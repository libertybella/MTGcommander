import { describe, expect, it } from "vitest";
import {
  addMana,
  applyAction,
  applyEffect,
  COMMANDER_DAMAGE_TO_LOSE,
  createCardDefinition,
  createCardInstance,
  createGameState,
  parseGameState,
  serializeGameState,
} from "./index";
import { advanceSteps } from "./turn";
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

function placeCommander(game: GameState, ownerId: string, name: string, power: number) {
  const owner = game.players.find((player) => player.id === ownerId);
  if (!owner) {
    throw new Error("missing owner");
  }
  const definition = createCardDefinition({
    name,
    typeLine: "Legendary Creature — Dragon",
    manaCost: "{2}{R}",
    power,
    toughness: power,
  });
  const card = createCardInstance({
    definitionId: definition.id,
    ownerId,
    zone: "command",
    summoningSick: false,
  });
  game.definitions[definition.id] = definition;
  game.cards[card.id] = card;
  owner.zones.command.push(card.id);
  owner.commander.commanderIds.push(card.id);
  return card;
}

function toPrecombatMain(game: GameState): GameState {
  return advanceSteps(game, 3);
}

function passTo(
  game: GameState,
  step: GameState["turn"]["step"],
  activePlayerId?: string,
): GameState {
  let next = game;
  let guard = 0;
  while (
    next.turn.step !== step ||
    (activePlayerId !== undefined && next.turn.activePlayerId !== activePlayerId)
  ) {
    next = applyAction(next, { kind: "pass_priority", playerId: next.priorityPlayerId });
    guard += 1;
    if (guard > 200) {
      throw new Error(`Could not reach ${step} (at ${next.turn.step})`);
    }
  }
  return next;
}

describe("commander rules", () => {
  it("starts the commander in the command zone", () => {
    const { game, p1 } = twoPlayers();
    const commander = placeCommander(game, p1.id, "Dragonlord", 5);
    expect(game.players[0]?.zones.command).toEqual([commander.id]);
    expect(game.cards[commander.id]?.zone).toBe("command");
    expect(game.players[0]?.commander.commanderIds).toEqual([commander.id]);
    expect(game.players[0]?.commander.tax).toBe(0);
    expect(game.players[0]?.life).toBe(40);
  });

  it("casts a commander from the command zone and increases tax", () => {
    const { game, p1, p2 } = twoPlayers();
    const commander = placeCommander(game, p1.id, "Dragonlord", 5);
    let next = toPrecombatMain(game);
    next = addMana(next, p1.id, { R: 1, C: 2 });
    next = applyAction(next, {
      kind: "cast_spell",
      playerId: p1.id,
      cardId: commander.id,
    });
    expect(next.cards[commander.id]?.zone).toBe("stack");
    expect(next.players[0]?.zones.command).toHaveLength(0);
    expect(next.players[0]?.mana).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 });
    expect(next.players[0]?.commander.tax).toBe(2);

    next = applyAction(next, { kind: "pass_priority", playerId: p1.id });
    next = applyAction(next, { kind: "pass_priority", playerId: p2.id });
    expect(next.cards[commander.id]?.zone).toBe("battlefield");
    expect(next.cards[commander.id]?.id).toBe(commander.id);
  });

  it("requires additional generic mana equal to commander tax on later casts", () => {
    const { game, p1, p2 } = twoPlayers();
    const commander = placeCommander(game, p1.id, "Dragonlord", 5);
    game.players[0]!.commander.tax = 2;
    let next = toPrecombatMain(game);
    const tooLittle = addMana(next, p1.id, { R: 1, C: 2 });
    const original = structuredClone(tooLittle);
    expect(() =>
      applyAction(tooLittle, { kind: "cast_spell", playerId: p1.id, cardId: commander.id }),
    ).toThrow(/Cannot pay/);
    expect(tooLittle).toEqual(original);

    next = addMana(next, p1.id, { R: 1, C: 4 });
    next = applyAction(next, { kind: "cast_spell", playerId: p1.id, cardId: commander.id });
    expect(next.players[0]?.commander.tax).toBe(4);
    expect(next.players[0]?.mana).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 });
    expect(p2.id).toBeTruthy();
  });

  it("returns a commander to the command zone instead of the graveyard or exile", () => {
    const { game, p1 } = twoPlayers();
    const commander = placeCommander(game, p1.id, "Dragonlord", 5);
    game.players[0]!.zones.command = [];
    game.cards[commander.id]!.zone = "battlefield";
    game.players[0]!.zones.battlefield.push(commander.id);

    const toGraveyard = applyEffect(game, {
      kind: "move_card",
      cardId: commander.id,
      toZone: "graveyard",
    });
    expect(toGraveyard.cards[commander.id]?.zone).toBe("command");
    expect(toGraveyard.players[0]?.zones.command).toContain(commander.id);
    expect(toGraveyard.players[0]?.zones.graveyard).not.toContain(commander.id);

    game.players[0]!.zones.command = [];
    game.players[0]!.zones.battlefield = [commander.id];
    game.cards[commander.id]!.zone = "battlefield";
    const toExile = applyEffect(game, {
      kind: "move_card",
      cardId: commander.id,
      toZone: "exile",
    });
    expect(toExile.cards[commander.id]?.zone).toBe("command");
  });

  it("accumulates commander damage by instance ID and loses at 21", () => {
    const { game, p1, p2 } = twoPlayers();
    const first = placeCommander(game, p1.id, "Dragon A", 11);
    const second = placeCommander(game, p1.id, "Dragon B", 10);
    game.players[0]!.zones.command = [];
    for (const card of [first, second]) {
      game.cards[card.id]!.zone = "battlefield";
      game.cards[card.id]!.summoningSick = false;
      game.players[0]!.zones.battlefield.push(card.id);
    }

    let next = passTo(game, "declareAttackers", p1.id);
    next = applyAction(next, {
      kind: "declare_attackers",
      playerId: p1.id,
      attacks: [
        { attackerId: first.id, defenderId: p2.id },
        { attackerId: second.id, defenderId: p2.id },
      ],
    });
    next = passTo(next, "combatDamage");
    expect(next.players[1]?.commander.damageReceived[first.id]).toBe(11);
    expect(next.players[1]?.commander.damageReceived[second.id]).toBe(10);
    expect(next.players[1]?.lost).toBe(false);

    next = passTo(next, "declareAttackers", p1.id);
    next = applyAction(next, {
      kind: "declare_attackers",
      playerId: p1.id,
      attacks: [{ attackerId: first.id, defenderId: p2.id }],
    });
    next = passTo(next, "combatDamage");
    expect(next.players[1]?.commander.damageReceived[first.id]).toBe(22);
    expect(next.players[1]?.commander.damageReceived[second.id]).toBe(10);
    expect(next.players[1]?.lost).toBe(true);
    expect(COMMANDER_DAMAGE_TO_LOSE).toBe(21);
  });

  it("serializes commander tax, damage, and loss", () => {
    const { game, p1, p2 } = twoPlayers();
    const commander = placeCommander(game, p1.id, "Dragonlord", 5);
    game.players[1]!.commander.damageReceived[commander.id] = 21;
    game.players[1]!.lost = true;
    game.players[0]!.commander.tax = 4;
    const restored = parseGameState(serializeGameState(game));
    expect(restored).toEqual(game);
    expect(restored.players[0]?.commander.commanderIds).toEqual([commander.id]);
    expect(restored.players[1]?.lost).toBe(true);
    expect(p2.id).toBe(restored.players[1]?.id);
  });
});
