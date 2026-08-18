import { describe, expect, it } from "vitest";
import {
  addMana,
  applyAction,
  applyEffect,
  createCardDefinition,
  createCardInstance,
  createGameState,
  parseGameAction,
  parseGameState,
  serializeGameAction,
  serializeGameState,
  testShock,
  testTerror,
  testCounter,
} from "./index";
import type { GameState } from "./types";

function twoPlayers() {
  const game = createGameState({ playerCount: 2 });
  const p1 = game.players[0];
  const p2 = game.players[1];
  if (!p1 || !p2) {
    throw new Error("need players");
  }
  return { game, p1, p2 };
}

function addToHand(game: GameState, ownerId: string, definition: ReturnType<typeof testShock>) {
  const owner = game.players.find((player) => player.id === ownerId);
  if (!owner) {
    throw new Error("missing owner");
  }
  game.definitions[definition.id] = definition;
  const card = createCardInstance({
    definitionId: definition.id,
    ownerId,
    zone: "hand",
  });
  game.cards[card.id] = card;
  owner.zones.hand.push(card.id);
  return card;
}

function addCreature(
  game: GameState,
  ownerId: string,
  toughness = 4,
) {
  const owner = game.players.find((player) => player.id === ownerId);
  if (!owner) {
    throw new Error("missing owner");
  }
  const definition = createCardDefinition({
    name: "Test Beast",
    typeLine: "Creature — Beast",
    power: 2,
    toughness,
  });
  const card = createCardInstance({
    definitionId: definition.id,
    ownerId,
    zone: "battlefield",
    summoningSick: false,
  });
  game.definitions[definition.id] = definition;
  game.cards[card.id] = card;
  owner.zones.battlefield.push(card.id);
  return card;
}

function passAll(game: GameState): GameState {
  let next = game;
  for (let i = 0; i < game.players.length; i += 1) {
    next = applyAction(next, { kind: "pass_priority", playerId: next.priorityPlayerId });
  }
  return next;
}

