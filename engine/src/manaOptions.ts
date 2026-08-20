import { computedCard } from "./characteristicsEngine";
import { COLOR_PIPS, MANA_COLORS } from "./mana";
import type { CardDefinition, CardInstanceId, GameState, ManaAbility, ManaColor } from "./types";

const BASIC_SUBTYPE_COLOR: Record<string, ManaColor> = {
  plains: "W",
  island: "U",
  swamp: "B",
  mountain: "R",
  forest: "G",
};

/**
 * State-aware mana abilities: the printed list (silenced by Humility), plus
 * abilities granted by statics (Cryptolith Rite), plus the intrinsic mana of
 * basic land subtypes the permanent has GAINED (Urborg — CR 305.6). Printed
 * basics already carry their color in `produces`, so only extra subtypes add.
 */
export function manaAbilitiesFor(state: GameState, cardId: CardInstanceId): ManaAbility[] {
  const card = state.cards[cardId];
  const definition = card ? state.definitions[card.definitionId] : undefined;
  if (!card || !definition) {
    return [];
  }
  if (card.zone !== "battlefield") {
    return manaAbilitiesOf(definition);
  }
  const computed = computedCard(state, cardId);
  if (computed?.abilitiesRemoved) {
    return [...(computed?.grantedMana ?? [])];
  }
  const abilities = [...manaAbilitiesOf(definition), ...(computed?.grantedMana ?? [])];
  if (computed?.characteristics.types.includes("land")) {
    const printedColors = new Set<ManaColor>();
    for (const ability of abilities) {
      for (const color of MANA_COLORS) {
        if ((ability.produces[color] ?? 0) > 0) {
          printedColors.add(color);
        }
      }
      for (const color of ability.producesOptions) {
        printedColors.add(color);
      }
      if (ability.producesAnyColor) {
        for (const color of COLOR_PIPS) {
          printedColors.add(color);
        }
      }
    }
    for (const subtype of computed.characteristics.subtypes) {
      const color = BASIC_SUBTYPE_COLOR[subtype];
      if (color && !printedColors.has(color)) {
        abilities.push({
          produces: { [color]: 1 },
          producesOptions: [],
          producesAnyColor: false,
          damageToController: 0,
        });
        printedColors.add(color);
      }
    }
  }
  return abilities;
}

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
