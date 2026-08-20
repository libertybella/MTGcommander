import { describe, expect, it } from "vitest";
import { applyAction } from "./actions";
import { compileOracleCard } from "./oracle";
import { applyEffect } from "./effects";
import { creaturePower, creatureToughness } from "./derived";
import { hasKeyword } from "./keywords";
import { createCardDefinition } from "./createGame";
import { scenario } from "./scenario";
import { HIDDEN_DEFINITION_ID, redactForViewer } from "./visibility";
import type { CardDefinition, GameState, PlayerId } from "./types";

function resolvePasses(state: GameState, a: PlayerId, b: PlayerId): GameState {
  let current = applyAction(state, { kind: "pass_priority", playerId: a });
  current = applyAction(current, { kind: "pass_priority", playerId: b });
  return current;
}

describe("[CR 303.4] auras", () => {
  function boarhide(): CardDefinition {
    const compiled = compileOracleCard({
      oracleId: "boarhide",
      name: "Test Boar Hide",
      manaCost: "{G}",
      typeLine: "Enchantment — Aura",
      oracleText: "Enchant creature\nEnchanted creature gets +2/+2 and has trample.",
      power: null,
      toughness: null,
      printedKeywords: [],
    });
    expect(compiled.notes).toEqual([]);
    return compiled.definition;
  }

  it("enters attached and buffs through the layer engine", () => {
    const s = scenario();
    const [me, opponent] = s.players as [PlayerId, PlayerId];
    s.mainPhase(me);
    s.game.players[0]!.mana.G = 1;
    const bear = s.add(
      createCardDefinition({ name: "Test Bear", typeLine: "Creature — Bear", power: 2, toughness: 2 }),
      me,
      "battlefield",
    );
    const aura = s.add(boarhide(), me, "hand");
    let state = applyAction(s.game, {
      kind: "cast_spell",
      playerId: me,
      cardId: aura,
      targets: [{ type: "creature", cardId: bear }],
    });
    state = resolvePasses(state, me, opponent);
    expect(state.cards[aura]?.zone).toBe("battlefield");
    expect(state.cards[aura]?.attachedTo).toBe(bear);
    expect(creaturePower(state, bear)).toBe(4);
    expect(hasKeyword(state, bear, "trample")).toBe(true);
  });

  it("[CR 704.5n] dies when its host leaves, and the buff ends", () => {
    const s = scenario();
    const [me, opponent] = s.players as [PlayerId, PlayerId];
    s.mainPhase(me);
    s.game.players[0]!.mana.G = 1;
    const bear = s.add(
      createCardDefinition({ name: "Test Bear", typeLine: "Creature — Bear", power: 2, toughness: 2 }),
      me,
      "battlefield",
    );
    const aura = s.add(boarhide(), me, "hand");
    let state = applyAction(s.game, {
      kind: "cast_spell",
      playerId: me,
      cardId: aura,
      targets: [{ type: "creature", cardId: bear }],
    });
    state = resolvePasses(state, me, opponent);
    state = applyEffect(state, { kind: "move_card", cardId: bear, toZone: "graveyard" });
    expect(state.cards[aura]?.zone).toBe("graveyard");
  });

  it("fizzles to the graveyard when its target is gone at resolution", () => {
    const s = scenario();
    const [me, opponent] = s.players as [PlayerId, PlayerId];
    s.mainPhase(me);
    s.game.players[0]!.mana.G = 1;
    const bear = s.add(
      createCardDefinition({ name: "Test Bear", typeLine: "Creature — Bear", power: 2, toughness: 2 }),
      me,
      "battlefield",
    );
    const aura = s.add(boarhide(), me, "hand");
    let state = applyAction(s.game, {
      kind: "cast_spell",
      playerId: me,
      cardId: aura,
      targets: [{ type: "creature", cardId: bear }],
    });
    state = applyEffect(state, { kind: "move_card", cardId: bear, toZone: "graveyard" });
    state = resolvePasses(state, me, opponent);
    expect(state.cards[aura]?.zone).toBe("graveyard");
  });
});

