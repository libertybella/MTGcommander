import { abilitiesRemoved, cardMatchesSubtype } from "./characteristicsEngine";
import { cloneGameState } from "./clone";
import { createCardDefinition, createCardInstance } from "./createGame";
import { characteristicsOf, hasSubtype, isCreature, isInstantOrSorcery, isLand } from "./cardTypes";
import { createId } from "./ids";
import { allBattlefieldCreatureCount, creaturePower, creatureToughness, wouldSkipDraw } from "./derived";
import { hasKeyword } from "./keywords";
import { addMana, tapCard, untapCard } from "./mana";
import { isLiving, livingPlayers, nextLivingPlayerId } from "./players";
import { isPromptOpen, legalIdsForChooseSources, searchMatches } from "./prompt";
import { shuffleInPlace } from "./shuffle";
import { applyStateBasedActionsInPlace } from "./status";
import { isChosenTargetLegal, legalChoicesForRequirement, sourceColorsOf } from "./targeting";
import { amassArmyTemplate, tokenPresetFor } from "./tokens";
import { dispatchEventsInPlace, queueEnterBattlefieldTriggersInPlace } from "./triggers";
import { countCardPlacements, enterOwnerZone, moveCard, moveCardInPlace, processDiesReturnsInPlace } from "./zones";
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
  /** The trigger event's amount ("that much" life gained or lost). */
  subjectAmount?: number;
  /** Fling: the power of the creature sacrificed as a cast cost. */
  sacrificedPower?: number;
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
    effect.kind === "discard" ||
    effect.kind === "exile_top_play"
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

