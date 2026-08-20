import { parseManaCost } from "./mana";
import { parseAmassClause } from "./tokens";
import type {
  ActivatedAbility,
  CardEffect,
  CardTrigger,
  ChooseCardSource,
  Color,
  EnterTappedUnless,
  Keyword,
  LoyaltyAbility,
  ManaAbility,
  ManaColor,
  ManaPool,
  ReplacementEffect,
  SearchFilter,
  SpellMode,
  StaticAbility,
  TargetRequirement,
} from "./types";
import type { OracleCard } from "./oracle";

export type CompiledOracleText = {
  effects: CardEffect[];
  targetRequirements: TargetRequirement[];
  activated: ActivatedAbility[];
  triggers: CardTrigger[];
  replacements: ReplacementEffect[];
  staticAbilities: StaticAbility[];
  produces: Partial<ManaPool>;
  producesAnyColor: boolean;
  producesOptions: ManaColor[];
  manaAbilities: ManaAbility[];
  ward?: number;
  modes?: SpellMode[];
  protectionFrom?: Color[];
  enchant?: "creature";
  loyaltyAbilities?: LoyaltyAbility[];
  leftover: string[];
  notes: string[];
};

const KEYWORD_LINE = new Set([
  "flying",
  "reach",
  "haste",
  "vigilance",
  "trample",
  "deathtouch",
  "lifelink",
  "first strike",
  "double strike",
  "menace",
  "hexproof",
  "shroud",
  "indestructible",
  "flash",
  "defender",
  "fear",
  "intimidate",
  "horsemanship",
  "shadow",
  "skulk",
]);

const BASIC_TYPE_MANA: Record<string, Color> = {
  plains: "W",
  island: "U",
  swamp: "B",
  mountain: "R",
  forest: "G",
};

/** Keywords a sentence can grant ("All Slivers have shroud", "gains flying"). */
const KEYWORD_GRANTS: Record<string, Keyword> = {
  flying: "flying",
  reach: "reach",
  haste: "haste",
  vigilance: "vigilance",
  trample: "trample",
  deathtouch: "deathtouch",
  lifelink: "lifelink",
  "first strike": "first_strike",
  "double strike": "double_strike",
  menace: "menace",
  hexproof: "hexproof",
  indestructible: "indestructible",
  shroud: "shroud",
  defender: "defender",
  fear: "fear",
  intimidate: "intimidate",
  horsemanship: "horsemanship",
  shadow: "shadow",
  skulk: "skulk",
};

const COUNT_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

export function stripReminderText(oracleText: string): string {
  return oracleText.replace(/\([^)]*\)/g, " ");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseCount(raw: string): number | null {
  const text = raw.trim().toLowerCase();
  if (/^\d+$/.test(text)) {
    const amount = Number(text);
    return amount > 0 ? amount : null;
  }
  return COUNT_WORDS[text] ?? null;
}

