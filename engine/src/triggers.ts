import { characteristicsOf } from "./cardTypes";
import { abilitiesRemoved, cardMatchesSubtype } from "./characteristicsEngine";
import { creaturePower, creatureToughness } from "./derived";
import { createId } from "./ids";
import { hasKeyword } from "./keywords";
import { hasAnyLegalTargetSet } from "./targeting";
import type {
  CardEffect,
  CardInstance,
  CardInstanceId,
  CardTrigger,
  EngineEvent,
  GameState,
  PlayerId,
  Step,
  TriggerEvent,
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

/**
 * Intervening "if" (CR 603.4), checked when the trigger would be queued —
 * and the same vocabulary an ability-word rider tests when its effects bind,
 * which is why it is exported.
 */
export function triggerConditionHolds(
  state: GameState,
  controllerId: PlayerId,
  condition: CardTrigger["condition"],
  subjectCardId?: CardInstanceId,
  watcherId?: CardInstanceId,
): boolean {
  if (!condition) {
    return true;
  }
  if (condition.kind === "subject_name_unique") {
    // Guardian Project: no other controlled creature and no creature card in
    // the controller's graveyard shares the subject's name.
    const subject = subjectCardId ? state.cards[subjectCardId] : undefined;
    const name = subject ? state.definitions[subject.definitionId]?.name : undefined;
    if (!subject || !name) {
      return false;
    }
    const owner = state.players.find((entry) => entry.id === controllerId);
    const clash = Object.values(state.cards).some((card) => {
      if (card.id === subjectCardId) {
        return false;
      }
      const sameName = state.definitions[card.definitionId]?.name === name;
      if (!sameName || !characteristicsOf(state, card.id).types.includes("creature")) {
        return false;
      }
      if (card.zone === "battlefield" && card.controllerId === controllerId) {
        return true;
      }
      return card.zone === "graveyard" && (owner?.zones.graveyard ?? []).includes(card.id);
    });
    return !clash;
  }
  if (condition.kind === "controls_count") {
    let count = 0;
    for (const card of Object.values(state.cards)) {
      if (
        card.zone === "battlefield" &&
        card.controllerId === controllerId &&
        characteristicsOf(state, card.id).types.includes(condition.what)
      ) {
        count += 1;
      }
    }
    return count >= condition.atLeast;
  }
  if (condition.kind === "first_combat_this_turn") {
    // Karlach: only the turn's first combat phase qualifies.
    return (state.combatPhasesThisTurn ?? 0) <= 1;
  }
  if (condition.kind === "self_tapped") {
    // Mana Vault: the watcher itself must still be tapped.
    return state.cards[watcherId ?? ""]?.tapped === true;
  }
  if (condition.kind === "attacking_most_life") {
    // Dethrone: the subject attacker's defender has (or ties for) most life.
    const attackerId = subjectCardId;
    const defenderId = state.combat?.attacks.find(
      (attack) => attack.attackerId === attackerId,
    )?.defenderId;
    const defender = state.players.find((entry) => entry.id === defenderId);
    if (!defender) {
      return false;
    }
    const most = Math.max(
      ...state.players.filter((player) => !player.lost).map((player) => player.life),
    );
    return defender.life >= most;
  }
  if (condition.kind === "life_at_least") {
    const player = state.players.find((entry) => entry.id === controllerId);
    return (player?.life ?? 0) >= condition.amount;
  }
  if (condition.kind === "hand_size_exactly") {
    const player = state.players.find((entry) => entry.id === controllerId);
    return (player?.zones.hand.length ?? -1) === condition.count;
  }
  if (condition.kind === "graveyard_cards_at_least") {
    const player = state.players.find((entry) => entry.id === controllerId);
    return (player?.zones.graveyard.length ?? 0) >= condition.count;
  }
  if (condition.kind === "graveyard_card_types_at_least") {
    // Delirium counts distinct CARD TYPES, not cards.
    const player = state.players.find((entry) => entry.id === controllerId);
    const types = new Set<string>();
    for (const cardId of player?.zones.graveyard ?? []) {
      for (const type of characteristicsOf(state, cardId).types) {
        types.add(type);
      }
    }
    return types.size >= condition.count;
  }
  if (condition.kind === "creature_died_this_turn") {
    return (state.creaturesDiedThisTurn ?? 0) > 0;
  }
  if (condition.kind === "attacked_this_turn") {
    return state.players.find((entry) => entry.id === controllerId)?.attackedThisTurn === true;
  }
  if (condition.kind === "drew_cards_this_turn") {
    return (state.drawsByPlayerThisTurn?.[controllerId] ?? 0) > condition.moreThan;
  }
  if (condition.kind === "graveyard_creature_cards_at_least") {
    const player = state.players.find((entry) => entry.id === controllerId);
    const creatures = (player?.zones.graveyard ?? []).filter((cardId) =>
      characteristicsOf(state, cardId).types.includes("creature"),
    ).length;
    return creatures >= condition.count;
  }
  if (condition.kind === "opponent_controls_count") {
    // ANY single opponent must be at the bar, not the table's total.
    return state.players.some((player) => {
      if (player.id === controllerId || player.lost) {
        return false;
      }
      const held = Object.values(state.cards).filter(
        (card) =>
          card.zone === "battlefield" &&
          card.controllerId === player.id &&
          characteristicsOf(state, card.id).types.includes(condition.what),
      ).length;
      return held >= condition.atLeast;
    });
  }
  if (condition.kind === "controls_colored_permanent") {
    return Object.values(state.cards).some(
      (card) =>
        card.zone === "battlefield" &&
        card.controllerId === controllerId &&
        characteristicsOf(state, card.id).colors.includes(condition.color),
    );
  }
  if (
    condition.kind === "controls_subtype_count" ||
    condition.kind === "controls_no_subtype"
  ) {
    const count = Object.values(state.cards).filter(
      (card) =>
        card.zone === "battlefield" &&
        card.controllerId === controllerId &&
        // "five OTHER Mountains": the permanent holding the ability is not
        // one of the five it needs.
        !(condition.kind === "controls_subtype_count" &&
          condition.excludeSelf &&
          card.id === watcherId) &&
        cardMatchesSubtype(state, card.id, condition.subtype),
    ).length;
    return condition.kind === "controls_no_subtype"
      ? count === 0
      : count >= condition.atLeast;
  }
  if (condition.kind === "controls_power_at_least") {
    // Garruk's Uprising: any controlled creature at or above the power bar.
    return Object.values(state.cards).some(
      (card) =>
        card.zone === "battlefield" &&
        card.controllerId === controllerId &&
        characteristicsOf(state, card.id).types.includes("creature") &&
        creaturePower(state, card.id) >= condition.power,
    );
  }
  if (condition.kind === "opponent_controls_more_lands") {
    // Land Tax: any opponent with strictly more lands than the controller.
    const landsOf = (playerId: string): number =>
      Object.values(state.cards).filter(
        (card) =>
          card.zone === "battlefield" &&
          card.controllerId === playerId &&
          characteristicsOf(state, card.id).types.includes("land"),
      ).length;
    const own = landsOf(controllerId);
    return state.players.some(
      (player) => player.id !== controllerId && !player.lost && landsOf(player.id) > own,
    );
  }
  // greatest_artifact_mana_value (Padeem): the controller has an artifact
  // tied for the battlefield's greatest artifact mana value.
  let greatest = -1;
  let controllerGreatest = -1;
  for (const card of Object.values(state.cards)) {
    if (card.zone !== "battlefield") {
      continue;
    }
    const traits = characteristicsOf(state, card.id);
    if (!traits.types.includes("artifact")) {
      continue;
    }
    greatest = Math.max(greatest, traits.manaValue);
    if (card.controllerId === controllerId) {
      controllerGreatest = Math.max(controllerGreatest, traits.manaValue);
    }
  }
  return controllerGreatest >= 0 && controllerGreatest >= greatest;
}

export function queueDefinitionTriggerInPlace(
  state: GameState,
  cardId: CardInstanceId,
  index: number,
  subject?: { cardId?: CardInstanceId; playerId?: PlayerId; amount?: number },
): boolean {
  const card = state.cards[cardId];
  const trigger = card ? state.definitions[card.definitionId]?.triggers[index] : undefined;
  if (!card || !trigger) {
    return false;
  }
  if (!triggerConditionHolds(state, card.controllerId, trigger.condition, subject?.cardId, cardId)) {
    return false;
  }
  if (trigger.oncePerTurn) {
    const key = `${cardId}:${index}`;
    if (state.oncePerTurnFired.includes(key)) {
      return false;
    }
    state.oncePerTurnFired.push(key);
  }
  // "…, choose one —" triggers: the controller picks the mode before the
  // ability stacks; targets (if the mode has any) are chosen after.
  if (trigger.modes && trigger.modes.length > 0) {
    state.prompts.push({
      kind: "choose_trigger_mode",
      playerId: card.controllerId,
      sourceId: cardId,
      triggerIndex: index,
      ...(subject?.cardId ? { subjectCardId: subject.cardId } : {}),
      ...(subject?.playerId ? { subjectPlayerId: subject.playerId } : {}),
      ...(subject?.amount ? { subjectAmount: subject.amount } : {}),
    });
    return true;
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
      ...(subject?.cardId ? { subjectCardId: subject.cardId } : {}),
      ...(subject?.playerId ? { subjectPlayerId: subject.playerId } : {}),
      ...(subject?.amount ? { subjectAmount: subject.amount } : {}),
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
    ...(subject?.amount ? { subjectAmount: subject.amount } : {}),
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
  if (!triggerConditionHolds(state, card.controllerId, trigger.condition, candidate.subjectCardId, candidate.cardId)) {
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
        amount: entries[0]!.subjectAmount,
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
/**
 * "…triggers an additional time": one extra copy per matching doubler on the
 * battlefield (Panharmonicon, Teysa Karlov, Isshin, Roaming Throne, Harmonic
 * Prodigy). Cause-restricted doublers only fire for event-caused candidates
 * (candidate.causeKind); source-restricted doublers also double turn-based
 * triggers, which carry no cause.
 */
function triggerDoublingCopies(state: GameState, candidate: TriggerCandidate): number {
  let copies = 1;
  const source = state.cards[candidate.cardId];
  if (!source) {
    return copies;
  }
  for (const doubler of Object.values(state.cards)) {
    const doubling = state.definitions[doubler.definitionId]?.triggerDoubling;
    if (
      !doubling ||
      doubler.zone !== "battlefield" ||
      doubler.controllerId !== source.controllerId ||
      abilitiesRemoved(state, doubler.id)
    ) {
      continue;
    }
    if (doubling.cause) {
      if (candidate.causeKind !== doubling.cause) {
        continue;
      }
      if (doubling.causeTypesAny) {
        const subjectId = candidate.subjectCardId;
        const types = subjectId ? characteristicsOf(state, subjectId).types : [];
        if (!doubling.causeTypesAny.some((type) => types.includes(type))) {
          continue;
        }
      }
    }
    const filter = doubling.source;
    if (filter) {
      if (filter.excludeSelf && candidate.cardId === doubler.id) {
        continue;
      }
      const sourceTypes = characteristicsOf(state, candidate.cardId).types;
      if (filter.types && !filter.types.every((type) => sourceTypes.includes(type))) {
        continue;
      }
      if (
        filter.subtypesAny &&
        !filter.subtypesAny.some((subtype) => cardMatchesSubtype(state, candidate.cardId, subtype))
      ) {
        continue;
      }
      if (filter.chosenSubtype) {
        const chosen = doubler.chosenCreatureType;
        if (!chosen || !cardMatchesSubtype(state, candidate.cardId, chosen)) {
          continue;
        }
      }
    }
    copies += 1;
  }
  return copies;
}

export function queueSimultaneousTriggersInPlace(
  state: GameState,
  candidates: TriggerCandidate[],
): void {
  const queueable = candidates
    .filter((candidate) => candidateIsQueueable(state, candidate))
    .flatMap((candidate) =>
      Array.from({ length: triggerDoublingCopies(state, candidate) }, () => ({ ...candidate })),
    );
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
    if (!chosen || !cardMatchesSubtype(state, subjectId, chosen)) {
      return false;
    }
  }
  if (filter.nonToken && state.cards[subjectId]?.isToken) {
    return false;
  }
  // CR 702: historic is artifact, legendary, or Saga.
  if (
    filter.historic &&
    !traits.types.includes("artifact") &&
    !traits.supertypes.includes("legendary") &&
    !cardMatchesSubtype(state, subjectId, "saga")
  ) {
    return false;
  }
  if (filter.tokenOnly && !state.cards[subjectId]?.isToken) {
    return false;
  }
  if (filter.legendary && !traits.supertypes.includes("legendary")) {
    return false;
  }
  // CR 701.48: "modified" is an Aura or Equipment attached to it, or any
  // counter on it. Counters of every kind count, not only +1/+1.
  if (filter.modified) {
    const subject = state.cards[subjectId];
    const counters = Object.values(subject?.counters ?? {}).some((amount) => amount > 0);
    const attached = Object.values(state.cards).some(
      (card) => card.zone === "battlefield" && card.attachedTo === subjectId,
    );
    if (!counters && !attached) {
      return false;
    }
  }
  if (filter.minManaValue !== undefined && traits.manaValue < filter.minManaValue) {
    return false;
  }
  // "with flying" / "without flying": read computed, so a granted keyword
  // counts and a removed one does not.
  if (filter.withKeyword && !hasKeyword(state, subjectId, filter.withKeyword)) {
    return false;
  }
  if (filter.withoutKeyword && hasKeyword(state, subjectId, filter.withoutKeyword)) {
    return false;
  }
  for (const subtype of filter.nonSubtypes ?? []) {
    if (cardMatchesSubtype(state, subjectId, subtype)) {
      return false;
    }
  }
  if (filter.minPower !== undefined && creaturePower(state, subjectId) < filter.minPower) {
    return false;
  }
  if (filter.maxPower !== undefined && creaturePower(state, subjectId) > filter.maxPower) {
    return false;
  }
  for (const type of filter.types ?? []) {
    if (!traits.types.includes(type)) {
      return false;
    }
  }
  for (const subtype of filter.subtypes ?? []) {
    if (!cardMatchesSubtype(state, subjectId, subtype)) {
      return false;
    }
  }
  if (
    filter.subtypesAny &&
    !filter.subtypesAny.some((subtype) => cardMatchesSubtype(state, subjectId, subtype))
  ) {
    return false;
  }
  if (filter.typesAny && !filter.typesAny.some((type) => traits.types.includes(type))) {
    return false;
  }
  for (const type of filter.nonTypes ?? []) {
    if (traits.types.includes(type)) {
      return false;
    }
  }
  // Evolve: the entering subject must outclass the watcher in power OR
  // toughness (CR 702.100c).
  if (filter.greaterPtThanWatcher) {
    if (!watcher) {
      return false;
    }
    const subjectPower = creaturePower(state, subjectId);
    const subjectToughness = creatureToughness(state, subjectId);
    if (
      subjectPower <= creaturePower(state, watcher.id) &&
      subjectToughness <= creatureToughness(state, watcher.id)
    ) {
      return false;
    }
  }
  // Pollywog Prodigy: the cast subject's mana value must undercut the
  // watcher's power, read when the trigger checks.
  if (filter.manaValueBelowWatcherPower) {
    if (!watcher || traits.manaValue >= creaturePower(state, watcher.id)) {
      return false;
    }
  }
  // Glaring Fleshraker: colorless subjects only.
  if (filter.colorless && traits.colors.length > 0) {
    return false;
  }
  // Ayara: "another black creature".
  if (filter.colors && !filter.colors.every((color) => traits.colors.includes(color))) {
    return false;
  }
  // Tocasia's Welcome: "with mana value 3 or less".
  if (filter.maxManaValue !== undefined && traits.manaValue > filter.maxManaValue) {
    return false;
  }
  // Kutzil: the subject's computed power must beat its printed base power.
  if (filter.powerAboveBase) {
    const subject = state.cards[subjectId];
    const printed = subject ? state.definitions[subject.definitionId]?.power ?? 0 : 0;
    if (!subject || creaturePower(state, subjectId) <= (printed ?? 0)) {
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
  if (event.kind === "loses_life") {
    return trigger.event === "opponent_loses_life" && watcher.controllerId !== event.playerId;
  }
  if (trigger.event === "opponent_loses_life") {
    return false;
  }
  if (event.kind === "creates_token") {
    return trigger.event === "you_create_token" && watcher.controllerId === event.playerId;
  }
  if (trigger.event === "you_create_token") {
    return false;
  }
  if (event.kind === "sacrifices") {
    if (trigger.event === "player_sacrifices") {
      // These three qualifiers used to be ignored outright — the branch
      // returned true for any sacrifice by anyone — so a head that named who
      // sacrificed, or what, would have fired on everything.
      if (trigger.watch === "controlled" && watcher.controllerId !== event.controllerId) {
        return false;
      }
      if (trigger.watch === "opponents" && watcher.controllerId === event.controllerId) {
        return false;
      }
      if (trigger.excludeSelf && event.cardId === watcher.id) {
        return false;
      }
      return subjectMatchesFilter(state, event.cardId, trigger.subjectFilter, watcher);
    }
    return (
      trigger.event === "you_sacrifice_token" &&
      event.wasToken &&
      watcher.controllerId === event.controllerId &&
      // Tireless Tracker: "Whenever you sacrifice a Clue".
      subjectMatchesFilter(state, event.cardId, trigger.subjectFilter, watcher)
    );
  }
  if (trigger.event === "you_sacrifice_token" || trigger.event === "player_sacrifices") {
    return false;
  }
  // The Ozolith: a counter-carrying permanent left the battlefield.
  if (event.kind === "leaves_battlefield") {
    return (
      trigger.event === "leaves_battlefield" &&
      (trigger.watch ?? "controlled") === "controlled" &&
      event.controllerId === watcher.controllerId &&
      subjectMatchesFilter(state, event.cardId, trigger.subjectFilter, watcher)
    );
  }
  if (trigger.event === "leaves_battlefield") {
    return false;
  }
  if (event.kind === "untapped") {
    return (
      trigger.event === "becomes_untapped" &&
      subjectMatchesFilter(state, event.cardId, trigger.subjectFilter, watcher)
    );
  }
  if (trigger.event === "becomes_untapped") {
    return false;
  }
  if (event.kind === "tapped") {
    if (trigger.event !== "becomes_tapped") {
      return false;
    }
    const watch = trigger.watch ?? "self";
    if (watch === "self") {
      return event.cardId === watcher.id;
    }
    const tappedController = state.cards[event.cardId]?.controllerId;
    if (watch === "controlled" && tappedController !== watcher.controllerId) {
      return false;
    }
    if (watch === "opponents" && tappedController === watcher.controllerId) {
      return false;
    }
    return subjectMatchesFilter(state, event.cardId, trigger.subjectFilter, watcher);
  }
  if (trigger.event === "becomes_tapped") {
    return false;
  }
  if (event.kind === "searches_library") {
    return trigger.event === "opponent_searches" && watcher.controllerId !== event.playerId;
  }
  if (trigger.event === "opponent_searches") {
    return false;
  }
  if (event.kind === "put_in_graveyard_from_elsewhere") {
    return (
      trigger.event === "graveyard_from_elsewhere" &&
      subjectMatchesFilter(state, event.cardId, trigger.subjectFilter, watcher)
    );
  }
  if (trigger.event === "graveyard_from_elsewhere") {
    return false;
  }
  if (event.kind === "leaves_graveyard") {
    return (
      trigger.event === "leaves_your_graveyard" &&
      event.ownerId === watcher.controllerId &&
      subjectMatchesFilter(state, event.cardId, trigger.subjectFilter, watcher)
    );
  }
  if (trigger.event === "leaves_your_graveyard") {
    return false;
  }
  if (event.kind === "draws") {
    if (trigger.event === "opponent_draws") {
      return watcher.controllerId !== event.playerId;
    }
    if (trigger.event === "opponent_draws_second") {
      // Faerie Mastermind: exactly the opponent's second draw of the turn.
      return (
        watcher.controllerId !== event.playerId &&
        (state.drawsByPlayerThisTurn?.[event.playerId] ?? 0) === 2
      );
    }
    return trigger.event === "you_draw" && watcher.controllerId === event.playerId;
  }
  if (
    trigger.event === "opponent_draws" ||
    trigger.event === "you_draw" ||
    trigger.event === "opponent_draws_second"
  ) {
    return false;
  }
  if (event.kind === "class_level") {
    // A Class's own level trigger only — a Class does not watch its neighbours.
    return (
      trigger.event === "class_level" &&
      event.cardId === watcher.id &&
      trigger.classLevel === event.level
    );
  }
  if (trigger.event === "class_level") {
    return false;
  }
  if (event.kind === "step_begins") {
    const stepOf: Partial<Record<TriggerEvent, Step>> = {
      upkeep: "upkeep",
      end_step: "end",
      draw_step: "draw",
      first_main_phase: "precombatMain",
    };
    const step = stepOf[trigger.event];
    if (!step || event.step !== step) {
      return false;
    }
    // "At the beginning of EACH end step" fires on every player's turn;
    // "your" fires only on the controller's own.
    return trigger.eachPlayersStep === true || watcher.controllerId === state.turn.activePlayerId;
  }
  if (event.kind === "combat_damage_to_player") {
    if (trigger.event !== "deals_combat_damage_to_player") {
      return false;
    }
    const watch = trigger.watch ?? "self";
    if (watch === "self" && event.cardId !== watcher.id) {
      return false;
    }
    // Equipment watching its host ("equipped creature") — the Swords.
    if (watch === "attached" && watcher.attachedTo !== event.cardId) {
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
  if (event.kind === "damaged") {
    // Enrage: the watcher itself was dealt damage.
    return trigger.event === "is_dealt_damage" && event.cardId === watcher.id;
  }
  if (trigger.event === "is_dealt_damage") {
    return false;
  }
  if (event.kind === "counter_added") {
    // Fathom Mage: a named counter landed on the watcher itself.
    return (
      trigger.event === "counter_added" &&
      event.cardId === watcher.id &&
      (!trigger.subjectFilter?.counterName || trigger.subjectFilter.counterName === event.counter)
    );
  }
  if (trigger.event === "counter_added") {
    return false;
  }
  if (event.kind === "discards") {
    // Waste Not / Bone Miser: who discarded, and what kind of card.
    if (trigger.event !== "discards") {
      return false;
    }
    const watch = trigger.watch ?? "controlled";
    if (watch === "controlled" && event.playerId !== watcher.controllerId) {
      return false;
    }
    if (watch === "opponents" && event.playerId === watcher.controllerId) {
      return false;
    }
    return subjectMatchesFilter(state, event.cardId, trigger.subjectFilter, watcher);
  }
  if (trigger.event === "discards") {
    return false;
  }
  if (event.kind === "deals_damage_to_player") {
    if (trigger.event !== "deals_damage_to_player") {
      return false;
    }
    const watch = trigger.watch ?? "self";
    if (watch === "self" && event.cardId !== watcher.id) {
      return false;
    }
    // An Aura watching its host ("enchanted creature") — CR 702.102-style.
    if (watch === "attached" && watcher.attachedTo !== event.cardId) {
      return false;
    }
    const dealerController = state.cards[event.cardId]?.controllerId;
    if (watch === "controlled" && dealerController !== watcher.controllerId) {
      return false;
    }
    if (watch === "opponents" && dealerController === watcher.controllerId) {
      return false;
    }
    if (trigger.subjectPlayerOpponent && event.playerId === watcher.controllerId) {
      return false;
    }
    return subjectMatchesFilter(state, event.cardId, trigger.subjectFilter, watcher);
  }
  if (trigger.event === "deals_damage_to_player") {
    return false;
  }
  if (event.kind === "casts" && trigger.event === "casts_second_spell") {
    // Lotho: fires exactly on each player's second cast of the turn.
    // Monologue Tax narrows the same count to opponents only.
    if (trigger.watch === "opponents" && watcher.controllerId === event.controllerId) {
      return false;
    }
    return (state.spellsCastByPlayerThisTurn?.[event.controllerId] ?? 0) === 2;
  }
  if (trigger.event === "casts_second_spell") {
    return false;
  }
  if (event.kind === "casts" && trigger.event === "opponent_casts_first_noncreature_spell") {
    // Esper Sentinel: an opponent's first noncreature cast of the turn.
    return (
      event.controllerId !== watcher.controllerId &&
      !characteristicsOf(state, event.cardId).types.includes("creature") &&
      (state.noncreatureSpellsCastByPlayerThisTurn?.[event.controllerId] ?? 0) === 1
    );
  }
  if (trigger.event === "opponent_casts_first_noncreature_spell") {
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
  if (event.kind === "copies_spell") {
    // Magecraft: only "cast or copy" triggers see spell copies.
    if (trigger.event !== "cast_spell" || !trigger.alsoOnCopy) {
      return false;
    }
    const watch = trigger.watch ?? "controlled";
    if (watch === "controlled" && event.controllerId !== watcher.controllerId) {
      return false;
    }
    if (watch === "opponents" && event.controllerId === watcher.controllerId) {
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
  // Exalted: only when exactly one creature attacks.
  if (trigger.attacksAlone && event.kind === "attacks") {
    if ((state.combat?.attacks.length ?? 0) !== 1) {
      return false;
    }
  }
  const watch = trigger.watch ?? "self";
  if (trigger.excludeSelf && event.cardId === watcher.id) {
    return false;
  }
  if (watch === "self") {
    return event.cardId === watcher.id;
  }
  if (watch === "attached") {
    // The zone change already detached the watcher when the host died —
    // the dies event remembers who was attached (Skullclamp).
    const attachedNow = watcher.attachedTo === event.cardId;
    const attachedThen =
      event.kind === "dies" && (event.wasAttachedIds ?? []).includes(watcher.id);
    return (
      (attachedNow || attachedThen) &&
      subjectMatchesFilter(state, event.cardId, trigger.subjectFilter, watcher)
    );
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
  // Mahadi's counter: every dies event for a printed creature bumps the
  // per-turn tally (reset when a new turn begins).
  for (const event of events) {
    if (
      event.kind === "dies" &&
      characteristicsOf(state, event.cardId).types.includes("creature")
    ) {
      state.creaturesDiedThisTurn = (state.creaturesDiedThisTurn ?? 0) + 1;
    }
  }
  const candidates: TriggerCandidate[] = [];
  const consider = (card: CardInstance) => {
    const triggers = state.definitions[card.definitionId]?.triggers ?? [];
    for (let index = 0; index < triggers.length; index += 1) {
      const trigger = triggers[index]!;
      // A trigger fires once for EACH matching event in the batch — a board
      // wipe drains Blood Artist once per death, not once total. "One or
      // more" heads fire once per batch instead.
      let firedThisBatch = false;
      for (const event of events) {
        if (trigger.oncePerBatch && firedThisBatch) {
          break;
        }
        if (triggerMatchesEvent(state, card, trigger, event)) {
          firedThisBatch = true;
          const subjectCardId = "cardId" in event ? event.cardId : undefined;
          const subjectPlayerId =
            event.kind === "gains_life" ||
            event.kind === "loses_life" ||
            event.kind === "combat_damage_to_player" ||
            event.kind === "deals_damage_to_player" ||
            event.kind === "draws" ||
            event.kind === "creates_token"
              ? event.playerId
              : event.kind === "casts" || event.kind === "dies" || event.kind === "sacrifices"
                ? event.controllerId
                : subjectCardId
                  ? state.cards[subjectCardId]?.controllerId
                  : undefined;
          const subjectAmount =
            event.kind === "gains_life" ||
            event.kind === "loses_life" ||
            // Old Gnawbone / Kediss: "that many" is the damage just dealt.
            event.kind === "combat_damage_to_player"
              ? event.amount
              : event.kind === "dies"
                ? event.powerAtDeath
                : event.kind === "leaves_battlefield"
                  ? event.amount
                  : undefined;
          const causeKind =
            event.kind === "enters" || event.kind === "dies" || event.kind === "attacks"
              ? event.kind
              : undefined;
          candidates.push({
            cardId: card.id,
            triggerIndex: index,
            ...(subjectCardId ? { subjectCardId } : {}),
            ...(subjectPlayerId ? { subjectPlayerId } : {}),
            ...(subjectAmount ? { subjectAmount } : {}),
            ...(causeKind ? { causeKind } : {}),
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
      if (!card) {
        continue;
      }
      const triggers = state.definitions[card.definitionId]?.triggers ?? [];
      for (let index = 0; index < triggers.length; index += 1) {
        const trigger = triggers[index];
        if (trigger?.event !== "begin_combat") {
          continue;
        }
        // "on your turn" (the default) fires only for the active player's
        // permanents; "each combat" (watch: any) fires for everyone's.
        if (card.controllerId === activeId || trigger.watch === "any") {
          candidates.push({ cardId, triggerIndex: index });
        }
      }
    }
  }
  queueSimultaneousTriggersInPlace(state, candidates);
}
