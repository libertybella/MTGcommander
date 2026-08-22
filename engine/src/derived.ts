import { characteristicsOf, isBasic, isCommander, isCreature, isLand, isLegendary } from "./cardTypes";
import { abilitiesRemoved, cardMatchesSubtype, computedCard, controlsGate } from "./characteristicsEngine";
import type { AlternativeCastCost, CardInstance, CardInstanceId, EnterTappedUnless, GameState, PlayerId } from "./types";

/**
 * CR 616: damage-modifying replacements, applied wherever damage is actually
 * applied — noncombat effects, sweeps, and combat. `targetPlayerId` is the
 * damaged player, or the controller of the damaged permanent.
 *
 * Documented approximation: multiplications apply before additions and
 * holders apply in timestamp order, where the rules let the affected player
 * choose the order. With one holder — the realistic table — the two agree.
 */
export function damageAfterReplacements(
  state: GameState,
  sourceId: CardInstanceId | null | undefined,
  targetPlayerId: PlayerId | undefined,
  amount: number,
): number {
  if (amount <= 0 || !sourceId) {
    return amount;
  }
  const source = state.cards[sourceId];
  if (!source) {
    return amount;
  }
  const holders = Object.values(state.cards)
    .filter((card) => {
      if (card.zone !== "battlefield" || abilitiesRemoved(state, card.id)) {
        return false;
      }
      const rule = state.definitions[card.definitionId]?.damageReplacement;
      if (!rule) {
        return false;
      }
      // "a source YOU control" — the holder's controller must control it.
      if (source.controllerId !== card.controllerId) {
        return false;
      }
      if (rule.opponentsOnly && (targetPlayerId === undefined || targetPlayerId === card.controllerId)) {
        return false;
      }
      if (rule.sourceMustBeCreature && !isCreature(state, sourceId)) {
        return false;
      }
      const colors = characteristicsOf(state, sourceId).colors;
      return (rule.sourceColors ?? []).every((color) => colors.includes(color));
    })
    .sort((a, b) => a.timestamp - b.timestamp);

  let result = amount;
  for (const holder of holders) {
    const rule = state.definitions[holder.definitionId]!.damageReplacement!;
    result = result * (rule.times ?? 1) + (rule.plus ?? 0);
  }
  return result;
}

/**
 * Mana Reflection, Nyxbloom Ancient: "If you tap a permanent for mana, it
 * produces twice as much of that mana instead." Several holders multiply
 * together, which is what CR 616 gives regardless of the chosen order.
 */
export function manaTapMultiplier(state: GameState, playerId: PlayerId): number {
  let multiplier = 1;
  for (const card of Object.values(state.cards)) {
    if (card.zone !== "battlefield" || card.controllerId !== playerId) {
      continue;
    }
    if (abilitiesRemoved(state, card.id)) {
      continue;
    }
    multiplier *= state.definitions[card.definitionId]?.manaTapMultiplier ?? 1;
  }
  return multiplier;
}

/**
 * What paying an alternative cast cost would actually take, or null if it
 * cannot be paid. The cards are auto-picked cheapest-first — a documented
 * approximation of the caster's choice, tolerable because the alternative is
 * only ever reached when the printed cost was unpayable.
 */
export function altCastPayment(
  state: GameState,
  playerId: PlayerId,
  cost: AlternativeCastCost,
  spellId: CardInstanceId,
): { exileIds: CardInstanceId[]; sacrificeId?: CardInstanceId } | null {
  const player = state.players.find((entry) => entry.id === playerId);
  if (!player) {
    return null;
  }
  if (cost.requires && !controlsGate(state, playerId, cost.requires)) {
    return null;
  }
  // CR 118.4: a cost that would reduce life to zero or below cannot be paid.
  if (cost.life !== undefined && player.life <= cost.life) {
    return null;
  }
  const exileIds: CardInstanceId[] = [];
  if (cost.exileFromHand) {
    const candidates = player.zones.hand
      .filter((id) => id !== spellId)
      .filter((id) => {
        const colors = characteristicsOf(state, id).colors;
        return (cost.exileFromHand!.colors ?? []).every((color) => colors.includes(color));
      })
      .sort(
        (a, b) => characteristicsOf(state, a).manaValue - characteristicsOf(state, b).manaValue,
      );
    if (candidates.length < cost.exileFromHand.count) {
      return null;
    }
    exileIds.push(...candidates.slice(0, cost.exileFromHand.count));
  }
  let sacrificeId: CardInstanceId | undefined;
  if (cost.sacrificeCreature) {
    const rule = cost.sacrificeCreature;
    sacrificeId = Object.values(state.cards)
      .filter(
        (card) =>
          card.zone === "battlefield" &&
          card.controllerId === playerId &&
          isCreature(state, card.id) &&
          (!rule.nontoken || !card.isToken) &&
          (rule.colors ?? []).every((color) =>
            characteristicsOf(state, card.id).colors.includes(color),
          ),
      )
      .sort((a, b) => creaturePower(state, a.id) - creaturePower(state, b.id))[0]?.id;
    if (!sacrificeId) {
      return null;
    }
  }
  return { exileIds, ...(sacrificeId ? { sacrificeId } : {}) };
}

