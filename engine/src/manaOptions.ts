import { cardMatchesSubtype, computedCard } from "./characteristicsEngine";
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
/** "Activate only if you control a Swamp" on a mana ability (Cabal-class). */
function manaGateSatisfied(state: GameState, controllerId: string, ability: ManaAbility): boolean {
  // Mox Opal: "Activate only if you control three or more artifacts."
  if (ability.requiresCount) {
    const { what, atLeast } = ability.requiresCount;
    const count = Object.values(state.cards).filter(
      (card) =>
        card.zone === "battlefield" &&
        card.controllerId === controllerId &&
        (state.definitions[card.definitionId]?.characteristics.types ?? []).includes(what),
    ).length;
    if (count < atLeast) {
      return false;
    }
  }
  const gate = ability.requiresControlled;
  if (!gate) {
    return true;
  }
  return Object.values(state.cards).some((card) => {
    if (card.zone !== "battlefield" || card.controllerId !== controllerId) {
      return false;
    }
    const traits = state.definitions[card.definitionId]?.characteristics;
    if (!traits) {
      return false;
    }
    return (
      (gate.types ?? []).every((type) => traits.types.includes(type)) &&
      (gate.subtypes ?? []).every((subtype) => cardMatchesSubtype(state, card.id, subtype))
    );
  });
}

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
  return abilities.filter(
    (ability) =>
      manaGateSatisfied(state, card.controllerId, ability) &&
      sacrificeFodderAvailable(state, card.controllerId, ability),
  );
}

/** Phyrexian Altar-class: the sacrifice-cost ability needs legal fodder. */
function sacrificeFodderAvailable(
  state: GameState,
  controllerId: string,
  ability: ManaAbility,
): boolean {
  const scope = ability.costSacrifice;
  if (!scope) {
    return true;
  }
  return Object.values(state.cards).some((card) => {
    if (card.zone !== "battlefield" || card.controllerId !== controllerId) {
      return false;
    }
    const types = state.definitions[card.definitionId]?.characteristics.types ?? [];
    if (scope === "creature") {
      return types.includes("creature");
    }
    if (scope === "artifact") {
      return types.includes("artifact");
    }
    if (scope === "land") {
      return types.includes("land");
    }
    return types.includes("creature") || types.includes("artifact");
  });
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
