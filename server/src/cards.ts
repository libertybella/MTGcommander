import { normalizeCardName, type OracleCard } from "@mtgcommander/engine";
import type { SnapshotStore } from "./persist";
import { fetchOracleCardsByName } from "./scryfall";
import type { HttpFetch } from "./http";

export const ORACLE_CACHE_KEY = "mtgcommander.oracle.v4";
export const LEGACY_ORACLE_CACHE_KEY = "mtgcommander.oracle.v3";

/**
 * Cards are cached with the time they were fetched so Oracle errata — the
 * mechanism WotC uses for retroactive card changes — actually reaches the
 * compiler. A card older than `maxAgeDays` is refreshed on next use; if the
 * refresh fails (offline), the stale copy still plays.
 */
export const DEFAULT_MAX_AGE_DAYS = 30;

type CacheFileV4 = {
  version: 4;
  /** Scryfall bulk `updated_at` from the last ingestBulk, if any. */
  bulkUpdatedAt: string | null;
  cards: Record<string, OracleCard>;
  fetchedAt: Record<string, string>;
};

type CacheFileV3 = {
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

export type CardDatabaseOptions = {
  /** Injected clock for deterministic tests. */
  now?: () => Date;
  maxAgeDays?: number;
};

export class CardDatabase {
  private cards = new Map<string, OracleCard>();
  private fetchedAt = new Map<string, string>();
  private bulkUpdatedAt: string | null = null;
  private readonly now: () => Date;
  private readonly maxAgeMs: number;

  constructor(
    private readonly fetchImpl: HttpFetch,
    private readonly store?: SnapshotStore,
    options: CardDatabaseOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.maxAgeMs = (options.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS) * 24 * 60 * 60 * 1000;
    this.readStore();
  }

  getCached(name: string): OracleCard | null {
    return this.cards.get(normalizeCardName(name)) ?? null;
  }

  allCached(): OracleCard[] {
    return [...new Set(this.cards.values())];
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
    this.indexCard(card, this.now().toISOString());
    this.writeStore();
  }

  /**
   * Ingest a Scryfall bulk "Oracle Cards" download. Every entry is stamped
   * fresh and the bulk's updated_at is recorded so callers can decide when a
   * new bulk is worth downloading.
   */
  ingestBulk(cards: OracleCard[], updatedAt: string): void {
    const stamp = this.now().toISOString();
    for (const card of cards) {
      this.indexCard(card, stamp);
    }
    this.bulkUpdatedAt = updatedAt;
    this.writeStore();
  }

  cacheInfo(): { count: number; bulkUpdatedAt: string | null; oldestFetch: string | null } {
    let oldest: string | null = null;
    for (const stamp of this.fetchedAt.values()) {
      if (oldest === null || stamp < oldest) {
        oldest = stamp;
      }
    }
    return { count: this.allCached().length, bulkUpdatedAt: this.bulkUpdatedAt, oldestFetch: oldest };
  }

  isStale(name: string): boolean {
    const key = normalizeCardName(name);
    if (!this.cards.has(key)) {
      return true;
    }
    const stamp = this.fetchedAt.get(key);
    if (!stamp) {
      return true;
    }
    const age = this.now().getTime() - new Date(stamp).getTime();
    return !(age >= 0 && age <= this.maxAgeMs);
  }

  async resolveNames(names: string[]): Promise<{ cards: OracleCard[]; missing: string[] }> {
    const found: OracleCard[] = [];
    const needed: string[] = [];
    const staleFallback = new Map<string, OracleCard>();
    for (const name of names) {
      const cached = this.getCached(name);
      const usable = cached && !isIncompleteDfc(cached);
      if (usable && !this.isStale(name)) {
        found.push(cached);
        continue;
      }
      if (usable) {
        staleFallback.set(normalizeCardName(name), cached);
      }
      needed.push(name);
    }
    if (needed.length === 0) {
      return { cards: found, missing: [] };
    }
    let fetched: { cards: OracleCard[]; missing: string[] };
    try {
      fetched = await fetchOracleCardsByName(this.fetchImpl, needed);
    } catch (error) {
      if (staleFallback.size === needed.length) {
        return { cards: [...found, ...staleFallback.values()], missing: [] };
      }
      throw error;
    }
    const stamp = this.now().toISOString();
    const refreshed = new Set<string>();
    for (const card of fetched.cards) {
      this.indexCard(card, stamp);
      refreshed.add(normalizeCardName(card.name));
      found.push(card);
    }
    this.writeStore();
    const missing: string[] = [];
    for (const name of fetched.missing) {
      const fallback = staleFallback.get(normalizeCardName(name));
      if (fallback) {
        found.push(fallback);
      } else {
        missing.push(name);
      }
    }
    for (const [key, card] of staleFallback) {
      if (!refreshed.has(key) && !fetched.missing.some((name) => normalizeCardName(name) === key)) {
        found.push(card);
      }
    }
    return { cards: found, missing };
  }

  private indexCard(card: OracleCard, stamp: string): void {
    const primary = normalizeCardName(card.name);
    this.cards.set(primary, card);
    this.fetchedAt.set(primary, stamp);
    const front = card.name.split(" // ")[0];
    if (front && front !== card.name) {
      this.cards.set(normalizeCardName(front), card);
      this.fetchedAt.set(normalizeCardName(front), stamp);
    }
    for (const face of card.faces ?? []) {
      this.cards.set(normalizeCardName(face.name), card);
      this.fetchedAt.set(normalizeCardName(face.name), stamp);
    }
  }

  private readStore(): void {
    if (!this.store) {
      return;
    }
    const raw = this.store.getItem(ORACLE_CACHE_KEY);
    if (raw && this.readV4(raw)) {
      return;
    }
    const legacy = this.store.getItem(LEGACY_ORACLE_CACHE_KEY);
    if (!legacy) {
      return;
    }
    try {
      const parsed: unknown = JSON.parse(legacy);
      if (typeof parsed !== "object" || parsed === null) {
        return;
      }
      const file = parsed as CacheFileV3;
      if (file.version !== 3 || typeof file.cards !== "object" || file.cards === null) {
        return;
      }
      // Migrate v3 entries with an epoch stamp: usable offline, but stale,
      // so each card refreshes the next time it is imported online.
      for (const card of Object.values(file.cards)) {
        if (card && typeof card.name === "string") {
          this.indexCard(card, new Date(0).toISOString());
        }
      }
      this.writeStore();
    } catch {
      // Ignore a corrupt legacy cache and start empty.
    }
  }

  private readV4(raw: string): boolean {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null) {
        return false;
      }
      const file = parsed as CacheFileV4;
      if (file.version !== 4 || typeof file.cards !== "object" || file.cards === null) {
        return false;
      }
      const stamps = typeof file.fetchedAt === "object" && file.fetchedAt !== null ? file.fetchedAt : {};
      for (const [key, card] of Object.entries(file.cards)) {
        if (card && typeof card.name === "string") {
          this.cards.set(key, card);
          this.fetchedAt.set(key, stamps[key] ?? new Date(0).toISOString());
        }
      }
      this.bulkUpdatedAt = typeof file.bulkUpdatedAt === "string" ? file.bulkUpdatedAt : null;
      return true;
    } catch {
      return false;
    }
  }

  private writeStore(): void {
    if (!this.store) {
      return;
    }
    const cards: Record<string, OracleCard> = {};
    const fetchedAt: Record<string, string> = {};
    for (const [key, card] of this.cards) {
      cards[key] = card;
      const stamp = this.fetchedAt.get(key);
      if (stamp) {
        fetchedAt[key] = stamp;
      }
    }
    this.store.setItem(
      ORACLE_CACHE_KEY,
      JSON.stringify({
        version: 4,
        bulkUpdatedAt: this.bulkUpdatedAt,
        cards,
        fetchedAt,
      } satisfies CacheFileV4),
    );
  }
}