export function splitOracleSentences(card: OracleCard): string[] {
  const printedName = card.name.includes(" // ") ? (card.name.split(" // ")[0] ?? card.name) : card.name;
  let text = stripReminderText(card.oracleText).replace(/\r/g, "");
  text = text.replace(new RegExp(escapeRegex(printedName), "gi"), "~");
  const shortName = printedName.split(",")[0]?.trim();
  if (shortName && shortName !== printedName) {
    text = text.replace(new RegExp(`\\b${escapeRegex(shortName)}\\b`, "gi"), "~");
  }
  text = text.replace(/\bthis (?:creature|artifact|enchantment|land|permanent|planeswalker)\b/gi, "~");
  text = text.replace(/\benters the battlefield\b/gi, "enters");
  return text
    .split(/[.\n]+/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function isKeywordLine(sentence: string): boolean {
  const parts = sentence
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  return parts.length > 0 && parts.every((part) => KEYWORD_LINE.has(part));
}

const SACRIFICE_COST = /Sacrifice (?:~|this land|this creature|this artifact|this permanent)/i;
const LIFE_COST = /Pay (\d+) life/i;
const COST_UNIT =
  "(?:\\{[^}]+\\})+|Sacrifice (?:~|this land|this creature|this artifact|this permanent)|Pay \\d+ life";

function splitAbility(sentence: string): { costText: string; rest: string } | null {
  const match = sentence.match(
    new RegExp(`^((?:${COST_UNIT})(?:,\\s*(?:${COST_UNIT}))*):\\s*(.+)$`, "i"),
  );
  if (!match?.[1] || !match[2]) {
    return null;
  }
  return { costText: match[1], rest: match[2].trim() };
}

function parseAbilityCost(
  costText: string,
): { tap: boolean; manaCost: string; sacrificeSelf: boolean; lifeCost?: number } | null {
  const sacrificeSelf = SACRIFICE_COST.test(costText);
  const lifeMatch = costText.match(LIFE_COST);
  const lifeCost = lifeMatch?.[1] ? Number(lifeMatch[1]) : undefined;
  const symbols = [...costText.matchAll(/\{([^}]+)\}/g)].map((match) => match[1] ?? "");
  if (symbols.length === 0 && !sacrificeSelf && !lifeCost) {
    return null;
  }
  let tap = false;
  const mana: string[] = [];
  for (const symbol of symbols) {
    if (symbol === "T") {
      tap = true;
      continue;
    }
    if (symbol === "Q" || symbol === "X" || /P/.test(symbol)) {
      return null;
    }
    mana.push(`{${symbol}}`);
  }
  const manaCost = mana.join("");
  try {
    parseManaCost(manaCost);
  } catch {
    return null;
  }
  return { tap, manaCost, sacrificeSelf, ...(lifeCost ? { lifeCost } : {}) };
}

function parseControlledTypes(text: string): string[] | null {
  const parts = text.split(/\s+or\s+/i).map((part) => part.trim());
  const types: string[] = [];
  for (const part of parts) {
    const match = part.match(/^an?\s+(.+)$/i);
    if (!match?.[1]) {
      return null;
    }
    const name = match[1].trim().toLowerCase();
    if (!name || name.includes(" ")) {
      return null;
    }
    types.push(name);
  }
  return types.length > 0 ? types : null;
}

function compileControlCondition(text: string): EnterTappedUnless | null {
  const rest = text.trim();
  if (/^two or more other lands$/i.test(rest)) {
    return { kind: "other_lands", count: 2 };
  }
  if (/^two or more basic lands$/i.test(rest)) {
    return { kind: "basic_lands", count: 2 };
  }
  if (/^a legendary creature$/i.test(rest)) {
    return { kind: "legendary_creature" };
  }
  const types = parseControlledTypes(rest);
  if (!types) {
    return null;
  }
  return { kind: "controlled_types", types };
}

function compileEntersTappedUnless(sentence: string): ReplacementEffect | null {
  const match = sentence.match(/^~ enters tapped unless you control (.+)$/i);
  if (!match?.[1]) {
    return null;
  }
  const unless = compileControlCondition(match[1]);
  return unless ? { kind: "enters_tapped_unless", unless } : null;
}

function compileEntersTappedIf(sentence: string): ReplacementEffect | null {
  const match = sentence.match(/^If you control (.+), ~ enters tapped$/i);
  if (!match?.[1]) {
    return null;
  }
  const condition = compileControlCondition(match[1]);
  return condition ? { kind: "enters_tapped_if", if: condition } : null;
}

function manaAbilityFromAdd(add: AddManaResult): ManaAbility {
  if (add.kind === "fixed") {
    return {
      produces: add.produces,
      producesOptions: [],
      producesAnyColor: false,
      damageToController: 0,
    };
  }
  if (add.kind === "any_color") {
    return {
      produces: {},
      producesOptions: [],
      producesAnyColor: true,
      damageToController: 0,
      ...(add.count && add.count > 1 ? { count: add.count } : {}),
    };
  }
  return {
    produces: {},
    producesOptions: add.colors,
    producesAnyColor: false,
    damageToController: 0,
  };
}

function copyFirstManaAbility(result: CompiledOracleText): void {
  const first = result.manaAbilities[0];
  if (!first) {
    return;
  }
  result.produces = first.produces;
  result.producesAnyColor = first.producesAnyColor;
  result.producesOptions = first.producesOptions;
}

type AddManaResult =
  | { kind: "fixed"; produces: Partial<ManaPool> }
  | { kind: "any_color"; identityRestricted: boolean; count?: number }
  | { kind: "or"; colors: ManaColor[] };

function parseAddMana(rest: string): AddManaResult | null {
  const text = rest.trim();
  const identity = /any color in your commander'?s color identity/i.test(text);
  if (/^Add one mana of any color(?: in your commander'?s color identity)?$/i.test(text)) {
    return { kind: "any_color", identityRestricted: identity };
  }
  const big = text.match(/^Add (two|three|four|five) mana of any one color$/i);
  if (big?.[1]) {
    return { kind: "any_color", identityRestricted: false, count: parseCount(big[1]) ?? 1 };
  }
  if (!/^Add /i.test(text)) {
    return null;
  }
  const symbols = [...text.matchAll(/\{([WUBRGC])\}/g)].map((match) => match[1] as ManaColor);
  if (symbols.length === 0) {
    return null;
  }
  if (/\bor\b/i.test(text) || /any color/i.test(text) || /choose/i.test(text)) {
    const unique = [...new Set(symbols)];
    if (unique.length === 0) {
      return null;
    }
    return { kind: "or", colors: unique };
  }
  const produces: Partial<ManaPool> = {};
  for (const color of symbols) {
    produces[color] = (produces[color] ?? 0) + 1;
  }
  return { kind: "fixed", produces };
}

function basicTypeColors(typeLine: string): Color[] {
  const lower = typeLine.toLowerCase();
  const colors: Color[] = [];
  for (const [landType, color] of Object.entries(BASIC_TYPE_MANA)) {
    if (new RegExp(`\\b${landType}\\b`).test(lower)) {
      colors.push(color);
    }
  }
  return colors;
}

type SimpleClause = {
  effects: CardEffect[];
  targetRequirements: TargetRequirement[];
  leftover?: string;
};

function compileSimpleClause(sentence: string): SimpleClause | null {
  const amass = parseAmassClause(sentence);
  if (amass) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "amass",
          playerId: "controller",
          amount: amass.amount,
          ...(amass.subtype ? { subtype: amass.subtype } : {}),
        },
      ],
      ...(amass.rest ? { leftover: amass.rest } : {}),
    };
  }

  if (/^(?:then )?discard a card unless you attacked this turn$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [{ kind: "discard_unless_attacked", playerId: "controller", count: 1 }],
    };
  }

  let match =
    sentence.match(/^(?:~ )?deals (\d+) damage to any target$/i) ??
    sentence.match(/^deal (\d+) damage to any target$/i);
  if (match?.[1]) {
    return {
      targetRequirements: [{ kind: "player_or_creature" }],
      effects: [
        {
          kind: "deal_damage",
          sourceId: "self",
          target: { type: "chosen", index: 0 },
          amount: Number(match[1]),
        },
      ],
    };
  }

  if (/^(?:~ )?deals? X damage to any target$/i.test(sentence)) {
    return {
      targetRequirements: [{ kind: "player_or_creature" }],
      effects: [
        { kind: "deal_damage", sourceId: "self", target: { type: "chosen", index: 0 }, amount: "x" },
      ],
    };
  }

  if (
    /^(?:~ )?deals? X damage divided as you choose among (?:any number of|one, two, or three) targets?$/i.test(
      sentence,
    )
  ) {
    return {
      targetRequirements: [{ kind: "player_or_creature", variable: true }],
      effects: [{ kind: "divided_damage", sourceId: "self", amount: "x" }],
    };
  }

  match = sentence.match(/^(?:~ )?deals (\d+) damage to target creature$/i);
  if (match?.[1]) {
    return {
      targetRequirements: [{ kind: "creature" }],
      effects: [
        {
          kind: "deal_damage",
          sourceId: "self",
          target: { type: "chosen", index: 0 },
          amount: Number(match[1]),
        },
      ],
    };
  }

  match = sentence.match(/^(?:you )?gain (\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten) life$/i);
  if (match?.[1]) {
    const amount = parseCount(match[1]);
    if (amount) {
      return {
        targetRequirements: [],
        effects: [{ kind: "gain_life", playerId: "controller", amount }],
      };
    }
  }

  match = sentence.match(/^target player gains (\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten) life$/i);
  if (match?.[1]) {
    const amount = parseCount(match[1]);
    if (amount) {
      return {
        targetRequirements: [{ kind: "player" }],
        effects: [{ kind: "gain_life", playerId: { type: "chosen", index: 0 }, amount }],
      };
    }
  }

  match = sentence.match(/^(?:you )?lose (\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten) life$/i);
  if (match?.[1]) {
    const amount = parseCount(match[1]);
    if (amount) {
      return {
        targetRequirements: [],
        effects: [{ kind: "lose_life", playerId: "controller", amount }],
      };
    }
  }

  match = sentence.match(/^target player loses (\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten) life$/i);
  if (match?.[1]) {
    const amount = parseCount(match[1]);
    if (amount) {
      return {
        targetRequirements: [{ kind: "player" }],
        effects: [{ kind: "lose_life", playerId: { type: "chosen", index: 0 }, amount }],
      };
    }
  }

  match = sentence.match(/^each opponent loses (\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten) life$/i);
  if (match?.[1]) {
    const amount = parseCount(match[1]);
    if (amount) {
      return {
        targetRequirements: [],
        effects: [{ kind: "lose_life", playerId: "each_opponent", amount }],
      };
    }
  }

  match =
    sentence.match(/^(?:you )?draw (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?$/i) ??
    sentence.match(/^draw (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?$/i);
  if (match?.[1]) {
    const count = parseCount(match[1]);
    if (count) {
      return {
        targetRequirements: [],
        effects: [{ kind: "draw", playerId: "controller", count }],
      };
    }
  }

  match = sentence.match(/^scry (\d+)$/i);
  if (match?.[1]) {
    const count = Number(match[1]);
    if (count > 0) {
      return {
        targetRequirements: [],
        effects: [{ kind: "scry", playerId: "controller", count }],
      };
    }
  }

  match = sentence.match(/^surveil (\d+)$/i);
  if (match?.[1]) {
    const count = Number(match[1]);
    if (count > 0) {
      return {
        targetRequirements: [],
        effects: [{ kind: "surveil", playerId: "controller", count }],
      };
    }
  }

  match = sentence.match(
    /^target player draws (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? and loses (\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten) life$/i,
  );
  if (match?.[1] && match[2]) {
    const count = parseCount(match[1]);
    const amount = parseCount(match[2]);
    if (count && amount) {
      return {
        targetRequirements: [{ kind: "player" }],
        effects: [
          { kind: "draw", playerId: { type: "chosen", index: 0 }, count },
          { kind: "lose_life", playerId: { type: "chosen", index: 0 }, amount },
        ],
      };
    }
  }

  match = sentence.match(
    /^Scry (\d+), then draw (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?$/i,
  );
  if (match?.[1] && match[2]) {
    const scryCount = Number(match[1]);
    const drawCount = parseCount(match[2]);
    if (scryCount > 0 && drawCount) {
      return {
        targetRequirements: [],
        effects: [
          { kind: "scry", playerId: "controller", count: scryCount },
          { kind: "draw", playerId: "controller", count: drawCount },
        ],
      };
    }
  }

  match = sentence.match(
    /^target player draws (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?$/i,
  );
  if (match?.[1]) {
    const count = parseCount(match[1]);
    if (count) {
      return {
        targetRequirements: [{ kind: "player" }],
        effects: [{ kind: "draw", playerId: { type: "chosen", index: 0 }, count }],
      };
    }
  }

  match = sentence.match(
    /^(?:you )?mill (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?$/i,
  );
  if (match?.[1]) {
    const count = parseCount(match[1]);
    if (count) {
      return {
        targetRequirements: [],
        effects: [{ kind: "mill", playerId: "controller", count }],
      };
    }
  }

  match = sentence.match(
    /^target player mills (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?$/i,
  );
  if (match?.[1]) {
    const count = parseCount(match[1]);
    if (count) {
      return {
        targetRequirements: [{ kind: "player" }],
        effects: [{ kind: "mill", playerId: { type: "chosen", index: 0 }, count }],
      };
    }
  }

  match = sentence.match(
    /^each opponent mills (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?$/i,
  );
  if (match?.[1]) {
    const count = parseCount(match[1]);
    if (count) {
      return {
        targetRequirements: [],
        effects: [{ kind: "mill", playerId: "each_opponent", count }],
      };
    }
  }

  if (/^destroy target creature$/i.test(sentence)) {
    return {
      targetRequirements: [{ kind: "creature" }],
      effects: [{ kind: "move_card", cardId: { type: "chosen", index: 0 }, toZone: "graveyard" }],
    };
  }

  if (/^exile target creature$/i.test(sentence)) {
    return {
      targetRequirements: [{ kind: "creature" }],
      effects: [{ kind: "move_card", cardId: { type: "chosen", index: 0 }, toZone: "exile" }],
    };
  }

  if (/^return target creature to (?:its|their) owner's hand$/i.test(sentence)) {
    return {
      targetRequirements: [{ kind: "creature" }],
      effects: [{ kind: "move_card", cardId: { type: "chosen", index: 0 }, toZone: "hand" }],
    };
  }

  if (/^counter target spell$/i.test(sentence)) {
    return {
      targetRequirements: [{ kind: "spell" }],
      effects: [{ kind: "counter_spell", target: { type: "chosen", index: 0 } }],
    };
  }

  match = sentence.match(
    /^Counter target (spell|noncreature spell|creature spell) unless its controller pays \{(\d+)\}$/i,
  );
  if (match?.[1] && match[2]) {
    const what = match[1].toLowerCase();
    return {
      targetRequirements: [
        {
          kind:
            what === "noncreature spell"
              ? "noncreature_spell"
              : what === "creature spell"
                ? "creature_spell"
                : "spell",
        },
      ],
      effects: [
        {
          kind: "counter_unless_pays",
          target: { type: "chosen", index: 0 },
          cost: `{${match[2]}}`,
        },
      ],
    };
  }

  if (/^counter target noncreature spell$/i.test(sentence)) {
    return {
      targetRequirements: [{ kind: "noncreature_spell" }],
      effects: [{ kind: "counter_spell", target: { type: "chosen", index: 0 } }],
    };
  }

  if (/^counter target creature spell$/i.test(sentence)) {
    return {
      targetRequirements: [{ kind: "creature_spell" }],
      effects: [{ kind: "counter_spell", target: { type: "chosen", index: 0 } }],
    };
  }

  if (/^destroy target nonartifact creature$/i.test(sentence)) {
    return {
      targetRequirements: [{ kind: "nonartifact_creature" }],
      effects: [{ kind: "move_card", cardId: { type: "chosen", index: 0 }, toZone: "graveyard" }],
    };
  }

  match = sentence.match(/^Destroy target non(white|blue|black|red|green) creature$/i);
  if (match?.[1]) {
    return {
      targetRequirements: [
        { kind: "creature", excludeColors: [COLOR_WORDS[match[1].toLowerCase()]!] },
      ],
      effects: [{ kind: "move_card", cardId: { type: "chosen", index: 0 }, toZone: "graveyard" }],
    };
  }

  const ritual = parseAddMana(sentence);
  if (ritual?.kind === "fixed") {
    return {
      targetRequirements: [],
      effects: [{ kind: "add_mana", playerId: "controller", mana: ritual.produces }],
    };
  }

  match = sentence.match(
    /^Create (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) (\d+)\/(\d+)(?: (white|blue|black|red|green|colorless))? ([\w]+(?: [\w]+)?) creature tokens?$/i,
  );
  if (match?.[1] && match[2] && match[3] && match[5]) {
    const count = parseCount(match[1]);
    const power = Number(match[2]);
    const toughness = Number(match[3]);
    const subtype = match[5].replace(/\b\w/g, (letter) => letter.toUpperCase());
    if (count) {
      const token: CardEffect = {
        kind: "create_token",
        ownerId: "controller",
        name: subtype,
        typeLine: `Creature — ${subtype} Token`,
        power,
        toughness,
      };
      return {
        targetRequirements: [],
        effects: Array.from({ length: count }, () => ({ ...token })),
      };
    }
  }

  // Cultivate / Kodama's Reach: two basics, split destinations.
  if (
    /^Search your library for up to two basic land cards, reveal (?:those cards|them), put one onto the battlefield tapped and the other into your hand, then shuffle(?: your library)?$/i.test(
      sentence,
    )
  ) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "search_library",
          playerId: "controller",
          filter: { supertypes: ["basic"], types: ["land"] },
          destination: "battlefield",
          count: 1,
          entersTapped: true,
        },
        {
          kind: "search_library",
          playerId: "controller",
          filter: { supertypes: ["basic"], types: ["land"] },
          destination: "hand",
          count: 1,
        },
      ],
    };
  }

  match = sentence.match(
    /^Search your library for (?:up to (one|two|three|\d+) )?(?:an? )?(.+?) cards?(?: and)?, (?:and )?put (?:it|them|that card|those cards) (onto the battlefield(?: tapped)?|into your hand|into your graveyard), then shuffle(?: your library)?$/i,
  );
  if (match?.[2] && match[3]) {
    const filter = parseSearchDescriptor(match[2]);
    const count = match[1] ? parseCount(match[1]) : 1;
    if (filter && count) {
      const where = match[3].toLowerCase();
      return {
        targetRequirements: [],
        effects: [
          {
            kind: "search_library",
            playerId: "controller",
            filter,
            destination: where.startsWith("onto the battlefield")
              ? "battlefield"
              : where === "into your hand"
                ? "hand"
                : "graveyard",
            count,
            ...(where.includes("tapped") ? { entersTapped: true } : {}),
          },
        ],
      };
    }
  }

  // Beast Within (single sentence: destroy; the token clause is a pair).
  if (/^Destroy target permanent$/i.test(sentence)) {
    return {
      targetRequirements: [{ kind: "permanent" }],
      effects: [{ kind: "move_card", cardId: { type: "chosen", index: 0 }, toZone: "graveyard" }],
    };
  }

  match = sentence.match(/^Put a \+1\/\+1 counter on each creature you control$/i);
  if (match) {
    return {
      targetRequirements: [],
      effects: [
        { kind: "counter_on_controlled_creatures", playerId: "controller", counter: "p1p1", amount: 1 },
      ],
    };
  }

  match = sentence.match(/^Surveil (\d+)$/i);
  if (match?.[1]) {
    return {
      targetRequirements: [],
      effects: [{ kind: "surveil", playerId: "controller", count: Number(match[1]) }],
    };
  }

  match = sentence.match(/^Target player loses (\d+) life and you gain (\d+) life$/i);
  if (match?.[1] && match[2]) {
    return {
      targetRequirements: [{ kind: "player" }],
      effects: [
        { kind: "lose_life", playerId: { type: "chosen", index: 0 }, amount: Number(match[1]) },
        { kind: "gain_life", playerId: "controller", amount: Number(match[2]) },
      ],
    };
  }

  match = sentence.match(/^Target creature gets ([+-]\d+)\/([+-]\d+) until end of turn$/i);
  if (match?.[1] && match[2]) {
    return {
      targetRequirements: [{ kind: "creature" }],
      effects: [
        {
          kind: "pt_until_eot",
          cardId: { type: "chosen", index: 0 },
          power: Number(match[1]),
          toughness: Number(match[2]),
        },
      ],
    };
  }

  match = sentence.match(
    /^Target creature (?:gains|gets) ([a-z ]+?) until end of turn$/i,
  );
  if (match?.[1]) {
    const keyword = KEYWORD_GRANTS[match[1].trim().toLowerCase()];
    if (keyword) {
      return {
        targetRequirements: [{ kind: "creature" }],
        effects: [
          { kind: "keyword_until_eot", cardId: { type: "chosen", index: 0 }, keyword },
        ],
      };
    }
  }

  match = sentence.match(/^Put a \+1\/\+1 counter on ~$/i);
  if (match) {
    return {
      targetRequirements: [],
      effects: [{ kind: "add_counter", cardId: "self", counter: "p1p1", amount: 1 }],
    };
  }

  match = sentence.match(/^~ gets ([+-]\d+)\/([+-]\d+) until end of turn$/i);
  if (match?.[1] && match[2]) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "pt_until_eot",
          cardId: "self",
          power: Number(match[1]),
          toughness: Number(match[2]),
        },
      ],
    };
  }

  match = sentence.match(/^Creatures you control get ([+-]\d+)\/([+-]\d+) until end of turn$/i);
  if (match?.[1] && match[2]) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "team_pt_until_eot",
          playerId: "controller",
          power: Number(match[1]),
          toughness: Number(match[2]),
        },
      ],
    };
  }

  match = sentence.match(/^Creatures you control get \+(\d+)\/\+(\d+)$/i);
  if (match?.[1] && match[2]) {
    return null;
  }

  return null;
}

