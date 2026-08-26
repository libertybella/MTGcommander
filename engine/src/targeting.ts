import { characteristicsOf, isCommander, isCreature, isPlaneswalker } from "./cardTypes";
import { cardMatchesSubtype } from "./characteristicsEngine";
import { creaturePower, playerHasHexproof, playerHexproofFromColors, playerProtectedFromEverything } from "./derived";
import { hasKeyword, hexproofFromSource, protectedFromSource } from "./keywords";
import { isLiving, livingPlayers } from "./players";
import type {
  CardInstanceId,
  ChosenTarget,
  Color,
  GameState,
  PlayerId,
  StackObject,
  StackObjectId,
  TargetRequirement,
} from "./types";

function isLegalPlayerTarget(
  state: GameState,
  playerId: string,
  casterId?: PlayerId,
  sourceColors?: Color[],
): boolean {
  if (!isLiving(state, playerId)) {
    return false;
  }
  // Hexproof stops OPPONENTS only, so a player may always target
  // themselves — several cards a Shalai controller wants to cast do
  // exactly that, and a blanket check would lock them out of their own.
  if (casterId && casterId !== playerId && playerHasHexproof(state, playerId)) {
    return false;
  }
  // Veil of Summer: the player half of the same shield, and opponents only
  // for the same reason as the line above.
  if (casterId && casterId !== playerId) {
    const shield = playerHexproofFromColors(state, playerId);
    if (shield.length > 0 && (sourceColors ?? []).some((color) => shield.includes(color))) {
      return false;
    }
  }
  // Protection from everything is NOT hexproof: CR 702.16e makes no
  // exception for the protected player's own spells, which is why
  // Teferi's Protection locks its caster out of their own targeted
  // effects for the turn. No casterId check here on purpose.
  if (playerProtectedFromEverything(state, playerId)) {
    return false;
  }
  return true;
}

function isLegalCreatureTarget(
  state: GameState,
  cardId: string,
  casterId?: PlayerId,
  sourceColors?: Color[],
  sourceId?: CardInstanceId | null,
): boolean {
  const card = state.cards[cardId];
  if (!card || card.zone !== "battlefield" || card.phasedOut || !isCreature(state, cardId)) {
    return false;
  }
  // Shroud blocks everyone, including its own controller (CR 702.18).
  if (hasKeyword(state, cardId, "shroud")) {
    return false;
  }
  if (
    casterId &&
    hasKeyword(state, cardId, "hexproof") &&
    casterId !== card.controllerId
  ) {
    return false;
  }
  // Knight of Grace: hexproof from black stops an opponent's black spell
  // TARGETING it, and stops nothing else about that spell.
  if (
    casterId &&
    casterId !== card.controllerId &&
    hexproofFromSource(state, cardId, sourceId ?? null, sourceColors)
  ) {
    return false;
  }
  if (protectedFromSource(state, cardId, sourceId ?? null, sourceColors)) {
    return false;
  }
  return true;
}

function violatesColorExclusion(
  state: GameState,
  cardId: CardInstanceId,
  requirement: TargetRequirement,
): boolean {
  if (!requirement.excludeColors || requirement.excludeColors.length === 0) {
    return false;
  }
  const colors = characteristicsOf(state, cardId).colors;
  return requirement.excludeColors.some((color) => colors.includes(color));
}

function violatesManaValueFilter(
  state: GameState,
  cardId: CardInstanceId,
  requirement: TargetRequirement,
): boolean {
  if (requirement.maxManaValue === undefined && requirement.minManaValue === undefined) {
    return false;
  }
  const manaValue = characteristicsOf(state, cardId).manaValue;
  if (requirement.maxManaValue !== undefined && manaValue > requirement.maxManaValue) {
    return true;
  }
  return requirement.minManaValue !== undefined && manaValue < requirement.minManaValue;
}

