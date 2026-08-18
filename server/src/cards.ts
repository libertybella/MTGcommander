import { normalizeCardName, type OracleCard } from "@mtgcommander/engine";
import type { SnapshotStore } from "./persist";
import { fetchOracleCardsByName } from "./scryfall";
import type { HttpFetch } from "./http";

export const ORACLE_CACHE_KEY = "mtgcommander.oracle.v3";

type CacheFile = {
  version: 3;
  cards: Record<string, OracleCard>;
};

function isIncompleteDfc(card: OracleCard): boolean {
  const layout = (card.layout ?? "").toLowerCase();
  if (layout !== "modal_dfc" && layout !== "transform") {
    return false;
  }
  return !card.faces || card.faces.length < 2;
}

export class CardDatabase {
  private cards = new Map<string, OracleCard>();

  constructor(
    private readonly fetchImpl: HttpFetch,
    private readonly store?: SnapshotStore,
  ) {
    this.readStore();
  }

  getCached(name: string): OracleCard | null {
    return this.cards.get(normalizeCardName(name)) ?? null;
  }

  allCached(): OracleCard[] {
    return [...this.cards.values()];
  }

  search(query: string, limit = 20): OracleCard[] {
    const needle = normalizeCardName(query);
    if (!needle) {
      return [];
    }
    return this.allCached()
      .filter((card) => normalizeCardName(card.name).includes(needle))
      .slice(0, limit);
  }

  put(card: OracleCard): void {
    this.indexCard(card);
    this.writeStore();
  }

  async resolveNames(names: string[]): Promise<{ cards: OracleCard[]; missing: string[] }> {
    const found: OracleCard[] = [];
    const needed: string[] = [];
    for (const name of names) {
      const cached = this.getCached(name);
      if (cached && !isIncompleteDfc(cached)) {
        found.push(cached);
      } else {
        needed.push(name);
      }
    }
    if (needed.length === 0) {
      return { cards: found, missing: [] };
    }
    const fetched = await fetchOracleCardsByName(this.fetchImpl, needed);
    for (const card of fetched.cards) {
      this.put(card);
      found.push(card);
    }
    return { cards: found, missing: fetched.missing };
  }

  private indexCard(card: OracleCard): void {
    this.cards.set(normalizeCardName(card.name), card);
    const front = card.name.split(" // ")[0];
    if (front && front !== card.name) {
      this.cards.set(normalizeCardName(front), card);
    }
    for (const face of card.faces ?? []) {
      this.cards.set(normalizeCardName(face.name), card);
    }
  }

  private readStore(): void {
    if (!this.store) {
      return;
    }
    const raw = this.store.getItem(ORACLE_CACHE_KEY);
    if (!raw) {
      return;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null) {
        return;
      }
      const file = parsed as CacheFile;
      if (file.version !== 3 || typeof file.cards !== "object" || file.cards === null) {
        return;
      }
      for (const card of Object.values(file.cards)) {
        if (card && typeof card.name === "string") {
          this.indexCard(card);
        }
      }
    } catch {
      // Ignore a corrupt cache and start empty.
    }
  }

  private writeStore(): void {
    if (!this.store) {
      return;
    }
    const cards: Record<string, OracleCard> = {};
    for (const [key, card] of this.cards) {
      cards[key] = card;
    }
    this.store.setItem(ORACLE_CACHE_KEY, JSON.stringify({ version: 3, cards } satisfies CacheFile));
  }
}
