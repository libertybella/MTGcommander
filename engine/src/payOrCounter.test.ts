import { describe, expect, it } from "vitest";
import { applyAction } from "./actions";
import { compileOracleCard } from "./oracle";
import { createCardDefinition } from "./createGame";
import { currentPrompt } from "./prompt";
import { scenario } from "./scenario";
import type { CardDefinition, GameState, PlayerId } from "./types";

function spellPierce(): CardDefinition {
  const compiled = compileOracleCard({
    oracleId: "pierce",
    name: "Spell Pierce",
    manaCost: "{U}",
    typeLine: "Instant",
    oracleText: "Counter target noncreature spell unless its controller pays {2}.",
    power: null,
    toughness: null,
    printedKeywords: [],
  });
  expect(compiled.notes).toEqual([]);
  return compiled.definition;
}

function island(): CardDefinition {
  return createCardDefinition({
    name: "Test Island",
    typeLine: "Basic Land — Island",
    produces: { U: 1 },
  });
}

/** P1 casts a sorcery; P2 responds with Spell Pierce; both resolve down to the prompt. */
function pierceShowdown(): { state: GameState; p1: PlayerId; p2: PlayerId; spellSource: string } {
  const s = scenario();
  const [p1, p2] = s.players as [PlayerId, PlayerId];
  s.mainPhase(p1);
  const sorceryDef = createCardDefinition({
    name: "Test Ritual of Knowledge",
    typeLine: "Sorcery",
    manaCost: "",
    effects: [{ kind: "draw", playerId: "controller", count: 1 }],
  });
  const spell = s.add(sorceryDef, p1, "hand");
  s.add(island(), p2, "battlefield");
  const pierce = s.add(spellPierce(), p2, "hand");
  for (const player of s.game.players) {
    const filler = createCardDefinition({ name: "Test Filler", typeLine: "Instant" });
    s.game.definitions[filler.id] = filler;
    for (let i = 0; i < 5; i += 1) {
      s.add(filler, player.id, "library");
    }
  }

  let state = applyAction(s.game, { kind: "cast_spell", playerId: p1, cardId: spell });
  state = applyAction(state, { kind: "pass_priority", playerId: p1 });
  state = applyAction(state, {
    kind: "tap_for_mana",
    playerId: p2,
    cardId: state.players[1]!.zones.battlefield[0]!,
  });
  const spellOnStack = state.stack[0]!.id;
  state = applyAction(state, {
    kind: "cast_spell",
    playerId: p2,
    cardId: pierce,
    targets: [{ type: "spell", stackObjectId: spellOnStack }],
  });
  // Resolve the Pierce: both players pass.
  state = applyAction(state, { kind: "pass_priority", playerId: p2 });
  state = applyAction(state, { kind: "pass_priority", playerId: p1 });
  return { state, p1, p2, spellSource: spell };
}

describe("Spell Pierce (counter unless pays)", () => {
  it("declining the payment counters the spell", () => {
    const { state, p1, spellSource } = pierceShowdown();
    const prompt = currentPrompt(state);
    expect(prompt).toMatchObject({ kind: "pay_or_counter", playerId: p1, cost: "{2}", reason: "unless_pays" });
    const after = applyAction(state, { kind: "resolve_pay", playerId: p1, pay: false });
    expect(after.cards[spellSource]?.zone).toBe("graveyard");
    expect(after.stack).toHaveLength(0);
  });

  it("paying (by tapping producers during payment) keeps the spell", () => {
    const s = pierceShowdown();
    // Give P1 two untapped islands to tap for the payment.
    let state = s.state;
    const islandDef = island();
    state.definitions[islandDef.id] = islandDef;
    const ids: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      const card = {
        ...Object.values(state.cards)[0]!,
      };
      void card;
      const instance = structuredClone(Object.values(state.cards)[0]!);
      instance.id = `island-extra-${i}`;
      instance.definitionId = islandDef.id;
      instance.ownerId = s.p1;
      instance.controllerId = s.p1;
      instance.zone = "battlefield";
      instance.tapped = false;
      instance.summoningSick = false;
      state.cards[instance.id] = instance;
      state.players[0]!.zones.battlefield.push(instance.id);
      ids.push(instance.id);
    }
    state = applyAction(state, {
      kind: "resolve_pay",
      playerId: s.p1,
      pay: true,
      taps: ids.map((cardId) => ({ cardId })),
    });
    // The spell survives on the stack and later resolves.
    expect(state.stack).toHaveLength(1);
    state = applyAction(state, { kind: "pass_priority", playerId: state.priorityPlayerId });
    state = applyAction(state, { kind: "pass_priority", playerId: state.priorityPlayerId });
    expect(state.cards[s.spellSource]?.zone).toBe("graveyard");
    expect(state.players[0]!.zones.hand.length).toBeGreaterThan(0);
  });
});

describe("ward", () => {
  it("compiles Ward {2} and taxes an opponent's targeted removal", () => {
    const compiled = compileOracleCard({
      oracleId: "warded",
      name: "Test Warded Beast",
      manaCost: "{2}{G}",
      typeLine: "Creature — Beast",
      oracleText: "Ward {2}",
      power: "3",
      toughness: "3",
      printedKeywords: ["Ward"],
    });
    expect(compiled.definition.ward).toBe(2);

    const s = scenario();
    const [p1, p2] = s.players as [PlayerId, PlayerId];
    s.mainPhase(p1);
    const beast = s.add(compiled.definition, p2, "battlefield");
    const boltDef = createCardDefinition({
      name: "Test Bolt",
      typeLine: "Instant",
      manaCost: "",
      targetRequirements: [{ kind: "creature" }],
      effects: [
        { kind: "deal_damage", sourceId: "self", target: { type: "chosen", index: 0 }, amount: 3 },
      ],
    });
    const bolt = s.add(boltDef, p1, "hand");
    let state = applyAction(s.game, {
      kind: "cast_spell",
      playerId: p1,
      cardId: bolt,
      targets: [{ type: "creature", cardId: beast }],
    });
    const prompt = currentPrompt(state);
    expect(prompt).toMatchObject({ kind: "pay_or_counter", playerId: p1, cost: "{2}", reason: "ward" });
    state = applyAction(state, { kind: "resolve_pay", playerId: p1, pay: false });
    expect(state.cards[bolt]?.zone).toBe("graveyard");
    expect(state.stack).toHaveLength(0);
    expect(state.cards[beast]?.zone).toBe("battlefield");
  });

  it("does not tax the warded creature's own controller", () => {
    const s = scenario();
    const p1 = s.players[0]!;
    s.mainPhase(p1);
    const wardedDef = createCardDefinition({
      name: "Test Warded Ally",
      typeLine: "Creature — Beast",
      power: 2,
      toughness: 2,
      ward: 2,
    });
    const ally = s.add(wardedDef, p1, "battlefield");
    const pumpDef = createCardDefinition({
      name: "Test Pump",
      typeLine: "Instant",
      manaCost: "",
      targetRequirements: [{ kind: "creature" }],
      effects: [
        { kind: "pt_until_eot", cardId: { type: "chosen", index: 0 }, power: 2, toughness: 2 },
      ],
    });
    const pump = s.add(pumpDef, p1, "hand");
    const state = applyAction(s.game, {
      kind: "cast_spell",
      playerId: p1,
      cardId: pump,
      targets: [{ type: "creature", cardId: ally }],
    });
    expect(currentPrompt(state)).toBeNull();
  });
});
