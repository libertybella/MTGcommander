import { describe, expect, it } from "vitest";
import {
  addMana,
  applyAction,
  countCardPlacements,
  createCardDefinition,
  createCardInstance,
  createGameState,
  parseGameState,
  serializeGameState,
} from "./index";
import {
  testBear,
  testBlankInstant,
  testDrain,
  testGift,
  testRecruit,
  testRitual,
  testShock,
  testStudy,
} from "./catalog";
import { advanceSteps } from "./turn";
import type { CardDefinition, GameState } from "./types";

function twoPlayers() {
  const game = createGameState({ playerCount: 2 });
  const p1 = game.players[0];
  const p2 = game.players[1];
  if (!p1 || !p2) {
    throw new Error("need players");
  }
  return { game, p1, p2 };
}

function toPrecombatMain(game: GameState): GameState {
  return advanceSteps(game, 3);
}

function addToHand(game: GameState, ownerId: string, definition: CardDefinition) {
  const owner = game.players.find((player) => player.id === ownerId);
  if (!owner) {
    throw new Error("missing owner");
  }
  game.definitions[definition.id] = definition;
  const card = createCardInstance({
    definitionId: definition.id,
    ownerId,
    zone: "hand",
  });
  game.cards[card.id] = card;
  owner.zones.hand.push(card.id);
  return card;
}

function castAndResolve(game: GameState, playerId: string, opponentId: string, cardId: string) {
  let next = applyAction(game, { kind: "cast_spell", playerId, cardId });
  next = applyAction(next, { kind: "pass_priority", playerId });
  next = applyAction(next, { kind: "pass_priority", playerId: opponentId });
  return next;
}

describe("card definitions", () => {
  it("creates a CardDefinition with serializable effects", () => {
    const shock = testShock();
    expect(shock.effects[0]?.kind).toBe("deal_damage");
    expect(typeof shock.effects[0]).toBe("object");
    expect(typeof shock.effects[0]).not.toBe("function");
  });

  it("lets multiple CardInstances share one definition while remaining distinct", () => {
    const { game, p1 } = twoPlayers();
    const bear = testBear();
    const a = addToHand(game, p1.id, bear);
    const b = addToHand(game, p1.id, bear);
    expect(a.definitionId).toBe(bear.id);
    expect(b.definitionId).toBe(bear.id);
    expect(a.id).not.toBe(b.id);
    expect(game.cards[a.id]?.id).toBe(a.id);
    expect(game.cards[b.id]?.id).toBe(b.id);
  });
});

