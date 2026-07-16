import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { homedir } from "node:os";

export type CodexAppServerTransport = {
  send(payload: unknown): void | Promise<void>;
  read(timeoutMs?: number): Promise<unknown>;
  close?(): void;
};

export class ProcessCodexAppServerTransport implements CodexAppServerTransport {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly lines: string[] = [];
  private readonly waiters: Array<{
    resolve: (line: string) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];
  private readonly timeoutMs: number;
  private stderr = "";
  private closed = false;
  private terminalError: Error | null = null;
  private stdoutBuffer = "";
  private readonly stdoutDecoder = new StringDecoder("utf8");

  constructor(codexPath: string, timeoutMs = 30_000) {
    this.timeoutMs = timeoutMs;
    this.child = spawn(
      codexPath,
      ["-s", "read-only", "-a", "untrusted", "app-server"],
      {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        env: process.env,
        shell: process.platform === "win32",
      },
    );
    this.child.stdout.on("data", (chunk: Buffer) => this.appendStdout(chunk));
    this.child.stderr.on("data", (chunk: Buffer) => {
      this.stderr += chunk.toString("utf8");
      if (this.stderr.length > 8_192) this.stderr = this.stderr.slice(-8_192);
    });
    this.child.once("error", (error) =>
      this.fail(new Error(`codex app-server failed to start: ${error.message}`)),
    );
    this.child.once("exit", (code) => {
      this.fail(
        new Error(
          `codex app-server exited before response.${code === null ? "" : ` exit code: ${code}`}`,
        ),
      );
    });
  }

  send(payload: unknown): void {
    if (this.closed) throw new Error("codex app-server transport is closed.");
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  async read(timeoutMs = this.timeoutMs): Promise<unknown> {
    const line = await this.readLine(timeoutMs);
    try {
      return JSON.parse(line);
    } catch {
      throw new Error("codex app-server returned an unparseable JSON-RPC message.");
    }
  }

  close(): void {
    this.closed = true;
    this.fail(new Error("codex app-server transport is closed."));
    this.child.kill();
  }

  private appendStdout(chunk: Buffer): void {
    if (this.terminalError) return;
    this.stdoutBuffer += this.stdoutDecoder.write(chunk);
    if (Buffer.byteLength(this.stdoutBuffer, "utf8") > 1_048_576) {
      this.fail(new Error("codex app-server output exceeded the safety limit."));
      this.child.kill();
      return;
    }

    let newline = this.stdoutBuffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.stdoutBuffer.slice(0, newline).replace(/\r$/, "");
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      this.acceptLine(line);
      if (this.terminalError) return;
      newline = this.stdoutBuffer.indexOf("\n");
    }
  }

  private acceptLine(line: string): void {
    if (this.terminalError) return;
    if (Buffer.byteLength(line, "utf8") > 1_048_576) {
      this.fail(new Error("codex app-server output exceeded the safety limit."));
      this.child.kill();
      return;
    }
    const waiter = this.waiters.shift();
    if (waiter) {
      clearTimeout(waiter.timer);
      waiter.resolve(line);
      return;
    }
    if (this.lines.length >= 1_000) {
      this.fail(new Error("codex app-server queued too many messages."));
      return;
    }
    this.lines.push(line);
  }

  private readLine(timeoutMs: number): Promise<string> {
    const existing = this.lines.shift();
    if (existing !== undefined) return Promise.resolve(existing);
    if (this.terminalError) return Promise.reject(this.terminalError);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const index = this.waiters.findIndex((waiter) => waiter.resolve === resolve);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(
          new Error(
            `codex app-server timed out after ${timeoutMs}ms.${safeStderrSuffix(this.stderr)}`,
          ),
        );
      }, Math.max(0, timeoutMs));

      this.waiters.push({ resolve, reject, timer: timeout });
    });
  }

  private fail(error: Error): void {
    if (!this.terminalError) this.terminalError = error;
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(this.terminalError);
    }
  }
}

export function safeStderrSuffix(stderr: string): string {
  if (!stderr) return "";
  const home = homedir().replace(/\\/g, "\\\\");
  const sanitized = stderr
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/https?:\/\/\S+/g, "[remote service]")
    .replace(new RegExp(home, "gi"), "[home]")
    .replace(/\/Users\/[^/\s]+/g, "/Users/[redacted]")
    .replace(/C:\\Users\\[^\\\s]+/gi, "C:\\Users\\[redacted]")
    .replace(/\s+/g, " ")
    .slice(0, 512);
  return ` stderr: ${sanitized}`;
}
