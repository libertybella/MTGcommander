import { cloneGameState } from "./clone";
import { createCardDefinition, createCardInstance } from "./createGame";
import { characteristicsOf, hasSubtype, isCreature, isLand } from "./cardTypes";
import { createId } from "./ids";
import { wouldSkipDraw } from "./derived";
import { hasKeyword } from "./keywords";
import { addMana, tapCard, untapCard } from "./mana";
import { isLiving, livingPlayers, nextLivingPlayerId } from "./players";
import { isPromptOpen, legalIdsForChooseSources } from "./prompt";
import { applyStateBasedActionsInPlace } from "./status";
import { isChosenTargetLegal, sourceColorsOf } from "./targeting";
import { amassArmyTemplate, tokenPresetFor } from "./tokens";
import { dispatchEventsInPlace, queueEnterBattlefieldTriggersInPlace } from "./triggers";
import { countCardPlacements, enterOwnerZone, moveCard, moveCardInPlace } from "./zones";
import type {
  CardEffect,
  CardIdSelector,
  CardInstanceId,
  ChosenControllerRef,
  ChosenTarget,
  ChosenTargetRef,
  ContinuousEffectData,
  EngineEvent,
  GameEffect,
  GameState,
  Keyword,
  LookDestination,
  PlayerId,
  PlayerSelector,
  PlayerState,
  StackObjectId,
  SubjectPlayerRef,
  TargetRequirement,
} from "./types";

export type BindEffectContext = {
  controllerId: PlayerId;
  sourceId: CardInstanceId | null;
  targets?: ChosenTarget[];
  targetRequirements?: TargetRequirement[];
  chosenCardId?: CardInstanceId;
  /** Announced X for {X} spells; effects with amount "x" read it. */
  xValue?: number;
  /** The trigger event's subject ("that player" / "that creature"). */
  subjectPlayerId?: PlayerId;
  subjectCardId?: CardInstanceId;
};

function nextOpponentId(state: GameState, controllerId: PlayerId): PlayerId {
  return nextLivingPlayerId(state, controllerId);
}

function bindPlayerSelector(
  state: GameState,
  selector: PlayerSelector,
  context: BindEffectContext,
): PlayerId | null {
  if (typeof selector === "object") {
    if (selector.type === "chosen_controller") {
      const chosen = chosenTargetAt(context, selector.index, state);
      if (!chosen || chosen.type !== "creature") {
        return null;
      }
      return state.cards[chosen.cardId]?.controllerId ?? null;
    }
    if (selector.type === "subject_player") {
      return context.subjectPlayerId ?? null;
    }
    const chosen = chosenTargetAt(context, selector.index, state);
    if (!chosen || chosen.type !== "player") {
      return null;
    }
    return chosen.playerId;
  }
  return bindPlayer(state, selector, context.controllerId);
}

function bindPlayer(
  state: GameState,
  selector: Exclude<PlayerSelector, ChosenTargetRef | ChosenControllerRef | SubjectPlayerRef>,
  controllerId: PlayerId,
): PlayerId {
  if (selector === "controller") {
    return controllerId;
  }
  if (selector === "next_opponent") {
    return nextOpponentId(state, controllerId);
  }
  if (selector === "each_opponent" || selector === "each_player") {
    throw new Error("each-player selectors must be expanded before binding");
  }
  return selector;
}

function opponentIds(state: GameState, controllerId: PlayerId): PlayerId[] {
  return livingPlayers(state)
    .filter((player) => player.id !== controllerId)
    .map((player) => player.id);
}

function expandEachOpponent(
  state: GameState,
  effect: CardEffect,
  controllerId: PlayerId,
): CardEffect[] {
  // APNAP-ish: the controller acts first, then opponents in seat order.
  const eachOf = (selector: unknown): PlayerId[] | null =>
    selector === "each_opponent"
      ? opponentIds(state, controllerId)
      : selector === "each_player"
        ? [controllerId, ...opponentIds(state, controllerId)]
        : null;
  if (
    effect.kind === "gain_life" ||
    effect.kind === "lose_life" ||
    effect.kind === "draw" ||
    effect.kind === "add_mana" ||
    effect.kind === "mill" ||
    effect.kind === "discard"
  ) {
    const players = eachOf(effect.playerId);
    if (players) {
      return players.map((playerId) => ({ ...effect, playerId }));
    }
  }
  if (effect.kind === "create_token") {
    const players = eachOf(effect.ownerId);
    if (players) {
      return players.map((ownerId) => ({ ...effect, ownerId }));
    }
  }
  if (effect.kind === "choose_card") {
    const players = eachOf(effect.chooserId);
    if (players) {
      return players.map((playerId) => ({
        ...effect,
        chooserId: playerId,
        sources: effect.sources.map((source) => ({
          ...source,
          playerId: source.playerId === "each_opponent" || source.playerId === "each_player"
            ? playerId
            : source.playerId,
        })),
      }));
    }
  }
  if (effect.kind === "deal_damage" && effect.target.type === "player") {
    const players = eachOf(effect.target.playerId);
    if (players) {
      return players.map((playerId) => ({
        ...effect,
        target: { type: "player" as const, playerId },
      }));
    }
  }
  return [effect];
}

function bindSourceId(
  sourceId: CardInstanceId | "self" | null,
  context: BindEffectContext,
): CardInstanceId | null {
  if (sourceId === "self") {
    return context.sourceId;
  }
  return sourceId;
}

function chosenTargetAt(
  context: BindEffectContext,
  index: number,
  state: GameState,
): ChosenTarget | null {
  const requirement = context.targetRequirements?.[index];
  const target = context.targets?.[index];
  if (
    !requirement ||
    !target ||
    !isChosenTargetLegal(
      state,
      requirement,
      target,
      context.controllerId,
      sourceColorsOf(state, context.sourceId),
    )
  ) {
    return null;
  }
  return target;
}

