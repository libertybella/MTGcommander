import { characteristicsOf, isCreature } from "./cardTypes";
import { abilitiesRemoved } from "./characteristicsEngine";
import { cloneGameState } from "./clone";
import {
  applyCombatDamage,
  clearCombatFlagsInPlace,
  clearDamageInPlace,
  ensureCombatInPlace,
} from "./combat";
import { applyEffect } from "./effects";
import { maxHandSizeOf, wouldSkipDraw } from "./derived";
import { emptyManaPoolsInPlace } from "./mana";
import { livingPlayers, nextLivingPlayerId } from "./players";
import { applyStateBasedActionsInPlace } from "./status";
import { dispatchEventsInPlace, queueBeginCombatTriggersInPlace } from "./triggers";
import type { EngineEvent, GameState, Phase, PlayerId, Step } from "./types";

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

function playerIndex(state: GameState, playerId: PlayerId): number {
  const index = state.players.findIndex((player) => player.id === playerId);
  return index === -1 ? 0 : index;
}

/** True when play wraps past the original first player's seat. */
function crossesFirstPlayerSeat(state: GameState, currentId: PlayerId, nextId: PlayerId): boolean {
  const startIndex = playerIndex(state, state.firstPlayerId);
  let index = playerIndex(state, currentId);
  for (let step = 0; step < state.players.length; step += 1) {
    index = (index + 1) % state.players.length;
    if (index === startIndex) {
      return true;
    }
    if (state.players[index]?.id === nextId) {
      return false;
    }
  }
  return false;
}

