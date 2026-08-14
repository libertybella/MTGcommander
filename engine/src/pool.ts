import { createCardDefinition } from "./createGame";
import type { CardDefinition } from "./types";

/** Stable definition IDs for the synthetic 20-card pool. Not real Magic cards. */
export const POOL_ID = {
  plains: "def-test-plains",
  island: "def-test-island",
  swamp: "def-test-swamp",
  mountain: "def-test-mountain",
  forest: "def-test-forest",
  dragon: "def-test-dragon",
  bear: "def-test-bear",
  knight: "def-test-knight",
  angel: "def-test-angel",
  wall: "def-test-wall",
  cleric: "def-test-cleric",
  lord: "def-test-lord",
  shock: "def-test-shock",
  gift: "def-test-gift",
  drain: "def-test-drain",
  study: "def-test-study",
  ritual: "def-test-ritual",
  recruit: "def-test-recruit",
  terror: "def-test-terror",
  mill: "def-test-mill",
  counter: "def-test-counter",
} as const;

export function syntheticPool(): CardDefinition[] {
  return [
    createCardDefinition({
      id: POOL_ID.plains,
      name: "Test Plains",
      typeLine: "Basic Land — Plains",
      oracleText: "{T}: Add {W}.",
      produces: { W: 1 },
    }),
    createCardDefinition({
      id: POOL_ID.island,
      name: "Test Island",
      typeLine: "Basic Land — Island",
      oracleText: "{T}: Add {U}.",
      produces: { U: 1 },
    }),
    createCardDefinition({
      id: POOL_ID.swamp,
      name: "Test Swamp",
      typeLine: "Basic Land — Swamp",
      oracleText: "{T}: Add {B}.",
      produces: { B: 1 },
    }),
    createCardDefinition({
      id: POOL_ID.mountain,
      name: "Test Mountain",
      typeLine: "Basic Land — Mountain",
      oracleText: "{T}: Add {R}.",
      produces: { R: 1 },
    }),
    createCardDefinition({
      id: POOL_ID.forest,
      name: "Test Forest",
      typeLine: "Basic Land — Forest",
      oracleText: "{T}: Add {G}.",
      produces: { G: 1 },
    }),
    createCardDefinition({
      id: POOL_ID.dragon,
      name: "Test Dragon",
      typeLine: "Legendary Creature — Dragon",
      manaCost: "{3}{R}{G}",
      oracleText: "Flying, trample",
      power: 5,
      toughness: 5,
      keywords: ["flying", "trample"],
    }),
    createCardDefinition({
      id: POOL_ID.bear,
      name: "Test Bear",
      typeLine: "Creature — Bear",
      manaCost: "{1}{G}",
      power: 2,
      toughness: 2,
    }),
    createCardDefinition({
      id: POOL_ID.knight,
      name: "Test Knight",
      typeLine: "Creature — Knight",
      manaCost: "{1}{W}",
      oracleText: "First strike",
      power: 2,
      toughness: 2,
      keywords: ["first_strike"],
    }),
    createCardDefinition({
      id: POOL_ID.angel,
      name: "Test Angel",
      typeLine: "Creature — Angel",
      manaCost: "{3}{W}",
      oracleText: "Flying, lifelink",
      power: 3,
      toughness: 3,
      keywords: ["flying", "lifelink"],
    }),
    createCardDefinition({
      id: POOL_ID.wall,
      name: "Test Wall",
      typeLine: "Creature — Wall",
      manaCost: "{1}{W}",
      oracleText: "Defender",
      power: 0,
      toughness: 4,
      keywords: ["defender"],
    }),
    createCardDefinition({
      id: POOL_ID.cleric,
      name: "Test Cleric",
      typeLine: "Creature — Cleric",
      manaCost: "{W}",
      oracleText: "When this enters, you gain 3 life.",
      power: 1,
      toughness: 1,
      triggers: [
        {
          event: "enter_battlefield",
          effects: [{ kind: "gain_life", playerId: "controller", amount: 3 }],
        },
      ],
    }),
    createCardDefinition({
      id: POOL_ID.lord,
      name: "Test Lord",
      typeLine: "Creature — Soldier",
      manaCost: "{2}{W}",
      oracleText: "Creatures you control get +1/+1.",
      power: 2,
      toughness: 2,
      staticModifiers: [{ kind: "pt", selector: "controlled_creatures", power: 1, toughness: 1 }],
    }),
    createCardDefinition({
      id: POOL_ID.shock,
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
    }),
    createCardDefinition({
      id: POOL_ID.gift,
      name: "Test Gift",
      typeLine: "Instant",
      manaCost: "{W}",
      effects: [{ kind: "gain_life", playerId: "controller", amount: 3 }],
    }),
    createCardDefinition({
      id: POOL_ID.drain,
      name: "Test Drain",
      typeLine: "Sorcery",
      manaCost: "{B}",
      effects: [{ kind: "lose_life", playerId: "next_opponent", amount: 2 }],
    }),
    createCardDefinition({
      id: POOL_ID.study,
      name: "Test Study",
      typeLine: "Instant",
      manaCost: "{U}",
      effects: [{ kind: "draw", playerId: "controller", count: 1 }],
    }),
    createCardDefinition({
      id: POOL_ID.ritual,
      name: "Test Ritual",
      typeLine: "Instant",
      manaCost: "{R}",
      effects: [{ kind: "add_mana", playerId: "controller", mana: { R: 2 } }],
    }),
    createCardDefinition({
      id: POOL_ID.recruit,
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
    }),
    createCardDefinition({
      id: POOL_ID.terror,
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
    }),
    createCardDefinition({
      id: POOL_ID.mill,
      name: "Test Mill",
      typeLine: "Sorcery",
      manaCost: "{U}",
      oracleText: "Target player mills two cards.",
      effects: [{ kind: "mill", playerId: "next_opponent", count: 2 }],
    }),
    createCardDefinition({
      id: POOL_ID.counter,
      name: "Test Counter",
      typeLine: "Instant",
      manaCost: "{U}{U}",
      oracleText: "Counter target spell.",
      targetRequirements: [{ kind: "spell" }],
      effects: [{ kind: "counter_spell", target: { type: "chosen", index: 0 } }],
    }),
  ];
}

export function syntheticPoolById(): Record<string, CardDefinition> {
  const byId: Record<string, CardDefinition> = {};
  for (const definition of syntheticPool()) {
    byId[definition.id] = definition;
  }
  return byId;
}
