import { createCardDefinition } from "./createGame";
import { parseManaCost } from "./mana";
import type { CardDefinition, Keyword, ManaColor, ManaPool } from "./types";

export type OracleCard = {
  oracleId: string;
  name: string;
  manaCost: string;
  typeLine: string;
  oracleText: string;
  power: string | null;
  toughness: string | null;
  /** Scryfall-style keyword names, e.g. "Flying". */
  printedKeywords: string[];
};

export type OracleCompileResult = {
  definition: CardDefinition;
  notes: string[];
};

const KEYWORD_BY_LABEL: Record<string, Keyword> = {
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
  flash: "flash",
  defender: "defender",
};

const BASIC_TYPE_MANA: Record<string, ManaColor> = {
  plains: "W",
  island: "U",
  swamp: "B",
  mountain: "R",
  forest: "G",
};

export function normalizeCardName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function definitionIdForOracle(card: OracleCard): string {
  return `oracle:${card.oracleId}`;
}

function stripReminderText(oracleText: string): string {
  return oracleText.replace(/\([^)]*\)/g, " ");
}

function parseStat(value: string | null): number | null {
  if (value === null || value === "") {
    return null;
  }
  if (/^\d+$/.test(value)) {
    return Number(value);
  }
  return null;
}

export function keywordsFromOracle(card: OracleCard): Keyword[] {
  const found = new Set<Keyword>();
  for (const label of card.printedKeywords) {
    const mapped = KEYWORD_BY_LABEL[label.trim().toLowerCase()];
    if (mapped) {
      found.add(mapped);
    }
  }
  const firstLine = stripReminderText(card.oracleText).split("\n")[0] ?? "";
  for (const [label, keyword] of Object.entries(KEYWORD_BY_LABEL)) {
    const pattern = new RegExp(`\\b${label.replace(" ", "[- ]")}\\b`, "i");
    if (pattern.test(firstLine)) {
      found.add(keyword);
    }
  }
  return [...found];
}

export function inferProduces(card: OracleCard): Partial<ManaPool> {
  const produces: Partial<ManaPool> = {};
  const typeLine = card.typeLine.toLowerCase();
  if (typeLine.includes("land")) {
    for (const [landType, color] of Object.entries(BASIC_TYPE_MANA)) {
      if (new RegExp(`\\b${landType}\\b`).test(typeLine)) {
        produces[color] = 1;
      }
    }
  }

  const cleaned = stripReminderText(card.oracleText).replace(/\s+/g, " ").trim();
  const sentences = cleaned
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);
  const addLines = sentences.filter((line) => /^\{T\}: Add /i.test(line));
  if (addLines.length !== 1) {
    return produces;
  }
  const line = addLines[0] ?? "";
  if (/\bor\b/i.test(line) || /any color/i.test(line) || /choose/i.test(line) || /commander/i.test(line)) {
    return produces;
  }
  const symbols = [...line.matchAll(/\{([WUBRGC])\}/g)];
  if (symbols.length === 0) {
    return produces;
  }
  const fromTap: Partial<ManaPool> = {};
  for (const match of symbols) {
    const color = match[1] as ManaColor;
    fromTap[color] = (fromTap[color] ?? 0) + 1;
  }
  return Object.keys(fromTap).length > 0 ? fromTap : produces;
}

function manaCostIsPayable(manaCost: string): boolean {
  if (manaCost.trim() === "") {
    return true;
  }
  try {
    parseManaCost(manaCost);
    return true;
  } catch {
    return false;
  }
}

/**
 * Compile Scryfall-shaped oracle data into an engine CardDefinition.
 * Does not parse general oracle text into effects.
 */
export function compileOracleCard(card: OracleCard): OracleCompileResult {
  const notes: string[] = [];
  const typeLine = card.typeLine.toLowerCase();
  const isLand = typeLine.includes("land");
  const isInstantOrSorcery = typeLine.includes("instant") || typeLine.includes("sorcery");
  const produces = inferProduces(card);
  const keywords = keywordsFromOracle(card);
  const power = parseStat(card.power);
  const toughness = parseStat(card.toughness);

  if (!manaCostIsPayable(card.manaCost)) {
    notes.push("Mana cost cannot be paid (hybrid, Phyrexian, or {X}).");
  }

  const cleanedOracle = stripReminderText(card.oracleText).replace(/\s+/g, " ").trim();
  const hasRulesText = cleanedOracle.length > 0;
  const onlyTapAdd =
    hasRulesText &&
    /^\{T\}: Add /.test(cleanedOracle.replace(/\.$/, "") + "") &&
    cleanedOracle.split(".").filter(Boolean).length <= 2;

  if (isInstantOrSorcery && hasRulesText) {
    notes.push("Spell oracle text is not compiled; it resolves with no effect.");
  } else if (!isLand && hasRulesText && !onlyTapAdd && keywords.length === 0) {
    notes.push("Abilities on this card are not compiled.");
  } else if (!isLand && hasRulesText && !onlyTapAdd && Object.keys(produces).length === 0) {
    const leftover = cleanedOracle.replace(
      new RegExp(`\\b(${Object.keys(KEYWORD_BY_LABEL).join("|")})\\b`, "gi"),
      "",
    );
    if (leftover.replace(/[.,\s]/g, "").length > 0) {
      notes.push("Some abilities on this card are not compiled.");
    }
  }

  if (isLand && Object.keys(produces).length === 0 && hasRulesText) {
    notes.push("This land does not tap for a simple mana amount.");
  }

  if (typeLine.includes("creature") && (power === null || toughness === null)) {
    notes.push("Printed power/toughness is not a simple number; combat uses 0.");
  }

  const definition = createCardDefinition({
    id: definitionIdForOracle(card),
    name: card.name.includes(" // ") ? (card.name.split(" // ")[0] ?? card.name) : card.name,
    manaCost: card.manaCost,
    typeLine: card.typeLine,
    oracleText: card.oracleText,
    power: power ?? (typeLine.includes("creature") ? 0 : null),
    toughness: toughness ?? (typeLine.includes("creature") ? 0 : null),
    keywords,
    produces,
  });

  return { definition, notes };
}
