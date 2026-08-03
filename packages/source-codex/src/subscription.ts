import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SubscriptionInfo } from "@quota-capsule/core";

const OPENAI_AUTH_CLAIM = "https://api.openai.com/auth";
const MAX_AUTH_FILE_BYTES = 2 * 1024 * 1024;

export type ReadCodexSubscriptionOptions = {
  authPath?: string;
  codexHome?: string;
};

/**
 * Read only the Plus plan name and active-until timestamp from Codex auth.
 * Token strings and all other account claims stay inside this module.
 */
export async function readCodexSubscriptionValidity(
  options: ReadCodexSubscriptionOptions = {},
): Promise<SubscriptionInfo | null> {
  const codexHome =
    options.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), ".codex");
  const authPath = options.authPath ?? join(codexHome, "auth.json");

  try {
    const json = await readFile(authPath, "utf8");
    if (Buffer.byteLength(json, "utf8") > MAX_AUTH_FILE_BYTES) return null;
    return parseCodexSubscriptionAuth(JSON.parse(json));
  } catch {
    return null;
  }
}

export function parseCodexSubscriptionAuth(
  auth: unknown,
): SubscriptionInfo | null {
  const tokens = readObject(readObject(auth).tokens);
  const idToken = tokens.id_token;
  if (typeof idToken !== "string") return null;

  const claims = decodeJwtPayload(idToken);
  if (!claims) return null;

  const openaiAuth = readObject(claims[OPENAI_AUTH_CLAIM]);
  const planType = openaiAuth.chatgpt_plan_type;
  const activeUntil = openaiAuth.chatgpt_subscription_active_until;
  if (
    typeof planType !== "string" ||
    planType.toLowerCase() !== "plus" ||
    typeof activeUntil !== "string"
  ) {
    return null;
  }

  const expiresAt = new Date(activeUntil);
  if (!Number.isFinite(expiresAt.getTime())) return null;

  return { planType: "plus", activeUntil: expiresAt };
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[1].length > MAX_AUTH_FILE_BYTES) return null;

  try {
    const decoded = Buffer.from(parts[1], "base64url").toString("utf8");
    return readObject(JSON.parse(decoded));
  } catch {
    return null;
  }
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
