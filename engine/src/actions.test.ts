import { describe, expect, it } from "vitest";
import {
  addMana,
  applyAction,
  createCardDefinition,
  createCardInstance,
  createGameState,
  parseGameAction,
  parseGameState,
  serializeGameAction,
  serializeGameState,
} from "./index";
import { fillLibraries } from "./testSupport";
import { TURN_SEQUENCE, advanceSteps } from "./turn";
import type { GameAction, GameState } from "./types";

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
  fillLibraries(game);
  return advanceSteps(game, 3);
}

function addSpellToHand(
  game: GameState,
  ownerId: string,
  input: { name: string; typeLine: string; manaCost: string },
) {
  const owner = game.players.find((player) => player.id === ownerId);
  if (!owner) {
    throw new Error("missing owner");
  }
  const definition = createCardDefinition(input);
  const card = createCardInstance({
    definitionId: definition.id,
    ownerId,
    zone: "hand",
  });
  game.definitions[definition.id] = definition;
  game.cards[card.id] = card;
  owner.zones.hand.push(card.id);
  return { definition, card };
}

function passAll(game: GameState): GameState {
  let next = game;
  for (let i = 0; i < game.players.length; i += 1) {
    next = applyAction(next, { kind: "pass_priority", playerId: next.priorityPlayerId });
  }
  return next;
}

describe("applyAction casting and priority", () => {
  it("casts an instant from hand, pays mana, and puts it on the stack", () => {
    const { game, p1 } = twoPlayers();
    const { card } = addSpellToHand(game, p1.id, {
      name: "Lightning Bolt",
      typeLine: "Instant",
      manaCost: "{R}",
    });
    const ready = addMana(game, p1.id, { R: 1, C: 1 });
    const original = structuredClone(ready);

    const next = applyAction(ready, {
      kind: "cast_spell",
      playerId: p1.id,
      cardId: card.id,
    });

    expect(next.stack).toHaveLength(1);
    expect(next.stack[0]?.sourceId).toBe(card.id);
    expect(next.cards[card.id]?.zone).toBe("stack");
    expect(next.players[0]?.zones.hand).not.toContain(card.id);
    expect(next.players[0]?.mana).toEqual({
      W: 0,
      U: 0,
      B: 0,
      R: 0,
      G: 0,
      C: 1,
    });
    expect(next.priorityPlayerId).toBe(p1.id);
    expect(ready).toEqual(original);
  });

  it("resolves a creature spell onto the battlefield after both players pass", () => {
    const { game, p1, p2 } = twoPlayers();
    const { card } = addSpellToHand(game, p1.id, {
      name: "Grizzly Bears",
      typeLine: "Creature — Bear",
      manaCost: "{1}{G}",
    });
    let next = toPrecombatMain(game);
    next = addMana(next, p1.id, { G: 1, C: 1 });
    next = applyAction(next, { kind: "cast_spell", playerId: p1.id, cardId: card.id });
    next = applyAction(next, { kind: "pass_priority", playerId: p1.id });
    next = applyAction(next, { kind: "pass_priority", playerId: p2.id });

    expect(next.stack).toHaveLength(0);
    expect(next.cards[card.id]?.zone).toBe("battlefield");
    expect(next.players[0]?.zones.battlefield).toContain(card.id);
    expect(next.priorityPlayerId).toBe(p1.id);
    expect(next.turn.step).toBe("precombatMain");
  });

  it("resolves an instant to the owner's graveyard", () => {
    const { game, p1, p2 } = twoPlayers();
    const { card } = addSpellToHand(game, p1.id, {
      name: "Lightning Bolt",
      typeLine: "Instant",
      manaCost: "{R}",
    });
    let next = addMana(game, p1.id, { R: 1 });
    next = applyAction(next, { kind: "cast_spell", playerId: p1.id, cardId: card.id });
    next = applyAction(next, { kind: "pass_priority", playerId: p1.id });
    next = applyAction(next, { kind: "pass_priority", playerId: p2.id });
    expect(next.cards[card.id]?.zone).toBe("graveyard");
    expect(next.players[0]?.zones.graveyard).toContain(card.id);
  });

  it("advances the step after a full pass with an empty stack", () => {
    const { game, p1 } = twoPlayers();
    const next = passAll(game);
    expect(next.turn.step).toBe("upkeep");
    expect(next.priorityPlayerId).toBe(p1.id);
  });
});

