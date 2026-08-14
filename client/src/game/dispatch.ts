import { applyAction, type GameAction, type GameState } from "@mtgcommander/engine";

export type ApplyResult =
  | { ok: true; state: GameState }
  | { ok: false; error: string };

/** Single path from the UI into the engine. Does not mutate the previous state. */
export function dispatchAction(state: GameState, action: GameAction): ApplyResult {
  try {
    return { ok: true, state: applyAction(state, action) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "That action failed";
    return { ok: false, error: message };
  }
}