/** "X is the number of Dragons you control" — computed characteristics. */
function countControlledSubtype(state: GameState, controllerId: PlayerId, subtype: string): number {
  return Object.values(state.cards).filter(
    (card) =>
      card.zone === "battlefield" &&
      card.controllerId === controllerId &&
      cardMatchesSubtype(state, card.id, subtype),
  ).length;
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
    if (selector === "subject_card") {
      return context.subjectCardId ?? null;
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
    case "lose_life": {
      const playerId = bindPlayerSelector(state, effect.playerId, context);
      if (!playerId) {
        return null;
      }
      const amount =
        effect.amount === "subject_amount"
          ? (context.subjectAmount ?? 0)
          : effect.amount === "subject_toughness"
            ? context.subjectCardId
              ? creatureToughness(state, context.subjectCardId)
              : 0
            : effect.amount;
      if (amount <= 0) {
        return null;
      }
      return { kind: effect.kind, playerId, amount };
    }
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
      const amount =
        effect.amount === "x"
          ? context.xValue ?? 0
          : effect.amount === "sacrificed_power"
            ? context.sacrificedPower ?? 0
            : typeof effect.amount === "object"
              ? countControlledSubtype(state, context.controllerId, effect.amount.subtypeCount)
              : effect.amount;
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
          ...(effect.gainLife ? { gainLife: true } : {}),
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
          ...(effect.gainLife ? { gainLife: true } : {}),
        };
      }
      return {
        kind: "deal_damage",
        amount,
        sourceId: bindSourceId(effect.sourceId, context),
        target: effect.target,
        ...(effect.gainLife ? { gainLife: true } : {}),
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
      const { perControlled, perDiedCreatures, ...tokenRest } = effect;
      let count: number | undefined;
      if (perControlled) {
        count = Object.values(state.cards).filter(
          (card) =>
            card.zone === "battlefield" &&
            card.controllerId === context.controllerId &&
            characteristicsOf(state, card.id).types.includes(perControlled),
        ).length;
        if (count === 0) {
          return null;
        }
      }
      if (perDiedCreatures) {
        count = state.creaturesDiedThisTurn ?? 0;
        if (count === 0) {
          return null;
        }
      }
      return {
        ...tokenRest,
        ownerId,
        ...(count !== undefined ? { count } : {}),
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
        ...(effect.gainsHaste ? { gainsHaste: true } : {}),
        ...(effect.atEndStep ? { atEndStep: effect.atEndStep } : {}),
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
    case "restrict_until_eot": {
      const cardId = bindCardId(state, effect.cardId, context);
      if (!cardId) {
        return null;
      }
      return {
        kind: "restrict_until_eot",
        cardId,
        ...(effect.cantAttack ? { cantAttack: true } : {}),
        ...(effect.cantBlock ? { cantBlock: true } : {}),
        ...(effect.cantBeBlocked ? { cantBeBlocked: true } : {}),
      };
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
    case "grant_dies_return": {
      const cardId = bindCardId(state, effect.cardId, context);
      if (!cardId) {
        return null;
      }
      return {
        kind: "grant_dies_return",
        cardId,
        ...(effect.counter ? { counter: true } : {}),
        ...(effect.treasure ? { treasure: true } : {}),
      };
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
      const { maxManaValueX, ...filterRest } = effect.filter;
      return {
        kind: "search_library",
        playerId,
        filter: {
          ...filterRest,
          ...(maxManaValueX ? { maxManaValue: context.xValue ?? 0 } : {}),
        },
        destination: effect.destination,
        count: effect.count,
        ...(effect.entersTapped ? { entersTapped: true } : {}),
        ...(effect.untapIfLands !== undefined ? { untapIfLands: effect.untapIfLands } : {}),
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
        ...(effect.minManaValue !== undefined ? { minManaValue: effect.minManaValue } : {}),
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
    case "damage_all": {
      const amount =
        effect.amount === "x"
          ? context.xValue ?? 0
          : effect.amount === "creature_count"
            ? allBattlefieldCreatureCount(state)
            : effect.amount;
      if (amount <= 0) {
        return null;
      }
      return {
        kind: "damage_all",
        sourceId: bindSourceId(effect.sourceId, context),
        amount,
        ...(effect.includePlayers ? { includePlayers: true } : {}),
      };
    }
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
      if (effect.ofCardId === "self") {
        ofCardId = context.sourceId;
      } else if (typeof effect.ofCardId === "string") {
        ofCardId = effect.ofCardId;
      } else {
        const chosen = chosenTargetAt(context, effect.ofCardId.index, state);
        ofCardId = chosen?.type === "creature" ? chosen.cardId : null;
      }
      if (!ofCardId) {
        return null;
      }
      return {
        kind: "copy_token",
        ownerId,
        ofCardId,
        ...(effect.count && effect.count > 1 ? { count: effect.count } : {}),
        ...(effect.gainsHaste ? { gainsHaste: true } : {}),
        ...(effect.atEndStep ? { atEndStep: effect.atEndStep } : {}),
        ...(effect.setPt ? { setPt: { ...effect.setPt } } : {}),
      };
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
    case "copy_spell": {
      const chosen = chosenTargetAt(context, effect.target.index, state);
      if (!chosen || chosen.type !== "spell") {
        return null;
      }
      return { kind: "copy_spell", stackObjectId: chosen.stackObjectId, controllerId: context.controllerId };
    }
    case "extra_combat":
      return { kind: "extra_combat" };
    case "fog":
      return { kind: "fog" };
    case "windfall":
      return { kind: "windfall" };
    case "bounce_each_creature":
      return {
        kind: "bounce_each_creature",
        ...(effect.unlessCounter ? { unlessCounter: effect.unlessCounter } : {}),
      };
    case "dig_top": {
      const playerId = bindPlayerSelector(state, effect.playerId, context);
      if (!playerId) {
        return null;
      }
      return {
        kind: "dig_top",
        playerId,
        count: effect.count,
        filter: { ...effect.filter },
        destination: effect.destination,
      };
    }
    case "counter_on_each_creature": {
      const amount = effect.amount === "x" ? context.xValue ?? 0 : effect.amount;
      if (amount <= 0) {
        return null;
      }
      return { kind: "counter_on_each_creature", counter: effect.counter, amount };
    }
    case "overload_each":
      return {
        kind: "overload_each",
        controllerId: context.controllerId,
        sourceId: context.sourceId,
        requirement: { ...effect.requirement },
        effects: effect.effects.map((entry) => ({ ...entry })),
      };
    case "populate": {
      const playerId = bindPlayerSelector(state, effect.playerId, context);
      if (!playerId) {
        return null;
      }
      return { kind: "populate", playerId };
    }
    case "exile_top_play": {
      const playerId = bindPlayerSelector(state, effect.playerId, context);
      if (!playerId) {
        return null;
      }
      return {
        kind: "exile_top_play",
        playerId,
        casterId: context.controllerId,
        count: effect.count,
        ...(effect.freeCast ? { freeCast: true } : {}),
      };
    }
    case "proliferate": {
      const playerId = bindPlayerSelector(state, effect.playerId, context);
      if (!playerId) {
        return null;
      }
      return { kind: "proliferate", playerId };
    }
    case "untap_all": {
      const playerId = bindPlayerSelector(state, effect.playerId, context);
      if (!playerId) {
        return null;
      }
      return { kind: "untap_all", playerId, what: effect.what };
    }
    case "untap_lands_up_to": {
      const playerId = bindPlayerSelector(state, effect.playerId, context);
      if (!playerId) {
        return null;
      }
      return { kind: "untap_lands_up_to", playerId, count: effect.count };
    }
    case "copy_subject_spell":
    case "counter_subject_spell": {
      const subject = context.subjectCardId;
      const entry = subject
        ? state.stack.find(
            (object) => object.kind === "spell" && object.sourceId === subject && !object.isCopy,
          )
        : undefined;
      if (!entry || !entry.sourceId) {
        return null;
      }
      if (effect.kind === "copy_subject_spell") {
        // Documented approximation (RULES_COVERAGE.md): only instant/sorcery
        // subjects are copied — a permanent-spell copy would become a token
        // (CR 707.10c), which this table does not model yet.
        if (!isInstantOrSorcery(state, entry.sourceId)) {
          return null;
        }
        return { kind: "copy_spell", stackObjectId: entry.id, controllerId: context.controllerId };
      }
      return { kind: "counter_spell", stackObjectId: entry.id };
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

/** Rhox Faithmender-class: 2^n for n life-gain doublers the player controls. */
function lifeGainFactor(state: GameState, playerId: PlayerId): number {
  let factor = 1;
  for (const card of Object.values(state.cards)) {
    if (card.zone !== "battlefield" || card.controllerId !== playerId) {
      continue;
    }
    const doubles = (state.definitions[card.definitionId]?.replacements ?? []).filter(
      (replacement) => replacement.kind === "double_life_gain",
    ).length;
    if (doubles === 0 || abilitiesRemoved(state, card.id)) {
      continue;
    }
    factor *= 2 ** doubles;
  }
  return factor;
}

function applyGainLife(state: GameState, playerId: PlayerId, amount: number): GameState {
  requirePositiveInteger(amount, "life gain");
  const next = cloneGameState(state);
  const gained = amount * lifeGainFactor(next, playerId);
  requirePlayer(next, playerId).life += gained;
  next.log.push({ kind: "life_change", playerId, delta: gained });
  dispatchEventsInPlace(next, [{ kind: "gains_life", playerId, amount: gained }]);
  return next;
}

function applyLoseLife(state: GameState, playerId: PlayerId, amount: number): GameState {
  requirePositiveInteger(amount, "life loss");
  const next = cloneGameState(state);
  requirePlayer(next, playerId).life -= amount;
  next.log.push({ kind: "life_change", playerId, delta: -amount });
  dispatchEventsInPlace(next, [{ kind: "loses_life", playerId, amount }]);
  return next;
}

function applyDealDamage(state: GameState, effect: Extract<GameEffect, { kind: "deal_damage" }>): GameState {
  requirePositiveInteger(effect.amount, "damage");
  if (effect.sourceId && !state.cards[effect.sourceId]) {
    throw new Error(`Unknown source ${effect.sourceId}`);
  }

  if (effect.target.type === "player") {
    let next = applyLoseLife(state, effect.target.playerId, effect.amount);
    if (effect.sourceId && next.cards[effect.sourceId]) {
      dispatchEventsInPlace(next, [
        { kind: "deals_damage_to_player", cardId: effect.sourceId, playerId: effect.target.playerId },
      ]);
    }
    next = applyDamageLifegainRider(next, effect);
    return next;
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
  return applyDamageLifegainRider(next, effect);
}

/** "You gain life equal to the damage dealt this way" (Creeping Bloodsucker). */
function applyDamageLifegainRider(
  state: GameState,
  effect: Extract<GameEffect, { kind: "deal_damage" }>,
): GameState {
  if (!effect.gainLife || !effect.sourceId) {
    return state;
  }
  const controllerId = state.cards[effect.sourceId]?.controllerId;
  if (!controllerId) {
    return state;
  }
  return applyGainLife(state, controllerId, effect.amount);
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
    const lifeLoss: EngineEvent[] = [];
    for (const player of next.players) {
      if (!player.lost) {
        player.life -= effect.amount;
        next.log.push({ kind: "life_change", playerId: player.id, delta: -effect.amount });
        lifeLoss.push({ kind: "loses_life", playerId: player.id, amount: effect.amount });
      }
    }
    dispatchEventsInPlace(next, lifeLoss);
  }
  // Destruction is a state-based action; applyEffect sweeps the batch at once.
  return next;
}

/** Teferi's Ageless Insight: 2^n for n draw-doublers the player controls. */
function drawFactor(state: GameState, playerId: PlayerId): number {
  let factor = 1;
  for (const card of Object.values(state.cards)) {
    if (card.zone !== "battlefield" || card.controllerId !== playerId) {
      continue;
    }
    const doubles = (state.definitions[card.definitionId]?.replacements ?? []).filter(
      (replacement) => replacement.kind === "double_draws_except_first",
    ).length;
    if (doubles === 0 || abilitiesRemoved(state, card.id)) {
      continue;
    }
    factor *= 2 ** doubles;
  }
  return factor;
}

function applyDraw(
  state: GameState,
  playerId: PlayerId,
  count: number,
  optional?: boolean,
  turnDraw?: boolean,
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
  // Draw doubling replaces each draw with two; the turn-based first draw
  // of the controller's own draw step is exempt.
  const factor = drawFactor(state, playerId);
  const total = turnDraw ? 1 + (count - 1) * factor : count * factor;
  let next = cloneGameState(state);
  let drawn = 0;
  for (let i = 0; i < total; i += 1) {
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
  const controllerId = card.controllerId;
  const wasToken = Boolean(card.isToken);
  const next = moveCard(state, cardId, "graveyard");
  dispatchEventsInPlace(next, [{ kind: "sacrifices", cardId, controllerId, wasToken }]);
  return next;
}

/** Anointed Procession / Doubling Season: 2^n for n token doublers. */
export function tokenDoublingFactor(state: GameState, ownerId: PlayerId): number {
  let factor = 1;
  for (const card of Object.values(state.cards)) {
    if (card.zone !== "battlefield" || card.controllerId !== ownerId) {
      continue;
    }
    // Cheap definition check first — abilitiesRemoved runs a layer pass, so
    // only pay for it on actual doublers (burn-time hot path).
    const doubles = (state.definitions[card.definitionId]?.replacements ?? []).filter(
      (replacement) => replacement.kind === "double_tokens",
    ).length;
    if (doubles === 0 || abilitiesRemoved(state, card.id)) {
      continue;
    }
    factor *= 2 ** doubles;
  }
  return factor;
}

/** Doubling Season / Branching Evolution: 2^n for matching counter doublers. */
export function counterDoublingFactor(
  state: GameState,
  cardId: CardInstanceId,
  counter: string,
): number {
  const card = state.cards[cardId];
  if (!card || card.zone !== "battlefield") {
    return 1;
  }
  let factor = 1;
  for (const source of Object.values(state.cards)) {
    if (source.zone !== "battlefield" || source.controllerId !== card.controllerId) {
      continue;
    }
    // Cheap definition filter first; abilitiesRemoved (a layer pass) only
    // runs for actual doubler sources.
    const matching = (state.definitions[source.definitionId]?.replacements ?? []).filter(
      (replacement) =>
        replacement.kind === "double_counters" &&
        (!replacement.counter || replacement.counter === counter) &&
        (!replacement.creaturesOnly || isCreature(state, cardId)),
    ).length;
    if (matching === 0 || abilitiesRemoved(state, source.id)) {
      continue;
    }
    factor *= 2 ** matching;
  }
  return factor;
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
  card.counters[counter] =
    (card.counters[counter] ?? 0) + amount * counterDoublingFactor(next, cardId, counter);
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
  // A countered copy just ceases to exist — the source card belongs to the
  // original spell, which may still be on the stack (CR 707.10a).
  if (removed?.isCopy) {
    return next;
  }
  if (!removed?.sourceId || next.cards[removed.sourceId]?.zone !== "stack") {
    return next;
  }
  // A countered flashbacked card exiles instead (CR 702.34a).
  return enterOwnerZone(next, removed.sourceId, removed.fromGraveyard ? "exile" : "graveyard");
}

/**
 * Copy a spell on the stack (Fork / Reverberate / Dualcaster Mage). The copy
 * keeps the original's targets, modes, X, and damage division, but is
 * controlled by the copying player. Documented approximation: "You may choose
 * new targets for the copy" is auto-declined — keeping the original targets is
 * always a legal choice for that "may".
 */
function applyCopySpell(
  state: GameState,
  stackObjectId: StackObjectId,
  controllerId: PlayerId,
): GameState {
  const entry = state.stack.find((object) => object.id === stackObjectId);
  if (!entry || entry.kind !== "spell") {
    return state;
  }
  const next = cloneGameState(state);
  next.stack.push({
    id: createId("stack"),
    controllerId,
    sourceId: entry.sourceId,
    kind: "spell",
    targets: entry.targets.map((target) => ({ ...target })),
    ...(entry.modeIndex !== undefined ? { modeIndex: entry.modeIndex } : {}),
    ...(entry.modeIndexes ? { modeIndexes: [...entry.modeIndexes] } : {}),
    ...(entry.xValue !== undefined ? { xValue: entry.xValue } : {}),
    ...(entry.division ? { division: [...entry.division] } : {}),
    isCopy: true,
  });
  return next;
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
    ...(effect.keywords && effect.keywords.length > 0 ? { keywords: effect.keywords } : {}),
    ...(preset?.manaAbilities ? { manaAbilities: preset.manaAbilities } : {}),
    ...(preset?.activated ? { activated: preset.activated } : {}),
  });
  next.definitions[definition.id] = definition;
  const owner = next.players.find((player) => player.id === effect.ownerId);
  if (!owner) {
    throw new Error(`Unknown player ${effect.ownerId}`);
  }
  // Anointed Procession / Doubling Season (CR 614.1c): each doubler the
  // token's controller controls doubles the batch.
  const copies = (effect.count ?? 1) * tokenDoublingFactor(next, effect.ownerId);
  for (let index = 0; index < copies; index += 1) {
    const token = createCardInstance({
      definitionId: definition.id,
      ownerId: effect.ownerId,
      zone: "battlefield",
      isToken: true,
    });
    next.cards[token.id] = token;
    token.timestamp = next.nextTimestamp;
    next.nextTimestamp += 1;
    owner.zones.battlefield.push(token.id);
    if (countCardPlacements(next, token.id) !== 1) {
      throw new Error(`Token zone integrity failed for ${token.id}`);
    }
    queueEnterBattlefieldTriggersInPlace(next, token.id);
    dispatchEventsInPlace(next, [{ kind: "creates_token", playerId: effect.ownerId }]);
  }
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
    ...(effect.untapIfLands !== undefined ? { untapIfLands: effect.untapIfLands } : {}),
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
  opts?: {
    count?: number;
    gainsHaste?: boolean;
    atEndStep?: "sacrifice" | "exile";
    setPt?: { power: number; toughness: number };
  },
): GameState {
  requirePlayer(state, ownerId);
  const original = state.cards[ofCardId];
  // "stack" is allowed for Offspring: the copy is made as the spell resolves,
  // just before the original itself enters the battlefield.
  if (!original || (original.zone !== "battlefield" && original.zone !== "stack")) {
    throw new Error(`Card ${ofCardId} is not on the battlefield`);
  }
  const next = cloneGameState(state);
  let copyDefinitionId = original.definitionId;
  if (opts?.setPt) {
    // Offspring: the copy is 1/1 — a cloned definition with overridden base
    // power and toughness.
    const sourceDefinition = next.definitions[original.definitionId];
    if (sourceDefinition) {
      const overridden = JSON.parse(JSON.stringify(sourceDefinition)) as typeof sourceDefinition;
      overridden.id = createId("definition");
      overridden.power = opts.setPt.power;
      overridden.toughness = opts.setPt.toughness;
      next.definitions[overridden.id] = overridden;
      copyDefinitionId = overridden.id;
    }
  }
  const owner = next.players.find((player) => player.id === ownerId);
  if (!owner) {
    throw new Error(`Unknown player ${ownerId}`);
  }
  // Token copies are created tokens too — doublers apply (CR 614.1c).
  const copies = (opts?.count ?? 1) * tokenDoublingFactor(next, ownerId);
  for (let index = 0; index < copies; index += 1) {
    const token = createCardInstance({
      definitionId: copyDefinitionId,
      ownerId,
      zone: "battlefield",
      isToken: true,
    });
    token.timestamp = next.nextTimestamp;
    next.nextTimestamp += 1;
    next.cards[token.id] = token;
    if (opts?.gainsHaste) {
      token.summoningSick = false;
    }
    if (opts?.atEndStep) {
      next.delayedEndStep.push({ cardId: token.id, action: opts.atEndStep });
    }
    owner.zones.battlefield.push(token.id);
    queueEnterBattlefieldTriggersInPlace(next, token.id);
    dispatchEventsInPlace(next, [{ kind: "creates_token", playerId: ownerId }]);
  }
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
      card.counters[counter] =
        (card.counters[counter] ?? 0) + amount * counterDoublingFactor(next, card.id, counter);
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
    .filter((card) => {
      const manaValue = characteristicsOf(next, card.id).manaValue;
      return (
        (effect.maxManaValue === undefined || manaValue <= effect.maxManaValue) &&
        (effect.minManaValue === undefined || manaValue >= effect.minManaValue)
      );
    })
    .filter((card) => !hasKeyword(next, card.id, "indestructible"))
    .map((card) => card.id);
  const collectDies: EngineEvent[] = [];
  for (const cardId of doomed) {
    moveCardInPlace(next, cardId, "graveyard", { collectDies });
  }
  if (collectDies.length > 0) {
    dispatchEventsInPlace(next, collectDies);
    processDiesReturnsInPlace(next, collectDies);
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
        next = applyDraw(state, effect.playerId, effect.count, effect.optional, effect.turnDraw);
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
        const arrived = next.cards[effect.cardId];
        if (arrived?.zone === "battlefield") {
          if (effect.entersTapped) {
            arrived.tapped = true;
          }
          // "It gains haste": mechanically, no summoning sickness this turn.
          if (effect.gainsHaste) {
            arrived.summoningSick = false;
          }
          if (effect.atEndStep) {
            next.delayedEndStep.push({ cardId: effect.cardId, action: effect.atEndStep });
          }
        }
        break;
      }
      case "tap":
        next = tapCard(state, effect.cardId);
        break;
      case "untap": {
        const wasTapped = state.cards[effect.cardId]?.tapped === true;
        next = untapCard(state, effect.cardId);
        if (wasTapped) {
          dispatchEventsInPlace(next, [{ kind: "untapped", cardId: effect.cardId }]);
        }
        break;
      }
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
      case "copy_spell":
        next = applyCopySpell(state, effect.stackObjectId, effect.controllerId);
        break;
      case "extra_combat": {
        next = cloneGameState(state);
        next.pendingExtraCombats += 1;
        break;
      }
      case "fog": {
        next = cloneGameState(state);
        next.preventCombatDamage = true;
        break;
      }
      case "overload_each": {
        // Enumerate what the normal mode could have targeted, then run the
        // effects once per object; anything that left the battlefield mid-
        // sweep simply fails its per-object bind and is skipped.
        next = cloneGameState(state);
        const choices = legalChoicesForRequirement(next, effect.requirement, effect.controllerId);
        for (const choice of choices) {
          const bound = bindCardEffects(next, effect.effects, {
            controllerId: effect.controllerId,
            sourceId: effect.sourceId,
            targets: [choice],
            targetRequirements: [effect.requirement],
          });
          next = applyEffects(next, bound);
        }
        break;
      }
      case "dig_top": {
        // Impulse dig, with the pick auto-taken: the first filter match among
        // the looked cards goes to the destination (a documented
        // approximation — no picker prompt), the rest go to the bottom in
        // random order.
        next = cloneGameState(state);
        const digger = next.players.find((entry) => entry.id === effect.playerId);
        if (!digger) {
          throw new Error(`Unknown player ${effect.playerId}`);
        }
        const looked = digger.zones.library.slice(0, effect.count);
        const pickedId = looked.find((cardId) => searchMatches(next, cardId, effect.filter));
        if (pickedId) {
          moveCardInPlace(next, pickedId, effect.destination === "hand" ? "hand" : "battlefield");
          if (effect.destination === "battlefield_tapped") {
            const entered = next.cards[pickedId];
            if (entered && entered.zone === "battlefield") {
              entered.tapped = true;
            }
          }
        }
        const rest = looked.filter((cardId) => cardId !== pickedId);
        for (const cardId of rest) {
          moveCardInPlace(next, cardId, "library", { libraryPosition: "bottom" });
        }
        // "In a random order": shuffle the moved tail in place.
        const tail = digger.zones.library.splice(digger.zones.library.length - rest.length);
        shuffleInPlace(tail);
        digger.zones.library.push(...tail);
        break;
      }
      case "bounce_each_creature": {
        next = cloneGameState(state);
        const bounced = Object.values(next.cards)
          .filter(
            (card) =>
              card.zone === "battlefield" &&
              isCreature(next, card.id) &&
              (!effect.unlessCounter || (card.counters[effect.unlessCounter] ?? 0) === 0),
          )
          .map((card) => card.id);
        for (const cardId of bounced) {
          moveCardInPlace(next, cardId, "hand");
        }
        break;
      }
      case "counter_on_each_creature": {
        next = cloneGameState(state);
        for (const card of Object.values(next.cards)) {
          if (card.zone === "battlefield" && isCreature(next, card.id)) {
            card.counters[effect.counter] =
              (card.counters[effect.counter] ?? 0) +
              effect.amount * counterDoublingFactor(next, card.id, effect.counter);
          }
        }
        break;
      }
      case "windfall": {
        // Each player discards their hand, then draws the greatest count.
        next = cloneGameState(state);
        let greatest = 0;
        for (const player of livingPlayers(next)) {
          const hand = [...player.zones.hand];
          greatest = Math.max(greatest, hand.length);
          for (const cardId of hand) {
            moveCardInPlace(next, cardId, "graveyard");
          }
        }
        if (greatest > 0) {
          const drawerIds = livingPlayers(next).map((player) => player.id);
          for (const drawerId of drawerIds) {
            next = applyDraw(next, drawerId, greatest);
          }
        }
        break;
      }
      case "proliferate": {
        // Documented approximation (CR 702.24 is "choose any number"): the
        // proliferating player auto-picks every permanent they control that
        // has counters, skipping -1/-1 counters, opponents' permanents, and
        // players. Doublers apply per counter kind.
        next = cloneGameState(state);
        for (const card of Object.values(next.cards)) {
          if (card.zone !== "battlefield" || card.controllerId !== effect.playerId) {
            continue;
          }
          for (const counter of Object.keys(card.counters)) {
            if (counter === "m1m1" || (card.counters[counter] ?? 0) <= 0) {
              continue;
            }
            card.counters[counter] =
              (card.counters[counter] ?? 0) + counterDoublingFactor(next, card.id, counter);
          }
        }
        break;
      }
      case "untap_all": {
        next = cloneGameState(state);
        const untapped: EngineEvent[] = [];
        for (const card of Object.values(next.cards)) {
          if (
            card.zone === "battlefield" &&
            card.controllerId === effect.playerId &&
            (effect.what === "creature" ? isCreature(next, card.id) : isLand(next, card.id))
          ) {
            if (card.tapped) {
              untapped.push({ kind: "untapped", cardId: card.id });
            }
            card.tapped = false;
          }
        }
        dispatchEventsInPlace(next, untapped);
        break;
      }
      case "untap_lands_up_to": {
        // Documented auto-choice: untap the first N tapped lands you control.
        next = cloneGameState(state);
        let remaining = effect.count;
        const landsUntapped: EngineEvent[] = [];
        for (const card of Object.values(next.cards)) {
          if (remaining <= 0) {
            break;
          }
          if (
            card.zone === "battlefield" &&
            card.controllerId === effect.playerId &&
            card.tapped &&
            isLand(next, card.id)
          ) {
            card.tapped = false;
            landsUntapped.push({ kind: "untapped", cardId: card.id });
            remaining -= 1;
          }
        }
        dispatchEventsInPlace(next, landsUntapped);
        break;
      }
      case "set_class_level":
        next = applySetClassLevel(state, effect.cardId, effect.level);
        break;
      case "grant_dies_return": {
        next = cloneGameState(state);
        if (next.cards[effect.cardId]?.zone === "battlefield") {
          const grants = next.diesReturnUntilEot ?? [];
          grants.push({
            cardId: effect.cardId,
            ...(effect.counter ? { counter: true } : {}),
            ...(effect.treasure ? { treasure: true } : {}),
          });
          next.diesReturnUntilEot = grants;
        }
        break;
      }
      case "discard_unless_attacked":
        next = applyDiscardUnlessAttacked(state, effect.playerId, effect.count);
        break;
      case "pt_until_eot":
        next = applyPtUntilEot(state, effect.cardId, effect.power, effect.toughness);
        break;
      case "keyword_until_eot":
        next = applyKeywordUntilEot(state, effect.cardId, effect.keyword);
        break;
      case "restrict_until_eot":
        next = pushUntilEotEffect(state, [effect.cardId], {
          kind: "restrict",
          ...(effect.cantAttack ? { cantAttack: true } : {}),
          ...(effect.cantBlock ? { cantBlock: true } : {}),
          ...(effect.cantBeBlocked ? { cantBeBlocked: true } : {}),
        });
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
        next = applyCopyToken(state, effect.ownerId, effect.ofCardId, effect);
        break;
      case "exile_top_play": {
        // Impulse: the exiled cards stay castable/playable by the effect's
        // controller for the rest of the turn (costs paid as normal).
        next = cloneGameState(state);
        const impulsed = next.players.find((entry) => entry.id === effect.playerId);
        if (!impulsed) {
          throw new Error(`Unknown player ${effect.playerId}`);
        }
        const tops = impulsed.zones.library.slice(0, effect.count);
        for (const cardId of tops) {
          moveCardInPlace(next, cardId, "exile");
          const grants = next.exilePlayable ?? [];
          grants.push({
            cardId,
            casterId: effect.casterId,
            ...(effect.freeCast ? { freeCast: true } : {}),
          });
          next.exilePlayable = grants;
        }
        break;
      }
      case "populate": {
        // CR 701.35 is "choose a token you control" — auto-pick the highest
        // power creature token, a documented approximation like proliferate.
        const player = state.players.find((entry) => entry.id === effect.playerId);
        const tokens = (player?.zones.battlefield ?? []).filter((cardId) => {
          const card = state.cards[cardId];
          return (
            card &&
            card.isToken &&
            card.controllerId === effect.playerId &&
            isCreature(state, cardId)
          );
        });
        if (tokens.length === 0) {
          next = cloneGameState(state);
          break;
        }
        const best = tokens.reduce((leader, cardId) =>
          creaturePower(state, cardId) > creaturePower(state, leader) ? cardId : leader,
        );
        next = applyCopyToken(state, effect.playerId, best, {});
        break;
      }
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