describe("equipment", () => {
  it("compiles Equip and attaches at sorcery speed; survives its host", () => {
    const compiled = compileOracleCard({
      oracleId: "blade",
      name: "Test Shortblade",
      manaCost: "{1}",
      typeLine: "Artifact — Equipment",
      oracleText: "Equipped creature gets +1/+1.\nEquip {1}",
      power: null,
      toughness: null,
      printedKeywords: [],
    });
    expect(compiled.notes).toEqual([]);
    const s = scenario();
    const [me, opponent] = s.players as [PlayerId, PlayerId];
    void opponent;
    s.mainPhase(me);
    s.game.players[0]!.mana.C = 1;
    const bear = s.add(
      createCardDefinition({ name: "Test Bear", typeLine: "Creature — Bear", power: 2, toughness: 2 }),
      me,
      "battlefield",
    );
    const blade = s.add(compiled.definition, me, "battlefield");
    let state = applyAction(s.game, {
      kind: "activate_ability",
      playerId: me,
      cardId: blade,
      abilityIndex: 0,
      targets: [{ type: "creature", cardId: bear }],
    });
    state = resolvePasses(state, me, opponent);
    expect(state.cards[blade]?.attachedTo).toBe(bear);
    expect(creaturePower(state, bear)).toBe(3);
    // Host dies: equipment stays, detached (CR 704.5m).
    state = applyEffect(state, { kind: "move_card", cardId: bear, toZone: "graveyard" });
    expect(state.cards[blade]?.zone).toBe("battlefield");
    expect(state.cards[blade]?.attachedTo ?? null).toBeNull();
  });
});

describe("[CR 306] planeswalkers", () => {
  function walker(): CardDefinition {
    const compiled = compileOracleCard({
      oracleId: "walker",
      name: "Test Ajani",
      manaCost: "{2}{W}{W}",
      typeLine: "Legendary Planeswalker — Ajani",
      oracleText: "+2: You gain 2 life.\n−6: Creatures you control get +2/+2 until end of turn.",
      power: null,
      toughness: null,
      printedKeywords: [],
      loyalty: "4",
    });
    expect(compiled.notes).toEqual([]);
    expect(compiled.definition.loyalty).toBe(4);
    expect(compiled.definition.loyaltyAbilities).toHaveLength(2);
    return compiled.definition;
  }

  it("enters with loyalty, plus-activates once per turn, and resolves", () => {
    const s = scenario();
    const [me, opponent] = s.players as [PlayerId, PlayerId];
    s.mainPhase(me);
    const ajani = s.add(walker(), me, "hand");
    let state = applyEffect(s.game, { kind: "move_card", cardId: ajani, toZone: "battlefield" });
    expect(state.cards[ajani]?.counters["loyalty"]).toBe(4);
    state = applyAction(state, {
      kind: "activate_loyalty",
      playerId: me,
      cardId: ajani,
      abilityIndex: 0,
    });
    expect(state.cards[ajani]?.counters["loyalty"]).toBe(6);
    state = resolvePasses(state, me, opponent);
    expect(state.players[0]!.life).toBe(42);
    // Once per walker per turn, even after the first resolves.
    expect(() =>
      applyAction(state, { kind: "activate_loyalty", playerId: me, cardId: ajani, abilityIndex: 0 }),
    ).toThrow(/already used/);
  });

  it("cannot pay more loyalty than it has, and dies at zero", () => {
    const s = scenario();
    const me = s.players[0]!;
    const ajani = s.add(walker(), me, "hand");
    const state = applyEffect(s.game, { kind: "move_card", cardId: ajani, toZone: "battlefield" });
    state.turn.activePlayerId = me;
    state.turn.phase = "precombatMain";
    state.turn.step = "precombatMain";
    state.priorityPlayerId = me;
    expect(() =>
      applyAction(state, { kind: "activate_loyalty", playerId: me, cardId: ajani, abilityIndex: 1 }),
    ).toThrow(/Not enough loyalty/);
    // At zero loyalty the SBA sends it to the graveyard.
    state.cards[ajani]!.counters["loyalty"] = 0;
    const after = applyEffect(state, { kind: "gain_life", playerId: me, amount: 1 });
    expect(after.cards[ajani]?.zone).toBe("graveyard");
  });
});

describe("copies and transforms", () => {
  it("a token copy of a Sliver receives lord bonuses", () => {
    const s = scenario();
    const me = s.players[0]!;
    const sliver = s.add(
      createCardDefinition({ name: "Test Sliver", typeLine: "Creature — Sliver", power: 1, toughness: 1 }),
      me,
      "battlefield",
    );
    s.add(
      createCardDefinition({
        name: "Test Sliver Lord",
        typeLine: "Creature — Sliver",
        power: 1,
        toughness: 1,
        staticAbilities: [
          {
            selector: { scope: "all", subtypes: ["sliver"] },
            effect: { kind: "modify_pt", power: 1, toughness: 1 },
          },
        ],
      }),
      me,
      "battlefield",
    );
    const state = applyEffect(s.game, { kind: "copy_token", ownerId: me, ofCardId: sliver });
    const copy = Object.values(state.cards).find((card) => card.isToken)!;
    expect(copy).toBeTruthy();
    expect(creaturePower(state, copy.id)).toBe(2);
    expect(creatureToughness(state, copy.id)).toBe(2);
  });

  it("transform flips to the other face and back", () => {
    const s = scenario();
    const me = s.players[0]!;
    const back = createCardDefinition({
      name: "Test Werewolf",
      typeLine: "Creature — Werewolf",
      power: 5,
      toughness: 5,
    });
    const front = createCardDefinition({
      name: "Test Villager",
      typeLine: "Creature — Human",
      power: 1,
      toughness: 1,
      otherFaceId: back.id,
      layout: "transform",
    });
    back.otherFaceId = front.id;
    s.game.definitions[back.id] = back;
    const card = s.add(front, me, "battlefield");
    const flipped = applyEffect(s.game, { kind: "transform", cardId: card });
    expect(creaturePower(flipped, card)).toBe(5);
    const restored = applyEffect(flipped, { kind: "transform", cardId: card });
    expect(creaturePower(restored, card)).toBe(1);
  });
});