function violatesCharacteristicFilter(
  state: GameState,
  cardId: CardInstanceId,
  requirement: TargetRequirement,
): boolean {
  // "Equip commander": your commander, not merely a legendary creature —
  // a legendary you did not name as commander must be refused.
  if (requirement.commanderOnly && !isCommander(state, cardId)) {
    return true;
  }
  if (requirement.legendaryOnly && !characteristicsOf(state, cardId).supertypes.includes("legendary")) {
    return true;
  }
  if (
    requirement.nonlegendaryOnly &&
    characteristicsOf(state, cardId).supertypes.includes("legendary")
  ) {
    return true;
  }
  if (requirement.attackingOnly && state.cards[cardId]?.attacking !== true) {
    return true;
  }
  if (requirement.nonTokenOnly && state.cards[cardId]?.isToken === true) {
    return true;
  }
  if (requirement.tokenTargetOnly && state.cards[cardId]?.isToken !== true) {
    return true;
  }
  // Blocking is not a flag on the instance the way attacking is: the
  // blocker list is keyed by attacker, so the question is whether this card
  // appears anywhere in it.
  if (requirement.attackingOrBlockingOnly) {
    const attacking = state.cards[cardId]?.attacking === true;
    const blocking = Object.values(state.combat?.blockers ?? {}).some((ids) =>
      ids.includes(cardId),
    );
    if (!attacking && !blocking) {
      return true;
    }
  }
  // "target nontoken creature" (Parting Gust).
  if (requirement.nontoken && state.cards[cardId]?.isToken) {
    return true;
  }
  if (violatesRequiredColors(state, cardId, requirement)) {
    return true;
  }
  // "Return target Human you control" (Kogla).
  if (
    (requirement.requiredSubtypes ?? []).some(
      (subtype) => !cardMatchesSubtype(state, cardId, subtype),
    )
  ) {
    return true;
  }
  // Swarmyard: "target Insect, Rat, Spider, or Squirrel" — ANY of them,
  // where the list above demands all of them at once.
  if (
    requirement.requiredSubtypesAny &&
    requirement.requiredSubtypesAny.length > 0 &&
    !requirement.requiredSubtypesAny.some((subtype) =>
      cardMatchesSubtype(state, cardId, subtype),
    )
  ) {
    return true;
  }
  // Deathrite Shaman: "target land card from a graveyard" — ANY of the
  // listed card types, read from the printed characteristics.
  if (
    requirement.requiredTypesAny &&
    requirement.requiredTypesAny.length > 0 &&
    !requirement.requiredTypesAny.some((type) =>
      characteristicsOf(state, cardId).types.includes(type),
    )
  ) {
    return true;
  }
  // "target non-Dragon creature card" (Junji).
  if (
    (requirement.excludedSubtypes ?? []).some((subtype) =>
      cardMatchesSubtype(state, cardId, subtype),
    )
  ) {
    return true;
  }
  // "target noncreature artifact" (Haywire Mite).
  if (
    (requirement.excludedTypes ?? []).some((type) =>
      characteristicsOf(state, cardId).types.includes(type),
    )
  ) {
    return true;
  }
  // "target multicolored permanent" (Null Elemental Blast).
  if (requirement.multicolored && characteristicsOf(state, cardId).colors.length < 2) {
    return true;
  }
  if (requirement.minPower !== undefined && creaturePower(state, cardId) < requirement.minPower) {
    return true;
  }
  return requirement.maxPower !== undefined && creaturePower(state, cardId) > requirement.maxPower;
}

/** "target blue permanent": every listed color must be present. */
function violatesRequiredColors(
  state: GameState,
  cardId: CardInstanceId,
  requirement: TargetRequirement,
): boolean {
  if (!requirement.requiredColors || requirement.requiredColors.length === 0) {
    return false;
  }
  const colors = characteristicsOf(state, cardId).colors;
  return !requirement.requiredColors.every((color) => colors.includes(color));
}

function violatesControlFilter(
  state: GameState,
  cardId: CardInstanceId,
  requirement: TargetRequirement,
  casterId: PlayerId | undefined,
): boolean {
  if (!requirement.control || !casterId) {
    return false;
  }
  const controllerId = state.cards[cardId]?.controllerId;
  return requirement.control === "own" ? controllerId !== casterId : controllerId === casterId;
}

/** Colors of a spell or ability source, for protection checks. */
export function sourceColorsOf(state: GameState, sourceId: CardInstanceId | null): Color[] {
  if (!sourceId) {
    return [];
  }
  const card = state.cards[sourceId];
  const definition = card ? state.definitions[card.definitionId] : undefined;
  return definition?.characteristics.colors ?? [];
}

function isLegalSpellTarget(state: GameState, stackObjectId: StackObjectId): boolean {
  const entry = state.stack.find((object) => object.id === stackObjectId);
  return Boolean(entry && entry.kind === "spell");
}

/**
 * The target requirements of ANY object on the stack — a spell, an activated
 * ability, a loyalty ability, or a trigger, modes included.
 *
 * The resolver reads the same shapes inline, per stack kind, because it also
 * needs the ability object itself to bind effects from. This exists so that
 * `retarget` asks EXACTLY the question resolution asks: a redirect that
 * computed requirements differently could point a spell at something the
 * resolver then refuses, and the redirect would report success.
 */
export function stackObjectRequirements(
  state: GameState,
  entry: StackObject,
): TargetRequirement[] {
  const source = entry.sourceId ? state.cards[entry.sourceId] : undefined;
  const definition = source ? state.definitions[source.definitionId] : undefined;
  if (entry.kind === "spell") {
    if (entry.modeIndexes && entry.modeIndexes.length > 0 && definition?.modes) {
      return entry.modeIndexes.flatMap(
        (index) => definition.modes![index]?.targetRequirements ?? [],
      );
    }
    if (entry.modeIndex !== undefined && definition?.modes?.[entry.modeIndex]) {
      return definition.modes[entry.modeIndex]!.targetRequirements;
    }
    return definition?.targetRequirements ?? [];
  }
  if (entry.activatedIndex !== undefined) {
    // The snapshot first: a granted ability outlives the grant (CR 113.7a).
    const ability = entry.grantedActivated ?? definition?.activated[entry.activatedIndex];
    const mode = entry.modeIndex !== undefined ? ability?.modes?.[entry.modeIndex] : undefined;
    return mode ? mode.targetRequirements ?? [] : ability?.targetRequirements ?? [];
  }
  if (entry.loyaltyIndex !== undefined) {
    return definition?.loyaltyAbilities?.[entry.loyaltyIndex]?.targetRequirements ?? [];
  }
  const trigger = entry.grantedTrigger ?? definition?.triggers[entry.triggerIndex ?? 0];
  if (entry.modeIndexes && entry.modeIndexes.length > 0 && trigger?.modes) {
    return entry.modeIndexes.flatMap((index) => trigger.modes![index]?.targetRequirements ?? []);
  }
  if (entry.modeIndex !== undefined && trigger?.modes?.[entry.modeIndex]) {
    return trigger.modes[entry.modeIndex]!.targetRequirements ?? [];
  }
  return trigger?.targetRequirements ?? [];
}

