import { describe, expect, it } from "vitest";
import {
  applyAction,
  beginMulligan,
  createCardDefinition,
  createCardInstance,
  createGameState,
  parseGameAction,
  parseGameState,
  serializeGameAction,
  serializeGameState,
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

function seatBear(game: GameState, ownerId: string, zone: "battlefield" | "library" | "hand" = "battlefield") {
  const definition = createCardDefinition({
    name: "Test Bear",
    typeLine: "Creature — Bear",
    manaCost: "{1}{G}",
    power: 2,
    toughness: 2,
  });
  const card = createCardInstance({
    definitionId: definition.id,
    ownerId,
    zone,
  });
  game.definitions[definition.id] = definition;
  game.cards[card.id] = card;
  const player = game.players.find((entry) => entry.id === ownerId);
  player?.zones[zone].push(card.id);
  return card;
}

describe("manual override", () => {
  it("adjusts life without priority and logs the override", () => {
    const { game, p1, p2 } = twoPlayers();
    game.priorityPlayerId = p2.id;
    const next = applyAction(game, {
      kind: "manual_override",
      playerId: p1.id,
      change: { type: "adjust_life", targetPlayerId: p2.id, delta: -1 },
    });
    expect(next.players[1]?.life).toBe(39);
    expect(next.priorityPlayerId).toBe(p2.id);
    expect(next.log.some((entry) => entry.kind === "override")).toBe(true);
    const override = next.log.find((entry) => entry.kind === "override");
    expect(override && override.kind === "override" ? override.summary : "").toMatch(/life -1/);
  });

  it("draws, mills, adds mana, taps, and moves a public card", () => {
    const { game, p1, p2 } = twoPlayers();
    const bear = seatBear(game, p1.id);
    const libraryCard = seatBear(game, p1.id, "library");
    const milled = seatBear(game, p2.id, "library");
    let next = applyAction(game, {
      kind: "manual_override",
      playerId: p1.id,
      change: { type: "draw", targetPlayerId: p1.id, count: 1 },
    });
    expect(next.players[0]?.zones.hand).toContain(libraryCard.id);
    next = applyAction(next, {
      kind: "manual_override",
      playerId: p1.id,
      change: { type: "add_mana", targetPlayerId: p1.id, color: "G" },
    });
    expect(next.players[0]?.mana.G).toBe(1);
    next = applyAction(next, {
      kind: "manual_override",
      playerId: p1.id,
      change: { type: "set_tapped", cardId: bear.id, tapped: true },
    });
    expect(next.cards[bear.id]?.tapped).toBe(true);
    next = applyAction(next, {
      kind: "manual_override",
      playerId: p1.id,
      change: { type: "move_card", cardId: bear.id, toZone: "graveyard" },
    });
    expect(next.players[0]?.zones.graveyard).toContain(bear.id);
    expect(next.players[0]?.zones.battlefield).not.toContain(bear.id);
    next = applyAction(next, {
      kind: "manual_override",
      playerId: p1.id,
      change: { type: "mill", targetPlayerId: p2.id, count: 1 },
    });
    expect(next.players[1]?.zones.graveyard).toContain(milled.id);
  });

  it("rejects hidden opponent library cards and leaves GameState unchanged", () => {
    const { game, p1, p2 } = twoPlayers();
    const hidden = seatBear(game, p2.id, "library");
    const before = serializeGameState(game);
    expect(() =>
      applyAction(game, {
        kind: "manual_override",
        playerId: p1.id,
        change: { type: "move_card", cardId: hidden.id, toZone: "graveyard" },
      }),
    ).toThrow(/hidden/i);
    expect(serializeGameState(game)).toBe(before);
  });

  it("rejects override during mulligan and after the game is over", () => {
    const { game, p1, p2 } = twoPlayers();
    const mulligan = beginMulligan(game);
    const beforeMulligan = serializeGameState(mulligan);
    expect(() =>
      applyAction(mulligan, {
        kind: "manual_override",
        playerId: p1.id,
        change: { type: "adjust_life", targetPlayerId: p2.id, delta: 1 },
      }),
    ).toThrow(/mulligan/i);
    expect(serializeGameState(mulligan)).toBe(beforeMulligan);

    const over = applyAction(game, { kind: "concede", playerId: p2.id });
    const beforeOver = serializeGameState(over);
    expect(() =>
      applyAction(over, {
        kind: "manual_override",
        playerId: p1.id,
        change: { type: "adjust_life", targetPlayerId: p1.id, delta: 1 },
      }),
    ).toThrow(/already over/i);
    expect(serializeGameState(over)).toBe(beforeOver);
  });

  it("round-trips the override action and a logged GameState", () => {
    const { game, p1, p2 } = twoPlayers();
    const action = {
      kind: "manual_override" as const,
      playerId: p1.id,
      change: { type: "adjust_life" as const, targetPlayerId: p2.id, delta: -3 },
    };
    expect(parseGameAction(serializeGameAction(action))).toEqual(action);
    const next = applyAction(game, action);
    expect(parseGameState(serializeGameState(next))).toEqual(next);
  });
});