describe("[CR 708] manifest and face-down permanents", () => {
  it("manifests the top card as a hidden 2/2 and turns it face up for its cost", () => {
    const s = scenario();
    const [me, opponent] = s.players as [string, string];
    const giantDef = createCardDefinition({
      name: "Test Hill Giant",
      typeLine: "Creature — Giant",
      manaCost: "{3}{R}",
      power: 3,
      toughness: 3,
      keywords: ["trample"],
    });
    const giant = s.add(giantDef, me, "library");
    let state = applyEffect(s.game, { kind: "manifest", playerId: me, count: 1 });
    expect(state.cards[giant]?.zone).toBe("battlefield");
    expect(state.cards[giant]?.faceDown).toBe(true);
    expect(creaturePower(state, giant)).toBe(2);
    expect(creatureToughness(state, giant)).toBe(2);
    expect(hasKeyword(state, giant, "trample")).toBe(false);

    // Opponents cannot see what it is.
    const theirView = redactForViewer(state, opponent);
    expect(theirView.cards[giant]?.definitionId).toBe(HIDDEN_DEFINITION_ID);
    const myView = redactForViewer(state, me);
    expect(myView.cards[giant]?.definitionId).toBe(giantDef.id);

    // Turn it face up mid-combat by paying its mana cost.
    state.turn.activePlayerId = me;
    state.turn.phase = "combat";
    state.turn.step = "declareBlockers";
    state.priorityPlayerId = me;
    state.players[0]!.mana.R = 1;
    state.players[0]!.mana.C = 3;
    state = applyAction(state, { kind: "turn_face_up", playerId: me, cardId: giant });
    expect(state.cards[giant]?.faceDown).toBe(false);
    expect(creaturePower(state, giant)).toBe(3);
    expect(hasKeyword(state, giant, "trample")).toBe(true);
  });

  it("cannot turn a manifested land face up", () => {
    const s = scenario();
    const me = s.players[0]!;
    const land = s.add(
      createCardDefinition({ name: "Test Island", typeLine: "Basic Land — Island", produces: { U: 1 } }),
      me,
      "library",
    );
    const state = applyEffect(s.game, { kind: "manifest", playerId: me, count: 1 });
    state.turn.activePlayerId = me;
    state.turn.phase = "precombatMain";
    state.turn.step = "precombatMain";
    state.priorityPlayerId = me;
    expect(() =>
      applyAction(state, { kind: "turn_face_up", playerId: me, cardId: land }),
    ).toThrow(/creature card/);
  });
});

describe("[CR 510] first strike ordering", () => {
  it("a first-strike deathtouch blocker kills before normal damage lands", () => {
    const s = scenario();
    const [me, opponent] = s.players as [string, string];
    const attacker = s.add(
      createCardDefinition({ name: "Test Ogre", typeLine: "Creature — Ogre", power: 4, toughness: 4 }),
      me,
      "battlefield",
    );
    const sentinel = s.add(
      createCardDefinition({
        name: "Test Venom Duelist",
        typeLine: "Creature — Human",
        power: 1,
        toughness: 1,
        keywords: ["first_strike", "deathtouch"],
      }),
      opponent,
      "battlefield",
    );
    s.game.turn.activePlayerId = me;
    s.game.turn.phase = "combat";
    s.game.turn.step = "declareAttackers";
    s.game.priorityPlayerId = me;
    let state = applyAction(s.game, {
      kind: "declare_attackers",
      playerId: me,
      attacks: [{ attackerId: attacker, defenderId: opponent }],
    });
    state = resolvePasses(state, me, opponent);
    expect(state.turn.step).toBe("declareBlockers");
    state = applyAction(state, {
      kind: "declare_blockers",
      playerId: opponent,
      blocks: [{ blockerId: sentinel, attackerId: attacker }],
    });
    state = applyAction(state, { kind: "advance_step", playerId: me });
    // First-strike deathtouch killed the ogre before it could deal damage.
    expect(state.cards[attacker]?.zone).toBe("graveyard");
    expect(state.cards[sentinel]?.zone).toBe("battlefield");
    expect(state.cards[sentinel]?.damageMarked).toBe(0);
  });
});
