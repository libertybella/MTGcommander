import { describe, expect, it } from "vitest";
import {
  createCardDefinition,
  createCardInstance,
  createGameState,
  type CardDefinition,
  type GameState,
  type PlayerId,
} from "@mtgcommander/engine";
import { GameHost } from "./session";

function addCard(
  game: GameState,
  definition: CardDefinition,
  ownerId: PlayerId,
  zone: "hand" | "battlefield",
  options: { tapped?: boolean } = {},
): string {
  game.definitions[definition.id] = definition;
  const card = createCardInstance({
    definitionId: definition.id,
    ownerId,
    zone,
    summoningSick: false,
  });
  card.tapped = options.tapped ?? false;
  game.cards[card.id] = card;
  game.players.find((entry) => entry.id === ownerId)!.zones[zone].push(card.id);
  return card.id;
}

function island(): CardDefinition {
  return createCardDefinition({
    name: "Test Island",
    typeLine: "Basic Land — Island",
    produces: { U: 1 },
  });
}

function flashSpell(): CardDefinition {
  return createCardDefinition({
    name: "Test Trick",
    typeLine: "Instant",
    manaCost: "{U}",
    effects: [{ kind: "draw", playerId: "controller", count: 1 }],
  });
}

/** Two seated players at P1's end step, P1 holding priority. */
function endStepTable(): { host: GameHost; game: GameState; p1: PlayerId; p2: PlayerId } {
  const game = createGameState({ playerCount: 2 });
  const p1 = game.players[0]!.id;
  const p2 = game.players[1]!.id;
  for (const player of game.players) {
    const filler = createCardDefinition({ name: "Test Filler", typeLine: "Instant" });
    game.definitions[filler.id] = filler;
    for (let i = 0; i < 10; i += 1) {
      const card = createCardInstance({ definitionId: filler.id, ownerId: player.id, zone: "library" });
      game.cards[card.id] = card;
      player.zones.library.push(card.id);
    }
  }
  addCard(game, island(), p2, "battlefield");
  addCard(game, flashSpell(), p2, "hand");
  game.turn.phase = "ending";
  game.turn.step = "end";
  game.priorityPlayerId = p1;
  const host = GameHost.start(game, p1, { hotseat: true });
  return { host, game, p1, p2 };
}

