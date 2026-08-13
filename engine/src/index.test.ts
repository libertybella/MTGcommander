import { describe, expect, it } from "vitest";
import { getEngineInfo } from "./info";

describe("engine foundation", () => {
  it("reports package identity without a UI", () => {
    const info = getEngineInfo();
    expect(info.name).toBe("mtgcommander-engine");
    expect(info.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
