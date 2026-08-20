import { describe, expect, it } from "vitest";
import { applyAction, applyActions } from "./actions";
import { createGameState } from "./createGame";
import { fillLibraries } from "./testSupport";
import { DEFAULT_SHORTCUT_POLICY } from "./turn";
import type { GameAction, GameState, Step } from "./types";

function mainPhaseGame(): GameState {
  const game = createGameState({ playerCount: 2 });
  fillLibraries(game);
  game.turn.phase = "precombatMain";
  game.turn.step = "precombatMain";
  return game;
}

function passAround(game: GameState): GameAction[] {
  return game.players.map((player) => ({ kind: "pass_priority" as const, playerId: player.id }));
}

describe("host-owned shortcut policy", () => {
  it("skips begin combat by default after a full pass", () => {
    const game = mainPhaseGame();
    const after = applyActions(game, passAround(game));
    expect(after.turn.step).toBe("declareAttackers");
  });

  it("stops at begin combat when the policy does not skip it", () => {
    const game = mainPhaseGame();
    const holdAtBeginCombat = {
      skippableSteps: new Set<Step>(["draw", "cleanup"]),
    };
    const after = applyActions(game, passAround(game), { shortcuts: holdAtBeginCombat });
    expect(after.turn.step).toBe("beginCombat");
  });

  it("default policy set is draw, begin combat, and cleanup", () => {
    expect([...DEFAULT_SHORTCUT_POLICY.skippableSteps].sort()).toEqual(
      ["beginCombat", "cleanup", "draw"],
    );
  });

  it("logs advance_step as a table fast-forward", () => {
    const game = mainPhaseGame();
    const actor = game.players[0]!.id;
    const after = applyAction(game, { kind: "advance_step", playerId: actor });
    const entry = after.log.find((line) => line.kind === "override");
    expect(entry).toMatchObject({ kind: "override", playerId: actor });
  });

  it("logs advance_turn with the number of discarded stack objects", () => {
    const game = mainPhaseGame();
    const actor = game.players[0]!.id;
    game.stack.push({
      id: "stack-test",
      controllerId: actor,
      sourceId: null,
      kind: "ability",
      targets: [],
    });
    const after = applyAction(game, { kind: "advance_turn", playerId: actor });
    const entry = after.log.find((line) => line.kind === "override");
    expect(entry?.kind === "override" && entry.summary.includes("discarding 1")).toBe(true);
    expect(after.stack).toEqual([]);
  });
});
