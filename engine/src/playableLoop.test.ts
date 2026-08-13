import { describe, expect, it } from "vitest";
import {
  applyAction,
  applyEffect,
  createCardDefinition,
  createCardInstance,
  createGameState,
  parseGameAction,
  parseGameState,
  serializeGameAction,
  serializeGameState,
  testForest,
  TURN_SEQUENCE,
} from "./index";
import { advanceSteps } from "./turn";
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

function threePlayers() {
  const game = createGameState({ playerCount: 3 });
  const p1 = game.players[0];
  const p2 = game.players[1];
  const p3 = game.players[2];
  if (!p1 || !p2 || !p3) {
    throw new Error("need players");
  }
  return { game, p1, p2, p3 };
}

function toPrecombatMain(game: GameState): GameState {
  return advanceSteps(game, 3);
}

function addForestToHand(game: GameState, ownerId: string) {
  const owner = game.players.find((player) => player.id === ownerId);
  if (!owner) {
    throw new Error("missing owner");
  }
  const definition = testForest();
  const card = createCardInstance({
    definitionId: definition.id,
    ownerId,
    zone: "hand",
  });
  game.definitions[definition.id] = definition;
  game.cards[card.id] = card;
  owner.zones.hand.push(card.id);
  return card;
}

describe("playable loop: land play", () => {
  it("plays a land as a special action onto the battlefield, not the stack", () => {
    const { game, p1 } = twoPlayers();
    const forest = addForestToHand(game, p1.id);
    const ready = toPrecombatMain(game);
    const original = structuredClone(ready);

    const next = applyAction(ready, {
      kind: "play_land",
      playerId: p1.id,
      cardId: forest.id,
    });

    expect(next.stack).toHaveLength(0);
    expect(next.cards[forest.id]?.zone).toBe("battlefield");
    expect(next.players[0]?.zones.hand).not.toContain(forest.id);
    expect(next.players[0]?.zones.battlefield).toContain(forest.id);
    expect(next.players[0]?.landsPlayedThisTurn).toBe(1);
    expect(next.priorityPlayerId).toBe(p1.id);
    expect(next.passesSinceAction).toBe(0);
    expect(ready).toEqual(original);
  });

  it("allows only one land play per player per turn", () => {
    const { game, p1 } = twoPlayers();
    const first = addForestToHand(game, p1.id);
    const second = addForestToHand(game, p1.id);
    const ready = toPrecombatMain(game);
    const afterFirst = applyAction(ready, {
      kind: "play_land",
      playerId: p1.id,
      cardId: first.id,
    });
    const original = structuredClone(afterFirst);
    expect(() =>
      applyAction(afterFirst, { kind: "play_land", playerId: p1.id, cardId: second.id }),
    ).toThrow(/Already played a land/);
    expect(afterFirst).toEqual(original);
  });

  it("resets the land play count on that player's next untap", () => {
    const { game, p1 } = twoPlayers();
    const first = addForestToHand(game, p1.id);
    const second = addForestToHand(game, p1.id);
    let next = toPrecombatMain(game);
    next = applyAction(next, { kind: "play_land", playerId: p1.id, cardId: first.id });
    next = advanceSteps(next, TURN_SEQUENCE.length - 3);
    expect(next.turn.step).toBe("untap");
    expect(next.players[0]?.landsPlayedThisTurn).toBe(1);
    next = advanceSteps(next, TURN_SEQUENCE.length);
    expect(next.turn.activePlayerId).toBe(p1.id);
    expect(next.turn.step).toBe("untap");
    expect(next.players[0]?.landsPlayedThisTurn).toBe(0);
    next = advanceSteps(next, 3);
    next = applyAction(next, { kind: "play_land", playerId: p1.id, cardId: second.id });
    expect(next.players[0]?.zones.battlefield).toContain(second.id);
  });

  it("rejects land play from the non-active player, outside a main phase, or with the stack occupied", () => {
    const { game, p1, p2 } = twoPlayers();
    const p1Forest = addForestToHand(game, p1.id);
    const p2Forest = addForestToHand(game, p2.id);
    const atUpkeep = advanceSteps(game, 1);
    expect(atUpkeep.turn.step).toBe("upkeep");
    expect(() =>
      applyAction(atUpkeep, { kind: "play_land", playerId: p1.id, cardId: p1Forest.id }),
    ).toThrow(/main phase/);

    const main = toPrecombatMain(game);
    expect(() =>
      applyAction(main, { kind: "play_land", playerId: p2.id, cardId: p2Forest.id }),
    ).toThrow(/active player|priority/);

    const spell = createCardDefinition({ name: "Test Blank", typeLine: "Instant", manaCost: "{0}" });
    const spellCard = createCardInstance({
      definitionId: spell.id,
      ownerId: p1.id,
      zone: "hand",
    });
    main.definitions[spell.id] = spell;
    main.cards[spellCard.id] = spellCard;
    main.players[0]?.zones.hand.push(spellCard.id);
    const stacked = applyAction(main, {
      kind: "cast_spell",
      playerId: p1.id,
      cardId: spellCard.id,
    });
    expect(() =>
      applyAction(stacked, { kind: "play_land", playerId: p1.id, cardId: p1Forest.id }),
    ).toThrow(/stack is empty/);
  });

  it("still rejects casting a land as a spell", () => {
    const { game, p1 } = twoPlayers();
    const forest = addForestToHand(game, p1.id);
    const ready = toPrecombatMain(game);
    expect(() =>
      applyAction(ready, { kind: "cast_spell", playerId: p1.id, cardId: forest.id }),
    ).toThrow(/cannot be cast as a spell/);
  });

  it("round-trips a play_land action", () => {
    const action = { kind: "play_land" as const, playerId: "player-1", cardId: "card-1" };
    expect(parseGameAction(serializeGameAction(action))).toEqual(action);
  });
});

