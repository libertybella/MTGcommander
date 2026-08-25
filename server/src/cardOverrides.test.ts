import { describe, expect, it } from "vitest";
import { compileOracleCard, type OracleCard } from "@mtgcommander/engine";
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

/**
 * The registry is a last resort, not a shelf. These tests exist to keep it
 * one: an entry is justified only while the compiler cannot read the card,
 * and an override shadows the compiler completely — the compile-rate metric
 * counts an overridden card as full by construction, so a stale entry hides
 * in two places at once.
 */
describe("hand-authored registry", () => {
  it("holds only what the compiler still cannot read", () => {
    // Wave 363 took this from 22 entries to 1. If it grows again, each new
    // entry needs its own reason, and the reason has to expire.
    expect(overriddenCardNames()).toEqual([expect.stringContaining("brainstorm")]);
  });

  it("Brainstorm draws three and puts two back on top", () => {
    const definition = cardOverrideFor(oracle("Brainstorm", "Instant"));
    expect(definition).not.toBeNull();
    expect(definition?.effects[0]).toMatchObject({ kind: "draw", count: 3 });
    // Two sequential hand picks: "in any order" is the order you pick them.
    expect(definition?.effects[1]).toMatchObject({ kind: "choose_card" });
    expect(definition?.effects[2]).toMatchObject({ kind: "choose_card" });
  });

  it("has nothing to say about a card the compiler reads", () => {
    expect(cardOverrideFor(oracle("Divination", "Sorcery", "Draw two cards."))).toBeNull();
  });
});

/**
 * The cards wave 363 handed back to the compiler. Each of these was an
 * override until the compiler could do better, and in every case below the
 * override was a DOCUMENTED APPROXIMATION that played a stronger card than
 * the printed one. These assert the difference, so nobody re-adds them.
 */
describe("retired overrides now read by the compiler", () => {
  const compiled = (
    name: string,
    typeLine: string,
    oracleText: string,
    manaCost = "{2}",
    pt: [string, string] | null = null,
  ) =>
    compileOracleCard({
      ...oracle(name, typeLine, oracleText),
      manaCost,
      power: pt?.[0] ?? null,
      toughness: pt?.[1] ?? null,
    });

  it("Exotic Orchard taps for what an OPPONENT could produce, not any color", () => {
    const out = compiled(
      "Exotic Orchard",
      "Land",
      "{T}: Add one mana of any color that a land an opponent controls could produce.",
      "",
    );
    expect(out.notes).toEqual([]);
    // The override said `producesAnyColor: true` — a perfect any-colour
    // land, which is a much better card on an empty opposing board.
    expect(out.definition.producesAnyColor).toBe(false);
    expect(out.definition.manaAbilities[0]).toMatchObject({
      anyColorAmong: "opponent_lands",
    });
  });

  it("Fellwar Stone does the same, and is not an unconditional rock", () => {
    const out = compiled(
      "Fellwar Stone",
      "Artifact",
      "{T}: Add one mana of any color that a land an opponent controls could produce.",
    );
    expect(out.notes).toEqual([]);
    expect(out.definition.producesAnyColor).toBe(false);
    expect(out.definition.manaAbilities[0]).toMatchObject({
      anyColorAmong: "opponent_lands",
    });
  });

  it("a filter land taps for {C}, and its coloured mana costs a filter", () => {
    const out = compiled(
      "Mystic Gate",
      "Land",
      "{T}: Add {C}.\n{W/U}, {T}: Add {W}{W}, {W}{U}, or {U}{U}.",
      "",
    );
    expect(out.notes).toEqual([]);
    // The override listed C, W and U as free tap options, which is a
    // tri-land. The printed card gives {C} for free and asks for a hybrid
    // pip back before it gives two coloured mana.
    expect(out.definition.producesOptions).toEqual([]);
    expect(out.definition.manaAbilities[0]).toMatchObject({ produces: { C: 1 } });
    expect(out.definition.manaAbilities.length).toBeGreaterThan(1);
    expect(out.definition.manaAbilities[1]?.costMana).toBeTruthy();
  });

  it("Solemn Simulacrum's death draw is a MAY, not a mandate", () => {
    const out = compiled(
      "Solemn Simulacrum",
      "Artifact Creature — Golem",
      "When this creature enters, you may search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.\nWhen this creature dies, you may draw a card.",
      "{4}",
      ["2", "2"],
    );
    expect(out.notes).toEqual([]);
    const dies = out.definition.triggers.find((trigger) => trigger.event === "dies");
    // The override drew unconditionally. The engine's optional draw is
    // auto-taken but skipped when it would deck the player — which is the
    // difference between a Jens and a loss.
    expect(dies?.effects[0]).toMatchObject({ kind: "draw", optional: true });
  });

  it("Eternal Witness TARGETS the card it returns", () => {
    const out = compiled(
      "Eternal Witness",
      "Creature — Human Shaman",
      "When this creature enters, you may return target card from your graveyard to your hand.",
      "{1}{G}{G}",
      ["2", "1"],
    );
    expect(out.notes).toEqual([]);
    // The override modelled it as an untargeted choice, which ignores
    // every reason a card might not be a legal target.
    expect(out.definition.triggers[0]?.targetRequirements).toEqual([
      { kind: "own_graveyard_card" },
    ]);
  });

  it("still reads the plain ones it always did", () => {
    for (const [name, typeLine, text] of [
      ["Divination", "Sorcery", "Draw two cards."],
      ["Fabricate", "Sorcery", "Search your library for an artifact card, reveal it, put it into your hand, then shuffle."],
      ["Phyrexian Arena", "Enchantment", "At the beginning of your upkeep, you draw a card and you lose 1 life."],
    ] as const) {
      expect(compiled(name, typeLine, text).notes).toEqual([]);
    }
  });
});
