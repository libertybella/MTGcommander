import { describe, expect, it } from "vitest";
import {
  applyAction,
  applyEffect,
  createCardDefinition,
  createCardInstance,
  createGameState,
  isGameOver,
  livingPlayers,
  parseGameState,
  serializeGameState,
  TURN_SEQUENCE,
} from "./index";
import { advanceSteps } from "./turn";
import type { GameState } from "./types";

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

function twoPlayers() {
  const game = createGameState({ playerCount: 2 });
  const p1 = game.players[0];
  const p2 = game.players[1];
  if (!p1 || !p2) {
    throw new Error("need players");
  }
  return { game, p1, p2 };
}

function placeOwnedCard(
  game: GameState,
  ownerId: string,
  zone: "library" | "hand" | "battlefield" | "graveyard" | "exile" | "command",
  name: string,
  typeLine = "Instant",
) {
  const owner = game.players.find((player) => player.id === ownerId);
  if (!owner) {
    throw new Error("missing owner");
  }
  const definition = createCardDefinition({ name, typeLine });
  const card = createCardInstance({
    definitionId: definition.id,
    ownerId,
    zone,
    summoningSick: false,
  });
  game.definitions[definition.id] = definition;
  game.cards[card.id] = card;
  owner.zones[zone].push(card.id);
  return card;
}