function plus1Plus1(state: GameState, cardId: CardInstanceId): number {
  return state.cards[cardId]?.counters["p1p1"] ?? 0;
}

/** Final power: the layer engine for battlefield objects, printed elsewhere. */
export function creaturePower(state: GameState, cardId: CardInstanceId): number {
  const card = state.cards[cardId];
  if (card?.zone === "battlefield") {
    return computedCard(state, cardId)?.power ?? 0;
  }
  const base = state.definitions[card?.definitionId ?? ""]?.power ?? 0;
  return Math.max(0, base + plus1Plus1(state, cardId));
}

export function creatureToughness(state: GameState, cardId: CardInstanceId): number {
  const card = state.cards[cardId];
  if (card?.zone === "battlefield") {
    return computedCard(state, cardId)?.toughness ?? 0;
  }
  const base = state.definitions[card?.definitionId ?? ""]?.toughness ?? 0;
  return Math.max(0, base + plus1Plus1(state, cardId));
}

export function wouldSkipDraw(state: GameState, playerId: string): boolean {
  return Object.values(state.cards).some((card) => {
    if (card.zone !== "battlefield" || card.controllerId !== playerId) {
      return false;
    }
    if (abilitiesRemoved(state, card.id)) {
      return false;
    }
    return (state.definitions[card.definitionId]?.replacements ?? []).some(
      (replacement) => replacement.kind === "replace_draw" && replacement.instead === "skip",
    );
  });
}

/** CR 402.2: 7 unless a permanent removes the maximum. null means no maximum. */
export function maxHandSizeOf(state: GameState, playerId: string): number | null {
  const unlimited = Object.values(state.cards).some((card) => {
    if (card.zone !== "battlefield" || card.controllerId !== playerId) {
      return false;
    }
    if (abilitiesRemoved(state, card.id)) {
      return false;
    }
    return state.definitions[card.definitionId]?.noMaxHandSize === true;
  });
  return unlimited ? null : 7;
}

/**
 * CR 601.2f: total generic discount the player's permanents give a spell
 * with these printed characteristics (medallions, Foundry Inspector).
 */
