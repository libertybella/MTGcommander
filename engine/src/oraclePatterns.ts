import { parseManaCost } from "./mana";
import { parseAmassClause } from "./tokens";
import type {
  ActivatedAbility,
  AdditionalCastCost,
  TopOfLibraryGrant,
  CardEffect,
  CardTrigger,
  ChooseCardSource,
  Color,
  CostReduction,
  DestroyAllScope,
  DynamicCount,
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
  TargetKind,
  TargetRequirement,
  TriggerCondition,
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
  enchant?: "creature" | "land";
  chooseColorOnEnter?: boolean;
  enchantedTappedBonus?: { color: Color | "chosen"; amount: number };
  loyaltyAbilities?: LoyaltyAbility[];
  noMaxHandSize?: boolean;
  extraLandDrops?: number;
  cantBeCountered?: boolean;
  creatureSpellsCantBeCountered?: boolean;
  opponentsLockedDuringYourTurn?: boolean;
  opponentsCantCastDuringYourTurn?: boolean;
  mustAttack?: boolean;
  freeIfCommander?: boolean;
  changeling?: boolean;
  storm?: boolean;
  doesntUntap?: boolean;
  grantsFlash?: boolean;
  attackTax?: { generic?: number; perEnchantment?: boolean; lifePer?: number };
  leyline?: boolean;
  castFromGraveyard?: { types?: string[]; subtypes?: string[] };
  ascend?: boolean;
  untapDuringEachUntap?: "creatures" | "permanents" | "artifacts";
  opponentCreaturesEnterTapped?: boolean;
  opponentArtifactsEnterTapped?: boolean;
  extraDrawStepDraws?: boolean;
  affinityArtifacts?: boolean;
  affinityAllCreatures?: boolean;
  topOfLibrary?: TopOfLibraryGrant;
  flashback?: { manaCost: string; life?: number };
  costReductions?: CostReduction[];
  chooseCreatureTypeOnEnter?: boolean;
  entersWithXCounters?: boolean;
  playLandsFromGraveyard?: boolean;
  additionalCost?: AdditionalCastCost;
  dynamicPt?: { count: DynamicCount };
  bonusPt?: { power: number; toughness: number; per: DynamicCount };
  modeChoice?: { min: number; max: number; maxIfCommander?: number };
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

function normalizeOracleText(card: OracleCard): string {
  const printedName = card.name.includes(" // ") ? (card.name.split(" // ")[0] ?? card.name) : card.name;
  let text = stripReminderText(card.oracleText).replace(/\r/g, "");
  text = text.replace(new RegExp(escapeRegex(printedName), "gi"), "~");
  const shortName = printedName.split(",")[0]?.trim();
  if (shortName && shortName !== printedName) {
    text = text.replace(new RegExp(`\\b${escapeRegex(shortName)}\\b`, "gi"), "~");
  }
  text = text.replace(/\bthis (?:creature|artifact|enchantment|land|permanent|planeswalker)\b/gi, "~");
  text = text.replace(/\benters the battlefield\b/gi, "enters");
  // Periods inside quoted granted abilities ('… have "{T}: Add {C}."') must
  // not split the sentence; shield them, split, then restore.
  text = text.replace(/"[^"]*"/g, (quoted) => quoted.replace(/\./g, ""));
  return text;
}

function restoreSentence(part: string): string {
  return part.replace(//g, ".").replace(/\s+/g, " ").trim();
}

export function splitOracleSentences(card: OracleCard): string[] {
  return normalizeOracleText(card)
    .split(/[.\n]+/)
    .map(restoreSentence)
    .filter(Boolean);
}

/**
 * Sentences grouped by printed line. Oracle text separates whole abilities
 * with newlines; sentences within one line belong to the same ability
 * (multi-sentence activated bodies and their riders).
 */
export function splitOracleSentencesByLine(card: OracleCard): string[][] {
  return normalizeOracleText(card)
    .split(/\n+/)
    .map((line) => line.split(/\.+/).map(restoreSentence).filter(Boolean))
    .filter((line) => line.length > 0);
}
function isKeywordLine(sentence: string): boolean {
  const parts = sentence
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  return parts.length > 0 && parts.every((part) => KEYWORD_LINE.has(part));
}

const SACRIFICE_COST = /Sacrifice (?:~|this land|this creature|this artifact|this permanent)/i;
const SACRIFICE_TYPE_COST = /Sacrifice (?:an? |another )(creature|artifact|land|Treasure)\b/i;
const LIFE_COST = /Pay (\d+) life/i;
const TAP_CREATURE_COST = /Tap an untapped creature you control/i;
const COST_UNIT =
  "(?:\\{[^}]+\\})+|Sacrifice (?:~|this land|this creature|this artifact|this permanent)|Sacrifice (?:an? |another )(?:creature|artifact|land|Treasure)|Pay \\d+ life|Tap an untapped creature you control";

function splitAbility(sentence: string): { costText: string; rest: string } | null {
  // "Metalcraft — {T}: …" — the ability word is flavor (Mox Opal).
  const stripped = sentence.replace(
    /^(?:Metalcraft|Landfall|Threshold|Delirium|Hellbent|Vivid)\s*[—-]\s*(?=\{)/i,
    "",
  );
  const match = stripped.match(
    new RegExp(`^((?:${COST_UNIT})(?:,\\s*(?:${COST_UNIT}))*):\\s*(.+)$`, "i"),
  );
  if (!match?.[1] || !match[2]) {
    return null;
  }
  return { costText: match[1], rest: match[2].trim() };
}

function parseAbilityCost(
  costText: string,
): {
  tap: boolean;
  manaCost: string;
  sacrificeSelf: boolean;
  lifeCost?: number;
  sacrificeCost?: "creature" | "another_creature" | "artifact" | "land" | "treasure";
  tapCreature?: boolean;
} | null {
  const tapCreature = TAP_CREATURE_COST.test(costText);
  const sacrificeSelf = SACRIFICE_COST.test(costText);
  const sacrificeTypeMatch = SACRIFICE_COST.test(costText)
    ? null
    : costText.match(SACRIFICE_TYPE_COST);
  const another = /Sacrifice another /i.test(costText);
  const sacrificeCost = sacrificeTypeMatch?.[1]
    ? another && sacrificeTypeMatch[1].toLowerCase() === "creature"
      ? ("another_creature" as const)
      : (sacrificeTypeMatch[1].toLowerCase() as "creature" | "artifact" | "land" | "treasure")
    : undefined;
  const lifeMatch = costText.match(LIFE_COST);
  const lifeCost = lifeMatch?.[1] ? Number(lifeMatch[1]) : undefined;
  const symbols = [...costText.matchAll(/\{([^}]+)\}/g)].map((match) => match[1] ?? "");
  if (symbols.length === 0 && !sacrificeSelf && !lifeCost && !sacrificeCost && !tapCreature) {
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
  return {
    tap,
    manaCost,
    sacrificeSelf,
    ...(lifeCost ? { lifeCost } : {}),
    ...(sacrificeCost ? { sacrificeCost } : {}),
    ...(tapCreature ? { tapCreature: true } : {}),
  };
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
  if (/^two or fewer other lands$/i.test(rest)) {
    return { kind: "other_lands_at_most", count: 2 };
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
  const crowd = sentence.match(/^~ enters tapped unless you have (two|three) or more opponents$/i);
  if (crowd?.[1]) {
    return {
      kind: "enters_tapped_unless",
      unless: { kind: "opponents", count: parseCount(crowd[1]) ?? 2 },
    };
  }
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
      ...(add.countFromPower ? { countFromPower: true } : {}),
      ...(add.count && add.count > 1 ? { count: add.count } : {}),
    };
  }
  if (add.kind === "any_color_among") {
    return {
      produces: {},
      producesOptions: [],
      producesAnyColor: false,
      damageToController: 0,
      anyColorAmong: add.scope,
    };
  }
  if (add.kind === "colors_among") {
    return {
      produces: {},
      producesOptions: [],
      producesAnyColor: false,
      damageToController: 0,
      producesColorsAmong: add.scope,
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
  | { kind: "any_color"; identityRestricted: boolean; count?: number; countFromPower?: boolean }
  | { kind: "any_color_among"; scope: "legendary" }
  | { kind: "colors_among"; scope: "permanents" }
  | { kind: "or"; colors: ManaColor[] };

function parseAddMana(rest: string): AddManaResult | null {
  const text = rest.trim();
  // Mox Amber: the choice is limited to colors among controlled legendaries.
  if (
    /^Add one mana of any color among legendary creatures and planeswalkers you control$/i.test(
      text,
    )
  ) {
    return { kind: "any_color_among", scope: "legendary" };
  }
  // Bloom Tender: one mana of each color represented on your board.
  if (/^For each color among permanents you control, add one mana of that color$/i.test(text)) {
    return { kind: "colors_among", scope: "permanents" };
  }
  const identity = /any color in your commander'?s color identity/i.test(text);
  if (/^Add one mana of any color(?: in your commander'?s color identity)?$/i.test(text)) {
    return { kind: "any_color", identityRestricted: identity };
  }
  const big = text.match(/^Add (two|three|four|five) mana of any one color$/i);
  if (big?.[1]) {
    return { kind: "any_color", identityRestricted: false, count: parseCount(big[1]) ?? 1 };
  }
  // Kami of Whispered Hopes: the amount reads the creature's power at tap.
  if (/^Add X mana of any one color, where X is (?:this creature|~)'s power$/i.test(text)) {
    return { kind: "any_color", identityRestricted: false, countFromPower: true };
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

/**
 * Fold a subject rider ("It gains haste", "Sacrifice it at the beginning of
 * the next end step") into the previous effect when it created or moved a
 * permanent onto the battlefield. Returns true when consumed.
 */
function foldSubjectRider(effects: CardEffect[], sentence: string): boolean {
  const last = effects[effects.length - 1];
  if (!last) {
    return false;
  }
  const supports =
    last.kind === "copy_token" ||
    (last.kind === "move_card" && last.toZone === "battlefield");
  if (!supports) {
    return false;
  }
  if (/^(?:It|They|That token|That creature) gains? haste$/i.test(sentence)) {
    last.gainsHaste = true;
    return true;
  }
  const delayed = sentence.match(
    /^(Sacrifice|Exile) (?:it|them|that token|that creature) at the beginning of the next end step$/i,
  );
  if (delayed?.[1]) {
    last.atEndStep = delayed[1].toLowerCase() === "sacrifice" ? "sacrifice" : "exile";
    return true;
  }
  return false;
}

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

  const wipe = sentence.match(
    /^Destroy all (creatures|artifacts|enchantments|planeswalkers|nonland permanents|artifacts and enchantments)(?: with mana value (\d+) or (less|greater))?$/i,
  );
  if (wipe?.[1]) {
    const named = wipe[1].toLowerCase();
    const scopes: DestroyAllScope[] =
      named === "artifacts and enchantments"
        ? ["artifacts", "enchantments"]
        : named === "nonland permanents"
          ? ["nonland"]
          : [named as DestroyAllScope];
    const maxManaValue =
      wipe[2] && wipe[3]?.toLowerCase() === "less" ? Number(wipe[2]) : undefined;
    const minManaValue =
      wipe[2] && wipe[3]?.toLowerCase() === "greater" ? Number(wipe[2]) : undefined;
    return {
      targetRequirements: [],
      effects: scopes.map((what) => ({
        kind: "destroy_all",
        what,
        ...(maxManaValue !== undefined ? { maxManaValue } : {}),
        ...(minManaValue !== undefined ? { minManaValue } : {}),
      })),
    };
  }

  const loseLife = sentence.match(/^You lose (\d+) life$/i);
  if (loseLife?.[1]) {
    return {
      targetRequirements: [],
      effects: [{ kind: "lose_life", playerId: "controller", amount: Number(loseLife[1]) }],
    };
  }

  const drainAll = sentence.match(/^each opponent loses (\d+) life and you gain (\d+) life$/i);
  if (drainAll?.[1] && drainAll[2]) {
    return {
      targetRequirements: [],
      effects: [
        { kind: "lose_life", playerId: "each_opponent", amount: Number(drainAll[1]) },
        { kind: "gain_life", playerId: "controller", amount: Number(drainAll[2]) },
      ],
    };
  }

  if (/^Exile ~$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [{ kind: "move_card", cardId: "self", toZone: "exile" }],
    };
  }

  // "When ~ dies, return it to the battlefield tapped under its owner's
  // control [with a +1/+1 counter on it]."
  const selfReturn = sentence.match(
    /^return (?:it|~) to the battlefield( tapped)?(?: under its owner's control)?( with a \+1\/\+1 counter on it)?$/i,
  );
  if (selfReturn) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "move_card",
          cardId: "self",
          toZone: "battlefield",
          ...(selfReturn[1] ? { entersTapped: true } : {}),
        },
        ...(selfReturn[2]
          ? [{ kind: "add_counter" as const, cardId: "self", counter: "p1p1", amount: 1 }]
          : []),
      ],
    };
  }

  const unblockable = sentence.match(
    /^(target creature|~)(?: with power (\d+) or less)? can't be blocked this turn$/i,
  );
  if (unblockable?.[1]) {
    if (unblockable[1].toLowerCase() === "~") {
      return {
        targetRequirements: [],
        effects: [{ kind: "restrict_until_eot", cardId: "self", cantBeBlocked: true }],
      };
    }
    return {
      targetRequirements: [
        {
          kind: "creature",
          ...(unblockable[2] ? { maxPower: Number(unblockable[2]) } : {}),
        },
      ],
      effects: [
        { kind: "restrict_until_eot", cardId: { type: "chosen", index: 0 }, cantBeBlocked: true },
      ],
    };
  }

  if (/^shuffle ~ into its owner's library$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [
        { kind: "move_card", cardId: "self", toZone: "library", libraryPosition: "shuffled" },
      ],
    };
  }

  if (/^return a land you control to its owner's hand$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "choose_card",
          chooserId: "controller",
          sources: [{ playerId: "controller", zone: "battlefield", filter: "land" }],
          thenEffects: [{ kind: "move_card", cardId: "chosen_card", toZone: "hand" }],
        },
      ],
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

  match = sentence.match(
    /^(?:~|this \w+) deals (\d+|X) damage to each creature( and each player| and each planeswalker)?$/i,
  );
  if (match?.[1]) {
    const amount = match[1].toUpperCase() === "X" ? ("x" as const) : Number(match[1]);
    const includePlayers = (match[2] ?? "").toLowerCase().includes("player");
    if (!(match[2] ?? "").toLowerCase().includes("planeswalker")) {
      return {
        targetRequirements: [],
        effects: [
          {
            kind: "damage_all",
            sourceId: "self",
            amount,
            ...(includePlayers ? { includePlayers: true } : {}),
          },
        ],
      };
    }
  }

  // City of Brass: the tapped land pings its own controller.
  match = sentence.match(/^it deals (\d+) damage to you$/i);
  if (match?.[1]) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "deal_damage",
          sourceId: "self",
          target: { type: "player", playerId: "controller" },
          amount: Number(match[1]),
        },
      ],
    };
  }

  match = sentence.match(/^(?:~|this \w+) deals (\d+) damage to each opponent$/i);
  if (match?.[1]) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "deal_damage",
          sourceId: "self",
          target: { type: "player", playerId: "each_opponent" },
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

  // Drakuseth: a primary target plus up to two optional extras.
  const multiBlast = sentence.match(
    /^it deals (\d+) damage to any target and (\d+) damage to each of up to two other targets$/i,
  );
  if (multiBlast?.[1] && multiBlast[2]) {
    const first = Number(multiBlast[1]);
    const rest = Number(multiBlast[2]);
    return {
      targetRequirements: [
        { kind: "player_or_creature" },
        { kind: "player_or_creature", optional: true },
        { kind: "player_or_creature", optional: true },
      ],
      effects: [0, 1, 2].map((index) => ({
        kind: "deal_damage" as const,
        sourceId: "self" as const,
        target: { type: "chosen" as const, index },
        amount: index === 0 ? first : rest,
      })),
    };
  }

  // Scourge of Valkas: X scales with the controller's tribe at resolution.
  const tribalDamage = sentence.match(
    /^it deals X damage to any target, where X is the number of ([A-Za-z]+) you control$/i,
  );
  if (tribalDamage?.[1]) {
    return {
      targetRequirements: [{ kind: "player_or_creature" }],
      effects: [
        {
          kind: "deal_damage",
          sourceId: "self",
          target: { type: "chosen", index: 0 },
          amount: { subtypeCount: singularSubtype(tribalDamage[1]) },
        },
      ],
    };
  }

  // Fling / Kazuul's Fury: the power was captured when the cost was paid.
  if (/^(?:~ )?deals damage equal to the sacrificed creature's power to any target$/i.test(sentence)) {
    return {
      targetRequirements: [{ kind: "player_or_creature" }],
      effects: [
        {
          kind: "deal_damage",
          sourceId: "self",
          target: { type: "chosen", index: 0 },
          amount: "sacrificed_power",
        },
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

  match = sentence.match(/^(?:~ )?deals (\d+) damage to target player or planeswalker$/i);
  if (match?.[1]) {
    return {
      targetRequirements: [{ kind: "player_or_planeswalker" }],
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

  // Wave Goodbye: mass bounce that spares counter-carrying creatures.
  if (/^Return each creature without a \+1\/\+1 counter on it to its owner's hand$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [{ kind: "bounce_each_creature", unlessCounter: "p1p1" }],
    };
  }

  if (/^Return each creature to its owner's hand$/i.test(sentence)) {
    return { targetRequirements: [], effects: [{ kind: "bounce_each_creature" }] };
  }

  // Aetherize.
  if (/^Return all attacking creatures to their owner(?:'s|s') hands?$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [{ kind: "bounce_each_creature", onlyAttacking: true }],
    };
  }

  if (/^(?:then )?populate$/i.test(sentence)) {
    return { targetRequirements: [], effects: [{ kind: "populate", playerId: "controller" }] };
  }

  // Mesmeric Orb's body: the untapped permanent's controller mills.
  const subjectMill = sentence.match(
    /^that (?:permanent|creature|player)(?:'s controller)? mills? (a|one|two|three|\d+) cards?$/i,
  );
  if (subjectMill?.[1]) {
    const count = parseCount(subjectMill[1]);
    if (count) {
      return {
        targetRequirements: [],
        effects: [{ kind: "mill", playerId: { type: "subject_player" }, count }],
      };
    }
  }

  // Chain Reaction: X scales with the battlefield at resolution.
  if (
    /^~ deals X damage to each creature, where X is the number of creatures on the battlefield$/i.test(
      sentence,
    )
  ) {
    return {
      targetRequirements: [],
      effects: [{ kind: "damage_all", sourceId: "self", amount: "creature_count" }],
    };
  }

  // The synthetic impulse-dig sentence from fuseDigSentencesInPlace. The
  // pick is auto-taken (first match) — a documented approximation.
  const digTop = sentence.match(/^Dig (\d+) for (.+?) to (hand|battlefield|battlefield_tapped)$/);
  if (digTop?.[1] && digTop[2] && digTop[3]) {
    const filter = parseDigDescriptor(digTop[2]);
    if (filter) {
      return {
        targetRequirements: [],
        effects: [
          {
            kind: "dig_top",
            playerId: "controller",
            count: Number(digTop[1]),
            filter,
            destination: digTop[3] as "hand" | "battlefield" | "battlefield_tapped",
          },
        ],
      };
    }
  }

  // Windfall / wheel refills keyed to the biggest discarded hand.
  if (
    /^Each player discards their hand, then draws cards equal to the greatest number of cards a player discarded this way$/i.test(
      sentence,
    )
  ) {
    return { targetRequirements: [], effects: [{ kind: "windfall" }] };
  }

  // Trostani: the entering creature's toughness feeds the gain.
  if (/^you gain life equal to (?:that creature's|its) toughness$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [{ kind: "gain_life", playerId: "controller", amount: "subject_toughness" }],
    };
  }

  // Tatyova-class compound: "you gain 1 life and draw a card".
  const gainDraw = sentence.match(
    /^you gain (\d+|a|an|one|two|three|four|five) life and draw (a|an|one|two|three|\d+) cards?$/i,
  );
  if (gainDraw?.[1] && gainDraw[2]) {
    const life = parseCount(gainDraw[1]);
    const cards = parseCount(gainDraw[2]);
    if (life && cards) {
      return {
        targetRequirements: [],
        effects: [
          { kind: "gain_life", playerId: "controller", amount: life },
          { kind: "draw", playerId: "controller", count: cards },
        ],
      };
    }
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

  // Massacre Wurm: "that player" is the trigger subject's controller.
  match = sentence.match(/^that player loses (\d+) life$/i);
  if (match?.[1]) {
    return {
      targetRequirements: [],
      effects: [
        { kind: "lose_life", playerId: { type: "subject_player" }, amount: Number(match[1]) },
      ],
    };
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

  // "That much" reads the trigger event's amount (Sanguine Bond, Exquisite
  // Blood); outside a life trigger it binds to 0 and fizzles silently.
  if (/^target opponent loses that much life$/i.test(sentence)) {
    return {
      targetRequirements: [{ kind: "opponent" }],
      effects: [
        { kind: "lose_life", playerId: { type: "chosen", index: 0 }, amount: "subject_amount" },
      ],
    };
  }

  if (/^(?:you )?gain that much life$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [{ kind: "gain_life", playerId: "controller", amount: "subject_amount" }],
    };
  }

  // Faerie Mastermind: symmetric group draw.
  const eachDraw = sentence.match(/^each player draws (a|an|one|two|three|\d+) cards?$/i);
  if (eachDraw?.[1]) {
    const count = parseCount(eachDraw[1]);
    if (count) {
      return {
        targetRequirements: [],
        effects: [{ kind: "draw", playerId: "each_player", count }],
      };
    }
  }

  // Stormfist Crusader: symmetric draw-and-drain upkeep.
  const eachDrawLose = sentence.match(
    /^each player draws (a|an|one|two|\d+) cards? and loses (\d+|one|two) life$/i,
  );
  if (eachDrawLose?.[1] && eachDrawLose[2]) {
    const count = parseCount(eachDrawLose[1]);
    const amount = parseCount(eachDrawLose[2]);
    if (count && amount) {
      return {
        targetRequirements: [],
        effects: [
          { kind: "draw", playerId: "each_player", count },
          { kind: "lose_life", playerId: "each_player", amount },
        ],
      };
    }
  }

  // Murderous Rider: the dies-trigger tucks the card away.
  if (/^put (?:it|~) on the bottom of its owner's library$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [
        { kind: "move_card", cardId: "self", toZone: "library", libraryPosition: "bottom" },
      ],
    };
  }

  if (/^each opponent loses that much life$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [{ kind: "lose_life", playerId: "each_opponent", amount: "subject_amount" }],
    };
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

  // Looting/rummaging: "Draw two cards, then discard two cards."
  const looting = sentence.match(
    /^(?:you )?draw (a|an|one|two|three|four|\d+) cards?, then discard (a|an|one|two|three|four|\d+) cards?$/i,
  );
  if (looting?.[1] && looting[2]) {
    const drawn = parseCount(looting[1]);
    const discarded = parseCount(looting[2]);
    if (drawn && discarded) {
      return {
        targetRequirements: [],
        effects: [
          { kind: "draw", playerId: "controller", count: drawn },
          { kind: "discard", playerId: "controller", count: discarded },
        ],
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

  // Return of the Wildspeaker: the count reads the board at resolution.
  match = sentence.match(
    /^Draw cards equal to the greatest power among (?:non-([A-Za-z]+) )?creatures you control$/i,
  );
  if (match) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "draw",
          playerId: "controller",
          count: 0,
          countFromGreatestPower: match[1] ? { nonSubtypes: [match[1].toLowerCase()] } : {},
        },
      ],
    };
  }

  // Rhystic Study / Mystic Remora: the tax prompt goes to "that player".
  // Esper Sentinel: the tax scales with the watcher's power at trigger time.
  if (/^draw a card unless that player pays \{X\}, where X is ~'s power$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "unless_pays",
          playerId: { type: "subject_player" },
          cost: "{1}",
          costFromPower: true,
          effects: [{ kind: "draw", playerId: "controller", count: 1 }],
        },
      ],
    };
  }

  match = sentence.match(/^(you may )?draw a card unless that player pays ((?:\{[^}]+\})+)$/i);
  if (match?.[2]) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "unless_pays",
          playerId: { type: "subject_player" },
          cost: match[2],
          effects: [
            {
              kind: "draw",
              playerId: "controller",
              count: 1,
              ...(match[1] ? { optional: true } : {}),
            },
          ],
        },
      ],
    };
  }

  // "You may draw": auto-taken, declined only when the library is too small
  // (a documented approximation — see RULES_COVERAGE.md).
  match = sentence.match(/^you may draw (a|one|two|three) cards?$/i);
  if (match?.[1]) {
    const count = parseCount(match[1]);
    if (count) {
      return {
        targetRequirements: [],
        effects: [{ kind: "draw", playerId: "controller", count, optional: true }],
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

  // Syr Konrad's activation body.
  match = sentence.match(/^Each player mills (a|an|one|two|three|\d+) cards?$/i);
  if (match?.[1]) {
    const count = parseCount(match[1]);
    if (count) {
      return {
        targetRequirements: [],
        effects: [{ kind: "mill", playerId: "each_player", count }],
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

  const exilePermanent = sentence.match(
    /^exile target (artifact or enchantment|artifact|enchantment|nonland permanent)$/i,
  );
  if (exilePermanent?.[1]) {
    const what = exilePermanent[1].toLowerCase();
    return {
      targetRequirements: [
        {
          kind:
            what === "artifact or enchantment"
              ? "artifact_or_enchantment"
              : what === "nonland permanent"
                ? "nonland_permanent"
                : (what as "artifact" | "enchantment"),
        },
      ],
      effects: [{ kind: "move_card", cardId: { type: "chosen", index: 0 }, toZone: "exile" }],
    };
  }

  if (/^return target creature to (?:its|their) owner's hand$/i.test(sentence)) {
    return {
      targetRequirements: [{ kind: "creature" }],
      effects: [{ kind: "move_card", cardId: { type: "chosen", index: 0 }, toZone: "hand" }],
    };
  }

  const targetCounter = sentence.match(
    /^put (a|one|two|three|four) \+1\/\+1 counters? on (target creature you control|target artifact or creature you control|target creature|~)$/i,
  );
  if (targetCounter?.[1] && targetCounter[2]) {
    const amount = parseCount(targetCounter[1]) ?? 1;
    const what = targetCounter[2].toLowerCase();
    if (what === "~") {
      return {
        targetRequirements: [],
        effects: [{ kind: "add_counter", cardId: "self", counter: "p1p1", amount }],
      };
    }
    return {
      targetRequirements: [
        what === "target creature"
          ? { kind: "creature" }
          : what === "target creature you control"
            ? { kind: "creature", control: "own" }
            : { kind: "creature_or_artifact", control: "own" },
      ],
      effects: [
        { kind: "add_counter", cardId: { type: "chosen", index: 0 }, counter: "p1p1", amount },
      ],
    };
  }

  const tokenCopy = sentence.match(
    /^create a token that's a copy of (another )?target (artifact or creature|creature)( you control)?$/i,
  );
  if (tokenCopy?.[2]) {
    return {
      targetRequirements: [
        {
          kind:
            tokenCopy[2].toLowerCase() === "artifact or creature"
              ? "creature_or_artifact"
              : "creature",
          ...(tokenCopy[3] ? { control: "own" as const } : {}),
        },
      ],
      effects: [
        { kind: "copy_token", ownerId: "controller", ofCardId: { type: "chosen", index: 0 } },
      ],
    };
  }

  if (/^put a \+1\/\+1 counter on each creature target player controls$/i.test(sentence)) {
    return {
      targetRequirements: [{ kind: "player" }],
      effects: [
        {
          kind: "counter_on_controlled_creatures",
          playerId: { type: "chosen", index: 0 },
          counter: "p1p1",
          amount: 1,
        },
      ],
    };
  }

  if (/^search your library for a card, then shuffle and put that card on top$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "search_library",
          playerId: "controller",
          filter: {},
          destination: "library_top",
          count: 1,
        },
      ],
    };
  }

  if (/^prevent all combat damage that would be dealt this turn$/i.test(sentence)) {
    return { targetRequirements: [], effects: [{ kind: "fog" }] };
  }

  // Documented auto-take: "you may destroy/exile target X" compiles as the
  // mandatory form — trigger targeting already skips with no legal target.
  const mayTargeted = sentence.match(/^you may (destroy|exile) target (.+)$/i);
  if (mayTargeted?.[1] && mayTargeted[2]) {
    return compileSimpleClause(`${mayTargeted[1]} target ${mayTargeted[2]}`);
  }

  if (/^proliferate$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [{ kind: "proliferate", playerId: "controller" }],
    };
  }

  if (/^untap ~$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [{ kind: "untap", cardId: "self" }],
    };
  }

  const untapUpTo = sentence.match(/^untap up to (one|two|three|four|five) lands$/i);
  if (untapUpTo?.[1]) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "untap_lands_up_to",
          playerId: "controller",
          count: parseCount(untapUpTo[1]) ?? 1,
        },
      ],
    };
  }

  const painThatPlayer = sentence.match(/^~ deals (\d+) damage to that player$/i);
  if (painThatPlayer?.[1]) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "deal_damage",
          sourceId: "self",
          amount: Number(painThatPlayer[1]),
          target: { type: "player", playerId: { type: "subject_player" } },
        },
      ],
    };
  }

  const untapAll = sentence.match(/^untap all (creatures|lands) you control$/i);
  if (untapAll?.[1]) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "untap_all",
          playerId: "controller",
          what: untapAll[1].toLowerCase() === "creatures" ? "creature" : "land",
        },
      ],
    };
  }

  if (/^untap another target artifact$/i.test(sentence)) {
    return {
      targetRequirements: [{ kind: "artifact", excludeSource: true }],
      effects: [{ kind: "untap", cardId: { type: "chosen", index: 0 } }],
    };
  }

  if (/^untap target artifact$/i.test(sentence)) {
    return {
      targetRequirements: [{ kind: "artifact" }],
      effects: [{ kind: "untap", cardId: { type: "chosen", index: 0 } }],
    };
  }

  if (/^return another target artifact card from your graveyard to your hand$/i.test(sentence)) {
    return {
      targetRequirements: [{ kind: "own_graveyard_artifact_card", excludeSource: true }],
      effects: [{ kind: "move_card", cardId: { type: "chosen", index: 0 }, toZone: "hand" }],
    };
  }

  const putLand = sentence.match(
    /^you may put a land card from your hand onto the battlefield( tapped)?$/i,
  );
  if (putLand) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "choose_card",
          chooserId: "controller",
          sources: [{ playerId: "controller", zone: "hand", filter: "land" }],
          thenEffects: [
            {
              kind: "move_card",
              cardId: "chosen_card",
              toZone: "battlefield",
              ...(putLand[1] ? { entersTapped: true } : {}),
            },
          ],
        },
      ],
    };
  }

  if (/^untap target creature$/i.test(sentence)) {
    return {
      targetRequirements: [{ kind: "creature" }],
      effects: [{ kind: "untap", cardId: { type: "chosen", index: 0 } }],
    };
  }

  if (
    /^after this (?:main )?phase, there is an additional combat phase(?: followed by an additional main phase)?$/i.test(
      sentence,
    )
  ) {
    return {
      targetRequirements: [],
      effects: [{ kind: "extra_combat" }],
    };
  }

  // Red Elemental Blast / Pyroblast ("if it's blue" compiles as a color-
  // restricted target — a documented approximation of the may-target-anything
  // wording; the outcomes match in practice).
  match =
    sentence.match(/^Counter target (white|blue|black|red|green) spell$/i) ??
    sentence.match(/^Counter target spell if it's (white|blue|black|red|green)$/i);
  if (match?.[1]) {
    return {
      targetRequirements: [
        { kind: "spell", requiredColors: [COLOR_WORDS[match[1].toLowerCase()]!] },
      ],
      effects: [{ kind: "counter_spell", target: { type: "chosen", index: 0 } }],
    };
  }

  match =
    sentence.match(/^Destroy target (white|blue|black|red|green) permanent$/i) ??
    sentence.match(/^Destroy target permanent if it's (white|blue|black|red|green)$/i);
  if (match?.[1]) {
    return {
      targetRequirements: [
        { kind: "permanent", requiredColors: [COLOR_WORDS[match[1].toLowerCase()]!] },
      ],
      effects: [{ kind: "move_card", cardId: { type: "chosen", index: 0 }, toZone: "graveyard" }],
    };
  }

  if (/^Your opponents can't cast spells this turn$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [{ kind: "silence", playerId: "controller" }],
    };
  }

  if (/^counter target spell$/i.test(sentence)) {
    return {
      targetRequirements: [{ kind: "spell" }],
      effects: [{ kind: "counter_spell", target: { type: "chosen", index: 0 } }],
    };
  }

  if (/^copy target instant or sorcery spell$/i.test(sentence)) {
    return {
      targetRequirements: [{ kind: "instant_or_sorcery_spell" }],
      effects: [{ kind: "copy_spell", target: { type: "chosen", index: 0 } }],
    };
  }

  if (/^copy (?:that spell|it)$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [{ kind: "copy_subject_spell" }],
    };
  }

  if (/^counter (?:that spell|it)$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [{ kind: "counter_subject_spell" }],
    };
  }

  match = sentence.match(
    /^Counter target (spell|noncreature spell|creature spell|instant or sorcery spell) unless its controller pays \{(\d+)\}$/i,
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
                : what === "instant or sorcery spell"
                  ? "instant_or_sorcery_spell"
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

  if (/^Destroy target creature or planeswalker$/i.test(sentence)) {
    return {
      targetRequirements: [{ kind: "creature_or_planeswalker" }],
      effects: [{ kind: "move_card", cardId: { type: "chosen", index: 0 }, toZone: "graveyard" }],
    };
  }

  // The engine has no regeneration, so the denial is truthfully a no-op.
  if (/^it can't be regenerated$/i.test(sentence)) {
    return { targetRequirements: [], effects: [] };
  }

  // Documented approximation (matches storm): copies keep the original's
  // targets, so the retargeting permission compiles as a no-op.
  if (/^You may choose new targets for (?:the|that) cop(?:y|ies)$/i.test(sentence)) {
    return { targetRequirements: [], effects: [] };
  }

  // Feign Death family: an until-EOT "when it dies, return it tapped" grant,
  // optionally with +2/+0, a +1/+1 counter, or a Treasure rider.
  const diesReturn = sentence.match(
    /^Until end of turn, target creature (?:gets \+2\/\+0 and )?gains "When (?:~|this creature) dies, return it to the battlefield tapped under its owner's control(?:( with a \+1\/\+1 counter on it)|( and you create a Treasure token))?\."$/i,
  );
  if (diesReturn) {
    const pump = /gets \+2\/\+0/i.test(sentence);
    return {
      targetRequirements: [{ kind: "creature" }],
      effects: [
        ...(pump
          ? [
              {
                kind: "pt_until_eot" as const,
                cardId: { type: "chosen" as const, index: 0 },
                power: 2,
                toughness: 0,
              },
            ]
          : []),
        {
          kind: "grant_dies_return",
          cardId: { type: "chosen", index: 0 },
          ...(diesReturn[1] ? { counter: true } : {}),
          ...(diesReturn[2] ? { treasure: true } : {}),
        },
      ],
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

  // Jeska's Will: the count reads the chosen opponent's hand at resolution.
  // Must run before the generic ritual parse, which would eat the prefix.
  match = sentence.match(/^Add \{([WUBRGC])\} for each card in target opponent's hand$/i);
  if (match?.[1]) {
    return {
      targetRequirements: [{ kind: "opponent" }],
      effects: [
        {
          kind: "add_mana",
          playerId: "controller",
          mana: { [match[1].toUpperCase()]: 1 },
          perChosenPlayerHand: true,
        },
      ],
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
    /^Draw (a|one|two|three) cards? and create (a|one|two|three) (Treasure|Clue|Food) tokens?$/i,
  );
  if (match?.[1] && match[2] && match[3]) {
    const drawCount = parseCount(match[1]);
    const tokenCount = parseCount(match[2]);
    const name = match[3][0]!.toUpperCase() + match[3].slice(1).toLowerCase();
    if (drawCount && tokenCount) {
      return {
        targetRequirements: [],
        effects: [
          { kind: "draw", playerId: "controller", count: drawCount },
          ...Array.from({ length: tokenCount }, () => ({
            kind: "create_token" as const,
            ownerId: "controller" as const,
            name,
            typeLine: `Artifact — ${name} Token`,
            power: null,
            toughness: null,
          })),
        ],
      };
    }
  }

  // Etali: everyone's top card, castable free this turn.
  if (
    /^exile the top card of each player's library, then you may cast any number of spells from among (?:those cards|them) without paying their mana costs?$/i.test(
      sentence,
    )
  ) {
    return {
      targetRequirements: [],
      effects: [{ kind: "exile_top_play", playerId: "each_player", count: 1, freeCast: true }],
    };
  }

  // Impulse exiles (fused by fuseExilePlayInPlace): cast/play this turn,
  // paying costs as normal.
  match = sentence.match(/^impulse(?: (\d+))? from your library$/i);
  if (match) {
    return {
      targetRequirements: [],
      effects: [
        { kind: "exile_top_play", playerId: "controller", count: match[1] ? Number(match[1]) : 1 },
      ],
    };
  }

  // Ragavan's compound body: the Treasure plus the damaged player's impulse.
  if (/^create a Treasure token and impulse from that player's library$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "create_token",
          ownerId: "controller",
          name: "Treasure",
          typeLine: "Artifact — Treasure Token",
          power: null,
          toughness: null,
        },
        { kind: "exile_top_play", playerId: { type: "subject_player" }, count: 1 },
      ],
    };
  }

  // Mahadi: tokens keyed to the turn's creature deaths.
  const perDied = sentence.match(
    /^create a (Treasure|Clue|Food) token for each creature that died this turn$/i,
  );
  if (perDied?.[1]) {
    const name = perDied[1][0]!.toUpperCase() + perDied[1].slice(1).toLowerCase();
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "create_token",
          ownerId: "controller",
          name,
          typeLine: `Artifact — ${name} Token`,
          power: null,
          toughness: null,
          perDiedCreatures: true,
        },
      ],
    };
  }

  // Lotho: the second-spell tax body.
  const loseAndTreasure = sentence.match(
    /^you lose (\d+) life and create a (Treasure|Clue|Food) token$/i,
  );
  if (loseAndTreasure?.[1] && loseAndTreasure[2]) {
    const name =
      loseAndTreasure[2][0]!.toUpperCase() + loseAndTreasure[2].slice(1).toLowerCase();
    return {
      targetRequirements: [],
      effects: [
        { kind: "lose_life", playerId: "controller", amount: Number(loseAndTreasure[1]) },
        {
          kind: "create_token",
          ownerId: "controller",
          name,
          typeLine: `Artifact — ${name} Token`,
          power: null,
          toughness: null,
        },
      ],
    };
  }

  // Brass's Bounty: one predefined artifact token per controlled type.
  const perControlledToken = sentence.match(
    /^For each (land|creature|artifact) you control, create a (Treasure|Clue|Food) token$/i,
  );
  if (perControlledToken?.[1] && perControlledToken[2]) {
    const name =
      perControlledToken[2][0]!.toUpperCase() + perControlledToken[2].slice(1).toLowerCase();
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "create_token",
          ownerId: "controller",
          name,
          typeLine: `Artifact — ${name} Token`,
          power: null,
          toughness: null,
          perControlled: perControlledToken[1].toLowerCase() as "land" | "creature" | "artifact",
        },
      ],
    };
  }

  // Tireless Provisioner: "a Food token or a Treasure token" — auto-picks the
  // Treasure (mana is the flexible half), a documented approximation.
  if (/^Create a Food token or a Treasure token$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "create_token",
          ownerId: "controller",
          name: "Treasure",
          typeLine: "Artifact — Treasure Token",
          power: null,
          toughness: null,
        },
      ],
    };
  }

  match = sentence.match(
    /^Create (a|an|one|two|three|four|five|\d+) (Treasure|Clue|Food) tokens?$/i,
  );
  if (match?.[1] && match[2]) {
    const count = parseCount(match[1]);
    const name = match[2][0]!.toUpperCase() + match[2].slice(1).toLowerCase();
    if (count) {
      const token: CardEffect = {
        kind: "create_token",
        ownerId: "controller",
        name,
        typeLine: `Artifact — ${name} Token`,
        power: null,
        toughness: null,
      };
      return {
        targetRequirements: [],
        effects: Array.from({ length: count }, () => ({ ...token })),
      };
    }
  }

  // "You may create" is auto-taken (creating a token is never a downside a
  // casual table would decline) — a documented approximation.
  match = sentence.match(
    /^(?:You may )?Create (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) (\d+)\/(\d+)(?: (white|blue|black|red|green|colorless))? ([\w]+(?: [\w]+)?) creature tokens?( with [a-z ]+)?$/i,
  );
  if (match?.[1] && match[2] && match[3] && match[5]) {
    const count = parseCount(match[1]);
    const power = Number(match[2]);
    const toughness = Number(match[3]);
    const subtype = match[5].replace(/\b\w/g, (letter) => letter.toUpperCase());
    const keywordText = match[6]?.replace(/^ with /i, "");
    const keywords = keywordText
      ? keywordText.split(/ and |, /i).map((word) => KEYWORD_GRANTS[word.trim().toLowerCase()])
      : [];
    if (count && keywords.every((keyword): keyword is Keyword => Boolean(keyword))) {
      const token: CardEffect = {
        kind: "create_token",
        ownerId: "controller",
        name: subtype,
        typeLine: `Creature — ${subtype} Token`,
        power,
        toughness,
        ...(keywords.length > 0 ? { keywords } : {}),
      };
      return {
        targetRequirements: [],
        effects: Array.from({ length: count }, () => ({ ...token })),
      };
    }
  }

  // Avenger of Zendikar: one token per controlled permanent of the type.
  match = sentence.match(
    /^create a (\d+)\/(\d+)(?: (?:white|blue|black|red|green|colorless))? ([\w]+) creature token for each (land|creature|artifact) you control$/i,
  );
  if (match?.[1] && match[2] && match[3] && match[4]) {
    const subtype = match[3].replace(/\b\w/g, (letter) => letter.toUpperCase());
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "create_token",
          ownerId: "controller",
          name: subtype,
          typeLine: `Creature — ${subtype} Token`,
          power: Number(match[1]),
          toughness: Number(match[2]),
          perControlled: match[4].toLowerCase() as "land" | "creature" | "artifact",
        },
      ],
    };
  }

  // Avenger's landfall half ("you may" is auto-taken).
  match = sentence.match(
    /^(?:you may )?put a \+1\/\+1 counter on each ([\w]+) creature you control$/i,
  );
  if (match?.[1]) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "counter_on_each_creature",
          counter: "p1p1",
          amount: 1,
          subtype: match[1].toLowerCase(),
          controlledOnly: true,
        },
      ],
    };
  }

  // Bedevil.
  if (/^Destroy target artifact, creature, or planeswalker$/i.test(sentence)) {
    return {
      targetRequirements: [{ kind: "artifact_creature_or_planeswalker" }],
      effects: [{ kind: "move_card", cardId: { type: "chosen", index: 0 }, toZone: "graveyard" }],
    };
  }

  // Shadowspear.
  match = sentence.match(
    /^Permanents your opponents control lose ([a-z ]+?) and ([a-z ]+?) until end of turn$/i,
  );
  if (match?.[1] && match[2]) {
    const keywords = [match[1], match[2]].map(
      (name) => KEYWORD_GRANTS[name.trim().toLowerCase()],
    );
    if (keywords.every((keyword): keyword is Keyword => Boolean(keyword))) {
      return {
        targetRequirements: [],
        effects: [{ kind: "opponents_lose_keywords_until_eot", keywords }],
      };
    }
  }

  // Scute Swarm's landfall body handles its own conditional copy.

  // Command Beacon.
  if (/^Put your commander into your hand from the command zone$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [{ kind: "commander_to_hand", playerId: "controller" }],
    };
  }

  // Mithril Coat.
  if (/^attach it to target legendary creature you control$/i.test(sentence)) {
    return {
      targetRequirements: [{ kind: "creature", control: "own", legendaryOnly: true }],
      effects: [{ kind: "attach", cardId: "self", toId: { type: "chosen", index: 0 } }],
    };
  }

  // Explore-family.
  if (/^You may play an additional land this turn$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [{ kind: "extra_land_drop", playerId: "controller" }],
    };
  }

  // Arbor Elf ("Untap target Forest") / Voyaging Satyr ("Untap target land").
  match = sentence.match(/^Untap target (land|Plains|Island|Swamp|Mountain|Forest)$/i);
  if (match?.[1]) {
    const word = match[1].toLowerCase();
    return {
      targetRequirements: [
        { kind: "land", ...(word === "land" ? {} : { requiredSubtypes: [word] }) },
      ],
      effects: [{ kind: "untap", cardId: { type: "chosen", index: 0 } }],
    };
  }

  // Maze of Ith.
  if (/^Untap target attacking creature$/i.test(sentence)) {
    return {
      targetRequirements: [{ kind: "creature", attackingOnly: true }],
      effects: [{ kind: "untap", cardId: { type: "chosen", index: 0 } }],
    };
  }

  if (
    /^Prevent all combat damage that would be dealt to and dealt by that creature this turn$/i.test(
      sentence,
    )
  ) {
    return {
      targetRequirements: [],
      effects: [{ kind: "prevent_combat_for", cardId: { type: "chosen", index: 0 } }],
    };
  }

  // Rise of the Dark Realms.
  if (
    /^Put all creature cards from all graveyards onto the battlefield under your control$/i.test(
      sentence,
    )
  ) {
    return {
      targetRequirements: [],
      effects: [{ kind: "mass_reanimate", playerId: "controller" }],
    };
  }

  // Deflecting Swat: retargeting. Abilities on the stack can't be targeted —
  // "spell or ability" compiles to spells only, a documented approximation.
  if (/^You may choose new targets for target spell or ability$/i.test(sentence)) {
    return {
      targetRequirements: [{ kind: "spell" }],
      effects: [{ kind: "retarget", target: { type: "chosen", index: 0 } }],
    };
  }

  // Chandra's Ignition.
  if (
    /^Target creature you control deals damage equal to its power to each other creature and each opponent$/i.test(
      sentence,
    )
  ) {
    return {
      targetRequirements: [{ kind: "creature", control: "own" }],
      effects: [{ kind: "power_nova", cardId: { type: "chosen", index: 0 } }],
    };
  }

  // Unnatural Growth.
  if (
    /^double the power and toughness of each creature you control until end of turn$/i.test(
      sentence,
    )
  ) {
    return {
      targetRequirements: [],
      effects: [{ kind: "double_team_pt_until_eot", playerId: "controller" }],
    };
  }

  // Rakdos Charm's third mode.
  match = sentence.match(/^Each creature deals (\d+) damage to its controller$/i);
  if (match?.[1]) {
    return {
      targetRequirements: [],
      effects: [{ kind: "each_creature_damages_controller", amount: Number(match[1]) }],
    };
  }

  // Land Tax: up to three basics to hand ("you may" is auto-taken; the
  // search prompt already allows taking fewer).
  match = sentence.match(
    /^(?:you may )?search your library for up to (two|three|four) basic land cards, reveal them, put them into your hand, then shuffle(?: your library)?$/i,
  );
  if (match?.[1]) {
    const count = parseCount(match[1]);
    if (count) {
      return {
        targetRequirements: [],
        effects: [
          {
            kind: "search_library",
            playerId: "controller",
            filter: { supertypes: ["basic"], types: ["land"] },
            destination: "hand",
            count,
          },
        ],
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

  // Green Sun's Zenith: an X-capped tutor straight to the battlefield.
  const xTutor = sentence.match(
    /^Search your library for (?:an? )?(.+?) card with mana value X or less, put it (onto the battlefield( tapped)?|into your hand), then shuffle(?: your library)?$/i,
  );
  if (xTutor?.[1] && xTutor[2]) {
    const filter = parseSearchDescriptor(xTutor[1]);
    if (filter) {
      return {
        targetRequirements: [],
        effects: [
          {
            kind: "search_library",
            playerId: "controller",
            filter: { ...filter, maxManaValueX: true },
            destination: xTutor[2].toLowerCase().startsWith("onto") ? "battlefield" : "hand",
            count: 1,
            ...(xTutor[3] ? { entersTapped: true } : {}),
          },
        ],
      };
    }
  }

  match = sentence.match(
    /^(?:you may )?Search your library for (?:up to (one|two|three|\d+) )?(?:an? )?(.+?) cards?(?: and)?, (?:and )?put (?:it|them|that card|those cards) (onto the battlefield(?: tapped)?|into your hand|into your graveyard), then shuffle(?: your library)?$/i,
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

  // Ephemerate / Conjurer's Closet flicker.
  match = sentence.match(
    /^(?:you may )?Exile target creature( you control)?, then return (?:it|that card) to the battlefield(?: under (?:its owner's|your) control)?$/i,
  );
  if (match) {
    return {
      targetRequirements: [{ kind: "creature", ...(match[1] ? { control: "own" as const } : {}) }],
      effects: [{ kind: "flicker", cardId: { type: "chosen", index: 0 } }],
    };
  }

  // Venser, Shaper Savant.
  if (/^return target spell or permanent to its owner's hand$/i.test(sentence)) {
    return {
      targetRequirements: [{ kind: "spell_or_permanent" }],
      effects: [{ kind: "bounce_spell_or_permanent", target: { type: "chosen", index: 0 } }],
    };
  }

  // Tree of Perdition.
  if (/^Exchange target opponent's life total with ~'s toughness$/i.test(sentence)) {
    return {
      targetRequirements: [{ kind: "opponent" }],
      effects: [{ kind: "exchange_life_toughness", playerId: { type: "chosen", index: 0 } }],
    };
  }

  // Otawara: the four-type list is exactly "nonland permanent".
  if (
    /^Return target artifact, creature, enchantment, or planeswalker to its owner's hand$/i.test(
      sentence,
    )
  ) {
    return {
      targetRequirements: [{ kind: "nonland_permanent" }],
      effects: [{ kind: "move_card", cardId: { type: "chosen", index: 0 }, toZone: "hand" }],
    };
  }

  // Generalized bounce, with Cyclonic Rift's "you don't control".
  match = sentence.match(
    /^Return target (creature|artifact|enchantment|permanent|nonland permanent)( you don't control)? to its owner's hand$/i,
  );
  if (match?.[1]) {
    const kindOf: Record<string, TargetKind> = {
      creature: "creature",
      artifact: "artifact",
      enchantment: "enchantment",
      permanent: "permanent",
      "nonland permanent": "nonland_permanent",
    };
    return {
      targetRequirements: [
        {
          kind: kindOf[match[1].toLowerCase()]!,
          ...(match[2] ? { control: "not_own" as const } : {}),
        },
      ],
      effects: [{ kind: "move_card", cardId: { type: "chosen", index: 0 }, toZone: "hand" }],
    };
  }

  match = sentence.match(
    /^Return target (creature |permanent |artifact )?card from your graveyard to (your hand|the battlefield)$/i,
  );
  if (match?.[2]) {
    const filterWord = match[1]?.trim().toLowerCase();
    const creatureOnly = filterWord === "creature";
    const permanentOnly = filterWord === "permanent";
    const artifactOnly = filterWord === "artifact";
    const toHand = match[2].toLowerCase() === "your hand";
    if (toHand || creatureOnly) {
      return {
        targetRequirements: [
          {
            kind: creatureOnly
              ? "own_graveyard_creature_card"
              : permanentOnly
                ? "own_graveyard_permanent_card"
                : artifactOnly
                  ? "own_graveyard_artifact_card"
                  : "own_graveyard_card",
          },
        ],
        effects: [
          {
            kind: "move_card",
            cardId: { type: "chosen", index: 0 },
            toZone: toHand ? "hand" : "battlefield",
          },
        ],
      };
    }
  }

  // Chaos Warp: the shuffle-in, then the conditional reveal-put back half.
  if (
    /^The owner of target permanent shuffles it into their library, then reveals the top card of their library$/i.test(
      sentence,
    )
  ) {
    return {
      targetRequirements: [{ kind: "permanent" }],
      effects: [
        {
          kind: "move_card",
          cardId: { type: "chosen", index: 0 },
          toZone: "library",
          libraryPosition: "shuffled",
        },
      ],
    };
  }

  if (/^If it's a permanent card, they put it onto the battlefield$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [{ kind: "reveal_top_put_permanent", playerId: { type: "chosen_owner", index: 0 } }],
    };
  }

  // Exsanguinate (fused): each opponent loses N; the caster gains the total.
  match = sentence.match(/^drain (X|\d+) from each opponent$/i);
  if (match?.[1]) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "drain_opponents",
          playerId: "controller",
          amount: match[1].toUpperCase() === "X" ? "x" : Number(match[1]),
        },
      ],
    };
  }

  // Gray Merchant of Asphodel (fused): X = the caster's devotion.
  match = sentence.match(/^drain devotion (white|blue|black|red|green) from each opponent$/i);
  if (match?.[1]) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "drain_opponents",
          playerId: "controller",
          amount: { devotion: COLOR_WORDS[match[1].toLowerCase()]! },
        },
      ],
    };
  }

  match = sentence.match(/^Draw a card for each creature you control$/i);
  if (match) {
    return {
      targetRequirements: [],
      effects: [{ kind: "draw", playerId: "controller", count: 0, countPerControlled: "creature" }],
    };
  }

  // Shamanic Revelation's ferocious half (the ability word is flavor).
  match = sentence.match(
    /^(?:Ferocious\s*[—-]\s*)?You gain (\d+) life for each creature you control with power (\d+) or greater$/i,
  );
  if (match?.[1] && match[2]) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "gain_life",
          playerId: "controller",
          amount: Number(match[1]),
          perControlledCreature: { minPower: Number(match[2]) },
        },
      ],
    };
  }

  // Reanimate: steal from ANY graveyard; the life clause follows separately.
  if (
    /^Put target creature card from a graveyard onto the battlefield under your control$/i.test(
      sentence,
    )
  ) {
    return {
      targetRequirements: [{ kind: "graveyard_creature_card" }],
      effects: [
        {
          kind: "move_card",
          cardId: { type: "chosen", index: 0 },
          toZone: "battlefield",
          underControlOf: "controller",
        },
      ],
    };
  }

  // Nature's Claim.
  match = sentence.match(/^Its controller gains (\d+) life$/i);
  if (match?.[1]) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "gain_life",
          playerId: { type: "chosen_controller", index: 0 },
          amount: Number(match[1]),
        },
      ],
    };
  }

  // Sun Titan.
  match = sentence.match(
    /^(?:you may )?return target permanent card with mana value (\d+) or less from your graveyard to the battlefield$/i,
  );
  if (match?.[1]) {
    return {
      targetRequirements: [
        { kind: "own_graveyard_permanent_card", maxManaValue: Number(match[1]) },
      ],
      effects: [{ kind: "move_card", cardId: { type: "chosen", index: 0 }, toZone: "battlefield" }],
    };
  }

  // Craterhoof Behemoth.
  if (
    /^creatures you control gain trample and get \+X\/\+X until end of turn, where X is the number of creatures you control$/i.test(
      sentence,
    )
  ) {
    return {
      targetRequirements: [],
      effects: [
        { kind: "team_keyword_until_eot", playerId: "controller", keyword: "trample" },
        {
          kind: "team_pt_until_eot",
          playerId: "controller",
          power: "creature_count",
          toughness: "creature_count",
        },
      ],
    };
  }

  // Aetherflux Reservoir.
  match = sentence.match(/^you gain (\d+) life for each spell you've cast this turn$/i);
  if (match?.[1]) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "gain_life",
          playerId: "controller",
          amount: Number(match[1]),
          perSpellsCastThisTurn: true,
        },
      ],
    };
  }

  // Swords to Plowshares: the exiled creature's controller gains its power.
  if (/^Its controller gains life equal to its power$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "gain_life",
          playerId: { type: "chosen_controller", index: 0 },
          amount: "target_power",
        },
      ],
    };
  }

  // An Offer You Can't Refuse: the countered spell's controller gets paid.
  match = sentence.match(/^Its controller creates (two|three|\d+) Treasure tokens$/i);
  if (match?.[1]) {
    const count = parseCount(match[1]) ?? Number(match[1]);
    if (count) {
      const token = {
        kind: "create_token" as const,
        ownerId: { type: "chosen_controller" as const, index: 0 },
        name: "Treasure",
        typeLine: "Artifact — Treasure Token",
        power: null,
        toughness: null,
      };
      return {
        targetRequirements: [],
        effects: Array.from({ length: count }, () => ({ ...token })),
      };
    }
  }

  if (/^You lose life equal to that (?:card|permanent)'s mana value$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [{ kind: "lose_life", playerId: "controller", amount: "target_mana_value" }],
    };
  }

  // Toxic Deluge: X was announced as the life paid.
  if (/^All creatures get -X\/-X until end of turn$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [{ kind: "all_pt_until_eot", power: "-x", toughness: "-x" }],
    };
  }

  // Vampiric / Mystical / Worldly / Enlightened Tutor: fetch to the top.
  match = sentence.match(
    /^Search your library for (?:an? )?(.*?)card, (?:reveal it, )?then shuffle(?: your library)? and put (?:that|the) card on top(?: of it| of your library)?$/i,
  );
  if (match) {
    const descriptor = (match[1] ?? "").trim();
    const filter = descriptor ? parseSearchDescriptor(descriptor) : {};
    if (filter) {
      return {
        targetRequirements: [],
        effects: [
          {
            kind: "search_library",
            playerId: "controller",
            filter,
            destination: "library_top",
            count: 1,
          },
        ],
      };
    }
  }

  // Beast Within (single sentence: destroy; the token clause is a pair).
  // Boseiju, Who Endures.
  const boseiju = sentence.match(
    /^Destroy target artifact, enchantment, or nonbasic land( an opponent controls)?$/i,
  );
  if (boseiju) {
    return {
      targetRequirements: [
        {
          kind: "artifact_enchantment_or_nonbasic_land",
          ...(boseiju[1] ? { control: "not_own" as const } : {}),
        },
      ],
      effects: [{ kind: "move_card", cardId: { type: "chosen", index: 0 }, toZone: "graveyard" }],
    };
  }

  const destroyLand = sentence.match(/^Destroy target (nonbasic )?land$/i);
  if (destroyLand) {
    return {
      targetRequirements: [{ kind: "land", ...(destroyLand[1] ? { nonbasicOnly: true } : {}) }],
      effects: [{ kind: "move_card", cardId: { type: "chosen", index: 0 }, toZone: "graveyard" }],
    };
  }

  // Staff of Compleation. Approximation: "you own" is checked as "you
  // control" (ownership and control only diverge under theft effects).
  if (/^Destroy target permanent you own$/i.test(sentence)) {
    return {
      targetRequirements: [{ kind: "permanent", control: "own" }],
      effects: [{ kind: "move_card", cardId: { type: "chosen", index: 0 }, toZone: "graveyard" }],
    };
  }

  if (/^Untap ~$/i.test(sentence)) {
    return { targetRequirements: [], effects: [{ kind: "untap", cardId: "self" }] };
  }

  if (/^Destroy target permanent$/i.test(sentence)) {
    return {
      targetRequirements: [{ kind: "permanent" }],
      effects: [{ kind: "move_card", cardId: { type: "chosen", index: 0 }, toZone: "graveyard" }],
    };
  }

  match = sentence.match(
    /^(Destroy|Exile) target (artifact|enchantment|artifact or enchantment|artifact or creature|creature or artifact|creature or enchantment|nonland permanent|noncreature, nonland permanent|permanent)( you don't control| an opponent controls)?(?: with mana value (\d+) or (less|greater))?$/i,
  );
  if (match?.[1] && match[2] && (match[2].toLowerCase() !== "permanent" || match[3] || match[4])) {
    const kindOf: Record<string, TargetKind> = {
      artifact: "artifact",
      enchantment: "enchantment",
      "artifact or enchantment": "artifact_or_enchantment",
      "artifact or creature": "creature_or_artifact",
      "creature or artifact": "creature_or_artifact",
      "creature or enchantment": "creature_or_enchantment",
      "nonland permanent": "nonland_permanent",
      "noncreature, nonland permanent": "noncreature_nonland_permanent",
      permanent: "permanent",
    };
    const bound = match[4] ? Number(match[4]) : undefined;
    return {
      targetRequirements: [
        {
          kind: kindOf[match[2].toLowerCase()]!,
          ...(match[3] ? { control: "not_own" as const } : {}),
          ...(bound !== undefined && match[5]?.toLowerCase() === "less"
            ? { maxManaValue: bound }
            : {}),
          ...(bound !== undefined && match[5]?.toLowerCase() === "greater"
            ? { minManaValue: bound }
            : {}),
        },
      ],
      effects: [
        {
          kind: "move_card",
          cardId: { type: "chosen", index: 0 },
          toZone: match[1].toLowerCase() === "exile" ? "exile" : "graveyard",
        },
      ],
    };
  }

  // Mother of Runes: the protection color is chosen when this resolves.
  if (
    /^Target creature you control gains protection from the color of your choice until end of turn$/i.test(
      sentence,
    )
  ) {
    return {
      targetRequirements: [{ kind: "own_creature" }],
      effects: [{ kind: "grant_protection_choice", target: { type: "chosen", index: 0 } }],
    };
  }

  // Sensei's Divining Top: reorder without revealing.
  match = sentence.match(
    /^Look at the top (two|three|four|five) cards of your library, then put them back in any order$/i,
  );
  if (match?.[1]) {
    const count = parseCount(match[1]);
    if (count) {
      return {
        targetRequirements: [],
        effects: [
          {
            kind: "look_and_assign",
            playerId: "controller",
            count,
            destinations: Array.from({ length: count }, () => "library_top" as const),
          },
        ],
      };
    }
  }

  // Sensei's Divining Top: the draw spins the top back onto the library.
  if (
    /^Draw a card, then put (?:~|this artifact) on top of its owner's library$/i.test(sentence)
  ) {
    return {
      targetRequirements: [],
      effects: [
        { kind: "draw", playerId: "controller", count: 1 },
        { kind: "move_card", cardId: "self", toZone: "library", libraryPosition: "top" },
      ],
    };
  }

  // Edicts: sacrifice choices belong to the affected players.
  match = sentence.match(
    /^Each (player|opponent|other player) sacrifices (?:a|one) (nontoken )?creature(?: of their choice)?$/i,
  );
  if (match?.[1]) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "choose_card",
          chooserId: match[1].toLowerCase() === "player" ? "each_player" : "each_opponent",
          sources: [
            {
              playerId: match[1].toLowerCase() === "player" ? "each_player" : "each_opponent",
              zone: "battlefield",
              filter: match[2] ? "nontoken_creature" : "creature",
            },
          ],
          thenEffects: [{ kind: "sacrifice", cardId: "chosen_card" }],
        },
      ],
    };
  }

  match = sentence.match(/^Each (player|opponent) (draws|discards) (a|one|two|three) cards?$/i);
  if (match?.[1] && match[2] && match[3]) {
    const count = parseCount(match[3]);
    if (count) {
      return {
        targetRequirements: [],
        effects: [
          {
            kind: match[2].toLowerCase() === "draws" ? "draw" : "discard",
            playerId: match[1].toLowerCase() === "player" ? "each_player" : "each_opponent",
            count,
          },
        ],
      };
    }
  }

  if (/^Exile target player's graveyard$/i.test(sentence)) {
    return {
      targetRequirements: [{ kind: "player" }],
      effects: [{ kind: "exile_graveyard", playerId: { type: "chosen", index: 0 } }],
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
    /^Target (legendary creature|creature|commander) (?:gains|gets) ([a-z ]+?) until end of turn$/i,
  );
  if (match?.[1] && match[2]) {
    const keyword = KEYWORD_GRANTS[match[2].trim().toLowerCase()];
    if (keyword) {
      const what = match[1].toLowerCase();
      return {
        targetRequirements: [
          what === "commander"
            ? { kind: "commander" }
            : { kind: "creature", ...(what.startsWith("legendary") ? { legendaryOnly: true } : {}) },
        ],
        effects: [
          { kind: "keyword_until_eot", cardId: { type: "chosen", index: 0 }, keyword },
        ],
      };
    }
  }

  // Black Sun's Zenith: X counters sprayed across every creature.
  const eachCounter = sentence.match(/^Put X (\+1\/\+1|-1\/-1) counters on each creature$/i);
  if (eachCounter?.[1]) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "counter_on_each_creature",
          counter: eachCounter[1] === "+1/+1" ? "p1p1" : "m1m1",
          amount: "x",
        },
      ],
    };
  }

  // Anim Pakal's body: the token count reads the counters AFTER the add.
  const pakal = sentence.match(
    /^put a \+1\/\+1 counter on ~, then create X (\d+)\/(\d+) colorless ([A-Za-z]+) artifact creature tokens that are tapped and attacking, where X is the number of \+1\/\+1 counters on ~$/i,
  );
  if (pakal?.[1] && pakal[2] && pakal[3]) {
    const subtype = pakal[3][0]!.toUpperCase() + pakal[3].slice(1).toLowerCase();
    return {
      targetRequirements: [],
      effects: [
        { kind: "add_counter", cardId: "self", counter: "p1p1", amount: 1 },
        {
          kind: "create_token",
          ownerId: "controller",
          name: subtype,
          typeLine: `Artifact Creature — ${subtype} Token`,
          power: Number(pakal[1]),
          toughness: Number(pakal[2]),
          perSourceCounters: "p1p1",
          entersTappedAttacking: true,
        },
      ],
    };
  }

  match = sentence.match(/^Put a \+1\/\+1 counter on ~$/i);
  if (match) {
    return {
      targetRequirements: [],
      effects: [{ kind: "add_counter", cardId: "self", counter: "p1p1", amount: 1 }],
    };
  }

  // Beastmaster Ascension ("you may" is auto-taken; quest counters only go up).
  match = sentence.match(/^(?:you may )?put a ([a-z]+) counter on ~$/i);
  if (match?.[1]) {
    return {
      targetRequirements: [],
      effects: [
        { kind: "add_counter", cardId: "self", counter: match[1].toLowerCase(), amount: 1 },
      ],
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

  // Massacre Wurm: an until-EOT debuff on each opponent's creatures.
  match = sentence.match(
    /^Creatures your opponents control get ([+-]\d+)\/([+-]\d+) until end of turn$/i,
  );
  if (match?.[1] && match[2]) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "team_pt_until_eot",
          playerId: "each_opponent",
          power: Number(match[1]),
          toughness: Number(match[2]),
        },
      ],
    };
  }

  match = sentence.match(
    /^(?:Non-([A-Za-z]+) )?[Cc]reatures you control get ([+-]\d+)\/([+-]\d+) until end of turn$/,
  );
  if (match?.[2] && match[3]) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "team_pt_until_eot",
          playerId: "controller",
          power: Number(match[2]),
          toughness: Number(match[3]),
          ...(match[1] ? { nonSubtypes: [match[1].toLowerCase()] } : {}),
        },
      ],
    };
  }

  match = sentence.match(
    /^(Creatures|Permanents) you control gain ([a-z ,]+?) until end of turn$/i,
  );
  if (match?.[2]) {
    // "flying, vigilance, and double strike" — an Oxford list of grants;
    // "protection from each color" may close the list (Akroma's Will).
    const names = match[2]
      .split(/,\s*(?:and\s+)?|\s+and\s+/)
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean);
    const permanents = match[1]!.toLowerCase() === "permanents";
    const effects: CardEffect[] = [];
    let ok = names.length > 0;
    for (const name of names) {
      if (name === "protection from each color") {
        effects.push({
          kind: "team_protection_until_eot",
          playerId: "controller",
          colors: ["W", "U", "B", "R", "G"],
        });
        continue;
      }
      const keyword = KEYWORD_GRANTS[name];
      if (!keyword) {
        ok = false;
        break;
      }
      effects.push({
        kind: "team_keyword_until_eot",
        playerId: "controller",
        keyword,
        ...(permanents ? { scope: "permanents" as const } : {}),
      });
    }
    if (ok) {
      return { targetRequirements: [], effects };
    }
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
      // "instant or sorcery" is an any-of over card TYPES (Mystical Tutor);
      // "Plains, Island, or Swamp" is an any-of over subtypes (Farseek).
      if (options.every((word) => SEARCH_CARD_TYPES.has(word))) {
        return { typesAny: options };
      }
      if (options.every((word) => !SEARCH_CARD_TYPES.has(word))) {
        return { subtypesAny: options };
      }
      return null;
    }
    return null;
  }
  const filter = {
    supertypes: [] as string[],
    types: [] as string[],
    subtypes: [] as string[],
    colors: [] as Color[],
  };
  const SEARCH_COLOR_WORDS: Record<string, Color> = {
    white: "W",
    blue: "U",
    black: "B",
    red: "R",
    green: "G",
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
    } else if (SEARCH_COLOR_WORDS[word]) {
      filter.colors.push(SEARCH_COLOR_WORDS[word]!);
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
    ...(filter.colors.length > 0 ? { colors: filter.colors } : {}),
  };
}

