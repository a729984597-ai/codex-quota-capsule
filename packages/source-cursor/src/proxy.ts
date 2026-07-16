import { execFileSync } from "node:child_process";

export type ProxyConfig = {
  host: string;
  port: number;
};

/**
 * Resolve an HTTP proxy for HTTPS requests: env vars first, then the Windows
 * per-user proxy (the one Cursor itself uses). Returns null when no proxy is
 * enabled.
 */
export function detectSystemProxy(
  env: NodeJS.ProcessEnv = process.env,
): ProxyConfig | null {
  const fromEnv =
    env.HTTPS_PROXY ?? env.https_proxy ?? env.HTTP_PROXY ?? env.http_proxy;
  const parsedEnv = parseProxyUrl(fromEnv);
  if (parsedEnv) return parsedEnv;

  if (process.platform !== "win32") return null;
  return readWindowsProxy();
}

function readWindowsProxy(): ProxyConfig | null {
  try {
    const out = execFileSync(
      "reg",
      [
        "query",
        "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings",
      ],
      { encoding: "utf8", windowsHide: true },
    );
    const enabled = /ProxyEnable\s+REG_DWORD\s+0x1/i.test(out);
    if (!enabled) return null;
    const match = out.match(/ProxyServer\s+REG_SZ\s+(\S+)/i);
    if (!match) return null;
    return parseProxyServerValue(match[1]);
  } catch {
    return null;
  }
}

/** Handles both "host:port" and "http=host:port;https=host:port" formats. */
function parseProxyServerValue(value: string): ProxyConfig | null {
  if (value.includes("=")) {
    for (const part of value.split(";")) {
      const [scheme, addr] = part.split("=");
      if ((scheme === "https" || scheme === "http") && addr) {
        const parsed = parseHostPort(addr);
        if (parsed) return parsed;
      }
    }
    return null;
  }
  return parseHostPort(value);
}

function parseProxyUrl(value: string | undefined): ProxyConfig | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const port = Number(url.port || 80);
    if (!url.hostname || !Number.isFinite(port)) return null;
    return { host: url.hostname, port };
  } catch {
    return parseHostPort(value);
  }
}

function parseHostPort(value: string): ProxyConfig | null {
  const cleaned = value.replace(/^https?:\/\//, "");
  const idx = cleaned.lastIndexOf(":");
  if (idx <= 0) return null;
  const host = cleaned.slice(0, idx);
  const port = Number(cleaned.slice(idx + 1));
  if (!host || !Number.isFinite(port) || port <= 0 || port > 65535) {
    return null;
  }
  return { host, port };
}
