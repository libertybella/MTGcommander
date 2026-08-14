import { describe, expect, it } from "vitest";
import {
  applyEffect,
  createCardDefinition,
  createCardInstance,
  createGameState,
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

describe("state-based actions", () => {
  it("puts a 0-toughness creature into the graveyard, including indestructible", () => {
    const { game, p1 } = twoPlayers();
    const definition = createCardDefinition({
      name: "Zero",
      typeLine: "Creature — Spirit",
      power: 0,
      toughness: 0,
      keywords: ["indestructible"],
    });
    const card = createCardInstance({
      definitionId: definition.id,
      ownerId: p1.id,
      zone: "battlefield",
    });
    game.definitions[definition.id] = definition;
    game.cards[card.id] = card;
    p1.zones.battlefield.push(card.id);

    const next = applyEffect(game, { kind: "gain_life", playerId: p1.id, amount: 1 });
    expect(next.cards[card.id]?.zone).toBe("graveyard");
  });

  it("eliminates a player after a failed library draw", () => {
    const { game, p1, p2 } = twoPlayers();
    const next = applyEffect(game, { kind: "draw", playerId: p1.id, count: 1 });
    expect(next.players[0]?.lost).toBe(true);
    expect(next.winnerId).toBe(p2.id);
  });
});
