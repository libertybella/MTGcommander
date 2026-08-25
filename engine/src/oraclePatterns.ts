import { manaValueOf } from "./characteristics";
import { IMPLEMENTED_KEYWORDS } from "./keywordCatalog";
import { parseManaCost } from "./mana";
import { parseAmassClause } from "./tokens";
import type {
  ProtectionFrom,
  ActivatedAbility,
  AdditionalCastCost,
  TopOfLibraryGrant,
  CardDefinition,
  CardEffect,
  CardFilter,
  ControlAllScope,
  CardTrigger,
  ChooseCardSource,
  Color,
  ContinuousEffectData,
  ControlledGate,
  ManaRestriction,
  CostReduction,
  EffectSelector,
  DestroyAllScope,
  DynamicCount,
  EnterAsCopyScope,
  EnterTappedUnless,
  Keyword,
  LoyaltyAbility,
  ManaAbility,
  ManaColor,
  ManaPool,
  PlayerSelector,
  ReplacementEffect,
  SearchFilter,
  SpellMode,
  StaticAbility,
  TriggerEvent,
  TargetKind,
  AlternativeCastCost,
  DamageReplacement,
  TargetRequirement,
  TriggerCondition,
} from "./types";
import { mergeProtection } from "./characteristicsEngine";
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
  wardLife?: number;
  modes?: SpellMode[];
  protectionFrom?: ProtectionFrom;
  /** Taken from the definition so the two cannot drift apart. */
  enchant?: CardDefinition["enchant"];
  reanimateOnEnter?: boolean;
  grantsEscape?: { exileOther: number };
  copySelfWhenCastFromGraveyard?: boolean;
  cascade?: number;
  harmonizeConvoke?: boolean;
  chooseColorOnEnter?: boolean;
  chooseColorExcludes?: Color;
  enchantedTappedBonus?: { color: Color | "chosen"; amount: number };
  loyaltyAbilities?: LoyaltyAbility[];
  noMaxHandSize?: boolean;
  landsEnterUntapped?: boolean;
  totemArmor?: boolean;
  targetingLifeTax?: number;
  opponentsEnterTriggersSuppressed?: boolean;
  payLifeForColor?: Color;
  handSizeEffect?: CardDefinition["handSizeEffect"];
  opponentsDrawCap?: number;
  noncreatureSpellCap?: number;
  cantLoseGame?: boolean;
  creaturesDontUntap?: boolean;
  controllerHexproof?: boolean;
  attackLimitPerCombat?: number;
  extraBlocksGranted?: number;
  damageReplacement?: DamageReplacement;
  manaTapMultiplier?: number;
  altCost?: AlternativeCastCost;
  extraLandDrops?: number;
  extraLandDropsForAll?: number;
  cantBeCountered?: boolean;
  spellsCantBeCountered?: { types?: string[] };
  opponentsLockedDuringYourTurn?: boolean;
  opponentsCantCastDuringYourTurn?: boolean;
  mustAttack?: boolean;
  notCreatureBelowDevotion?: { color: Color; threshold: number };
  freeIfCommander?: boolean;
  altCostIfCreatures?: { cost: string; count: number };
  changeling?: boolean;
  storm?: boolean;
  doesntUntap?: boolean;
  convoke?: boolean;
  improvise?: boolean;
  delve?: boolean;
  grantsCostKeyword?: { keyword: "convoke" | "improvise"; types?: string[]; nonTypes?: string[] };
  grantsFlash?: boolean;
  grantsFlashFor?: { types?: string[]; subtypesAny?: string[] };
  castFreeFromHand?: CardDefinition["castFreeFromHand"];
  attackTax?: { generic?: number; perEnchantment?: boolean; lifePer?: number };
  leyline?: boolean;
  openingHandStart?: { counter: string; exileFromHand: number };
  saga?: { chapters: CardEffect[][] };
  castFromGraveyard?: { types?: string[]; subtypes?: string[] };
  ascend?: boolean;
  untapDuringEachUntap?: CardDefinition["untapDuringEachUntap"];
  abilityHaste?: boolean;
  opponentCreaturesEnterTapped?: boolean;
  opponentNonbasicLandsEnterTapped?: boolean;
  opponentArtifactsEnterTapped?: boolean;
  extraDrawStepDraws?: boolean;
  affinityArtifacts?: boolean;
  affinityAllCreatures?: boolean;
  selfDiscount?: CardDefinition["selfDiscount"];
  topOfLibrary?: TopOfLibraryGrant;
  flashback?: CardDefinition["flashback"];
  evoke?: CardDefinition["evoke"];
  splitSecond?: boolean;
  blockPowerGate?: CardDefinition["blockPowerGate"];
  echo?: CardDefinition["echo"];
  escalate?: CardDefinition["escalate"];
  costReductions?: CostReduction[];
  chooseCreatureTypeOnEnter?: boolean;
  chooseCardTypeOnEnter?: boolean;
  enterCountersPerChosenType?: string;
  freeEquipIfArtifacts?: number;
  opponentsCastOnlyFromHand?: boolean;
  selfIsChosenType?: boolean;
  triggerDoubling?: CardDefinition["triggerDoubling"];
  landChosenColorBonus?: boolean;
  landTapEcho?: CardDefinition["landTapEcho"];
  opponentLandTapsSkipUntap?: boolean;
  rebound?: boolean;
  entersWithXCounters?: boolean;
  entersWithXCounterKind?: string;
  manaCostOverride?: string;
  entersWithCounters?: { counter: string; count: number };
  enterAsCopy?: {
    scope: EnterAsCopyScope;
    extraCounters?: number;
    maxManaValueBySpent?: boolean;
    entersTapped?: boolean;
    untilEot?: boolean;
    grantHaste?: boolean;
  };
  playLandsFromGraveyard?: boolean;
  additionalCost?: AdditionalCastCost;
  dynamicPt?: { count: DynamicCount; powerOnly?: boolean };
  bonusPt?: { power: number; toughness: number; per: DynamicCount };
  modeChoice?: { min: number; max: number; maxIfCommander?: number };
  leftover: string[];
  notes: string[];
};

/**
 * The printed labels that ARE a keyword line, DERIVED from the implemented
 * catalogue. This was a hand-written copy — the fourth in the codebase — and
 * a copy is how five evasion keywords went missing once already.
 */
const KEYWORD_LINE = new Set(Object.values(IMPLEMENTED_KEYWORDS));

const BASIC_TYPE_MANA: Record<string, Color> = {
  plains: "W",
  island: "U",
  swamp: "B",
  mountain: "R",
  forest: "G",
};

/** Keywords a sentence can grant ("All Slivers have shroud", "gains flying"). */
/**
 * Printed label -> Keyword for a GRANT ("Equipped creature has islandwalk").
 * DERIVED, like the label lookup in oracle.ts and `KEYWORD_LINE` above: this
 * was the fifth hand-written copy of the keyword list in the codebase, and a
 * copy is how five evasion keywords went missing once already.
 */
const KEYWORD_GRANTS: Record<string, Keyword> = Object.fromEntries(
  (Object.entries(IMPLEMENTED_KEYWORDS) as [Keyword, string][]).map(
    ([keyword, label]) => [label, keyword],
  ),
);

/**
 * Ability words ("Landfall —", "Treasure Hunter —", "Coven —") are pure
 * flavour: CR 207.2c gives them no rules meaning, so any capitalised phrase
 * before an em dash is stripped off a trigger head. The trailing lookahead
 * keeps this away from real game text that happens to contain a dash — only
 * a phrase introducing an actual trigger is removed.
 */
const ABILITY_WORD_PREFIX = /^[A-Z][A-Za-z'’ ]*\s*[—-]\s*(?=When|Whenever|At the beginning)/;

/**
 * One "as an additional cost" clause, lower-cased. Returns null when the
 * phrase is not a cost this engine can charge, so an either-or line only
 * compiles when BOTH of its halves are understood.
 */
const COLOR_WORD_TO_SYMBOL: Record<string, Color> = {
  white: "W",
  blue: "U",
  black: "B",
  red: "R",
  green: "G",
};

function parseSingleAdditionalCost(what: string): AdditionalCastCost | null {
  if (what === "sacrifice a creature") {
    return { sacrifice: "creature" };
  }
  // Natural Order: the colour narrows the same scope rather than naming a
  // different one, so it rides on the creature branch instead of adding a
  // branch per colour.
  const coloredCreature = what.match(
    /^sacrifice a (white|blue|black|red|green) creature$/,
  );
  if (coloredCreature?.[1]) {
    return {
      sacrifice: "creature",
      sacrificeColor: COLOR_WORD_TO_SYMBOL[coloredCreature[1]]!,
    };
  }
  if (what === "sacrifice an artifact") {
    return { sacrifice: "artifact" };
  }
  if (
    what === "sacrifice an artifact or creature" ||
    what === "sacrifice a creature or artifact"
  ) {
    return { sacrifice: "creature_or_artifact" };
  }
  if (what === "sacrifice a land") {
    return { sacrifice: "land" };
  }
  if (what === "discard a card") {
    return { discard: 1 };
  }
  if (what === "discard two cards") {
    return { discard: 2 };
  }
  if (what === "pay x life") {
    return { lifeX: true };
  }
  const life = what.match(/^pay (\d+) life$/);
  if (life?.[1]) {
    return { life: Number(life[1]) };
  }
  // Redirect Lightning: "pay 5 life or pay {2}". A mana branch is only ever
  // useful inside an `or`, but it is read here so both halves go through the
  // same table rather than the disjunction growing a special case.
  const mana = what.match(/^pay ((?:\{[^}]+\})+)$/);
  if (mana?.[1]) {
    return { mana: mana[1].toUpperCase() };
  }
  // "pay {2}" as a branch has no home here — AdditionalCastCost charges
  // permanents, cards, and life, not mana — so Redirect Lightning's
  // "pay 5 life or pay {2}" stays a clean miss rather than half a cost.
  return null;
}

/**
 * The tail of "Spend this mana only to …", lower-cased. Returns null for any
 * phrasing this engine cannot enforce, so an unenforceable restriction leaves
 * the card uncompiled rather than producing mana that quietly spends on
 * anything.
 */
function parseSpendRestriction(tail: string): ManaRestriction | null {
  // The clause is "cast <describes a spell>", optionally followed by an
  // "or activate abilities of <the same thing>" half. Only the cast half
  // carries the description; the ability half just widens what may be paid.
  const split = tail.match(
    /^cast (.+?)(?: or activate (?:an ability|abilities) of (.+))?$/,
  );
  if (!split?.[1]) {
    return null;
  }
  const allowsAbilities = split[2] !== undefined;

  // Strip the article, the "spell(s)" noun, and a trailing chosen-type tag.
  let phrase = split[1].replace(/^(?:an?|the) /, "").trim();
  let chosenSubtype = false;
  const chosen = phrase.match(/^(.*?) of the chosen type$/);
  if (chosen?.[1]) {
    chosenSubtype = true;
    phrase = chosen[1].trim();
  }
  const noun = phrase.match(/^(.*?) spells?$/);
  if (!noun?.[1]) {
    return null;
  }
  const words = noun[1].split(/\s+/).filter(Boolean);

  const restriction: ManaRestriction = {
    ...(chosenSubtype ? { chosenSubtype: true } : {}),
    ...(allowsAbilities ? { allowsAbilities: true } : {}),
  };
  for (const word of words) {
    if (word === "colorless") {
      restriction.colorless = true;
    } else if (word === "legendary") {
      restriction.legendary = true;
    } else if (word === "monocolored") {
      // Monocolour is not a filter this engine can express; refuse rather
      // than compile a restriction that would admit anything.
      return null;
    } else if (SEARCH_CARD_TYPES.has(word)) {
      restriction.types = [...(restriction.types ?? []), word];
    } else if (/^[a-z][a-z-]*$/.test(word)) {
      // A creature subtype ("Dragon", "Angel", "Eldrazi"), lower-cased by
      // the caller. Only one is supported; "Aura and/or Equipment" is not.
      if (restriction.subtype) {
        return null;
      }
      restriction.subtype = word;
    } else {
      return null;
    }
  }
  if (Object.keys(restriction).length === 0) {
    return null;
  }
  return restriction;
}

/** "…for each <noun> you control" — the nouns a live count can scale by. */
/**
 * The thing a "for each …" / "equal to the number of …" clause counts. One
 * table, shared by star P/T, self-buffs, and count-scaled draws and lifegain,
 * so a new count is a row rather than a branch.
 */
const DYNAMIC_COUNTS: [RegExp, DynamicCount][] = [
  [/^lands? you control$/i, "lands_you_control"],
  [/^creatures? you control$/i, "creatures_you_control"],
  [/^artifacts? you control$/i, "artifacts_you_control"],
  [/^enchantments? you control$/i, "enchantments_you_control"],
  [
    /^artifacts? and(?:\/or)? enchantments? you control$/i,
    "artifacts_and_enchantments_you_control",
  ],
  [/^cards? in your hand$/i, "cards_in_your_hand"],
  [/^cards? in your graveyard$/i, "cards_in_your_graveyard"],
  [/^creature cards? in your graveyard$/i, "creature_cards_in_your_graveyard"],
  [/^colors? among permanents you control$/i, "colors_among_permanents_you_control"],
  [/^colorless creatures? you control$/i, "colorless_creatures_you_control"],
  [
    /^creatures? you control with an? \+1\/\+1 counter on (?:it|them)$/i,
    "creatures_you_control_with_a_counter",
  ],
  [/^Auras? attached to it$/i, "auras_attached_to_it"],
  [/^Aura and Equipment attached to it$/i, "auras_and_equipment_attached_to_it"],
  [
    /^creatures? and(?:\/or)? enchantments? you control$/i,
    "creatures_and_enchantments_you_control",
  ],
  [
    /^Auras? you control that(?:'s| are) attached to a creature$/i,
    "auras_you_control_attached_to_a_creature",
  ],
  [/^legendary creatures? you control$/i, "legendary_creatures_you_control"],
  [/^attacking creatures? you control$/i, "attacking_creatures_you_control"],
  [/^permanents? you control$/i, "permanents_you_control"],
  [/^Plains you control$/i, "plains_you_control"],
  [/^Islands? you control$/i, "islands_you_control"],
  [/^Swamps? you control$/i, "swamps_you_control"],
  [/^Mountains? you control$/i, "mountains_you_control"],
  [/^Forests? you control$/i, "forests_you_control"],
  // "card you've drawn this turn" after "for each"; "cards you've drawn
  // this turn" after "the number of". Both spellings, one row.
  [new RegExp("^cards? you" + "['’]" + "ve drawn this turn$", "i"), "cards_drawn_this_turn"],
  // Coat of Arms and Shared Animosity. "Other" is not optional: a creature
  // shares a type with itself, and counting itself would give every lone
  // Goblin a free +1/+1.
  [
    /^other creatures? on the battlefield that shares? at least one creature type with it$/i,
    "creatures_sharing_a_type_with_it",
  ],
  [
    /^other attacking creatures? that shares? a creature type with it$/i,
    "attacking_creatures_sharing_a_type_with_it",
  ],
];

/**
 * Singular or plural, "for each X" and "the number of X" say the same thing —
 * the printed text uses the singular after "for each" and the plural after
 * "the number of", so every row admits both.
 */
function parseDynamicCount(phrase: string): DynamicCount | null {
  const trimmed = phrase.trim();
  return DYNAMIC_COUNTS.find(([pattern]) => pattern.test(trimmed))?.[1] ?? null;
}

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
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  twenty: 20,
  thirty: 30,
  forty: 40,
};

export function stripReminderText(oracleText: string): string {
  return oracleText.replace(/\([^)]*\)/g, " ");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Oracle spelling of a counter to the key the engine stores it under.
 * Shared rather than copied: it lived inline in two places, and a third
 * reader would have been a third chance to spell "p1p1" differently.
 */
function counterKeyOf(named: string): string {
  return named === "+1/+1" ? "p1p1" : named === "-1/-1" ? "m1m1" : named.toLowerCase();
}

function parseCount(raw: string): number | null {
  const text = raw.trim().toLowerCase();
  if (/^\d+$/.test(text)) {
    const amount = Number(text);
    return amount > 0 ? amount : null;
  }
  return COUNT_WORDS[text] ?? null;
}

/**
 * Ability words (CR 207.2c) — italic flavour with no rules meaning. Every one
 * of these is followed by text that states the condition in full, so removing
 * the word loses nothing. Deliberately a list and not a shape: boast, channel,
 * imprint and strive also print before an em dash and DO carry rules.
 */
const ABILITY_WORDS = new RegExp(
  "(^|\\n)(?:" +
    [
      "Adamant",
      "Addendum",
      "Alliance",
      "Battalion",
      "Celebration",
      "Constellation",
      "Converge",
      "Corrupted",
      "Coven",
      "Delirium",
      "Descend",
      "Domain",
      "Eminence",
      "Enrage",
      "Fateful hour",
      "Ferocious",
      "Flurry",
      "Formidable",
      "Grandeur",
      "Hellbent",
      "Heroic",
      "Inspired",
      "Kinship",
      "Landfall",
      "Lieutenant",
      "Magecraft",
      "Metalcraft",
      "Morbid",
      "Pack tactics",
      "Parade",
      "Radiance",
      "Raid",
      "Rally",
      "Revolt",
      "Spell mastery",
      "Survival",
      "Sweep",
      "Threshold",
      "Undergrowth",
      "Valiant",
    ].join("|") +
    ")\\s*[—-]\\s*",
  "gi",
);

/**
 * Stands in for a period inside a quoted granted ability while the sentence
 * splitter runs, then is restored afterwards. No oracle text contains it.
 *
 * Spelled as an escape rather than embedded as a raw byte: an invisible
 * character in source cannot be reviewed in a diff and survives the edits
 * meant to remove it. engine/src/sourceHygiene.test.ts enforces that
 * repo-wide, for the same reason.
 */
const PERIOD_SHIELD = "\u0001";

function normalizeOracleText(card: OracleCard): string {
  const printedName = card.name.includes(" // ") ? (card.name.split(" // ")[0] ?? card.name) : card.name;
  let text = stripReminderText(card.oracleText).replace(/\r/g, "");
  text = text.replace(new RegExp(escapeRegex(printedName), "gi"), "~");
  // Legends refer to themselves by their short name. That is the part before
  // a comma ("Atsushi, the Blazing Sky" → "Atsushi"), and for the comma-less
  // "X of the Y" / "X the Y" patterns it is the leading word or words
  // ("Loran of the Third Path" → "Loran"). Only these two shapes are
  // shortened: a bare multi-word name like "Lightning Greaves" has no short
  // form, and treating its first word as one would rewrite unrelated text.
  const shortNames = [printedName.split(",")[0]?.trim()];
  const ofThe = printedName.match(/^(.+?) (?:of|the) \b/);
  if (ofThe?.[1]) {
    shortNames.push(ofThe[1].trim());
  }
  for (const shortName of shortNames) {
    if (shortName && shortName !== printedName) {
      text = text.replace(new RegExp(`\\b${escapeRegex(shortName)}\\b`, "gi"), "~");
    }
  }
  text = text.replace(
    /\bthis (?:creature|artifact|enchantment|land|permanent|planeswalker|Aura|Equipment|Class)\b/gi,
    "~",
  );
  text = text.replace(/\benters the battlefield\b/gi, "enters");
  // CR 207.2c: an ability word is italic flavour with no rules meaning, and
  // the condition it names is spelled out in the text that follows. Stripped
  // from an explicit list rather than by shape, because several italicised
  // words before an em dash are NOT ability words — boast, channel, imprint
  // and strive carry real rules, and eating them would widen the ability.
  text = text.replace(ABILITY_WORDS, "$1");
  // CR 700.4: for the card itself these are the same event, and "dies" is the
  // shape every trigger head here already reads (Rancor, Ichor Wellspring).
  text = text.replace(/~ is put into a graveyard from the battlefield\b/gi, "~ dies");
  text = text.replace(
    /\benters or is put into a graveyard from the battlefield\b/gi,
    "enters or dies",
  );
  // Periods inside quoted granted abilities ('… have "{T}: Add {C}."') must
  // not split the sentence; shield them, split, then restore.
  text = text.replace(/"[^"]*"/g, (quoted) => quoted.replace(/\./g, PERIOD_SHIELD));
  // A quote INSIDE a quote uses single marks — Urza's Saga's Construct
  // token carries its own '…gets +1/+1 for each artifact you control.'
  // Only a span that looks like a whole quoted ability is shielded, so an
  // ordinary apostrophe ("its controller's") is left alone.
  text = text.replace(/'[A-Z~][^']*\.'/g, (quoted) => quoted.replace(/\./g, PERIOD_SHIELD));
  return text;
}

function restoreSentence(part: string): string {
  return part.split(PERIOD_SHIELD).join(".").replace(/\s+/g, " ").trim();
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
/**
 * A printed keyword line ("Flying, first strike"), which is skipped whole
 * because the keywords already arrive on `printedKeywords`.
 *
 * A protection conjunct may sit in the same list (Stonecoil Serpent's
 * "Reach, trample, protection from multicolored"), and it is NOT a printed
 * keyword — it carries a quality, so it comes back here to be stored.
 * Returns null when any conjunct is neither, which keeps the line a miss.
 */
function readKeywordLine(sentence: string): { protection: ProtectionFrom | null } | null {
  // Case is preserved for the protection parts: "from Humans" is a subtype
  // and "from creatures" is a card type, told apart by capitalisation alone.
  const parts = sentence
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return null;
  }
  let protection: ProtectionFrom | null = null;
  for (const part of parts) {
    if (KEYWORD_LINE.has(part.toLowerCase())) {
      continue;
    }
    const from = /^protection from /i.test(part) ? parseProtectionPhrase(part) : null;
    if (!from) {
      return null;
    }
    protection = mergeProtection(protection ?? {}, from);
  }
  return { protection };
}

const SACRIFICE_COST = /Sacrifice (?:~|this land|this creature|this artifact|this permanent)/i;
/**
 * A sacrifice cost's scope, plus an optional count for the Dominus cycle's
 * "Sacrifice two other creatures". Group 1 is the count word when present.
 */
/**
 * Shared with COST_UNIT below rather than written out twice. The pair used
 * to be two copies, and copies drift: the reader grew a counted form the
 * SPLITTER refused, so the ability compiled to nothing at all. Anything
 * added here is added to both halves at once.
 *
 * LONGEST FIRST, and it matters twice over. Alternation is first-match, and
 * the splitter matches a cost up to a delimiter with no word boundary to
 * save it: a bare "artifacts" placed ahead of "artifacts and/or creatures"
 * swallows the head of the longer phrase and hands back the wrong scope,
 * and "Treasure" ahead of "Treasures" leaves an `s` where a comma was due.
 */
const SACRIFICE_COUNTS = "two|three|four|five|six|seven|eight|nine|ten|X|\\d+";
const SACRIFICE_SCOPES =
  "artifacts and\\/or creatures|nonland permanents|creature or artifact|artifact or creature|black creature|creatures|artifacts|Treasures|creature|artifact|Treasure|lands|land|token";
const SACRIFICE_TYPE_COST = new RegExp(
  `Sacrifice (?:an? |another |(${SACRIFICE_COUNTS}) (?:other )?)(${SACRIFICE_SCOPES})\\b`,
  "i",
);
/**
 * "Sacrifice a Goblin" / "Sacrifice a Desert" / "Sacrifice a Food" — the
 * fodder is named by a subtype and no card type appears, so the scope is
 * `permanent` and the subtype carries the whole filter. Case-sensitive on
 * purpose: the capital is what separates a subtype from "Sacrifice a token",
 * which this deliberately does not compile. Tried after SACRIFICE_TYPE_COST
 * so "Sacrifice a Treasure" keeps its dedicated scope.
 */
/** "Sacrifice a Food", and the counted plural "Sacrifice three Foods". */
const SACRIFICE_SUBTYPE_COST =
  /Sacrifice (?:an? |(one|two|three|four|five|\d+) )([A-Z][a-z]+?)s?\b/;
const LIFE_COST = /Pay (\d+) life/i;
/** Springleaf Drum, and Relic of Legends' legendary-only variant. */
const TAP_CREATURE_COST = /Tap an untapped (legendary )?creature you control/i;
/** Walking Ballista, Dragon's Hoard, Mikaeus: counters come off as a cost. */
const REMOVE_COUNTER_COST =
  /Remove (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) ([-+]\d\/[-+]\d|[a-z]+) counters? from ~/i;
/** Devoted Druid: a counter goes ON as a cost. */
const ADD_COUNTER_COST =
  /Put (a|an|one|two|three|\d+) ([-+]\d\/[-+]\d|[a-z]+) counters? on ~/i;
/** Fauna Shaman, Tortured Existence: discarding a chosen card is the cost. */
/**
 * "Discard a card" and its typed forms, plus Solphim's counted "Discard two
 * cards". The count and the type never appear together on a printed cost,
 * which is why one pattern reads both alternatives rather than composing them.
 *
 * The pieces are shared with COST_UNIT below rather than written twice: that
 * was a duplicate, and the two drifted apart the moment this grew a counted
 * form — the cost SPLITTER refused "Discard two cards" while the cost READER
 * accepted it, so the ability compiled to nothing at all.
 */
const DISCARD_COST_TYPES = "creature|artifact|enchantment|land|instant|sorcery";
const DISCARD_COST_COUNTS = "two|three|four|\\d+";
const DISCARD_TYPE_COST = new RegExp(
  `Discard (?:an? (${DISCARD_COST_TYPES})? ?card|(${DISCARD_COST_COUNTS}) cards)`,
  "i",
);
/** Millikin. */
const MILL_COST = /Mill (a|one|two|three|\d+) cards?/i;
/** Mines of Moria, Drivnod. */
const EXILE_GRAVEYARD_COST =
  /Exile (a|one|two|three|four|five|\d+) (?:(creature|artifact|land|instant|sorcery) )?cards? from your graveyard/i;
/** Lion's Eye Diamond: the whole hand, so there is nothing to choose. */
const DISCARD_HAND_COST = /Discard your hand/i;
const COST_UNIT =
  `(?:\\{[^}]+\\})+|Sacrifice (?:~|this land|this creature|this artifact|this permanent)|Sacrifice (?:an? |another |(?:${SACRIFICE_COUNTS}) (?:other )?)(?:${SACRIFICE_SCOPES})|Sacrifice (?:an? |(?:one|two|three|four|five|\\d+) )[A-Z][a-z]+s?|Discard your hand|Exile ~|Exert ~|Pay \\d+ life|Pay life equal to the number of colors in your commanders?['\u2019]? color identity|Tap an untapped (?:legendary )?creature you control|Remove (?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\\d+) (?:[-+]\\d\\/[-+]\\d|[a-z]+) counters? from ~|Put (?:a|an|one|two|three|\\d+) (?:[-+]\\d\\/[-+]\\d|[a-z]+) counters? on ~|Discard (?:an? (?:${DISCARD_COST_TYPES})? ?card|(?:${DISCARD_COST_COUNTS}) cards)|Mill (?:a|one|two|three|\\d+) cards?|Exile (?:a|one|two|three|four|five|\\d+) (?:(?:creature|artifact|land|instant|sorcery) )?cards? from your graveyard`;

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
  // Walking Ballista: in an activated ability's body "it" is the source, so
  // the rest of the grammar can read it as ~. (In a trigger body "it" is the
  // watched object instead, which is why this rewrite lives here and not in
  // normalizeOracleText.)
  return { costText: match[1], rest: match[2].trim().replace(/^It\s+/, "~ ") };
}

function parseAbilityCost(
  costText: string,
): {
  tap: boolean;
  manaCost: string;
  /** How many {X} pips the cost carries; 0 when it has none. */
  xCost: number;
  sacrificeSelf: boolean;
  lifeCost?: number;
  lifeCostFromCommanderColors?: boolean;
  sacrificeCost?:
    | "creature"
    | "another_creature"
    | "another_black_creature"
    | "artifact"
    | "creature_or_artifact"
    | "another_creature_or_artifact"
    | "land"
    | "treasure"
    | "permanent"
    | "nonland_permanent"
    | "token";
  sacrificeSubtype?: string;
  sacrificeCount?: number;
  sacrificeCountFromX?: boolean;
  discardHandCost?: boolean;
  tapCreature?: boolean;
  /** Relic of Legends: the tapped creature must be legendary. */
  tapCreatureLegendary?: boolean;
  /** Nyx Weaver: exiling the source pays for it. */
  exertSelf?: boolean;
  exileSelf?: boolean;
  removeCounterCost?: { counter: string; count: number };
  addCounterCost?: { counter: string; count: number };
  discardCost?: { count: number; types?: string[] };
  millCost?: number;
  exileFromGraveyardCost?: { count: number; types?: string[] };
} | null {
  // Nyx Weaver: exiling the source pays for it, the way sacrificing it does.
  const exileSelfCost = /(?:^|,\s*)Exile ~(?:,|$)/i.test(costText);
  const tapCreatureMatch = costText.match(TAP_CREATURE_COST);
  const tapCreature = tapCreatureMatch !== null;
  const tapCreatureLegendary = Boolean(tapCreatureMatch?.[1]);
  const sacrificeSelf = SACRIFICE_COST.test(costText);
  const sacrificeTypeMatch = SACRIFICE_COST.test(costText)
    ? null
    : costText.match(SACRIFICE_TYPE_COST);
  const another = /Sacrifice (?:another |(?:two|three) other )/i.test(costText);
  // "Sacrifice X Treasures": the count is announced, not printed, so it
  // becomes a flag rather than a number.
  const sacrificeCountFromX = /^x$/i.test(sacrificeTypeMatch?.[1] ?? "");
  const sacrificeCount =
    sacrificeTypeMatch?.[1] && !sacrificeCountFromX
      ? parseCount(sacrificeTypeMatch[1].toLowerCase())
      : undefined;
  // "artifacts and/or creatures" and the bare plural are the counted forms;
  // they map onto the same scopes as their singulars.
  const scopeWord = sacrificeTypeMatch?.[2]
    ?.toLowerCase()
    .replace(/^artifacts and\/or creatures$/, "creature_or_artifact")
    .replace(/^(?:creature or artifact|artifact or creature)$/, "creature_or_artifact")
    // The counted forms are printed plural; the scopes are singular. Only
    // "creatures" was folded before, so "Sacrifice two artifacts" carried a
    // scope name no fodder matcher would ever match.
    .replace(/^(creature|artifact|land|treasure)s$/, "$1")
    // Bolas's Citadel: "ten nonland permanents".
    .replace(/^nonland permanents$/, "nonland_permanent");
  // Only consulted when no card-type scope was found, so "a Treasure" and
  // "another black creature" keep the scopes they already had.
  const subtypeMatch =
    sacrificeSelf || scopeWord ? null : costText.match(SACRIFICE_SUBTYPE_COST);
  const sacrificeSubtype = subtypeMatch?.[2]?.toLowerCase();
  // "Sacrifice three Foods": the count rides alongside the subtype, the same
  // way it does for a card-type scope.
  const subtypeCount = subtypeMatch?.[1] ? parseCount(subtypeMatch[1].toLowerCase()) : undefined;
  const sacrificeCost = sacrificeSubtype
    ? ("permanent" as const)
    : scopeWord
    ? scopeWord === "black creature"
      ? another
        ? ("another_black_creature" as const)
        : null
      : another && (scopeWord === "creature" || scopeWord === "creature_or_artifact")
        ? scopeWord === "creature"
          ? ("another_creature" as const)
          : ("another_creature_or_artifact" as const)
        : (scopeWord as
            | "creature"
            | "artifact"
            | "land"
            | "treasure"
            | "token"
            | "nonland_permanent")
    : undefined;
  if (sacrificeCost === null) {
    return null;
  }
  // COST_UNIT matches case-insensitively, so "Sacrifice a token:" splits off a
  // cost none of the branches above understand. Refuse rather than compile an
  // ability whose sacrifice quietly costs nothing.
  if (/\bSacrifice\b/i.test(costText) && !sacrificeSelf && !sacrificeCost) {
    return null;
  }
  // Exert (CR 701.39): the permanent taps and then skips its controller's
  // next untap step.
  const exertSelf = /\bExert ~/i.test(costText) || undefined;
  const lifeMatch = costText.match(LIFE_COST);
  const lifeCost = lifeMatch?.[1] ? Number(lifeMatch[1]) : undefined;
  // War Room: the life is a LIVE count, not a number, so it cannot ride
  // `lifeCost` — a fixed reading would charge 0 in a colourless deck and
  // never change when the commander did.
  const lifeCostFromCommanderColors =
    /\bPay life equal to the number of colors in your commanders?['\u2019]? color identity\b/i.test(
      costText,
    ) || undefined;

  // Costs paid with something other than mana, life or a permanent: counters
  // on or off the source, a card out of hand, library or graveyard. Each is
  // read the same way — a count word and an optional filter.
  const counterName = counterKeyOf;
  const removeMatch = costText.match(REMOVE_COUNTER_COST);
  const removeCount = removeMatch?.[1] ? parseCount(removeMatch[1].toLowerCase()) : undefined;
  const removeCounterCost =
    removeMatch?.[2] && removeCount
      ? { counter: counterName(removeMatch[2]), count: removeCount }
      : undefined;
  const addMatch = costText.match(ADD_COUNTER_COST);
  const addCount = addMatch?.[1] ? parseCount(addMatch[1].toLowerCase()) : undefined;
  const addCounterCost =
    addMatch?.[2] && addCount
      ? { counter: counterName(addMatch[2]), count: addCount }
      : undefined;
  const discardMatch = costText.match(DISCARD_TYPE_COST);
  const discardCost = discardMatch
    ? {
        count: discardMatch[2] ? parseCount(discardMatch[2].toLowerCase()) ?? 1 : 1,
        ...(discardMatch[1] ? { types: [discardMatch[1].toLowerCase()] } : {}),
      }
    : undefined;
  // Lion's Eye Diamond: the whole hand, so it names no count and no type.
  const discardHandCost = DISCARD_HAND_COST.test(costText);
  const millMatch = costText.match(MILL_COST);
  const millCost = millMatch?.[1] ? parseCount(millMatch[1].toLowerCase()) ?? undefined : undefined;
  const exileMatch = costText.match(EXILE_GRAVEYARD_COST);
  const exileCount = exileMatch?.[1] ? parseCount(exileMatch[1].toLowerCase()) : undefined;
  const exileFromGraveyardCost = exileCount
    ? { count: exileCount, ...(exileMatch?.[2] ? { types: [exileMatch[2].toLowerCase()] } : {}) }
    : undefined;

  const symbols = [...costText.matchAll(/\{([^}]+)\}/g)].map((match) => match[1] ?? "");
  if (
    symbols.length === 0 &&
    !sacrificeSelf &&
    !exertSelf &&
    !lifeCost &&
    !lifeCostFromCommanderColors &&
    !sacrificeCost &&
    !tapCreature &&
    !removeCounterCost &&
    !addCounterCost &&
    !discardCost &&
    !discardHandCost &&
    millCost === undefined &&
    !exileFromGraveyardCost
  ) {
    return null;
  }
  // Same guard as the sacrifice one above: COST_UNIT is case-insensitive and
  // admits shapes these branches may not read, and a cost that quietly costs
  // nothing is worse than a clean miss.
  if (/\bRemove\b/i.test(costText) && !removeCounterCost) {
    return null;
  }
  if (/\bDiscard\b/i.test(costText) && !discardCost && !discardHandCost) {
    return null;
  }
  if (/\bMill\b/i.test(costText) && millCost === undefined) {
    return null;
  }
  let tap = false;
  let xCost = 0;
  const mana: string[] = [];
  for (const symbol of symbols) {
    if (symbol === "T") {
      tap = true;
      continue;
    }
    // {X} is announced when the ability is activated, the same way a spell's
    // is; "{X}{X}" charges it twice. {Q} (untap) is still unsupported.
    // Phyrexian pips are fine — parseManaCost reads them and the payment path
    // already charges 2 life when the colour is not available.
    if (symbol === "X") {
      xCost += 1;
      continue;
    }
    if (symbol === "Q") {
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
    xCost,
    sacrificeSelf,
    ...(exertSelf ? { exertSelf: true } : {}),
    ...(lifeCost ? { lifeCost } : {}),
    ...(lifeCostFromCommanderColors ? { lifeCostFromCommanderColors: true } : {}),
    ...(sacrificeCost ? { sacrificeCost } : {}),
    ...(sacrificeSubtype ? { sacrificeSubtype } : {}),
    ...((sacrificeCount ?? subtypeCount) && (sacrificeCount ?? subtypeCount)! > 1
      ? { sacrificeCount: (sacrificeCount ?? subtypeCount)! }
      : {}),
    ...(sacrificeCountFromX ? { sacrificeCountFromX: true } : {}),
    ...(discardHandCost ? { discardHandCost: true } : {}),
    ...(tapCreature ? { tapCreature: true } : {}),
    ...(tapCreatureLegendary ? { tapCreatureLegendary: true } : {}),
    ...(exileSelfCost ? { exileSelf: true } : {}),
    ...(removeCounterCost ? { removeCounterCost } : {}),
    ...(addCounterCost ? { addCounterCost } : {}),
    ...(discardCost ? { discardCost } : {}),
    ...(millCost !== undefined ? { millCost } : {}),
    ...(exileFromGraveyardCost ? { exileFromGraveyardCost } : {}),
  };
}

/**
 * Fiery Emancipation, Torbran, Gratuitous Violence, Twinflame Tyrant:
 * "If a \<source\> you control would deal damage to \<target\>, it deals
 * \<modified\> damage instead." One shape covers the four because the source
 * clause, the target clause and the modification are each independent.
 */
function parseDamageReplacement(sentence: string): DamageReplacement | null {
  const match = sentence.match(
    /^If an? (red |white |blue |black |green )?(source|creature) you control would deal (noncombat )?damage to (a permanent or player|an opponent or a permanent an opponent controls), it deals (?:(double|triple) that damage|that much damage plus (\d+))(?: to that (?:permanent or player|player or permanent))? instead$/i,
  );
  if (!match?.[2] || !match[4] || (!match[5] && !match[6])) {
    return null;
  }
  const color = match[1]?.trim().toLowerCase();
  const plus = match[6] ? Number(match[6]) : undefined;
  return {
    ...(plus === undefined
      ? { times: /^triple$/i.test(match[5] ?? "") ? 3 : 2 }
      : { plus }),
    ...(color ? { sourceColors: [COLOR_WORDS[color]!] } : {}),
    ...(/^creature$/i.test(match[2]) ? { sourceMustBeCreature: true } : {}),
    // Solphim: combat damage is exempt, which is most of what stops the
    // card from simply doubling every attack.
    ...(match[3] ? { noncombatOnly: true } : {}),
    ...(/opponent/i.test(match[4]) ? { opponentsOnly: true } : {}),
  };
}

/**
 * The colour word in "target \<colour\> spell" / "…permanent". A named colour
 * becomes a required colour; "multicolored" is a count of them instead, which
 * is why the two cannot share one field.
 */
function colorQualifierOf(word: string): Partial<TargetRequirement> {
  return /^multicolored$/i.test(word)
    ? { multicolored: true }
    : { requiredColors: [COLOR_WORDS[word.toLowerCase()]!] };
}

/** Head nouns a plain "target …" phrase can name, longest first so
 * "artifact or creature" wins over "artifact". */
const TARGET_HEAD_NOUNS: [RegExp, TargetKind][] = [
  [/^artifact or creature$/i, "creature_or_artifact"],
  [/^creature or artifact$/i, "creature_or_artifact"],
  [/^creature or enchantment$/i, "creature_or_enchantment"],
  [/^creature, enchantment, or planeswalker$/i, "creature_enchantment_or_planeswalker"],
  [/^creature or planeswalker$/i, "creature_or_planeswalker"],
  [/^artifact or enchantment$/i, "artifact_or_enchantment"],
  [/^artifact, enchantment, or land$/i, "artifact_enchantment_or_land"],
  [
    /^artifact, creature, enchantment, or land$/i,
    "artifact_creature_enchantment_or_land",
  ],
  [/^artifact, enchantment, or planeswalker$/i, "artifact_enchantment_or_planeswalker"],
  [/^noncreature, nonland permanent$/i, "noncreature_nonland_permanent"],
  [/^nonland permanent$/i, "nonland_permanent"],
  [/^permanent$/i, "permanent"],
  [/^creature$/i, "creature"],
  [/^artifact$/i, "artifact"],
  [/^enchantment$/i, "enchantment"],
  [/^land$/i, "land"],
  [/^planeswalker$/i, "planeswalker"],
];

/**
 * "another target permanent you control", "up to one target artifact or
 * creature you control", "target non-Angel creature you control" — the plain
 * targeting noun phrase, as a grammar rather than one branch per wording.
 * Anything it does not recognise returns null, so an unparsed qualifier is a
 * clean miss instead of a silently widened target.
 */
function parseSimpleTargetPhrase(phrase: string): TargetRequirement | null {
  let rest = phrase.trim();
  const requirement: Partial<TargetRequirement> = {};

  const optional = rest.match(/^up to one\s+(.*)$/i);
  if (optional?.[1]) {
    requirement.optional = true;
    rest = optional[1];
  }
  // "another target …", and the bare "other" that "up to one other target …"
  // leaves behind (Thassa).
  const another = rest.match(/^(?:an)?other\s+(.*)$/i);
  if (another?.[1]) {
    requirement.excludeSource = true;
    rest = another[1];
  }
  // The same exclusion written after the noun: "target creature you control
  // other than ~" (Rosie Cotton). One flag, two places it can be spelled.
  const otherThan = rest.match(/^(.*?)\s+other than ~$/i);
  if (otherThan?.[1]) {
    requirement.excludeSource = true;
    rest = otherThan[1];
  }
  const target = rest.match(/^target\s+(.*)$/i);
  if (!target?.[1]) {
    return null;
  }
  rest = target[1];

  // Trailing qualifiers, outermost first — the same shape parseSweepPhrase
  // uses, so a new trailing wording is a loop arm rather than a branch.
  for (;;) {
    // "with mana value 1 or less" (Archmage's Charm), "…or greater" (Despark).
    const manaValue = rest.match(/^(.*?)\s+with mana value (\d+) or (less|greater)$/i);
    if (manaValue?.[1] && manaValue[2] && manaValue[3]) {
      if (/^less$/i.test(manaValue[3])) {
        requirement.maxManaValue = Number(manaValue[2]);
      } else {
        requirement.minManaValue = Number(manaValue[2]);
      }
      rest = manaValue[1];
      continue;
    }
    // "with power 4 or greater" (Herd Heirloom), "…or less" (Escape Tunnel).
    const power = rest.match(/^(.*?)\s+with power (\d+) or (less|greater)$/i);
    if (power?.[1] && power[2] && power[3]) {
      if (/^less$/i.test(power[3])) {
        requirement.maxPower = Number(power[2]);
      } else {
        requirement.minPower = Number(power[2]);
      }
      rest = power[1];
      continue;
    }
    const controlled = rest.match(/^(.*?)\s+you control$/i);
    if (controlled?.[1]) {
      requirement.control = "own";
      rest = controlled[1];
      continue;
    }
    // "an opponent controls" names the same set as "you don't control": every
    // permanent the caster does not control is controlled by an opponent.
    const notControlled = rest.match(/^(.*?)\s+(?:you don't control|an opponent controls)$/i);
    if (notControlled?.[1]) {
      requirement.control = "not_own";
      rest = notControlled[1];
      continue;
    }
    break;
  }

  // "target legendary permanent" (Minamo), "target nonbasic land" (Wasteland).
  const legendary = rest.match(/^legendary\s+(.*)$/i);
  if (legendary?.[1]) {
    requirement.legendaryOnly = true;
    rest = legendary[1];
  }
  const nonbasic = rest.match(/^nonbasic\s+(.*)$/i);
  if (nonbasic?.[1]) {
    requirement.nonbasicOnly = true;
    rest = nonbasic[1];
  }
  // "target attacking or blocking creature" (Razorgrass Ambush). Read
  // BEFORE the bare "attacking" below, which would otherwise take the word
  // and leave "or blocking creature" as the noun.
  const attackingOrBlocking = rest.match(/^attacking or blocking\s+(.*)$/i);
  if (attackingOrBlocking?.[1]) {
    requirement.attackingOrBlockingOnly = true;
    rest = attackingOrBlocking[1];
  }
  // "target attacking creature" (Maze of Ith, Duelist's Heritage).
  const attacking = rest.match(/^attacking\s+(.*)$/i);
  if (attacking?.[1]) {
    requirement.attackingOnly = true;
    rest = attacking[1];
  }
  // "target multicolored permanent" (Null Elemental Blast). "Monocolored" is
  // deliberately absent: exactly-one-color has no filter to carry it.
  const multicolored = rest.match(/^multicolored\s+(.*)$/i);
  if (multicolored?.[1]) {
    requirement.multicolored = true;
    rest = multicolored[1];
  }

  // "noncreature artifact or noncreature enchantment" (Haywire Mite): the
  // adjective repeats on each half, so it is lifted off both before the head
  // noun is read as the plain two-type union it is.
  // "nonland" is deliberately absent: "nonland permanent" is its own head
  // noun already, and claiming it here would rewrite a shape that works.
  const excludedType = rest.match(/^non(creature|artifact|enchantment)\s+(.*)$/i);
  if (excludedType?.[1] && excludedType[2]) {
    const bare = excludedType[1].toLowerCase();
    requirement.excludedTypes = [bare];
    // The adjective repeats on the second half ("noncreature artifact or
    // noncreature enchantment"); lift it off there too so the head noun sees
    // the plain two-type union it already knows.
    rest = excludedType[2].replace(new RegExp(`\\bnon${bare}\\s+`, "gi"), "");
  }

  // "non-Angel creature": a subtype the target may not have.
  const excluded = rest.match(/^non-([A-Za-z]+)\s+(.*)$/i);
  if (excluded?.[1] && excluded[2]) {
    requirement.excludedSubtypes = [excluded[1].toLowerCase()];
    rest = excluded[2];
  }

  const head = TARGET_HEAD_NOUNS.find(([pattern]) => pattern.test(rest.trim()));
  return head ? { ...requirement, kind: head[1] } : null;
}

/**
 * "You may \<cost\> rather than pay this spell's mana cost" — the Force of
 * Will / Flare cycle, Snuff Out, Misdirection. The cost halves ("pay N life",
 * "exile a blue card from your hand", "sacrifice a nontoken red creature")
 * join with "and", so the grammar reads them one at a time and refuses the
 * whole sentence if any half is unrecognised.
 */
function parseAlternativeCastCost(sentence: string): AlternativeCastCost | null {
  // Force of Negation: the whole clause is gated on it not being your
  // turn. Peeled first so the rest reads as the ordinary alternative-cost
  // grammar, and only when what follows parses on its own.
  const notYourTurn = sentence.match(/^If it['\u2019]s not your turn, (.+)$/i);
  if (notYourTurn?.[1]) {
    const inner = parseAlternativeCastCost(notYourTurn[1].trim());
    return inner ? { ...inner, onlyOnOpponentsTurn: true } : null;
  }
  // Mindbreak Trap, and the rest of the trap cycle: a free cast gated on
  // what an OPPONENT did this turn.
  const trap = sentence.match(
    /^If an opponent cast ([a-z]+) or more spells this turn, you may pay \{0\} rather than pay this spell's mana cost$/i,
  );
  if (trap?.[1]) {
    const threshold = parseCount(trap[1]);
    return threshold ? { opponentSpellsThisTurn: threshold } : null;
  }
  const match = sentence.match(
    /^(?:If you control an? ([A-Z][a-z]+), )?you may (.+) rather than pay this spell's mana cost$/i,
  );
  if (!match?.[2]) {
    return null;
  }
  const cost: AlternativeCastCost = {};
  if (match[1]) {
    cost.requires = { subtypes: [match[1].toLowerCase()] };
  }
  for (const half of match[2].split(/\s+and\s+/i)) {
    const life = half.match(/^pay (\d+) life$/i);
    if (life?.[1]) {
      cost.life = Number(life[1]);
      continue;
    }
    const exile = half.match(
      /^exile an? (white|blue|black|red|green)? ?card from your hand$/i,
    );
    if (exile) {
      cost.exileFromHand = {
        count: 1,
        ...(exile[1] ? { colors: [COLOR_WORDS[exile[1].toLowerCase()]!] } : {}),
      };
      continue;
    }
    const sacrifice = half.match(
      /^sacrifice a (nontoken )?(white|blue|black|red|green)? ?creature$/i,
    );
    if (sacrifice) {
      cost.sacrificeCreature = {
        ...(sacrifice[1] ? { nontoken: true } : {}),
        ...(sacrifice[2] ? { colors: [COLOR_WORDS[sacrifice[2].toLowerCase()]!] } : {}),
      };
      continue;
    }
    return null;
  }
  return Object.keys(cost).length > 0 ? cost : null;
}

/**
 * One half of a mana-upgrade condition: "an Urza's Mine" (a permanent with
 * both land types), "a creature with power 4 or greater". Null for anything
 * else, which keeps the whole rider a clean miss.
 */
function parseManaUpgradeGate(phrase: string): ControlledGate | null {
  const power = phrase.match(/^an? creature with power (\d+) or greater$/i);
  if (power?.[1]) {
    return { types: ["creature"], minPower: Number(power[1]) };
  }
  // "an Urza's Power-Plant" — the capitalised words are all land types, and
  // one permanent must carry every one of them. Split on whitespace only, the
  // way parseTypeLine splits a printed subtype list, so "Power-Plant" stays
  // the single subtype it is on the card.
  const named = phrase.match(/^an? ([A-Z][\w'-]*(?: [A-Z][\w'-]*)*)$/);
  if (named?.[1]) {
    return {
      subtypes: named[1]
        .split(/\s+/)
        .map((word) => word.toLowerCase())
        .filter(Boolean),
    };
  }
  return null;
}

/**
 * The counter half of a placement clause: "a +1/+1", "two -1/-1", or a list
 * like "a +1/+1 counter, a reach counter, and a deathtouch" (the trailing
 * "counter(s)" is consumed by the caller). Null for anything unrecognised, so
 * an unreadable counter name never lands as a silent no-op.
 */
function parseCounterList(phrase: string): { counter: string; amount: number }[] | null {
  const entries: { counter: string; amount: number }[] = [];
  for (const part of phrase.split(/,\s*(?:and\s+)?|\s+and\s+/)) {
    const trimmed = part.replace(/\s+counters?$/i, "").trim();
    if (!trimmed) {
      continue;
    }
    const match = trimmed.match(
      /^(a|an|one|two|three|four|five|X|\d+) ([+-]\d\/[+-]\d|[a-z]+)$/i,
    );
    if (!match?.[1] || !match[2]) {
      return null;
    }
    const amount = /^X$/i.test(match[1]) ? null : parseCount(match[1].toLowerCase());
    if (!amount) {
      return null;
    }
    const named = match[2];
    entries.push({ counter: counterKeyOf(named), amount });
  }
  return entries.length > 0 ? entries : null;
}

/** "{C}{C}{C}" → a mana pool. Null if any symbol is not a plain colour. */
function parseManaSymbols(text: string): Partial<ManaPool> | null {
  const pool: Partial<ManaPool> = {};
  for (const symbol of text.matchAll(/\{([^}]+)\}/g)) {
    const color = symbol[1]!.toUpperCase();
    if (!["W", "U", "B", "R", "G", "C"].includes(color)) {
      return null;
    }
    pool[color as ManaColor] = (pool[color as ManaColor] ?? 0) + 1;
  }
  return Object.keys(pool).length > 0 ? pool : null;
}

/** Plural head nouns a sweep can name, and the scope each maps to. */
const SWEEP_HEAD_NOUNS: [RegExp, DestroyAllScope][] = [
  [/^nonland permanents$/i, "nonland"],
  [/^permanents$/i, "nonland"],
  [/^creatures$/i, "creatures"],
  [/^artifacts$/i, "artifacts"],
  [/^enchantments$/i, "enchantments"],
  [/^planeswalkers$/i, "planeswalkers"],
];

/** Type lists a sweep can name, in printed order. */
const SWEEP_TYPE_LISTS: [RegExp, string[]][] = [
  [/^artifacts, creatures, and enchantments$/i, ["artifact", "creature", "enchantment"]],
  [/^artifacts and enchantments$/i, ["artifact", "enchantment"]],
  [/^creatures and planeswalkers$/i, ["creature", "planeswalker"]],
];

type SweepFilters = Extract<CardEffect, { kind: "destroy_all" }>;

/**
 * The sweep noun phrase — "all tapped creatures", "all creatures with no
 * counters on them", "all nonland permanents that aren't legendary", "all
 * creatures you don't control". Qualifiers are read one at a time from both
 * ends, so a new wording is a qualifier rather than a branch. Anything left
 * over returns null and the sentence stays a clean miss.
 */
function parseSweepPhrase(phrase: string): Omit<SweepFilters, "kind"> | null {
  let rest = phrase.trim();
  const filters: Partial<SweepFilters> = {};

  // Trailing qualifiers, outermost first.
  for (;;) {
    const possessor = rest.match(/^(.*?)\s+(?:you don't control|your opponents control)$/i);
    if (possessor?.[1]) {
      filters.opponentsOnly = true;
      rest = possessor[1];
      continue;
    }
    const counters = rest.match(/^(.*?)\s+with no counters on them$/i);
    if (counters?.[1]) {
      filters.withoutCounters = true;
      rest = counters[1];
      continue;
    }
    const enchanted = rest.match(/^(.*?)\s+that aren't enchanted$/i);
    if (enchanted?.[1]) {
      filters.notEnchanted = true;
      rest = enchanted[1];
      continue;
    }
    const legendary = rest.match(/^(.*?)\s+that aren't legendary$/i);
    if (legendary?.[1]) {
      filters.notLegendary = true;
      rest = legendary[1];
      continue;
    }
    const abovePower = rest.match(/^(.*?)\s+with power greater than target creature's power$/i);
    if (abovePower?.[1]) {
      filters.minPowerAboveTarget = 0;
      rest = abovePower[1];
      continue;
    }
    const power = rest.match(/^(.*?)\s+with power (\d+) or greater$/i);
    if (power?.[1] && power[2]) {
      filters.minPower = Number(power[2]);
      rest = power[1];
      continue;
    }
    const manaValue = rest.match(/^(.*?)\s+with mana value (\d+) or (less|greater)$/i);
    if (manaValue?.[1] && manaValue[2] && manaValue[3]) {
      if (/^less$/i.test(manaValue[3])) {
        filters.maxManaValue = Number(manaValue[2]);
      } else {
        filters.minManaValue = Number(manaValue[2]);
      }
      rest = manaValue[1];
      continue;
    }
    break;
  }

  // "all NONARTIFACT creatures" — a card type the swept permanent must not
  // have, read before the tap state so the adjectives can stack.
  // "nonland" is deliberately absent here too: the sweep head noun already
  // reads "nonland permanents", and claiming it here rewrites a working shape.
  const exceptType = rest.match(/^non(artifact|creature|enchantment)\s+(.*)$/i);
  if (exceptType?.[1] && exceptType[2]) {
    filters.exceptTypes = [exceptType[1].toLowerCase()];
    rest = exceptType[2];
  }

  // "all NONTOKEN creatures" — not a card type, so it reads separately from
  // the exceptTypes strip above.
  const nontoken = rest.match(/^nontoken\s+(.*)$/i);
  if (nontoken?.[1]) {
    filters.nontoken = true;
    rest = nontoken[1];
  }

  // Leading qualifiers.
  const tapState = rest.match(/^(tapped|untapped)\s+(.*)$/i);
  if (tapState?.[1] && tapState[2]) {
    filters.tapState = tapState[1].toLowerCase() as "tapped" | "untapped";
    rest = tapState[2];
  }

  const list = SWEEP_TYPE_LISTS.find(([pattern]) => pattern.test(rest.trim()));
  if (list) {
    return { what: "nonland", typesAny: list[1], ...filters };
  }
  const head = SWEEP_HEAD_NOUNS.find(([pattern]) => pattern.test(rest.trim()));
  return head ? { what: head[1], ...filters } : null;
}

/** Head nouns for a card in the caster's own graveyard. */
const GRAVEYARD_HEAD_NOUNS: [RegExp, TargetKind][] = [
  [/^creature card$/i, "own_graveyard_creature_card"],
  [/^permanent card$/i, "own_graveyard_permanent_card"],
  [/^artifact card$/i, "own_graveyard_artifact_card"],
  [/^enchantment card$/i, "own_graveyard_enchantment_card"],
  [/^land card$/i, "own_graveyard_land_card"],
  [/^instant or sorcery card$/i, "own_graveyard_instant_or_sorcery_card"],
  [
    /^creature or planeswalker card$/i,
    "own_graveyard_creature_or_planeswalker_card",
  ],
  [/^card$/i, "own_graveyard_card"],
];

/** Kinds whose cards are certainly permanents, so they may be returned to the
 * battlefield rather than only to hand. */
const BATTLEFIELD_RETURNABLE = new Set<TargetKind>([
  "own_graveyard_creature_card",
  "own_graveyard_permanent_card",
  "own_graveyard_artifact_card",
  "own_graveyard_land_card",
]);

/**
 * "target creature card with mana value 3 or less" (Unearth), "target
 * permanent card with mana value 3 or less" (Sun Titan), "target card"
 * (Noxious Revival) — the graveyard noun phrase as a grammar.
 */
function parseGraveyardTargetPhrase(phrase: string): TargetRequirement | null {
  let rest = phrase.trim();
  const requirement: Partial<TargetRequirement> = {};
  const manaValue = rest.match(/^(.*?)\s+with mana value (\d+) or less$/i);
  if (manaValue?.[1] && manaValue[2]) {
    requirement.maxManaValue = Number(manaValue[2]);
    rest = manaValue[1];
  }
  const nonlegendary = rest.match(/^nonlegendary\s+(.*)$/i);
  if (nonlegendary?.[1]) {
    requirement.nonlegendaryOnly = true;
    rest = nonlegendary[1];
  }
  /**
   * Haven of the Spirit Dragon: "Dragon creature card OR Ugin planeswalker
   * card". Both halves name a SUBTYPE, and a card carrying either subtype
   * is the card the phrase means — there is no Dragon planeswalker or Ugin
   * creature to tell them apart. So the two collapse to one any-of filter
   * over `card`, rather than a disjunction across two target kinds.
   */
  const subtypePair = rest
    .trim()
    .match(
      /^([A-Z][a-z]+) (?:creature|planeswalker) card(?: or ([A-Z][a-z]+) (?:creature|planeswalker) card)?$/,
    );
  if (subtypePair?.[1]) {
    const subtypes = [subtypePair[1], subtypePair[2]]
      .filter((subtype): subtype is string => Boolean(subtype))
      .map((subtype) => subtype.toLowerCase());
    return {
      ...requirement,
      kind: "own_graveyard_card",
      requiredSubtypesAny: subtypes,
    };
  }
  const head = GRAVEYARD_HEAD_NOUNS.find(([pattern]) => pattern.test(rest.trim()));
  return head ? { ...requirement, kind: head[1] } : null;
}

/**
 * "Exile that creature", "Return that card … to the battlefield" — a clause
 * whose subject is whatever an EARLIER clause targeted, rather than a target
 * of its own. Callers must only use this when the card has already declared a
 * target, because index 0 would otherwise bind to nobody and the effect would
 * quietly do nothing.
 */
function compileBackReferenceClause(sentence: string): CardEffect[] | null {
  const chosen = { type: "chosen", index: 0 } as const;
  const moved = sentence.match(/^(Exile|Destroy|Tap|Untap) (?:that (?:creature|card|permanent)|it)$/i);
  if (moved?.[1]) {
    const verb = moved[1].toLowerCase();
    if (verb === "tap") {
      return [{ kind: "tap", cardId: chosen }];
    }
    if (verb === "untap") {
      return [{ kind: "untap", cardId: chosen }];
    }
    return [
      { kind: "move_card", cardId: chosen, toZone: verb === "exile" ? "exile" : "graveyard" },
    ];
  }
  if (/^Return that card from your graveyard to the battlefield$/i.test(sentence)) {
    return [{ kind: "move_card", cardId: chosen, toZone: "battlefield" }];
  }
  // Slip Out the Back: the thing that phases out is what the clause
  // before it targeted.
  if (/^It phases out$/i.test(sentence)) {
    return [{ kind: "phase_out", cardIds: [chosen] }];
  }
  // "Put a +1/+1 counter on it" following a clause that targeted something.
  const counters = sentence.match(/^Put (.+?) counters? on (?:it|that creature)$/i);
  const placed = counters?.[1] ? parseCounterList(counters[1]) : null;
  if (placed) {
    return placed.map((entry) => ({
      kind: "add_counter",
      cardId: chosen,
      counter: entry.counter,
      amount: entry.amount,
    }));
  }
  // "It gains indestructible until end of turn" following a clause that
  // targeted something. The grant parser reads "It" as the TRIGGER's subject,
  // which is right in a trigger body and wrong here, so the referent is
  // rebound — and only when the grant chose no target of its own.
  if (/^(?:It|That creature) (?:gets|gains) /i.test(sentence)) {
    const grant = compileUntilEotGrant(sentence);
    if (grant && grant.targetRequirements.length === 0 && grant.effects.length > 0) {
      const rebound = grant.effects.map((effect) =>
        (effect.kind === "pt_until_eot" || effect.kind === "keyword_until_eot") &&
        effect.cardId === "subject_card"
          ? { ...effect, cardId: chosen }
          : effect,
      );
      // If nothing actually rebound, the clause was not about the referent.
      return rebound.some((effect, index) => effect !== grant.effects[index]) ? rebound : null;
    }
  }
  return null;
}

/**
 * The condition an ability-word rider or an activation gate tests. One
 * vocabulary for both, so a wording added for Threshold also serves
 * "Activate only if …". Anything unrecognised is null, which keeps the
 * clause a clean miss rather than an ungated effect.
 */
const SPENT_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
};

const SPENT_COLORS: Record<string, Color> = {
  white: "W",
  blue: "U",
  black: "B",
  red: "R",
  green: "G",
};

/**
 * "at least three white mana was spent" / "five or more mana was spent".
 * One reader for both, because adamant and Opus ask the same question and
 * only differ on whether a colour is named.
 */
function parseManaSpentGate(text: string): { atLeast: number; color?: Color } | null {
  const match = text.match(
    /^(?:at least|(\d+|one|two|three|four|five|six|seven|eight) or more) ?(\d+|one|two|three|four|five|six|seven|eight)? ?(white|blue|black|red|green)? mana was spent$/i,
  );
  if (!match) {
    return null;
  }
  const word = (match[1] ?? match[2] ?? "").toLowerCase();
  const atLeast = SPENT_WORDS[word] ?? Number(word);
  if (!Number.isFinite(atLeast) || atLeast <= 0) {
    return null;
  }
  const color = match[3] ? SPENT_COLORS[match[3].toLowerCase()] : undefined;
  return color ? { atLeast, color } : { atLeast };
}

function parseEffectCondition(phrase: string): TriggerCondition | null {
  const text = phrase.trim().replace(/^if\s+/i, "");
  const power = text.match(/^you control a creature with power (\d+) or greater$/i);
  if (power?.[1]) {
    return { kind: "controls_power_at_least", power: Number(power[1]) };
  }
  const count = text.match(
    /^you control (\w+) or more (artifacts|creatures|lands)$/i,
  );
  if (count?.[1] && count[2]) {
    const atLeast = parseCount(count[1]);
    if (atLeast) {
      return {
        kind: "controls_count",
        what: count[2].toLowerCase().replace(/s$/, "") as "land" | "creature" | "artifact",
        atLeast,
      };
    }
  }
  // Selvala: "its power is greater than each other creature's power" —
  // a strict maximum among every creature on the battlefield, so a tie
  // fails, which is the whole restriction on the card.
  if (
    /^its power is greater than each other creature['\u2019]s power$/i.test(text)
  ) {
    return { kind: "subject_power_greatest" };
  }
  // Field of the Dead: distinct NAMES, not a count of lands. Reading it
  // as "seven or more lands" would fire off seven copies of one Wastes.
  const differentNames = text.match(
    /^you control (\w+) or more lands with different names$/i,
  );
  if (differentNames?.[1]) {
    const atLeast = parseCount(differentNames[1]);
    if (atLeast) {
      return { kind: "controls_lands_with_different_names", atLeast };
    }
  }
  // Windbrisk Heights. The tally the attack step already keeps, summed
  // across combat phases — which is what the printed "this turn" asks.
  const attackedWith = text.match(
    /^you attacked with (\w+) or more creatures this turn$/i,
  );
  const attackerCount = attackedWith?.[1] ? parseCount(attackedWith[1]) : null;
  if (attackerCount) {
    return { kind: "attacked_with_creatures_this_turn", atLeast: attackerCount };
  }
  // Spinerock Knoll. DAMAGE, not life lost, and ANY ONE opponent has to
  // clear the bar — two opponents on four each is not seven to an opponent.
  const opponentDamaged = text.match(
    /^an opponent was dealt (\d+) or more damage this turn$/i,
  );
  if (opponentDamaged?.[1]) {
    return { kind: "opponent_damaged_this_turn", atLeast: Number(opponentDamaged[1]) };
  }
  // Shelldock Isle: "A library" is any library at the table, the
  // controller's own included, which is how the card is normally used.
  const smallLibrary = text.match(
    /^a library has (\w+) or fewer cards in it$/i,
  );
  const libraryCap = smallLibrary?.[1] ? parseCount(smallLibrary[1]) : null;
  if (libraryCap !== null) {
    return { kind: "library_at_most", count: libraryCap };
  }
  // Mosswort Bridge: "creatures you control have TOTAL power 10 or
  // greater" — the sum, not the greatest single power.
  const totalPower = text.match(
    /^creatures you control have total power (\d+) or greater$/i,
  );
  if (totalPower?.[1]) {
    return { kind: "controls_total_power_at_least", power: Number(totalPower[1]) };
  }
  // Lieutenant: "if you control your commander".
  if (/^you control your commander$/i.test(text)) {
    return { kind: "controls_commander" };
  }
  // Thopter Spy Network: the bare singular, with no count word at all.
  const controlsOne = text.match(/^you control an? (artifact|creature|land)$/i);
  if (controlsOne?.[1]) {
    return {
      kind: "controls_count",
      what: controlsOne[1].toLowerCase() as "land" | "creature" | "artifact",
      atLeast: 1,
    };
  }
  const tribe = text.match(/^you control (\w+) or more ([A-Z][a-z-]+)s$/);
  if (tribe?.[1] && tribe[2]) {
    const atLeast = parseCount(tribe[1]);
    if (atLeast) {
      return { kind: "controls_subtype_count", subtype: tribe[2].toLowerCase(), atLeast };
    }
  }
  const graveyard = text.match(/^there are (\w+) or more cards in your graveyard$/i);
  if (graveyard?.[1]) {
    const atLeast = parseCount(graveyard[1]);
    if (atLeast) {
      return { kind: "graveyard_cards_at_least", count: atLeast };
    }
  }
  const graveyardTypes = text.match(
    /^there are (\w+) or more card types among cards in your graveyard$/i,
  );
  if (graveyardTypes?.[1]) {
    const atLeast = parseCount(graveyardTypes[1]);
    if (atLeast) {
      return { kind: "graveyard_card_types_at_least", count: atLeast };
    }
  }
  const isSubtype = text.match(/^it's an? ([A-Z][a-z-]+)$/);
  if (isSubtype?.[1]) {
    return { kind: "chosen_has_subtype", subtype: isSubtype[1].toLowerCase() };
  }
  if (/^a creature died this turn$/i.test(text)) {
    return { kind: "creature_died_this_turn" };
  }
  // Mangara. Planeswalkers are not separate defenders in this engine — every
  // attack names a PLAYER — so "you and/or planeswalkers you control" is
  // exactly "you", and the two readings agree rather than approximate.
  const aimedAtYou = text.match(
    /^([\w-]+) or more of those creatures are attacking you(?: and\/or planeswalkers you control)?$/i,
  );
  const aimedCount = aimedAtYou?.[1] ? parseCount(aimedAtYou[1]) : null;
  if (aimedCount) {
    return { kind: "attackers_against_you_at_least", count: aimedCount };
  }
  if (/^you cast this spell during your main phase$/i.test(text)) {
    return { kind: "own_main_phase" };
  }
  if (/^you have (\d+) or more life$/i.test(text)) {
    return { kind: "life_at_least", amount: Number(text.match(/(\d+)/)![1]) };
  }
  if (/^you attacked this turn$/i.test(text)) {
    return { kind: "attacked_this_turn" };
  }
  if (/^your library has no cards in it$/i.test(text)) {
    return { kind: "library_empty" };
  }
  if (/^you cast it$/i.test(text)) {
    return { kind: "entered_from_cast" };
  }
  const drew = text.match(/^you've drawn more than (\w+) cards? this turn$/i);
  if (drew?.[1]) {
    const moreThan = parseCount(drew[1]);
    if (moreThan) {
      return { kind: "drew_cards_this_turn", moreThan };
    }
  }
  // "you gained life this turn" is the same question with a bar of one, so
  // both spellings read through one pattern rather than two conditions.
  const gainedLife = text.match(/^you gained (?:([\w-]+) or more )?life this turn$/i);
  if (gainedLife) {
    const atLeast = gainedLife[1] ? parseCount(gainedLife[1]) : 1;
    if (atLeast) {
      return { kind: "gained_life_this_turn", atLeast };
    }
  }
  // Bloodchief Ascension: the same question about somebody else, and ANY
  // one of them satisfies it.
  const opponentLostLife = text.match(
    /^an opponent lost (?:([\w-]+) or more )?life this turn$/i,
  );
  if (opponentLostLife) {
    const atLeast = opponentLostLife[1] ? parseCount(opponentLostLife[1]) : 1;
    if (atLeast) {
      return { kind: "opponent_lost_life_this_turn", atLeast };
    }
  }
  if (/^you created a token this turn$/i.test(text)) {
    return { kind: "created_token_this_turn" };
  }
  // Two spellings of one question. The counter NAME is normalised through
  // the shared key helper, so a quest counter and a +1/+1 counter are read
  // by the same line.
  const fewerCounters = text.match(/^~ has fewer than ([\w-]+) (\S+) counters? on it$/i);
  if (fewerCounters?.[1] && fewerCounters[2]) {
    const count = parseCount(fewerCounters[1]);
    if (count) {
      return {
        kind: "self_counter_count",
        counter: counterKeyOf(fewerCounters[2]),
        comparison: "fewer_than",
        count,
      };
    }
  }
  const atLeastCounters = text.match(/^~ has ([\w-]+) or more (\S+) counters? on it$/i);
  if (atLeastCounters?.[1] && atLeastCounters[2]) {
    const count = parseCount(atLeastCounters[1]);
    if (count) {
      return {
        kind: "self_counter_count",
        counter: counterKeyOf(atLeastCounters[2]),
        comparison: "at_least",
        count,
      };
    }
  }
  const opponentCount = text.match(
    /^an opponent controls (\w+) or more (lands|creatures|artifacts)$/i,
  );
  if (opponentCount?.[1] && opponentCount[2]) {
    const atLeast = parseCount(opponentCount[1]);
    if (atLeast) {
      return {
        kind: "opponent_controls_count",
        what: opponentCount[2].toLowerCase().replace(/s$/, "") as
          | "land"
          | "creature"
          | "artifact",
        atLeast,
      };
    }
  }
  const graveyardCreatures = text.match(
    /^you have (\w+) or more creature cards in your graveyard$/i,
  );
  if (graveyardCreatures?.[1]) {
    const atLeast = parseCount(graveyardCreatures[1]);
    if (atLeast) {
      return { kind: "graveyard_creature_cards_at_least", count: atLeast };
    }
  }
  // The wordings the trigger heads' own chain used to spell out one by one.
  if (
    /^you control the artifact with the greatest mana value or tied for the greatest mana value$/i.test(
      text,
    )
  ) {
    return { kind: "greatest_artifact_mana_value" };
  }
  if (
    /^an opponent controls more lands than you$/i.test(text) ||
    // Archaeomancer's Map: "that player" is the land's controller, an
    // opponent, so the same condition reads correctly.
    /^that player controls more lands than you$/i.test(text)
  ) {
    return { kind: "opponent_controls_more_lands" };
  }
  if (
    /^it doesn't have the same name as another creature you control or a creature card in your graveyard$/i.test(
      text,
    )
  ) {
    return { kind: "subject_name_unique" };
  }
  // Boromir, Nix, Roiling Vortex: the free-spell hosers.
  if (/^no mana was spent to cast (?:it|that spell|this spell)$/i.test(text)) {
    return { kind: "no_mana_spent_to_cast" };
  }
  const spentGate = parseManaSpentGate(
    text.replace(/ to cast (?:it|that spell|this spell)$/i, ""),
  );
  if (spentGate) {
    return { kind: "mana_spent_to_cast", ...spentGate };
  }
  // Kodama of the East Tree: the loop guard, read as an ordinary
  // intervening `if` because that is exactly what it is.
  if (/^it wasn't put onto the battlefield with this ability$/i.test(text)) {
    return { kind: "subject_not_put_by_watcher" };
  }
  if (/^it's the first combat phase of the turn$/i.test(text)) {
    return { kind: "first_combat_this_turn" };
  }
  if (/^it's attacking the player with the most life or tied for most life$/i.test(text)) {
    return { kind: "attacking_most_life" };
  }
  if (/^~ is tapped$/i.test(text)) {
    return { kind: "self_tapped" };
  }
  if (/^~ is attacking$/i.test(text)) {
    return { kind: "self_attacking" };
  }
  const handSize = text.match(/^you have exactly (\w+) cards in your hand$/i);
  if (handSize?.[1]) {
    const count = parseCount(handSize[1]);
    if (count) {
      return { kind: "hand_size_exactly", count };
    }
  }
  const colored = text.match(/^you control an? (white|blue|black|red|green) permanent$/i);
  if (colored?.[1]) {
    return { kind: "controls_colored_permanent", color: COLOR_WORDS[colored[1].toLowerCase()]! };
  }
  // "at least five other Mountains" (Valakut) — the source is not one of them.
  const otherSubtype = text.match(
    /^you control at least (\w+) other ([A-Z][A-Za-z]*)s$/,
  );
  if (otherSubtype?.[1] && otherSubtype[2]) {
    const atLeast = parseCount(otherSubtype[1]);
    if (atLeast) {
      return {
        kind: "controls_subtype_count",
        subtype: singularSubtype(`${otherSubtype[2]}s`),
        atLeast,
        excludeSelf: true,
      };
    }
  }
  const noSubtype = text.match(/^you control no ([A-Z][a-z]+)s$/);
  if (noSubtype?.[1]) {
    return { kind: "controls_no_subtype", subtype: singularSubtype(`${noSubtype[1]}s`) };
  }
  return null;
}

/** What a printed token descriptor spells out, before an owner is attached. */
type TokenDescriptor = {
  count: number | "x";
  name: string;
  typeLine: string;
  power: number | null;
  toughness: number | null;
  colors: Color[];
  keywords: Keyword[];
  /** "a number of … tokens": the count lives in a tail the caller strips. */
  countUnspecified?: boolean;
  entersTapped?: boolean;
  entersTappedAttacking?: boolean;
};

const TOKEN_CARD_TYPES = ["artifact", "creature", "enchantment", "land", "planeswalker"];
const TOKEN_SUPERTYPES = ["snow", "legendary"];

/**
 * The scope phrase shared by every counter replacement — Hardened Scales
 * ("a creature you control"), Doubling Season ("a permanent you control"),
 * Ozolith the Shattered Spire ("an artifact or creature you control").
 *
 * "permanent" is the unrestricted case and yields no filter at all, which is
 * what the replacement types mean by an absent scope. Anything that is not a
 * card type returns null, so an unread noun leaves the sentence uncompiled
 * rather than quietly widening the replacement to the whole board.
 */
function counterReplacementScope(
  phrase: string,
): { creaturesOnly?: true; typesAny?: string[] } | null {
  const words = phrase
    .toLowerCase()
    .split(/\s+or\s+/)
    .map((word) => word.trim())
    .filter(Boolean);
  if (words.length === 0) {
    return null;
  }
  if (words.length === 1 && words[0] === "permanent") {
    return {};
  }
  if (!words.every((word) => TOKEN_CARD_TYPES.includes(word))) {
    return null;
  }
  // One type keeps the older, narrower field so existing states still read.
  if (words.length === 1 && words[0] === "creature") {
    return { creaturesOnly: true };
  }
  return { typesAny: words };
}

const TOKEN_COUNT_WORDS =
  "a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|X|\\d+";

/** Two tokens in one clause ("… and a 3/3 … token with lifelink"): the "and"
 * that starts a second token is the one followed by a count word. */
const TOKEN_CONJUNCTION = new RegExp(`\\s+and\\s+(?=(?:${TOKEN_COUNT_WORDS})\\s)`, "i");

const capitalizeWord = (word: string): string =>
  word[0]!.toUpperCase() + word.slice(1).toLowerCase();

/**
 * "thirteen tapped 2/2 black Zombie creature tokens", "a 3/3 colorless
 * Phyrexian Wurm artifact creature token with deathtouch", "a tapped Treasure
 * token", "a 0/1 red Kobold creature token named Kobolds of ~" — the token
 * descriptor as one grammar rather than a branch per printed wording.
 *
 * The split between subtypes and card types is capitalisation: oracle text
 * prints creature and artifact subtypes capitalised and card types in lower
 * case, so "Phyrexian Wurm artifact creature" needs no type table to divide.
 * An unrecognised lower-case word returns null, which keeps a descriptor this
 * cannot read a clean miss instead of a token with the wrong type line.
 */
function parseTokenDescriptor(phrase: string): TokenDescriptor | null {
  let rest = phrase.trim().replace(/\.$/, "");

  const keywords: Keyword[] = [];
  const withKeywords = rest.match(/^(.*?)\s+with\s+(.+)$/i);
  if (withKeywords?.[1] && withKeywords[2]) {
    for (const word of withKeywords[2].split(/,\s*(?:and\s+)?|\s+and\s+/)) {
      const keyword = KEYWORD_GRANTS[word.trim().toLowerCase()];
      if (!keyword) {
        return null;
      }
      keywords.push(keyword);
    }
    rest = withKeywords[1];
  }

  let explicitName: string | null = null;
  const named = rest.match(/^(.*?)\s+named\s+(.+)$/i);
  if (named?.[1] && named[2]) {
    explicitName = named[2].trim();
    rest = named[1];
  }

  const head = rest.match(/^(.*?)\s+tokens?$/i);
  if (!head?.[1]) {
    return null;
  }
  rest = head[1];

  // "a number of tapped Treasure tokens equal to its power": the count is not
  // in the descriptor at all, so the caller must supply one from the tail it
  // stripped. Flagged rather than guessed at.
  let countUnspecified = false;
  const vague = rest.match(/^a number of\s+(.*)$/i);
  if (vague?.[1]) {
    countUnspecified = true;
    rest = vague[1];
  }

  let count: number | "x" = 1;
  if (!countUnspecified) {
    const counted = rest.match(new RegExp(`^(${TOKEN_COUNT_WORDS})\\s+(.*)$`, "i"));
    if (!counted?.[1] || !counted[2]) {
      return null;
    }
    count = /^X$/i.test(counted[1]) ? "x" : (parseCount(counted[1]) ?? Number(counted[1]));
    if (count !== "x" && (!Number.isInteger(count) || count < 1)) {
      return null;
    }
    rest = counted[2];
  }

  let entersTapped = false;
  let entersTappedAttacking = false;
  const attacking = rest.match(/^tapped and attacking\s+(.*)$/i);
  if (attacking?.[1]) {
    entersTappedAttacking = true;
    rest = attacking[1];
  } else {
    const tapped = rest.match(/^tapped\s+(.*)$/i);
    if (tapped?.[1]) {
      entersTapped = true;
      rest = tapped[1];
    }
  }

  let power: number | null = null;
  let toughness: number | null = null;
  const pt = rest.match(/^(\d+|X)\/(\d+|X)\s+(.*)$/i);
  if (pt?.[1] && pt[2] && pt[3]) {
    // An X/X token would have to read the announced X at creation, which the
    // effect's fixed power and toughness cannot carry.
    if (/X/i.test(pt[1]) || /X/i.test(pt[2])) {
      return null;
    }
    power = Number(pt[1]);
    toughness = Number(pt[2]);
    rest = pt[3];
  }

  const colors: Color[] = [];
  const supertypes: string[] = [];
  const types: string[] = [];
  const subtypes: string[] = [];
  for (const word of rest.split(/\s+/).filter(Boolean)) {
    if (word === "and") {
      continue; // "blue and red"
    }
    if (/^[A-Z]/.test(word)) {
      subtypes.push(word);
      continue;
    }
    const lower = word.toLowerCase();
    if (lower === "colorless") {
      continue;
    }
    if (COLOR_WORDS[lower]) {
      colors.push(COLOR_WORDS[lower]!);
      continue;
    }
    if (TOKEN_SUPERTYPES.includes(lower)) {
      supertypes.push(lower);
      continue;
    }
    if (TOKEN_CARD_TYPES.includes(lower)) {
      types.push(lower);
      continue;
    }
    return null;
  }
  if (types.length === 0) {
    // "a Treasure token", "a Food token": the predefined artifact tokens are
    // the only ones printed without a card type.
    if (subtypes.length === 0) {
      return null;
    }
    types.push("artifact");
  }

  const left = [...supertypes, ...types].map(capitalizeWord).join(" ");
  const typeLine = subtypes.length > 0 ? `${left} — ${subtypes.join(" ")} Token` : `${left} Token`;
  return {
    count,
    name: explicitName ?? (subtypes.length > 0 ? subtypes.join(" ") : left),
    typeLine,
    power,
    toughness,
    colors,
    keywords,
    ...(countUnspecified ? { countUnspecified: true } : {}),
    ...(entersTapped ? { entersTapped: true } : {}),
    ...(entersTappedAttacking ? { entersTappedAttacking: true } : {}),
  };
}

/**
 * The descriptor in "Whenever you cast a <descriptor> spell" — a card type,
 * a type list, "noncreature", "colorless", "historic", or a creature type.
 * Returns the subject filter it implies; an empty object means "any spell".
 * Null for anything it does not recognise, which keeps the head a clean miss.
 */
function parseSpellDescriptor(descriptor: string): CardTrigger["subjectFilter"] | null {
  const word = descriptor.trim().toLowerCase();
  if (word === "") {
    return {};
  }
  if (word === "colorless") {
    return { colorless: true };
  }
  // "a red spell" (Runaway Steam-Kin) — a colour, not a type. Composed forms
  // like "a red creature spell" fall through to the type paths below.
  if (COLOR_WORDS[word]) {
    return { colors: [COLOR_WORDS[word]!] };
  }
  // CR 702.- historic: artifact, legendary, or Saga.
  if (word === "historic") {
    return { historic: true };
  }
  const nonType = word.match(/^non(creature|artifact|enchantment|land)$/);
  if (nonType?.[1]) {
    return { nonTypes: [nonType[1]] };
  }
  // "instant or sorcery", "artifact, instant, or sorcery" — a type list.
  const listed = word
    .split(/,\s*(?:or\s+)?|\s+or\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (listed.length > 1 && listed.every((part) => SPELL_CARD_TYPES.has(part))) {
    return { typesAny: listed };
  }
  if (listed.length === 1 && SPELL_CARD_TYPES.has(word)) {
    return { types: [word] };
  }
  // A creature type, which changelings match through the shared helper. The
  // capital in the printed text is what marks it as a subtype.
  if (/^[A-Z][a-z]+$/.test(descriptor.trim())) {
    return { subtypes: [word] };
  }
  return null;
}

const SPELL_CARD_TYPES = new Set([
  "artifact",
  "creature",
  "enchantment",
  "instant",
  "sorcery",
  "planeswalker",
  "battle",
]);

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
  // Ba Sing Se / Fire Nation Palace.
  if (/^a basic land$/i.test(rest)) {
    return { kind: "basic_lands", count: 1 };
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

function compileDiscardLandOrGraveyard(sentence: string): ReplacementEffect | null {
  // Mox Diamond: "If ~ would enter, you may discard a land card instead."
  // The two follow-up sentences say what each answer does, and both are
  // implied by the replacement itself — they are consumed by the fuser
  // that builds this sentence rather than compiled separately.
  if (
    /^If ~ would enter, you may discard a land card instead$/i.test(sentence.trim())
  ) {
    return { kind: "discard_land_or_graveyard" };
  }
  return null;
}

function compileEntersTappedUnless(sentence: string): ReplacementEffect | null {
  // Starting Town: the early-turns land. The printed list is an ordinal run
  // ("first, second, or third"), so the last ordinal is the cap.
  const earlyTurn = sentence.match(
    /^~ enters tapped unless it's your (?:(?:first|second|third|fourth|fifth)(?:, |,? or )?)*?(first|second|third|fourth|fifth) turn of the game$/i,
  );
  const ORDINALS: Record<string, number> = {
    first: 1,
    second: 2,
    third: 3,
    fourth: 4,
    fifth: 5,
  };
  if (earlyTurn?.[1]) {
    return {
      kind: "enters_tapped_unless",
      unless: { kind: "turn_at_most", count: ORDINALS[earlyTurn[1].toLowerCase()]! },
    };
  }
  const crowd = sentence.match(/^~ enters tapped unless you have (two|three) or more opponents$/i);
  if (crowd?.[1]) {
    return {
      kind: "enters_tapped_unless",
      unless: { kind: "opponents", count: parseCount(crowd[1]) ?? 2 },
    };
  }
  // Mystic Sanctuary: "three or more other Islands". The subtype is
  // capitalised in oracle text and stored lowercase.
  const subtypeCount = sentence.match(
    /^~ enters tapped unless you control (\w+) or more (other )?([A-Z][a-z]+)s$/,
  );
  if (subtypeCount?.[1] && subtypeCount[3]) {
    const need = parseCount(subtypeCount[1].toLowerCase());
    if (need) {
      return {
        kind: "enters_tapped_unless",
        unless: {
          kind: "controlled_subtype",
          subtype: subtypeCount[3].toLowerCase(),
          count: need,
          ...(subtypeCount[2] ? { excludeSelf: true } : {}),
        },
      };
    }
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
      ...(add.countFromEnchantments ? { countFromEnchantments: true } : {}),
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
  if (add.kind === "chosen_color") {
    return {
      produces: {},
      producesOptions: [],
      producesAnyColor: false,
      damageToController: 0,
      producesChosenColor: true,
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
  | { kind: "any_color"; count?: number; countFromPower?: boolean; countFromEnchantments?: boolean }
  | {
      kind: "any_color_among";
      scope: NonNullable<ManaAbility["anyColorAmong"]>;
    }
  | { kind: "chosen_color" }
  | { kind: "colors_among"; scope: "permanents" }
  | { kind: "or"; colors: ManaColor[] };

function parseAddMana(rest: string): AddManaResult | null {
  const text = rest.trim();
  // Mox Amber: the choice is limited to colors among controlled legendaries.
  const legendaryMana = text.match(
    /^Add one mana of any color among legendary (creatures and planeswalkers|permanents) you control$/i,
  );
  if (legendaryMana?.[1]) {
    return {
      kind: "any_color_among",
      scope: /^permanents$/i.test(legendaryMana[1]) ? "legendary_permanents" : "legendary",
    };
  }

  // Bloom Tender: one mana of each color represented on your board.
  if (/^For each color among permanents you control, add one mana of that color$/i.test(text)) {
    return { kind: "colors_among", scope: "permanents" };
  }
  // Exotic Orchard / Fellwar Stone.
  if (/^Add one mana of any color that a land an opponent controls could produce$/i.test(text)) {
    return { kind: "any_color_among", scope: "opponent_lands" };
  }
  // Reflecting Pool ("any type" — colorless included).
  if (/^Add one mana of any type that a land you control could produce$/i.test(text)) {
    return { kind: "any_color_among", scope: "your_lands" };
  }
  // Heraldic Banner: the color picked as the source entered.
  if (/^Add one mana of the chosen color$/i.test(text)) {
    return { kind: "chosen_color" };
  }
  // Command Tower / Arcane Signet: the color picker is limited to the
  // controller's commanders' color identity, read from the board at tap time.
  if (/^Add one mana of any color in your commander'?s color identity$/i.test(text)) {
    return { kind: "any_color_among", scope: "commander_identity" };
  }
  // Chrome Mox: the colours of the card exiled with it. An unimprinted
  // Mox has an empty set, and the mana gate refuses the tap — which is
  // exactly what the card does.
  if (
    /^Add one mana of any of the exiled card['\u2019]s colors$/i.test(text)
  ) {
    return { kind: "any_color_among", scope: "imprinted" };
  }
  if (/^Add one mana of any color$/i.test(text)) {
    return { kind: "any_color" };
  }
  const big = text.match(/^Add (two|three|four|five) mana of any one color$/i);
  if (big?.[1]) {
    return { kind: "any_color", count: parseCount(big[1]) ?? 1 };
  }
  // Kami of Whispered Hopes: the amount reads the creature's power at tap.
  if (/^Add X mana of any one color, where X is (?:this creature|~)'s power$/i.test(text)) {
    return { kind: "any_color", countFromPower: true };
  }
  // Sanctum Weaver.
  if (/^Add X mana of any one color, where X is the number of enchantments you control$/i.test(text)) {
    return { kind: "any_color", countFromEnchantments: true };
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
  /**
   * How many EARLIER targets this clause's chosen indexes already account
   * for. "It deals damage equal to its power to target creature you don't
   * control" reads `it` as the previous sentence's target, so it emits
   * chosen 0 for that and chosen 1 for its own — a clause that already
   * knows it is second. The assembler shifts by `offset - chosenBase`, so
   * these two refs move together and stay one apart.
   */
  chosenBase?: number;
  /**
   * Mosswort Bridge prints its gate inside the effect sentence ("… if
   * creatures you control have total power 10 or greater") rather than as
   * a separate "Activate only if" line. Carried up to the ability so an
   * unmet condition offers nothing, instead of offering an activation
   * that resolves to nothing.
   */
  activationGate?: TriggerCondition;
};

/**
 * Fold a subject rider ("It gains haste", "Sacrifice it at the beginning of
 * the next end step") into the previous effect when it created or moved a
 * permanent onto the battlefield. Returns true when consumed.
 */
/**
 * Move a rider that depends on the SACRIFICED creature into the
 * `thenEffects` of the choose_card that sacrifices it.
 *
 * Left where it is printed, the rider binds against the trigger, where
 * `sacrificedPower` is undefined — so the card compiles, scores, and pays
 * out zero. Wave 228 was reverted for exactly that, and this is the half
 * that was missing.
 */
function foldSacrificeRider(effects: CardEffect[], sentence: string): boolean {
  for (let i = effects.length - 1; i >= 0; i -= 1) {
    const effect = effects[i];
    if (!effect || effect.kind !== "choose_card") {
      continue;
    }
    const sacrifices = effect.thenEffects.some((then) => then.kind === "sacrifice");
    if (!sacrifices) {
      return false;
    }
    const clause = compileSimpleClause(sentence);
    if (!clause || clause.leftover || clause.targetRequirements.length > 0) {
      return false;
    }
    // Only riders that actually read the fodder belong in there; anything
    // else is an ordinary following clause and must stay where it is.
    const readsFodder = clause.effects.some(
      (candidate) =>
        ("amount" in candidate && candidate.amount === "sacrificed_power") ||
        ("count" in candidate && candidate.count === "sacrificed_power"),
    );
    if (!readsFodder) {
      return false;
    }
    effect.thenEffects.push(...clause.effects);
    return true;
  }
  return false;
}

function foldSubjectRider(effects: CardEffect[], sentence: string): boolean {
  // Search BACKWARDS for the effect that made the permanent, rather than
  // insisting it be the very last one. "It gains haste until end of turn"
  // compiles as a clause of its own and lands between the token creation
  // and the sacrifice rider, and requiring adjacency silently dropped the
  // rider whenever anything sat in the gap.
  // A plain backwards loop rather than findLastIndex: the engine targets
  // ES2022, and this keeps the narrowing that the callback form loses.
  let last: Extract<CardEffect, { kind: "copy_token" | "create_token" | "move_card" }> | undefined;
  for (let i = effects.length - 1; i >= 0; i -= 1) {
    const effect = effects[i];
    if (!effect) {
      continue;
    }
    if (effect.kind === "copy_token" || effect.kind === "create_token") {
      last = effect;
      break;
    }
    if (effect.kind === "move_card" && effect.toZone === "battlefield") {
      last = effect;
      break;
    }
  }
  if (!last) {
    return false;
  }
  // "…until end of turn" folds the same way. The token this rides on is
  // sacrificed or exiled at the next end step anyway, so a haste that
  // outlives the turn and a haste that does not are the same haste here.
  if (
    /^(?:It|They|That token|That creature) gains? haste(?: until end of turn)?$/i.test(
      sentence,
    )
  ) {
    if (last.kind === "create_token") {
      // A freshly made token carries the keyword instead of a flag. Haste
      // on a token that has already been able to attack once is inert, so
      // "until end of turn" and a permanent haste are the same haste here
      // — a documented approximation, and a far smaller one than losing
      // the sentence entirely.
      //
      // "Create TWO tokens" compiles to two effects, and "They gain haste"
      // means both — so every create_token in the trailing run gets it,
      // not just the last one.
      for (let i = effects.length - 1; i >= 0; i -= 1) {
        const effect = effects[i];
        if (!effect || effect.kind !== "create_token") {
          break;
        }
        effect.keywords = [...(effect.keywords ?? []), "haste"];
      }
      return true;
    }
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

/**
 * Read the timing phrase of a delayed triggered ability. "YOUR next"
 * upkeep waits for the controller's own turn; "the NEXT TURN's" upkeep
 * fires on whoever is active — four-handed those are three turns apart.
 */
function parseDelayedTiming(
  phrase: string,
): { step: "upkeep" | "first_main_phase"; whose: "controller" | "any" } | null {
  if (/^your next upkeep$/i.test(phrase)) {
    return { step: "upkeep", whose: "controller" };
  }
  if (/^the next turn['\u2019]s upkeep$/i.test(phrase)) {
    return { step: "upkeep", whose: "any" };
  }
  if (/^your next main phase$/i.test(phrase)) {
    return { step: "first_main_phase", whose: "controller" };
  }
  return null;
}

const DELAYED_TIMING = String.raw`your next upkeep|your next main phase|the next turn['\u2019]s upkeep`;

/**
 * Mark every graveyard-bound move a DESTROY sentence produced as an actual
 * destruction (CR 701.7), so indestructible stops it and totem armor
 * replaces it.
 *
 * This is done once, here, rather than at each of the twenty-odd clauses
 * that read the word: those are a list, and a list written out by hand is a
 * list that falls behind. The engine spent a long time with the SWEEPS
 * checking indestructible and "Destroy target creature" not checking it, so
 * a Blightsteel Colossus died to a Beast Within.
 *
 * A move to any other zone is untouched — exile, bounce and tuck are not
 * destructions and are not stopped by any of this. Neither is a sacrifice,
 * which is its own effect kind and never comes through here.
 */
function markDestructionsInPlace(sentence: string, effects: CardEffect[]): void {
  if (!/\bdestroy(s|ed)?\b/i.test(sentence)) {
    return;
  }
  for (const effect of effects) {
    if (effect.kind === "move_card" && effect.toZone === "graveyard") {
      effect.destroy = true;
    } else if (effect.kind === "if_condition") {
      markDestructionsInPlace(sentence, effect.then);
      if (effect.otherwise) {
        markDestructionsInPlace(sentence, effect.otherwise);
      }
    }
  }
}

/**
 * Every printed wording of the denial, in one place: it is read from four
 * assemblers and a miss in any of them is silent.
 */
const REGENERATION_DENIAL =
  /^(?:(?:They|It)|(?:A creature|Creatures) destroyed this way) can't be regenerated$/i;

/**
 * "It can't be regenerated" (CR 701.15d). The denial rides the destruction
 * it was printed beside — "destroyed THIS WAY" scopes to one ability — so
 * it is applied to a list of effects, never to the card. A sweep that
 * exiles or sacrifices is not a destruction and takes no flag.
 */
function denyRegenerationInPlace(effects: CardEffect[]): void {
  for (const effect of effects) {
    if (effect.kind === "move_card" && effect.destroy === true) {
      effect.denyRegeneration = true;
    } else if (
      effect.kind === "destroy_all" &&
      effect.toZone !== "exile" &&
      effect.asSacrifice !== true
    ) {
      effect.denyRegeneration = true;
    } else if (effect.kind === "if_condition") {
      denyRegenerationInPlace(effect.then);
      if (effect.otherwise) {
        denyRegenerationInPlace(effect.otherwise);
      }
    }
  }
}

/**
 * "target card from a graveyard", and every type-qualified form of it.
 * The type words are a table rather than a regex alternation so an unknown
 * qualifier declines the whole phrase instead of quietly compiling to the
 * unfiltered target — which would be a Deathrite Shaman that eats anything.
 */
const GRAVEYARD_TARGET_TYPES: Record<string, string[]> = {
  land: ["land"],
  creature: ["creature"],
  artifact: ["artifact"],
  enchantment: ["enchantment"],
  planeswalker: ["planeswalker"],
  instant: ["instant"],
  sorcery: ["sorcery"],
  "instant or sorcery": ["instant", "sorcery"],
  "artifact or creature": ["artifact", "creature"],
  "creature or artifact": ["creature", "artifact"],
  "creature or planeswalker": ["creature", "planeswalker"],
};

function graveyardCardTarget(phrase: string): TargetRequirement | null {
  const match = phrase.match(/^(?:(.+?) )?card from (a|your) graveyard$/i);
  if (!match?.[2]) {
    return null;
  }
  const types = match[1] ? GRAVEYARD_TARGET_TYPES[match[1].toLowerCase()] : [];
  if (!types) {
    return null;
  }
  return {
    kind: /^your$/i.test(match[2]) ? "own_graveyard_card" : "graveyard_card",
    ...(types.length > 0 ? { requiredTypesAny: types } : {}),
  };
}

function compileSimpleClause(sentence: string): SimpleClause | null {
  const clause = compileSimpleClauseInner(sentence);
  if (clause) {
    markDestructionsInPlace(sentence, clause.effects);
  }
  return clause;
}

function compileSimpleClauseInner(sentence: string): SimpleClause | null {
  /**
   * Siren Stormtamer, and the plain form beside it. "That targets you or a
   * creature you control" is a constraint on what the STACK OBJECT is
   * aiming at, which is most of the card — without it the Siren counters
   * anything at all.
   */
  const counterStackObject = sentence.match(
    /^Counter target spell or ability( that targets you or a creature you control)?$/i,
  );
  if (counterStackObject) {
    return {
      targetRequirements: [
        {
          kind: "spell_or_ability",
          ...(counterStackObject[1] ? { targetsYouOrYours: true } : {}),
        },
      ],
      effects: [{ kind: "counter_spell", target: { type: "chosen", index: 0 } }],
    };
  }

  /**
   * Regenerate (CR 701.15). A SHIELD against the next destruction this
   * turn, not a heal — which is why it costs the permanent a tap and its
   * place in combat when it is spent.
   *
   * Swarmyard names four creature types and ANY of them qualifies, where
   * the existing subtype filter demands all of them at once.
   */
  const regenerateAny = sentence.match(
    /^Regenerate target ([A-Z][a-z]+), ([A-Z][a-z]+), ([A-Z][a-z]+), or ([A-Z][a-z]+)$/,
  );
  if (regenerateAny) {
    return {
      targetRequirements: [
        {
          kind: "creature",
          requiredSubtypesAny: regenerateAny
            .slice(1, 5)
            .map((subtype) => subtype!.toLowerCase()),
        },
      ],
      effects: [{ kind: "regenerate", cardId: { type: "chosen", index: 0 } }],
    };
  }
  if (/^Regenerate target creature$/i.test(sentence)) {
    return {
      targetRequirements: [{ kind: "creature" }],
      effects: [{ kind: "regenerate", cardId: { type: "chosen", index: 0 } }],
    };
  }
  if (/^Regenerate ~$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [{ kind: "regenerate", cardId: "self" }],
    };
  }
  if (/^Regenerate each creature you control$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [{ kind: "regenerate", allControlled: true }],
    };
  }

  /**
   * Liliana, Dreadhorde General's -9: "Each opponent chooses a permanent
   * they control of each permanent type and sacrifices the rest."
   *
   * The choice names what to KEEP, which inverts every other "of their
   * choice" sacrifice here. One `choose_card` per permanent type (CR
   * 110.4a lists six), each followed by sacrificing everything ELSE of
   * that type. A player who controls none of a type is asked nothing and
   * loses nothing there.
   */
  if (
    /^Each opponent chooses a permanent they control of each permanent type and sacrifices the rest$/i.test(
      sentence,
    )
  ) {
    const permanentTypes = [
      "artifact",
      "creature",
      "enchantment",
      "land",
      "planeswalker",
      "battle",
    ] as const;
    return {
      targetRequirements: [],
      effects: permanentTypes.map((cardType) => ({
        kind: "choose_card" as const,
        chooserId: "each_opponent" as const,
        sources: [
          {
            playerId: "each_opponent" as const,
            zone: "battlefield" as const,
            filter: cardType,
          },
        ],
        thenEffects: [
          {
            kind: "sacrifice_others_of_type" as const,
            playerId: "each_opponent" as const,
            cardType,
          },
        ],
        // Controlling none of a type is not a decline: there is simply
        // nothing to keep and nothing to lose.
        thenEffectsIfNone: [],
      })),
    };
  }

  /**
   * Agadeem's Awakening: "Return from your graveyard to the battlefield any
   * number of target creature cards that each have a different mana value X
   * or less."
   *
   * The two qualifiers are what make the card a card. "X or less" bounds
   * the pool by the mana actually spent, and "each a DIFFERENT mana value"
   * stops the spell emptying a graveyard full of one-drops. Both read the
   * whole chosen SET, so they ride the requirement and are checked where
   * the set is in hand.
   */
  if (
    /^Return from your graveyard to the battlefield any number of target creature cards that each have a different mana value X or less$/i.test(
      sentence,
    )
  ) {
    return {
      targetRequirements: [
        {
          kind: "own_graveyard_creature_card",
          variable: true,
          maxManaValueX: true,
          distinctManaValues: true,
        },
      ],
      effects: [
        // ALL of them: a variable requirement is satisfied by any number of
        // targets, and naming `chosen 0` would return only the first.
        { kind: "move_card", cardId: "all_chosen", toZone: "battlefield" },
      ],
    };
  }

  /**
   * Mishra's Bauble: "Look at the top card of target player's library."
   * A LOOK, not a reveal — only the effect's controller sees it, which is
   * the whole point of aiming it at an opponent.
   */
  if (/^Look at the top card of target player's library$/i.test(sentence)) {
    return {
      targetRequirements: [{ kind: "player" }],
      effects: [
        {
          kind: "look_top_card",
          playerId: { type: "chosen", index: 0 },
          viewerId: "controller",
        },
      ],
    };
  }

  /** The same look, aimed at yourself. */
  if (/^Look at the top card of your library$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [
        { kind: "look_top_card", playerId: "controller", viewerId: "controller" },
      ],
    };
  }

  /**
   * Portal to Phyrexia's rider: "It's a Phyrexian in addition to its other
   * types." A characteristic the reanimated permanent keeps for as long as
   * it is on the battlefield — "in addition to" is the whole of it, so the
   * type is ADDED and nothing the card already was is lost.
   *
   * "It" is the card the previous sentence put onto the battlefield, which
   * is the first chosen target; a clause with no targets of its own keeps
   * that index.
   */

  /**
   * Kodama of the East Tree: "you may put a permanent card with equal or
   * lesser mana value from your hand onto the battlefield." The cap is the
   * mana value of the permanent whose entry triggered this, so it is
   * resolved at bind rather than printed; the card put down is MARKED, so
   * the entry it causes does not feed the ability again.
   */
  if (
    /^You may put a permanent card with equal or lesser mana value from your hand onto the battlefield$/i.test(
      sentence,
    )
  ) {
    return {
      effects: [
        {
          kind: "choose_card",
          chooserId: "controller",
          optional: true,
          sources: [
            {
              playerId: "controller",
              zone: "hand",
              filter: "permanent",
              maxManaValueOfSubject: true,
            },
          ],
          thenEffects: [
            {
              kind: "move_card",
              cardId: "chosen_card",
              toZone: "battlefield",
              putByAbilityOf: true,
            },
          ],
        },
      ],
      targetRequirements: [],
    };
  }

  /**
   * High Tide: "Until end of turn, whenever a player taps an Island for
   * mana, that player adds an additional {U}." This is the rule a
   * permanent carries as `landTapEcho`, with no permanent to carry it —
   * so it lives on the game for the turn. Note "a PLAYER": it watches
   * everyone's taps, not just the caster's, which is most of why the card
   * is played in the first place.
   */
  const turnEcho = sentence.match(
    /^Until end of turn, whenever a player taps an? ([A-Z][a-z]+) for mana, that player adds an additional \{([WUBRGC])\}$/,
  );
  if (turnEcho?.[1] && turnEcho[2]) {
    return {
      effects: [
        {
          kind: "add_turn_mana_echo",
          echo: {
            subtype: turnEcho[1].toLowerCase(),
            addColor: turnEcho[2] as ManaColor,
          },
        },
      ],
      targetRequirements: [],
    };
  }

  /**
   * Archdruid's Charm's first bullet, fused into one clause because the
   * destination depends on WHAT was found and neither half means anything
   * without the other: "Search your library for a creature or land card and
   * reveal it. Put it onto the battlefield tapped if it's a land card.
   * Otherwise, put it into your hand. Then shuffle."
   */
  if (/^search creature or land, land to battlefield tapped$/i.test(sentence)) {
    return {
      effects: [
        {
          kind: "search_library",
          playerId: "controller",
          filter: { typesAny: ["creature", "land"] },
          destination: "hand",
          count: 1,
          landsToBattlefieldTapped: true,
        },
      ],
      targetRequirements: [],
    };
  }

  /**
   * "It deals damage equal to its power to target creature you don't
   * control" — the one-way bite, where "it" is whatever the PREVIOUS
   * sentence in this mode targeted. That is chosen 0 here and the modal
   * assembler shifts this clause's own target past it.
   */
  const oneWayBite = sentence.match(
    /^It deals damage equal to its power to target creature you don't control$/i,
  );
  if (oneWayBite) {
    return {
      effects: [
        {
          kind: "deal_damage",
          // "IT" — the creature the previous sentence targeted.
          sourceId: { type: "chosen", index: 0 },
          target: { type: "chosen", index: 1 },
          amount: "chosen_power",
        },
      ],
      targetRequirements: [{ kind: "creature", control: "not_own" }],
      chosenBase: 1,
    };
  }

  /**
   * Descent into Avernus's second sentence: two clauses sharing one
   * "where X is …" tail, which is why they compile together rather than
   * as two sentences that each lost the tail.
   *
   * Both readings happen at APPLY, not at bind. The trigger's FIRST effect
   * puts two more counters on, and effects bind as a batch — a bind-time
   * reading would be two short every time, which on this card is the whole
   * escalation.
   */
  const sharedCounterX = sentence.match(
    /^Each player creates X Treasure tokens and ~ deals X damage to each player, where X is the number of ([a-z]+) counters on ~$/i,
  );
  if (sharedCounterX?.[1]) {
    const counter = sharedCounterX[1].toLowerCase();
    return {
      effects: [
        {
          kind: "create_token",
          ownerId: "each_player",
          name: "Treasure",
          typeLine: "Artifact — Treasure",
          count: 0,
          perSourceCounters: counter,
        },
        {
          kind: "deal_damage",
          sourceId: "self",
          target: { type: "player", playerId: "each_player" },
          amount: { sourceCounters: counter },
        },
      ],
      targetRequirements: [],
    };
  }

  /**
   * "Put any number of cards from your hand on the bottom of your library,
   * then draw that many cards plus one" (Valakut Awakening), and "put any
   * number of creature cards from your hand onto the battlefield" (Last
   * March of the Ents).
   *
   * The draw rides the PROMPT rather than sitting beside it as a second
   * effect: "that many" is how many the player chooses, and a sibling
   * effect would have bound its count before the choice was made.
   */
  const anyFromHand = sentence.match(
    /^Put any number of (?:([a-z]+) )?cards from your hand (?:on the bottom of your library|onto the battlefield)(?:, then draw that many cards plus (one|\d+))?$/i,
  );
  if (anyFromHand) {
    const toBattlefield = /onto the battlefield/i.test(sentence);
    const plusWord = anyFromHand[2]?.toLowerCase();
    const plus = plusWord === "one" ? 1 : plusWord ? Number(plusWord) : undefined;
    // A card-type filter this engine cannot name would let a player choose
    // anything at all, so refuse rather than widen the choice silently.
    const filter = anyFromHand[1]?.toLowerCase();
    if (filter && filter !== "creature" && filter !== "land" && filter !== "artifact") {
      return null;
    }
    return {
      effects: [
        {
          kind: "choose_from_hand",
          playerId: "controller",
          destination: toBattlefield ? "battlefield" : "library_bottom",
          ...(filter ? { types: [filter] } : {}),
          ...(plus === undefined ? {} : { thenDrawPlus: plus }),
        },
      ],
      targetRequirements: [],
    };
  }

  /**
   * "~ becomes a 2/2 creature with all creature types until end of turn"
   * (Mutavault) and "Target land you control becomes an X/X Elemental
   * creature with trample and haste until end of turn, where X is the
   * number of enchantments you control" (Destiny Spinner).
   *
   * One clause for both because they are one sentence shape: a subject, a
   * size, optional creature types, optional keywords, and an optional
   * "where X is" tail. "It's still a land" is consumed separately and means
   * nothing here — the creature type is ADDED, so the land stays a land
   * whether or not the card bothers to say so.
   */
  // The duration is printed at either end of the sentence — Mutavault
  // trails it, the enemy-colour manlands front it — and it says the same
  // thing in both places, so one pattern reads both rather than two
  // patterns saying the same thing twice.
  const animate = sentence.match(
    /^(?:Until end of turn, )?(~|Target land you control|Target land) becomes an? (?:(\d+)\/(\d+)|X\/X) ((?:[A-Za-z]+ )*)creature(?: with (all creature types|[a-z, ]+?))?(?: until end of turn)?(?:, where X is (.+))?$/i,
  );
  if (animate && !/until end of turn/i.test(sentence)) {
    // Every printed form says it somewhere. A sentence that does not is
    // some other card doing something permanent, and guessing is worse
    // than a clean miss.
    return null;
  }
  if (animate?.[1]) {
    const withClause = animate[5]?.toLowerCase().trim();
    const all = withClause === "all creature types";
    const keywords: Keyword[] = [];
    if (withClause && !all) {
      for (const word of withClause.split(/,| and /).map((part) => part.trim())) {
        if (!word) {
          continue;
        }
        const keyword = KEYWORD_GRANTS[word];
        if (!keyword) {
          return null;
        }
        keywords.push(keyword);
      }
    }
    // The count table is keyed on the noun phrase alone ("enchantments you
    // control"), so the "the number of" the card prints in front of it is
    // stripped rather than duplicated into every entry.
    const ptFrom = animate[6]
      ? parseDynamicCount(animate[6].replace(/^the number of /i, ""))
      : null;
    // An X/X with no "where X is" tail has nothing to read: refuse rather
    // than animate something as a 0/0 that the card never said was one.
    if (!animate[2] && !ptFrom) {
      return null;
    }
    // "a 1/1 Phyrexian Blinkmoth ARTIFACT creature", "a 2/1 BLUE Faerie
    // creature" — one run of words carrying three different kinds of thing,
    // sorted by what each word is rather than by where it sits.
    const subtypes: string[] = [];
    const extraTypes: string[] = [];
    const colors: Color[] = [];
    for (const word of (animate[4] ?? "").trim().split(/\s+/).filter(Boolean)) {
      const lower = word.toLowerCase();
      if (lower === "and") {
        // "blue and black Elemental" — the conjunction joins the colours
        // and is not a creature type of its own.
        continue;
      }
      const color = COLOR_WORDS[lower];
      if (color) {
        colors.push(color);
      } else if (lower === "artifact" || lower === "enchantment" || lower === "land") {
        extraTypes.push(lower);
      } else {
        subtypes.push(lower);
      }
    }
    return {
      effects: [
        {
          kind: "animate_until_eot",
          cardId: animate[1] === "~" ? "self" : { type: "chosen", index: 0 },
          power: animate[2] ? Number(animate[2]) : 0,
          toughness: animate[3] ? Number(animate[3]) : 0,
          ...(ptFrom ? { ptFrom } : {}),
          ...(subtypes.length > 0 ? { subtypes } : {}),
          ...(extraTypes.length > 0 ? { types: extraTypes } : {}),
          ...(colors.length > 0 ? { colors } : {}),
          ...(all ? { allCreatureTypes: true } : {}),
          ...(keywords.length > 0 ? { keywords } : {}),
        },
      ],
      targetRequirements:
        animate[1] === "~" ? [] : [{ kind: "land" as const, control: "own" as const }],
    };
  }

  /**
   * "It's still a land." Consumed rather than compiled: the animation above
   * ADDS the creature type instead of replacing what was there, so this
   * sentence is already true and there is nothing to do about it.
   */
  if (/^It's still a land$/i.test(sentence)) {
    return { effects: [], targetRequirements: [] };
  }

  /**
   * Discover N (CR 702.163) — the same walk cascade makes, with a printed
   * ceiling instead of the spell's own mana value, and with the extra
   * option of taking the card to hand.
   */
  const discoverLine = sentence.match(/^Discover (\d+)$/i);
  if (discoverLine?.[1]) {
    return {
      effects: [
        {
          kind: "discover",
          playerId: "controller",
          maxManaValue: Number(discoverLine[1]),
          toHandAllowed: true,
        },
      ],
      targetRequirements: [],
    };
  }

  // "At the beginning of your next upkeep, …" — a delayed triggered
  // ability (CR 603.7) created by THIS spell, not a trigger on a
  // permanent, which is why the permanent trigger head ("of your upkeep",
  // no "next") does not read it. The body compiles here and binds when
  // the spell resolves. Terminates: the body is strictly shorter and no
  // longer holds the timing phrase.
  const delayedLead = sentence.match(
    new RegExp(`^At the beginning of (${DELAYED_TIMING}), (.+)$`, "i"),
  );
  const delayedTail = delayedLead
    ? null
    : sentence.match(
        new RegExp(`^(.+?) at the beginning of (${DELAYED_TIMING})$`, "i"),
      );
  const delayedTiming = delayedLead?.[1] ?? delayedTail?.[2];
  const delayedBody = delayedLead?.[2] ?? delayedTail?.[1];
  if (delayedTiming && delayedBody) {
    const timing = parseDelayedTiming(delayedTiming);
    const inner = timing ? compileSimpleClause(delayedBody) : null;
    // A body needing its own targets cannot be delayed: the choice would
    // have to be made now, for a board that has not happened yet. Refuse
    // rather than drop the requirement and target nothing later.
    if (
      timing &&
      inner &&
      !inner.leftover &&
      inner.targetRequirements.length === 0 &&
      inner.effects.length > 0
    ) {
      return {
        targetRequirements: [],
        effects: [
          {
            kind: "delayed_trigger",
            step: timing.step,
            whose: timing.whose,
            effects: inner.effects,
          },
        ],
      };
    }
  }
  // The One Ring: "you lose 1 life for each burden counter on ~" and
  // "draw a card for each burden counter on ~".
  const perCounterLoss = sentence.match(
    /^you lose (\d+) life for each ([a-z][a-z-]*) counter on ~$/i,
  );
  if (perCounterLoss?.[1] && perCounterLoss[2]) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "lose_life",
          playerId: "controller",
          amount: Number(perCounterLoss[1]),
          perCounterOnSource: counterKeyOf(perCounterLoss[2]),
        },
      ],
    };
  }
  const perCounterDraw = sentence.match(
    /^draw a card for each ([a-z][a-z-]*) counter on ~$/i,
  );
  if (perCounterDraw?.[1]) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "draw",
          playerId: "controller",
          count: 1,
          countFromCounterOnSource: counterKeyOf(perCounterDraw[1]),
        },
      ],
    };
  }
  // Teferi's Protection and The One Ring: a shield on the PLAYER that
  // lasts until their next turn. "Until your next turn" is a duration
  // `activeEffects` cannot hold — that list sweeps at cleanup, and this
  // has to outlive every opponent's whole turn.
  const shieldBoth = /^Until your next turn, your life total can['\u2019]t change and you gain protection from everything$/i;
  const shieldLife = /^Until your next turn, your life total can['\u2019]t change$/i;
  const shieldProtection =
    /^(?:Until your next turn, you gain protection from everything|You gain protection from everything until your next turn)$/i;
  if (shieldBoth.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "grant_player_shield",
          playerId: "controller",
          protectionFromEverything: true,
          lifeLocked: true,
        },
      ],
    };
  }
  if (shieldLife.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [{ kind: "grant_player_shield", playerId: "controller", lifeLocked: true }],
    };
  }
  if (shieldProtection.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "grant_player_shield",
          playerId: "controller",
          protectionFromEverything: true,
        },
      ],
    };
  }
  // Teferi's Protection: "All permanents you control phase out." The set
  // is read at RESOLUTION — a selector list fixed at compile time could
  // not know what the board would look like.
  if (/^All permanents you control phase out$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [{ kind: "phase_out", cardIds: [], allControlled: true }],
    };
  }
  // Pact of Negation, after fusePactInPlace: "pay {3}{U}{U} or you lose
  // the game". `unless_pays` is exactly this polarity — the effects run
  // when the payment does NOT happen.
  const payOrLose = sentence.match(
    /^pay ((?:\{[^}]+\})+) or you lose the game$/i,
  );
  if (payOrLose?.[1]) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "unless_pays",
          playerId: "controller",
          cost: payOrLose[1],
          effects: [{ kind: "lose_game", playerId: "controller" }],
        },
      ],
    };
  }
  // Mana Drain: "add an amount of {C} equal to that spell's mana value".
  // The amount is read as the effect binds, while the countered spell is
  // still on the stack; by the time the mana arrives it is long gone.
  if (
    /^add an amount of \{C\} equal to that spell['\u2019]s mana value$/i.test(
      sentence,
    )
  ) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "add_mana",
          playerId: "controller",
          mana: { C: 1 },
          perTargetManaValue: true,
        },
      ],
    };
  }
  // Arcane Denial: "Its controller may draw up to two cards" — the
  // controller of the countered spell. "Up to" is taken in full, the
  // same documented approximation `optional` already carries elsewhere:
  // it draws the full count unless the library is too small.
  const itsControllerDraws = sentence.match(
    /^Its controller may draw up to (a|an|one|two|three|four|five|\d+) cards?$/i,
  );
  if (itsControllerDraws?.[1]) {
    const drawCount = parseCount(itsControllerDraws[1]);
    if (drawCount) {
      return {
        targetRequirements: [],
        effects: [
          {
            kind: "draw",
            playerId: { type: "chosen_controller", index: 0 },
            count: drawCount,
            optional: true,
          },
        ],
      };
    }
  }
  // "You may have ~ deal 3 damage to any target" (Valakut, Kederekt Parasite):
  // the "may" is auto-taken, the same documented approximation the other
  // may-clauses here use, and what is left is the ordinary damage clause.
  // Terminates because the rewrite removes the phrase it matched on.
  const mayHave = sentence.match(/^you may have (.+?) deals? (.+)$/i);
  if (mayHave?.[1] && mayHave[2]) {
    return compileSimpleClause(`${mayHave[1]} deals ${mayHave[2]}`);
  }
  // "You may have that player lose 1 life" (Suture Priest) — the same
  // auto-taken "may", over a verb that conjugates rather than staying put.
  const mayHaveLose = sentence.match(/^you may have (.+?) (lose|gain|draw|mill|discard) (.+)$/i);
  if (mayHaveLose?.[1] && mayHaveLose[2] && mayHaveLose[3]) {
    const conjugated = `${mayHaveLose[2].toLowerCase()}s`;
    return compileSimpleClause(`${mayHaveLose[1]} ${conjugated} ${mayHaveLose[3]}`);
  }
  // "That player mills that many cards" (Mindcrank), "that player draws a
  // card" — the trigger's subject player, and its amount where the text
  // says "that many".
  const subjectPlayerBody = sentence.match(
    /^That player (mills|draws|discards) (that many|a|an|one|two|three|\d+) cards?$/i,
  );
  if (subjectPlayerBody?.[1] && subjectPlayerBody[2]) {
    const verb = subjectPlayerBody[1].toLowerCase();
    const many = /^that many$/i.test(subjectPlayerBody[2]);
    const count = many ? undefined : parseCount(subjectPlayerBody[2]);
    if (many || count) {
      // Only mill carries "that many"; a draw or discard of it has no
      // printed card here and would be a guess.
      if (!many || verb === "mills") {
        return {
          targetRequirements: [],
          effects: [
            verb === "mills"
              ? {
                  kind: "mill",
                  playerId: { type: "subject_player" },
                  count: many ? ("subject_amount" as const) : count!,
                }
              : {
                  kind: verb === "draws" ? "draw" : "discard",
                  playerId: { type: "subject_player" },
                  count: count!,
                },
          ],
        };
      }
    }
  }

  // "Sacrifice a land" / "sacrifice two lands" as an EFFECT rather than a
  // cost: the controller picks, which is the choose-a-permanent shape an
  // edict already uses. Each sacrifice is its own pick, so "two lands" is two
  // choices rather than one choice of two.
  const sacrificeEffect = sentence.match(
    /^Sacrifice (?:an? |(two|three|four|\d+) )(land|creature|artifact)s?$/i,
  );
  if (sacrificeEffect?.[2]) {
    const howMany = sacrificeEffect[1] ? parseCount(sacrificeEffect[1]) : 1;
    if (howMany) {
      const one: CardEffect = {
        kind: "choose_card",
        chooserId: "controller",
        sources: [
          {
            playerId: "controller",
            zone: "battlefield",
            filter: sacrificeEffect[2].toLowerCase() as "land" | "creature",
          },
        ],
        thenEffects: [{ kind: "sacrifice", cardId: "chosen_card" }],
      };
      return {
        targetRequirements: [],
        effects: Array.from({ length: howMany }, () => ({ ...one })),
      };
    }
  }

  // Bristly Bill: "Double the number of +1/+1 counters on each creature you
  // control" — a one-shot doubling of what is on the board, not a replacement
  // effect on counters yet to be placed.
  const doubleTeamCounters = sentence.match(
    /^Double the number of (.+?) counters on each creature you control$/i,
  );
  const doubled = doubleTeamCounters?.[1] ? parseCounterList(`a ${doubleTeamCounters[1]}`) : null;
  if (doubled && doubled.length === 1) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "double_counters_on_team",
          playerId: "controller",
          counter: doubled[0]!.counter,
        },
      ],
    };
  }

  // Vilis: "draw that many cards" — the controller draws, and "that many" is
  // the amount the trigger watched (the life just lost). Terrasymbiosis
  // prints "you may draw that many cards"; the may is auto-taken, the same
  // documented approximation the other may-clauses here use.
  if (/^(?:you )?(?:may )?draw that many cards$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [{ kind: "draw", playerId: "controller", count: "subject_amount" }],
    };
  }

  // "You may mill three cards" (World Shaper) — the may is auto-taken, the
  // same documented approximation the other may-clauses here use.
  const mayMill = sentence.match(/^(?:you )?may mill (a|one|two|three|four|five|\d+) cards?$/i);
  const milled = mayMill?.[1] ? parseCount(mayMill[1]) : null;
  if (milled) {
    return {
      targetRequirements: [],
      effects: [{ kind: "mill", playerId: "controller", count: milled }],
    };
  }

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

  // Ruinous Ultimatum: a sweep that spares the caster's own board.
  const opponentWipe = sentence.match(
    /^Destroy all (creatures|artifacts|enchantments|nonland permanents) your opponents control$/i,
  );
  if (opponentWipe?.[1]) {
    const named = opponentWipe[1].toLowerCase();
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "destroy_all",
          what: (named === "nonland permanents" ? "nonland" : named) as DestroyAllScope,
          opponentsOnly: true,
        },
      ],
    };
  }

  // Old Gnawbone: "that many" is the damage the trigger just carried.
  const thatManyTreasures = sentence.match(
    /^Create that many Treasure tokens$/i,
  );
  if (thatManyTreasures) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "create_token",
          ownerId: "controller",
          name: "Treasure",
          typeLine: "Artifact — Treasure Token",
          countFromSubjectAmount: true,
        },
      ],
    };
  }

  // "It deals that much damage to …" — the amount is whatever the trigger
  // carried: the damage just dealt (Kediss), or the size of the batch that
  // fired it (Ingenious Artillerist). One pattern for all three scopes,
  // because the sentence differs only in who is hit.
  //
  // "Each OTHER opponent" was refused here for a long time, correctly:
  // `each_opponent` would have hit the player who was just damaged a
  // second time. It is now a selector of its own rather than an omission.
  const thatMuchDamage = sentence.match(
    /^(?:~|It) deals that much damage to (each opponent|each other opponent|target opponent)$/i,
  );
  if (thatMuchDamage?.[1]) {
    const scope = thatMuchDamage[1].toLowerCase();
    if (scope === "target opponent") {
      return {
        targetRequirements: [{ kind: "opponent" }],
        effects: [
          {
            kind: "deal_damage",
            sourceId: "self",
            target: { type: "player", playerId: { type: "chosen", index: 0 } },
            amount: "subject_amount",
          },
        ],
      };
    }
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "deal_damage",
          sourceId: "self",
          target: {
            type: "player",
            playerId:
              scope === "each other opponent" ? "each_other_opponent" : "each_opponent",
          },
          amount: "subject_amount",
        },
      ],
    };
  }

  // Blue Sun's Zenith: a targeted X draw.
  const targetedXDraw = sentence.match(/^Target player draws X cards$/i);
  if (targetedXDraw) {
    return {
      targetRequirements: [{ kind: "player" }],
      effects: [{ kind: "draw", playerId: { type: "chosen", index: 0 }, count: "x" }],
    };
  }

  // Pull from Tomorrow: draw X, then pay one card back.
  const xLoot = sentence.match(/^Draw X cards, then discard (a|one|\d+) cards?$/i);
  if (xLoot?.[1]) {
    return {
      targetRequirements: [],
      effects: [
        { kind: "draw", playerId: "controller", count: "x" },
        {
          kind: "discard",
          playerId: "controller",
          count: parseCount(xLoot[1]) ?? 1,
        },
      ],
    };
  }

  // Secret Rendezvous: a shared draw with one opponent.
  const sharedDraw = sentence.match(
    /^You and target opponent each draw (a|one|two|three|four|\d+) cards?$/i,
  );
  if (sharedDraw?.[1]) {
    const count = parseCount(sharedDraw[1]) ?? 1;
    return {
      targetRequirements: [{ kind: "opponent" }],
      effects: [
        { kind: "draw", playerId: "controller", count },
        { kind: "draw", playerId: { type: "chosen", index: 0 }, count },
      ],
    };
  }

  // Geier Reach Sanitarium: a symmetric loot.
  const eachLoot = sentence.match(
    /^Each player draws (a|one|\d+) cards?, then discards (a|one|\d+) cards?$/i,
  );
  if (eachLoot?.[1] && eachLoot[2]) {
    return {
      targetRequirements: [],
      effects: [
        { kind: "draw", playerId: "each_player", count: parseCount(eachLoot[1]) ?? 1 },
        { kind: "discard", playerId: "each_player", count: parseCount(eachLoot[2]) ?? 1 },
      ],
    };
  }

  // Splendid Reclamation / Aftermath Analyst / Lumra: a mass land return.
  if (
    /^(?:Then )?return all land cards from your graveyard to the battlefield tapped$/i.test(
      sentence,
    )
  ) {
    return {
      targetRequirements: [],
      effects: [{ kind: "return_all_lands", playerId: "controller" }],
    };
  }

  // Gitaxian Probe: a one-way look at somebody's hand.
  if (/^Look at target player's hand$/i.test(sentence)) {
    return {
      targetRequirements: [{ kind: "player" }],
      effects: [
        {
          kind: "reveal_zone",
          fromPlayerId: { type: "chosen", index: 0 },
          toPlayerId: "controller",
          zone: "hand",
        },
      ],
    };
  }

  // Crux of Fate: "Destroy all Dragon creatures" / "all non-Dragon creatures".
  const tribalWipe = sentence.match(/^Destroy all (non-)?([A-Z][a-z-]+) creatures$/);
  if (tribalWipe?.[2]) {
    const subtype = singularSubtype(`${tribalWipe[2]}s`);
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "destroy_all",
          what: "creatures",
          ...(tribalWipe[1] ? { exceptSubtype: subtype } : { onlySubtype: subtype }),
        },
      ],
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
    /^return (it|~) to the battlefield( tapped)?( and transformed)?(?: under its owner's control)?(?: with an? ([+\w/]+) counter on it)?$/i,
  );
  if (selfReturn?.[1]) {
    /**
     * "IT" is the trigger's SUBJECT, not the source. Under "When ~ dies"
     * those are the same card and either reading works; under "Whenever a
     * creature you control dies" they are not, and binding the source
     * would return the WATCHER to the battlefield instead of the creature
     * that died — a card that compiles clean and returns the wrong thing.
     * `~` still means the source, because that is what the word says.
     */
    const returned = /^~$/.test(selfReturn[1]) ? ("self" as const) : ("subject_card" as const);
    const counter = selfReturn[4] ? counterKeyOf(selfReturn[4]) : null;
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "move_card",
          cardId: returned,
          toZone: "battlefield",
          ...(selfReturn[2] ? { entersTapped: true } : {}),
          // Ojer Taq: it arrives on its other face, rather than arriving
          // and then turning over.
          ...(selfReturn[3] ? { transformed: true } : {}),
        },
        ...(counter
          ? [{ kind: "add_counter" as const, cardId: returned, counter, amount: 1 }]
          : []),
      ],
    };
  }

  // Untimely Malfunction: "One or two target creatures can't block this
  // turn." The count is a CLAUSE-level shape — a noun phrase is one
  // requirement and cannot say "one or two" — so it becomes two slots and
  // the head decides how many of them are required: "two" needs both,
  // "one or two" needs the first, "up to two" needs neither.
  const cantAct = sentence.match(
    /^(?:(One or two|Up to two|Two) target creatures|Target creature) can't (block|attack) this turn$/i,
  );
  if (cantAct?.[2]) {
    const head = cantAct[1]?.toLowerCase();
    const slots = head ? 2 : 1;
    const required = head === "two" ? 2 : head === "up to two" ? 0 : 1;
    const cant =
      cantAct[2].toLowerCase() === "block"
        ? ({ cantBlock: true } as const)
        : ({ cantAttack: true } as const);
    return {
      targetRequirements: Array.from({ length: slots }, (_unused, index) => ({
        kind: "creature" as const,
        ...(index >= required ? { optional: true } : {}),
      })),
      effects: Array.from({ length: slots }, (_unused, index) => ({
        kind: "restrict_until_eot" as const,
        cardId: { type: "chosen" as const, index },
        ...cant,
      })),
    };
  }

  // Dauthi Voidwalker's ability, once the fuser has joined its two halves.
  // The pool is every opponent's exile, narrowed to the cards this card's
  // own replacement put there — every other exiled card is somebody else's
  // business.
  if (
    /^Choose an exiled card an opponent owns with a void counter on it, and you may play it this turn without paying its mana cost$/i.test(
      sentence,
    )
  ) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "choose_card",
          chooserId: "controller",
          sources: [
            {
              playerId: "each_opponent",
              zone: "exile",
              filter: "any",
              hasVoidCounter: true,
            },
          ],
          thenEffects: [{ kind: "grant_play_chosen", playerId: "controller", free: true }],
        },
      ],
    };
  }

  // "Sacrifice ~." on its own — a common line with nowhere to land until
  // now. New Capenna's fetch lands say it in a trigger body; Underworld
  // Breach says it at the end step.
  if (
    /^Sacrifice (?:~|this (?:creature|artifact|enchantment|land|permanent|token))$/i.test(
      sentence,
    )
  ) {
    return { targetRequirements: [], effects: [{ kind: "sacrifice", cardId: "self" }] };
  }

  const unblockable = sentence.match(
    /^(target creature( you control)?|~)(?: with power (\d+) or less)? can't be blocked this turn$/i,
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
          ...(unblockable[2] ? { control: "own" as const } : {}),
          ...(unblockable[3] ? { maxPower: Number(unblockable[3]) } : {}),
        },
      ],
      effects: [
        { kind: "restrict_until_eot", cardId: { type: "chosen", index: 0 }, cantBeBlocked: true },
      ],
    };
  }

  // Mirage Mirror / Thespian's Stage / Shifting Woodland: the source becomes
  // a copy of something it targets. The noun phrase goes through the shared
  // target grammars, so "nontoken artifact you control" and "permanent card in
  // your graveyard" are read by the parsers that already know those shapes.
  const becomeCopy = sentence.match(
    /^~ becomes a copy of target (.+?)(, except it has this ability)?( until end of turn)?$/i,
  );
  if (becomeCopy?.[1]) {
    const phrase = becomeCopy[1].trim();
    const inGraveyard = phrase.match(/^(.+) card in your graveyard$/i);
    const requirement = inGraveyard?.[1]
      ? parseGraveyardTargetPhrase(`${inGraveyard[1]} card`)
      : // this grammar reads the whole phrase INCLUDING "target", which the
        // match above has already stripped.
        parseSimpleTargetPhrase(`target ${phrase}`);
    if (requirement) {
      return {
        targetRequirements: [requirement],
        effects: [
          {
            kind: "become_copy",
            cardId: "self",
            target: { type: "chosen", index: 0 },
            ...(becomeCopy[3] ? { untilEot: true } : {}),
            ...(becomeCopy[2] ? { keepAbilities: true } : {}),
          },
        ],
      };
    }
  }

  // All Is Dust: a sacrifice, not a destruction, so indestructible does not
  // save — and colourless permanents are spared, which is the whole card.
  if (
    /^Each player sacrifices all permanents they control that are one or more colors$/i.test(
      sentence,
    )
  ) {
    return {
      targetRequirements: [],
      effects: [
        { kind: "destroy_all", what: "permanents", coloredOnly: true, asSacrifice: true },
      ],
    };
  }

  // Reconnaissance: out of combat, still on the battlefield. Not a tap and
  // not a bounce — an attacker removed from combat (CR 506.4) deals and
  // receives no combat damage, and its attack trigger stays fired.
  const removeFromCombat = sentence.match(
    /^Remove (target .+?) from combat and untap it$/i,
  );
  const removedTarget = removeFromCombat?.[1]
    ? parseSimpleTargetPhrase(removeFromCombat[1])
    : null;
  if (removedTarget) {
    return {
      targetRequirements: [removedTarget],
      effects: [
        { kind: "remove_from_combat", cardId: { type: "chosen", index: 0 } },
        { kind: "untap", cardId: { type: "chosen", index: 0 } },
      ],
    };
  }

  // Liquimetal Torque: "in addition to its other types" is layer 4, so the
  // permanent keeps what it already is — the target is an artifact creature,
  // not an artifact.
  const becomesType = sentence.match(
    /^(Target .+?) becomes an? ([a-z]+) in addition to its other types until end of turn$/i,
  );
  if (becomesType?.[1] && becomesType[2] && TOKEN_CARD_TYPES.includes(becomesType[2].toLowerCase())) {
    const requirement = parseSimpleTargetPhrase(becomesType[1]);
    if (requirement) {
      return {
        targetRequirements: [requirement],
        effects: [
          {
            kind: "types_until_eot",
            cardId: { type: "chosen", index: 0 },
            types: [becomesType[2].toLowerCase()],
          },
        ],
      };
    }
  }

  // Rishkar: "on EACH OF up to two target creatures" — two optional slots
  // and one counter apiece, which is not the same shape as "distribute".
  const eachOfUpTo = sentence.match(
    /^Put (.+?) counters? on each of up to (one|two|three) target (.+)$/i,
  );
  const eachOfCount = eachOfUpTo?.[2] ? parseCount(eachOfUpTo[2]) : null;
  if (eachOfUpTo?.[1] && eachOfCount && eachOfUpTo[3]) {
    const placed = parseCounterList(eachOfUpTo[1]);
    const singular = eachOfUpTo[3].replace(/s(?= |$)/gi, "");
    const requirement = parseSimpleTargetPhrase(`target ${singular}`);
    if (placed && requirement) {
      return {
        targetRequirements: Array.from({ length: eachOfCount }, (_, index) => ({
          ...requirement,
          ...(index === 0 ? {} : { optional: true as const }),
        })),
        effects: Array.from({ length: eachOfCount }, (_, index) =>
          placed.map((entry) => ({
            kind: "add_counter" as const,
            cardId: { type: "chosen" as const, index },
            counter: entry.counter,
            amount: entry.amount,
          })),
        ).flat(),
      };
    }
  }

  // "Exile up to two target artifacts and/or enchantments" (Angel of the
  // Ruins): "up to N" is N OPTIONAL slots, which is a clause-level shape.
  // The noun-phrase parser can only say "up to one", because a phrase is one
  // requirement; the plural head is singularised so it goes through the
  // shared grammar rather than being parsed a second way.
  const upToTwo = sentence.match(/^(Exile|Destroy) up to two target (.+)$/i);
  if (upToTwo?.[1] && upToTwo[2]) {
    const singular = upToTwo[2].replace(/and\/or/gi, "or").replace(/s(?= |$)/gi, "");
    const requirement = parseSimpleTargetPhrase(`target ${singular}`);
    if (requirement) {
      const toZone = /^exile$/i.test(upToTwo[1]) ? ("exile" as const) : ("graveyard" as const);
      return {
        targetRequirements: [
          { ...requirement, optional: true },
          { ...requirement, optional: true },
        ],
        effects: [
          { kind: "move_card", cardId: { type: "chosen", index: 0 }, toZone },
          { kind: "move_card", cardId: { type: "chosen", index: 1 }, toZone },
        ],
      };
    }
  }

  // Nesting Grounds: "Move a counter from target permanent you control onto
  // a second target permanent." Two independent target slots — the donor is
  // restricted to what its controller owns and the receiver is not, which is
  // the whole reason this is not one requirement used twice.
  const moveCounter = sentence.match(
    /^Move a counter from (target .+?) onto a second (target .+)$/i,
  );
  if (moveCounter?.[1] && moveCounter[2]) {
    const from = parseSimpleTargetPhrase(moveCounter[1]);
    const to = parseSimpleTargetPhrase(moveCounter[2]);
    if (from && to) {
      return {
        targetRequirements: [from, to],
        effects: [
          {
            kind: "move_counter",
            from: { type: "chosen", index: 0 },
            to: { type: "chosen", index: 1 },
          },
        ],
      };
    }
  }

  // The Earth Crystal: "Distribute two +1/+1 counters among one or two
  // target creatures you control." The count of counters and the count of
  // SLOTS are different numbers and are read separately; every slot after
  // the first is optional, because "one or two" permits one.
  const distribute = sentence.match(
    /^Distribute ([a-z]+) (.+?) counters among (one|one or two|one, two, or three) target (.+)$/i,
  );
  if (distribute?.[1] && distribute[2] && distribute[3] && distribute[4]) {
    const amount = parseCount(distribute[1]);
    const counter = counterKeyOf(distribute[2]);
    const slots = distribute[3].toLowerCase() === "one" ? 1 : distribute[3].includes("three") ? 3 : 2;
    const singular = distribute[4].replace(/s(?= |$)/gi, "");
    const requirement = parseSimpleTargetPhrase(`target ${singular}`);
    if (amount !== null && amount > 0 && counter && requirement) {
      return {
        targetRequirements: Array.from({ length: slots }, (_, index) => ({
          ...requirement,
          ...(index === 0 ? {} : { optional: true as const }),
        })),
        effects: [
          {
            kind: "distribute_counters",
            counter,
            amount,
            targets: Array.from({ length: slots }, (_, index) => ({
              type: "chosen" as const,
              index,
            })),
          },
        ],
      };
    }
  }

  // Decimate: four targets of four kinds, destroyed together.
  const decimate = sentence.match(
    /^Destroy target ([a-z]+), target ([a-z]+), target ([a-z]+), and target ([a-z]+)$/i,
  );
  if (decimate) {
    const kinds = [decimate[1], decimate[2], decimate[3], decimate[4]].map((word) =>
      TARGET_HEAD_NOUNS.find(([pattern]) => pattern.test(word!.toLowerCase()))?.[1],
    );
    if (kinds.every((kind): kind is TargetKind => Boolean(kind))) {
      return {
        targetRequirements: kinds.map((kind) => ({ kind })),
        effects: kinds.map((_, index) => ({
          kind: "move_card" as const,
          cardId: { type: "chosen" as const, index },
          toZone: "graveyard" as const,
        })),
      };
    }
  }

  // Emry: the card is TARGETED, not picked from a prompt, so the permission
  // reads the chosen target. Fused with its permission (see
  // `fuseChooseGraveyardCastInPlace`) because on a permanent card a
  // top-level effect never runs.
  const chooseGraveyardCast = sentence.match(
    /^Choose target ([a-z]+) card in your graveyard and you may cast that card this turn$/i,
  );
  const chooseGraveyardKind = chooseGraveyardCast?.[1]
    ? GRAVEYARD_HEAD_NOUNS.find(([pattern]) =>
        pattern.test(`${chooseGraveyardCast[1]} card`),
      )?.[1]
    : undefined;
  if (chooseGraveyardKind) {
    return {
      targetRequirements: [{ kind: chooseGraveyardKind }],
      effects: [{ kind: "grant_play_chosen", playerId: "controller" }],
    };
  }

  // Wishclaw Talisman: "AN opponent gains control" — the choice is the
  // activating player's and there is no field for it, so the next opponent
  // in turn order is taken. A documented auto-pick; in a two-player game it
  // is the only opponent, and Wishclaw is a two-player card in practice.
  if (/^An opponent gains control of ~$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [{ kind: "gain_control", cardId: "self", playerId: "next_opponent" }],
    };
  }

  // Sea Gate Restoration: a live board reading PLUS a flat bonus, so an
  // empty hand still draws the one.
  const drawPlus = sentence.match(
    /^Draw cards equal to the number of (.+?) plus one$/i,
  );
  const drawPlusCount = drawPlus?.[1] ? parseDynamicCount(drawPlus[1]) : null;
  if (drawPlusCount) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "draw",
          playerId: "controller",
          count: 1,
          countFromDynamicPlus: { count: drawPlusCount, plus: 1 },
        },
      ],
    };
  }

  // Sea Gate Restoration's second half. "For the rest of the game" is a
  // player-level grant: there is no permanent to read it off, unlike
  // `CardDefinition.noMaxHandSize`, which lasts only while its card is out.
  if (/^You have no maximum hand size for the rest of the game$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [{ kind: "grant_no_max_hand_size", playerId: "controller" }],
    };
  }

  // Noxious Gearhulk: a targeted destroy with a lifegain rider that reads
  // the victim's toughness BEFORE it dies. The "may" is auto-taken, the same
  // documented approximation the other may-clauses here make.
  // The lifegain half is the fused rider (see `fuseDestroyLifegainInPlace`),
  // and its amount is read at BIND — before the sibling destroy applies,
  // because effects bind as a batch and a dead creature has no toughness.
  const mayDestroyAnother = sentence.match(
    /^(?:you may )?destroy another target creature( and gain life equal to its toughness)?$/i,
  );
  if (mayDestroyAnother) {
    return {
      targetRequirements: [{ kind: "creature", excludeSource: true }],
      effects: [
        { kind: "move_card", cardId: { type: "chosen", index: 0 }, toZone: "graveyard" },
        ...(mayDestroyAnother[1]
          ? [
              {
                kind: "gain_life" as const,
                playerId: "controller" as const,
                amount: "target_toughness" as const,
              },
            ]
          : []),
      ],
    };
  }



  // Razorkin Needlehead: "~ deals N damage to them" — "them" is the player
  // the trigger watched. Damage, not life loss: the source matters, so a
  // damage doubler and a prevention shield both see it.
  const damageToSubject = sentence.match(/^~ deals (\d+) damage to them$/i);
  if (damageToSubject?.[1]) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "deal_damage",
          sourceId: "self",
          target: { type: "player", playerId: { type: "subject_player" } },
          amount: Number(damageToSubject[1]),
        },
      ],
    };
  }

  // Scrap Trawler: "with LESSER mana value" — lesser than the artifact that
  // just died, which is the trigger's subject. Resolved where the trigger
  // asks for targets, the only place that subject is known.
  if (
    /^return to your hand target artifact card in your graveyard with lesser mana value$/i.test(
      sentence,
    )
  ) {
    return {
      targetRequirements: [
        { kind: "own_graveyard_artifact_card", manaValueBelowSubject: true },
      ],
      effects: [
        { kind: "move_card", cardId: { type: "chosen", index: 0 }, toZone: "hand" },
      ],
    };
  }

  // The Gitrog Monster: feed it a land, or lose it. The pay-or-effect prompt
  // speaks mana and life, not permanents, so the choice is auto-taken —
  // documented, and the one a player makes nearly always.
  if (/^sacrifice ~ unless you sacrifice a land$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [
        { kind: "sacrifice_unless_sacrifice", playerId: "controller", scope: "land" },
      ],
    };
  }

  // Midnight Clock: the cards go back in as one batch and the library is
  // shuffled ONCE. Shuffling never would leave the graveyard sitting on top
  // in order, which is exactly what the printed word rules out.
  if (
    /^shuffle your hand and graveyard into your library$/i.test(sentence)
  ) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "shuffle_zones_into_library",
          playerId: "controller",
          zones: ["hand", "graveyard"],
        },
      ],
    };
  }

  // Caretaker's Talent: a copy of a TOKEN, which is the restriction — the
  // Class cannot copy a real permanent.
  if (
    /^create a token that's a copy of target token you control$/i.test(sentence)
  ) {
    return {
      targetRequirements: [{ kind: "creature", control: "own", tokenTargetOnly: true }],
      effects: [
        { kind: "copy_token", ownerId: "controller", ofCardId: { type: "chosen", index: 0 } },
      ],
    };
  }

  // Cut a Deal: every living opponent drew, so "each opponent who drew a
  // card this way" is just how many opponents there are — counted at bind,
  // after their draws have resolved.
  if (
    /^you draw a card for each opponent who drew a card this way$/i.test(sentence)
  ) {
    return {
      targetRequirements: [],
      effects: [{ kind: "draw", playerId: "controller", count: 1, countPerOpponent: true }],
    };
  }

  // Flare of Fortitude: a locked life total and a blanket grant, in one
  // sentence. "Permanents you control" is wider than the creature team every
  // other grant here means — the artifacts and lands are shielded too.
  if (
    /^Until end of turn, your life total can't change, and permanents you control gain hexproof and indestructible$/i.test(
      sentence,
    )
  ) {
    return {
      targetRequirements: [],
      effects: [
        { kind: "grant_player_shield", playerId: "controller", lifeLocked: true },
        {
          kind: "team_keyword_until_eot",
          playerId: "controller",
          keyword: "hexproof",
          scope: "permanents",
        },
        {
          kind: "team_keyword_until_eot",
          playerId: "controller",
          keyword: "indestructible",
          scope: "permanents",
        },
      ],
    };
  }

  // Unbreakable Formation's addendum. "Those creatures" are the ones the
  // previous sentence granted indestructible to — the controller's creatures,
  // re-read here rather than remembered, which is the same set: nothing can
  // die between two clauses of one resolution.
  const addendumCounters = sentence.match(
    /^If you cast this spell during your main phase, put a \+1\/\+1 counter on each of those creatures and they gain ([a-z ]+) until end of turn$/i,
  );
  const addendumKeyword = addendumCounters?.[1]
    ? KEYWORD_GRANTS[addendumCounters[1].trim().toLowerCase()]
    : undefined;
  if (addendumKeyword) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "if_condition",
          condition: { kind: "own_main_phase" },
          then: [
            {
              kind: "counter_on_each_creature",
              counter: "p1p1",
              amount: 1,
              controlledOnly: true,
            },
            {
              kind: "team_keyword_until_eot",
              playerId: "controller",
              keyword: addendumKeyword,
            },
          ],
        },
      ],
    };
  }

  // Mirror Entity: a SET power and toughness, not a bonus, so the team is
  // X/X regardless of what it printed — and the announced X is read where
  // the ability resolves.
  if (
    /^Until end of turn, creatures you control have base power and toughness X\/X and gain all creature types$/i.test(
      sentence,
    )
  ) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "team_set_pt_until_eot",
          playerId: "controller",
          power: "x",
          toughness: "x",
          allCreatureTypes: true,
        },
      ],
    };
  }

  // The Mycosynth Gardens: "with mana value X" is EXACTLY the announced X,
  // resolved where the ability goes on the stack.
  if (
    /^~ becomes a copy of target nontoken artifact you control with mana value X$/i.test(
      sentence,
    )
  ) {
    return {
      targetRequirements: [
        { kind: "artifact", control: "own", nonTokenOnly: true, manaValueEqualsX: true },
      ],
      effects: [
        { kind: "become_copy", cardId: "self", target: { type: "chosen", index: 0 } },
      ],
    };
  }

  // Shared Animosity: the same scaled pump aimed at the trigger's SUBJECT
  // rather than a target. "It" is the creature that attacked, and it is also
  // the referent the count is measured against.
  const subjectScaledPump = sentence.match(
    /^it gets ([+-]\d+)\/([+-]\d+) until end of turn for each (.+)$/i,
  );
  if (subjectScaledPump?.[1] && subjectScaledPump[2] && subjectScaledPump[3]) {
    const per = parseDynamicCount(subjectScaledPump[3]);
    if (per) {
      return {
        targetRequirements: [],
        effects: [
          {
            kind: "pt_until_eot",
            cardId: "subject_card",
            power: Number(subjectScaledPump[1]),
            toughness: Number(subjectScaledPump[2]),
            per,
          },
        ],
      };
    }
  }

  // Defile: a targeted pump whose size is a live count. The count is read as
  // the spell resolves, so the printed numbers are the per-unit step.
  const scaledPump = sentence.match(
    /^Target creature gets ([+-]\d+)\/([+-]\d+) until end of turn for each (.+)$/i,
  );
  if (scaledPump?.[1] && scaledPump[2] && scaledPump[3]) {
    const per = parseDynamicCount(scaledPump[3]);
    if (per) {
      return {
        targetRequirements: [{ kind: "creature" }],
        effects: [
          {
            kind: "pt_until_eot",
            cardId: { type: "chosen", index: 0 },
            power: Number(scaledPump[1]),
            toughness: Number(scaledPump[2]),
            per,
          },
        ],
      };
    }
  }

  // Mossborn Hydra: the doubling lands on the source, not on a team.
  const doubleSelf = sentence.match(
    /^double the number of ([+-]\d\/[+-]\d|[a-z]+) counters on ~$/i,
  );
  if (doubleSelf?.[1]) {
    const counter =
      doubleSelf[1] === "+1/+1" ? "p1p1" : doubleSelf[1] === "-1/-1" ? "m1m1" : doubleSelf[1].toLowerCase();
    return {
      targetRequirements: [],
      effects: [{ kind: "double_counters_on", cardId: "self", counter }],
    };
  }

  // Sundering Eruption: a restriction laid on every creature that lacks a
  // keyword, rather than on one this clause targets.
  const allRestrict = sentence.match(
    /^Creatures (with|without) ([a-z ]+) can't (attack|block) this turn$/i,
  );
  if (allRestrict?.[1] && allRestrict[2] && allRestrict[3]) {
    const keyword = KEYWORD_GRANTS[allRestrict[2].trim().toLowerCase()];
    if (keyword) {
      return {
        targetRequirements: [],
        effects: [
          {
            kind: "all_restrict_until_eot",
            ...(/^attack$/i.test(allRestrict[3]) ? { cantAttack: true } : { cantBlock: true }),
            ...(/^with$/i.test(allRestrict[1])
              ? { withKeyword: keyword }
              : { withoutKeyword: keyword }),
          },
        ],
      };
    }
  }

  // Thassa, Deep-Dwelling: "{3}{U}: Tap another target creature."
  const tapTarget = sentence.match(/^Tap (another )?target creature$/i);
  if (tapTarget) {
    return {
      targetRequirements: [{ kind: "creature", ...(tapTarget[1] ? { excludeSource: true } : {}) }],
      effects: [{ kind: "tap", cardId: { type: "chosen", index: 0 } }],
    };
  }

  // Ranger-Captain of Eos.
  if (/^Your opponents can't cast noncreature spells this turn$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [{ kind: "silence_noncreature", playerId: "controller" }],
    };
  }

  // Weathered Wayfarer: any land, to hand.
  if (
    /^Search your library for a land card, reveal it, put it into your hand, then shuffle$/i.test(
      sentence,
    )
  ) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "search_library",
          playerId: "controller",
          filter: { types: ["land"] },
          destination: "hand",
          count: 1,
        },
      ],
    };
  }

  // Recruiter of the Guard / Ranger-Captain of Eos: capped creature tutors.
  const cappedTutor = sentence.match(
    /^(?:you may )?search your library for a creature card with (toughness|mana value|power) (\d+) or less, reveal it, put it into your hand, then shuffle$/i,
  );
  if (cappedTutor?.[1] && cappedTutor[2]) {
    const cap = Number(cappedTutor[2]);
    const capKind = cappedTutor[1].toLowerCase();
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "search_library",
          playerId: "controller",
          filter: {
            types: ["creature"],
            ...(capKind === "toughness"
              ? { maxToughness: cap }
              : capKind === "power"
                ? { maxPower: cap }
                : { maxManaValue: cap }),
          },
          destination: "hand",
          count: 1,
        },
      ],
    };
  }

  // Ouroboroid: team counters scaled to its own power at bind.
  if (
    /^put X \+1\/\+1 counters on each creature you control, where X is (?:~|this creature)'s power$/i.test(
      sentence,
    )
  ) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "counter_on_controlled_creatures",
          playerId: "controller",
          counter: "+1/+1",
          amount: "source_power",
        },
      ],
    };
  }

  // Halana and Alena: targeted counters scaled to the source's power.
  if (
    /^put X \+1\/\+1 counters on another target creature you control, where X is (?:~|this creature)'s power$/i.test(
      sentence,
    )
  ) {
    return {
      targetRequirements: [{ kind: "creature", control: "own", excludeSource: true }],
      effects: [
        {
          kind: "add_counter",
          cardId: { type: "chosen", index: 0 },
          counter: "+1/+1",
          amount: "source_power",
        },
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

  /**
   * Terror of the Peaks: the same reading, but the DEALER is the permanent
   * with the trigger rather than the creature that entered. Warstorm Surge
   * says "it deals … its power"; Terror says "~ deals … that creature's
   * power", so only the source differs.
   */
  if (
    /^~ deals damage equal to that creature's power to any target$/i.test(sentence)
  ) {
    return {
      targetRequirements: [{ kind: "player_or_creature" }],
      effects: [
        {
          kind: "deal_damage",
          sourceId: "self",
          target: { type: "chosen", index: 0 },
          amount: "subject_power",
        },
      ],
    };
  }

  // Warstorm Surge: the trigger subject's power, read at bind.
  if (/^it deals damage equal to its power to any target$/i.test(sentence)) {
    return {
      targetRequirements: [{ kind: "player_or_creature" }],
      effects: [
        {
          kind: "deal_damage",
          sourceId: null,
          target: { type: "chosen", index: 0 },
          amount: "subject_power",
        },
      ],
    };
  }

  // Mental Misstep ({U/P} pays as plain {U}, documented).
  /**
   * Mindbreak Trap. Exiling a spell is NOT countering it (CR 701.11), which
   * is the whole reason the card beats a storm turn full of uncounterable
   * spells — so this is `exile_spell`, not a counter that happens to exile.
   */
  if (/^Exile any number of target spells$/i.test(sentence)) {
    return {
      targetRequirements: [{ kind: "spell", variable: true }],
      effects: [{ kind: "exile_spell", target: "all_chosen" }],
    };
  }
  if (/^Exile target spell$/i.test(sentence)) {
    return {
      targetRequirements: [{ kind: "spell" }],
      effects: [{ kind: "exile_spell", target: { type: "chosen", index: 0 } }],
    };
  }

  const counterMv = sentence.match(/^Counter target spell with mana value (\d+)$/i);
  if (counterMv?.[1]) {
    const mv = Number(counterMv[1]);
    return {
      targetRequirements: [{ kind: "spell", maxManaValue: mv, minManaValue: mv }],
      effects: [{ kind: "counter_spell", target: { type: "chosen", index: 0 } }],
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

  match = sentence.match(
    /^(?:~|this \w+) deals (\d+) damage to (each opponent|you|each player)$/i,
  );
  if (match?.[1] && match[2]) {
    const who = match[2].toLowerCase();
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "deal_damage",
          sourceId: "self",
          target: {
            type: "player",
            playerId:
              who === "you" ? "controller" : who === "each player" ? "each_player" : "each_opponent",
          },
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

  // Any other damage target, read by the SHARED target-phrase parser
  // rather than another noun list of its own — that is what lets
  // "attacking or blocking creature" work here without teaching this
  // sentence anything about combat. Deliberately last: the two spellings
  // above are more specific and must keep winning.
  match = sentence.match(/^(?:~ )?deals (\d+) damage to (target .+)$/i);
  if (match?.[1] && match[2]) {
    const requirement = parseSimpleTargetPhrase(match[2]);
    if (requirement) {
      return {
        targetRequirements: [requirement],
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
  }

  // Wave Goodbye: mass bounce that spares counter-carrying creatures.
  if (/^Return each creature without a \+1\/\+1 counter on it to its owner's hand$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [{ kind: "bounce_each_creature", unlessCounter: "p1p1" }],
    };
  }

  if (
    /^Return each creature to its owner's hand$/i.test(sentence) ||
    // Evacuation says the same thing in the plural.
    /^Return all creatures to their owners' hands$/i.test(sentence)
  ) {
    return { targetRequirements: [], effects: [{ kind: "bounce_each_creature" }] };
  }

  // Aetherize.
  if (/^Return all attacking creatures to their owner(?:'s|s') hands?$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [{ kind: "bounce_each_creature", onlyAttacking: true }],
    };
  }

  // Distant Melody / Kindred Dominance / Crippling Fear / Raise the Palisade:
  // "Choose a creature type." on a spell is consumed here; the choice itself
  // is auto-picked at bind (the caster's most common creature type — a
  // documented approximation) by the exceptChosenType effects that follow.
  if (/^Choose a creature type$/i.test(sentence)) {
    return { targetRequirements: [], effects: [] };
  }

  if (/^Draw a card for each permanent you control of that type$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [
        { kind: "draw", playerId: "controller", count: 1, countFromChosenTypePermanents: true },
      ],
    };
  }

  if (/^Destroy all creatures that aren't of the chosen type$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [{ kind: "destroy_all", what: "creatures", exceptChosenType: true }],
    };
  }

  const nonChosenDebuff = sentence.match(
    /^Creatures that aren't of the chosen type get (-\d+)\/(-\d+) until end of turn$/i,
  );
  if (nonChosenDebuff?.[1] && nonChosenDebuff[2]) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "all_pt_until_eot",
          power: Number(nonChosenDebuff[1]),
          toughness: Number(nonChosenDebuff[2]),
          exceptChosenType: true,
        },
      ],
    };
  }

  if (
    /^Return all creatures that aren't of the chosen type to their owners' hands$/i.test(sentence)
  ) {
    return {
      targetRequirements: [],
      effects: [{ kind: "bounce_each_creature", exceptChosenType: true }],
    };
  }

  if (/^(?:then )?populate$/i.test(sentence)) {
    return { targetRequirements: [], effects: [{ kind: "populate", playerId: "controller" }] };
  }

  // Rancor: the Aura's own dies trigger sends it home. "It" is the trigger's
  // subject, which for a self-watching dies trigger is this card.
  if (/^return it to its owner's hand$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [{ kind: "move_card", cardId: "subject_card", toZone: "hand" }],
    };
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
  const digTop = sentence.match(
    /^Dig (\d+) for (.+?) to (hand|battlefield|battlefield_tapped)( rest graveyard)?$/,
  );
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
            ...(digTop[4] ? { restTo: "graveyard" as const } : {}),
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

  // Imp's Mischief's toll rides the retargeted spell's mana value.
  if (/^You lose life equal to that spell's mana value$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [{ kind: "lose_life", playerId: "controller", amount: "target_mana_value" }],
    };
  }

  // Narset's Reversal: copy first, then hand the original back.
  if (/^Copy target instant or sorcery spell, then return it to its owner's hand$/i.test(sentence)) {
    return {
      targetRequirements: [{ kind: "instant_or_sorcery_spell" }],
      effects: [
        { kind: "copy_spell", target: { type: "chosen", index: 0 } },
        { kind: "bounce_spell_or_permanent", target: { type: "chosen", index: 0 } },
      ],
    };
  }

  // Goreclaw's attack pump: the big team only.
  const bigTeam = sentence.match(
    /^each creature you control with power (\d+) or greater gets \+(\d+)\/\+(\d+) and gains ([a-z ]+) until end of turn$/i,
  );
  if (bigTeam?.[1] && bigTeam[2] && bigTeam[3] && bigTeam[4]) {
    const keyword = KEYWORD_GRANTS[bigTeam[4].trim().toLowerCase()];
    if (keyword) {
      const floor = Number(bigTeam[1]);
      return {
        targetRequirements: [],
        effects: [
          {
            kind: "team_pt_until_eot",
            playerId: "controller",
            power: Number(bigTeam[2]),
            toughness: Number(bigTeam[3]),
            minPower: floor,
          },
          { kind: "team_keyword_until_eot", playerId: "controller", keyword, minPower: floor },
        ],
      };
    }
  }

  /**
   * Reassembling Skeleton's self-reanimation body, and Bloodghast's, which
   * is the same clause with a permission in front of it.
   *
   * The permission is a DOCUMENTED AUTO-TAKE: `move_card` carries no
   * optional flag, and inventing one that nothing reads would be decoration.
   * Declining a free return from the graveyard is a real choice on paper —
   * a card kept back for delirium — and it is not modelled here.
   */
  const boneReturn = sentence.match(
    /^(?:You may )?[Rr]eturn (?:~|this card) from your graveyard to (the battlefield|your hand)( tapped)?$/i,
  );
  if (boneReturn?.[1]) {
    const toHand = /^your hand$/i.test(boneReturn[1]);
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "move_card",
          cardId: "self",
          toZone: toHand ? "hand" : "battlefield",
          ...(boneReturn[2] ? { entersTapped: true } : {}),
        },
      ],
    };
  }

  /**
   * Approach of the Second Sun, once the fuser has joined its two halves.
   * The win reads the per-name game tally and the zone the spell was cast
   * from; the else-branch puts the card back seventh from the top, which is
   * the one numeric library position any card names.
   */
  if (/^approach-second-sun$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "if_condition",
          condition: { kind: "cast_from_hand_and_another_named_this_game" },
          then: [{ kind: "win_game", playerId: "controller" }],
          otherwise: [
            {
              kind: "move_card",
              cardId: "self",
              toZone: "library",
              libraryPosition: { fromTop: 7 },
            },
            { kind: "gain_life", playerId: "controller", amount: 7 },
          ],
        },
      ],
    };
  }

  /**
   * Saw in Half's rider, once the fuser has joined it to the destruction it
   * follows. Two halves that pull in opposite directions: the halved P/T is
   * measured at BIND, while the creature is still on the battlefield to be
   * measured, and "if that creature dies this way" is asked at APPLY, after
   * the destruction either worked or was replaced.
   */
  if (
    /^saw-in-half-copies$/i.test(sentence)
  ) {
    return {
      targetRequirements: [],
      chosenBase: 1,
      effects: [
        {
          kind: "copy_token",
          ownerId: { type: "chosen_controller", index: 0 },
          ofCardId: { type: "chosen", index: 0 },
          count: 2,
          halvePtRoundUp: true,
          onlyIfDied: true,
        },
      ],
    };
  }

  /**
   * Eldritch Evolution. The cap is read from the creature the ADDITIONAL
   * COST already ate — captured on the stack when the cost was paid,
   * because by the time this binds nothing remembers which creature it
   * was. Only the offset is printed here.
   */
  const evolution = sentence.match(
    /^Search your library for a creature card with mana value X or less, where X is ([a-z0-9]+) plus the sacrificed creature's mana value(?:, put that card onto the battlefield, then shuffle)?$/i,
  );
  if (evolution?.[1]) {
    const offset = parseCount(evolution[1]);
    if (offset !== null && offset !== undefined) {
      return {
        targetRequirements: [],
        effects: [
          {
            kind: "search_library",
            playerId: "controller",
            filter: { types: ["creature"], maxManaValuePlusSacrificed: offset },
            destination: "battlefield",
            count: 1,
          },
        ],
      };
    }
  }

  /**
   * Brainstorm, and the fourteen other printings of its sentence. The cards
   * go back ONE AT A TIME — "in any order" is the order you pick them, and
   * `choose_card` picks one card — so N picks are emitted rather than one
   * choice of N. The last override in the registry was exactly this list;
   * the difficulty was never the vocabulary, only reading the sentence.
   */
  const drawThenTop = sentence.match(
    /^Draw ([a-z]+) cards?, then put ([a-z]+) cards? from your hand on top of your library(?: in any order)?$/i,
  );
  if (drawThenTop?.[1] && drawThenTop[2]) {
    const drawn = parseCount(drawThenTop[1]);
    const returned = parseCount(drawThenTop[2]);
    if (drawn && returned) {
      return {
        targetRequirements: [],
        effects: [
          { kind: "draw", playerId: "controller", count: drawn },
          ...Array.from({ length: returned }, () => ({
            kind: "choose_card" as const,
            chooserId: "controller" as const,
            sources: [
              { playerId: "controller" as const, zone: "hand" as const, filter: "any" as const },
            ],
            thenEffects: [
              {
                kind: "move_card" as const,
                cardId: "chosen_card" as const,
                toZone: "library" as const,
                libraryPosition: "top" as const,
              },
            ],
          })),
        ],
      };
    }
  }

  /**
   * Mechanized Production's upkeep body. The copy is of the ENCHANTED
   * permanent, which the copy selector already reaches as `"host"`, and the
   * win is counted at APPLY — the token this same ability just made is one
   * of the eight, so a bind-time count would always be one short.
   */
  const massProduction = sentence.match(
    /^create a token that's a copy of enchanted (artifact|creature|permanent), then if you control ([a-z]+) or more (artifact|creature|permanent)s with the same name as one another, you win the game$/i,
  );
  if (
    massProduction?.[1] &&
    massProduction[2] &&
    massProduction[3]?.toLowerCase() === massProduction[1].toLowerCase()
  ) {
    const atLeast = parseCount(massProduction[2]);
    if (atLeast) {
      return {
        targetRequirements: [],
        effects: [
          { kind: "copy_token", ownerId: "controller", ofCardId: "host" },
          {
            kind: "win_game",
            playerId: "controller",
            ifSameNameCount: { type: massProduction[1].toLowerCase(), atLeast },
          },
        ],
      };
    }
  }

  /**
   * Torment of Hailfire, once the fuser has joined the head to its process.
   * The body compiles on its own, so this only wraps it — an inner clause
   * that needs targets is refused, because the repetitions would all aim
   * at one set of targets chosen once.
   */
  const repeatX = sentence.match(/^Repeat-X (.+)$/);
  if (repeatX?.[1]) {
    const inner = compileSimpleClause(repeatX[1]);
    if (inner && !inner.leftover && inner.targetRequirements.length === 0) {
      return {
        targetRequirements: [],
        effects: [{ kind: "repeat_x_times", effects: inner.effects }],
      };
    }
    return null;
  }

  /**
   * "Each opponent loses N life unless that player sacrifices X or discards
   * a card" — the Braids shape: ONE choice over a pool spanning two zones,
   * `optional` so it can be declined, and the life loss as the punisher for
   * declining. The chosen card leaves the way its zone says, which is why
   * the sacrifice is not a plain `sacrifice`.
   */
  const hailfire = sentence.match(
    /^Each opponent loses (\w+) life unless that player sacrifices a (nonland permanent|creature|permanent) of their choice or discards a card$/i,
  );
  if (hailfire?.[1] && hailfire[2]) {
    const life = parseCount(hailfire[1]);
    const filter =
      hailfire[2].toLowerCase() === "nonland permanent"
        ? ("nonland" as const)
        : hailfire[2].toLowerCase() === "creature"
          ? ("creature" as const)
          : ("any" as const);
    if (life) {
      return {
        targetRequirements: [],
        effects: [
          {
            kind: "choose_card",
            chooserId: "each_opponent",
            sources: [
              { playerId: "each_opponent", zone: "battlefield", filter },
              { playerId: "each_opponent", zone: "hand", filter: "any" },
            ],
            optional: true,
            thenEffects: [
              { kind: "sacrifice_or_discard_chosen", cardId: "chosen_card" },
            ],
            thenEffectsIfNone: [
              { kind: "lose_life", playerId: { type: "subject_player" }, amount: life },
            ],
          },
        ],
      };
    }
  }

  // Return to Nature's third bullet, and Deathrite Shaman's three.
  const graveyardExile = sentence.match(/^Exile target (.+)$/i);
  const exiledFromGraveyard = graveyardExile?.[1]
    ? graveyardCardTarget(graveyardExile[1])
    : null;
  if (exiledFromGraveyard) {
    return {
      targetRequirements: [exiledFromGraveyard],
      effects: [{ kind: "move_card", cardId: { type: "chosen", index: 0 }, toZone: "exile" }],
    };
  }

  // Dramatic Reversal.
  if (/^Untap all nonland permanents you control$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [{ kind: "untap_all", playerId: "controller", what: "nonland" }],
    };
  }

  // Greater Good: the draw reads the sacrificed cost-creature's power. The
  // discard picks the hand's first cards (the looting clause's precedent).
  if (
    /^Draw cards equal to the sacrificed creature's power, then discard three cards$/i.test(
      sentence,
    )
  ) {
    return {
      targetRequirements: [],
      effects: [
        { kind: "draw", playerId: "controller", count: "sacrificed_power" },
        { kind: "discard", playerId: "controller", count: 3 },
      ],
    };
  }

  // Investigate (CR 701.13): a Clue token; the preset supplies its ability.
  if (/^investigate$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "create_token",
          ownerId: "controller",
          name: "Clue",
          typeLine: "Artifact — Clue Token",
          power: null,
          toughness: null,
        },
      ],
    };
  }

  // The Ozolith's combat trigger: the has-counters gate folds into the
  // apply (empty counters move nothing); the "may" is auto-taken.
  if (
    /^if ~ has counters on it, you may move all counters from ~ onto target creature$/i.test(
      sentence,
    )
  ) {
    return {
      targetRequirements: [{ kind: "creature" }],
      effects: [{ kind: "move_all_counters", cardId: "self", target: { type: "chosen", index: 0 } }],
    };
  }

  // Necropotence: "exile that card from your graveyard" — the discard
  // trigger's subject.
  if (/^exile that card from your graveyard$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [{ kind: "move_card", cardId: "subject_card", toZone: "exile" }],
    };
  }

  // No Mercy: "destroy it" in a trigger body is the trigger SUBJECT — the
  // creature the event was about — not anything targeted. Written as a
  // move to the graveyard because that is what destruction is here until
  // the destroy primitive lands; regeneration and totem armour are the
  // documented casualties of that, and they are named in CLAIMS.md.
  // Deliberately the PRONOUN only. "Exile that creature" is what an orphan
  // instant says with no earlier target to refer to, and wave 192 refuses
  // it on purpose — a clean miss beats an effect bound to nobody. "It"
  // after a trigger head always has the subject to point at.
  const subjectRemoval = sentence.match(/^(Destroy|Exile) it$/i);
  if (subjectRemoval?.[1]) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "move_card",
          cardId: "subject_card",
          toZone: subjectRemoval[1].toLowerCase() === "exile" ? "exile" : "graveyard",
        },
      ],
    };
  }

  // Necropotence's synthetic fused impulse (see fuseNecroTopInPlace).
  if (/^Necro-exile the top card of your library$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [{ kind: "exile_top_to_hand", playerId: "controller" }],
    };
  }

  // Living Death.
  if (
    /^Each player exiles all creature cards from their graveyard, then sacrifices all creatures they control, then puts all cards they exiled this way onto the battlefield$/i.test(
      sentence,
    )
  ) {
    return { targetRequirements: [], effects: [{ kind: "living_death" }] };
  }

  // Bolt Bend / Redirect Lightning: retarget variants. The single-target
  // restriction is dropped — the retarget prompt re-validates against the
  // spell's own requirements — a documented approximation. Abilities on the
  // stack can't be targeted (Deflecting Swat's precedent).
  if (
    /^Change the target of target spell or ability with a single target$/i.test(sentence) ||
    /^Change the target of target spell with a single target$/i.test(sentence) ||
    /^Change the target of target spell that targets only a single creature or player$/i.test(
      sentence,
    )
  ) {
    return {
      targetRequirements: [{ kind: "spell" }],
      effects: [{ kind: "retarget", target: { type: "chosen", index: 0 } }],
    };
  }

  // Hydroelectric Specimen: the same redirect, but the new target is named
  // by the card rather than chosen — so there is nothing to prompt for. The
  // "may" is auto-taken, the documented approximation used throughout.
  if (
    /^(?:you may )?change the target of target instant or sorcery spell with a single target to ~$/i.test(
      sentence,
    )
  ) {
    return {
      targetRequirements: [{ kind: "instant_or_sorcery_spell", singleTargetOnly: true }],
      effects: [{ kind: "retarget", target: { type: "chosen", index: 0 }, toSelf: true }],
    };
  }

  // Altar of Dementia: the mill reads the sacrificed cost-creature's power.
  if (/^Target player mills cards equal to the sacrificed creature's power$/i.test(sentence)) {
    return {
      targetRequirements: [{ kind: "player" }],
      effects: [
        { kind: "mill", playerId: { type: "chosen", index: 0 }, count: "sacrificed_power" },
      ],
    };
  }

  // Mystic Forge's exile activation.
  const exileTop = sentence.match(/^Exile the top (card|two cards|three cards) of your library$/i);
  if (exileTop?.[1]) {
    const word = exileTop[1].toLowerCase();
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "exile_top",
          playerId: "controller",
          count: word === "card" ? 1 : word.startsWith("two") ? 2 : 3,
        },
      ],
    };
  }

  // Springbloom Druid: the fused "you may sacrifice a land to do: X". The
  // take and the land pick are auto (documented approximations).
  const maySacDo = sentence.match(
    /^you may sacrifice (a land|another creature) to do: (.+)$/i,
  );
  if (maySacDo?.[1] && maySacDo[2]) {
    const inner = compileSimpleClause(
      maySacDo[2].charAt(0).toUpperCase() + maySacDo[2].slice(1),
    );
    if (inner && !inner.leftover && inner.targetRequirements.length === 0) {
      return {
        targetRequirements: [],
        effects: [
          {
            kind: "may_sacrifice",
            what:
              maySacDo[1].toLowerCase() === "a land"
                ? ("land" as const)
                : ("another_creature" as const),
            effects: inner.effects,
          },
        ],
      };
    }
  }

  // Curse of the Swine's first half compiles with its rider (see the pair
  // handler in the main loop); a bare variable exile also lands here.

  const amongMilled = compileFromAmongMilled(sentence);
  if (amongMilled) {
    return { targetRequirements: [], effects: amongMilled };
  }

  // Mentor of the Meek: the fused "you may pay {1} to do: draw a card".
  // Call of the Ring pays in life instead, and Ripples of Undeath in both.
  const mayPayDo = sentence.match(
    new RegExp(
      "^you may pay ((?:" +
        MANA_PIP_SOURCE +
        ")+)?(?: ?and )?(?:(" + DIGITS + ") life)? to do: (.+)$",
      "i",
    ),
  );
  if (mayPayDo && (mayPayDo[1] || mayPayDo[2]) && mayPayDo[3]) {
    const inner = compileSimpleClause(
      mayPayDo[3].charAt(0).toUpperCase() + mayPayDo[3].slice(1),
    );
    if (inner && !inner.leftover && inner.targetRequirements.length === 0) {
      const life = mayPayDo[2] ? Number(mayPayDo[2]) : undefined;
      return {
        targetRequirements: [],
        effects: [
          {
            kind: "may_pay",
            playerId: "controller",
            cost: mayPayDo[1] ?? "",
            ...(life === undefined ? {} : { life }),
            effects: inner.effects,
          },
        ],
      };
    }
  }

  // Wheel of Fortune: the refill is a fixed seven.
  const wheel = sentence.match(/^Each player discards their hand, then draws (seven|\d+) cards$/i);
  if (wheel?.[1]) {
    const refill = wheel[1].toLowerCase() === "seven" ? 7 : Number(wheel[1]);
    return { targetRequirements: [], effects: [{ kind: "windfall", drawCount: refill }] };
  }

  // Second Harvest.
  if (/^For each token you control, create a token that's a copy of that permanent$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [{ kind: "copy_each_token", playerId: "controller" }],
    };
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
  // Connive N (CR 702.148): draw N, discard N, and a +1/+1 counter for
  // each NONLAND card discarded that way. The third clause rides the
  // discard because its count is only known once the discard has run.
  /**
   * Spymaster's Vault: "Target creature you control connives X, where X is
   * the number of creatures that died this turn." Connive X is draw X,
   * discard X, and a +1/+1 counter per NONLAND card discarded (CR 702.148)
   * — the same three clauses as the plain form, with the count read off
   * the tally and the counters landing on the TARGET rather than the
   * source.
   */
  if (
    /^Target creature you control connives X, where X is the number of creatures that died this turn$/i.test(
      sentence,
    )
  ) {
    return {
      targetRequirements: [{ kind: "creature", control: "own" }],
      effects: [
        { kind: "draw", playerId: "controller", count: 0, countFromCreaturesDied: true },
        {
          kind: "discard",
          playerId: "controller",
          count: 0,
          countFromCreaturesDied: true,
          conniveCounterOn: { type: "chosen", index: 0 },
        },
      ],
    };
  }

  const connives = sentence.match(/^~ connives$/i);
  if (connives) {
    return {
      targetRequirements: [],
      effects: [
        { kind: "draw", playerId: "controller", count: 1 },
        { kind: "discard", playerId: "controller", count: 1, conniveCounterOn: "self" },
      ],
    };
  }

  if (/^target opponent loses that much life$/i.test(sentence)) {
    return {
      targetRequirements: [{ kind: "opponent" }],
      effects: [
        { kind: "lose_life", playerId: { type: "chosen", index: 0 }, amount: "subject_amount" },
      ],
    };
  }

  // Marionette Master: the amount is the SOURCE's power, not the trigger's
  // subject. "That much" above reads what the event carried; this reads the
  // permanent whose ability is resolving.
  if (/^target opponent loses life equal to ~'s power$/i.test(sentence)) {
    return {
      targetRequirements: [{ kind: "opponent" }],
      effects: [
        { kind: "lose_life", playerId: { type: "chosen", index: 0 }, amount: "source_power" },
      ],
    };
  }

  // Wound Reflection: each opponent loses what THEY lost, so the amount is
  // per-player and resolves after the each-opponent expansion picks one.
  if (/^each opponent loses life equal to the life they lost this turn$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [
        { kind: "lose_life", playerId: "each_opponent", amount: "own_life_lost_this_turn" },
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

  // "Target player draws two cards, then discards two cards" (Prismari
  // Command) — the same loot aimed at a chosen player.
  const targetedLoot = sentence.match(
    /^Target (player|opponent) draws (a|an|one|two|three|four|\d+) cards?, then discards (a|an|one|two|three|four|\d+) cards?$/i,
  );
  if (targetedLoot?.[1] && targetedLoot[2] && targetedLoot[3]) {
    const drawn = parseCount(targetedLoot[2]);
    const discarded = parseCount(targetedLoot[3]);
    if (drawn && discarded) {
      const chosen = { type: "chosen", index: 0 } as const;
      return {
        targetRequirements: [
          { kind: targetedLoot[1].toLowerCase() === "opponent" ? "opponent" : "player" },
        ],
        effects: [
          { kind: "draw", playerId: chosen, count: drawn },
          { kind: "discard", playerId: chosen, count: discarded },
        ],
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
  // Last March of the Ents asks the same question about toughness, so the
  // axis is a capture rather than a second pattern.
  match = sentence.match(
    /^Draw cards equal to the greatest (power|toughness) among (?:non-([A-Za-z]+) )?creatures you control$/i,
  );
  if (match?.[1]) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "draw",
          playerId: "controller",
          count: 0,
          countFromGreatestPower: {
            ...(match[2] ? { nonSubtypes: [match[2].toLowerCase()] } : {}),
            ...(match[1].toLowerCase() === "toughness"
              ? { stat: "toughness" as const }
              : {}),
          },
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

  // Aether Channeler's bounce mode.
  const nonlandBounce = sentence.match(
    /^Return (another )?target nonland permanent to its owner's hand$/i,
  );
  if (nonlandBounce) {
    return {
      targetRequirements: [
        { kind: "nonland_permanent", ...(nonlandBounce[1] ? { excludeSource: true } : {}) },
      ],
      effects: [{ kind: "move_card", cardId: { type: "chosen", index: 0 }, toZone: "hand" }],
    };
  }

  // Charming Prince's third mode, fused: exile now, return at end step.
  const flickerSelf = sentence.match(/^flicker-delay-self( tapped)?$/i);
  if (flickerSelf) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "exile_return_end_step",
          self: true,
          ...(flickerSelf[1] ? { returnsTapped: true } : {}),
        },
      ],
    };
  }

  const flickerDelay = sentence.match(/^flicker-delay (another )?target creature you own$/i);
  if (flickerDelay) {
    return {
      targetRequirements: [
        {
          kind: "creature",
          owner: "own",
          ...(flickerDelay[1] ? { excludeSource: true } : {}),
        },
      ],
      effects: [{ kind: "exile_return_end_step", target: { type: "chosen", index: 0 } }],
    };
  }

  // Jarad, Susur Secundi: the same fodder-power payout, but from an
  // ACTIVATION cost rather than a clause. That path already captures the
  // power as the cost is paid, so these need no plumbing — only the words.
  if (
    /^Each opponent loses life equal to the sacrificed creature's power$/i.test(sentence)
  ) {
    return {
      targetRequirements: [],
      effects: [
        { kind: "lose_life", playerId: "each_opponent", amount: "sacrificed_power" },
      ],
    };
  }
  if (/^Draw cards equal to the sacrificed creature's power$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [{ kind: "draw", playerId: "controller", count: "sacrificed_power" }],
    };
  }

  // Disciple of Bolas: the payout is the power of the creature the
  // preceding clause is about to sacrifice, which only the choose_card
  // resolution knows. foldSacrificeRider moves this into thenEffects so it
  // binds with that context; on its own it would bind against the trigger,
  // where sacrificedPower is undefined and the payout would be zero.
  if (/^You gain X life and draw X cards, where X is that creature's power$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [
        { kind: "gain_life", playerId: "controller", amount: "sacrificed_power" },
        { kind: "draw", playerId: "controller", count: "sacrificed_power" },
      ],
    };
  }

  // Deepglow Skate: every kind of counter, on every chosen target.
  if (
    /^double the number of each kind of counter on any number of target permanents$/i.test(
      sentence,
    )
  ) {
    return {
      targetRequirements: [{ kind: "permanent", variable: true }],
      effects: [{ kind: "double_all_counters", cardIds: [], allChosen: true }],
    };
  }

  // Guardian of Faith, Clever Concealment: a variable number of targets,
  // all phased out together. `variable` already means 1..N chosen targets
  // matching one requirement, so this needs no new target shape — only a
  // form of the effect that takes every target rather than fixed slots.
  const phaseOutMany = sentence.match(
    /^Any number of (other )?target (creatures|nonland permanents) you control phase out$/i,
  );
  if (phaseOutMany?.[2]) {
    return {
      targetRequirements: [
        {
          kind:
            phaseOutMany[2].toLowerCase() === "creatures"
              ? ("creature" as const)
              : ("nonland_permanent" as const),
          control: "own" as const,
          variable: true,
          ...(phaseOutMany[1] ? { excludeSource: true } : {}),
        },
      ],
      effects: [{ kind: "phase_out", cardIds: [], allChosen: true }],
    };
  }

  /**
   * Growing Rites of Itlimoc, Ojer Taq: "Transform this permanent", from a
   * trigger body or from an activation. The effect had an apply path, a
   * binder and a serializer already; nothing had ever compiled into it.
   */
  if (
    /^Transform (?:~|this (?:card|creature|enchantment|artifact|land|permanent|token))$/i.test(
      sentence,
    )
  ) {
    return {
      targetRequirements: [],
      effects: [{ kind: "transform", cardId: "self" }],
    };
  }

  // Talon Gates of Madara: ONE target phases out, where the clause above
  // takes any number. The noun phrase goes through the shared grammar, so
  // "up to one target creature" and "another target permanent you control"
  // come along for free and an unreadable qualifier is still a clean miss.
  const phaseOutOne = sentence.match(/^(.+?) phases out$/i);
  const phasedRequirement = phaseOutOne?.[1]
    ? parseSimpleTargetPhrase(phaseOutOne[1])
    : null;
  if (phasedRequirement) {
    return {
      targetRequirements: [phasedRequirement],
      effects: [{ kind: "phase_out", cardIds: [{ type: "chosen", index: 0 }] }],
    };
  }

  // Eerie Interlude, fused: every chosen creature blinks home at end step.
  if (/^flicker-delay-mass your creatures$/i.test(sentence)) {
    return {
      targetRequirements: [{ kind: "creature", control: "own", variable: true }],
      effects: [{ kind: "exile_return_end_step_all" }],
    };
  }

  // Junji's reanimation mode.
  const nonSubReanimate = sentence.match(
    /^Put target non-([A-Za-z]+) creature card from a graveyard onto the battlefield under your control$/i,
  );
  if (nonSubReanimate?.[1]) {
    return {
      targetRequirements: [
        { kind: "graveyard_creature_card", excludedSubtypes: [nonSubReanimate[1].toLowerCase()] },
      ],
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

  // Traverse the Outlands, fused.
  if (/^traverse-basics to battlefield tapped$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "search_library",
          playerId: "controller",
          filter: { supertypes: ["basic"], types: ["land"] },
          destination: "battlefield",
          count: 0,
          entersTapped: true,
          countFromGreatestPower: true,
        },
      ],
    };
  }

  // Adapt (CR 701.46 — Evolution Witness).
  const adapt = sentence.match(/^Adapt (\d+)$/i);
  if (adapt?.[1]) {
    return {
      targetRequirements: [],
      effects: [{ kind: "adapt", cardId: "self", amount: Number(adapt[1]) }],
    };
  }

  // Gingerbrute: the hasty-blocker exception is dropped — a documented
  // approximation (unblockable this turn).
  if (/^~ can't be blocked this turn except by creatures with haste$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [{ kind: "restrict_until_eot", cardId: "self", cantBeBlocked: true }],
    };
  }

  // Karlach: everyone's attackers untap and swing again.
  if (/^untap all attacking creatures$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [{ kind: "untap_all", playerId: "controller", what: "attacking" }],
    };
  }

  // Dreadhorde Invasion's trigger body: the attacker rewards itself.
  const subjectGains = sentence.match(/^it gains ([a-z ]+) until end of turn$/i);
  if (subjectGains?.[1]) {
    const granted = KEYWORD_GRANTS[subjectGains[1].trim().toLowerCase()];
    if (granted) {
      return {
        targetRequirements: [],
        effects: [{ kind: "keyword_until_eot", cardId: "subject_card", keyword: granted }],
      };
    }
  }

  // Dreadhorde Invasion's upkeep body.
  const loseAmass = sentence.match(/^you lose (\d+) life and amass ([A-Za-z]+) (\d+)$/i);
  if (loseAmass?.[1] && loseAmass[2] && loseAmass[3]) {
    return {
      targetRequirements: [],
      effects: [
        { kind: "lose_life", playerId: "controller", amount: Number(loseAmass[1]) },
        {
          kind: "amass",
          playerId: "controller",
          amount: Number(loseAmass[3]),
          subtype: loseAmass[2],
        },
      ],
    };
  }

  // The Great Henge's trigger body: the counter lands on the entering subject.
  if (/^put a \+1\/\+1 counter on it and draw a card$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [
        { kind: "add_counter", cardId: "subject_card", counter: "p1p1", amount: 1 },
        { kind: "draw", playerId: "controller", count: 1 },
      ],
    };
  }

  // Power Fist: "that many" is the combat damage the trigger just carried,
  // and "it" is the creature that dealt it.
  if (/^put that many \+1\/\+1 counters on it$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [
        { kind: "add_counter", cardId: "subject_card", counter: "p1p1", amount: "subject_amount" },
      ],
    };
  }

  // The Skullspore Nexus's activation.
  if (
    /^Double target creature's power until end of turn$/i.test(sentence) ||
    // Unleash Fury prints the same effect with the noun phrase moved.
    /^Double the power of target creature until end of turn$/i.test(sentence)
  ) {
    return {
      targetRequirements: [{ kind: "creature" }],
      effects: [
        {
          kind: "pt_until_eot",
          cardId: { type: "chosen", index: 0 },
          power: "target_power",
          toughness: 0,
        },
      ],
    };
  }

  // Junji's other mode.
  const massDiscardDrain = sentence.match(
    /^Each opponent discards (a|one|two|three) cards? and loses (\d+) life$/i,
  );
  if (massDiscardDrain?.[1] && massDiscardDrain[2]) {
    const count = parseCount(massDiscardDrain[1]);
    if (count) {
      return {
        targetRequirements: [],
        effects: [
          { kind: "discard", playerId: "each_opponent", count },
          { kind: "lose_life", playerId: "each_opponent", amount: Number(massDiscardDrain[2]) },
        ],
      };
    }
  }

  // Retreat to Coralhelm: toggling is always the useful half of the choice —
  // a documented approximation. The "may" is the up-to-one optional slot.
  if (/^You may tap or untap target creature$/i.test(sentence)) {
    return {
      targetRequirements: [{ kind: "creature", optional: true }],
      effects: [{ kind: "tap_or_untap", cardId: { type: "chosen", index: 0 } }],
    };
  }

  // Felidar Retreat's second mode sentence: the counters just went on each
  // creature you control, so "those creatures" is the controller's team.
  const thoseGain = sentence.match(
    /^Those creatures gain ([a-z]+) until (end of turn|your next turn)$/i,
  );
  if (thoseGain?.[1]) {
    const keyword = KEYWORD_GRANTS[thoseGain[1].toLowerCase()];
    if (keyword) {
      // Elspeth's grant outlives the turn it was made on, which is most of
      // why the ability is worth a loyalty activation at all.
      const untilNextTurn = /your next turn/i.test(thoseGain[2] ?? "");
      return {
        targetRequirements: [],
        effects: [
          {
            kind: "team_keyword_until_eot",
            playerId: "controller",
            keyword,
            ...(untilNextTurn ? { untilYourNextTurn: true } : {}),
          },
        ],
      };
    }
  }

  // "Put X +1/+1 counters on target creature you control, where X is the
  // number of cards you've drawn this turn minus one" (Proft's Eidetic
  // Memory). This X is a live count, not a spell's announced X, so it reads
  // through the shared DYNAMIC_COUNTS table rather than the cast-time value.
  // It is checked before the ordinary counter grammar because the trailing
  // "where X is …" clause is part of the subject phrase as far as that
  // grammar can see, and would make the subject unparseable.
  const scaledCounters = sentence.match(
    /^put X ([+-]\d\/[+-]\d|[a-z]+) counters? on (.+?), where X is the number of (.+?)( minus one)?$/i,
  );
  if (scaledCounters?.[1] && scaledCounters[2] && scaledCounters[3]) {
    const per = parseDynamicCount(scaledCounters[3]);
    const requirement = per ? parseSimpleTargetPhrase(scaledCounters[2].trim()) : null;
    if (per && requirement) {
      return {
        targetRequirements: [requirement],
        effects: [
          {
            kind: "add_counter",
            cardId: { type: "chosen", index: 0 },
            counter: counterKeyOf(scaledCounters[1]),
            amount: 1,
            perDynamicCount: per,
            ...(scaledCounters[4] ? { dynamicOffset: -1 } : {}),
          },
        ],
      };
    }
  }

  // "Put a +1/+1 counter on target creature", "Put a -1/-1 counter on each
  // creature your opponents control", "Put a +1/+1 counter, a reach counter,
  // and a deathtouch counter on target creature" — the counter list and the
  // subject are read separately, so a new wording is neither a new branch nor
  // a new effect.
  const counterPlacement = sentence.match(/^put (.+?) counters? on (.+)$/i);
  const placed = counterPlacement?.[1] ? parseCounterList(counterPlacement[1]) : null;
  if (placed && counterPlacement?.[2]) {
    const where = counterPlacement[2].toLowerCase().trim();
    const eachTeam = where.match(/^each creature (you control|your opponents control)$/);
    if (eachTeam?.[1]) {
      return {
        targetRequirements: [],
        effects: placed.map((entry) => ({
          kind: "counter_on_each_creature",
          counter: entry.counter,
          amount: entry.amount,
          ...(eachTeam[1] === "you control"
            ? { controlledOnly: true }
            : { opponentsOnly: true }),
        })),
      };
    }
    // Oran-Rief, the Vastwood: "each green creature that entered this turn".
    // Both riders narrow the same team effect, and neither restricts the
    // creature to one controller — an opponent's green creature that came
    // down this turn gets a counter too, which is what the card says.
    const eachFresh = where.match(
      /^each (white|blue|black|red|green )?creature that entered this turn$/,
    );
    if (eachFresh) {
      const color = eachFresh[1] ? COLOR_WORDS[eachFresh[1].trim()] : undefined;
      return {
        targetRequirements: [],
        effects: placed.map((entry) => ({
          kind: "counter_on_each_creature",
          counter: entry.counter,
          amount: entry.amount,
          ...(color ? { colors: [color] } : {}),
          enteredThisTurn: true,
        })),
      };
    }
    // "each Vampire you control" (Cordial Vampire) — the same team effect as
    // "each creature you control", narrowed to one subtype.
    const eachTribe = counterPlacement[2].trim().match(/^each ([A-Z][a-z-]+) you control$/);
    if (eachTribe?.[1]) {
      return {
        targetRequirements: [],
        effects: placed.map((entry) => ({
          kind: "counter_on_each_creature",
          counter: entry.counter,
          amount: entry.amount,
          subtype: eachTribe[1]!.toLowerCase(),
          controlledOnly: true,
        })),
      };
    }
    // "~" is the source; "it" is the trigger's subject; "equipped creature"
    // and "enchanted creature" are whatever this permanent is attached to.
    const selfLike =
      where === "~"
        ? ("self" as const)
        : where === "it"
          ? ("subject_card" as const)
          : /^(?:equipped|enchanted) creature$/.test(where)
            ? ("host" as const)
            : null;
    if (selfLike) {
      return {
        targetRequirements: [],
        effects: placed.map((entry) => ({
          kind: "add_counter",
          cardId: selfLike,
          counter: entry.counter,
          amount: entry.amount,
        })),
      };
    }
    const requirement = parseSimpleTargetPhrase(where);
    if (requirement) {
      return {
        targetRequirements: [requirement],
        effects: placed.map((entry) => ({
          kind: "add_counter",
          cardId: { type: "chosen", index: 0 },
          counter: entry.counter,
          amount: entry.amount,
        })),
      };
    }
  }

  // "you may attach ~ to it" (Hero's Blade), "you may attach that Equipment
  // to target creature you control" (Hammer of Nazahn). Attaching is never a
  // downside a casual table would decline, so the "may" is auto-taken — the
  // same documented approximation the other may-clauses here use.
  const attachClause = sentence.match(
    /^(?:you may )?attach (~|that Equipment|that Aura|it) to (.+)$/i,
  );
  if (attachClause?.[1] && attachClause[2]) {
    const what = attachClause[1].toLowerCase();
    const cardId = what === "~" ? ("self" as const) : ("subject_card" as const);
    const to = attachClause[2].trim();
    if (/^it$/i.test(to)) {
      // Both halves cannot be the trigger's subject; "attach ~ to it" is the
      // only shape that reads this way.
      if (cardId === "self") {
        return {
          targetRequirements: [],
          effects: [{ kind: "attach", cardId, toId: "subject_card" }],
        };
      }
    } else {
      const requirement = parseSimpleTargetPhrase(to);
      if (requirement) {
        return {
          targetRequirements: [requirement],
          effects: [{ kind: "attach", cardId, toId: { type: "chosen", index: 0 } }],
        };
      }
    }
  }

  const tokenCopy = sentence.match(
    /^create a token that's a copy of (another )?target (artifact or creature|creature)( you control)?(?:, except (.+))?$/i,
  );
  const tokenCopyRiders =
    tokenCopy?.[4] === undefined ? {} : parseCopyExceptRiders(tokenCopy[4]);
  if (tokenCopy?.[2] && tokenCopyRiders) {
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
        {
          kind: "copy_token",
          ownerId: "controller",
          ofCardId: { type: "chosen", index: 0 },
          ...(tokenCopyRiders.notLegendary ? { notLegendary: true } : {}),
        },
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

  /**
   * Inkshield, once the fuser has joined the shield to its token rider. One
   * player's fog rather than the table's, and it counts what it stopped —
   * the tokens are made off exactly that number.
   */
  if (/^inkshield-fog$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "fog",
          forPlayerId: "controller",
          tokenPerDamage: {
            kind: "create_token",
            ownerId: "controller",
            name: "Inkling",
            typeLine: "Creature — Inkling Token",
            power: 2,
            toughness: 1,
            colors: ["W", "B"],
            keywords: ["flying"],
          },
        },
      ],
    };
  }

  // A personal fog on its own, which is the half of Inkshield every other
  // card in that family prints alone.
  if (
    /^prevent all combat damage that would be dealt to you this turn$/i.test(sentence)
  ) {
    return {
      targetRequirements: [],
      effects: [{ kind: "fog", forPlayerId: "controller" }],
    };
  }

  // Documented auto-take: "you may destroy/exile target X" compiles as the
  // mandatory form — trigger targeting already skips with no legal target.
  const mayTargeted = sentence.match(/^you may (destroy|exile) target (.+)$/i);
  if (mayTargeted?.[1] && mayTargeted[2]) {
    return compileSimpleClause(`${mayTargeted[1]} target ${mayTargeted[2]}`);
  }

  // The Ring tempts you (CR 701.52). One sentence, four cumulative
  // abilities — see `applyRingBearerAbilitiesInPlace`.
  if (/^the Ring tempts you$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [{ kind: "ring_tempts", playerId: "controller" }],
    };
  }

  if (/^proliferate$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [{ kind: "proliferate", playerId: "controller" }],
    };
  }

  /**
   * Ripples of Potential, once the fuser has joined its two sentences. The
   * phase-out rides the proliferate because the set it names — permanents
   * that got a counter THIS WAY — exists only inside that effect.
   */
  if (/^ripples-proliferate-phase$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [
        { kind: "proliferate", playerId: "controller", thenPhaseOutTouched: true },
      ],
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

  // Sword of Feast and Famine's saboteur body.
  if (/^that player discards a card and you untap all lands you control$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [
        { kind: "discard", playerId: { type: "subject_player" }, count: 1 },
        { kind: "untap_all", playerId: "controller", what: "land" },
      ],
    };
  }

  // Sword of Fire and Ice's saboteur body.
  match = sentence.match(
    /^(?:~|this Equipment) deals (\d+) damage to any target and you draw a card$/i,
  );
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
        { kind: "draw", playerId: "controller", count: 1 },
      ],
    };
  }

  // Bloodforged Battle-Axe multiplies itself.
  if (/^create a token that's a copy of (?:~|this Equipment)$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [{ kind: "copy_token", ownerId: "controller", ofCardId: "self" }],
    };
  }

  // Helm of the Host: "a copy of EQUIPPED creature". The `host` selector
  // already reads `attachedTo`, which is the same field an Aura's
  // "enchanted creature" resolves through — an Equipment attaches the
  // same way. The except-riders and the trailing "That token gains haste"
  // are both already understood, so only the subject was missing.
  const equippedCopy = sentence.match(
    /^create a token that's a copy of (?:equipped|enchanted) creature(?:, except (.+))?$/i,
  );
  const equippedRiders =
    equippedCopy?.[1] === undefined ? {} : parseCopyExceptRiders(equippedCopy[1]);
  if (equippedCopy && equippedRiders) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "copy_token",
          ownerId: "controller",
          ofCardId: "host",
          ...(equippedRiders.notLegendary ? { notLegendary: true } : {}),
        },
      ],
    };
  }

  // Herald's Horn: "look at the top card of your library. If it's a
  // creature card of the chosen type, you may reveal it and put it into
  // your hand." Fused into one clause because the condition names the
  // card the first half looked at, which no separate sentence can reach.
  const hornLook = sentence.match(
    /^look at the top card of your library, and if it's an? (creature) card of the chosen type, you may reveal it and put it into your hand$/i,
  );
  if (hornLook?.[1]) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "look_top_take_matching",
          playerId: "controller",
          filter: { types: [hornLook[1].toLowerCase()] },
          chosenSubtypeOfSource: true,
        },
      ],
    };
  }

  // Mosswort Bridge's activated half. The gate rides the ABILITY rather
  // than the effect, so an unmet condition offers nothing at all instead
  // of offering an activation that resolves to nothing.
  const playHidden = sentence.match(
    /^You may play the exiled card without paying its mana cost(?: if (.+))?$/i,
  );
  if (playHidden) {
    const gate = playHidden[1] ? parseEffectCondition(playHidden[1].trim()) : null;
    // A condition we cannot read must not be dropped: the ability would
    // then be activatable whenever, which is a wrong game rather than an
    // uncompiled one.
    if (!playHidden[1] || gate) {
      return {
        targetRequirements: [],
        effects: [{ kind: "play_hidden_card", free: true }],
        ...(gate ? { activationGate: gate } : {}),
      };
    }
  }

  // "A creature destroyed this way can't be regenerated." Regeneration
  // is not implemented anywhere in this engine — there is no shield to
  // deny — so the sentence is genuinely vacuous rather than approximated.
  // If regeneration ever lands, this must become a real flag.
  if (
    /^A creature destroyed this way can't be regenerated$/i.test(sentence) ||
    /^Creatures destroyed this way can't be regenerated$/i.test(sentence)
  ) {
    return { targetRequirements: [], effects: [] };
  }

  // Selvala: "its controller may draw a card" — the controller of the
  // creature the trigger watched, not the ability's own controller.
  const subjectControllerDraws = sentence.match(
    /^its controller (?:may )?draws? (a|an|one|two|three|\d+) cards?$/i,
  );
  if (subjectControllerDraws?.[1]) {
    const count = parseCount(subjectControllerDraws[1]);
    if (count) {
      return {
        targetRequirements: [],
        effects: [
          {
            kind: "draw",
            playerId: { type: "subject_player" },
            count,
            ...(/may/i.test(sentence) ? { optional: true } : {}),
          },
        ],
      };
    }
  }

  // Setessan Champion's constellation body.
  if (/^put a \+1\/\+1 counter on (?:~|this creature) and draw a card$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [
        { kind: "add_counter", cardId: "self", counter: "+1/+1", amount: 1 },
        { kind: "draw", playerId: "controller", count: 1 },
      ],
    };
  }

  // "Gain control of target nonland permanent with mana value 1 or less"
  // (Archmage's Charm) — the subject is the ordinary target noun phrase.
  const takeControl = sentence.match(/^Gain control of ((?:up to one |another )?target .+)$/i);
  if (takeControl?.[1]) {
    const requirement = parseSimpleTargetPhrase(takeControl[1]);
    if (requirement) {
      return {
        targetRequirements: [requirement],
        effects: [
          { kind: "gain_control", cardId: { type: "chosen", index: 0 }, playerId: "controller" },
        ],
      };
    }
  }

  // Hellkite Tyrant: "gain control of all artifacts that player controls" —
  // "that player" is the trigger's subject, so this only compiles in a body
  // that has one.
  const takeControlOfTheirs = sentence.match(
    /^gain control of all (artifacts|creatures|permanents) that player controls$/i,
  );
  if (takeControlOfTheirs?.[1]) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "gain_control_all",
          playerId: "controller",
          what: takeControlOfTheirs[1].toLowerCase() as ControlAllScope,
          fromId: { type: "subject_player" },
        },
      ],
    };
  }

  // Homeward Path: everyone takes their own things back.
  const restore = sentence.match(
    /^Each player gains control of all (creatures|artifacts|permanents) they own$/i,
  );
  if (restore?.[1]) {
    return {
      targetRequirements: [],
      effects: [{ kind: "restore_control", what: restore[1].toLowerCase() as ControlAllScope }],
    };
  }

  // Goad (CR 701.38). Disrupt Decorum says the keyword; Kardur spells the
  // same thing out longhand, so both land on one effect rather than the
  // longhand becoming a second, subtly different mechanic.
  if (
    /^Goad all creatures you don't control$/i.test(sentence) ||
    /^until your next turn, creatures your opponents control attack each combat if able and attack a player other than you if able$/i.test(
      sentence,
    )
  ) {
    return { targetRequirements: [], effects: [{ kind: "goad_all" }] };
  }

  // Bident of Thassa: the must-attack half of goad with no say in the
  // defender, so it is NOT goad — a creature under it may still attack you.
  if (/^Creatures your opponents control attack this turn if able$/i.test(sentence)) {
    return { targetRequirements: [], effects: [{ kind: "must_attack_all" }] };
  }

  const tapAll = sentence.match(
    /^Tap all (creatures|lands) (you control|your opponents control)$/i,
  );
  if (tapAll?.[1] && tapAll[2]) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "tap_all",
          playerId: /^you control$/i.test(tapAll[2]) ? "controller" : "each_opponent",
          what: tapAll[1].toLowerCase() === "creatures" ? "creature" : "land",
        },
      ],
    };
  }

  // "Untap all creatures" without a "you control" is EVERYONE's, which is
  // the whole point of Insurrection: it unlocks the board it is about to
  // take. The optional tail is one sentence in print and stays one clause
  // here, because "them" refers back to what was just untapped.
  const untapEveryone = sentence.match(
    /^untap all creatures(?: and gain control of them until end of turn)?$/i,
  );
  if (untapEveryone) {
    const steals = /gain control/i.test(sentence);
    return {
      targetRequirements: [],
      effects: [
        { kind: "untap_all", playerId: "each_player", what: "creature" },
        ...(steals
          ? [
              {
                kind: "gain_control_all" as const,
                playerId: "controller" as const,
                what: "creatures" as const,
                untilEot: true,
              },
            ]
          : []),
      ],
    };
  }

  // Without a `fromId` the steal covers the whole table (Mass Mutiny's
  // "all creatures", as against Hellkite Tyrant's "that player controls").
  if (/^gain control of all creatures until end of turn$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "gain_control_all",
          playerId: "controller",
          what: "creatures",
          untilEot: true,
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

  // Archaeomancer / Mystic Sanctuary-class recursion.
  if (
    /^return target instant or sorcery card from your graveyard to your hand$/i.test(sentence)
  ) {
    return {
      targetRequirements: [{ kind: "own_graveyard_instant_or_sorcery_card" }],
      effects: [{ kind: "move_card", cardId: { type: "chosen", index: 0 }, toZone: "hand" }],
    };
  }

  // Ponder's tail: the reorder just happened via look-and-assign; the
  // optional shuffle is auto-declined — a documented approximation.
  if (/^You may shuffle$/i.test(sentence)) {
    return { targetRequirements: [], effects: [] };
  }

  // Fathom Mage's body: the "may" is auto-taken (documented).
  if (/^you may draw a card$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [{ kind: "draw", playerId: "controller", count: 1, optional: true }],
    };
  }

  // Soul's Attendant: the "may" is auto-taken (documented, like may-draw).
  const mayGain = sentence.match(/^you may gain (\d+|a|an|one|two|three) life$/i);
  if (mayGain?.[1]) {
    const amount = parseCount(mayGain[1]);
    if (amount) {
      return {
        targetRequirements: [],
        effects: [{ kind: "gain_life", playerId: "controller", amount }],
      };
    }
  }

  // Elspeth, Sun's Champion's −3.
  // The general sweep: "Destroy all X", "Exile all X", and the compound
  // "Destroy all X and all Y" (In Garruk's Wake). Runs after the narrower
  // sweep branches above, so nothing they already claim changes shape.
  const sweep = sentence.match(/^(Destroy|Exile) all (.+)$/i);
  if (sweep?.[1] && sweep[2]) {
    const halves = sweep[2].split(/\s+and all\s+/i);
    const parsed = halves.map((half) => parseSweepPhrase(half));
    if (parsed.every((entry): entry is Omit<SweepFilters, "kind"> => entry !== null)) {
      const exile = /^Exile$/i.test(sweep[1]);
      return {
        // Fell the Mighty names a creature whose power sets the bar.
        targetRequirements: parsed.some((entry) => entry.minPowerAboveTarget !== undefined)
          ? [{ kind: "creature" }]
          : [],
        effects: parsed.map((entry) => ({
          kind: "destroy_all",
          ...entry,
          ...(exile ? { toZone: "exile" as const } : {}),
        })),
      };
    }
  }

  const powerSweep = sentence.match(/^Destroy all creatures with power (\d+) or greater$/i);
  if (powerSweep?.[1]) {
    return {
      targetRequirements: [],
      effects: [
        { kind: "destroy_all", what: "creatures", minPower: Number(powerSweep[1]) },
      ],
    };
  }

  // "You get an emblem with ..." — the quoted grant becomes statics on a
  // battlefield emblem object (a documented approximation of CR 114).
  const emblem = sentence.match(
    /^You get an emblem with "Creatures you control get \+(\d+)\/\+(\d+)(?: and have ([a-z]+))?\.?"$/i,
  );
  if (emblem?.[1] && emblem[2]) {
    const granted = emblem[3] ? KEYWORD_GRANTS[emblem[3].toLowerCase()] : undefined;
    if (!emblem[3] || granted) {
      return {
        targetRequirements: [],
        effects: [
          {
            kind: "create_emblem",
            ownerId: "controller",
            statics: [
              {
                selector: { scope: "controlled", types: ["creature"] },
                effect: {
                  kind: "modify_pt",
                  power: Number(emblem[1]),
                  toughness: Number(emblem[2]),
                },
              },
              ...(granted
                ? [
                    {
                      selector: { scope: "controlled" as const, types: ["creature"] },
                      effect: { kind: "grant_keyword" as const, keyword: granted },
                    },
                  ]
                : []),
            ],
          },
        ],
      };
    }
  }

  // The d20 dragons, fused: "roll a d20" + "You create a number of Treasure
  // tokens equal to the result".
  if (/^roll a d20 for Treasures$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [{ kind: "roll_die_treasures", playerId: "controller", sides: 20 }],
    };
  }

  // The trailing "gaining N life if it is a <Subtype>" is Spelunking's
  // fused rider (see `fusePutLandRiderInPlace`): it reads the card this
  // clause just chose, so it belongs inside the same choice.
  const putLand = sentence.match(
    /^you may put a land card from your hand onto the battlefield( tapped)?(?: gaining (\d+) life if it is an? ([A-Za-z-]+))?$/i,
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
            ...(putLand[2] && putLand[3]
              ? [
                  {
                    kind: "if_condition" as const,
                    condition: {
                      kind: "chosen_has_subtype" as const,
                      subtype: putLand[3].toLowerCase(),
                    },
                    then: [
                      {
                        kind: "gain_life" as const,
                        playerId: "controller" as const,
                        amount: Number(putLand[2]),
                      },
                    ],
                  },
                ]
              : []),
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
    sentence.match(/^Counter target (white|blue|black|red|green|multicolored) spell$/i) ??
    sentence.match(/^Counter target spell if it's (white|blue|black|red|green|multicolored)$/i);
  if (match?.[1]) {
    return {
      targetRequirements: [{ kind: "spell", ...colorQualifierOf(match[1]) }],
      effects: [{ kind: "counter_spell", target: { type: "chosen", index: 0 } }],
    };
  }

  match =
    sentence.match(/^Destroy target (white|blue|black|red|green|multicolored) permanent$/i) ??
    sentence.match(/^Destroy target permanent if it's (white|blue|black|red|green|multicolored)$/i);
  if (match?.[1]) {
    return {
      targetRequirements: [{ kind: "permanent", ...colorQualifierOf(match[1]) }],
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

  // Strionic Resonator: the same copy, aimed at an ABILITY on the stack.
  if (/^copy target triggered ability you control$/i.test(sentence)) {
    return {
      targetRequirements: [{ kind: "triggered_ability_you_control" }],
      effects: [{ kind: "copy_spell", target: { type: "chosen", index: 0 } }],
    };
  }

  // Spellskite: "a target", not "the target" — any one slot the source fits,
  // and no single-target restriction. The "may" is the activation itself.
  if (
    /^change a target of target spell or ability to ~$/i.test(sentence) ||
    /^change the target of target spell or ability to ~$/i.test(sentence)
  ) {
    return {
      targetRequirements: [{ kind: "spell_or_ability" }],
      effects: [{ kind: "retarget", target: { type: "chosen", index: 0 }, toSelf: true }],
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

  // Dispel: instants only, not sorceries.
  if (/^counter target instant spell$/i.test(sentence)) {
    return {
      targetRequirements: [{ kind: "instant_spell" }],
      effects: [{ kind: "counter_spell", target: { type: "chosen", index: 0 } }],
    };
  }

  // Muddle the Mixture.
  if (/^counter target artifact, creature, or planeswalker spell$/i.test(sentence)) {
    return {
      targetRequirements: [{ kind: "artifact_creature_or_planeswalker_spell" }],
      effects: [{ kind: "counter_spell", target: { type: "chosen", index: 0 } }],
    };
  }

  if (/^counter target enchantment, instant, or sorcery spell$/i.test(sentence)) {
    return {
      targetRequirements: [{ kind: "enchantment_instant_or_sorcery_spell" }],
      effects: [{ kind: "counter_spell", target: { type: "chosen", index: 0 } }],
    };
  }

  if (/^counter target instant or sorcery spell$/i.test(sentence)) {
    return {
      targetRequirements: [{ kind: "instant_or_sorcery_spell" }],
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

  // Awakening Zone, Pawn of Ulamog: the Eldrazi Spawn token's sacrifice-for-
  // {C} ability is a token preset (see tokens.ts), so the sentence that spells
  // it out is already true of the token this card creates.
  if (/^It has "Sacrifice this token: Add \{C\}\."$/i.test(sentence)) {
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

  // Birgi, once the fuser has joined the rider to the add. The mana is
  // ordinary in every way except that a step boundary does not take it.
  const persistentAdd = sentence.match(
    /^(add (?:\{[WUBRGC]\})+) that doesn['’]t empty until end of turn$/i,
  );
  if (persistentAdd?.[1]) {
    const persistent = parseAddMana(persistentAdd[1]);
    if (persistent?.kind === "fixed") {
      return {
        targetRequirements: [],
        effects: [
          {
            kind: "add_mana",
            playerId: "controller",
            mana: persistent.produces,
            untilEndOfTurn: true,
          },
        ],
      };
    }
  }

  const ritual = parseAddMana(sentence);
  if (ritual?.kind === "fixed") {
    return {
      targetRequirements: [],
      effects: [{ kind: "add_mana", playerId: "controller", mana: ritual.produces }],
    };
  }
  // Lotus Cobra: "add one mana of any color" as a resolved effect — the
  // color is auto-picked at bind (documented approximation).
  if (ritual?.kind === "any_color" && !ritual.countFromPower && !ritual.countFromEnchantments) {
    return {
      targetRequirements: [],
      effects: [
        { kind: "add_mana", playerId: "controller", mana: {}, anyColor: ritual.count ?? 1 },
      ],
    };
  }

  // Academy Ruins, Hall of Heliod's Generosity, Mortuary Mire: the same
  // graveyard noun phrase as the recursion grammar, aimed at the library top.
  const toTop = sentence.match(
    /^(?:you may )?Put target (.+?) from your graveyard on top of your library$/i,
  );
  const toTopTarget = toTop?.[1] ? parseGraveyardTargetPhrase(toTop[1]) : null;
  if (toTopTarget) {
    return {
      targetRequirements: [toTopTarget],
      effects: [
        {
          kind: "move_card",
          cardId: { type: "chosen", index: 0 },
          toZone: "library",
          libraryPosition: "top",
        },
      ],
    };
  }

  // Stoneforge Mystic, Terrain Generator, Monster Manual: the controller
  // picks a matching card out of their own hand and it enters. The "may" is
  // the choice itself — declining is choosing nothing.
  const fromHand = sentence.match(
    /^(?:You may )?put an? (creature|land|basic land|Equipment) card from your hand onto the battlefield( tapped)?$/i,
  );
  if (fromHand?.[1]) {
    const named = fromHand[1].toLowerCase();
    const filter =
      named === "equipment"
        ? ("equipment" as const)
        : named === "basic land"
          ? ("basic_land" as const)
          : (named as "creature" | "land");
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "choose_card",
          chooserId: "controller",
          sources: [{ playerId: "controller", zone: "hand", filter }],
          thenEffects: [
            {
              kind: "move_card",
              cardId: "chosen_card",
              toZone: "battlefield",
              ...(fromHand[2] ? { entersTapped: true } : {}),
            },
          ],
        },
      ],
    };
  }

  // Noxious Revival.
  if (/^Put target card from a graveyard on top of its owner's library$/i.test(sentence)) {
    return {
      targetRequirements: [{ kind: "graveyard_card" }],
      effects: [
        {
          kind: "move_card",
          cardId: { type: "chosen", index: 0 },
          toZone: "library",
          libraryPosition: "top",
        },
      ],
    };
  }

  // Gamble. The random discard applies at resolution, before the search
  // prompt completes — the tutored card can't be the one discarded, a
  // documented approximation of Gamble's famous risk.
  if (
    /^Search your library for a card, put (?:it|that card) into your hand, discard a card at random, then shuffle$/i.test(
      sentence,
    )
  ) {
    return {
      targetRequirements: [],
      effects: [
        { kind: "search_library", playerId: "controller", filter: {}, destination: "hand", count: 1 },
        { kind: "discard_random", playerId: "controller", count: 1 },
      ],
    };
  }

  // Ghostly Flicker: an immediate double blink; "under your control" reads
  // as a return to the owner-controller (they match for controlled targets).
  if (
    /^Exile two target artifacts, creatures, and\/or lands you control, then return those cards to the battlefield under your control$/i.test(
      sentence,
    )
  ) {
    return {
      targetRequirements: [
        { kind: "artifact_creature_or_land", control: "own" },
        { kind: "artifact_creature_or_land", control: "own" },
      ],
      effects: [
        { kind: "flicker", cardId: { type: "chosen", index: 0 } },
        { kind: "flicker", cardId: { type: "chosen", index: 1 } },
      ],
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
  match = sentence.match(/^impulse(?: (\d+))?( extended)? from your library$/i);
  if (match) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "exile_top_play",
          playerId: "controller",
          count: match[1] ? Number(match[1]) : 1,
          ...(match[2] ? { untilEndOfNextTurn: true } : {}),
        },
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
    /^Create (a|an|one|two|three|four|five|\d+|X) (Treasure|Clue|Food) tokens?$/i,
  );
  if (match?.[1] && match[2]) {
    const count = /^X$/i.test(match[1]) ? undefined : parseCount(match[1]) ?? undefined;
    const name = match[2][0]!.toUpperCase() + match[2].slice(1).toLowerCase();
    if (count !== undefined || /^X$/i.test(match[1])) {
      const token: CardEffect = {
        kind: "create_token",
        ownerId: "controller",
        name,
        typeLine: `Artifact — ${name} Token`,
        power: null,
        toughness: null,
        ...(count === undefined ? { count: "x" as const } : {}),
      };
      return {
        targetRequirements: [],
        effects:
          count === undefined ? [token] : Array.from({ length: count }, () => ({ ...token })),
      };
    }
  }

  // The token descriptor, read as one grammar. It runs before the older
  // shapes below so the strict reading wins: those fall back to a loose
  // "any words are the subtype" match, which happily invents a subtype out
  // of a word it does not know. What is left to them is what this cannot
  // express — a count read off the board, and quoted granted abilities.
  // Adeline: "For each opponent, create a 1/1 white Human creature token
  // that's tapped and attacking that player or a planeswalker they
  // control." The COUNT and the DEFENDER are both per opponent — a plain
  // count with one shared defender would send the whole squad at a single
  // player, which in a four-player game is most of the card.
  //
  // "or a planeswalker they control" is not offered: the token attacks the
  // player. A documented approximation of a choice.
  const perOpponentAttackers = sentence.match(
    /^For each opponent, create (.+?) that['’]s tapped and attacking that player(?: or a planeswalker they control)?$/i,
  );
  if (perOpponentAttackers?.[1]) {
    const descriptor = parseTokenDescriptor(perOpponentAttackers[1]);
    if (descriptor && !descriptor.countUnspecified && descriptor.count === 1) {
      return {
        targetRequirements: [],
        effects: [
          {
            kind: "create_token",
            ownerId: "controller",
            name: descriptor.name,
            typeLine: descriptor.typeLine,
            power: descriptor.power,
            toughness: descriptor.toughness,
            ...(descriptor.keywords.length > 0 ? { keywords: descriptor.keywords } : {}),
            ...(descriptor.colors.length > 0 ? { colors: descriptor.colors } : {}),
            attackingEachOpponent: true,
          },
        ],
      };
    }
  }

  // Urza's Saga's Construct: a token whose printed text is a static of its
  // own. The static belongs to the TOKEN, not to whatever made it, so it
  // rides the create_token effect onto the token's definition.
  const tokenWithStatic = sentence.match(
    /^Create (.+? token) with ['‘“](?:This token|~) gets \+(\d+)\/\+(\d+) for each (.+?)\.?['’”]\.?$/i,
  );
  if (tokenWithStatic?.[1] && tokenWithStatic[2] && tokenWithStatic[3] && tokenWithStatic[4]) {
    const per = parseDynamicCount(tokenWithStatic[4]);
    const descriptor = parseTokenDescriptor(tokenWithStatic[1]);
    if (per && descriptor && !descriptor.countUnspecified) {
      const token: CardEffect = {
        kind: "create_token",
        ownerId: "controller",
        name: descriptor.name,
        typeLine: descriptor.typeLine,
        power: descriptor.power,
        toughness: descriptor.toughness,
        ...(descriptor.keywords.length > 0 ? { keywords: descriptor.keywords } : {}),
        ...(descriptor.colors.length > 0 ? { colors: descriptor.colors } : {}),
        bonusPt: {
          power: Number(tokenWithStatic[2]),
          toughness: Number(tokenWithStatic[3]),
          per,
        },
      };
      return {
        targetRequirements: [],
        effects: Array.from({ length: descriptor.count === "x" ? 1 : descriptor.count }, () => ({
          ...token,
        })),
      };
    }
  }

  const createdTokens = sentence.match(
    /^(?:Then )?(?:(You|Its controller|Each player|Each opponent|Target player|Target opponent) creates?|(?:You may )?Create) (.+)$/i,
  );
  if (createdTokens?.[2]) {
    const who = createdTokens[1]?.toLowerCase();
    // "Target player creates …" (Prismari Command): the token's owner is the
    // chosen player, so the clause declares a target of its own.
    const targeted = who === "target player" || who === "target opponent";
    const ownerId: PlayerSelector | null =
      who === undefined || who === "you"
        ? "controller"
        : who === "its controller"
          ? { type: "chosen_controller", index: 0 }
          : who === "each player"
            ? "each_player"
            : who === "each opponent"
              ? "each_opponent"
              : targeted
                ? { type: "chosen", index: 0 }
                : null;
    // A trailing count tail applies to the whole clause, so it comes off
    // before the descriptors are read. Each maps to a count the effect can
    // already work out for itself at resolution.
    let body = createdTokens[2];
    let countTail: Partial<Extract<CardEffect, { kind: "create_token" }>> | null = null;
    const perControlledTail = body.match(/^(.*?)\s+for each (land|creature|artifact) you control$/i);
    const perCounterTail = body.match(/^(.*?)\s+for each \+1\/\+1 counter on ~$/i);
    const perSubjectPowerTail = body.match(/^(.*?)\s+equal to its power$/i);
    if (perControlledTail?.[1] && perControlledTail[2]) {
      countTail = { perControlled: perControlledTail[2].toLowerCase() as "land" | "creature" | "artifact" };
      body = perControlledTail[1];
    } else if (perCounterTail?.[1]) {
      countTail = { perSourceCounters: "p1p1" };
      body = perCounterTail[1];
    } else if (perSubjectPowerTail?.[1]) {
      countTail = { countFromSubjectAmount: true };
      body = perSubjectPowerTail[1];
    }

    // "Its controller" reads the first chosen target, which is the referent
    // every printed card that uses the phrase means — it follows a sentence
    // that targeted something (Resculpt exiles it, then pays its controller).
    const descriptors =
      ownerId === null ? [] : body.split(TOKEN_CONJUNCTION).map((part) => parseTokenDescriptor(part));
    // "a number of … tokens" with no tail to say how many would create one
    // token and quietly lose the count, so the whole clause is refused.
    const countable = descriptors.every(
      (entry) => entry !== null && (!entry.countUnspecified || countTail !== null),
    );
    if (descriptors.length > 0 && countable) {
      const effects: CardEffect[] = [];
      for (const descriptor of descriptors) {
        const token: CardEffect = {
          kind: "create_token",
          ownerId: ownerId!,
          name: descriptor!.name,
          typeLine: descriptor!.typeLine,
          power: descriptor!.power,
          toughness: descriptor!.toughness,
          ...(descriptor!.keywords.length > 0 ? { keywords: descriptor!.keywords } : {}),
          ...(descriptor!.colors.length > 0 ? { colors: descriptor!.colors } : {}),
          ...(descriptor!.entersTapped ? { entersTapped: true } : {}),
          ...(descriptor!.entersTappedAttacking ? { entersTappedAttacking: true } : {}),
          ...(descriptor!.count === "x" ? { count: "x" as const } : {}),
          ...(countTail ?? {}),
        };
        // A count tail is a per-something multiplier the effect works out at
        // resolution, so it emits one effect rather than N copies.
        if (descriptor!.count === "x" || countTail) {
          effects.push(token);
        } else {
          for (let index = 0; index < descriptor!.count; index += 1) {
            effects.push({ ...token });
          }
        }
      }
      return {
        targetRequirements: targeted
          ? [{ kind: who === "target opponent" ? "opponent" : "player" }]
          : [],
        effects,
      };
    }
  }

  // "You may create" is auto-taken (creating a token is never a downside a
  // casual table would decline) — a documented approximation.
  // The quoted grant is accepted only for Eldrazi Spawn, whose ability the
  // token preset supplies.
  // Krenko, Tin Street Kingpin: "a number of … equal to ~'s power". The
  // count is read when the tokens are CREATED, not when the effect binds —
  // the sibling "+1/+1 counter on it" has not landed at bind time, and the
  // swarm would be one Goblin short every single attack.
  const powerTokens = sentence.match(
    /^create a number of (\d+)\/(\d+)(?: (?:white|blue|black|red|green|colorless))? ([\w]+) creature tokens equal to ~'s power$/i,
  );
  if (powerTokens?.[1] && powerTokens[2] && powerTokens[3]) {
    const subtype = powerTokens[3].replace(/\b\w/g, (letter) => letter.toUpperCase());
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "create_token",
          ownerId: "controller",
          name: subtype,
          typeLine: `Creature — ${subtype} Token`,
          power: Number(powerTokens[1]),
          toughness: Number(powerTokens[2]),
          countFromSourcePower: true,
        },
      ],
    };
  }

  match = sentence.match(
    new RegExp(
      "^(?:You may )?Create (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\\d+|X) " +
        // "1/1", one or two colours, then the type words: "Warrior creature",
        // "Soldier artifact creature", "Forest Dryad land creature".
        "(\\d+)\\/(\\d+)(?: (?:white|blue|black|red|green|colorless)(?: and (?:white|blue|black|red|green))?)? " +
        "([\\w]+(?: [\\w]+)*?)((?: (?:artifact|land|enchantment))*) creature tokens?" +
        "( with [a-z ]+| with \"Sacrifice this token: Add \\{C\\}\\.\")?" +
        // Krenko / Myrel: "…, where X is the number of Goblins you control";
        // Chasm Skulker: "…, where X is the number of +1/+1 counters on ~".
        "(?:, where X is the number of (?:([A-Za-z]+)s you control|([+-]\\d\\/[+-]\\d|[a-z]+) counters on ~))?$",
      "i",
    ),
  );
  if (match?.[1] && match[2] && match[3] && match[4]) {
    const literalCount = /^X$/i.test(match[1]) ? undefined : parseCount(match[1]);
    const perSubtype = match[7]?.toLowerCase();
    const power = Number(match[2]);
    const toughness = Number(match[3]);
    const subtype = match[4].replace(/\b\w/g, (letter) => letter.toUpperCase());
    // Extra card types printed before "creature" (Awaken the Woods' land
    // creatures, Myrel's artifact creatures) lead the type line.
    const extraTypes = (match[5] ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => word[0]!.toUpperCase() + word.slice(1).toLowerCase());
    const keywordText = match[6]?.replace(/^ with /i, "");
    // "with prowess" (Monastery Mentor's Monks): prowess is not representable
    // on a token definition — dropped, a documented approximation. The quoted
    // Eldrazi Spawn grant is supplied by the token preset instead.
    const keywords =
      keywordText && !keywordText.startsWith('"')
        ? keywordText
            .split(/ and |, /i)
            .map((word) => word.trim().toLowerCase())
            .filter((word) => word !== "prowess" && word !== "changeling")
            .map((word) => KEYWORD_GRANTS[word])
        : [];
    // "X" with no "where X is …" tail is the spell's announced X; with one it
    // counts permanents. A literal count still emits that many effects, which
    // is what every existing caller expects.
    // Chasm Skulker: the count is the source's own counters. Read when the
    // effect APPLIES, which is what lets a dies-trigger still see them — the
    // counters ride the card object through the zone change.
    const perCounter = match[8] ? counterKeyOf(match[8].toLowerCase()) : undefined;
    const dynamic = perSubtype
      ? { perControlledSubtype: perSubtype }
      : perCounter
        ? { perSourceCounters: perCounter }
        : literalCount === undefined
          ? { count: "x" as const }
          : null;
    if ((dynamic || literalCount) && keywords.every((keyword): keyword is Keyword => Boolean(keyword))) {
      const token: CardEffect = {
        kind: "create_token",
        ownerId: "controller",
        name: subtype,
        typeLine: `${[...extraTypes, "Creature"].join(" ")} — ${subtype} Token`,
        power,
        toughness,
        ...(keywords.length > 0 ? { keywords } : {}),
        ...(dynamic ?? {}),
      };
      return {
        targetRequirements: [],
        effects: dynamic
          ? [token]
          : Array.from({ length: literalCount! }, () => ({ ...token })),
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

  /**
   * Arcane Lighthouse: the same removal, narrowed to CREATURES, with the
   * duration FRONTED and a "can't have" half. That last part is the card:
   * without the lock a static that grants hexproof re-grants it in the
   * same layer and the ability does nothing at all.
   *
   * The two keyword lists must AGREE. A card that removed one set and
   * locked another would be something this shape cannot say, so it is a
   * clean miss rather than a guess.
   */
  const loseAndLock = sentence.match(
    /^Until end of turn, creatures your opponents control lose ([a-z]+) and ([a-z]+) and can't have ([a-z]+) or ([a-z]+)$/i,
  );
  if (loseAndLock) {
    const lost = [loseAndLock[1], loseAndLock[2]].map((name) =>
      KEYWORD_GRANTS[name!.trim().toLowerCase()],
    );
    const locked = [loseAndLock[3], loseAndLock[4]].map((name) =>
      KEYWORD_GRANTS[name!.trim().toLowerCase()],
    );
    if (
      lost.every((keyword): keyword is Keyword => Boolean(keyword)) &&
      lost.length === locked.length &&
      lost.every((keyword, index) => keyword === locked[index])
    ) {
      return {
        targetRequirements: [],
        effects: [
          {
            kind: "opponents_lose_keywords_until_eot",
            keywords: lost,
            creaturesOnly: true,
            alsoLock: true,
          },
        ],
      };
    }
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

  // Minamo, Patriar's Seal, Kiora's Follower, Clock of Omens: the plain
  // targeted untap, over whatever noun phrase the card names.
  const untapTarget = /^Untap (target|another target|up to one target)\b/i.test(sentence)
    ? parseSimpleTargetPhrase(sentence.replace(/^Untap\s+/i, ""))
    : null;
  if (untapTarget) {
    return {
      targetRequirements: [untapTarget],
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

  // Urza's Saga chapter III: "an artifact card with mana cost {0} or {1}".
  // The printed COST, not the mana value — a {W} artifact has mana value 1
  // and is not what this asks for.
  const costTutor = sentence.match(
    /^Search your library for (?:an? )?(.+?) card with mana cost ((?:\{[^}]+\})+(?: or (?:\{[^}]+\})+)*), put it onto the battlefield, then shuffle$/i,
  );
  if (costTutor?.[1] && costTutor[2]) {
    const filter = parseSearchDescriptor(costTutor[1]);
    const costs = costTutor[2].split(/\s+or\s+/i).map((entry) => entry.trim());
    if (filter && costs.length > 0) {
      return {
        targetRequirements: [],
        effects: [
          {
            kind: "search_library",
            playerId: "controller",
            filter: { ...filter, manaCostIn: costs },
            destination: "battlefield",
            count: 1,
          },
        ],
      };
    }
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
    /^(?:you may )?Search your library for (?:up to (one|two|three|\d+) )?(?:an? )?(.+?) cards?(?: and)?, (?:reveal (?:it|them|that card|those cards), )?(?:and )?put (?:it|them|that card|those cards) (onto the battlefield(?: tapped)?|into your hand|into your graveyard), then shuffle(?: your library)?$/i,
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

  // The same search, with a noun phrase the pattern above cannot hold: a
  // cross-axis disjunction, an "and/or" list, or a trailing qualifier.
  // It runs only AFTER that one declines, so every card already compiling
  // through the battle-tested shape keeps compiling through it — this adds
  // reach without moving anything.
  match = sentence.match(
    /^(?:you may )?Search your library for (.+?), (?:reveal (?:it|them|that card|those cards), )?(?:and )?put (?:it|them|that card|those cards) (onto the battlefield(?: tapped)?|into your hand|into your graveyard), then shuffle(?: your library)?$/i,
  );
  if (match?.[1] && match[2]) {
    const phrase = parseSearchNounPhrase(match[1]);
    if (phrase) {
      const where = match[2].toLowerCase();
      return {
        targetRequirements: [],
        effects: [
          {
            kind: "search_library",
            playerId: "controller",
            filter: phrase.filter,
            destination: where.startsWith("onto the battlefield")
              ? "battlefield"
              : where === "into your hand"
                ? "hand"
                : "graveyard",
            count: phrase.count,
            ...(where.includes("tapped") ? { entersTapped: true } : {}),
          },
        ],
      };
    }
  }

  // Ephemerate / Conjurer's Closet / Restoration Angel / Felidar Guardian /
  // Teleportation Circle flicker. The noun phrase is parsed rather than
  // enumerated, so each new blink is a card, not a branch.
  match = sentence.match(
    /^(?:you may )?Exile (.+?), then return (?:it|that card) to the battlefield(?: under (?:its owner's|your) control)?$/i,
  );
  const flickerTarget = match?.[1] ? parseSimpleTargetPhrase(match[1]) : null;
  if (flickerTarget) {
    return {
      targetRequirements: [flickerTarget],
      effects: [{ kind: "flicker", cardId: { type: "chosen", index: 0 } }],
    };
  }

  /**
   * Buster Sword: the same free cast, capped by THAT DAMAGE rather than by
   * a printed number or an announced X. A second pattern beside the one
   * below rather than a widening of it, so no card that already compiles
   * can move.
   */
  if (
    /^You may cast a spell from your hand with mana value less than or equal to that damage without paying its mana cost$/i.test(
      sentence,
    )
  ) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "grant_free_cast_from_hand",
          playerId: "controller",
          maxManaValue: "subject_amount",
          count: 1,
        },
      ],
    };
  }

  // Rishkar's Expertise / Electrodominance: one free cast out of hand.
  const freeHandCast = sentence.match(
    /^You may cast a spell with mana value (X|\d+) or less from your hand without paying its mana cost$/i,
  );
  if (freeHandCast?.[1]) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "grant_free_cast_from_hand",
          playerId: "controller",
          maxManaValue:
            freeHandCast[1].toUpperCase() === "X" ? ("x" as const) : Number(freeHandCast[1]),
          count: 1,
        },
      ],
    };
  }

  // Emergence Zone / Alchemist's Refuge / Borne Upon a Wind: a one-turn
  // flash grant, as opposed to Vedalken Orrery's permanent one.
  if (
    /^You may cast spells this turn as though they had flash$/i.test(sentence) ||
    /^You may cast (?:a )?spells? this turn as though it had flash$/i.test(sentence)
  ) {
    return {
      targetRequirements: [],
      effects: [{ kind: "grant_flash_this_turn", playerId: "controller" }],
    };
  }

  // Reprieve: the spell-only half of Venser's bounce. Hullbreaker Horror
  // adds "you don't control", which narrows the same requirement.
  const spellBounce = sentence.match(
    /^return target spell(?: you (don't|do not) control)? to its owner's hand$/i,
  );
  if (spellBounce) {
    return {
      targetRequirements: [
        { kind: "spell", ...(spellBounce[1] ? { control: "not_own" as const } : {}) },
      ],
      effects: [{ kind: "bounce_spell_or_permanent", target: { type: "chosen", index: 0 } }],
    };
  }

  // Sink into Stupor: Venser's bounce, narrowed. Both halves take the
  // qualifiers — "an opponent controls" applies to the spell as much as
  // to the permanent.
  if (
    /^return target spell or nonland permanent an opponent controls to its owner's hand$/i.test(
      sentence,
    )
  ) {
    return {
      targetRequirements: [
        { kind: "spell_or_permanent", excludedTypes: ["land"], control: "not_own" },
      ],
      effects: [{ kind: "bounce_spell_or_permanent", target: { type: "chosen", index: 0 } }],
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

  // Generalized bounce, with Cyclonic Rift's "you don't control" ("an
  // opponent controls" reads the same way here).
  match = sentence.match(
    /^Return target (creature|artifact|enchantment|permanent|nonland permanent)( you don't control| an opponent controls)? to its owner's hand$/i,
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

  // Regrowth / Zombify / Unearth / Sun Titan / Goblin Engineer: one grammar
  // for the graveyard noun phrase and its destination.
  match = sentence.match(
    /^(?:you may )?Return (?:target|a|an) (.+?) from your graveyard to (your hand|the battlefield)(?: with an? ([+-]\d\/[+-]\d) counter on it)?$/i,
  );
  const yardTarget = match?.[1] ? parseGraveyardTargetPhrase(match[1]) : null;
  if (yardTarget && match?.[2]) {
    const toHand = match[2].toLowerCase() === "your hand";
    // Persist: the counter rides the arrival, so the state-based sweep that
    // follows sees the shrunken creature rather than a full-size one.
    const arrivalCounter = match[3]
      ? { counter: match[3] === "+1/+1" ? "p1p1" : "m1m1", amount: 1 }
      : null;
    // Only cards that are certainly permanents may return to the battlefield;
    // "target card" could be an instant, and an instant on the battlefield is
    // not a game state this engine has.
    if (toHand || BATTLEFIELD_RETURNABLE.has(yardTarget.kind)) {
      return {
        targetRequirements: [yardTarget],
        effects: [
          {
            kind: "move_card",
            cardId: { type: "chosen", index: 0 },
            toZone: toHand ? "hand" : "battlefield",
            ...(arrivalCounter && !toHand ? { withCounter: arrivalCounter } : {}),
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

  // Mistrise Village / Archway of Innovation: a permission spent by the next
  // spell, rather than a class-wide grant from a permanent.
  const nextSpell = sentence.match(
    /^The next spell you cast this turn (can't be countered|has improvise)$/i,
  );
  if (nextSpell?.[1]) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "grant_next_spell",
          playerId: "controller",
          ...(/^has improvise$/i.test(nextSpell[1])
            ? { improvise: true }
            : { cantBeCountered: true }),
        },
      ],
    };
  }


  // Reality Shift: the manifest lands on whoever owned the exiled creature,
  // which is an earlier clause's target rather than a target of its own.
  if (/^Its controller manifests the top card of their library$/i.test(sentence)) {
    return {
      targetRequirements: [],
      effects: [{ kind: "manifest", playerId: { type: "chosen_owner", index: 0 }, count: 1 }],
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

  // Inspiring Call, Tomb of the Spirit Dragon, Venser's Journal: a draw or a
  // lifegain scaled by whatever the shared count table names.
  const perEachDraw = sentence.match(/^Draw a card for each (.+)$/i);
  const perEachDrawCount = perEachDraw?.[1] ? parseDynamicCount(perEachDraw[1]) : null;
  if (perEachDrawCount) {
    return {
      targetRequirements: [],
      effects: [
        { kind: "draw", playerId: "controller", count: 1, perDynamicCount: perEachDrawCount },
      ],
    };
  }
  // Castle Locthwain: "you lose life equal to the number of cards in your
  // hand" — the same count table, on the losing side.
  const lifeEqualTo = sentence.match(
    /^(?:you )?lose life equal to the number of (.+)$/i,
  );
  const lifeEqualCount = lifeEqualTo?.[1]
    ? parseDynamicCount(`cards in ${lifeEqualTo[1]}`.replace(/^cards in cards in /, "cards in "))
    : null;
  if (lifeEqualCount) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "lose_life",
          playerId: "controller",
          amount: 1,
          perDynamicCount: lifeEqualCount,
        },
      ],
    };
  }

  const perEachLife = sentence.match(/^You gain (\d+) life for each (.+)$/i);
  const perEachLifeCount = perEachLife?.[2] ? parseDynamicCount(perEachLife[2]) : null;
  if (perEachLife?.[1] && perEachLifeCount) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "gain_life",
          playerId: "controller",
          amount: Number(perEachLife[1]),
          perDynamicCount: perEachLifeCount,
        },
      ],
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
  // Portal to Phyrexia fuses its type rider onto the end of this, because
  // on a PERMANENT a rider left as its own sentence never runs.
  const reanimateAny = sentence.match(
    /^Put target creature card from a graveyard onto the battlefield under your control(?:, then it becomes a ([A-Z][a-z]+) in addition)?$/i,
  );
  if (reanimateAny) {
    return {
      targetRequirements: [{ kind: "graveyard_creature_card" }],
      effects: [
        {
          kind: "move_card",
          cardId: { type: "chosen", index: 0 },
          toZone: "battlefield",
          underControlOf: "controller",
        },
        ...(reanimateAny[1]
          ? [
              {
                kind: "add_subtypes" as const,
                cardId: { type: "chosen" as const, index: 0 },
                subtypes: [reanimateAny[1].toLowerCase()],
              },
            ]
          : []),
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

  // Finale of Devastation: "If X is 10 or more, creatures you control get
  // +X/+X and gain haste until end of turn." The gate is on the ANNOUNCED
  // X, which only exists while the spell resolves.
  if (
    /^if X is (\d+) or more, creatures you control get \+X\/\+X and gain haste until end of turn$/i.test(
      sentence,
    )
  ) {
    const gate = sentence.match(/^if X is (\d+) or more/i);
    if (gate?.[1]) {
      return {
        targetRequirements: [],
        effects: [
          {
            kind: "if_condition",
            condition: { kind: "announced_x_at_least", amount: Number(gate[1]) },
            then: [
              {
                kind: "team_pt_until_eot",
                playerId: "controller",
                power: "x",
                toughness: "x",
              },
              { kind: "team_keyword_until_eot", playerId: "controller", keyword: "haste" },
            ],
          },
        ],
      };
    }
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

  const destroyLand = sentence.match(
    /^Destroy target (nonbasic )?land( an opponent controls| you don't control)?$/i,
  );
  if (destroyLand) {
    return {
      targetRequirements: [
        {
          kind: "land",
          ...(destroyLand[1] ? { nonbasicOnly: true } : {}),
          ...(destroyLand[2] ? { control: "not_own" as const } : {}),
        },
      ],
      effects: [{ kind: "move_card", cardId: { type: "chosen", index: 0 }, toZone: "graveyard" }],
    };
  }

  // Ram Through: a one-way bite — the bound creature's power at bind.
  if (
    /^Target creature you control deals damage equal to its power to target creature you don't control$/i.test(
      sentence,
    )
  ) {
    return {
      targetRequirements: [
        { kind: "creature", control: "own" },
        { kind: "creature", control: "not_own" },
      ],
      effects: [
        {
          kind: "deal_damage",
          sourceId: { type: "chosen", index: 0 },
          target: { type: "chosen", index: 1 },
          amount: "chosen_power",
        },
      ],
    };
  }

  // Ram Through's trample rider is not implemented: excess damage stays on
  // the bitten creature — a documented approximation.
  if (
    /^If the creature you control has trample, excess damage is dealt to that creature's controller instead$/i.test(
      sentence,
    )
  ) {
    return { targetRequirements: [], effects: [] };
  }

  // Epic Confrontation (fused): buff the biter, then fight.
  match = sentence.match(
    /^Target creature you control gets ([+-]\d+)\/([+-]\d+) until end of turn, then fights target creature you don't control$/i,
  );
  if (match?.[1] && match[2]) {
    return {
      targetRequirements: [
        { kind: "creature", control: "own" },
        { kind: "creature", control: "not_own" },
      ],
      effects: [
        {
          kind: "pt_until_eot",
          cardId: { type: "chosen", index: 0 },
          power: Number(match[1]),
          toughness: Number(match[2]),
        },
        {
          kind: "fight",
          cardId: { type: "chosen", index: 0 },
          withTarget: { type: "chosen", index: 1 },
        },
      ],
    };
  }

  // Freed from the Real: the aura taps and untaps its host.
  match = sentence.match(/^(Tap|Untap) enchanted creature$/i);
  if (match?.[1]) {
    return {
      targetRequirements: [],
      effects: [
        { kind: match[1].toLowerCase() === "tap" ? "tap" : "untap", cardId: "host" },
      ],
    };
  }

  // Kogla / Apex Altisaur: the fight is optional — an unfilled slot skips.
  // "ANOTHER target creature" is not "a creature you don't control": Brash
  // Taunter may fight one of yours, and the only thing it may not fight is
  // itself. The requirement carries that as `excludeSource`, so the
  // restriction lives where the target is chosen rather than in the effect.
  if (/^(?:it|~|this creature) fights another target creature$/i.test(sentence)) {
    return {
      targetRequirements: [{ kind: "creature", excludeSource: true }],
      effects: [{ kind: "fight", cardId: "self", withTarget: { type: "chosen", index: 0 } }],
    };
  }
  if (/^(?:it|~|this creature) fights up to one target creature you don't control$/i.test(sentence)) {
    return {
      targetRequirements: [{ kind: "creature", control: "not_own", optional: true }],
      effects: [{ kind: "fight", cardId: "self", withTarget: { type: "chosen", index: 0 } }],
    };
  }

  // Prey Upon-class: a straight two-party fight.
  if (/^Target creature you control fights target creature you don't control$/i.test(sentence)) {
    return {
      targetRequirements: [
        { kind: "creature", control: "own" },
        { kind: "creature", control: "not_own" },
      ],
      effects: [
        { kind: "fight", cardId: { type: "chosen", index: 0 }, withTarget: { type: "chosen", index: 1 } },
      ],
    };
  }

  // Kogla's self-shield rider.
  match = sentence.match(/^(?:~|this creature) gains ([a-z ]+) until end of turn$/i);
  if (match?.[1]) {
    const keyword = KEYWORD_GRANTS[match[1].trim().toLowerCase()];
    if (keyword) {
      return {
        targetRequirements: [],
        effects: [{ kind: "keyword_until_eot", cardId: "self", keyword }],
      };
    }
  }

  // Kogla: "Return target Human you control to its owner's hand".
  match = sentence.match(/^Return target ([A-Z][a-z]+) you control to its owner's hand$/);
  if (match?.[1] && !SEARCH_CARD_TYPES.has(match[1].toLowerCase())) {
    return {
      targetRequirements: [
        { kind: "creature", control: "own", requiredSubtypes: [match[1].toLowerCase()] },
      ],
      effects: [{ kind: "move_card", cardId: { type: "chosen", index: 0 }, toZone: "hand" }],
    };
  }

  // Casualties of War's fifth bullet.
  if (/^Destroy target planeswalker$/i.test(sentence)) {
    return {
      targetRequirements: [{ kind: "planeswalker" }],
      effects: [{ kind: "move_card", cardId: { type: "chosen", index: 0 }, toZone: "graveyard" }],
    };
  }

  // Field of Ruin's group consolation search.
  if (
    /^Each player searches their library for a basic land card, puts it onto the battlefield, then shuffles$/i.test(
      sentence,
    )
  ) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "search_library",
          playerId: "each_player",
          filter: { supertypes: ["basic"], types: ["land"] },
          destination: "battlefield",
          count: 1,
        },
      ],
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
    // "creature" is listed so the control-qualified form reaches here; the
    // plain "Destroy target creature" is claimed by an earlier pattern.
    // The noun phrase reads through the shared parser rather than a list of
    // the wordings that happened to come up, so every qualifier it knows —
    // mana value, power, multicolored, excluded types — arrives here too.
    /^(Destroy|Exile) ((?:up to one )?target .+?)( defending player controls)?$/i,
  );
  const destroyPhrase = match?.[2] ? parseSimpleTargetPhrase(match[2]) : null;
  // A bare "Destroy target permanent" is too broad to be this pattern; it
  // only qualifies once some qualifier narrows it.
  const narrowed =
    destroyPhrase &&
    (destroyPhrase.kind !== "permanent" ||
      Object.keys(destroyPhrase).length > 1 ||
      Boolean(match?.[3]));
  if (match?.[1] && destroyPhrase && narrowed) {
    // "defending player controls" (Kogla) widens to any opponent's — a
    // documented approximation of the defender restriction.
    return {
      targetRequirements: [
        {
          ...destroyPhrase,
          ...(match[3] ? { control: "not_own" as const } : {}),
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

  // Sheoldred: "THAT PLAYER sacrifices a creature of their choice" — the one
  // player whose step began, not every opponent. The same edict machinery as
  // below, aimed at the trigger's subject.
  const subjectEdict = sentence.match(
    /^(That player|They|Target player) sacrifices? a creature(?: of their choice)?$/i,
  );
  if (subjectEdict?.[1]) {
    // Sudden Edict names a TARGET; Sheoldred's names the trigger's subject.
    // Same edict, two ways of saying who — so the referent is the only
    // difference between them.
    const targeted = /^target player$/i.test(subjectEdict[1]);
    const who: PlayerSelector = targeted
      ? { type: "chosen", index: 0 }
      : { type: "subject_player" };
    return {
      targetRequirements: targeted ? [{ kind: "player" }] : [],
      effects: [
        {
          kind: "choose_card",
          chooserId: who,
          sources: [{ playerId: who, zone: "battlefield", filter: "creature" }],
          thenEffects: [{ kind: "sacrifice", cardId: "chosen" }],
        },
      ],
    };
  }

  // Edicts: sacrifice choices belong to the affected players. Multi-count
  // edicts (Blasphemous Edict's thirteen) repeat the choice sequentially —
  // a documented approximation of the simultaneous pick.
  match = sentence.match(
    /^Each (player|opponent|other player) sacrifices (a|one|two|three|thirteen|\d+) (nontoken )?(creatures?|planeswalkers?|creatures? or planeswalkers?|creature tokens?)(?: of their choice)?(?: with the greatest mana value among (.+?) they control)?$/i,
  );
  if (match?.[1] && match[2]) {
    // Only the "creature OR planeswalker" form widens; a bare "planeswalker"
    // must not pull creatures in with it.
    const withPlaneswalkers = /creatures? or planeswalkers?/i.test(match[4] ?? "");
    // Soul Shatter: the superlative must be measured over the SAME class
    // the edict names. "Sacrifice a creature with the greatest mana value
    // among artifacts they control" is not a card, and reading it as one
    // would offer the wrong permanents; the scopes have to agree.
    let greatestManaValue = false;
    if (match[5]) {
      // The two halves are printed differently — "a creature OR
      // planeswalker" against "among creatureS AND planeswalkerS" — so
      // they are compared as SETS of nouns rather than as strings.
      const nouns = (phrase: string) =>
        phrase
          .toLowerCase()
          .split(/\s*(?:,|\band\/or\b|\band\b|\bor\b)\s*/)
          .map((word) => word.trim().replace(/s$/, ""))
          .filter(Boolean)
          .sort()
          .join("|");
      if (nouns(match[5]) !== nouns(match[4] ?? "")) {
        return null;
      }
      greatestManaValue = true;
    }
    const edictWord = match[2].toLowerCase();
    const edictCount =
      edictWord === "a" || edictWord === "one"
        ? 1
        : edictWord === "two"
          ? 2
          : edictWord === "three"
            ? 3
            : edictWord === "thirteen"
              ? 13
              : Number(edictWord);
    if (Number.isFinite(edictCount) && edictCount >= 1) {
      const edict: CardEffect = {
        kind: "choose_card",
        chooserId: match[1].toLowerCase() === "player" ? "each_player" : "each_opponent",
        sources: [
          {
            playerId: match[1].toLowerCase() === "player" ? "each_player" : "each_opponent",
            zone: "battlefield",
            ...(greatestManaValue ? { greatestManaValue: true } : {}),
            filter: withPlaneswalkers
              ? "creature_or_planeswalker"
              : /^planeswalkers?$/i.test(match[4] ?? "")
                ? "planeswalker"
                : // The printed order is "a creature TOKEN", noun then noun —
                  // not an adjective in front like "nontoken creature".
                  /^creature tokens?$/i.test(match[4] ?? "")
                  ? "token_creature"
                  : match[3]
                    ? "nontoken_creature"
                    : "creature",
          },
        ],
        thenEffects: [{ kind: "sacrifice", cardId: "chosen_card" }],
      };
      return {
        targetRequirements: [],
        effects: Array.from({ length: edictCount }, () => ({ ...edict })),
      };
    }
  }

  // "Sacrifice another permanent" (Korvold), "sacrifice a creature". The
  // mirror of the edict above, with the controller as the chooser: the
  // `choose_card` machinery is identical, so this is a second reader of it
  // rather than a second way to sacrifice.
  //
  // "Another" excludes the source, which only means anything once there is
  // an instance — the exclusion is bound, not baked into the definition.
  match = sentence.match(
    /^(?:You )?[Ss]acrifice (a|an|another) (permanent|creature|artifact|land)$/i,
  );
  if (match?.[1] && match[2]) {
    const noun = match[2].toLowerCase();
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "choose_card",
          chooserId: "controller",
          sources: [
            {
              playerId: "controller",
              zone: "battlefield",
              // A permanent is anything on the battlefield, which is what
              // "any" already means for this zone.
              filter:
                noun === "permanent"
                  ? ("any" as const)
                  : noun === "creature"
                    ? ("creature" as const)
                    : noun === "artifact"
                      ? ("artifact" as const)
                      : ("land" as const),
              ...(/^another$/i.test(match[1]) ? { excludeSelf: true } : {}),
            },
          ],
          thenEffects: [{ kind: "sacrifice", cardId: "chosen_card" }],
        },
      ],
    };
  }

  // Zulaport Cutthroat: a flat drain — the gain does not scale per opponent.
  match = sentence.match(
    /^each opponent loses (\d+|one|two) life and you gain (\d+|one|two) life$/i,
  );
  if (match?.[1] && match[2]) {
    const lost = parseCount(match[1]);
    const gained = parseCount(match[2]);
    if (lost && gained) {
      return {
        targetRequirements: [],
        effects: [
          { kind: "lose_life", playerId: "each_opponent", amount: lost },
          { kind: "gain_life", playerId: "controller", amount: gained },
        ],
      };
    }
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

  // Soul-Guide Lantern / Scavenger Grounds: untargeted mass graveyard hate.
  const massGraveyardExile = sentence.match(
    /^Exile (each opponent's graveyard|all graveyards)$/i,
  );
  if (massGraveyardExile?.[1]) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "exile_graveyard",
          playerId: /all graveyards/i.test(massGraveyardExile[1])
            ? "each_player"
            : "each_opponent",
        },
      ],
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

  // The drain body, over every subject that can carry it. Note that the gain
  // is a flat amount, NOT the total lost — "each opponent loses 1 life and you
  // gain 1 life" gains exactly 1 at a four-player table, which is why this
  // cannot reuse drain_opponents.
  match = sentence.match(
    /^(Target player|Target opponent|That player|They|Each opponent) loses? (\d+) life and you gain (\d+) life$/i,
  );
  if (match?.[1] && match[2] && match[3]) {
    const who = match[1].toLowerCase();
    const loser: PlayerSelector | null =
      who === "target player" || who === "target opponent"
        ? { type: "chosen", index: 0 }
        : who === "that player" || who === "they"
          ? { type: "subject_player" }
          : "each_opponent";
    return {
      targetRequirements: who.startsWith("target")
        ? [{ kind: who === "target opponent" ? "opponent" : "player" }]
        : [],
      effects: [
        { kind: "lose_life", playerId: loser, amount: Number(match[2]) },
        { kind: "gain_life", playerId: "controller", amount: Number(match[3]) },
      ],
    };
  }

  // The same subjects without the lifegain rider ("they lose 2 life").
  match = sentence.match(/^(That player|They) loses? (\d+) life$/i);
  if (match?.[2]) {
    return {
      targetRequirements: [],
      effects: [
        { kind: "lose_life", playerId: { type: "subject_player" }, amount: Number(match[2]) },
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

  // Forgotten Ancient's "you may" is auto-taken (a free counter).
  match = sentence.match(/^(?:you may )?Put a \+1\/\+1 counter on ~$/i);
  if (match) {
    return {
      targetRequirements: [],
      effects: [{ kind: "add_counter", cardId: "self", counter: "p1p1", amount: 1 }],
    };
  }

  if (/^You win the game$/i.test(sentence)) {
    return { targetRequirements: [], effects: [{ kind: "win_game", playerId: "controller" }] };
  }

  // "…on it": the object the trigger watched, not the source (Surrak and
  // Goreclaw's "Whenever another nontoken creature you control enters, put a
  // +1/+1 counter on it").
  match = sentence.match(/^(?:you may )?Put (a|one|two|three|\d+) \+1\/\+1 counters? on it$/i);
  if (match?.[1]) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "add_counter",
          cardId: "subject_card",
          counter: "p1p1",
          amount: parseCount(match[1]) ?? 1,
        },
      ],
    };
  }

  // Amulet of Vigor: "Whenever a permanent you control enters tapped, untap it."
  if (/^Untap it$/i.test(sentence)) {
    return { targetRequirements: [], effects: [{ kind: "untap", cardId: "subject_card" }] };
  }

  // Beastmaster Ascension ("you may" is auto-taken; quest counters only go up).
  match = sentence.match(/^(?:you may )?put an? ([a-z]+) counter on ~$/i);
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

  // The general until-end-of-turn grant, tried last: the narrow shapes above
  // still own their exact sentences, and this catches the combinations they
  // cannot express ("gets +3/+3 AND gains trample until end of turn").
  const untilEot = compileUntilEotGrant(sentence);
  if (untilEot) {
    return untilEot;
  }

  // Last resort: a compound body whose halves are each understood.
  const compound = compileCompoundClause(sentence);
  if (compound) {
    return compound;
  }

  return null;
}

/**
 * "Draw a card and you lose 1 life", "~ deals 1 damage to you and you draw a
 * card": split a clause at a top-level conjunction and compile each half.
 *
 * This is deliberately the very last thing tried, and it is self-validating —
 * a split is accepted only when EVERY part compiles cleanly on its own, so a
 * conjunction that is really part of one phrase ("artifacts and/or
 * enchantments", "search … and put it onto the battlefield") simply fails to
 * split and falls through. Parts shrink strictly, so the recursion terminates.
 */
function compileCompoundClause(sentence: string): SimpleClause | null {
  // "and/or" is one phrase, never a join.
  if (/\band\/or\b/i.test(sentence)) {
    return null;
  }
  const separators = [/,\s+then\s+/i, /\s+and\s+then\s+/i, /\s+and\s+/i];
  for (const separator of separators) {
    const pieces = splitOnce(sentence, separator);
    if (!pieces) {
      continue;
    }
    const clauses: SimpleClause[] = [];
    let ok = true;
    for (const piece of pieces) {
      const trimmed = piece.trim();
      if (!trimmed) {
        ok = false;
        break;
      }
      // Patterns anchor on either casing, so try the raw text first and the
      // sentence-cased form second.
      const compiled =
        compileSimpleClause(trimmed) ??
        compileSimpleClause(trimmed.charAt(0).toUpperCase() + trimmed.slice(1));
      if (!compiled || compiled.leftover || compiled.effects.length === 0) {
        ok = false;
        break;
      }
      clauses.push(compiled);
    }
    if (!ok) {
      continue;
    }
    const targetRequirements: TargetRequirement[] = [];
    const effects: CardEffect[] = [];
    for (const clause of clauses) {
      // Each half numbered its targets from zero; renumber onto the tail of
      // the combined list.
      const shifted = offsetChosenIndexes(clause, targetRequirements.length);
      targetRequirements.push(...shifted.targetRequirements);
      effects.push(...shifted.effects);
    }
    return { targetRequirements, effects };
  }
  return null;
}

/** Split at the FIRST match of a separator, into exactly two pieces. */
function splitOnce(text: string, separator: RegExp): [string, string] | null {
  const match = separator.exec(text);
  if (!match || match.index <= 0) {
    return null;
  }
  const head = text.slice(0, match.index);
  const tail = text.slice(match.index + match[0].length);
  return head && tail ? [head, tail] : null;
}

/**
 * Who an until-end-of-turn grant applies to, in terms the effect vocabulary
 * can already address. `target` also carries the requirement to add.
 */
/** One side of a printed P/T modifier, before it is matched to an effect that
 * can carry it. Not every effect accepts every term. */
type PtTerm = number | "x" | "minus_x" | "greatest_power" | "creature_count";

type EotSubject =
  | { how: "team"; playerId: "controller" | "each_opponent"; subtypes?: string[] }
  | { how: "all" }
  | { how: "card"; cardId: "self" | "subject_card" }
  | { how: "target"; requirement: TargetRequirement };

function parseEotSubject(phrase: string): EotSubject | null {
  const rest = phrase.trim();
  if (/^(?:other )?creatures you control$/i.test(rest)) {
    // "Other creatures you control" excludes the source; the team effects
    // address a player rather than a card set, so the source is included.
    // Documented approximation — it matters only for a source that is itself
    // an affected creature (End-Raze Forerunners).
    return { how: "team", playerId: "controller" };
  }
  if (/^creatures your opponents control$/i.test(rest)) {
    return { how: "team", playerId: "each_opponent" };
  }
  // Golgari Charm: everyone's creatures, the caster's included.
  if (/^(?:all creatures|each creature)$/i.test(rest)) {
    return { how: "all" };
  }
  // Lathliss: "Dragons you control". The capital marks it as a subtype;
  // "Creatures" is claimed above.
  const tribal = rest.match(/^([A-Z][a-z]+)s you control$/);
  if (tribal?.[1]) {
    return { how: "team", playerId: "controller", subtypes: [tribal[1].toLowerCase()] };
  }
  // Lord of the Accursed: "All Zombies" — everyone's, so it stays a team
  // effect on the controller only. That is a documented narrowing: the
  // printed card pumps opponents' Zombies too, which no team effect models.
  const allTribal = rest.match(/^All ([A-Z][a-z]+)s$/);
  if (allTribal?.[1]) {
    return { how: "team", playerId: "controller", subtypes: [allTribal[1].toLowerCase()] };
  }
  if (/^(?:~|It|That creature|They)$/i.test(rest)) {
    return { how: "card", cardId: /^~$/.test(rest) ? "self" : "subject_card" };
  }
  // The targeted subject is the ordinary targeting noun phrase, so it reads
  // through the shared grammar rather than a list of the exact five wordings
  // that happened to come up: "another target creature" (Heliod), "target
  // legendary creature" (Plaza of Heroes) and "target creature you don't
  // control" all arrive for free, and a new qualifier is added once.
  const targeted = parseSimpleTargetPhrase(rest);
  return targeted ? { how: "target", requirement: targeted } : null;
}

/**
 * "gets +3/+3 and gains trample", "gains hexproof and indestructible",
 * "gets +X/+X and gains trample". Returns null on any unrecognised conjunct
 * so a half-understood line compiles to nothing rather than to half a card.
 */
function compileUntilEotGrant(sentence: string): SimpleClause | null {
  // The duration sits at either end: "Until end of turn, X gets …" or
  // "X gets … until end of turn".
  let body: string;
  const leading = sentence.match(/^Until end of turn, (.+)$/i);
  // Moonshaker Cavalry prints the "where X is …" tail after the duration; it
  // belongs to the modifier, so move it back before splitting.
  const trailing = sentence.match(/^(.+?) until end of turn(, where X is .+)?$/i);
  if (leading?.[1]) {
    body = leading[1];
  } else if (trailing?.[1]) {
    body = trailing[1] + (trailing[2] ?? "");
  } else {
    return null;
  }

  const split = body.match(/^(.+?)\s+((?:gets?|gains?)\s+.+)$/i);
  if (!split?.[1] || !split[2]) {
    return null;
  }
  const subject = parseEotSubject(split[1]);
  if (!subject) {
    return null;
  }

  const cardId =
    subject.how === "card"
      ? subject.cardId
      : subject.how === "target"
        ? ({ type: "chosen", index: 0 } as const)
        : null;

  const effects: CardEffect[] = [];
  const parts = split[2]
    .split(/\s+and\s+(?=(?:gets?|gains?)\s)/i)
    .map((part) => part.trim())
    .filter(Boolean);
  for (const part of parts) {
    // A P/T modifier is two independent terms — each a signed number or a
    // signed X — plus an optional "where X is …" tail naming what X reads.
    // Reading the two sides separately is what admits "+X/+0" (Kessig Wolf
    // Run) and "-X/-X" (Grim Hireling) without a branch per combination.
    // The "for each …" trailer scales the modifier by a live count
    // (Fists of Flame). It is mutually exclusive with the "where X is …"
    // tail: both name what the number reads, and no printed card uses
    // them together.
    const ptMod = part.match(
      /^gets?\s+([+-](?:\d+|X))\/([+-](?:\d+|X))(?:, where X is (the greatest power among creatures you control|the number of creatures you control))?(?:\s+for each (.+))?$/i,
    );
    if (ptMod?.[1] && ptMod[2]) {
      const xReads = ptMod[3]?.toLowerCase();
      const term = (text: string): PtTerm | null => {
        if (!/X$/i.test(text)) {
          return Number(text);
        }
        if (text.startsWith("-")) {
          // A "where X is …" tail names a board count, which is never
          // negated on a printed card; pairing the two would be guesswork.
          return xReads ? null : "minus_x";
        }
        return xReads === "the greatest power among creatures you control"
          ? "greatest_power"
          : xReads === "the number of creatures you control"
            ? "creature_count"
            : "x";
      };
      const power = term(ptMod[1]);
      const toughness = term(ptMod[2]);
      if (power === null || toughness === null) {
        return null;
      }
      if (ptMod[4] && subject.how !== "target" && subject.how !== "card") {
        return null;
      }
      if (subject.how === "team") {
        // The board-reading counts and the announced X all belong here; a
        // negated X does not — no printed team effect uses one.
        if (power === "minus_x" || toughness === "minus_x") {
          return null;
        }
        effects.push({
          kind: "team_pt_until_eot",
          playerId: subject.playerId,
          power,
          toughness,
          ...(subject.subtypes ? { subtypes: [...subject.subtypes] } : {}),
        });
        continue;
      }
      if (subject.how === "all") {
        // The sweep effect carries a negated X of its own ("-x"), which is
        // the only variable a card-less subject can read.
        const sweepTerm = (term: PtTerm): number | "-x" | null =>
          typeof term === "number" ? term : term === "minus_x" ? "-x" : null;
        const sweepPower = sweepTerm(power);
        const sweepToughness = sweepTerm(toughness);
        if (sweepPower === null || sweepToughness === null) {
          return null;
        }
        effects.push({
          kind: "all_pt_until_eot",
          power: sweepPower,
          toughness: sweepToughness,
        });
        continue;
      }
      // Off a single card only the announced X resolves; the board-reading
      // counts are printed on team effects only.
      if (power === "greatest_power" || power === "creature_count") {
        return null;
      }
      if (toughness === "greatest_power" || toughness === "creature_count") {
        return null;
      }
      const per = ptMod[4] ? parseDynamicCount(ptMod[4]) : null;
      if (ptMod[4] && !per) {
        // A trailer we cannot count is not a trailer we may drop: the
        // grant would silently become a flat +1/+0.
        return null;
      }
      effects.push({
        kind: "pt_until_eot",
        cardId: cardId!,
        power,
        toughness,
        ...(per ? { per } : {}),
      });
      continue;
    }
    const gains = part.match(/^gains?\s+(.+)$/i);
    if (!gains?.[1]) {
      return null;
    }
    const names = gains[1]
      .split(/,\s*(?:and\s+)?|\s+and\s+/)
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean);
    if (names.length === 0) {
      return null;
    }
    for (const name of names) {
      const keyword = KEYWORD_GRANTS[name];
      if (!keyword) {
        return null;
      }
      if (subject.how === "team") {
        effects.push({
          kind: "team_keyword_until_eot",
          playerId: subject.playerId,
          keyword,
          ...(subject.subtypes ? { subtypes: [...subject.subtypes] } : {}),
        });
      } else if (subject.how === "all") {
        // There is no all-scope keyword grant yet, and "all creatures" has no
        // single card to hang one on — refuse rather than address nobody.
        return null;
      } else {
        effects.push({ kind: "keyword_until_eot", cardId: cardId!, keyword });
      }
    }
  }
  if (effects.length === 0) {
    return null;
  }
  return {
    targetRequirements: subject.how === "target" ? [subject.requirement] : [],
    effects,
  };
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
    // The Landscape cycle reads "a basic Swamp, Forest, or Island card": an
    // article and a supertype sit in front of the list and qualify all of it,
    // so peel them off before splitting rather than letting the first option
    // come out as "a basic swamp".
    let listText = descriptor.trim().replace(/^an?\s+/i, "");
    const supertypes: string[] = [];
    for (;;) {
      const leading = listText.match(/^([a-z]+)\s+(.*)$/i);
      if (!leading?.[1] || !SEARCH_SUPERTYPES.has(leading[1].toLowerCase())) {
        break;
      }
      supertypes.push(leading[1].toLowerCase());
      listText = leading[2]!;
    }
    const options = listText
      .split(/,\s*(?:or\s+)?|\s+or\s+/i)
      .map((word) => word.trim().toLowerCase().replace(/\s*cards?$/, ""))
      .filter(Boolean);
    if (options.length >= 2 && options.every((word) => /^[a-z]+$/.test(word))) {
      if (supertypes.length > 0) {
        // Only a subtype list can carry a supertype ("a basic Swamp or …").
        if (options.some((word) => SEARCH_CARD_TYPES.has(word))) {
          return null;
        }
        return { supertypes, subtypesAny: options };
      }
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

/**
 * The richer half of a library search: a noun phrase that may be a
 * DISJUNCTION ("an artifact or Dragon card", "basic land cards and/or Gate
 * cards") and may carry a qualifier that applies to all of it ("… with mana
 * value 2 or less").
 *
 * `parseSearchDescriptor` handles a single descriptor and refuses a mixed
 * list, because `typesAny` and `subtypesAny` each live on one axis. This
 * splits the phrase first and hands each branch to that same function, so a
 * cross-axis list is a disjunction of two ordinary filters rather than a
 * new kind of list.
 *
 * The shared "with …" tail is peeled BEFORE the split, because its own "or"
 * ("2 or less") would otherwise be read as another branch. A per-branch
 * qualifier ("a card with flash") is peeled after, from its own branch.
 */
function parseSearchNounPhrase(
  phrase: string,
): { filter: SearchFilter; count: number } | null {
  let text = phrase.trim();
  let count = 1;
  const upTo = text.match(/^up to ([a-z]+|\d+) /i);
  if (upTo?.[1]) {
    const parsed = parseCount(upTo[1].toLowerCase()) ?? Number(upTo[1]);
    if (!parsed) {
      return null;
    }
    count = parsed;
    text = text.slice(upTo[0].length);
  }

  const shared: SearchFilter = {};
  const manaCap = text.match(/^(.*?)\s+with mana value (\d+) or less$/i);
  if (manaCap?.[1] && manaCap[2]) {
    shared.maxManaValue = Number(manaCap[2]);
    text = manaCap[1].trim();
  }

  const branchTexts = text
    .split(/\s+and\/or\s+|\s+or\s+/i)
    .map((part) => part.trim())
    .filter(Boolean);
  if (branchTexts.length === 0) {
    return null;
  }

  const branches: SearchFilter[] = [];
  for (const branchText of branchTexts) {
    let branch = branchText.replace(/^an?\s+/i, "").trim();
    let keyword: Keyword | undefined;
    // KEYWORD_LINE, not KEYWORD_GRANTS: a search names printed keywords,
    // and flash — the one this exists for — is not something a static can
    // grant a creature, so it is absent from the grant table.
    const withKeyword = branch.match(/^(.*?)\s+with (?:an? )?([a-z]+)$/i);
    if (withKeyword?.[2] && KEYWORD_LINE.has(withKeyword[2].toLowerCase())) {
      keyword = withKeyword[2].toLowerCase() as Keyword;
      branch = (withKeyword[1] ?? "").trim();
    }
    // A trailing word that is NOT a keyword is left where it is rather
    // than failing the phrase — the descriptor parser below is the one
    // that decides whether "with a basic land type" means anything.
    branch = branch.replace(/\s*cards?$/i, "").trim();
    // "a card with flash" leaves nothing behind, which is the empty filter
    // — every card — narrowed by the keyword alone.
    const parsed = branch.length > 0 ? parseSearchDescriptor(branch) : {};
    if (!parsed) {
      return null;
    }
    branches.push({ ...parsed, ...(keyword ? { keyword } : {}) });
  }

  if (branches.length === 1) {
    return { filter: { ...branches[0]!, ...shared }, count };
  }
  return { filter: { ...shared, anyOf: branches }, count };
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
/**
 * Ojer Taq: "Activate only if you attacked with three or more creatures this
 * turn AND ONLY AS A SORCERY." Both riders already exist on their own, so
 * the compound is split into the two the readers know rather than given a
 * third parser that would have to repeat one of them.
 */
function splitActivationRidersInPlace(sentences: string[], lineStart: boolean[]): void {
  for (let index = 0; index < sentences.length; index += 1) {
    const compound = sentences[index]!.match(
      /^(Activate only .+?) and only as (?:a|an) (sorcery|instant)$/i,
    );
    if (!compound?.[1] || !compound[2]) {
      continue;
    }
    const timing = /^instant$/i.test(compound[2])
      ? "Activate only as an instant"
      : "Activate only as a sorcery";
    sentences.splice(index, 1, compound[1], timing);
    lineStart.splice(index + 1, 0, false);
  }
}

/**
 * Torment of Hailfire: "Repeat the following process X times." The process
 * is the NEXT sentence on the same line, so the two are fused into one
 * clause rather than the head being read as an effect of its own — on its
 * own it means nothing, and left behind it is a note on a card that
 * otherwise compiles.
 */
function fuseRepeatXInPlace(sentences: string[], lineStart: boolean[]): void {
  for (let index = 0; index + 1 < sentences.length; index += 1) {
    if (lineStart[index + 1] || !sentences[index + 1]) {
      continue;
    }
    if (!/^Repeat the following process X times$/i.test(sentences[index]!)) {
      continue;
    }
    sentences.splice(index, 2, `Repeat-X ${sentences[index + 1]!}`);
    lineStart.splice(index + 1, 1);
  }
}

/**
 * Eldritch Evolution prints its search and its destination as two
 * sentences, where most cards run them together with a comma. The comma
 * form is what every search clause reads, so the two are joined rather
 * than every one of those clauses learning a second shape.
 */
/**
 * Saw in Half prints its rider across two sentences — the copies, then
 * "Round up each time." — and the rider itself is long enough that reading
 * it as one clause would be a regex nobody can check. Both are collapsed to
 * a marker the clause below reads, which keeps the shape of the card in the
 * fuser and the meaning in the clause.
 */
/**
 * Inkshield prints its shield and the tokens it pays out as two sentences.
 * The token spec is printed in full in the second, and the clause below
 * carries it — so the fuser only recognises the exact pair and collapses it
 * to a marker, rather than trying to read an arbitrary token out of an
 * arbitrary rider.
 */
/**
 * Ripples of Potential prints its proliferate and the phase-out it feeds as
 * two sentences. They are collapsed to a marker because the second cannot
 * be read on its own — "those permanents" names a set that only the first
 * one knows.
 */
/**
 * Combat Celebrant prints the exert offer and the reflexive trigger it
 * fires as two sentences, and neither reads on its own — "when you do"
 * names the offer above it. Collapsed to a marker the clause below builds
 * the whole attack trigger from.
 */
/**
 * Approach of the Second Sun prints its win and its consolation as two
 * sentences joined by "Otherwise". Neither reads alone — the second is the
 * else-branch of the first — so both collapse to one marker.
 */
function fuseApproachInPlace(sentences: string[], lineStart: boolean[]): void {
  for (let index = 0; index + 1 < sentences.length; index += 1) {
    if (lineStart[index + 1] || !sentences[index] || !sentences[index + 1]) {
      continue;
    }
    if (
      !/^If this spell was cast from your hand and you've cast another spell named (?:~|Approach of the Second Sun) this game, you win the game$/i.test(
        sentences[index]!,
      )
    ) {
      continue;
    }
    if (
      !/^Otherwise, put (?:~|Approach of the Second Sun) into its owner's library seventh from the top and you gain 7 life$/i.test(
        sentences[index + 1]!,
      )
    ) {
      continue;
    }
    sentences.splice(index, 2, "approach-second-sun");
    lineStart.splice(index + 1, 1);
  }
}

function fuseExertInPlace(sentences: string[], lineStart: boolean[]): void {
  for (let index = 0; index + 1 < sentences.length; index += 1) {
    if (lineStart[index + 1] || !sentences[index] || !sentences[index + 1]) {
      continue;
    }
    if (
      !/^If (?:~|this creature) hasn't been exerted this turn, you may exert it as it attacks$/i.test(
        sentences[index]!,
      )
    ) {
      continue;
    }
    if (
      !/^When you do, untap all other creatures you control and after this phase, there is an additional combat phase$/i.test(
        sentences[index + 1]!,
      )
    ) {
      continue;
    }
    sentences.splice(index, 2, "combat-celebrant-exert");
    lineStart.splice(index + 1, 1);
  }
}

function fuseRipplesInPlace(sentences: string[], lineStart: boolean[]): void {
  for (let index = 0; index + 1 < sentences.length; index += 1) {
    if (lineStart[index + 1] || !sentences[index] || !sentences[index + 1]) {
      continue;
    }
    if (
      !/^Proliferate, then choose any number of permanents you control that had a counter put on them this way$/i.test(
        sentences[index]!,
      )
    ) {
      continue;
    }
    if (!/^Those permanents phase out$/i.test(sentences[index + 1]!)) {
      continue;
    }
    sentences.splice(index, 2, "ripples-proliferate-phase");
    lineStart.splice(index + 1, 1);
  }
}

function fuseInkshieldInPlace(sentences: string[], lineStart: boolean[]): void {
  for (let index = 0; index + 1 < sentences.length; index += 1) {
    if (lineStart[index + 1] || !sentences[index] || !sentences[index + 1]) {
      continue;
    }
    if (
      !/^Prevent all combat damage that would be dealt to you this turn$/i.test(
        sentences[index]!,
      )
    ) {
      continue;
    }
    if (
      !/^For each 1 damage prevented this way, create a 2\/1 white and black Inkling creature token with flying$/i.test(
        sentences[index + 1]!,
      )
    ) {
      continue;
    }
    sentences.splice(index, 2, "inkshield-fog");
    lineStart.splice(index + 1, 1);
  }
}

function fuseSawInHalfInPlace(sentences: string[], lineStart: boolean[]): void {
  for (let index = 0; index + 1 < sentences.length; index += 1) {
    if (lineStart[index + 1] || !sentences[index] || !sentences[index + 1]) {
      continue;
    }
    const copies =
      /^If that creature dies this way, its controller creates two tokens that are copies of that creature, except their power is half that creature's power and their toughness is half that creature's toughness$/i.test(
        sentences[index]!,
      );
    if (!copies || !/^Round up each time$/i.test(sentences[index + 1]!)) {
      continue;
    }
    sentences.splice(index, 2, "saw-in-half-copies");
    lineStart.splice(index + 1, 1);
  }
}

function fuseSearchPutInPlace(sentences: string[], lineStart: boolean[]): void {
  for (let index = 0; index + 1 < sentences.length; index += 1) {
    if (lineStart[index + 1] || !sentences[index] || !sentences[index + 1]) {
      continue;
    }
    if (!/^Search your library for /i.test(sentences[index]!)) {
      continue;
    }
    // Only the bare destination sentence. Anything carrying a rider of its
    // own ("with an additional +1/+1 counter") is left alone, because the
    // joined clause would silently drop it.
    const put = sentences[index + 1]!.match(
      /^Put that card (onto the battlefield(?: tapped)?|into your hand), then shuffle$/i,
    );
    if (!put?.[1]) {
      continue;
    }
    sentences.splice(
      index,
      2,
      `${sentences[index]!}, put that card ${put[1].toLowerCase()}, then shuffle`,
    );
    lineStart.splice(index + 1, 1);
  }
}

function fuseDigSentencesInPlace(sentences: string[], lineStart: boolean[]): void {
  for (let index = 0; index + 2 < sentences.length; index += 1) {
    if (lineStart[index + 1] || lineStart[index + 2]) {
      continue;
    }
    // The prefix is an activation cost ("{2}, {T}: Look at …") or a TRIGGER
    // HEAD ("When this enchantment enters, look at …"). Without the second,
    // the fuser ran over every printed spell and skipped every permanent
    // that does the same thing on arrival — the dig sentences then split
    // three ways and none of them compiled.
    const look = sentences[index]!.match(
      /^(.*: |(?:When|Whenever|At)\b.*?, )?(Look at|Reveal) the top (two|three|four|five|six|seven|eight|\d+) cards of your library$/i,
    );
    if (!look?.[3]) {
      continue;
    }
    const count = parseCount(look[3]);
    if (!count) {
      continue;
    }
    // "In any order" and "in a random order" are the same instruction to an
    // engine that has no ordering prompt for the discarded remainder — and
    // "the bottom" is sometimes printed without "of your library".
    const restBottom =
      /^Put the rest on the bottom(?: of your library)? in (?:a random|any) order$/i.test(
        sentences[index + 2]!,
      );
    // Grisly Salvage: the unpicked reveals go to the graveyard instead.
    const restGraveyard = /^Put the rest into your graveyard$/i.test(sentences[index + 2]!);
    if (!restBottom && !restGraveyard) {
      continue;
    }
    const mid = sentences[index + 1]!;
    const toHand = mid.match(
      /^You may (?:reveal|put) an? (.+?) card from among them (?:and put it )?into your hand$/i,
    );
    const toField = mid.match(/^You may put an? (.+?) card from among them onto the battlefield( tapped)?$/i);
    const descriptor = toHand?.[1] ?? toField?.[1];
    if (!descriptor) {
      continue;
    }
    const destination = toHand ? "hand" : toField?.[2] ? "battlefield_tapped" : "battlefield";
    const restSuffix = restGraveyard ? " rest graveyard" : "";
    sentences.splice(
      index,
      3,
      `${look[1] ?? ""}Dig ${count} for ${descriptor} to ${destination}${restSuffix}`,
    );
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
/**
 * Archdruid's Charm's first bullet. The three sentences say ONE thing
 * between them — search, then split the destination on what was found —
 * and none of the last two means anything alone. Fusing them keeps
 * "Otherwise, put it into your hand" from becoming a global no-op that
 * would silently swallow the same sentence on a card with no search in
 * front of it.
 */
function fuseSplitDestinationSearchInPlace(sentences: string[], lineStart: boolean[]): void {
  for (let index = 0; index + 3 < sentences.length; index += 1) {
    if (lineStart[index + 1] || lineStart[index + 2] || lineStart[index + 3]) {
      continue;
    }
    const search = sentences[index]!.match(
      /^Search your library for an? (?:creature or land|land or creature) card and reveal it$/i,
    );
    if (
      search &&
      /^Put it onto the battlefield tapped if it's a land card$/i.test(sentences[index + 1]!) &&
      /^Otherwise, put it into your hand$/i.test(sentences[index + 2]!) &&
      /^Then shuffle$/i.test(sentences[index + 3]!)
    ) {
      // The shuffle comes with the search and is not a separate effect.
      sentences.splice(index, 4, "search creature or land, land to battlefield tapped");
      lineStart.splice(index + 1, 3);
    }
  }
}

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

/** Traverse the Outlands: the greatest-power basic fetch, fused. */
function fuseMaySacrificeInPlace(sentences: string[], lineStart: boolean[]): void {
  // Springbloom Druid: "…, you may sacrifice a land. If you do, X." fuses
  // to one synthetic clause.
  for (let index = 0; index + 1 < sentences.length; index += 1) {
    if (lineStart[index + 1]) {
      continue;
    }
    const head = sentences[index]?.match(
      /^(.+, )?you may sacrifice (a land|another creature)$/i,
    );
    const rider = sentences[index + 1]?.match(/^If you do, (.+)$/i);
    if (!head || !rider?.[1]) {
      continue;
    }
    sentences[index] = `${head[1] ?? ""}you may sacrifice ${head[2]} to do: ${rider[1]}`;
    sentences.splice(index + 1, 1);
    lineStart.splice(index + 1, 1);
  }
}

function fuseNecroTopInPlace(sentences: string[], lineStart: boolean[]): void {
  // Necropotence: the two-sentence activation body fuses to one synthetic
  // clause (the face-down detail is a documented approximation).
  for (let index = 0; index + 1 < sentences.length; index += 1) {
    if (lineStart[index + 1]) {
      continue;
    }
    if (
      /Exile the top card of your library face down$/i.test(sentences[index] ?? "") &&
      /^Put that card into your hand at the beginning of your next end step$/i.test(
        sentences[index + 1] ?? "",
      )
    ) {
      sentences[index] = sentences[index]!.replace(
        /Exile the top card of your library face down$/i,
        "Necro-exile the top card of your library",
      );
      sentences.splice(index + 1, 1);
      lineStart.splice(index + 1, 1);
    }
  }
}

function fuseItCantBeBlockedInPlace(sentences: string[], lineStart: boolean[]): void {
  // Kappa Cannoneer: "…put a +1/+1 counter on ~. It can't be blocked this
  // turn." The second sentence belongs to the trigger body the first one is
  // in — left alone it becomes a top-level effect on a permanent card, which
  // is not a place effects run. "It" is the source, since the sentence before
  // it acted on the source; the fuse is refused otherwise rather than
  // guessing, because in a trigger body "it" usually means the watched object.
  for (let index = 0; index + 1 < sentences.length; index += 1) {
    if (lineStart[index + 1]) {
      continue;
    }
    if (
      /on (?:~|this creature)$/i.test(sentences[index] ?? "") &&
      /^It can't be blocked this turn$/i.test(sentences[index + 1] ?? "")
    ) {
      sentences[index] = `${sentences[index]} and ~ can't be blocked this turn`;
      sentences.splice(index + 1, 1);
      lineStart.splice(index + 1, 1);
    }
  }
}

/**
 * Noxious Gearhulk: "…destroy another target creature. If a creature is
 * destroyed this way, you gain life equal to its toughness."
 *
 * The rider belongs to the trigger body the destroy is in. Left as its own
 * sentence it becomes a top-level effect on a PERMANENT card, which is not a
 * place effects run — the same trap Kappa Cannoneer's rider fell into above,
 * and the reason the fused form is what the clause matches.
 */
/**
 * Portal to Phyrexia: "…onto the battlefield under your control." + "It's a
 * Phyrexian in addition to its other types." The rider belongs to the
 * trigger that put the card down. Left as its own sentence it lands in
 * `definition.effects`, which a PERMANENT never runs — the card compiles
 * with zero notes and the type is never added.
 */
function fuseInAdditionTypeInPlace(sentences: string[], lineStart: boolean[]): void {
  for (let index = 0; index + 1 < sentences.length; index += 1) {
    if (lineStart[index + 1]) {
      continue;
    }
    const rider = sentences[index + 1]?.match(
      /^It's an? ([A-Z][a-z]+) in addition to its other types$/,
    );
    if (rider?.[1] && /onto the battlefield/i.test(sentences[index] ?? "")) {
      sentences[index] = `${sentences[index]}, then it becomes a ${rider[1]} in addition`;
      sentences.splice(index + 1, 1);
      lineStart.splice(index + 1, 1);
    }
  }
}

function fuseDestroyLifegainInPlace(sentences: string[], lineStart: boolean[]): void {
  for (let index = 0; index + 1 < sentences.length; index += 1) {
    if (lineStart[index + 1]) {
      continue;
    }
    if (
      /destroy another target creature$/i.test(sentences[index] ?? "") &&
      /^If a creature is destroyed this way, you gain life equal to its toughness$/i.test(
        sentences[index + 1] ?? "",
      )
    ) {
      sentences[index] = `${sentences[index]} and gain life equal to its toughness`;
      sentences.splice(index + 1, 1);
      lineStart.splice(index + 1, 1);
    }
  }
}

/**
 * Emry: "Choose target artifact card in your graveyard. You may cast that
 * card this turn." The permission belongs to the activation the choice is
 * in — left as its own sentence it has no card to name, and on a permanent
 * card a top-level effect never runs at all.
 */
function fuseChooseGraveyardCastInPlace(sentences: string[], lineStart: boolean[]): void {
  for (let index = 0; index + 1 < sentences.length; index += 1) {
    if (lineStart[index + 1]) {
      continue;
    }
    if (
      /Choose target ([a-z]+ )?card in your graveyard$/i.test(sentences[index] ?? "") &&
      /^You may cast that card this turn$/i.test(sentences[index + 1] ?? "")
    ) {
      sentences[index] = `${sentences[index]} and you may cast that card this turn`;
      sentences.splice(index + 1, 1);
      lineStart.splice(index + 1, 1);
    }
  }
}

/**
 * Spelunking: "…you may put a land card from your hand onto the battlefield.
 * If you put a Cave onto the battlefield this way, you gain 4 life."
 *
 * The rider reads the card the previous sentence chose, so it has to be part
 * of that clause — on its own it names a card nothing has picked, and on a
 * permanent card a top-level effect never runs.
 */
function fusePutLandRiderInPlace(sentences: string[], lineStart: boolean[]): void {
  for (let index = 0; index + 1 < sentences.length; index += 1) {
    if (lineStart[index + 1]) {
      continue;
    }
    const rider = sentences[index + 1]?.match(
      /^If you put an? ([A-Z][a-z-]+) onto the battlefield this way, you gain (\d+) life$/,
    );
    if (
      rider?.[1] &&
      rider[2] &&
      /put a land card from your hand onto the battlefield$/i.test(sentences[index] ?? "")
    ) {
      sentences[index] =
        `${sentences[index]} gaining ${rider[2]} life if it is a ${rider[1]}`;
      sentences.splice(index + 1, 1);
      lineStart.splice(index + 1, 1);
    }
  }
}

/** One mana pip, as regex source: the Bash-safe way to spell `\\{[^}]+\\}`
 * in a string the several may-pay readers below share. */
/**
 * The filters the "from among them" cluster actually names. Written out
 * rather than shared with a general noun reader because the list is short
 * and a wrong filter here silently offers the wrong cards.
 */
const AMONG_MILLED_FILTERS: Record<string, CardFilter> = {
  "": "any",
  land: "land",
  creature: "creature",
  permanent: "permanent",
  artifact: "artifact",
  enchantment: "enchantment",
};

/**
 * "You may put a land card from among them into your hand." — "them" is the
 * set the mill in the same ability just made, read at prompt time through
 * `milledThisWay`.
 */
function compileFromAmongMilled(sentence: string): CardEffect[] | null {
  const match = sentence.match(
    /^(You may put|Put) (?:an? )?([a-z]+ )?card from among (?:them|those cards) into your hand$/i,
  );
  if (!match) {
    return null;
  }
  const filter = AMONG_MILLED_FILTERS[(match[2] ?? "").trim().toLowerCase()];
  if (!filter) {
    return null;
  }
  return [
    {
      kind: "choose_card",
      chooserId: "controller",
      ...(/^you may/i.test(match[1] ?? "") ? { optional: true } : {}),
      sources: [
        {
          playerId: "controller",
          zone: "graveyard",
          filter,
          milledThisWay: true,
        },
      ],
      thenEffects: [{ kind: "move_card", cardId: "chosen_card", toZone: "hand" }],
    },
  ];
}

const DIGITS = "\\d+";
const MANA_PIP_SOURCE = "\\{[^}]+\\}";

function fuseMayPayInPlace(sentences: string[], lineStart: boolean[]): void {
  // Mentor of the Meek: "…, you may pay {1}. If you do, draw a card." fuses
  // into one synthetic clause the may_pay parser reads.
  for (let index = 0; index + 1 < sentences.length; index += 1) {
    if (lineStart[index + 1]) {
      continue;
    }
    // Three cost shapes: mana, life, or "{1} and 3 life" — one optional
    // cost with two halves (Ripples of Undeath).
    const head = sentences[index]?.match(
      new RegExp(
        "^(.+, (?:then )?you may pay (?:(?:" +
          MANA_PIP_SOURCE +
          ")+(?: and " + DIGITS + " life)?|" + DIGITS + " life))$",
        "i",
      ),
    );
    const rider = sentences[index + 1]?.match(/^If you do, (.+)$/i);
    if (!head?.[1] || !rider?.[1]) {
      continue;
    }
    sentences[index] = `${head[1]} to do: ${rider[1]}`;
    sentences.splice(index + 1, 1);
    lineStart.splice(index + 1, 1);
  }
}

function fuseMoxDiamondInPlace(sentences: string[], lineStart: boolean[]): void {
  // Mox Diamond prints its replacement as three sentences: the offer, and
  // one for each answer. The last two say exactly what the replacement
  // already means, so they are dropped here — compiled separately they
  // would be top-level effects on an artifact card ("put ~ onto the
  // battlefield") that never run, and the card would score while doing
  // nothing at all.
  for (let index = 0; index + 2 < sentences.length; index += 1) {
    if (lineStart[index + 1] || lineStart[index + 2]) {
      continue;
    }
    if (
      !/^If ~ would enter, you may discard a land card instead$/i.test(
        sentences[index] ?? "",
      ) ||
      !/^If you do, put ~ onto the battlefield$/i.test(sentences[index + 1] ?? "") ||
      !/^If you don['\u2019]t, put it into its owner['\u2019]s graveyard$/i.test(
        sentences[index + 2] ?? "",
      )
    ) {
      continue;
    }
    sentences.splice(index + 1, 2);
    lineStart.splice(index + 1, 2);
  }
}

function fuseOpeningHandStartInPlace(
  sentences: string[],
  lineStart: boolean[],
): void {
  // Gemstone Caverns prints the offer and its price as two sentences on one
  // line. "If you do, exile a card from your hand" alone has nothing to be
  // the price OF, and the offer alone would be a free land.
  for (let index = 0; index + 1 < sentences.length; index += 1) {
    if (lineStart[index + 1]) {
      continue;
    }
    const offer = sentences[index]?.match(
      /^If this card is in your opening hand and you['’]re not the starting player, you may begin the game with ~ on the battlefield with an? ([a-z]+) counter on it$/i,
    );
    const price = sentences[index + 1]?.match(
      /^If you do, exile (a|an|one|two|\d+) cards? from your hand$/i,
    );
    if (!offer?.[1] || !price?.[1]) {
      continue;
    }
    sentences[index] = `Begin the game with ~ on the battlefield with a ${offer[1]} counter, exiling ${price[1]} cards from your hand`;
    sentences.splice(index + 1, 1);
    lineStart.splice(index + 1, 1);
    index -= 1;
  }
}

function fuseEscapeGrantInPlace(sentences: string[], lineStart: boolean[]): void {
  // Underworld Breach prints the grant and its cost as two sentences on one
  // line. "Each nonland card in your graveyard has escape" alone says
  // nothing about what escaping costs, and the cost sentence alone has
  // nothing to attach to.
  for (let index = 0; index + 1 < sentences.length; index += 1) {
    if (lineStart[index + 1]) {
      continue;
    }
    if (
      !/^Each nonland card in your graveyard has escape$/i.test(sentences[index] ?? "")
    ) {
      continue;
    }
    const cost = sentences[index + 1]?.match(
      /^The escape cost is equal to the card['’]s mana cost plus exile (a|an|one|two|three|four|five|\d+) other cards? from your graveyard$/i,
    );
    if (!cost?.[1]) {
      continue;
    }
    sentences[index] = `Each nonland card in your graveyard has escape for exiling ${cost[1]} other cards`;
    sentences.splice(index + 1, 1);
    lineStart.splice(index + 1, 1);
    index -= 1;
  }
}

function fuseManaUntilEotInPlace(sentences: string[], lineStart: boolean[]): void {
  // Birgi: "…, add {R}." then "Until end of turn, you don't lose this mana
  // as steps and phases end." The second names the mana the first added, so
  // parked alone it is an uncompiled sentence and the mana quietly empties
  // at the next step — which is the whole card.
  for (let index = 0; index + 1 < sentences.length; index += 1) {
    if (lineStart[index + 1]) {
      continue;
    }
    const adds = sentences[index]?.match(/^(.*\badd (?:\{[WUBRGC]\})+)$/i);
    const rider = sentences[index + 1];
    if (
      !adds?.[1] ||
      !rider ||
      !/^Until end of turn, you don['’]t lose this mana as steps and phases end$/i.test(
        rider,
      )
    ) {
      continue;
    }
    sentences[index] = `${adds[1]} that doesn't empty until end of turn`;
    sentences.splice(index + 1, 1);
    lineStart.splice(index + 1, 1);
    index -= 1;
  }
}

function fuseVoidPlayInPlace(sentences: string[], lineStart: boolean[]): void {
  // Dauthi Voidwalker prints the choice and the permission as two sentences
  // on one line: "Choose an exiled card…" and "You may play it this turn…".
  // The second names the card the first chose, so neither means anything
  // alone — split, the choice picks a card and does nothing with it.
  for (let index = 0; index + 1 < sentences.length; index += 1) {
    if (lineStart[index + 1]) {
      continue;
    }
    const choose = sentences[index]?.match(
      /^(.*\bChoose an exiled card an opponent owns with a void counter on it)$/i,
    );
    const play = sentences[index + 1];
    if (
      !choose?.[1] ||
      !play ||
      !/^You may play it this turn without paying its mana cost$/i.test(play)
    ) {
      continue;
    }
    sentences[index] =
      `${choose[1]}, and you may play it this turn without paying its mana cost`;
    sentences.splice(index + 1, 1);
    lineStart.splice(index + 1, 1);
    index -= 1;
  }
}

function fuseLookTopTakeInPlace(sentences: string[], lineStart: boolean[]): void {
  // Herald's Horn prints "look at the top card of your library." and "If
  // it's a creature card of the chosen type, you may reveal it and put it
  // into your hand." as two sentences. The second names the card the
  // first looked at, so neither compiles alone — the look would discard
  // what it saw and the condition would have no referent.
  for (let index = 0; index + 1 < sentences.length; index += 1) {
    if (lineStart[index + 1]) {
      continue;
    }
    const look = sentences[index]?.match(
      /^(.*\blook at the top card of your library)$/i,
    );
    const rider = sentences[index + 1]?.match(/^If it's (.+)$/i);
    if (!look?.[1] || !rider?.[1]) {
      continue;
    }
    sentences[index] = `${look[1]}, and if it's ${rider[1]}`;
    sentences.splice(index + 1, 1);
    lineStart.splice(index + 1, 1);
    index -= 1;
  }
}

function fuseChooseTargetCreatureInPlace(
  sentences: string[],
  lineStart: boolean[],
): void {
  // Malakir Rebirth: "Choose target creature. Until end of turn, that
  // creature gains \"…\"" — the grant already compiles when the target is
  // written into it, so the pair fuses rather than teaching the grant
  // parser a second name for its subject. Left split, the "Choose target
  // creature" sentence compiles to a target requirement with no effect.
  for (let index = 0; index + 1 < sentences.length; index += 1) {
    if (lineStart[index + 1]) {
      continue;
    }
    if (!/^Choose target creature$/i.test(sentences[index] ?? "")) {
      continue;
    }
    // The grant need not be the very next sentence — Malakir Rebirth puts
    // "You lose 2 life." between them — so scan forward within the line.
    let riderAt = -1;
    let riderBody = "";
    for (let ahead = index + 1; ahead < sentences.length; ahead += 1) {
      if (lineStart[ahead]) {
        break;
      }
      const found = sentences[ahead]?.match(
        /^Until end of turn, that creature (.+)$/i,
      );
      if (found?.[1]) {
        riderAt = ahead;
        riderBody = found[1];
        break;
      }
    }
    if (riderAt < 0) {
      continue;
    }
    sentences[riderAt] = `Until end of turn, target creature ${riderBody}`;
    // The choose sentence has done its job; left in place it compiles to
    // a SECOND target requirement the grant would not use.
    sentences.splice(index, 1);
    lineStart.splice(index, 1);
    index -= 1;
  }
}

function fusePactInPlace(sentences: string[], lineStart: boolean[]): void {
  // Pact of Negation: "…, pay {3}{U}{U}. If you don't, you lose the game."
  // The penalty belongs INSIDE the delayed trigger — left as its own
  // sentence it would be a top-level effect on the spell, losing the game
  // the moment the Pact resolved.
  for (let index = 0; index + 1 < sentences.length; index += 1) {
    if (lineStart[index + 1]) {
      continue;
    }
    const head = sentences[index]?.match(/^(.*\bpay (?:\{[^}]+\})+)$/i);
    const rider = sentences[index + 1]?.match(
      /^If you don['\u2019]t, you lose the game$/i,
    );
    if (!head?.[1] || !rider) {
      continue;
    }
    sentences[index] = `${head[1]} or you lose the game`;
    sentences.splice(index + 1, 1);
    lineStart.splice(index + 1, 1);
  }
}

function fuseThenIntoTriggerInPlace(
  sentences: string[],
  lineStart: boolean[],
): void {
  // Orcish Bowmasters: "…, ~ deals 1 damage to that player. Then amass
  // Orcs 1." The "Then" clause belongs INSIDE the trigger body; parked as
  // its own sentence it becomes a top-level effect on a creature card,
  // where nothing ever runs it. Fused before the head split below, so a
  // dual head carries the whole body into BOTH of its triggers.
  for (let index = 0; index + 1 < sentences.length; index += 1) {
    if (lineStart[index + 1]) {
      continue;
    }
    const head = sentences[index] ?? "";
    if (!/^(?:When|Whenever|At) .+, .+$/i.test(head)) {
      continue;
    }
    const rider = sentences[index + 1]?.match(/^Then (.+)$/i);
    if (!rider?.[1]) {
      continue;
    }
    sentences[index] = `${head}, then ${rider[1]}`;
    sentences.splice(index + 1, 1);
    lineStart.splice(index + 1, 1);
    index -= 1;
  }
}

function expandDualTriggerHeadInPlace(
  sentences: string[],
  lineStart: boolean[],
): void {
  // Orcish Bowmasters: "When ~ enters AND whenever an opponent draws a
  // card …, BODY" is two triggered abilities sharing one body (CR 603.1).
  // Read as one head, the second half was dropped with no note at all —
  // the card compiled clean and did half of what it says.
  for (let index = 0; index < sentences.length; index += 1) {
    const match = sentences[index]?.match(
      /^When(?:ever)? (.+?) and whenever (.+?), (.+)$/i,
    );
    if (!match?.[1] || !match[2] || !match[3]) {
      continue;
    }
    // Only split when BOTH halves read as heads on their own. A comma-free
    // "and whenever" inside a body would otherwise be torn in two.
    const first = `When ${match[1]}`;
    const second = `Whenever ${match[2]}`;
    // "When ~ enters" is read by its own branch further down rather than
    // by parseTriggerHead, so it is recognised here directly.
    const firstReadable = /^When ~ enters$/i.test(first) || parseTriggerHead(first) !== null;
    if (!firstReadable || !parseTriggerHead(second)) {
      continue;
    }
    sentences[index] = `${first}, ${match[3]}`;
    sentences.splice(index + 1, 0, `${second}, ${match[3]}`);
    lineStart.splice(index + 1, 0, true);
    index += 1;
  }
}

function expandEntersOrDiesInPlace(sentences: string[], lineStart: boolean[]): void {
  // Stitcher's Supplier: "When ~ enters or dies, X" expands to one enter
  // trigger and one dies trigger carrying the same clause.
  for (let index = 0; index < sentences.length; index += 1) {
    const match = sentences[index]?.match(/^When(?:ever)? ~ enters or dies, (.+)$/i);
    if (!match?.[1]) {
      continue;
    }
    sentences[index] = `When ~ enters, ${match[1]}`;
    sentences.splice(index + 1, 0, `When ~ dies, ${match[1]}`);
    lineStart.splice(index + 1, 0, true);
    index += 1;
  }
}

function fuseTraverseInPlace(sentences: string[], lineStart: boolean[]): void {
  for (let index = 0; index + 1 < sentences.length; index += 1) {
    if (lineStart[index + 1]) {
      continue;
    }
    if (
      /^Search your library for up to X basic land cards, where X is the greatest power among creatures you control$/i.test(
        sentences[index]!,
      ) &&
      /^Put those cards onto the battlefield tapped, then shuffle$/i.test(sentences[index + 1]!)
    ) {
      sentences.splice(index, 2, "traverse-basics to battlefield tapped");
      lineStart.splice(index + 1, 1);
    }
  }
}

/** Charming Prince: "Exile another target creature you own." + "Return it to
 * the battlefield under your control at the beginning of the next end step."
 * become one synthetic delayed-flicker sentence. */
function fuseExileReturnEndStepInPlace(sentences: string[], lineStart: boolean[]): void {
  for (let index = 0; index + 1 < sentences.length; index += 1) {
    if (lineStart[index + 1]) {
      continue;
    }
    const exile = sentences[index]!.match(/^(.*)Exile (another )?target creature you own$/i);
    if (
      exile &&
      /^Return it to the battlefield under your control at the beginning of the next end step$/i.test(
        sentences[index + 1]!,
      )
    ) {
      sentences.splice(
        index,
        2,
        `${exile[1] ?? ""}flicker-delay ${exile[2] ? "another " : ""}target creature you own`,
      );
      lineStart.splice(index + 1, 1);
      continue;
    }
    // Nezahal: the SELF blink, home tapped. "Its owner" and "your" are the
    // same player for a permanent blinking itself, so both wordings land on
    // the same clause.
    const selfExile = sentences[index]!.match(/^(.*)Exile ~$/i);
    const selfReturn = sentences[index + 1]!.match(
      /^Return it to the battlefield (tapped )?under (?:its owner's|your) control at the beginning of the next end step$/i,
    );
    if (selfExile && selfReturn) {
      sentences.splice(
        index,
        2,
        `${selfExile[1] ?? ""}flicker-delay-self${selfReturn[1] ? " tapped" : ""}`,
      );
      lineStart.splice(index + 1, 1);
      continue;
    }

    // Eerie Interlude: the mass blink, home to each owner.
    const mass = sentences[index]!.match(
      /^(.*)Exile any number of target creatures you control$/i,
    );
    if (
      mass &&
      /^Return those cards to the battlefield under their owner's control at the beginning of the next end step$/i.test(
        sentences[index + 1]!,
      )
    ) {
      sentences.splice(index, 2, `${mass[1] ?? ""}flicker-delay-mass your creatures`);
      lineStart.splice(index + 1, 1);
    }
  }
}

/**
 * Diamond Pick-Axe, Kaldra Compleat, Bear Umbra: `Equipped creature gets +1/+1
 * and has "Whenever ~ attacks, …"` splits into the buff sentence and the
 * quoted trigger, rewritten to watch the host — which is exactly what the
 * `Whenever equipped creature …` heads already mean. Granting a trigger to
 * another permanent would need a second address space for trigger indexes;
 * the Equipment carrying its own attached-watch trigger is the same game.
 *
 * Quoted ACTIVATED abilities (Paradise Mantle's `"{T}: Add one mana of any
 * color."`) are deliberately left alone: the same rewrite would put the
 * ability on the Equipment, so it would tap itself instead of the creature.
 */
function splitGrantedQuotedTriggerInPlace(sentences: string[], lineStart: boolean[]): void {
  for (let index = 0; index < sentences.length; index += 1) {
    const match = sentences[index]!.match(
      /^((?:Equipped|Enchanted) creature .*?)\s*"([^"]+)"\.?$/i,
    );
    const quoted = match?.[2]?.trim();
    if (!match?.[1] || !quoted || !/^(?:Whenever|When|At the beginning)\b/i.test(quoted)) {
      continue;
    }
    const subject = /^Equipped/i.test(match[1]) ? "equipped creature" : "enchanted creature";
    const body = quoted.replace(/~/g, subject).replace(/\.$/, "");
    // Everything before the quote, unwound in printed order: the "has" that
    // introduced the quote, then the "and" that joined it to whatever came
    // before. Doing these in the wrong order silently eats the other half of
    // "gets +1/+1 and has \"…\"".
    const head = match[1]
      .replace(/\s+has$/i, "")
      .replace(/(?:,)?\s*and$/i, "")
      .replace(/,$/, "")
      .trim();
    // Nothing but the subject left: the quote was the only grant.
    const replacement = /^(?:Equipped|Enchanted) creature$/i.test(head) ? [body] : [head, body];
    sentences.splice(index, 1, ...replacement);
    lineStart.splice(index, 1, ...replacement.map(() => true));
    index += replacement.length - 1;
  }
}

/** Ancient Copper Dragon: "roll a d20" + "You create a number of Treasure
 * tokens equal to the result" become one synthetic clause sentence. */
function fuseD20TreasuresInPlace(sentences: string[], lineStart: boolean[]): void {
  for (let index = 0; index + 1 < sentences.length; index += 1) {
    if (lineStart[index + 1]) {
      continue;
    }
    const roll = sentences[index]!.match(/^(.*, )?roll a d20$/i);
    if (
      roll &&
      /^You create a number of Treasure tokens equal to the result$/i.test(sentences[index + 1]!)
    ) {
      sentences.splice(index, 2, `${roll[1] ?? ""}roll a d20 for Treasures`);
      lineStart.splice(index + 1, 1);
    }
  }
}

/** Epic Confrontation: "Target creature you control gets +1/+2 until end of
 * turn." + "It fights target creature you don't control." — one clause. */
function fuseBiteInPlace(sentences: string[], lineStart: boolean[]): void {
  for (let index = 0; index + 1 < sentences.length; index += 1) {
    if (lineStart[index + 1]) {
      continue;
    }
    const buff = sentences[index]!.match(
      /^(.*)Target creature you control gets ([+-]\d+)\/([+-]\d+) until end of turn$/i,
    );
    if (buff && /^It fights target creature you don't control$/i.test(sentences[index + 1]!)) {
      sentences.splice(
        index,
        2,
        `${buff[1] ?? ""}Target creature you control gets ${buff[2]}/${buff[3]} until end of turn, then fights target creature you don't control`,
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
    if (own && /^You may play (?:it|that card|them|those cards) this turn$/i.test(sentences[index + 1]!)) {
      const count = own[2]!.toLowerCase() === "card" ? 1 : parseCount(own[2]!.split(" ")[0]!) ?? 1;
      const suffix = count === 1 ? "" : ` ${count}`;
      sentences.splice(index, 2, `${own[1] ?? ""}impulse${suffix} from your library`);
      lineStart.splice(index + 1, 1);
      continue;
    }
    // Atsushi: the grant lasts through the caster's next turn.
    if (
      own &&
      /^Until the end of your next turn, you may play (?:it|that card|them|those cards)$/i.test(
        sentences[index + 1]!,
      )
    ) {
      const count = own[2]!.toLowerCase() === "card" ? 1 : parseCount(own[2]!.split(" ")[0]!) ?? 1;
      const suffix = count === 1 ? "" : ` ${count}`;
      sentences.splice(index, 2, `${own[1] ?? ""}impulse${suffix} extended from your library`);
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
  | "classLevel"
  | "condition"
  | "onSelfCast"
> & {
  /** "enters or attacks": emit a sibling trigger for each extra event. */
  extraEvents?: CardTrigger["event"][];
};

/** "Whenever another creature dies" → dies / any / excludeSelf, and friends. */
function parseTriggerHead(head: string): TriggerHead | null {
  // "When X enters AND whenever Y" is TWO abilities sharing a body (CR
  // 603.1). The splitter upstream turns it into two sentences when it can
  // read both halves; if it could not, reading just the first half here
  // would drop the second with no note at all — the card would compile
  // clean and do half of what it says. Refuse instead.
  if (/\band whenever\b/i.test(head)) {
    return null;
  }
  const text = head.replace(ABILITY_WORD_PREFIX, "").trim();
  // "When you cast this spell" (CR 603.2c): the watcher is the spell being
  // cast, not a permanent watching the table. Its own flag, because every
  // other cast head watches somebody else's spells.
  if (/^When you cast this spell$/i.test(text)) {
    return { event: "cast_spell", watch: "self", onSelfCast: true };
  }
  // Bloodchief Ascension. "From anywhere" is the wave-359 superset, not Syr
  // Konrad's "from anywhere but the battlefield" — a creature of theirs
  // dying counts, and that is most of what the card does.
  if (
    /^Whenever a card is put into an opponent's graveyard from anywhere$/i.test(text)
  ) {
    return { event: "put_into_graveyard", watch: "opponents" };
  }
  // Call of the Ring: the tempt itself dispatches this when it names a
  // bearer, so a tempt that changes nothing fires nothing.
  if (/^Whenever you choose a creature as your Ring-bearer$/i.test(text)) {
    return { event: "chooses_ring_bearer" };
  }
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
  // Goldspan Dragon: "whenever ~ becomes the target of a spell".
  if (/^Whenever ~ becomes the target of a spell$/i.test(text)) {
    return { event: "becomes_target" };
  }
  // Orcish Bowmasters. The exemption is not decoration: without it the
  // Bowmasters ping on the draw step too, which is a strictly stronger
  // card than the one printed.
  if (
    /^Whenever an opponent draws a card except the first one they draw in each of their draw steps$/i.test(
      text,
    )
  ) {
    return { event: "opponent_draws_except_first" };
  }
  // Midnight Clock: "When the TWELFTH hour counter is put on ~". The same
  // counter-added event Fathom Mage watches, with an intervening `if` on how
  // many are now there — a count, not a distinct twelfth-counter event.
  const nthCounter = text.match(
    /^When the (\w+) ([a-z+/-]+) counter is put on ~$/i,
  );
  const ORDINAL_COUNTS: Record<string, number> = {
    second: 2,
    third: 3,
    fourth: 4,
    fifth: 5,
    sixth: 6,
    seventh: 7,
    eighth: 8,
    ninth: 9,
    tenth: 10,
    eleventh: 11,
    twelfth: 12,
  };
  const nthCount = nthCounter?.[1]
    ? ORDINAL_COUNTS[nthCounter[1].toLowerCase()]
    : undefined;
  if (nthCount && nthCounter?.[2]) {
    const counter = counterKeyOf(nthCounter[2].toLowerCase());
    return {
      event: "counter_added",
      subjectFilter: { counterName: counter },
      condition: {
        kind: "self_counter_count",
        counter,
        comparison: "at_least",
        count: nthCount,
      },
    };
  }
  const classLevel = text.match(/^When ~ becomes level (\d+)$/i);
  if (classLevel?.[1]) {
    return { event: "class_level", classLevel: Number(classLevel[1]) };
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
  // Forbidden Orchard: the narrower question. "Becomes tapped" also fires
  // when the permanent taps to attack or an opponent taps it, and neither of
  // those is "you tap it for mana".
  if (/^Whenever you tap ~ for mana$/i.test(text)) {
    return { event: "taps_for_mana" };
  }
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
  // Goldspan Dragon: one head, two events.  emits a sibling
  // trigger carrying the same body, which is what CR 603.1 means by two
  // triggered abilities written as one sentence.
  if (/^Whenever ~ attacks or becomes the target of a spell$/i.test(text)) {
    return { event: "attacks", extraEvents: ["becomes_target"] };
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
  if (/^Whenever you lose life$/i.test(text)) {
    return { event: "you_lose_life" };
  }
  if (/^Whenever ~ or another creature dies$/i.test(text)) {
    return { event: "dies", watch: "any", subjectFilter: { types: ["creature"] } };
  }
  if (/^Whenever another creature dies$/i.test(text)) {
    return { event: "dies", watch: "any", excludeSelf: true, subjectFilter: { types: ["creature"] } };
  }
  // Mystic Sanctuary: "When ~ enters untapped". The event is the ordinary
  // battlefield entry; "untapped" is an intervening condition read on the
  // source, so a Sanctuary that entered tapped queues nothing.
  if (/^When ~ enters untapped$/i.test(text)) {
    return {
      event: "enter_battlefield",
      condition: { kind: "self_untapped" },
    };
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
  if (
    new RegExp(
      `^Whenever a creature token you control ${COMBAT_DAMAGE_TO_PLAYER}$`,
      "i",
    ).test(text)
  ) {
    return {
      event: "deals_combat_damage_to_player",
      watch: "controlled",
      subjectFilter: { types: ["creature"], tokenOnly: true },
      ...(/an opponent$/i.test(text) ? { subjectPlayerOpponent: true } : {}),
    };
  }
  // "…creatures you control" and Thopter Spy Network's narrower "…ARTIFACT
  // creatures you control" are the same head with one more type on the
  // filter, so they read as one line rather than two branches.
  const batchCombatDamage = text.match(
    /^Whenever one or more (artifact )?creatures you control deal combat damage to a player$/i,
  );
  if (batchCombatDamage) {
    return {
      event: "deals_combat_damage_to_player",
      watch: "controlled",
      subjectFilter: {
        types: batchCombatDamage[1] ? ["artifact", "creature"] : ["creature"],
      },
      oncePerBatch: true,
    };
  }
  // Kutzil: the batch must contain a pumped creature (computed > printed).
  if (
    /^Whenever one or more creatures you control each with power greater than its base power deals? combat damage to a player$/i.test(
      text,
    )
  ) {
    return {
      event: "deals_combat_damage_to_player",
      watch: "controlled",
      subjectFilter: { types: ["creature"], powerAboveBase: true },
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
  const secondSpell = text.match(
    /^Whenever (a player|an opponent) casts their second spell each turn$/i,
  );
  if (secondSpell?.[1]) {
    return {
      event: "casts_second_spell",
      ...(/^an opponent$/i.test(secondSpell[1]) ? { watch: "opponents" as const } : {}),
    };
  }
  if (/^Whenever a creature you control dies$/i.test(text)) {
    return { event: "dies", watch: "controlled", subjectFilter: { types: ["creature"] } };
  }
  // Sacrifice heads name who did it separately from what was sacrificed, so
  // "a player sacrifices a permanent" (Mayhem Devil), "you sacrifice an
  // artifact" and "a player sacrifices another permanent" (Mazirek) are one
  // shape rather than three.
  const sacrificed = text.match(
    /^Whenever (you|a player|an opponent) sacrifices? (another )?(?:an? )?(.+)$/i,
  );
  if (sacrificed?.[1] && sacrificed[3]) {
    const subject = parseTriggerSubjectPhrase(sacrificed[3], false);
    if (subject) {
      const who = sacrificed[1].toLowerCase();
      return {
        event: "player_sacrifices",
        // The sacrificer, not the permanent's controller — they are the same
        // player, since only a permanent's controller may sacrifice it.
        watch: who === "you" ? "controlled" : who === "an opponent" ? "opponents" : "any",
        ...(sacrificed[2] ? { excludeSelf: true } : {}),
        ...(Object.keys(subject.filter).length > 0 ? { subjectFilter: subject.filter } : {}),
      };
    }
  }
  if (/^Whenever a creature an opponent controls dies$/i.test(text)) {
    return { event: "dies", watch: "opponents", subjectFilter: { types: ["creature"] } };
  }
  if (/^Whenever a creature you control attacks$/i.test(text)) {
    return { event: "attacks", watch: "controlled", subjectFilter: { types: ["creature"] } };
  }
  // Skullclamp. Auras say "enchanted" for the same watch.
  if (/^Whenever (?:equipped|enchanted) creature dies$/i.test(text)) {
    return { event: "dies", watch: "attached" };
  }
  // Sword of the Animist, Bear Umbra.
  if (/^Whenever (?:equipped|enchanted) creature attacks$/i.test(text)) {
    return { event: "attacks", watch: "attached" };
  }
  // Enrage (Apex Altisaur).
  if (/^Whenever (?:~|this creature) is dealt damage$/i.test(text)) {
    return { event: "is_dealt_damage" };
  }
  // The Swords, Mask of Memory: the Equipment watches its host's strikes.
  if (
    new RegExp(
      `^Whenever (?:equipped|enchanted) creature ${COMBAT_DAMAGE_TO_PLAYER}$`,
      "i",
    ).test(text)
  ) {
    return {
      event: "deals_combat_damage_to_player",
      watch: "attached",
      ...(/an opponent$/i.test(text) ? { subjectPlayerOpponent: true } : {}),
    };
  }
  // The Gitrog Monster: "one or more LAND CARDS are put into your graveyard
  // FROM ANYWHERE" — a milled land and a fetch land both count, which is why
  // this is `graveyard_from_elsewhere` and not `dies`.
  const landsToGraveyard = text.match(
    /^Whenever one or more ([a-z]+) cards are put into your graveyard from anywhere$/i,
  );
  if (landsToGraveyard?.[1] && SEARCH_CARD_TYPES.has(landsToGraveyard[1].toLowerCase())) {
    return {
      event: "graveyard_from_elsewhere",
      subjectFilter: { types: [landsToGraveyard[1].toLowerCase()] },
      oncePerBatch: true,
    };
  }

  // Scrap Trawler: "~ dies OR another artifact you control is put into a
  // graveyard from the battlefield". The Trawler is itself an artifact, so
  // both halves are the same watch — an artifact you control dying, itself
  // included — and there is no `excludeSelf`, which is the whole reason it
  // chains off its own death.
  if (
    /^Whenever ~ dies or another artifact you control is put into a graveyard from the battlefield$/i.test(
      text,
    )
  ) {
    return {
      event: "dies",
      watch: "controlled",
      subjectFilter: { types: ["artifact"] },
    };
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
  if (/^Whenever (?:~|this creature) or another creature you control dies$/i.test(text)) {
    return { event: "dies", watch: "controlled", subjectFilter: { types: ["creature"] } };
  }
  // Puresteel Paladin: an Equipment-subtype arrival watch.
  if (/^Whenever an Equipment you control enters$/i.test(text)) {
    return {
      event: "enter_battlefield",
      watch: "controlled",
      subjectFilter: { subtypes: ["equipment"] },
    };
  }
  // Reckless Fireweaver: an artifact arrival watch.
  if (/^Whenever an artifact you control enters$/i.test(text)) {
    return {
      event: "enter_battlefield",
      watch: "controlled",
      subjectFilter: { types: ["artifact"] },
    };
  }
  // Reflections of Littjara: casts of the watcher's chosen type.
  if (/^Whenever you cast a spell of the chosen type$/i.test(text)) {
    return {
      event: "cast_spell",
      watch: "controlled",
      subjectFilter: { chosenSubtype: true },
    };
  }
  // Archaeomancer's Map: an opponent's land arrival.
  if (/^Whenever a land an opponent controls enters$/i.test(text)) {
    return {
      event: "enter_battlefield",
      watch: "opponents",
      subjectFilter: { types: ["land"] },
    };
  }
  // Tireless Tracker: "Whenever you sacrifice a Clue" — tokens only, a
  // documented approximation (nontoken Clues are vanishingly rare).
  const sacSubtype = text.match(/^Whenever you sacrifice an? ([A-Za-z]+)$/i);
  if (sacSubtype?.[1] && !SEARCH_CARD_TYPES.has(sacSubtype[1].toLowerCase())) {
    return {
      event: "you_sacrifice_token",
      subjectFilter: { subtypes: [sacSubtype[1].toLowerCase()] },
    };
  }
  // Constellation (an enchantment creature's own arrival counts too).
  if (
    /^Whenever an enchantment you control enters$/i.test(text) ||
    /^Whenever (?:~|this creature) or another enchantment you control enters$/i.test(text)
  ) {
    return {
      event: "enter_battlefield",
      watch: "controlled",
      subjectFilter: { types: ["enchantment"] },
    };
  }
  // Mentor of the Meek: the singular little-creature watch (per creature).
  const singleEnter = text.match(
    /^Whenever another creature you control with power (\d+) or less enters$/i,
  );
  if (singleEnter?.[1]) {
    return {
      event: "enter_battlefield",
      watch: "controlled",
      excludeSelf: true,
      subjectFilter: { types: ["creature"], maxPower: Number(singleEnter[1]) },
    };
  }
  // Tocasia's Welcome: a batched cheap-creature watch.
  const batchMvEnter = text.match(
    /^Whenever one or more creatures you control with mana value (\d+) or less enter$/i,
  );
  if (batchMvEnter?.[1]) {
    return {
      event: "enter_battlefield",
      watch: "controlled",
      oncePerBatch: true,
      subjectFilter: { types: ["creature"], maxManaValue: Number(batchMvEnter[1]) },
    };
  }
  // Ayara: a color-restricted self-or-another watch.
  const colorSelfEnter = text.match(
    /^Whenever ~ or another (white|blue|black|red|green) creature you control enters$/i,
  );
  if (colorSelfEnter?.[1]) {
    return {
      event: "enter_battlefield",
      watch: "controlled",
      subjectFilter: {
        types: ["creature"],
        colors: [COLOR_WORDS[colorSelfEnter[1].toLowerCase()]!],
      },
    };
  }
  // Welcoming Vampire / Enduring Innocence: a batched little-creature watch.
  const batchEnter = text.match(
    /^Whenever one or more other creatures you control with power (\d+) or less enter$/i,
  );
  if (batchEnter?.[1]) {
    return {
      event: "enter_battlefield",
      watch: "controlled",
      excludeSelf: true,
      oncePerBatch: true,
      subjectFilter: { types: ["creature"], maxPower: Number(batchEnter[1]) },
    };
  }
  // "your …" fires on the controller's step; "each …" on everyone's.
  // "each opponent's …" is deliberately absent: approximating it as every
  // player's step would fire it on the controller's own turn too, and
  // Archfiend of Depravity making its own controller sacrifice is a wrong
  // game, not a rough one. It stays a clean miss.
  const stepHead = text.match(
    /^At the beginning of (your|each|each player's|each opponent's|the) (upkeep|end step|draw step|first main phase|precombat main phase)$/i,
  );
  if (stepHead?.[1] && stepHead[2]) {
    const eventOf: Record<string, TriggerEvent> = {
      upkeep: "upkeep",
      "end step": "end_step",
      "draw step": "draw_step",
      "first main phase": "first_main_phase",
      "precombat main phase": "first_main_phase",
    };
    return {
      event: eventOf[stepHead[2].toLowerCase()]!,
      // "THE end step" is the current turn's, whoever is taking it —
      // Underworld Breach goes away at the next end step, not only at its
      // controller's, and that is a whole turn cycle of difference.
      ...(/^your$/i.test(stepHead[1]) ? {} : { eachPlayersStep: true }),
      // Sheoldred: "each OPPONENT'S upkeep" skips the controller's own turn,
      // and the step's player becomes the trigger's subject.
      ...(/^each opponent's$/i.test(stepHead[1]) ? { opponentsStepOnly: true } : {}),
    };
  }
  if (/^Whenever ~ attacks$/i.test(text)) {
    return { event: "attacks" };
  }
  // Aurelia: "for the first time each turn" maps to the once-per-turn latch.
  if (/^Whenever ~ attacks for the first time each turn$/i.test(text)) {
    return { event: "attacks", oncePerTurn: true };
  }
  // Karlach: one firing per attack declaration.
  if (/^Whenever you attack$/i.test(text)) {
    return { event: "attacks", watch: "controlled", oncePerBatch: true };
  }
  // Mangara: one firing per declaration, watching the other side. The "if
  // two or more are attacking you" half is an intervening condition read
  // separately, so the head only has to say WHOSE declaration this is.
  if (/^Whenever an opponent attacks with creatures$/i.test(text)) {
    return { event: "attacks", watch: "opponents", oncePerBatch: true };
  }
  // Dreadhorde Invasion's second line.
  const tokenTribalAttack = text.match(
    /^Whenever an? ([A-Za-z]+) token you control with power (\d+) or greater attacks$/i,
  );
  if (tokenTribalAttack?.[1] && tokenTribalAttack[2]) {
    return {
      event: "attacks",
      watch: "controlled",
      subjectFilter: {
        subtypes: [tokenTribalAttack[1].toLowerCase()],
        tokenOnly: true,
        minPower: Number(tokenTribalAttack[2]),
      },
    };
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
  // Burgeoning, City of Traitors: PLAYS a land, which is not the same event.
  // A fetched land enters and was never played, so reading these as landfall
  // would sacrifice City of Traitors to a Fabled Passage.
  const playsLand = text.match(
    /^When(?:ever)? (you|an opponent|a player) plays? (another )?(?:a )?land$/i,
  );
  if (playsLand?.[1]) {
    const who = playsLand[1].toLowerCase();
    return {
      event: "plays_land",
      watch: who === "you" ? "controlled" : who === "an opponent" ? "opponents" : "any",
      ...(playsLand[2] ? { excludeSelf: true } : {}),
    };
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
  // One cast-trigger grammar: who is watched, and what the spell has to be.
  // Every "Whenever <someone> casts a <descriptor> spell" head lands here.
  /**
   * The descriptor before "spell" is a PREFIX ("a noncreature spell"), but
   * a mana-value qualifier trails it ("a spell with mana value 5 or
   * greater"). The ENTERS head already read that suffix and this one did
   * not — a parser asymmetry, not a missing feature, and the reason Up the
   * Beanstalk's second head would not parse at all.
   */
  const castHead = text.match(
    /^Whenever (you|an opponent|a player|each player) casts? an? (.+? )?spell(?: with mana value (\d+) or (less|greater))?$/i,
  );
  const castFilter = castHead ? parseSpellDescriptor(castHead[2]?.trim() ?? "") : null;
  if (castHead?.[1] && castFilter) {
    const who = castHead[1].toLowerCase();
    const bound = castHead[3] ? Number(castHead[3]) : undefined;
    const filter = {
      ...castFilter,
      ...(bound !== undefined && /^less$/i.test(castHead[4] ?? "")
        ? { maxManaValue: bound }
        : {}),
      ...(bound !== undefined && /^greater$/i.test(castHead[4] ?? "")
        ? { minManaValue: bound }
        : {}),
    };
    return {
      event: "cast_spell",
      watch: who === "you" ? "controlled" : who === "an opponent" ? "opponents" : "any",
      ...(Object.keys(filter).length > 0 ? { subjectFilter: filter } : {}),
    };
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
  if (/^Whenever an opponent draws a card$/i.test(text)) {
    return { event: "opponent_draws" };
  }
  // Fathom Mage / Evolution Witness.
  if (
    /^Whenever (?:a|one or more) \+1\/\+1 counters? (?:is|are) put on ~$/i.test(text) ||
    // Exemplar of Light prints the same event in the active voice.
    /^Whenever you put (?:a|one or more) \+1\/\+1 counters? on ~$/i.test(text)
  ) {
    return { event: "counter_added", subjectFilter: { counterName: "p1p1" } };
  }
  // Terrasymbiosis: the same event, watched across the board rather than on
  // the source. `watch` has to be explicit — "self" stays the default for
  // this event so Fathom Mage keeps watching only itself.
  const countersOnTeam = text.match(
    /^Whenever you put (?:a|one or more) \+1\/\+1 counters? on an? (creature|permanent|artifact) you control$/i,
  );
  if (countersOnTeam?.[1]) {
    const noun = countersOnTeam[1].toLowerCase();
    return {
      event: "counter_added",
      watch: "controlled",
      oncePerBatch: true,
      subjectFilter: {
        counterName: "p1p1",
        ...(noun === "permanent" ? {} : { types: [noun] }),
      },
    };
  }
  if (/^Whenever another colorless creature you control enters$/i.test(text)) {
    return {
      event: "enter_battlefield",
      watch: "controlled",
      excludeSelf: true,
      subjectFilter: { types: ["creature"], colorless: true },
    };
  }
  // Waste Not / Bone Miser.
  const discardWatch = text.match(
    /^Whenever (an opponent|you) discards? a(?: (creature|land|noncreature, nonland))? card$/i,
  );
  if (discardWatch?.[1]) {
    const what = discardWatch[2]?.toLowerCase();
    return {
      event: "discards",
      watch: discardWatch[1].toLowerCase() === "you" ? "controlled" : "opponents",
      // Necropotence's "a card" carries no type filter at all.
      ...(what === undefined
        ? {}
        : {
            subjectFilter:
              what === "noncreature, nonland"
                ? { nonTypes: ["creature", "land"] }
                : { types: [what] },
          }),
    };
  }
  // Pollywog Prodigy: the cap reads the watcher's power live.
  if (
    /^Whenever an opponent casts a noncreature spell with mana value less than ~'s power$/i.test(
      text,
    )
  ) {
    return {
      event: "cast_spell",
      watch: "opponents",
      subjectFilter: { nonTypes: ["creature"], manaValueBelowWatcherPower: true },
    };
  }
  if (/^Whenever an opponent casts a noncreature spell$/i.test(text)) {
    return { event: "cast_spell", watch: "opponents", subjectFilter: { nonTypes: ["creature"] } };
  }
  if (/^Whenever a player casts a spell$/i.test(text)) {
    return { event: "cast_spell", watch: "any" };
  }
  if (new RegExp(`^Whenever ~ ${COMBAT_DAMAGE_TO_PLAYER}$`, "i").test(text)) {
    // The alternation includes "an opponent", which is the same EVENT but
    // narrows who the subject player may be. The generic head path sets
    // this flag too; losing it here would let the trigger fire off damage
    // dealt to the controller.
    return {
      event: "deals_combat_damage_to_player",
      ...(/an opponent$/i.test(text) ? { subjectPlayerOpponent: true } : {}),
    };
  }
  if (
    new RegExp(`^Whenever a creature you control ${COMBAT_DAMAGE_TO_PLAYER}$`, "i").test(text)
  ) {
    return {
      event: "deals_combat_damage_to_player",
      watch: "controlled",
      subjectFilter: { types: ["creature"] },
      ...(/an opponent$/i.test(text) ? { subjectPlayerOpponent: true } : {}),
    };
  }
  // The shared subject parser understands "of the chosen type" now, but
  // this head is still reached first for the two-event spelling and is what
  // supplies `extraEvents` — removing it makes the sentence stop compiling
  // outright, so it is not the dead special case it looks like. The wave 233
  // test pins both events firing so the two paths cannot drift.
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

  // The general enters/dies head, tried after every specific one above.
  const generic = parseGenericSubjectHead(text);
  if (generic) {
    return generic;
  }
  return null;
}

/**
 * "Whenever ~ or another Zombie you control dies", "Whenever another artifact
 * you control enters", "Whenever an enchantment you control is put into a
 * graveyard from the battlefield" — one grammar over the noun phrases that
 * previously each needed their own regex.
 *
 * Runs only after every specific head above has declined, so it cannot change
 * how an already-recognised sentence compiles.
 */
/**
 * What a subject can be seen doing in "Whenever \<subject\> \<verb\>". Longest
 * first, so "deals combat damage to a player" wins over "deals damage …".
 * A permanent going battlefield → graveyard *is* the dies event whatever its
 * card type; the long phrasing is just older templating.
 */
/**
 * The head verb for "deals combat damage to a player", and the spellings
 * that mean the same thing here.
 *
 * "…or planeswalker" is one of them because combat damage cannot be
 * redirected to a planeswalker in this engine, so the planeswalker half has
 * nothing to fire on — a documented narrowing, and stated once. It lives in
 * a constant because four self-subject heads used to spell the phrase out
 * again and accepted only the bare player form, which is exactly how one
 * card ends up compiling and its neighbour not.
 */
const COMBAT_DAMAGE_TO_PLAYER =
  "deals? combat damage to (?:a player|an opponent|a player or planeswalker)";

const SUBJECT_HEAD_VERBS: [string, TriggerEvent][] = [
  ["enters tapped|enter tapped", "enter_battlefield"],
  ["enters|enter", "enter_battlefield"],
  ["dies|die|is put into a graveyard from the battlefield", "dies"],
  ["attacks|attack", "attacks"],
  ["becomes tapped|become tapped", "becomes_tapped"],
  ["becomes untapped|become untapped", "becomes_untapped"],
  [COMBAT_DAMAGE_TO_PLAYER, "deals_combat_damage_to_player"],
  ["deals? damage to (?:a player|an opponent|you)", "deals_damage_to_player"],
  ["leaves the battlefield|leave the battlefield", "leaves_battlefield"],
];

/**
 * The subject noun phrase of a trigger head — "another nontoken creature you
 * control", "a Dwarf an opponent controls", "equipped creature". Shared by
 * every head shape so a new qualifier is added once rather than per event.
 */
function parseTriggerSubjectPhrase(
  phrase: string,
  batched: boolean,
): { watch: CardTrigger["watch"]; filter: NonNullable<CardTrigger["subjectFilter"]> } | null {
  let rest = phrase.trim();
  const filter: NonNullable<CardTrigger["subjectFilter"]> = {};
  let watch: CardTrigger["watch"] = "any";
  // Trailing qualifiers, outermost first: "a creature you control with flying"
  // puts the keyword outside the possessor, so it comes off before it.
  const keywordQualifier = rest.match(/^(.*?)\s+(with|without)\s+([a-z]+)$/i);
  if (keywordQualifier?.[1] && keywordQualifier[2] && keywordQualifier[3]) {
    const keyword = KEYWORD_GRANTS[keywordQualifier[3].toLowerCase()];
    if (!keyword) {
      return null;
    }
    if (/^with$/i.test(keywordQualifier[2])) {
      filter.withKeyword = keyword;
    } else {
      filter.withoutKeyword = keyword;
    }
    rest = keywordQualifier[1];
  }
  // "of the chosen type" (Bloodline Pretender). The static selector parser
  // has understood this for a long time; the trigger side had one
  // hardcoded head for one exact sentence, so every other spelling missed.
  const chosenType = rest.match(/^(.*?)\s+of the chosen type$/i);
  if (chosenType?.[1] !== undefined) {
    filter.chosenSubtype = true;
    rest = chosenType[1];
  }
  // "with mana value 3 or greater" (Sai) rides in the same trailing slot.
  const manaValue = rest.match(/^(.*?)\s+with mana value (\d+) or (less|greater)$/i);
  if (manaValue?.[1] && manaValue[2] && manaValue[3]) {
    if (/^less$/i.test(manaValue[3])) {
      filter.maxManaValue = Number(manaValue[2]);
    } else {
      filter.minManaValue = Number(manaValue[2]);
    }
    rest = manaValue[1];
  }
  const possessor = rest.match(/^(.*?)\s+you control$/i);
  if (possessor?.[1] !== undefined) {
    watch = "controlled";
    rest = possessor[1];
  } else {
    const theirs = rest.match(/^(.*?)\s+(?:an opponent controls|your opponents control)$/i);
    if (theirs?.[1] !== undefined) {
      watch = "opponents";
      rest = theirs[1];
    }
  }
  // The attached subjects name no possessor of their own — the Equipment or
  // Aura's own host is the subject.
  const attached = rest.match(/^(?:equipped|enchanted)\s+(.*)$/i);
  if (attached?.[1]) {
    watch = "attached";
    rest = attached[1];
  }
  // Leading adjectives, read one at a time. Each requires a word after it —
  // in "a token you control", "token" is the head noun, not an adjective, and
  // eating it would leave nothing for the head to match.
  for (;;) {
    if (/^nontoken\s+\S/i.test(rest)) {
      filter.nonToken = true;
      rest = rest.replace(/^nontoken\s+/i, "");
      continue;
    }
    if (/^token\s+\S/i.test(rest)) {
      filter.tokenOnly = true;
      rest = rest.replace(/^token\s+/i, "");
      continue;
    }
    if (/^legendary\s+\S/i.test(rest)) {
      filter.legendary = true;
      rest = rest.replace(/^legendary\s+/i, "");
      continue;
    }
    if (/^modified\s+\S/i.test(rest)) {
      filter.modified = true;
      rest = rest.replace(/^modified\s+/i, "");
      continue;
    }
    if (/^attacking\s+\S/i.test(rest)) {
      filter.attacking = true;
      rest = rest.replace(/^attacking\s+/i, "");
      continue;
    }
    break;
  }
  // A bare "token" / "permanent" head names no card type at all.
  if (/^tokens?$/i.test(rest.trim())) {
    filter.tokenOnly = true;
    rest = "permanent";
  }
  // A batched head is plural ("one or more artifacts"); the rest of the
  // grammar reads singular nouns.
  const head = (batched ? rest.trim().replace(/s$/i, "") : rest.trim());
  // "creature or planeswalker" / "artifact or creature": any listed type.
  const eitherType = head.match(/^([a-z]+) or ([a-z]+)$/i);
  if (/^permanents?$/i.test(head)) {
    // No type restriction.
  } else if (/^commander$/i.test(head)) {
    // "a commander you control" (Kediss). A commander is always a
    // permanent on the battlefield here, and the flag does the narrowing,
    // so no card type is asserted alongside it.
    filter.commanderOnly = true;
  } else if (SEARCH_CARD_TYPES.has(head.toLowerCase())) {
    filter.types = [head.toLowerCase()];
  } else if (
    eitherType?.[1] &&
    eitherType[2] &&
    SEARCH_CARD_TYPES.has(eitherType[1].toLowerCase()) &&
    SEARCH_CARD_TYPES.has(eitherType[2].toLowerCase())
  ) {
    filter.typesAny = [eitherType[1].toLowerCase(), eitherType[2].toLowerCase()];
  } else if (/^[A-Z][a-z-]+$/.test(head)) {
    // A creature subtype ("Zombie", "Elf") — changelings match.
    filter.subtypes = [head.toLowerCase()];
  } else {
    return null;
  }
  return { watch, filter };
}

function parseGenericSubjectHead(text: string): TriggerHead | null {
  const match = text.match(
    new RegExp(
      "^Whenever (~ or another |another |one or more |an? |)(.+?) " +
        `(${SUBJECT_HEAD_VERBS.map(([pattern]) => pattern).join("|")})$`,
      "i",
    ),
  );
  if (match?.[1] === undefined || !match[2] || !match[3]) {
    return null;
  }
  const lead = match[1].toLowerCase();
  const verb = match[3].toLowerCase();
  // "Whenever one or more … enter" fires once for the whole simultaneous
  // batch, not once per permanent.
  const batched = lead.startsWith("one or more");
  const event = SUBJECT_HEAD_VERBS.find(([pattern]) =>
    new RegExp(`^(?:${pattern})$`, "i").test(verb),
  )?.[1];
  if (!event) {
    return null;
  }

  const subject = parseTriggerSubjectPhrase(match[2], batched);
  if (!subject) {
    return null;
  }
  const { watch, filter } = subject;
  return {
    event,
    watch,
    // "another …" excludes the source; "~ or another …" deliberately does not.
    ...(lead.startsWith("another") ? { excludeSelf: true } : {}),
    ...(batched ? { oncePerBatch: true } : {}),
    // "deals combat damage to an opponent": the damaged player must not be
    // the watcher's own controller.
    ...(/to an opponent$/i.test(verb) ? { subjectPlayerOpponent: true } : {}),
    // "deals damage to YOU" is the mirror: it must BE the controller.
    ...(/to you$/i.test(verb) ? { subjectPlayerSelf: true } : {}),
    ...(Object.keys(filter).length > 0
      ? {
          subjectFilter: {
            ...filter,
            // "enters tapped" narrows the subject rather than the event.
            ...(/tapped$/i.test(verb) ? { enteredTapped: true } : {}),
          },
        }
      : /tapped$/i.test(verb)
        ? { subjectFilter: { enteredTapped: true } }
        : {}),
  };
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

/**
 * "~ gets +5/+5 and has flying" as a static on the source itself. Kept apart
 * from `parseGrantSubject`, which deliberately refuses "~": an unconditional
 * self grant is Storm-Kiln Artist's `bonusPt` territory, and only the
 * conditional form ("As long as …") belongs here.
 */
function compileSelfGrant(body: string): StaticAbility[] | null {
  const split = body.match(/^~\s+((?:get|gets|have|has)\s+.+)$/i);
  if (!split?.[1]) {
    return null;
  }
  const effects = parseGrantPredicate(split[1]);
  return effects
    ? effects.map((effect) => ({ selector: { scope: "self" as const }, effect }))
    : null;
}

/**
 * The subject half of a static grant line: "Other Elf creatures you control",
 * "Creature tokens you control", "Creatures your opponents control". Returns
 * null when the phrase is not a recognised subject, so the caller falls
 * through to the leftover pile rather than mis-compiling a card.
 */
/**
 * "protection from <what>", with `from` repeated across an "and" list
 * ("protection from black and from red"). One reader for the printed line,
 * the keyword list, and the grant predicate — three places that each used
 * to carry their own colour-only regex, which is why nothing but a colour
 * could be printed there.
 *
 * Refuses any conjunct it cannot read: half a protection is not protection.
 */
function parseProtectionPhrase(phrase: string): ProtectionFrom | null {
  const body = phrase.trim().replace(/^protection from\s+/i, "");
  if (body === phrase.trim()) {
    return null;
  }
  let from: ProtectionFrom = {};
  const parts = body
    .split(/\s*,\s*(?:and\s+)?from\s+|\s+and\s+from\s+|\s*,\s*from\s+/i)
    .map((part) => part.trim())
    .filter(Boolean);
  for (const part of parts) {
    const one = parseOneProtectionQuality(part);
    if (!one) {
      return null;
    }
    from = mergeProtection(from, one);
  }
  return Object.keys(from).length > 0 ? from : null;
}

function parseOneProtectionQuality(word: string): ProtectionFrom | null {
  // Commander's Plate. Resolved in the layer engine against the granting
  // permanent's controller, not baked to colours here — the identity can
  // change mid-game when a commander does.
  if (
    /^each color that['\u2019]s not in your commander['\u2019]s color identity$/i.test(
      word.trim(),
    )
  ) {
    return { colorsOutsideCommanderIdentity: true };
  }
  const text = word.trim().replace(/\.$/, "").trim();
  if (/^everything$/i.test(text)) {
    return { everything: true };
  }
  if (/^multicolored$/i.test(text)) {
    return { multicolored: true };
  }
  if (/^colorless$/i.test(text)) {
    return { colorless: true };
  }
  if (/^each color$/i.test(text)) {
    return { colors: ["W", "U", "B", "R", "G"] };
  }
  const color = COLOR_WORDS[text.toLowerCase()];
  if (color) {
    return { colors: [color] };
  }
  // "protection from creatures" / "from instants" — a card type, plural.
  const typeWord = text.toLowerCase().replace(/s$/, "");
  if (SEARCH_CARD_TYPES.has(typeWord)) {
    return { types: [typeWord] };
  }
  // "protection from Humans" — a subtype, capitalised the way oracle text
  // capitalises subtypes and lowercases card types.
  if (/^[A-Z][a-z-]+s$/.test(text)) {
    return { subtypes: [singularSubtype(text)] };
  }
  return null;
}

function parseGrantSubject(phrase: string): EffectSelector | null {
  let rest = phrase.trim();
  const selector: EffectSelector = { scope: "all" };

  if (/^(?:Enchanted|Equipped) (?:creature|permanent|land|artifact)$/i.test(rest)) {
    return { scope: "attached" };
  }

  // "~ gets …" is deliberately NOT a subject here: self-scaling pumps have
  // their own `bonusPt` machinery further down the sentence chain, and this
  // grammar runs first, so claiming "~" would shadow it (Storm-Kiln Artist).

  // Leading "Other " / "All " / "Each " qualifiers. "Each" is singular, so
  // the head noun and any counter phrase below are singular too.
  if (/^Other /i.test(rest)) {
    selector.excludeSelf = true;
    rest = rest.slice("Other ".length);
  } else if (/^All /i.test(rest)) {
    rest = rest.slice("All ".length);
  } else if (/^Each [A-Za-z]+\b/i.test(rest)) {
    // Pluralise the HEAD noun so the rest of the grammar sees its usual
    // "Creatures you control …" shape. The head noun is the last word of
    // the noun phrase, not the first: "Each nonland permanent you control"
    // has to become "nonland permanents you control" and not "nonlands
    // permanent you control", which is what pluralising the first word did
    // and which then matched nothing at all.
    rest = rest.replace(
      /^Each ((?:[A-Za-z]+ )*?)([A-Za-z]+)(?= you control| your opponents control|$)/i,
      (_, adjectives: string, noun: string) => `${adjectives}${noun}s`,
    );
  }

  // Trailing qualifiers, stripped outermost-first: they follow the possessor
  // ("Creatures you control of the chosen type"), so they must come off
  // before it or the possessor match — which is anchored at the end — fails.
  const chosen = rest.match(/^(.*?)\s+of the chosen type$/i);
  if (chosen?.[1] !== undefined) {
    selector.chosenSubtype = true;
    rest = chosen[1];
  }
  // "with +1/+1 counters on them" names a kind; Innkeeper's Talent's "with
  // counters on them" means any kind at all, which is a different filter and
  // not a wider reading of the same one.
  const counters = rest.match(/^(.*?)\s+with (?:a )?(\+1\/\+1 )?counters? on (?:them|it)$/i);
  if (counters?.[1] !== undefined) {
    if (counters[2]) {
      selector.withCounter = "p1p1";
    } else {
      selector.withAnyCounter = true;
    }
    rest = counters[1];
  }
  // "with power or toughness 1 or less" is tried before the bare power
  // form so the longer phrase cannot be half-eaten.
  const eitherPt = rest.match(
    /^(.*?)\s+with power or toughness ([\w-]+) or less$/i,
  );
  if (eitherPt?.[1] !== undefined && eitherPt[2]) {
    const amount = parseCount(eitherPt[2]);
    if (amount !== null) {
      selector.maxPowerOrToughness = amount;
      rest = eitherPt[1];
    }
  }
  const maxPower = rest.match(/^(.*?)\s+with power ([\w-]+) or less$/i);
  if (maxPower?.[1] !== undefined && maxPower[2]) {
    const amount = parseCount(maxPower[2]);
    if (amount !== null) {
      selector.maxPower = amount;
      rest = maxPower[1];
    }
  }

  // Trailing possessor. Without one the line is unrestricted ("All Slivers").
  const possessor = rest.match(/^(.*?)\s+you control$/i);
  const opponents = rest.match(/^(.*?)\s+your opponents control$/i);
  if (possessor?.[1] !== undefined) {
    selector.scope = "controlled";
    rest = possessor[1];
  } else if (opponents?.[1] !== undefined) {
    selector.scope = "opponents";
    rest = opponents[1];
  }

  // Leading adjectives, in any order.
  for (;;) {
    const before = rest;
    const colorWord = rest.match(/^(White|Blue|Black|Red|Green)\s+(.*)$/i);
    if (colorWord?.[1] && colorWord[2]) {
      selector.colors = [...(selector.colors ?? []), COLOR_WORDS[colorWord[1].toLowerCase()]!];
      rest = colorWord[2];
    }
    // Leyline of the Guildpact: a type EXCLUSION rather than a flag, so it
    // is peeled here and pushed onto nonTypes.
    const nonland = rest.match(/^Nonland\s+(.*)$/i);
    if (nonland?.[1]) {
      selector.nonTypes = [...(selector.nonTypes ?? []), "land"];
      rest = nonland[1];
    }
    const flags: Array<[RegExp, "legendary" | "nonLegendary" | "nonToken" | "commanderOnly"]> = [
      [/^Legendary\s+(.*)$/i, "legendary"],
      [/^Nonlegendary\s+(.*)$/i, "nonLegendary"],
      [/^Nontoken\s+(.*)$/i, "nonToken"],
      [/^Commander\s+(.*)$/i, "commanderOnly"],
    ];
    for (const [pattern, flag] of flags) {
      const hit = rest.match(pattern);
      if (hit?.[1]) {
        selector[flag] = true;
        rest = hit[1];
      }
    }
    if (rest === before) {
      break;
    }
  }

  // "Creature tokens" — the noun is "tokens", qualified by a card type.
  const tokenNoun = rest.match(/^([A-Za-z]+)\s+tokens$/i);
  if (tokenNoun?.[1]) {
    selector.tokenOnly = true;
    rest = `${tokenNoun[1]}s`;
  } else if (/^tokens$/i.test(rest)) {
    selector.tokenOnly = true;
    rest = "permanents";
  }

  // The head noun: a card type, a creature subtype, or bare "permanents".
  const head = rest.trim();
  if (!/^permanents$/i.test(head)) {
    const typeWord = head.toLowerCase().replace(/s$/, "");
    if (SEARCH_CARD_TYPES.has(typeWord)) {
      selector.types = [typeWord];
    } else {
      // "Elf creatures" / "Elves" — a tribal subject (changelings match).
      const tribalWithType = head.match(/^([A-Z][a-z-]+)\s+([a-z]+)s$/);
      if (tribalWithType?.[1] && tribalWithType[2] && SEARCH_CARD_TYPES.has(tribalWithType[2])) {
        selector.subtypes = [singularSubtype(`${tribalWithType[1]}s`)];
        selector.types = [tribalWithType[2]];
      } else if (/^[A-Z][a-z-]+s$/.test(head)) {
        selector.subtypes = [singularSubtype(head)];
      } else {
        return null;
      }
    }
  }
  return selector;
}

/**
 * The body of a quoted grant: `<subject> has "<ability>"`.
 *
 * One entry point for all four body shapes, because the printed text gives
 * no other signal than the ability's own grammar: a trigger head, a mana
 * ability, an activated ability, or a bare keyword. Each is compiled by the
 * same parser the printed form uses, so a body the card could have printed
 * on itself is a body it can be given.
 *
 * Refuses anything it cannot read whole — a half-understood grant would hand
 * a permanent an ability that does less than the card says.
 */
function compileQuotedAbility(quoted: string): ContinuousEffectData[] | null {
  const body = quoted.trim().replace(/\.$/, "").trim();
  if (body === "") {
    return null;
  }

  // A trigger head: the body is "Whenever …, …" / "When …, …" / "At …, …".
  if (/^(?:When|Whenever|At)\b/i.test(body)) {
    const trigger = compileQuotedTrigger(body);
    return trigger ? [{ kind: "grant_trigger", trigger }] : null;
  }

  const split = splitAbility(body);
  if (split) {
    const cost = parseAbilityCost(split.costText);
    if (!cost) {
      return null;
    }
    // A granted ability that only produces mana is a MANA ability and must
    // never use the stack — it belongs in the older `grant_mana_ability`,
    // which the Cryptolith Rite path already reads.
    const add = parseAddMana(split.rest);
    if (
      add &&
      cost.tap &&
      cost.manaCost === "" &&
      !cost.lifeCost &&
      !cost.lifeCostFromCommanderColors
    ) {
      // Goldspan Dragon grants Treasures a BETTER mana ability, and a
      // Treasure's ability sacrifices it. `sacrificeSelf` is a shape the
      // mana ability already carries, so refusing it here was the only
      // thing stopping the grant.
      return [
        {
          kind: "grant_mana_ability",
          ability: {
            ...manaAbilityFromAdd(add),
            ...(cost.sacrificeSelf ? { sacrificeSelf: true } : {}),
          },
        },
      ];
    }
    if (add) {
      // A mana ability with a cost this shape cannot carry: refuse rather
      // than grant a free one.
      return null;
    }
    const clause = compileSimpleClause(split.rest);
    if (!clause || clause.leftover || clause.targetRequirements.length > 0) {
      // A granted TARGETED ability would need its targets chosen against the
      // granted permanent, which the grant carries no way to express yet.
      return null;
    }
    return [
      {
        kind: "grant_activated",
        ability: {
          tap: cost.tap,
          manaCost: cost.manaCost,
          effects: clause.effects,
          targetRequirements: [],
          ...(cost.sacrificeSelf ? { sacrificeSelf: true } : {}),
          ...(cost.lifeCost !== undefined ? { lifeCost: cost.lifeCost } : {}),
          ...(cost.lifeCostFromCommanderColors
            ? { lifeCostFromCommanderColors: true }
            : {}),
        },
      },
    ];
  }

  // A bare keyword in quotes ("…have \"flying\""). Ward is spelled with an
  // amount, in mana or in life.
  const ward = body.match(/^Ward\s*\{(\d+)\}$/i);
  if (ward?.[1]) {
    return [{ kind: "grant_ward", amount: Number(ward[1]) }];
  }
  // Hexing Squelcher grants the same ability it has.
  const wardLife = body.match(/^Ward\s*[—-]\s*Pay (\d+) life$/i);
  if (wardLife?.[1]) {
    return [{ kind: "grant_ward_life", amount: Number(wardLife[1]) }];
  }
  const keyword = KEYWORD_GRANTS[body.toLowerCase()];
  if (keyword) {
    return [{ kind: "grant_keyword", keyword }];
  }
  return null;
}

/**
 * A self-contained "Whenever …, …" sentence compiled into a CardTrigger.
 *
 * The printed-trigger branch in the main sentence loop cannot be reused: it
 * looks ahead into the following sentences (Scute Swarm's copy upgrade, Mask
 * of Memory's loot fuse) and pushes straight onto the result. A quoted body
 * has no neighbours, so it needs the head-plus-body core alone.
 */
function compileQuotedTrigger(sentence: string): CardTrigger | null {
  const parts = sentence.match(/^((?:Landfall\s*[—-]\s*)?[^,]+?), (.+)$/i);
  if (!parts?.[1] || !parts[2]) {
    return null;
  }
  const head = parseTriggerHead(parts[1]) ?? parseSimpleTriggerHead(parts[1]);
  if (!head) {
    return null;
  }
  const { extraEvents, ...headRest } = head;
  // A head that fires on several events is two abilities, not one; granting
  // half of it would be worse than a clean miss.
  if (extraEvents && extraEvents.length > 0) {
    return null;
  }
  // The engine cannot fire a GRANTED dies-trigger: the grant is read from the
  // live board, where the dead creature no longer is (see RULES_COVERAGE.md).
  // Compiling it would put an ability on the card that never runs, and the
  // compile-rate metric cannot see that by construction.
  if (headRest.event === "dies" || headRest.event === "leaves_battlefield") {
    return null;
  }

  // Intervening "if" (CR 603.4), read by the same shared vocabulary as
  // printed triggers and activation gates.
  let rest = parts[2].trim();
  let condition: TriggerCondition | undefined;
  const interveningIf = rest.match(/^if (.+?), (?:then )?(.+)$/i);
  if (interveningIf?.[1] && interveningIf[2]) {
    const parsed = parseEffectCondition(interveningIf[1].trim());
    if (!parsed) {
      return null;
    }
    condition = parsed;
    rest = interveningIf[2].trim();
  }
  const inner = compileSimpleClause(rest);
  if (!inner || inner.leftover || inner.targetRequirements.length > 0) {
    return null;
  }
  return {
    ...headRest,
    ...(condition ? { condition } : {}),
    effects: inner.effects,
    targetRequirements: [],
  };
}

/**
 * The predicate half: "get +1/+1 and have vigilance", "have double strike and
 * lifelink", "have flying, first strike, and protection from black and from
 * red". Returns null if any conjunct is unrecognised — a half-understood
 * grant would silently drop the rest of the card's text.
 */
/**
 * "an Assassin", "Forest lands", "a Phyrexian" — the words after "is/are"
 * in an "in addition to its other types" grant. A word that is a card TYPE
 * lands in `types` and anything else in `subtypes`, which is the same
 * division `parseSearchDescriptor` makes; the plural is stripped first so
 * "lands" and "land" read alike.
 *
 * A subtype is a PROPER NOUN in oracle text, so a lowercase word that is
 * not a card type is not a subtype at all — it is a quantifier, and the
 * phrase is a quantified one rather than a type list. "Lands you control
 * are every basic land type in addition to their other types" reads that
 * way, and has its own rule; without this check it parsed here first and
 * granted the subtypes "every", "basic", and "type".
 */
function parseAddedTypeWords(
  phrase: string,
): { types: string[]; subtypes: string[] } | null {
  const types: string[] = [];
  const subtypes: string[] = [];
  for (const raw of phrase.trim().split(/\s+/)) {
    const word = raw.toLowerCase().replace(/s$/, "");
    if (!/^[a-z-]+$/.test(word)) {
      return null;
    }
    if (SEARCH_CARD_TYPES.has(word)) {
      types.push(word);
      continue;
    }
    if (!/^[A-Z]/.test(raw)) {
      return null;
    }
    subtypes.push(word);
  }
  if (types.length === 0 && subtypes.length === 0) {
    return null;
  }
  return { types, subtypes };
}

/**
 * A predicate may be a COMMA list rather than an "and" list: Brotherhood
 * Regalia says "has ward {2}, is an Assassin …, and can't be blocked".
 *
 * The comma-aware split is a SECOND attempt, tried only after the plain
 * one has failed, rather than a widening of it. Widening the split in
 * place would change how every predicate already compiling is torn apart,
 * and a comma inside a part is exactly the kind of thing that reads fine
 * in the cases you thought of and wrongly in one you did not.
 */
function parseGrantPredicate(phrase: string): ContinuousEffectData[] | null {
  // A quoted ability is handled whole, BEFORE the verb split below: a body
  // like "gets +1/+1 and has flying" inside the quotes would otherwise be
  // torn in half by a split meant for the outer sentence.
  const quoted = phrase.match(/^(?:have|has)\s+"(.+)"\.?$/i);
  if (quoted?.[1]) {
    return compileQuotedAbility(quoted[1]);
  }
  const VERB = "(?:get|gets|have|has|lose|loses|is|are|can't)";
  return (
    readGrantParts(phrase.split(new RegExp(`\\s+and\\s+(?=${VERB}\\s)`, "i"))) ??
    readGrantParts(
      phrase.split(new RegExp(`\\s*,\\s*(?:and\\s+)?(?=${VERB}\\s)|\\s+and\\s+(?=${VERB}\\s)`, "i")),
    )
  );
}

function readGrantParts(split: string[]): ContinuousEffectData[] | null {
  const effects: ContinuousEffectData[] = [];
  const parts = split
    .map((part) => part.trim())
    .filter(Boolean);
  for (const part of parts) {
    // Leyline of the Guildpact: "is all colors" is a layer-5 colour SET,
    // not an addition — the permanent becomes every colour rather than
    // gaining one.
    if (/^(?:is|are)\s+all colors$/i.test(part)) {
      effects.push({ kind: "set_colors", colors: ["W", "U", "B", "R", "G"] });
      continue;
    }
    // "is an Assassin in addition to its other types" (Brotherhood
    // Regalia), "are Forest lands in addition to their other types"
    // (Ashaya). Layer 4, and an ADDITION — the printed types survive,
    // which is what the phrase says and why this is not a set.
    const addedTypes = part.match(
      /^(?:is|are)\s+(?:an?\s+)?(.+?)\s+in addition to (?:its|their) other types$/i,
    );
    if (addedTypes?.[1]) {
      const parsed = parseAddedTypeWords(addedTypes[1]);
      if (!parsed) {
        return null;
      }
      effects.push({ kind: "add_types", ...parsed });
      continue;
    }
    const pt = part.match(/^(?:get|gets)\s+([+-]\d+)\/([+-]\d+)$/i);
    if (pt?.[1] && pt[2]) {
      effects.push({ kind: "modify_pt", power: Number(pt[1]), toughness: Number(pt[2]) });
      continue;
    }
    // "gets +1/+1 for each enchantment you control" (Ethereal Armor). The
    // counted noun comes from the shared table, not a private four-row one —
    // "for each Aura and Equipment attached to it" is the same clause.
    const scaled = part.match(/^(?:get|gets)\s+\+(\d+)\/\+(\d+) for each (.+)$/i);
    if (scaled?.[1] && scaled[2] && scaled[3]) {
      const per = parseDynamicCount(scaled[3]);
      if (!per) {
        return null;
      }
      effects.push({
        kind: "modify_pt",
        power: Number(scaled[1]),
        toughness: Number(scaled[2]),
        per,
      });
      continue;
    }
    // "loses flying" (Colossus Hammer).
    const losses = part.match(/^loses?\s+(.+)$/i);
    if (losses?.[1]) {
      const lost = losses[1]
        .split(/,\s*(?:and\s+)?|\s+and\s+/i)
        .map((word) => KEYWORD_GRANTS[word.trim().toLowerCase()]);
      if (!lost.every((keyword): keyword is Keyword => Boolean(keyword))) {
        return null;
      }
      effects.push({ kind: "remove_keywords", keywords: lost });
      continue;
    }
    // Archetype of Imagination: not merely losing the keyword. A lock that
    // a later grant cannot beat, where `remove_keywords` would be re-added
    // on timestamp (CR 613.7) — right for Shadowspear, wrong here.
    const locked = part.match(/^can't have or gain\s+(.+)$/i);
    if (locked?.[1]) {
      const keywords = locked[1]
        .split(/,\s*(?:or\s+)?|\s+or\s+/i)
        .map((word) => KEYWORD_GRANTS[word.trim().toLowerCase()]);
      if (!keywords.every((keyword): keyword is Keyword => Boolean(keyword))) {
        return null;
      }
      effects.push({ kind: "lock_keywords", keywords });
      continue;
    }
    const restriction = part.match(/^can't\s+(be blocked|attack|block)$/i);
    if (restriction?.[1]) {
      const what = restriction[1].toLowerCase();
      effects.push({
        kind: "restrict",
        ...(what === "be blocked" ? { cantBeBlocked: true } : {}),
        ...(what === "attack" ? { cantAttack: true } : {}),
        ...(what === "block" ? { cantBlock: true } : {}),
      });
      continue;
    }
    // Shiny Impetus: "and is goaded" — a static, so it lasts as long as the
    // Aura does rather than until anyone's next turn.
    if (/^is goaded$/i.test(part)) {
      effects.push({ kind: "goaded" });
      continue;
    }
    const grants = part.match(/^(?:have|has)\s+(.+)$/i);
    if (!grants?.[1]) {
      return null;
    }
    // "flying, first strike, vigilance, and protection from black and from red"
    // Case is PRESERVED through the split: oracle text capitalises subtypes
    // and lowercases card types, so "protection from Humans" and "protection
    // from creatures" are told apart by nothing else.
    const printedWords = grants[1]
      .split(/,\s*(?:and\s+)?|\s+and\s+(?!from\b)/i)
      .map((entry) => entry.trim())
      .filter(Boolean);
    for (const printedWord of printedWords) {
      const word = printedWord.toLowerCase();
      if (/^protection from /i.test(printedWord)) {
        const from = parseProtectionPhrase(printedWord);
        if (!from) {
          return null;
        }
        effects.push({ kind: "grant_protection", from });
        continue;
      }
      // "ward {2}" is a numeric ability, not a plain keyword.
      const ward = word.match(/^ward \{(\d+)\}$/i);
      if (ward?.[1]) {
        effects.push({ kind: "grant_ward", amount: Number(ward[1]) });
        continue;
      }
      const wardLife = word.match(/^ward\s*[—-]\s*pay (\d+) life$/i);
      if (wardLife?.[1]) {
        effects.push({ kind: "grant_ward_life", amount: Number(wardLife[1]) });
        continue;
      }
      const keyword = KEYWORD_GRANTS[word];
      if (!keyword) {
        return null;
      }
      effects.push({ kind: "grant_keyword", keyword });
    }
  }
  return effects.length > 0 ? effects : null;
}

/**
 * A static grant line: one subject, one or more granted effects. "Creature
 * tokens you control get +1/+1 and have vigilance" compiles to two abilities
 * sharing a selector, rather than falling off the single shape the anthem
 * matcher above recognises. That matcher runs first and still owns the plain
 * cases; this is the general fallback.
 */
function compileStaticGrant(sentence: string): StaticAbility[] | null {
  // Bloodghast prints the same conditional the other way round — the grant
  // first, the condition trailing — so it is rewritten into the one form
  // below rather than given a parser of its own. Sentences that already
  // lead with the condition keep their own comma split.
  const trailing = /^As long as /i.test(sentence)
    ? null
    : sentence.match(/^(.+?) as long as (.+)$/i);
  const normalized = trailing?.[1] && trailing[2]
    ? `As long as ${trailing[2]}, ${trailing[1]}`
    : sentence;
  // "As long as <condition>, <grant>": peel the condition, compile the grant,
  // and hang the condition on every ability it produced.
  const conditional = normalized.match(/^As long as (.+?), (.+)$/i);
  if (conditional?.[1] && conditional[2]) {
    const phrase = conditional[1].trim();
    let body = conditional[2].trim();
    // "…, it has hexproof": the subject is the one the condition named.
    const subject = phrase.match(/^(equipped creature|enchanted creature|~)\s+is (.+)$/i);
    if (subject?.[1] && subject[2] && /^it\s/i.test(body)) {
      const trait = subject[2].trim().toLowerCase();
      if (trait !== "legendary") {
        return null;
      }
      // Champion's Helm: a condition on the affected object is just a
      // narrower selector, so no new gate is needed.
      const grants = compileStaticGrant(
        `${subject[1]} ${body.replace(/^it\s+/i, "")}`,
      );
      return grants
        ? grants.map((ability) => ({
            ...ability,
            selector: { ...ability.selector, legendary: true },
          }))
        : null;
    }
    // The World Tree: "As long as you control six or more lands, lands you
    // control have …" — a COUNT gate on the controller's board, which is
    // exactly what `ControlledGate.atLeast` was added for. The gate hangs on
    // every ability the inner grant produced.
    const countGate = phrase.match(/^you control (\w+) or more ([A-Za-z]+)s$/i);
    if (countGate?.[1] && countGate[2]) {
      const atLeast = parseCount(countGate[1]);
      const noun = countGate[2].toLowerCase();
      if (!atLeast || !SEARCH_CARD_TYPES.has(noun)) {
        return null;
      }
      const gated = compileStaticGrant(body);
      return gated
        ? gated.map((ability) => ({
            ...ability,
            requiresControlled: { types: [noun], atLeast },
          }))
        : null;
    }
    // Bloodghast: the same shape pointed the other way — an OPPONENT, and a
    // ceiling rather than a floor.
    const opponentLife = phrase.match(/^an opponent has (\d+) or less life$/i);
    if (opponentLife?.[1]) {
      const gatedBody = body.replace(/^~\s+/, "~ ");
      const grants = compileSelfGrant(gatedBody) ?? compileStaticGrant(gatedBody);
      return grants
        ? grants.map((ability) => ({
            ...ability,
            requiresOpponentLifeAtMost: Number(opponentLife[1]),
          }))
        : null;
    }
    const life = phrase.match(/^you have (\d+) or more life$/i);
    if (!life?.[1]) {
      return null;
    }
    // Serra Ascendant's "~ gets +5/+5" is a self grant.
    body = body.replace(/^~\s+/, "~ ");
    const grants = compileSelfGrant(body);
    return grants
      ? grants.map((ability) => ({ ...ability, requiresLife: Number(life[1]) }))
      : null;
  }

  // "is"/"are" join the verb list. A predicate the grammar does not know
  // still returns null, so widening the split cannot swallow a sentence
  // that some other branch handles.
  const split = sentence.match(
    /^(.+?)\s+((?:get|gets|have|has|lose|loses|is|are|can't)\s+.+)$/i,
  );
  if (!split?.[1] || !split[2]) {
    return null;
  }
  const selector = parseGrantSubject(split[1]);
  if (!selector) {
    return null;
  }
  const effects = parseGrantPredicate(split[2]);
  if (!effects) {
    return null;
  }
  return effects.map((effect) => ({ selector: { ...selector }, effect }));
}

function offsetChosenIndexes(clause: SimpleClause, offset: number): SimpleClause {
  // A clause that chose no targets of its own cannot be numbering from its
  // own list — its chosen references point back at what an earlier clause
  // targeted ("Exile target artifact or creature. Its controller creates …").
  // Shifting those would walk them off the end of the merged list, where they
  // bind to nobody and the effect quietly does nothing.
  //
  // `chosenBase` is the middle case: a clause that names a target of its own
  // AND refers back to an earlier one already numbers from the merged list,
  // so it is shifted by the REMAINDER or it walks past its own target.
  const shift = offset - (clause.chosenBase ?? 0);
  if (shift <= 0 || clause.targetRequirements.length === 0) {
    return clause;
  }
  return {
    targetRequirements: clause.targetRequirements,
    effects: clause.effects.map((effect) => shiftChosen(effect, shift)),
    leftover: clause.leftover,
    ...(clause.chosenBase === undefined ? {} : { chosenBase: clause.chosenBase }),
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

/**
 * A look clause that spans SENTENCES, folded into a trigger body.
 *
 * Impulse-style ETBs print "look at the top four cards of your library."
 * and "Put one of them into your hand and the rest on the bottom." as two
 * sentences on ONE printed line, and Thassa's Oracle adds a third. A
 * trigger body is parsed as a single sentence, so the pair compiler is
 * handed a synthetic list starting at the body itself. The run stops at a
 * printed line break, which is where a separate ability begins.
 */
function foldLookRun(
  rest: string,
  sentences: string[],
  index: number,
  lineStart: boolean[],
): (SimpleClause & { consumed: number }) | null {
  if (!/^look at the top /i.test(rest)) {
    return null;
  }
  const run: string[] = [rest];
  for (
    let scan = index + 1;
    scan < sentences.length && !lineStart[scan] && sentences[scan];
    scan += 1
  ) {
    run.push(sentences[scan]!);
  }
  const pair = compileLookAndAssignPair(run, 0);
  // A partial read would push a look with no assignment, which discards
  // what it saw. Better to leave the whole run uncompiled.
  return pair && !pair.leftover ? pair : null;
}

/**
 * Finale of Devastation: "Search your library and/or graveyard for a
 * creature card with mana value X or less and put it onto the battlefield."
 * The next sentence, "If you search your library this way, shuffle.", is a
 * rider on THIS search rather than an effect of its own, so it is consumed
 * here. Left standing it would be an uncompiled sentence on a card that
 * otherwise reads whole.
 */
/**
 * Sylvan Library, whose three printed sentences are ONE ability:
 *
 *   "At the beginning of your draw step, you may draw two additional
 *    cards. If you do, choose two cards in your hand drawn this turn. For
 *    each of those cards, pay 4 life or put the card on top of your
 *    library."
 *
 * Matched as a run rather than sentence by sentence: the second names what
 * the first drew and the third names what the second chose, so no part of
 * it compiles to anything meaningful alone.
 *
 * The two choices run in sequence, and the second excludes the first —
 * paying life leaves that card in hand, still drawn this turn, still legal,
 * and without the exclusion a player could pay for the same card twice and
 * keep all three.
 */
/**
 * Braids, Arisen Nightmare — three printed sentences that are one ability:
 *
 *   "At the beginning of your end step, you may sacrifice an artifact,
 *    creature, enchantment, land, or planeswalker. If you do, each opponent
 *    may sacrifice a permanent of their choice that shares a card type with
 *    it. For each opponent who doesn't, that player loses 2 life and you
 *    draw a card."
 *
 * Every choice here is a REAL one. Auto-taking the controller's would
 * sacrifice something every end step whether they wanted it or not, and
 * auto-taking an opponent's would decide the punisher for them — which is
 * the entire card.
 */
const ROMAN_CHAPTERS: Record<string, number> = {
  i: 1,
  ii: 2,
  iii: 3,
  iv: 4,
  v: 5,
};

/**
 * A Saga's chapter lines (CR 714), which print as "I — …", "II — …" and so
 * on. Collected as a run, because a Saga is one object and a chapter that
 * did not read leaves the whole card half-built — a Saga that sacrifices
 * itself after a chapter it cannot perform is worse than one that misses.
 *
 * `This Saga gains "…"` goes through the shared quoted-ability compiler,
 * which already knows a granted mana ability from a granted activated one.
 * The grant is turned inward: it is the Saga itself that gains the ability.
 */
function compileSagaChapters(
  sentences: string[],
  index: number,
): { chapters: CardEffect[][]; consumed: number } | null {
  const chapters: CardEffect[][] = [];
  let scan = index;
  while (scan < sentences.length) {
    const line = sentences[scan]?.match(/^([IVX]+(?:, ?[IVX]+)*) [—-] (.+)$/i);
    if (!line?.[1] || !line[2]) {
      break;
    }
    const numbers = line[1]
      .split(/,\s*/)
      .map((entry) => ROMAN_CHAPTERS[entry.trim().toLowerCase()]);
    if (numbers.some((entry) => entry === undefined)) {
      return null;
    }
    const body = line[2].trim();
    const gains = body.match(/^This Saga gains "(.+)\.?"$/i);
    let effects: CardEffect[] | null = null;
    if (gains?.[1]) {
      const granted = compileQuotedAbility(gains[1].replace(/\.$/, ""));
      if (granted && granted.length === 1) {
        const only = granted[0]!;
        if (only.kind === "grant_mana_ability") {
          effects = [{ kind: "grant_self_mana", ability: only.ability }];
        } else if (only.kind === "grant_activated") {
          effects = [{ kind: "grant_self_activated", ability: only.ability }];
        }
      }
    } else {
      const clause = compileSimpleClause(body);
      if (clause && !clause.leftover && clause.targetRequirements.length === 0) {
        effects = clause.effects;
      }
    }
    if (!effects) {
      return null;
    }
    for (const number of numbers) {
      chapters[number! - 1] = effects.map((effect) => ({ ...effect }));
    }
    scan += 1;
  }
  if (chapters.length === 0) {
    return null;
  }
  // A gap means a chapter did not read, and a Saga missing one of its own
  // chapters is a wrong card rather than an incomplete one.
  for (let chapter = 0; chapter < chapters.length; chapter += 1) {
    if (!chapters[chapter]) {
      return null;
    }
  }
  return { chapters, consumed: scan - index };
}

function compileBraidsEndStep(
  sentences: string[],
  index: number,
): (SimpleClause & { consumed: number }) | null {
  const head = sentences[index]?.match(
    /^At the beginning of your end step, you may sacrifice an artifact, creature, enchantment, land, or planeswalker$/i,
  );
  const answer = sentences[index + 1];
  const punish = sentences[index + 2];
  if (!head || !answer || !punish) {
    return null;
  }
  if (
    !/^If you do, each opponent may sacrifice a permanent of their choice that shares a card type with it$/i.test(
      answer,
    )
  ) {
    return null;
  }
  const punishMatch = punish.match(
    /^For each opponent who doesn['’]t, that player loses (\d+) life and you draw a card$/i,
  );
  if (!punishMatch?.[1]) {
    return null;
  }
  const life = Number(punishMatch[1]);
  return {
    targetRequirements: [],
    effects: [
      {
        kind: "choose_card",
        chooserId: "controller",
        // The five listed types are every permanent type this card can see.
        sources: [
          { playerId: "controller", zone: "battlefield", filter: "any" },
        ],
        optional: true,
        thenEffects: [
          { kind: "sacrifice", cardId: "chosen_card" },
          {
            kind: "choose_card",
            chooserId: "each_opponent",
            sources: [
              {
                playerId: "each_opponent",
                zone: "battlefield",
                filter: "any",
                sharesTypeWithChosen: true,
              },
            ],
            optional: true,
            thenEffects: [{ kind: "sacrifice", cardId: "chosen_card" }],
            thenEffectsIfNone: [
              { kind: "lose_life", playerId: { type: "subject_player" }, amount: life },
              { kind: "draw", playerId: "controller", count: 1 },
            ],
          },
        ],
      },
    ],
    consumed: 3,
  };
}

function compileSylvanDrawStep(
  sentences: string[],
  index: number,
): (SimpleClause & { consumed: number }) | null {
  const head = sentences[index]?.match(
    /^At the beginning of your draw step, you may draw (two|three|\d+) additional cards$/i,
  );
  const choose = sentences[index + 1];
  const price = sentences[index + 2];
  if (!head?.[1] || !choose || !price) {
    return null;
  }
  const drawCount = parseCount(head[1]);
  const chooseMatch = choose.match(
    /^If you do, choose (two|three|\d+) cards in your hand drawn this turn$/i,
  );
  const priceMatch = price.match(
    /^For each of those cards, pay (\d+) life or put the card on top of your library$/i,
  );
  if (!drawCount || !chooseMatch?.[1] || !priceMatch?.[1]) {
    return null;
  }
  const chooseCount = parseCount(chooseMatch[1]);
  if (!chooseCount) {
    return null;
  }
  const life = Number(priceMatch[1]);
  const pick = (first: boolean): CardEffect => ({
    kind: "choose_card",
    chooserId: "controller",
    sources: [
      {
        playerId: "controller",
        zone: "hand",
        filter: "any",
        drawnThisTurn: true,
        ...(first ? {} : { excludePreviousChoice: true }),
      },
    ],
    thenEffects: [
      {
        kind: "unless_pays",
        playerId: "controller",
        cost: "",
        life,
        effects: [
          {
            kind: "move_card",
            cardId: "chosen_card",
            toZone: "library",
            libraryPosition: "top",
          },
        ],
      },
    ],
  });
  return {
    targetRequirements: [],
    effects: [
      { kind: "draw", playerId: "controller", count: drawCount, optional: true },
      ...Array.from({ length: chooseCount }, (_unused, slot) => pick(slot === 0)),
    ],
    consumed: 3,
  };
}

function compileTwoZoneTutorPair(
  sentences: string[],
  index: number,
): (SimpleClause & { consumed: number }) | null {
  const tutor = sentences[index]?.match(
    /^Search your library and\/or graveyard for (?:an? )?(.+?) card with mana value X or less and put it onto the battlefield$/i,
  );
  if (!tutor?.[1]) {
    return null;
  }
  const filter = parseSearchDescriptor(tutor[1]);
  if (!filter) {
    return null;
  }
  const shuffle = sentences[index + 1];
  if (
    !shuffle ||
    !/^If you search your library this way, shuffle$/i.test(shuffle)
  ) {
    return null;
  }
  return {
    targetRequirements: [],
    effects: [
      {
        kind: "search_library",
        playerId: "controller",
        filter: { ...filter, maxManaValueX: true },
        destination: "battlefield",
        count: 1,
        alsoGraveyard: true,
      },
    ],
    consumed: 2,
  };
}

function compileLookAndAssignPair(sentences: string[], index: number): SimpleClause & { consumed: number } | null {
  // Thassa's Oracle: the count is X, and X is devotion — not a number the
  // compiler can know. A SECOND head rather than a widened first one, so
  // the fixed-count forms below keep reading exactly as they did.
  const devotionLook = sentences[index]?.match(
    /^Look at the top X cards of your library, where X is your devotion to (white|blue|black|red|green)$/i,
  );
  const devotionAssign = sentences[index + 1];
  if (devotionLook?.[1] && devotionAssign) {
    const color = COLOR_WORDS[devotionLook[1].toLowerCase()];
    const topRest =
      /^Put up to one of them on top of your library and the rest on the bottom of your library in (?:any|a random) order$/i.test(
        devotionAssign,
      );
    if (color && topRest) {
      const effects: CardEffect[] = [
        {
          kind: "look_and_assign",
          playerId: "controller",
          // Unused while `countFromDevotion` is set. Zero and not four so
          // that losing the flag yields no look at all rather than a look
          // of some invented size.
          count: 0,
          destinations: [],
          countFromDevotion: color,
          upToOneOnTop: true,
        },
      ];
      // "If X is greater than or equal to the number of cards in your
      // library, you win the game." The same X, so the same colour.
      const win = sentences[index + 2];
      if (
        win &&
        /^If X is greater than or equal to the number of cards in your library, you win the game$/i.test(
          win,
        )
      ) {
        effects.push({ kind: "win_game", playerId: "controller", ifDevotionAtLeastLibrary: color });
        return { targetRequirements: [], effects, consumed: 3 };
      }
      return { targetRequirements: [], effects, consumed: 2 };
    }
  }

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
  // Dig Through Time: the same shape with more than one hand slot. The
  // destination list is a MULTISET, so two hand slots and five bottom ones
  // say it exactly; nothing about the mechanism changes with the count.
  const manyToHand = assign.match(
    /^Put (two|three|four|five) of them into your hand and (?:the rest|put the rest) on the bottom of your library in (?:any|a random) order$/i,
  );
  const toHand = manyToHand?.[1] ? parseCount(manyToHand[1]) : null;
  if (toHand && toHand < count) {
    return {
      targetRequirements: [],
      effects: [
        {
          kind: "look_and_assign",
          playerId: "controller",
          count,
          destinations: [
            ...Array.from({ length: toHand }, () => "hand" as const),
            ...Array.from({ length: count - toHand }, () => "library_bottom" as const),
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
      fuseSplitDestinationSearchInPlace(sentences, lineStart);
    }
    if (sentences.length === 0) {
      return { remainingText, modes: null, raw };
    }
    // A bullet may be more than one sentence ("Put a +1/+1 counter on target
    // creature you control. It gains indestructible until end of turn."). Each
    // compiles on its own and they join, with later sentences' chosen indexes
    // renumbered onto the tail of the bullet's own target list — the same
    // merge the top-level clause sequence does, but bounded to this bullet,
    // since a mode's targets are chosen for that mode alone.
    const effects: CardEffect[] = [];
    const targetRequirements: TargetRequirement[] = [];
    for (const part of sentences) {
      const backReference =
        targetRequirements.length > 0 ? compileBackReferenceClause(part) : null;
      const clause = backReference
        ? { targetRequirements: [], effects: backReference }
        : compileSimpleClause(part);
      if (!clause || clause.leftover) {
        return { remainingText, modes: null, raw };
      }
      const shifted = offsetChosenIndexes(clause, targetRequirements.length);
      targetRequirements.push(...shifted.targetRequirements);
      effects.push(...shifted.effects);
      // Scoped to this bullet: a mode denies regeneration only to what it
      // destroyed, and the modes beside it are other abilities entirely.
      if (REGENERATION_DENIAL.test(part)) {
        denyRegenerationInPlace(effects);
      }
    }
    modes.push({
      label: bullet.replace(/\.$/, ""),
      effects,
      targetRequirements,
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

/** "return that card to the battlefield under its owner's control with a
 * +1/+1 counter on it at the beginning of the next end step" (Parting
 * Gust's unpromised half). */
const GIFT_RETURN_RIDER =
  /^return that card to the battlefield under its owner's control with a \+1\/\+1 counter on it at the beginning of the next end step$/i;

/**
 * The gift mechanic (CR 702.174) compiles to a two-mode choice made on
 * cast: mode 0 declines the gift and mode 1 promises it, with the
 * recipient's reward resolving before the spell's other effects. Two
 * documented approximations: the recipient is always the next opponent
 * (rather than a chosen one), and Dawn's Truce's "You and …" player-
 * hexproof half is dropped (player hexproof isn't modeled).
 */
function extractGiftModes(card: OracleCard): ModalExtraction | null {
  const lines = stripReminderText(card.oracleText)
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const headIndex = lines.findIndex((line) => /^Gift a (card|tapped Fish)$/i.test(line));
  if (headIndex === -1 || headIndex + 1 >= lines.length) {
    return null;
  }
  const head = lines[headIndex]!;
  const body = lines[headIndex + 1]!;
  const remainingText = [...lines.slice(0, headIndex), ...lines.slice(headIndex + 2)].join("\n");
  const raw = `${head} ${body}`;
  const failed: ModalExtraction = { remainingText, modes: null, raw };
  const giftEffect: CardEffect = /card$/i.test(head)
    ? { kind: "draw", playerId: "next_opponent", count: 1 }
    : {
        kind: "create_token",
        ownerId: "next_opponent",
        name: "Fish",
        typeLine: "Creature — Fish Token",
        power: 1,
        toughness: 1,
        entersTapped: true,
      };
  const sentences = splitOracleSentences({ ...card, oracleText: body });
  if (sentences.length !== 2 || !sentences[0] || !sentences[1]) {
    return failed;
  }
  // Dawn's Truce: the player-hexproof half of "You and permanents you
  // control" is dropped.
  const base = sentences[0].replace(/^You and permanents you control gain/i, "Permanents you control gain");
  const rider = sentences[1];
  const buildModes = (
    unpromised: { effects: CardEffect[]; targetRequirements: TargetRequirement[] },
    promised: { effects: CardEffect[]; targetRequirements: TargetRequirement[] },
  ): ModalExtraction => ({
    remainingText,
    raw,
    modes: [
      { label: "Don't promise a gift", effects: unpromised.effects, targetRequirements: unpromised.targetRequirements },
      {
        label: `Promise the gift (${head.replace(/^Gift /i, "")})`,
        effects: [giftEffect, ...promised.effects],
        targetRequirements: promised.targetRequirements,
      },
    ],
  });

  // Parting Gust: unpromised, the exiled creature blinks back to its owner
  // with a +1/+1 counter; promised, it stays exiled.
  const wasnt = rider.match(/^If the gift wasn't promised, (.+)$/i);
  if (wasnt?.[1]) {
    if (!GIFT_RETURN_RIDER.test(wasnt[1]) || !/^Exile target nontoken creature$/i.test(base)) {
      return failed;
    }
    const target: TargetRequirement = { kind: "creature", nontoken: true };
    return buildModes(
      {
        effects: [
          { kind: "exile_return_end_step", target: { type: "chosen", index: 0 }, toOwner: true, withCounter: "p1p1" },
        ],
        targetRequirements: [target],
      },
      {
        effects: [{ kind: "move_card", cardId: { type: "chosen", index: 0 }, toZone: "exile" }],
        targetRequirements: [target],
      },
    );
  }

  const promisedRider = rider.match(/^If the gift was promised, (.+)$/i);
  if (!promisedRider?.[1]) {
    return failed;
  }
  const baseClause = compileSimpleClause(base);
  if (!baseClause || baseClause.leftover) {
    return failed;
  }
  const tail = promisedRider[1];

  // "instead <alt clause>": the promised mode swaps the whole effect.
  const instead = tail.match(/^instead (.+)$/i);
  if (instead?.[1]) {
    const alt = instead[1].charAt(0).toUpperCase() + instead[1].slice(1);
    const altClause = compileSimpleClause(alt);
    if (!altClause || altClause.leftover) {
      return failed;
    }
    return buildModes(
      { effects: baseClause.effects, targetRequirements: baseClause.targetRequirements },
      { effects: altClause.effects, targetRequirements: altClause.targetRequirements },
    );
  }

  // "<subject> also <grant>": the promised mode adds to the base effects.
  const also = tail.match(/^(.+?) also (.+)$/i);
  if (also?.[1] && also[2]) {
    const extra = `${also[1].charAt(0).toUpperCase()}${also[1].slice(1)} ${also[2]}`;
    const extraClause = compileSimpleClause(extra);
    if (!extraClause || extraClause.leftover || extraClause.targetRequirements.length > 0) {
      return failed;
    }
    return buildModes(
      { effects: baseClause.effects, targetRequirements: baseClause.targetRequirements },
      {
        effects: [...baseClause.effects, ...extraClause.effects],
        targetRequirements: baseClause.targetRequirements,
      },
    );
  }
  return failed;
}

type TriggerModalExtraction = {
  remainingText: string;
  trigger: CardTrigger | null;
  raw: string;
};

/** Heads the general parser doesn't cover, in their modal-trigger forms. */
function parseSimpleTriggerHead(text: string): TriggerHead | null {
  const t = text.replace(ABILITY_WORD_PREFIX, "").trim();
  if (/^When(?:ever)? ~ enters$/i.test(t)) {
    return { event: "enter_battlefield" };
  }
  if (/^When(?:ever)? ~ dies$/i.test(t)) {
    return { event: "dies" };
  }
  return null;
}

/**
 * "When ~ enters, choose one —" trigger blocks (Aether Channeler, Felidar
 * Retreat): the head keeps its trigger event, the bullets become modes the
 * controller picks from when the trigger would stack. Every bullet must
 * compile whole or the block stays a note.
 */
function extractTriggerModalModes(card: OracleCard): TriggerModalExtraction | null {
  const lines = stripReminderText(card.oracleText).replace(/\r/g, "").split("\n");
  const headIndex = lines.findIndex((line) =>
    /^(?:Landfall\s*[\u2014-]\s*)?(?:When(?:ever)?|At the beginning of) .+, choose (one|one or more|up to one|up to two|two)\s*[\u2014-]\s*$/i.test(
      line.trim(),
    ),
  );
  if (headIndex === -1) {
    return null;
  }
  // Black Market Connections chooses one or more; Hullbreaker Horror up to
  // one. Absent bounds mean exactly one, which is what every modal trigger
  // written before them asked for.
  const headCount =
    lines[headIndex]!
      .trim()
      .match(/,\s*choose (one or more|up to one|up to two|two|one)\s*[\u2014-]\s*$/i)?.[1]
      ?.toLowerCase() ?? "one";
  const bullets: string[] = [];
  let end = headIndex + 1;
  while (end < lines.length && lines[end]!.trim().startsWith("•")) {
    bullets.push(
      lines[end]!
        .trim()
        .replace(/^•\s*/, "")
        // Black Market Connections names each mode; the name is flavour
        // (CR 207.2c) and is not part of what the mode does.
        .replace(/^[A-Z][\w'\- ]*\s+[\u2014]\s+/, ""),
    );
    end += 1;
  }
  if (bullets.length < 2) {
    return null;
  }
  const remainingText = [...lines.slice(0, headIndex), ...lines.slice(end)].join("\n");
  const raw = lines.slice(headIndex, end).join(" ");
  const frontName = card.name.split(" // ")[0]!;
  const shortName = frontName.split(",")[0]!;
  const headText = lines[headIndex]!
    .trim()
    .replace(/,\s*choose (?:one or more|up to one|up to two|two|one)\s*[\u2014-]\s*$/i, "")
    .replace(/\bthis creature\b/gi, "~")
    .replace(new RegExp(`\\b${frontName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), "~")
    // Legend short names ("When Atsushi dies").
    .replace(new RegExp(`\\b${shortName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), "~");
  const head = parseTriggerHead(headText) ?? parseSimpleTriggerHead(headText);
  if (!head) {
    return { remainingText, trigger: null, raw };
  }
  const modes: SpellMode[] = [];
  for (const bullet of bullets) {
    const bulletSentences = splitOracleSentences({ ...card, oracleText: bullet });
    if (bulletSentences.length > 1) {
      const bulletLineStart = bulletSentences.map((_, position) => position === 0);
      fuseDigSentencesInPlace(bulletSentences, bulletLineStart);
      fuseSplitDestinationSearchInPlace(bulletSentences, bulletLineStart);
      fuseExilePlayInPlace(bulletSentences, bulletLineStart);
      fuseExileReturnEndStepInPlace(bulletSentences, bulletLineStart);
    }
    const effects: CardEffect[] = [];
    let requirements: TargetRequirement[] = [];
    let failed = bulletSentences.length === 0;
    for (const sentence of bulletSentences) {
      const clause = compileSimpleClause(sentence);
      // A second targeted sentence would skew chosen indexes; keep modes to
      // one targeted clause (first) plus untargeted riders.
      if (
        !clause ||
        clause.leftover ||
        (clause.targetRequirements.length > 0 && (requirements.length > 0 || effects.length > 0))
      ) {
        failed = true;
        break;
      }
      if (clause.targetRequirements.length > 0) {
        requirements = clause.targetRequirements;
      }
      effects.push(...clause.effects);
      if (REGENERATION_DENIAL.test(sentence)) {
        denyRegenerationInPlace(effects);
      }
    }
    if (failed || effects.length === 0) {
      return { remainingText, trigger: null, raw };
    }
    modes.push({
      label: bullet.replace(/\.$/, ""),
      effects,
      targetRequirements: requirements,
    });
  }
  const { extraEvents, ...headRest } = head;
  void extraEvents;
  return {
    remainingText,
    raw,
    trigger: {
      ...headRest,
      modes,
      ...(headCount === "one"
        ? {}
        : {
            modeChoice:
              headCount === "one or more"
                ? { min: 1, max: modes.length }
                : headCount === "up to one"
                  ? { min: 0, max: 1 }
                  : headCount === "up to two"
                    ? { min: 0, max: 2 }
                    : { min: 2, max: 2 },
          }),
      effects: [],
      targetRequirements: [],
    },
  };
}

type ActivatedModalExtraction = {
  remainingText: string;
  ability: ActivatedAbility | null;
  raw: string;
};

/**
 * "{2}, Sacrifice ~: Choose one —" activation blocks (Insidious Fungus,
 * Cankerbloom): the cost keeps its activation shape, the bullets become
 * modes chosen when the ability is activated.
 */
function extractActivatedModalModes(card: OracleCard): ActivatedModalExtraction | null {
  const lines = stripReminderText(card.oracleText).replace(/\r/g, "").split("\n");
  const headIndex = lines.findIndex((line) =>
    /^.+: Choose one\s*[—-]\s*$/i.test(line.trim()),
  );
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
  const costText = lines[headIndex]!
    .trim()
    .replace(/: Choose one\s*[—-]\s*$/i, "")
    .replace(/\bthis creature\b/gi, "~")
    .replace(/\bthis artifact\b/gi, "~")
    .replace(/\bthis enchantment\b/gi, "~");
  const cost = parseAbilityCost(costText);
  if (!cost) {
    return { remainingText, ability: null, raw };
  }
  const modes: SpellMode[] = [];
  for (const bullet of bullets) {
    const bulletSentences = splitOracleSentences({ ...card, oracleText: bullet });
    const effects: CardEffect[] = [];
    const requirements: TargetRequirement[] = [];
    let failed = bulletSentences.length === 0;
    for (const rawSentence of bulletSentences) {
      // "Then you may put a land card…" riders keep their clause shape.
      const sentence = rawSentence.replace(/^Then /i, "");
      const clause = compileSimpleClause(sentence);
      if (!clause || clause.leftover) {
        failed = true;
        break;
      }
      // Same rule as the trigger-mode assembler above: a clause with
      // targets of its own is shifted past the ones already claimed; a
      // clause with none refers BACK and keeps its indexes.
      const shift = requirements.length - (clause.chosenBase ?? 0);
      effects.push(
        ...(clause.targetRequirements.length > 0 && shift > 0
          ? clause.effects.map((effect) => shiftChosen(effect, shift))
          : clause.effects),
      );
      requirements.push(...clause.targetRequirements);
      if (REGENERATION_DENIAL.test(sentence)) {
        denyRegenerationInPlace(effects);
      }
    }
    if (failed || effects.length === 0) {
      return { remainingText, ability: null, raw };
    }
    modes.push({
      label: bullet.replace(/\.$/, ""),
      effects,
      targetRequirements: requirements,
    });
  }
  return {
    remainingText,
    raw,
    ability: {
      tap: cost.tap,
      manaCost: cost.manaCost,
      ...(cost.sacrificeSelf ? { sacrificeSelf: true } : {}),
      ...(cost.sacrificeCost ? { sacrificeCost: cost.sacrificeCost } : {}),
      ...(cost.sacrificeSubtype ? { sacrificeSubtype: cost.sacrificeSubtype } : {}),
      ...(cost.sacrificeCount ? { sacrificeCount: cost.sacrificeCount } : {}),
      ...(cost.removeCounterCost ? { removeCounterCost: cost.removeCounterCost } : {}),
      ...(cost.addCounterCost ? { addCounterCost: cost.addCounterCost } : {}),
      ...(cost.discardCost ? { discardCost: cost.discardCost } : {}),
      ...(cost.millCost !== undefined ? { millCost: cost.millCost } : {}),
      ...(cost.exileFromGraveyardCost ? { exileFromGraveyardCost: cost.exileFromGraveyardCost } : {}),
      ...(cost.lifeCost ? { lifeCost: cost.lifeCost } : {}),
      ...(cost.lifeCostFromCommanderColors
        ? { lifeCostFromCommanderColors: true }
        : {}),
      modes,
      effects: [],
      targetRequirements: [],
    },
  };
}

const CLONE_SCOPE_BY_PHRASE: Record<string, EnterAsCopyScope> = {
  "any creature on the battlefield": "any_creature",
  "a creature you control": "your_creature",
  "another creature you control": "another_your_creature",
  "a creature or planeswalker you control": "your_creature_or_planeswalker",
  "any nonland permanent on the battlefield": "any_nonland_permanent",
  "any artifact or creature on the battlefield": "any_artifact_or_creature",
  "any artifact on the battlefield": "any_artifact",
  "any land on the battlefield": "any_land",
  "any equipment on the battlefield": "any_equipment",
  "any artifact or enchantment on the battlefield": "any_artifact_or_enchantment",
};

/**
 * Clone "except" riders that are safe to consume: either carried into
 * enterAsCopy fields or documented cosmetic no-ops (added types, granted
 * keywords and quoted abilities, name changes, myriad, Sakashima's kept
 * abilities). Returns null when any rider is unrecognized, so exotic riders
 * keep the sentence uncompiled instead of silently vanishing.
 */
function parseCopyExceptRiders(
  tail: string,
): { extraCounters?: number; notLegendary?: boolean } | null {
  const result: { extraCounters?: number; notLegendary?: boolean } = {};
  // Quoted ability grants may hold commas and periods — strip them whole
  // before splitting the rest into rider atoms.
  let rest = tail.replace(/(?:and )?(?:it|the token) has "[^"]*"/gi, "").trim();
  rest = rest.replace(/^[,;]+|[,;]+$/g, "").trim();
  if (rest === "") {
    return result;
  }
  const atoms = rest
    .split(/, and |, | and /i)
    .map((atom) => atom.trim())
    .filter(Boolean);
  for (const atom of atoms) {
    if (/^it enters with an additional \+1\/\+1 counter on it if it's a creature$/i.test(atom)) {
      result.extraCounters = 1;
      continue;
    }
    if (/^it enters with an additional loyalty counter on it if it's a planeswalker$/i.test(atom)) {
      continue;
    }
    if (/^(?:it|the token) (?:isn't|is not) legendary$/i.test(atom)) {
      // Not cosmetic: a legendary copy of a legendary creature loses one
      // of the pair to the legend rule the instant it arrives, which for
      // Helm of the Host is the whole card. This used to be swallowed.
      result.notLegendary = true;
      continue;
    }
    if (/^(?:it's|it is|is) (?:an? )?[\w' -]+ in addition to its other types$/i.test(atom)) {
      continue;
    }
    if (/^(?:it |the token )?has (?:flying|myriad)$/i.test(atom)) {
      continue;
    }
    // "~" once the name is normalised, or a literal name on cards that
    // spell out a different permanent's.
    if (/^it has (?:~|[\w' -]+)'s other abilities$/i.test(atom)) {
      continue;
    }
    return null;
  }
  return result;
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
  // Gift heads compile to a promise/decline mode pair, before sentence
  // splitting (the head is its own line).
  const afterModal = modal ? { ...card, oracleText: modal.remainingText } : card;
  const gift = extractGiftModes(afterModal);
  if (gift) {
    if (gift.modes) {
      result.modes = gift.modes;
    } else {
      result.leftover.push(gift.raw);
    }
  }
  const afterGift = gift ? { ...afterModal, oracleText: gift.remainingText } : afterModal;
  // "When ~ dies/enters, choose one —" trigger blocks, before sentence
  // splitting (the bullets are lines).
  const triggerModal = extractTriggerModalModes(afterGift);
  if (triggerModal) {
    if (triggerModal.trigger) {
      result.triggers.push(triggerModal.trigger);
    } else {
      result.leftover.push(triggerModal.raw);
    }
  }
  const afterTriggerModal = triggerModal
    ? { ...afterGift, oracleText: triggerModal.remainingText }
    : afterGift;
  // "{2}, Sacrifice ~: Choose one —" activation blocks.
  const activatedModal = extractActivatedModalModes(afterTriggerModal);
  if (activatedModal) {
    if (activatedModal.ability) {
      result.activated.push(activatedModal.ability);
    } else {
      result.leftover.push(activatedModal.raw);
    }
  }
  const sourceCard = activatedModal
    ? { ...afterTriggerModal, oracleText: activatedModal.remainingText }
    : afterTriggerModal;
  const lines = splitOracleSentencesByLine(sourceCard);
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
  fuseSplitDestinationSearchInPlace(sentences, lineStart);
  fuseBiteInPlace(sentences, lineStart);
  fuseD20TreasuresInPlace(sentences, lineStart);
  fuseExileReturnEndStepInPlace(sentences, lineStart);
  fuseTraverseInPlace(sentences, lineStart);
  fuseThenIntoTriggerInPlace(sentences, lineStart);
  expandDualTriggerHeadInPlace(sentences, lineStart);
  expandEntersOrDiesInPlace(sentences, lineStart);
  splitGrantedQuotedTriggerInPlace(sentences, lineStart);
  fuseItCantBeBlockedInPlace(sentences, lineStart);
  fuseDestroyLifegainInPlace(sentences, lineStart);
  fuseInAdditionTypeInPlace(sentences, lineStart);
  fuseChooseGraveyardCastInPlace(sentences, lineStart);
  fusePutLandRiderInPlace(sentences, lineStart);
  fuseMayPayInPlace(sentences, lineStart);
  fusePactInPlace(sentences, lineStart);
  fuseChooseTargetCreatureInPlace(sentences, lineStart);
  fuseLookTopTakeInPlace(sentences, lineStart);
  fuseVoidPlayInPlace(sentences, lineStart);
  fuseManaUntilEotInPlace(sentences, lineStart);
  fuseEscapeGrantInPlace(sentences, lineStart);
  fuseOpeningHandStartInPlace(sentences, lineStart);
  fuseMoxDiamondInPlace(sentences, lineStart);
  fuseMaySacrificeInPlace(sentences, lineStart);
  fuseNecroTopInPlace(sentences, lineStart);
  splitActivationRidersInPlace(sentences, lineStart);
  fuseRepeatXInPlace(sentences, lineStart);
  fuseSearchPutInPlace(sentences, lineStart);
  fuseSawInHalfInPlace(sentences, lineStart);
  fuseInkshieldInPlace(sentences, lineStart);
  fuseRipplesInPlace(sentences, lineStart);
  fuseExertInPlace(sentences, lineStart);
  fuseApproachInPlace(sentences, lineStart);
  // A printed line is an ability, so these mark where the current line's
  // output begins. Riders that reach BACKWARD — the regeneration denial
  // below — use them to stop at the line they were printed on.
  let lineEffectFloor = 0;
  let lineTriggerFloor = 0;
  let lineActivatedFloor = 0;
  for (let index = 0; index < sentences.length; index += 1) {
    const sentence = sentences[index];
    if (!sentence) {
      continue;
    }
    if (lineStart[index]) {
      lineEffectFloor = result.effects.length;
      lineTriggerFloor = result.triggers.length;
      lineActivatedFloor = result.activated.length;
    }
    // Pristine Talisman: a life rider on the mana ability printed with it.
    // Parked in `result.effects` it would never run at all, because a
    // permanent spell resolves by entering the battlefield rather than by
    // resolving its effects.
    const manaLifeRider = sentence.match(/^You gain (one|two|three|\d+) life$/i);
    const riddenMana = result.manaAbilities[result.manaAbilities.length - 1];

    if (
      manaLifeRider?.[1] &&
      riddenMana &&
      index > 0 &&
      !lineStart[index] &&
      riddenMana.gainLifeToController === undefined
    ) {
      const gained = parseCount(manaLifeRider[1]);
      if (gained) {
        riddenMana.gainLifeToController = gained;
        continue;
      }
    }

    // A subject rider attaches to the effect that made the permanent, and
    // it must be tried BEFORE the general clause branches. Read later,
    // "It gains haste until end of turn" compiles as a back-reference to
    // the COPIED ORIGINAL instead of the token — the card then scores and
    // hastes the wrong permanent, which is worse than not compiling.
    //
    // Safe to try first because the fold is narrow: two exact sentences,
    // and only when an earlier effect on the same printed line created or
    // moved a permanent.
    if (index > 0 && !lineStart[index] && foldSubjectRider(result.effects, sentence)) {
      continue;
    }

    // Force of Negation: "If that spell is countered this way, exile it
    // instead of putting it into its owner's graveyard." A sentence of
    // its own that MODIFIES the counter before it — compiled separately
    // it would be an effect with nothing to act on, and the countered
    // spell would quietly reach the graveyard after all.
    if (
      index > 0 &&
      !lineStart[index] &&
      /^If that spell is countered this way, exile it instead of putting it into its owner['\u2019]s graveyard$/i.test(
        sentence,
      )
    ) {
      const counter = [...result.effects]
        .reverse()
        .find((effect) => effect.kind === "counter_spell");
      if (counter) {
        counter.exileInstead = true;
        continue;
      }
    }

    // A rider that reads the sacrificed creature has to travel INTO the
    // thenEffects of the choose_card that sacrifices it, whether that
    // choose_card is in a trigger or in the spell itself.
    if (index > 0 && !lineStart[index]) {
      const lastTrigger = result.triggers[result.triggers.length - 1];
      if (lastTrigger && foldSacrificeRider(lastTrigger.effects, sentence)) {
        continue;
      }
      if (foldSacrificeRider(result.effects, sentence)) {
        continue;
      }
    }

    const keywordLine = readKeywordLine(sentence);
    if (keywordLine) {
      if (keywordLine.protection) {
        result.protectionFrom = mergeProtection(result.protectionFrom ?? {}, keywordLine.protection);
      }
      continue;
    }

    /**
     * "Cascade", "Cascade, cascade" (Maelstrom Wanderer) and four of them
     * (Apex Devastator) are the same keyword repeated, so the count is read
     * off the sentence rather than each arity getting a clause.
     */
    if (/^cascade(?:, cascade)*$/i.test(sentence)) {
      result.cascade = (result.cascade ?? 0) + sentence.split(",").length;
      continue;
    }

    const wardLine = sentence.match(/^Ward \{(\d+)\}$/i);
    if (wardLine?.[1]) {
      result.ward = Number(wardLine[1]);
      continue;
    }

    // "Ward—Pay 2 life" (CR 702.21b): the same ability, taxed in life.
    const wardLifeLine = sentence.match(/^Ward\s*[—-]\s*Pay (\d+) life$/i);
    if (wardLifeLine?.[1]) {
      result.wardLife = Number(wardLifeLine[1]);
      continue;
    }

    // Animate Dead: an Aura cast on a creature card in a GRAVEYARD. The
    // `enchant` value stays "creature" because that is what it is attached
    // to once it resolves, and it is the loose-Aura state-based action that
    // reads it — the graveyard is where the TARGET lives, not the host.
    // Sevinne's Reclamation. The copy is pushed during resolution, from the
    // resolving object itself, because the spell has already left the stack
    // by the time its effects bind — so this is a definition flag and not an
    // effect.
    if (
      /^If this spell was cast from a graveyard, you may copy this spell and may choose a new target for the copy$/i.test(
        sentence,
      )
    ) {
      result.copySelfWhenCastFromGraveyard = true;
      continue;
    }

    // Underworld Breach, once the fuser has joined the grant to its cost.
    const escapeGrant = sentence.match(
      /^Each nonland card in your graveyard has escape for exiling (a|an|one|two|three|four|five|\d+) other cards$/i,
    );
    if (escapeGrant?.[1]) {
      const exileOther = parseCount(escapeGrant[1]);
      if (exileOther) {
        result.grantsEscape = { exileOther };
        continue;
      }
    }

    if (/^Enchant creature card in a graveyard$/i.test(sentence)) {
      result.enchant = "creature";
      if (
        !result.targetRequirements.some(
          (requirement) => requirement.kind === "graveyard_creature_card",
        )
      ) {
        result.targetRequirements.push({ kind: "graveyard_creature_card" });
      }
      continue;
    }

    // The rest of the same card. The printed text is a legacy contortion —
    // the Aura rewrites its own enchant clause — but all it does is put the
    // enchanted card onto the battlefield and attach. Matched whole rather
    // than in pieces, because no part of it means anything alone.
    if (
      /^When ~ enters, if it['’]s on the battlefield, it loses "enchant creature card in a graveyard" and gains "enchant creature put onto the battlefield with ~\." Return enchanted creature card to the battlefield under your control and attach ~ to it$/i.test(
        sentence,
      )
    ) {
      result.reanimateOnEnter = true;
      continue;
    }

    // "When ~ leaves the battlefield, that creature's controller sacrifices
    // it." — the creature it ANIMATED, which `attachedTo` can no longer
    // name by the time this fires.
    if (
      /^When ~ leaves the battlefield, that creature['’]s controller sacrifices it$/i.test(
        sentence,
      )
    ) {
      result.triggers.push({
        event: "leaves_battlefield",
        // It watches ITSELF go, not what its controller loses.
        watch: "self",
        effects: [{ kind: "sacrifice", cardId: "reanimated" }],
        targetRequirements: [],
      });
      continue;
    }

    if (/^Enchant creature$/i.test(sentence)) {
      result.enchant = "creature";
      if (!result.targetRequirements.some((requirement) => requirement.kind === "creature")) {
        result.targetRequirements.push({ kind: "creature" });
      }
      continue;
    }

    // Kaya's Ghostform ("you own" reads as "you control", the Staff of
    // Compleation approximation).
    if (/^Enchant creature or planeswalker you (?:own|control)$/i.test(sentence)) {
      result.enchant = "creature_or_planeswalker_own";
      if (
        !result.targetRequirements.some(
          (requirement) => requirement.kind === "creature_or_planeswalker",
        )
      ) {
        result.targetRequirements.push({ kind: "creature_or_planeswalker", control: "own" });
      }
      continue;
    }

    // Kaya's Ghostform's return watch: the exile half is dropped — only the
    // dies event is watched, a documented approximation.
    if (
      /^When enchanted permanent dies or is put into exile, return that card to the battlefield under your control$/i.test(
        sentence,
      )
    ) {
      result.triggers.push({
        event: "dies",
        watch: "attached",
        effects: [
          {
            kind: "move_card",
            cardId: "subject_card",
            toZone: "battlefield",
            underControlOf: "controller",
          },
        ],
      });
      continue;
    }

    // Imprisoned in the Moon: three permanent types in one enchant line.
    if (/^Enchant creature, land, or planeswalker$/i.test(sentence)) {
      result.enchant = "creature_land_or_planeswalker";
      if (!result.targetRequirements.some((requirement) => requirement.kind === "permanent")) {
        result.targetRequirements.push({
          kind: "permanent",
          requiredTypesAny: ["creature", "land", "planeswalker"],
        });
      }
      continue;
    }

    // Song of the Dryads: an Aura that takes anything at all.
    if (/^Enchant permanent$/i.test(sentence)) {
      result.enchant = "permanent";
      if (!result.targetRequirements.some((requirement) => requirement.kind === "permanent")) {
        result.targetRequirements.push({ kind: "permanent" });
      }
      continue;
    }

    // Mechanized Production: an Aura restricted to your own artifacts.
    if (/^Enchant artifact you control$/i.test(sentence)) {
      result.enchant = "artifact_own";
      if (!result.targetRequirements.some((requirement) => requirement.kind === "artifact")) {
        result.targetRequirements.push({ kind: "artifact", control: "own" });
      }
      continue;
    }

    /**
     * Imprisoned in the Moon and Song of the Dryads: the enchanted permanent
     * IS something else now. Layer 4 SETS the types (a creature that also
     * became a land would still attack), layer 5 sets the colours, and the
     * ability clause is read here rather than assumed — "loses all other
     * card types and abilities" and "is a colorless Forest land" are the
     * same sentence shape with different tails.
     */
    const becomes = sentence.match(
      /^Enchanted permanent is a colorless (?:(Plains|Island|Swamp|Mountain|Forest) )?land(?: with "\{T\}: Add \{C\}")?( and loses all other card types and abilities)?$/i,
    );
    if (becomes) {
      const abilities: StaticAbility[] = [
        {
          selector: { scope: "attached" },
          effect: {
            kind: "set_types",
            types: ["land"],
            ...(becomes[1] ? { subtypes: [becomes[1].toLowerCase()] } : {}),
          },
        },
        { selector: { scope: "attached" }, effect: { kind: "set_colors", colors: [] } },
      ];
      if (becomes[2]) {
        abilities.push({
          selector: { scope: "attached" },
          effect: { kind: "remove_all_abilities" },
        });
      }
      if (/with "\{T\}: Add \{C\}"/i.test(sentence)) {
        // Granted AFTER the removal, in the same layer: the printed
        // abilities go and this one stays, which is what the card says.
        abilities.push({
          selector: { scope: "attached" },
          effect: {
            kind: "grant_mana_ability",
            ability: {
              produces: { C: 1 },
              producesOptions: [],
              producesAnyColor: false,
              damageToController: 0,
            },
          },
        });
      }
      result.staticAbilities.push(...abilities);
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

    // Thriving lands: the same choice, minus the land's own colour.
    const excludedColor = sentence.match(
      /^As (?:~|it|this land|this Aura|this enchantment) enters, choose a color other than (white|blue|black|red|green)$/i,
    );
    if (excludedColor?.[1]) {
      result.chooseColorOnEnter = true;
      result.chooseColorExcludes = COLOR_WORDS[excludedColor[1].toLowerCase()]!;
      continue;
    }

    if (/^As (?:~|it|this land|this Aura|this enchantment) enters, choose a color$/i.test(sentence)) {
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

    // "Equipped/Enchanted creature gets …/has …" used to have three narrow
    // branches here. They are gone: the general static-grant grammar below
    // covers every shape they did and handles the Oxford comma they choked
    // on ("first strike, vigilance, trample, and haste" left "and haste").

    // Kenrith's Transformation: the rewrite with the removal leading.
    const elkMutation = sentence.match(
      /^Enchanted creature loses all abilities and is a (white|blue|black|red|green) ([A-Za-z]+) creature with base power and toughness (\d+)\/(\d+)$/i,
    );
    if (elkMutation?.[1] && elkMutation[2] && elkMutation[3] && elkMutation[4]) {
      result.staticAbilities.push(
        { selector: { scope: "attached" }, effect: { kind: "remove_all_abilities" } },
        {
          selector: { scope: "attached" },
          effect: { kind: "add_types", types: ["creature"], subtypes: [elkMutation[2].toLowerCase()] },
        },
        {
          selector: { scope: "attached" },
          effect: { kind: "set_colors", colors: [COLOR_WORDS[elkMutation[1].toLowerCase()]!] },
        },
        {
          selector: { scope: "attached" },
          effect: { kind: "set_pt", power: Number(elkMutation[3]), toughness: Number(elkMutation[4]) },
        },
      );
      continue;
    }

    // Drannith Magistrate.
    if (/^Your opponents can't cast spells from anywhere other than their hands$/i.test(sentence)) {
      result.opponentsCastOnlyFromHand = true;
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

    // Topiary Stomper: the restriction lifts once the board reaches a count,
    // which is a gate on the static rather than a second static.
    const gatedRestrict = sentence.match(
      /^~ can't (attack or block|attack|block) unless you control (\w+) or more (lands|creatures|artifacts)$/i,
    );
    if (gatedRestrict?.[1] && gatedRestrict[2] && gatedRestrict[3]) {
      const atLeast = parseCount(gatedRestrict[2]);
      if (atLeast) {
        const what = gatedRestrict[1].toLowerCase();
        result.staticAbilities.push({
          selector: { scope: "self" },
          effect: {
            kind: "restrict",
            ...(what.includes("attack") ? { cantAttack: true } : {}),
            ...(what === "attack or block" || what === "block" ? { cantBlock: true } : {}),
          },
          // The gate says when the restriction is GONE, so the static is
          // hung on its negation: a card cannot express "unless" directly.
          requiresControlledBelow: {
            types: [gatedRestrict[3].toLowerCase().replace(/s$/, "")],
            atLeast,
          },
        });
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

    // Cumulative upkeep (CR 702.24). The keyword is its own upkeep
    // trigger; only the mana form is read here, because the pay-a-cost
    // forms ("Cumulative upkeep—Sacrifice a creature") need a cost the
    // pay-or-sacrifice prompt cannot express.
    const cumulative = sentence.match(/^Cumulative upkeep\s*[—-]?\s*((?:\{[^}]+\})+)$/i);
    if (cumulative?.[1]) {
      result.triggers.push({
        event: "upkeep",
        effects: [
          { kind: "cumulative_upkeep", playerId: "controller", cost: cumulative[1] },
        ],
        targetRequirements: [],
      });
      continue;
    }

    // Chrome Mox: "Imprint — When ~ enters, you may exile a nonartifact,
    // nonland card from your hand." The ability word is flavour (CR
    // 207.2c); the exile is what matters, and it must be recorded ON the
    // source, since the mana ability reads the exiled card's colours.
    const imprintEtb = sentence.match(
      /^Imprint\s*[\u2014-]\s*When ~ enters, you may exile an? (nonartifact, nonland|noncreature, nonland) card from your hand$/i,
    );
    if (imprintEtb?.[1]) {
      const handFilter =
        imprintEtb[1].toLowerCase() === "nonartifact, nonland"
          ? ("nonartifact_nonland" as const)
          : ("noncreature_nonland" as const);
      result.triggers.push({
        event: "enter_battlefield",
        effects: [
          {
            kind: "choose_card",
            chooserId: "controller",
            sources: [{ playerId: "controller", zone: "hand", filter: handFilter }],
            thenEffects: [{ kind: "imprint", cardId: "chosen_card" }],
          },
        ],
        targetRequirements: [],
      });
      continue;
    }

    // Hideaway N (CR 702.75): "When this permanent enters, look at the
    // top N cards of your library, exile one face down, then put the rest
    // on the bottom in a random order." The exiled card is recorded ON
    // the source, because the ability that plays it later has no other
    // way to say WHICH exiled card is "the exiled card".
    const hideaway = sentence.match(/^Hideaway (\d+)$/i);
    if (hideaway?.[1]) {
      const look = Number(hideaway[1]);
      result.triggers.push({
        event: "enter_battlefield",
        effects: [
          {
            kind: "look_and_assign",
            playerId: "controller",
            count: look,
            destinations: [
              "exile" as const,
              ...Array.from({ length: look - 1 }, () => "library_bottom" as const),
            ],
            hideawayFromSource: true,
          },
        ],
        targetRequirements: [],
      });
      continue;
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
        /**
         * A loyalty ability's body can be more than one sentence, and the
         * rest of the PRINTED LINE belongs to the ability rather than to
         * the card. Without this, Elspeth's "Those creatures gain flying"
         * landed in `definition.effects` — where a PERMANENT never runs it
         * — and the card compiled with zero notes while doing half of what
         * it says. Same defect as the trigger riders in waves 317-319, one
         * layer over.
         */
        const effects = [...clause.effects];
        let requirements = clause.targetRequirements;
        for (
          let rider = index + 1;
          rider < sentences.length && !lineStart[rider] && sentences[rider];
          rider += 1
        ) {
          // Consumed the way every other rider here is consumed: blanked
          // in place, so the outer loop skips it.
          if (REGENERATION_DENIAL.test(sentences[rider]!)) {
            denyRegenerationInPlace(effects);
            sentences[rider] = "";
            continue;
          }
          const tail = compileSimpleClause(sentences[rider]!);
          // A rider needing its OWN targets alongside a body that already
          // has some cannot be expressed; leave it to fail honestly.
          if (
            !tail ||
            tail.leftover ||
            (tail.targetRequirements.length > 0 && requirements.length > 0)
          ) {
            break;
          }
          if (tail.targetRequirements.length > 0) {
            requirements = tail.targetRequirements;
          }
          effects.push(...tail.effects);
          sentences[rider] = "";
        }
        result.loyaltyAbilities = result.loyaltyAbilities ?? [];
        result.loyaltyAbilities.push({
          cost: Number(loyaltyAbility[1].replace("−", "-")),
          effects,
          targetRequirements: requirements,
        });
        continue;
      }
      result.leftover.push(sentence);
      continue;
    }

    if (/^Protection from /i.test(sentence)) {
      const printed = parseProtectionPhrase(sentence);
      if (printed) {
        result.protectionFrom = mergeProtection(result.protectionFrom ?? {}, printed);
        continue;
      }
      result.leftover.push(sentence);
      continue;
    }

    // Sylvan Library: a three-sentence run that is one triggered ability.
    // Parked as top-level effects on an enchantment, none of it would ever
    // run — so the run builds the trigger here rather than going through
    // commitClause.
    // Sagas: the chapter lines are one object, read as a run.
    const sagaRun = compileSagaChapters(sentences, index);
    if (sagaRun) {
      result.saga = { chapters: sagaRun.chapters };
      index += sagaRun.consumed - 1;
      continue;
    }

    // Braids: a three-sentence run that is one triggered ability.
    const braids = compileBraidsEndStep(sentences, index);
    if (braids) {
      result.triggers.push({
        event: "end_step",
        effects: braids.effects,
        targetRequirements: [],
      });
      index += braids.consumed - 1;
      continue;
    }

    const sylvan = compileSylvanDrawStep(sentences, index);
    if (sylvan) {
      result.triggers.push({
        event: "draw_step",
        effects: sylvan.effects,
        targetRequirements: [],
      });
      index += sylvan.consumed - 1;
      continue;
    }

    const tutorPair = compileTwoZoneTutorPair(sentences, index);
    if (tutorPair) {
      commitClause(result, tutorPair);
      index += tutorPair.consumed - 1;
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

    const grant = compileStaticGrant(sentence);
    if (grant) {
      result.staticAbilities.push(...grant);
      continue;
    }

    // Shalai: a compound subject in which one of the subjects is the
    // PLAYER. The permanent halves are ordinary static grants; the player
    // half is a definition flag, because a player is not a permanent and
    // has no computed characteristics to hang a keyword on.
    //
    // Hexproof only. Most keywords mean nothing on a player, and granting
    // one silently would be worse than leaving the line uncompiled.
    const playerAndPermanents = sentence.match(
      /^You, (.+?), and (.+?) have hexproof$/i,
    );
    if (playerAndPermanents?.[1] && playerAndPermanents[2]) {
      const halves = [playerAndPermanents[1], playerAndPermanents[2]].map((subject) =>
        compileStaticGrant(`${subject} have hexproof`),
      );
      if (halves.every((half) => half !== null)) {
        result.controllerHexproof = true;
        for (const half of halves) {
          result.staticAbilities.push(...half!);
        }
        continue;
      }
    }

    if (/^You have no maximum hand size$/i.test(sentence)) {
      result.noMaxHandSize = true;
      continue;
    }
    // "Your maximum hand size is twenty" (Twenty-Toed Toad) and "Each
    // opponent's maximum hand size is reduced by seven" (Jin-Gitaxias) —
    // one field, because they differ only in whose hand and which way.
    const handSizeSet = sentence.match(
      /^(Your|Each opponent's) maximum hand size is ([\w-]+)$/i,
    );
    if (handSizeSet?.[1] && handSizeSet[2]) {
      const amount = parseCount(handSizeSet[2]);
      if (amount !== null) {
        result.handSizeEffect = {
          scope: /^your$/i.test(handSizeSet[1]) ? "controller" : "opponents",
          mode: "set",
          amount,
        };
        continue;
      }
    }
    const handSizeReduced = sentence.match(
      /^(Your|Each opponent's) maximum hand size is reduced by ([\w-]+)$/i,
    );
    if (handSizeReduced?.[1] && handSizeReduced[2]) {
      const amount = parseCount(handSizeReduced[2]);
      if (amount !== null) {
        result.handSizeEffect = {
          scope: /^your$/i.test(handSizeReduced[1]) ? "controller" : "opponents",
          mode: "reduce",
          amount,
        };
        continue;
      }
    }

    // Narset, Parter of Veils.
    if (
      /^Each creature you control can block an additional creature each combat$/i.test(
        sentence,
      )
    ) {
      result.extraBlocksGranted = 1;
      continue;
    }
    const attackCap = sentence.match(
      /^No more than (one|two|three|\d+) creatures? can attack you each combat$/i,
    );
    if (attackCap?.[1]) {
      const cap = parseCount(attackCap[1]);
      if (cap) {
        result.attackLimitPerCombat = cap;
        continue;
      }
    }
    if (
      /^You can't lose the game and your opponents can't win the game$/i.test(sentence)
    ) {
      result.cantLoseGame = true;
      continue;
    }
    if (
      /^Creatures don't untap during their controllers' untap steps$/i.test(sentence)
    ) {
      result.creaturesDontUntap = true;
      continue;
    }
    const spellCap = sentence.match(
      /^Each player can't cast more than (one|two|three|\d+) noncreature spells? each turn$/i,
    );
    if (spellCap?.[1]) {
      const cap = parseCount(spellCap[1]);
      if (cap) {
        result.noncreatureSpellCap = cap;
        continue;
      }
    }
    const drawCap = sentence.match(
      /^Each opponent can't draw more than (one|two|three|\d+) cards? each turn$/i,
    );
    if (drawCap?.[1]) {
      const cap = parseCount(drawCap[1]);
      if (cap) {
        result.opponentsDrawCap = cap;
        continue;
      }
    }

    const damageRule = parseDamageReplacement(sentence);
    if (damageRule) {
      result.damageReplacement = damageRule;
      continue;
    }

    const alternative = parseAlternativeCastCost(sentence);
    if (alternative) {
      result.altCost = alternative;
      continue;
    }

    // Mana Reflection, Nyxbloom Ancient.
    const manaMultiplier = sentence.match(
      /^If you tap a permanent for mana, it produces (twice|three times) as much of that mana instead$/i,
    );
    if (manaMultiplier?.[1]) {
      result.manaTapMultiplier = /^twice$/i.test(manaMultiplier[1]) ? 2 : 3;
      continue;
    }

    // The denial is a rider on whatever this LINE destroyed, so it reaches
    // back only as far as the line's own output (CR 701.15d). Marking the
    // whole card would deny regeneration to an unrelated second ability.
    if (REGENERATION_DENIAL.test(sentence)) {
      denyRegenerationInPlace([
        ...result.effects.slice(lineEffectFloor),
        ...result.triggers.slice(lineTriggerFloor).flatMap((entry) => entry.effects),
        ...result.activated.slice(lineActivatedFloor).flatMap((entry) => entry.effects),
      ]);
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

    // Split second (CR 702.61).
    if (/^Split second$/i.test(sentence)) {
      result.splitSecond = true;
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
    // Multikicker (CR 702.32): kickable any number of times. Modelled as
    // {X} on the cast cost — one {X} per generic pip of the kicker cost —
    // so the announced X IS "how many times it was kicked". Refused when
    // the kicker cost has coloured pips, which an {X} cannot express.
    const multikicker = sentence.match(/^Multikicker ((?:\{[^}]+\})+)$/i);
    if (multikicker?.[1]) {
      try {
        const kick = parseManaCost(multikicker[1]);
        const colourless =
          (['W', 'U', 'B', 'R', 'G', 'C'] as const).every((pip) => kick[pip] === 0) &&
          kick.hybrid.length === 0 &&
          kick.xCount === 0 &&
          kick.generic > 0;
        if (colourless && !result.manaCostOverride) {
          result.manaCostOverride = `${card.manaCost}${"{X}".repeat(kick.generic)}`;
          continue;
        }
      } catch {
        // An unparseable kicker cost stays a miss.
      }
      result.leftover.push(sentence);
      continue;
    }
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
    // Everflowing Chalice: "a charge counter on it for each time it was
    // kicked". With multikicker modelled as {X}, "each time it was kicked"
    // IS the announced X, so this is the hydra shape with a different
    // counter — but only when multikicker actually rewrote the cost.
    const kickedCounters = sentence.match(
      /^~ enters with an? ([a-z][a-z-]*) counter on it for each time it was kicked$/i,
    );
    if (kickedCounters?.[1] && result.manaCostOverride) {
      result.entersWithXCounters = true;
      result.entersWithXCounterKind = counterKeyOf(kickedCounters[1]);
      continue;
    }
    // The fixed-count form: "enters with four +1/+1 counters on it", and
    // adamant's gated form, which is the same clause behind an `if`.
    const adamant = sentence.match(
      /^If (.+?) to cast this spell, (~ enters with .+? counters? on it)$/i,
    );
    const entersCounters = (adamant?.[2] ?? sentence).match(
      /^~ enters with (.+?) counters? on it$/i,
    );
    const enteringList = entersCounters?.[1] ? parseCounterList(entersCounters[1]) : null;
    const adamantGate = adamant?.[1] ? parseManaSpentGate(adamant[1]) : null;
    if (enteringList && enteringList.length === 1 && (!adamant || adamantGate)) {
      result.entersWithCounters = {
        counter: enteringList[0]!.counter,
        count: enteringList[0]!.amount,
        ...(adamantGate ? { ifManaSpent: adamantGate } : {}),
      };
      continue;
    }

    // Cursed Mirror: "As ~ enters, you may have it become a copy of any
    // creature on the battlefield until end of turn, except it has haste."
    // A SECOND pattern rather than a widened Clone one: the grammar is a
    // different sentence, and the two riders here are real rather than the
    // cosmetic ones parseCopyExceptRiders is allowed to drop.
    const becomeCopyOnEnter = sentence.match(
      /^As ~ enters, you may have it become a copy of (any creature on the battlefield|any nonland permanent on the battlefield|any artifact or creature on the battlefield)( until end of turn)?(?:, except it has haste)?$/i,
    );
    if (becomeCopyOnEnter?.[1]) {
      const scope = CLONE_SCOPE_BY_PHRASE[becomeCopyOnEnter[1].toLowerCase()];
      if (scope) {
        result.enterAsCopy = {
          scope,
          ...(becomeCopyOnEnter[2] ? { untilEot: true } : {}),
          ...(/except it has haste$/i.test(sentence) ? { grantHaste: true } : {}),
        };
        continue;
      }
    }

    // Clone family. The leading name is "~" for most cards but stays a short
    // legend name when oracle text uses it (Sakashima).
    const cloneEnter = sentence.match(
      /^You may have (?:~|[\w' -]+?) enter( tapped)?(?: the battlefield)? as a copy of (any creature on the battlefield|a creature you control|another creature you control|a creature or planeswalker you control|any nonland permanent on the battlefield|any artifact or creature on the battlefield|any artifact on the battlefield|any land on the battlefield|any equipment on the battlefield|any artifact or enchantment on the battlefield)( with mana value less than or equal to the amount of mana spent to cast ~)?(?:, except (.+))?$/i,
    );
    if (cloneEnter?.[2]) {
      const riders = cloneEnter[4] === undefined ? {} : parseCopyExceptRiders(cloneEnter[4]);
      const scope = CLONE_SCOPE_BY_PHRASE[cloneEnter[2].toLowerCase()];
      if (riders && scope) {
        result.enterAsCopy = {
          scope,
          ...(riders.extraCounters ? { extraCounters: riders.extraCounters } : {}),
          ...(cloneEnter[3] ? { maxManaValueBySpent: true } : {}),
          ...(cloneEnter[1] ? { entersTapped: true } : {}),
        };
        continue;
      }
    }

    // Birgi's second line. Boast (CR 702.142) is not implemented, so no
    // permanent in this engine can boast even once — raising the limit to
    // twice changes nothing that can happen. An ACCURATE no-op rather than
    // a swallowed ability, and it stops being one the day boast lands.
    if (
      /^Creatures you control can boast twice during each of your turns rather than once$/i.test(
        sentence,
      )
    ) {
      continue;
    }

    if (/^The "legend rule" doesn't apply to permanents you control$/i.test(sentence)) {
      // The engine never applies CR 704.5j, so Sakashima's exemption already
      // matches the table's behavior — an accurate no-op, not an approximation.
      continue;
    }

    // Panharmonicon / Yarok / Teysa Karlov / Drivnod / Isshin: cause-keyed
    // trigger doubling.
    // Ancient Greenwarden keys the same doubling on a LAND entering, and
    // is the one printing that ends "…an additional time INSTEAD". The
    // word changes nothing about the effect — it is a replacement either
    // way — so it is optional rather than a second pattern.
    const causeDoubling = sentence.match(
      /^If an? (artifact or creature|permanent|creature|land) (entering|dying|attacking) causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time(?: instead)?$/i,
    );
    if (causeDoubling?.[1] && causeDoubling[2]) {
      const cause = { entering: "enters", dying: "dies", attacking: "attacks" }[
        causeDoubling[2].toLowerCase()
      ] as "enters" | "dies" | "attacks";
      const what = causeDoubling[1].toLowerCase();
      result.triggerDoubling = {
        cause,
        ...(what === "artifact or creature"
          ? { causeTypesAny: ["artifact", "creature"] }
          : what === "permanent"
            ? {}
            : { causeTypesAny: [what] }),
      };
      continue;
    }

    // Veyran: the cause is a CAST rather than a permanent arriving. "Or
    // copying" is dropped — a copy is put on the stack, never cast, so this
    // engine has no cast event for it, and a doubler that fired on copies it
    // cannot see would be worse than one that honestly misses them.
    if (
      /^If you casting or copying an instant or sorcery spell causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time$/i.test(
        sentence,
      )
    ) {
      result.triggerDoubling = { cause: "casts", causeTypesAny: ["instant", "sorcery"] };
      continue;
    }

    // Delney: the restriction is on the ABILITY'S SOURCE, not on the cause.
    const smallSourceDoubling = sentence.match(
      /^If a triggered ability of a creature you control with power (\w+) or less triggers, (?:that ability|it) triggers an additional time$/i,
    );
    const smallPower = smallSourceDoubling?.[1] ? parseCount(smallSourceDoubling[1]) : null;
    if (smallPower !== null) {
      result.triggerDoubling = { source: { types: ["creature"], maxPower: smallPower } };
      continue;
    }

    // Roaming Throne: source-keyed doubling on the chosen type.
    if (
      /^If a triggered ability of another creature you control of the chosen type triggers, (?:that ability|it) triggers an additional time$/i.test(
        sentence,
      )
    ) {
      result.triggerDoubling = {
        source: { types: ["creature"], chosenSubtype: true, excludeSelf: true },
      };
      continue;
    }

    // Harmonic Prodigy: "a Shaman or another Wizard you control". The
    // excludeSelf covers both halves — a documented micro-approximation
    // (the source is never its own first-listed subtype in practice).
    const pairDoubling = sentence.match(
      /^If a triggered ability of an? ([A-Z][a-z]+) or another ([A-Z][a-z]+) you control triggers, (?:that ability|it) triggers an additional time$/,
    );
    if (pairDoubling?.[1] && pairDoubling[2]) {
      result.triggerDoubling = {
        source: {
          subtypesAny: [pairDoubling[1].toLowerCase(), pairDoubling[2].toLowerCase()],
          excludeSelf: true,
        },
      };
      continue;
    }

    // Teysa Karlov's second line: keyword grants limited to creature tokens.
    const tokenGrants = sentence.match(/^Creature tokens you control have ([a-z ]+)$/i);
    if (tokenGrants?.[1]) {
      const granted = tokenGrants[1]
        .split(/ and |, /i)
        .map((word) => KEYWORD_GRANTS[word.trim().toLowerCase()]);
      if (granted.every((keyword): keyword is Keyword => Boolean(keyword))) {
        for (const keyword of granted) {
          result.staticAbilities.push({
            selector: { scope: "controlled", types: ["creature"], tokenOnly: true },
            effect: { kind: "grant_keyword", keyword },
          });
        }
        continue;
      }
    }

    // Enduring cycle: the dead creature-enchantment comes back as a pure
    // enchantment. The "It's an enchantment." rider is part of this effect —
    // consumed here alongside the trigger.
    if (
      /^When ~ dies, if it was a creature, return it to the battlefield under its owner's control$/i.test(
        sentence,
      )
    ) {
      result.triggers.push({
        event: "dies",
        effects: [{ kind: "return_self_as_enchantment", cardId: "self" }],
        targetRequirements: [],
      });
      if (/^It's an enchantment$/i.test(sentences[index + 1] ?? "")) {
        sentences[index + 1] = "";
      }
      continue;
    }

    // Caged Sun / Heraldic Banner: chosen-color anthems.
    const chosenColorAnthem = sentence.match(
      /^Creatures you control of the chosen color get \+(\d+)\/\+(\d+)$/i,
    );
    if (chosenColorAnthem?.[1] && chosenColorAnthem[2]) {
      result.staticAbilities.push({
        selector: { scope: "controlled", types: ["creature"], chosenColor: true },
        effect: {
          kind: "modify_pt",
          power: Number(chosenColorAnthem[1]),
          toughness: Number(chosenColorAnthem[2]),
        },
      });
      continue;
    }

    // Caged Sun's mana half.
    if (
      /^Whenever a land's ability causes you to add one or more mana of the chosen color, add an additional one mana of that color$/i.test(
        sentence,
      )
    ) {
      result.landChosenColorBonus = true;
      continue;
    }

    // Mirari's Wake / Vorinclex: the controller's land taps echo one mana.
    if (
      /^Whenever you tap a land for mana, add one mana of any type that land produced$/i.test(
        sentence,
      )
    ) {
      result.landTapEcho = {};
      continue;
    }

    // Crypt Ghast: only Swamps echo, and they always add {B}.
    const subtypeEcho = sentence.match(
      /^Whenever you tap an? ([A-Z][a-z]+) for mana, add an additional \{([WUBRGC])\}$/,
    );
    if (subtypeEcho?.[1] && subtypeEcho[2]) {
      result.landTapEcho = {
        subtype: singularSubtype(`${subtypeEcho[1]}s`),
        addColor: subtypeEcho[2] as ManaColor,
      };
      continue;
    }

    // Forsaken Monument: any permanent, but only when it made colorless.
    const producedEcho = sentence.match(
      /^Whenever you tap a permanent for \{([WUBRGC])\}, add an additional \{([WUBRGC])\}$/,
    );
    if (producedEcho?.[1] && producedEcho[2]) {
      result.landTapEcho = {
        anyPermanent: true,
        requiresProduced: producedEcho[1] as ManaColor,
        addColor: producedEcho[2] as ManaColor,
      };
      continue;
    }

    // Vorinclex's other half: opponents' tapped lands stay frozen.
    if (
      /^Whenever an opponent taps a land for mana, that land doesn't untap during its controller's next untap step$/i.test(
        sentence,
      )
    ) {
      result.opponentLandTapsSkipUntap = true;
      continue;
    }

    // Elenda: dies-tokens equal to the dying creature's power.
    const elenda = sentence.match(
      /^When ~ dies, create X (\d+)\/(\d+) (white|blue|black|red|green|colorless) ([A-Z][a-z]+) creature tokens with ([a-z]+), where X is (?:its|~'s) power$/i,
    );
    if (elenda?.[1] && elenda[2] && elenda[4] && elenda[5]) {
      const keyword = KEYWORD_GRANTS[elenda[5].toLowerCase()];
      if (keyword) {
        const subtype = elenda[4][0]!.toUpperCase() + elenda[4].slice(1).toLowerCase();
        result.triggers.push({
          event: "dies",
          effects: [
            {
              kind: "create_token",
              ownerId: "controller",
              name: subtype,
              typeLine: `Creature — ${subtype} Token`,
              power: Number(elenda[1]),
              toughness: Number(elenda[2]),
              keywords: [keyword],
              countFromSubjectAmount: true,
            },
          ],
          targetRequirements: [],
        });
        continue;
      }
    }

    // The self-discount artifacts and Henges.
    const selfDiscount = sentence.match(
      /^This spell costs \{X\} less to cast, where X is the (total mana value of noncreature artifacts you control|total mana value of historic permanents you control|greatest power among creatures you control|total power of creatures you control)$/i,
    );
    if (selfDiscount?.[1]) {
      const phrase = selfDiscount[1].toLowerCase();
      result.selfDiscount = {
        per: phrase.startsWith("total mana value of noncreature")
          ? "noncreature_artifacts_total_mv"
          : phrase.startsWith("total mana value of historic")
            ? "historic_total_mv"
            : phrase.startsWith("total power")
              ? "total_creature_power"
              : "greatest_creature_power",
      };
      continue;
    }

    // Embercleave: the same self-discount, counted rather than aggregated.
    const perDiscount = sentence.match(
      /^This spell costs \{(\d+)\} less to cast for each (.+)$/i,
    );
    if (perDiscount?.[1] && perDiscount[2]) {
      const count = parseDynamicCount(perDiscount[2]);
      if (count) {
        result.selfDiscount = {
          perDynamicCount: { generic: Number(perDiscount[1]), count },
        };
        continue;
      }
    }

    // Excalibur: equip restricted to legendary creatures.
    const commanderEquip = sentence.match(/^Equip commander \{?(\d+)\}?$/i);
    if (commanderEquip?.[1]) {
      result.activated.push({
        tap: false,
        manaCost: `{${commanderEquip[1]}}`,
        effects: [{ kind: "attach", cardId: "self", toId: { type: "chosen", index: 0 } }],
        targetRequirements: [{ kind: "own_creature", commanderOnly: true }],
        timing: "sorcery",
      });
      continue;
    }

    const restrictedEquip = sentence.match(/^Equip legendary creature \{?(\d+)\}?$/i);
    if (restrictedEquip?.[1]) {
      result.activated.push({
        tap: false,
        manaCost: `{${restrictedEquip[1]}}`,
        effects: [{ kind: "attach", cardId: "self", toId: { type: "chosen", index: 0 } }],
        targetRequirements: [{ kind: "own_creature", legendaryOnly: true }],
        timing: "sorcery",
      });
      continue;
    }

    // Transmute (CR 702.53): a hand activation — discard this card, tutor a
    // card with the same mana value. The sorcery-timing restriction is not
    // enforced (documented approximation).
    const transmute = sentence.match(/^Transmute (\{.+\})$/i);
    if (transmute?.[1]) {
      result.activated.push({
        tap: false,
        manaCost: transmute[1],
        zone: "hand",
        discard: true,
        effects: [
          {
            kind: "search_library",
            playerId: "controller",
            filter: { exactManaValue: manaValueOf(card.manaCost) },
            destination: "hand",
            count: 1,
          },
        ],
        targetRequirements: [],
      });
      continue;
    }

    // Living weapon (CR 702.92) lowers to its full rules text.
    if (/^Living weapon$/i.test(sentence)) {
      result.triggers.push({
        event: "enter_battlefield",
        effects: [{ kind: "germ_attach", cardId: "self" }],
        targetRequirements: [],
      });
      continue;
    }

    // Rebound (CR 702.87).
    if (/^Rebound$/i.test(sentence)) {
      result.rebound = true;
      continue;
    }

    // Nettlecyst and All That Glitters used to need a branch here. They no
    // longer do: the general static-grant grammar above reads their counted
    // noun from the shared table, so this shape is one row, not a case.

    // Dethrone (CR 702.104) lowers to its full rules text.
    if (/^Dethrone$/i.test(sentence)) {
      result.triggers.push({
        event: "attacks",
        condition: { kind: "attacking_most_life" },
        effects: [{ kind: "add_counter", cardId: "self", counter: "p1p1", amount: 1 }],
        targetRequirements: [],
      });
      continue;
    }

    // Dragon's Rage Channeler. The "attacks each combat if able" half is
    // dropped — a documented approximation (the drawback is unrepresentable
    // as a gated static today).
    const delirium = sentence.match(
      /^As long as there are four or more card types among cards in your graveyard, ~ gets \+(\d+)\/\+(\d+), has ([a-z]+), and attacks each combat if able$/i,
    );
    if (delirium?.[1] && delirium[2] && delirium[3]) {
      const granted = KEYWORD_GRANTS[delirium[3].toLowerCase()];
      if (granted) {
        result.staticAbilities.push(
          {
            selector: { scope: "self" },
            effect: {
              kind: "modify_pt",
              power: Number(delirium[1]),
              toughness: Number(delirium[2]),
            },
            requiresDelirium: true,
          },
          {
            selector: { scope: "self" },
            effect: { kind: "grant_keyword", keyword: granted },
            requiresDelirium: true,
          },
        );
        continue;
      }
    }

    // Evolve (CR 702.100) lowers to its full rules text.
    if (/^Evolve$/i.test(sentence)) {
      result.triggers.push({
        event: "enter_battlefield",
        watch: "controlled",
        excludeSelf: true,
        subjectFilter: { types: ["creature"], greaterPtThanWatcher: true },
        effects: [{ kind: "add_counter", cardId: "self", counter: "p1p1", amount: 1 }],
        targetRequirements: [],
      });
      continue;
    }

    // Prowess (CR 702.108) lowers to its full rules text.
    if (/^Prowess$/i.test(sentence)) {
      result.triggers.push({
        event: "cast_spell",
        watch: "controlled",
        subjectFilter: { nonTypes: ["creature"] },
        effects: [{ kind: "pt_until_eot", cardId: "self", power: 1, toughness: 1 }],
        targetRequirements: [],
      });
      continue;
    }

    if (/^You may play lands from your graveyard$/i.test(sentence)) {
      result.playLandsFromGraveyard = true;
      continue;
    }

    // Adeline: her POWER counts creatures while her toughness stays the
    // printed 4. A second pattern rather than a widened one — the
    // "power and toughness are each" form below means something different.
    const starPower = sentence.match(/^~'s power is equal to the number of (.+)$/i);
    const starPowerCount = starPower?.[1] ? parseDynamicCount(starPower[1]) : null;
    if (starPowerCount) {
      result.dynamicPt = { count: starPowerCount, powerOnly: true };
      continue;
    }

    const starPt = sentence.match(
      /^~'s power and toughness are each equal to the number of (.+)$/i,
    );
    const starCount = starPt?.[1] ? parseDynamicCount(starPt[1]) : null;
    if (starCount) {
      result.dynamicPt = { count: starCount };
      continue;
    }

    // Storm-Kiln Artist, Faeburrow Elder, Kor Spiritdancer: an asymmetric
    // per-count self-buff over whatever the shared count table admits.
    const bonusPt = sentence.match(/^~ gets \+(\d+)\/\+(\d+) for each (.+)$/i);
    const bonusCount = bonusPt?.[3] ? parseDynamicCount(bonusPt[3]) : null;
    if (bonusPt?.[1] && bonusPt[2] && bonusCount) {
      result.bonusPt = {
        power: Number(bonusPt[1]),
        toughness: Number(bonusPt[2]),
        per: bonusCount,
      };
      continue;
    }

    const addCost = sentence.match(/^As an additional cost to cast this spell, (.+)$/i);
    if (addCost?.[1]) {
      const what = addCost[1].trim().toLowerCase();
      // "sacrifice an artifact or discard a card": two whole costs, one of
      // which is paid. Split before the single-cost table below, and only
      // when BOTH halves are themselves understood.
      const either = what.match(
        /^((?:sacrifice|discard|pay) .+?) or ((?:sacrifice|discard|pay) .+)$/,
      );
      if (either?.[1] && either[2]) {
        const branches = [parseSingleAdditionalCost(either[1]), parseSingleAdditionalCost(either[2])];
        if (branches.every((branch): branch is AdditionalCastCost => branch !== null)) {
          result.additionalCost = {
            ...(result.additionalCost ?? {}),
            alternatives: branches,
          };
          continue;
        }
      }
      const single = parseSingleAdditionalCost(what);
      if (single) {
        result.additionalCost = { ...(result.additionalCost ?? {}), ...single };
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

    // Metallic Mimic / Adaptive Automaton: the entry choice becomes one of
    // the card's own computed subtypes.
    if (/^~ is the chosen type in addition to its other types$/i.test(sentence)) {
      result.selfIsChosenType = true;
      continue;
    }

    // Metallic Mimic. "enters with" is a replacement (CR 614.1c); the counter
    // arrives via an ETB watch instead — a documented approximation.
    if (
      /^Each other creature you control of the chosen type enters with an additional \+1\/\+1 counter on it$/i.test(
        sentence,
      )
    ) {
      result.triggers.push({
        event: "enter_battlefield",
        watch: "controlled",
        excludeSelf: true,
        subjectFilter: { types: ["creature"], chosenSubtype: true },
        effects: [{ kind: "add_counter", cardId: "subject_card", counter: "p1p1", amount: 1 }],
        targetRequirements: [],
      });
      continue;
    }

    const chosenAnthem = sentence.match(
      /^(Other )?[Cc]reatures you control of the chosen type get \+(\d+)\/\+(\d+)$/i,
    );
    if (chosenAnthem?.[2] && chosenAnthem[3]) {
      result.staticAbilities.push({
        selector: {
          scope: "controlled",
          types: ["creature"],
          chosenSubtype: true,
          ...(chosenAnthem[1] ? { excludeSelf: true } : {}),
        },
        effect: {
          kind: "modify_pt",
          power: Number(chosenAnthem[2]),
          toughness: Number(chosenAnthem[3]),
        },
      });
      continue;
    }

    // Rites of Flourishing: the same grant, given to the whole table.
    const extraLandsForAll = sentence.match(
      /^Each player may play (an|one|two|three) additional lands? on each of their turns$/i,
    );
    if (extraLandsForAll?.[1]) {
      const count =
        extraLandsForAll[1].toLowerCase() === "an" ? 1 : (parseCount(extraLandsForAll[1]) ?? 1);
      result.extraLandDropsForAll = (result.extraLandDropsForAll ?? 0) + count;
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

    /**
     * Chimil, Rhythm of the Wild and Destiny Spinner in one clause: the
     * three wordings differ only in which card types they name, so the
     * types are read out rather than each wording getting a flag.
     */
    const shield = sentence.match(
      /^(?:(Creature|Enchantment|Artifact|Instant|Sorcery)(?: and (Creature|Enchantment|Artifact|Instant|Sorcery))? s|S)pells you control can't be countered$/i,
    );
    if (shield) {
      const types = [shield[1], shield[2]]
        .filter((type): type is string => Boolean(type))
        .map((type) => type.toLowerCase());
      result.spellsCantBeCountered = types.length > 0 ? { types } : {};
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

    // Razorkin Needlehead: "~ has first strike DURING YOUR TURN". A static
    // gated on the turn, not a keyword the permanent simply has — it loses
    // first strike the moment the turn passes, which is the whole card.
    const turnKeyword = sentence.match(/^~ has ([a-z ]+) during your turn$/i);
    const turnGranted = turnKeyword?.[1]
      ? KEYWORD_GRANTS[turnKeyword[1].trim().toLowerCase()]
      : undefined;
    if (turnGranted) {
      result.staticAbilities.push({
        selector: { scope: "self" },
        effect: { kind: "grant_keyword", keyword: turnGranted },
        requiresYourTurn: true,
      });
      continue;
    }

    // Toski.
    if (/^~ attacks each combat if able$/i.test(sentence)) {
      result.mustAttack = true;
      continue;
    }

    // Champion of Lambholt: the threshold is the source's OWN power, read
    // live — the creature grows and the wall of legal blockers shrinks with
    // it. Neither "can't block" nor "can't be blocked" says this alone.
    if (
      /^Creatures with power less than ~'s power can't block creatures you control$/i.test(
        sentence,
      )
    ) {
      result.blockPowerGate = { blockerBelowSourcePower: true };
      continue;
    }

    // Delney: the mirror, with both halves printed as fixed numbers.
    const delney = sentence.match(
      /^Creatures you control with power (\w+) or less can't be blocked by creatures with power (\w+) or greater$/i,
    );
    const attackerMax = delney?.[1] ? parseCount(delney[1]) : null;
    const blockerMin = delney?.[2] ? parseCount(delney[2]) : null;
    if (attackerMax !== null && blockerMin !== null) {
      result.blockPowerGate = { attackerMaxPower: attackerMax, blockerMinPower: blockerMin };
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

    // "Flashback {2}{R}" / "Flashback—{1}{U}, Pay 3 life."
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
    /**
     * Harmonize (CR 702.184) — Nature's Rhythm. Two keywords this engine
     * already has, welded together: cast it from your GRAVEYARD for this
     * cost (flashback, exile rider and all) and tap creatures to help pay
     * (convoke). The convoke half is flagged separately because it belongs
     * to the graveyard cast alone — setting `convoke` outright would make
     * the printed hand cast cheaper than the card says.
     */
    const harmonize = sentence.match(/^Harmonize\s*[—–-]?\s*((?:\{[^}]+\})+)$/i);
    if (harmonize?.[1]) {
      result.flashback = { manaCost: harmonize[1] };
      result.harmonizeConvoke = true;
      continue;
    }

    // Dread Return: "Flashback—Sacrifice three creatures." The whole cost is
    // the sacrifice, so there is no mana half at all.
    const sacrificeFlashback = sentence.match(
      /^Flashback\s*[—–-]\s*Sacrifice ([a-z]+) creatures?$/i,
    );
    const flashbackFodder = sacrificeFlashback?.[1]
      ? parseCount(sacrificeFlashback[1])
      : null;
    if (flashbackFodder) {
      result.flashback = { manaCost: "", sacrificeCreatures: flashbackFodder };
      continue;
    }

    // Evoke (CR 702.74). The sacrifice half is machinery, not a compiled
    // trigger: it has to survive onto the permanent the spell becomes.
    const evoke = sentence.match(/^Evoke\s*[—–-]?\s*((?:\{[^}]+\})+)$/i);
    if (evoke?.[1]) {
      result.evoke = { manaCost: evoke[1] };
      continue;
    }

    // Echo (CR 702.29). Compiled down onto the upkeep trigger it already
    // is, the way cumulative upkeep is — only the mana form, because
    // "Echo—Sacrifice a creature" needs a cost the prompt cannot express.
    // `result.echo` still rides along: arming the debt on entry is what
    // makes "since your last upkeep" answerable.
    const echo = sentence.match(/^Echo\s*[—–-]?\s*((?:\{[^}]+\})+)$/i);
    if (echo?.[1]) {
      result.echo = { manaCost: echo[1] };
      result.triggers.push({
        event: "upkeep",
        effects: [{ kind: "echo", playerId: "controller", cost: echo[1] }],
        targetRequirements: [],
      });
      continue;
    }

    // Escalate (CR 702.120).
    const escalate = sentence.match(/^Escalate\s*[—–-]?\s*((?:\{[^}]+\})+)$/i);
    if (escalate?.[1]) {
      result.escalate = escalate[1];
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

    // Theros gods: the devotion type gate.
    const devotionGate = sentence.match(
      /^As long as your devotion to (white|blue|black|red|green) is less than (\w+), ~ isn't a creature$/i,
    );
    if (devotionGate?.[1] && devotionGate[2]) {
      const threshold = parseCount(devotionGate[2]);
      const color = COLOR_WORDS[devotionGate[1].toLowerCase()];
      if (threshold && color) {
        result.notCreatureBelowDevotion = { color, threshold };
        continue;
      }
    }

    /**
     * Terror of the Peaks: "Spells your opponents cast that target ~ cost
     * an additional N life to cast." A cost increase, not a ward trigger:
     * it is paid as the spell is cast and there is nothing to decline.
     */
    const targetTax = sentence.match(
      /^Spells your opponents cast that target ~ cost an additional (\d+) life to cast$/i,
    );
    if (targetTax?.[1]) {
      result.targetingLifeTax = Number(targetTax[1]);
      continue;
    }

    /**
     * K'rrik, Son of Yawgmoth: "For each {B} in a cost, you may pay 2 life
     * rather than pay that mana." That is Phyrexian mana (CR 107.4f) for
     * every pip of the colour, so it becomes a grant the cost path already
     * knows how to honour.
     */
    const payLife = sentence.match(
      /^For each \{([WUBRG])\} in a cost, you may pay 2 life rather than pay that mana$/,
    );
    if (payLife?.[1]) {
      result.payLifeForColor = payLife[1] as Color;
      continue;
    }

    // Elesh Norn, Mother of Machines: the suppressing half of the pair.
    if (
      /^Permanents entering don't cause abilities of permanents your opponents control to trigger$/i.test(
        sentence,
      )
    ) {
      result.opponentsEnterTriggersSuppressed = true;
      continue;
    }

    // Spelunking: the mirror of the enters-tapped statics — it cancels one
    // rather than adding one.
    if (/^Lands you control enter untapped$/i.test(sentence)) {
      result.landsEnterUntapped = true;
      continue;
    }

    /**
     * Totem armor (CR 702.87), printed as "Umbra armor" on the Bear Umbra
     * cycle's newer wordings and reminded as the full sentence on the
     * older ones. Both spellings, and the reminder text, name the same
     * ability — so all three land on the same flag rather than the
     * reminder falling through as uncompiled text.
     */
    if (
      /^(?:Totem|Umbra) armor$/i.test(sentence) ||
      /^If enchanted (?:creature|permanent) would be destroyed, instead remove all damage from it and destroy (?:this Aura|~)$/i.test(
        sentence,
      )
    ) {
      result.totemArmor = true;
      continue;
    }

    // Bender's Waterskin: the one-permanent form of the same static.
    if (/^Untap ~ during each other player's untap step$/i.test(sentence)) {
      result.untapDuringEachUntap = "self";
      continue;
    }

    // Thousand-Year Elixir. ABILITIES only — compiling this as a haste grant
    // would also let a summoning-sick creature attack, which is a different
    // and much better card.
    if (
      /^You may activate abilities of creatures you control as though those creatures had haste$/i.test(
        sentence,
      )
    ) {
      result.abilityHaste = true;
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

    // Authority of the Consuls, and Thalia's creatures-and-lands variant.
    const enterTapped = sentence.match(
      /^Creatures( and nonbasic lands)? your opponents control enter (?:the battlefield )?tapped$/i,
    );
    if (enterTapped) {
      result.opponentCreaturesEnterTapped = true;
      if (enterTapped[1]) {
        result.opponentNonbasicLandsEnterTapped = true;
      }
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

    // Convoke / improvise / delve: a bare keyword line, and the granted forms
    // ("Creature spells you cast have convoke").
    const costKeyword = sentence.match(/^(Convoke|Improvise|Delve)$/i);
    if (costKeyword?.[1]) {
      const keyword = costKeyword[1].toLowerCase() as "convoke" | "improvise" | "delve";
      result[keyword] = true;
      continue;
    }
    const grantedCost = sentence.match(
      /^(Creature|Artifact|Nonartifact|Noncreature|Enchantment)? ?spells you cast have (convoke|improvise)$/i,
    );
    if (grantedCost?.[2]) {
      const scope = grantedCost[1]?.toLowerCase();
      const type = scope?.replace(/^non/, "");
      result.grantsCostKeyword = {
        keyword: grantedCost[2].toLowerCase() as "convoke" | "improvise",
        ...(type === undefined
          ? {}
          : scope!.startsWith("non")
            ? { nonTypes: [type] }
            : { types: [type] }),
      };
      continue;
    }

    if (/^You may cast spells as though they had flash$/i.test(sentence)) {
      result.grantsFlash = true;
      continue;
    }
    // Sigarda's Aid, Shimmer Myr: the same grant narrowed to some spells.
    const narrowFlash = sentence.match(
      /^You may cast ([A-Za-z ]+?) spells as though they had flash$/i,
    );
    if (narrowFlash?.[1]) {
      const words = narrowFlash[1].split(/,\s*(?:and\s+)?|\s+and\s+/).map((word) => word.trim());
      const types = words.filter((word) => SPELL_CARD_TYPES.has(word.toLowerCase()));
      const subtypes = words.filter((word) => /^[A-Z][a-z]+$/.test(word));
      if (types.length + subtypes.length === words.length && words.length > 0) {
        result.grantsFlashFor = {
          ...(types.length > 0 ? { types: types.map((word) => word.toLowerCase()) } : {}),
          ...(subtypes.length > 0
            ? { subtypesAny: subtypes.map((word) => word.toLowerCase()) }
            : {}),
        };
        continue;
      }
    }

    // Omniscience: an uncapped, unlimited free-cast permission.
    if (
      /^You may cast spells from your hand without paying their mana costs$/i.test(sentence)
    ) {
      result.castFreeFromHand = {};
      continue;
    }

    // As Foretold: once each turn, capped by the counters it has accrued.
    const foretold = sentence.match(
      /^Once each turn, you may pay \{0\} rather than pay the mana cost for a spell you cast with mana value X or less, where X is the number of ([a-z]+) counters on ~$/i,
    );
    if (foretold?.[1]) {
      result.castFreeFromHand = {
        capFromCounter: foretold[1].toLowerCase(),
        oncePerTurn: true,
      };
      continue;
    }

    // Gemstone Caverns, once the fuser has joined the offer to its price.
    const openingStart = sentence.match(
      /^Begin the game with ~ on the battlefield with an? ([a-z]+) counter, exiling (a|an|one|two|\d+) cards? from your hand$/i,
    );
    if (openingStart?.[1] && openingStart[2]) {
      const exileFromHand = parseCount(openingStart[2]);
      if (exileFromHand) {
        result.openingHandStart = {
          counter: counterKeyOf(openingStart[1]),
          exileFromHand,
        };
        continue;
      }
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
      ) ||
      // Rites of Flourishing prints the same rule as one sentence.
      /^Each player draws an additional card during their draw step$/i.test(sentence)
    ) {
      result.extraDrawStepDraws = true;
      continue;
    }

    // Modular N (CR 702.43): enters with N +1/+1 counters, and on death moves
    // them to an artifact creature. Both halves already existed separately —
    // the enter-counters field and the counter-move effect.
    const modular = sentence.match(/^Modular (\d+)$/i);
    if (modular?.[1]) {
      const count = Number(modular[1]);
      if (count > 0) {
        result.entersWithCounters = { counter: "p1p1", count };
        result.triggers.push({
          event: "dies",
          effects: [
            { kind: "move_all_counters", cardId: "self", target: { type: "chosen", index: 0 } },
          ],
          targetRequirements: [{ kind: "creature_or_artifact" }],
        });
        continue;
      }
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

    /**
     * Augur of Autumn's second half carries a COVEN gate on the front. The
     * grant is otherwise identical, so the gate is read here rather than
     * given a clause of its own.
     */
    const topCast = sentence.match(
      /^(As long as you control three or more creatures with different powers, y|Y)ou may cast (artifact|creature|enchantment|instant|sorcery) spells from the top of your library$/i,
    );
    if (topCast?.[2]) {
      const prior = result.topOfLibrary ?? {};
      result.topOfLibrary = {
        ...prior,
        castTypesAny: [...new Set([...(prior.castTypesAny ?? []), topCast[2].toLowerCase()])],
        ...(/^As long as/i.test(topCast[1] ?? "") ? { castRequiresCoven: true } : {}),
      };
      continue;
    }

    // Mystic Forge: artifact spells plus anything colorless.
    if (/^You may cast artifact spells and colorless spells from the top of your library$/i.test(sentence)) {
      const prior = result.topOfLibrary ?? {};
      result.topOfLibrary = {
        ...prior,
        castTypesAny: [...new Set([...(prior.castTypesAny ?? []), "artifact"])],
        castColorless: true,
      };
      continue;
    }

    // Realmwalker: creature spells of the card's own chosen type.
    if (/^You may cast creature spells of the chosen type from the top of your library$/i.test(sentence)) {
      result.topOfLibrary = { ...(result.topOfLibrary ?? {}), castChosenType: true };
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

    // Cloud Key: the card-type choice (auto-picked, documented).
    if (/^As ~ enters, choose artifact, creature, enchantment, instant, or sorcery$/i.test(sentence)) {
      result.chooseCardTypeOnEnter = true;
      continue;
    }
    if (/^Spells you cast of the chosen type cost \{(\d+)\} less to cast$/i.test(sentence)) {
      const amount = Number(sentence.match(/\{(\d+)\}/)?.[1] ?? 1);
      result.costReductions = [
        ...(result.costReductions ?? []),
        { generic: amount, filter: { chosenCardType: true } },
      ];
      continue;
    }

    // Goreclaw: the discount takes a printed-power floor.
    const bigDiscount = sentence.match(
      /^Creature spells you cast with power (\d+) or greater cost \{(\d+)\} less to cast$/i,
    );
    if (bigDiscount?.[1] && bigDiscount[2]) {
      result.costReductions = [
        ...(result.costReductions ?? []),
        {
          generic: Number(bigDiscount[2]),
          filter: { types: ["creature"], minPower: Number(bigDiscount[1]) },
        },
      ];
      continue;
    }

    // Banner of Kinship: the enter counters land once the type is chosen.
    const kinshipEnter = sentence.match(
      /^~ enters with an? ([a-z]+) counter on it for each creature you control of the chosen type$/i,
    );
    if (kinshipEnter?.[1]) {
      result.enterCountersPerChosenType = kinshipEnter[1].toLowerCase();
      continue;
    }
    const kinshipPump = sentence.match(
      /^Creatures you control of the chosen type get \+(\d+)\/\+(\d+) for each ([a-z]+) counter on ~$/i,
    );
    if (kinshipPump?.[1] && kinshipPump[2] && kinshipPump[3]) {
      result.staticAbilities.push({
        selector: { scope: "controlled", types: ["creature"], chosenSubtype: true },
        effect: {
          kind: "modify_pt",
          power: Number(kinshipPump[1]),
          toughness: Number(kinshipPump[2]),
          perSourceCounter: kinshipPump[3].toLowerCase(),
        },
      });
      continue;
    }

    // Forgotten Ancient's upkeep redistribution: the "may" is auto-declined
    // (counters stay put) — a documented approximation.
    if (
      /^At the beginning of your upkeep, you may move any number of \+1\/\+1 counters from ~ onto other creatures$/i.test(
        sentence,
      )
    ) {
      continue;
    }

    // The Ozolith: only +1/+1 counters transfer — a documented approximation.
    if (
      /^Whenever a creature you control leaves the battlefield, if it had counters on it, put those counters on ~$/i.test(
        sentence,
      )
    ) {
      result.triggers.push({
        event: "leaves_battlefield",
        watch: "controlled",
        subjectFilter: { types: ["creature"] },
        effects: [{ kind: "add_counter", cardId: "self", counter: "p1p1", amount: "subject_amount" }],
      });
      continue;
    }

    // Puresteel Paladin's metalcraft equip grant.
    if (
      /^(?:Metalcraft\s*[—-]\s*)?Equipment you control have equip \{0\} as long as you control three or more artifacts$/i.test(
        sentence,
      )
    ) {
      result.freeEquipIfArtifacts = 3;
      continue;
    }

    // Howling Mine: the untapped gate is honored for the whole extra-draw
    // class at the draw step.
    if (
      /^At the beginning of each player's draw step, if ~ is untapped, that player draws an additional card$/i.test(
        sentence,
      )
    ) {
      result.extraDrawStepDraws = true;
      continue;
    }

    // Necropotence's first line.
    if (/^Skip your draw step$/i.test(sentence)) {
      result.replacements.push({ kind: "replace_draw", instead: "skip" });
      continue;
    }

    // Bolt Bend: the conditional discount compiles to a proxy — {3} less
    // while an opponent has a spell or ability on the stack (documented).
    if (
      /^This spell costs \{3\} less to cast if it targets a spell or ability an opponent controls$/i.test(
        sentence,
      )
    ) {
      result.selfDiscount = { per: "opponent_stack_3" };
      continue;
    }

    // "This spell costs {3} less to cast if <condition>" (Bolt Bend) — the
    // discount is a self cost-reduction gated by the shared condition
    // vocabulary, so it needs no shape of its own.
    const conditionalDiscount = sentence.match(
      /^This spell costs \{(\d+)\} less to cast if (.+)$/i,
    );
    if (conditionalDiscount?.[1] && conditionalDiscount[2]) {
      const discountCondition = parseEffectCondition(conditionalDiscount[2]);
      if (discountCondition) {
        result.costReductions = [
          ...(result.costReductions ?? []),
          {
            generic: Number(conditionalDiscount[1]),
            filter: {},
            condition: discountCondition,
          },
        ];
        continue;
      }
    }

    // Tribute to the World Tree: the conditional branch compiles to two
    // complementary-filter triggers over computed power.
    const tribute = sentence.match(
      /^Whenever a creature you control enters, draw a card if its power is (\d+) or greater$/i,
    );
    if (
      tribute?.[1] &&
      /^Otherwise, put two \+1\/\+1 counters on it$/i.test(sentences[index + 1] ?? "")
    ) {
      const threshold = Number(tribute[1]);
      result.triggers.push(
        {
          event: "enter_battlefield",
          watch: "controlled",
          subjectFilter: { types: ["creature"], minPower: threshold },
          effects: [{ kind: "draw", playerId: "controller", count: 1 }],
        },
        {
          event: "enter_battlefield",
          watch: "controlled",
          subjectFilter: { types: ["creature"], maxPower: threshold - 1 },
          effects: [{ kind: "add_counter", cardId: "subject_card", counter: "p1p1", amount: 2 }],
        },
      );
      sentences[index + 1] = "";
      continue;
    }

    // Curse of the Swine: variable exile with per-controller pig tokens.
    // The X cap on target count is dropped — "any number", documented.
    const swine = /^Exile X target creatures$/i.test(sentence);
    const swineRider = (sentences[index + 1] ?? "").match(
      /^For each creature exiled this way, its controller creates a (\d+)\/(\d+) (white|blue|black|red|green) ([A-Za-z]+) creature token$/i,
    );
    if (swine && swineRider?.[1] && swineRider[2] && swineRider[4]) {
      const subtype = swineRider[4].replace(/\b\w/g, (letter) => letter.toUpperCase());
      result.targetRequirements.push({ kind: "creature", variable: true });
      result.effects.push({
        kind: "exile_targets_into_tokens",
        token: {
          name: subtype,
          typeLine: `Creature — ${subtype} Token`,
          power: Number(swineRider[1]),
          toughness: Number(swineRider[2]),
        },
      });
      sentences[index + 1] = "";
      continue;
    }

    // Victimize: two graveyard picks and a tapped mass return. The real
    // card sacrifices on resolution; here the sacrifice is a cast-time
    // additional cost (Fling's pattern) — a documented approximation.
    if (
      /^Choose two target creature cards in your graveyard$/i.test(sentence) &&
      /^Sacrifice a creature$/i.test(sentences[index + 1] ?? "") &&
      /^If you do, return the chosen cards to the battlefield tapped$/i.test(
        sentences[index + 2] ?? "",
      )
    ) {
      result.additionalCost = { ...(result.additionalCost ?? {}), sacrifice: "creature" };
      result.targetRequirements.push(
        { kind: "own_graveyard_creature_card" },
        { kind: "own_graveyard_creature_card" },
      );
      result.effects.push(
        {
          kind: "move_card",
          cardId: { type: "chosen", index: 0 },
          toZone: "battlefield",
          entersTapped: true,
        },
        {
          kind: "move_card",
          cardId: { type: "chosen", index: 1 },
          toZone: "battlefield",
          entersTapped: true,
        },
      );
      sentences[index + 1] = "";
      sentences[index + 2] = "";
      continue;
    }

    // Culling Ritual: the sweep counts its kills into mana.
    const culling =
      /^Destroy each nonland permanent with mana value (\d+) or less$/i.exec(sentence);
    const cullingMana = /^Add \{([WUBRG])\} or \{([WUBRG])\} for each permanent destroyed this way$/i.exec(
      sentences[index + 1] ?? "",
    );
    if (culling?.[1] && cullingMana?.[1] && cullingMana[2]) {
      result.effects.push({
        kind: "destroy_all",
        what: "nonland",
        maxManaValue: Number(culling[1]),
        addManaPerDestroyedOptions: [
          cullingMana[1].toUpperCase() as ManaColor,
          cullingMana[2].toUpperCase() as ManaColor,
        ],
      });
      sentences[index + 1] = "";
      continue;
    }

    // Fumigate / Bane of Progress: "…for each <noun> destroyed this way"
    // attaches to the sweep that just compiled, which is the only thing that
    // knows the count. Refused when the previous effect was not a sweep,
    // rather than compiling a rider that would read nothing.
    const perDestroyed = sentence.match(
      /^(?:You gain (\d+) life|Put an? ([+-]\d\/[+-]\d) counter on ~) for each (?:[a-z]+ )?destroyed this way$/i,
    );
    if (perDestroyed) {
      const lastTrigger = result.triggers.at(-1);
      const pool = lastTrigger ? lastTrigger.effects : result.effects;
      // "Destroy all artifacts and enchantments" is TWO sweeps, so the rider
      // goes on every trailing one — each counts its own kills and they add
      // up. Attaching only to the last would have counted half the board and
      // compiled perfectly cleanly.
      const sweeps: Extract<CardEffect, { kind: "destroy_all" }>[] = [];
      for (let back = pool.length - 1; back >= 0; back -= 1) {
        const entry = pool[back];
        if (entry?.kind !== "destroy_all") {
          break;
        }
        sweeps.push(entry);
      }
      if (sweeps.length > 0) {
        for (const sweep of sweeps) {
          if (perDestroyed[1]) {
            sweep.gainLifePerDestroyed = Number(perDestroyed[1]);
          } else if (perDestroyed[2]) {
            sweep.counterPerDestroyed = {
              cardId: "self",
              counter: perDestroyed[2] === "+1/+1" ? "p1p1" : "m1m1",
              amount: 1,
            };
          }
        }
        continue;
      }
    }

    // Plaguecrafter's fallback rider: attaches to the just-compiled edict.
    if (/^Each player who can't discards a card$/i.test(sentence)) {
      const lastTrigger = result.triggers.at(-1);
      const pool = lastTrigger ? lastTrigger.effects : result.effects;
      const edicts = pool.filter(
        (entry): entry is Extract<CardEffect, { kind: "choose_card" }> =>
          entry.kind === "choose_card",
      );
      if (edicts.length > 0) {
        for (const edict of edicts) {
          edict.cantDiscards = 1;
        }
        continue;
      }
    }

    // Dryad of the Ilysian Grove: controlled lands gain every basic type
    // (layer 4); their intrinsic mana follows via the Urborg machinery.
    if (
      /^Lands you control are every basic land type(?: in addition to their other types)?$/i.test(
        sentence,
      )
    ) {
      result.staticAbilities.push({
        selector: { scope: "controlled", types: ["land"] },
        effect: {
          kind: "add_types",
          types: [],
          subtypes: ["plains", "island", "swamp", "mountain", "forest"],
        },
      });
      continue;
    }

    // Maskwood Nexus. The off-battlefield half of the sentence pair is
    // consumed as covered by the battlefield static — spells and cards off
    // the battlefield keep only their printed types, a documented
    // approximation.
    if (/^Creatures you control are every creature type$/i.test(sentence)) {
      result.staticAbilities.push({
        selector: { scope: "controlled", types: ["creature"] },
        effect: { kind: "all_creature_types" },
      });
      if (
        /^The same is true for creature spells you control and creature cards you own that aren't on the battlefield$/i.test(
          sentences[index + 1] ?? "",
        )
      ) {
        sentences[index + 1] = "";
      }
      continue;
    }

    // Blasphemous Edict: the cheap alternative cost, auto-taken whenever
    // the creature count holds (documented approximation).
    const altCost = sentence.match(
      /^You may pay ((?:\{[^}]+\})+) rather than pay this spell's mana cost if there are (thirteen|\d+) or more creatures on the battlefield$/i,
    );
    if (altCost?.[1] && altCost[2]) {
      const threshold = altCost[2].toLowerCase() === "thirteen" ? 13 : Number(altCost[2]);
      result.altCostIfCreatures = { cost: altCost[1], count: threshold };
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

    // Taxes are discounts with the sign flipped (Grand Arbiter, Defense Grid)
    // and symmetric discounts are the same shape with a wider scope
    // (Helm of Awakening) — no second machinery for making spells cost more.
    const tax = sentence.match(
      /^(Spells your opponents cast|Each spell|Spells) costs? \{(\d+)\} (more|less) to cast( except during its controller's turn)?$/i,
    );
    if (tax?.[1] && tax[2] && tax[3]) {
      const amount = Number(tax[2]) * (/^more$/i.test(tax[3]) ? -1 : 1);
      result.costReductions = [
        ...(result.costReductions ?? []),
        {
          generic: amount,
          filter: {},
          scope: /opponents/i.test(tax[1]) ? ("opponents" as const) : ("all" as const),
          ...(tax[4] ? { notDuringControllersTurn: true } : {}),
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
      } else if (
        // Nightscape Familiar: "Blue spells AND red spells you cast" — two
        // colours, either of which qualifies. The head's lazy match leaves
        // the inner "spells" behind, so it is stripped here rather than in
        // the pattern, where it would have to be optional twice.
        /^(?:white|blue|black|red|green) spells and (?:white|blue|black|red|green)$/.test(what)
      ) {
        const pair = what.replace(" spells", "").split(" and ");
        filter = { colors: pair.map((name) => colorOf[name]!) };
      } else if (["artifact", "creature", "enchantment", "instant", "sorcery"].includes(what)) {
        filter = { types: [what] };
      } else if (what === "instant and sorcery") {
        filter = { typesAny: ["instant", "sorcery"] };
      } else if (/^[A-Za-z]+ and [A-Za-z]+$/.test(what) && /^[A-Z]/.test(discount[1].trim())) {
        // Danitha Capashen: "Aura and Equipment spells" — two capitalised
        // subtypes, either of which qualifies.
        filter = { subtypesAny: what.split(" and ") };
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

    const moxReplacement = compileDiscardLandOrGraveyard(sentence);
    if (moxReplacement) {
      result.replacements.push(moxReplacement);
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

    // Dauthi Voidwalker: an OPPONENT's card only, and it carries a void
    // counter so the ability below can find it again. Owner-scoped, unlike
    // Rest in Peace, which is the whole difference between the two.
    if (
      /^If a card would be put into an opponent['’]s graveyard from anywhere, instead exile it with a void counter on it$/i.test(
        sentence,
      )
    ) {
      result.replacements.push({ kind: "opponents_graveyard_to_void_exile" });
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
    /**
     * Blightsteel Colossus, Progenitus, Darksteel Colossus. A REPLACEMENT,
     * where Kozilek's shuffle-back is a trigger: this card never reaches
     * the graveyard at all, so nothing that watches a graveyard sees it and
     * there is no window to respond in. The reveal is not modelled — every
     * zone in this engine is already visible to the test harness, and
     * nothing reads it.
     */
    if (
      /^If (?:~|this creature|this card) would be put into a graveyard from anywhere, reveal (?:~|this creature|this card) and shuffle (?:it|~) into its owner's library instead$/i.test(
        sentence,
      )
    ) {
      result.replacements.push({ kind: "self_to_library_shuffled" });
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

    /**
     * Ojer Taq: the same replacement, tripled and narrowed to CREATURE
     * tokens. Multipliers compound (CR 614.1c), so beside a Doubling Season
     * this is six — which falls out of the shared factor rather than
     * needing to be spelled.
     */
    const tokenMultiplier = sentence.match(
      /^If one or more (creature )?tokens would be created under your control, (twice|three times|four times) that many of those tokens are created instead$/i,
    );
    if (tokenMultiplier?.[2]) {
      const word = tokenMultiplier[2].toLowerCase();
      const multiplier = word === "twice" ? 2 : word === "three times" ? 3 : 4;
      result.replacements.push({
        kind: "double_tokens",
        ...(multiplier === 2 ? {} : { multiplier }),
        ...(tokenMultiplier[1] ? { creaturesOnly: true } : {}),
      });
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

    // Bloodletter of Aclazotz: the mirror, with both halves restrictions —
    // an OPPONENT, and only during YOUR turn.
    if (
      /^If an opponent would lose life during your turn, they lose twice that much life instead$/i.test(
        sentence,
      )
    ) {
      result.replacements.push({ kind: "double_opponent_life_loss_on_your_turn" });
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
    const doubleCounters = sentence.match(
      /^If one or more \+1\/\+1 counters would be put on an? ([a-z]+(?: or [a-z]+)*) you control, twice that many \+1\/\+1 counters are put on (?:it|that creature|that permanent) instead$/i,
    );
    const doubleScope = doubleCounters?.[1]
      ? counterReplacementScope(doubleCounters[1])
      : null;
    if (doubleScope) {
      result.replacements.push({ kind: "double_counters", counter: "p1p1", ...doubleScope });
      continue;
    }

    // Token-creation replacements (CR 614). All three shapes name which
    // tokens they touch and what to do, so they read as one family.
    const oneOfEach = sentence.match(
      /^If you would create an? ([A-Za-z]+(?:, [A-Za-z]+)*,? or [A-Za-z]+) token, instead create one of each$/i,
    );
    if (oneOfEach?.[1]) {
      const subtypes = oneOfEach[1]
        .split(/,\s*(?:or\s+)?|\s+or\s+/)
        .map((word) => word.trim())
        .filter(Boolean);
      if (subtypes.length > 1) {
        result.replacements.push({ kind: "tokens_one_of_each", subtypes });
        continue;
      }
    }
    const extraToken = sentence.match(
      /^If (?:you would create |)?(?:one or more )?([A-Za-z ]*?)tokens? would be created(?: under your control)?, (?:those tokens plus an additional (.+?)|that many (.+?)) are created instead$/i,
    );
    const xornForm = sentence.match(
      /^If you would create one or more ([A-Za-z ]*?)tokens?, instead create those tokens plus an additional (.+)$/i,
    );
    const replacementForm = extraToken ?? xornForm;
    if (replacementForm) {
      const scope = (replacementForm[1] ?? "").trim().toLowerCase();
      const substituting = Boolean(extraToken?.[3]);
      const descriptor = parseTokenDescriptor(
        `a ${(extraToken?.[2] ?? extraToken?.[3] ?? xornForm?.[2] ?? "").replace(/^an?\s+/i, "")}`,
      );
      const match =
        scope === "" || scope === "one or more"
          ? undefined
          : TOKEN_CARD_TYPES.includes(scope)
            ? { types: [scope] }
            : { subtypesAny: [scope] };
      if (descriptor && descriptor.count === 1) {
        const token = {
          name: descriptor.name,
          typeLine: descriptor.typeLine,
          power: descriptor.power,
          toughness: descriptor.toughness,
          ...(descriptor.keywords.length > 0 ? { keywords: descriptor.keywords } : {}),
          ...(descriptor.colors.length > 0 ? { colors: descriptor.colors } : {}),
        };
        result.replacements.push({
          kind: substituting ? "substitute_tokens" : "extra_token",
          ...(match ? { match } : {}),
          token,
        });
        continue;
      }
    }

    // Hardened Scales / Kami of Whispered Hopes / Ozolith, the Shattered
    // Spire: "that many plus one". The scope phrase is shared with the
    // doubling half below — "a creature", "a permanent", or a disjunction
    // of card types ("an artifact or creature").
    const bonusCounters = sentence.match(
      /^If one or more \+1\/\+1 counters would be put on an? ([a-z]+(?: or [a-z]+)*) you control, that many plus one \+1\/\+1 counters are put on (?:it|that creature|that permanent) instead$/i,
    );
    const bonusScope = bonusCounters?.[1]
      ? counterReplacementScope(bonusCounters[1])
      : null;
    if (bonusScope) {
      result.replacements.push({ kind: "bonus_counters", counter: "p1p1", ...bonusScope });
      continue;
    }

    // Innkeeper's Talent level 3. "Or player" is read and DROPPED: nothing
    // in this engine puts a counter on a player, so the half is silent
    // rather than wrong — a documented omission, not an approximation.
    if (
      /^If you would put one or more counters on a permanent or player, put twice that many of each of those kinds of counters on that permanent or player instead$/i.test(
        sentence,
      )
    ) {
      result.replacements.push({ kind: "double_counters" });
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

    const etb = sentence.match(/^When ~ enters, (.+)$/i);
    if (etb?.[1]) {
      // Garruk's Uprising: peel an intervening "if" off the ETB body.
      let etbRest = etb[1].trim();
      let etbCondition: TriggerCondition | undefined;
      const etbIf = etbRest.match(/^if you control a creature with power (\d+) or greater, (?:then )?(.+)$/i);
      if (etbIf?.[1] && etbIf[2]) {
        etbCondition = { kind: "controls_power_at_least", power: Number(etbIf[1]) };
        etbRest = etbIf[2].trim();
      }
      // Knight of the White Orchid / Loyal Warhound: land catch-up ETBs.
      const etbLands = etbRest.match(/^if an opponent controls more lands than you, (?:then )?(.+)$/i);
      if (etbLands?.[1]) {
        etbCondition = { kind: "opponent_controls_more_lands" };
        etbRest = etbLands[1].trim();
      }
      // Any OTHER intervening "if" the shared condition vocabulary can
      // read (CR 603.4). The two peels above predate that vocabulary and
      // name conditions it does not carry, so they stay in front.
      //
      // A condition it cannot read is left attached to the body, exactly as
      // before this peel existed — the same rule the combat head follows.
      // Dropping one would make the trigger fire unconditionally, which is
      // a wrong game rather than an uncompiled one.
      if (!etbCondition) {
        const general = etbRest.match(/^if (.+?), (?:then )?(.+)$/i);
        if (general?.[1] && general[2]) {
          const parsed = parseEffectCondition(general[1].trim());
          if (parsed) {
            etbCondition = parsed;
            etbRest = general[2].trim();
          }
        }
      }
      const etbLook = foldLookRun(etbRest, sentences, index, lineStart);
      if (etbLook) {
        result.triggers.push({
          event: "enter_battlefield",
          ...(etbCondition ? { condition: etbCondition } : {}),
          effects: etbLook.effects,
          targetRequirements: etbLook.targetRequirements,
        });
        index += etbLook.consumed - 1;
        continue;
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
      // Intervening "if" (CR 603.4). This head has its own branch — for
      // the haste rider below — and so never reached the shared peel the
      // other phase heads use. Without it the whole trigger was a miss,
      // which is why Proft's Eidetic Memory read as needing a new count
      // when the count it asks about already existed.
      //
      // The peel only applies when the condition is one we can READ. A
      // condition we cannot read is left attached to the body, which is
      // exactly what this branch did before the peel existed — The
      // Ozolith's "if ~ has counters on it" compiles down there, as part
      // of the whole clause, and peeling it off unconditionally turned a
      // working card into a miss. Never drop the condition: the trigger
      // would fire unconditionally, which is a wrong game rather than an
      // uncompiled one.
      let combatBody = beginCombat[1].trim();
      let combatCondition: TriggerCondition | undefined;
      const combatIf = combatBody.match(/^if (.+?), (?:then )?(.+)$/i);
      if (combatIf?.[1] && combatIf[2]) {
        const parsed = parseEffectCondition(combatIf[1].trim());
        if (parsed) {
          combatCondition = parsed;
          combatBody = combatIf[2].trim();
        }
      }
      const inner = compileSimpleClause(combatBody);
      // Halana and Alena: "That creature gains haste until end of turn."
      // rides the previous sentence's single target.
      const hasteRider = sentences[index + 1]?.match(
        /^That creature gains ([a-z ]+) until end of turn$/i,
      );
      const riderKeyword = hasteRider?.[1]
        ? KEYWORD_GRANTS[hasteRider[1].trim().toLowerCase()]
        : undefined;
      if (
        inner &&
        !inner.leftover &&
        riderKeyword &&
        !lineStart[index + 1] &&
        inner.targetRequirements.length === 1
      ) {
        inner.effects.push({
          kind: "keyword_until_eot",
          cardId: { type: "chosen", index: 0 },
          keyword: riderKeyword,
        });
        sentences[index + 1] = "";
      }
      // Helm of the Host: "That token gains haste." — no target and no
      // "until end of turn", so the branch above does not read it. The
      // shared subject-rider fold does, and it must run here rather than
      // leaving the sentence to become a top-level effect on a permanent
      // card, where nothing would ever run it.
      while (
        inner &&
        index + 1 < sentences.length &&
        !lineStart[index + 1] &&
        foldSubjectRider(inner.effects, sentences[index + 1]!)
      ) {
        index += 1;
      }
      if (inner) {
        result.triggers.push({
          event: "begin_combat",
          ...(everyCombat ? { watch: "any" as const } : {}),
          ...(combatCondition ? { condition: combatCondition } : {}),
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

    // Waste Not / Bone Miser: the "noncreature, nonland" head carries a comma
    // that would confuse the general head/body split.
    const nonNonDiscard = sentence.match(
      /^Whenever (an opponent|you) discards? a noncreature, nonland card, (.+)$/i,
    );
    if (nonNonDiscard?.[1] && nonNonDiscard[2]) {
      const inner = compileSimpleClause(nonNonDiscard[2].trim());
      if (inner && !inner.leftover && inner.targetRequirements.length === 0) {
        result.triggers.push({
          event: "discards",
          watch: nonNonDiscard[1].toLowerCase() === "you" ? "controlled" : "opponents",
          subjectFilter: { nonTypes: ["creature", "land"] },
          effects: inner.effects,
          targetRequirements: [],
        });
        continue;
      }
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
        // Selvala prints the intervening "if" AFTER the body. Peeled only
        // when the condition READS — an unreadable one stays attached, so
        // the trigger is a miss rather than one that fires unconditionally.
        const trailingIf = rest.match(/^(.+?) if (.+)$/i);
        if (trailingIf?.[1] && trailingIf[2]) {
          const parsedTrailing = parseEffectCondition(trailingIf[2].trim());
          if (parsedTrailing) {
            condition = parsedTrailing;
            rest = trailingIf[1].trim();
          }
        }
        const interveningIf = rest.match(/^if (.+?), (?:then )?(.+)$/i);
        if (interveningIf?.[1] && interveningIf[2]) {
          // One condition vocabulary, shared with activation gates and
          // ability-word riders. It used to be spelled out here as a chain of
          // one branch per wording, which meant a condition added for one of
          // the three served only that one.
          const parsed = parseEffectCondition(interveningIf[1].trim());
          if (parsed) {
            condition = parsed;
            rest = interveningIf[2].trim();
          }
        }
        // Mask of Memory: "you may draw two cards. If you do, discard a
        // card." fuses to a loot — the draw is taken unconditionally, a
        // documented approximation of the "may".
        const mayDraw = rest.match(/^you may draw (two|three|\d+) cards$/i);
        const followDiscard = sentences[index + 1];
        if (
          mayDraw?.[1] &&
          followDiscard &&
          !lineStart[index + 1] &&
          /^If you do, discard a card$/i.test(followDiscard)
        ) {
          rest = `draw ${mayDraw[1]} cards, then discard a card`;
          sentences[index + 1] = "";
        }
        const pair = foldLookRun(rest, sentences, index, lineStart);
        {
          if (pair) {
            const { extraEvents: lookExtras, ...lookHead } = head;
            const built = {
              ...lookHead,
              ...(condition ? { condition } : {}),
              effects: pair.effects,
              targetRequirements: pair.targetRequirements,
            };
            result.triggers.push(built);
            for (const extra of lookExtras ?? []) {
              result.triggers.push({
                ...built,
                event: extra,
                effects: pair.effects.map((effect) => ({ ...effect })),
                targetRequirements: pair.targetRequirements.map((req) => ({ ...req })),
              });
            }
            index += pair.consumed - 1;
            continue;
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
          // Helm of the Host: "That token gains haste." is its own
          // sentence on the same printed line. Folded BEFORE the push so
          // an extraEvents sibling copies the rider too — and folded at
          // all because a rider parked as a top-level effect on a
          // permanent card never runs.
          while (
            index + 1 < sentences.length &&
            !lineStart[index + 1] &&
            foldSubjectRider(inner.effects, sentences[index + 1]!)
          ) {
            index += 1;
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

    // Typecycling (CR 702.29f): the same discard-from-hand activation as
    // plain cycling, but it fetches rather than draws. "Basic landcycling"
    // is the supertype form of the same clause.
    const typeCycling = sentence.match(/^(Basic land|[A-Z][a-z]+)cycling ((?:\{[^}]+\})+)$/);
    if (typeCycling?.[1] && typeCycling[2]) {
      let typeCyclingCostOk = true;
      try {
        parseManaCost(typeCycling[2]);
      } catch {
        typeCyclingCostOk = false;
      }
      const word = typeCycling[1];
      const filter: SearchFilter =
        word === "Basic land"
          ? { supertypes: ["basic"], types: ["land"] }
          : { subtypes: [singularSubtype(`${word}s`)] };
      if (typeCyclingCostOk) {
        result.activated.push({
          tap: false,
          manaCost: typeCycling[2],
          effects: [
            {
              kind: "search_library",
              playerId: "controller",
              filter,
              destination: "hand",
              count: 1,
            },
          ],
          targetRequirements: [],
          zone: "hand",
          discard: true,
        });
        continue;
      }
    }

    // Persist (CR 702.78) lowers to its full rules text. The intervening-if
    // is what keeps it from looping: a creature that came back already has
    // the counter, so its second death does nothing.
    if (/^Persist$/i.test(sentence)) {
      result.triggers.push({
        event: "dies",
        condition: { kind: "self_no_counter", counter: "m1m1" },
        effects: [
          {
            kind: "move_card",
            cardId: "self",
            toZone: "battlefield",
            withCounter: { counter: "m1m1", amount: 1 },
          },
        ],
        targetRequirements: [],
      });
      continue;
    }

    /**
     * Talon Gates of Madara: "{4}: Put this card from your hand onto the
     * battlefield." A hand-zone activation, which the engine already runs
     * end to end — this is the first card that compiles into one. It is an
     * ABILITY, not a land drop, so it does not spend the turn's land.
     */
    const handDrop = sentence.match(
      /^((?:\{[^}]+\})+): Put this card from your hand onto the battlefield$/i,
    );
    if (handDrop?.[1]) {
      let handDropCostOk = true;
      try {
        parseManaCost(handDrop[1]);
      } catch {
        handDropCostOk = false;
      }
      if (handDropCostOk) {
        result.activated.push({
          tap: false,
          manaCost: handDrop[1],
          zone: "hand",
          effects: [{ kind: "move_card", cardId: "self", toZone: "battlefield" }],
          targetRequirements: [],
        });
        continue;
      }
    }

    /**
     * Kozilek, Ulamog: "when this is put into a graveyard FROM ANYWHERE".
     * A superset of dies — the stack, the library and the hand all count —
     * and the difference is the card: answering one of these by countering
     * or milling it is exactly what the shuffle undoes. The watcher is the
     * card itself, which is in the graveyard by the time the event goes
     * out, so it rides wave 354's graveyard pass.
     */
    if (
      /^When (?:~|this card|this creature|this permanent) is put into a graveyard from anywhere, its owner shuffles their graveyard into their library$/i.test(
        sentence,
      )
    ) {
      result.triggers.push({
        event: "put_into_graveyard",
        watch: "self",
        fromGraveyard: true,
        effects: [
          {
            kind: "shuffle_zones_into_library",
            playerId: "source_owner",
            zones: ["graveyard"],
          },
        ],
        targetRequirements: [],
      });
      continue;
    }

    /**
     * Combat Celebrant, once the fuser has joined its offer to the trigger
     * that offer fires. The "may" is a DOCUMENTED AUTO-TAKE: the engine
     * always exerts, which for this card is always right — an extra combat
     * phase and an untapped board cost it one untap step it was going to
     * spend attacking anyway.
     */
    if (/^combat-celebrant-exert$/i.test(sentence)) {
      result.triggers.push({
        event: "attacks",
        watch: "self",
        condition: { kind: "self_not_exerted_this_turn" },
        effects: [
          { kind: "exert", cardId: "self" },
          {
            kind: "untap_all",
            playerId: "controller",
            what: "creature",
            excludeSource: true,
          },
          { kind: "extra_combat" },
        ],
        targetRequirements: [],
      });
      continue;
    }

    /**
     * Annihilator N (CR 702.85) lowers to its full rules text: an attack
     * trigger whose sacrifice belongs to the DEFENDING player, not to the
     * attacker's controller.
     *
     * Emitted as N single sacrifices rather than one choice of N, because
     * `choose_card` picks one card and nothing here counts. The two come
     * out the same: the choices are all made during one resolution, so the
     * deaths batch together for dies-watchers, and a player holding fewer
     * than N permanents loses all of them, which is what "sacrifices N"
     * means when N is more than they have.
     */
    const annihilator = sentence.match(/^Annihilator (\w+)$/i);
    if (annihilator?.[1]) {
      const annihilatorCount = parseCount(annihilator[1]);
      if (annihilatorCount) {
        result.triggers.push({
          event: "attacks",
          watch: "self",
          effects: Array.from({ length: annihilatorCount }, () => ({
            kind: "choose_card" as const,
            chooserId: "defending_player" as const,
            sources: [
              {
                playerId: "defending_player" as const,
                zone: "battlefield" as const,
                filter: "permanent" as const,
              },
            ],
            thenEffects: [{ kind: "sacrifice" as const, cardId: "chosen_card" as const }],
          })),
          targetRequirements: [],
        });
        continue;
      }
    }

    // Eternalize (CR 702.129) lowers to its full rules text: exile the card
    // from the graveyard and get a 4/4 black Zombie copy of it, which keeps
    // its name and abilities and loses only its mana cost and its size.
    const eternalize = sentence.match(/^Eternalize ((?:\{[^}]+\})+)$/i);
    if (eternalize?.[1]) {
      let eternalizeCostOk = true;
      try {
        parseManaCost(eternalize[1]);
      } catch {
        eternalizeCostOk = false;
      }
      if (eternalizeCostOk) {
        result.activated.push({
          tap: false,
          manaCost: eternalize[1],
          zone: "graveyard",
          effects: [
            {
              kind: "copy_token",
              ownerId: "controller",
              ofCardId: "self",
              setPt: { power: 4, toughness: 4 },
              setColors: ["B"],
              addSubtypes: ["zombie"],
            },
            // The copy is made from the card, so the exile follows it.
            { kind: "move_card", cardId: "self", toZone: "exile" },
          ],
          targetRequirements: [],
          timing: "sorcery",
        });
        continue;
      }
    }

    // Unearth (CR 702.83) lowers to its full rules text as well: a graveyard
    // activation at sorcery speed whose arrival is hasty and temporary. Both
    // halves of the exile are modelled now: the end-step one, and the shield
    // that stops a sacrifice from banking the card for next time.
    const unearth = sentence.match(/^Unearth ((?:\{[^}]+\})+)$/i);
    if (unearth?.[1]) {
      let unearthCostOk = true;
      try {
        parseManaCost(unearth[1]);
      } catch {
        unearthCostOk = false;
      }
      if (unearthCostOk) {
        result.activated.push({
          tap: false,
          manaCost: unearth[1],
          zone: "graveyard",
          effects: [
            {
              kind: "move_card",
              cardId: "self",
              toZone: "battlefield",
              gainsHaste: true,
              atEndStep: "exile",
              exileIfLeaves: true,
            },
          ],
          targetRequirements: [],
          timing: "sorcery",
        });
        continue;
      }
    }

    // Outlast (CR 702.94): a tap ability at sorcery speed. The reminder's
    // "Outlast only as a sorcery" is the same restriction the timing carries.
    const outlast = sentence.match(/^Outlast ((?:\{[^}]+\})+)$/i);
    if (outlast?.[1]) {
      let outlastCostOk = true;
      try {
        parseManaCost(outlast[1]);
      } catch {
        outlastCostOk = false;
      }
      if (outlastCostOk) {
        result.activated.push({
          tap: true,
          manaCost: outlast[1],
          effects: [{ kind: "add_counter", cardId: "self", counter: "p1p1", amount: 1 }],
          targetRequirements: [],
          timing: "sorcery",
        });
        continue;
      }
    }

    // Vanishing N (CR 702.62) lowers to its full rules text: enter with time
    // counters, tick one off each upkeep, and go when the last one does.
    const vanishing = sentence.match(/^Vanishing (\d+)$/i);
    if (vanishing?.[1]) {
      result.entersWithCounters = { counter: "time", count: Number(vanishing[1]) };
      result.triggers.push({
        event: "upkeep",
        effects: [
          {
            kind: "remove_counter",
            cardId: "self",
            counter: "time",
            amount: 1,
            sacrificeWhenEmpty: true,
          },
        ],
        targetRequirements: [],
      });
      continue;
    }

    const channel = sentence.match(
      /^Channel\s*[—-]\s*((?:\{[^}]+\}(?:,\s*)?)+),\s*Discard this card:\s*(.+)$/i,
    );
    if (channel?.[1] && channel[2]) {
      const cost = parseAbilityCost(channel[1]);
      // Eiganjo: "It deals 4 damage to …". In a Channel body "it" is the
      // card being discarded — there is no watched object to confuse it
      // with, which is why the rewrite is scoped here and not global.
      const channelBody = channel[2].trim().replace(/^It /, "~ ");
      const clause = compileSimpleClause(channelBody);
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
        // A Channel body carries the same subject riders an ordinary
        // activated body does. Without this the rider fell through to the
        // main loop and was committed as a SPELL effect, which a land never
        // runs - so the card scored and the tokens had no haste.
        const channelAbility = result.activated[result.activated.length - 1];
        while (
          channelAbility &&
          index + 1 < sentences.length &&
          !lineStart[index + 1] &&
          foldSubjectRider(channelAbility.effects, sentences[index + 1]!)
        ) {
          index += 1;
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
      // Three Tree City: the same "Choose a color" shell over a different
      // count — creatures you control of the type chosen as it entered.
      if (
        /^Choose a color$/i.test(ability.rest) &&
        cost.tap &&
        sentences[index + 1] &&
        !lineStart[index + 1] &&
        /^Add an amount of mana of that color equal to the number of creatures you control of the chosen type$/i.test(
          sentences[index + 1]!,
        )
      ) {
        result.manaAbilities.push({
          produces: {},
          producesOptions: [],
          producesAnyColor: true,
          damageToController: 0,
          countFromChosenTypeCreatures: true,
          ...(cost.manaCost ? { costMana: cost.manaCost } : {}),
        });
        sentences[index + 1] = "";
        continue;
      }
      // Nykthos: "{2}, {T}: Choose a color. Add an amount of mana of that
      // color equal to your devotion to that color."
      if (
        /^Choose a color$/i.test(ability.rest) &&
        cost.tap &&
        sentences[index + 1] &&
        !lineStart[index + 1] &&
        /^Add an amount of mana of that color equal to your devotion to that color$/i.test(
          sentences[index + 1]!,
        )
      ) {
        result.manaAbilities.push({
          produces: {},
          producesOptions: [],
          producesAnyColor: true,
          damageToController: 0,
          countFromDevotion: true,
          ...(cost.manaCost ? { costMana: cost.manaCost } : {}),
        });
        sentences[index + 1] = "";
        continue;
      }
      // Selvala: "Add X mana in any combination of colors, where X is the
      // greatest power among creatures you control." The split across
      // colours is NOT offered — the tap picks one colour and adds X of
      // it, a documented approximation of a free combination.
      if (
        /^Add X mana in any combination of colors, where X is the greatest power among creatures you control$/i.test(
          ability.rest,
        ) &&
        cost.tap
      ) {
        result.manaAbilities.push({
          produces: {},
          producesOptions: [],
          producesAnyColor: true,
          damageToController: 0,
          countFromGreatestControlledPower: true,
          ...(cost.manaCost ? { costMana: cost.manaCost } : {}),
        });
        continue;
      }
      const add = parseAddMana(ability.rest);
      // Relic of Legends taps a creature INSTEAD of itself, so the ability
      // has no {T} of its own — the creature tap is the whole cost.
      if (
        add &&
        (cost.tap || cost.tapCreature) &&
        (cost.manaCost === "" || cost.exertSelf)
      ) {
        result.manaAbilities.push({
          ...manaAbilityFromAdd(add),
          ...(cost.tapCreature ? { costTapCreature: true } : {}),
          ...(cost.tapCreatureLegendary ? { costTapCreatureLegendary: true } : {}),
          ...(cost.exertSelf ? { exertSelf: true } : {}),
          ...(cost.exertSelf && cost.manaCost ? { costMana: cost.manaCost } : {}),
        });
        continue;
      }
      // Springleaf Drum-class: a tap mana ability with a mana activation cost.
      if (add && cost.tap && cost.manaCost !== "" && !cost.sacrificeSelf && !cost.exertSelf && !cost.lifeCost && !cost.lifeCostFromCommanderColors) {
        result.manaAbilities.push({ ...manaAbilityFromAdd(add), costMana: cost.manaCost });
        continue;
      }
      // Phyrexian Altar-class: a tapless mana ability paid by sacrificing.
      if (
        add &&
        !cost.tap &&
        cost.manaCost === "" &&
        cost.sacrificeCost &&
        cost.sacrificeCost !== "another_creature" &&
        cost.sacrificeCost !== "another_black_creature" &&
        cost.sacrificeCost !== "another_creature_or_artifact" &&
        !cost.lifeCost &&
        !cost.lifeCostFromCommanderColors
      ) {
        result.manaAbilities.push({
          ...manaAbilityFromAdd(add),
          costSacrifice: cost.sacrificeCost,
          ...(cost.sacrificeSubtype ? { costSacrificeSubtype: cost.sacrificeSubtype } : {}),
          noTap: true,
        });
        continue;
      }
      // Lion's Eye Diamond: a mana ability with no {T} at all, paid by
      // sacrificing the source. Nothing about it needs the stack, so it
      // stays a mana ability — and `noTap` is what says the permanent is
      // not tapping, which matters because a tap doubler (Mana Reflection)
      // replaces the amount only for abilities that do.
      if (
        add &&
        !cost.tap &&
        cost.manaCost === "" &&
        cost.sacrificeSelf &&
        !cost.exertSelf &&
        !cost.lifeCost &&
        !cost.lifeCostFromCommanderColors
      ) {
        result.manaAbilities.push({
          ...manaAbilityFromAdd(add),
          sacrificeSelf: true,
          noTap: true,
          ...(cost.discardHandCost ? { costDiscardHand: true } : {}),
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
        ...(clause.activationGate
          ? { requiresCondition: clause.activationGate }
          : {}),
        ...(cost.xCost ? { xCost: cost.xCost } : {}),
        ...(cost.sacrificeSelf ? { sacrificeSelf: true } : {}),
        ...(cost.sacrificeCost ? { sacrificeCost: cost.sacrificeCost } : {}),
        ...(cost.sacrificeSubtype ? { sacrificeSubtype: cost.sacrificeSubtype } : {}),
        ...(cost.sacrificeCount ? { sacrificeCount: cost.sacrificeCount } : {}),
        ...(cost.sacrificeCountFromX ? { sacrificeCountFromX: true } : {}),
        ...(cost.removeCounterCost ? { removeCounterCost: cost.removeCounterCost } : {}),
        ...(cost.addCounterCost ? { addCounterCost: cost.addCounterCost } : {}),
        ...(cost.discardCost ? { discardCost: cost.discardCost } : {}),
        ...(cost.millCost !== undefined ? { millCost: cost.millCost } : {}),
        ...(cost.exileFromGraveyardCost ? { exileFromGraveyardCost: cost.exileFromGraveyardCost } : {}),
        ...(cost.lifeCost ? { lifeCost: cost.lifeCost } : {}),
        ...(cost.lifeCostFromCommanderColors
          ? { lifeCostFromCommanderColors: true }
          : {}),
        ...(cost.exileSelf ? { exileSelf: true } : {}),
        // Reassembling Skeleton: a self-return body activates from the yard.
        ...(/^Return (?:~|this card) from your graveyard to (?:the battlefield|your hand)/i.test(
          ability.rest,
        )
          ? { zone: "graveyard" as const }
          : {}),
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
        // The denial belongs to the ability's own destruction, and this
        // loop is the only thing that sees both.
        if (REGENERATION_DENIAL.test(follow)) {
          denyRegenerationInPlace(pushed.effects);
          index += 1;
          continue;
        }
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
        // A clause that already accounts for earlier targets ("It deals
        // damage equal to its power to target …") must not be shifted past
        // them twice.
        const offset = pushed.targetRequirements.length - (followClause.chosenBase ?? 0);
        pushed.effects.push(
          ...(offset > 0
            ? followClause.effects.map((effect) => shiftChosen(effect, offset))
            : followClause.effects),
        );
        pushed.targetRequirements.push(...followClause.targetRequirements);
        index += 1;
      }
      continue;
    }

    // "Mill three cards. You may put a land card from among them into your
    // hand." — a sentence of its own, but "them" belongs to the mill in the
    // sentence before it, so it joins that ability rather than becoming a
    // spell effect beside it.
    const amongMilledRider = compileFromAmongMilled(sentence);
    if (amongMilledRider) {
      const lastTrigger = result.triggers[result.triggers.length - 1];
      const lastActivated = result.activated[result.activated.length - 1];
      const host =
        result.effects.length > 0
          ? result.effects
          : lastActivated && result.activated.length > 0
            ? lastActivated.effects
            : lastTrigger
              ? lastTrigger.effects
              : null;
      if (host && host.some((entry) => entry.kind === "mill")) {
        host.push(...amongMilledRider);
        continue;
      }
    }

    // Karlach: "They gain first strike until end of turn" after an attack
    // trigger extends that trigger — the attackers get the grant.
    const theyGain = sentence.match(/^They gain ([a-z ]+) until end of turn$/i);
    if (theyGain?.[1] && result.triggers.length > 0) {
      const grantedKeyword = KEYWORD_GRANTS[theyGain[1].trim().toLowerCase()];
      const lastAttackTrigger = result.triggers[result.triggers.length - 1];
      if (grantedKeyword && lastAttackTrigger) {
        lastAttackTrigger.effects.push({
          kind: "attackers_gain_keyword_until_eot",
          keyword: grantedKeyword,
        });
        continue;
      }
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

    /**
     * "If you do, <clause>" following a "you may" on the SAME printed line.
     * The engine auto-takes optional effects, so the antecedent always
     * holds and the rider simply joins the ability it follows — a
     * DOCUMENTED approximation, and the only one available while "may" is
     * an auto-take. It rides the last trigger or activated ability, so it
     * lands where the "may" did rather than in `definition.effects`, where
     * a permanent would never run it.
     */
    const ifYouDo = index > 0 && !lineStart[index] ? sentence.match(/^If you do, (.+)$/i) : null;
    if (ifYouDo?.[1]) {
      const lastTrigger = result.triggers[result.triggers.length - 1];
      const lastActivated = result.activated[result.activated.length - 1];
      const host = lastTrigger?.effects ?? lastActivated?.effects ?? null;
      const rider = host ? compileSimpleClause(ifYouDo[1]) : null;
      if (host && rider && !rider.leftover && rider.targetRequirements.length === 0) {
        host.push(...rider.effects);
        continue;
      }
    }

    // A clause referring back to what an earlier clause targeted. Only read
    // once the card has a target for it to refer to.
    if (result.targetRequirements.length > 0) {
      const backReference = compileBackReferenceClause(sentence);
      if (backReference) {
        result.effects.push(...backReference);
        continue;
      }
    }

    /**
     * Opus: "…, this creature gets +1/+1 until end of turn. If five or more
     * mana was spent to cast that spell, draw a card."
     *
     * "That spell" is the one the PREVIOUS sentence's trigger watched, so
     * the rider belongs to that trigger. Left to the general rider handler
     * below it would become a spell effect, and a creature's spell effects
     * never run — the card would compile clean and do half of what it says.
     */
    const spentRider = sentence.match(
      /^If (.+? mana was spent) to cast (?:that spell|it), (?:then )?(.+)$/i,
    );
    const spentRiderGate = spentRider?.[1] ? parseManaSpentGate(spentRider[1]) : null;
    if (spentRiderGate && spentRider?.[2]) {
      const host = result.triggers[result.triggers.length - 1];
      const clause = compileSimpleClause(
        spentRider[2].charAt(0).toUpperCase() + spentRider[2].slice(1),
      );
      if (
        host?.event === "cast_spell" &&
        clause &&
        !clause.leftover &&
        clause.targetRequirements.length === 0
      ) {
        host.effects = [
          ...host.effects,
          {
            kind: "if_condition",
            condition: { kind: "mana_spent_to_cast", ...spentRiderGate },
            then: clause.effects,
          },
        ];
        continue;
      }
    }

    // Ability-word riders: "<effect> instead if <condition>" (Cabal Ritual,
    // Tragic Slip) and "If <condition>, [instead ]<effect>" (Dispatch,
    // Stubborn Denial). "Instead" replaces what the card has said so far;
    // without it the rider is an extra effect the condition gates. The ability
    // word itself is already gone — normalizeOracleText strips it.
    const riderTrailing = sentence.match(/^(.+?) instead if (.+)$/i);
    // A leading "Then" is sequencing, not a condition of its own (Jace,
    // Wielder of Mysteries: "Then if your library has no cards in it, you
    // win the game."). The condition parser still gates the match, so this
    // cannot claim a sentence whose "if" it cannot read.
    const riderLeading = sentence.match(/^(?:Then )?If (.+?), (instead )?(.+)$/i);
    // "That creature ALSO gains trample … if you control …" — the condition
    // trails without "instead", so the rider adds rather than replaces. The
    // condition parser is what keeps this from claiming every sentence
    // containing the word "if".
    const riderAlso = sentence.match(/^(.+?) if (.+)$/i);
    const rider = riderTrailing
      ? { body: riderTrailing[1]!, condition: riderTrailing[2]!, replaces: true }
      : riderLeading
        ? {
            body: riderLeading[3]!,
            condition: riderLeading[1]!,
            replaces: Boolean(riderLeading[2]) || /\binstead$/i.test(riderLeading[3]!),
          }
        : riderAlso
          ? {
              body: riderAlso[1]!.replace(/\balso\b/i, "").replace(/\s+/g, " ").trim(),
              condition: riderAlso[2]!,
              replaces: false,
            }
          : null;
    // A card with no spell effects has nowhere for an ADDING rider to go:
    // `definition.effects` is what a spell does as it resolves, and a
    // permanent resolves by entering the battlefield. The mana-spent
    // vocabulary is new enough to be held to this, so a rider the fuser
    // above could not place is left UNCOMPILED — a note rather than a card
    // that compiles clean and does half of what it says.
    const strandedSpentRider =
      rider !== null &&
      result.effects.length === 0 &&
      parseManaSpentGate(
        rider.condition.replace(/ to cast (?:that spell|it|this spell)$/i, ""),
      ) !== null;
    if (rider && !strandedSpentRider) {
      const condition = parseEffectCondition(rider.condition);
      const body = rider.body.replace(/\s+instead$/i, "");
      const backReference =
        condition && result.targetRequirements.length > 0
          ? compileBackReferenceClause(body)
          : null;
      const clause = backReference
        ? { targetRequirements: [], effects: backReference }
        : condition
          ? compileSimpleClause(body)
          : null;
      // A replacing rider needs something to replace, and its own targets
      // would renumber against the clause it is replacing — so it only
      // compiles when it adds no targets of its own.
      if (
        condition &&
        clause &&
        !clause.leftover &&
        clause.targetRequirements.length === 0 &&
        (!rider.replaces || result.effects.length > 0)
      ) {
        const gated: CardEffect = {
          kind: "if_condition",
          condition,
          then: clause.effects,
          ...(rider.replaces ? { otherwise: [...result.effects] } : {}),
        };
        // Replacing swallows what came before; adding runs after it.
        result.effects = rider.replaces ? [gated] : [...result.effects, gated];
        continue;
      }
    }

    /**
     * Lion's Eye Diamond. On paper this line is a RESTRICTION — it stops
     * the ability being activated while a spell is being cast, which is
     * the whole reason the card is a puzzle rather than a Black Lotus.
     * Here it is already true: mana abilities are only ever activated at
     * priority, never mid-cast, so the engine has no window to forbid.
     * Consumed as a no-op rather than left to fail the whole card.
     */
    if (
      /^Activate only as an instant$/i.test(sentence) &&
      (result.manaAbilities.length > 0 || result.activated.length > 0)
    ) {
      continue;
    }

    if (/^Activate only as a sorcery$/i.test(sentence) && result.activated.length > 0) {
      const last = result.activated[result.activated.length - 1];
      if (last && !last.timing) {
        last.timing = "sorcery";
        continue;
      }
    }

    // Wishclaw Talisman: your turn, but ANY time during it — not sorcery
    // timing, which would also demand a main phase and an empty stack.
    if (/^Activate only during your turn$/i.test(sentence) && result.activated.length > 0) {
      const last = result.activated[result.activated.length - 1];
      if (last && !last.timing) {
        last.timing = "your_turn";
        continue;
      }
    }

    // Weathered Wayfarer.
    if (
      /^Activate only if an opponent controls more lands than you$/i.test(sentence) &&
      result.activated.length > 0
    ) {
      const last = result.activated[result.activated.length - 1];
      if (last) {
        last.requiresOpponentMoreLands = true;
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

    // Arena of Glory: "If that mana is spent on a creature spell, it gains
    // haste until end of turn." A rider on the mana, not a restriction —
    // the mana pays for anything, and "it" is the spell it paid for.
    const hasteRiderMana = sentence.match(
      /^If that mana is spent on a creature spell, it gains haste until end of turn$/i,
    );
    if (hasteRiderMana) {
      const lastMana = result.manaAbilities[result.manaAbilities.length - 1];
      if (lastMana && !lastMana.rider) {
        lastMana.rider = {
          when: { types: ["creature"] },
          effects: [
            {
              kind: "keyword_until_eot",
              cardId: "subject_card",
              keyword: "haste",
            },
          ],
        };
        continue;
      }
    }

    // Path of Ancestry: "When that mana is spent to cast a creature spell
    // that shares a creature type with your commander, scry 1." This is
    // NOT a restriction — the mana pays for anything — so it rides the
    // tagged pool purely so the spend can be watched.
    const manaRider = sentence.match(
      /^When that mana is spent to cast a creature spell that shares a creature type with your commander, scry (\d+)$/i,
    );
    if (manaRider?.[1]) {
      const riderMana = result.manaAbilities[result.manaAbilities.length - 1];
      if (riderMana && !riderMana.rider) {
        riderMana.rider = {
          when: { types: ["creature"], sharesCreatureTypeWithCommander: true },
          effects: [
            { kind: "scry", playerId: "controller", count: Number(manaRider[1]) },
          ],
        };
        continue;
      }
    }

    // "Spend this mana only to …" (CR 106.6): a restriction riding the mana
    // ability just parsed. The trailing "and that spell can't be countered"
    // is dropped — an uncounterable rider on restricted mana would need the
    // spend to be tracked onto the spell, which it is not (documented).
    const spendOnly = sentence.match(
      /^Spend this mana only to (.+?)(?:, and that spell can't be countered)?$/i,
    );
    if (spendOnly?.[1]) {
      const restriction = parseSpendRestriction(spendOnly[1].trim().toLowerCase());
      const lastMana = result.manaAbilities[result.manaAbilities.length - 1];
      if (restriction && lastMana && !lastMana.spendOnly) {
        lastMana.spendOnly = restriction;
        continue;
      }
    }

    // Bolas's Citadel: the top-of-library grant just parsed pays LIFE
    // instead of mana. Attached to the grant rather than compiled as its
    // own effect, because it is a cost replacement and not something that
    // happens when the spell resolves.
    if (
      /^If you cast a spell this way, pay life equal to its mana value rather than pay its mana cost$/i.test(
        sentence,
      ) &&
      result.topOfLibrary
    ) {
      result.topOfLibrary = { ...result.topOfLibrary, payLifeInsteadOfMana: true };
      continue;
    }

    // Minas Tirith: "Activate only if you attacked with two or more creatures
    // this turn."
    const attackGate = sentence.match(
      /^Activate only if you attacked with (\w+) or more creatures this turn$/i,
    );
    if (attackGate?.[1]) {
      const atLeast = parseCount(attackGate[1]);
      const lastActivated = result.activated[result.activated.length - 1];
      if (atLeast && lastActivated && lastActivated.requiresAttackersThisTurn === undefined) {
        lastActivated.requiresAttackersThisTurn = atLeast;
        continue;
      }
    }

    // "Activate only if <condition>" through the shared vocabulary. Tried
    // before the type/subtype gates below, which read wordings this parser
    // deliberately does not (a bare "you control a Swamp" names no count).
    const generalGate = sentence.match(/^Activate only if (.+)$/i);
    if (generalGate?.[1]) {
      const gateCondition = parseEffectCondition(generalGate[1]);
      const lastActivated = result.activated[result.activated.length - 1];
      if (gateCondition && lastActivated && !lastActivated.requiresCondition) {
        lastActivated.requiresCondition = gateCondition;
        continue;
      }
      // Shrine of the Forsaken Gods: the gate rides a MANA ability, which is
      // a separate list from the activated one.
      const lastManaAbility = result.manaAbilities[result.manaAbilities.length - 1];
      if (gateCondition && lastManaAbility && !lastManaAbility.requiresCondition) {
        lastManaAbility.requiresCondition = gateCondition;
        continue;
      }
    }

    const activateGate = sentence.match(
      /^Activate only if you control (?:an? )?([A-Za-z]+)(?: or (?:an? )?([A-Za-z]+))?$/i,
    );
    // "…a legendary creature" / "…a creature with power 4 or greater" — the
    // adjective forms the bare word-match above can't reach.
    const legendaryGate = /^Activate only if you control a legendary creature$/i.test(sentence);
    const powerGate = sentence.match(
      /^Activate only if you control a creature with power (\d+) or greater$/i,
    );
    let gate: ControlledGate | null = null;
    if (legendaryGate) {
      gate = { types: ["creature"], legendary: true };
    } else if (powerGate?.[1]) {
      gate = { types: ["creature"], minPower: Number(powerGate[1]) };
    } else if (activateGate?.[1]) {
      const first = activateGate[1].toLowerCase();
      const second = activateGate[2]?.toLowerCase();
      if (second) {
        // The Verge land cycle: "a Plains or a Swamp". Only the all-subtype
        // form is supported — a mixed type/subtype "or" has no card in the
        // measured set and would need a full disjunction shape.
        if (!SEARCH_CARD_TYPES.has(first) && !SEARCH_CARD_TYPES.has(second)) {
          gate = { subtypesAny: [first, second] };
        }
      } else {
        gate = SEARCH_CARD_TYPES.has(first) ? { types: [first] } : { subtypes: [first] };
      }
    }
    if (gate) {
      const lastActivated = result.activated[result.activated.length - 1];
      if (lastActivated && !lastActivated.requiresControlled) {
        lastActivated.requiresControlled = gate;
        continue;
      }
      // The gate can also ride a mana ability (Cabal Stronghold-class, and
      // the Verge cycle's second mana ability).
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

    // Expressive Iteration: the rider belongs to the LOOK that did the
    // exiling. Left as its own sentence it would be a top-level effect with
    // no card to name — and the look is the only thing that knows which card
    // went to exile. Refused when the look has no exile destination, so a
    // rider that reads nothing never lands.
    if (/^You may play the exiled card this turn$/i.test(sentence)) {
      const look = [...result.effects]
        .reverse()
        .find(
          (effect) =>
            effect.kind === "look_and_assign" && effect.destinations.includes("exile"),
        );
      if (look?.kind === "look_and_assign") {
        look.exilePlayableThisTurn = true;
        continue;
      }
    }

    // Whip of Erebos: the shield belongs to the reanimation it follows.
    // Without it the Whip is a repeatable reanimator — sacrifice the creature
    // in response to the end-step exile and it is back in the graveyard.
    if (
      /^If it would leave the battlefield, exile it instead of putting it anywhere else$/i.test(
        sentence,
      )
    ) {
      const arrivals = [
        ...(result.activated[result.activated.length - 1]?.effects ?? []),
        ...result.effects,
      ].filter((effect) => effect.kind === "move_card" && effect.toZone === "battlefield");
      const last = arrivals[arrivals.length - 1];
      if (last?.kind === "move_card") {
        last.exileIfLeaves = true;
        continue;
      }
    }

    // "This ability triggers only once each turn" (Morbid Opportunist) and
    // Terrasymbiosis's "Do this only once each turn" are the same cap, and
    // both ride the trigger they follow.
    if (
      /^(?:This ability triggers|Do this) only once each turn$/i.test(sentence) &&
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

    // Gemstone Caverns: "If ~ has a luck counter on it, instead add one
    // mana of any color." The same rider shape as the Urza lands below, but
    // gated on the SOURCE's own counters rather than on what its controller
    // has out.
    const selfCounterUpgrade = sentence.match(
      /^If ~ has an? ([a-z]+) counter on it, instead add (one mana of any color|two mana of any one color)$/i,
    );
    const counterMana = result.manaAbilities[result.manaAbilities.length - 1];
    if (selfCounterUpgrade?.[1] && selfCounterUpgrade[2] && counterMana) {
      counterMana.upgrade = {
        requires: [],
        selfCounter: counterKeyOf(selfCounterUpgrade[1]),
        anyColor: /^one /i.test(selfCounterUpgrade[2]) ? 1 : 2,
      };
      continue;
    }

    // Incubation Druid: "add three mana of THAT type instead" — the same
    // type the base ability just picked, only more of it. Not `anyColor`,
    // which offers a fresh choice the printed card does not.
    const sameTypeUpgrade = sentence.match(
      /^If ~ has an? ([+-]\d\/[+-]\d|[a-z]+) counter on it, add (two|three|four) mana of that type instead$/i,
    );
    const sameTypeAbility = result.manaAbilities[result.manaAbilities.length - 1];
    const sameTypeAmount = sameTypeUpgrade?.[2] ? parseCount(sameTypeUpgrade[2]) : null;
    if (sameTypeUpgrade?.[1] && sameTypeAmount && sameTypeAbility) {
      sameTypeAbility.upgrade = {
        requires: [],
        selfCounter: counterKeyOf(sameTypeUpgrade[1]),
        sameTypeCount: sameTypeAmount,
      };
      continue;
    }

    // The Urza lands, Ilysian Caryatid: "If you control …, add <more>
    // instead." A rider on the mana ability the previous sentence made, so it
    // is read here rather than as a clause of its own.
    const manaUpgrade = sentence.match(
      /^If you control (.+?), add ((?:\{[^}]+\})+|two mana of any one color|three mana of any one color) instead$/i,
    );
    const lastMana = result.manaAbilities[result.manaAbilities.length - 1];
    if (manaUpgrade?.[1] && manaUpgrade[2] && lastMana) {
      const gates = manaUpgrade[1]
        .split(/\s+and\s+/i)
        .map((half) => parseManaUpgradeGate(half.trim()));
      const anyColor = manaUpgrade[2].match(/^(two|three) mana of any one color$/i);
      if (gates.every((gate): gate is ControlledGate => gate !== null)) {
        const produces = anyColor ? null : parseManaSymbols(manaUpgrade[2]);
        if (anyColor?.[1]) {
          lastMana.upgrade = { requires: gates, anyColor: parseCount(anyColor[1].toLowerCase())! };
          continue;
        }
        if (produces) {
          lastMana.upgrade = { requires: gates, produces };
          continue;
        }
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
        const swapsCost =
          !coloredMatch && over.hybrid.length === 0 && over.xCount === 0;
        if (swapsCost) {
          // Damn: {1}{B}{B} printed, Overload {2}{W}{W}. An extra cost
          // cannot express a different colour, so the mode replaces the
          // whole cost instead.
          const requirement = result.targetRequirements[0]!;
          result.modes = [
            {
              label: "Cast normally",
              effects: result.effects,
              targetRequirements: result.targetRequirements,
            },
            {
              label: `Overload ${overloadCost}`,
              replacesCost: overloadCost,
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

  /**
   * A trigger that returns its own card to the battlefield can only be
   * watching from the graveyard — there is nowhere else the card could be
   * for the sentence to mean anything. Derived here rather than set at each
   * clause because the clause hands back effects and never sees the trigger
   * it will be hung on, and a trigger that compiles clean and never fires
   * is worse than one that misses (Silversmote Ghoul was exactly that).
   */
  for (const trigger of result.triggers) {
    // Persist and undying are NOT graveyard abilities: they are battlefield
    // triggers reading last-known information about their own departure
    // (CR 603.10a), and the dispatcher has a separate look-back pass for
    // them. Marking those would take them out of it.
    if (trigger.event === "dies" || trigger.event === "leaves_battlefield") {
      continue;
    }
    if (
      trigger.effects.some(
        (effect) =>
          effect.kind === "move_card" &&
          effect.cardId === "self" &&
          effect.toZone === "battlefield",
      )
    ) {
      trigger.fromGraveyard = true;
    }
  }

  return result;
}