const SEARCH_CARD_TYPES = new Set([
  "artifact",
  "creature",
  "enchantment",
  "instant",
  "land",
  "planeswalker",
  "sorcery",
]);
const SEARCH_SUPERTYPES = new Set(["basic", "legendary", "snow"]);

/**
 * "basic land" → {supertypes:[basic], types:[land]}; "Forest" → {subtypes:
 * [forest]}; "card" alone → match anything. Unknown words fail the parse so
 * unsupported searches stay compile notes.
 */
function parseSearchDescriptor(descriptor: string): SearchFilter | null {
  // "Plains, Island, Swamp, or Mountain" — an any-of subtype list (Farseek).
  if (/,|\bor\b/i.test(descriptor)) {
    const options = descriptor
      .split(/,\s*(?:or\s+)?|\s+or\s+/i)
      .map((word) => word.trim().toLowerCase().replace(/\s*cards?$/, ""))
      .filter(Boolean);
    if (options.length >= 2 && options.every((word) => /^[a-z]+$/.test(word))) {
      return { subtypesAny: options };
    }
    return null;
  }
  const filter: Required<Omit<SearchFilter, "subtypesAny">> = {
    supertypes: [],
    types: [],
    subtypes: [],
  };
  const words = descriptor.trim().toLowerCase().split(/\s+/).filter(Boolean);
  for (const word of words) {
    if (word === "card" || word === "cards" || word === "a" || word === "an") {
      continue;
    }
    if (SEARCH_SUPERTYPES.has(word)) {
      filter.supertypes.push(word);
    } else if (SEARCH_CARD_TYPES.has(word)) {
      filter.types.push(word);
    } else if (/^[a-z]+$/.test(word)) {
      filter.subtypes.push(word);
    } else {
      return null;
    }
  }
  return {
    ...(filter.supertypes.length > 0 ? { supertypes: filter.supertypes } : {}),
    ...(filter.types.length > 0 ? { types: filter.types } : {}),
    ...(filter.subtypes.length > 0 ? { subtypes: filter.subtypes } : {}),
  };
}

