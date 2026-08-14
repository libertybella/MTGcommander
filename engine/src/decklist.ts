import { normalizeCardName } from "./oracle";

export type ParsedDeckCard = {
  name: string;
  quantity: number;
};

export type ParsedDecklist = {
  name: string | null;
  commanders: ParsedDeckCard[];
  library: ParsedDeckCard[];
};

const SKIP_HEADERS = new Set([
  "deck",
  "mainboard",
  "main",
  "main deck",
  "sideboard",
  "maybeboard",
  "considering",
  "tokens",
  "attractions",
  "stickers",
  "companions",
]);

const COMMANDER_HEADERS = new Set(["commander", "commanders", "command zone"]);

export function parseMoxfieldPublicId(input: string): string {
  const trimmed = input.trim();
  const fromUrl = trimmed.match(/moxfield\.com\/decks\/([A-Za-z0-9_-]+)/i);
  if (fromUrl?.[1]) {
    return fromUrl[1];
  }
  if (/^[A-Za-z0-9_-]{6,}$/.test(trimmed)) {
    return trimmed;
  }
  throw new Error("Not a Moxfield deck URL or public ID");
}

function parseLine(line: string): ParsedDeckCard | null {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.startsWith("#") || trimmed.startsWith("//")) {
    return null;
  }
  const stripped = trimmed.replace(/^SB:\s*/i, "");
  const match = stripped.match(/^(\d+)\s+(.+)$/);
  if (!match) {
    return null;
  }
  const quantity = Number(match[1]);
  let name = (match[2] ?? "").trim();
  name = name.replace(/\s+\([A-Za-z0-9]+\)\s+\d+.*$/, "");
  name = name.replace(/\s+\[[A-Za-z0-9]+\]\s*$/, "");
  if (!name || !Number.isInteger(quantity) || quantity <= 0) {
    return null;
  }
  return { name, quantity };
}

function expand(cards: ParsedDeckCard[]): string[] {
  const names: string[] = [];
  for (const card of cards) {
    for (let i = 0; i < card.quantity; i += 1) {
      names.push(card.name);
    }
  }
  return names;
}

/**
 * Parse Arena / MTGO / Moxfield-export text. Commander section headers are
 * recognized. Sideboard and maybeboard cards are ignored.
 */
export function parseTextDecklist(text: string): ParsedDecklist {
  const commanders: ParsedDeckCard[] = [];
  const library: ParsedDeckCard[] = [];
  let section: "library" | "commander" | "skip" = "library";
  let name: string | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const header = trimmed.replace(/:$/, "").toLowerCase();
    if (trimmed.startsWith("About") || header.startsWith("name ")) {
      const named = trimmed.match(/^name[:\s]+(.+)$/i);
      if (named?.[1]) {
        name = named[1].trim();
      }
      continue;
    }
    if (COMMANDER_HEADERS.has(header)) {
      section = "commander";
      continue;
    }
    if (SKIP_HEADERS.has(header) || header.startsWith("sideboard")) {
      section = header.startsWith("sideboard") || header === "maybeboard" || header === "tokens"
        ? "skip"
        : "library";
      continue;
    }
    const parsed = parseLine(trimmed);
    if (!parsed) {
      continue;
    }
    if (section === "skip") {
      continue;
    }
    if (section === "commander") {
      commanders.push(parsed);
    } else {
      library.push(parsed);
    }
  }

  return { name, commanders, library };
}

export function deckNames(list: ParsedDecklist): string[] {
  const names = [...expand(list.commanders), ...expand(list.library)];
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const cardName of names) {
    const key = normalizeCardName(cardName);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(cardName);
  }
  return unique;
}

export function expandDeckCards(cards: ParsedDeckCard[]): string[] {
  return expand(cards);
}
