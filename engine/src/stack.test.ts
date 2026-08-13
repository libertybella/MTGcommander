import { describe, expect, it } from "vitest";
import {
  createCardDefinition,
  createCardInstance,
  createGameState,
  countCardPlacements,
  parseGameState,
  serializeGameState,
} from "./index";
import { passPriority, putSpellOnStack, resolveTopOfStack } from "./stack";

function twoPlayerWithInstants() {
  const game = createGameState({ playerCount: 2 });
  const p1 = game.players[0];
  const p2 = game.players[1];
  if (!p1 || !p2) {
    throw new Error("need players");
  }
  const bolt = createCardDefinition({
    name: "Lightning Bolt",
    typeLine: "Instant",
    manaCost: "{R}",
  });
  const counter = createCardDefinition({
    name: "Counterspell",
    typeLine: "Instant",
    manaCost: "{U}{U}",
  });
  game.definitions[bolt.id] = bolt;
  game.definitions[counter.id] = counter;
  const boltCard = createCardInstance({
    definitionId: bolt.id,
    ownerId: p1.id,
    zone: "hand",
  });
  const counterCard = createCardInstance({
    definitionId: counter.id,
    ownerId: p2.id,
    zone: "hand",
  });
  game.cards[boltCard.id] = boltCard;
  game.cards[counterCard.id] = counterCard;
  p1.zones.hand.push(boltCard.id);
  p2.zones.hand.push(counterCard.id);
  return { game, p1, p2, boltCard, counterCard };
}

describe("priority and stack", () => {
  it("starts priority with the active player", () => {
    const game = createGameState({ playerCount: 3 });
    expect(game.priorityPlayerId).toBe(game.turn.activePlayerId);
  });

  it("passes priority around the table", () => {
    const game = createGameState({ playerCount: 3 });
    const [a, b, c] = game.players;
    const afterA = passPriority(game, a!.id);
    expect(afterA.priorityPlayerId).toBe(b!.id);
    const afterB = passPriority(afterA, b!.id);
    expect(afterB.priorityPlayerId).toBe(c!.id);
  });

  it("rejects a pass from a player who does not have priority", () => {
    const game = createGameState({ playerCount: 2 });
    expect(() => passPriority(game, game.players[1]!.id)).toThrow(/priority/);
  });

  it("puts a spell on the stack from hand", () => {
    const { game, p1, boltCard } = twoPlayerWithInstants();
    const stacked = putSpellOnStack(game, boltCard.id);
    expect(stacked.stack).toHaveLength(1);
    expect(stacked.stack[0]?.sourceId).toBe(boltCard.id);
    expect(stacked.cards[boltCard.id]?.zone).toBe("stack");
    expect(stacked.players[0]?.zones.hand).not.toContain(boltCard.id);
    expect(countCardPlacements(stacked, boltCard.id)).toBe(0);
    expect(stacked.priorityPlayerId).toBe(p1.id);
  });

  it("resolves instants to the graveyard in LIFO order (counterspell pattern)", () => {
    const { game, p1, p2, boltCard, counterCard } = twoPlayerWithInstants();
    let next = putSpellOnStack(game, boltCard.id);
    next = passPriority(next, p1.id);
    expect(next.priorityPlayerId).toBe(p2.id);
    next = putSpellOnStack(next, counterCard.id);
    expect(next.stack.map((entry) => entry.sourceId)).toEqual([
      boltCard.id,
      counterCard.id,
    ]);

    next = passPriority(next, p2.id);
    next = passPriority(next, p1.id);
    expect(next.stack).toHaveLength(1);
    expect(next.stack[0]?.sourceId).toBe(boltCard.id);
    expect(next.cards[counterCard.id]?.zone).toBe("graveyard");
    expect(next.players[1]?.zones.graveyard).toContain(counterCard.id);

    next = passPriority(next, p1.id);
    next = passPriority(next, p2.id);
    expect(next.stack).toHaveLength(0);
    expect(next.cards[boltCard.id]?.zone).toBe("graveyard");
    expect(next.priorityPlayerId).toBe(p1.id);
  });

  it("resolves a creature spell onto the battlefield", () => {
    const game = createGameState({ playerCount: 2 });
    const p1 = game.players[0];
    if (!p1) {
      throw new Error("missing player");
    }
    const def = createCardDefinition({
      name: "Grizzly Bears",
      typeLine: "Creature — Bear",
      manaCost: "{1}{G}",
    });
    const card = createCardInstance({
      definitionId: def.id,
      ownerId: p1.id,
      zone: "hand",
    });
    game.definitions[def.id] = def;
    game.cards[card.id] = card;
    p1.zones.hand.push(card.id);

    let next = putSpellOnStack(game, card.id);
    next = resolveTopOfStack(next);
    expect(next.stack).toHaveLength(0);
    expect(next.cards[card.id]?.zone).toBe("battlefield");
    expect(next.players[0]?.zones.battlefield).toContain(card.id);
    expect(card.id).toBe(next.cards[card.id]?.id);
  });

  it("returns priority to the active player after everyone passes on an empty stack", () => {
    const game = createGameState({ playerCount: 3 });
    const [a, b, c] = game.players;
    let next = passPriority(game, a!.id);
    next = passPriority(next, b!.id);
    next = passPriority(next, c!.id);
    expect(next.stack).toHaveLength(0);
    expect(next.priorityPlayerId).toBe(game.turn.activePlayerId);
    expect(next.passesSinceAction).toBe(0);
    expect(next.turn.step).toBe("untap");
  });

  it("wraps priority around four players", () => {
    const game = createGameState({ playerCount: 4 });
    const ids = game.players.map((player) => player.id);
    let next = game;
    for (let i = 0; i < 3; i += 1) {
      next = passPriority(next, ids[i]!);
      expect(next.priorityPlayerId).toBe(ids[i + 1]);
    }
  });

  it("resets pass count when a new object is put on the stack", () => {
    const { game, p1, p2, boltCard } = twoPlayerWithInstants();
    let next = passPriority(game, p1.id);
    expect(next.priorityPlayerId).toBe(p2.id);
    next = putSpellOnStack(next, boltCard.id);
    expect(next.passesSinceAction).toBe(0);
    expect(next.priorityPlayerId).toBe(p1.id);
  });

  it("rejects putting a card on the stack from a zone other than hand", () => {
    const { game, boltCard, p1 } = twoPlayerWithInstants();
    p1.zones.hand = [];
    p1.zones.library.push(boltCard.id);
    game.cards[boltCard.id]!.zone = "library";
    expect(() => putSpellOnStack(game, boltCard.id)).toThrow(/hand/);
  });

  it("rejects resolving an empty stack", () => {
    const game = createGameState({ playerCount: 2 });
    expect(() => resolveTopOfStack(game)).toThrow(/empty/i);
  });

  it("keeps card instance IDs stable and serializes after stack movement", () => {
    const { game, boltCard } = twoPlayerWithInstants();
    const stacked = putSpellOnStack(game, boltCard.id);
    expect(stacked.cards[boltCard.id]?.id).toBe(boltCard.id);
    expect(game.stack).toHaveLength(0);
    expect(game.players[0]?.zones.hand).toContain(boltCard.id);

    const restored = parseGameState(serializeGameState(stacked));
    expect(restored.stack).toHaveLength(1);
    expect(restored.cards[boltCard.id]?.zone).toBe("stack");
    expect(restored.priorityPlayerId).toBe(stacked.priorityPlayerId);
  });
});
