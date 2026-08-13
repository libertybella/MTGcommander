import type { GameState } from "./types";

export function cloneGameState(state: GameState): GameState {
  return structuredClone(state);
}