function bindCardId(
  state: GameState,
  selector: CardIdSelector,
  context: BindEffectContext,
): CardInstanceId | null {
  if (typeof selector === "string") {
    if (selector === "self") {
      return context.sourceId;
    }
    if (selector === "chosen_card") {
      return context.chosenCardId ?? null;
    }
    return selector;
  }
  const chosen = chosenTargetAt(context, selector.index, state);
  if (!chosen || chosen.type !== "creature") {
    return null;
  }
  return chosen.cardId;
}

export function bindCardEffect(
  state: GameState,
  effect: CardEffect,
  context: BindEffectContext,
): GameEffect | null {
  switch (effect.kind) {
    case "gain_life":
    case "lose_life":
    case "draw":
    case "add_mana":
    case "mill":
    case "discard":
    case "scry":
    case "surveil":
    case "discard_unless_attacked": {
      const playerId = bindPlayerSelector(state, effect.playerId, context);
      if (!playerId) {
        return null;
      }
      return {
        ...effect,
        playerId,
      };
    }
    case "amass": {
      const playerId = bindPlayerSelector(state, effect.playerId, context);
      if (!playerId) {
        return null;
      }
      return {
        kind: "amass",
        playerId,
        amount: effect.amount,
        ...(effect.subtype ? { subtype: effect.subtype } : {}),
      };
    }
    case "look_and_assign": {
      const playerId = bindPlayerSelector(state, effect.playerId, context);
      if (!playerId) {
        return null;
      }
      return {
        kind: "look_and_assign",
        playerId,
        count: effect.count,
        destinations: [...effect.destinations],
      };
    }
    case "reveal_zone": {
      const fromPlayerId = bindPlayerSelector(state, effect.fromPlayerId, context);
      const toPlayerId = bindPlayerSelector(state, effect.toPlayerId, context);
      if (!fromPlayerId || !toPlayerId) {
        return null;
      }
      return { kind: "reveal_zone", fromPlayerId, toPlayerId, zone: effect.zone };
    }
    case "choose_card": {
      const chooserId = bindPlayerSelector(state, effect.chooserId, context);
      if (!chooserId) {
        return null;
      }
      const sources = effect.sources.flatMap((source) => {
        const playerId = bindPlayerSelector(state, source.playerId, context);
        return playerId ? [{ playerId, zone: source.zone, filter: source.filter }] : [];
      });
      if (sources.length === 0) {
        return null;
      }
      return {
        kind: "choose_card",
        chooserId,
        sources,
        thenEffects: effect.thenEffects.map((entry) => ({ ...entry })),
        sourceId: context.sourceId,
      };
    }
    case "deal_damage": {
      const amount = effect.amount === "x" ? context.xValue ?? 0 : effect.amount;
      if (amount <= 0) {
        return null;
      }
      if (effect.target.type === "chosen") {
        const chosen = chosenTargetAt(context, effect.target.index, state);
        if (!chosen || chosen.type === "spell") {
          return null;
        }
        return {
          kind: "deal_damage",
          amount,
          sourceId: bindSourceId(effect.sourceId, context),
          target: chosen,
        };
      }
      if (effect.target.type === "player") {
        const playerId = bindPlayerSelector(state, effect.target.playerId, context);
        if (!playerId) {
          return null;
        }
        return {
          kind: "deal_damage",
          amount,
          sourceId: bindSourceId(effect.sourceId, context),
          target: { type: "player", playerId },
        };
      }
      return {
        kind: "deal_damage",
        amount,
        sourceId: bindSourceId(effect.sourceId, context),
        target: effect.target,
      };
    }
    case "divided_damage":
      // Handled at spell resolution with the announced division.
      return null;
    case "create_token": {
      const ownerId = bindPlayerSelector(state, effect.ownerId, context);
      if (!ownerId) {
        return null;
      }
      return {
        ...effect,
        ownerId,
      };
    }
    case "move_card": {
      const cardId = bindCardId(state, effect.cardId, context);
      if (!cardId) {
        return null;
      }
      return {
        kind: "move_card",
        cardId,
        toZone: effect.toZone,
        libraryPosition: effect.libraryPosition,
        ...(effect.entersTapped ? { entersTapped: true } : {}),
      };
    }
    case "tap":
    case "untap": {
      const cardId = bindCardId(state, effect.cardId, context);
      if (!cardId) {
        return null;
      }
      return { kind: effect.kind, cardId };
    }
    case "sacrifice": {
      const cardId = bindCardId(state, effect.cardId, context);
      if (!cardId) {
        return null;
      }
      return { kind: "sacrifice", cardId };
    }
    case "add_counter": {
      const cardId = bindCardId(state, effect.cardId, context);
      if (!cardId) {
        return null;
      }
      return { kind: "add_counter", cardId, counter: effect.counter, amount: effect.amount };
    }
    case "set_class_level": {
      const cardId = bindCardId(state, effect.cardId, context);
      if (!cardId) {
        return null;
      }
      return { kind: "set_class_level", cardId, level: effect.level };
    }
    case "pt_until_eot": {
      const cardId = bindCardId(state, effect.cardId, context);
      if (!cardId) {
        return null;
      }
      return { kind: "pt_until_eot", cardId, power: effect.power, toughness: effect.toughness };
    }
    case "keyword_until_eot": {
      const cardId = bindCardId(state, effect.cardId, context);
      if (!cardId) {
        return null;
      }
      return { kind: "keyword_until_eot", cardId, keyword: effect.keyword };
    }
    case "team_pt_until_eot": {
      const playerId = bindPlayerSelector(state, effect.playerId, context);
      if (!playerId) {
        return null;
      }
      return { kind: "team_pt_until_eot", playerId, power: effect.power, toughness: effect.toughness };
    }
    case "team_keyword_until_eot": {
      const playerId = bindPlayerSelector(state, effect.playerId, context);
      if (!playerId) {
        return null;
      }
      return { kind: "team_keyword_until_eot", playerId, keyword: effect.keyword };
    }
    case "search_library": {
      const playerId = bindPlayerSelector(state, effect.playerId, context);
      if (!playerId) {
        return null;
      }
      return {
        kind: "search_library",
        playerId,
        filter: { ...effect.filter },
        destination: effect.destination,
        count: effect.count,
        ...(effect.entersTapped ? { entersTapped: true } : {}),
      };
    }
    case "attach": {
      const cardId = bindCardId(state, effect.cardId, context);
      if (!cardId) {
        return null;
      }
      let toId: CardInstanceId | null;
      if (typeof effect.toId === "string") {
        toId = effect.toId;
      } else {
        const chosen = chosenTargetAt(context, effect.toId.index, state);
        toId = chosen?.type === "creature" ? chosen.cardId : null;
      }
      if (!toId) {
        return null;
      }
      return { kind: "attach", cardId, toId };
    }
    case "transform": {
      const cardId = bindCardId(state, effect.cardId, context);
      if (!cardId) {
        return null;
      }
      return { kind: "transform", cardId };
    }
    case "manifest": {
      const playerId = bindPlayerSelector(state, effect.playerId, context);
      if (!playerId) {
        return null;
      }
      return { kind: "manifest", playerId, count: effect.count };
    }
    case "counter_on_controlled_creatures": {
      const playerId = bindPlayerSelector(state, effect.playerId, context);
      if (!playerId) {
        return null;
      }
      return {
        kind: "counter_on_controlled_creatures",
        playerId,
        counter: effect.counter,
        amount: effect.amount,
      };
    }
    case "destroy_all":
      return {
        kind: "destroy_all",
        what: effect.what,
        ...(effect.maxManaValue !== undefined ? { maxManaValue: effect.maxManaValue } : {}),
      };
    case "unless_pays": {
      const playerId = bindPlayerSelector(state, effect.playerId, context);
      if (!playerId) {
        return null;
      }
      return {
        kind: "unless_pays",
        playerId,
        cost: effect.cost,
        effects: bindCardEffects(state, effect.effects, context),
      };
    }
    case "may_pay": {
      const playerId = bindPlayerSelector(state, effect.playerId, context);
      if (!playerId) {
        return null;
      }
      return {
        kind: "may_pay",
        playerId,
        cost: effect.cost,
        effects: bindCardEffects(state, effect.effects, context),
      };
    }
    case "damage_all":
      return {
        kind: "damage_all",
        sourceId: bindSourceId(effect.sourceId, context),
        amount: effect.amount === "x" ? context.xValue ?? 0 : effect.amount,
        ...(effect.includePlayers ? { includePlayers: true } : {}),
      };
    case "flicker": {
      const cardId = bindCardId(state, effect.cardId, context);
      if (!cardId) {
        return null;
      }
      return { kind: "flicker", cardId };
    }
    case "exile_graveyard": {
      const playerId = bindPlayerSelector(state, effect.playerId, context);
      if (!playerId) {
        return null;
      }
      return { kind: "exile_graveyard", playerId };
    }
    case "copy_token": {
      const ownerId = bindPlayerSelector(state, effect.ownerId, context);
      if (!ownerId) {
        return null;
      }
      let ofCardId: CardInstanceId | null;
      if (typeof effect.ofCardId === "string") {
        ofCardId = effect.ofCardId;
      } else {
        const chosen = chosenTargetAt(context, effect.ofCardId.index, state);
        ofCardId = chosen?.type === "creature" ? chosen.cardId : null;
      }
      if (!ofCardId) {
        return null;
      }
      return { kind: "copy_token", ownerId, ofCardId };
    }
    case "counter_spell": {
      const chosen = chosenTargetAt(context, effect.target.index, state);
      if (!chosen || chosen.type !== "spell") {
        return null;
      }
      return { kind: "counter_spell", stackObjectId: chosen.stackObjectId };
    }
    case "counter_unless_pays": {
      const chosen = chosenTargetAt(context, effect.target.index, state);
      if (!chosen || chosen.type !== "spell") {
        return null;
      }
      return { kind: "counter_unless_pays", stackObjectId: chosen.stackObjectId, cost: effect.cost };
    }
    default: {
      const exhaustive: never = effect;
      throw new Error(`Unknown card effect ${(exhaustive as CardEffect).kind}`);
    }
  }
}

