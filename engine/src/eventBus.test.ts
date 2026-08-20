import { describe, expect, it } from "vitest";
import { applyAction } from "./actions";
import { compileOracleCard } from "./oracle";
import { applyEffect, applyEffects } from "./effects";
import { createCardDefinition } from "./createGame";
import { resolveTopOfStack } from "./stack";
import { advanceStep } from "./turn";
import { scenario } from "./scenario";
import { fillLibraries } from "./testSupport";
import type { CardDefinition, GameState } from "./types";

function bloodArtist(): CardDefinition {
  return createCardDefinition({
    name: "Test Blood Artist",
    typeLine: "Creature — Vampire",
    power: 0,
    toughness: 1,
    triggers: [
      {
        event: "dies",
        watch: "any",
        subjectFilter: { types: ["creature"] },
        effects: [
          { kind: "lose_life", playerId: "next_opponent", amount: 1 },
          { kind: "gain_life", playerId: "controller", amount: 1 },
        ],
      },
    ],
  });
}

function bear(name = "Test Bear"): CardDefinition {
  return createCardDefinition({ name, typeLine: "Creature — Bear", power: 2, toughness: 2 });
}

function lifeOf(state: GameState, playerId: string): number {
  return state.players.find((player) => player.id === playerId)!.life;
}

function resolveAllTriggers(state: GameState): GameState {
  let current = state;
  let guard = 0;
  while (current.stack.length > 0 && guard < 20) {
    current = resolveTopOfStack(current);
    guard += 1;
  }
  return current;
}

describe("Stage 3: the event bus", () => {
  it("Blood Artist drains when any creature dies, including its own death", () => {
    const s = scenario();
    const [me, opponent] = s.players as [string, string];
    const artist = s.add(bloodArtist(), me, "battlefield");
    const victim = s.add(bear(), opponent, "battlefield");

    const afterBearDies = resolveAllTriggers(
      applyEffect(s.game, { kind: "move_card", cardId: victim, toZone: "graveyard" }),
    );
    expect(lifeOf(afterBearDies, me)).toBe(41);
    expect(lifeOf(afterBearDies, opponent)).toBe(39);

    const afterArtistDies = resolveAllTriggers(
      applyEffect(afterBearDies, { kind: "move_card", cardId: artist, toZone: "graveyard" }),
    );
    expect(lifeOf(afterArtistDies, me)).toBe(42);
    expect(lifeOf(afterArtistDies, opponent)).toBe(38);
  });

  it("a board wipe queues one drain per death in a single APNAP batch", () => {
    const s = scenario();
    const [me, opponent] = s.players as [string, string];
    s.add(bloodArtist(), me, "battlefield");
    const first = s.add(bear("Test Bear One"), opponent, "battlefield");
    const second = s.add(bear("Test Bear Two"), opponent, "battlefield");
    const after = resolveAllTriggers(
      applyEffects(s.game, [
        { kind: "move_card", cardId: first, toZone: "graveyard" },
        { kind: "move_card", cardId: second, toZone: "graveyard" },
      ]),
    );
    expect(lifeOf(after, me)).toBe(42);
    expect(lifeOf(after, opponent)).toBe(38);
  });

  it("Soul Warden hears other creatures entering, not itself", () => {
    const s = scenario();
    const me = s.players[0]!;
    const warden = createCardDefinition({
      name: "Test Soul Warden",
      typeLine: "Creature — Human Cleric",
      power: 1,
      toughness: 1,
      triggers: [
        {
          event: "enter_battlefield",
          watch: "any",
          excludeSelf: true,
          subjectFilter: { types: ["creature"] },
          effects: [{ kind: "gain_life", playerId: "controller", amount: 1 }],
        },
      ],
    });
    s.add(warden, me, "battlefield");
    const after = resolveAllTriggers(
      applyEffect(s.game, {
        kind: "create_token",
        ownerId: me,
        name: "Test Soldier",
        typeLine: "Creature — Soldier Token",
        power: 1,
        toughness: 1,
      }),
    );
    expect(lifeOf(after, me)).toBe(41);
  });

  it("an upkeep trigger fires at the beginning of its controller's upkeep only", () => {
    const s = scenario();
    const me = s.players[0]!;
    fillLibraries(s.game);
    const shrine = createCardDefinition({
      name: "Test Shrine",
      typeLine: "Enchantment",
      triggers: [
        {
          event: "upkeep",
          effects: [{ kind: "gain_life", playerId: "controller", amount: 1 }],
        },
      ],
    });
    s.add(shrine, me, "battlefield");
    // My turn: untap → upkeep queues the trigger.
    const atUpkeep = advanceStep(s.game);
    expect(atUpkeep.turn.step).toBe("upkeep");
    expect(atUpkeep.stack).toHaveLength(1);
    const resolved = resolveAllTriggers(atUpkeep);
    expect(lifeOf(resolved, me)).toBe(41);
  });

  it("an attack trigger fires when the creature attacks (compiled amass half)", () => {
    const compiled = compileOracleCard({
      oracleId: "march-gate",
      name: "Test Gate Captain",
      manaCost: "{2}{B}",
      typeLine: "Creature — Orc Soldier",
      oracleText: "Whenever Test Gate Captain attacks, amass Orcs 1.",
      power: 2,
      toughness: 2,
      printedKeywords: [],
    } as never);
    expect(compiled.notes).toEqual([]);
    expect(compiled.definition.triggers[0]).toMatchObject({ event: "attacks" });

    const s = scenario();
    const [me, opponent] = s.players as [string, string];
    fillLibraries(s.game);
    const captain = s.add(compiled.definition, me, "battlefield");
    s.game.turn.activePlayerId = me;
    s.game.turn.phase = "combat";
    s.game.turn.step = "declareAttackers";
    s.game.priorityPlayerId = me;
    const declared = applyAction(s.game, {
      kind: "declare_attackers",
      playerId: me,
      attacks: [{ attackerId: captain, defenderId: opponent }],
    });
    expect(declared.stack).toHaveLength(1);
    const resolved = resolveAllTriggers(declared);
    const army = Object.values(resolved.cards).find((card) =>
      resolved.definitions[card.definitionId]?.characteristics.subtypes.includes("army"),
    );
    expect(army).toBeTruthy();
    expect(army?.counters["p1p1"]).toBe(1);
  });

  it("compiles Blood Artist's actual templating", () => {
    const compiled = compileOracleCard({
      oracleId: "blood-artist",
      name: "Blood Artist",
      manaCost: "{B}{1}",
      typeLine: "Creature — Vampire",
      oracleText:
        "Whenever Blood Artist or another creature dies, target player loses 1 life and you gain 1 life.",
      power: 0,
      toughness: 1,
      printedKeywords: [],
    } as never);
    const trigger = compiled.definition.triggers[0];
    expect(trigger).toMatchObject({ event: "dies", watch: "any" });
  });
});
