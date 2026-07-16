import { describe, expect, it } from "vitest";
import { classifyCodexError } from "../src/diagnose.ts";

describe("classifyCodexError", () => {
  it("maps auth-related messages to auth_required", () => {
    expect(classifyCodexError("unauthorized: please login")).toBe("auth_required");
    expect(classifyCodexError("Auth required")).toBe("auth_required");
  });

  it("maps timeouts", () => {
    expect(classifyCodexError("codex app-server timed out after 30000ms")).toBe(
      "timeout",
    );
  });

  it("maps missing CLI", () => {
    expect(classifyCodexError("codex binary was not found")).toBe("cli_missing");
    expect(classifyCodexError("ENOENT: not found")).toBe("cli_missing");
  });

  it("defaults to parse_error", () => {
    expect(classifyCodexError("unexpected shape")).toBe("parse_error");
  });
});
