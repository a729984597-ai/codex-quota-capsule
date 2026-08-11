import type { DiagnosticCode } from "@quota-capsule/core";

export function classifyCursorError(message: string): DiagnosticCode {
  const lower = message.toLowerCase();
  if (/timed?\s*out|timeout|abort/.test(lower)) {
    return "timeout";
  }
  if (
    /enoent|not found|missing state\.vscdb|state\.vscdb was not found|cli_missing/.test(
      lower,
    )
  ) {
    return "cli_missing";
  }
  if (
    /unauthorized|unauthenticated|\b401\b|\b403\b|accessToken missing|not be logged in|jwt expired|invalid token|http 401|http 403|shouldlogout|empty access_token|refresh requires login|access token expired/.test(
      lower,
    )
  ) {
    return "auth_required";
  }
  return "parse_error";
}
