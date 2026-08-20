import { normalizeCardName, type OracleCard } from "@mtgcommander/engine";
import { fetchJson, type HttpFetch } from "./http";

type ScryfallCard = {
  object?: string;
  oracle_id?: string;
  id?: string;
  name?: string;
  layout?: string;
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
  power?: string | null;
  toughness?: string | null;
  keywords?: string[];
  colors?: string[];
  image_uris?: { small?: string; normal?: string; large?: string };
  card_faces?: Array<{
    name?: string;
    mana_cost?: string;
    type_line?: string;
    oracle_text?: string;
    power?: string | null;
    toughness?: string | null;
    colors?: string[];
    image_uris?: { small?: string; normal?: string; large?: string };
  }>;
};

function faceImage(face: NonNullable<ScryfallCard["card_faces"]>[number] | undefined): string {
  return face?.image_uris?.normal ?? face?.image_uris?.small ?? "";
}

export function oracleCardFromScryfall(raw: unknown): OracleCard {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Invalid Scryfall card");
  }
  const card = raw as ScryfallCard;
  const face = card.card_faces?.[0];
  const name = card.name ?? face?.name;
  if (!name) {
    throw new Error("Scryfall card is missing a name");
  }
  const oracleId = card.oracle_id ?? card.id;
  if (!oracleId) {
    throw new Error(`Scryfall card ${name} is missing an oracle id`);
  }
  const faces = (card.card_faces ?? [])
    .map((entry) => {
      if (!entry.name || !entry.type_line) {
        return null;
      }
      return {
        name: entry.name,
        manaCost: entry.mana_cost ?? "",
        typeLine: entry.type_line,
        oracleText: entry.oracle_text ?? "",
        power: entry.power ?? null,
        toughness: entry.toughness ?? null,
        imageUrl: faceImage(entry),
        ...(Array.isArray(entry.colors) ? { colors: entry.colors.map(String) } : {}),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  return {
    oracleId,
    name,
    manaCost: face?.mana_cost ?? card.mana_cost ?? "",
    typeLine: face?.type_line ?? card.type_line ?? "",
    oracleText: face?.oracle_text ?? card.oracle_text ?? "",
    power: face?.power ?? card.power ?? null,
    toughness: face?.toughness ?? card.toughness ?? null,
    printedKeywords: Array.isArray(card.keywords) ? card.keywords.map(String) : [],
    ...(typeof (card as { loyalty?: unknown }).loyalty === "string"
      ? { loyalty: String((card as { loyalty?: unknown }).loyalty) }
      : {}),
    ...(Array.isArray(card.colors)
      ? { colors: card.colors.map(String) }
      : Array.isArray(face?.colors)
        ? { colors: face.colors.map(String) }
        : {}),
    imageUrl:
      card.image_uris?.normal ??
      card.image_uris?.small ??
      faceImage(face) ??
      "",
    ...(card.layout ? { layout: card.layout } : {}),
    ...(faces.length > 1 ? { faces } : {}),
  };
}

const COLLECTION_URL = "https://api.scryfall.com/cards/collection";
const NAMED_URL = "https://api.scryfall.com/cards/named";
const BATCH = 75;

export async function fetchOracleCardsByName(
  fetchImpl: HttpFetch,
  names: string[],
): Promise<{ cards: OracleCard[]; missing: string[] }> {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const key = normalizeCardName(name);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(name);
  }

  const cards: OracleCard[] = [];
  const missing: string[] = [];

  for (let offset = 0; offset < unique.length; offset += BATCH) {
    const batch = unique.slice(offset, offset + BATCH);
    const payload = await fetchJson(fetchImpl, COLLECTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identifiers: batch.map((name) => ({ name })),
      }),
    });
    if (typeof payload !== "object" || payload === null) {
      throw new Error("Invalid Scryfall collection response");
    }
    const record = payload as { data?: unknown[]; not_found?: Array<{ name?: string }> };
    for (const entry of record.data ?? []) {
      cards.push(oracleCardFromScryfall(entry));
    }
    for (const entry of record.not_found ?? []) {
      if (entry.name) {
        missing.push(entry.name);
      }
    }
  }

  const stillMissing: string[] = [];
  for (const name of missing) {
    try {
      const encoded = encodeURIComponent(name);
      const payload = await fetchJson(fetchImpl, `${NAMED_URL}?fuzzy=${encoded}`);
      cards.push(oracleCardFromScryfall(payload));
    } catch {
      stillMissing.push(name);
    }
  }

  return { cards, missing: stillMissing };
}
