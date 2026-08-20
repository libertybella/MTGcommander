import { describe, expect, it } from "vitest";
import { CardDatabase } from "./cards";
import { compileParsedDeck, importTextDeck, startImportedTable } from "./importDeck";
import { parseMoxfieldDeckJson, fetchMoxfieldDeck } from "./moxfield";
import { oracleCardFromScryfall } from "./scryfall";
import type { HttpFetch } from "./http";
import type { SnapshotStore } from "./persist";
import type { OracleCard } from "@mtgcommander/engine";

function memoryStore(): SnapshotStore {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

function forest(): OracleCard {
  return {
    oracleId: "forest",
    name: "Forest",
    manaCost: "",
    typeLine: "Basic Land — Forest",
    oracleText: "{T}: Add {G}.",
    power: null,
    toughness: null,
    printedKeywords: [],
  };
}

function solRing(): OracleCard {
  return {
    oracleId: "sol",
    name: "Sol Ring",
    manaCost: "{1}",
    typeLine: "Artifact",
    oracleText: "{T}: Add {C}{C}.",
    power: null,
    toughness: null,
    printedKeywords: [],
  };
}

function atraxa(): OracleCard {
  return {
    oracleId: "atraxa",
    name: "Atraxa, Praetors' Voice",
    manaCost: "{G}{W}{U}{B}",
    typeLine: "Legendary Creature — Phyrexian Angel Horror",
    oracleText: "Flying, vigilance, deathtouch, lifelink",
    power: "4",
    toughness: "4",
    printedKeywords: ["Flying", "Vigilance", "Deathtouch", "Lifelink"],
  };
}

describe("scryfall mapping", () => {
  it("maps a Scryfall payload onto OracleCard", () => {
    const card = oracleCardFromScryfall({
      oracle_id: "abc",
      name: "Lightning Bolt",
      mana_cost: "{R}",
      type_line: "Instant",
      oracle_text: "Lightning Bolt deals 3 damage to any target.",
      keywords: [],
      power: null,
      toughness: null,
    });
    expect(card.name).toBe("Lightning Bolt");
    expect(card.manaCost).toBe("{R}");
  });

  it("keeps both faces of a modal double-faced card", () => {
    const card = oracleCardFromScryfall({
      oracle_id: "pathway",
      name: "Clearwater Pathway // Murkwater Pathway",
      layout: "modal_dfc",
      keywords: [],
      card_faces: [
        {
          name: "Clearwater Pathway",
          mana_cost: "",
          type_line: "Land",
          oracle_text: "{T}: Add {U}.",
          power: null,
          toughness: null,
        },
        {
          name: "Murkwater Pathway",
          mana_cost: "",
          type_line: "Land",
          oracle_text: "{T}: Add {B}.",
          power: null,
          toughness: null,
        },
      ],
    });
    expect(card.layout).toBe("modal_dfc");
    expect(card.faces).toHaveLength(2);
    expect(card.faces?.[1]?.name).toBe("Murkwater Pathway");
    expect(card.oracleText).toBe("{T}: Add {U}.");
  });
});

describe("card database", () => {
  it("caches, searches, and persists oracle cards", () => {
    const store = memoryStore();
    const fetchImpl: HttpFetch = async () => {
      throw new Error("network should not run");
    };
    const db = new CardDatabase(fetchImpl, store);
    db.put(forest());
    expect(db.search("for").map((card) => card.name)).toEqual(["Forest"]);
    const restored = new CardDatabase(fetchImpl, store);
    expect(restored.getCached("Forest")?.oracleId).toBe("forest");
  });

  it("looks up a modal DFC by either face name after reload", () => {
    const store = memoryStore();
    const fetchImpl: HttpFetch = async () => {
      throw new Error("network should not run");
    };
    const db = new CardDatabase(fetchImpl, store);
    db.put({
      oracleId: "path",
      name: "Riverglide Pathway // Lavaglide Pathway",
      manaCost: "",
      typeLine: "Land",
      oracleText: "{T}: Add {U}.",
      power: null,
      toughness: null,
      printedKeywords: [],
      layout: "modal_dfc",
      faces: [
        {
          name: "Riverglide Pathway",
          manaCost: "",
          typeLine: "Land",
          oracleText: "{T}: Add {U}.",
          power: null,
          toughness: null,
        },
        {
          name: "Lavaglide Pathway",
          manaCost: "",
          typeLine: "Land",
          oracleText: "{T}: Add {R}.",
          power: null,
          toughness: null,
        },
      ],
    });
    const restored = new CardDatabase(fetchImpl, store);
    expect(restored.getCached("Riverglide Pathway")?.faces?.[1]?.name).toBe("Lavaglide Pathway");
    expect(restored.getCached("Lavaglide Pathway")?.layout).toBe("modal_dfc");
  });
});

describe("moxfield", () => {
  it("parses v3 boards JSON", () => {
    const parsed = parseMoxfieldDeckJson({
      name: "Demo",
      boards: {
        commanders: {
          cards: {
            a: { quantity: 1, card: { name: "Atraxa, Praetors' Voice" } },
          },
        },
        mainboard: {
          cards: {
            b: { quantity: 1, card: { name: "Sol Ring" } },
            c: { quantity: 2, card: { name: "Forest" } },
          },
        },
      },
    });
    expect(parsed.name).toBe("Demo");
    expect(parsed.commanders).toEqual([{ name: "Atraxa, Praetors' Voice", quantity: 1 }]);
    expect(parsed.library).toEqual([
      { name: "Sol Ring", quantity: 1 },
      { name: "Forest", quantity: 2 },
    ]);
  });

  it("parses v2 top-level commanders and mainboard", () => {
    const parsed = parseMoxfieldDeckJson({
      commanders: { x: { quantity: 1, card: { name: "Atraxa, Praetors' Voice" } } },
      mainboard: { y: { quantity: 1, card: { name: "Sol Ring" } } },
    });
    expect(parsed.commanders[0]?.name).toBe("Atraxa, Praetors' Voice");
    expect(parsed.library[0]?.name).toBe("Sol Ring");
  });

  it("fetches a Moxfield URL through the JSON endpoint", async () => {
    const fetchImpl: HttpFetch = async (url) => {
      expect(url).toContain("/v3/decks/all/AbC123");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          name: "Demo",
          commanders: { a: { quantity: 1, card: { name: "Atraxa, Praetors' Voice" } } },
          mainboard: { b: { quantity: 1, card: { name: "Forest" } } },
        }),
        text: async () => "",
      };
    };
    const deck = await fetchMoxfieldDeck(
      fetchImpl,
      "https://www.moxfield.com/decks/AbC123",
    );
    expect(deck.commanders[0]?.name).toBe("Atraxa, Praetors' Voice");
  });
});