describe("targeting", () => {
  it("chooses targets when the spell is put on the stack, not on resolution", () => {
    const { game, p1, p2 } = twoPlayers();
    const card = addToHand(game, p1.id, testShock());
    const ready = addMana(game, p1.id, { R: 1 });
    const stacked = applyAction(ready, {
      kind: "cast_spell",
      playerId: p1.id,
      cardId: card.id,
      targets: [{ type: "player", playerId: p1.id }],
    });
    expect(stacked.stack[0]?.targets).toEqual([{ type: "player", playerId: p1.id }]);
    const resolved = passAll(stacked);
    expect(resolved.players[0]?.life).toBe(38);
    expect(resolved.players[1]?.life).toBe(40);
    expect(resolved.cards[card.id]?.zone).toBe("graveyard");
    expect(p2.id).toBe(game.players[1]?.id);
  });

  it("can target a creature chosen at cast", () => {
    const { game, p1 } = twoPlayers();
    const beast = addCreature(game, p1.id, 4);
    const card = addToHand(game, p1.id, testShock());
    const ready = addMana(game, p1.id, { R: 1 });
    const resolved = passAll(
      applyAction(ready, {
        kind: "cast_spell",
        playerId: p1.id,
        cardId: card.id,
        targets: [{ type: "creature", cardId: beast.id }],
      }),
    );
    expect(resolved.cards[beast.id]?.damageMarked).toBe(2);
    expect(resolved.cards[beast.id]?.zone).toBe("battlefield");
    expect(resolved.players[0]?.life).toBe(40);
  });

  it("rejects a targeted spell with no targets and does not spend mana", () => {
    const { game, p1 } = twoPlayers();
    const card = addToHand(game, p1.id, testShock());
    const ready = addMana(game, p1.id, { R: 1 });
    const original = structuredClone(ready);
    expect(() =>
      applyAction(ready, { kind: "cast_spell", playerId: p1.id, cardId: card.id }),
    ).toThrow(/Expected 1 target/);
    expect(ready).toEqual(original);
    expect(ready.players[0]?.mana.R).toBe(1);
    expect(ready.players[0]?.zones.hand).toContain(card.id);
  });

  it("rejects targeting a lost player or a creature that is not on the battlefield", () => {
    const { game, p1, p2 } = twoPlayers();
    const inHand = addCreature(game, p2.id);
    game.players[1]!.zones.battlefield = [];
    game.players[1]!.zones.hand.push(inHand.id);
    game.cards[inHand.id]!.zone = "hand";
    const shock = addToHand(game, p1.id, testShock());
    const ready = addMana(game, p1.id, { R: 2 });
    const original = structuredClone(ready);

    expect(() =>
      applyAction(ready, {
        kind: "cast_spell",
        playerId: p1.id,
        cardId: shock.id,
        targets: [{ type: "creature", cardId: inHand.id }],
      }),
    ).toThrow(/Illegal target/);

    const afterConcede = applyAction(ready, { kind: "concede", playerId: p2.id });
    expect(() =>
      applyAction(afterConcede, {
        kind: "cast_spell",
        playerId: p1.id,
        cardId: shock.id,
        targets: [{ type: "player", playerId: p2.id }],
      }),
    ).toThrow(/Illegal target/);
    expect(ready).toEqual(original);
  });

  it("checks target legality again on resolution and fizzles if the target is gone", () => {
    const { game, p1 } = twoPlayers();
    const beast = addCreature(game, p1.id, 4);
    const shock = addToHand(game, p1.id, testShock());
    let next = addMana(game, p1.id, { R: 1 });
    next = applyAction(next, {
      kind: "cast_spell",
      playerId: p1.id,
      cardId: shock.id,
      targets: [{ type: "creature", cardId: beast.id }],
    });
    expect(next.stack[0]?.targets).toEqual([{ type: "creature", cardId: beast.id }]);
    next = applyEffect(next, { kind: "move_card", cardId: beast.id, toZone: "exile" });
    next = passAll(next);
    expect(next.stack).toHaveLength(0);
    expect(next.cards[shock.id]?.zone).toBe("graveyard");
    expect(next.cards[beast.id]?.zone).toBe("exile");
    expect(next.cards[beast.id]?.damageMarked).toBe(0);
    expect(next.players[0]?.life).toBe(40);
  });

  it("lets a later spell remove a creature target before an earlier spell resolves", () => {
    const { game, p1, p2 } = twoPlayers();
    const beast = addCreature(game, p2.id, 4);
    const shock = addToHand(game, p1.id, testShock());
    const terror = addToHand(game, p1.id, testTerror());
    let next = addMana(game, p1.id, { R: 1, B: 1 });
    next = applyAction(next, {
      kind: "cast_spell",
      playerId: p1.id,
      cardId: shock.id,
      targets: [{ type: "creature", cardId: beast.id }],
    });
    next = applyAction(next, {
      kind: "cast_spell",
      playerId: p1.id,
      cardId: terror.id,
      targets: [{ type: "creature", cardId: beast.id }],
    });
    next = passAll(next);
    next = passAll(next);
    expect(next.cards[beast.id]?.zone).toBe("graveyard");
    expect(next.cards[shock.id]?.zone).toBe("graveyard");
    expect(next.cards[terror.id]?.zone).toBe("graveyard");
    expect(next.cards[beast.id]?.damageMarked).toBe(0);
    expect(next.players[1]?.life).toBe(40);
  });

  it("round-trips chosen targets on actions, stack objects, and definitions", () => {
    const { game, p1, p2 } = twoPlayers();
    const card = addToHand(game, p1.id, testShock());
    const action = {
      kind: "cast_spell" as const,
      playerId: p1.id,
      cardId: card.id,
      targets: [{ type: "player" as const, playerId: p2.id }],
    };
    expect(parseGameAction(serializeGameAction(action))).toEqual(action);

    const stacked = applyAction(addMana(game, p1.id, { R: 1 }), action);
    const restored = parseGameState(serializeGameState(stacked));
    expect(restored).toEqual(stacked);
    expect(restored.stack[0]?.targets).toEqual([{ type: "player", playerId: p2.id }]);
    expect(restored.definitions[card.definitionId]?.targetRequirements).toEqual([
      { kind: "player_or_creature" },
    ]);
  });

  it("round-trips a choose_targets action", () => {
    const { p1 } = twoPlayers();
    const action = {
      kind: "choose_targets" as const,
      playerId: p1.id,
      targets: [{ type: "player" as const, playerId: p1.id }],
    };
    expect(parseGameAction(serializeGameAction(action))).toEqual(action);
  });

  it("counters a spell on the stack chosen at cast", () => {
    const { game, p1, p2 } = twoPlayers();
    const shock = addToHand(game, p1.id, testShock());
    const counter = addToHand(game, p2.id, testCounter());
    let next = addMana(game, p1.id, { R: 1 });
    next = addMana(next, p2.id, { U: 2 });
    next = applyAction(next, {
      kind: "cast_spell",
      playerId: p1.id,
      cardId: shock.id,
      targets: [{ type: "player", playerId: p2.id }],
    });
    next = applyAction(next, { kind: "pass_priority", playerId: p1.id });
    const stackId = next.stack[0]?.id;
    if (!stackId) {
      throw new Error("expected shock on the stack");
    }
    next = applyAction(next, {
      kind: "cast_spell",
      playerId: p2.id,
      cardId: counter.id,
      targets: [{ type: "spell", stackObjectId: stackId }],
    });
    next = passAll(next);
    expect(next.stack).toHaveLength(0);
    expect(next.cards[shock.id]?.zone).toBe("graveyard");
    expect(next.cards[counter.id]?.zone).toBe("graveyard");
    expect(next.players[1]?.life).toBe(40);
  });

  it("rejects countering when the stack has no spell", () => {
    const { game, p1 } = twoPlayers();
    const counter = addToHand(game, p1.id, testCounter());
    const ready = addMana(game, p1.id, { U: 2 });
    expect(() =>
      applyAction(ready, {
        kind: "cast_spell",
        playerId: p1.id,
        cardId: counter.id,
        targets: [{ type: "spell", stackObjectId: "stack-missing" }],
      }),
    ).toThrow(/Illegal target/);
  });

  it("rejects Go for the Throat on an artifact creature and Essence Scatter on a noncreature spell", () => {
    const { game, p1, p2 } = twoPlayers();
    const golemDef = createCardDefinition({
      name: "Golem",
      typeLine: "Artifact Creature — Golem",
      power: 3,
      toughness: 3,
    });
    const golem = createCardInstance({
      definitionId: golemDef.id,
      ownerId: p2.id,
      zone: "battlefield",
    });
    const throat = createCardDefinition({
      name: "Go for the Throat",
      manaCost: "{1}{B}",
      typeLine: "Instant",
      targetRequirements: [{ kind: "nonartifact_creature" }],
      effects: [{ kind: "move_card", cardId: { type: "chosen", index: 0 }, toZone: "graveyard" }],
    });
    const throatCard = addToHand(game, p1.id, throat);
    game.definitions[golemDef.id] = golemDef;
    game.cards[golem.id] = golem;
    p2.zones.battlefield.push(golem.id);
    const readyThroat = addMana(game, p1.id, { B: 1, C: 1 });
    expect(() =>
      applyAction(readyThroat, {
        kind: "cast_spell",
        playerId: p1.id,
        cardId: throatCard.id,
        targets: [{ type: "creature", cardId: golem.id }],
      }),
    ).toThrow(/Illegal target/);

    const scatter = createCardDefinition({
      name: "Essence Scatter",
      manaCost: "{1}{U}",
      typeLine: "Instant",
      targetRequirements: [{ kind: "creature_spell" }],
      effects: [{ kind: "counter_spell", target: { type: "chosen", index: 0 } }],
    });
    const scatterCard = addToHand(game, p2.id, scatter);
    const shock = addToHand(game, p1.id, testShock());
    let next = addMana(game, p1.id, { R: 1 });
    next = addMana(next, p2.id, { U: 1, C: 1 });
    next = applyAction(next, {
      kind: "cast_spell",
      playerId: p1.id,
      cardId: shock.id,
      targets: [{ type: "player", playerId: p2.id }],
    });
    next = applyAction(next, { kind: "pass_priority", playerId: p1.id });
    const stackId = next.stack[0]?.id;
    if (!stackId) {
      throw new Error("expected shock on the stack");
    }
    expect(() =>
      applyAction(next, {
        kind: "cast_spell",
        playerId: p2.id,
        cardId: scatterCard.id,
        targets: [{ type: "spell", stackObjectId: stackId }],
      }),
    ).toThrow(/Illegal target/);
  });
});
