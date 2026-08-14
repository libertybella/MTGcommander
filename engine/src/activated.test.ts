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

function passUntilEmptyStack(game: GameState): GameState {
  let next = game;
  let guard = 0;
  while (next.stack.length > 0) {
    next = applyAction(next, { kind: "pass_priority", playerId: next.priorityPlayerId });
    guard += 1;
    if (guard > 40) {
      throw new Error("stack did not clear");
    }
  }
  return next;
}

function seatOracle(
  game: GameState,
  ownerId: string,
  extra?: Partial<ReturnType<typeof createCardDefinition>>,
) {
  const definition = createCardDefinition({
    name: "Test Oracle",
    typeLine: "Artifact",
    manaCost: "{0}",
    oracleText: "{T}: Draw a card.",
    activated: [
      {
        tap: true,
        manaCost: "",
        targetRequirements: [],
        effects: [{ kind: "draw", playerId: "controller", count: 1 }],
      },
    ],
    ...extra,
  });
  const card = createCardInstance({
    definitionId: definition.id,
    ownerId,
    zone: "battlefield",
    summoningSick: false,
  });
  game.definitions[definition.id] = definition;
  game.cards[card.id] = card;
  const player = game.players.find((entry) => entry.id === ownerId);
  player?.zones.battlefield.push(card.id);
  return { definition, card };
}