export function bindCardEffects(
  state: GameState,
  effects: CardEffect[],
  context: BindEffectContext,
): GameEffect[] {
  return effects.flatMap((effect) => {
    return expandEachOpponent(state, effect, context.controllerId).flatMap((item) => {
      const bound = bindCardEffect(state, item, context);
      return bound ? [bound] : [];
    });
  });
}

function requirePlayer(state: GameState, playerId: PlayerId): PlayerState {
  const player = state.players.find((entry) => entry.id === playerId);
  if (!player) {
    throw new Error(`Unknown player ${playerId}`);
  }
  return player;
}

function requirePositiveInteger(amount: number, label: string): void {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error(`Invalid ${label}`);
  }
}

function snapshot(state: GameState): string {
  return JSON.stringify(state);
}

function applyGainLife(state: GameState, playerId: PlayerId, amount: number): GameState {
  requirePositiveInteger(amount, "life gain");
  const next = cloneGameState(state);
  requirePlayer(next, playerId).life += amount;
  next.log.push({ kind: "life_change", playerId, delta: amount });
  dispatchEventsInPlace(next, [{ kind: "gains_life", playerId }]);
  return next;
}

function applyLoseLife(state: GameState, playerId: PlayerId, amount: number): GameState {
  requirePositiveInteger(amount, "life loss");
  const next = cloneGameState(state);
  requirePlayer(next, playerId).life -= amount;
  next.log.push({ kind: "life_change", playerId, delta: -amount });
  return next;
}

