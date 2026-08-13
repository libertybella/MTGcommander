import { describe, expect, it } from "vitest";
import {
  createCardDefinition,
  createCardInstance,
  createGameState,
  parseGameAction,
  parseGameEvent,
  parseGameState,
  serializeGameAction,
  serializeGameEvent,
  serializeGameState,
} from "./index";
import type { GameAction, GameEvent, GameState } from "./types";

function unique<T>(values: T[]): boolean {
  return new Set(values).size === values.length;
}

function populateForRoundTrip(game: GameState): GameState {
  const [p1, p2] = game.players;
  if (!p1 || !p2) {
    throw new Error("expected at least two players");
  }

  const solRing = createCardDefinition({
    name: "Sol Ring",
    typeLine: "Artifact",
    manaCost: "{1}",
  });
  const urDragon = createCardDefinition({
    name: "The Ur-Dragon",
    typeLine: "Legendary Creature — Dragon Avatar",
    manaCost: "{4}{W}{U}{B}{R}{G}",
  });
  game.definitions[solRing.id] = solRing;
  game.definitions[urDragon.id] = urDragon;

  const commander = createCardInstance({
    definitionId: urDragon.id,
    ownerId: p1.id,
    zone: "command",
  });
  const inHand = createCardInstance({
    definitionId: solRing.id,
    ownerId: p1.id,
    zone: "hand",
  });
  const onBattlefield = createCardInstance({
    definitionId: solRing.id,
    ownerId: p2.id,
    zone: "battlefield",
  });
  const inLibrary = createCardInstance({
    definitionId: solRing.id,
    ownerId: p2.id,
    zone: "library",
  });
  const inGraveyard = createCardInstance({
    definitionId: solRing.id,
    ownerId: p2.id,
    zone: "graveyard",
  });
  const inExile = createCardInstance({
    definitionId: solRing.id,
    ownerId: p1.id,
    zone: "exile",
  });

  for (const card of [
    commander,
    inHand,
    onBattlefield,
    inLibrary,
    inGraveyard,
    inExile,
  ]) {
    game.cards[card.id] = card;
  }

  p1.zones.command.push(commander.id);
  p1.zones.hand.push(inHand.id);
  p1.zones.exile.push(inExile.id);
  p1.commander.commanderIds.push(commander.id);
  p1.commander.tax = 2;
  p1.commander.damageReceived[commander.id] = 6;
  p1.mana = { W: 1, U: 2, B: 0, R: 1, G: 0, C: 3 };
  p1.life = 39;

  p2.zones.battlefield.push(onBattlefield.id);
  p2.zones.library.push(inLibrary.id);
  p2.zones.graveyard.push(inGraveyard.id);

  game.turn = {
    number: 3,
    activePlayerId: p2.id,
    phase: "combat",
    step: "declareAttackers",
  };
  game.stack.push({
    id: "stack-1",
    controllerId: p1.id,
    sourceId: inHand.id,
    kind: "spell",
    targets: [],
  });

  return game;
}

describe("GameState data model", () => {
  it("creates a valid 2-player GameState", () => {
    const game = createGameState({ playerCount: 2 });
    expect(game.players).toHaveLength(2);
    expect(game.players.every((p) => p.life === 40)).toBe(true);
  });

  it("creates a valid 4-player GameState", () => {
    const game = createGameState({
      playerCount: 4,
      playerNames: ["Ross", "A", "B", "C"],
    });
    expect(game.players).toHaveLength(4);
    expect(game.players[0]?.displayName).toBe("Ross");
  });

  it("gives players unique IDs", () => {
    const game = createGameState({ playerCount: 4 });
    expect(unique(game.players.map((p) => p.id))).toBe(true);
  });

  it("gives card instances unique IDs", () => {
    const game = populateForRoundTrip(createGameState({ playerCount: 2 }));
    const ids = Object.keys(game.cards);
    expect(ids.length).toBeGreaterThan(1);
    expect(unique(ids)).toBe(true);
  });

  it("represents the major zones", () => {
    const game = populateForRoundTrip(createGameState({ playerCount: 2 }));
    const p1 = game.players[0];
    const p2 = game.players[1];
    expect(p1?.zones.command).toHaveLength(1);
    expect(p1?.zones.hand).toHaveLength(1);
    expect(p1?.zones.exile).toHaveLength(1);
    expect(p2?.zones.battlefield).toHaveLength(1);
    expect(p2?.zones.library).toHaveLength(1);
    expect(p2?.zones.graveyard).toHaveLength(1);
    expect(game.stack).toHaveLength(1);
  });

  it("represents turn, phase, and step data", () => {
    const game = createGameState({ playerCount: 2 });
    expect(game.turn.number).toBe(1);
    expect(game.turn.phase).toBe("beginning");
    expect(game.turn.step).toBe("untap");
    expect(game.players.some((p) => p.id === game.turn.activePlayerId)).toBe(
      true,
    );
  });

  it("represents W/U/B/R/G and colorless mana", () => {
    const game = populateForRoundTrip(createGameState({ playerCount: 2 }));
    const mana = game.players[0]?.mana;
    expect(mana).toEqual({ W: 1, U: 2, B: 0, R: 1, G: 0, C: 3 });
  });

  it("represents commander state as data", () => {
    const game = populateForRoundTrip(createGameState({ playerCount: 2 }));
    const commander = game.players[0]?.commander;
    expect(commander?.tax).toBe(2);
    expect(commander?.commanderIds).toHaveLength(1);
    const commanderId = commander?.commanderIds[0];
    expect(commanderId).toBeTruthy();
    expect(commander?.damageReceived[commanderId ?? ""]).toBe(6);
  });

  it("represents a GameAction", () => {
    const game = createGameState({ playerCount: 2 });
    const action: GameAction = {
      kind: "pass_priority",
      playerId: game.players[0]?.id ?? "",
    };
    expect(action.kind).toBe("pass_priority");
    expect(parseGameAction(serializeGameAction(action))).toEqual(action);
  });

  it("represents a GameEvent", () => {
    const game = createGameState({ playerCount: 2 });
    const event: GameEvent = { kind: "game_created", gameId: game.id };
    expect(event.kind).toBe("game_created");
    expect(parseGameEvent(serializeGameEvent(event))).toEqual(event);
  });

  it("serializes GameState to JSON and round-trips equivalently", () => {
    const original = populateForRoundTrip(createGameState({ playerCount: 4 }));
    const json = serializeGameState(original);
    expect(() => JSON.parse(json)).not.toThrow();
    const restored = parseGameState(json);
    expect(restored).toEqual(original);
  });
});