type TriggerHead = Pick<CardTrigger, "event" | "watch" | "excludeSelf" | "subjectFilter">;

/** "Whenever another creature dies" → dies / any / excludeSelf, and friends. */
function parseTriggerHead(head: string): TriggerHead | null {
  const text = head.replace(/^Landfall\s*[—-]\s*/i, "").trim();
  if (/^When(?:ever)? ~ dies$/i.test(text)) {
    return { event: "dies" };
  }
  if (/^Whenever you gain life$/i.test(text)) {
    return { event: "you_gain_life" };
  }
  if (/^Whenever ~ or another creature dies$/i.test(text)) {
    return { event: "dies", watch: "any", subjectFilter: { types: ["creature"] } };
  }
  if (/^Whenever another creature dies$/i.test(text)) {
    return { event: "dies", watch: "any", excludeSelf: true, subjectFilter: { types: ["creature"] } };
  }
  if (/^Whenever a creature you control dies$/i.test(text)) {
    return { event: "dies", watch: "controlled", subjectFilter: { types: ["creature"] } };
  }
  if (/^Whenever a creature dies$/i.test(text)) {
    return { event: "dies", watch: "any", subjectFilter: { types: ["creature"] } };
  }
  if (/^At the beginning of your upkeep$/i.test(text)) {
    return { event: "upkeep" };
  }
  if (/^At the beginning of your end step$/i.test(text)) {
    return { event: "end_step" };
  }
  if (/^Whenever ~ attacks$/i.test(text)) {
    return { event: "attacks" };
  }
  if (
    /^Whenever a land you control enters$/i.test(text) ||
    /^Whenever a land enters(?: under your control)?$/i.test(text)
  ) {
    return { event: "enter_battlefield", watch: "controlled", subjectFilter: { types: ["land"] } };
  }
  if (/^Whenever ~ or another creature enters$/i.test(text)) {
    return { event: "enter_battlefield", watch: "any", subjectFilter: { types: ["creature"] } };
  }
  if (/^Whenever another creature enters$/i.test(text)) {
    return {
      event: "enter_battlefield",
      watch: "any",
      excludeSelf: true,
      subjectFilter: { types: ["creature"] },
    };
  }
  if (/^Whenever another creature you control enters$/i.test(text)) {
    return {
      event: "enter_battlefield",
      watch: "controlled",
      excludeSelf: true,
      subjectFilter: { types: ["creature"] },
    };
  }
  if (
    /^Whenever a creature enters under your control$/i.test(text) ||
    /^Whenever a creature you control enters$/i.test(text)
  ) {
    return { event: "enter_battlefield", watch: "controlled", subjectFilter: { types: ["creature"] } };
  }
  return null;
}