/** Spellskite: any object on the stack, spell or ability alike. */
function isLegalStackTarget(state: GameState, stackObjectId: StackObjectId): boolean {
  return state.stack.some((object) => object.id === stackObjectId);
}

function isArtifactPermanent(state: GameState, cardId: string): boolean {
  const card = state.cards[cardId];
  const typeLine = card ? state.definitions[card.definitionId]?.typeLine.toLowerCase() ?? "" : "";
  return /\bartifact\b/.test(typeLine);
}

function isCreatureSpell(state: GameState, stackObjectId: StackObjectId): boolean {
  const entry = state.stack.find((object) => object.id === stackObjectId);
  if (!entry || entry.kind !== "spell" || !entry.sourceId) {
    return false;
  }
  const card = state.cards[entry.sourceId];
  const typeLine = card ? state.definitions[card.definitionId]?.typeLine.toLowerCase() ?? "" : "";
  return /\bcreature\b/.test(typeLine);
}

/** Dispel: a spell of exactly one card type. */
function isSpellOfType(
  state: GameState,
  stackObjectId: StackObjectId,
  type: string,
): boolean {
  const entry = state.stack.find((object) => object.id === stackObjectId);
  if (!entry || entry.kind !== "spell" || !entry.sourceId) {
    return false;
  }
  const card = state.cards[entry.sourceId];
  const typeLine = card ? state.definitions[card.definitionId]?.typeLine.toLowerCase() ?? "" : "";
  return new RegExp(`\\b${type}\\b`).test(typeLine);
}

function isInstantOrSorcerySpell(state: GameState, stackObjectId: StackObjectId): boolean {
  const entry = state.stack.find((object) => object.id === stackObjectId);
  if (!entry || entry.kind !== "spell" || !entry.sourceId) {
    return false;
  }
  const card = state.cards[entry.sourceId];
  const typeLine = card ? state.definitions[card.definitionId]?.typeLine.toLowerCase() ?? "" : "";
  return /\b(?:instant|sorcery)\b/.test(typeLine);
}

