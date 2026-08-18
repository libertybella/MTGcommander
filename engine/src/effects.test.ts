import { describe, expect, it } from "vitest";
import {
  applyAction,
  applyEffect,
  applyEffects,
  countCardPlacements,
  createCardDefinition,
  createCardInstance,
  createGameState,
  parseGameState,
  serializeGameState,
} from "./index";

function twoPlayers() {
  const game = createGameState({ playerCount: 2 });
  const p1 = game.players[0];
  const p2 = game.players[1];
  if (!p1 || !p2) {
    throw new Error("need players");
  }
  return { game, p1, p2 };
}

function battlefieldCreature(
  name: string,
  power: number,
  toughness: number,
  ownerId: string,
  game: ReturnType<typeof createGameState>,
) {
  const owner = game.players.find((player) => player.id === ownerId);
  if (!owner) {
    throw new Error("missing owner");
  }
  const definition = createCardDefinition({
    name,
    typeLine: "Creature",
    power,
    toughness,
  });
  const card = createCardInstance({
    definitionId: definition.id,
    ownerId,
    zone: "battlefield",
  });
  game.definitions[definition.id] = definition;
  game.cards[card.id] = card;
  owner.zones.battlefield.push(card.id);
  return card;
}

describe("basic card effects", () => {
  it("gains and loses life on the intended player only", () => {
    const { game, p1, p2 } = twoPlayers();
    const gained = applyEffect(game, { kind: "gain_life", playerId: p1.id, amount: 5 });
    expect(gained.players[0]?.life).toBe(45);
    expect(gained.players[1]?.life).toBe(40);
    expect(game.players[0]?.life).toBe(40);

    const lost = applyEffect(gained, { kind: "lose_life", playerId: p2.id, amount: 3 });
    expect(lost.players[1]?.life).toBe(37);
    expect(lost.players[0]?.life).toBe(45);
  });

  it("deals damage to a player as life loss", () => {
    const { game, p1 } = twoPlayers();
    const next = applyEffect(game, {
      kind: "deal_damage",
      sourceId: null,
      target: { type: "player", playerId: p1.id },
      amount: 4,
    });
    expect(next.players[0]?.life).toBe(36);
    expect(game.players[0]?.life).toBe(40);
  });

  it("marks damage on a creature and destroys it at lethal toughness", () => {
    const { game, p1 } = twoPlayers();
    const bear = battlefieldCreature("Grizzly Bears", 2, 2, p1.id, game);
    const wounded = applyEffect(game, {
      kind: "deal_damage",
      sourceId: null,
      target: { type: "creature", cardId: bear.id },
      amount: 1,
    });
    expect(wounded.cards[bear.id]?.damageMarked).toBe(1);
    expect(wounded.cards[bear.id]?.zone).toBe("battlefield");
    expect(wounded.cards[bear.id]?.id).toBe(bear.id);

    const dead = applyEffect(wounded, {
      kind: "deal_damage",
      sourceId: null,
      target: { type: "creature", cardId: bear.id },
      amount: 1,
    });
    expect(dead.cards[bear.id]?.zone).toBe("graveyard");
    expect(dead.players[0]?.zones.graveyard).toContain(bear.id);
    expect(dead.players[0]?.zones.battlefield).not.toContain(bear.id);
    expect(countCardPlacements(dead, bear.id)).toBe(1);
  });

  it("draws the top library cards into hand in order", () => {
    const { game, p1 } = twoPlayers();
    const first = createCardDefinition({ name: "Island", typeLine: "Basic Land — Island" });
    const second = createCardDefinition({ name: "Forest", typeLine: "Basic Land — Forest" });
    const top = createCardInstance({ definitionId: first.id, ownerId: p1.id, zone: "library" });
    const bottom = createCardInstance({ definitionId: second.id, ownerId: p1.id, zone: "library" });
    game.definitions[first.id] = first;
    game.definitions[second.id] = second;
    game.cards[top.id] = top;
    game.cards[bottom.id] = bottom;
    p1.zones.library.push(top.id, bottom.id);

    const drawn = applyEffect(game, { kind: "draw", playerId: p1.id, count: 1 });
    expect(drawn.players[0]?.zones.hand).toEqual([top.id]);
    expect(drawn.players[0]?.zones.library).toEqual([bottom.id]);
    expect(drawn.cards[top.id]?.zone).toBe("hand");
    expect(drawn.cards[top.id]?.id).toBe(top.id);
  });

  it("moves a card between zones", () => {
    const { game, p1 } = twoPlayers();
    const card = battlefieldCreature("Bear", 2, 2, p1.id, game);
    const next = applyEffect(game, {
      kind: "move_card",
      cardId: card.id,
      toZone: "exile",
    });
    expect(next.cards[card.id]?.zone).toBe("exile");
    expect(next.players[0]?.zones.exile).toContain(card.id);
    expect(next.players[0]?.zones.battlefield).not.toContain(card.id);
    expect(countCardPlacements(next, card.id)).toBe(1);
  });

  it("taps and untaps a battlefield permanent", () => {
    const { game, p1 } = twoPlayers();
    const card = battlefieldCreature("Bear", 2, 2, p1.id, game);
    const tapped = applyEffect(game, { kind: "tap", cardId: card.id });
    expect(tapped.cards[card.id]?.tapped).toBe(true);
    const untapped = applyEffect(tapped, { kind: "untap", cardId: card.id });
    expect(untapped.cards[card.id]?.tapped).toBe(false);
  });

  it("adds mana to a player's pool", () => {
    const { game, p1, p2 } = twoPlayers();
    const next = applyEffect(game, {
      kind: "add_mana",
      playerId: p1.id,
      mana: { G: 2, C: 1 },
    });
    expect(next.players[0]?.mana).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 2, C: 1 });
    expect(next.players[1]?.mana).toEqual(p2.mana);
  });

  it("creates a basic token on the owner's battlefield", () => {
    const { game, p1 } = twoPlayers();
    const next = applyEffect(game, {
      kind: "create_token",
      ownerId: p1.id,
      name: "Soldier",
      typeLine: "Creature — Soldier Token",
      power: 1,
      toughness: 1,
    });
    const tokenId = next.players[0]?.zones.battlefield[0];
    expect(tokenId).toBeTruthy();
    const token = next.cards[tokenId ?? ""];
    expect(token?.zone).toBe("battlefield");
    expect(token?.ownerId).toBe(p1.id);
    expect(next.definitions[token?.definitionId ?? ""]?.power).toBe(1);
    expect(countCardPlacements(next, tokenId ?? "")).toBe(1);
    expect(game.players[0]?.zones.battlefield).toHaveLength(0);
  });

  it("serializes state after applying effects", () => {
    const { game, p1 } = twoPlayers();
    const card = battlefieldCreature("Bear", 2, 2, p1.id, game);
    const next = applyEffects(game, [
      { kind: "gain_life", playerId: p1.id, amount: 1 },
      { kind: "tap", cardId: card.id },
      { kind: "add_mana", playerId: p1.id, mana: { W: 1 } },
    ]);
    const restored = parseGameState(serializeGameState(next));
    expect(restored).toEqual(next);
    expect(restored.cards[card.id]?.tapped).toBe(true);
    expect(restored.cards[card.id]?.damageMarked).toBe(0);
  });
});

