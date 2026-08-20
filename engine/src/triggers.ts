import { characteristicsOf } from "./cardTypes";
import { abilitiesRemoved } from "./characteristicsEngine";
import { createId } from "./ids";
import { hasAnyLegalTargetSet } from "./targeting";
import type {
  CardEffect,
  CardInstance,
  CardInstanceId,
  CardTrigger,
  EngineEvent,
  GameState,
  PlayerId,
  TriggerCandidate,
} from "./types";

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
  subject?: { cardId?: CardInstanceId; playerId?: PlayerId },
): boolean {
  const card = state.cards[cardId];
  const trigger = card ? state.definitions[card.definitionId]?.triggers[index] : undefined;
  if (!card || !trigger) {
    return false;
  }
  if (trigger.oncePerTurn) {
    const key = `${cardId}:${index}`;
    if (state.oncePerTurnFired.includes(key)) {
      return false;
    }
    state.oncePerTurnFired.push(key);
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
    ...(subject?.cardId ? { subjectCardId: subject.cardId } : {}),
    ...(subject?.playerId ? { subjectPlayerId: subject.playerId } : {}),
  });
  return true;
}

function candidateIsQueueable(state: GameState, candidate: TriggerCandidate): boolean {
  const card = state.cards[candidate.cardId];
  const trigger = card
    ? state.definitions[card.definitionId]?.triggers[candidate.triggerIndex]
    : undefined;
  if (!card || !trigger) {
    return false;
  }
  if (
    trigger.oncePerTurn &&
    state.oncePerTurnFired.includes(`${candidate.cardId}:${candidate.triggerIndex}`)
  ) {
    return false;
  }
  // A permanent whose abilities were removed (Humility) has no triggers.
  return !abilitiesRemoved(state, card.id);
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
      queueDefinitionTriggerInPlace(state, entries[0]!.cardId, entries[0]!.triggerIndex, {
        cardId: entries[0]!.subjectCardId,
        playerId: entries[0]!.subjectPlayerId,
      });
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

function subjectMatchesFilter(
  state: GameState,
  subjectId: CardInstanceId,
  filter: CardTrigger["subjectFilter"],
  watcher?: CardInstance,
): boolean {
  if (!filter) {
    return true;
  }
  const traits = characteristicsOf(state, subjectId);
  if (filter.chosenSubtype) {
    const chosen = watcher?.chosenCreatureType;
    if (!chosen || !traits.subtypes.includes(chosen)) {
      return false;
    }
  }
  for (const type of filter.types ?? []) {
    if (!traits.types.includes(type)) {
      return false;
    }
  }
  for (const subtype of filter.subtypes ?? []) {
    if (!traits.subtypes.includes(subtype)) {
      return false;
    }
  }
  if (filter.typesAny && !filter.typesAny.some((type) => traits.types.includes(type))) {
    return false;
  }
  for (const type of filter.nonTypes ?? []) {
    if (traits.types.includes(type)) {
      return false;
    }
  }
  return true;
}

function triggerMatchesEvent(
  state: GameState,
  watcher: CardInstance,
  trigger: CardTrigger,
  event: EngineEvent,
): boolean {
  if (event.kind === "gains_life") {
    return trigger.event === "you_gain_life" && watcher.controllerId === event.playerId;
  }
  if (trigger.event === "you_gain_life") {
    return false;
  }
  if (event.kind === "draws") {
    return trigger.event === "opponent_draws" && watcher.controllerId !== event.playerId;
  }
  if (trigger.event === "opponent_draws") {
    return false;
  }
  if (event.kind === "step_begins") {
    if (trigger.event !== "upkeep" && trigger.event !== "end_step") {
      return false;
    }
    const step = trigger.event === "upkeep" ? "upkeep" : "end";
    // "At the beginning of your …": the controller's own step.
    return event.step === step && watcher.controllerId === state.turn.activePlayerId;
  }
  if (event.kind === "combat_damage_to_player") {
    if (trigger.event !== "deals_combat_damage_to_player") {
      return false;
    }
    const watch = trigger.watch ?? "self";
    if (watch === "self" && event.cardId !== watcher.id) {
      return false;
    }
    const dealerController = state.cards[event.cardId]?.controllerId;
    if (watch === "controlled" && dealerController !== watcher.controllerId) {
      return false;
    }
    if (watch === "opponents" && dealerController === watcher.controllerId) {
      return false;
    }
    if (trigger.excludeSelf && event.cardId === watcher.id) {
      return false;
    }
    return subjectMatchesFilter(state, event.cardId, trigger.subjectFilter, watcher);
  }
  if (trigger.event === "deals_combat_damage_to_player") {
    return false;
  }
  if (event.kind === "casts") {
    if (trigger.event !== "cast_spell") {
      return false;
    }
    // "Whenever you cast …" defaults to the watcher's controller.
    const watch = trigger.watch ?? "controlled";
    if (watch === "controlled" && event.controllerId !== watcher.controllerId) {
      return false;
    }
    if (watch === "opponents" && event.controllerId === watcher.controllerId) {
      return false;
    }
    if (trigger.excludeSelf && event.cardId === watcher.id) {
      return false;
    }
    return subjectMatchesFilter(state, event.cardId, trigger.subjectFilter, watcher);
  }
  if (trigger.event === "cast_spell") {
    return false;
  }
  if (
    (event.kind === "enters" && trigger.event !== "enter_battlefield") ||
    (event.kind === "dies" && trigger.event !== "dies") ||
    (event.kind === "attacks" && trigger.event !== "attacks")
  ) {
    return false;
  }
  const watch = trigger.watch ?? "self";
  if (trigger.excludeSelf && event.cardId === watcher.id) {
    return false;
  }
  if (watch === "self") {
    return event.cardId === watcher.id;
  }
  const subjectController =
    event.kind === "dies" ? event.controllerId : state.cards[event.cardId]?.controllerId;
  if (watch === "controlled" && subjectController !== watcher.controllerId) {
    return false;
  }
  if (watch === "opponents" && subjectController === watcher.controllerId) {
    return false;
  }
  return subjectMatchesFilter(state, event.cardId, trigger.subjectFilter, watcher);
}

/**
 * The event bus (Stage 3): match a batch of simultaneous events against
 * every ability that could see them, then queue the triggers under APNAP.
 * Watchers are battlefield permanents; a dying object's own dies-triggers
 * also fire, looking back from the graveyard (CR 603.10a).
 */
export function dispatchEventsInPlace(state: GameState, events: EngineEvent[]): void {
  if (events.length === 0) {
    return;
  }
  const candidates: TriggerCandidate[] = [];
  const consider = (card: CardInstance) => {
    const triggers = state.definitions[card.definitionId]?.triggers ?? [];
    for (let index = 0; index < triggers.length; index += 1) {
      const trigger = triggers[index]!;
      // A trigger fires once for EACH matching event in the batch — a board
      // wipe drains Blood Artist once per death, not once total.
      for (const event of events) {
        if (triggerMatchesEvent(state, card, trigger, event)) {
          const subjectCardId = "cardId" in event ? event.cardId : undefined;
          const subjectPlayerId =
            event.kind === "gains_life" || event.kind === "combat_damage_to_player" || event.kind === "draws"
              ? event.playerId
              : event.kind === "casts" || event.kind === "dies"
                ? event.controllerId
                : subjectCardId
                  ? state.cards[subjectCardId]?.controllerId
                  : undefined;
          candidates.push({
            cardId: card.id,
            triggerIndex: index,
            ...(subjectCardId ? { subjectCardId } : {}),
            ...(subjectPlayerId ? { subjectPlayerId } : {}),
          });
        }
      }
    }
  };
  for (const card of Object.values(state.cards)) {
    if (card.zone === "battlefield" && !abilitiesRemoved(state, card.id)) {
      consider(card);
    }
  }
  const deadConsidered = new Set<CardInstanceId>();
  for (const event of events) {
    if (event.kind !== "dies" || deadConsidered.has(event.cardId)) {
      continue;
    }
    deadConsidered.add(event.cardId);
    const dead = state.cards[event.cardId];
    if (dead && dead.zone !== "battlefield") {
      consider(dead);
    }
  }
  queueSimultaneousTriggersInPlace(state, candidates);
}

/** Queue enter-the-battlefield triggers and notify watchers of the arrival. */
export function queueEnterBattlefieldTriggersInPlace(
  state: GameState,
  cardId: CardInstanceId,
): void {
  const card = state.cards[cardId];
  if (!card || card.zone !== "battlefield") {
    return;
  }
  dispatchEventsInPlace(state, [{ kind: "enters", cardId }]);
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