const COLOR_WORDS: Record<string, Color> = {
  white: "W",
  blue: "U",
  black: "B",
  red: "R",
  green: "G",
};

function compileAnthem(sentence: string): StaticAbility | null {
  const match = sentence.match(/^(?:Other )?Creatures you control get \+(\d+)\/\+(\d+)$/i);
  if (match?.[1] && match[2]) {
    return {
      selector: { scope: "controlled", types: ["creature"] },
      effect: { kind: "modify_pt", power: Number(match[1]), toughness: Number(match[2]) },
    };
  }
  const colored = sentence.match(
    /^(White|Blue|Black|Red|Green) creatures(?: you control)? get \+(\d+)\/\+(\d+)$/i,
  );
  if (colored?.[1] && colored[2] && colored[3]) {
    return {
      selector: {
        scope: /you control/i.test(sentence) ? "controlled" : "all",
        types: ["creature"],
        colors: [COLOR_WORDS[colored[1].toLowerCase()]!],
      },
      effect: { kind: "modify_pt", power: Number(colored[2]), toughness: Number(colored[3]) },
    };
  }
  // "All Slivers have flying" / "Sliver creatures you control have shroud".
  const tribal = sentence.match(
    /^(?:All )?([A-Z][a-z]+)(?: creature)?s(?: you control)? have ([a-z ]+)$/,
  );
  if (tribal?.[1] && tribal[2]) {
    const keyword = KEYWORD_GRANTS[tribal[2].trim().toLowerCase()];
    if (keyword) {
      return {
        selector: {
          scope: /you control/.test(sentence) ? "controlled" : "all",
          subtypes: [tribal[1].toLowerCase()],
        },
        effect: { kind: "grant_keyword", keyword },
      };
    }
  }
  return null;
}

function offsetChosenIndexes(clause: SimpleClause, offset: number): SimpleClause {
  if (offset === 0) {
    return clause;
  }
  return {
    targetRequirements: clause.targetRequirements,
    effects: clause.effects.map((effect) => shiftChosen(effect, offset)),
    leftover: clause.leftover,
  };
}

function commitClause(
  result: CompiledOracleText,
  clause: SimpleClause,
): void {
  const offset = result.targetRequirements.length;
  const shifted = offsetChosenIndexes(clause, offset);
  result.targetRequirements.push(...shifted.targetRequirements);
  result.effects.push(...shifted.effects);
  if (clause.leftover) {
    result.leftover.push(clause.leftover);
  }
}

