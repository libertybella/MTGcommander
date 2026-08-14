import { describe, expect, it } from "vitest";
import {
  applyAction,
  hasKeyword,
  isCreature,
  isGameOver,
  isLand,
  livingPlayers,
  parseGameAction,
  parseGameState,
  POOL_ID,
  serializeGameAction,
  serializeGameState,
  startCatalogGame,
  syntheticPool,
  winnerId,
  type CatalogDeckSpec,
} from "./index";
import type { ChosenTarget, GameState } from "./types";

function shockDeck(): CatalogDeckSpec {
  const library: string[] = [];
  for (let i = 0; i < 12; i += 1) {
    library.push(i % 2 === 0 ? POOL_ID.mountain : POOL_ID.shock);
  }
  return {
    commanderDefinitionId: POOL_ID.dragon,
    libraryDefinitionIds: library,
  };
}

function forestDeck(): CatalogDeckSpec {
  return {
    commanderDefinitionId: POOL_ID.dragon,
    libraryDefinitionIds: Array.from({ length: 12 }, () => POOL_ID.forest),
  };
}

function opponentOf(state: GameState, playerId: string) {
  return livingPlayers(state).find((player) => player.id !== playerId);
}

function chooseTargets(state: GameState, playerId: string, cardId: string): ChosenTarget[] | null {
  const requirements = state.definitions[state.cards[cardId]?.definitionId ?? ""]?.targetRequirements ?? [];
  if (requirements.length === 0) {
    return [];
  }
  const opponent = opponentOf(state, playerId);
  if (!opponent) {
    return null;
  }
  const targets: ChosenTarget[] = [];
  for (const requirement of requirements) {
    if (requirement.kind === "player") {
      targets.push({ type: "player", playerId: opponent.id });
      continue;
    }
    if (requirement.kind === "creature") {
      const creatureId = opponent.zones.battlefield.find((id) => isCreature(state, id));
      if (!creatureId) {
        return null;
      }
      targets.push({ type: "creature", cardId: creatureId });
      continue;
    }
    if (requirement.kind === "spell") {
      const spell = state.stack.find((entry) => entry.kind === "spell");
      if (!spell) {
        return null;
      }
      targets.push({ type: "spell", stackObjectId: spell.id });
      continue;
    }
    targets.push({ type: "player", playerId: opponent.id });
  }
  return targets;
}

function tryPlayLand(state: GameState): GameState | null {
  const playerId = state.priorityPlayerId;
  const player = state.players.find((entry) => entry.id === playerId);
  if (!player) {
    return null;
  }
  for (const cardId of player.zones.hand) {
    try {
      return applyAction(state, { kind: "play_land", playerId, cardId });
    } catch {
      continue;
    }
  }
  return null;
}

function tapAvailableMana(state: GameState): GameState {
  let next = state;
  let progressed = true;
  while (progressed) {
    progressed = false;
    const player = next.players.find((entry) => entry.id === next.priorityPlayerId);
    if (!player) {
      return next;
    }
    for (const cardId of player.zones.battlefield) {
      try {
        next = applyAction(next, { kind: "tap_for_mana", playerId: player.id, cardId });
        progressed = true;
        break;
      } catch {
        continue;
      }
    }
  }
  return next;
}

function tryCast(state: GameState): GameState | null {
  const playerId = state.priorityPlayerId;
  const player = state.players.find((entry) => entry.id === playerId);
  if (!player) {
    return null;
  }
  for (const cardId of [...player.zones.hand, ...player.zones.command]) {
    if (isLand(state, cardId)) {
      continue;
    }
    const targets = chooseTargets(state, playerId, cardId);
    if (!targets) {
      continue;
    }
    try {
      return applyAction(state, {
        kind: "cast_spell",
        playerId,
        cardId,
        ...(targets.length > 0 ? { targets } : {}),
      });
    } catch {
      continue;
    }
  }
  return null;
}

function tryAttack(state: GameState): GameState | null {
  if (state.turn.step !== "declareAttackers") {
    return null;
  }
  const playerId = state.priorityPlayerId;
  if (playerId !== state.turn.activePlayerId) {
    return null;
  }
  const player = state.players.find((entry) => entry.id === playerId);
  const opponent = opponentOf(state, playerId);
  if (!player || !opponent) {
    return null;
  }
  const attacks = player.zones.battlefield.flatMap((cardId) => {
    const card = state.cards[cardId];
    if (!card || !isCreature(state, cardId) || card.tapped || card.controllerId !== playerId) {
      return [];
    }
    if (card.summoningSick && !hasKeyword(state, cardId, "haste")) {
      return [];
    }
    if (hasKeyword(state, cardId, "defender")) {
      return [];
    }
    return [{ attackerId: cardId, defenderId: opponent.id }];
  });
  if (attacks.length === 0) {
    return null;
  }
  try {
    return applyAction(state, { kind: "declare_attackers", playerId, attacks });
  } catch {
    return null;
  }
}