export function castCostReduction(
  state: GameState,
  playerId: string,
  spell: {
    characteristics: { types: string[]; subtypes?: string[]; colors: string[] };
    changeling?: boolean;
    power?: number | null;
  },
): number {
  let total = 0;
  for (const card of Object.values(state.cards)) {
    if (card.zone !== "battlefield") {
      continue;
    }
    if (abilitiesRemoved(state, card.id)) {
      continue;
    }
    for (const reduction of state.definitions[card.definitionId]?.costReductions ?? []) {
      // Whose spells this touches. Unscoped means the holder's own, which is
      // what every discount written before taxes existed meant.
      const scope = reduction.scope ?? "you";
      const own = card.controllerId === playerId;
      if ((scope === "you" && !own) || (scope === "opponents" && own)) {
        continue;
      }
      // Defense Grid: the tax lifts on the holder's own turn.
      if (reduction.notDuringControllersTurn && state.turn.activePlayerId === card.controllerId) {
        continue;
      }
      const { types, typesAny, subtypesAny, colors, chosenSubtype, chosenCardType } =
        reduction.filter;
      if (types && !types.every((type) => spell.characteristics.types.includes(type))) {
        continue;
      }
      // Urza's Incubator / Herald's Horn: the discount reads the source's
      // as-enters chosen creature type.
      if (chosenSubtype) {
        const chosen = card.chosenCreatureType;
        if (
          !chosen ||
          (!spell.changeling && !(spell.characteristics.subtypes ?? []).includes(chosen))
        ) {
          continue;
        }
      }
      // Cloud Key: the spell must have the source's auto-picked card type.
      if (chosenCardType) {
        const chosen = card.chosenCardType;
        if (!chosen || !spell.characteristics.types.includes(chosen)) {
          continue;
        }
      }
      // Goreclaw: printed power floor on the discounted spell.
      if (reduction.filter.minPower !== undefined && (spell.power ?? 0) < reduction.filter.minPower) {
        continue;
      }
      if (typesAny && !typesAny.some((type) => spell.characteristics.types.includes(type))) {
        continue;
      }
      if (
        subtypesAny &&
        !spell.changeling &&
        !subtypesAny.some((subtype) => (spell.characteristics.subtypes ?? []).includes(subtype))
      ) {
        continue;
      }
      if (colors && !colors.some((color) => spell.characteristics.colors.includes(color))) {
        continue;
      }
      total += reduction.generic;
    }
  }
  return total;
}

/** "You may play lands from your graveyard" (Crucible of Worlds). */
export function canPlayLandsFromGraveyard(state: GameState, playerId: string): boolean {
  return Object.values(state.cards).some((card) => {
    if (card.zone !== "battlefield" || card.controllerId !== playerId) {
      return false;
    }
    if (abilitiesRemoved(state, card.id)) {
      return false;
    }
    return state.definitions[card.definitionId]?.playLandsFromGraveyard === true;
  });
}

/**
 * Merged top-of-library permissions from the player's battlefield permanents
 * (Oracle of Mul Daya, Elven Chorus). Null when nothing grants any.
 */
export function topOfLibraryGrant(
  state: GameState,
  playerId: string,
): {
  look: boolean;
  playLands: boolean;
  castAll: boolean;
  castColorless: boolean;
  castTypesAny: string[];
  castSubtypesAny: string[];
} | null {
  let look = false;
  let playLands = false;
  let castAll = false;
  let castColorless = false;
  const castTypes = new Set<string>();
  const castSubtypes = new Set<string>();
  for (const card of Object.values(state.cards)) {
    if (card.zone !== "battlefield" || card.controllerId !== playerId) {
      continue;
    }
    // Cheap grant check before abilitiesRemoved (a layer pass) — this runs
    // inside every legalActions call.
    const grant = state.definitions[card.definitionId]?.topOfLibrary;
    if (!grant) {
      continue;
    }
    if (abilitiesRemoved(state, card.id)) {
      continue;
    }
    look = look || grant.look === true;
    playLands = playLands || grant.playLands === true;
    castAll = castAll || grant.castAll === true;
    castColorless = castColorless || grant.castColorless === true;
    for (const type of grant.castTypesAny ?? []) {
      castTypes.add(type);
    }
    // Realmwalker: "creature spells of the chosen type", read live from the
    // granting card's own chosen creature type.
    if (grant.castChosenType && card.chosenCreatureType) {
      castSubtypes.add(card.chosenCreatureType);
    }
  }
  if (!look && !playLands && !castAll && !castColorless && castTypes.size === 0 && castSubtypes.size === 0) {
    return null;
  }
  return {
    look,
    playLands,
    castAll,
    castColorless,
    castTypesAny: [...castTypes],
    castSubtypesAny: [...castSubtypes],
  };
}

/** May this exact card be cast right now from the top of its owner's library? */
export function castableFromTop(state: GameState, playerId: string, cardId: string): boolean {
  const player = state.players.find((entry) => entry.id === playerId);
  if (!player || player.zones.library[0] !== cardId) {
    return false;
  }
  const card = state.cards[cardId];
  const definition = card ? state.definitions[card.definitionId] : undefined;
  if (!definition || definition.characteristics.types.includes("land")) {
    return false;
  }
  const grant = topOfLibraryGrant(state, playerId);
  if (!grant) {
    return false;
  }
  return (
    grant.castAll ||
    grant.castTypesAny.some((type) => definition.characteristics.types.includes(type)) ||
    // Mystic Forge's colorless half: no colors among the printed characteristics.
    (grant.castColorless && definition.characteristics.colors.length === 0) ||
    // Realmwalker: creature spells of the granting card's chosen type
    // (changelings count via cardMatchesSubtype).
    (grant.castSubtypesAny.length > 0 &&
      definition.characteristics.types.includes("creature") &&
      grant.castSubtypesAny.some((subtype) => cardMatchesSubtype(state, cardId, subtype)))
  );
}