describe("player elimination transition", () => {
  it("eliminates a player who reaches 0 life", () => {
    const { game, p1, p2 } = twoPlayers();
    const inHand = placeOwnedCard(game, p2.id, "hand", "Test Note");
    const next = applyEffect(game, { kind: "lose_life", playerId: p2.id, amount: 40 });
    expect(next.players[1]?.life).toBe(0);
    expect(next.players[1]?.lost).toBe(true);
    expect(next.winnerId).toBe(p1.id);
    expect(isGameOver(next)).toBe(true);
    expect(next.cards[inHand.id]?.zone).toBe("removed");
    expect(next.players[1]?.zones.hand).toEqual([]);
    expect(game.players[1]?.lost).toBe(false);
  });

  it("eliminates a player who concedes", () => {
    const { game, p1, p2 } = twoPlayers();
    const original = structuredClone(game);
    const next = applyAction(game, { kind: "concede", playerId: p2.id });
    expect(next.players[1]?.lost).toBe(true);
    expect(next.winnerId).toBe(p1.id);
    expect(isGameOver(next)).toBe(true);
    expect(game).toEqual(original);
  });

  it("skips an eliminated player in turn order", () => {
    const { game, p1, p2, p3 } = threePlayers();
    const after = applyAction(game, { kind: "concede", playerId: p2.id });
    const nextTurn = advanceSteps(after, TURN_SEQUENCE.length);
    expect(nextTurn.turn.activePlayerId).toBe(p3.id);
    expect(nextTurn.turn.activePlayerId).not.toBe(p2.id);
    expect(p1.id).toBe(after.turn.activePlayerId);
  });

  it("skips an eliminated player in priority", () => {
    const { game, p1, p2, p3 } = threePlayers();
    const ready = advanceSteps(game, 3);
    const after = applyAction(ready, { kind: "concede", playerId: p2.id });
    const passed = applyAction(after, { kind: "pass_priority", playerId: p1.id });
    expect(passed.priorityPlayerId).toBe(p3.id);
    expect(passed.priorityPlayerId).not.toBe(p2.id);
  });

  it("removes cards owned by the eliminated player from the game", () => {
    const { game, p2 } = twoPlayers();
    const inHand = placeOwnedCard(game, p2.id, "hand", "Test Note");
    const inLibrary = placeOwnedCard(game, p2.id, "library", "Test Page");
    const onBattlefield = placeOwnedCard(
      game,
      p2.id,
      "battlefield",
      "Test Bear",
      "Creature — Bear",
    );
    const inGraveyard = placeOwnedCard(game, p2.id, "graveyard", "Test Memory");
    const next = applyAction(game, { kind: "concede", playerId: p2.id });
    const eliminated = next.players[1];
    expect(eliminated?.zones.hand).toEqual([]);
    expect(eliminated?.zones.library).toEqual([]);
    expect(eliminated?.zones.battlefield).toEqual([]);
    expect(eliminated?.zones.graveyard).toEqual([]);
    expect(eliminated?.zones.removed).toEqual(
      expect.arrayContaining([inHand.id, inLibrary.id, onBattlefield.id, inGraveyard.id]),
    );
    expect(next.cards[inHand.id]?.zone).toBe("removed");
    expect(next.cards[onBattlefield.id]?.zone).toBe("removed");
    expect(next.cards[inHand.id]?.ownerId).toBe(p2.id);
  });

  it("exiles a permanent the eliminated player controls but does not own", () => {
    const { game, p1, p2 } = twoPlayers();
    const stolen = placeOwnedCard(
      game,
      p1.id,
      "battlefield",
      "Test Bear",
      "Creature — Bear",
    );
    game.cards[stolen.id]!.controllerId = p2.id;
    expect(game.players[0]?.zones.battlefield).toContain(stolen.id);
    expect(game.cards[stolen.id]?.ownerId).toBe(p1.id);

    const next = applyAction(game, { kind: "concede", playerId: p2.id });
    expect(next.cards[stolen.id]?.ownerId).toBe(p1.id);
    expect(next.cards[stolen.id]?.controllerId).toBe(p1.id);
    expect(next.cards[stolen.id]?.zone).toBe("exile");
    expect(next.players[0]?.zones.battlefield).not.toContain(stolen.id);
    expect(next.players[0]?.zones.exile).toContain(stolen.id);
    expect(next.players[1]?.zones.removed).not.toContain(stolen.id);
    expect(next.players[1]?.zones.battlefield).not.toContain(stolen.id);
  });

  it("keeps remaining players and their cards valid after one player is eliminated", () => {
    const { game, p1, p2, p3 } = threePlayers();
    const p1Bear = placeOwnedCard(game, p1.id, "battlefield", "P1 Bear", "Creature — Bear");
    const p2Bear = placeOwnedCard(game, p2.id, "battlefield", "P2 Bear", "Creature — Bear");
    const p3Bear = placeOwnedCard(game, p3.id, "hand", "P3 Spell");
    const next = applyAction(game, { kind: "concede", playerId: p2.id });
    expect(livingPlayers(next).map((player) => player.id)).toEqual([p1.id, p3.id]);
    expect(next.winnerId).toBeNull();
    expect(isGameOver(next)).toBe(false);
    expect(next.cards[p1Bear.id]?.zone).toBe("battlefield");
    expect(next.players[0]?.zones.battlefield).toContain(p1Bear.id);
    expect(next.cards[p3Bear.id]?.zone).toBe("hand");
    expect(next.players[2]?.zones.hand).toContain(p3Bear.id);
    expect(next.cards[p2Bear.id]?.zone).toBe("removed");
    expect(next.players[0]?.lost).toBe(false);
    expect(next.players[2]?.lost).toBe(false);
  });

  it("recognizes the game as finished when one player remains", () => {
    const { game, p1, p2 } = twoPlayers();
    const next = applyEffect(game, { kind: "lose_life", playerId: p2.id, amount: 40 });
    expect(livingPlayers(next)).toHaveLength(1);
    expect(livingPlayers(next)[0]?.id).toBe(p1.id);
    expect(next.winnerId).toBe(p1.id);
    expect(isGameOver(next)).toBe(true);
  });

  it("serializes the post-elimination board, including removed and exiled cards", () => {
    const { game, p1, p2 } = twoPlayers();
    const owned = placeOwnedCard(game, p2.id, "hand", "Test Note");
    const stolen = placeOwnedCard(
      game,
      p1.id,
      "battlefield",
      "Test Bear",
      "Creature — Bear",
    );
    game.cards[stolen.id]!.controllerId = p2.id;
    const next = applyAction(game, { kind: "concede", playerId: p2.id });
    const restored = parseGameState(serializeGameState(next));
    expect(restored).toEqual(next);
    expect(restored.players[1]?.lost).toBe(true);
    expect(restored.winnerId).toBe(p1.id);
    expect(restored.cards[owned.id]?.zone).toBe("removed");
    expect(restored.players[1]?.zones.removed).toContain(owned.id);
    expect(restored.cards[stolen.id]?.zone).toBe("exile");
    expect(isGameOver(restored)).toBe(true);
  });
});
