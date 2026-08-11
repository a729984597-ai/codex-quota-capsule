import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { TLSSocket } from "node:tls";
import { connect as tlsConnect } from "node:tls";
import { detectSystemProxy } from "./proxy.js";

const OAUTH_HOST = "api2.cursor.sh";
const OAUTH_PATH = "/oauth/token";
const OAUTH_URL = `https://${OAUTH_HOST}${OAUTH_PATH}`;

/** Public Cursor IDE OAuth client id (same as desktop / Cockpit refresh). */
export const CURSOR_OAUTH_CLIENT_ID = "KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB";

export type RefreshCursorAccessTokenOptions = {
  refreshToken: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  clientId?: string;
};

/**
 * Exchange a Cursor refresh token for a fresh access token.
 * Never logs tokens. Does not persist anything.
 */
export async function refreshCursorAccessToken(
  options: RefreshCursorAccessTokenOptions,
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const clientId = options.clientId ?? CURSOR_OAUTH_CLIENT_ID;
  const body = {
    grant_type: "refresh_token",
    client_id: clientId,
    refresh_token: options.refreshToken,
  };

  const text = options.fetchImpl
    ? await postViaFetch(options.fetchImpl, body, timeoutMs)
    : await postViaHttps(body, timeoutMs);

  let parsed: {
    access_token?: unknown;
    shouldLogout?: unknown;
  };
  try {
    parsed = JSON.parse(text) as {
      access_token?: unknown;
      shouldLogout?: unknown;
    };
  } catch {
    throw new Error(
      `cursor oauth refresh response was not JSON: ${text.slice(0, 180)}`,
    );
  }

  if (parsed.shouldLogout === true) {
    throw new Error(
      "cursor oauth refresh requires login (shouldLogout) — Cursor may not be logged in",
    );
  }

  const access =
    typeof parsed.access_token === "string" ? parsed.access_token : "";
  if (!access) {
    throw new Error(
      "cursor oauth refresh returned empty access_token — Cursor may not be logged in",
    );
  }
  return access;
}

async function postViaFetch(
  fetchImpl: typeof fetch,
  body: Record<string, string>,
  timeoutMs: number,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(OAUTH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "QuotaCapsuleWindows/0.1",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(
        `cursor oauth refresh HTTP ${res.status}: ${text.slice(0, 180)}`,
      );
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function postViaHttps(
  body: Record<string, string>,
  timeoutMs: number,
): Promise<string> {
  const raw = JSON.stringify(body);
  const headers = {
    "Content-Type": "application/json",
    "User-Agent": "QuotaCapsuleWindows/0.1",
    "Content-Length": String(Buffer.byteLength(raw)),
  };
  const proxy = detectSystemProxy();
  return proxy
    ? postViaProxy(proxy.host, proxy.port, headers, raw, timeoutMs)
    : postDirect(headers, raw, timeoutMs);
}

function postDirect(
  headers: Record<string, string>,
  raw: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        host: OAUTH_HOST,
        port: 443,
        path: OAUTH_PATH,
        method: "POST",
        headers,
        timeout: timeoutMs,
      },
      (res) => collectResponse(res, resolve, reject),
    );
    req.on("timeout", () =>
      req.destroy(new Error("cursor oauth refresh timeout")),
    );
    req.on("error", reject);
    req.end(raw);
  });
}

function postViaProxy(
  proxyHost: string,
  proxyPort: number,
  headers: Record<string, string>,
  raw: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const connectReq = httpRequest({
      host: proxyHost,
      port: proxyPort,
      method: "CONNECT",
      path: `${OAUTH_HOST}:443`,
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
        servername: OAUTH_HOST,
      });
      tls.on("error", reject);
      const req = httpsRequest(
        {
          host: OAUTH_HOST,
          path: OAUTH_PATH,
          method: "POST",
          headers,
          timeout: timeoutMs,
          createConnection: () => tls,
        },
        (r) => collectResponse(r, resolve, reject),
      );
      req.on("timeout", () =>
        req.destroy(new Error("cursor oauth refresh timeout")),
      );
      req.on("error", reject);
      req.end(raw);
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
      reject(
        new Error(
          `cursor oauth refresh HTTP ${status}: ${text.slice(0, 180)}`,
        ),
      );
      return;
    }
    resolve(text);
  });
}
