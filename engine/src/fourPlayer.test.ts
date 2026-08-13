import { describe, expect, it } from "vitest";
import {
  applyAction,
  createCardDefinition,
  createCardInstance,
  createGameState,
  parseGameState,
  redactForViewer,
  serializeGameState,
  TURN_SEQUENCE,
} from "./index";
import { advanceSteps } from "./turn";
import { HIDDEN_DEFINITION_ID } from "./visibility";
import type { GameState } from "./types";

function fourPlayers() {
  const game = createGameState({
    playerCount: 4,
    playerNames: ["Ross", "A", "B", "C"],
  });
  const [p1, p2, p3, p4] = game.players;
  if (!p1 || !p2 || !p3 || !p4) {
    throw new Error("need four players");
  }
  return { game, p1, p2, p3, p4 };
}

function addHiddenCard(game: GameState, ownerId: string, zone: "hand" | "library", name: string) {
  const owner = game.players.find((player) => player.id === ownerId);
  if (!owner) {
    throw new Error("missing owner");
  }
  const definition = createCardDefinition({ name, typeLine: "Instant" });
  const card = createCardInstance({ definitionId: definition.id, ownerId, zone });
  game.definitions[definition.id] = definition;
  game.cards[card.id] = card;
  owner.zones[zone].push(card.id);
  return { definition, card };
}

function creature(game: GameState, ownerId: string, name: string) {
  const owner = game.players.find((player) => player.id === ownerId);
  if (!owner) {
    throw new Error("missing owner");
  }
  const definition = createCardDefinition({
    name,
    typeLine: "Creature — Soldier",
    power: 2,
    toughness: 2,
  });
  const card = createCardInstance({
    definitionId: definition.id,
    ownerId,
    zone: "battlefield",
    summoningSick: false,
  });
  game.definitions[definition.id] = definition;
  game.cards[card.id] = card;
  owner.zones.battlefield.push(card.id);
  return card;
}

function passTo(game: GameState, step: GameState["turn"]["step"]): GameState {
  let next = game;
  let guard = 0;
  while (next.turn.step !== step) {
    next = applyAction(next, { kind: "pass_priority", playerId: next.priorityPlayerId });
    guard += 1;
    if (guard > 200) {
      throw new Error(`Could not reach ${step}`);
    }
  }
  return next;
}

describe("four-player engine", () => {
  it("creates four distinct identities", () => {
    const { game, p1, p2, p3, p4 } = fourPlayers();
    expect(game.players).toHaveLength(4);
    expect([p1.displayName, p2.displayName, p3.displayName, p4.displayName]).toEqual([
      "Ross",
      "A",
      "B",
      "C",
    ]);
    expect(new Set(game.players.map((player) => player.id)).size).toBe(4);
  });

  it("walks turn order around four living players", () => {
    const { game, p1, p2, p3, p4 } = fourPlayers();
    const order = [p1.id, p2.id, p3.id, p4.id];
    let next = game;
    for (let turn = 0; turn < 4; turn += 1) {
      expect(next.turn.activePlayerId).toBe(order[turn]);
      next = advanceSteps(next, TURN_SEQUENCE.length);
    }
    expect(next.turn.activePlayerId).toBe(p1.id);
    expect(next.turn.number).toBe(5);
  });

  it("passes priority around four players", () => {
    const { game, p1, p2, p3, p4 } = fourPlayers();
    let next = game;
    expect(next.priorityPlayerId).toBe(p1.id);
    next = applyAction(next, { kind: "pass_priority", playerId: p1.id });
    expect(next.priorityPlayerId).toBe(p2.id);
    next = applyAction(next, { kind: "pass_priority", playerId: p2.id });
    expect(next.priorityPlayerId).toBe(p3.id);
    next = applyAction(next, { kind: "pass_priority", playerId: p3.id });
    expect(next.priorityPlayerId).toBe(p4.id);
  });

  it("allows attacking two different opponents in one combat", () => {
    const { game, p1, p2, p3 } = fourPlayers();
    const a = creature(game, p1.id, "A");
    const b = creature(game, p1.id, "B");
    let next = passTo(game, "declareAttackers");
    next = applyAction(next, {
      kind: "declare_attackers",
      playerId: p1.id,
      attacks: [
        { attackerId: a.id, defenderId: p2.id },
        { attackerId: b.id, defenderId: p3.id },
      ],
    });
    next = passTo(next, "combatDamage");
    expect(next.players[1]?.life).toBe(38);
    expect(next.players[2]?.life).toBe(38);
    expect(next.players[3]?.life).toBe(40);
  });

  it("lets one of four players concede without ending the game", () => {
    const { game, p1, p2, p3 } = fourPlayers();
    const next = applyAction(game, { kind: "concede", playerId: p2.id });
    expect(next.players[1]?.lost).toBe(true);
    expect(next.winnerId).toBeNull();
    const afterTurn = advanceSteps(next, TURN_SEQUENCE.length);
    expect(afterTurn.turn.activePlayerId).toBe(p3.id);
    expect(p1.id).toBe(next.turn.activePlayerId);
  });

  it("hides opponent hands and libraries from a viewer while keeping public zones", () => {
    const { game, p1, p2 } = fourPlayers();
    const { definition: secretDef, card: secret } = addHiddenCard(game, p2.id, "hand", "Secret Bolt");
    addHiddenCard(game, p2.id, "library", "Secret Land");
    const bear = creature(game, p2.id, "Public Bear");
    const view = redactForViewer(game, p1.id);
    expect(view.players[1]?.zones.hand).toHaveLength(1);
    expect(view.cards[secret.id]?.definitionId).toBe(HIDDEN_DEFINITION_ID);
    expect(view.definitions[HIDDEN_DEFINITION_ID]?.name).toBe("Unknown Card");
    expect(view.definitions[secretDef.id]?.name).toBe("Secret Bolt");
    expect(view.cards[bear.id]?.definitionId).toBe(bear.definitionId);
    expect(view.definitions[bear.definitionId]?.name).toBe("Public Bear");
    const selfView = redactForViewer(game, p2.id);
    expect(selfView.cards[secret.id]?.definitionId).toBe(secretDef.id);
  });

  it("serializes a four-player game after a concession", () => {
    const { game, p2 } = fourPlayers();
    creature(game, p2.id, "Bear");
    const next = applyAction(game, { kind: "concede", playerId: p2.id });
    const restored = parseGameState(serializeGameState(next));
    expect(restored).toEqual(next);
    expect(restored.players).toHaveLength(4);
    expect(restored.players[1]?.lost).toBe(true);
  });
});