function assignNextPlayerTurn(state: GameState, nextId: PlayerId): void {
  if (crossesFirstPlayerSeat(state, state.turn.activePlayerId, nextId)) {
    state.turn.number += 1;
  }
  state.turn.activePlayerId = nextId;
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
      active.attackedThisTurn = false;
      active.attackersThisTurn = 0;
    }
    // As Foretold: the once-per-turn free cast refreshes for everyone.
    if (state.freeCastUsedThisTurn && state.freeCastUsedThisTurn.length > 0) {
      state.freeCastUsedThisTurn = [];
    }
    // Explore-style one-shot land-drop grants expire with the turn.
    for (const player of state.players) {
      if (player.extraLandDropsThisTurn) {
        delete player.extraLandDropsThisTurn;
      }
    }
    // "Only once each turn" abilities reset when a new turn begins.
    state.oncePerTurnFired = [];
    // Unused extra combats do not carry across turns.
    state.pendingExtraCombats = 0;
    state.spellsCastThisTurn = 0;
    state.spellsCastByPlayerThisTurn = {};
    state.noncreatureSpellsCastByPlayerThisTurn = {};
    state.creaturesDiedThisTurn = 0;
    state.createdTokenThisTurn = [];
    state.drawsByPlayerThisTurn = {};
    state.combatPhasesThisTurn = 0;
    // Goad lasts "until your next turn" (CR 701.38), so the active player's
    // own goads expire as their turn begins — every other goader's stay on.
    // Bident's "attacks this turn" is spent by then either way.
    for (const card of Object.values(state.cards)) {
      if (card.goadedBy?.includes(activeId)) {
        const left = card.goadedBy.filter((playerId) => playerId !== activeId);
        if (left.length > 0) {
          card.goadedBy = left;
        } else {
          delete card.goadedBy;
        }
      }
      if (card.mustAttackThisTurn) {
        delete card.mustAttackThisTurn;
      }
    }
    const untappedEvents: EngineEvent[] = [];
    const untapInPlace = (card: (typeof state.cards)[string]) => {
      if (card.tapped) {
        untappedEvents.push({ kind: "untapped", cardId: card.id });
      }
      card.tapped = false;
    };
    for (const card of Object.values(state.cards)) {
      if (card.zone === "battlefield" && card.controllerId === activeId) {
        // "~ doesn't untap during your untap step" (ability removal restores it).
        const staysTapped =
          state.definitions[card.definitionId]?.doesntUntap === true &&
          !abilitiesRemoved(state, card.id);
        // Vorinclex froze it: skip this one untap step, then clear.
        if (card.skipNextUntap) {
          card.skipNextUntap = false;
        } else if (!staysTapped) {
          untapInPlace(card);
        }
        card.summoningSick = false;
        card.loyaltyActivatedThisTurn = false;
      }
    }
    // Drumbellower / Seedborn Muse: their controller's creatures (or all
    // their permanents) untap during everyone else's untap step too.
    for (const source of Object.values(state.cards)) {
      const scope = state.definitions[source.definitionId]?.untapDuringEachUntap;
      if (
        !scope ||
        source.zone !== "battlefield" ||
        source.controllerId === activeId ||
        abilitiesRemoved(state, source.id)
      ) {
        continue;
      }
      for (const card of Object.values(state.cards)) {
        if (card.zone !== "battlefield" || card.controllerId !== source.controllerId) {
          continue;
        }
        const matches =
          scope === "permanents" ||
          (scope === "artifacts"
            ? characteristicsOf(state, card.id).types.includes("artifact")
            : isCreature(state, card.id));
        if (matches) {
          untapInPlace(card);
        }
      }
    }
    dispatchEventsInPlace(state, untappedEvents);
    return state;
  }
  if (state.turn.step === "upkeep") {
    // Rebound: the caster's exiled spells become free casts this turn. An
    // unused offer stays exiled for good (CR 702.87e).
    const activeId = state.turn.activePlayerId;
    const rebounds = (state.pendingRebounds ?? []).filter(
      (entry) => entry.casterId === activeId,
    );
    if (rebounds.length > 0) {
      state.pendingRebounds = (state.pendingRebounds ?? []).filter(
        (entry) => entry.casterId !== activeId,
      );
      const grants = state.exilePlayable ?? [];
      for (const entry of rebounds) {
        if (state.cards[entry.cardId]?.zone === "exile") {
          grants.push({ cardId: entry.cardId, casterId: entry.casterId, freeCast: true });
        }
      }
      state.exilePlayable = grants;
    }
    dispatchEventsInPlace(state, [{ kind: "step_begins", step: "upkeep" }]);
    return state;
  }
  if (state.turn.step === "end") {
    // "At the beginning of the next end step" one-shots (temporary tokens,
    // reanimation shells) fire before the step's other triggers.
    let current = state;
    const pending = [...current.delayedEndStep];
    if (pending.length > 0) {
      current.delayedEndStep = [];
      for (const entry of pending) {
        const card = current.cards[entry.cardId];
        // Charming Prince: the returning card waits in exile, not on the
        // battlefield.
        if (entry.action === "battlefield") {
          if (card && card.zone === "exile") {
            current = applyEffect(current, {
              kind: "move_card",
              cardId: entry.cardId,
              toZone: "battlefield",
              ...(entry.controllerId ? { controllerId: entry.controllerId } : {}),
            });
            // Parting Gust: "with a +1/+1 counter on it".
            if (entry.withCounter && current.cards[entry.cardId]?.zone === "battlefield") {
              current = applyEffect(current, {
                kind: "add_counter",
                cardId: entry.cardId,
                counter: entry.withCounter,
                amount: 1,
              });
            }
          }
          continue;
        }
        // Necropotence: an exiled card can be waiting to come to hand.
        if (entry.action === "hand" && card && card.zone === "exile") {
          current = applyEffect(current, { kind: "move_card", cardId: entry.cardId, toZone: "hand" });
          continue;
        }
        if (!card || card.zone !== "battlefield") {
          continue;
        }
        current =
          entry.action === "sacrifice"
            ? applyEffect(current, { kind: "sacrifice", cardId: entry.cardId })
            : entry.action === "hand"
              ? applyEffect(current, { kind: "move_card", cardId: entry.cardId, toZone: "hand" })
              : applyEffect(current, { kind: "move_card", cardId: entry.cardId, toZone: "exile" });
      }
    }
    dispatchEventsInPlace(current, [{ kind: "step_begins", step: "end" }]);
    return current;
  }
  if (state.turn.step === "draw") {
    const active = state.players.find((player) => player.id === state.turn.activePlayerId);
    if (active && !active.lost && !wouldSkipDraw(state, active.id)) {
      // Howling Mine-class: every extra-draw permanent on the battlefield
      // (anyone's, abilities intact) adds a card to each draw step.
      let extra = 0;
      for (const card of Object.values(state.cards)) {
        if (
          card.zone === "battlefield" &&
          state.definitions[card.definitionId]?.extraDrawStepDraws === true &&
          // Howling Mine reads "if this artifact is untapped"; the gate is
          // applied to the whole class (a documented approximation for the
          // few gateless printings).
          !card.tapped &&
          !abilitiesRemoved(state, card.id)
        ) {
          extra += 1;
        }
      }
      // CR 504: the turn-based draw happens first, then draw-step triggers
      // go on the stack.
      const drawn = applyEffect(state, {
        kind: "draw",
        playerId: active.id,
        count: 1 + extra,
        turnDraw: true,
      });
      dispatchEventsInPlace(drawn, [{ kind: "step_begins", step: "draw" }]);
      return drawn;
    }
    dispatchEventsInPlace(state, [{ kind: "step_begins", step: "draw" }]);
    return state;
  }
  if (state.turn.step === "precombatMain") {
    dispatchEventsInPlace(state, [{ kind: "step_begins", step: "precombatMain" }]);
    return state;
  }
  if (state.turn.step === "declareAttackers") {
    ensureCombatInPlace(state);
    return state;
  }
  if (state.turn.step === "beginCombat") {
    // Karlach's "first combat phase of the turn" condition counts these.
    state.combatPhasesThisTurn = (state.combatPhasesThisTurn ?? 0) + 1;
    queueBeginCombatTriggersInPlace(state);
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
    // CR 514.1: the active player discards down to maximum hand size.
    const active = state.players.find((player) => player.id === state.turn.activePlayerId);
    if (active && !active.lost) {
      const max = maxHandSizeOf(state, active.id);
      const handCount = Object.values(state.cards).filter(
        (card) => card.zone === "hand" && card.ownerId === active.id,
      ).length;
      if (max !== null && handCount > max) {
        state.prompts.push({
          kind: "choose_discard",
          playerId: active.id,
          count: handCount - max,
        });
      }
    }
    clearDamageInPlace(state);
    clearCombatFlagsInPlace(state);
    // CR 514.2: "until end of turn" effects end during cleanup.
    state.activeEffects = state.activeEffects.filter(
      (effect) => effect.duration !== "until_end_of_turn",
    );
    state.preventCombatDamage = false;
    if (state.preventCombatFor && state.preventCombatFor.length > 0) {
      state.preventCombatFor = [];
    }
    if (state.flashThisTurn && state.flashThisTurn.length > 0) {
      state.flashThisTurn = [];
    }
    // Borrowed permanents go home. They are summoning-sick for the player
    // getting them back, the same as they were for the borrower.
    if (state.temporaryControl && state.temporaryControl.length > 0) {
      for (const entry of state.temporaryControl) {
        const card = state.cards[entry.cardId];
        if (card && card.zone === "battlefield") {
          card.controllerId = entry.returnToId;
          card.summoningSick = true;
        }
      }
      state.temporaryControl = [];
    }
    // Mirage Mirror stops being whatever it was.
    if (state.temporaryCopies && state.temporaryCopies.length > 0) {
      for (const entry of state.temporaryCopies) {
        const card = state.cards[entry.cardId];
        if (card && card.zone === "battlefield") {
          card.definitionId = entry.restoreDefinitionId;
        }
      }
      state.temporaryCopies = [];
    }
    if (state.freeCastFromHand && state.freeCastFromHand.length > 0) {
      // An unused "you may cast" offer expires with the turn.
      state.freeCastFromHand = [];
    }
    if (state.diesReturnUntilEot && state.diesReturnUntilEot.length > 0) {
      state.diesReturnUntilEot = [];
    }
    if (state.exilePlayable && state.exilePlayable.length > 0) {
      // Plain grants end with the turn; extended grants (Atsushi) count down
      // at the caster's own cleanups only.
      state.exilePlayable = state.exilePlayable.flatMap((entry) => {
        if (entry.remainingOwnCleanups === undefined) {
          return [];
        }
        if (entry.casterId !== state.turn.activePlayerId) {
          return [entry];
        }
        const remaining = entry.remainingOwnCleanups - 1;
        return remaining > 0 ? [{ ...entry, remainingOwnCleanups: remaining }] : [];
      });
    }
    if (state.castLockUntilEot) {
      delete state.castLockUntilEot;
    }
    if (state.noncreatureCastLockUntilEot) {
      delete state.noncreatureCastLockUntilEot;
    }
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
  assignNextPlayerTurn(state, nextId);
  state.turn.phase = "beginning";
  state.turn.step = "untap";
  state.combat = null;
  state.passesSinceAction = 0;
  state.priorityPlayerId = nextId;
  onEnterStep(state);
}

