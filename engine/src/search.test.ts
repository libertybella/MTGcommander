import { describe, expect, it } from "vitest";
import { applyAction } from "./actions";
import { compileOracleCard } from "./oracle";
import { createCardDefinition } from "./createGame";
import { currentPrompt, legalSearchIds } from "./prompt";
import { scenario } from "./scenario";
import type { CardDefinition, GameState } from "./types";

function evolvingWilds(): CardDefinition {
  const compiled = compileOracleCard({
    oracleId: "wilds",
    name: "Evolving Wilds",
    manaCost: "",
    typeLine: "Land",
    oracleText:
      "{T}, Sacrifice this land: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.",
    power: null,
    toughness: null,
    printedKeywords: [],
  });
  expect(compiled.notes).toEqual([]);
  return compiled.definition;
}

function seedLibrary(s: ReturnType<typeof scenario>, ownerId: string): {
  forest: string;
  bolt: string;
} {
  const forestDef = createCardDefinition({
    name: "Test Forest",
    typeLine: "Basic Land — Forest",
    produces: { G: 1 },
  });
  const boltDef = createCardDefinition({ name: "Test Bolt", typeLine: "Instant", manaCost: "{R}" });
  const forest = s.add(forestDef, ownerId, "library");
  const bolt = s.add(boltDef, ownerId, "library");
  return { forest, bolt };
}

describe("[CR 701.19] search and shuffle", () => {
  it("compiles a fetch land and resolves it: basic land arrives tapped, library shuffles", () => {
    const s = scenario();
    const me = s.players[0]!;
    s.mainPhase(me);
    const wilds = s.add(evolvingWilds(), me, "battlefield");
    const { forest, bolt } = seedLibrary(s, me);

    let state: GameState = applyAction(s.game, {
      kind: "activate_ability",
      playerId: me,
      cardId: wilds,
      abilityIndex: 0,
    });
    // Cost paid: Wilds sacrificed, ability resolved into a search prompt.
    expect(state.cards[wilds]?.zone).toBe("graveyard");
    const prompt = currentPrompt(state);
    expect(prompt).toMatchObject({ kind: "search_library", playerId: me, destination: "battlefield" });
    const legal = legalSearchIds(state, prompt!);
    expect(legal).toEqual([forest]);
    expect(legal).not.toContain(bolt);

    state = applyAction(state, { kind: "resolve_search", playerId: me, cardIds: [forest] });
    expect(state.cards[forest]?.zone).toBe("battlefield");
    expect(state.cards[forest]?.tapped).toBe(true);
    expect(currentPrompt(state)).toBeNull();
  });

  it("failing to find is legal", () => {
    const s = scenario();
    const me = s.players[0]!;
    s.mainPhase(me);
    const wilds = s.add(evolvingWilds(), me, "battlefield");
    seedLibrary(s, me);
    let state = applyAction(s.game, {
      kind: "activate_ability",
      playerId: me,
      cardId: wilds,
      abilityIndex: 0,
    });
    state = applyAction(state, { kind: "resolve_search", playerId: me, cardIds: [] });
    expect(currentPrompt(state)).toBeNull();
  });

  it("rejects fetching a card that does not match the filter", () => {
    const s = scenario();
    const me = s.players[0]!;
    s.mainPhase(me);
    const wilds = s.add(evolvingWilds(), me, "battlefield");
    const { bolt } = seedLibrary(s, me);
    const state = applyAction(s.game, {
      kind: "activate_ability",
      playerId: me,
      cardId: wilds,
      abilityIndex: 0,
    });
    expect(() =>
      applyAction(state, { kind: "resolve_search", playerId: me, cardIds: [bolt] }),
    ).toThrow(/does not match/);
  });

  it("compiles a tutor to hand", () => {
    const compiled = compileOracleCard({
      oracleId: "tutor",
      name: "Test Tutor",
      manaCost: "{1}{B}",
      typeLine: "Sorcery",
      oracleText: "Search your library for a card, put it into your hand, then shuffle.",
      power: null,
      toughness: null,
      printedKeywords: [],
    });
    expect(compiled.notes).toEqual([]);
    expect(compiled.definition.effects).toEqual([
      { kind: "search_library", playerId: "controller", filter: {}, destination: "hand", count: 1 },
    ]);
  });

  it("compiles a Forest-typed fetch (subtype filter)", () => {
    const compiled = compileOracleCard({
      oracleId: "ranger",
      name: "Test Ranger Sorcery",
      manaCost: "{G}",
      typeLine: "Sorcery",
      oracleText: "Search your library for a Forest card, put it onto the battlefield tapped, then shuffle.",
      power: null,
      toughness: null,
      printedKeywords: [],
    });
    expect(compiled.notes).toEqual([]);
    expect(compiled.definition.effects[0]).toMatchObject({
      kind: "search_library",
      filter: { subtypes: ["forest"] },
      destination: "battlefield",
      entersTapped: true,
    });
  });
});
