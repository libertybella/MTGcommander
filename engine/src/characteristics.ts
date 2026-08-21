import type { CardCharacteristics, Color } from "./types";

export type { CardCharacteristics };

/** CR 205.4a. */
const SUPERTYPES = new Set(["basic", "legendary", "ongoing", "snow", "world"]);

/** CR 300.1, plus "tribal" (the pre-2023 name for kindred). */
const CARD_TYPES = new Set([
  "artifact",
  "battle",
  "conspiracy",
  "creature",
  "dungeon",
  // Not a CR card type: our emblems live on the battlefield as static
  // carriers (a documented approximation), and mass removal spares the type.
  "emblem",
  "enchantment",
  "instant",
  "kindred",
  "land",
  "phenomenon",
  "plane",
  "planeswalker",
  "scheme",
  "sorcery",
  "tribal",
  "vanguard",
]);

const COLOR_ORDER: Color[] = ["W", "U", "B", "R", "G"];

/**
 * Split a printed type line into supertypes, card types, and subtypes.
 * Handles Scryfall's em dash and a plain spaced hyphen. A combined
 * double-faced line ("Land // Land") parses its front half.
 * Known limitation: multi-word subtypes ("Time Lord") split into words.
 */
export function parseTypeLine(typeLine: string): Pick<CardCharacteristics, "supertypes" | "types" | "subtypes"> {
  const front = typeLine.includes(" // ") ? (typeLine.split(" // ")[0] ?? typeLine) : typeLine;
  const [left, ...rest] = front.split(/\s+—\s+|\s+-\s+/);
  const supertypes: string[] = [];
  const types: string[] = [];
  for (const word of (left ?? "").toLowerCase().split(/\s+/).filter(Boolean)) {
    if (SUPERTYPES.has(word)) {
      supertypes.push(word);
    } else if (CARD_TYPES.has(word)) {
      types.push(word);
    }
    // Unknown words on the left side (set-specific noise) are dropped.
  }
  const subtypes = rest
    .join(" ")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  return { supertypes, types, subtypes };
}

function symbolsOf(manaCost: string): string[] {
  return [...manaCost.matchAll(/\{([^}]+)\}/g)].map((match) => match[1] ?? "");
}

/**
 * Colors from mana-cost pips, covering hybrid ({W/U}, {2/W}) and Phyrexian
 * ({W/P}) symbols. Colorless and generic symbols contribute nothing.
 */
export function colorsFromManaCost(manaCost: string): Color[] {
  const found = new Set<Color>();
  for (const symbol of symbolsOf(manaCost)) {
    for (const part of symbol.toUpperCase().split("/")) {
      if ((COLOR_ORDER as string[]).includes(part)) {
        found.add(part as Color);
      }
    }
  }
  return COLOR_ORDER.filter((color) => found.has(color));
}

/**
 * Mana value of a cost (CR 203.3): numbers count themselves, {X} counts 0,
 * colored/colorless/snow pips count 1, and a monocolored hybrid symbol like
 * {2/W} counts its highest option.
 */
export function manaValueOf(manaCost: string): number {
  let total = 0;
  for (const symbol of symbolsOf(manaCost)) {
    const parts = symbol.toUpperCase().split("/");
    let best = 0;
    for (const part of parts) {
      if (/^\d+$/.test(part)) {
        best = Math.max(best, Number(part));
      } else if (part !== "X" && part !== "P") {
        best = Math.max(best, 1);
      }
    }
    total += best;
  }
  return total;
}

/**
 * Derive printed characteristics. `explicitColors` (from oracle data, e.g. a
 * back face with no mana cost or a color indicator) wins over cost-derived
 * colors when provided.
 */
export function deriveCharacteristics(
  typeLine: string,
  manaCost: string,
  explicitColors?: Color[],
): CardCharacteristics {
  const parsed = parseTypeLine(typeLine);
  const colors = explicitColors
    ? COLOR_ORDER.filter((color) => explicitColors.includes(color))
    : colorsFromManaCost(manaCost);
  return {
    ...parsed,
    colors,
    manaValue: manaValueOf(manaCost),
  };
}