/** May this exact card be played as a land from the top of its owner's library? */
export function canPlayLandFromTop(state: GameState, playerId: string, cardId: string): boolean {
  const player = state.players.find((entry) => entry.id === playerId);
  if (!player || player.zones.library[0] !== cardId) {
    return false;
  }
  return topOfLibraryGrant(state, playerId)?.playLands === true;
}

/** Vedalken Orrery-class: the player may cast any spell at instant speed. */
export function hasFlashGrant(state: GameState, playerId: string): boolean {
  // Emergence Zone-class one-shot grants last only for this turn.
  if ((state.flashThisTurn ?? []).includes(playerId)) {
    return true;
  }
  return Object.values(state.cards).some((card) => {
    if (card.zone !== "battlefield" || card.controllerId !== playerId) {
      return false;
    }
    if (state.definitions[card.definitionId]?.grantsFlash !== true) {
      return false;
    }
    return !abilitiesRemoved(state, card.id);
  });
}

/** Affinity for artifacts: one generic less per artifact the caster controls. */
/** Weathered Wayfarer / Land Tax: is any opponent ahead on lands? */
export function opponentControlsMoreLands(state: GameState, playerId: string): boolean {
  const landCount = (owner: string): number =>
    Object.values(state.cards).filter(
      (card) =>
        card.zone === "battlefield" &&
        card.controllerId === owner &&
        characteristicsOf(state, card.id).types.includes("land"),
    ).length;
  const mine = landCount(playerId);
  return state.players.some(
    (player) => player.id !== playerId && !player.lost && landCount(player.id) > mine,
  );
}

/** "This spell costs {X} less to cast, where X is …" (the self-discount
 * artifacts and Henges). Historic = artifact, legendary, or Saga (CR 700.4a). */
/** Drannith Magistrate: an opponent's live lock limits casts to the hand. */
export function opponentsCastLockedToHand(state: GameState, playerId: string): boolean {
  return Object.values(state.cards).some(
    (card) =>
      card.zone === "battlefield" &&
      card.controllerId !== playerId &&
      state.definitions[card.definitionId]?.opponentsCastOnlyFromHand === true &&
      !abilitiesRemoved(state, card.id),
  );
}

/** Puresteel Paladin: any live granter makes controlled equips free. */
export function freeEquipGranted(state: GameState, playerId: string): boolean {
  return Object.values(state.cards).some((card) => {
    if (card.zone !== "battlefield" || card.controllerId !== playerId) {
      return false;
    }
    const need = state.definitions[card.definitionId]?.freeEquipIfArtifacts;
    if (!need || abilitiesRemoved(state, card.id)) {
      return false;
    }
    const artifacts = Object.values(state.cards).filter(
      (entry) =>
        entry.zone === "battlefield" &&
        entry.controllerId === playerId &&
        characteristicsOf(state, entry.id).types.includes("artifact"),
    ).length;
    return artifacts >= need;
  });
}

export function selfDiscountAmount(
  state: GameState,
  playerId: string,
  per:
    | "noncreature_artifacts_total_mv"
    | "historic_total_mv"
    | "greatest_creature_power"
    | "opponent_stack_3",
): number {
  // Bolt Bend: {3} less while an opponent has a spell or ability on the
  // stack — a documented proxy for "if it targets one".
  if (per === "opponent_stack_3") {
    return state.stack.some((entry) => entry.controllerId !== playerId) ? 3 : 0;
  }
  let total = 0;
  let greatest = 0;
  for (const card of Object.values(state.cards)) {
    if (card.zone !== "battlefield" || card.controllerId !== playerId) {
      continue;
    }
    const traits = characteristicsOf(state, card.id);
    if (per === "greatest_creature_power") {
      if (traits.types.includes("creature")) {
        greatest = Math.max(greatest, creaturePower(state, card.id));
      }
      continue;
    }
    if (per === "noncreature_artifacts_total_mv") {
      if (traits.types.includes("artifact") && !traits.types.includes("creature")) {
        total += traits.manaValue;
      }
      continue;
    }
    const historic =
      traits.types.includes("artifact") ||
      traits.supertypes.includes("legendary") ||
      traits.subtypes.includes("saga");
    if (historic) {
      total += traits.manaValue;
    }
  }
  return per === "greatest_creature_power" ? greatest : total;
}