export function isChosenTargetLegal(
  state: GameState,
  requirement: TargetRequirement,
  target: ChosenTarget,
  casterId?: PlayerId,
  sourceColors?: Color[],
  sourceId?: CardInstanceId | null,
): boolean {
  // "another target …": the source itself is not a legal choice.
  if (
    requirement.excludeSource &&
    sourceId &&
    target.type === "creature" &&
    target.cardId === sourceId
  ) {
    return false;
  }
  if (requirement.kind === "player") {
    return (
      target.type === "player" &&
      isLegalPlayerTarget(state, target.playerId, casterId, sourceColors)
    );
  }
  if (requirement.kind === "opponent") {
    return (
      target.type === "player" &&
      Boolean(casterId) &&
      target.playerId !== casterId &&
      isLegalPlayerTarget(state, target.playerId, casterId, sourceColors)
    );
  }
  if (requirement.kind === "creature") {
    return (
      target.type === "creature" &&
      isLegalCreatureTarget(state, target.cardId, casterId, sourceColors, sourceId) &&
      !violatesColorExclusion(state, target.cardId, requirement) &&
      !violatesControlFilter(state, target.cardId, requirement, casterId) &&
      !violatesManaValueFilter(state, target.cardId, requirement) &&
      !violatesCharacteristicFilter(state, target.cardId, requirement) &&
      // "target creature you own" (Charming Prince).
      (requirement.owner !== "own" || state.cards[target.cardId]?.ownerId === casterId)
    );
  }
  if (requirement.kind === "own_creature") {
    return (
      target.type === "creature" &&
      isLegalCreatureTarget(state, target.cardId, casterId, sourceColors, sourceId) &&
      state.cards[target.cardId]?.controllerId === casterId &&
      // "Equip legendary creature" (Excalibur).
      !violatesCharacteristicFilter(state, target.cardId, requirement)
    );
  }
  if (requirement.kind === "permanent") {
    if (target.type !== "creature") {
      return false;
    }
    const card = state.cards[target.cardId];
    if (!card || card.zone !== "battlefield" || card.phasedOut) {
      return false;
    }
    if (violatesControlFilter(state, target.cardId, requirement, casterId)) {
      return false;
    }
    if (violatesManaValueFilter(state, target.cardId, requirement)) {
      return false;
    }
    // "target legendary permanent" (Minamo) — the same characteristic gate
    // the creature branch runs; without it the qualifier would be inert.
    if (violatesCharacteristicFilter(state, target.cardId, requirement)) {
      return false;
    }
    if (hasKeyword(state, target.cardId, "shroud")) {
      return false;
    }
    if (
      casterId &&
      hasKeyword(state, target.cardId, "hexproof") &&
      casterId !== card.controllerId
    ) {
      return false;
    }
    if (
      casterId &&
      casterId !== card.controllerId &&
      hexproofFromSource(state, target.cardId, sourceId ?? null, sourceColors)
    ) {
      return false;
    }
    if (protectedFromSource(state, target.cardId, sourceId ?? null, sourceColors)) {
      return false;
    }
    return true;
  }
  if (requirement.kind === "nonartifact_creature") {
    return (
      target.type === "creature" &&
      isLegalCreatureTarget(state, target.cardId, casterId, sourceColors, sourceId) &&
      !isArtifactPermanent(state, target.cardId)
    );
  }
  if (requirement.kind === "graveyard_creature_card") {
    if (target.type !== "creature") {
      return false;
    }
    const card = state.cards[target.cardId];
    return Boolean(
      card &&
        card.zone === "graveyard" &&
        characteristicsOf(state, target.cardId).types.includes("creature") &&
        !violatesManaValueFilter(state, target.cardId, requirement) &&
        // Every other adjective too, not just the one excluded subtype this
        // used to spell out by hand — the same fix the own_ family below
        // already carries.
        !violatesCharacteristicFilter(state, target.cardId, requirement),
    );
  }
  // "target card from a graveyard" (Noxious Revival), and every type-filtered
  // form of it (Deathrite Shaman).
  if (requirement.kind === "graveyard_card") {
    if (target.type !== "creature") {
      return false;
    }
    if (state.cards[target.cardId]?.zone !== "graveyard") {
      return false;
    }
    if (violatesManaValueFilter(state, target.cardId, requirement)) {
      return false;
    }
    return !violatesCharacteristicFilter(state, target.cardId, requirement);
  }
  if (
    requirement.kind === "own_graveyard_card" ||
    requirement.kind === "own_graveyard_creature_card" ||
    requirement.kind === "own_graveyard_permanent_card" ||
    requirement.kind === "own_graveyard_artifact_card" ||
    requirement.kind === "own_graveyard_enchantment_card" ||
    requirement.kind === "own_graveyard_land_card" ||
    requirement.kind === "own_graveyard_instant_or_sorcery_card" ||
    requirement.kind === "own_graveyard_creature_or_planeswalker_card"
  ) {
    if (target.type !== "creature" || !casterId) {
      return false;
    }
    const card = state.cards[target.cardId];
    if (!card || card.zone !== "graveyard" || card.ownerId !== casterId) {
      return false;
    }
    // Sun Titan: "with mana value 3 or less" on graveyard targets.
    if (violatesManaValueFilter(state, target.cardId, requirement)) {
      return false;
    }
    // The rest of the adjectives ("nonlegendary", a colour, a subtype) were
    // being parsed onto graveyard requirements and then ignored here, which
    // is the same shape the permanent family had: a filter that reads as
    // decoration because nothing consults it.
    if (violatesCharacteristicFilter(state, target.cardId, requirement)) {
      return false;
    }
    if (requirement.kind === "own_graveyard_creature_card") {
      return characteristicsOf(state, target.cardId).types.includes("creature");
    }
    if (requirement.kind === "own_graveyard_artifact_card") {
      return characteristicsOf(state, target.cardId).types.includes("artifact");
    }
    if (requirement.kind === "own_graveyard_enchantment_card") {
      return characteristicsOf(state, target.cardId).types.includes("enchantment");
    }
    if (requirement.kind === "own_graveyard_land_card") {
      return characteristicsOf(state, target.cardId).types.includes("land");
    }
    if (requirement.kind === "own_graveyard_instant_or_sorcery_card") {
      const types = characteristicsOf(state, target.cardId).types;
      return types.includes("instant") || types.includes("sorcery");
    }
    if (requirement.kind === "own_graveyard_creature_or_planeswalker_card") {
      const types = characteristicsOf(state, target.cardId).types;
      return types.includes("creature") || types.includes("planeswalker");
    }
    if (requirement.kind === "own_graveyard_permanent_card") {
      const types = characteristicsOf(state, target.cardId).types;
      return !types.includes("instant") && !types.includes("sorcery");
    }
    return true;
  }
  if (
    requirement.kind === "creature_or_planeswalker" ||
    requirement.kind === "artifact" ||
    requirement.kind === "enchantment" ||
    requirement.kind === "artifact_or_enchantment" ||
    requirement.kind === "creature_or_artifact" ||
    requirement.kind === "creature_or_enchantment" ||
    requirement.kind === "creature_enchantment_or_planeswalker" ||
    requirement.kind === "nonland_permanent" ||
    requirement.kind === "noncreature_nonland_permanent" ||
    requirement.kind === "land" ||
    requirement.kind === "artifact_enchantment_or_nonbasic_land" ||
    requirement.kind === "artifact_enchantment_or_land" ||
    requirement.kind === "artifact_creature_enchantment_or_land" ||
    requirement.kind === "artifact_enchantment_or_planeswalker" ||
    requirement.kind === "artifact_creature_or_planeswalker" ||
    requirement.kind === "artifact_creature_or_land" ||
    requirement.kind === "planeswalker" ||
    requirement.kind === "commander"
  ) {
    if (target.type !== "creature") {
      return false;
    }
    const permanentLegal = isChosenTargetLegal(
      state,
      { kind: "permanent" },
      target,
      casterId,
      sourceColors,
    );
    if (!permanentLegal) {
      return false;
    }
    if (violatesControlFilter(state, target.cardId, requirement, casterId)) {
      return false;
    }
    if (violatesManaValueFilter(state, target.cardId, requirement)) {
      return false;
    }
    if (violatesRequiredColors(state, target.cardId, requirement)) {
      return false;
    }
    // The permanent check above recursed with a BARE {kind:"permanent"}
    // requirement, so it never saw this one's qualifiers. Without this line
    // excludedTypes, legendaryOnly, multicolored, the power bounds and both
    // subtype filters are inert for every kind in this group.
    if (violatesCharacteristicFilter(state, target.cardId, requirement)) {
      return false;
    }
    const types = characteristicsOf(state, target.cardId).types;
    switch (requirement.kind) {
      case "creature_or_planeswalker":
        return isCreature(state, target.cardId) || isPlaneswalker(state, target.cardId);
      case "artifact":
        return types.includes("artifact");
      case "enchantment":
        return types.includes("enchantment");
      case "artifact_or_enchantment":
        return types.includes("artifact") || types.includes("enchantment");
      case "creature_or_artifact":
        return isCreature(state, target.cardId) || types.includes("artifact");
      case "creature_or_enchantment":
        return isCreature(state, target.cardId) || types.includes("enchantment");
      case "creature_enchantment_or_planeswalker":
        return (
          isCreature(state, target.cardId) ||
          types.includes("enchantment") ||
          isPlaneswalker(state, target.cardId)
        );
      case "nonland_permanent":
        return !types.includes("land");
      case "noncreature_nonland_permanent":
        return !types.includes("land") && !isCreature(state, target.cardId);
      case "land":
        return (
          types.includes("land") &&
          (!requirement.nonbasicOnly ||
            !characteristicsOf(state, target.cardId).supertypes.includes("basic")) &&
          (requirement.requiredSubtypes ?? []).every((subtype) =>
            cardMatchesSubtype(state, target.cardId, subtype),
          )
        );
      case "artifact_enchantment_or_nonbasic_land":
        return (
          types.includes("artifact") ||
          types.includes("enchantment") ||
          (types.includes("land") &&
            !characteristicsOf(state, target.cardId).supertypes.includes("basic"))
        );
      case "artifact_enchantment_or_land":
        return (
          types.includes("artifact") || types.includes("enchantment") || types.includes("land")
        );
      case "artifact_creature_enchantment_or_land":
        return (
          types.includes("artifact") ||
          isCreature(state, target.cardId) ||
          types.includes("enchantment") ||
          types.includes("land")
        );
      case "artifact_enchantment_or_planeswalker":
        return (
          types.includes("artifact") ||
          types.includes("enchantment") ||
          isPlaneswalker(state, target.cardId)
        );
      case "artifact_creature_or_planeswalker":
        return (
          types.includes("artifact") ||
          isCreature(state, target.cardId) ||
          isPlaneswalker(state, target.cardId)
        );
      // "two target artifacts, creatures, and/or lands" (Ghostly Flicker).
      case "artifact_creature_or_land":
        return (
          types.includes("artifact") || isCreature(state, target.cardId) || types.includes("land")
        );
      case "planeswalker":
        return isPlaneswalker(state, target.cardId);
      case "commander":
        return isCommander(state, target.cardId);
    }
  }
  if (requirement.kind === "spell") {
    if (target.type !== "spell" || !isLegalSpellTarget(state, target.stackObjectId)) {
      return false;
    }
    // Hullbreaker Horror: "target spell you DON'T control". Parsed onto
    // the requirement and then ignored here, the filter would read as
    // decoration and the Horror could bounce its own spell.
    if (requirement.control !== undefined) {
      const entry = state.stack.find((object) => object.id === target.stackObjectId);
      if (!entry) {
        return false;
      }
      if (requirement.control === "not_own" && entry.controllerId === casterId) {
        return false;
      }
      if (requirement.control === "own" && entry.controllerId !== casterId) {
        return false;
      }
    }
    // Mental Misstep: "target spell with mana value 1" caps the stack
    // object's source mana value.
    if (requirement.maxManaValue !== undefined || requirement.minManaValue !== undefined) {
      const entry = state.stack.find((object) => object.id === target.stackObjectId);
      const card = entry?.sourceId ? state.cards[entry.sourceId] : undefined;
      const manaValue = card
        ? state.definitions[card.definitionId]?.characteristics.manaValue ?? 0
        : 0;
      if (requirement.maxManaValue !== undefined && manaValue > requirement.maxManaValue) {
        return false;
      }
      if (requirement.minManaValue !== undefined && manaValue < requirement.minManaValue) {
        return false;
      }
    }
    if (
      (requirement.requiredColors && requirement.requiredColors.length > 0) ||
      requirement.multicolored
    ) {
      // "target blue spell" (Red Elemental Blast), "target multicolored spell"
      // (Null Elemental Blast).
      const entry = state.stack.find((object) => object.id === target.stackObjectId);
      const card = entry?.sourceId ? state.cards[entry.sourceId] : undefined;
      const colors = card
        ? state.definitions[card.definitionId]?.characteristics.colors ?? []
        : [];
      if (requirement.multicolored && colors.length < 2) {
        return false;
      }
      return (requirement.requiredColors ?? []).every((color) => colors.includes(color));
    }
    return true;
  }
  if (requirement.kind === "spell_or_permanent") {
    if (target.type === "spell") {
      if (!isLegalSpellTarget(state, target.stackObjectId)) {
        return false;
      }
      // "…an opponent controls" narrows the SPELL half too. The permanent
      // half below recurses with a BARE permanent requirement, which drops
      // every qualifier this one carries — so both halves are filtered
      // here, or Sink into Stupor would happily bounce your own spell.
      if (requirement.control === undefined) {
        return true;
      }
      const entry = state.stack.find((object) => object.id === target.stackObjectId);
      if (!entry) {
        return false;
      }
      return requirement.control === "not_own"
        ? entry.controllerId !== casterId
        : entry.controllerId === casterId;
    }
    return (
      target.type === "creature" &&
      isChosenTargetLegal(state, { kind: "permanent" }, target, casterId, sourceColors) &&
      !violatesControlFilter(state, target.cardId, requirement, casterId) &&
      !violatesCharacteristicFilter(state, target.cardId, requirement)
    );
  }
  if (requirement.kind === "player_or_planeswalker") {
    if (target.type === "player") {
      return isLegalPlayerTarget(state, target.playerId);
    }
    return (
      target.type === "creature" &&
      isPlaneswalker(state, target.cardId) &&
      isChosenTargetLegal(state, { kind: "permanent" }, target, casterId, sourceColors)
    );
  }
  if (requirement.kind === "creature_spell") {
    return target.type === "spell" && isLegalSpellTarget(state, target.stackObjectId) && isCreatureSpell(state, target.stackObjectId);
  }
  if (requirement.kind === "noncreature_spell") {
    return (
      target.type === "spell" &&
      isLegalSpellTarget(state, target.stackObjectId) &&
      !isCreatureSpell(state, target.stackObjectId)
    );
  }
  if (requirement.kind === "instant_sorcery_or_ability") {
    if (target.type !== "spell" || !isLegalStackTarget(state, target.stackObjectId)) {
      return false;
    }
    const entry = state.stack.find((object) => object.id === target.stackObjectId);
    if (!entry) {
      return false;
    }
    // An ability on the stack is always fair game; a SPELL has to be an
    // instant or a sorcery, which is the half `spell_or_ability` does not
    // narrow.
    if (entry.kind !== "spell") {
      return true;
    }
    return isInstantOrSorcerySpell(state, target.stackObjectId);
  }
  if (requirement.kind === "spell_or_ability") {
    if (target.type !== "spell" || !isLegalStackTarget(state, target.stackObjectId)) {
      return false;
    }
    /**
     * Siren Stormtamer: the object must itself be aiming at the caster or
     * something they control. Read off the stack object's OWN targets —
     * without it the Siren counters anything at all, which is a much
     * better card than the printed one.
     */
    if (requirement.targetsYouOrYours) {
      const entry = state.stack.find((object) => object.id === target.stackObjectId);
      return (entry?.targets ?? []).some((aimed) =>
        aimed.type === "player"
          ? aimed.playerId === casterId
          : "cardId" in aimed
            ? state.cards[aimed.cardId]?.controllerId === casterId
            : false,
      );
    }
    return true;
  }
  if (requirement.kind === "triggered_ability_you_control") {
    if (target.type !== "spell") {
      return false;
    }
    const entry = state.stack.find((object) => object.id === target.stackObjectId);
    if (!entry || entry.kind !== "ability" || entry.controllerId !== casterId) {
      return false;
    }
    // A TRIGGERED ability, not an activated or loyalty one: those carry an
    // index of their own, and a trigger is what is left.
    return entry.activatedIndex === undefined && entry.loyaltyIndex === undefined;
  }
  if (requirement.kind === "instant_or_sorcery_spell") {
    if (
      target.type !== "spell" ||
      !isLegalSpellTarget(state, target.stackObjectId) ||
      !isInstantOrSorcerySpell(state, target.stackObjectId)
    ) {
      return false;
    }
    // Hydroelectric Specimen: "with a single target". A spell pointing at
    // two things cannot be redirected by it, and one pointing at nothing
    // has no target to change.
    if (requirement.singleTargetOnly) {
      const entry = state.stack.find((object) => object.id === target.stackObjectId);
      return (entry?.targets.length ?? 0) === 1;
    }
    return true;
  }
  if (requirement.kind === "artifact_creature_or_planeswalker_spell") {
    return (
      target.type === "spell" &&
      isLegalSpellTarget(state, target.stackObjectId) &&
      (isSpellOfType(state, target.stackObjectId, "artifact") ||
        isCreatureSpell(state, target.stackObjectId) ||
        isSpellOfType(state, target.stackObjectId, "planeswalker"))
    );
  }
  if (requirement.kind === "enchantment_instant_or_sorcery_spell") {
    return (
      target.type === "spell" &&
      isLegalSpellTarget(state, target.stackObjectId) &&
      (isInstantOrSorcerySpell(state, target.stackObjectId) ||
        isSpellOfType(state, target.stackObjectId, "enchantment"))
    );
  }
  if (requirement.kind === "instant_spell") {
    return (
      target.type === "spell" &&
      isLegalSpellTarget(state, target.stackObjectId) &&
      isSpellOfType(state, target.stackObjectId, "instant")
    );
  }
  if (target.type === "player") {
    return isLegalPlayerTarget(state, target.playerId);
  }
  if (target.type === "spell") {
    return false;
  }
  return isLegalCreatureTarget(state, target.cardId, casterId, sourceColors, sourceId);
}

