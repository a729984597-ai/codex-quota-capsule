import type { DiagnosticCode } from "@quota-capsule/core";

export function classifyCodexError(message: string): DiagnosticCode {
  const lower = message.toLowerCase();
  if (/auth|login|unauthorized|unauthenticated/.test(lower)) {
    return "auth_required";
  }
  if (/timed?\s*out|timeout/.test(lower)) {
    return "timeout";
  }
  if (/not found|enoent|cli_missing|binary was not found/.test(lower)) {
    return "cli_missing";
  }
  return "parse_error";
}
