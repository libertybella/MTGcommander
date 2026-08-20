import { describe, expect, it } from "vitest";
import { defaultStopPrefs, toggleStop, toPreferencesInput, LADDER_STEPS } from "./stopPrefs";

describe("stop preferences model", () => {
  it("defaults mirror the host: hold every non-skipped step of my turn", () => {
    const prefs = defaultStopPrefs();
    expect(prefs.myTurn.has("precombatMain")).toBe(true);
    expect(prefs.myTurn.has("end")).toBe(true);
    expect(prefs.myTurn.has("draw")).toBe(false);
    expect(prefs.myTurn.has("beginCombat")).toBe(false);
    expect(prefs.myTurn.has("cleanup")).toBe(false);
    expect(prefs.theirTurn.size).toBe(0);
    expect(prefs.fullControl).toBe(false);
    expect(prefs.yield).toBe("stops-only");
  });

  it("toggles a stop without mutating the original", () => {
    const prefs = defaultStopPrefs();
    const withEndStop = toggleStop(prefs, "theirTurn", "end");
    expect(withEndStop.theirTurn.has("end")).toBe(true);
    expect(prefs.theirTurn.has("end")).toBe(false);
    const removed = toggleStop(withEndStop, "theirTurn", "end");
    expect(removed.theirTurn.has("end")).toBe(false);
  });

  it("serializes to the wire shape", () => {
    const prefs = toggleStop(defaultStopPrefs(), "theirTurn", "end");
    const input = toPreferencesInput(prefs);
    expect(input.stops?.theirTurn).toEqual(["end"]);
    expect(input.fullControl).toBe(false);
    expect(input.yield).toBe("stops-only");
    expect(input.stops?.myTurn?.length).toBeGreaterThan(0);
  });

  it("covers every step in the ladder", () => {
    expect(LADDER_STEPS).toHaveLength(12);
  });
});
