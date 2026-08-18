import { describe, expect, it } from "vitest";
import {
  createCardDefinition,
  createCardInstance,
  createGameState,
} from "./index";
import { fillLibraries } from "./testSupport";
import { TURN_SEQUENCE, advanceStep, advanceSteps, skipPriorityShortcuts } from "./turn";

function gameWithLibraries(playerCount: 2 | 3 | 4) {
  const game = createGameState({ playerCount });
  fillLibraries(game);
  return game;
}

describe("turn progression", () => {
  it("walks every step in a turn", () => {
    let game = gameWithLibraries(2);
    expect(game.turn).toMatchObject({
      number: 1,
      phase: "beginning",
      step: "untap",
    });
    const seen: string[] = [`${game.turn.phase}/${game.turn.step}`];
    for (let i = 1; i < TURN_SEQUENCE.length; i += 1) {
      game = advanceStep(game);
      seen.push(`${game.turn.phase}/${game.turn.step}`);
    }
    expect(seen).toEqual(
      TURN_SEQUENCE.map((slot) => `${slot.phase}/${slot.step}`),
    );
    expect(game.turn.activePlayerId).toBe(game.players[0]?.id);
  });

  it("passes the turn to the next player after cleanup", () => {
    const game = gameWithLibraries(2);
    const first = game.players[0]?.id;
    const second = game.players[1]?.id;
    const nextTurn = advanceSteps(game, TURN_SEQUENCE.length);
    expect(nextTurn.turn.activePlayerId).toBe(second);
    expect(nextTurn.turn.number).toBe(1);
    expect(nextTurn.turn.phase).toBe("beginning");
    expect(nextTurn.turn.step).toBe("untap");
    const thirdTurn = advanceSteps(nextTurn, TURN_SEQUENCE.length);
    expect(thirdTurn.turn.activePlayerId).toBe(first);
    expect(thirdTurn.turn.number).toBe(2);
  });

  it("increments the turn number only when play returns to the first player", () => {
    const game = gameWithLibraries(3);
    const first = game.players[1];
    const second = game.players[2];
    const third = game.players[0];
    if (!first || !second || !third) {
      throw new Error("missing players");
    }
    game.firstPlayerId = first.id;
    game.turn.activePlayerId = first.id;
    game.priorityPlayerId = first.id;

    const afterSecond = advanceSteps(game, TURN_SEQUENCE.length);
    expect(afterSecond.turn.activePlayerId).toBe(second.id);
    expect(afterSecond.turn.number).toBe(1);

    const afterThird = advanceSteps(afterSecond, TURN_SEQUENCE.length);
    expect(afterThird.turn.activePlayerId).toBe(third.id);
    expect(afterThird.turn.number).toBe(1);

    const afterFirstAgain = advanceSteps(afterThird, TURN_SEQUENCE.length);
    expect(afterFirstAgain.turn.activePlayerId).toBe(first.id);
    expect(afterFirstAgain.turn.number).toBe(2);
  });

  it("wraps turn order with four players", () => {
    let game = gameWithLibraries(4);
    const order = game.players.map((p) => p.id);
    for (let turn = 0; turn < 4; turn += 1) {
      expect(game.turn.activePlayerId).toBe(order[turn]);
      game = advanceSteps(game, TURN_SEQUENCE.length);
    }
    expect(game.turn.activePlayerId).toBe(order[0]);
    expect(game.turn.number).toBe(2);
  });

  it("draws a card for the active player on the draw step", () => {
    const game = createGameState({ playerCount: 2 });
    const p1 = game.players[0];
    if (!p1) {
      throw new Error("missing player");
    }
    const def = createCardDefinition({ name: "Forest", typeLine: "Basic Land — Forest" });
    const card = createCardInstance({
      definitionId: def.id,
      ownerId: p1.id,
      zone: "library",
    });
    game.definitions[def.id] = def;
    game.cards[card.id] = card;
    p1.zones.library.push(card.id);

    const atDraw = advanceSteps(game, 2);
    expect(atDraw.turn.step).toBe("draw");
    expect(atDraw.players[0]?.zones.library).toEqual([]);
    expect(atDraw.players[0]?.zones.hand).toEqual([card.id]);
    expect(atDraw.cards[card.id]?.zone).toBe("hand");
  });

  it("untaps the active player's battlefield permanents", () => {
    const game = gameWithLibraries(2);
    const p1 = game.players[0];
    const p2 = game.players[1];
    if (!p1 || !p2) {
      throw new Error("missing players");
    }
    const def = createCardDefinition({ name: "Bear", typeLine: "Creature — Bear" });
    game.definitions[def.id] = def;
    const activeBear = createCardInstance({
      definitionId: def.id,
      ownerId: p1.id,
      zone: "battlefield",
    });
    const opponentBear = createCardInstance({
      definitionId: def.id,
      ownerId: p2.id,
      zone: "battlefield",
    });
    activeBear.tapped = true;
    opponentBear.tapped = true;
    game.cards[activeBear.id] = activeBear;
    game.cards[opponentBear.id] = opponentBear;
    p1.zones.battlefield.push(activeBear.id);
    p2.zones.battlefield.push(opponentBear.id);

    const afterFullTurn = advanceSteps(game, TURN_SEQUENCE.length);
    expect(afterFullTurn.turn.activePlayerId).toBe(p2.id);
    expect(afterFullTurn.cards[opponentBear.id]?.tapped).toBe(false);
    expect(afterFullTurn.cards[activeBear.id]?.tapped).toBe(true);
  });

  it("simulates multiple turns without changing player count", () => {
    const start = gameWithLibraries(3);
    const later = advanceSteps(start, TURN_SEQUENCE.length * 6);
    expect(later.players).toHaveLength(3);
    expect(later.turn.number).toBe(3);
  });

  it("skips draw, beginning of combat, and cleanup as empty-stack shortcuts", () => {
    const fromMain = advanceSteps(gameWithLibraries(2), 3);
    expect(fromMain.turn.step).toBe("precombatMain");
    const skipped = skipPriorityShortcuts(advanceStep(fromMain));
    expect(skipped.turn.step).toBe("declareAttackers");
  });
});
