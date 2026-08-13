import { createCardDefinition } from "./createGame";
import type { CardDefinition } from "./types";

/** Synthetic cards for proving definition-driven effect execution. Not real Magic cards. */
export function testShock(): CardDefinition {
  return createCardDefinition({
    name: "Test Shock",
    typeLine: "Instant",
    manaCost: "{R}",
    oracleText: "Deal 2 damage to the next opponent. Not a targeting system.",
    effects: [
      {
        kind: "deal_damage",
        sourceId: "self",
        target: { type: "player", playerId: "next_opponent" },
        amount: 2,
      },
    ],
  });
}

export function testGift(): CardDefinition {
  return createCardDefinition({
    name: "Test Gift",
    typeLine: "Instant",
    manaCost: "{W}",
    effects: [{ kind: "gain_life", playerId: "controller", amount: 3 }],
  });
}

export function testDrain(): CardDefinition {
  return createCardDefinition({
    name: "Test Drain",
    typeLine: "Sorcery",
    manaCost: "{B}",
    effects: [{ kind: "lose_life", playerId: "controller", amount: 2 }],
  });
}

export function testStudy(): CardDefinition {
  return createCardDefinition({
    name: "Test Study",
    typeLine: "Instant",
    manaCost: "{U}",
    effects: [{ kind: "draw", playerId: "controller", count: 1 }],
  });
}

export function testRitual(): CardDefinition {
  return createCardDefinition({
    name: "Test Ritual",
    typeLine: "Instant",
    manaCost: "{R}",
    effects: [{ kind: "add_mana", playerId: "controller", mana: { R: 2 } }],
  });
}

export function testRecruit(): CardDefinition {
  return createCardDefinition({
    name: "Test Recruit",
    typeLine: "Sorcery",
    manaCost: "{W}",
    effects: [
      {
        kind: "create_token",
        ownerId: "controller",
        name: "Test Soldier",
        typeLine: "Creature — Soldier Token",
        power: 1,
        toughness: 1,
      },
    ],
  });
}

export function testBear(): CardDefinition {
  return createCardDefinition({
    name: "Test Bear",
    typeLine: "Creature — Bear",
    manaCost: "{1}{G}",
    power: 2,
    toughness: 2,
  });
}

export function testBlankInstant(): CardDefinition {
  return createCardDefinition({
    name: "Test Blank",
    typeLine: "Instant",
    manaCost: "{0}",
  });
}