function applyDealDamage(state: GameState, effect: Extract<GameEffect, { kind: "deal_damage" }>): GameState {
  requirePositiveInteger(effect.amount, "damage");
  if (effect.sourceId && !state.cards[effect.sourceId]) {
    throw new Error(`Unknown source ${effect.sourceId}`);
  }

  if (effect.target.type === "player") {
    return applyLoseLife(state, effect.target.playerId, effect.amount);
  }

  const card = state.cards[effect.target.cardId];
  if (!card) {
    throw new Error(`Unknown card ${effect.target.cardId}`);
  }
  if (card.zone !== "battlefield" || !isCreature(state, card.id)) {
    throw new Error(`Card ${card.id} is not a creature on the battlefield`);
  }

  // Protection prevents damage from sources of the protected colors.
  const protection = state.definitions[card.definitionId]?.protectionFrom ?? [];
  if (protection.length > 0) {
    const colors = sourceColorsOf(state, effect.sourceId ?? null);
    if (protection.some((color) => colors.includes(color))) {
      return cloneGameState(state);
    }
  }
  const next = cloneGameState(state);
  const damaged = next.cards[card.id];
  if (!damaged) {
    throw new Error(`Unknown card ${card.id}`);
  }
  damaged.damageMarked += effect.amount;
  if (effect.sourceId && hasKeyword(next, effect.sourceId, "deathtouch")) {
    damaged.deathtouched = true;
  }
  // Destruction is a state-based action (CR 704.5g/h); applyEffect sweeps.
  return next;
}

/** Blasphemous Act: mark every creature's damage in one pass, sweep once. */
function applyDamageAll(
  state: GameState,
  effect: Extract<GameEffect, { kind: "damage_all" }>,
): GameState {
  requirePositiveInteger(effect.amount, "damage");
  const next = cloneGameState(state);
  const sourceColors = sourceColorsOf(next, effect.sourceId ?? null);
  const deathtouch = effect.sourceId ? hasKeyword(next, effect.sourceId, "deathtouch") : false;
  for (const card of Object.values(next.cards)) {
    if (card.zone !== "battlefield" || !isCreature(next, card.id)) {
      continue;
    }
    const protection = next.definitions[card.definitionId]?.protectionFrom ?? [];
    if (protection.length > 0 && protection.some((color) => sourceColors.includes(color))) {
      continue;
    }
    card.damageMarked += effect.amount;
    if (deathtouch) {
      card.deathtouched = true;
    }
  }
  if (effect.includePlayers) {
    for (const player of next.players) {
      if (!player.lost) {
        player.life -= effect.amount;
        next.log.push({ kind: "life_change", playerId: player.id, delta: -effect.amount });
      }
    }
  }
  // Destruction is a state-based action; applyEffect sweeps the batch at once.
  return next;
}

function applyDraw(
  state: GameState,
  playerId: PlayerId,
  count: number,
  optional?: boolean,
): GameState {
  requirePositiveInteger(count, "draw count");
  if (wouldSkipDraw(state, playerId)) {
    return cloneGameState(state);
  }
  const player = requirePlayer(state, playerId);
  // "You may draw": auto-taken, declined only when it would deck the player.
  if (optional && player.zones.library.length < count) {
    return cloneGameState(state);
  }
  let next = cloneGameState(state);
  let drawn = 0;
  for (let i = 0; i < count; i += 1) {
    if (wouldSkipDraw(next, playerId)) {
      break;
    }
    const current = next.players.find((entry) => entry.id === playerId);
    if (!current) {
      throw new Error(`Unknown player ${playerId}`);
    }
    const top = current.zones.library[0];
    if (!top) {
      current.failedToDraw = true;
      break;
    }
    next = moveCard(next, top, "hand");
    drawn += 1;
  }
  if (drawn > 0) {
    dispatchEventsInPlace(
      next,
      Array.from({ length: drawn }, () => ({ kind: "draws" as const, playerId })),
    );
  }
  return next;
}

function applyScry(state: GameState, playerId: PlayerId, count: number): GameState {
  requirePositiveInteger(count, "scry count");
  const player = requirePlayer(state, playerId);
  const looked = Math.min(count, player.zones.library.length);
  if (looked === 0) {
    return cloneGameState(state);
  }
  const next = cloneGameState(state);
  next.prompts.push({
    kind: "scry",
    playerId,
    count: looked,
  });
  return next;
}

function applySurveil(state: GameState, playerId: PlayerId, count: number): GameState {
  requirePositiveInteger(count, "surveil count");
  const player = requirePlayer(state, playerId);
  const looked = Math.min(count, player.zones.library.length);
  if (looked === 0) {
    return cloneGameState(state);
  }
  const next = cloneGameState(state);
  next.prompts.push({
    kind: "surveil",
    playerId,
    count: looked,
  });
  return next;
}

function applyMill(state: GameState, playerId: PlayerId, count: number): GameState {
  requirePositiveInteger(count, "mill count");
  requirePlayer(state, playerId);
  let next = state;
  for (let i = 0; i < count; i += 1) {
    const current = next.players.find((entry) => entry.id === playerId);
    const top = current?.zones.library[0];
    if (!top) {
      return next === state ? cloneGameState(state) : next;
    }
    next = moveCard(next, top, "graveyard");
  }
  return next;
}

