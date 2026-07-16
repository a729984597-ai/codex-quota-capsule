import { describe, expect, it } from "vitest";
import { codexPathCandidates } from "../src/paths.ts";

describe("codexPathCandidates", () => {
  it("splits Windows PATH with semicolons and includes .cmd/.exe", () => {
    // 评审修正：原样例双重转义（"C:\\\\bin" 是字面量 C:\\bin），已改为真实 PATH 形态
    const paths = codexPathCandidates(
      "C:\\bin;D:\\tools",
      "C:\\Users\\demo",
      "win32",
    );
    expect(paths).toContain("C:\\bin\\codex.cmd");
    expect(paths).toContain("C:\\bin\\codex.exe");
    expect(paths.some((p) => p.includes("npm"))).toBe(true);
    expect(paths.some((p) => p.includes(".codex"))).toBe(true);
  });

  it("splits POSIX PATH with colons", () => {
    const paths = codexPathCandidates(
      "/usr/local/bin:/usr/bin",
      "/home/demo",
      "linux",
    );
    expect(paths).toContain("/usr/local/bin/codex");
  });
});
