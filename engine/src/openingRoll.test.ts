import { describe, expect, it } from "vitest";
import {
  applyOpeningRoll,
  beginOpeningRoll,
  isMulliganOpen,
  isOpeningRoll,
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

function twoPlayer(skipMulligan = false, skipOpeningRoll = false) {
  return startCatalogGame({
    playerCount: 2,
    playerNames: ["You", "Opponent"],
    skipMulligan,
    skipOpeningRoll,
    openingHandSize: 7,
    decks: [
      { commanderDefinitionId: POOL_ID.dragon, libraryDefinitionIds: library() },
      { commanderDefinitionId: POOL_ID.dragon, libraryDefinitionIds: library() },
    ],
  });
}

describe("opening d20", () => {
  it("starts client games in the opening roll instead of mulligans", () => {
    const game = twoPlayer();
    expect(isOpeningRoll(game)).toBe(true);
    expect(isMulliganOpen(game)).toBe(false);
    expect(game.openingRoll?.startingHandSize).toBe(7);
  });

  it("skips the opening roll when mulligans are skipped", () => {
    const game = twoPlayer(true);
    expect(isOpeningRoll(game)).toBe(false);
    expect(isMulliganOpen(game)).toBe(false);
  });

  it("makes the highest roller the first player and starts mulligans", () => {
    const start = twoPlayer();
    const you = start.players[0];
    const them = start.players[1];
    if (!you || !them) {
      throw new Error("missing players");
    }
    const afterYou = applyOpeningRoll(start, you.id, () => 0.99);
    expect(afterYou.openingRoll?.rolls[you.id]).toBe(20);
    const done = applyOpeningRoll(afterYou, them.id, () => 0);
    expect(isOpeningRoll(done)).toBe(false);
    expect(done.turn.activePlayerId).toBe(you.id);
    expect(done.firstPlayerId).toBe(you.id);
    expect(done.priorityPlayerId).toBe(you.id);
    expect(isMulliganOpen(done)).toBe(true);
    expect(done.mulligan?.decidingPlayerId).toBe(you.id);
    expect(done.log.some((entry) => entry.kind === "first_player" && entry.playerId === you.id)).toBe(
      true,
    );
  });

  it("clears tied leaders so they roll again", () => {
    const start = twoPlayer();
    const you = start.players[0];
    const them = start.players[1];
    if (!you || !them) {
      throw new Error("missing players");
    }
    const tied = applyOpeningRoll(applyOpeningRoll(start, you.id, () => 0.5), them.id, () => 0.5);
    expect(isOpeningRoll(tied)).toBe(true);
    expect(tied.openingRoll?.rolls[you.id]).toBeUndefined();
    expect(tied.openingRoll?.rolls[them.id]).toBeUndefined();
    expect(tied.log.some((entry) => entry.kind === "opening_tie")).toBe(true);
  });

  it("lets a later player win and decide mulligans first", () => {
    const start = twoPlayer();
    const you = start.players[0];
    const them = start.players[1];
    if (!you || !them) {
      throw new Error("missing players");
    }
    const done = applyOpeningRoll(applyOpeningRoll(start, you.id, () => 0), them.id, () => 0.99);
    expect(done.turn.activePlayerId).toBe(them.id);
    expect(done.mulligan?.decidingPlayerId).toBe(them.id);
  });

  it("round-trips opening roll state and actions", () => {
    const mid = beginOpeningRoll(twoPlayer(true), 7);
    expect(parseGameState(serializeGameState(mid)).openingRoll).toEqual(mid.openingRoll);
    const action = { kind: "opening_roll" as const, playerId: "player-1" };
    expect(parseGameAction(serializeGameAction(action))).toEqual(action);
  });
});
