import {
  parseMoxfieldPublicId,
  parseTextDecklist,
  type ParsedDecklist,
} from "@mtgcommander/engine";
import { fetchJson, SCRYFALL_USER_AGENT, type HttpFetch } from "./http";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function quantityOf(value: Record<string, unknown>): number {
  const quantity = value.quantity;
  return typeof quantity === "number" && Number.isInteger(quantity) && quantity > 0 ? quantity : 1;
}

function nameOf(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (!isRecord(value)) {
    return null;
  }
  if (typeof value.name === "string" && value.name.trim()) {
    return value.name.trim();
  }
  if (isRecord(value.card)) {
    return nameOf(value.card);
  }
  return null;
}

function collectEntries(node: unknown): { name: string; quantity: number }[] {
  if (!node) {
    return [];
  }
  if (Array.isArray(node)) {
    return node.flatMap((entry) => collectEntries(entry));
  }
  if (!isRecord(node)) {
    return [];
  }
  if (node.cards) {
    return collectEntries(node.cards);
  }
  const name = nameOf(node);
  if (name && (typeof node.quantity === "number" || isRecord(node.card))) {
    return [{ name, quantity: quantityOf(node) }];
  }
  const collected: { name: string; quantity: number }[] = [];
  for (const value of Object.values(node)) {
    if (!isRecord(value)) {
      continue;
    }
    const nested = collectEntries(value);
    if (nested.length > 0) {
      collected.push(...nested);
      continue;
    }
    const entryName = nameOf(value);
    if (entryName) {
      collected.push({ name: entryName, quantity: quantityOf(value) });
    }
  }
  return collected;
}

function board(raw: Record<string, unknown>, key: string): unknown {
  if (raw[key]) {
    return raw[key];
  }
  if (isRecord(raw.boards) && raw.boards[key]) {
    return raw.boards[key];
  }
  if (isRecord(raw.board) && raw.board[key]) {
    return raw.board[key];
  }
  return undefined;
}

export function parseMoxfieldDeckJson(raw: unknown): ParsedDecklist {
  if (!isRecord(raw)) {
    throw new Error("Invalid Moxfield deck JSON");
  }
  const name = typeof raw.name === "string" ? raw.name : null;
  const commanders = collectEntries(board(raw, "commanders"));
  const library = collectEntries(board(raw, "mainboard"));
  if (commanders.length === 0 && library.length === 0) {
    throw new Error("Moxfield deck has no commanders or mainboard cards");
  }
  return { name, commanders, library };
}

const MOXFIELD_JSON = (id: string) => `https://api2.moxfield.com/v3/decks/all/${id}`;
const MOXFIELD_EXPORT = (id: string) =>
  `https://api2.moxfield.com/v2/decks/all/${id}/export?format=full`;

export async function fetchMoxfieldDeck(
  fetchImpl: HttpFetch,
  urlOrId: string,
): Promise<ParsedDecklist> {
  const publicId = parseMoxfieldPublicId(urlOrId);
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    Accept: "application/json,text/plain,*/*",
    Referer: "https://www.moxfield.com/",
  };
  try {
    const payload = await fetchJson(fetchImpl, MOXFIELD_JSON(publicId), { headers });
    return parseMoxfieldDeckJson(payload);
  } catch (jsonError) {
    const response = await fetchImpl(MOXFIELD_EXPORT(publicId), {
      headers: { ...headers, Accept: "text/plain", "User-Agent": SCRYFALL_USER_AGENT },
    });
    if (!response.ok) {
      const message = jsonError instanceof Error ? jsonError.message : "Moxfield JSON failed";
      throw new Error(`Could not load Moxfield deck ${publicId}: ${message}`);
    }
    return parseTextDecklist(await response.text());
  }
}