describe("activated abilities", () => {
  it("taps the source, puts the ability on the stack, and draws on resolve", () => {
    const { game, p1 } = twoPlayers();
    const libraryCard = createCardInstance({
      definitionId: seatOracle(game, p1.id).definition.id,
      ownerId: p1.id,
      zone: "library",
    });
    game.cards[libraryCard.id] = libraryCard;
    p1.zones.library.push(libraryCard.id);
    const oracleId = p1.zones.battlefield[0];
    if (!oracleId) {
      throw new Error("missing oracle");
    }

    const activated = applyAction(game, {
      kind: "activate_ability",
      playerId: p1.id,
      cardId: oracleId,
      abilityIndex: 0,
    });
    expect(activated.cards[oracleId]?.tapped).toBe(true);
    expect(activated.cards[oracleId]?.zone).toBe("battlefield");
    expect(activated.stack).toHaveLength(1);
    expect(activated.stack[0]?.kind).toBe("ability");
    expect(activated.stack[0]?.activatedIndex).toBe(0);
    expect(activated.players[0]?.zones.hand).toHaveLength(0);

    const resolved = passUntilEmptyStack(activated);
    expect(resolved.stack).toHaveLength(0);
    expect(resolved.players[0]?.zones.hand).toEqual([libraryCard.id]);
    expect(resolved.cards[oracleId]?.zone).toBe("battlefield");
  });

  it("pays a mana cost before the ability is stacked", () => {
    const { game, p1 } = twoPlayers();
    const { card } = seatOracle(game, p1.id, {
      activated: [
        {
          tap: true,
          manaCost: "{2}",
          targetRequirements: [],
          effects: [{ kind: "gain_life", playerId: "controller", amount: 1 }],
        },
      ],
    });
    const funded = addMana(game, p1.id, { C: 2 });
    const activated = applyAction(funded, {
      kind: "activate_ability",
      playerId: p1.id,
      cardId: card.id,
      abilityIndex: 0,
    });
    expect(activated.players[0]?.mana).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 });
    expect(activated.stack).toHaveLength(1);

    const resolved = passUntilEmptyStack(activated);
    expect(resolved.players[0]?.life).toBe(41);
  });

  it("rejects a tap ability while the source is tapped, without mutating state", () => {
    const { game, p1 } = twoPlayers();
    const { card } = seatOracle(game, p1.id);
    const first = applyAction(game, {
      kind: "activate_ability",
      playerId: p1.id,
      cardId: card.id,
      abilityIndex: 0,
    });
    const before = serializeGameState(first);
    expect(() =>
      applyAction(first, {
        kind: "activate_ability",
        playerId: p1.id,
        cardId: card.id,
        abilityIndex: 0,
      }),
    ).toThrow(/already tapped/);
    expect(serializeGameState(first)).toBe(before);
  });

  it("rejects a creature tap ability under summoning sickness", () => {
    const { game, p1 } = twoPlayers();
    const definition = createCardDefinition({
      name: "Test Prodigy",
      typeLine: "Creature — Wizard",
      power: 1,
      toughness: 1,
      activated: [
        {
          tap: true,
          manaCost: "",
          targetRequirements: [{ kind: "player_or_creature" }],
          effects: [
            {
              kind: "deal_damage",
              sourceId: "self",
              target: { type: "chosen", index: 0 },
              amount: 1,
            },
          ],
        },
      ],
    });
    const card = createCardInstance({
      definitionId: definition.id,
      ownerId: p1.id,
      zone: "battlefield",
      summoningSick: true,
    });
    game.definitions[definition.id] = definition;
    game.cards[card.id] = card;
    p1.zones.battlefield.push(card.id);
    const p2 = game.players[1];
    if (!p2) {
      throw new Error("need opponent");
    }
    const before = serializeGameState(game);
    expect(() =>
      applyAction(game, {
        kind: "activate_ability",
        playerId: p1.id,
        cardId: card.id,
        abilityIndex: 0,
        targets: [{ type: "player", playerId: p2.id }],
      }),
    ).toThrow(/summoning sickness/);
    expect(serializeGameState(game)).toBe(before);
  });

  it("resolves a targeted ping", () => {
    const { game, p1, p2 } = twoPlayers();
    const staff = createCardDefinition({
      name: "Test Staff",
      typeLine: "Artifact",
      activated: [
        {
          tap: true,
          manaCost: "",
          targetRequirements: [{ kind: "player_or_creature" }],
          effects: [
            {
              kind: "deal_damage",
              sourceId: "self",
              target: { type: "chosen", index: 0 },
              amount: 1,
            },
          ],
        },
      ],
    });
    const source = createCardInstance({
      definitionId: staff.id,
      ownerId: p1.id,
      zone: "battlefield",
      summoningSick: false,
    });
    const bear = createCardDefinition({
      name: "Test Bear",
      typeLine: "Creature — Bear",
      power: 2,
      toughness: 2,
    });
    const creature = createCardInstance({
      definitionId: bear.id,
      ownerId: p2.id,
      zone: "battlefield",
    });
    game.definitions[staff.id] = staff;
    game.definitions[bear.id] = bear;
    game.cards[source.id] = source;
    game.cards[creature.id] = creature;
    p1.zones.battlefield.push(source.id);
    p2.zones.battlefield.push(creature.id);

    const pinged = applyAction(game, {
      kind: "activate_ability",
      playerId: p1.id,
      cardId: source.id,
      abilityIndex: 0,
      targets: [{ type: "creature", cardId: creature.id }],
    });
    const resolved = passUntilEmptyStack(pinged);
    expect(resolved.cards[creature.id]?.damageMarked).toBe(1);
  });

  it("fizzles a targeted ability if the player target has left", () => {
    const { game, p1, p2 } = twoPlayers();
    const { card } = seatOracle(game, p1.id, {
      activated: [
        {
          tap: true,
          manaCost: "",
          targetRequirements: [{ kind: "player" }],
          effects: [
            {
              kind: "deal_damage",
              sourceId: "self",
              target: { type: "chosen", index: 0 },
              amount: 1,
            },
          ],
        },
      ],
    });
    const stacked = applyAction(game, {
      kind: "activate_ability",
      playerId: p1.id,
      cardId: card.id,
      abilityIndex: 0,
      targets: [{ type: "player", playerId: p2.id }],
    });
    const conceded = applyAction(stacked, { kind: "concede", playerId: p2.id });
    expect(conceded.stack).toHaveLength(1);
    const fizzled = passUntilEmptyStack(conceded);
    expect(fizzled.players[0]?.life).toBe(40);
  });

  it("round-trips an activate_ability action and stacked ability", () => {
    const { game, p1 } = twoPlayers();
    const { card } = seatOracle(game, p1.id);
    const action = {
      kind: "activate_ability" as const,
      playerId: p1.id,
      cardId: card.id,
      abilityIndex: 0,
    };
    expect(parseGameAction(serializeGameAction(action))).toEqual(action);

    const stacked = applyAction(game, action);
    const restored = parseGameState(serializeGameState(stacked));
    expect(restored.stack[0]?.activatedIndex).toBe(0);
    expect(restored.definitions[card.definitionId]?.activated).toHaveLength(1);
  });
});
