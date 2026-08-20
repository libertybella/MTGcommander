import { COLOR_PIPS, MANA_COLORS } from "./mana";
import type { CardDefinition, ManaAbility, ManaColor } from "./types";

export function manaAbilitiesOf(definition: CardDefinition): ManaAbility[] {
  if (definition.manaAbilities.length > 0) {
    return definition.manaAbilities;
  }
  if (definition.producesAnyColor) {
    return [
      {
        produces: {},
        producesOptions: [],
        producesAnyColor: true,
        damageToController: 0,
      },
    ];
  }
  if (definition.producesOptions.length > 0) {
    return [
      {
        produces: {},
        producesOptions: [...definition.producesOptions],
        producesAnyColor: false,
        damageToController: 0,
      },
    ];
  }
  if (MANA_COLORS.some((color) => (definition.produces[color] ?? 0) > 0)) {
    return [
      {
        produces: { ...definition.produces },
        producesOptions: [],
        producesAnyColor: false,
        damageToController: 0,
      },
    ];
  }
  return [];
}

export function manaAbilityAmount(ability: ManaAbility): number {
  return ability.count && ability.count > 0 ? ability.count : 1;
}

export function manaTapOptionsFor(ability: ManaAbility): ManaColor[] | null {
  if (ability.producesAnyColor) {
    return [...COLOR_PIPS];
  }
  if (ability.producesOptions.length > 0) {
    return [...ability.producesOptions];
  }
  return null;
}

export function manaTapOptions(definition: CardDefinition): ManaColor[] | null {
  const abilities = manaAbilitiesOf(definition);
  if (abilities.length !== 1) {
    return null;
  }
  return manaTapOptionsFor(abilities[0]!);
}

export function canTapForMana(definition: CardDefinition): boolean {
  return manaAbilitiesOf(definition).length > 0;
}
