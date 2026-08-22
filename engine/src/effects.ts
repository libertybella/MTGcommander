import { abilitiesRemoved, cardMatchesSubtype, computedCard, dynamicCountOf } from "./characteristicsEngine";
import { cloneGameState } from "./clone";
import { createCardDefinition, createCardInstance } from "./createGame";
import { characteristicsOf, hasSubtype, isCreature, isInstantOrSorcery, isLand, isPlaneswalker } from "./cardTypes";
import { eliminatePlayerInPlace } from "./elimination";
import { createId } from "./ids";
import { allBattlefieldCreatureCount, creaturePower, creatureToughness, damageAfterReplacements, wouldSkipDraw } from "./derived";
import { hasKeyword, protectionColorsOf } from "./keywords";
import { addMana, tapCard, untapCard } from "./mana";
import { commanderIdentityColors } from "./manaOptions";
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
  ChosenOwnerRef,
  ChosenTarget,
  ChosenTargetRef,
  Color,
  ContinuousEffectData,
  EngineEvent,
  GameEffect,
  GameState,
  Keyword,
  LookDestination,
  ManaPool,
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
      if (!chosen) {
        return null;
      }
      // A chosen spell's controller (An Offer You Can't Refuse).
      if (chosen.type === "spell") {
        return (
          state.stack.find((entry) => entry.id === chosen.stackObjectId)?.controllerId ?? null
        );
      }
      if (chosen.type !== "creature") {
        return null;
      }
      return state.cards[chosen.cardId]?.controllerId ?? null;
    }
    if (selector.type === "chosen_owner") {
      const chosen = chosenTargetAt(context, selector.index, state);
      if (!chosen || chosen.type !== "creature") {
        return null;
      }
      return state.cards[chosen.cardId]?.ownerId ?? null;
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
  selector: Exclude<
    PlayerSelector,
    ChosenTargetRef | ChosenControllerRef | ChosenOwnerRef | SubjectPlayerRef
  >,
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

/** CR 700.5: colored pips of the color among the player's permanents' mana
 * costs (a hybrid symbol counts toward each of its colors once). */
/**
 * "Choose a creature type" on a resolving spell, auto-picked as the type most
 * common among the caster's creatures (ties break alphabetically, changelings
 * are not counted) — a documented approximation like populate's auto-pick.
 */
export function mostCommonControlledCreatureType(
  state: GameState,
  playerId: PlayerId,
): string | null {
  const tally = new Map<string, number>();
  for (const card of Object.values(state.cards)) {
    if (
      card.zone !== "battlefield" ||
      card.controllerId !== playerId ||
      !isCreature(state, card.id)
    ) {
      continue;
    }
    const computed = computedCard(state, card.id);
    if (computed?.allCreatureTypes) {
      continue;
    }
    for (const subtype of computed?.characteristics.subtypes ?? []) {
      tally.set(subtype, (tally.get(subtype) ?? 0) + 1);
    }
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [subtype, count] of [...tally.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (count > bestCount) {
      best = subtype;
      bestCount = count;
    }
  }
  return best;
}

export function devotionTo(state: GameState, playerId: PlayerId, color: Color): number {
  let pips = 0;
  for (const card of Object.values(state.cards)) {
    if (card.zone !== "battlefield" || card.controllerId !== playerId) {
      continue;
    }
    const manaCost = state.definitions[card.definitionId]?.manaCost ?? "";
    for (const symbol of manaCost.matchAll(/\{([^}]+)\}/g)) {
      if (symbol[1]!.toUpperCase().split("/").includes(color)) {
        pips += 1;
      }
    }
  }
  return pips;
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
    effect.kind === "team_pt_until_eot" ||
    effect.kind === "exile_top_play" ||
    // Soul-Guide Lantern: "Exile each opponent's graveyard" is one clause but
    // one exile per player.
    effect.kind === "exile_graveyard" ||
    effect.kind === "search_library"
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
    // Freed from the Real: the aura's host ("enchanted creature").
    if (selector === "host") {
      const source = context.sourceId ? state.cards[context.sourceId] : undefined;
      return source?.attachedTo ?? null;
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
            : effect.amount === "target_mana_value"
              ? (() => {
                  // Reanimate: "life equal to that card's mana value".
                  const chosen = chosenTargetAt(context, 0, state);
                  // Imp's Mischief: the target may be a spell on the stack.
                  if (chosen?.type === "spell") {
                    const entry = state.stack.find((object) => object.id === chosen.stackObjectId);
                    const card = entry?.sourceId ? state.cards[entry.sourceId] : undefined;
                    return card
                      ? state.definitions[card.definitionId]?.characteristics.manaValue ?? 0
                      : 0;
                  }
                  return chosen?.type === "creature"
                    ? characteristicsOf(state, chosen.cardId).manaValue
                    : 0;
                })()
              : effect.amount === "target_power"
                ? (() => {
                    // Swords to Plowshares: power read before the exile.
                    const chosen = chosenTargetAt(context, 0, state);
                    return chosen?.type === "creature"
                      ? creaturePower(state, chosen.cardId)
                      : 0;
                  })()
                : effect.amount;
      if (amount <= 0) {
        return null;
      }
      // Venser's Journal: scale by whatever the shared count table names.
      if (effect.kind === "gain_life" && effect.perDynamicCount) {
        const count = dynamicCountOf(state, context.controllerId, effect.perDynamicCount, context.sourceId ?? undefined);
        if (count === 0) {
          return null;
        }
        return { kind: effect.kind, playerId, amount: amount * count };
      }
      // Aetherflux Reservoir: scale by the controller's casts this turn.
      if (effect.kind === "gain_life" && effect.perSpellsCastThisTurn) {
        const casts = state.spellsCastByPlayerThisTurn?.[context.controllerId] ?? 0;
        if (casts === 0) {
          return null;
        }
        return { kind: effect.kind, playerId, amount: amount * casts };
      }
      // Shamanic Revelation's ferocious rider: scale by matching creatures.
      if (effect.kind === "gain_life" && effect.perControlledCreature) {
        const minPower = effect.perControlledCreature.minPower ?? 0;
        const matching = Object.values(state.cards).filter(
          (card) =>
            card.zone === "battlefield" &&
            card.controllerId === context.controllerId &&
            isCreature(state, card.id) &&
            creaturePower(state, card.id) >= minPower,
        ).length;
        if (matching === 0) {
          return null;
        }
        return { kind: effect.kind, playerId, amount: amount * matching };
      }
      return { kind: effect.kind, playerId, amount };
    }
    case "draw": {
      const playerId = bindPlayerSelector(state, effect.playerId, context);
      if (!playerId) {
        return null;
      }
      const { countFromGreatestPower, countPerControlled, countFromChosenTypePermanents, perDynamicCount, ...drawRest } = effect;
      // Inspiring Call: one card per whatever the shared count table names.
      if (perDynamicCount) {
        const scaled = dynamicCountOf(state, context.controllerId, perDynamicCount, context.sourceId ?? undefined) * (typeof effect.count === "number" ? effect.count : 1);
        if (scaled === 0) {
          return null;
        }
        return { ...drawRest, playerId, count: scaled };
      }
      // Blue Sun's Zenith: the announced X.
      if (effect.count === "x") {
        return { ...drawRest, playerId, count: Math.max(0, context.xValue ?? 0) };
      }
      // Greater Good: the count is the sacrificed cost-creature's power.
      if (effect.count === "sacrificed_power") {
        const count = Math.max(0, context.sacrificedPower ?? 0);
        if (count === 0) {
          return null;
        }
        return { ...drawRest, playerId, count };
      }
      if (countFromChosenTypePermanents) {
        // Distant Melody: "for each permanent you control of that type" —
        // the type is auto-chosen at bind (most common among the caster's
        // creatures), a documented approximation.
        const chosen = mostCommonControlledCreatureType(state, context.controllerId);
        if (!chosen) {
          return null;
        }
        const count = Object.values(state.cards).filter(
          (card) =>
            card.zone === "battlefield" &&
            card.controllerId === context.controllerId &&
            cardMatchesSubtype(state, card.id, chosen),
        ).length;
        if (count === 0) {
          return null;
        }
        return { ...drawRest, playerId, count };
      }
      if (countPerControlled) {
        // Shamanic Revelation: one card per controlled creature at bind.
        const count = Object.values(state.cards).filter(
          (card) =>
            card.zone === "battlefield" &&
            card.controllerId === context.controllerId &&
            isCreature(state, card.id),
        ).length;
        if (count === 0) {
          return null;
        }
        return { ...drawRest, playerId, count };
      }
      if (!countFromGreatestPower) {
        return { ...drawRest, playerId, count: effect.count as number };
      }
      // "the greatest power among … creatures you control", read when the
      // effect binds (spell resolution).
      const exclude = countFromGreatestPower.nonSubtypes ?? [];
      let greatest = 0;
      for (const card of Object.values(state.cards)) {
        if (
          card.zone !== "battlefield" ||
          card.controllerId !== context.controllerId ||
          !isCreature(state, card.id) ||
          exclude.some((subtype) => cardMatchesSubtype(state, card.id, subtype))
        ) {
          continue;
        }
        greatest = Math.max(greatest, creaturePower(state, card.id));
      }
      if (greatest <= 0) {
        return null;
      }
      return { ...drawRest, playerId, count: greatest };
    }
    case "add_mana": {
      const playerId = bindPlayerSelector(state, effect.playerId, context);
      if (!playerId) {
        return null;
      }
      const { perChosenPlayerHand, anyColor, ...manaRest } = effect;
      // "Add one mana of any color": auto-pick the first commander-identity
      // color, else {G} — a documented approximation of the free choice.
      if (anyColor) {
        const color = commanderIdentityColors(state, playerId)[0] ?? "G";
        return { ...manaRest, playerId, mana: { [color]: anyColor } };
      }
      if (!perChosenPlayerHand) {
        return { ...manaRest, playerId };
      }
      // Jeska's Will: "{R} for each card in target opponent's hand".
      const chosen = chosenTargetAt(context, 0, state);
      if (!chosen || chosen.type !== "player") {
        return null;
      }
      const handSize =
        state.players.find((entry) => entry.id === chosen.playerId)?.zones.hand.length ?? 0;
      if (handSize === 0) {
        return null;
      }
      const mana: Partial<ManaPool> = {};
      for (const [color, amount] of Object.entries(effect.mana)) {
        if (typeof amount === "number" && amount > 0) {
          mana[color as keyof ManaPool] = amount * handSize;
        }
      }
      return { ...manaRest, playerId, mana };
    }
    case "mill": {
      const playerId = bindPlayerSelector(state, effect.playerId, context);
      if (!playerId) {
        return null;
      }
      // Altar of Dementia: the sacrificed cost-creature's power, captured
      // on activation.
      const count =
        effect.count === "sacrificed_power" ? context.sacrificedPower ?? 0 : effect.count;
      if (count <= 0) {
        return null;
      }
      return { kind: "mill", playerId, count };
    }
    case "discard":
    case "discard_random":
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
        ...(effect.cantDiscards ? { cantDiscards: effect.cantDiscards } : {}),
      };
    }
    case "deal_damage": {
      // Ram Through: a chosen creature is the source and its power the amount.
      const chosenSource =
        effect.sourceId !== null && typeof effect.sourceId === "object"
          ? chosenTargetAt(context, effect.sourceId.index, state)
          : null;
      if (effect.sourceId !== null && typeof effect.sourceId === "object") {
        if (!chosenSource || chosenSource.type !== "creature") {
          return null;
        }
      }
      const boundSourceId =
        chosenSource?.type === "creature"
          ? chosenSource.cardId
          : bindSourceId(effect.sourceId as CardInstanceId | "self" | null, context);
      const amount =
        effect.amount === "x"
          ? context.xValue ?? 0
          : effect.amount === "sacrificed_power"
            ? context.sacrificedPower ?? 0
            : effect.amount === "chosen_power"
              ? boundSourceId
                ? Math.max(0, creaturePower(state, boundSourceId))
                : 0
              : effect.amount === "subject_power"
                ? context.subjectCardId
                  ? Math.max(0, creaturePower(state, context.subjectCardId))
                  : 0
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
          sourceId: boundSourceId,
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
          sourceId: boundSourceId,
          target: { type: "player", playerId },
          ...(effect.gainLife ? { gainLife: true } : {}),
        };
      }
      return {
        kind: "deal_damage",
        amount,
        sourceId: boundSourceId,
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
      const {
        perControlled,
        perControlledSubtype,
        perDiedCreatures,
        perSourceCounters,
        copySelfIfLandsAtLeast,
        countFromSubjectAmount,
        count: printedCount,
        ...tokenRest
      } = effect;
      // Scute Swarm: at six lands the token becomes a copy of the source.
      if (copySelfIfLandsAtLeast && context.sourceId) {
        const lands = Object.values(state.cards).filter(
          (card) =>
            card.zone === "battlefield" &&
            card.controllerId === context.controllerId &&
            characteristicsOf(state, card.id).types.includes("land"),
        ).length;
        if (lands >= copySelfIfLandsAtLeast) {
          return { kind: "copy_token", ownerId, ofCardId: context.sourceId };
        }
      }
      // Secure the Wastes: "Create X … tokens" reads the announced X. An X of
      // zero makes no tokens rather than one.
      let count: number | undefined =
        printedCount === "x" ? Math.max(0, context.xValue ?? 0) : printedCount;
      if (count === 0) {
        return null;
      }
      // Krenko: "where X is the number of Goblins you control".
      if (perControlledSubtype) {
        count = Object.values(state.cards).filter(
          (card) =>
            card.zone === "battlefield" &&
            card.controllerId === context.controllerId &&
            cardMatchesSubtype(state, card.id, perControlledSubtype),
        ).length;
        if (count === 0) {
          return null;
        }
      }
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
      if (countFromSubjectAmount) {
        // Elenda: "X is its power", carried on the dies event.
        count = Math.max(0, context.subjectAmount ?? 0);
        if (count === 0) {
          return null;
        }
      }
      return {
        ...tokenRest,
        ownerId,
        ...(count !== undefined ? { count } : {}),
        ...(perSourceCounters && context.sourceId
          ? { countFromCounters: { cardId: context.sourceId, counter: perSourceCounters } }
          : {}),
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
        ...(effect.underControlOf === "controller"
          ? { controllerId: context.controllerId }
          : {}),
      };
    }
    case "tap":
    case "untap":
    case "tap_or_untap": {
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
      // Halana and Alena: X reads the source's power at bind.
      // The Ozolith: "subject_amount" is the leave event's counter total.
      const amount =
        effect.amount === "source_power"
          ? context.sourceId
            ? Math.max(0, creaturePower(state, context.sourceId))
            : 0
          : effect.amount === "subject_amount"
            ? Math.max(0, context.subjectAmount ?? 0)
            : effect.amount;
      if (amount <= 0) {
        return null;
      }
      return { kind: "add_counter", cardId, counter: effect.counter, amount };
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
      // "Double target creature's power": +P/+0 where P reads at bind.
      const power =
        effect.power === "target_power"
          ? Math.max(0, creaturePower(state, cardId))
          : effect.power;
      return { kind: "pt_until_eot", cardId, power, toughness: effect.toughness };
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
      // Craterhoof Behemoth: X = controlled creatures, read at bind.
      const teamCount =
        effect.power === "creature_count" || effect.toughness === "creature_count"
          ? Object.values(state.cards).filter(
              (card) =>
                card.zone === "battlefield" &&
                card.controllerId === context.controllerId &&
                isCreature(state, card.id),
            ).length
          : 0;
      return {
        kind: "team_pt_until_eot",
        playerId,
        power: effect.power === "creature_count" ? teamCount : effect.power,
        toughness: effect.toughness === "creature_count" ? teamCount : effect.toughness,
        ...(effect.nonSubtypes ? { nonSubtypes: [...effect.nonSubtypes] } : {}),
        ...(effect.minPower !== undefined ? { minPower: effect.minPower } : {}),
      };
    }
    case "team_keyword_until_eot": {
      const playerId = bindPlayerSelector(state, effect.playerId, context);
      if (!playerId) {
        return null;
      }
      return {
        kind: "team_keyword_until_eot",
        playerId,
        keyword: effect.keyword,
        ...(effect.scope ? { scope: effect.scope } : {}),
        ...(effect.nonSubtypes ? { nonSubtypes: [...effect.nonSubtypes] } : {}),
        ...(effect.minPower !== undefined ? { minPower: effect.minPower } : {}),
      };
    }
    case "team_protection_until_eot": {
      const playerId = bindPlayerSelector(state, effect.playerId, context);
      if (!playerId) {
        return null;
      }
      return { kind: "team_protection_until_eot", playerId, colors: [...effect.colors] };
    }
    case "all_pt_until_eot": {
      const power = effect.power === "-x" ? -(context.xValue ?? 0) : effect.power;
      const toughness = effect.toughness === "-x" ? -(context.xValue ?? 0) : effect.toughness;
      if (power === 0 && toughness === 0) {
        return null;
      }
      const spared = effect.exceptChosenType
        ? mostCommonControlledCreatureType(state, context.controllerId)
        : null;
      return {
        kind: "all_pt_until_eot",
        power,
        toughness,
        ...(spared ? { exceptSubtype: spared } : {}),
      };
    }
    case "reveal_top_put_permanent": {
      const playerId = bindPlayerSelector(state, effect.playerId, context);
      if (!playerId) {
        return null;
      }
      return { kind: "reveal_top_put_permanent", playerId };
    }
    case "silence": {
      const playerId = bindPlayerSelector(state, effect.playerId, context);
      if (!playerId) {
        return null;
      }
      return { kind: "silence", playerId };
    }
    case "silence_noncreature": {
      const playerId = bindPlayerSelector(state, effect.playerId, context);
      if (!playerId) {
        return null;
      }
      return { kind: "silence_noncreature", playerId };
    }
    case "each_creature_damages_controller":
      return { kind: "each_creature_damages_controller", amount: effect.amount };
    case "double_team_pt_until_eot": {
      const playerId = bindPlayerSelector(state, effect.playerId, context);
      if (!playerId) {
        return null;
      }
      return { kind: "double_team_pt_until_eot", playerId };
    }
    case "power_nova": {
      const chosen = chosenTargetAt(context, effect.cardId.index, state);
      if (!chosen || chosen.type !== "creature") {
        return null;
      }
      const amount = creaturePower(state, chosen.cardId);
      if (amount <= 0) {
        return null;
      }
      return { kind: "power_nova", sourceId: chosen.cardId, amount };
    }
    case "retarget": {
      const chosen = chosenTargetAt(context, effect.target.index, state);
      if (!chosen || chosen.type !== "spell") {
        return null;
      }
      return {
        kind: "retarget",
        stackObjectId: chosen.stackObjectId,
        controllerId: context.controllerId,
      };
    }
    case "mass_reanimate": {
      const playerId = bindPlayerSelector(state, effect.playerId, context);
      if (!playerId) {
        return null;
      }
      return { kind: "mass_reanimate", playerId };
    }
    case "return_all_lands": {
      const playerId = bindPlayerSelector(state, effect.playerId, context);
      if (!playerId) {
        return null;
      }
      return { kind: "return_all_lands", playerId };
    }
    case "prevent_combat_for": {
      const chosen = chosenTargetAt(context, effect.cardId.index, state);
      if (!chosen || chosen.type !== "creature") {
        return null;
      }
      return { kind: "prevent_combat_for", cardId: chosen.cardId };
    }
    case "extra_land_drop": {
      const playerId = bindPlayerSelector(state, effect.playerId, context);
      if (!playerId) {
        return null;
      }
      return { kind: "extra_land_drop", playerId };
    }
    case "grant_flash_this_turn":
    case "win_game": {
      const playerId = bindPlayerSelector(state, effect.playerId, context);
      if (!playerId) {
        return null;
      }
      return { kind: effect.kind, playerId };
    }
    case "grant_free_cast_from_hand": {
      const playerId = bindPlayerSelector(state, effect.playerId, context);
      if (!playerId) {
        return null;
      }
      // Electrodominance: "mana value X or less" reads the announced X.
      const cap =
        effect.maxManaValue === "x" ? context.xValue ?? 0 : effect.maxManaValue;
      return {
        kind: "grant_free_cast_from_hand",
        playerId,
        ...(cap !== undefined ? { maxManaValue: cap } : {}),
        count: effect.count,
      };
    }
    case "commander_to_hand": {
      const playerId = bindPlayerSelector(state, effect.playerId, context);
      if (!playerId) {
        return null;
      }
      return { kind: "commander_to_hand", playerId };
    }
    case "opponents_lose_keywords_until_eot":
      return {
        kind: "opponents_lose_keywords_until_eot",
        playerId: context.controllerId,
        keywords: [...effect.keywords],
      };
    case "drain_opponents": {
      const playerId = bindPlayerSelector(state, effect.playerId, context);
      if (!playerId) {
        return null;
      }
      const amount =
        effect.amount === "x"
          ? context.xValue ?? 0
          : typeof effect.amount === "object"
            ? devotionTo(state, context.controllerId, effect.amount.devotion)
            : effect.amount;
      if (amount <= 0) {
        return null;
      }
      return { kind: "drain_opponents", playerId, amount };
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
        // Traverse the Outlands: X = greatest power, read at bind.
        count: effect.countFromGreatestPower
          ? Math.max(
              0,
              ...Object.values(state.cards)
                .filter(
                  (card) =>
                    card.zone === "battlefield" &&
                    card.controllerId === context.controllerId &&
                    isCreature(state, card.id),
                )
                .map((card) => creaturePower(state, card.id)),
            )
          : effect.count,
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
      // Ouroboroid: X reads the source's power at bind.
      const amount =
        effect.amount === "source_power"
          ? context.sourceId
            ? Math.max(0, creaturePower(state, context.sourceId))
            : 0
          : effect.amount;
      if (amount <= 0) {
        return null;
      }
      return {
        kind: "counter_on_controlled_creatures",
        playerId,
        counter: effect.counter,
        amount,
      };
    }
    case "destroy_all": {
      // Kindred Dominance: "aren't of the chosen type" — the type is
      // auto-chosen at bind (the caster's most common creature type).
      const spared = effect.exceptChosenType
        ? mostCommonControlledCreatureType(state, context.controllerId)
        : null;
      // Culling Ritual: pick the mana color from the options — first
      // commander-identity match, else the first listed (documented).
      const manaOptions = effect.addManaPerDestroyedOptions;
      const identity = manaOptions ? commanderIdentityColors(state, context.controllerId) : [];
      const manaColor = manaOptions
        ? manaOptions.find((color) => identity.includes(color)) ?? manaOptions[0]
        : undefined;
      // Fell the Mighty: "power greater than target creature's power" — the
      // bar is read from the chosen target, so a sweep with no legal target
      // does nothing rather than everything.
      let minPower = effect.minPower;
      if (effect.minPowerAboveTarget !== undefined) {
        const targetId = bindCardId(
          state,
          { type: "chosen", index: effect.minPowerAboveTarget },
          context,
        );
        if (!targetId) {
          return null;
        }
        minPower = creaturePower(state, targetId) + 1;
      }
      return {
        kind: "destroy_all",
        what: effect.what,
        ...(effect.typesAny ? { typesAny: [...effect.typesAny] } : {}),
        ...(effect.tapState ? { tapState: effect.tapState } : {}),
        ...(effect.withoutCounters ? { withoutCounters: true } : {}),
        ...(effect.notEnchanted ? { notEnchanted: true } : {}),
        ...(effect.notLegendary ? { notLegendary: true } : {}),
        ...(effect.toZone ? { toZone: effect.toZone } : {}),
        ...(effect.maxManaValue !== undefined ? { maxManaValue: effect.maxManaValue } : {}),
        ...(effect.minManaValue !== undefined ? { minManaValue: effect.minManaValue } : {}),
        ...(minPower !== undefined ? { minPower } : {}),
        // A printed "non-Dragon" spares that subtype; Kindred Dominance's
        // auto-chosen type takes precedence when both are somehow present.
        ...(spared ?? effect.exceptSubtype
          ? { exceptSubtype: spared ?? effect.exceptSubtype }
          : {}),
        ...(effect.onlySubtype ? { onlySubtype: effect.onlySubtype } : {}),
        ...(effect.opponentsOnly ? { opponentsOf: context.controllerId } : {}),
        ...(manaColor ? { addManaPerDestroyed: manaColor, manaTo: context.controllerId } : {}),
      };
    }
    case "unless_pays": {
      const playerId = bindPlayerSelector(state, effect.playerId, context);
      if (!playerId) {
        return null;
      }
      // Esper Sentinel: "{X}, where X is this creature's power", read at bind.
      const cost =
        effect.costFromPower && context.sourceId
          ? `{${Math.max(0, creaturePower(state, context.sourceId))}}`
          : effect.cost;
      return {
        kind: "unless_pays",
        playerId,
        cost,
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
    case "return_self_as_enchantment": {
      const cardId = bindCardId(state, effect.cardId, context);
      if (!cardId) {
        return null;
      }
      return { kind: "return_self_as_enchantment", cardId };
    }
    case "create_emblem": {
      const ownerId = bindPlayerSelector(state, effect.ownerId, context);
      if (!ownerId) {
        return null;
      }
      return {
        kind: "create_emblem",
        ownerId,
        statics: effect.statics.map((entry) => ({
          selector: { ...entry.selector },
          effect: { ...entry.effect },
        })),
      };
    }
    case "roll_die_treasures": {
      const playerId = bindPlayerSelector(state, effect.playerId, context);
      if (!playerId) {
        return null;
      }
      return { kind: "roll_die_treasures", playerId, sides: effect.sides };
    }
    case "germ_attach": {
      const cardId = bindCardId(state, effect.cardId, context);
      if (!cardId) {
        return null;
      }
      return { kind: "germ_attach", cardId };
    }
    case "exile_graveyard": {
      const playerId = bindPlayerSelector(state, effect.playerId, context);
      if (!playerId) {
        return null;
      }
      return { kind: "exile_graveyard", playerId };
    }
    case "grant_protection_choice": {
      const chosen = chosenTargetAt(context, effect.target.index, state);
      if (!chosen || chosen.type !== "creature") {
        return null;
      }
      return {
        kind: "grant_protection_choice",
        cardId: chosen.cardId,
        playerId: context.controllerId,
      };
    }
    case "fight": {
      const cardId = bindCardId(state, effect.cardId, context);
      const chosen = chosenTargetAt(context, effect.withTarget.index, state);
      if (!cardId || !chosen || chosen.type !== "creature") {
        return null;
      }
      return { kind: "fight", cardId, otherId: chosen.cardId };
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
    case "bounce_spell_or_permanent": {
      const chosen = chosenTargetAt(context, effect.target.index, state);
      if (!chosen || chosen.type === "player") {
        return null;
      }
      return chosen.type === "spell"
        ? { kind: "bounce_spell_or_permanent", stackObjectId: chosen.stackObjectId }
        : { kind: "bounce_spell_or_permanent", cardId: chosen.cardId };
    }
    case "exchange_life_toughness": {
      const playerId = bindPlayerSelector(state, effect.playerId, context);
      if (!playerId || !context.sourceId) {
        return null;
      }
      return { kind: "exchange_life_toughness", playerId, sourceId: context.sourceId };
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
      return { kind: "windfall", ...(effect.drawCount ? { drawCount: effect.drawCount } : {}) };
    case "exile_top": {
      const playerId = bindPlayerSelector(state, effect.playerId, context);
      if (!playerId) {
        return null;
      }
      return { kind: "exile_top", playerId, count: effect.count };
    }
    case "exile_top_to_hand": {
      const playerId = bindPlayerSelector(state, effect.playerId, context);
      if (!playerId) {
        return null;
      }
      return { kind: "exile_top_to_hand", playerId };
    }
    case "living_death":
      return { kind: "living_death" };
    case "may_sacrifice":
      return {
        kind: "may_sacrifice",
        controllerId: context.controllerId,
        what: effect.what,
        effects: bindCardEffects(state, effect.effects, context),
      };
    case "exile_targets_into_tokens": {
      // Curse of the Swine: every chosen creature target.
      const cardIds = (context.targets ?? [])
        .filter((target): target is Extract<ChosenTarget, { type: "creature" }> => target.type === "creature")
        .map((target) => target.cardId);
      if (cardIds.length === 0) {
        return null;
      }
      return { kind: "exile_targets_into_tokens", cardIds, token: { ...effect.token } };
    }
    case "move_all_counters": {
      const fromId = bindCardId(state, effect.cardId, context);
      const chosen = chosenTargetAt(context, effect.target.index, state);
      if (!fromId || !chosen || chosen.type !== "creature") {
        return null;
      }
      return { kind: "move_all_counters", fromId, toId: chosen.cardId };
    }
    case "copy_each_token": {
      const playerId = bindPlayerSelector(state, effect.playerId, context);
      if (!playerId) {
        return null;
      }
      return { kind: "copy_each_token", playerId };
    }
    case "bounce_each_creature": {
      const spared = effect.exceptChosenType
        ? mostCommonControlledCreatureType(state, context.controllerId)
        : null;
      return {
        kind: "bounce_each_creature",
        ...(effect.unlessCounter ? { unlessCounter: effect.unlessCounter } : {}),
        ...(effect.onlyAttacking ? { onlyAttacking: true } : {}),
        ...(spared ? { exceptSubtype: spared } : {}),
      };
    }
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
        ...(effect.restTo ? { restTo: effect.restTo } : {}),
      };
    }
    case "counter_on_each_creature": {
      const amount = effect.amount === "x" ? context.xValue ?? 0 : effect.amount;
      if (amount <= 0) {
        return null;
      }
      return {
        kind: "counter_on_each_creature",
        counter: effect.counter,
        amount,
        ...(effect.subtype ? { subtype: effect.subtype } : {}),
        ...(effect.controlledOnly ? { controllerId: context.controllerId } : {}),
      };
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
        ...(effect.untilEndOfNextTurn ? { untilEndOfNextTurn: true } : {}),
      };
    }
    case "exile_return_end_step": {
      const chosen = chosenTargetAt(context, effect.target.index, state);
      if (!chosen || chosen.type !== "creature") {
        return null;
      }
      // Parting Gust returns the exiled card to its OWNER, not the caster.
      const returnTo = effect.toOwner
        ? state.cards[chosen.cardId]?.ownerId ?? context.controllerId
        : context.controllerId;
      return {
        kind: "exile_return_end_step",
        cardId: chosen.cardId,
        controllerId: returnTo,
        ...(effect.withCounter ? { withCounter: effect.withCounter } : {}),
      };
    }
    case "adapt": {
      const cardId = bindCardId(state, effect.cardId, context);
      if (!cardId) {
        return null;
      }
      return { kind: "adapt", cardId, amount: effect.amount };
    }
    case "exile_return_end_step_all": {
      // Eerie Interlude: every chosen creature target.
      const cardIds = (context.targets ?? [])
        .filter((target): target is Extract<ChosenTarget, { type: "creature" }> => target.type === "creature")
        .map((target) => target.cardId);
      if (cardIds.length === 0) {
        return null;
      }
      return { kind: "exile_return_end_step_all", cardIds };
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
    case "attackers_gain_keyword_until_eot":
      return { kind: "attackers_gain_keyword_until_eot", keyword: effect.keyword };
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
    // Fiery Emancipation et al: CR 616 replacements modify the amount.
    const dealt = damageAfterReplacements(
      state,
      effect.sourceId,
      effect.target.playerId,
      effect.amount,
    );
    let next = applyLoseLife(state, effect.target.playerId, dealt);
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
  if (
    card.zone !== "battlefield" ||
    (!isCreature(state, card.id) && !isPlaneswalker(state, card.id))
  ) {
    throw new Error(`Card ${card.id} is not a creature on the battlefield`);
  }

  // Protection prevents damage from sources of the protected colors.
  const protection = protectionColorsOf(state, card.id);
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
  const dealt = damageAfterReplacements(next, effect.sourceId, damaged.controllerId, effect.amount);
  // CR 120.3c: damage to a planeswalker removes that many loyalty counters
  // (a creature-planeswalker takes both — CR 120.3d).
  if (isPlaneswalker(next, damaged.id)) {
    damaged.counters["loyalty"] = Math.max(0, (damaged.counters["loyalty"] ?? 0) - dealt);
    if (!isCreature(next, damaged.id)) {
      return applyDamageLifegainRider(next, effect);
    }
  }
  damaged.damageMarked += dealt;
  if (effect.sourceId && hasKeyword(next, effect.sourceId, "deathtouch")) {
    damaged.deathtouched = true;
  }
  // Enrage (Apex Altisaur) hears every marked point of noncombat damage.
  if (dealt > 0) {
    dispatchEventsInPlace(next, [{ kind: "damaged", cardId: damaged.id }]);
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
    const protection = protectionColorsOf(next, card.id);
    if (protection.length > 0 && protection.some((color) => sourceColors.includes(color))) {
      continue;
    }
    card.damageMarked += damageAfterReplacements(
      next,
      effect.sourceId,
      card.controllerId,
      effect.amount,
    );
    if (deathtouch) {
      card.deathtouched = true;
    }
  }
  if (effect.includePlayers) {
    const lifeLoss: EngineEvent[] = [];
    for (const player of next.players) {
      if (!player.lost) {
        const dealt = damageAfterReplacements(next, effect.sourceId, player.id, effect.amount);
        player.life -= dealt;
        next.log.push({ kind: "life_change", playerId: player.id, delta: -dealt });
        lifeLoss.push({ kind: "loses_life", playerId: player.id, amount: dealt });
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
      // Laboratory Maniac: the empty draw becomes a win instead of a loss.
      const maniac = Object.values(next.cards).some(
        (card) =>
          card.zone === "battlefield" &&
          card.controllerId === playerId &&
          (next.definitions[card.definitionId]?.replacements ?? []).some(
            (replacement) => replacement.kind === "empty_draw_wins",
          ) &&
          !abilitiesRemoved(next, card.id),
      );
      if (maniac) {
        // "You win the game": every other player loses (CR 104.2a).
        for (const other of next.players) {
          if (other.id !== playerId && !other.lost) {
            eliminatePlayerInPlace(next, other.id);
          }
        }
        break;
      }
      current.failedToDraw = true;
      break;
    }
    next = moveCard(next, top, "hand");
    drawn += 1;
  }
  if (drawn > 0) {
    // Faerie Mastermind: tally per-player draws for second-draw heads; each
    // draw dispatches with its tally already bumped.
    const tally = next.drawsByPlayerThisTurn ?? {};
    for (let i = 0; i < drawn; i += 1) {
      tally[playerId] = (tally[playerId] ?? 0) + 1;
      next.drawsByPlayerThisTurn = tally;
      dispatchEventsInPlace(next, [{ kind: "draws", playerId }]);
    }
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
    dispatchEventsInPlace(next, [{ kind: "discards", cardId: first, playerId }]);
  }
  return next;
}

/** Gamble: "discard a card at random" (tests mock Math.random). */
function applyDiscardRandom(state: GameState, playerId: PlayerId, count: number): GameState {
  requirePositiveInteger(count, "discard count");
  requirePlayer(state, playerId);
  let next = state;
  for (let i = 0; i < count; i += 1) {
    const hand = next.players.find((entry) => entry.id === playerId)?.zones.hand ?? [];
    const picked = hand[Math.floor(Math.random() * hand.length)];
    if (!picked) {
      return next === state ? cloneGameState(state) : next;
    }
    next = moveCard(next, picked, "graveyard");
    dispatchEventsInPlace(next, [{ kind: "discards", cardId: picked, playerId }]);
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

/** Hardened Scales-family: flat +N added to each counter batch. */
function counterBonusAmount(state: GameState, cardId: CardInstanceId, counter: string): number {
  const card = state.cards[cardId];
  if (!card || card.zone !== "battlefield") {
    return 0;
  }
  let bonus = 0;
  for (const source of Object.values(state.cards)) {
    if (source.zone !== "battlefield" || source.controllerId !== card.controllerId) {
      continue;
    }
    const matching = (state.definitions[source.definitionId]?.replacements ?? []).filter(
      (replacement) =>
        replacement.kind === "bonus_counters" &&
        (!replacement.counter || replacement.counter === counter) &&
        (!replacement.creaturesOnly || isCreature(state, cardId)),
    ).length;
    if (matching === 0 || abilitiesRemoved(state, source.id)) {
      continue;
    }
    bonus += matching;
  }
  return bonus;
}

/** One counter batch: (amount + bonuses) × doublers — the controller's
 * optimal CR 616.1 ordering. */
export function counterBatchAmount(
  state: GameState,
  cardId: CardInstanceId,
  counter: string,
  amount: number,
): number {
  return (
    (amount + counterBonusAmount(state, cardId, counter)) *
    counterDoublingFactor(state, cardId, counter)
  );
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
    (card.counters[counter] ?? 0) + counterBatchAmount(next, cardId, counter, amount);
  // Fathom Mage: effect-driven placements notify counter_added watchers.
  // (Counters arriving through enter-with-counters setups do not — a
  // documented approximation.)
  if (card.zone === "battlefield") {
    dispatchEventsInPlace(next, [{ kind: "counter_added", cardId, counter }]);
  }
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
  if (card && state.definitions[card.definitionId]?.cantBeCountered) {
    return true;
  }
  // Rhythm of the Wild: the spell's controller has a "creature spells you
  // control can't be countered" permanent.
  if (card && characteristicsOf(state, card.id).types.includes("creature")) {
    return Object.values(state.cards).some(
      (source) =>
        source.zone === "battlefield" &&
        source.controllerId === entry.controllerId &&
        state.definitions[source.definitionId]?.creatureSpellsCantBeCountered === true &&
        !abilitiesRemoved(state, source.id),
    );
  }
  return false;
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
  // Magecraft: "cast or copy" triggers see the copy too.
  if (entry.sourceId) {
    dispatchEventsInPlace(next, [
      { kind: "copies_spell", cardId: entry.sourceId, controllerId },
    ]);
  }
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
    ...(preset?.changeling ? { changeling: true } : {}),
  });
  next.definitions[definition.id] = definition;
  const owner = next.players.find((player) => player.id === effect.ownerId);
  if (!owner) {
    throw new Error(`Unknown player ${effect.ownerId}`);
  }
  // Anointed Procession / Doubling Season (CR 614.1c): each doubler the
  // token's controller controls doubles the batch. Anim Pakal counts the
  // source's counters here, after earlier effects in the batch applied.
  const counterCount = effect.countFromCounters
    ? next.cards[effect.countFromCounters.cardId]?.counters[effect.countFromCounters.counter] ?? 0
    : undefined;
  if (counterCount === 0) {
    return next;
  }
  const copies = (counterCount ?? effect.count ?? 1) * tokenDoublingFactor(next, effect.ownerId);
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
    // "Tapped and attacking": join the ongoing combat against the first
    // declared defender (a documented approximation of the attack choice).
    if (effect.entersTappedAttacking && next.combat?.attackersDeclared) {
      const defenderId = next.combat.attacks[0]?.defenderId;
      if (defenderId) {
        token.tapped = true;
        token.attacking = true;
        token.summoningSick = false;
        next.combat.attacks.push({ attackerId: token.id, defenderId });
      }
    }
    // "a tapped 1/1 blue Fish" (the gift mechanic).
    if (effect.entersTapped) {
      token.tapped = true;
    }
    // Mobilize: the tokens clean themselves up at the next end step.
    if (effect.atEndStep) {
      next.delayedEndStep.push({ cardId: token.id, action: effect.atEndStep });
    }
    queueEnterBattlefieldTriggersInPlace(next, token.id);
    // Idol of Oblivion: remember who made a token this turn.
    const creators = next.createdTokenThisTurn ?? [];
    if (!creators.includes(effect.ownerId)) {
      creators.push(effect.ownerId);
    }
    next.createdTokenThisTurn = creators;
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

/** Mother of Runes: applied from the choose_color prompt's answer. */
export function grantProtectionUntilEot(
  state: GameState,
  cardId: CardInstanceId,
  color: Color,
): GameState {
  return pushUntilEotEffect(state, [cardId], { kind: "grant_protection", colors: [color] });
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

function teamMembers(
  state: GameState,
  playerId: PlayerId,
  options: { scope?: "permanents"; nonSubtypes?: string[]; minPower?: number },
): CardInstanceId[] {
  return Object.values(state.cards)
    .filter(
      (card) =>
        card.zone === "battlefield" &&
        card.controllerId === playerId &&
        (options.scope === "permanents" || isCreature(state, card.id)) &&
        !(options.nonSubtypes ?? []).some((subtype) =>
          cardMatchesSubtype(state, card.id, subtype),
        ) &&
        // Goreclaw: "each creature you control with power 4 or greater".
        (options.minPower === undefined || creaturePower(state, card.id) >= options.minPower),
    )
    .map((card) => card.id);
}

function applyTeamPtUntilEot(
  state: GameState,
  playerId: PlayerId,
  power: number,
  toughness: number,
  nonSubtypes?: string[],
  minPower?: number,
): GameState {
  requirePlayer(state, playerId);
  // CR 611.2c: the affected set locks in when the effect is created.
  const team = teamMembers(state, playerId, { nonSubtypes, minPower });
  if (team.length === 0) {
    return state;
  }
  return pushUntilEotEffect(state, team, { kind: "modify_pt", power, toughness });
}

function applyTeamKeywordUntilEot(
  state: GameState,
  playerId: PlayerId,
  keyword: Keyword,
  options: { scope?: "permanents"; nonSubtypes?: string[]; minPower?: number } = {},
): GameState {
  requirePlayer(state, playerId);
  // CR 611.2c: the affected set locks in when the effect is created.
  const team = teamMembers(state, playerId, options);
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
        (card.counters[counter] ?? 0) + counterBatchAmount(next, card.id, counter, amount);
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
    // Nevinyrral's Disk: a list of types, any of which qualifies.
    if (effect.typesAny && effect.typesAny.length > 0) {
      const types = characteristicsOf(next, cardId).types;
      return effect.typesAny.some((type) =>
        type === "creature" ? isCreature(next, cardId) : types.includes(type),
      );
    }
    if (what === "creatures") {
      return isCreature(next, cardId);
    }
    if (what === "nonland") {
      // Emblems are not permanents (CR 114) — mass removal spares them.
      return !isLand(next, cardId) && !characteristicsOf(next, cardId).types.includes("emblem");
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
    // Ruinous Ultimatum: the caster's own board is spared.
    .filter((card) => !effect.opponentsOf || card.controllerId !== effect.opponentsOf)
    .filter((card) => {
      const manaValue = characteristicsOf(next, card.id).manaValue;
      return (
        (effect.maxManaValue === undefined || manaValue <= effect.maxManaValue) &&
        (effect.minManaValue === undefined || manaValue >= effect.minManaValue)
      );
    })
    .filter(
      (card) => !effect.exceptSubtype || !cardMatchesSubtype(next, card.id, effect.exceptSubtype),
    )
    // Crux of Fate's first mode: the sweep is narrowed TO a subtype rather
    // than sparing one.
    .filter(
      (card) => !effect.onlySubtype || cardMatchesSubtype(next, card.id, effect.onlySubtype),
    )
    .filter(
      (card) => effect.minPower === undefined || creaturePower(next, card.id) >= effect.minPower,
    )
    // Split Up: only one half of the board.
    .filter(
      (card) =>
        effect.tapState === undefined || card.tapped === (effect.tapState === "tapped"),
    )
    // Damning Verdict: "with no counters on them" — any kind of counter saves it.
    .filter(
      (card) =>
        !effect.withoutCounters ||
        Object.values(card.counters).every((count) => count === 0),
    )
    // Winds of Rath: an Aura attached to it saves it.
    .filter(
      (card) =>
        !effect.notEnchanted ||
        !Object.values(next.cards).some(
          (aura) =>
            aura.zone === "battlefield" &&
            aura.attachedTo === card.id &&
            characteristicsOf(next, aura.id).types.includes("enchantment"),
        ),
    )
    .filter(
      (card) =>
        !effect.notLegendary || !characteristicsOf(next, card.id).supertypes.includes("legendary"),
    )
    // Exiling sweeps are not "destroy", so indestructible does not save.
    .filter((card) => effect.toZone === "exile" || !hasKeyword(next, card.id, "indestructible"))
    .map((card) => card.id);
  const collectDies: EngineEvent[] = [];
  for (const cardId of doomed) {
    moveCardInPlace(next, cardId, effect.toZone ?? "graveyard", { collectDies });
  }
  if (collectDies.length > 0) {
    dispatchEventsInPlace(next, collectDies);
    processDiesReturnsInPlace(next, collectDies);
  }
  // Culling Ritual: one mana per permanent the sweep destroyed.
  if (effect.addManaPerDestroyed && effect.manaTo && doomed.length > 0) {
    return addMana(next, effect.manaTo, { [effect.addManaPerDestroyed]: doomed.length });
  }
  return next;
}

function applyChooseCardEffect(
  state: GameState,
  effect: Extract<GameEffect, { kind: "choose_card" }>,
): GameState {
  const legal = legalIdsForChooseSources(state, effect.sources);
  if (legal.length === 0) {
    // Plaguecrafter: "Each player who can't discards a card" — the discard
    // is still that player's choice.
    if (effect.cantDiscards && effect.cantDiscards > 0) {
      const hand = state.players.find((entry) => entry.id === effect.chooserId)?.zones.hand ?? [];
      const count = Math.min(effect.cantDiscards, hand.length);
      if (count > 0) {
        const withPrompt = cloneGameState(state);
        withPrompt.prompts.push({ kind: "choose_discard", playerId: effect.chooserId, count });
        return withPrompt;
      }
    }
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
          // Reanimate: "onto the battlefield under your control" — the card
          // sits in its owner's zone list, but the caster controls it.
          if (effect.controllerId && next.players.some((p) => p.id === effect.controllerId)) {
            arrived.controllerId = effect.controllerId;
          }
        }
        break;
      }
      case "tap":
        next = tapCard(state, effect.cardId);
        break;
      case "tap_or_untap": {
        // "You may tap or untap": toggling is always the useful half — a
        // documented approximation of the choice.
        const toggled = state.cards[effect.cardId];
        if (!toggled || toggled.zone !== "battlefield") {
          next = cloneGameState(state);
          break;
        }
        if (toggled.tapped) {
          next = untapCard(state, effect.cardId);
          dispatchEventsInPlace(next, [{ kind: "untapped", cardId: effect.cardId }]);
        } else {
          next = tapCard(state, effect.cardId);
          dispatchEventsInPlace(next, [{ kind: "tapped", cardId: effect.cardId }]);
        }
        break;
      }
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
      case "discard_random":
        next = applyDiscardRandom(state, effect.playerId, effect.count);
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
      case "bounce_spell_or_permanent": {
        if (effect.cardId) {
          const bounced = state.cards[effect.cardId];
          next =
            bounced && bounced.zone === "battlefield"
              ? moveCard(state, effect.cardId, "hand")
              : cloneGameState(state);
          break;
        }
        // A spell leaves the stack for its owner's hand instead of resolving.
        next = cloneGameState(state);
        const index = next.stack.findIndex((entry) => entry.id === effect.stackObjectId);
        if (index === -1) {
          break;
        }
        const [removed] = next.stack.splice(index, 1);
        if (removed?.isCopy || !removed?.sourceId) {
          break;
        }
        if (next.cards[removed.sourceId]?.zone === "stack") {
          next = enterOwnerZone(next, removed.sourceId, "hand");
        }
        break;
      }
      case "exchange_life_toughness": {
        // Tree of Perdition: the swap is a real gain/loss on the player's
        // side, and the source's base toughness becomes the old life total
        // via a cloned definition (the Offspring pattern).
        const player = state.players.find((entry) => entry.id === effect.playerId);
        const source = state.cards[effect.sourceId];
        if (!player || !source || source.zone !== "battlefield") {
          next = cloneGameState(state);
          break;
        }
        const toughness = creatureToughness(state, effect.sourceId);
        const oldLife = player.life;
        next = state;
        if (toughness > oldLife) {
          next = applyGainLife(next, effect.playerId, toughness - oldLife);
        } else if (toughness < oldLife) {
          next = applyLoseLife(next, effect.playerId, oldLife - toughness);
        } else {
          next = cloneGameState(next);
        }
        const treeCard = next.cards[effect.sourceId];
        const sourceDefinition = treeCard ? next.definitions[treeCard.definitionId] : undefined;
        if (treeCard && sourceDefinition) {
          const overridden = JSON.parse(JSON.stringify(sourceDefinition)) as typeof sourceDefinition;
          overridden.id = createId("definition");
          overridden.toughness = oldLife;
          next.definitions[overridden.id] = overridden;
          treeCard.definitionId = overridden.id;
        }
        break;
      }
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
        if (effect.restTo === "graveyard") {
          // Grisly Salvage: "Put the rest into your graveyard."
          for (const cardId of rest) {
            moveCardInPlace(next, cardId, "graveyard");
          }
          break;
        }
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
              (!effect.onlyAttacking || card.attacking) &&
              (!effect.unlessCounter || (card.counters[effect.unlessCounter] ?? 0) === 0) &&
              (!effect.exceptSubtype ||
                !cardMatchesSubtype(next, card.id, effect.exceptSubtype)),
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
          if (card.zone !== "battlefield" || !isCreature(next, card.id)) {
            continue;
          }
          if (effect.controllerId && card.controllerId !== effect.controllerId) {
            continue;
          }
          if (effect.subtype && !cardMatchesSubtype(next, card.id, effect.subtype)) {
            continue;
          }
          card.counters[effect.counter] =
            (card.counters[effect.counter] ?? 0) +
            counterBatchAmount(next, card.id, effect.counter, effect.amount);
        }
        break;
      }
      case "prevent_combat_for": {
        next = cloneGameState(state);
        const shieldedIds = next.preventCombatFor ?? [];
        if (!shieldedIds.includes(effect.cardId)) {
          shieldedIds.push(effect.cardId);
        }
        next.preventCombatFor = shieldedIds;
        break;
      }
      case "extra_land_drop": {
        requirePlayer(state, effect.playerId);
        next = cloneGameState(state);
        const granted = next.players.find((entry) => entry.id === effect.playerId)!;
        granted.extraLandDropsThisTurn = (granted.extraLandDropsThisTurn ?? 0) + 1;
        break;
      }
      case "grant_flash_this_turn": {
        requirePlayer(state, effect.playerId);
        next = cloneGameState(state);
        if (!(next.flashThisTurn ?? []).includes(effect.playerId)) {
          next.flashThisTurn = [...(next.flashThisTurn ?? []), effect.playerId];
        }
        break;
      }
      case "grant_free_cast_from_hand": {
        requirePlayer(state, effect.playerId);
        next = cloneGameState(state);
        next.freeCastFromHand = [
          ...(next.freeCastFromHand ?? []),
          {
            casterId: effect.playerId,
            ...(effect.maxManaValue !== undefined ? { maxManaValue: effect.maxManaValue } : {}),
            remaining: effect.count,
          },
        ];
        break;
      }
      case "win_game": {
        // CR 104.2a: winning is expressed as everyone else losing, which is
        // the same shape Laboratory Maniac already uses.
        requirePlayer(state, effect.playerId);
        next = cloneGameState(state);
        for (const other of next.players) {
          if (other.id !== effect.playerId && !other.lost) {
            eliminatePlayerInPlace(next, other.id);
          }
        }
        break;
      }
      case "fight": {
        // CR 701.12: both powers read first, both damages marked at once.
        const a = state.cards[effect.cardId];
        const b = state.cards[effect.otherId];
        next = cloneGameState(state);
        if (
          a &&
          b &&
          a.zone === "battlefield" &&
          b.zone === "battlefield" &&
          isCreature(state, a.id) &&
          isCreature(state, b.id)
        ) {
          const powerA = Math.max(0, creaturePower(state, a.id));
          const powerB = Math.max(0, creaturePower(state, b.id));
          const colorsA = sourceColorsOf(state, a.id);
          const colorsB = sourceColorsOf(state, b.id);
          const shieldedA = protectionColorsOf(state, a.id).some((color) =>
            colorsB.includes(color),
          );
          const shieldedB = protectionColorsOf(state, b.id).some((color) =>
            colorsA.includes(color),
          );
          const fighterA = next.cards[a.id]!;
          const fighterB = next.cards[b.id]!;
          const events: EngineEvent[] = [];
          if (!shieldedB && powerA > 0) {
            fighterB.damageMarked += powerA;
            if (hasKeyword(next, a.id, "deathtouch")) {
              fighterB.deathtouched = true;
            }
            events.push({ kind: "damaged", cardId: b.id });
          }
          if (!shieldedA && powerB > 0) {
            fighterA.damageMarked += powerB;
            if (hasKeyword(next, b.id, "deathtouch")) {
              fighterA.deathtouched = true;
            }
            events.push({ kind: "damaged", cardId: a.id });
          }
          if (events.length > 0) {
            dispatchEventsInPlace(next, events);
          }
        }
        break;
      }
      case "grant_protection_choice": {
        // Mother of Runes: the color is chosen when the ability resolves.
        const shielded = state.cards[effect.cardId];
        next = cloneGameState(state);
        if (shielded && shielded.zone === "battlefield") {
          next.prompts.push({
            kind: "choose_color",
            playerId: effect.playerId,
            sourceId: effect.cardId,
            grantProtectionTo: effect.cardId,
          });
        }
        break;
      }
      case "opponents_lose_keywords_until_eot": {
        // Shadowspear: every permanent under every opponent, locked in now.
        requirePlayer(state, effect.playerId);
        const struck = Object.values(state.cards)
          .filter(
            (card) =>
              card.zone === "battlefield" && card.controllerId !== effect.playerId,
          )
          .map((card) => card.id);
        next =
          struck.length === 0
            ? cloneGameState(state)
            : pushUntilEotEffect(state, struck, {
                kind: "remove_keywords",
                keywords: [...effect.keywords],
              });
        break;
      }
      case "commander_to_hand": {
        // Command Beacon: the commander leaves the command zone for the hand.
        const beaconOwner = requirePlayer(state, effect.playerId);
        const commanderId = beaconOwner.commander.commanderIds.find((id) =>
          beaconOwner.zones.command.includes(id),
        );
        if (!commanderId) {
          next = cloneGameState(state);
          break;
        }
        next = cloneGameState(state);
        moveCardInPlace(next, commanderId, "hand");
        break;
      }
      case "mass_reanimate": {
        // Rise of the Dark Realms: every creature card in every graveyard
        // arrives under the effect's controller.
        requirePlayer(state, effect.playerId);
        next = cloneGameState(state);
        for (const player of next.players) {
          for (const cardId of [...player.zones.graveyard]) {
            if (!characteristicsOf(next, cardId).types.includes("creature")) {
              continue;
            }
            moveCardInPlace(next, cardId, "battlefield");
            const arrived = next.cards[cardId];
            if (arrived?.zone === "battlefield") {
              arrived.controllerId = effect.playerId;
            }
          }
        }
        break;
      }
      case "return_all_lands": {
        // Splendid Reclamation: only the effect's controller's own graveyard,
        // and everything arrives tapped.
        requirePlayer(state, effect.playerId);
        next = cloneGameState(state);
        const owner = next.players.find((entry) => entry.id === effect.playerId);
        for (const cardId of [...(owner?.zones.graveyard ?? [])]) {
          if (!characteristicsOf(next, cardId).types.includes("land")) {
            continue;
          }
          moveCardInPlace(next, cardId, "battlefield");
          const arrived = next.cards[cardId];
          if (arrived?.zone === "battlefield") {
            arrived.tapped = true;
          }
        }
        break;
      }
      case "retarget": {
        // Deflecting Swat: the retargeter picks replacement targets via a
        // prompt; the spell's own requirements bound the choices.
        const entry = state.stack.find((object) => object.id === effect.stackObjectId);
        if (!entry || entry.kind !== "spell" || !entry.sourceId) {
          next = cloneGameState(state);
          break;
        }
        const spellCard = state.cards[entry.sourceId];
        const spellDefinition = spellCard ? state.definitions[spellCard.definitionId] : undefined;
        const requirements =
          entry.modeIndexes && entry.modeIndexes.length > 0 && spellDefinition?.modes
            ? entry.modeIndexes.flatMap(
                (index) => spellDefinition.modes![index]?.targetRequirements ?? [],
              )
            : entry.modeIndex !== undefined && spellDefinition?.modes?.[entry.modeIndex]
              ? spellDefinition.modes[entry.modeIndex]!.targetRequirements
              : spellDefinition?.targetRequirements ?? [];
        next = cloneGameState(state);
        if (requirements.length === 0) {
          break;
        }
        next.prompts.push({
          kind: "choose_targets",
          playerId: effect.controllerId,
          sourceId: entry.sourceId,
          origin: "retarget",
          stackObjectId: entry.id,
          requirements: requirements.map((requirement) => ({ ...requirement })),
        });
        break;
      }
      case "power_nova": {
        // Chandra's Ignition: the source hits every OTHER creature and each
        // opponent of its controller for its power (protection applies).
        requirePositiveInteger(effect.amount, "damage");
        next = cloneGameState(state);
        const novaSource = next.cards[effect.sourceId];
        const novaColors = sourceColorsOf(next, effect.sourceId);
        const novaDeathtouch = hasKeyword(next, effect.sourceId, "deathtouch");
        for (const card of Object.values(next.cards)) {
          if (
            card.id === effect.sourceId ||
            card.zone !== "battlefield" ||
            !isCreature(next, card.id)
          ) {
            continue;
          }
          const protection = protectionColorsOf(next, card.id);
          if (protection.some((color) => novaColors.includes(color))) {
            continue;
          }
          card.damageMarked += effect.amount;
          if (novaDeathtouch) {
            card.deathtouched = true;
          }
        }
        for (const player of next.players) {
          if (player.lost || player.id === novaSource?.controllerId) {
            continue;
          }
          player.life -= effect.amount;
          next.log.push({ kind: "life_change", playerId: player.id, delta: -effect.amount });
          dispatchEventsInPlace(next, [
            { kind: "deals_damage_to_player", cardId: effect.sourceId, playerId: player.id },
          ]);
        }
        break;
      }
      case "double_team_pt_until_eot": {
        requirePlayer(state, effect.playerId);
        // Doubling is additive: +current power/+current toughness until EOT,
        // read per creature when the effect resolves (CR 611.2c lock-in).
        next = state;
        const doubled = Object.values(state.cards).filter(
          (card) =>
            card.zone === "battlefield" &&
            card.controllerId === effect.playerId &&
            isCreature(state, card.id),
        );
        for (const card of doubled) {
          const computed = computedCard(next, card.id);
          const power = computed?.power ?? 0;
          const toughness = computed?.toughness ?? 0;
          if (power === 0 && toughness === 0) {
            continue;
          }
          next = pushUntilEotEffect(next, [card.id], {
            kind: "modify_pt",
            power,
            toughness,
          });
        }
        if (next === state) {
          next = cloneGameState(state);
        }
        break;
      }
      case "each_creature_damages_controller": {
        requirePositiveInteger(effect.amount, "damage");
        next = cloneGameState(state);
        for (const card of Object.values(next.cards)) {
          if (card.zone !== "battlefield" || !isCreature(next, card.id)) {
            continue;
          }
          const controller = next.players.find((entry) => entry.id === card.controllerId);
          if (controller && !controller.lost) {
            controller.life -= effect.amount;
            next.log.push({
              kind: "life_change",
              playerId: controller.id,
              delta: -effect.amount,
            });
          }
        }
        break;
      }
      case "windfall": {
        // Each player discards their hand, then draws the greatest count —
        // or the fixed drawCount (Wheel of Fortune's seven).
        next = cloneGameState(state);
        let greatest = 0;
        for (const player of livingPlayers(next)) {
          const hand = [...player.zones.hand];
          greatest = Math.max(greatest, hand.length);
          for (const cardId of hand) {
            moveCardInPlace(next, cardId, "graveyard");
            // Waste Not rides the wheel.
            dispatchEventsInPlace(next, [{ kind: "discards", cardId, playerId: player.id }]);
          }
        }
        const refill = effect.drawCount ?? greatest;
        if (refill > 0) {
          const drawerIds = livingPlayers(next).map((player) => player.id);
          for (const drawerId of drawerIds) {
            next = applyDraw(next, drawerId, refill);
          }
        }
        break;
      }
      case "exile_top": {
        next = cloneGameState(state);
        for (let i = 0; i < effect.count; i += 1) {
          const top = next.players.find((entry) => entry.id === effect.playerId)?.zones.library[0];
          if (!top) {
            break;
          }
          next = moveCard(next, top, "exile");
        }
        break;
      }
      case "exile_top_to_hand": {
        // Necropotence: the exiled card reaches its owner's hand at the next
        // end step (face-down and "your next end step" are documented
        // approximations).
        const top = state.players.find((entry) => entry.id === effect.playerId)?.zones.library[0];
        if (!top) {
          next = cloneGameState(state);
          break;
        }
        next = moveCard(state, top, "exile");
        if (next.cards[top]?.zone === "exile") {
          next.delayedEndStep.push({ cardId: top, action: "hand" });
        }
        break;
      }
      case "move_all_counters": {
        // The Ozolith: every counter kind hops to the target at once.
        const from = state.cards[effect.fromId];
        const to = state.cards[effect.toId];
        if (!from || !to || to.zone !== "battlefield") {
          next = cloneGameState(state);
          break;
        }
        next = cloneGameState(state);
        const moving = next.cards[effect.fromId]!;
        const receiving = next.cards[effect.toId]!;
        for (const [name, count] of Object.entries(moving.counters)) {
          if (typeof count === "number" && count > 0) {
            receiving.counters[name] = (receiving.counters[name] ?? 0) + count;
          }
        }
        moving.counters = {};
        break;
      }
      case "may_sacrifice": {
        // Springbloom Druid: auto-taken with the first controlled land —
        // both the take and the pick are documented approximations.
        const fodder = state.players
          .find((entry) => entry.id === effect.controllerId)
          ?.zones.battlefield.find((cardId) => isLand(state, cardId));
        if (!fodder) {
          next = cloneGameState(state);
          break;
        }
        next = applyEffect(state, { kind: "sacrifice", cardId: fodder });
        next = applyEffects(next, effect.effects);
        break;
      }
      case "exile_targets_into_tokens": {
        // Curse of the Swine: capture each controller before the exile.
        next = cloneGameState(state);
        for (const cardId of effect.cardIds) {
          const victim = next.cards[cardId];
          if (!victim || victim.zone !== "battlefield") {
            continue;
          }
          const owner = victim.controllerId;
          next = moveCard(next, cardId, "exile");
          next = applyCreateToken(next, {
            kind: "create_token",
            ownerId: owner,
            name: effect.token.name,
            typeLine: effect.token.typeLine,
            power: effect.token.power,
            toughness: effect.token.toughness,
          });
        }
        break;
      }
      case "living_death": {
        // Living Death: snapshot everyone's graveyard creatures, sacrifice
        // every creature on the battlefield, then mass-return the snapshot.
        next = cloneGameState(state);
        const returning: CardInstanceId[] = [];
        for (const player of livingPlayers(next)) {
          for (const cardId of [...player.zones.graveyard]) {
            if (isCreature(next, cardId)) {
              next = moveCard(next, cardId, "exile");
              returning.push(cardId);
            }
          }
        }
        const dying = Object.values(next.cards)
          .filter((card) => card.zone === "battlefield" && isCreature(next, card.id))
          .map((card) => card.id);
        for (const cardId of dying) {
          next = applyEffect(next, { kind: "sacrifice", cardId });
        }
        for (const cardId of returning) {
          if (next.cards[cardId]?.zone === "exile") {
            next = moveCard(next, cardId, "battlefield");
          }
        }
        break;
      }
      case "copy_each_token": {
        // Second Harvest: snapshot first — the copies must not copy copies.
        const tokens = Object.values(state.cards).filter(
          (card) =>
            card.zone === "battlefield" && card.controllerId === effect.playerId && card.isToken,
        );
        next = cloneGameState(state);
        for (const token of tokens) {
          next = applyCopyToken(next, effect.playerId, token.id);
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
              (card.counters[counter] ?? 0) + counterBatchAmount(next, card.id, counter, 1);
          }
        }
        break;
      }
      case "attackers_gain_keyword_until_eot": {
        // Karlach: "They gain first strike until end of turn."
        const attackerIds = (state.combat?.attacks ?? []).map((attack) => attack.attackerId);
        next =
          attackerIds.length === 0
            ? cloneGameState(state)
            : pushUntilEotEffect(state, attackerIds, {
                kind: "grant_keyword",
                keyword: effect.keyword,
              });
        break;
      }
      case "untap_all": {
        next = cloneGameState(state);
        const untapped: EngineEvent[] = [];
        // Karlach: "untap all attacking creatures" — anyone's attackers.
        const attackingIds =
          effect.what === "attacking"
            ? new Set((next.combat?.attacks ?? []).map((attack) => attack.attackerId))
            : null;
        for (const card of Object.values(next.cards)) {
          if (
            card.zone === "battlefield" &&
            (attackingIds
              ? attackingIds.has(card.id)
              : card.controllerId === effect.playerId &&
                (effect.what === "creature"
                  ? isCreature(next, card.id)
                  : effect.what === "nonland"
                    ? !isLand(next, card.id)
                    : isLand(next, card.id)))
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
        next = applyTeamPtUntilEot(
          state,
          effect.playerId,
          effect.power,
          effect.toughness,
          effect.nonSubtypes,
          effect.minPower,
        );
        break;
      case "team_keyword_until_eot":
        next = applyTeamKeywordUntilEot(state, effect.playerId, effect.keyword, {
          scope: effect.scope,
          nonSubtypes: effect.nonSubtypes,
          minPower: effect.minPower,
        });
        break;
      case "team_protection_until_eot": {
        requirePlayer(state, effect.playerId);
        // CR 611.2c: the affected set locks in when the effect is created.
        const team = teamMembers(state, effect.playerId, {});
        next =
          team.length === 0
            ? state
            : pushUntilEotEffect(state, team, {
                kind: "grant_protection",
                colors: [...effect.colors],
              });
        break;
      }
      case "all_pt_until_eot": {
        // CR 611.2c: every creature on the battlefield, all players.
        const everyone = Object.values(state.cards)
          .filter((card) => card.zone === "battlefield" && isCreature(state, card.id))
          .filter(
            (card) =>
              !effect.exceptSubtype || !cardMatchesSubtype(state, card.id, effect.exceptSubtype),
          )
          .map((card) => card.id);
        next =
          everyone.length === 0
            ? state
            : pushUntilEotEffect(state, everyone, {
                kind: "modify_pt",
                power: effect.power,
                toughness: effect.toughness,
              });
        break;
      }
      case "reveal_top_put_permanent": {
        // Chaos Warp's back half: a revealed permanent card lands; anything
        // else stays on top, revealed.
        const revealer = requirePlayer(state, effect.playerId);
        const topId = revealer.zones.library[0];
        if (!topId) {
          next = state;
          break;
        }
        next = cloneGameState(state);
        next.log.push({ kind: "zone_change", cardId: topId, from: "library", to: "library" });
        const types = characteristicsOf(next, topId).types;
        if (!types.includes("instant") && !types.includes("sorcery")) {
          moveCardInPlace(next, topId, "battlefield");
        }
        break;
      }
      case "silence": {
        requirePlayer(state, effect.playerId);
        next = cloneGameState(state);
        next.castLockUntilEot = effect.playerId;
        break;
      }
      case "silence_noncreature": {
        requirePlayer(state, effect.playerId);
        next = cloneGameState(state);
        next.noncreatureCastLockUntilEot = effect.playerId;
        break;
      }
      case "drain_opponents": {
        requirePlayer(state, effect.playerId);
        next = state;
        let drained = 0;
        for (const player of state.players) {
          if (player.id === effect.playerId || player.lost) {
            continue;
          }
          next = applyLoseLife(next, player.id, effect.amount);
          drained += effect.amount;
        }
        if (drained > 0) {
          next = applyGainLife(next, effect.playerId, drained);
        } else if (next === state) {
          next = cloneGameState(state);
        }
        break;
      }
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
        // Atsushi: "until the end of your next turn" — the grant survives
        // cleanups until the caster's own cleanup has run this many times.
        const remainingOwnCleanups = effect.untilEndOfNextTurn
          ? effect.casterId === state.turn.activePlayerId
            ? 2
            : 1
          : undefined;
        for (const cardId of tops) {
          moveCardInPlace(next, cardId, "exile");
          const grants = next.exilePlayable ?? [];
          grants.push({
            cardId,
            casterId: effect.casterId,
            ...(effect.freeCast ? { freeCast: true } : {}),
            ...(remainingOwnCleanups !== undefined ? { remainingOwnCleanups } : {}),
          });
          next.exilePlayable = grants;
        }
        break;
      }
      case "exile_return_end_step": {
        const exiled = state.cards[effect.cardId];
        if (!exiled || exiled.zone !== "battlefield") {
          next = cloneGameState(state);
          break;
        }
        next = moveCard(state, effect.cardId, "exile");
        if (next.cards[effect.cardId]?.zone === "exile") {
          next.delayedEndStep.push({
            cardId: effect.cardId,
            action: "battlefield",
            controllerId: effect.controllerId,
            ...(effect.withCounter ? { withCounter: effect.withCounter } : {}),
          });
        }
        break;
      }
      case "adapt": {
        // CR 701.46: only a counterless creature adapts.
        const adapter = state.cards[effect.cardId];
        if (!adapter || adapter.zone !== "battlefield" || (adapter.counters["p1p1"] ?? 0) > 0) {
          next = cloneGameState(state);
          break;
        }
        next = applyAddCounter(state, effect.cardId, "p1p1", effect.amount);
        break;
      }
      case "exile_return_end_step_all": {
        next = cloneGameState(state);
        for (const flickerId of effect.cardIds) {
          const blinked = next.cards[flickerId];
          if (!blinked || blinked.zone !== "battlefield") {
            continue;
          }
          next = moveCard(next, flickerId, "exile");
          if (next.cards[flickerId]?.zone === "exile") {
            next.delayedEndStep.push({
              cardId: flickerId,
              action: "battlefield",
              // Eerie Interlude: home to the owner, not the caster.
              controllerId: next.cards[flickerId]!.ownerId,
            });
          }
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
      case "return_self_as_enchantment": {
        // Enduring cycle: "if it was a creature" — once returned, the cloned
        // definition has no creature type, so a second death is final.
        const dead = state.cards[effect.cardId];
        const printed = dead ? state.definitions[dead.definitionId] : undefined;
        if (
          !dead ||
          dead.zone !== "graveyard" ||
          !printed ||
          !printed.characteristics.types.includes("creature")
        ) {
          next = cloneGameState(state);
          break;
        }
        next = cloneGameState(state);
        const enchantmentOnly = JSON.parse(JSON.stringify(printed)) as typeof printed;
        enchantmentOnly.id = createId("definition");
        enchantmentOnly.typeLine = printed.typeLine
          .replace(/\bCreature\b ?/i, "")
          .replace(/\s+—/, " —")
          .trim();
        enchantmentOnly.characteristics = {
          ...printed.characteristics,
          types: printed.characteristics.types.filter((type) => type !== "creature"),
        };
        enchantmentOnly.power = null;
        enchantmentOnly.toughness = null;
        next.definitions[enchantmentOnly.id] = enchantmentOnly;
        next.cards[effect.cardId]!.definitionId = enchantmentOnly.id;
        // "under its owner's control": moveCard returns it to the owner's
        // battlefield, and control follows the owner's zone list.
        next = moveCard(next, effect.cardId, "battlefield");
        break;
      }
      case "create_emblem": {
        // An emblem is not a permanent (CR 114); modeling it as a
        // battlefield static carrier is a documented approximation — mass
        // removal is taught to spare the "emblem" type.
        next = cloneGameState(state);
        const emblemDefinition = createCardDefinition({
          name: "Emblem",
          typeLine: "Emblem",
          staticAbilities: effect.statics,
        });
        next.definitions[emblemDefinition.id] = emblemDefinition;
        const emblem = createCardInstance({
          definitionId: emblemDefinition.id,
          ownerId: effect.ownerId,
          zone: "battlefield",
          isToken: true,
        });
        emblem.timestamp = next.nextTimestamp;
        next.nextTimestamp += 1;
        next.cards[emblem.id] = emblem;
        next.players
          .find((player) => player.id === effect.ownerId)
          ?.zones.battlefield.push(emblem.id);
        break;
      }
      case "roll_die_treasures": {
        // The d20 is a real random roll (like the opening roll); tests mock
        // Math.random.
        const roll = 1 + Math.floor(Math.random() * effect.sides);
        next = applyCreateToken(state, {
          kind: "create_token",
          ownerId: effect.playerId,
          name: "Treasure",
          typeLine: "Artifact — Treasure Token",
          power: null,
          toughness: null,
          count: roll,
        });
        break;
      }
      case "germ_attach": {
        // Living weapon (CR 702.92): the Germ enters, then the Equipment
        // attaches. A boostless Germ dies to the next SBA sweep as a 0/0 and
        // the Equipment stays behind — the printed behavior.
        const equipment = state.cards[effect.cardId];
        if (!equipment || equipment.zone !== "battlefield") {
          next = cloneGameState(state);
          break;
        }
        next = cloneGameState(state);
        const germDefinition = createCardDefinition({
          name: "Phyrexian Germ",
          typeLine: "Creature — Phyrexian Germ Token",
          colors: ["B"],
          power: 0,
          toughness: 0,
        });
        next.definitions[germDefinition.id] = germDefinition;
        const germ = createCardInstance({
          definitionId: germDefinition.id,
          ownerId: equipment.controllerId,
          zone: "battlefield",
          isToken: true,
        });
        germ.timestamp = next.nextTimestamp;
        next.nextTimestamp += 1;
        next.cards[germ.id] = germ;
        next.players
          .find((player) => player.id === equipment.controllerId)
          ?.zones.battlefield.push(germ.id);
        next.cards[effect.cardId]!.attachedTo = germ.id;
        queueEnterBattlefieldTriggersInPlace(next, germ.id);
        dispatchEventsInPlace(next, [
          { kind: "creates_token", playerId: equipment.controllerId },
        ]);
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
