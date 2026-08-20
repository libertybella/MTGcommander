import { describe, expect, it } from "vitest";
import {
  colorsFromManaCost,
  deriveCharacteristics,
  manaValueOf,
  parseTypeLine,
} from "./characteristics";
import { createCardDefinition } from "./createGame";
import { parseGameState, serializeGameState } from "./serialize";
import { createGameState } from "./createGame";

describe("parseTypeLine (CR 205)", () => {
  it("splits supertypes, card types, and subtypes", () => {
    expect(parseTypeLine("Legendary Creature — Sliver")).toEqual({
      supertypes: ["legendary"],
      types: ["creature"],
      subtypes: ["sliver"],
    });
  });

  it("reads basic land subtypes", () => {
    expect(parseTypeLine("Basic Land — Island")).toEqual({
      supertypes: ["basic"],
      types: ["land"],
      subtypes: ["island"],
    });
  });

  it("keeps multiple types and multiple subtypes", () => {
    expect(parseTypeLine("Artifact Creature — Golem Warrior")).toEqual({
      supertypes: [],
      types: ["artifact", "creature"],
      subtypes: ["golem", "warrior"],
    });
  });

  it("treats Class as an enchantment subtype", () => {
    const parsed = parseTypeLine("Enchantment — Class");
    expect(parsed.types).toEqual(["enchantment"]);
    expect(parsed.subtypes).toEqual(["class"]);
  });

  it("accepts a spaced hyphen as the dash", () => {
    expect(parseTypeLine("Creature - Bear")).toEqual({
      supertypes: [],
      types: ["creature"],
      subtypes: ["bear"],
    });
  });

  it("parses the front half of a combined double-faced line", () => {
    expect(parseTypeLine("Land — Island // Land — Mountain").subtypes).toEqual(["island"]);
  });

  it("handles a bare type line with no dash", () => {
    expect(parseTypeLine("Instant")).toEqual({
      supertypes: [],
      types: ["instant"],
      subtypes: [],
    });
  });
});

describe("colorsFromManaCost", () => {
  it("reads simple pips in WUBRG order", () => {
    expect(colorsFromManaCost("{2}{U}{W}")).toEqual(["W", "U"]);
  });

  it("reads hybrid and Phyrexian pips", () => {
    expect(colorsFromManaCost("{W/U}")).toEqual(["W", "U"]);
    expect(colorsFromManaCost("{2/G}")).toEqual(["G"]);
    expect(colorsFromManaCost("{B/P}")).toEqual(["B"]);
  });

  it("returns no colors for generic or colorless costs", () => {
    expect(colorsFromManaCost("{3}")).toEqual([]);
    expect(colorsFromManaCost("{C}{C}")).toEqual([]);
    expect(colorsFromManaCost("")).toEqual([]);
  });
});

describe("manaValueOf (CR 203.3)", () => {
  it("sums numbers and pips", () => {
    expect(manaValueOf("{2}{U}{U}")).toBe(4);
    expect(manaValueOf("{W}")).toBe(1);
    expect(manaValueOf("")).toBe(0);
  });

  it("counts X as zero", () => {
    expect(manaValueOf("{X}{R}")).toBe(1);
  });

  it("counts monocolored hybrid at its highest option", () => {
    expect(manaValueOf("{2/W}{2/W}")).toBe(4);
    expect(manaValueOf("{W/U}")).toBe(1);
  });

  it("counts Phyrexian pips as one", () => {
    expect(manaValueOf("{G/P}{G/P}")).toBe(2);
  });
});

describe("deriveCharacteristics", () => {
  it("prefers explicit colors over cost-derived colors", () => {
    const derived = deriveCharacteristics("Creature — Human Wizard", "", ["U"]);
    expect(derived.colors).toEqual(["U"]);
  });

  it("normalizes explicit colors into WUBRG order", () => {
    const derived = deriveCharacteristics("Instant", "", ["G", "W"]);
    expect(derived.colors).toEqual(["W", "G"]);
  });
});

describe("definitions carry characteristics", () => {
  it("createCardDefinition populates structured characteristics", () => {
    const definition = createCardDefinition({
      name: "Test Commander",
      typeLine: "Legendary Creature — Dragon",
      manaCost: "{3}{R}{R}",
    });
    expect(definition.characteristics).toEqual({
      supertypes: ["legendary"],
      types: ["creature"],
      subtypes: ["dragon"],
      colors: ["R"],
      manaValue: 5,
    });
  });

  it("characteristics survive a serialize/parse round trip", () => {
    const state = createGameState({ playerCount: 2 });
    const definition = createCardDefinition({
      name: "Test Sliver",
      typeLine: "Creature — Sliver",
      manaCost: "{W}{U}",
    });
    state.definitions[definition.id] = definition;
    const parsed = parseGameState(serializeGameState(state));
    expect(parsed.definitions[definition.id]?.characteristics).toEqual(definition.characteristics);
  });

  it("a snapshot without characteristics re-derives them on parse", () => {
    const state = createGameState({ playerCount: 2 });
    const definition = createCardDefinition({
      name: "Test Relic",
      typeLine: "Legendary Artifact",
      manaCost: "{1}",
    });
    state.definitions[definition.id] = definition;
    const raw = JSON.parse(serializeGameState(state)) as {
      definitions: Record<string, { characteristics?: unknown }>;
    };
    delete raw.definitions[definition.id]?.characteristics;
    const parsed = parseGameState(JSON.stringify(raw));
    expect(parsed.definitions[definition.id]?.characteristics).toEqual({
      supertypes: ["legendary"],
      types: ["artifact"],
      subtypes: [],
      colors: [],
      manaValue: 1,
    });
  });

  it("explicit colors survive the round trip through stored characteristics", () => {
    const state = createGameState({ playerCount: 2 });
    const definition = createCardDefinition({
      name: "Test Back Face",
      typeLine: "Creature — Spirit",
      manaCost: "",
      colors: ["B"],
    });
    state.definitions[definition.id] = definition;
    const parsed = parseGameState(serializeGameState(state));
    expect(parsed.definitions[definition.id]?.characteristics.colors).toEqual(["B"]);
  });
});