export function affinityArtifactDiscount(state: GameState, playerId: string): number {
  let count = 0;
  for (const card of Object.values(state.cards)) {
    if (
      card.zone === "battlefield" &&
      card.controllerId === playerId &&
      characteristicsOf(state, card.id).types.includes("artifact")
    ) {
      count += 1;
    }
  }
  return count;
}

/** "for each creature on the battlefield" — anyone's (Ghoulcaller's-class). */
export function allBattlefieldCreatureCount(state: GameState): number {
  let count = 0;
  for (const card of Object.values(state.cards)) {
    if (card.zone === "battlefield" && isCreature(state, card.id)) {
      count += 1;
    }
  }
  return count;
}

/** "If you control a commander" (the free-spell cycle): any commander on the
 * battlefield under this player's control, their own or a stolen one. */
/** Grand Abolisher: the active player controls a lock and it isn't you. */
export function lockedByAbolisher(state: GameState, playerId: string): boolean {
  const activeId = state.turn.activePlayerId;
  if (activeId === playerId) {
    return false;
  }
  return Object.values(state.cards).some(
    (card) =>
      card.zone === "battlefield" &&
      card.controllerId === activeId &&
      state.definitions[card.definitionId]?.opponentsLockedDuringYourTurn === true &&
      !abilitiesRemoved(state, card.id),
  );
}

/** Casting lock: the Abolisher lock, or a cast-only "opponents can't cast
 * spells during your turn" (Voice of Victory, Kutzil). */
export function lockedFromCasting(state: GameState, playerId: string): boolean {
  if (lockedByAbolisher(state, playerId)) {
    return true;
  }
  const activeId = state.turn.activePlayerId;
  if (activeId === playerId) {
    return false;
  }
  return Object.values(state.cards).some(
    (card) =>
      card.zone === "battlefield" &&
      card.controllerId === activeId &&
      state.definitions[card.definitionId]?.opponentsCantCastDuringYourTurn === true &&
      !abilitiesRemoved(state, card.id),
  );
}

export function controlsCommander(state: GameState, playerId: string): boolean {
  return Object.values(state.cards).some(
    (card) =>
      card.zone === "battlefield" &&
      card.controllerId === playerId &&
      isCommander(state, card.id),
  );
}

/** CR 305.2: one land drop plus any extras granted by permanents (Exploration). */
export function landDropAllowance(state: GameState, playerId: string): number {
  let extra = 0;
  for (const card of Object.values(state.cards)) {
    if (card.zone !== "battlefield" || card.controllerId !== playerId) {
      continue;
    }
    if (abilitiesRemoved(state, card.id)) {
      continue;
    }
    extra += state.definitions[card.definitionId]?.extraLandDrops ?? 0;
  }
  // Explore: one-shot grants for this turn only.
  const player = state.players.find((entry) => entry.id === playerId);
  return 1 + extra + (player?.extraLandDropsThisTurn ?? 0);
}

function controlledBattlefield(state: GameState, controllerId: string): CardInstance[] {
  return Object.values(state.cards).filter(
    (card) => card.zone === "battlefield" && card.controllerId === controllerId,
  );
}