describe("deck import", () => {
  it("compiles a text list from the cache and starts a table", async () => {
    const db = new CardDatabase(async () => {
      throw new Error("network should not run");
    });
    db.put(atraxa());
    db.put(solRing());
    db.put(forest());
    const imported = await importTextDeck(
      db,
      `Commander\n1 Atraxa, Praetors' Voice\nDeck\n1 Sol Ring\n3 Forest\n`,
    );
    expect(imported.compiled.commanderDefinitionIds).toHaveLength(1);
    expect(imported.compiled.libraryDefinitionIds).toHaveLength(4);
    const table = startImportedTable({
      decks: [imported.compiled, imported.compiled],
      random: () => 0,
    });
    expect(table.state.players[0]?.zones.command).toHaveLength(1);
    expect(table.state.players[0]?.zones.hand.length).toBe(4);
    expect(table.state.definitions[imported.compiled.libraryDefinitionIds[0] ?? ""]?.name).toBeTruthy();
  });

  it("starts a three-player imported table from mirrored decks", async () => {
    const db = new CardDatabase(async () => {
      throw new Error("network should not run");
    });
    db.put(atraxa());
    db.put(solRing());
    db.put(forest());
    const imported = await importTextDeck(
      db,
      `Commander\n1 Atraxa, Praetors' Voice\nDeck\n1 Sol Ring\n3 Forest\n`,
    );
    const table = startImportedTable({
      decks: [imported.compiled, imported.compiled, imported.compiled],
      random: () => 0,
    });
    expect(table.state.players).toHaveLength(3);
    expect(table.state.players.map((player) => player.displayName)).toEqual([
      "Player 1",
      "Player 2",
      "Player 3",
    ]);
    expect(table.state.players.every((player) => player.zones.command.length === 1)).toBe(true);
  });

  it("keeps compile notes for spells with uncompiled oracle text", () => {
    const bolt: OracleCard = {
      oracleId: "bolt",
      name: "Lightning Bolt",
      manaCost: "{R}",
      typeLine: "Instant",
      oracleText: "The Ring tempts you.",
      power: null,
      toughness: null,
      printedKeywords: [],
    };
    const compiled = compileParsedDeck(
      {
        name: "Bolts",
        commanders: [{ name: "Atraxa, Praetors' Voice", quantity: 1 }],
        library: [{ name: "Lightning Bolt", quantity: 1 }],
      },
      [atraxa(), bolt],
    );
    expect(compiled.notes.some((entry) => entry.name === "Lightning Bolt")).toBe(true);
  });
});
