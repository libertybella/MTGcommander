import { describe, expect, it } from "vitest";
import { applyAction } from "./actions";
import { compileOracleCard } from "./oracle";
import { applyEffect } from "./effects";
import { creaturePower } from "./derived";
import { resolveTopOfStack } from "./stack";
import { createCardDefinition } from "./createGame";
import { scenario } from "./scenario";
import type { PlayerId } from "./types";

describe("Stage 6 coverage sprint mechanics", () => {
  it("Pacifism stops its host from attacking", () => {
    const compiled = compileOracleCard({
      oracleId: "pacifism",
      name: "Pacifism",
      manaCost: "{1}{W}",
      typeLine: "Enchantment — Aura",
      oracleText: "Enchant creature\nEnchanted creature can't attack or block.",
      power: null,
      toughness: null,
      printedKeywords: [],
    });
    expect(compiled.notes).toEqual([]);

    const s = scenario();
    const [me, opponent] = s.players as [PlayerId, PlayerId];
    const bear = s.add(
      createCardDefinition({ name: "Test Bear", typeLine: "Creature — Bear", power: 2, toughness: 2 }),
      me,
      "battlefield",
    );
    const aura = s.add(compiled.definition, opponent, "battlefield");
    s.game.cards[aura]!.attachedTo = bear;
    s.game.turn.activePlayerId = me;
    s.game.turn.phase = "combat";
    s.game.turn.step = "declareAttackers";
    s.game.priorityPlayerId = me;
    expect(() =>
      applyAction(s.game, {
        kind: "declare_attackers",
        playerId: me,
        attacks: [{ attackerId: bear, defenderId: opponent }],
      }),
    ).toThrow(/cannot attack/);
  });

  it("Ajani's Pridemate grows on every life gain", () => {
    const compiled = compileOracleCard({
      oracleId: "pridemate",
      name: "Ajani's Pridemate",
      manaCost: "{1}{W}",
      typeLine: "Creature — Cat Soldier",
      oracleText: "Whenever you gain life, put a +1/+1 counter on Ajani's Pridemate.",
      power: "2",
      toughness: "2",
      printedKeywords: [],
    });
    expect(compiled.notes).toEqual([]);

    const s = scenario();
    const me = s.players[0]!;
    const cat = s.add(compiled.definition, me, "battlefield");
    let state = applyEffect(s.game, { kind: "gain_life", playerId: me, amount: 3 });
    expect(state.stack).toHaveLength(1);
    state = resolveTopOfStack(state);
    expect(state.cards[cat]?.counters["p1p1"]).toBe(1);
    expect(creaturePower(state, cat)).toBe(3);
  });

  it("Beast Within destroys anything and consoles its controller", () => {
    const compiled = compileOracleCard({
      oracleId: "beast-within",
      name: "Beast Within",
      manaCost: "{2}{G}",
      typeLine: "Instant",
      oracleText: "Destroy target permanent. Its controller creates a 3/3 green Beast creature token.",
      power: null,
      toughness: null,
      printedKeywords: [],
    });
    expect(compiled.notes).toEqual([]);

    const s = scenario();
    const [me, opponent] = s.players as [PlayerId, PlayerId];
    s.mainPhase(me);
    s.game.players[0]!.mana.G = 1;
    s.game.players[0]!.mana.C = 2;
    const land = s.add(
      createCardDefinition({ name: "Test Island", typeLine: "Basic Land — Island", produces: { U: 1 } }),
      opponent,
      "battlefield",
    );
    const beastWithin = s.add(compiled.definition, me, "hand");
    let state = applyAction(s.game, {
      kind: "cast_spell",
      playerId: me,
      cardId: beastWithin,
      targets: [{ type: "creature", cardId: land }],
    });
    state = applyAction(state, { kind: "pass_priority", playerId: me });
    state = applyAction(state, { kind: "pass_priority", playerId: opponent });
    expect(state.cards[land]?.zone).toBe("graveyard");
    const beast = Object.values(state.cards).find((card) => card.isToken);
    expect(beast?.ownerId).toBe(opponent);
    expect(creaturePower(state, beast!.id)).toBe(3);
  });

  it("Gilded Lotus taps for three of one color", () => {
    const compiled = compileOracleCard({
      oracleId: "lotus",
      name: "Gilded Lotus",
      manaCost: "{5}",
      typeLine: "Artifact",
      oracleText: "{T}: Add three mana of any one color.",
      power: null,
      toughness: null,
      printedKeywords: [],
    });
    expect(compiled.notes).toEqual([]);

    const s = scenario();
    const me = s.players[0]!;
    s.mainPhase(me);
    const lotus = s.add(compiled.definition, me, "battlefield");
    const state = applyAction(s.game, {
      kind: "tap_for_mana",
      playerId: me,
      cardId: lotus,
      color: "U",
    });
    expect(state.players[0]!.mana.U).toBe(3);
  });

  it("Doom Whisperer's pay-life surveil compiles and costs life", () => {
    const compiled = compileOracleCard({
      oracleId: "whisperer",
      name: "Doom Whisperer",
      manaCost: "{3}{B}{B}",
      typeLine: "Legendary Creature — Demon",
      oracleText: "Flying, trample\nPay 2 life: Surveil 2.",
      power: "6",
      toughness: "6",
      printedKeywords: ["Flying", "Trample"],
    });
    expect(compiled.notes).toEqual([]);

    const s = scenario();
    const me = s.players[0]!;
    s.mainPhase(me);
    for (let i = 0; i < 3; i += 1) {
      s.add(createCardDefinition({ name: "Test Filler", typeLine: "Instant" }), me, "library");
    }
    const demon = s.add(compiled.definition, me, "battlefield");
    const state = applyAction(s.game, {
      kind: "activate_ability",
      playerId: me,
      cardId: demon,
      abilityIndex: 0,
    });
    expect(state.players[0]!.life).toBe(38);
  });
});
