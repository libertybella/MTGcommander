import { describe, expect, it } from "vitest";
import { createGameState } from "@mtgcommander/engine";
import { advanceButtonLabel, playtestActorId, showAdvanceButton } from "./advanceLabel";

describe("advance button label", () => {
  it("names the next step for the active player with empty-stack priority", () => {
    const game = createGameState({ playerCount: 2, playerNames: ["You", "Opponent"] });
    const you = game.players[0];
    const them = game.players[1];
    if (!you || !them) {
      throw new Error("need players");
    }
    game.turn.step = "upkeep";
    game.turn.phase = "beginning";
    expect(advanceButtonLabel(game, you.id)).toBe("Draw a card");
    game.turn.step = "precombatMain";
    game.turn.phase = "precombatMain";
    expect(advanceButtonLabel(game, you.id)).toBe("Move to combat phase");
    game.turn.step = "declareAttackers";
    game.turn.phase = "combat";
    expect(advanceButtonLabel(game, you.id)).toBe("Declare attackers");
    game.turn.step = "declareBlockers";
    expect(advanceButtonLabel(game, you.id)).toBe("Assign blockers");
    game.turn.step = "combatDamage";
    expect(advanceButtonLabel(game, you.id)).toBe("Combat damage");
    game.turn.step = "endCombat";
    expect(advanceButtonLabel(game, you.id)).toBe("Move to Main Phase 2");
    game.turn.step = "postcombatMain";
    game.turn.phase = "postcombatMain";
    expect(advanceButtonLabel(game, you.id)).toBe("Move to End Phase");
    game.turn.step = "end";
    game.turn.phase = "ending";
    expect(advanceButtonLabel(game, you.id)).toBe("Pass to Opponent");
    game.turn.step = "untap";
    game.turn.phase = "beginning";
    expect(advanceButtonLabel(game, you.id)).toBe("Untap");
  });

  it("says pass priority when the stack has objects or it is not your turn", () => {
    const game = createGameState({ playerCount: 2, playerNames: ["You", "Opponent"] });
    const you = game.players[0];
    const them = game.players[1];
    if (!you || !them) {
      throw new Error("need players");
    }
    game.turn.step = "precombatMain";
    game.stack.push({
      id: "stack-1",
      controllerId: you.id,
      sourceId: "card-1",
      kind: "spell",
      targets: [],
    });
    expect(advanceButtonLabel(game, you.id)).toBe("Pass priority");
    game.stack = [];
    game.priorityPlayerId = them.id;
    expect(advanceButtonLabel(game, you.id)).toBe("Pass priority");
    game.priorityPlayerId = them.id;
    game.turn.activePlayerId = them.id;
    expect(advanceButtonLabel(game, them.id)).toBe("Move to combat phase");
    game.priorityPlayerId = you.id;
    expect(advanceButtonLabel(game, you.id)).toBe("Pass priority");
  });

  it("only shows the advance button for the player who must act", () => {
    const game = createGameState({ playerCount: 2, playerNames: ["You", "Opponent"] });
    const you = game.players[0];
    const them = game.players[1];
    if (!you || !them) {
      throw new Error("need players");
    }
    game.turn.step = "precombatMain";
    game.turn.phase = "precombatMain";
    expect(showAdvanceButton(game, you.id)).toBe(true);
    expect(showAdvanceButton(game, them.id)).toBe(false);
    game.priorityPlayerId = them.id;
    expect(showAdvanceButton(game, you.id)).toBe(false);
    expect(showAdvanceButton(game, them.id)).toBe(false);
    game.stack.push({
      id: "stack-1",
      controllerId: you.id,
      sourceId: "card-1",
      kind: "spell",
      targets: [],
    });
    expect(showAdvanceButton(game, them.id)).toBe(true);
    expect(showAdvanceButton(game, you.id)).toBe(false);
  });

  it("picks the next player who must roll or keep in solo playtest", () => {
    const game = createGameState({ playerCount: 2, playerNames: ["You", "Opponent"] });
    const you = game.players[0];
    const them = game.players[1];
    if (!you || !them) {
      throw new Error("need players");
    }
    game.openingRoll = { rolls: { [you.id]: 12 }, startingHandSize: 7 };
    expect(playtestActorId(game, you.id, true)).toBe(them.id);
    expect(playtestActorId(game, you.id, false)).toBe(you.id);
    game.openingRoll = null;
    game.mulligan = {
      decidingPlayerId: them.id,
      taken: { [you.id]: 0, [them.id]: 0 },
      kept: { [you.id]: true, [them.id]: false },
      pendingBottom: 0,
      startingHandSize: 7,
    };
    expect(playtestActorId(game, you.id, true)).toBe(them.id);
    game.mulligan = null;
    game.priorityPlayerId = them.id;
    expect(playtestActorId(game, you.id, true)).toBe(them.id);
    game.prompts = [
      {
        kind: "choose_targets",
        playerId: them.id,
        sourceId: "card-1",
        origin: "trigger",
        triggerIndex: 0,
        requirements: [{ kind: "creature" }],
      },
    ];
    expect(playtestActorId(game, you.id, true)).toBe(them.id);
    expect(showAdvanceButton(game, them.id)).toBe(false);
  });
});
