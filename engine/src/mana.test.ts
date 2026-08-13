import { describe, expect, it } from "vitest";
import {
  createCardDefinition,
  createCardInstance,
  createGameState,
  emptyManaPool,
  parseGameState,
  serializeGameState,
} from "./index";
import { advanceStep } from "./turn";
import {
  addMana,
  canPayManaCost,
  emptyManaPools,
  parseManaCost,
  payManaCost,
  removeMana,
  tapCard,
  tapForMana,
  untapCard,
} from "./mana";

function twoPlayers() {
  const game = createGameState({ playerCount: 2 });
  const p1 = game.players[0];
  const p2 = game.players[1];
  if (!p1 || !p2) {
    throw new Error("need players");
  }
  return { game, p1, p2 };
}

function battlefieldPermanent() {
  const { game, p1, p2 } = twoPlayers();
  const forest = createCardDefinition({
    name: "Forest",
    typeLine: "Basic Land — Forest",
  });
  const card = createCardInstance({
    definitionId: forest.id,
    ownerId: p1.id,
    zone: "battlefield",
  });
  game.definitions[forest.id] = forest;
  game.cards[card.id] = card;
  p1.zones.battlefield.push(card.id);
  return { game, p1, p2, card };
}

describe("mana pool", () => {
  it("adds colored and colorless mana without changing other players", () => {
    const { game, p1, p2 } = twoPlayers();
    const next = addMana(game, p1.id, { R: 2, C: 1 });
    expect(next.players[0]?.mana).toEqual({
      W: 0,
      U: 0,
      B: 0,
      R: 2,
      G: 0,
      C: 1,
    });
    expect(next.players[1]?.mana).toEqual(emptyManaPool());
    expect(game.players[0]?.mana).toEqual(emptyManaPool());
    expect(p2.mana).toEqual(emptyManaPool());
  });

  it("tracks each color independently", () => {
    const { game, p1 } = twoPlayers();
    let next = addMana(game, p1.id, { W: 1 });
    next = addMana(next, p1.id, { U: 1, B: 1, R: 1, G: 1 });
    expect(next.players[0]?.mana).toEqual({
      W: 1,
      U: 1,
      B: 1,
      R: 1,
      G: 1,
      C: 0,
    });
  });

  it("removes specific mana from the pool", () => {
    const { game, p1 } = twoPlayers();
    const filled = addMana(game, p1.id, { U: 2, C: 1 });
    const next = removeMana(filled, p1.id, { U: 1, C: 1 });
    expect(next.players[0]?.mana).toEqual({
      W: 0,
      U: 1,
      B: 0,
      R: 0,
      G: 0,
      C: 0,
    });
  });

  it("rejects removing more mana than the pool contains", () => {
    const { game, p1 } = twoPlayers();
    const filled = addMana(game, p1.id, { R: 1 });
    expect(() => removeMana(filled, p1.id, { R: 2 })).toThrow(/Not enough R/);
    expect(() => removeMana(filled, p1.id, { U: 1 })).toThrow(/Not enough U/);
  });

  it("rejects negative mana amounts", () => {
    const { game, p1 } = twoPlayers();
    expect(() => addMana(game, p1.id, { R: -1 })).toThrow(/Invalid/);
    expect(() => removeMana(game, p1.id, { C: -1 })).toThrow(/Invalid/);
  });

  it("empties every player's pool", () => {
    const { game, p1, p2 } = twoPlayers();
    let next = addMana(game, p1.id, { W: 3 });
    next = addMana(next, p2.id, { C: 2 });
    next = emptyManaPools(next);
    expect(next.players[0]?.mana).toEqual(emptyManaPool());
    expect(next.players[1]?.mana).toEqual(emptyManaPool());
  });

  it("empties unused mana when a step ends", () => {
    const { game, p1, p2 } = twoPlayers();
    let next = addMana(game, p1.id, { G: 2, C: 1 });
    next = addMana(next, p2.id, { R: 1 });
    next = advanceStep(next);
    expect(next.turn.step).toBe("upkeep");
    expect(next.players[0]?.mana).toEqual(emptyManaPool());
    expect(next.players[1]?.mana).toEqual(emptyManaPool());
  });

  it("serializes mana pool changes", () => {
    const { game, p1 } = twoPlayers();
    const next = addMana(game, p1.id, { W: 1, C: 2 });
    const restored = parseGameState(serializeGameState(next));
    expect(restored.players[0]?.mana).toEqual(next.players[0]?.mana);
  });
});

