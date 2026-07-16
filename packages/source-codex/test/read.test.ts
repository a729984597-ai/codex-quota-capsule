import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readCodexRateLimitsFromTransport } from "../src/read.ts";
import type { CodexAppServerTransport } from "../src/transport.ts";

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/codex-rate-limits",
);

class FakeTransport implements CodexAppServerTransport {
  private readonly queue: unknown[];
  readonly sent: unknown[] = [];

  constructor(messages: unknown[]) {
    this.queue = [...messages];
  }

  send(payload: unknown): void {
    this.sent.push(payload);
  }

  async read(): Promise<unknown> {
    const next = this.queue.shift();
    if (next === undefined) throw new Error("fake transport exhausted");
    return next;
  }
}

describe("readCodexRateLimitsFromTransport", () => {
  it("reads initialize + rateLimits via fake transport", async () => {
    const result = JSON.parse(
      readFileSync(join(fixturesDir, "weekly-ok.json"), "utf8"),
    );
    const transport = new FakeTransport([
      { jsonrpc: "2.0", id: 1, result: { ok: true } },
      { jsonrpc: "2.0", id: 2, result },
    ]);
    const fetchedAt = new Date("2026-07-16T00:00:00.000Z");
    const snap = await readCodexRateLimitsFromTransport(transport, { fetchedAt });
    expect(snap.sourceStatus).toBe("ok");
    expect(snap.weeklyWindow?.label).toBe("weekly");
    expect(transport.sent[0]).toMatchObject({ method: "initialize", id: 1 });
    expect(transport.sent[2]).toMatchObject({
      method: "account/rateLimits/read",
      id: 2,
    });
  });
});