/**
 * Ghost Quarter / Assassin's Trophy: "Its controller may search their library
 * for a basic land card, put it onto the battlefield, then shuffle." Rides the
 * previous sentence's permanent target, so the caller supplies the index.
 */
function controllerBasicSearchRider(sentence: string, lastIndex: number): CardEffect | null {
  const plainBasic =
    /^(?:Its|That (?:land|permanent|creature)'s) controller may search their library for a basic land card, put (?:it|that card) onto the battlefield( tapped)?, then shuffle$/i.exec(
      sentence,
    );
  // Boseiju: "That player may search … a land card with a basic land type".
  const basicType =
    /^That player may search their library for a land card with a basic land type, put it onto the battlefield, then shuffle$/i.test(
      sentence,
    );
  if (!plainBasic && !basicType) {
    return null;
  }
  return {
    kind: "search_library",
    playerId: { type: "chosen_controller", index: lastIndex },
    filter: plainBasic
      ? { supertypes: ["basic"], types: ["land"] }
      : { types: ["land"], subtypesAny: ["plains", "island", "swamp", "mountain", "forest"] },
    destination: "battlefield",
    count: 1,
    ...(plainBasic?.[1] ? { entersTapped: true } : {}),
  };
}

/** "a noncreature, nonland card" / "a non-Human creature card" and friends. */
function parseDigDescriptor(descriptor: string): SearchFilter | null {
  const parts = descriptor.toLowerCase().replace(/,/g, " ").split(/\s+/).filter(Boolean);
  const nonTypes: string[] = [];
  const nonSubtypes: string[] = [];
  const rest: string[] = [];
  for (const word of parts) {
    const non = word.match(/^non-?([a-z]+)$/);
    if (non?.[1] && SEARCH_CARD_TYPES.has(non[1])) {
      nonTypes.push(non[1]);
    } else if (non?.[1]) {
      nonSubtypes.push(non[1]);
    } else {
      rest.push(word);
    }
  }
  const base = rest.length > 0 ? parseSearchDescriptor(rest.join(" ")) : {};
  if (!base) {
    return null;
  }
  return {
    ...base,
    ...(nonTypes.length > 0 ? { nonTypes } : {}),
    ...(nonSubtypes.length > 0 ? { nonSubtypes } : {}),
  };
}

