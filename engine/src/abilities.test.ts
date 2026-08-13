import { describe, expect, it } from "vitest";
import {
  applyEffect,
  createCardDefinition,
  createCardInstance,
  createGameState,
  parseGameState,
  serializeGameState,
} from "./index";

function twoPlayers() {
  const game = createGameState({ playerCount: 2 });
  const p1 = game.players[0];
  const p2 = game.players[1];
  if (!p1 || !p2) {
    throw new Error("need players");
  }
  return { game, p1, p2 };
}

describe("ability architecture", () => {
  it("mills library cards into the graveyard and mills fewer if the library is short", () => {
    const { game, p1 } = twoPlayers();
    const first = createCardDefinition({ name: "A", typeLine: "Instant" });
    const second = createCardDefinition({ name: "B", typeLine: "Instant" });
    const top = createCardInstance({ definitionId: first.id, ownerId: p1.id, zone: "library" });
    const bottom = createCardInstance({ definitionId: second.id, ownerId: p1.id, zone: "library" });
    game.definitions[first.id] = first;
    game.definitions[second.id] = second;
    game.cards[top.id] = top;
    game.cards[bottom.id] = bottom;
    p1.zones.library.push(top.id, bottom.id);

    const milled = applyEffect(game, { kind: "mill", playerId: p1.id, count: 1 });
    expect(milled.players[0]?.zones.graveyard).toEqual([top.id]);
    expect(milled.players[0]?.zones.library).toEqual([bottom.id]);
    expect(milled.log.some((entry) => entry.cardId === top.id && entry.to === "graveyard")).toBe(
      true,
    );

    const rest = applyEffect(milled, { kind: "mill", playerId: p1.id, count: 4 });
    expect(rest.players[0]?.zones.library).toEqual([]);
    expect(rest.players[0]?.zones.graveyard).toEqual([top.id, bottom.id]);
  });

  it("discards from the front of hand without throwing when the hand is empty", () => {
    const { game, p1 } = twoPlayers();
    const definition = createCardDefinition({ name: "Bolt", typeLine: "Instant" });
    const card = createCardInstance({ definitionId: definition.id, ownerId: p1.id, zone: "hand" });
    game.definitions[definition.id] = definition;
    game.cards[card.id] = card;
    p1.zones.hand.push(card.id);

    const discarded = applyEffect(game, { kind: "discard", playerId: p1.id, count: 1 });
    expect(discarded.players[0]?.zones.hand).toEqual([]);
    expect(discarded.players[0]?.zones.graveyard).toEqual([card.id]);

    const empty = applyEffect(discarded, { kind: "discard", playerId: p1.id, count: 1 });
    expect(empty.players[0]?.zones.hand).toEqual([]);
  });

  it("sacrifices a battlefield permanent to the graveyard", () => {
    const { game, p1 } = twoPlayers();
    const definition = createCardDefinition({
      name: "Goat",
      typeLine: "Creature — Goat",
      power: 0,
      toughness: 1,
    });
    const card = createCardInstance({
      definitionId: definition.id,
      ownerId: p1.id,
      zone: "battlefield",
    });
    game.definitions[definition.id] = definition;
    game.cards[card.id] = card;
    p1.zones.battlefield.push(card.id);

    const next = applyEffect(game, { kind: "sacrifice", cardId: card.id });
    expect(next.cards[card.id]?.zone).toBe("graveyard");
    expect(() => applyEffect(game, { kind: "sacrifice", cardId: card.id })).not.toThrow();
    expect(game.cards[card.id]?.zone).toBe("battlefield");
  });

  it("adds +1/+1 counters and round-trips them", () => {
    const { game, p1 } = twoPlayers();
    const definition = createCardDefinition({
      name: "Bear",
      typeLine: "Creature — Bear",
      power: 2,
      toughness: 2,
    });
    const card = createCardInstance({
      definitionId: definition.id,
      ownerId: p1.id,
      zone: "battlefield",
    });
    game.definitions[definition.id] = definition;
    game.cards[card.id] = card;
    p1.zones.battlefield.push(card.id);

    const next = applyEffect(game, {
      kind: "add_counter",
      cardId: card.id,
      counter: "p1p1",
      amount: 2,
    });
    expect(next.cards[card.id]?.counters.p1p1).toBe(2);
    const restored = parseGameState(serializeGameState(next));
    expect(restored).toEqual(next);
  });
});
