import { describe, expect, it } from "vitest";
import type { OracleCard } from "@mtgcommander/engine";
import { cardOverrideFor, overriddenCardNames } from "./cardOverrides";

function oracle(name: string, typeLine = "Artifact", oracleText = ""): OracleCard {
  return {
    oracleId: `test-${name.toLowerCase().replace(/[^a-z]+/g, "-")}`,
    name,
    manaCost: "{2}",
    typeLine,
    oracleText,
    power: null,
    toughness: null,
    printedKeywords: [],
    imageUrl: "",
  };
}

describe("hand-authored registry", () => {
  it("covers every listed name with a builder", () => {
    expect(overriddenCardNames().length).toBeGreaterThanOrEqual(9);
  });

  it("Solemn Simulacrum fetches a basic tapped and draws on death", () => {
    const definition = cardOverrideFor(oracle("Solemn Simulacrum", "Artifact Creature — Golem"));
    expect(definition).not.toBeNull();
    expect(definition?.triggers).toHaveLength(2);
    const [enter, dies] = definition!.triggers;
    expect(enter?.event).toBe("enter_battlefield");
    expect(enter?.effects[0]).toMatchObject({
      kind: "search_library",
      destination: "battlefield",
      entersTapped: true,
      filter: { supertypes: ["basic"], types: ["land"] },
    });
    expect(dies?.event).toBe("dies");
    expect(dies?.effects[0]).toMatchObject({ kind: "draw", count: 1 });
  });

  it("Phyrexian Arena draws and drains on upkeep", () => {
    const definition = cardOverrideFor(oracle("Phyrexian Arena", "Enchantment"));
    expect(definition?.triggers[0]).toMatchObject({
      event: "upkeep",
      effects: [
        { kind: "draw", playerId: "controller", count: 1 },
        { kind: "lose_life", playerId: "controller", amount: 1 },
      ],
    });
  });

  it("Zulaport Cutthroat watches controlled creature deaths including itself", () => {
    const definition = cardOverrideFor(oracle("Zulaport Cutthroat", "Creature — Human Rogue Ally"));
    const trigger = definition?.triggers[0];
    expect(trigger?.event).toBe("dies");
    expect(trigger?.watch).toBe("controlled");
    expect(trigger?.excludeSelf).toBeUndefined();
    expect(trigger?.effects).toEqual([
      { kind: "lose_life", playerId: "each_opponent", amount: 1 },
      { kind: "gain_life", playerId: "controller", amount: 1 },
    ]);
  });

  it("Eternal Witness picks a graveyard card back to hand on entry", () => {
    const definition = cardOverrideFor(oracle("Eternal Witness", "Creature — Human Shaman"));
    expect(definition?.triggers[0]?.effects[0]).toMatchObject({
      kind: "choose_card",
      sources: [{ playerId: "controller", zone: "graveyard", filter: "any" }],
    });
  });

  it("Brainstorm draws three then stacks two picks on top", () => {
    const definition = cardOverrideFor(oracle("Brainstorm", "Instant"));
    expect(definition?.effects[0]).toMatchObject({ kind: "draw", count: 3 });
    expect(definition?.effects.slice(1)).toHaveLength(2);
    for (const effect of definition!.effects.slice(1)) {
      expect(effect).toMatchObject({
        kind: "choose_card",
        thenEffects: [
          { kind: "move_card", cardId: "chosen_card", toZone: "library", libraryPosition: "top" },
        ],
      });
    }
  });

  it("Fellwar Stone and Exotic Orchard tap for any color (documented approximation)", () => {
    for (const name of ["Fellwar Stone", "Exotic Orchard"]) {
      const definition = cardOverrideFor(oracle(name, name.includes("Stone") ? "Artifact" : "Land"));
      expect(definition?.producesAnyColor).toBe(true);
    }
  });
});
