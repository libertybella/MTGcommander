import { cloneGameState } from "./clone";
import {
  applyCombatDamage,
  clearCombatFlagsInPlace,
  clearDamageInPlace,
  ensureCombatInPlace,
} from "./combat";
import { emptyManaPoolsInPlace } from "./mana";
import type { GameState, Phase, PlayerId, Step } from "./types";

export type TurnSlot = {
  phase: Phase;
  step: Step;
};

export const TURN_SEQUENCE: TurnSlot[] = [
  { phase: "beginning", step: "untap" },
  { phase: "beginning", step: "upkeep" },
  { phase: "beginning", step: "draw" },
  { phase: "precombatMain", step: "precombatMain" },
  { phase: "combat", step: "beginCombat" },
  { phase: "combat", step: "declareAttackers" },
  { phase: "combat", step: "declareBlockers" },
  { phase: "combat", step: "combatDamage" },
  { phase: "combat", step: "endCombat" },
  { phase: "postcombatMain", step: "postcombatMain" },
  { phase: "ending", step: "end" },
  { phase: "ending", step: "cleanup" },
];

function slotIndex(phase: Phase, step: Step): number {
  const index = TURN_SEQUENCE.findIndex((slot) => slot.phase === phase && slot.step === step);
  if (index === -1) {
    throw new Error(`Unknown turn slot ${phase}/${step}`);
  }
  return index;
}

function nextPlayerId(state: GameState, currentId: PlayerId): PlayerId {
  const index = state.players.findIndex((p) => p.id === currentId);
  if (index === -1) {
    throw new Error(`Unknown player ${currentId}`);
  }
  const next = state.players[(index + 1) % state.players.length];
  if (!next) {
    throw new Error("No next player");
  }
  return next.id;
}

function onEnterStep(state: GameState): GameState {
  if (state.turn.step === "untap") {
    const activeId = state.turn.activePlayerId;
    for (const card of Object.values(state.cards)) {
      if (card.zone === "battlefield" && card.controllerId === activeId) {
        card.tapped = false;
        card.summoningSick = false;
      }
    }
    return state;
  }
  if (state.turn.step === "declareAttackers") {
    ensureCombatInPlace(state);
    return state;
  }
  if (state.turn.step === "combatDamage") {
    return applyCombatDamage(state);
  }
  if (state.turn.step === "endCombat") {
    clearCombatFlagsInPlace(state);
    return state;
  }
  if (state.turn.step === "cleanup") {
    clearDamageInPlace(state);
    clearCombatFlagsInPlace(state);
    return state;
  }
  return state;
}

/**
 * Advance to the next step. After cleanup, the next player starts a new turn at untap.
 * The draw step is visited but does not move cards (no draw engine).
 */
export function advanceStep(state: GameState): GameState {
  const next = cloneGameState(state);
  emptyManaPoolsInPlace(next);
  const current = slotIndex(next.turn.phase, next.turn.step);
  const lastIndex = TURN_SEQUENCE.length - 1;

  if (current === lastIndex) {
    next.turn.activePlayerId = nextPlayerId(next, next.turn.activePlayerId);
    next.turn.number += 1;
    next.turn.phase = "beginning";
    next.turn.step = "untap";
  } else {
    const slot = TURN_SEQUENCE[current + 1];
    if (!slot) {
      throw new Error("Missing next turn slot");
    }
    next.turn.phase = slot.phase;
    next.turn.step = slot.step;
  }

  return onEnterStep(next);
}

export function advanceSteps(state: GameState, count: number): GameState {
  let current = state;
  for (let i = 0; i < count; i += 1) {
    current = advanceStep(current);
  }
  return current;
}
