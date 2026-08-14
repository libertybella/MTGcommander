import { COLOR_PIPS, MANA_COLORS } from "./mana";
import type { CardDefinition, ManaColor } from "./types";

export function manaTapOptions(definition: CardDefinition): ManaColor[] | null {
  if (definition.producesAnyColor) {
    return [...COLOR_PIPS];
  }
  if (definition.producesOptions.length > 0) {
    return [...definition.producesOptions];
  }
  return null;
}

export function canTapForMana(definition: CardDefinition): boolean {
  if (manaTapOptions(definition)) {
    return true;
  }
  return MANA_COLORS.some((color) => (definition.produces[color] ?? 0) > 0);
}