function applyDiscard(state: GameState, playerId: PlayerId, count: number): GameState {
  requirePositiveInteger(count, "discard count");
  requirePlayer(state, playerId);
  let next = state;
  for (let i = 0; i < count; i += 1) {
    const current = next.players.find((entry) => entry.id === playerId);
    const first = current?.zones.hand[0];
    if (!first) {
      return next === state ? cloneGameState(state) : next;
    }
    next = moveCard(next, first, "graveyard");
  }
  return next;
}

function applySacrifice(state: GameState, cardId: CardInstanceId): GameState {
  const card = state.cards[cardId];
  if (!card) {
    throw new Error(`Unknown card ${cardId}`);
  }
  if (card.zone !== "battlefield") {
    throw new Error(`Card ${cardId} is not on the battlefield`);
  }
  return moveCard(state, cardId, "graveyard");
}

function applyAddCounter(
  state: GameState,
  cardId: CardInstanceId,
  counter: string,
  amount: number,
): GameState {
  requirePositiveInteger(amount, "counter amount");
  if (!state.cards[cardId]) {
    throw new Error(`Unknown card ${cardId}`);
  }
  const next = cloneGameState(state);
  const card = next.cards[cardId];
  if (!card) {
    throw new Error(`Unknown card ${cardId}`);
  }
  card.counters[counter] = (card.counters[counter] ?? 0) + amount;
  return next;
}

function applySetClassLevel(state: GameState, cardId: CardInstanceId, level: number): GameState {
  requirePositiveInteger(level, "class level");
  const next = cloneGameState(state);
  const card = next.cards[cardId];
  if (!card) {
    throw new Error(`Unknown card ${cardId}`);
  }
  if (card.zone !== "battlefield") {
    throw new Error(`Card ${cardId} is not on the battlefield`);
  }
  if (card.classLevel < 1) {
    throw new Error(`Card ${cardId} is not a Class`);
  }
  if (level !== card.classLevel + 1) {
    throw new Error("Class levels must be gained in order");
  }
  card.classLevel = level;
  return next;
}

/** "This spell can't be countered" (CR 608.2r); counter effects fizzle against it. */
function cantBeCountered(state: GameState, stackObjectId: StackObjectId): boolean {
  const entry = state.stack.find((object) => object.id === stackObjectId);
  if (!entry || entry.kind !== "spell" || !entry.sourceId) {
    return false;
  }
  const card = state.cards[entry.sourceId];
  return Boolean(card && state.definitions[card.definitionId]?.cantBeCountered);
}

function applyCounterUnlessPays(
  state: GameState,
  stackObjectId: StackObjectId,
  cost: string,
): GameState {
  const entry = state.stack.find((object) => object.id === stackObjectId);
  if (!entry) {
    return state;
  }
  if (cantBeCountered(state, stackObjectId)) {
    return state;
  }
  const next = cloneGameState(state);
  next.prompts.push({
    kind: "pay_or_counter",
    playerId: entry.controllerId,
    cost,
    stackObjectId,
    reason: "unless_pays",
  });
  return next;
}

function applyCounterSpell(state: GameState, stackObjectId: StackObjectId): GameState {
  if (cantBeCountered(state, stackObjectId)) {
    return state;
  }
  const next = cloneGameState(state);
  const index = next.stack.findIndex((entry) => entry.id === stackObjectId);
  if (index === -1) {
    return next;
  }
  const [removed] = next.stack.splice(index, 1);
  if (!removed?.sourceId || next.cards[removed.sourceId]?.zone !== "stack") {
    return next;
  }
  return enterOwnerZone(next, removed.sourceId, "graveyard");
}

function applyCreateToken(
  state: GameState,
  effect: Extract<GameEffect, { kind: "create_token" }>,
): GameState {
  requirePlayer(state, effect.ownerId);
  const next = cloneGameState(state);
  const preset = tokenPresetFor(effect.typeLine);
  const definition = createCardDefinition({
    name: effect.name,
    typeLine: effect.typeLine,
    power: effect.power ?? null,
    toughness: effect.toughness ?? null,
    ...(preset?.manaAbilities ? { manaAbilities: preset.manaAbilities } : {}),
    ...(preset?.activated ? { activated: preset.activated } : {}),
  });
  const token = createCardInstance({
    definitionId: definition.id,
    ownerId: effect.ownerId,
    zone: "battlefield",
    isToken: true,
  });
  next.definitions[definition.id] = definition;
  next.cards[token.id] = token;
  token.timestamp = next.nextTimestamp;
  next.nextTimestamp += 1;
  const owner = next.players.find((player) => player.id === effect.ownerId);
  if (!owner) {
    throw new Error(`Unknown player ${effect.ownerId}`);
  }
  owner.zones.battlefield.push(token.id);
  if (countCardPlacements(next, token.id) !== 1) {
    throw new Error(`Token zone integrity failed for ${token.id}`);
  }
  queueEnterBattlefieldTriggersInPlace(next, token.id);
  return next;
}

function findControlledArmy(state: GameState, playerId: PlayerId): CardInstanceId | undefined {
  const player = state.players.find((entry) => entry.id === playerId);
  return player?.zones.battlefield.find((cardId) => {
    const card = state.cards[cardId];
    return Boolean(card && card.controllerId === playerId && hasSubtype(state, cardId, "army"));
  });
}

