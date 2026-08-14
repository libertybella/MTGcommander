import { describe, expect, it } from "vitest";
import {
  applyAction,
  applyEffect,
  createCardDefinition,
  createCardInstance,
  createGameState,
  testShock,
} from "./index";
import { fillLibraries } from "./testSupport";
import type { GameState, Keyword } from "./types";

function twoPlayers() {
  const game = createGameState({ playerCount: 2 });
  const p1 = game.players[0];
  const p2 = game.players[1];
  if (!p1 || !p2) {
    throw new Error("need players");
  }
  fillLibraries(game);
  return { game, p1, p2 };
}

function creature(
  game: GameState,
  ownerId: string,
  name: string,
  power: number,
  toughness: number,
  keywords: Keyword[] = [],
  options: { summoningSick?: boolean } = {},
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
    keywords,
  });
  const card = createCardInstance({
    definitionId: definition.id,
    ownerId,
    zone: "battlefield",
    summoningSick: options.summoningSick ?? false,
  });
  game.definitions[definition.id] = definition;
  game.cards[card.id] = card;
  owner.zones.battlefield.push(card.id);
  return card;
}

function passTo(game: GameState, step: GameState["turn"]["step"]): GameState {
  let next = game;
  let guard = 0;
  while (next.turn.step !== step) {
    next = applyAction(next, { kind: "pass_priority", playerId: next.priorityPlayerId });
    guard += 1;
    if (guard > 80) {
      throw new Error(`Could not reach ${step}`);
    }
  }
  return next;
}

function passN(game: GameState, count: number): GameState {
  let next = game;
  for (let i = 0; i < count; i += 1) {
    next = applyAction(next, { kind: "pass_priority", playerId: next.priorityPlayerId });
  }
  return next;
}