describe("invalid effects", () => {
  it("rejects non-positive amounts and unknown players without mutating state", () => {
    const { game, p1 } = twoPlayers();
    const original = structuredClone(game);
    expect(() =>
      applyEffect(game, { kind: "gain_life", playerId: p1.id, amount: 0 }),
    ).toThrow(/Invalid/);
    expect(() =>
      applyEffect(game, { kind: "lose_life", playerId: "nope", amount: 1 }),
    ).toThrow(/Unknown player/);
    expect(game).toEqual(original);
  });

  it("marks a failed draw from an empty library and eliminates that player", () => {
    const { game, p1, p2 } = twoPlayers();
    const next = applyEffect(game, { kind: "draw", playerId: p1.id, count: 1 });
    expect(next.players[0]?.failedToDraw).toBe(true);
    expect(next.players[0]?.lost).toBe(true);
    expect(next.winnerId).toBe(p2.id);
    expect(game.players[0]?.lost).toBe(false);
  });

  it("rejects damaging a card that is not a battlefield creature", () => {
    const { game, p1 } = twoPlayers();
    const definition = createCardDefinition({ name: "Shock", typeLine: "Instant" });
    const card = createCardInstance({
      definitionId: definition.id,
      ownerId: p1.id,
      zone: "hand",
    });
    game.definitions[definition.id] = definition;
    game.cards[card.id] = card;
    p1.zones.hand.push(card.id);
    const original = structuredClone(game);
    expect(() =>
      applyEffect(game, {
        kind: "deal_damage",
        sourceId: null,
        target: { type: "creature", cardId: card.id },
        amount: 1,
      }),
    ).toThrow(/creature/);
    expect(game).toEqual(original);
  });

  it("pauses surveil and draws after the looked-at card is kept or ditched", () => {
    const { game, p1 } = twoPlayers();
    const top = createCardDefinition({ name: "Island", typeLine: "Basic Land — Island" });
    const next = createCardDefinition({ name: "Swamp", typeLine: "Basic Land — Swamp" });
    const topCard = createCardInstance({ definitionId: top.id, ownerId: p1.id, zone: "library" });
    const nextCard = createCardInstance({ definitionId: next.id, ownerId: p1.id, zone: "library" });
    game.definitions[top.id] = top;
    game.definitions[next.id] = next;
    game.cards[topCard.id] = topCard;
    game.cards[nextCard.id] = nextCard;
    p1.zones.library.push(topCard.id, nextCard.id);

    const paused = applyEffects(game, [
      { kind: "surveil", playerId: p1.id, count: 1 },
      { kind: "draw", playerId: p1.id, count: 1 },
    ]);
    expect(paused.prompts[0]).toMatchObject({
      kind: "surveil",
      playerId: p1.id,
      count: 1,
      resumeEffects: [{ kind: "draw", playerId: p1.id, count: 1 }],
    });
    expect(paused.players[0]?.zones.hand).toEqual([]);

    const kept = applyAction(paused, {
      kind: "resolve_surveil",
      playerId: p1.id,
      graveyardIds: [],
    });
    expect(kept.prompts).toEqual([]);
    expect(kept.players[0]?.zones.hand).toEqual([topCard.id]);
    expect(kept.players[0]?.zones.library).toEqual([nextCard.id]);
    expect(kept.players[0]?.zones.graveyard).toEqual([]);

    const ditched = applyAction(paused, {
      kind: "resolve_surveil",
      playerId: p1.id,
      graveyardIds: [topCard.id],
    });
    expect(ditched.players[0]?.zones.graveyard).toEqual([topCard.id]);
    expect(ditched.players[0]?.zones.hand).toEqual([nextCard.id]);
    expect(ditched.players[0]?.zones.library).toEqual([]);
  });
});
