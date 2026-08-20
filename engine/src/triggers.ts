import { createId } from "./ids";
import { hasAnyLegalTargetSet } from "./targeting";
import type { CardEffect, CardInstanceId, GameState, PlayerId, TriggerCandidate } from "./types";

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

export function queueDefinitionTriggerInPlace(
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

function candidateIsQueueable(state: GameState, candidate: TriggerCandidate): boolean {
  const card = state.cards[candidate.cardId];
  return Boolean(card && state.definitions[card.definitionId]?.triggers[candidate.triggerIndex]);
}

function finishTriggerBookkeepingInPlace(state: GameState): void {
  state.passesSinceAction = 0;
  if (state.prompts.length === 0) {
    state.priorityPlayerId = state.turn.activePlayerId;
  }
}

type TriggerGroup = { playerId: PlayerId; entries: TriggerCandidate[] };

/** Group candidates by controller in APNAP order (CR 101.4): active first. */
function apnapGroups(state: GameState, candidates: TriggerCandidate[]): TriggerGroup[] {
  const byController = new Map<PlayerId, TriggerCandidate[]>();
  for (const candidate of candidates) {
    const controllerId = state.cards[candidate.cardId]?.controllerId;
    if (!controllerId) {
      continue;
    }
    const list = byController.get(controllerId) ?? [];
    list.push(candidate);
    byController.set(controllerId, list);
  }
  const activeIndex = state.players.findIndex(
    (player) => player.id === state.turn.activePlayerId,
  );
  const groups: TriggerGroup[] = [];
  for (let offset = 0; offset < state.players.length; offset += 1) {
    const player = state.players[(Math.max(activeIndex, 0) + offset) % state.players.length];
    const entries = player ? byController.get(player.id) : undefined;
    if (player && entries && entries.length > 0) {
      groups.push({ playerId: player.id, entries });
    }
  }
  return groups;
}

/**
 * Queue APNAP groups: single triggers go straight to the stack (or their
 * targeting/look pause); a controller with several simultaneous triggers gets
 * an order_triggers prompt, and later groups wait in `remaining` until that
 * choice resolves.
 */
export function processTriggerGroupsInPlace(state: GameState, groups: TriggerGroup[]): void {
  const pending = [...groups];
  while (pending.length > 0) {
    const group = pending.shift()!;
    const entries = group.entries.filter((entry) => candidateIsQueueable(state, entry));
    if (entries.length === 0) {
      continue;
    }
    if (entries.length === 1) {
      queueDefinitionTriggerInPlace(state, entries[0]!.cardId, entries[0]!.triggerIndex);
      continue;
    }
    state.prompts.push({
      kind: "order_triggers",
      playerId: group.playerId,
      entries: entries.map((entry) => ({ ...entry })),
      remaining: pending.map((rest) => ({
        playerId: rest.playerId,
        entries: rest.entries.map((entry) => ({ ...entry })),
      })),
    });
    return;
  }
}

/**
 * Queue simultaneous triggers under APNAP ordering. Untargeted abilities go on
 * the stack immediately. Scry and surveil are keyword actions: they pause for
 * the owner without using the stack. Targeted abilities pause for
 * `choose_targets` unless no legal target exists (CR 603.3d — skipped).
 */
export function queueSimultaneousTriggersInPlace(
  state: GameState,
  candidates: TriggerCandidate[],
): void {
  const queueable = candidates.filter((candidate) => candidateIsQueueable(state, candidate));
  if (queueable.length === 0) {
    return;
  }
  processTriggerGroupsInPlace(state, apnapGroups(state, queueable));
  finishTriggerBookkeepingInPlace(state);
}

/** Queue enter-the-battlefield triggers for one entering card. */
export function queueEnterBattlefieldTriggersInPlace(
  state: GameState,
  cardId: CardInstanceId,
): void {
  const card = state.cards[cardId];
  if (!card || card.zone !== "battlefield") {
    return;
  }
  const triggers = state.definitions[card.definitionId]?.triggers ?? [];
  const candidates: TriggerCandidate[] = [];
  for (let index = 0; index < triggers.length; index += 1) {
    if (triggers[index]?.event === "enter_battlefield") {
      candidates.push({ cardId, triggerIndex: index });
    }
  }
  queueSimultaneousTriggersInPlace(state, candidates);
}

/** Queue "at the beginning of combat on your turn" triggers for the active player. */
export function queueBeginCombatTriggersInPlace(state: GameState): void {
  const activeId = state.turn.activePlayerId;
  const candidates: TriggerCandidate[] = [];
  for (const player of state.players) {
    for (const cardId of player.zones.battlefield) {
      const card = state.cards[cardId];
      if (!card || card.controllerId !== activeId) {
        continue;
      }
      const triggers = state.definitions[card.definitionId]?.triggers ?? [];
      for (let index = 0; index < triggers.length; index += 1) {
        if (triggers[index]?.event === "begin_combat") {
          candidates.push({ cardId, triggerIndex: index });
        }
      }
    }
  }
  queueSimultaneousTriggersInPlace(state, candidates);
}