/**
 * Fuse the three-sentence impulse dig ("Look at the top N… / You may reveal a
 * X card from among them and put it into your hand. / Put the rest on the
 * bottom of your library in a random order.") into one synthetic sentence the
 * clause compiler can parse: "Dig N for <descriptor> to <destination>".
 * Preserves any activation-cost prefix on the first sentence.
 */
function fuseDigSentencesInPlace(sentences: string[], lineStart: boolean[]): void {
  for (let index = 0; index + 2 < sentences.length; index += 1) {
    if (lineStart[index + 1] || lineStart[index + 2]) {
      continue;
    }
    const look = sentences[index]!.match(
      /^(.*: )?Look at the top (two|three|four|five|six|seven|eight|\d+) cards of your library$/i,
    );
    if (!look?.[2]) {
      continue;
    }
    const count = parseCount(look[2]);
    if (!count) {
      continue;
    }
    if (!/^Put the rest on the bottom of your library in a random order$/i.test(sentences[index + 2]!)) {
      continue;
    }
    const mid = sentences[index + 1]!;
    const toHand = mid.match(/^You may reveal an? (.+?) card from among them and put it into your hand$/i);
    const toField = mid.match(/^You may put an? (.+?) card from among them onto the battlefield( tapped)?$/i);
    const descriptor = toHand?.[1] ?? toField?.[1];
    if (!descriptor) {
      continue;
    }
    const destination = toHand ? "hand" : toField?.[2] ? "battlefield_tapped" : "battlefield";
    sentences.splice(index, 3, `${look[1] ?? ""}Dig ${count} for ${descriptor} to ${destination}`);
    lineStart.splice(index + 1, 2);
  }
}

