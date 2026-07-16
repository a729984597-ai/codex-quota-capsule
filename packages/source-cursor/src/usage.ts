import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { TLSSocket } from "node:tls";
import { connect as tlsConnect } from "node:tls";
import { detectSystemProxy } from "./proxy.js";

const USAGE_HOST = "api2.cursor.sh";
const USAGE_PATH = "/aiserver.v1.DashboardService/GetCurrentPeriodUsage";
const USAGE_URL = `https://${USAGE_HOST}${USAGE_PATH}`;

export type FetchCursorUsageOptions = {
  accessToken: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export async function fetchCursorPeriodUsage(
  options: FetchCursorUsageOptions,
): Promise<unknown> {
  const timeoutMs = options.timeoutMs ?? 30_000;

  if (options.fetchImpl) {
    return fetchViaFetch(options.fetchImpl, options.accessToken, timeoutMs);
  }

  const headers = {
    Authorization: `Bearer ${options.accessToken}`,
    "Content-Type": "application/json",
    "Connect-Protocol-Version": "1",
    "User-Agent": "QuotaCapsuleWindows/0.1",
    "Content-Length": "2",
  };

  const proxy = detectSystemProxy();
  const text = proxy
    ? await postViaProxy(proxy.host, proxy.port, headers, timeoutMs)
    : await postDirect(headers, timeoutMs);

  return parseBody(text);
}

async function fetchViaFetch(
  fetchImpl: typeof fetch,
  accessToken: string,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(USAGE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Connect-Protocol-Version": "1",
        "User-Agent": "QuotaCapsuleWindows/0.1",
      },
      body: "{}",
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`cursor usage HTTP ${res.status}: ${text.slice(0, 180)}`);
    }
    return parseBody(text, true);
  } finally {
    clearTimeout(timer);
  }
}

function parseBody(text: string, alreadyChecked = false): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    if (alreadyChecked) {
      throw new Error("cursor usage response was not JSON");
    }
    throw new Error(`cursor usage response was not JSON: ${text.slice(0, 180)}`);
  }
}

function postDirect(
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        host: USAGE_HOST,
        port: 443,
        path: USAGE_PATH,
        method: "POST",
        headers,
        timeout: timeoutMs,
      },
      (res) => collectResponse(res, resolve, reject),
    );
    req.on("timeout", () => req.destroy(new Error("cursor usage timeout")));
    req.on("error", reject);
    req.end("{}");
  });
}

/** HTTPS over an HTTP proxy using a CONNECT tunnel. */
function postViaProxy(
  proxyHost: string,
  proxyPort: number,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const connectReq = httpRequest({
      host: proxyHost,
      port: proxyPort,
      method: "CONNECT",
      path: `${USAGE_HOST}:443`,
      timeout: timeoutMs,
    });
    connectReq.on("timeout", () =>
      connectReq.destroy(new Error("proxy CONNECT timeout")),
    );
    connectReq.on("error", reject);
    connectReq.on("connect", (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        reject(new Error(`proxy CONNECT failed: HTTP ${res.statusCode}`));
        return;
      }
      const tls: TLSSocket = tlsConnect({
        socket,
        servername: USAGE_HOST,
      });
      tls.on("error", reject);
      const req = httpsRequest(
        {
          host: USAGE_HOST,
          path: USAGE_PATH,
          method: "POST",
          headers,
          timeout: timeoutMs,
          createConnection: () => tls,
        },
        (r) => collectResponse(r, resolve, reject),
      );
      req.on("timeout", () => req.destroy(new Error("cursor usage timeout")));
      req.on("error", reject);
      req.end("{}");
    });
    connectReq.end();
  });
}

function collectResponse(
  res: import("node:http").IncomingMessage,
  resolve: (text: string) => void,
  reject: (err: Error) => void,
): void {
  const chunks: Buffer[] = [];
  res.on("data", (c: Buffer) => chunks.push(c));
  res.on("error", reject);
  res.on("end", () => {
    const text = Buffer.concat(chunks).toString("utf8");
    const status = res.statusCode ?? 0;
    if (status < 200 || status >= 300) {
      reject(new Error(`cursor usage HTTP ${status}: ${text.slice(0, 180)}`));
      return;
    }
    resolve(text);
  });
}
