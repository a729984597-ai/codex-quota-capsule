import { describe, expect, it } from "vitest";
import { createSerialExecutor } from "../src/serial.ts";

describe("createSerialExecutor", () => {
  it("does not start a second resize while the first one is measuring", async () => {
    const runSerially = createSerialExecutor();
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = runSerially(async () => {
      events.push("first:start");
      await firstGate;
      events.push("first:end");
    });
    const second = runSerially(async () => {
      events.push("second:start");
      events.push("second:end");
    });

    await Promise.resolve();
    expect(events).toEqual(["first:start"]);

    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual([
      "first:start",
      "first:end",
      "second:start",
      "second:end",
    ]);
  });

  it("continues the queue after a resize rejects", async () => {
    const runSerially = createSerialExecutor();
    const failed = runSerially(async () => {
      throw new Error("resize failed");
    });
    const recovered = runSerially(async () => "recovered");

    await expect(failed).rejects.toThrow("resize failed");
    await expect(recovered).resolves.toBe("recovered");
  });
});
