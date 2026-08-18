import { createId } from "./ids";
import { hasAnyLegalTargetSet } from "./targeting";
import type { CardEffect, CardInstanceId, GameState } from "./types";

function isLookActionTrigger(effects: CardEffect[]): boolean {
  return (
    effects.length > 0 &&
    effects.every((effect) => effect.kind === "scry" || effect.kind === "surveil")
  );
}

function queueLookActionInPlace(
  state: GameState,
  playerId: string,
  kind: "scry" | "surveil",
  count: number,
): void {
  if (!Number.isInteger(count) || count <= 0) {
    return;
  }
  const player = state.players.find((entry) => entry.id === playerId);
  const looked = Math.min(count, player?.zones.library.length ?? 0);
  if (looked === 0) {
    return;
  }
  state.prompts.push({ kind, playerId, count: looked });
}

function queueDefinitionTriggerInPlace(
  state: GameState,
  cardId: CardInstanceId,
  index: number,
): boolean {
  const card = state.cards[cardId];
  const trigger = card ? state.definitions[card.definitionId]?.triggers[index] : undefined;
  if (!card || !trigger) {
    return false;
  }
  const requirements = trigger.targetRequirements ?? [];
  if (requirements.length > 0) {
    if (!hasAnyLegalTargetSet(state, requirements, card.controllerId)) {
      return false;
    }
    state.prompts.push({
      kind: "choose_targets",
      playerId: card.controllerId,
      sourceId: cardId,
      origin: "trigger",
      triggerIndex: index,
      requirements: requirements.map((requirement) => ({ ...requirement })),
    });
    return true;
  }
  if (isLookActionTrigger(trigger.effects)) {
    for (const effect of trigger.effects) {
      if (effect.kind === "scry" || effect.kind === "surveil") {
        queueLookActionInPlace(state, card.controllerId, effect.kind, effect.count);
      }
    }
    return true;
  }
  state.stack.push({
    id: createId("stack"),
    controllerId: card.controllerId,
    sourceId: cardId,
    kind: "ability",
    targets: [],
    triggerIndex: index,
  });
  return true;
}

/**
 * Queue enter-the-battlefield triggers. Untargeted abilities go on the stack
 * immediately. Scry and surveil are keyword actions: they pause for the owner
 * without using the stack, so other players do not get priority to respond.
 * Targeted abilities pause for `choose_targets` unless no legal target exists
 * (CR 603.3d — the trigger is skipped).
 */
export function queueEnterBattlefieldTriggersInPlace(
  state: GameState,
  cardId: CardInstanceId,
): void {
  const card = state.cards[cardId];
  if (!card || card.zone !== "battlefield") {
    return;
  }
  const triggers = state.definitions[card.definitionId]?.triggers ?? [];
  let queued = 0;
  for (let index = 0; index < triggers.length; index += 1) {
    if (triggers[index]?.event !== "enter_battlefield") {
      continue;
    }
    if (queueDefinitionTriggerInPlace(state, cardId, index)) {
      queued += 1;
    }
  }
  if (queued > 0) {
    state.passesSinceAction = 0;
    if (state.prompts.length === 0) {
      state.priorityPlayerId = state.turn.activePlayerId;
    }
  }
}

/** Queue "at the beginning of combat on your turn" triggers for the active player. */
export function queueBeginCombatTriggersInPlace(state: GameState): void {
  const activeId = state.turn.activePlayerId;
  let queued = 0;
  for (const player of state.players) {
    for (const cardId of player.zones.battlefield) {
      const card = state.cards[cardId];
      if (!card || card.controllerId !== activeId) {
        continue;
      }
      const triggers = state.definitions[card.definitionId]?.triggers ?? [];
      for (let index = 0; index < triggers.length; index += 1) {
        if (triggers[index]?.event !== "begin_combat") {
          continue;
        }
        if (queueDefinitionTriggerInPlace(state, cardId, index)) {
          queued += 1;
        }
      }
    }
  }
  if (queued > 0) {
    state.passesSinceAction = 0;
    if (state.prompts.length === 0) {
      state.priorityPlayerId = state.turn.activePlayerId;
    }
  }
}