function unlessSatisfied(
  state: GameState,
  card: CardInstance,
  unless: EnterTappedUnless,
): boolean {
  const controlled = controlledBattlefield(state, card.controllerId);
  if (unless.kind === "other_lands") {
    const others = controlled.filter((entry) => entry.id !== card.id && isLand(state, entry.id));
    return others.length >= unless.count;
  }
  if (unless.kind === "other_lands_at_most") {
    const others = controlled.filter((entry) => entry.id !== card.id && isLand(state, entry.id));
    return others.length <= unless.count;
  }
  if (unless.kind === "opponents") {
    const opponents = state.players.filter(
      (player) => player.id !== card.controllerId && !player.lost,
    );
    return opponents.length >= unless.count;
  }
  if (unless.kind === "legendary_creature") {
    return controlled.some((entry) => isLegendary(state, entry.id) && isCreature(state, entry.id));
  }
  if (unless.kind === "basic_lands") {
    const basics = controlled.filter(
      (entry) => isLand(state, entry.id) && isBasic(state, entry.id),
    );
    return basics.length >= unless.count;
  }
  if (unless.kind === "hand_reveals_types") {
    // Documented approximation: the reveal "may" is auto-taken — any matching
    // card in hand means the land enters untapped.
    const player = state.players.find((entry) => entry.id === card.controllerId);
    return (player?.zones.hand ?? []).some((id) => {
      const printed = characteristicsOf(state, id);
      return unless.types.some(
        (type) => printed.subtypes.includes(type) || printed.types.includes(type),
      );
    });
  }
  return controlled.some((entry) => {
    const printed = characteristicsOf(state, entry.id);
    return unless.types.some(
      (type) => printed.subtypes.includes(type) || printed.types.includes(type),
    );
  });
}

/** Self-replacement: the permanent enters the battlefield tapped (CR 614.12). */
export function wouldEnterTapped(state: GameState, cardId: CardInstanceId): boolean {
  const card = state.cards[cardId];
  if (!card) {
    return false;
  }
  // Authority of the Consuls / Blind Obedience: an opponent's static taps
  // arriving creatures (and artifacts, when the flag says so).
  const arrivingTypes = characteristicsOf(state, cardId).types;
  if (
    Object.values(state.cards).some((other) => {
      if (other.zone !== "battlefield" || other.controllerId === card.controllerId) {
        return false;
      }
      const flags = state.definitions[other.definitionId];
      return (
        (flags?.opponentCreaturesEnterTapped === true && arrivingTypes.includes("creature")) ||
        (flags?.opponentArtifactsEnterTapped === true && arrivingTypes.includes("artifact"))
      );
    })
  ) {
    return true;
  }
  return (state.definitions[card.definitionId]?.replacements ?? []).some((replacement) => {
    if (replacement.kind === "enters_tapped") {
      return true;
    }
    if (replacement.kind === "enters_tapped_unless") {
      return !unlessSatisfied(state, card, replacement.unless);
    }
    if (replacement.kind === "enters_tapped_if") {
      return unlessSatisfied(state, card, replacement.if);
    }
    return false;
  });
}

export function queueEnterReplacementChoicesInPlace(state: GameState, cardId: CardInstanceId): void {
  const card = state.cards[cardId];
  if (!card || card.zone !== "battlefield") {
    return;
  }
  const definition = state.definitions[card.definitionId];
  if (!card.tapped) {
    for (const replacement of definition?.replacements ?? []) {
      if (replacement.kind !== "may_pay_life_or_enter_tapped") {
        continue;
      }
      state.prompts.push({
        kind: "may_pay_life_or_enter_tapped",
        playerId: card.controllerId,
        sourceId: card.id,
        amount: replacement.amount,
      });
    }
  }
  if (definition?.chooseCreatureTypeOnEnter && card.chosenCreatureType === null) {
    state.prompts.push({
      kind: "choose_creature_type",
      playerId: card.controllerId,
      sourceId: card.id,
    });
  }
  // Cloud Key: the card-type choice is auto-picked — the most common card
  // type among the controller's hand, else "creature" (documented).
  if (definition?.chooseCardTypeOnEnter && (card.chosenCardType ?? null) === null) {
    const tally: Record<string, number> = {};
    const hand =
      state.players.find((entry) => entry.id === card.controllerId)?.zones.hand ?? [];
    for (const handId of hand) {
      const types = state.definitions[state.cards[handId]?.definitionId ?? ""]?.characteristics
        .types;
      for (const type of types ?? []) {
        if (["artifact", "creature", "enchantment", "instant", "sorcery"].includes(type)) {
          tally[type] = (tally[type] ?? 0) + 1;
        }
      }
    }
    const best = Object.entries(tally).sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    )[0]?.[0];
    card.chosenCardType = best ?? "creature";
  }
  if (definition?.chooseColorOnEnter && card.chosenColor === null) {
    state.prompts.push({
      kind: "choose_color",
      playerId: card.controllerId,
      sourceId: card.id,
      ...(definition.chooseColorExcludes
        ? { excludeColor: definition.chooseColorExcludes }
        : {}),
    });
  }
  if (definition?.enterAsCopy) {
    // maxManaValue starts at 0 for spent-mana-capped clones (CR 707.12a: a
    // copy that wasn't cast spent no mana); stack resolution raises it to the
    // announced amount when the card enters from a cast.
    state.prompts.push({
      kind: "enter_as_copy",
      playerId: card.controllerId,
      sourceId: card.id,
      scope: definition.enterAsCopy.scope,
      ...(definition.enterAsCopy.extraCounters
        ? { extraCounters: definition.enterAsCopy.extraCounters }
        : {}),
      ...(definition.enterAsCopy.maxManaValueBySpent ? { maxManaValue: 0 } : {}),
      ...(definition.enterAsCopy.entersTapped ? { entersTapped: true } : {}),
    });
  }
}

