import { computedCard } from "./characteristicsEngine";
import type { CardInstanceId, Color, GameState, Keyword, ProtectionFrom } from "./types";

/**
 * A card's current keywords. Battlefield objects go through the layer engine
 * (grants, removals, until-end-of-turn effects); elsewhere the printed
 * definition applies.
 */
export function cardKeywords(state: GameState, cardId: CardInstanceId): Keyword[] {
  const card = state.cards[cardId];
  if (!card) {
    return [];
  }
  if (card.zone === "battlefield") {
    return computedCard(state, cardId)?.keywords ?? [];
  }
  return state.definitions[card.definitionId]?.keywords ?? [];
}

export function hasKeyword(state: GameState, cardId: CardInstanceId, keyword: Keyword): boolean {
  return cardKeywords(state, cardId).includes(keyword);
}

/**
 * What a card has protection from: printed protection plus layer-6 grants
 * ("gain protection from each color") for battlefield objects.
 */
export function protectionOf(state: GameState, cardId: CardInstanceId): ProtectionFrom {
  const card = state.cards[cardId];
  if (!card) {
    return {};
  }
  if (card.zone === "battlefield") {
    return computedCard(state, cardId)?.protectionFrom ?? {};
  }
  return state.definitions[card.definitionId]?.protectionFrom ?? {};
}

/**
 * Does this protection stop a source with these traits? Every field of a
 * ProtectionFrom is a separate quality and they OR together (CR 702.16e).
 *
 * ONE predicate for all of it. The thirteen sites that ask this question
 * each used to spell out `protection.some(color => sourceColors.includes(
 * color))`, which is why a protection naming anything but a colour could
 * not be added: the shape was hard-coded thirteen times.
 */
export function protectedFromTraits(
  protection: ProtectionFrom,
  traits: { colors: Color[]; types?: string[]; subtypes?: string[] },
): boolean {
  if (protection.everything) {
    return true;
  }
  if (protection.colors?.some((color) => traits.colors.includes(color))) {
    return true;
  }
  if (protection.multicolored && traits.colors.length > 1) {
    return true;
  }
  if (protection.colorless && traits.colors.length === 0) {
    return true;
  }
  if (protection.types?.some((type) => traits.types?.includes(type))) {
    return true;
  }
  if (protection.subtypes?.some((subtype) => traits.subtypes?.includes(subtype))) {
    return true;
  }
  return false;
}

/**
 * Is `protectedId` protected from `sourceId`? Traits are read from the
 * source's COMPUTED characteristics where the source is a real object;
 * `fallbackColors` covers the callers that only have a colour list (a spell
 * whose card has already left the stack).
 */
/**
 * "Hexproof from black" (CR 702.11e). Unlike protection this ONLY stops
 * targeting, and like plain hexproof it only stops opponents — so the
 * caller passes the caster and the check is skipped for the permanent's
 * own controller.
 *
 * The source's computed colours are used when there is a source; a spell
 * that has already left the stack falls back to the colours the caller
 * carried, exactly as `protectedFromSource` does.
 */
export function hexproofFromSource(
  state: GameState,
  protectedId: CardInstanceId,
  sourceId: CardInstanceId | null,
  fallbackColors?: Color[],
): boolean {
  const shield = computedCard(state, protectedId)?.hexproofFrom ?? [];
  if (shield.length === 0) {
    return false;
  }
  const source = sourceId ? state.cards[sourceId] : undefined;
  const colors = source
    ? computedCard(state, sourceId!)?.characteristics.colors ??
      state.definitions[source.definitionId]?.characteristics.colors ??
      []
    : fallbackColors ?? [];
  return colors.some((color) => shield.includes(color));
}

export function protectedFromSource(
  state: GameState,
  protectedId: CardInstanceId,
  sourceId: CardInstanceId | null,
  fallbackColors?: Color[],
): boolean {
  const protection = protectionOf(state, protectedId);
  if (
    protection.everything !== true &&
    protection.colors === undefined &&
    protection.types === undefined &&
    protection.subtypes === undefined &&
    protection.multicolored !== true &&
    protection.colorless !== true
  ) {
    return false;
  }
  const source = sourceId ? state.cards[sourceId] : undefined;
  if (source) {
    const computed = computedCard(state, sourceId!);
    const printed = state.definitions[source.definitionId]?.characteristics;
    const traits = computed?.characteristics ?? printed;
    if (traits) {
      return protectedFromTraits(protection, traits);
    }
  }
  return protectedFromTraits(protection, { colors: fallbackColors ?? [] });
}