describe("illegal actions leave GameState unchanged", () => {
  it("rejects a pass from a player without priority", () => {
    const { game, p2 } = twoPlayers();
    const original = structuredClone(game);
    expect(() =>
      applyAction(game, { kind: "pass_priority", playerId: p2.id }),
    ).toThrow(/priority/);
    expect(game).toEqual(original);
  });

  it("rejects a cast from a player without priority", () => {
    const { game, p2 } = twoPlayers();
    const { card } = addSpellToHand(game, p2.id, {
      name: "Lightning Bolt",
      typeLine: "Instant",
      manaCost: "{R}",
    });
    const ready = addMana(game, p2.id, { R: 1 });
    const original = structuredClone(ready);
    expect(() =>
      applyAction(ready, { kind: "cast_spell", playerId: p2.id, cardId: card.id }),
    ).toThrow(/priority/);
    expect(ready).toEqual(original);
    expect(ready.players[1]?.zones.hand).toContain(card.id);
    expect(ready.players[1]?.mana.R).toBe(1);
    expect(ready.stack).toHaveLength(0);
  });

  it("rejects casting a card that is not in the player's hand", () => {
    const { game, p1 } = twoPlayers();
    const { card } = addSpellToHand(game, p1.id, {
      name: "Lightning Bolt",
      typeLine: "Instant",
      manaCost: "{R}",
    });
    game.players[0]!.zones.hand = [];
    game.players[0]!.zones.library.push(card.id);
    game.cards[card.id]!.zone = "library";
    const ready = addMana(game, p1.id, { R: 1 });
    const original = structuredClone(ready);
    expect(() =>
      applyAction(ready, { kind: "cast_spell", playerId: p1.id, cardId: card.id }),
    ).toThrow(/hand/);
    expect(ready).toEqual(original);
    expect(ready.players[0]?.mana.R).toBe(1);
    expect(ready.stack).toHaveLength(0);
  });

  it("rejects a cast the player cannot pay for without spending mana or moving the card", () => {
    const { game, p1 } = twoPlayers();
    const { card } = addSpellToHand(game, p1.id, {
      name: "Lightning Bolt",
      typeLine: "Instant",
      manaCost: "{R}",
    });
    const original = structuredClone(game);
    expect(() =>
      applyAction(game, { kind: "cast_spell", playerId: p1.id, cardId: card.id }),
    ).toThrow(/Cannot pay/);
    expect(game).toEqual(original);
    expect(game.players[0]?.zones.hand).toContain(card.id);
    expect(game.stack).toHaveLength(0);
    expect(game.priorityPlayerId).toBe(p1.id);
  });

  it("rejects an unknown card and an unknown player", () => {
    const { game, p1 } = twoPlayers();
    const original = structuredClone(game);
    expect(() =>
      applyAction(game, { kind: "cast_spell", playerId: p1.id, cardId: "missing" }),
    ).toThrow(/Unknown card/);
    expect(() =>
      applyAction(game, { kind: "pass_priority", playerId: "no-such-player" }),
    ).toThrow(/Unknown player/);
    expect(game).toEqual(original);
  });

  it("rejects extra targets on an untargeted spell", () => {
    const { game, p1 } = twoPlayers();
    const { card } = addSpellToHand(game, p1.id, {
      name: "Lightning Bolt",
      typeLine: "Instant",
      manaCost: "{R}",
    });
    const ready = addMana(game, p1.id, { R: 1 });
    const original = structuredClone(ready);
    const action: GameAction = {
      kind: "cast_spell",
      playerId: p1.id,
      cardId: card.id,
      targets: [{ type: "player", playerId: p1.id }],
    };
    expect(() => applyAction(ready, action)).toThrow(/does not require targets/);
    expect(ready).toEqual(original);
    expect(ready.players[0]?.mana.R).toBe(1);
  });

  it("rejects casting a creature outside the active player's main phase", () => {
    const { game, p1 } = twoPlayers();
    const { card } = addSpellToHand(game, p1.id, {
      name: "Grizzly Bears",
      typeLine: "Creature — Bear",
      manaCost: "{1}{G}",
    });
    const ready = addMana(game, p1.id, { G: 1, C: 1 });
    const original = structuredClone(ready);
    expect(ready.turn.step).toBe("untap");
    expect(() =>
      applyAction(ready, { kind: "cast_spell", playerId: p1.id, cardId: card.id }),
    ).toThrow(/cannot be cast/);
    expect(ready).toEqual(original);
  });
});

describe("game action serialization", () => {
  it("round-trips a cast_spell action", () => {
    const action: GameAction = {
      kind: "cast_spell",
      playerId: "player-1",
      cardId: "card-1",
    };
    expect(parseGameAction(serializeGameAction(action))).toEqual(action);
  });

  it("round-trips a game with a hand card, stack spell, mana, priority, and mid-turn state", () => {
    const { game, p1, p2 } = twoPlayers();
    const { card: bolt } = addSpellToHand(game, p1.id, {
      name: "Lightning Bolt",
      typeLine: "Instant",
      manaCost: "{R}",
    });
    addSpellToHand(game, p1.id, {
      name: "Grizzly Bears",
      typeLine: "Creature — Bear",
      manaCost: "{1}{G}",
    });
    let next = toPrecombatMain(game);
    next = addMana(next, p1.id, { R: 2, G: 1, C: 3 });
    next = applyAction(next, { kind: "cast_spell", playerId: p1.id, cardId: bolt.id });
    next = applyAction(next, { kind: "pass_priority", playerId: p1.id });

    expect(next.turn.step).toBe("precombatMain");
    expect(next.stack).toHaveLength(1);
    expect(next.priorityPlayerId).toBe(p2.id);
    expect(next.players[0]?.mana.R).toBe(1);

    const restored = parseGameState(serializeGameState(next));
    expect(restored).toEqual(next);
    expect(restored.cards[bolt.id]?.zone).toBe("stack");
    expect(TURN_SEQUENCE.some((slot) => slot.step === restored.turn.step)).toBe(true);
  });
});

