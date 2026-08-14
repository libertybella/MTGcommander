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

  it("lets Command Tower tap for any color", () => {
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
    const compiled = compileOracleCard(tower);
    expect(compiled.definition.producesAnyColor).toBe(true);
    expect(compiled.notes.some((note) => /color identity is not enforced/.test(note))).toBe(true);
  });

  it("copies printed keywords and power/toughness", () => {
    expect(keywordsFromOracle(dragon())).toEqual(["flying"]);
    const compiled = compileOracleCard(dragon());
    expect(compiled.definition.power).toBe(5);
    expect(compiled.definition.toughness).toBe(5);
    expect(compiled.definition.keywords).toContain("flying");
  });

  it("compiles a lone {T}: Draw a card ability", () => {
    const tome: OracleCard = {
      oracleId: "tome",
      name: "Tap Tome",
      manaCost: "{4}",
      typeLine: "Artifact",
      oracleText: "{T}: Draw a card.",
      power: null,
      toughness: null,
      printedKeywords: [],
    };
    const compiled = compileOracleCard(tome);
    expect(compiled.notes).toEqual([]);
    expect(compiled.definition.activated).toEqual([
      {
        tap: true,
        manaCost: "",
        targetRequirements: [],
        effects: [{ kind: "draw", playerId: "controller", count: 1 }],
      },
    ]);
  });

  it("compiles Lightning Bolt as targeted damage", () => {
    const compiled = compileOracleCard(bolt());
    expect(compiled.definition.targetRequirements).toEqual([{ kind: "player_or_creature" }]);
    expect(compiled.definition.effects).toEqual([
      {
        kind: "deal_damage",
        sourceId: "self",
        target: { type: "chosen", index: 0 },
        amount: 3,
      },
    ]);
    expect(compiled.notes).toEqual([]);
  });

  it("pays hybrid mana costs", () => {
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
    expect(compileOracleCard(hybrid).notes.some((note) => /cannot be paid/.test(note))).toBe(false);
    expect(compileOracleCard(hybrid).notes).toEqual([]);
  });

  it("compiles dual lands as a color choice, not both colors at once", () => {
    const shock: OracleCard = {
      oracleId: "breeding",
      name: "Breeding Pool",
      manaCost: "",
      typeLine: "Land — Forest Island",
      oracleText:
        "As Breeding Pool enters, you may pay 2 life. If you don't, it enters tapped.\n{T}: Add {G} or {U}.",
      power: null,
      toughness: null,
      printedKeywords: [],
    };
    const compiled = compileOracleCard(shock);
    expect(compiled.definition.produces).toEqual({});
    expect(compiled.definition.producesOptions).toEqual(["G", "U"]);
    expect(compiled.notes.some((note) => /not compiled/.test(note))).toBe(true);
  });

  it("compiles a cleric ETB, anthem, destroy, counter, and paid tap-draw", () => {
    const cleric = compileOracleCard({
      oracleId: "cleric",
      name: "Soul Warden",
      manaCost: "{W}",
      typeLine: "Creature — Human Cleric",
      oracleText: "Whenever another creature enters, you gain 1 life.",
      power: "1",
      toughness: "1",
      printedKeywords: [],
    });
    expect(cleric.definition.triggers).toEqual([]);
    expect(cleric.notes.some((note) => /not compiled/.test(note))).toBe(true);

    const etb = compileOracleCard({
      oracleId: "etb",
      name: "Test Cleric",
      manaCost: "{W}",
      typeLine: "Creature — Cleric",
      oracleText: "When Test Cleric enters, you gain 3 life.",
      power: "1",
      toughness: "1",
      printedKeywords: [],
    });
    expect(etb.definition.triggers).toEqual([
      {
        event: "enter_battlefield",
        effects: [{ kind: "gain_life", playerId: "controller", amount: 3 }],
      },
    ]);

    const lord = compileOracleCard({
      oracleId: "lord",
      name: "Honor of the Pure",
      manaCost: "{1}{W}",
      typeLine: "Enchantment",
      oracleText: "Creatures you control get +1/+1.",
      power: null,
      toughness: null,
      printedKeywords: [],
    });
    expect(lord.definition.staticModifiers).toEqual([
      { kind: "pt", selector: "controlled_creatures", power: 1, toughness: 1 },
    ]);

    const terror = compileOracleCard({
      oracleId: "terror",
      name: "Doom Blade",
      manaCost: "{1}{B}",
      typeLine: "Instant",
      oracleText: "Destroy target creature.",
      power: null,
      toughness: null,
      printedKeywords: [],
    });
    expect(terror.definition.targetRequirements).toEqual([{ kind: "creature" }]);

    const counter = compileOracleCard({
      oracleId: "counter",
      name: "Counterspell",
      manaCost: "{U}{U}",
      typeLine: "Instant",
      oracleText: "Counter target spell.",
      power: null,
      toughness: null,
      printedKeywords: [],
    });
    expect(counter.definition.effects[0]?.kind).toBe("counter_spell");

    const tome = compileOracleCard({
      oracleId: "jayemdae",
      name: "Jayemdae Tome",
      manaCost: "{4}",
      typeLine: "Artifact",
      oracleText: "{4}, {T}: Draw a card.",
      power: null,
      toughness: null,
      printedKeywords: [],
    });
    expect(tome.definition.activated).toEqual([
      {
        tap: true,
        manaCost: "{4}",
        targetRequirements: [],
        effects: [{ kind: "draw", playerId: "controller", count: 1 }],
      },
    ]);
  });
});
