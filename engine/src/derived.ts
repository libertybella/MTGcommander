import { characteristicsOf, isBasic, isCommander, isCreature, isLand, isLegendary } from "./cardTypes";
import { abilitiesRemoved, computedCard } from "./characteristicsEngine";
import type { CardInstance, CardInstanceId, EnterTappedUnless, GameState } from "./types";

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
  },
): number {
  let total = 0;
  for (const card of Object.values(state.cards)) {
    if (card.zone !== "battlefield" || card.controllerId !== playerId) {
      continue;
    }
    if (abilitiesRemoved(state, card.id)) {
      continue;
    }
    for (const reduction of state.definitions[card.definitionId]?.costReductions ?? []) {
      const { types, typesAny, subtypesAny, colors, chosenSubtype } = reduction.filter;
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
): { look: boolean; playLands: boolean; castAll: boolean; castTypesAny: string[] } | null {
  let look = false;
  let playLands = false;
  let castAll = false;
  const castTypes = new Set<string>();
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
    for (const type of grant.castTypesAny ?? []) {
      castTypes.add(type);
    }
  }
  if (!look && !playLands && !castAll && castTypes.size === 0) {
    return null;
  }
  return { look, playLands, castAll, castTypesAny: [...castTypes] };
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
    grant.castTypesAny.some((type) => definition.characteristics.types.includes(type))
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
export function selfDiscountAmount(
  state: GameState,
  playerId: string,
  per: "noncreature_artifacts_total_mv" | "historic_total_mv" | "greatest_creature_power",
): number {
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
  if (definition?.chooseColorOnEnter && card.chosenColor === null) {
    state.prompts.push({
      kind: "choose_color",
      playerId: card.controllerId,
      sourceId: card.id,
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
    });
  }
}
