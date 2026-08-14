import { describe, expect, it } from "vitest";
import {
  applyAction,
  countedMulligans,
  isMulliganOpen,
  parseGameAction,
  parseGameState,
  POOL_ID,
  serializeGameAction,
  serializeGameState,
  startCatalogGame,
} from "./index";

function library(): string[] {
  return Array.from({ length: 14 }, (_, index) =>
    index % 2 === 0 ? POOL_ID.mountain : POOL_ID.forest,
  );
}

function twoPlayer(skipMulligan = false) {
  return startCatalogGame({
    playerCount: 2,
    playerNames: ["You", "Opponent"],
    skipMulligan,
    openingHandSize: 7,
    decks: [
      { commanderDefinitionId: POOL_ID.dragon, libraryDefinitionIds: library() },
      { commanderDefinitionId: POOL_ID.dragon, libraryDefinitionIds: library() },
    ],
  });
}

describe("London mulligan", () => {
  it("starts with seven cards and waits for the first player", () => {
    const game = twoPlayer();
    const you = game.players[0];
    if (!you) {
      throw new Error("missing you");
    }
    expect(isMulliganOpen(game)).toBe(true);
    expect(you.zones.hand).toHaveLength(7);
    expect(game.mulligan?.decidingPlayerId).toBe(you.id);
  });

  it("keeps a seven-card hand and then lets the opponent decide", () => {
    const start = twoPlayer();
    const you = start.players[0];
    const them = start.players[1];
    if (!you || !them) {
      throw new Error("missing players");
    }
    const kept = applyAction(start, { kind: "keep_hand", playerId: you.id });
    expect(kept.players[0]?.zones.hand).toHaveLength(7);
    expect(kept.mulligan?.decidingPlayerId).toBe(them.id);
    const done = applyAction(kept, { kind: "keep_hand", playerId: them.id });
    expect(isMulliganOpen(done)).toBe(false);
  });

  it("shuffles, draws seven, then bottoms one card on a two-player first mulligan", () => {
    const start = twoPlayer();
    const you = start.players[0];
    if (!you) {
      throw new Error("missing you");
    }
    const mulled = applyAction(start, { kind: "mulligan", playerId: you.id });
    const after = mulled.players[0];
    if (!after) {
      throw new Error("missing you");
    }
    expect(after.zones.hand).toHaveLength(7);
    expect(mulled.mulligan?.pendingBottom).toBe(1);
    expect(countedMulligans(mulled, you.id)).toBe(1);
    const bottomId = after.zones.hand[0];
    if (!bottomId) {
      throw new Error("missing card");
    }
    const bottomed = applyAction(mulled, {
      kind: "bottom_cards",
      playerId: you.id,
      cardIds: [bottomId],
    });
    expect(bottomed.players[0]?.zones.hand).toHaveLength(6);
    expect(bottomed.players[0]?.zones.hand.includes(bottomId)).toBe(false);
    expect(bottomed.mulligan?.pendingBottom).toBe(0);
    const kept = applyAction(bottomed, { kind: "keep_hand", playerId: you.id });
    expect(kept.players[0]?.zones.hand).toHaveLength(6);
    expect(kept.mulligan?.decidingPlayerId).toBe(kept.players[1]?.id);
  });

  it("does not count the first mulligan in a three-player game", () => {
    const deck = {
      commanderDefinitionId: POOL_ID.dragon,
      libraryDefinitionIds: library(),
    };
    const start = startCatalogGame({
      playerCount: 3,
      playerNames: ["You", "Opponent 1", "Opponent 2"],
      skipMulligan: false,
      decks: [deck, deck, deck],
    });
    const you = start.players[0];
    if (!you) {
      throw new Error("missing you");
    }
    const mulled = applyAction(start, { kind: "mulligan", playerId: you.id });
    expect(mulled.mulligan?.pendingBottom).toBe(0);
    expect(countedMulligans(mulled, you.id)).toBe(0);
    expect(mulled.players[0]?.zones.hand).toHaveLength(7);
  });

  it("rejects playing a land during mulligans", () => {
    const start = twoPlayer();
    const you = start.players[0];
    const landId = you?.zones.hand.find(
      (cardId) => start.definitions[start.cards[cardId]?.definitionId ?? ""]?.name === "Test Mountain",
    );
    if (!you || !landId) {
      throw new Error("expected a mountain");
    }
    expect(() =>
      applyAction(start, { kind: "play_land", playerId: you.id, cardId: landId }),
    ).toThrow(/mulligan/i);
    expect(start.players[0]?.zones.hand).toHaveLength(7);
  });

  it("round-trips mulligan actions", () => {
    const keep = { kind: "keep_hand" as const, playerId: "player-1" };
    const mulligan = { kind: "mulligan" as const, playerId: "player-1" };
    const bottom = { kind: "bottom_cards" as const, playerId: "player-1", cardIds: ["card-1"] };
    expect(parseGameAction(serializeGameAction(keep))).toEqual(keep);
    expect(parseGameAction(serializeGameAction(mulligan))).toEqual(mulligan);
    expect(parseGameAction(serializeGameAction(bottom))).toEqual(bottom);
    const game = twoPlayer();
    expect(parseGameState(serializeGameState(game)).mulligan).toEqual(game.mulligan);
  });
});