describe("multiple mana abilities", () => {
  it("lets a pain land tap for colorless or for a color at 1 damage", () => {
    const { game, p1 } = twoPlayers();
    const river = createCardDefinition({
      name: "Underground River",
      typeLine: "Land",
      produces: { C: 1 },
      manaAbilities: [
        {
          produces: { C: 1 },
          producesOptions: [],
          producesAnyColor: false,
          damageToController: 0,
        },
        {
          produces: {},
          producesOptions: ["U", "B"],
          producesAnyColor: false,
          damageToController: 1,
        },
      ],
    });
    const card = createCardInstance({
      definitionId: river.id,
      ownerId: p1.id,
      zone: "battlefield",
      summoningSick: false,
    });
    game.definitions[river.id] = river;
    game.cards[card.id] = card;
    p1.zones.battlefield.push(card.id);

    const ready = toPrecombatMain(game);
    const colorless = applyAction(ready, {
      kind: "tap_for_mana",
      playerId: p1.id,
      cardId: card.id,
      manaIndex: 0,
    });
    expect(colorless.players[0]?.mana.C).toBe(1);
    expect(colorless.players[0]?.life).toBe(40);
    expect(colorless.cards[card.id]?.tapped).toBe(true);

    const colored = applyAction(ready, {
      kind: "tap_for_mana",
      playerId: p1.id,
      cardId: card.id,
      color: "U",
      manaIndex: 1,
    });
    expect(colored.players[0]?.mana.U).toBe(1);
    expect(colored.players[0]?.mana.C).toBe(0);
    expect(colored.players[0]?.life).toBe(39);
    expect(colored.cards[card.id]?.tapped).toBe(true);

    const restored = parseGameAction(
      serializeGameAction({
        kind: "tap_for_mana",
        playerId: p1.id,
        cardId: card.id,
        color: "B",
        manaIndex: 1,
      }),
    );
    expect(restored).toEqual({
      kind: "tap_for_mana",
      playerId: p1.id,
      cardId: card.id,
      color: "B",
      manaIndex: 1,
    });
  });
});

describe("host skip actions", () => {
  it("advances to the next action and then the next player's turn", () => {
    const { game, p1, p2 } = twoPlayers();
    fillLibraries(game);
    const fromUpkeep = applyAction(game, { kind: "advance_step", playerId: p1.id });
    expect(fromUpkeep.turn.step).toBe("upkeep");
    const fromMain = applyAction(fromUpkeep, { kind: "advance_step", playerId: p1.id });
    expect(fromMain.turn.step).toBe("precombatMain");
    const nextTurn = applyAction(fromMain, { kind: "advance_turn", playerId: p1.id });
    expect(nextTurn.turn.activePlayerId).toBe(p2.id);
    expect(nextTurn.turn.step).toBe("untap");
    expect(nextTurn.turn.number).toBe(1);
    expect(parseGameAction(serializeGameAction({ kind: "advance_step", playerId: p1.id }))).toEqual({
      kind: "advance_step",
      playerId: p1.id,
    });
    expect(parseGameAction(serializeGameAction({ kind: "advance_turn", playerId: p1.id }))).toEqual({
      kind: "advance_turn",
      playerId: p1.id,
    });
  });
});

describe("modal double-faced lands", () => {
  it("plays the chosen back face", () => {
    const { game, p1 } = twoPlayers();
    const front = createCardDefinition({
      name: "Clearwater Pathway",
      typeLine: "Land",
      layout: "modal_dfc",
      produces: { U: 1 },
    });
    const back = createCardDefinition({
      name: "Murkwater Pathway",
      typeLine: "Land",
      layout: "modal_dfc",
      otherFaceId: front.id,
      produces: { B: 1 },
    });
    front.otherFaceId = back.id;
    game.definitions[front.id] = front;
    game.definitions[back.id] = back;
    const card = createCardInstance({
      definitionId: front.id,
      ownerId: p1.id,
      zone: "hand",
    });
    game.cards[card.id] = card;
    p1.zones.hand.push(card.id);

    const played = applyAction(toPrecombatMain(game), {
      kind: "play_land",
      playerId: p1.id,
      cardId: card.id,
      faceIndex: 1,
    });
    expect(played.cards[card.id]?.definitionId).toBe(back.id);
    expect(played.cards[card.id]?.zone).toBe("battlefield");
    expect(played.definitions[back.id]?.produces).toEqual({ B: 1 });
  });
});