describe("playable loop: draw, life, concede, elimination", () => {
  it("draws on the first turn in a two-player game", () => {
    const { game, p1 } = twoPlayers();
    const def = createCardDefinition({ name: "Test Card", typeLine: "Instant" });
    const card = createCardInstance({
      definitionId: def.id,
      ownerId: p1.id,
      zone: "library",
    });
    game.definitions[def.id] = def;
    game.cards[card.id] = card;
    p1.zones.library.push(card.id);
    const atDraw = advanceSteps(game, 2);
    expect(atDraw.turn.number).toBe(1);
    expect(atDraw.players[0]?.zones.hand).toEqual([card.id]);
  });

  it("does not throw when the draw step has an empty library", () => {
    const { game } = twoPlayers();
    const atDraw = advanceSteps(game, 2);
    expect(atDraw.turn.step).toBe("draw");
    expect(atDraw.players[0]?.lost).toBe(false);
    expect(atDraw.players[0]?.zones.hand).toEqual([]);
  });

  it("marks a player as lost at 0 life and awards the winner", () => {
    const { game, p1, p2 } = twoPlayers();
    const next = applyEffect(game, { kind: "lose_life", playerId: p2.id, amount: 40 });
    expect(next.players[1]?.life).toBe(0);
    expect(next.players[1]?.lost).toBe(true);
    expect(next.winnerId).toBe(p1.id);
    expect(game.players[1]?.lost).toBe(false);
  });

  it("marks a player as lost below 0 life", () => {
    const { game, p2 } = twoPlayers();
    game.players[1]!.life = 2;
    const next = applyEffect(game, { kind: "lose_life", playerId: p2.id, amount: 5 });
    expect(next.players[1]?.life).toBe(-3);
    expect(next.players[1]?.lost).toBe(true);
  });

  it("implements concede without requiring priority", () => {
    const { game, p1, p2 } = twoPlayers();
    const ready = toPrecombatMain(game);
    expect(ready.priorityPlayerId).toBe(p1.id);
    const next = applyAction(ready, { kind: "concede", playerId: p2.id });
    expect(next.players[1]?.lost).toBe(true);
    expect(next.winnerId).toBe(p1.id);
    expect(next.turn.activePlayerId).toBe(p1.id);
    expect(ready.players[1]?.lost).toBe(false);
  });

  it("skips the rest of the turn when the active player concedes", () => {
    const { game, p1, p2 } = twoPlayers();
    const ready = toPrecombatMain(game);
    const next = applyAction(ready, { kind: "concede", playerId: p1.id });
    expect(next.players[0]?.lost).toBe(true);
    expect(next.winnerId).toBe(p2.id);
    expect(next.turn.activePlayerId).toBe(p2.id);
    expect(next.turn.step).toBe("untap");
    expect(next.turn.number).toBe(2);
  });

  it("rejects a second concede from a player who has already lost", () => {
    const { game, p2 } = twoPlayers();
    const lost = applyAction(game, { kind: "concede", playerId: p2.id });
    expect(() => applyAction(lost, { kind: "concede", playerId: p2.id })).toThrow(/already lost/);
  });

  it("skips a lost player in priority and turn order", () => {
    const { game, p1, p2, p3 } = threePlayers();
    const ready = toPrecombatMain(game);
    const afterConcede = applyAction(ready, { kind: "concede", playerId: p2.id });
    expect(afterConcede.winnerId).toBeNull();
    expect(afterConcede.priorityPlayerId).toBe(p1.id);

    const afterP1Pass = applyAction(afterConcede, {
      kind: "pass_priority",
      playerId: p1.id,
    });
    expect(afterP1Pass.priorityPlayerId).toBe(p3.id);

    const afterP3Pass = applyAction(afterP1Pass, {
      kind: "pass_priority",
      playerId: p3.id,
    });
    expect(afterP3Pass.turn.step).toBe("beginCombat");

    const afterP1Turn = advanceSteps(afterConcede, TURN_SEQUENCE.length - 3);
    expect(afterP1Turn.turn.activePlayerId).toBe(p3.id);
    expect(afterP1Turn.turn.step).toBe("untap");
  });

  it("rejects attacking a player who has lost", () => {
    const { game, p1, p2 } = twoPlayers();
    const def = createCardDefinition({
      name: "Test Bear",
      typeLine: "Creature — Bear",
      power: 2,
      toughness: 2,
    });
    const bear = createCardInstance({
      definitionId: def.id,
      ownerId: p1.id,
      zone: "battlefield",
      summoningSick: false,
    });
    game.definitions[def.id] = def;
    game.cards[bear.id] = bear;
    p1.zones.battlefield.push(bear.id);

    let next = applyAction(game, { kind: "concede", playerId: p2.id });
    next = advanceSteps(next, 5);
    expect(next.turn.step).toBe("declareAttackers");
    expect(() =>
      applyAction(next, {
        kind: "declare_attackers",
        playerId: p1.id,
        attacks: [{ attackerId: bear.id, defenderId: p2.id }],
      }),
    ).toThrow(/has lost/);
  });

  it("serializes land-play counts, winner, and concession", () => {
    const { game, p1, p2 } = twoPlayers();
    const forest = addForestToHand(game, p1.id);
    let next = toPrecombatMain(game);
    next = applyAction(next, { kind: "play_land", playerId: p1.id, cardId: forest.id });
    next = applyAction(next, { kind: "concede", playerId: p2.id });
    const restored = parseGameState(serializeGameState(next));
    expect(restored).toEqual(next);
    expect(restored.players[0]?.landsPlayedThisTurn).toBe(1);
    expect(restored.winnerId).toBe(p1.id);
    expect(restored.players[1]?.lost).toBe(true);
  });
});