/**
 * Fuse impulse-exile pairs into one synthetic sentence:
 * "…Exile the top card of your library." + "You may play it this turn." and
 * "…exile the top card of that player's library." + "Until end of turn, you
 * may cast that card." both become "…impulse from <whose> library".
 */
/**
 * Fuse "Each opponent loses X life." + "You gain life equal to the life lost
 * this way." into one synthetic drain sentence (Exsanguinate).
 */
function fuseDrainPairInPlace(sentences: string[], lineStart: boolean[]): void {
  for (let index = 0; index + 1 < sentences.length; index += 1) {
    if (lineStart[index + 1]) {
      continue;
    }
    const drain = sentences[index]!.match(/^(.*)Each opponent loses (X|\d+) life$/i);
    if (drain && /^You gain life equal to the life lost this way$/i.test(sentences[index + 1]!)) {
      sentences.splice(index, 2, `${drain[1] ?? ""}drain ${drain[2]} from each opponent`);
      lineStart.splice(index + 1, 1);
      continue;
    }
    // Gray Merchant of Asphodel: the X is the caster's devotion.
    const devotion = sentences[index]!.match(
      /^(.*)each opponent loses X life, where X is your devotion to (white|blue|black|red|green)$/i,
    );
    if (
      devotion &&
      /^You gain life equal to the life lost this way$/i.test(sentences[index + 1]!)
    ) {
      sentences.splice(
        index,
        2,
        `${devotion[1] ?? ""}drain devotion ${devotion[2]!.toLowerCase()} from each opponent`,
      );
      lineStart.splice(index + 1, 1);
    }
  }
}