describe("keywords", () => {
  it("lets haste ignore summoning sickness", () => {
    const { game, p1, p2 } = twoPlayers();
    const hasty = creature(game, p1.id, "Haste", 2, 2, ["haste"], { summoningSick: true });
    let next = passTo(game, "declareAttackers");
    next = applyAction(next, {
      kind: "declare_attackers",
      playerId: p1.id,
      attacks: [{ attackerId: hasty.id, defenderId: p2.id }],
    });
    expect(next.cards[hasty.id]?.attacking).toBe(true);
  });

  it("stops defender from attacking", () => {
    const { game, p1, p2 } = twoPlayers();
    const wall = creature(game, p1.id, "Wall", 0, 4, ["defender"]);
    const next = passTo(game, "declareAttackers");
    expect(() =>
      applyAction(next, {
        kind: "declare_attackers",
        playerId: p1.id,
        attacks: [{ attackerId: wall.id, defenderId: p2.id }],
      }),
    ).toThrow(/cannot attack/);
  });

  it("does not tap vigilance attackers", () => {
    const { game, p1, p2 } = twoPlayers();
    const watcher = creature(game, p1.id, "Watcher", 2, 2, ["vigilance"]);
    let next = passTo(game, "declareAttackers");
    next = applyAction(next, {
      kind: "declare_attackers",
      playerId: p1.id,
      attacks: [{ attackerId: watcher.id, defenderId: p2.id }],
    });
    expect(next.cards[watcher.id]?.tapped).toBe(false);
    expect(next.cards[watcher.id]?.attacking).toBe(true);
  });

  it("requires flying or reach to block flying, and two blockers for menace", () => {
    const { game, p1, p2 } = twoPlayers();
    const flyer = creature(game, p1.id, "Bird", 2, 2, ["flying"]);
    const menace = creature(game, p1.id, "Ogre", 3, 3, ["menace"]);
    const ground = creature(game, p2.id, "Bear", 2, 2);
    const archer = creature(game, p2.id, "Archer", 1, 3, ["reach"]);
    const extra = creature(game, p2.id, "Extra", 1, 1);
    let next = passTo(game, "declareAttackers");
    next = applyAction(next, {
      kind: "declare_attackers",
      playerId: p1.id,
      attacks: [
        { attackerId: flyer.id, defenderId: p2.id },
        { attackerId: menace.id, defenderId: p2.id },
      ],
    });
    next = passN(next, 2);
    const original = structuredClone(next);
    expect(() =>
      applyAction(next, {
        kind: "declare_blockers",
        playerId: p2.id,
        blocks: [{ blockerId: ground.id, attackerId: flyer.id }],
      }),
    ).toThrow(/flying/);
    expect(() =>
      applyAction(next, {
        kind: "declare_blockers",
        playerId: p2.id,
        blocks: [{ blockerId: ground.id, attackerId: menace.id }],
      }),
    ).toThrow(/menace/);
    expect(next).toEqual(original);
    next = applyAction(next, {
      kind: "declare_blockers",
      playerId: p2.id,
      blocks: [
        { blockerId: archer.id, attackerId: flyer.id },
        { blockerId: ground.id, attackerId: menace.id },
        { blockerId: extra.id, attackerId: menace.id },
      ],
    });
    expect(next.cards[archer.id]?.blockingAttackerId).toBe(flyer.id);
  });

  it("tramples leftover damage to the defending player", () => {
    const { game, p1, p2 } = twoPlayers();
    const rhino = creature(game, p1.id, "Rhino", 5, 5, ["trample"]);
    const chump = creature(game, p2.id, "Goat", 0, 1);
    let next = passTo(game, "declareAttackers");
    next = applyAction(next, {
      kind: "declare_attackers",
      playerId: p1.id,
      attacks: [{ attackerId: rhino.id, defenderId: p2.id }],
    });
    next = passN(next, 2);
    next = applyAction(next, {
      kind: "declare_blockers",
      playerId: p2.id,
      blocks: [{ blockerId: chump.id, attackerId: rhino.id }],
    });
    next = passN(next, 2);
    expect(next.cards[chump.id]?.zone).toBe("graveyard");
    expect(next.players[1]?.life).toBe(36);
  });

  it("uses first strike before normal damage and double strike on both passes", () => {
    const { game, p1, p2 } = twoPlayers();
    const first = creature(game, p1.id, "Knight", 2, 2, ["first_strike"]);
    const blocker = creature(game, p2.id, "Bear", 2, 2);
    let next = passTo(game, "declareAttackers");
    next = applyAction(next, {
      kind: "declare_attackers",
      playerId: p1.id,
      attacks: [{ attackerId: first.id, defenderId: p2.id }],
    });
    next = passN(next, 2);
    next = applyAction(next, {
      kind: "declare_blockers",
      playerId: p2.id,
      blocks: [{ blockerId: blocker.id, attackerId: first.id }],
    });
    next = passN(next, 2);
    expect(next.cards[blocker.id]?.zone).toBe("graveyard");
    expect(next.cards[first.id]?.zone).toBe("battlefield");
    expect(next.cards[first.id]?.damageMarked).toBe(0);
  });

  it("gains life from lifelink combat damage", () => {
    const { game, p1, p2 } = twoPlayers();
    const angel = creature(game, p1.id, "Angel", 3, 3, ["lifelink"]);
    let next = passTo(game, "declareAttackers");
    next = applyAction(next, {
      kind: "declare_attackers",
      playerId: p1.id,
      attacks: [{ attackerId: angel.id, defenderId: p2.id }],
    });
    next = passTo(next, "combatDamage");
    expect(next.players[1]?.life).toBe(37);
    expect(next.players[0]?.life).toBe(43);
  });

  it("keeps indestructible creatures from dying to lethal damage", () => {
    const { game, p1 } = twoPlayers();
    const darksteel = creature(game, p1.id, "Darksteel", 1, 1, ["indestructible"]);
    const next = applyEffect(game, {
      kind: "deal_damage",
      sourceId: null,
      target: { type: "creature", cardId: darksteel.id },
      amount: 5,
    });
    expect(next.cards[darksteel.id]?.zone).toBe("battlefield");
    expect(next.cards[darksteel.id]?.damageMarked).toBe(5);
  });

  it("blocks hexproof creatures from opponent targeting and lets flash cast on an opponent turn", () => {
    const { game, p1, p2 } = twoPlayers();
    const hexed = creature(game, p2.id, "Hexed", 2, 2, ["hexproof"]);
    const shockDef = testShock();
    const shock = createCardInstance({ definitionId: shockDef.id, ownerId: p1.id, zone: "hand" });
    game.definitions[shockDef.id] = shockDef;
    game.cards[shock.id] = shock;
    p1.zones.hand.push(shock.id);
    p1.mana.R = 1;

    let next = passTo(game, "precombatMain");
    next.players[0]!.mana.R = 1;
    const original = structuredClone(next);
    expect(() =>
      applyAction(next, {
        kind: "cast_spell",
        playerId: p1.id,
        cardId: shock.id,
        targets: [{ type: "creature", cardId: hexed.id }],
      }),
    ).toThrow(/Illegal target/);
    expect(next).toEqual(original);

    const flashDef = createCardDefinition({
      name: "Flash Bear",
      typeLine: "Creature — Bear",
      manaCost: "{0}",
      power: 2,
      toughness: 2,
      keywords: ["flash"],
    });
    const flashCard = createCardInstance({
      definitionId: flashDef.id,
      ownerId: p2.id,
      zone: "hand",
    });
    next.definitions[flashDef.id] = flashDef;
    next.cards[flashCard.id] = flashCard;
    next.players[1]?.zones.hand.push(flashCard.id);
    next = applyAction(next, { kind: "pass_priority", playerId: p1.id });
    expect(next.priorityPlayerId).toBe(p2.id);
    const stacked = applyAction(next, {
      kind: "cast_spell",
      playerId: p2.id,
      cardId: flashCard.id,
    });
    expect(stacked.stack[0]?.sourceId).toBe(flashCard.id);
  });
});
