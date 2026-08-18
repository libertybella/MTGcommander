import { describe, expect, it } from "vitest";
import {
  applyAction,
  createCardDefinition,
  createCardInstance,
  createGameState,
  parseGameState,
  serializeGameState,
} from "./index";
import { fillLibraries } from "./testSupport";
import type { GameState } from "./types";

function twoPlayers() {
  const game = createGameState({ playerCount: 2 });
  const p1 = game.players[0];
  const p2 = game.players[1];
  if (!p1 || !p2) {
    throw new Error("need players");
  }
  fillLibraries(game);
  return { game, p1, p2 };
}

function creature(
  game: GameState,
  ownerId: string,
  name: string,
  power: number,
  toughness: number,
  options: { summoningSick?: boolean; commander?: boolean } = {},
) {
  const owner = game.players.find((player) => player.id === ownerId);
  if (!owner) {
    throw new Error("missing owner");
  }
  const definition = createCardDefinition({
    name,
    typeLine: name.toLowerCase().includes("commander")
      ? "Legendary Creature — Dragon"
      : "Creature",
    power,
    toughness,
  });
  const card = createCardInstance({
    definitionId: definition.id,
    ownerId,
    zone: "battlefield",
    summoningSick: options.summoningSick ?? false,
  });
  game.definitions[definition.id] = definition;
  game.cards[card.id] = card;
  owner.zones.battlefield.push(card.id);
  if (options.commander) {
    owner.commander.commanderIds.push(card.id);
  }
  return card;
}

function passTo(game: GameState, step: GameState["turn"]["step"]): GameState {
  let next = game;
  let guard = 0;
  while (next.turn.step !== step) {
    next = applyAction(next, { kind: "pass_priority", playerId: next.priorityPlayerId });
    guard += 1;
    if (guard > 80) {
      throw new Error(`Could not reach ${step} (at ${next.turn.step})`);
    }
  }
  return next;
}

function passN(game: GameState, count: number): GameState {
  let next = game;
  for (let i = 0; i < count; i += 1) {
    next = applyAction(next, { kind: "pass_priority", playerId: next.priorityPlayerId });
  }
  return next;
}