function fuseExilePlayInPlace(sentences: string[], lineStart: boolean[]): void {
  for (let index = 0; index + 1 < sentences.length; index += 1) {
    if (lineStart[index + 1]) {
      continue;
    }
    const own = sentences[index]!.match(
      /^(.*)Exile the top (card|two cards|three cards|four cards|five cards) of your library$/i,
    );
    if (own && /^You may play (?:it|that card|them) this turn$/i.test(sentences[index + 1]!)) {
      const count = own[2]!.toLowerCase() === "card" ? 1 : parseCount(own[2]!.split(" ")[0]!) ?? 1;
      const suffix = count === 1 ? "" : ` ${count}`;
      sentences.splice(index, 2, `${own[1] ?? ""}impulse${suffix} from your library`);
      lineStart.splice(index + 1, 1);
      continue;
    }
    const theirs = sentences[index]!.match(/^(.*)exile the top card of that player's library$/i);
    if (theirs && /^Until end of turn, you may cast (?:that card|it)$/i.test(sentences[index + 1]!)) {
      sentences.splice(index, 2, `${theirs[1] ?? ""}impulse from that player's library`);
      lineStart.splice(index + 1, 1);
      continue;
    }
  }
}

type TriggerHead = Pick<
  CardTrigger,
  | "event"
  | "watch"
  | "excludeSelf"
  | "subjectFilter"
  | "subjectPlayerOpponent"
  | "oncePerTurn"
  | "oncePerBatch"
  | "alsoOnCopy"
> & {
  /** "enters or attacks": emit a sibling trigger for each extra event. */
  extraEvents?: CardTrigger["event"][];
};

/** "Whenever another creature dies" → dies / any / excludeSelf, and friends. */
function parseTriggerHead(head: string): TriggerHead | null {
  const text = head.replace(/^(?:Landfall|Magecraft)\s*[—-]\s*/i, "").trim();
  if (/^Whenever you cast or copy an instant or sorcery spell$/i.test(text)) {
    return {
      event: "cast_spell",
      watch: "controlled",
      subjectFilter: { typesAny: ["instant", "sorcery"] },
      alsoOnCopy: true,
    };
  }
  // Sram: any-of subtype cast heads.
  const subtypeCastList = text.match(
    /^Whenever you cast an? ([A-Z][\w]*), ([A-Z][\w]*), or ([A-Z][\w]*) spell$/,
  );
  if (
    subtypeCastList?.[1] &&
    subtypeCastList[2] &&
    subtypeCastList[3] &&
    !SEARCH_CARD_TYPES.has(subtypeCastList[1].toLowerCase()) &&
    !SEARCH_CARD_TYPES.has(subtypeCastList[2].toLowerCase()) &&
    !SEARCH_CARD_TYPES.has(subtypeCastList[3].toLowerCase())
  ) {
    return {
      event: "cast_spell",
      watch: "controlled",
      subjectFilter: {
        subtypesAny: [
          subtypeCastList[1].toLowerCase(),
          subtypeCastList[2].toLowerCase(),
          subtypeCastList[3].toLowerCase(),
        ],
      },
    };
  }
  if (/^Whenever you draw a card$/i.test(text)) {
    return { event: "you_draw" };
  }
  if (/^Whenever an opponent casts their first noncreature spell each turn$/i.test(text)) {
    return { event: "opponent_casts_first_noncreature_spell" };
  }
  // Faerie Mastermind.
  if (/^Whenever an opponent draws their second card each turn$/i.test(text)) {
    return { event: "opponent_draws_second" };
  }
  if (/^When(?:ever)? ~ dies$/i.test(text)) {
    return { event: "dies" };
  }
  if (/^Whenever you gain life$/i.test(text)) {
    return { event: "you_gain_life" };
  }
  if (/^Whenever a permanent becomes untapped$/i.test(text)) {
    return { event: "becomes_untapped" };
  }
  // City of Brass.
  if (/^Whenever ~ becomes tapped$/i.test(text)) {
    return { event: "becomes_tapped" };
  }
  // Magda: "Whenever a Dwarf you control becomes tapped".
  const tappedTribe = text.match(/^Whenever an? ([A-Za-z]+) you control becomes tapped$/i);
  if (tappedTribe?.[1] && !SEARCH_CARD_TYPES.has(tappedTribe[1].toLowerCase())) {
    return {
      event: "becomes_tapped",
      watch: "controlled",
      subjectFilter: { subtypes: [tappedTribe[1].toLowerCase()] },
    };
  }
  if (/^Whenever you create or sacrifice a token$/i.test(text)) {
    return { event: "you_create_token", extraEvents: ["you_sacrifice_token"] };
  }
  if (/^Whenever you create a token$/i.test(text)) {
    return { event: "you_create_token" };
  }
  if (/^Whenever you sacrifice a token$/i.test(text)) {
    return { event: "you_sacrifice_token" };
  }
  if (/^Whenever an opponent loses life$/i.test(text)) {
    return { event: "opponent_loses_life" };
  }
  if (/^Whenever ~ or another creature dies$/i.test(text)) {
    return { event: "dies", watch: "any", subjectFilter: { types: ["creature"] } };
  }
  if (/^Whenever another creature dies$/i.test(text)) {
    return { event: "dies", watch: "any", excludeSelf: true, subjectFilter: { types: ["creature"] } };
  }
  if (/^Whenever another nontoken creature dies$/i.test(text)) {
    return {
      event: "dies",
      watch: "any",
      excludeSelf: true,
      subjectFilter: { types: ["creature"], nonToken: true },
    };
  }
  if (/^Whenever another nontoken creature you control enters$/i.test(text)) {
    return {
      event: "enter_battlefield",
      watch: "controlled",
      excludeSelf: true,
      subjectFilter: { types: ["creature"], nonToken: true },
    };
  }
  if (/^Whenever a nontoken creature you control enters$/i.test(text)) {
    return {
      event: "enter_battlefield",
      watch: "controlled",
      subjectFilter: { types: ["creature"], nonToken: true },
    };
  }
  if (/^Whenever a creature token you control deals combat damage to a player$/i.test(text)) {
    return {
      event: "deals_combat_damage_to_player",
      watch: "controlled",
      subjectFilter: { types: ["creature"], tokenOnly: true },
    };
  }
  if (/^Whenever one or more creatures you control deal combat damage to a player$/i.test(text)) {
    return {
      event: "deals_combat_damage_to_player",
      watch: "controlled",
      subjectFilter: { types: ["creature"] },
      oncePerBatch: true,
    };
  }
  // Anim Pakal: an attack-batch head with a non-<subtype> filter.
  const nonTribalAttack = text.match(/^Whenever you attack with one or more non-([A-Za-z]+) creatures$/i);
  if (nonTribalAttack?.[1]) {
    return {
      event: "attacks",
      watch: "controlled",
      subjectFilter: { types: ["creature"], nonSubtypes: [nonTribalAttack[1].toLowerCase()] },
      oncePerBatch: true,
    };
  }
  if (/^Whenever an opponent searches their library$/i.test(text)) {
    return { event: "opponent_searches" };
  }
  if (/^Whenever a player casts their second spell each turn$/i.test(text)) {
    return { event: "casts_second_spell" };
  }
  if (/^Whenever a creature you control dies$/i.test(text)) {
    return { event: "dies", watch: "controlled", subjectFilter: { types: ["creature"] } };
  }
  // Mayhem Devil: every player's sacrifices, including your own.
  if (/^Whenever a player sacrifices a permanent$/i.test(text)) {
    return { event: "player_sacrifices" };
  }
  if (/^Whenever a creature an opponent controls dies$/i.test(text)) {
    return { event: "dies", watch: "opponents", subjectFilter: { types: ["creature"] } };
  }
  if (/^Whenever a creature you control attacks$/i.test(text)) {
    return { event: "attacks", watch: "controlled", subjectFilter: { types: ["creature"] } };
  }
  // Skullclamp.
  if (/^Whenever equipped creature dies$/i.test(text)) {
    return { event: "dies", watch: "attached" };
  }
  // Sword of the Animist.
  if (/^Whenever equipped creature attacks$/i.test(text)) {
    return { event: "attacks", watch: "attached" };
  }
  // Marionette Apprentice.
  if (
    /^Whenever another creature or artifact you control is put into a graveyard from the battlefield$/i.test(
      text,
    )
  ) {
    return {
      event: "dies",
      watch: "controlled",
      excludeSelf: true,
      subjectFilter: { typesAny: ["creature", "artifact"] },
    };
  }
  if (/^Whenever another creature you control dies$/i.test(text)) {
    return {
      event: "dies",
      watch: "controlled",
      excludeSelf: true,
      subjectFilter: { types: ["creature"] },
    };
  }
  if (/^Whenever a creature dies$/i.test(text)) {
    return { event: "dies", watch: "any", subjectFilter: { types: ["creature"] } };
  }
  // "One or more" heads almost always carry the once-each-turn rider, which
  // restores the per-batch semantics a per-event bus would otherwise multiply.
  if (/^Whenever one or more (other )?creatures die$/i.test(text)) {
    const other = /other/i.test(text);
    return {
      event: "dies",
      watch: "any",
      ...(other ? { excludeSelf: true } : {}),
      subjectFilter: { types: ["creature"] },
    };
  }
  if (/^Whenever one or more (other )?creatures you control die$/i.test(text)) {
    const other = /other/i.test(text);
    return {
      event: "dies",
      watch: "controlled",
      ...(other ? { excludeSelf: true } : {}),
      subjectFilter: { types: ["creature"] },
    };
  }
  if (/^Whenever this creature or another creature you control dies$/i.test(text)) {
    return { event: "dies", watch: "controlled", subjectFilter: { types: ["creature"] } };
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
  // Aurelia: "for the first time each turn" maps to the once-per-turn latch.
  if (/^Whenever ~ attacks for the first time each turn$/i.test(text)) {
    return { event: "attacks", oncePerTurn: true };
  }
  // Tribal attack heads: "Whenever a Dragon you control attacks" (Utvara).
  const tribalAttack = text.match(/^Whenever an? ([A-Za-z]+) you control attacks$/i);
  if (tribalAttack?.[1]) {
    const word = tribalAttack[1].toLowerCase();
    return {
      event: "attacks",
      watch: "controlled",
      subjectFilter: SEARCH_CARD_TYPES.has(word) ? { types: [word] } : { subtypes: [word] },
    };
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
  // "Whenever ~ or another Dragon you control enters" (Scourge of Valkas).
  const tribalSelfEnter = text.match(/^Whenever ~ or another ([A-Za-z]+) you control enters$/i);
  if (tribalSelfEnter?.[1] && !SEARCH_CARD_TYPES.has(tribalSelfEnter[1].toLowerCase())) {
    return {
      event: "enter_battlefield",
      watch: "controlled",
      subjectFilter: { subtypes: [tribalSelfEnter[1].toLowerCase()] },
    };
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
  // Elemental Bond.
  const bigEnter = text.match(
    /^Whenever a creature you control with power (\d+) or greater enters$/i,
  );
  if (bigEnter?.[1]) {
    return {
      event: "enter_battlefield",
      watch: "controlled",
      subjectFilter: { types: ["creature"], minPower: Number(bigEnter[1]) },
    };
  }
  if (
    /^Whenever a creature an opponent controls enters$/i.test(text) ||
    /^Whenever a creature enters under an opponent's control$/i.test(text)
  ) {
    return { event: "enter_battlefield", watch: "opponents", subjectFilter: { types: ["creature"] } };
  }
  if (/^Whenever you cast a spell$/i.test(text)) {
    return { event: "cast_spell", watch: "controlled" };
  }
  if (/^Whenever you cast a creature spell$/i.test(text)) {
    return { event: "cast_spell", watch: "controlled", subjectFilter: { types: ["creature"] } };
  }
  if (/^Whenever you cast a noncreature spell$/i.test(text)) {
    return { event: "cast_spell", watch: "controlled", subjectFilter: { nonTypes: ["creature"] } };
  }
  if (/^Whenever you cast an instant or sorcery spell$/i.test(text)) {
    return {
      event: "cast_spell",
      watch: "controlled",
      subjectFilter: { typesAny: ["instant", "sorcery"] },
    };
  }
  if (/^Whenever you cast an artifact, instant, or sorcery spell$/i.test(text)) {
    return {
      event: "cast_spell",
      watch: "controlled",
      subjectFilter: { typesAny: ["artifact", "instant", "sorcery"] },
    };
  }
  if (/^Whenever an opponent casts an artifact, instant, or sorcery spell$/i.test(text)) {
    return {
      event: "cast_spell",
      watch: "opponents",
      subjectFilter: { typesAny: ["artifact", "instant", "sorcery"] },
    };
  }
  if (/^Whenever an opponent casts an instant or sorcery spell$/i.test(text)) {
    return {
      event: "cast_spell",
      watch: "opponents",
      subjectFilter: { typesAny: ["instant", "sorcery"] },
    };
  }
  if (/^Whenever you cast an artifact spell$/i.test(text)) {
    return { event: "cast_spell", watch: "controlled", subjectFilter: { types: ["artifact"] } };
  }
  if (/^Whenever you cast an enchantment spell$/i.test(text)) {
    return { event: "cast_spell", watch: "controlled", subjectFilter: { types: ["enchantment"] } };
  }
  if (/^Whenever enchanted creature deals damage to an opponent$/i.test(text)) {
    return {
      event: "deals_damage_to_player",
      watch: "attached",
      subjectPlayerOpponent: true,
    };
  }
  if (/^Whenever ~ deals damage to an opponent$/i.test(text)) {
    return { event: "deals_damage_to_player", subjectPlayerOpponent: true };
  }
  if (/^Whenever ~ deals damage to a player$/i.test(text)) {
    return { event: "deals_damage_to_player" };
  }
  // Tribal cast triggers ("Whenever you cast an Elf spell") — changelings
  // match through the shared subtype matcher.
  const tribalCast = text.match(/^Whenever you cast an? ([A-Z][a-z]+) spell$/);
  if (tribalCast?.[1] && !/^(creature|artifact|enchantment|instant|sorcery|noncreature)$/i.test(tribalCast[1])) {
    return {
      event: "cast_spell",
      watch: "controlled",
      subjectFilter: { subtypes: [tribalCast[1].toLowerCase()] },
    };
  }
  if (/^Whenever an opponent casts a spell$/i.test(text)) {
    return { event: "cast_spell", watch: "opponents" };
  }
  if (/^Whenever an opponent draws a card$/i.test(text)) {
    return { event: "opponent_draws" };
  }
  if (/^Whenever an opponent casts a noncreature spell$/i.test(text)) {
    return { event: "cast_spell", watch: "opponents", subjectFilter: { nonTypes: ["creature"] } };
  }
  if (/^Whenever a player casts a spell$/i.test(text)) {
    return { event: "cast_spell", watch: "any" };
  }
  if (/^Whenever ~ deals combat damage to a player$/i.test(text)) {
    return { event: "deals_combat_damage_to_player" };
  }
  if (/^Whenever a creature you control deals combat damage to a player$/i.test(text)) {
    return {
      event: "deals_combat_damage_to_player",
      watch: "controlled",
      subjectFilter: { types: ["creature"] },
    };
  }
  if (/^Whenever a creature you control of the chosen type enters or attacks$/i.test(text)) {
    return {
      event: "enter_battlefield",
      watch: "controlled",
      subjectFilter: { types: ["creature"], chosenSubtype: true },
      extraEvents: ["attacks"],
    };
  }
  // Sun Titan.
  if (/^Whenever ~ enters or attacks$/i.test(text)) {
    return { event: "enter_battlefield", extraEvents: ["attacks"] };
  }
  if (/^Whenever you cast a creature spell of the chosen type$/i.test(text)) {
    return {
      event: "cast_spell",
      watch: "controlled",
      subjectFilter: { types: ["creature"], chosenSubtype: true },
    };
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

/** MTG tribal plurals that don't just append "s". */
const IRREGULAR_PLURALS: Record<string, string> = {
  elves: "elf",
  wolves: "wolf",
  dwarves: "dwarf",
  allies: "ally",
  mercenaries: "mercenary",
  foxes: "fox",
  octopuses: "octopus",
  mice: "mouse",
};

function singularSubtype(plural: string): string {
  const lower = plural.toLowerCase();
  return IRREGULAR_PLURALS[lower] ?? lower.replace(/s$/, "");
}

function compileAnthem(sentence: string): StaticAbility | null {
  const match = sentence.match(/^(Other )?Creatures you control get \+(\d+)\/\+(\d+)$/i);
  if (match?.[2] && match[3]) {
    return {
      selector: {
        scope: "controlled",
        types: ["creature"],
        ...(match[1] ? { excludeSelf: true } : {}),
      },
      effect: { kind: "modify_pt", power: Number(match[2]), toughness: Number(match[3]) },
    };
  }
  // "Other Elves you control get +1/+1" — tribal anthems (changelings match).
  const tribalPt = sentence.match(/^(Other )?([A-Z][a-z]+s) you control get \+(\d+)\/\+(\d+)$/);
  if (tribalPt?.[2] && tribalPt[3] && tribalPt[4] && tribalPt[2] !== "Creatures") {
    return {
      selector: {
        scope: "controlled",
        subtypes: [singularSubtype(tribalPt[2])],
        ...(tribalPt[1] ? { excludeSelf: true } : {}),
      },
      effect: { kind: "modify_pt", power: Number(tribalPt[3]), toughness: Number(tribalPt[4]) },
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
    /^(?:All )?([A-Z][a-z]+?)(?: creature)?s(?: you control)? have ([a-z ]+)$/,
  );
  if (tribal?.[1] && tribal[2]) {
    const keyword = KEYWORD_GRANTS[tribal[2].trim().toLowerCase()];
    if (keyword) {
      return {
        selector: {
          scope: /you control/.test(sentence) ? "controlled" : "all",
          subtypes: [singularSubtype(`${tribal[1]}s`)],
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
    case "restrict_until_eot":
    case "transform":
      return { ...effect, cardId: bumpChosen(effect.cardId) };
    case "attach":
      return { ...effect, cardId: bumpChosen(effect.cardId), toId: bumpChosen(effect.toId) };
    case "copy_token":
      return { ...effect, ownerId: bumpChosen(effect.ownerId), ofCardId: bumpChosen(effect.ofCardId) };
    case "counter_unless_pays":
      return { ...effect, target: bumpChosen(effect.target) };
    case "divided_damage":
    case "copy_subject_spell":
    case "counter_subject_spell":
    case "extra_combat":
    case "fog":
      return effect;
    case "untap_all":
    case "untap_lands_up_to":
    case "proliferate":
      return { ...effect, playerId: bumpChosen(effect.playerId) };
    case "move_card":
    case "tap":
    case "untap":
    case "sacrifice":
    case "add_counter":
      return { ...effect, cardId: bumpChosen(effect.cardId) };
    case "set_class_level":
    case "grant_dies_return":
      return { ...effect, cardId: bumpChosen(effect.cardId) };
    case "counter_spell":
    case "copy_spell":
    case "bounce_spell_or_permanent":
      return { ...effect, target: bumpChosen(effect.target) };
    case "exchange_life_toughness":
      return { ...effect, playerId: bumpChosen(effect.playerId) };
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
    case "exile_graveyard":
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
    case "flicker":
      return { ...effect, cardId: bumpChosen(effect.cardId) };
    case "unless_pays":
    case "may_pay":
      return {
        ...effect,
        playerId: bumpChosen(effect.playerId),
        effects: effect.effects.map((entry) => shiftChosen(entry, offset)),
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
  if (!look?.[1] || !assign) {
    return null;
  }
  const count = parseCount(look[1]);
  if (!count) {
    return null;
  }
  if (
    /^Put one of them into your hand, put one of them on the bottom of your library, and exile one of them$/i.test(
      assign,
    )
  ) {
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
  // Impulse / Anticipate: one to hand, the rest to the bottom.
  if (
    /^Put one of them into your hand and (?:the rest|put the rest) on the bottom of your library in (?:any|a random) order$/i.test(
      assign,
    ) ||
    /^Put one of them into your hand, then put the rest on the bottom of your library in (?:any|a random) order$/i.test(
      assign,
    )
  ) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "look_and_assign",
          playerId: "controller",
          count,
          destinations: [
            "hand",
            ...Array.from({ length: count - 1 }, () => "library_bottom" as const),
          ],
        },
      ],
      consumed: 2,
    };
  }
  return null;
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
  choice?: { min: number; max: number; maxIfCommander?: number };
};

/** "Choose one. If you control a commander as you cast this spell, you may
 * choose both instead." (Jeska's Will, Akroma's Will). */
const COMMANDER_BOTH_HEAD =
  /^Choose one\. If you control a commander as you cast this spell, you may choose both instead\.$/i;

/**
 * "Choose one —" blocks compile before sentence splitting (the bullets are
 * lines, not sentences). Every bullet must compile as a single clause, or
 * the whole block stays a note.
 */
function extractModalModes(card: OracleCard): ModalExtraction | null {
  const lines = stripReminderText(card.oracleText).replace(/\r/g, "").split("\n");
  const headIndex = lines.findIndex(
    (line) =>
      /^Choose (one|two|three|one or more|one or both|up to one|up to two)\s*[—-]\s*$/i.test(
        line.trim(),
      ) || COMMANDER_BOTH_HEAD.test(line.trim()),
  );
  if (headIndex === -1) {
    return null;
  }
  const bothIfCommander = COMMANDER_BOTH_HEAD.test(lines[headIndex]!.trim());
  const headWord = bothIfCommander
    ? "one"
    : lines[headIndex]!.trim().match(/^Choose (.+?)\s*[—-]\s*$/i)?.[1]?.toLowerCase() ?? "one";
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
    if (sentences.length > 1) {
      // "Exile the top three cards… You may play them this turn." fuses to
      // one impulse clause, the same as it does outside a modal block.
      const lineStart = sentences.map((_, index) => index === 0);
      fuseDigSentencesInPlace(sentences, lineStart);
      fuseExilePlayInPlace(sentences, lineStart);
    }
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
  const choice =
    headWord === "two"
      ? { min: 2, max: 2 }
      : headWord === "three"
        ? { min: 3, max: 3 }
        : headWord === "one or more"
          ? { min: 1, max: modes.length }
          : headWord === "one or both"
            ? { min: 1, max: 2 }
            : headWord === "up to one"
              ? { min: 0, max: 1 }
              : headWord === "up to two"
                ? { min: 0, max: 2 }
                : bothIfCommander
                  ? { min: 1, max: 1, maxIfCommander: 2 }
                  : undefined;
  return { remainingText, modes, raw, ...(choice ? { choice } : {}) };
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
  let overloadCost: string | null = null;
  let offspringCost: string | null = null;
  let dashCost: string | null = null;

  const modal = extractModalModes(card);
  if (modal) {
    if (modal.modes) {
      result.modes = modal.modes;
      if (modal.choice) {
        result.modeChoice = modal.choice;
      }
    } else {
      result.leftover.push(modal.raw);
    }
  }
  const lines = splitOracleSentencesByLine(
    modal ? { ...card, oracleText: modal.remainingText } : card,
  );
  const sentences: string[] = [];
  const lineStart: boolean[] = [];
  let kickerCost: string | null = null;
  for (const line of lines) {
    line.forEach((part, position) => {
      sentences.push(part);
      lineStart.push(position === 0);
    });
  }
  fuseDigSentencesInPlace(sentences, lineStart);
  fuseExilePlayInPlace(sentences, lineStart);
  fuseDrainPairInPlace(sentences, lineStart);
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

    // Wild Growth ("Enchant land") / Utopia Sprawl ("Enchant Forest").
    const enchantLand = sentence.match(/^Enchant (land|Plains|Island|Swamp|Mountain|Forest)$/i);
    if (enchantLand?.[1]) {
      result.enchant = "land";
      const word = enchantLand[1].toLowerCase();
      if (!result.targetRequirements.some((requirement) => requirement.kind === "land")) {
        result.targetRequirements.push({
          kind: "land",
          ...(word === "land" ? {} : { requiredSubtypes: [word] }),
        });
      }
      continue;
    }

    if (/^As (?:~|this Aura|this enchantment) enters, choose a color$/i.test(sentence)) {
      result.chooseColorOnEnter = true;
      continue;
    }

    // "Whenever enchanted land is tapped for mana, its controller adds an
    // additional {G}" — a triggered mana ability handled in the mana flow.
    const tappedBonus = sentence.match(
      /^Whenever enchanted (?:land|Plains|Island|Swamp|Mountain|Forest) is tapped for mana, its controller adds an additional (?:\{([WUBRG])\}|one mana of the chosen color)$/i,
    );
    if (tappedBonus) {
      result.enchantedTappedBonus = tappedBonus[1]
        ? { color: tappedBonus[1].toUpperCase() as Color, amount: 1 }
        : { color: "chosen", amount: 1 };
      continue;
    }

    // Lightning Greaves / Swiftfoot Boots: bare keyword grants on the host.
    const attachedHas = sentence.match(
      /^(?:Enchanted|Equipped) creature has ([a-z ]+?)(?: and ([a-z ]+?))?$/i,
    );
    if (attachedHas?.[1]) {
      const names = [attachedHas[1], attachedHas[2]].filter((name): name is string =>
        Boolean(name),
      );
      const keywords = names.map((name) => KEYWORD_GRANTS[name.trim().toLowerCase()]);
      if (keywords.every((keyword): keyword is Keyword => Boolean(keyword))) {
        for (const keyword of keywords) {
          result.staticAbilities.push({
            selector: { scope: "attached" },
            effect: { kind: "grant_keyword", keyword },
          });
        }
        continue;
      }
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

    // Darksteel Mutation-class: the aura rewrites the host. Approximation:
    // the new types are ADDED (layer 4 add, not set) — the host keeps its
    // printed types; base P/T, ability removal, and the keyword are exact.
    const attachedMutation = sentence.match(
      /^Enchanted creature is an? ([A-Za-z]+) artifact creature with base power and toughness (\d+)\/(\d+) and has ([a-z ]+), and it loses all other abilities(?:, card types, and creature types)?$/i,
    );
    if (attachedMutation?.[1] && attachedMutation[2] && attachedMutation[3] && attachedMutation[4]) {
      const keyword = KEYWORD_GRANTS[attachedMutation[4].trim().toLowerCase()];
      if (keyword) {
        result.staticAbilities.push(
          {
            selector: { scope: "attached" },
            effect: { kind: "remove_all_abilities" },
          },
          {
            selector: { scope: "attached" },
            effect: {
              kind: "add_types",
              types: ["artifact", "creature"],
              subtypes: [attachedMutation[1].toLowerCase()],
            },
          },
          {
            selector: { scope: "attached" },
            effect: {
              kind: "set_pt",
              power: Number(attachedMutation[2]),
              toughness: Number(attachedMutation[3]),
            },
          },
          {
            selector: { scope: "attached" },
            effect: { kind: "grant_keyword", keyword },
          },
        );
        continue;
      }
    }

    const selfRestrict = sentence.match(
      /^~ can't (attack or block|be blocked|attack|block)(?: and can't (be blocked|block|attack))?$/i,
    );
    if (selfRestrict?.[1]) {
      const parts = [selfRestrict[1], selfRestrict[2]]
        .filter((part): part is string => Boolean(part))
        .map((part) => part.toLowerCase());
      result.staticAbilities.push({
        selector: { scope: "self" },
        effect: {
          kind: "restrict",
          ...(parts.some((part) => part === "attack" || part === "attack or block")
            ? { cantAttack: true }
            : {}),
          ...(parts.some((part) => part === "attack or block" || part === "block")
            ? { cantBlock: true }
            : {}),
          ...(parts.some((part) => part === "be blocked") ? { cantBeBlocked: true } : {}),
        },
      });
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

    if (/^You have no maximum hand size$/i.test(sentence)) {
      result.noMaxHandSize = true;
      continue;
    }

    // Regeneration is not implemented, so the denial is inert on this table.
    if (/^(?:They|It) can't be regenerated$/i.test(sentence)) {
      continue;
    }

    // Deckbuilding markers with no in-game effect at this table: commander
    // pairing is decided at import.
    if (/^(?:Partner|Choose a Background)$/i.test(sentence)) {
      continue;
    }

    if (/^Storm$/i.test(sentence)) {
      result.storm = true;
      continue;
    }

    // Spree (CR 702.169): "Choose one or more additional costs" — each
    // "+ {cost} — effect" line becomes a mode carrying its extraCost. All
    // modes must compile or the whole card stays uncompiled (a partially
    // castable Spree would silently hide options).
    if (/^Spree$/i.test(sentence) && !result.modes) {
      const spreeModes: SpellMode[] = [];
      let cursor = index + 1;
      let failed = false;
      while (cursor < sentences.length && lineStart[cursor]) {
        const bullet = sentences[cursor]?.match(/^\+ ?((?:\{[^}]+\})+) ?[—–-] ?(.+)$/);
        if (!bullet?.[1] || !bullet[2]) {
          break;
        }
        // Multi-sentence bullets (riders on the same line) are not supported.
        if (cursor + 1 < sentences.length && !lineStart[cursor + 1]) {
          failed = true;
          break;
        }
        const clause = compileSimpleClause(bullet[2].trim());
        if (!clause || clause.leftover) {
          failed = true;
          break;
        }
        spreeModes.push({
          label: `+ ${bullet[1]} — ${bullet[2].trim()}`,
          extraCost: bullet[1],
          effects: clause.effects,
          targetRequirements: clause.targetRequirements,
        });
        cursor += 1;
      }
      if (!failed && spreeModes.length >= 2) {
        result.modes = spreeModes;
        result.modeChoice = { min: 1, max: spreeModes.length };
        index = cursor - 1;
        continue;
      }
      result.leftover.push(sentence);
      continue;
    }

    // Kicker (CR 702.33), modeled as two modes: the kicked mode carries the
    // extra cost. Multikicker stays uncompiled.
    const kicker = sentence.match(/^Kicker ((?:\{[^}]+\})+)$/i);
    if (kicker?.[1]) {
      kickerCost = kicker[1];
      continue;
    }
    const kicked = sentence.match(/^If this spell was kicked, (.+?)(?: instead)?$/i);
    if (kicked?.[1] && kickerCost && !result.modes) {
      const base = {
        effects: result.effects,
        targetRequirements: result.targetRequirements,
      };
      let upgraded = compileSimpleClause(kicked[1].trim());
      if (!upgraded || upgraded.leftover) {
        // "create five of those tokens": the base copy effect, multiplied.
        const thoseTokens = kicked[1].match(/^create (two|three|four|five) of those tokens$/i);
        const baseCopy = base.effects[0];
        if (thoseTokens?.[1] && baseCopy?.kind === "copy_token" && base.effects.length === 1) {
          upgraded = {
            effects: [{ ...baseCopy, count: parseCount(thoseTokens[1]) ?? 1 }],
            targetRequirements: base.targetRequirements.map((req) => ({ ...req })),
          };
        }
      }
      if (base.effects.length > 0 && upgraded && !upgraded.leftover) {
        result.modes = [
          {
            label: "Unkicked",
            effects: base.effects,
            targetRequirements: base.targetRequirements,
          },
          {
            label: `Kicked ${kickerCost}`,
            extraCost: kickerCost,
            effects: upgraded.effects,
            targetRequirements: upgraded.targetRequirements,
          },
        ];
        result.effects = [];
        result.targetRequirements = [];
        continue;
      }
      result.leftover.push(sentence);
      continue;
    }

    // New Capenna fetch lands: "When ~ enters, sacrifice it." + "When you
    // do, search … basic A, B, or C … tapped, then shuffle and you gain 1
    // life." The reflexive trigger always fires, so it flattens to sequence.
    if (/^When ~ enters, sacrifice it$/i.test(sentence)) {
      const follow = sentences[index + 1]?.match(
        /^When you do, search your library for a basic ([A-Za-z]+), ([A-Za-z]+), or ([A-Za-z]+) card, put it onto the battlefield tapped, then shuffle and you gain (\d+) life$/i,
      );
      if (follow?.[1] && follow[2] && follow[3] && follow[4]) {
        result.triggers.push({
          event: "enter_battlefield",
          effects: [
            { kind: "sacrifice", cardId: "self" },
            {
              kind: "search_library",
              playerId: "controller",
              filter: {
                supertypes: ["basic"],
                subtypesAny: [
                  follow[1].toLowerCase(),
                  follow[2].toLowerCase(),
                  follow[3].toLowerCase(),
                ],
              },
              destination: "battlefield",
              count: 1,
              entersTapped: true,
            },
            { kind: "gain_life", playerId: "controller", amount: Number(follow[4]) },
          ],
          targetRequirements: [],
        });
        index += 1;
        continue;
      }
    }

    // The copy keeps the original's targets — declining the "may" is always a
    // legal choice (CR 707.10c note). Only accepted when a copy effect
    // actually compiled from an earlier sentence of this card.
    if (/^You may choose new targets for (?:the|that) cop(?:y|ies)$/i.test(sentence)) {
      const isCopyKind = (effect: CardEffect) =>
        effect.kind === "copy_spell" || effect.kind === "copy_subject_spell";
      const hasCopyEffect =
        result.effects.some(isCopyKind) ||
        result.triggers.some((trigger) => trigger.effects.some(isCopyKind)) ||
        (result.modes ?? []).some((mode) => mode.effects.some(isCopyKind));
      if (hasCopyEffect) {
        // Documented approximation (RULES_COVERAGE.md): the "may" is
        // auto-declined, so the copy keeps the original's targets.
        continue;
      }
      result.leftover.push(sentence);
      continue;
    }

    if (/^As ~ enters, choose a creature type$/i.test(sentence)) {
      result.chooseCreatureTypeOnEnter = true;
      continue;
    }

    if (/^~ enters with X \+1\/\+1 counters on it$/i.test(sentence)) {
      result.entersWithXCounters = true;
      continue;
    }

    if (/^You may play lands from your graveyard$/i.test(sentence)) {
      result.playLandsFromGraveyard = true;
      continue;
    }

    const starPt = sentence.match(
      /^~'s power and toughness are each equal to the number of (lands you control|creatures you control|artifacts you control|cards in your hand|cards in your graveyard)$/i,
    );
    if (starPt?.[1]) {
      const countOf: Record<string, DynamicCount> = {
        "lands you control": "lands_you_control",
        "creatures you control": "creatures_you_control",
        "artifacts you control": "artifacts_you_control",
        "cards in your hand": "cards_in_your_hand",
        "cards in your graveyard": "cards_in_your_graveyard",
      };
      result.dynamicPt = { count: countOf[starPt[1].toLowerCase()]! };
      continue;
    }

    // Storm-Kiln Artist: an asymmetric per-count self-buff.
    const bonusPt = sentence.match(
      /^~ gets \+(\d+)\/\+(\d+) for each (artifact|creature|land) you control$/i,
    );
    if (bonusPt?.[1] && bonusPt[2] && bonusPt[3]) {
      const perOf: Record<string, DynamicCount> = {
        artifact: "artifacts_you_control",
        creature: "creatures_you_control",
        land: "lands_you_control",
      };
      result.bonusPt = {
        power: Number(bonusPt[1]),
        toughness: Number(bonusPt[2]),
        per: perOf[bonusPt[3].toLowerCase()]!,
      };
      continue;
    }

    const addCost = sentence.match(/^As an additional cost to cast this spell, (.+)$/i);
    if (addCost?.[1]) {
      const what = addCost[1].trim().toLowerCase();
      let parsed: AdditionalCastCost | null = null;
      if (what === "sacrifice a creature") {
        parsed = { sacrifice: "creature" };
      } else if (what === "sacrifice an artifact") {
        parsed = { sacrifice: "artifact" };
      } else if (what === "sacrifice an artifact or creature" || what === "sacrifice a creature or artifact") {
        parsed = { sacrifice: "creature_or_artifact" };
      } else if (what === "sacrifice a land") {
        parsed = { sacrifice: "land" };
      } else if (what === "discard a card") {
        parsed = { discard: 1 };
      } else if (what === "discard two cards") {
        parsed = { discard: 2 };
      } else if (what === "pay x life") {
        parsed = { lifeX: true };
      } else {
        const life = what.match(/^pay (\d+) life$/);
        if (life?.[1]) {
          parsed = { life: Number(life[1]) };
        }
      }
      if (parsed) {
        result.additionalCost = { ...(result.additionalCost ?? {}), ...parsed };
        continue;
      }
    }

    // Urborg / Yavimaya: every land gains a basic subtype (CR 305.6 mana too).
    const landType = sentence.match(
      /^Each land is a (Plains|Island|Swamp|Mountain|Forest) in addition to its other land types$/i,
    );
    if (landType?.[1]) {
      result.staticAbilities.push({
        selector: { scope: "all", types: ["land"] },
        effect: { kind: "add_types", types: [], subtypes: [landType[1].toLowerCase()] },
      });
      continue;
    }

    // Cryptolith Rite / Jaheira: permanents gain a tap mana ability.
    const grantAnyMana = sentence.match(
      /^(Creatures|Lands|Artifacts|Tokens) you control have "\{T\}: Add (one mana of any color|(?:\{[WUBRGC]\})+)\.?"$/i,
    );
    if (grantAnyMana?.[1] && grantAnyMana[2]) {
      const typeOf: Record<string, string> = {
        creatures: "creature",
        lands: "land",
        artifacts: "artifact",
      };
      const what = grantAnyMana[1].toLowerCase();
      const anyColor = /any color/i.test(grantAnyMana[2]);
      const produces: Partial<Record<"W" | "U" | "B" | "R" | "G" | "C", number>> = {};
      if (!anyColor) {
        for (const pip of grantAnyMana[2].match(/\{[WUBRGC]\}/g) ?? []) {
          const color = pip[1] as "W" | "U" | "B" | "R" | "G" | "C";
          produces[color] = (produces[color] ?? 0) + 1;
        }
      }
      result.staticAbilities.push({
        selector:
          what === "tokens"
            ? { scope: "controlled", tokenOnly: true }
            : { scope: "controlled", types: [typeOf[what]!] },
        effect: {
          kind: "grant_mana_ability",
          ability: {
            produces: anyColor ? {} : produces,
            producesOptions: [],
            producesAnyColor: anyColor,
            damageToController: 0,
          },
        },
      });
      continue;
    }

    const chosenAnthem = sentence.match(
      /^Creatures you control of the chosen type get \+(\d+)\/\+(\d+)$/i,
    );
    if (chosenAnthem?.[1] && chosenAnthem[2]) {
      result.staticAbilities.push({
        selector: { scope: "controlled", types: ["creature"], chosenSubtype: true },
        effect: {
          kind: "modify_pt",
          power: Number(chosenAnthem[1]),
          toughness: Number(chosenAnthem[2]),
        },
      });
      continue;
    }

    const extraLands = sentence.match(
      /^You may play (an|one|two|three) additional lands? on each of your turns$/i,
    );
    if (extraLands?.[1]) {
      const count =
        extraLands[1].toLowerCase() === "an" ? 1 : (parseCount(extraLands[1]) ?? 1);
      result.extraLandDrops = (result.extraLandDrops ?? 0) + count;
      continue;
    }

    if (/^This spell can't be countered$/i.test(sentence)) {
      result.cantBeCountered = true;
      continue;
    }

    // Rhythm of the Wild's first half.
    if (/^Creature spells you control can't be countered$/i.test(sentence)) {
      result.creatureSpellsCantBeCountered = true;
      continue;
    }

    // Riot approximated as haste: the aggressive half of the choice, always
    // taken — a documented approximation (Rhythm of the Wild).
    if (/^Nontoken creatures you control have riot$/i.test(sentence)) {
      result.staticAbilities.push({
        selector: { scope: "controlled", types: ["creature"], nonToken: true },
        effect: { kind: "grant_keyword", keyword: "haste" },
      });
      continue;
    }

    // Grand Abolisher.
    if (
      /^During your turn, your opponents can't cast spells or activate abilities of artifacts, creatures, or enchantments$/i.test(
        sentence,
      )
    ) {
      result.opponentsLockedDuringYourTurn = true;
      continue;
    }

    // Toski.
    if (/^~ attacks each combat if able$/i.test(sentence)) {
      result.mustAttack = true;
      continue;
    }

    // Voice of Victory / Kutzil: the cast-only lock.
    if (/^Your opponents can't cast spells during your turn$/i.test(sentence)) {
      result.opponentsCantCastDuringYourTurn = true;
      continue;
    }

    // Mobilize N (CR 702.181): tapped-and-attacking Warriors, sacrificed at
    // the next end step.
    const mobilize = sentence.match(/^Mobilize (\d+)$/i);
    if (mobilize?.[1]) {
      const count = Number(mobilize[1]);
      result.triggers.push({
        event: "attacks",
        effects: Array.from({ length: count }, () => ({
          kind: "create_token" as const,
          ownerId: "controller" as const,
          name: "Warrior",
          typeLine: "Creature — Warrior Token",
          power: 1,
          toughness: 1,
          entersTappedAttacking: true,
          atEndStep: "sacrifice" as const,
        })),
      });
      continue;
    }

    if (/^Changeling$/i.test(sentence)) {
      result.changeling = true;
      continue;
    }

    // "Flashback {2}{R}" / "Flashback—{1}{U}, Pay 3 life." Sacrifice-cost
    // flashback (Dread Return) stays uncompiled.
    const flashback = sentence.match(
      /^Flashback\s*[—–-]?\s*((?:\{[^}]+\})+)(?:, Pay (\d+) life)?$/i,
    );
    if (flashback?.[1]) {
      result.flashback = {
        manaCost: flashback[1],
        ...(flashback[2] ? { life: Number(flashback[2]) } : {}),
      };
      continue;
    }

    if (/^You may look at the top card of your library any time$/i.test(sentence)) {
      result.topOfLibrary = { ...(result.topOfLibrary ?? {}), look: true };
      continue;
    }

    // Documented approximation: the public reveal is shown to the controller
    // only (opponents cannot see revealed top cards at this table yet).
    if (/^Play with the top card of your library revealed$/i.test(sentence)) {
      result.topOfLibrary = { ...(result.topOfLibrary ?? {}), look: true };
      continue;
    }

    if (/^~ doesn't untap during your untap step$/i.test(sentence)) {
      result.doesntUntap = true;
      continue;
    }

    // Drumbellower / Seedborn Muse / Unwinding Clock.
    const untapOthers = sentence.match(
      /^Untap all (creatures|permanents|artifacts) you control during each other player's untap step$/i,
    );
    if (untapOthers?.[1]) {
      result.untapDuringEachUntap = untapOthers[1].toLowerCase() as
        | "creatures"
        | "permanents"
        | "artifacts";
      continue;
    }

    // Authority of the Consuls.
    if (/^Creatures your opponents control enter (?:the battlefield )?tapped$/i.test(sentence)) {
      result.opponentCreaturesEnterTapped = true;
      continue;
    }

    // Blind Obedience.
    if (
      /^Artifacts and creatures your opponents control enter (?:the battlefield )?tapped$/i.test(
        sentence,
      )
    ) {
      result.opponentCreaturesEnterTapped = true;
      result.opponentArtifactsEnterTapped = true;
      continue;
    }

    // Extort (CR 702.100): a cast trigger with an optional {W/B} drain.
    if (/^Extort$/i.test(sentence)) {
      result.triggers.push({
        event: "cast_spell",
        watch: "controlled",
        effects: [
          {
            kind: "may_pay",
            playerId: "controller",
            cost: "{W/B}",
            effects: [{ kind: "drain_opponents", playerId: "controller", amount: 1 }],
          },
        ],
      });
      continue;
    }

    if (/^You may cast spells as though they had flash$/i.test(sentence)) {
      result.grantsFlash = true;
      continue;
    }

    if (
      /^If this card is in your opening hand, you may begin the game with it on the battlefield$/i.test(
        sentence,
      )
    ) {
      result.leyline = true;
      continue;
    }

    // Beastmaster Ascension: a counter-gated anthem.
    const questAnthem = sentence.match(
      /^As long as (?:~|this enchantment|this artifact) has (\w+) or more (\w+) counters on it, creatures you control get \+(\d+)\/\+(\d+)$/i,
    );
    if (questAnthem?.[1] && questAnthem[2] && questAnthem[3] && questAnthem[4]) {
      const atLeast = parseCount(questAnthem[1]) ?? Number(questAnthem[1]);
      if (Number.isFinite(atLeast) && atLeast > 0) {
        result.staticAbilities.push({
          selector: { scope: "controlled", types: ["creature"] },
          effect: {
            kind: "modify_pt",
            power: Number(questAnthem[3]),
            toughness: Number(questAnthem[4]),
          },
          requiresCounters: { counter: questAnthem[2].toLowerCase(), atLeast },
        });
        continue;
      }
    }

    // Fabricate N (CR 702.122): the counter half of the choice, always taken —
    // a documented approximation.
    const fabricate = sentence.match(/^Fabricate (\d+)$/i);
    if (fabricate?.[1]) {
      result.triggers.push({
        event: "enter_battlefield",
        effects: [
          {
            kind: "add_counter",
            cardId: "self",
            counter: "p1p1",
            amount: Number(fabricate[1]),
          },
        ],
      });
      continue;
    }

    // Brawn: a keyword anthem that works from the graveyard behind a gate.
    const graveAnthem = sentence.match(
      /^As long as this card is in your graveyard and you control an? ([A-Za-z]+), creatures you control have ([a-z ]+)$/i,
    );
    if (graveAnthem?.[1] && graveAnthem[2]) {
      const keyword = KEYWORD_GRANTS[graveAnthem[2].trim().toLowerCase()];
      const gateWord = graveAnthem[1].toLowerCase();
      if (keyword) {
        result.staticAbilities.push({
          selector: { scope: "controlled", types: ["creature"] },
          effect: { kind: "grant_keyword", keyword },
          fromGraveyard: true,
          requiresControlled: SEARCH_CARD_TYPES.has(gateWord)
            ? { types: [gateWord] }
            : { subtypes: [gateWord] },
        });
        continue;
      }
    }

    // Gravecrawler: a gated recast from the graveyard.
    const graveCast = sentence.match(
      /^You may cast (?:~|this card) from your graveyard as long as you control an? ([A-Za-z]+)$/i,
    );
    if (graveCast?.[1]) {
      const word = graveCast[1].toLowerCase();
      result.castFromGraveyard = SEARCH_CARD_TYPES.has(word)
        ? { types: [word] }
        : { subtypes: [word] };
      continue;
    }

    // Pillow forts. Norn's Annex's {W/P} is approximated as its life half.
    const propaganda = sentence.match(
      /^Creatures can't attack you unless their controller pays \{(\d+)\} for each creature they control that's attacking you$/i,
    );
    if (propaganda?.[1]) {
      result.attackTax = { ...(result.attackTax ?? {}), generic: Number(propaganda[1]) };
      continue;
    }
    if (
      /^Creatures can't attack you or planeswalkers you control unless their controller pays \{X\} for each of those creatures, where X is the number of enchantments you control$/i.test(
        sentence,
      )
    ) {
      result.attackTax = { ...(result.attackTax ?? {}), perEnchantment: true };
      continue;
    }
    if (
      /^Creatures can't attack you or planeswalkers you control unless their controller pays \{W\/P\} for each of those creatures$/i.test(
        sentence,
      )
    ) {
      result.attackTax = { ...(result.attackTax ?? {}), lifePer: 2 };
      continue;
    }

    if (
      /^At the beginning of each player's draw step, that player draws an additional card$/i.test(
        sentence,
      )
    ) {
      result.extraDrawStepDraws = true;
      continue;
    }

    if (/^Affinity for artifacts$/i.test(sentence)) {
      result.affinityArtifacts = true;
      continue;
    }

    if (/^Ascend$/i.test(sentence)) {
      result.ascend = true;
      continue;
    }

    // Wayward Swordtooth: a blessing-gated combat restriction.
    const blessedRestrict = sentence.match(
      /^~ can't (attack or block|attack|block) unless you have the city's blessing$/i,
    );
    if (blessedRestrict?.[1]) {
      const what = blessedRestrict[1].toLowerCase();
      result.staticAbilities.push({
        selector: { scope: "self" },
        effect: {
          kind: "restrict",
          ...(what.includes("attack") ? { cantAttack: true } : {}),
          ...(what.includes("block") ? { cantBlock: true } : {}),
          unlessCityBlessing: true,
        },
      });
      continue;
    }

    const overloadLine = sentence.match(/^Overload ((?:\{[^}]+\})+)$/i);
    if (overloadLine?.[1]) {
      overloadCost = overloadLine[1];
      continue;
    }

    const offspringLine = sentence.match(/^Offspring ((?:\{[^}]+\})+)$/i);
    if (offspringLine?.[1]) {
      offspringCost = offspringLine[1];
      continue;
    }

    const dashLine = sentence.match(/^Dash ((?:\{[^}]+\})+)$/i);
    if (dashLine?.[1]) {
      dashCost = dashLine[1];
      continue;
    }

    if (
      /^This spell costs \{1\} less to cast for each creature on the battlefield$/i.test(sentence)
    ) {
      result.affinityAllCreatures = true;
      continue;
    }

    // Exalted (CR 702.83): +1/+1 until end of turn when one of your
    // creatures attacks alone.
    if (/^Exalted$/i.test(sentence)) {
      result.triggers.push({
        event: "attacks",
        watch: "controlled",
        attacksAlone: true,
        effects: [{ kind: "pt_until_eot", cardId: "subject_card", power: 1, toughness: 1 }],
        targetRequirements: [],
      });
      continue;
    }

    if (/^You may play lands and cast spells from the top of your library$/i.test(sentence)) {
      result.topOfLibrary = { ...(result.topOfLibrary ?? {}), playLands: true, castAll: true };
      continue;
    }

    if (/^You may play lands from the top of your library$/i.test(sentence)) {
      result.topOfLibrary = { ...(result.topOfLibrary ?? {}), playLands: true };
      continue;
    }

    const topCast = sentence.match(
      /^You may cast (artifact|creature|enchantment|instant|sorcery) spells from the top of your library$/i,
    );
    if (topCast?.[1]) {
      const prior = result.topOfLibrary ?? {};
      result.topOfLibrary = {
        ...prior,
        castTypesAny: [...new Set([...(prior.castTypesAny ?? []), topCast[1].toLowerCase()])],
      };
      continue;
    }

    if (
      /^If you control a commander, you may cast this spell without paying its mana cost$/i.test(
        sentence,
      )
    ) {
      // Documented approximation (RULES_COVERAGE.md): the free alternative
      // cost is auto-taken whenever a commander is controlled.
      result.freeIfCommander = true;
      continue;
    }

    // Urza's Incubator / Herald's Horn: the discount reads the chosen type.
    // Incubator omits "you cast"; the reduction still only applies to the
    // controller's own spells — a documented approximation.
    const chosenDiscount = sentence.match(
      /^Creature spells(?: you cast)? of the chosen type cost \{(\d+)\} less to cast$/i,
    );
    if (chosenDiscount?.[1]) {
      result.costReductions = [
        ...(result.costReductions ?? []),
        {
          generic: Number(chosenDiscount[1]),
          filter: { types: ["creature"], chosenSubtype: true },
        },
      ];
      continue;
    }

    // Goblin Anarchomancer.
    const colorPairDiscount = sentence.match(
      /^Each spell you cast that's (white|blue|black|red|green) or (white|blue|black|red|green) costs \{(\d+)\} less to cast$/i,
    );
    if (colorPairDiscount?.[1] && colorPairDiscount[2] && colorPairDiscount[3]) {
      result.costReductions = [
        ...(result.costReductions ?? []),
        {
          generic: Number(colorPairDiscount[3]),
          filter: {
            colors: [
              COLOR_WORDS[colorPairDiscount[1].toLowerCase()]!,
              COLOR_WORDS[colorPairDiscount[2].toLowerCase()]!,
            ],
          },
        },
      ];
      continue;
    }

    const discount = sentence.match(/^(.+?) spells(?: you cast)? cost \{(\d+)\} less to cast$/i);
    if (discount?.[1] && discount[2]) {
      const what = discount[1].trim().toLowerCase();
      const colorOf: Record<string, Color> = {
        white: "W",
        blue: "U",
        black: "B",
        red: "R",
        green: "G",
      };
      let filter: CostReduction["filter"] | null = null;
      const colorType = what.match(
        /^(white|blue|black|red|green) (artifact|creature|enchantment|instant|sorcery)$/,
      );
      if (colorType?.[1] && colorType[2]) {
        filter = { colors: [colorOf[colorType[1]]!], types: [colorType[2]] };
      } else if (colorOf[what]) {
        filter = { colors: [colorOf[what]!] };
      } else if (["artifact", "creature", "enchantment", "instant", "sorcery"].includes(what)) {
        filter = { types: [what] };
      } else if (what === "instant and sorcery") {
        filter = { typesAny: ["instant", "sorcery"] };
      } else if (/^[a-z]+$/.test(what) && /^[A-Z]/.test(discount[1].trim())) {
        // A single capitalized word that is not a card type: a tribal
        // discount ("Dragon spells you cast cost {1} less").
        filter = { subtypesAny: [what] };
      }
      if (filter) {
        result.costReductions = [
          ...(result.costReductions ?? []),
          { generic: Number(discount[2]), filter },
        ];
        continue;
      }
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

    // Anointed Procession / Doubling Season: token doubling.
    if (
      /^If (?:one or more tokens would be created under your control|an effect would create one or more tokens under your control), (?:twice that many of those tokens are created|it creates twice that many of those tokens) instead$/i.test(
        sentence,
      )
    ) {
      result.replacements.push({ kind: "double_tokens" });
      continue;
    }

    // Doubling Season's counter half: all counters on your permanents.
    if (
      /^If an effect would put one or more counters on a permanent you control, it puts twice that many of those counters on (?:it|that permanent) instead$/i.test(
        sentence,
      )
    ) {
      result.replacements.push({ kind: "double_counters" });
      continue;
    }

    // Laboratory Maniac.
    if (
      /^If you would draw a card while your library has no cards in it, you win the game instead$/i.test(
        sentence,
      )
    ) {
      result.replacements.push({ kind: "empty_draw_wins" });
      continue;
    }

    // Rhox Faithmender / Boon Reflection: life-gain doubling.
    if (
      /^If you would gain life, you gain twice that much life instead$/i.test(sentence)
    ) {
      result.replacements.push({ kind: "double_life_gain" });
      continue;
    }

    // Teferi's Ageless Insight / Alhammarret's Archive: draw doubling with
    // the draw-step first-card exemption.
    if (
      /^If you would draw a card except the first one you draw in each of your draw steps, draw two cards instead$/i.test(
        sentence,
      )
    ) {
      result.replacements.push({ kind: "double_draws_except_first" });
      continue;
    }

    // Branching Evolution: +1/+1 counters on your creatures.
    if (
      /^If one or more \+1\/\+1 counters would be put on a creature you control, twice that many \+1\/\+1 counters are put on (?:it|that creature) instead$/i.test(
        sentence,
      )
    ) {
      result.replacements.push({ kind: "double_counters", counter: "p1p1", creaturesOnly: true });
      continue;
    }

    // Hardened Scales / Kami of Whispered Hopes: "that many plus one".
    const bonusCounters = sentence.match(
      /^If one or more \+1\/\+1 counters would be put on a (creature|permanent) you control, that many plus one \+1\/\+1 counters are put on (?:it|that creature|that permanent) instead$/i,
    );
    if (bonusCounters?.[1]) {
      result.replacements.push({
        kind: "bonus_counters",
        counter: "p1p1",
        ...(bonusCounters[1].toLowerCase() === "creature" ? { creaturesOnly: true } : {}),
      });
      continue;
    }

    // SOI/STX reveal lands: "As ~ enters, you may reveal a Plains or Island
    // card from your hand." + "If you don't, ~ enters tapped."
    const revealLand = sentence.match(
      /^As ~ enters, you may reveal an? ([A-Za-z]+) or (?:an? )?([A-Za-z]+) card from your hand$/i,
    );
    if (revealLand?.[1] && revealLand[2]) {
      result.replacements.push({
        kind: "enters_tapped_unless",
        unless: {
          kind: "hand_reveals_types",
          types: [revealLand[1].toLowerCase(), revealLand[2].toLowerCase()],
        },
      });
      continue;
    }
    if (
      /^If you don't, ~ enters tapped$/i.test(sentence) &&
      result.replacements.some(
        (replacement) =>
          replacement.kind === "enters_tapped_unless" &&
          replacement.unless.kind === "hand_reveals_types",
      )
    ) {
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

    // "When ~ enters, you may pay {2}." + "If you do, <clause>." — must run
    // before the general ETB branch eats the sentence.
    const mayPayEtb = sentence.match(
      /^(When(?:ever)? ~ enters), you may pay ((?:\{[^}]+\})+)$/i,
    );
    if (mayPayEtb?.[2]) {
      const follow = sentences[index + 1]?.match(/^If you do, (.+)$/i);
      const inner = follow?.[1] ? compileSimpleClause(follow[1].trim()) : null;
      if (inner && !inner.leftover && inner.targetRequirements.length === 0) {
        result.triggers.push({
          event: "enter_battlefield",
          effects: [
            {
              kind: "may_pay",
              playerId: "controller",
              cost: mayPayEtb[2],
              effects: inner.effects,
            },
          ],
          targetRequirements: [],
        });
        index += 1;
        continue;
      }
    }

    const etb = sentence.match(/^When ~ enters(?: and whenever [^,]+)?, (.+)$/i);
    if (etb?.[1]) {
      // Garruk's Uprising: peel an intervening "if" off the ETB body.
      let etbRest = etb[1].trim();
      let etbCondition: TriggerCondition | undefined;
      const etbIf = etbRest.match(/^if you control a creature with power (\d+) or greater, (?:then )?(.+)$/i);
      if (etbIf?.[1] && etbIf[2]) {
        etbCondition = { kind: "controls_power_at_least", power: Number(etbIf[1]) };
        etbRest = etbIf[2].trim();
      }
      const inner = compileSimpleClause(etbRest);
      if (inner) {
        result.triggers.push({
          event: "enter_battlefield",
          ...(etbCondition ? { condition: etbCondition } : {}),
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

    const beginCombat = sentence.match(
      /^At the beginning of (?:combat on your turn|each combat), (.+)$/i,
    );
    if (beginCombat?.[1]) {
      const everyCombat = /each combat/i.test(sentence);
      const inner = compileSimpleClause(beginCombat[1].trim());
      if (inner) {
        result.triggers.push({
          event: "begin_combat",
          ...(everyCombat ? { watch: "any" as const } : {}),
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

    // "When ~ enters, you may pay {2}." + "If you do, <clause>."
    const mayPayPair = sentence.match(/^(When(?:ever)? [^,]+), you may pay ((?:\{[^}]+\})+)$/i);
    if (mayPayPair?.[1] && mayPayPair[2]) {
      const head = parseTriggerHead(mayPayPair[1]);
      const follow = sentences[index + 1]?.match(/^If you do, (.+)$/i);
      const inner = follow?.[1] ? compileSimpleClause(follow[1].trim()) : null;
      if (head && inner && !inner.leftover && inner.targetRequirements.length === 0) {
        const { extraEvents: _skip, ...headRest } = head;
        result.triggers.push({
          ...headRest,
          effects: [
            {
              kind: "may_pay",
              playerId: "controller",
              cost: mayPayPair[2],
              effects: inner.effects,
            },
          ],
          targetRequirements: [],
        });
        index += 1;
        continue;
      }
    }

    // Smothering Tithe: "…, that player may pay {2}." + "If they don't, <clause>."
    const tithePair = sentence.match(
      /^(When(?:ever)? [^,]+), that player may pay ((?:\{[^}]+\})+)$/i,
    );
    if (tithePair?.[1] && tithePair[2]) {
      const head = parseTriggerHead(tithePair[1]);
      const follow = sentences[index + 1]?.match(/^If (?:they don't|the player doesn't), (.+)$/i);
      const inner = follow?.[1]
        ? compileSimpleClause(follow[1].trim().replace(/^you /i, ""))
        : null;
      if (head && inner && !inner.leftover && inner.targetRequirements.length === 0) {
        const { extraEvents: _unused, ...headRest } = head;
        result.triggers.push({
          ...headRest,
          effects: [
            {
              kind: "unless_pays",
              playerId: { type: "subject_player" },
              cost: tithePair[2],
              effects: inner.effects,
            },
          ],
          targetRequirements: [],
        });
        index += 1;
        continue;
      }
    }

    // Beast Within / Stroke of Midnight: destroy + the consolation token.
    const wipePair = sentence.match(/^Destroy target (nonland )?permanent$/i);
    if (wipePair) {
      const tokenClause = sentences[index + 1]?.match(
        /^Its controller creates a (\d+)\/(\d+)(?: (white|blue|black|red|green|colorless))? ([A-Za-z]+) creature token$/i,
      );
      if (tokenClause?.[1] && tokenClause[2] && tokenClause[4]) {
        const subtype =
          tokenClause[4][0]!.toUpperCase() + tokenClause[4].slice(1).toLowerCase();
        commitClause(result, {
          targetRequirements: [{ kind: wipePair[1] ? "nonland_permanent" : "permanent" }],
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

    // The general branch splits at the first comma, which breaks heads that
    // contain a type list ("an artifact, instant, or sorcery spell").
    const listCast = sentence.match(
      /^(Whenever (?:you cast|an opponent casts) an artifact, instant, or sorcery spell), (.+)$/i,
    );
    if (listCast?.[1] && listCast[2]) {
      const head = parseTriggerHead(listCast[1]);
      const inner = head ? compileSimpleClause(listCast[2].trim()) : null;
      if (head && inner && !inner.leftover) {
        const { extraEvents: _ignored, ...headRest } = head;
        result.triggers.push({
          ...headRest,
          effects: inner.effects,
          targetRequirements: inner.targetRequirements,
        });
        continue;
      }
      result.leftover.push(sentence);
      continue;
    }

    // Sram: a comma-carrying any-of subtype cast head.
    const sramHead = sentence.match(
      /^Whenever you cast an? ([A-Z][\w]*), ([A-Z][\w]*), or ([A-Z][\w]*) spell, (.+)$/,
    );
    if (
      sramHead?.[1] &&
      sramHead[2] &&
      sramHead[3] &&
      sramHead[4] &&
      !SEARCH_CARD_TYPES.has(sramHead[1].toLowerCase()) &&
      !SEARCH_CARD_TYPES.has(sramHead[2].toLowerCase()) &&
      !SEARCH_CARD_TYPES.has(sramHead[3].toLowerCase())
    ) {
      const inner = compileSimpleClause(sramHead[4].trim());
      if (inner && !inner.leftover && inner.targetRequirements.length === 0) {
        result.triggers.push({
          event: "cast_spell",
          watch: "controlled",
          subjectFilter: {
            subtypesAny: [
              sramHead[1].toLowerCase(),
              sramHead[2].toLowerCase(),
              sramHead[3].toLowerCase(),
            ],
          },
          effects: inner.effects,
        });
        continue;
      }
    }

    // Syr Konrad's triple head: one body, three sibling triggers.
    const konrad = sentence.match(
      /^Whenever another creature dies, or a creature card is put into a graveyard from anywhere other than the battlefield, or a creature card leaves your graveyard, (.+)$/i,
    );
    if (konrad?.[1]) {
      const inner = compileSimpleClause(konrad[1]);
      if (inner && !inner.leftover && inner.targetRequirements.length === 0) {
        result.triggers.push(
          {
            event: "dies",
            watch: "any",
            excludeSelf: true,
            subjectFilter: { types: ["creature"] },
            effects: inner.effects,
          },
          {
            event: "graveyard_from_elsewhere",
            subjectFilter: { types: ["creature"] },
            effects: inner.effects.map((entry) => ({ ...entry })),
          },
          {
            event: "leaves_your_graveyard",
            subjectFilter: { types: ["creature"] },
            effects: inner.effects.map((entry) => ({ ...entry })),
          },
        );
        continue;
      }
    }

    const generalTrigger = sentence.match(/^((?:Landfall\s*[—-]\s*)?[^,]+?), (.+)$/i);
    if (generalTrigger?.[1] && generalTrigger[2]) {
      const head = parseTriggerHead(generalTrigger[1]);
      if (head) {
        // Intervening "if" (CR 603.4): peel the condition off the body.
        let rest = generalTrigger[2].trim();
        let condition: TriggerCondition | undefined;
        const interveningIf = rest.match(/^if (.+?), (?:then )?(.+)$/i);
        if (interveningIf?.[1] && interveningIf[2]) {
          const phrase = interveningIf[1].trim();
          if (
            /^you control the artifact with the greatest mana value or tied for the greatest mana value$/i.test(
              phrase,
            )
          ) {
            condition = { kind: "greatest_artifact_mana_value" };
            rest = interveningIf[2].trim();
          } else if (/^an opponent controls more lands than you$/i.test(phrase)) {
            // Land Tax.
            condition = { kind: "opponent_controls_more_lands" };
            rest = interveningIf[2].trim();
          } else if (
            /^it doesn't have the same name as another creature you control or a creature card in your graveyard$/i.test(
              phrase,
            )
          ) {
            // Guardian Project.
            condition = { kind: "subject_name_unique" };
            rest = interveningIf[2].trim();
          } else if (
            /^you control a creature with power (\d+) or greater$/i.test(phrase)
          ) {
            // Garruk's Uprising.
            const power = Number(phrase.match(/power (\d+)/i)![1]);
            condition = { kind: "controls_power_at_least", power };
            rest = interveningIf[2].trim();
          } else {
            const controls = phrase.match(
              /^you control (two|three|four|five|six|\d+) or more (lands|creatures|artifacts)$/i,
            );
            const atLeast = controls?.[1] ? parseCount(controls[1]) : null;
            if (controls?.[2] && atLeast) {
              condition = {
                kind: "controls_count",
                what: controls[2].toLowerCase().replace(/s$/, "") as
                  | "land"
                  | "creature"
                  | "artifact",
                atLeast,
              };
              rest = interveningIf[2].trim();
            }
          }
        }
        const inner = compileSimpleClause(rest);
        if (inner && condition) {
          if (!inner.leftover) {
            const { extraEvents: _conditionSkip, ...headRest } = head;
            result.triggers.push({
              ...headRest,
              condition,
              effects: inner.effects,
              targetRequirements: inner.targetRequirements,
            });
            continue;
          }
          result.leftover.push(sentence);
          continue;
        }
        if (inner) {
          // Scute Swarm: the next sentence upgrades the token to a copy.
          const nextSentence = sentences[index + 1];
          const copyInstead =
            nextSentence && !lineStart[index + 1]
              ? nextSentence.match(
                  /^If you control (\w+) or more lands, create a token that's a copy of (?:~|this creature) instead$/i,
                )
              : null;
          const copyAt = copyInstead?.[1] ? parseCount(copyInstead[1]) : null;
          const lastEffect = inner.effects[inner.effects.length - 1];
          if (copyAt && lastEffect?.kind === "create_token") {
            lastEffect.copySelfIfLandsAtLeast = copyAt;
            sentences[index + 1] = "";
          }
          const { extraEvents, ...headRest } = head;
          result.triggers.push({
            ...headRest,
            effects: inner.effects,
            targetRequirements: inner.targetRequirements,
          });
          for (const extra of extraEvents ?? []) {
            result.triggers.push({
              ...headRest,
              event: extra,
              effects: inner.effects.map((effect) => ({ ...effect })),
              targetRequirements: inner.targetRequirements.map((req) => ({ ...req })),
            });
          }
          if (inner.leftover) {
            result.leftover.push(inner.leftover);
          }
          continue;
        }
        result.leftover.push(sentence);
        continue;
      }
    }

    // Spirit Guides: "Exile this card from your hand: Add {G}."
    const spiritGuide = sentence.match(/^Exile this card from your hand: Add ((?:\{[WUBRGC]\})+)$/i);
    if (spiritGuide?.[1]) {
      const mana: Partial<Record<"W" | "U" | "B" | "R" | "G" | "C", number>> = {};
      for (const pip of spiritGuide[1].match(/\{[WUBRGC]\}/g) ?? []) {
        const color = pip[1] as "W" | "U" | "B" | "R" | "G" | "C";
        mana[color] = (mana[color] ?? 0) + 1;
      }
      result.activated.push({
        tap: false,
        manaCost: "",
        zone: "hand",
        exileSelf: true,
        effects: [{ kind: "add_mana", playerId: "controller", mana }],
        targetRequirements: [],
      });
      continue;
    }

    // Cycling {cost}: "{cost}, Discard this card: Draw a card." (CR 702.29).
    const cycling = sentence.match(/^Cycling ((?:\{[^}]+\})+)$/i);
    if (cycling?.[1]) {
      let cyclingCostOk = true;
      try {
        parseManaCost(cycling[1]);
      } catch {
        cyclingCostOk = false;
      }
      if (cyclingCostOk) {
        result.activated.push({
          tap: false,
          manaCost: cycling[1],
          effects: [{ kind: "draw", playerId: "controller", count: 1 }],
          targetRequirements: [],
          zone: "hand",
          discard: true,
        });
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
        result.manaAbilities.push({
          ...manaAbilityFromAdd(add),
          ...(cost.tapCreature ? { costTapCreature: true } : {}),
        });
        if (add.kind === "any_color" && add.identityRestricted) {
          result.notes.push("Commander's color identity is not enforced; any color may be added.");
        }
        continue;
      }
      // Springleaf Drum-class: a tap mana ability with a mana activation cost.
      if (add && cost.tap && cost.manaCost !== "" && !cost.sacrificeSelf && !cost.lifeCost) {
        result.manaAbilities.push({ ...manaAbilityFromAdd(add), costMana: cost.manaCost });
        if (add.kind === "any_color" && add.identityRestricted) {
          result.notes.push("Commander's color identity is not enforced; any color may be added.");
        }
        continue;
      }
      // Phyrexian Altar-class: a tapless mana ability paid by sacrificing.
      if (
        add &&
        !cost.tap &&
        cost.manaCost === "" &&
        cost.sacrificeCost &&
        cost.sacrificeCost !== "another_creature" &&
        !cost.lifeCost
      ) {
        result.manaAbilities.push({
          ...manaAbilityFromAdd(add),
          costSacrifice: cost.sacrificeCost,
          noTap: true,
        });
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
      const pushed: ActivatedAbility = {
        tap: cost.tap,
        manaCost: cost.manaCost,
        effects: clause.effects,
        targetRequirements: clause.targetRequirements,
        ...(cost.sacrificeSelf ? { sacrificeSelf: true } : {}),
        ...(cost.sacrificeCost ? { sacrificeCost: cost.sacrificeCost } : {}),
        ...(cost.lifeCost ? { lifeCost: cost.lifeCost } : {}),
      };
      result.activated.push(pushed);
      if (clause.leftover) {
        result.leftover.push(clause.leftover);
      }
      // Multi-sentence ability bodies: sentences on the SAME printed line
      // extend this ability ("…: Do A. Do B. Sacrifice it at the beginning
      // of the next end step."). Riders like "Activate only as a sorcery"
      // don't compile as clauses, so they fall through to the rider handlers
      // below, which attach to this same (last) ability.
      while (index + 1 < sentences.length && !lineStart[index + 1]) {
        const follow = sentences[index + 1]!;
        if (foldSubjectRider(pushed.effects, follow)) {
          index += 1;
          continue;
        }
        const searchRider = controllerBasicSearchRider(
          follow,
          pushed.targetRequirements.length - 1,
        );
        if (searchRider && pushed.targetRequirements.length > 0) {
          pushed.effects.push(searchRider);
          index += 1;
          continue;
        }
        // Fabled Passage: the fetched land untaps at the land threshold.
        const untapRider = follow.match(
          /^Then if you control (two|three|four|five|\d+) or more lands, untap (?:that land|it)$/i,
        );
        if (untapRider?.[1]) {
          const threshold = parseCount(untapRider[1]);
          const lastSearch = [...pushed.effects]
            .reverse()
            .find((entry) => entry.kind === "search_library");
          if (threshold && lastSearch?.kind === "search_library") {
            lastSearch.untapIfLands = threshold;
            index += 1;
            continue;
          }
        }
        const followClause = compileSimpleClause(follow);
        if (!followClause || followClause.leftover) {
          break;
        }
        const offset = pushed.targetRequirements.length;
        pushed.effects.push(...followClause.effects.map((effect) => shiftChosen(effect, offset)));
        pushed.targetRequirements.push(...followClause.targetRequirements);
        index += 1;
      }
      continue;
    }

    // "After this main phase, there is an additional combat phase…" as its
    // own sentence after an activated ability (Aggravated Assault) extends
    // that ability rather than the card's cast effects.
    if (
      /^After this (?:main )?phase, there is an additional combat phase(?: followed by an additional main phase)?$/i.test(
        sentence,
      ) &&
      (result.activated.length > 0 || result.triggers.length > 0)
    ) {
      // Aggravated Assault rides the last activated ability; Aurelia's rides
      // her attack trigger.
      const lastActivated = result.activated[result.activated.length - 1];
      const lastTrigger = result.triggers[result.triggers.length - 1];
      if (result.activated.length > 0 && lastActivated) {
        lastActivated.effects.push({ kind: "extra_combat" });
        continue;
      }
      if (lastTrigger) {
        lastTrigger.effects.push({ kind: "extra_combat" });
        continue;
      }
    }

    if (/^Activate only as a sorcery$/i.test(sentence) && result.activated.length > 0) {
      const last = result.activated[result.activated.length - 1];
      if (last && !last.timing) {
        last.timing = "sorcery";
        continue;
      }
    }

    // Kamigawa channel lands.
    if (
      /^This ability costs \{1\} less to activate for each legendary creature you control$/i.test(
        sentence,
      ) &&
      result.activated.length > 0
    ) {
      const last = result.activated[result.activated.length - 1];
      if (last && !last.legendaryDiscount) {
        last.legendaryDiscount = true;
        continue;
      }
    }

    // Mox Opal: a count gate riding the previous mana ability.
    const countGate = sentence.match(
      /^Activate only if you control (two|three|four|five|\d+) or more (artifacts|creatures|lands)$/i,
    );
    if (countGate?.[1] && countGate[2]) {
      const atLeast = parseCount(countGate[1]);
      const lastMana = result.manaAbilities[result.manaAbilities.length - 1];
      if (atLeast && lastMana && !lastMana.requiresCount) {
        lastMana.requiresCount = {
          what: countGate[2].toLowerCase().replace(/s$/, "") as "artifact" | "creature" | "land",
          atLeast,
        };
        continue;
      }
    }

    // Idol of Oblivion.
    if (/^Activate only if you created a token this turn$/i.test(sentence)) {
      const lastActivated = result.activated[result.activated.length - 1];
      if (lastActivated && !lastActivated.requiresCreatedToken) {
        lastActivated.requiresCreatedToken = true;
        continue;
      }
    }

    const activateGate = sentence.match(/^Activate only if you control (an? )?([A-Za-z]+)$/i);
    if (activateGate?.[2]) {
      const name = activateGate[2].toLowerCase();
      const gate = SEARCH_CARD_TYPES.has(name)
        ? { types: [name] }
        : { subtypes: [name] };
      const lastActivated = result.activated[result.activated.length - 1];
      if (lastActivated && !lastActivated.requiresControlled) {
        lastActivated.requiresControlled = gate;
        continue;
      }
      // The gate can also ride a mana ability (Cabal Stronghold-class).
      const lastMana = result.manaAbilities[result.manaAbilities.length - 1];
      if (lastMana && !lastMana.requiresControlled) {
        lastMana.requiresControlled = gate;
        continue;
      }
    }

    // Creeping Bloodsucker: fold the lifegain rider into the last trigger's
    // damage effects.
    if (
      /^You gain life equal to the damage dealt this way$/i.test(sentence) &&
      result.triggers.length > 0
    ) {
      const last = result.triggers[result.triggers.length - 1];
      const damage = last?.effects.filter(
        (effect): effect is Extract<CardEffect, { kind: "deal_damage" }> =>
          effect.kind === "deal_damage",
      );
      if (last && damage && damage.length > 0) {
        for (const entry of damage) {
          entry.gainLife = true;
        }
        continue;
      }
    }

    if (
      /^This ability triggers only once each turn$/i.test(sentence) &&
      result.triggers.length > 0
    ) {
      const last = result.triggers[result.triggers.length - 1];
      if (last && !last.oncePerTurn) {
        last.oncePerTurn = true;
        continue;
      }
    }

    const pain = sentence.match(/^~ deals (\d+) damage to you$/i);
    if (pain?.[1] && result.manaAbilities.length > 0) {
      const last = result.manaAbilities[result.manaAbilities.length - 1];
      if (last) {
        last.damageToController = Number(pain[1]);
        continue;
      }
    }

    const basicSearchRider = controllerBasicSearchRider(
      sentence,
      result.targetRequirements.length - 1,
    );
    if (basicSearchRider && result.targetRequirements.length > 0) {
      result.effects.push(basicSearchRider);
      continue;
    }
    // Channel abilities (Boseiju) get the rider attached to their targets.
    const lastActivated = result.activated[result.activated.length - 1];
    if (lastActivated && lastActivated.targetRequirements.length > 0) {
      const activatedRider = controllerBasicSearchRider(
        sentence,
        lastActivated.targetRequirements.length - 1,
      );
      if (activatedRider) {
        lastActivated.effects.push(activatedRider);
        continue;
      }
    }

    // Pongify / Rapid Hybridization: the token goes to the destroyed
    // creature's controller. Rides the previous sentence's creature target,
    // so the chosen index is referenced directly (no shifting).
    const controllerToken = sentence.match(
      /^(?:its|that creature's) controller creates an? (\d+)\/(\d+)(?: (white|blue|black|red|green|colorless))? ([\w]+(?: [\w]+)?) creature token$/i,
    );
    if (controllerToken?.[1] && controllerToken[2] && controllerToken[4]) {
      const lastIndex = result.targetRequirements.length - 1;
      const last = result.targetRequirements[lastIndex];
      if (last && last.kind.includes("creature")) {
        const subtype = controllerToken[4].replace(/\b\w/g, (letter) => letter.toUpperCase());
        result.effects.push({
          kind: "create_token",
          ownerId: { type: "chosen_controller", index: lastIndex },
          name: subtype,
          typeLine: `Creature — ${subtype} Token`,
          power: Number(controllerToken[1]),
          toughness: Number(controllerToken[2]),
        });
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

  // Overload (CR 702.96): rebuild the compiled single-target spell as two
  // modes — the normal cast, and an untargeted sweep over every object the
  // normal mode could target. The extra cost is the generic difference
  // between the overload cost and the printed cost.
  if (overloadCost) {
    let built = false;
    if (result.targetRequirements.length === 1 && result.effects.length > 0 && !result.modes) {
      try {
        const base = parseManaCost(card.manaCost);
        const over = parseManaCost(overloadCost);
        const coloredMatch = (["W", "U", "B", "R", "G", "C"] as const).every(
          (pip) => base[pip] === over[pip],
        );
        const extra = over.generic - base.generic;
        if (coloredMatch && extra > 0 && over.hybrid.length === 0 && over.xCount === 0) {
          const requirement = result.targetRequirements[0]!;
          result.modes = [
            {
              label: "Cast normally",
              effects: result.effects,
              targetRequirements: result.targetRequirements,
            },
            {
              label: `Overload ${overloadCost}`,
              extraCost: `{${extra}}`,
              effects: [
                {
                  kind: "overload_each",
                  requirement,
                  effects: result.effects.map((entry) => ({ ...entry })),
                },
              ],
              targetRequirements: [],
            },
          ];
          result.effects = [];
          result.targetRequirements = [];
          built = true;
        }
      } catch {
        // fall through to leftover
      }
    }
    if (!built) {
      result.leftover.push(`Overload ${overloadCost}`);
    }
  }

  // Dash (CR 702.109), modeled like kicker when the dash cost is the printed
  // cost plus generic: the dashed mode enters hasty and bounces at end step.
  if (dashCost) {
    let built = false;
    if (!result.modes) {
      try {
        const printed = parseManaCost(card.manaCost);
        const dash = parseManaCost(dashCost);
        const coloredMatch = (["W", "U", "B", "R", "G", "C"] as const).every(
          (pip) => printed[pip] === dash[pip],
        );
        const extra = dash.generic - printed.generic;
        if (coloredMatch && extra >= 0 && dash.hybrid.length === 0 && dash.xCount === 0) {
          result.modes = [
            {
              label: "Cast normally",
              effects: result.effects,
              targetRequirements: result.targetRequirements,
            },
            {
              label: `Dash ${dashCost}`,
              ...(extra > 0 ? { extraCost: `{${extra}}` } : {}),
              dash: true,
              effects: result.effects.map((entry) => ({ ...entry })),
              targetRequirements: result.targetRequirements.map((entry) => ({ ...entry })),
            },
          ];
          result.effects = [];
          result.targetRequirements = [];
          built = true;
        }
      } catch {
        // fall through to leftover
      }
    }
    if (!built) {
      result.leftover.push(`Dash ${dashCost}`);
    }
  }

  // Offspring (CR 702.176), modeled like kicker: paying the extra cost adds a
  // 1/1 token copy of the entering creature.
  if (offspringCost) {
    if (!result.modes) {
      result.modes = [
        {
          label: "Cast normally",
          effects: result.effects,
          targetRequirements: result.targetRequirements,
        },
        {
          label: `Offspring ${offspringCost}`,
          extraCost: offspringCost,
          effects: [
            ...result.effects.map((entry) => ({ ...entry })),
            {
              kind: "copy_token" as const,
              ownerId: "controller" as const,
              ofCardId: "self" as const,
              setPt: { power: 1, toughness: 1 },
            },
          ],
          targetRequirements: result.targetRequirements.map((entry) => ({ ...entry })),
        },
      ];
      result.effects = [];
      result.targetRequirements = [];
    } else {
      result.leftover.push(`Offspring ${offspringCost}`);
    }
  }

  return result;
}