function applyAmass(
  state: GameState,
  playerId: PlayerId,
  amount: number,
  subtype: string | undefined,
): GameState {
  requirePositiveInteger(amount, "amass amount");
  requirePlayer(state, playerId);
  let next = state;
  let armyId = findControlledArmy(next, playerId);
  if (!armyId) {
    const template = amassArmyTemplate(subtype);
    next = applyCreateToken(next, {
      kind: "create_token",
      ownerId: playerId,
      name: template.name,
      typeLine: template.typeLine,
      power: template.power,
      toughness: template.toughness,
    });
    armyId = findControlledArmy(next, playerId);
  }
  if (!armyId) {
    throw new Error("Amass failed to create an Army");
  }
  return applyAddCounter(next, armyId, "p1p1", amount);
}

function applyDiscardUnlessAttacked(state: GameState, playerId: PlayerId, count: number): GameState {
  requirePositiveInteger(count, "discard count");
  const player = requirePlayer(state, playerId);
  if (player.attackedThisTurn) {
    return state;
  }
  const available = Math.min(count, player.zones.hand.length);
  if (available === 0) {
    return state;
  }
  const next = cloneGameState(state);
  next.prompts.push({ kind: "choose_discard", playerId, count: available });
  return next;
}

function pushUntilEotEffect(
  state: GameState,
  affected: CardInstanceId[],
  effect: ContinuousEffectData,
): GameState {
  const onBattlefield = affected.filter((cardId) => state.cards[cardId]?.zone === "battlefield");
  if (onBattlefield.length === 0) {
    return state;
  }
  const next = cloneGameState(state);
  next.activeEffects.push({
    id: createId("effect"),
    sourceId: null,
    affected: onBattlefield,
    effect,
    duration: "until_end_of_turn",
    timestamp: next.nextTimestamp,
  });
  next.nextTimestamp += 1;
  return next;
}

function applyPtUntilEot(
  state: GameState,
  cardId: CardInstanceId,
  power: number,
  toughness: number,
): GameState {
  const card = state.cards[cardId];
  if (!card) {
    throw new Error(`Unknown card ${cardId}`);
  }
  if (card.zone !== "battlefield" || !isCreature(state, cardId)) {
    throw new Error(`Card ${cardId} is not a creature on the battlefield`);
  }
  return pushUntilEotEffect(state, [cardId], { kind: "modify_pt", power, toughness });
}

function applyKeywordUntilEot(
  state: GameState,
  cardId: CardInstanceId,
  keyword: Keyword,
): GameState {
  const card = state.cards[cardId];
  if (!card) {
    throw new Error(`Unknown card ${cardId}`);
  }
  if (card.zone !== "battlefield") {
    throw new Error(`Card ${cardId} is not on the battlefield`);
  }
  return pushUntilEotEffect(state, [cardId], { kind: "grant_keyword", keyword });
}

function applyTeamPtUntilEot(
  state: GameState,
  playerId: PlayerId,
  power: number,
  toughness: number,
): GameState {
  requirePlayer(state, playerId);
  // CR 611.2c: the affected set locks in when the effect is created.
  const team = Object.values(state.cards)
    .filter(
      (card) =>
        card.zone === "battlefield" &&
        card.controllerId === playerId &&
        isCreature(state, card.id),
    )
    .map((card) => card.id);
  if (team.length === 0) {
    return state;
  }
  return pushUntilEotEffect(state, team, { kind: "modify_pt", power, toughness });
}

function applyTeamKeywordUntilEot(
  state: GameState,
  playerId: PlayerId,
  keyword: Keyword,
): GameState {
  requirePlayer(state, playerId);
  // CR 611.2c: the affected set locks in when the effect is created.
  const team = Object.values(state.cards)
    .filter(
      (card) =>
        card.zone === "battlefield" &&
        card.controllerId === playerId &&
        isCreature(state, card.id),
    )
    .map((card) => card.id);
  if (team.length === 0) {
    return state;
  }
  return pushUntilEotEffect(state, team, { kind: "grant_keyword", keyword });
}

function applySearchLibrary(
  state: GameState,
  effect: Extract<GameEffect, { kind: "search_library" }>,
): GameState {
  requirePositiveInteger(effect.count, "search count");
  const player = requirePlayer(state, effect.playerId);
  if (player.zones.library.length === 0) {
    return state;
  }
  const next = cloneGameState(state);
  next.prompts.push({
    kind: "search_library",
    playerId: effect.playerId,
    filter: { ...effect.filter },
    destination: effect.destination,
    count: effect.count,
    ...(effect.entersTapped ? { entersTapped: true } : {}),
  });
  return next;
}

function applyAttach(state: GameState, cardId: CardInstanceId, toId: CardInstanceId): GameState {
  const attachment = state.cards[cardId];
  const host = state.cards[toId];
  if (!attachment || attachment.zone !== "battlefield") {
    throw new Error(`Card ${cardId} is not on the battlefield`);
  }
  if (!host || host.zone !== "battlefield" || !isCreature(state, toId)) {
    throw new Error(`Card ${toId} is not a creature on the battlefield`);
  }
  const next = cloneGameState(state);
  next.cards[cardId]!.attachedTo = toId;
  return next;
}

function applyTransform(state: GameState, cardId: CardInstanceId): GameState {
  const card = state.cards[cardId];
  const definition = card ? state.definitions[card.definitionId] : undefined;
  if (!card || !definition?.otherFaceId || !state.definitions[definition.otherFaceId]) {
    throw new Error(`Card ${cardId} has no other face`);
  }
  const next = cloneGameState(state);
  next.cards[cardId]!.definitionId = definition.otherFaceId;
  return next;
}

