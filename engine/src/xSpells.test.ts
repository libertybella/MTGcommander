import { describe, expect, it } from "vitest";
import { applyAction } from "./actions";
import { compileOracleCard } from "./oracle";
import { createCardDefinition } from "./createGame";
import { scenario } from "./scenario";
import type { CardDefinition, GameState, PlayerId } from "./types";

function fireball(): CardDefinition {
  const compiled = compileOracleCard({
    oracleId: "fireball",
    name: "Test Fireball",
    manaCost: "{X}{R}",
    typeLine: "Sorcery",
    oracleText: "Test Fireball deals X damage divided as you choose among any number of targets.",
    power: null,
    toughness: null,
    printedKeywords: [],
  });
  expect(compiled.notes).toEqual([]);
  return compiled.definition;
}

function withMana(state: GameState, playerId: PlayerId, red: number): void {
  const player = state.players.find((entry) => entry.id === playerId)!;
  player.mana.R = red;
}

describe("[CR 601.2b] X costs and divided damage", () => {
  it("compiles an X blast to a single target", () => {
    const compiled = compileOracleCard({
      oracleId: "blast",
      name: "Test Blaze",
      manaCost: "{X}{R}",
      typeLine: "Sorcery",
      oracleText: "Test Blaze deals X damage to any target.",
      power: null,
      toughness: null,
      printedKeywords: [],
    });
    expect(compiled.notes).toEqual([]);
    expect(compiled.definition.effects).toEqual([
      { kind: "deal_damage", sourceId: "self", target: { type: "chosen", index: 0 }, amount: "x" },
    ]);

    const s = scenario();
    const [me, opponent] = s.players as [PlayerId, PlayerId];
    s.mainPhase(me);
    withMana(s.game, me, 5);
    const blaze = s.add(compiled.definition, me, "hand");
    let state = applyAction(s.game, {
      kind: "cast_spell",
      playerId: me,
      cardId: blaze,
      xValue: 4,
      targets: [{ type: "player", playerId: opponent }],
    });
    state = applyAction(state, { kind: "pass_priority", playerId: me });
    state = applyAction(state, { kind: "pass_priority", playerId: opponent });
    expect(state.players[1]!.life).toBe(36);
  });

  it("requires announcing X and enough mana for it", () => {
    const s = scenario();
    const [me, opponent] = s.players as [PlayerId, PlayerId];
    s.mainPhase(me);
    withMana(s.game, me, 2);
    const ball = s.add(fireball(), me, "hand");
    expect(() =>
      applyAction(s.game, {
        kind: "cast_spell",
        playerId: me,
        cardId: ball,
        targets: [{ type: "player", playerId: opponent }],
        division: [1],
      }),
    ).toThrow(/Announce a value for X/);
    expect(() =>
      applyAction(s.game, {
        kind: "cast_spell",
        playerId: me,
        cardId: ball,
        xValue: 7,
        targets: [{ type: "player", playerId: opponent }],
        division: [7],
      }),
    ).toThrow(/Cannot pay mana cost/);
  });

  it("Fireball for X=7 divides among three targets", () => {
    const s = scenario();
    const [me, opponent] = s.players as [PlayerId, PlayerId];
    s.mainPhase(me);
    withMana(s.game, me, 8);
    const bearDef = createCardDefinition({
      name: "Test Bear",
      typeLine: "Creature — Bear",
      power: 2,
      toughness: 2,
    });
    const giantDef = createCardDefinition({
      name: "Test Giant",
      typeLine: "Creature — Giant",
      power: 5,
      toughness: 5,
    });
    const bear = s.add(bearDef, opponent, "battlefield");
    const giant = s.add(giantDef, opponent, "battlefield");
    const ball = s.add(fireball(), me, "hand");
    let state = applyAction(s.game, {
      kind: "cast_spell",
      playerId: me,
      cardId: ball,
      xValue: 7,
      targets: [
        { type: "creature", cardId: bear },
        { type: "creature", cardId: giant },
        { type: "player", playerId: opponent },
      ],
      division: [2, 3, 2],
    });
    expect(state.players[0]!.mana.R).toBe(0);
    state = applyAction(state, { kind: "pass_priority", playerId: me });
    state = applyAction(state, { kind: "pass_priority", playerId: opponent });
    expect(state.cards[bear]?.zone).toBe("graveyard");
    expect(state.cards[giant]?.zone).toBe("battlefield");
    expect(state.cards[giant]?.damageMarked).toBe(3);
    expect(state.players[1]!.life).toBe(38);
  });

  it("rejects a division that does not total X", () => {
    const s = scenario();
    const [me, opponent] = s.players as [PlayerId, PlayerId];
    s.mainPhase(me);
    withMana(s.game, me, 8);
    const ball = s.add(fireball(), me, "hand");
    expect(() =>
      applyAction(s.game, {
        kind: "cast_spell",
        playerId: me,
        cardId: ball,
        xValue: 7,
        targets: [{ type: "player", playerId: opponent }],
        division: [5],
      }),
    ).toThrow(/must total 7/);
  });

  it("an illegal target loses its share on resolution", () => {
    const s = scenario();
    const [me, opponent] = s.players as [PlayerId, PlayerId];
    s.mainPhase(me);
    withMana(s.game, me, 5);
    const bearDef = createCardDefinition({
      name: "Test Bear",
      typeLine: "Creature — Bear",
      power: 2,
      toughness: 2,
    });
    const bear = s.add(bearDef, opponent, "battlefield");
    const ball = s.add(fireball(), me, "hand");
    let state = applyAction(s.game, {
      kind: "cast_spell",
      playerId: me,
      cardId: ball,
      xValue: 4,
      targets: [
        { type: "creature", cardId: bear },
        { type: "player", playerId: opponent },
      ],
      division: [2, 2],
    });
    // The bear dies to a response before the Fireball resolves.
    const boltDef = createCardDefinition({
      name: "Test Bolt",
      typeLine: "Instant",
      manaCost: "",
      targetRequirements: [{ kind: "creature" }],
      effects: [
        { kind: "deal_damage", sourceId: "self", target: { type: "chosen", index: 0 }, amount: 3 },
      ],
    });
    const bolt = s.add(boltDef, me, "hand");
    state.definitions[boltDef.id] = boltDef;
    state.cards[bolt] = s.game.cards[bolt]!;
    state.players[0]!.zones.hand.push(bolt);
    state = applyAction(state, {
      kind: "cast_spell",
      playerId: me,
      cardId: bolt,
      targets: [{ type: "creature", cardId: bear }],
    });
    state = applyAction(state, { kind: "pass_priority", playerId: me });
    state = applyAction(state, { kind: "pass_priority", playerId: opponent });
    expect(state.cards[bear]?.zone).toBe("graveyard");
    // Fireball resolves: only the player takes damage.
    state = applyAction(state, { kind: "pass_priority", playerId: me });
    state = applyAction(state, { kind: "pass_priority", playerId: opponent });
    expect(state.players[1]!.life).toBe(38);
  });
});
