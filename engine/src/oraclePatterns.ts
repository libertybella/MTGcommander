import { parseManaCost } from "./mana";
import type {
  ActivatedAbility,
  CardEffect,
  CardTrigger,
  Color,
  Keyword,
  ManaColor,
  ManaPool,
  StaticModifier,
  TargetRequirement,
} from "./types";
import type { OracleCard } from "./oracle";

export type CompiledOracleText = {
  effects: CardEffect[];
  targetRequirements: TargetRequirement[];
  activated: ActivatedAbility[];
  triggers: CardTrigger[];
  staticModifiers: StaticModifier[];
  produces: Partial<ManaPool>;
  producesAnyColor: boolean;
  producesOptions: ManaColor[];
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
  "indestructible",
  "flash",
  "defender",
]);

const BASIC_TYPE_MANA: Record<string, Color> = {
  plains: "W",
  island: "U",
  swamp: "B",
  mountain: "R",
  forest: "G",
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

function splitAbility(sentence: string): { costText: string; rest: string } | null {
  const match = sentence.match(/^((?:\{[^}]+\}(?:,\s*)?)+):\s*(.+)$/i);
  if (!match?.[1] || !match[2]) {
    return null;
  }
  return { costText: match[1], rest: match[2].trim() };
}

function parseAbilityCost(costText: string): { tap: boolean; manaCost: string } | null {
  const symbols = [...costText.matchAll(/\{([^}]+)\}/g)].map((match) => match[1] ?? "");
  if (symbols.length === 0) {
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
  return { tap, manaCost };
}

type AddManaResult =
  | { kind: "fixed"; produces: Partial<ManaPool> }
  | { kind: "any_color"; identityRestricted: boolean }
  | { kind: "or"; colors: ManaColor[] };

function parseAddMana(rest: string): AddManaResult | null {
  const text = rest.trim();
  const identity = /any color in your commander'?s color identity/i.test(text);
  if (/^Add one mana of any color(?: in your commander'?s color identity)?$/i.test(text)) {
    return { kind: "any_color", identityRestricted: identity };
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
};

function compileSimpleClause(sentence: string): SimpleClause | null {
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

  match = sentence.match(/^Creatures you control get \+(\d+)\/\+(\d+)$/i);
  if (match?.[1] && match[2]) {
    return null;
  }

  return null;
}

function compileAnthem(sentence: string): StaticModifier | null {
  const match = sentence.match(/^(?:Other )?Creatures you control get \+(\d+)\/\+(\d+)$/i);
  if (!match?.[1] || !match[2]) {
    return null;
  }
  return {
    kind: "pt",
    selector: "controlled_creatures",
    power: Number(match[1]),
    toughness: Number(match[2]),
  };
}

function offsetChosenIndexes(clause: SimpleClause, offset: number): SimpleClause {
  if (offset === 0) {
    return clause;
  }
  return {
    targetRequirements: clause.targetRequirements,
    effects: clause.effects.map((effect) => shiftChosen(effect, offset)),
  };
}

function shiftChosen(effect: CardEffect, offset: number): CardEffect {
  function bumpChosen<T>(value: T): T {
    if (value && typeof value === "object" && "type" in value && (value as { type: string }).type === "chosen") {
      const chosen = value as unknown as { type: "chosen"; index: number };
      return { type: "chosen", index: chosen.index + offset } as T;
    }
    return value;
  }
  switch (effect.kind) {
    case "deal_damage":
      return { ...effect, target: bumpChosen(effect.target) };
    case "move_card":
    case "tap":
    case "untap":
    case "sacrifice":
    case "add_counter":
      return { ...effect, cardId: bumpChosen(effect.cardId) };
    case "counter_spell":
      return { ...effect, target: bumpChosen(effect.target) };
    case "gain_life":
    case "lose_life":
    case "draw":
    case "mill":
    case "discard":
    case "add_mana":
      return { ...effect, playerId: bumpChosen(effect.playerId) };
    default:
      return effect;
  }
}

/**
 * Pattern-compile oracle sentences into existing engine data.
 * Unrecognized sentences are returned in `leftover`.
 */
export function compileOracleText(card: OracleCard, keywords: Keyword[] = []): CompiledOracleText {
  const result: CompiledOracleText = {
    effects: [],
    targetRequirements: [],
    activated: [],
    triggers: [],
    staticModifiers: [],
    produces: {},
    producesAnyColor: false,
    producesOptions: [],
    leftover: [],
    notes: [],
  };
  void keywords;

  let manaAddCompiled = false;

  for (const sentence of splitOracleSentences(card)) {
    if (isKeywordLine(sentence)) {
      continue;
    }

    const anthem = compileAnthem(sentence);
    if (anthem) {
      result.staticModifiers.push(anthem);
      continue;
    }

    const etb = sentence.match(/^When ~ enters(?:,)? (.+)$/i);
    if (etb?.[1]) {
      const inner = compileSimpleClause(etb[1].trim());
      if (inner && inner.targetRequirements.length === 0) {
        result.triggers.push({ event: "enter_battlefield", effects: inner.effects });
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
        if (manaAddCompiled) {
          result.leftover.push(sentence);
          continue;
        }
        manaAddCompiled = true;
        if (add.kind === "fixed") {
          result.produces = add.produces;
        } else if (add.kind === "any_color") {
          result.producesAnyColor = true;
          if (add.identityRestricted) {
            result.notes.push("Commander's color identity is not enforced; any color may be added.");
          }
        } else {
          result.producesOptions = add.colors;
        }
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
      });
      continue;
    }

    const clause = compileSimpleClause(sentence);
    if (clause) {
      const offset = result.targetRequirements.length;
      const shifted = offsetChosenIndexes(clause, offset);
      result.targetRequirements.push(...shifted.targetRequirements);
      result.effects.push(...shifted.effects);
      continue;
    }

    result.leftover.push(sentence);
  }

  if (!manaAddCompiled) {
    const basics = basicTypeColors(card.typeLine);
    if (basics.length === 1 && basics[0]) {
      result.produces = { [basics[0]]: 1 };
    } else if (basics.length > 1) {
      result.producesOptions = basics;
    }
  }

  return result;
}
