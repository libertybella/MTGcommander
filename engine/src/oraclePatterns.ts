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
  ManaAbility,
  ManaColor,
  ManaPool,
  ReplacementEffect,
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

function compileAnthem(sentence: string): StaticAbility | null {
  const match = sentence.match(/^(?:Other )?Creatures you control get \+(\d+)\/\+(\d+)$/i);
  if (match?.[1] && match[2]) {
    return {
      selector: { scope: "controlled", types: ["creature"] },
      effect: { kind: "modify_pt", power: Number(match[1]), toughness: Number(match[2]) },
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

  const sentences = splitOracleSentences(card);
  for (let index = 0; index < sentences.length; index += 1) {
    const sentence = sentences[index];
    if (!sentence) {
      continue;
    }
    if (isKeywordLine(sentence)) {
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
