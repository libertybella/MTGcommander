import { createCardDefinition } from "./createGame";
import type { CardDefinition } from "./types";

/** Synthetic cards for proving definition-driven effect execution. Not real Magic cards. */
export function testShock(): CardDefinition {
  return createCardDefinition({
    name: "Test Shock",
    typeLine: "Instant",
    manaCost: "{R}",
    oracleText: "Deal 2 damage to any target.",
    targetRequirements: [{ kind: "player_or_creature" }],
    effects: [
      {
        kind: "deal_damage",
        sourceId: "self",
        target: { type: "chosen", index: 0 },
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

/** Synthetic destroy-target-creature spell for targeting tests. */
export function testTerror(): CardDefinition {
  return createCardDefinition({
    name: "Test Terror",
    typeLine: "Instant",
    manaCost: "{B}",
    oracleText: "Destroy target creature.",
    targetRequirements: [{ kind: "creature" }],
    effects: [
      {
        kind: "move_card",
        cardId: { type: "chosen", index: 0 },
        toZone: "graveyard",
      },
    ],
  });
}

/** Synthetic basic land for land-play tests. Not a real-card database entry. */
export function testForest(): CardDefinition {
  return createCardDefinition({
    name: "Test Forest",
    typeLine: "Basic Land — Forest",
    oracleText: "{T}: Add {G}.",
  });
}