function shiftChosen(effect: CardEffect, offset: number): CardEffect {
  function bumpChosen<T>(value: T): T {
    if (
      value &&
      typeof value === "object" &&
      "type" in value &&
      ((value as { type: string }).type === "chosen" ||
        (value as { type: string }).type === "chosen_controller")
    ) {
      const chosen = value as unknown as { type: "chosen" | "chosen_controller"; index: number };
      return { type: chosen.type, index: chosen.index + offset } as T;
    }
    return value;
  }
  switch (effect.kind) {
    case "deal_damage":
      return { ...effect, target: bumpChosen(effect.target) };
    case "create_token":
      return { ...effect, ownerId: bumpChosen(effect.ownerId) };
    case "counter_on_controlled_creatures":
    case "manifest":
    case "team_pt_until_eot":
    case "search_library":
      return { ...effect, playerId: bumpChosen(effect.playerId) };
    case "pt_until_eot":
    case "keyword_until_eot":
    case "transform":
      return { ...effect, cardId: bumpChosen(effect.cardId) };
    case "attach":
      return { ...effect, cardId: bumpChosen(effect.cardId), toId: bumpChosen(effect.toId) };
    case "copy_token":
      return { ...effect, ownerId: bumpChosen(effect.ownerId), ofCardId: bumpChosen(effect.ofCardId) };
    case "counter_unless_pays":
      return { ...effect, target: bumpChosen(effect.target) };
    case "divided_damage":
      return effect;
    case "move_card":
    case "tap":
    case "untap":
    case "sacrifice":
    case "add_counter":
      return { ...effect, cardId: bumpChosen(effect.cardId) };
    case "set_class_level":
      return { ...effect, cardId: bumpChosen(effect.cardId) };
    case "counter_spell":
      return { ...effect, target: bumpChosen(effect.target) };
    case "gain_life":
    case "lose_life":
    case "draw":
    case "mill":
    case "discard":
    case "add_mana":
    case "scry":
    case "surveil":
    case "discard_unless_attacked":
    case "amass":
    case "look_and_assign":
      return { ...effect, playerId: bumpChosen(effect.playerId) };
    case "reveal_zone":
      return {
        ...effect,
        fromPlayerId: bumpChosen(effect.fromPlayerId),
        toPlayerId: bumpChosen(effect.toPlayerId),
      };
    case "choose_card":
      return {
        ...effect,
        chooserId: bumpChosen(effect.chooserId),
        sources: effect.sources.map((source) => ({
          ...source,
          playerId: bumpChosen(source.playerId),
        })),
        thenEffects: effect.thenEffects.map((entry) => shiftChosen(entry, offset)),
      };
    default:
      return effect;
  }
}

