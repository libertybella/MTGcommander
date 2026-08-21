import type { ActivatedAbility, CardDefinition, CardEffect, ManaAbility, TokenTemplate } from "./types";

/**
 * Built-in abilities for the evergreen predefined artifact tokens. Data, not
 * card-specific code: applyCreateToken merges these into any token whose type
 * line carries the subtype, however it was created.
 */
export type TokenPreset = {
  manaAbilities?: ManaAbility[];
  activated?: ActivatedAbility[];
  /** Shapeshifter tokens (Maskwood Nexus): changeling. */
  changeling?: boolean;
};

export function tokenPresetFor(typeLine: string): TokenPreset | null {
  const lower = typeLine.toLowerCase();
  if (lower.includes("treasure")) {
    return {
      // "{T}, Sacrifice this artifact: Add one mana of any color."
      manaAbilities: [
        {
          produces: {},
          producesOptions: [],
          producesAnyColor: true,
          damageToController: 0,
          sacrificeSelf: true,
        },
      ],
    };
  }
  if (lower.includes("clue")) {
    return {
      // "{2}, Sacrifice this artifact: Draw a card."
      activated: [
        {
          tap: false,
          manaCost: "{2}",
          sacrificeSelf: true,
          effects: [{ kind: "draw", playerId: "controller", count: 1 }],
          targetRequirements: [],
        },
      ],
    };
  }
  if (lower.includes("shapeshifter")) {
    // "with changeling" — the token is every creature type.
    return { changeling: true };
  }
  if (lower.includes("spawn")) {
    return {
      // Eldrazi Spawn: "Sacrifice this token: Add {C}."
      manaAbilities: [
        {
          produces: { C: 1 },
          producesOptions: [],
          producesAnyColor: false,
          damageToController: 0,
          sacrificeSelf: true,
          noTap: true,
        },
      ],
    };
  }
  if (lower.includes("food")) {
    return {
      // "{2}, {T}, Sacrifice this artifact: You gain 3 life."
      activated: [
        {
          tap: true,
          manaCost: "{2}",
          sacrificeSelf: true,
          effects: [{ kind: "gain_life", playerId: "controller", amount: 3 }],
          targetRequirements: [],
        },
      ],
    };
  }
  return null;
}

function singularizeType(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length > 3 && /s$/i.test(trimmed) && !/ss$/i.test(trimmed)) {
    return trimmed.slice(0, -1);
  }
  return trimmed;
}

export function amassArmyTemplate(subtype?: string): TokenTemplate {
  const creatureType = subtype ? `${singularizeType(subtype)} Army` : "Army";
  return {
    name: creatureType,
    typeLine: `Creature — ${creatureType} Token`,
    power: 0,
    toughness: 0,
  };
}

function amassOverrideTemplate(subtype?: string): TokenTemplate {
  return { ...amassArmyTemplate(subtype), power: 1, toughness: 1 };
}

export function parseAmassClause(sentence: string): {
  amount: number;
  subtype?: string;
  rest?: string;
} | null {
  const match = sentence.match(/^amass(?: ([A-Za-z]+))?(?: (\d+))?(?:, then (.+))?$/i);
  if (!match) {
    return null;
  }
  const amount = match[2] ? Number(match[2]) : 1;
  if (!Number.isInteger(amount) || amount <= 0) {
    return null;
  }
  return {
    amount,
    ...(match[1] ? { subtype: singularizeType(match[1]) } : {}),
    ...(match[3] ? { rest: `Then ${match[3].trim()}` } : {}),
  };
}

function addTemplate(list: TokenTemplate[], template: TokenTemplate): void {
  if (
    list.some(
      (entry) =>
        entry.name === template.name &&
        entry.typeLine === template.typeLine &&
        entry.power === template.power &&
        entry.toughness === template.toughness,
    )
  ) {
    return;
  }
  list.push(template);
}

function collectFromEffects(effects: CardEffect[], list: TokenTemplate[]): void {
  for (const effect of effects) {
    if (effect.kind === "create_token") {
      addTemplate(list, {
        name: effect.name,
        typeLine: effect.typeLine,
        power: effect.power ?? null,
        toughness: effect.toughness ?? null,
      });
    }
    if (effect.kind === "amass") {
      addTemplate(list, amassOverrideTemplate(effect.subtype));
    }
    if (effect.kind === "choose_card") {
      collectFromEffects(effect.thenEffects, list);
    }
  }
}

function collectFromOracle(oracleText: string, list: TokenTemplate[]): void {
  const text = oracleText.replace(/\([^)]*\)/g, " ");
  for (const part of text.split(/[.\n]+/)) {
    const sentence = part.replace(/\s+/g, " ").trim();
    if (!sentence) {
      continue;
    }
    const amass = parseAmassClause(sentence.replace(/^whenever [^,]+, /i, "").replace(/^when [^,]+, /i, ""));
    if (amass) {
      addTemplate(list, amassOverrideTemplate(amass.subtype));
    }
    const create = sentence.match(
      /^Create (?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) (\d+)\/(\d+)(?: (?:white|blue|black|red|green|colorless))? ([\w]+(?: [\w]+)?) creature tokens?$/i,
    );
    if (create?.[1] && create[2] && create[4]) {
      const subtype = create[4].replace(/\b\w/g, (letter) => letter.toUpperCase());
      addTemplate(list, {
        name: subtype,
        typeLine: `Creature — ${subtype} Token`,
        power: Number(create[1]),
        toughness: Number(create[2]),
      });
    }
  }
}

/** Token types a card can produce, for the right-click override. */
export function tokenTemplatesOf(definition: CardDefinition): TokenTemplate[] {
  const list: TokenTemplate[] = [];
  collectFromEffects(definition.effects, list);
  for (const trigger of definition.triggers) {
    collectFromEffects(trigger.effects, list);
  }
  for (const ability of definition.activated) {
    collectFromEffects(ability.effects, list);
  }
  collectFromOracle(definition.oracleText, list);
  return list;
}