/**
 * Advance to the next step. After cleanup, the next living player starts a new turn at untap.
 * Entering the draw step draws one card for the active player. An empty library
 * is a failed draw and loses the game.
 */
export function advanceStep(state: GameState): GameState {
  const next = cloneGameState(state);
  emptyManaPoolsInPlace(next);
  const current = slotIndex(next.turn.phase, next.turn.step);
  const lastIndex = TURN_SEQUENCE.length - 1;

  // Extra combat phases (Aggravated Assault): as the postcombat main ends,
  // re-enter combat; the sequence then flows into another main phase.
  if (next.turn.step === "postcombatMain" && next.pendingExtraCombats > 0) {
    next.pendingExtraCombats -= 1;
    next.turn.phase = "combat";
    next.turn.step = "beginCombat";
    const reentered = onEnterStep(next);
    applyStateBasedActionsInPlace(reentered);
    return reentered;
  }

  if (current === lastIndex) {
    assignNextPlayerTurn(next, nextTurnPlayerId(next, next.turn.activePlayerId));
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

/**
 * Digital-shortcut policy: which quiet steps to fast-forward after a full
 * priority pass. This is table policy, not a rule — the host owns it and can
 * shrink it (a player's stop on a step removes that step from the skip set).
 */
export type ShortcutPolicy = {
  skippableSteps: ReadonlySet<Step>;
};

export const DEFAULT_SHORTCUT_POLICY: ShortcutPolicy = {
  skippableSteps: new Set<Step>(["draw", "beginCombat", "cleanup"]),
};

/**
 * Skip empty digital shortcuts after a full priority pass. By default: the
 * draw step (card already drawn on enter), beginning of combat, and cleanup.
 * Never skips past a waiting stack object or prompt.
 */
export function skipPriorityShortcuts(
  state: GameState,
  policy: ShortcutPolicy = DEFAULT_SHORTCUT_POLICY,
): GameState {
  let current = state;
  let guard = 0;
  while (
    policy.skippableSteps.has(current.turn.step) &&
    current.stack.length === 0 &&
    current.prompts.length === 0 &&
    guard < 12
  ) {
    current = advanceStep(current);
    guard += 1;
  }
  return current;
}

export function advanceSteps(state: GameState, count: number): GameState {
  let current = state;
  for (let i = 0; i < count; i += 1) {
    current = advanceStep(current);
  }
  return current;
}