/**
 * Cast-time check: the number of targets must match, and every target must be legal now.
 */
export function validateChosenTargets(
  state: GameState,
  requirements: TargetRequirement[],
  targets: ChosenTarget[],
  casterId?: PlayerId,
  sourceColors?: Color[],
  sourceId?: CardInstanceId | null,
  /** Agadeem's Awakening: the announced X bounds what may be chosen. */
  xValue?: number,
): void {
  if (requirements.length === 0) {
    if (targets.length > 0) {
      throw new Error("That spell does not require targets");
    }
    return;
  }
  if (requirements.length === 1 && requirements[0]?.variable) {
    if (targets.length === 0) {
      throw new Error("Choose at least one target");
    }
    const seen = new Set(targets.map((target) => JSON.stringify(target)));
    if (seen.size !== targets.length) {
      throw new Error("Choose each target once");
    }
    for (const target of targets) {
      if (!isChosenTargetLegal(state, requirements[0]!, target, casterId, sourceColors, sourceId)) {
        throw new Error("Illegal target");
      }
    }
    // Agadeem's Awakening: "mana value X or less" and "each a DIFFERENT
    // mana value". Both read the whole chosen SET, so they are checked
    // here rather than inside the per-target test.
    if (requirements[0]!.maxManaValueX || requirements[0]!.distinctManaValues) {
      const values = targets.map((target) =>
        "cardId" in target ? characteristicsOf(state, target.cardId).manaValue : 0,
      );
      if (requirements[0]!.maxManaValueX && values.some((value) => value > (xValue ?? 0))) {
        throw new Error("That card's mana value is above X");
      }
      if (
        requirements[0]!.distinctManaValues &&
        new Set(values).size !== values.length
      ) {
        throw new Error("Each target must have a different mana value");
      }
    }
    // Ruthless Technomancer: "with power X or less" — the sacrificed-artifact
    // count. Checked here, where the announced X is in hand.
    if (requirements[0]!.maxPowerX) {
      for (const target of targets) {
        if ("cardId" in target && creaturePower(state, target.cardId) > (xValue ?? 0)) {
          throw new Error("That creature's power is above X");
        }
      }
    }
    return;
  }
  // "Up to N other targets": trailing optional slots may stay unfilled, and
  // every chosen target must then be distinct.
  const requiredCount = requirements.filter((requirement) => !requirement.optional).length;
  if (targets.length < requiredCount || targets.length > requirements.length) {
    throw new Error(
      requiredCount === requirements.length
        ? `Expected ${requirements.length} target(s)`
        : `Expected ${requiredCount} to ${requirements.length} target(s)`,
    );
  }
  if (requiredCount !== requirements.length) {
    const seen = new Set(targets.map((target) => JSON.stringify(target)));
    if (seen.size !== targets.length) {
      throw new Error("Choose each target once");
    }
  }
  for (let index = 0; index < targets.length; index += 1) {
    const requirement = requirements[index];
    const target = targets[index];
    if (!requirement || !target || !isChosenTargetLegal(state, requirement, target, casterId, sourceColors, sourceId)) {
      throw new Error("Illegal target");
    }
    // Ruthless Technomancer: "power X or less" on a single fixed target, so
    // the announced-X bound is checked here rather than in the variable path.
    if (
      requirement.maxPowerX &&
      "cardId" in target &&
      creaturePower(state, target.cardId) > (xValue ?? 0)
    ) {
      throw new Error("That creature's power is above X");
    }
  }
}

