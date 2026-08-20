import { describe, expect, it } from "vitest";
import type { OracleCard } from "@mtgcommander/engine";
import { CardDatabase, LEGACY_ORACLE_CACHE_KEY, ORACLE_CACHE_KEY } from "./cards";
import type { SnapshotStore } from "./persist";
import type { HttpFetch } from "./http";

function memoryStore(): SnapshotStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

function oracle(name: string, oracleText = ""): OracleCard {
  return {
    oracleId: `id-${name.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    manaCost: "{1}",
    typeLine: "Instant",
    oracleText,
    power: null,
    toughness: null,
    printedKeywords: [],
  };
}

function scryfallShaped(card: OracleCard): unknown {
  return {
    oracle_id: card.oracleId,
    name: card.name,
    mana_cost: card.manaCost,
    type_line: card.typeLine,
    oracle_text: card.oracleText,
    keywords: [],
  };
}

function collectionFetch(
  cards: OracleCard[],
  log: string[] = [],
): HttpFetch {
  return async (url) => {
    log.push(url);
    const payload = { data: cards.map(scryfallShaped), not_found: [] };
    return {
      ok: true,
      status: 200,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    };
  };
}

const failingFetch: HttpFetch = async () => {
  throw new Error("offline");
};

describe("oracle cache refresh policy", () => {
  it("serves fresh cards without fetching", async () => {
    const store = memoryStore();
    const log: string[] = [];
    const database = new CardDatabase(collectionFetch([oracle("Shock")], log), store);
    database.put(oracle("Shock"));
    const resolved = await database.resolveNames(["Shock"]);
    expect(resolved.cards.map((card) => card.name)).toEqual(["Shock"]);
    expect(log).toEqual([]);
  });

  it("refetches a card older than the max age", async () => {
    const store = memoryStore();
    let clock = new Date("2026-01-01T00:00:00Z");
    const log: string[] = [];
    const updated = oracle("Shock", "Shock deals 2 damage to any target.");
    const database = new CardDatabase(collectionFetch([updated], log), store, {
      now: () => clock,
      maxAgeDays: 30,
    });
    database.put(oracle("Shock", "old text"));
    clock = new Date("2026-03-01T00:00:00Z");
    const resolved = await database.resolveNames(["Shock"]);
    expect(log.length).toBe(1);
    expect(resolved.cards[0]?.oracleText).toContain("2 damage");
    expect(database.getCached("Shock")?.oracleText).toContain("2 damage");
  });

  it("falls back to the stale copy when the refresh fails", async () => {
    const store = memoryStore();
    let clock = new Date("2026-01-01T00:00:00Z");
    const database = new CardDatabase(failingFetch, store, { now: () => clock, maxAgeDays: 30 });
    database.put(oracle("Shock", "old text"));
    clock = new Date("2026-06-01T00:00:00Z");
    const resolved = await database.resolveNames(["Shock"]);
    expect(resolved.missing).toEqual([]);
    expect(resolved.cards[0]?.oracleText).toBe("old text");
  });

  it("migrates a v3 cache and marks every card stale", () => {
    const store = memoryStore();
    store.setItem(
      LEGACY_ORACLE_CACHE_KEY,
      JSON.stringify({ version: 3, cards: { shock: oracle("Shock") } }),
    );
    const database = new CardDatabase(failingFetch, store);
    expect(database.getCached("Shock")?.name).toBe("Shock");
    expect(database.isStale("Shock")).toBe(true);
    expect(store.data.has(ORACLE_CACHE_KEY)).toBe(true);
  });

  it("ingests a bulk file, stamping cards fresh and recording updated_at", async () => {
    const store = memoryStore();
    const log: string[] = [];
    const database = new CardDatabase(collectionFetch([], log), store);
    database.ingestBulk([oracle("Shock"), oracle("Duress")], "2026-08-20T05:00:00Z");
    expect(database.cacheInfo()).toMatchObject({ count: 2, bulkUpdatedAt: "2026-08-20T05:00:00Z" });
    const resolved = await database.resolveNames(["Shock", "Duress"]);
    expect(resolved.cards).toHaveLength(2);
    expect(log).toEqual([]);
  });

  it("persists fetch stamps across instances", () => {
    const store = memoryStore();
    const clock = new Date("2026-01-01T00:00:00Z");
    const first = new CardDatabase(failingFetch, store, { now: () => clock });
    first.put(oracle("Shock"));
    const later = new CardDatabase(failingFetch, store, {
      now: () => new Date("2026-01-10T00:00:00Z"),
      maxAgeDays: 30,
    });
    expect(later.isStale("Shock")).toBe(false);
    const muchLater = new CardDatabase(failingFetch, store, {
      now: () => new Date("2026-04-01T00:00:00Z"),
      maxAgeDays: 30,
    });
    expect(muchLater.isStale("Shock")).toBe(true);
  });
});