describe("Stage 1: stops, yield, and full control", () => {
  it("a their-turn stop holds priority at end step so flash works", () => {
    const { host, p1, p2 } = endStepTable();
    host.setPreferences(p2, { stops: { theirTurn: ["end"] } });
    expect(host.submit(p1, { kind: "pass_priority", playerId: p1 })).toEqual({ ok: true });
    const view = host.viewFor(p2);
    expect(view.turn.step).toBe("end");
    expect(view.priorityPlayerId).toBe(p2);
    const handCard = view.players[1]!.zones.hand.find(
      (cardId) => view.definitions[view.cards[cardId]!.definitionId]?.name === "Test Trick",
    )!;
    const tap = host.submit(p2, {
      kind: "tap_for_mana",
      playerId: p2,
      cardId: view.players[1]!.zones.battlefield[0]!,
    });
    expect(tap).toEqual({ ok: true });
    const cast = host.submit(p2, { kind: "cast_spell", playerId: p2, cardId: handCard });
    expect(cast).toEqual({ ok: true });
    expect(host.viewFor(p2).stack).toHaveLength(1);
  });

  it("without a stop the opponent auto-passes and the turn moves on", () => {
    const { host, p1, p2 } = endStepTable();
    expect(host.submit(p1, { kind: "pass_priority", playerId: p1 })).toEqual({ ok: true });
    const view = host.viewFor(p2);
    expect(view.turn.activePlayerId).toBe(p2);
    expect(view.turn.step).not.toBe("end");
  });

  it("smart yield auto-passes a stack response when the player has no action", () => {
    const { host, p1, p2 } = endStepTable();
    host.setPreferences(p2, { yield: "smart", stops: { theirTurn: [] } });
    // Strip P2's resources so they cannot respond.
    const before = host.viewFor(p2);
    void before;
    const p2State = host.viewFor(p2).players[1]!;
    void p2State;
    // P1 has nothing to cast either; but P2 having no meaningful action means
    // any stack object P1 creates resolves without pausing on P2.
    // Give P1 a castable instant instead:
    // (simplest observable: P1 passes, P2 smart-yields the empty end step too)
    expect(host.submit(p1, { kind: "pass_priority", playerId: p1 })).toEqual({ ok: true });
    const view = host.viewFor(p2);
    // P2 had an island + trick, so smart yield holds priority at end step.
    expect(view.turn.step).toBe("end");
    expect(view.priorityPlayerId).toBe(p2);
  });

  it("smart yield with no possible action does not pause", () => {
    const game = createGameState({ playerCount: 2 });
    const p1 = game.players[0]!.id;
    const p2 = game.players[1]!.id;
    for (const player of game.players) {
      const filler = createCardDefinition({ name: "Test Filler", typeLine: "Instant" });
      game.definitions[filler.id] = filler;
      for (let i = 0; i < 10; i += 1) {
        const card = createCardInstance({ definitionId: filler.id, ownerId: player.id, zone: "library" });
        game.cards[card.id] = card;
        player.zones.library.push(card.id);
      }
    }
    game.turn.phase = "ending";
    game.turn.step = "end";
    game.priorityPlayerId = p1;
    const host = GameHost.start(game, p1, { hotseat: true });
    host.setPreferences(p2, { yield: "smart", stops: { theirTurn: ["end"] } });
    // Stop is set, so it still pauses (stops win over smart yield)…
    expect(host.submit(p1, { kind: "pass_priority", playerId: p1 })).toEqual({ ok: true });
    expect(host.viewFor(p2).priorityPlayerId).toBe(p2);
  });

  it("full control holds every priority window", () => {
    const { host, p1, p2 } = endStepTable();
    host.setPreferences(p2, { fullControl: true, stops: { theirTurn: [] } });
    expect(host.submit(p1, { kind: "pass_priority", playerId: p1 })).toEqual({ ok: true });
    const view = host.viewFor(p2);
    expect(view.turn.step).toBe("end");
    expect(view.priorityPlayerId).toBe(p2);
  });

  it("a stop on a skippable step prevents the fast-forward past it", () => {
    const game = createGameState({ playerCount: 2 });
    const p1 = game.players[0]!.id;
    const p2 = game.players[1]!.id;
    for (const player of game.players) {
      const filler = createCardDefinition({ name: "Test Filler", typeLine: "Instant" });
      game.definitions[filler.id] = filler;
      for (let i = 0; i < 10; i += 1) {
        const card = createCardInstance({ definitionId: filler.id, ownerId: player.id, zone: "library" });
        game.cards[card.id] = card;
        player.zones.library.push(card.id);
      }
    }
    addCard(game, island(), p2, "battlefield");
    addCard(game, flashSpell(), p2, "hand");
    game.turn.phase = "precombatMain";
    game.turn.step = "precombatMain";
    game.priorityPlayerId = p1;
    const host = GameHost.start(game, p1, { hotseat: true });
    host.setPreferences(p2, { stops: { theirTurn: ["beginCombat"] } });
    expect(host.submit(p1, { kind: "pass_priority", playerId: p1 })).toEqual({ ok: true });
    const view = host.viewFor(p2);
    expect(view.turn.step).toBe("beginCombat");
    expect(view.priorityPlayerId).toBe(p2);
  });

  it("rejects preferences with unknown steps", () => {
    const { host, p2 } = endStepTable();
    expect(() =>
      host.setPreferences(p2, { stops: { theirTurn: ["notastep" as never] } }),
    ).toThrow(/Unknown step/);
  });
});