function autoplayUntilWinner(state: GameState, limit = 2500): GameState {
  let next = state;
  for (let i = 0; i < limit; i += 1) {
    if (isGameOver(next) || winnerId(next)) {
      return next;
    }
    const playedLand = tryPlayLand(next);
    if (playedLand) {
      next = playedLand;
      continue;
    }
    const withMana = tapAvailableMana(next);
    if (withMana !== next) {
      next = withMana;
      continue;
    }
    const attacked = tryAttack(next);
    if (attacked) {
      next = attacked;
      continue;
    }
    const cast = tryCast(next);
    if (cast) {
      next = cast;
      continue;
    }
    next = applyAction(next, { kind: "pass_priority", playerId: next.priorityPlayerId });
  }
  throw new Error("autoplay did not finish");
}

describe("20-card engine", () => {
  it("has twenty-one uniquely named synthetic definitions", () => {
    const pool = syntheticPool();
    expect(pool).toHaveLength(21);
    expect(new Set(pool.map((definition) => definition.id)).size).toBe(21);
    expect(new Set(pool.map((definition) => definition.name)).size).toBe(21);
  });

  it("seats commanders, libraries, and opening hands from the pool", () => {
    const game = startCatalogGame({
      playerCount: 2,
      decks: [shockDeck(), forestDeck()],
      openingHandSize: 7,
    });
    expect(game.players[0]?.zones.command).toHaveLength(1);
    expect(game.players[1]?.zones.command).toHaveLength(1);
    expect(game.players[0]?.zones.hand).toHaveLength(7);
    expect(game.players[0]?.zones.library).toHaveLength(5);
    expect(game.definitions[POOL_ID.dragon]?.keywords).toContain("flying");
    const commanderId = game.players[0]?.zones.command[0];
    expect(game.players[0]?.commander.commanderIds).toEqual([commanderId]);
  });

  it("plays a pool land, taps it for mana, and resolves a shock", () => {
    const game = startCatalogGame({
      playerCount: 2,
      decks: [shockDeck(), forestDeck()],
      openingHandSize: 2,
    });
    const p1 = game.players[0];
    const p2 = game.players[1];
    if (!p1 || !p2) {
      throw new Error("need players");
    }
    const mountainId = p1.zones.hand.find(
      (cardId) => game.cards[cardId]?.definitionId === POOL_ID.mountain,
    );
    const shockId = p1.zones.hand.find((cardId) => game.cards[cardId]?.definitionId === POOL_ID.shock);
    if (!mountainId || !shockId) {
      throw new Error("expected mountain and shock in hand");
    }

    let next = game;
    while (next.turn.step !== "precombatMain") {
      next = applyAction(next, { kind: "pass_priority", playerId: next.priorityPlayerId });
    }
    next = applyAction(next, { kind: "play_land", playerId: p1.id, cardId: mountainId });
    next = applyAction(next, { kind: "tap_for_mana", playerId: p1.id, cardId: mountainId });
    expect(next.players[0]?.mana.R).toBe(1);
    expect(next.cards[mountainId]?.tapped).toBe(true);

    next = applyAction(next, {
      kind: "cast_spell",
      playerId: p1.id,
      cardId: shockId,
      targets: [{ type: "player", playerId: p2.id }],
    });
    next = applyAction(next, { kind: "pass_priority", playerId: p1.id });
    next = applyAction(next, { kind: "pass_priority", playerId: p2.id });
    expect(next.players[1]?.life).toBe(38);
    expect(next.cards[shockId]?.zone).toBe("graveyard");
  });

  it("rejects tapping a non-producer and leaves GameState unchanged", () => {
    const game = startCatalogGame({
      playerCount: 2,
      decks: [shockDeck(), forestDeck()],
      openingHandSize: 2,
    });
    const p1 = game.players[0];
    if (!p1) {
      throw new Error("need player");
    }
    let next = game;
    while (next.turn.step !== "precombatMain") {
      next = applyAction(next, { kind: "pass_priority", playerId: next.priorityPlayerId });
    }
    const commanderId = next.players[0]?.zones.command[0];
    if (!commanderId) {
      throw new Error("need commander");
    }
    const original = structuredClone(next);
    expect(() =>
      applyAction(next, { kind: "tap_for_mana", playerId: p1.id, cardId: commanderId }),
    ).toThrow(/battlefield|does not produce mana/);
    expect(next).toEqual(original);
  });

  it("plays a complete game from the pool until a winner", () => {
    const start = startCatalogGame({
      playerCount: 2,
      decks: [shockDeck(), forestDeck()],
      openingHandSize: 4,
      startingLife: 2,
    });
    const finished = autoplayUntilWinner(start);
    expect(isGameOver(finished)).toBe(true);
    expect(finished.winnerId).toBeTruthy();
    expect(livingPlayers(finished)).toHaveLength(1);
    const restored = parseGameState(serializeGameState(finished));
    expect(restored.winnerId).toBe(finished.winnerId);
  });

  it("round-trips a tap_for_mana action", () => {
    const action = { kind: "tap_for_mana" as const, playerId: "player-1", cardId: "card-1" };
    expect(parseGameAction(serializeGameAction(action))).toEqual(action);
  });
});