/**
 * The index of a free-cast-from-hand grant this spell could use, or -1.
 * Grants are matched most-restrictive-first so a broad grant is not spent on
 * a spell that a narrower one would have covered.
 *
 * Lives here rather than in actions.ts so both the cast path and the
 * legal-action enumeration can read it without an import cycle.
 */
/**
 * Omniscience / As Foretold: a permanent that grants free casting from hand
 * continuously, rather than the one-shot grants above. Returns the loosest
 * cap available (Infinity for uncapped), or null when nothing grants it.
 *
 * As Foretold's "once each turn" is tracked on the player rather than the
 * card, which is a documented simplification: two copies would each allow a
 * cast, and here the second is refused.
 */
export function staticFreeCastCap(
  state: GameState,
  playerId: string,
  cardId: CardInstanceId,
): number | null {
  const manaValue = characteristicsOf(state, cardId).manaValue;
  let best: number | null = null;
  for (const card of Object.values(state.cards)) {
    if (card.zone !== "battlefield" || card.controllerId !== playerId) {
      continue;
    }
    const grant = state.definitions[card.definitionId]?.castFreeFromHand;
    if (!grant || abilitiesRemoved(state, card.id)) {
      continue;
    }
    if (grant.oncePerTurn && (state.freeCastUsedThisTurn ?? []).includes(playerId)) {
      continue;
    }
    const cap = grant.capFromCounter
      ? card.counters[grant.capFromCounter] ?? 0
      : Number.POSITIVE_INFINITY;
    if (manaValue > cap) {
      continue;
    }
    if (best === null || cap > best) {
      best = cap;
    }
  }
  return best;
}

/** Did a once-per-turn static grant cover this cast? */
export function usesOncePerTurnFreeCast(
  state: GameState,
  playerId: string,
  cardId: CardInstanceId,
): boolean {
  const manaValue = characteristicsOf(state, cardId).manaValue;
  return Object.values(state.cards).some((card) => {
    if (card.zone !== "battlefield" || card.controllerId !== playerId) {
      return false;
    }
    const grant = state.definitions[card.definitionId]?.castFreeFromHand;
    if (!grant?.oncePerTurn || abilitiesRemoved(state, card.id)) {
      return false;
    }
    const cap = grant.capFromCounter
      ? card.counters[grant.capFromCounter] ?? 0
      : Number.POSITIVE_INFINITY;
    return manaValue <= cap;
  });
}

export function findFreeHandGrantIndex(
  state: GameState,
  playerId: string,
  cardId: CardInstanceId,
): number {
  const grants = state.freeCastFromHand ?? [];
  const manaValue = characteristicsOf(state, cardId).manaValue;
  let best = -1;
  let bestCap = Number.POSITIVE_INFINITY;
  for (let index = 0; index < grants.length; index += 1) {
    const grant = grants[index]!;
    if (grant.casterId !== playerId || grant.remaining <= 0) {
      continue;
    }
    const cap = grant.maxManaValue ?? Number.POSITIVE_INFINITY;
    if (manaValue > cap) {
      continue;
    }
    if (cap < bestCap) {
      best = index;
      bestCap = cap;
    }
  }
  return best;
}
