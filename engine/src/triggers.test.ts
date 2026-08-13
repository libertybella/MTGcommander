import { describe, expect, it } from "vitest";
import {
  applyAction,
  applyEffect,
  createCardDefinition,
  createCardInstance,
  createGameState,
  moveCard,
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

function passUntilEmptyStack(game: GameState): GameState {
  let next = game;
  let guard = 0;
  while (next.stack.length > 0) {
    next = applyAction(next, { kind: "pass_priority", playerId: next.priorityPlayerId });
    guard += 1;
    if (guard > 40) {
      throw new Error("stack did not clear");
    }
  }
  return next;
}

describe("triggered abilities", () => {
  it("puts an enter-the-battlefield trigger on the stack and resolves its effects", () => {
    const { game, p1 } = twoPlayers();
    const definition = createCardDefinition({
      name: "ETB Cleric",
      typeLine: "Creature — Cleric",
      power: 1,
      toughness: 1,
      triggers: [
        {
          event: "enter_battlefield",
          effects: [{ kind: "gain_life", playerId: "controller", amount: 3 }],
        },
      ],
    });
    const card = createCardInstance({
      definitionId: definition.id,
      ownerId: p1.id,
      zone: "hand",
    });
    game.definitions[definition.id] = definition;
    game.cards[card.id] = card;
    p1.zones.hand.push(card.id);

    const entered = moveCard(game, card.id, "battlefield");
    expect(entered.cards[card.id]?.zone).toBe("battlefield");
    expect(entered.stack).toHaveLength(1);
    expect(entered.stack[0]?.kind).toBe("ability");
    expect(entered.stack[0]?.sourceId).toBe(card.id);
    expect(entered.players[0]?.life).toBe(40);

    const resolved = passUntilEmptyStack(entered);
    expect(resolved.stack).toHaveLength(0);
    expect(resolved.players[0]?.life).toBe(43);
    expect(resolved.cards[card.id]?.zone).toBe("battlefield");
  });

  it("creating a token without triggers does not put an ability on the stack", () => {
    const { game, p1 } = twoPlayers();
    const next = applyEffect(game, {
      kind: "create_token",
      ownerId: p1.id,
      name: "Soldier",
      typeLine: "Creature — Soldier Token",
      power: 1,
      toughness: 1,
    });
    expect(next.stack).toHaveLength(0);
    expect(next.players[0]?.zones.battlefield).toHaveLength(1);
  });
});
