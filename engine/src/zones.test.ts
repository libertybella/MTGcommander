import { describe, expect, it } from "vitest";
import {
  createCardDefinition,
  createCardInstance,
  createGameState,
  parseGameState,
  serializeGameState,
} from "./index";
import { countCardPlacements, moveCard } from "./zones";
import type { GameState, ZoneName } from "./types";

const ZONES: ZoneName[] = [
  "library",
  "hand",
  "battlefield",
  "graveyard",
  "exile",
  "command",
];

function gameWithOneCard(): { game: GameState; cardId: string; otherId: string } {
  const game = createGameState({ playerCount: 2 });
  const p1 = game.players[0];
  const p2 = game.players[1];
  if (!p1 || !p2) {
    throw new Error("need two players");
  }
  const def = createCardDefinition({ name: "Forest", typeLine: "Basic Land — Forest" });
  const otherDef = createCardDefinition({ name: "Island", typeLine: "Basic Land — Island" });
  game.definitions[def.id] = def;
  game.definitions[otherDef.id] = otherDef;
  const card = createCardInstance({
    definitionId: def.id,
    ownerId: p1.id,
    zone: "library",
  });
  const other = createCardInstance({
    definitionId: otherDef.id,
    ownerId: p1.id,
    zone: "hand",
  });
  game.cards[card.id] = card;
  game.cards[other.id] = other;
  p1.zones.library.push(card.id);
  p1.zones.hand.push(other.id);
  return { game, cardId: card.id, otherId: other.id };
}

describe("zone movement", () => {
  it("moves a card through all six player zones with a stable instance id", () => {
    let { game, cardId } = gameWithOneCard();
    const originalId = cardId;
    for (const zone of ZONES) {
      if (game.cards[cardId]?.zone === zone) {
        continue;
      }
      game = moveCard(game, cardId, zone);
      expect(game.cards[cardId]?.id).toBe(originalId);
      expect(game.cards[cardId]?.zone).toBe(zone);
      expect(countCardPlacements(game, cardId)).toBe(1);
    }
  });

  it("treats library index 0 as the top", () => {
    const { game, cardId, otherId } = gameWithOneCard();
    const p1 = game.players[0];
    if (!p1) {
      throw new Error("missing player");
    }
    const moved = moveCard(game, otherId, "library", { libraryPosition: "top" });
    expect(moved.players[0]?.zones.library[0]).toBe(otherId);
    expect(moved.players[0]?.zones.library[1]).toBe(cardId);
  });

  it("does not change owner when a card moves", () => {
    const { game, cardId } = gameWithOneCard();
    const ownerId = game.cards[cardId]?.ownerId;
    const next = moveCard(game, cardId, "battlefield");
    expect(next.cards[cardId]?.ownerId).toBe(ownerId);
    expect(next.cards[cardId]?.controllerId).toBe(ownerId);
  });

  it("rejects moving a card that is not in a zone", () => {
    const { game, cardId } = gameWithOneCard();
    const broken = parseGameState(serializeGameState(game));
    const player = broken.players[0];
    if (!player) {
      throw new Error("missing player");
    }
    player.zones.library = [];
    expect(() => moveCard(broken, cardId, "graveyard")).toThrow(
      /not in any player zone/,
    );
  });

  it("rejects unknown cards", () => {
    const game = createGameState({ playerCount: 2 });
    expect(() => moveCard(game, "missing", "hand")).toThrow(/Unknown card/);
  });

  it("leaves unrelated cards unchanged", () => {
    const { game, cardId, otherId } = gameWithOneCard();
    const next = moveCard(game, cardId, "exile");
    expect(next.cards[otherId]?.zone).toBe("hand");
    expect(next.players[0]?.zones.hand).toEqual([otherId]);
    expect(next.players[1]?.zones).toEqual(game.players[1]?.zones);
  });

  it("does not mutate the original GameState", () => {
    const { game, cardId } = gameWithOneCard();
    const snapshot = serializeGameState(game);
    moveCard(game, cardId, "graveyard");
    expect(serializeGameState(game)).toBe(snapshot);
  });

  it("still round-trips after movement", () => {
    const { game, cardId } = gameWithOneCard();
    const moved = moveCard(game, cardId, "command");
    const restored = parseGameState(serializeGameState(moved));
    expect(restored).toEqual(moved);
    expect(countCardPlacements(restored, cardId)).toBe(1);
  });

  it("allows library to hand as generic movement, not a draw engine", () => {
    const { game, cardId } = gameWithOneCard();
    const next = moveCard(game, cardId, "hand");
    expect(next.cards[cardId]?.zone).toBe("hand");
    expect(next.players[0]?.zones.library).toHaveLength(0);
    expect(next.players[0]?.zones.hand).toContain(cardId);
  });
});