function applyCopyToken(
  state: GameState,
  ownerId: PlayerId,
  ofCardId: CardInstanceId,
): GameState {
  requirePlayer(state, ownerId);
  const original = state.cards[ofCardId];
  if (!original || original.zone !== "battlefield") {
    throw new Error(`Card ${ofCardId} is not on the battlefield`);
  }
  const next = cloneGameState(state);
  const token = createCardInstance({
    definitionId: original.definitionId,
    ownerId,
    zone: "battlefield",
    isToken: true,
  });
  token.timestamp = next.nextTimestamp;
  next.nextTimestamp += 1;
  next.cards[token.id] = token;
  const owner = next.players.find((player) => player.id === ownerId);
  if (!owner) {
    throw new Error(`Unknown player ${ownerId}`);
  }
  owner.zones.battlefield.push(token.id);
  queueEnterBattlefieldTriggersInPlace(next, token.id);
  return next;
}

function applyCounterOnControlledCreatures(
  state: GameState,
  playerId: PlayerId,
  counter: string,
  amount: number,
): GameState {
  requirePositiveInteger(amount, "counter amount");
  requirePlayer(state, playerId);
  const next = cloneGameState(state);
  for (const card of Object.values(next.cards)) {
    if (card.zone === "battlefield" && card.controllerId === playerId && isCreature(next, card.id)) {
      card.counters[counter] = (card.counters[counter] ?? 0) + amount;
    }
  }
  return next;
}

function applyManifest(state: GameState, playerId: PlayerId, count: number): GameState {
  requirePositiveInteger(count, "manifest count");
  requirePlayer(state, playerId);
  const next = cloneGameState(state);
  for (let i = 0; i < count; i += 1) {
    const player = next.players.find((entry) => entry.id === playerId);
    const top = player?.zones.library[0];
    if (!top) {
      break;
    }
    const card = next.cards[top];
    if (card) {
      card.faceDown = true;
    }
    moveCardInPlace(next, top, "battlefield");
  }
  return next;
}

function applyRevealZone(
  state: GameState,
  fromPlayerId: PlayerId,
  toPlayerId: PlayerId,
  zone: "hand",
): GameState {
  requirePlayer(state, fromPlayerId);
  requirePlayer(state, toPlayerId);
  const from = state.players.find((entry) => entry.id === fromPlayerId);
  const next = cloneGameState(state);
  next.reveals.push({
    viewerId: toPlayerId,
    cardIds: [...(from?.zones[zone] ?? [])],
  });
  return next;
}

/** Board wipe (Wrath of God): destroy every matching permanent as one event batch. */
function applyDestroyAll(
  state: GameState,
  effect: Extract<GameEffect, { kind: "destroy_all" }>,
): GameState {
  const what = effect.what;
  const next = cloneGameState(state);
  const matches = (cardId: CardInstanceId): boolean => {
    if (what === "creatures") {
      return isCreature(next, cardId);
    }
    if (what === "nonland") {
      return !isLand(next, cardId);
    }
    const types = characteristicsOf(next, cardId).types;
    if (what === "artifacts") {
      return types.includes("artifact");
    }
    if (what === "enchantments") {
      return types.includes("enchantment");
    }
    return types.includes("planeswalker");
  };
  const doomed = Object.values(next.cards)
    .filter((card) => card.zone === "battlefield" && matches(card.id))
    .filter(
      (card) =>
        effect.maxManaValue === undefined ||
        characteristicsOf(next, card.id).manaValue <= effect.maxManaValue,
    )
    .filter((card) => !hasKeyword(next, card.id, "indestructible"))
    .map((card) => card.id);
  const collectDies: EngineEvent[] = [];
  for (const cardId of doomed) {
    moveCardInPlace(next, cardId, "graveyard", { collectDies });
  }
  if (collectDies.length > 0) {
    dispatchEventsInPlace(next, collectDies);
  }
  return next;
}

function applyChooseCardEffect(
  state: GameState,
  effect: Extract<GameEffect, { kind: "choose_card" }>,
): GameState {
  const legal = legalIdsForChooseSources(state, effect.sources);
  if (legal.length === 0) {
    return state;
  }
  const next = cloneGameState(state);
  next.prompts.push({
    kind: "choose_card",
    playerId: effect.chooserId,
    sources: effect.sources.map((source) => ({ ...source })),
    thenEffects: effect.thenEffects.map((entry) => ({ ...entry })),
    sourceId: effect.sourceId,
  });
  return next;
}

function applyLookAndAssign(
  state: GameState,
  playerId: PlayerId,
  count: number,
  destinations: LookDestination[],
): GameState {
  requirePositiveInteger(count, "look count");
  const player = requirePlayer(state, playerId);
  const looked = Math.min(count, player.zones.library.length);
  if (looked === 0 || destinations.length === 0) {
    return state;
  }
  const next = cloneGameState(state);
  next.prompts.push({
    kind: "look_and_assign",
    playerId,
    count: looked,
    destinations: destinations.slice(0, Math.max(looked, destinations.length)),
  });
  return next;
}

/**
 * Apply a reusable rules effect. Illegal effects throw and leave the original
 * GameState unchanged.
 */