describe("combat", () => {
  it("deals unblocked combat damage to the defending player", () => {
    const { game, p1, p2 } = twoPlayers();
    const attacker = creature(game, p1.id, "Bear", 2, 2);
    let next = passTo(game, "declareAttackers");
    next = applyAction(next, {
      kind: "declare_attackers",
      playerId: p1.id,
      attacks: [{ attackerId: attacker.id, defenderId: p2.id }],
    });
    expect(next.cards[attacker.id]?.tapped).toBe(true);
    expect(next.cards[attacker.id]?.attacking).toBe(true);

    next = passTo(next, "combatDamage");
    expect(next.turn.step).toBe("combatDamage");
    expect(next.players[1]?.life).toBe(38);
    expect(next.cards[attacker.id]?.zone).toBe("battlefield");
  });

  it("handles multiple unblocked attackers", () => {
    const { game, p1, p2 } = twoPlayers();
    const a = creature(game, p1.id, "Bear", 2, 2);
    const b = creature(game, p1.id, "Cat", 3, 1);
    let next = passTo(game, "declareAttackers");
    next = applyAction(next, {
      kind: "declare_attackers",
      playerId: p1.id,
      attacks: [
        { attackerId: a.id, defenderId: p2.id },
        { attackerId: b.id, defenderId: p2.id },
      ],
    });
    next = passTo(next, "combatDamage");
    expect(next.players[1]?.life).toBe(35);
  });

  it("assigns damage between one attacker and one blocker", () => {
    const { game, p1, p2 } = twoPlayers();
    const attacker = creature(game, p1.id, "Bear", 2, 2);
    const blocker = creature(game, p2.id, "Wall", 1, 3);
    let next = passTo(game, "declareAttackers");
    next = applyAction(next, {
      kind: "declare_attackers",
      playerId: p1.id,
      attacks: [{ attackerId: attacker.id, defenderId: p2.id }],
    });
    next = passN(next, 2);
    expect(next.turn.step).toBe("declareBlockers");
    next = applyAction(next, {
      kind: "declare_blockers",
      playerId: p2.id,
      blocks: [{ blockerId: blocker.id, attackerId: attacker.id }],
    });
    expect(next.cards[blocker.id]?.blockingAttackerId).toBe(attacker.id);
    next = passN(next, 2);
    expect(next.turn.step).toBe("combatDamage");
    expect(next.players[1]?.life).toBe(40);
    expect(next.cards[attacker.id]?.damageMarked).toBe(1);
    expect(next.cards[blocker.id]?.damageMarked).toBe(2);
    expect(next.cards[attacker.id]?.zone).toBe("battlefield");
    expect(next.cards[blocker.id]?.zone).toBe("battlefield");
  });

  it("lets the active player declare another player's blockers", () => {
    const { game, p1, p2 } = twoPlayers();
    const attacker = creature(game, p1.id, "Bear", 2, 2);
    const blocker = creature(game, p2.id, "Wall", 1, 3);
    let next = passTo(game, "declareAttackers");
    next = applyAction(next, {
      kind: "declare_attackers",
      playerId: p1.id,
      attacks: [{ attackerId: attacker.id, defenderId: p2.id }],
    });
    next = passN(next, 2);
    expect(next.priorityPlayerId).toBe(p1.id);
    next = applyAction(next, {
      kind: "declare_blockers",
      playerId: p1.id,
      blocks: [{ blockerId: blocker.id, attackerId: attacker.id }],
    });
    expect(next.cards[blocker.id]?.blockingAttackerId).toBe(attacker.id);
    expect(next.priorityPlayerId).toBe(p1.id);
  });

  it("supports multiple blockers and kills a creature with lethal damage", () => {
    const { game, p1, p2 } = twoPlayers();
    const attacker = creature(game, p1.id, "Ogre", 3, 3);
    const b1 = creature(game, p2.id, "Goblin", 2, 2);
    const b2 = creature(game, p2.id, "Elf", 1, 1);
    let next = passTo(game, "declareAttackers");
    next = applyAction(next, {
      kind: "declare_attackers",
      playerId: p1.id,
      attacks: [{ attackerId: attacker.id, defenderId: p2.id }],
    });
    next = passN(next, 2);
    next = applyAction(next, {
      kind: "declare_blockers",
      playerId: p2.id,
      blocks: [
        { blockerId: b1.id, attackerId: attacker.id },
        { blockerId: b2.id, attackerId: attacker.id },
      ],
    });
    next = passN(next, 2);
    expect(next.cards[attacker.id]?.zone).toBe("graveyard");
    expect(next.cards[b1.id]?.zone).toBe("graveyard");
    expect(next.cards[b2.id]?.zone).toBe("graveyard");
    expect(next.players[1]?.life).toBe(40);
  });

  it("tracks commander damage from an unblocked commander", () => {
    const { game, p1, p2 } = twoPlayers();
    const commander = creature(game, p1.id, "Commander Dragon", 5, 5, { commander: true });
    let next = passTo(game, "declareAttackers");
    next = applyAction(next, {
      kind: "declare_attackers",
      playerId: p1.id,
      attacks: [{ attackerId: commander.id, defenderId: p2.id }],
    });
    next = passTo(next, "combatDamage");
    expect(next.players[1]?.life).toBe(35);
    expect(next.players[1]?.commander.damageReceived[commander.id]).toBe(5);
  });

  it("rejects illegal attackers and leaves GameState unchanged", () => {
    const { game, p1, p2 } = twoPlayers();
    const sick = creature(game, p1.id, "Fresh", 2, 2, { summoningSick: true });
    const tapped = creature(game, p1.id, "Sleepy", 2, 2);
    game.cards[tapped.id]!.tapped = true;
    const next = passTo(game, "declareAttackers");
    const original = structuredClone(next);
    expect(() =>
      applyAction(next, {
        kind: "declare_attackers",
        playerId: p1.id,
        attacks: [{ attackerId: sick.id, defenderId: p2.id }],
      }),
    ).toThrow(/summoning sickness/);
    expect(() =>
      applyAction(next, {
        kind: "declare_attackers",
        playerId: p1.id,
        attacks: [{ attackerId: tapped.id, defenderId: p2.id }],
      }),
    ).toThrow(/tapped/);
    expect(() =>
      applyAction(next, {
        kind: "declare_attackers",
        playerId: p1.id,
        attacks: [{ attackerId: sick.id, defenderId: p1.id }],
      }),
    ).toThrow(/themselves|summoning/);
    expect(next).toEqual(original);
  });

  it("rejects illegal blockers", () => {
    const { game, p1, p2 } = twoPlayers();
    const attacker = creature(game, p1.id, "Bear", 2, 2);
    const tapped = creature(game, p2.id, "Wall", 1, 3);
    game.cards[tapped.id]!.tapped = true;
    let next = passTo(game, "declareAttackers");
    next = applyAction(next, {
      kind: "declare_attackers",
      playerId: p1.id,
      attacks: [{ attackerId: attacker.id, defenderId: p2.id }],
    });
    next = passN(next, 2);
    const original = structuredClone(next);
    expect(() =>
      applyAction(next, {
        kind: "declare_blockers",
        playerId: p2.id,
        blocks: [{ blockerId: tapped.id, attackerId: attacker.id }],
      }),
    ).toThrow(/tapped/);
    expect(() =>
      applyAction(next, {
        kind: "declare_blockers",
        playerId: p2.id,
        blocks: [{ blockerId: attacker.id, attackerId: attacker.id }],
      }),
    ).toThrow(/those blockers/);
    expect(next).toEqual(original);
  });

  it("clears combat flags after combat and returns to postcombat main with active-player priority", () => {
    const { game, p1, p2 } = twoPlayers();
    const attacker = creature(game, p1.id, "Bear", 2, 2);
    let next = passTo(game, "declareAttackers");
    next = applyAction(next, {
      kind: "declare_attackers",
      playerId: p1.id,
      attacks: [{ attackerId: attacker.id, defenderId: p2.id }],
    });
    next = passTo(next, "postcombatMain");
    expect(next.turn.phase).toBe("postcombatMain");
    expect(next.priorityPlayerId).toBe(p1.id);
    expect(next.combat).toBeNull();
    expect(next.cards[attacker.id]?.attacking).toBe(false);
    expect(next.cards[attacker.id]?.blockingAttackerId).toBeNull();
    expect(next.cards[attacker.id]?.tapped).toBe(true);
  });

  it("serializes combat in progress", () => {
    const { game, p1, p2 } = twoPlayers();
    const attacker = creature(game, p1.id, "Bear", 2, 2);
    let next = passTo(game, "declareAttackers");
    next = applyAction(next, {
      kind: "declare_attackers",
      playerId: p1.id,
      attacks: [{ attackerId: attacker.id, defenderId: p2.id }],
    });
    const restored = parseGameState(serializeGameState(next));
    expect(restored).toEqual(next);
    expect(restored.combat?.attacks[0]?.attackerId).toBe(attacker.id);
  });
});