describe("mana costs", () => {
  it("parses generic, colored, and colorless symbols", () => {
    expect(parseManaCost("{2}{W}{U}")).toEqual({
      generic: 2,
      W: 1,
      U: 1,
      B: 0,
      R: 0,
      G: 0,
      C: 0,
    });
    expect(parseManaCost("{1}{C}")).toEqual({
      generic: 1,
      W: 0,
      U: 0,
      B: 0,
      R: 0,
      G: 0,
      C: 1,
    });
    expect(parseManaCost("")).toEqual({
      generic: 0,
      W: 0,
      U: 0,
      B: 0,
      R: 0,
      G: 0,
      C: 0,
    });
  });

  it("rejects unsupported mana symbols", () => {
    expect(() => parseManaCost("{X}")).toThrow(/Unsupported/);
    expect(() => parseManaCost("{W/U}")).toThrow(/Unsupported/);
  });

  it("pays colored costs from matching mana", () => {
    const { game, p1 } = twoPlayers();
    const filled = addMana(game, p1.id, { R: 1, G: 1 });
    const paid = payManaCost(filled, p1.id, "{R}");
    expect(paid.players[0]?.mana).toEqual({
      W: 0,
      U: 0,
      B: 0,
      R: 0,
      G: 1,
      C: 0,
    });
  });

  it("pays generic costs with any remaining mana", () => {
    const { game, p1 } = twoPlayers();
    const withColorless = addMana(game, p1.id, { C: 2 });
    expect(canPayManaCost(withColorless.players[0]!.mana, "{2}")).toBe(true);
    expect(payManaCost(withColorless, p1.id, "{2}").players[0]?.mana).toEqual(
      emptyManaPool(),
    );

    const withColors = addMana(game, p1.id, { R: 1, G: 1 });
    expect(payManaCost(withColors, p1.id, "{2}").players[0]?.mana).toEqual(
      emptyManaPool(),
    );
  });

  it("pays mixed generic and colored costs", () => {
    const { game, p1 } = twoPlayers();
    const filled = addMana(game, p1.id, { G: 2, C: 1 });
    const paid = payManaCost(filled, p1.id, "{1}{G}");
    expect(paid.players[0]?.mana).toEqual({
      W: 0,
      U: 0,
      B: 0,
      R: 0,
      G: 1,
      C: 0,
    });
  });

  it("rejects illegal payments", () => {
    const { game, p1 } = twoPlayers();
    const filled = addMana(game, p1.id, { R: 1 });
    expect(canPayManaCost(filled.players[0]!.mana, "{2}")).toBe(false);
    expect(canPayManaCost(filled.players[0]!.mana, "{G}")).toBe(false);
    expect(() => payManaCost(filled, p1.id, "{2}")).toThrow(/Cannot pay/);
    expect(() => payManaCost(filled, p1.id, "{R}{R}")).toThrow(/Cannot pay/);
  });
});

describe("tap, untap, and mana production", () => {
  it("taps and untaps a battlefield permanent", () => {
    const { game, card } = battlefieldPermanent();
    const tapped = tapCard(game, card.id);
    expect(tapped.cards[card.id]?.tapped).toBe(true);
    expect(game.cards[card.id]?.tapped).toBe(false);
    const untapped = untapCard(tapped, card.id);
    expect(untapped.cards[card.id]?.tapped).toBe(false);
  });

  it("rejects tapping a card that is not an untapped battlefield permanent", () => {
    const { game, p1 } = twoPlayers();
    const def = createCardDefinition({ name: "Shock", typeLine: "Instant" });
    const card = createCardInstance({
      definitionId: def.id,
      ownerId: p1.id,
      zone: "hand",
    });
    game.definitions[def.id] = def;
    game.cards[card.id] = card;
    p1.zones.hand.push(card.id);
    expect(() => tapCard(game, card.id)).toThrow(/battlefield/);
  });

  it("rejects tapping an already tapped permanent", () => {
    const { game, card } = battlefieldPermanent();
    const tapped = tapCard(game, card.id);
    expect(() => tapCard(tapped, card.id)).toThrow(/already tapped/);
  });

  it("produces mana by tapping a permanent", () => {
    const { game, p1, p2, card } = battlefieldPermanent();
    const next = tapForMana(game, card.id, { G: 1 });
    expect(next.cards[card.id]?.tapped).toBe(true);
    expect(next.players[0]?.mana).toEqual({
      W: 0,
      U: 0,
      B: 0,
      R: 0,
      G: 1,
      C: 0,
    });
    expect(next.players[1]?.mana).toEqual(emptyManaPool());
    expect(p1.mana).toEqual(emptyManaPool());
    expect(p2.mana).toEqual(emptyManaPool());
  });
});
