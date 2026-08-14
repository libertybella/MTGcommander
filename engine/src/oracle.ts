import { createCardDefinition } from "./createGame";
import { parseManaCost } from "./mana";
import {
  compileOracleText,
  stripReminderText,
} from "./oraclePatterns";
import type { ActivatedAbility, CardDefinition, Keyword, ManaPool } from "./types";

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

export { stripReminderText };

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
  return compileOracleText(card).produces;
}

export function inferTapDraw(card: OracleCard): ActivatedAbility[] {
  return compileOracleText(card).activated;
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
 * Matches known sentence patterns; leftover text is recorded as notes.
 */
export function compileOracleCard(card: OracleCard): OracleCompileResult {
  const notes: string[] = [];
  const typeLine = card.typeLine.toLowerCase();
  const keywords = keywordsFromOracle(card);
  const power = parseStat(card.power);
  const toughness = parseStat(card.toughness);
  const compiled = compileOracleText(card, keywords);

  notes.push(...compiled.notes);

  if (!manaCostIsPayable(card.manaCost)) {
    notes.push("Mana cost cannot be paid (Phyrexian or {X}).");
  }

  if (compiled.leftover.length > 0) {
    notes.push(`Some oracle text is not compiled: ${compiled.leftover.join("; ")}.`);
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
    effects: compiled.effects,
    targetRequirements: compiled.targetRequirements,
    triggers: compiled.triggers,
    staticModifiers: compiled.staticModifiers,
    produces: compiled.produces,
    producesAnyColor: compiled.producesAnyColor,
    producesOptions: compiled.producesOptions,
    activated: compiled.activated,
  });

  return { definition, notes };
}
