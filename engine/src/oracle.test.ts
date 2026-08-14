import { describe, expect, it } from "vitest";
import {
  compileOracleCard,
  inferProduces,
  keywordsFromOracle,
  normalizeCardName,
  type OracleCard,
} from "./oracle";

function forest(): OracleCard {
  return {
    oracleId: "forest-id",
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
    oracleId: "sol-ring-id",
    name: "Sol Ring",
    manaCost: "{1}",
    typeLine: "Artifact",
    oracleText: "{T}: Add {C}{C}.",
    power: null,
    toughness: null,
    printedKeywords: [],
  };
}

function bolt(): OracleCard {
  return {
    oracleId: "bolt-id",
    name: "Lightning Bolt",
    manaCost: "{R}",
    typeLine: "Instant",
    oracleText: "Lightning Bolt deals 3 damage to any target.",
    power: null,
    toughness: null,
    printedKeywords: [],
  };
}

function dragon(): OracleCard {
  return {
    oracleId: "dragon-id",
    name: "Shivan Dragon",
    manaCost: "{4}{R}{R}",
    typeLine: "Creature — Dragon",
    oracleText: "Flying\n{R}: This creature gets +1/+0 until end of turn.",
    power: "5",
    toughness: "5",
    printedKeywords: ["Flying"],
  };
}

describe("oracle compile", () => {
  it("normalizes card names for lookup", () => {
    expect(normalizeCardName("  Sol  Ring ")).toBe("sol ring");
    expect(normalizeCardName("Lim-Dûl's Vault")).toBe("lim-dul's vault");
  });

  it("gives basic forests a green tap and no compile notes", () => {
    expect(inferProduces(forest())).toEqual({ G: 1 });
    const compiled = compileOracleCard(forest());
    expect(compiled.definition.produces).toEqual({ G: 1 });
    expect(compiled.notes).toEqual([]);
    expect(compiled.definition.id).toBe("oracle:forest-id");
  });

  it("lets Sol Ring tap for two colorless", () => {
    expect(inferProduces(solRing())).toEqual({ C: 2 });
    expect(compileOracleCard(solRing()).definition.produces).toEqual({ C: 2 });
  });

  it("does not invent mana for any-color lands", () => {
    const tower: OracleCard = {
      oracleId: "tower",
      name: "Command Tower",
      manaCost: "",
      typeLine: "Land",
      oracleText: "{T}: Add one mana of any color in your commander's color identity.",
      power: null,
      toughness: null,
      printedKeywords: [],
    };
    expect(inferProduces(tower)).toEqual({});
    expect(compileOracleCard(tower).notes.some((note) => /does not tap/.test(note))).toBe(true);
  });

  it("copies printed keywords and power/toughness", () => {
    expect(keywordsFromOracle(dragon())).toEqual(["flying"]);
    const compiled = compileOracleCard(dragon());
    expect(compiled.definition.power).toBe(5);
    expect(compiled.definition.toughness).toBe(5);
    expect(compiled.definition.keywords).toContain("flying");
  });

  it("notes that instants do not compile oracle text into effects", () => {
    const compiled = compileOracleCard(bolt());
    expect(compiled.definition.effects).toEqual([]);
    expect(compiled.notes.some((note) => /no effect/.test(note))).toBe(true);
  });

  it("notes unpayable hybrid costs", () => {
    const hybrid: OracleCard = {
      oracleId: "hybrid",
      name: "Boros Reckoner",
      manaCost: "{R/W}{R/W}{R/W}",
      typeLine: "Creature — Minotaur Wizard",
      oracleText: "",
      power: "3",
      toughness: "3",
      printedKeywords: [],
    };
    expect(compileOracleCard(hybrid).notes.some((note) => /cannot be paid/.test(note))).toBe(true);
  });
});
