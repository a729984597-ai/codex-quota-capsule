import type { AgentQuotaSnapshot } from "@quota-capsule/core";
import { classifyCodexError } from "./diagnose.js";
import { parseCodexRateLimits } from "./parse.js";
import { findCodexPath } from "./paths.js";
import {
  ProcessCodexAppServerTransport,
  type CodexAppServerTransport,
} from "./transport.js";
import { readCodexSubscriptionValidity } from "./subscription.js";

export type CodexAppServerReadOptions = {
  fetchedAt?: Date;
  codexPath?: string;
  timeoutMs?: number;
};

export async function readCodexRateLimits(
  options: CodexAppServerReadOptions = {},
): Promise<AgentQuotaSnapshot> {
  const fetchedAt = options.fetchedAt ?? new Date();
  const resolution = options.codexPath
    ? { codexPath: options.codexPath, checkedPaths: [options.codexPath] }
    : await findCodexPath();
  const codexPath = resolution.codexPath;

  if (!codexPath) {
    return errorSnapshot(
      fetchedAt,
      `codex binary was not found. Checked paths: ${resolution.checkedPaths.join(", ")}`,
    );
  }

  const transport = new ProcessCodexAppServerTransport(
    codexPath,
    options.timeoutMs,
  );

  try {
    const snapshot = await readCodexRateLimitsFromTransport(transport, {
      fetchedAt,
      timeoutMs: options.timeoutMs,
    });
    if (snapshot.sourceStatus !== "ok") return snapshot;

    const subscription = await readCodexSubscriptionValidity();
    return subscription ? { ...snapshot, subscription } : snapshot;
  } finally {
    transport.close();
  }
}

export async function readCodexRateLimitsFromTransport(
  transport: CodexAppServerTransport,
  options: { fetchedAt: Date; timeoutMs?: number },
): Promise<AgentQuotaSnapshot> {
  try {
    const requestedTimeout = options.timeoutMs ?? 30_000;
    const timeoutMs =
      Number.isFinite(requestedTimeout) && requestedTimeout > 0
        ? Math.min(requestedTimeout, 300_000)
        : 30_000;
    const deadline = Date.now() + timeoutMs;

    await transport.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        clientInfo: {
          name: "quota-capsule",
          title: "Quota Capsule",
          version: "0.0.0",
        },
        capabilities: {},
      },
    });

    const initialized = await readUntilId(transport, 1, deadline);
    const initError = readRpcError(initialized);
    if (initError) return errorSnapshot(options.fetchedAt, initError);

    await transport.send({ jsonrpc: "2.0", method: "initialized", params: {} });
    await transport.send({
      jsonrpc: "2.0",
      id: 2,
      method: "account/rateLimits/read",
      params: {},
    });

    const rateLimits = await readUntilId(transport, 2, deadline);
    const rateLimitError = readRpcError(rateLimits);
    if (rateLimitError) return errorSnapshot(options.fetchedAt, rateLimitError);

    return parseCodexRateLimits(readObject(rateLimits).result, {
      fetchedAt: options.fetchedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorSnapshot(options.fetchedAt, message);
  }
}

async function readUntilId(
  transport: CodexAppServerTransport,
  id: number,
  deadline: number,
): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error("codex app-server request exceeded its overall deadline.");
    }
    const message = readObject(await transport.read(remaining));
    if (message.id !== id) continue;
    return message;
  }

  throw new Error(`codex app-server did not return response id ${id}.`);
}

function readRpcError(message: Record<string, unknown>): string | null {
  const error = readObject(message.error);
  const messageText = error.message;
  return typeof messageText === "string" ? messageText : null;
}

function errorSnapshot(
  fetchedAt: Date,
  errorMessage: string,
): AgentQuotaSnapshot {
  return {
    provider: "codex",
    sourceStatus: "error",
    fetchedAt,
    diagnosticCode: classifyCodexError(errorMessage),
    errorMessage,
  };
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
