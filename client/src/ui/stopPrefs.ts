import { DEFAULT_SHORTCUT_POLICY, TURN_SEQUENCE, type Step } from "@mtgcommander/engine";
import type { SeatPreferencesInput } from "@mtgcommander/server";

/**
 * Client-side model of a seat's priority preferences (mirrors the host's
 * SeatPreferences). The ladder edits this; App sends it to the local host or
 * over the WebSocket as a `preferences` message.
 */
export type StopPrefs = {
  myTurn: Set<Step>;
  theirTurn: Set<Step>;
  fullControl: boolean;
  yield: "stops-only" | "smart";
};

export const LADDER_STEPS: Step[] = TURN_SEQUENCE.map((slot) => slot.step);

export function defaultStopPrefs(): StopPrefs {
  return {
    myTurn: new Set(
      LADDER_STEPS.filter((step) => !DEFAULT_SHORTCUT_POLICY.skippableSteps.has(step)),
    ),
    theirTurn: new Set(),
    fullControl: false,
    yield: "stops-only",
  };
}

export type StopScope = "myTurn" | "theirTurn";

export function toggleStop(prefs: StopPrefs, scope: StopScope, step: Step): StopPrefs {
  const next = {
    ...prefs,
    myTurn: new Set(prefs.myTurn),
    theirTurn: new Set(prefs.theirTurn),
  };
  if (next[scope].has(step)) {
    next[scope].delete(step);
  } else {
    next[scope].add(step);
  }
  return next;
}

export function toPreferencesInput(prefs: StopPrefs): SeatPreferencesInput {
  return {
    stops: {
      myTurn: [...prefs.myTurn],
      theirTurn: [...prefs.theirTurn],
    },
    fullControl: prefs.fullControl,
    yield: prefs.yield,
  };
}

export const STEP_SHORT_LABELS: Record<Step, string> = {
  untap: "Untap",
  upkeep: "Upkeep",
  draw: "Draw",
  precombatMain: "Main 1",
  beginCombat: "Combat",
  declareAttackers: "Attack",
  declareBlockers: "Block",
  combatDamage: "Damage",
  endCombat: "End Cbt",
  postcombatMain: "Main 2",
  end: "End",
  cleanup: "Cleanup",
};