function compileLookAndAssignPair(sentences: string[], index: number): SimpleClause & { consumed: number } | null {
  const look = sentences[index]?.match(
    /^Look at the top (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library$/i,
  );
  const assign = sentences[index + 1];
  if (
    !look?.[1] ||
    !assign ||
    !/^Put one of them into your hand, put one of them on the bottom of your library, and exile one of them$/i.test(
      assign,
    )
  ) {
    return null;
  }
  const count = parseCount(look[1]);
  if (!count) {
    return null;
  }
  return {
    targetRequirements: [],
    effects: [
      {
        kind: "look_and_assign",
        playerId: "controller",
        count,
        destinations: ["hand", "library_bottom", "exile"],
      },
    ],
    consumed: 2,
  };
}

function compileRevealAndChoose(sentences: string[], index: number): SimpleClause & { consumed: number } | null {
  const reveal = sentences[index]?.match(/^Target (opponent|player) reveals their hand$/i);
  const choose = sentences[index + 1]?.match(
    /^You choose a ((?:noncreature, )?nonland )?card from it(?: or a card from their (graveyard))?$/i,
  );
  const follow = sentences[index + 2];
  if (!reveal?.[1] || !choose || !follow) {
    return null;
  }
  const exile = /^Exile that card$/i.test(follow);
  const discard = /^That player discards that card$/i.test(follow);
  if (!exile && !discard) {
    return null;
  }
  const opponent = reveal[1].toLowerCase() === "opponent";
  const sources: ChooseCardSource[] = [
    {
      playerId: { type: "chosen", index: 0 },
      zone: "hand",
      filter: /noncreature/i.test(choose[1] ?? "")
        ? "noncreature_nonland"
        : choose[1]
          ? "nonland"
          : "any",
    },
  ];
  if (choose[2]?.toLowerCase() === "graveyard") {
    sources.push({
      playerId: { type: "chosen", index: 0 },
      zone: "graveyard",
      filter: "any",
    });
  }
  return {
    targetRequirements: [{ kind: opponent ? "opponent" : "player" }],
    effects: [
      {
        kind: "reveal_zone",
        fromPlayerId: { type: "chosen", index: 0 },
        toPlayerId: "controller",
        zone: "hand",
      },
      {
        kind: "choose_card",
        chooserId: "controller",
        sources,
        thenEffects: [
          {
            kind: "move_card",
            cardId: "chosen_card",
            toZone: exile ? "exile" : "graveyard",
          },
        ],
      },
    ],
    consumed: 3,
  };
}
type ModalExtraction = {
  remainingText: string;
  modes: SpellMode[] | null;
  raw: string;
};

/**
 * "Choose one —" blocks compile before sentence splitting (the bullets are
 * lines, not sentences). Every bullet must compile as a single clause, or
 * the whole block stays a note.
 */
function extractModalModes(card: OracleCard): ModalExtraction | null {
  const lines = stripReminderText(card.oracleText).replace(/\r/g, "").split("\n");
  const headIndex = lines.findIndex((line) => /^Choose one\s*[—-]\s*$/i.test(line.trim()));
  if (headIndex === -1) {
    return null;
  }
  const bullets: string[] = [];
  let end = headIndex + 1;
  while (end < lines.length && lines[end]!.trim().startsWith("•")) {
    bullets.push(lines[end]!.trim().replace(/^•\s*/, ""));
    end += 1;
  }
  if (bullets.length < 2) {
    return null;
  }
  const remainingText = [...lines.slice(0, headIndex), ...lines.slice(end)].join("\n");
  const raw = lines.slice(headIndex, end).join(" ");
  const modes: SpellMode[] = [];
  for (const bullet of bullets) {
    const sentences = splitOracleSentences({ ...card, oracleText: bullet });
    if (sentences.length !== 1 || !sentences[0]) {
      return { remainingText, modes: null, raw };
    }
    const clause = compileSimpleClause(sentences[0]);
    if (!clause || clause.leftover) {
      return { remainingText, modes: null, raw };
    }
    modes.push({
      label: bullet.replace(/\.$/, ""),
      effects: clause.effects,
      targetRequirements: clause.targetRequirements,
    });
  }
  return { remainingText, modes, raw };
}

export function compileOracleText(card: OracleCard, keywords: Keyword[] = []): CompiledOracleText {
  const result: CompiledOracleText = {
    effects: [],
    targetRequirements: [],
    activated: [],
    triggers: [],
    replacements: [],
    staticAbilities: [],
    produces: {},
    producesAnyColor: false,
    producesOptions: [],
    manaAbilities: [],
    leftover: [],
    notes: [],
  };
  void keywords;

  const modal = extractModalModes(card);
  if (modal) {
    if (modal.modes) {
      result.modes = modal.modes;
    } else {
      result.leftover.push(modal.raw);
    }
  }
  const sentences = splitOracleSentences(
    modal ? { ...card, oracleText: modal.remainingText } : card,
  );
  for (let index = 0; index < sentences.length; index += 1) {
    const sentence = sentences[index];
    if (!sentence) {
      continue;
    }
    if (isKeywordLine(sentence)) {
      continue;
    }

    const wardLine = sentence.match(/^Ward \{(\d+)\}$/i);
    if (wardLine?.[1]) {
      result.ward = Number(wardLine[1]);
      continue;
    }

    if (/^Enchant creature$/i.test(sentence)) {
      result.enchant = "creature";
      if (!result.targetRequirements.some((requirement) => requirement.kind === "creature")) {
        result.targetRequirements.push({ kind: "creature" });
      }
      continue;
    }

    const attachedBuff = sentence.match(
      /^(?:Enchanted|Equipped) creature gets ([+-]\d+)\/([+-]\d+)(?: and has ([a-z ,]+))?$/i,
    );
    if (attachedBuff?.[1] && attachedBuff[2]) {
      result.staticAbilities.push({
        selector: { scope: "attached" },
        effect: {
          kind: "modify_pt",
          power: Number(attachedBuff[1]),
          toughness: Number(attachedBuff[2]),
        },
      });
      if (attachedBuff[3]) {
        const grants = attachedBuff[3]
          .split(/,\s*|\s+and\s+/i)
          .map((word) => word.trim().toLowerCase())
          .filter(Boolean);
        const keywords = grants.map((word) => KEYWORD_GRANTS[word]);
        if (keywords.every((keyword): keyword is Keyword => Boolean(keyword))) {
          for (const keyword of keywords) {
            result.staticAbilities.push({
              selector: { scope: "attached" },
              effect: { kind: "grant_keyword", keyword },
            });
          }
        } else {
          result.leftover.push(sentence);
        }
      }
      continue;
    }

    const attachedRestrict = sentence.match(
      /^(?:Enchanted|Equipped) creature can't (attack or block|be blocked|attack|block)(?: and has ([a-z ]+))?$/i,
    );
    if (attachedRestrict?.[1]) {
      const what = attachedRestrict[1].toLowerCase();
      result.staticAbilities.push({
        selector: { scope: "attached" },
        effect: {
          kind: "restrict",
          ...(what.includes("attack") ? { cantAttack: true } : {}),
          ...(what === "attack or block" || what === "block" ? { cantBlock: true } : {}),
          ...(what === "be blocked" ? { cantBeBlocked: true } : {}),
        },
      });
      if (attachedRestrict[2]) {
        const keyword = KEYWORD_GRANTS[attachedRestrict[2].trim().toLowerCase()];
        if (keyword) {
          result.staticAbilities.push({
            selector: { scope: "attached" },
            effect: { kind: "grant_keyword", keyword },
          });
        } else {
          result.leftover.push(sentence);
        }
      }
      continue;
    }

    const attachedGrant = sentence.match(/^(?:Enchanted|Equipped) creature has ([a-z ]+)$/i);
    if (attachedGrant?.[1]) {
      const keyword = KEYWORD_GRANTS[attachedGrant[1].trim().toLowerCase()];
      if (keyword) {
        result.staticAbilities.push({
          selector: { scope: "attached" },
          effect: { kind: "grant_keyword", keyword },
        });
        continue;
      }
    }

    const equip = sentence.match(/^Equip (?:\{(\d+)\}|(\d+))$/i);
    if (equip) {
      const amount = equip[1] ?? equip[2] ?? "0";
      result.activated.push({
        tap: false,
        manaCost: `{${amount}}`,
        effects: [{ kind: "attach", cardId: "self", toId: { type: "chosen", index: 0 } }],
        targetRequirements: [{ kind: "own_creature" }],
        timing: "sorcery",
      });
      continue;
    }

    const loyaltyAbility = sentence.match(/^([+−-]\d+|0): (.+)$/);
    if (loyaltyAbility?.[1] && loyaltyAbility[2]) {
      const clause = compileSimpleClause(loyaltyAbility[2].trim());
      if (clause && !clause.leftover) {
        result.loyaltyAbilities = result.loyaltyAbilities ?? [];
        result.loyaltyAbilities.push({
          cost: Number(loyaltyAbility[1].replace("−", "-")),
          effects: clause.effects,
          targetRequirements: clause.targetRequirements,
        });
        continue;
      }
      result.leftover.push(sentence);
      continue;
    }

    const protectionLine = sentence.match(
      /^Protection from (white|blue|black|red|green)(?: and from (white|blue|black|red|green))?$/i,
    );
    if (protectionLine?.[1]) {
      const colorOf: Record<string, Color> = {
        white: "W",
        blue: "U",
        black: "B",
        red: "R",
        green: "G",
      };
      const colors = [protectionLine[1], protectionLine[2]]
        .filter((name): name is string => Boolean(name))
        .map((name) => colorOf[name.toLowerCase()]!);
      result.protectionFrom = [...new Set([...(result.protectionFrom ?? []), ...colors])];
      continue;
    }

    const lookPair = compileLookAndAssignPair(sentences, index);
    if (lookPair) {
      commitClause(result, lookPair);
      index += lookPair.consumed - 1;
      continue;
    }

    const revealChoose = compileRevealAndChoose(sentences, index);
    if (revealChoose) {
      commitClause(result, revealChoose);
      index += revealChoose.consumed - 1;
      continue;
    }

    const anthem = compileAnthem(sentence);
    if (anthem) {
      result.staticAbilities.push(anthem);
      continue;
    }

    if (/^~ enters tapped$/i.test(sentence)) {
      result.replacements.push({ kind: "enters_tapped" });
      continue;
    }

    const unlessTapped = compileEntersTappedUnless(sentence);
    if (unlessTapped) {
      result.replacements.push(unlessTapped);
      continue;
    }

    const ifTapped = compileEntersTappedIf(sentence);
    if (ifTapped) {
      result.replacements.push(ifTapped);
      continue;
    }

    if (
      /^If a card or token would be put into a graveyard from anywhere, exile it instead$/i.test(
        sentence,
      )
    ) {
      result.replacements.push({ kind: "graveyard_to_exile" });
      continue;
    }

    const shock = sentence.match(/^As ~ enters, you may pay (\d+) life$/i);
    if (shock?.[1]) {
      result.replacements.push({
        kind: "may_pay_life_or_enter_tapped",
        amount: Number(shock[1]),
      });
      continue;
    }
    if (
      /^If you don't, it enters tapped$/i.test(sentence) &&
      result.replacements.some((replacement) => replacement.kind === "may_pay_life_or_enter_tapped")
    ) {
      continue;
    }

    const etb = sentence.match(/^When ~ enters(?: and whenever [^,]+)?, (.+)$/i);
    if (etb?.[1]) {
      const inner = compileSimpleClause(etb[1].trim());
      if (inner) {
        result.triggers.push({
          event: "enter_battlefield",
          effects: inner.effects,
          targetRequirements: inner.targetRequirements,
        });
        if (inner.leftover) {
          result.leftover.push(inner.leftover);
        }
        continue;
      }
      result.leftover.push(sentence);
      continue;
    }

    const beginCombat = sentence.match(/^At the beginning of combat on your turn, (.+)$/i);
    if (beginCombat?.[1]) {
      const inner = compileSimpleClause(beginCombat[1].trim());
      if (inner) {
        result.triggers.push({
          event: "begin_combat",
          effects: inner.effects,
          targetRequirements: inner.targetRequirements,
        });
        if (inner.leftover) {
          result.leftover.push(inner.leftover);
        }
        continue;
      }
      result.leftover.push(sentence);
      continue;
    }

    // Beast Within: destroy + the next sentence's consolation token.
    if (/^Destroy target permanent$/i.test(sentence)) {
      const tokenClause = sentences[index + 1]?.match(
        /^Its controller creates a (\d+)\/(\d+)(?: (white|blue|black|red|green|colorless))? ([A-Za-z]+) creature token$/i,
      );
      if (tokenClause?.[1] && tokenClause[2] && tokenClause[4]) {
        const subtype =
          tokenClause[4][0]!.toUpperCase() + tokenClause[4].slice(1).toLowerCase();
        commitClause(result, {
          targetRequirements: [{ kind: "permanent" }],
          effects: [
            { kind: "move_card", cardId: { type: "chosen", index: 0 }, toZone: "graveyard" },
            {
              kind: "create_token",
              ownerId: { type: "chosen_controller", index: 0 },
              name: subtype,
              typeLine: `Creature — ${subtype} Token`,
              power: Number(tokenClause[1]),
              toughness: Number(tokenClause[2]),
            },
          ],
        });
        index += 1;
        continue;
      }
    }

    const generalTrigger = sentence.match(/^((?:Landfall\s*[—-]\s*)?[^,]+?), (.+)$/i);
    if (generalTrigger?.[1] && generalTrigger[2]) {
      const head = parseTriggerHead(generalTrigger[1]);
      if (head) {
        const inner = compileSimpleClause(generalTrigger[2].trim());
        if (inner) {
          result.triggers.push({
            ...head,
            effects: inner.effects,
            targetRequirements: inner.targetRequirements,
          });
          if (inner.leftover) {
            result.leftover.push(inner.leftover);
          }
          continue;
        }
        result.leftover.push(sentence);
        continue;
      }
    }

    const channel = sentence.match(
      /^Channel\s*[—-]\s*((?:\{[^}]+\}(?:,\s*)?)+),\s*Discard this card:\s*(.+)$/i,
    );
    if (channel?.[1] && channel[2]) {
      const cost = parseAbilityCost(channel[1]);
      const clause = compileSimpleClause(channel[2].trim());
      if (cost && !cost.tap && clause) {
        result.activated.push({
          tap: false,
          manaCost: cost.manaCost,
          effects: clause.effects,
          targetRequirements: clause.targetRequirements,
          zone: "hand",
          discard: true,
        });
        if (clause.leftover) {
          result.leftover.push(clause.leftover);
        }
        continue;
      }
      result.leftover.push(sentence);
      continue;
    }

    const ability = splitAbility(sentence);
    if (ability) {
      const cost = parseAbilityCost(ability.costText);
      if (!cost) {
        result.leftover.push(sentence);
        continue;
      }
      const add = parseAddMana(ability.rest);
      if (add && cost.tap && cost.manaCost === "") {
        result.manaAbilities.push(manaAbilityFromAdd(add));
        if (add.kind === "any_color" && add.identityRestricted) {
          result.notes.push("Commander's color identity is not enforced; any color may be added.");
        }
        continue;
      }
      const levelUp = ability.rest.match(/^Level (\d+)$/i);
      if (levelUp?.[1] && !cost.tap && cost.manaCost !== "") {
        result.activated.push({
          tap: false,
          manaCost: cost.manaCost,
          effects: [{ kind: "set_class_level", cardId: "self", level: Number(levelUp[1]) }],
          targetRequirements: [],
          timing: "sorcery",
        });
        continue;
      }
      const clause = compileSimpleClause(ability.rest);
      if (!clause) {
        result.leftover.push(sentence);
        continue;
      }
      result.activated.push({
        tap: cost.tap,
        manaCost: cost.manaCost,
        effects: clause.effects,
        targetRequirements: clause.targetRequirements,
        ...(cost.sacrificeSelf ? { sacrificeSelf: true } : {}),
        ...(cost.lifeCost ? { lifeCost: cost.lifeCost } : {}),
      });
      if (clause.leftover) {
        result.leftover.push(clause.leftover);
      }
      continue;
    }

    const pain = sentence.match(/^~ deals (\d+) damage to you$/i);
    if (pain?.[1] && result.manaAbilities.length > 0) {
      const last = result.manaAbilities[result.manaAbilities.length - 1];
      if (last) {
        last.damageToController = Number(pain[1]);
        continue;
      }
    }

    const clause = compileSimpleClause(sentence);
    if (clause) {
      commitClause(result, clause);
      continue;
    }

    result.leftover.push(sentence);
  }

  if (result.manaAbilities.length === 0) {
    const basics = basicTypeColors(card.typeLine);
    if (basics.length === 1 && basics[0]) {
      result.manaAbilities.push({
        produces: { [basics[0]]: 1 },
        producesOptions: [],
        producesAnyColor: false,
        damageToController: 0,
      });
    } else if (basics.length > 1) {
      result.manaAbilities.push({
        produces: {},
        producesOptions: basics,
        producesAnyColor: false,
        damageToController: 0,
      });
    }
  }
  copyFirstManaAbility(result);

  return result;
}