export function applyEffect(state: GameState, effect: GameEffect): GameState {
  const before = snapshot(state);
  try {
    let next: GameState;
    switch (effect.kind) {
      case "gain_life":
        next = applyGainLife(state, effect.playerId, effect.amount);
        break;
      case "lose_life":
        next = applyLoseLife(state, effect.playerId, effect.amount);
        break;
      case "deal_damage":
        next = applyDealDamage(state, effect);
        break;
      case "draw":
        next = applyDraw(state, effect.playerId, effect.count, effect.optional);
        break;
      case "scry":
        next = applyScry(state, effect.playerId, effect.count);
        break;
      case "surveil":
        next = applySurveil(state, effect.playerId, effect.count);
        break;
      case "move_card": {
        next = moveCard(state, effect.cardId, effect.toZone, {
          libraryPosition: effect.libraryPosition,
        });
        if (effect.entersTapped && next.cards[effect.cardId]?.zone === "battlefield") {
          next.cards[effect.cardId]!.tapped = true;
        }
        break;
      }
      case "tap":
        next = tapCard(state, effect.cardId);
        break;
      case "untap":
        next = untapCard(state, effect.cardId);
        break;
      case "add_mana":
        next = addMana(state, effect.playerId, effect.mana);
        break;
      case "create_token":
        next = applyCreateToken(state, effect);
        break;
      case "mill":
        next = applyMill(state, effect.playerId, effect.count);
        break;
      case "discard":
        next = applyDiscard(state, effect.playerId, effect.count);
        break;
      case "sacrifice":
        next = applySacrifice(state, effect.cardId);
        break;
      case "add_counter":
        next = applyAddCounter(state, effect.cardId, effect.counter, effect.amount);
        break;
      case "counter_spell":
        next = applyCounterSpell(state, effect.stackObjectId);
        break;
      case "counter_unless_pays":
        next = applyCounterUnlessPays(state, effect.stackObjectId, effect.cost);
        break;
      case "set_class_level":
        next = applySetClassLevel(state, effect.cardId, effect.level);
        break;
      case "discard_unless_attacked":
        next = applyDiscardUnlessAttacked(state, effect.playerId, effect.count);
        break;
      case "pt_until_eot":
        next = applyPtUntilEot(state, effect.cardId, effect.power, effect.toughness);
        break;
      case "keyword_until_eot":
        next = applyKeywordUntilEot(state, effect.cardId, effect.keyword);
        break;
      case "team_pt_until_eot":
        next = applyTeamPtUntilEot(state, effect.playerId, effect.power, effect.toughness);
        break;
      case "team_keyword_until_eot":
        next = applyTeamKeywordUntilEot(state, effect.playerId, effect.keyword);
        break;
      case "search_library":
        next = applySearchLibrary(state, effect);
        break;
      case "attach":
        next = applyAttach(state, effect.cardId, effect.toId);
        break;
      case "transform":
        next = applyTransform(state, effect.cardId);
        break;
      case "copy_token":
        next = applyCopyToken(state, effect.ownerId, effect.ofCardId);
        break;
      case "manifest":
        next = applyManifest(state, effect.playerId, effect.count);
        break;
      case "counter_on_controlled_creatures":
        next = applyCounterOnControlledCreatures(
          state,
          effect.playerId,
          effect.counter,
          effect.amount,
        );
        break;
      case "destroy_all":
        next = applyDestroyAll(state, effect);
        break;
      case "damage_all":
        next = applyDamageAll(state, effect);
        break;
      case "flicker": {
        const card = state.cards[effect.cardId];
        if (!card || card.zone !== "battlefield") {
          next = cloneGameState(state);
          break;
        }
        next = moveCard(state, effect.cardId, "exile");
        if (next.cards[effect.cardId]?.zone === "exile") {
          next = moveCard(next, effect.cardId, "battlefield");
        }
        break;
      }
      case "exile_graveyard": {
        next = cloneGameState(state);
        const player = next.players.find((entry) => entry.id === effect.playerId);
        for (const cardId of [...(player?.zones.graveyard ?? [])]) {
          next = moveCard(next, cardId, "exile");
        }
        break;
      }
      case "unless_pays": {
        next = cloneGameState(state);
        if (isLiving(next, effect.playerId)) {
          next.prompts.push({
            kind: "pay_or_effect",
            playerId: effect.playerId,
            cost: effect.cost,
            thenEffects: effect.effects.map((entry) => ({ ...entry })),
            sourceId: null,
          });
        } else {
          next = applyEffects(next, effect.effects);
        }
        break;
      }
      case "may_pay": {
        next = cloneGameState(state);
        if (isLiving(next, effect.playerId)) {
          next.prompts.push({
            kind: "pay_or_effect",
            playerId: effect.playerId,
            cost: effect.cost,
            thenEffects: effect.effects.map((entry) => ({ ...entry })),
            sourceId: null,
            whenPaid: true,
          });
        }
        break;
      }
      case "amass":
        next = applyAmass(state, effect.playerId, effect.amount, effect.subtype);
        break;
      case "reveal_zone":
        next = applyRevealZone(state, effect.fromPlayerId, effect.toPlayerId, effect.zone);
        break;
      case "choose_card":
        next = applyChooseCardEffect(state, effect);
        break;
      case "look_and_assign":
        next = applyLookAndAssign(state, effect.playerId, effect.count, effect.destinations);
        break;
      default: {
        const exhaustive: never = effect;
        throw new Error(`Unknown effect ${(exhaustive as GameEffect).kind}`);
      }
    }
    applyStateBasedActionsInPlace(next);
    return next;
  } catch (error) {
    if (JSON.stringify(state) !== before) {
      throw new Error("Illegal effect mutated GameState");
    }
    throw error;
  }
}

export function applyEffects(state: GameState, effects: GameEffect[]): GameState {
  let current = state;
  for (let index = 0; index < effects.length; index += 1) {
    current = applyEffect(current, effects[index]!);
    if (!isPromptOpen(current)) {
      continue;
    }
    const prompt = current.prompts[current.prompts.length - 1];
    if (
      prompt &&
      (prompt.kind === "scry" ||
        prompt.kind === "surveil" ||
        prompt.kind === "choose_discard" ||
        prompt.kind === "choose_card" ||
        prompt.kind === "look_and_assign" ||
        prompt.kind === "search_library" ||
        prompt.kind === "pay_or_counter" ||
        prompt.kind === "pay_or_effect")
    ) {
      const remaining = effects.slice(index + 1);
      if (remaining.length > 0) {
        prompt.resumeEffects = remaining;
      }
    }
    break;
  }
  return current;
}