describe("spell resolution with definition effects", () => {
  it("resolves a spell with no effects to the graveyard", () => {
    const { game, p1, p2 } = twoPlayers();
    const card = addToHand(game, p1.id, testBlankInstant());
    const next = castAndResolve(game, p1.id, p2.id, card.id);
    expect(next.stack).toHaveLength(0);
    expect(next.cards[card.id]?.zone).toBe("graveyard");
    expect(next.players[0]?.zones.graveyard).toContain(card.id);
    expect(countCardPlacements(next, card.id)).toBe(1);
  });

  it("resolves a creature to the battlefield without extra effects", () => {
    const { game, p1, p2 } = twoPlayers();
    const card = addToHand(game, p1.id, testBear());
    let next = toPrecombatMain(game);
    next = addMana(next, p1.id, { G: 1, C: 1 });
    next = castAndResolve(next, p1.id, p2.id, card.id);
    expect(next.cards[card.id]?.zone).toBe("battlefield");
    expect(next.players[0]?.zones.battlefield).toContain(card.id);
    expect(next.cards[card.id]?.id).toBe(card.id);
  });

  it("executes a damage spell against the next opponent and pays mana", () => {
    const { game, p1, p2 } = twoPlayers();
    const card = addToHand(game, p1.id, testShock());
    const ready = addMana(game, p1.id, { R: 1 });
    const originalLife = ready.players[1]?.life;
    let next = applyAction(ready, { kind: "cast_spell", playerId: p1.id, cardId: card.id });
    expect(next.stack).toHaveLength(1);
    expect(next.cards[card.id]?.zone).toBe("stack");
    expect(next.players[0]?.zones.hand).not.toContain(card.id);
    expect(next.players[0]?.mana.R).toBe(0);
    next = applyAction(next, { kind: "pass_priority", playerId: p1.id });
    next = applyAction(next, { kind: "pass_priority", playerId: p2.id });
    expect(next.stack).toHaveLength(0);
    expect(next.players[1]?.life).toBe((originalLife ?? 40) - 2);
    expect(next.players[0]?.life).toBe(40);
    expect(next.cards[card.id]?.zone).toBe("graveyard");
  });

  it("executes gain life, lose life, draw, add mana, and token effects", () => {
    const { game, p1, p2 } = twoPlayers();
    const gift = addToHand(game, p1.id, testGift());
    const drain = addToHand(game, p1.id, testDrain());
    const study = addToHand(game, p1.id, testStudy());
    const ritual = addToHand(game, p1.id, testRitual());
    const recruit = addToHand(game, p1.id, testRecruit());

    let next = toPrecombatMain(game);
    const bearDef = testBear();
    const libraryCard = createCardInstance({
      definitionId: bearDef.id,
      ownerId: p1.id,
      zone: "library",
    });
    next.definitions[bearDef.id] = bearDef;
    next.cards[libraryCard.id] = libraryCard;
    next.players[0]!.zones.library.push(libraryCard.id);

    next = addMana(next, p1.id, { W: 2, U: 1, B: 1 });

    next = castAndResolve(next, p1.id, p2.id, gift.id);
    expect(next.players[0]?.life).toBe(43);

    next = addMana(next, p1.id, { B: 1 });
    next = castAndResolve(next, p1.id, p2.id, drain.id);
    expect(next.players[0]?.life).toBe(41);

    next = addMana(next, p1.id, { U: 1 });
    next = castAndResolve(next, p1.id, p2.id, study.id);
    expect(next.players[0]?.zones.hand).toContain(libraryCard.id);
    expect(next.cards[libraryCard.id]?.zone).toBe("hand");

    next = addMana(next, p1.id, { R: 1 });
    next = castAndResolve(next, p1.id, p2.id, ritual.id);
    expect(next.players[0]?.mana.R).toBe(2);

    next = addMana(next, p1.id, { W: 1 });
    next = castAndResolve(next, p1.id, p2.id, recruit.id);
    expect(next.players[0]?.zones.battlefield).toHaveLength(1);
    const tokenId = next.players[0]?.zones.battlefield[0] ?? "";
    expect(next.definitions[next.cards[tokenId]?.definitionId ?? ""]?.name).toBe("Test Soldier");
    expect(countCardPlacements(next, tokenId)).toBe(1);
  });

  it("executes explicit tap, untap, and move effects without a targeting system", () => {
    const { game, p1, p2 } = twoPlayers();
    const permanent = testBear();
    const creature = createCardInstance({
      definitionId: permanent.id,
      ownerId: p1.id,
      zone: "battlefield",
      summoningSick: false,
    });
    game.definitions[permanent.id] = permanent;
    game.cards[creature.id] = creature;
    game.players[0]!.zones.battlefield.push(creature.id);

    const tapper = createCardDefinition({
      name: "Test Tapper",
      typeLine: "Instant",
      manaCost: "{U}",
      effects: [{ kind: "tap", cardId: creature.id }],
    });
    const untapper = createCardDefinition({
      name: "Test Untapper",
      typeLine: "Instant",
      manaCost: "{W}",
      effects: [{ kind: "untap", cardId: creature.id }],
    });
    const exile = createCardDefinition({
      name: "Test Exile",
      typeLine: "Instant",
      manaCost: "{B}",
      effects: [{ kind: "move_card", cardId: creature.id, toZone: "exile" }],
    });
    const tapCard = addToHand(game, p1.id, tapper);
    const untapCard = addToHand(game, p1.id, untapper);
    const exileCard = addToHand(game, p1.id, exile);

    let next = addMana(game, p1.id, { U: 1, W: 1, B: 1 });
    next = castAndResolve(next, p1.id, p2.id, tapCard.id);
    expect(next.cards[creature.id]?.tapped).toBe(true);
    expect(game.cards[creature.id]?.tapped).toBe(false);

    next = addMana(next, p1.id, { W: 1 });
    next = castAndResolve(next, p1.id, p2.id, untapCard.id);
    expect(next.cards[creature.id]?.tapped).toBe(false);

    next = addMana(next, p1.id, { B: 1 });
    next = castAndResolve(next, p1.id, p2.id, exileCard.id);
    expect(next.cards[creature.id]?.zone).toBe("exile");
    expect(next.players[0]?.zones.exile).toContain(creature.id);
    expect(next.players[0]?.zones.battlefield).not.toContain(creature.id);
    expect(countCardPlacements(next, creature.id)).toBe(1);
    expect(creature.id).toBe(next.cards[creature.id]?.id);
  });

  it("round-trips definitions, instances, stack spells, effects, mana, life, and zones", () => {
    const { game, p1 } = twoPlayers();
    const shock = addToHand(game, p1.id, testShock());
    const bear = addToHand(game, p1.id, testBear());
    let next = addMana(game, p1.id, { R: 2, G: 1, C: 1 });
    next = applyAction(next, { kind: "cast_spell", playerId: p1.id, cardId: shock.id });
    const restored = parseGameState(serializeGameState(next));
    expect(restored).toEqual(next);
    expect(restored.definitions[testShock().id]).toBeUndefined();
    const shockDef = restored.definitions[restored.cards[shock.id]?.definitionId ?? ""];
    expect(shockDef?.effects[0]?.kind).toBe("deal_damage");
    expect(restored.cards[shock.id]?.zone).toBe("stack");
    expect(restored.cards[bear.id]?.zone).toBe("hand");
    expect(restored.players[0]?.mana.R).toBe(1);
    expect(JSON.parse(serializeGameState(next)).definitions[shockDef?.id ?? ""].effects).toEqual(
      shockDef?.effects,
    );
  });
});
