import { cloneGameState } from "./clone";
import {
  applyCombatDamage,
  clearCombatFlagsInPlace,
  clearDamageInPlace,
  ensureCombatInPlace,
} from "./combat";
import { applyEffect } from "./effects";
import { emptyManaPoolsInPlace } from "./mana";
import { livingPlayers, nextLivingPlayerId } from "./players";
import { applyStateBasedActionsInPlace } from "./status";
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

function nextTurnPlayerId(state: GameState, currentId: PlayerId): PlayerId {
  const living = livingPlayers(state);
  if (living.length === 0) {
    return currentId;
  }
  if (living.length === 1) {
    return living[0]?.id ?? currentId;
  }
  return nextLivingPlayerId(state, currentId);
}

function onEnterStep(state: GameState): GameState {
  if (state.turn.step === "untap") {
    const activeId = state.turn.activePlayerId;
    const active = state.players.find((player) => player.id === activeId);
    if (active) {
      active.landsPlayedThisTurn = 0;
    }
    for (const card of Object.values(state.cards)) {
      if (card.zone === "battlefield" && card.controllerId === activeId) {
        card.tapped = false;
        card.summoningSick = false;
      }
    }
    return state;
  }
  if (state.turn.step === "draw") {
    const active = state.players.find((player) => player.id === state.turn.activePlayerId);
    if (active && !active.lost && active.zones.library.length > 0) {
      return applyEffect(state, { kind: "draw", playerId: active.id, count: 1 });
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
 * Start the next living player's turn at untap. Used when the active player has lost.
 */
export function beginNextLivingTurnInPlace(state: GameState): void {
  const living = livingPlayers(state);
  if (living.length === 0) {
    return;
  }
  emptyManaPoolsInPlace(state);
  const nextId = nextTurnPlayerId(state, state.turn.activePlayerId);
  state.turn.activePlayerId = nextId;
  state.turn.number += 1;
  state.turn.phase = "beginning";
  state.turn.step = "untap";
  state.combat = null;
  state.passesSinceAction = 0;
  state.priorityPlayerId = nextId;
  onEnterStep(state);
}

/**
 * Advance to the next step. After cleanup, the next living player starts a new turn at untap.
 * Entering the draw step draws one card for the active player when their library is not empty.
 */
export function advanceStep(state: GameState): GameState {
  const next = cloneGameState(state);
  emptyManaPoolsInPlace(next);
  const current = slotIndex(next.turn.phase, next.turn.step);
  const lastIndex = TURN_SEQUENCE.length - 1;

  if (current === lastIndex) {
    next.turn.activePlayerId = nextTurnPlayerId(next, next.turn.activePlayerId);
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

  const entered = onEnterStep(next);
  applyStateBasedActionsInPlace(entered);
  return entered;
}

export function advanceSteps(state: GameState, count: number): GameState {
  let current = state;
  for (let i = 0; i < count; i += 1) {
    current = advanceStep(current);
  }
  return current;
}