/** Resolve-time check: at least one required target is still legal. */
export function hasLegalTargetRemaining(
  state: GameState,
  requirements: TargetRequirement[],
  targets: ChosenTarget[],
  casterId?: PlayerId,
  sourceColors?: Color[],
  sourceId?: CardInstanceId | null,
): boolean {
  if (requirements.length === 0) {
    return true;
  }
  if (requirements.length === 1 && requirements[0]?.variable) {
    return targets.some((target) =>
      isChosenTargetLegal(state, requirements[0]!, target, casterId, sourceColors, sourceId),
    );
  }
  return requirements.some((requirement, index) => {
    const target = targets[index];
    return Boolean(target && isChosenTargetLegal(state, requirement, target, casterId, sourceColors, sourceId));
  });
}

/** Legal choices for one requirement, in seat then battlefield order. */
export function legalChoicesForRequirement(
  state: GameState,
  requirement: TargetRequirement,
  casterId: PlayerId,
): ChosenTarget[] {
  if (requirement.kind === "player") {
    return livingPlayers(state).map((player) => ({ type: "player" as const, playerId: player.id }));
  }
  if (requirement.kind === "opponent") {
    return livingPlayers(state)
      .filter((player) => player.id !== casterId)
      .map((player) => ({ type: "player" as const, playerId: player.id }));
  }
  if (requirement.kind === "creature") {
    // Every qualifier a "creature" requirement can carry — control, mana
    // value, characteristics — is enforced by isChosenTargetLegal. Listing the
    // raw creature set here would offer choices the legality check then
    // refuses, which is how a filter ends up inert on the choosing path while
    // looking correct on the checking one.
    return legalCreatureTargets(state, casterId).filter((choice) =>
      isChosenTargetLegal(state, requirement, choice, casterId),
    );
  }
  if (requirement.kind === "own_creature") {
    return legalCreatureTargets(state, casterId).filter(
      (choice) =>
        choice.type === "creature" && state.cards[choice.cardId]?.controllerId === casterId,
    );
  }
  if (
    requirement.kind === "own_graveyard_card" ||
    requirement.kind === "own_graveyard_creature_card" ||
    requirement.kind === "own_graveyard_permanent_card" ||
    requirement.kind === "own_graveyard_artifact_card" ||
    requirement.kind === "own_graveyard_enchantment_card" ||
    requirement.kind === "own_graveyard_land_card" ||
    requirement.kind === "own_graveyard_instant_or_sorcery_card" ||
    requirement.kind === "own_graveyard_creature_or_planeswalker_card"
  ) {
    const caster = state.players.find((entry) => entry.id === casterId);
    return (caster?.zones.graveyard ?? [])
      .map((cardId) => ({ type: "creature" as const, cardId }))
      .filter((choice) => isChosenTargetLegal(state, requirement, choice, casterId));
  }
  if (requirement.kind === "graveyard_creature_card" || requirement.kind === "graveyard_card") {
    return livingPlayers(state)
      .flatMap((player) => player.zones.graveyard)
      .map((cardId) => ({ type: "creature" as const, cardId }))
      .filter((choice) => isChosenTargetLegal(state, requirement, choice, casterId));
  }
  if (
    requirement.kind === "permanent" ||
    requirement.kind === "creature_or_planeswalker" ||
    requirement.kind === "artifact" ||
    requirement.kind === "enchantment" ||
    requirement.kind === "artifact_or_enchantment" ||
    requirement.kind === "creature_or_artifact" ||
    requirement.kind === "creature_or_enchantment" ||
    requirement.kind === "creature_enchantment_or_planeswalker" ||
    requirement.kind === "nonland_permanent" ||
    requirement.kind === "noncreature_nonland_permanent" ||
    requirement.kind === "land" ||
    requirement.kind === "artifact_enchantment_or_nonbasic_land" ||
    requirement.kind === "artifact_enchantment_or_land" ||
    requirement.kind === "artifact_creature_enchantment_or_land" ||
    requirement.kind === "artifact_enchantment_or_planeswalker" ||
    requirement.kind === "artifact_creature_or_planeswalker" ||
    requirement.kind === "artifact_creature_or_land" ||
    requirement.kind === "planeswalker" ||
    requirement.kind === "commander"
  ) {
    const choices: ChosenTarget[] = [];
    for (const player of livingPlayers(state)) {
      for (const cardId of player.zones.battlefield) {
        const choice: ChosenTarget = { type: "creature", cardId };
        if (isChosenTargetLegal(state, requirement, choice, casterId)) {
          choices.push(choice);
        }
      }
    }
    return choices;
  }
  if (requirement.kind === "nonartifact_creature") {
    return legalCreatureTargets(state, casterId).filter(
      (choice) => choice.type === "creature" && !isArtifactPermanent(state, choice.cardId),
    );
  }
  if (
    requirement.kind === "spell" ||
    requirement.kind === "creature_spell" ||
    requirement.kind === "noncreature_spell" ||
    requirement.kind === "instant_or_sorcery_spell" ||
    requirement.kind === "enchantment_instant_or_sorcery_spell" ||
    requirement.kind === "artifact_creature_or_planeswalker_spell" ||
    requirement.kind === "instant_spell"
  ) {
    return state.stack
      .filter((entry) => entry.kind === "spell")
      .map((entry) => ({ type: "spell" as const, stackObjectId: entry.id }))
      .filter((choice) => isChosenTargetLegal(state, requirement, choice, casterId));
  }
  // Return the Favor and Spellskite: the pool is every stack object, not
  // only the spells — an ability is exactly what these are printed to
  // reach, and the legality check narrows from there.
  if (
    requirement.kind === "spell_or_ability" ||
    requirement.kind === "instant_sorcery_or_ability"
  ) {
    return state.stack
      .map((entry) => ({ type: "spell" as const, stackObjectId: entry.id }))
      .filter((choice) => isChosenTargetLegal(state, requirement, choice, casterId));
  }
  if (requirement.kind === "player_or_planeswalker") {
    const walkers: ChosenTarget[] = [];
    for (const player of livingPlayers(state)) {
      for (const cardId of player.zones.battlefield) {
        const choice: ChosenTarget = { type: "creature", cardId };
        if (isChosenTargetLegal(state, requirement, choice, casterId)) {
          walkers.push(choice);
        }
      }
    }
    return [
      ...livingPlayers(state).map((player) => ({ type: "player" as const, playerId: player.id })),
      ...walkers,
    ];
  }
  if (requirement.kind === "spell_or_permanent") {
    const spells = state.stack
      .filter((entry) => entry.kind === "spell")
      .map((entry) => ({ type: "spell" as const, stackObjectId: entry.id }))
      // Unfiltered, this offered a choice the legality check would then
      // refuse — the enumeration has to narrow by the same qualifiers.
      .filter((choice) => isChosenTargetLegal(state, requirement, choice, casterId));
    const permanents: ChosenTarget[] = [];
    for (const player of livingPlayers(state)) {
      for (const cardId of player.zones.battlefield) {
        const choice: ChosenTarget = { type: "creature", cardId };
        if (isChosenTargetLegal(state, requirement, choice, casterId)) {
          permanents.push(choice);
        }
      }
    }
    return [...spells, ...permanents];
  }
  return [
    ...livingPlayers(state).map((player) => ({ type: "player" as const, playerId: player.id })),
    ...legalCreatureTargets(state, casterId),
  ];
}

function legalCreatureTargets(state: GameState, casterId: PlayerId): ChosenTarget[] {
  const choices: ChosenTarget[] = [];
  for (const player of state.players) {
    for (const cardId of player.zones.battlefield) {
      if (isLegalCreatureTarget(state, cardId, casterId)) {
        choices.push({ type: "creature", cardId });
      }
    }
  }
  return choices;
}

export function hasAnyLegalTargetSet(
  state: GameState,
  requirements: TargetRequirement[],
  casterId: PlayerId,
): boolean {
  if (requirements.length === 0) {
    return true;
  }
  return requirements
    .filter((requirement) => !requirement.optional)
    .every((requirement) => legalChoicesForRequirement(state, requirement, casterId).length > 0);
}

/** First legal target per requirement, or null if any requirement has none. */
export function firstLegalTargetSet(
  state: GameState,
  requirements: TargetRequirement[],
  casterId: PlayerId,
): ChosenTarget[] | null {
  const chosen: ChosenTarget[] = [];
  for (const requirement of requirements) {
    const pick = legalChoicesForRequirement(state, requirement, casterId)[0];
    if (!pick) {
      return null;
    }
    chosen.push(pick);
  }
  return chosen;
}
