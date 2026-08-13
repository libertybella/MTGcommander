import { describe, expect, it } from "vitest";
import { getServerInfo } from "./index";

describe("server foundation", () => {
  it("imports the engine without starting a network listener", () => {
    const info = getServerInfo();
    expect(info.name).toBe("mtgcommander-server");
    expect(info.engine.name).toBe("mtgcommander-engine");
    expect(info.engine.version).toBeTruthy();
  });
});
