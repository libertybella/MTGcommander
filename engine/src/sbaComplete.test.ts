import { describe, expect, it } from "vitest";
import { applyEffect, applyEffects } from "./effects";
import { compileOracleCard } from "./oracle";
import { createCardDefinition } from "./createGame";
import { hasKeyword } from "./keywords";
import { resolveTopOfStack } from "./stack";
import { scenario } from "./scenario";
import type { CardDefinition, GameState } from "./types";

function bear(name = "Test Bear", power = 2, toughness = 2): CardDefinition {
  return createCardDefinition({ name, typeLine: "Creature — Bear", power, toughness });
}

function legend(name: string): CardDefinition {
  return createCardDefinition({
    name,
    typeLine: "Legendary Creature — Dragon",
    power: 4,
    toughness: 4,
  });
}

function restInPeace(): CardDefinition {
  const compiled = compileOracleCard({
    oracleId: "rip",
    name: "Rest in Peace",
    manaCost: "{1}{W}",
    typeLine: "Enchantment",
    oracleText:
      "If a card or token would be put into a graveyard from anywhere, exile it instead.",
    power: null,
    toughness: null,
    printedKeywords: [],
  });
  expect(compiled.notes).toEqual([]);
  return compiled.definition;
}

function lifeOf(state: GameState, playerId: string): number {
  return state.players.find((player) => player.id === playerId)!.life;
}

describe("[CR 704] completed state-based actions", () => {
  it("[704.5g] lethal damage destroys during the SBA sweep, honoring pumps", () => {
    const s = scenario();
    const me = s.players[0]!;
    const target = s.add(bear(), me, "battlefield");
    const damaged = applyEffect(s.game, {
      kind: "deal_damage",
      sourceId: null,
      target: { type: "creature", cardId: target },
      amount: 2,
    });
    expect(damaged.cards[target]?.zone).toBe("graveyard");
  });

  it("a pump can save a creature from marked damage", () => {
    const s = scenario();
    const me = s.players[0]!;
    const target = s.add(bear(), me, "battlefield");
    // Pump first, then damage for the printed toughness: survives at 2 marked / 5 toughness.
    const pumped = applyEffects(s.game, [
      { kind: "pt_until_eot", cardId: target, power: 3, toughness: 3 },
      { kind: "deal_damage", sourceId: null, target: { type: "creature", cardId: target }, amount: 2 },
    ]);
    expect(pumped.cards[target]?.zone).toBe("battlefield");
  });

  it("[704.5h] any deathtouch damage destroys", () => {
    const s = scenario();
    const [me, opponent] = s.players as [string, string];
    const assassin = s.add(
      createCardDefinition({
        name: "Test Assassin",
        typeLine: "Creature — Human Assassin",
        power: 1,
        toughness: 1,
        keywords: ["deathtouch"],
      }),
      me,
      "battlefield",
    );
    const giant = s.add(bear("Test Giant", 8, 8), opponent, "battlefield");
    const after = applyEffect(s.game, {
      kind: "deal_damage",
      sourceId: assassin,
      target: { type: "creature", cardId: giant },
      amount: 1,
    });
    expect(after.cards[giant]?.zone).toBe("graveyard");
  });

  it("[704.5j] the legend rule keeps the newest copy", () => {
    const s = scenario();
    const me = s.players[0]!;
    const older = s.add(legend("Test Dragonlord"), me, "battlefield");
    s.game.cards[older]!.timestamp = 1;
    const newer = s.add(legend("Test Dragonlord"), me, "battlefield");
    s.game.cards[newer]!.timestamp = 2;
    const after = applyEffect(s.game, { kind: "gain_life", playerId: me, amount: 1 });
    expect(after.cards[older]?.zone).toBe("graveyard");
    expect(after.cards[newer]?.zone).toBe("battlefield");
  });

  it("different controllers keep their own copies of a legend", () => {
    const s = scenario();
    const [me, opponent] = s.players as [string, string];
    const mine = s.add(legend("Test Dragonlord"), me, "battlefield");
    const theirs = s.add(legend("Test Dragonlord"), opponent, "battlefield");
    const after = applyEffect(s.game, { kind: "gain_life", playerId: me, amount: 1 });
    expect(after.cards[mine]?.zone).toBe("battlefield");
    expect(after.cards[theirs]?.zone).toBe("battlefield");
  });

  it("[704.5d] a token that dies ceases to exist after its dies-trigger fires", () => {
    const s = scenario();
    const [me, opponent] = s.players as [string, string];
    s.add(
      createCardDefinition({
        name: "Test Blood Artist",
        typeLine: "Creature — Vampire",
        power: 0,
        toughness: 1,
        triggers: [
          {
            event: "dies",
            watch: "any",
            subjectFilter: { types: ["creature"] },
            effects: [{ kind: "lose_life", playerId: "next_opponent", amount: 1 }],
          },
        ],
      }),
      me,
      "battlefield",
    );
    let state = applyEffect(s.game, {
      kind: "create_token",
      ownerId: me,
      name: "Test Soldier",
      typeLine: "Creature — Soldier Token",
      power: 1,
      toughness: 1,
    });
    const token = Object.values(state.cards).find((card) => card.isToken)!;
    state = applyEffect(state, {
      kind: "deal_damage",
      sourceId: null,
      target: { type: "creature", cardId: token.id },
      amount: 1,
    });
    // Dies trigger queued before the token ceased.
    expect(state.stack).toHaveLength(1);
    state = resolveTopOfStack(state);
    expect(lifeOf(state, opponent)).toBe(39);
    expect(state.cards[token.id]?.zone).toBe("removed");
  });

  it("[CR 614.6] Rest in Peace exiles instead, and dies triggers never fire", () => {
    const s = scenario();
    const [me, opponent] = s.players as [string, string];
    void opponent;
    s.add(restInPeace(), me, "battlefield");
    s.add(
      createCardDefinition({
        name: "Test Blood Artist",
        typeLine: "Creature — Vampire",
        power: 0,
        toughness: 1,
        triggers: [
          {
            event: "dies",
            watch: "any",
            subjectFilter: { types: ["creature"] },
            effects: [{ kind: "lose_life", playerId: "next_opponent", amount: 1 }],
          },
        ],
      }),
      me,
      "battlefield",
    );
    const victim = s.add(bear(), me, "battlefield");
    const after = applyEffect(s.game, {
      kind: "deal_damage",
      sourceId: null,
      target: { type: "creature", cardId: victim },
      amount: 2,
    });
    expect(after.cards[victim]?.zone).toBe("exile");
    expect(after.stack).toHaveLength(0);
    expect(lifeOf(after, s.players[1]!)).toBe(40);
  });

  it("Humility silences Rest in Peace only if RIP is a creature (it is not)", () => {
    const s = scenario();
    const me = s.players[0]!;
    s.add(restInPeace(), me, "battlefield");
    const humility = createCardDefinition({
      name: "Test Humility",
      typeLine: "Enchantment",
      staticAbilities: [
        { selector: { scope: "all", types: ["creature"] }, effect: { kind: "remove_all_abilities" } },
        { selector: { scope: "all", types: ["creature"] }, effect: { kind: "set_pt", power: 1, toughness: 1 } },
      ],
    });
    s.add(humility, me, "battlefield");
    const victim = s.add(bear(), me, "battlefield");
    const after = applyEffect(s.game, {
      kind: "deal_damage",
      sourceId: null,
      target: { type: "creature", cardId: victim },
      amount: 5,
    });
    expect(after.cards[victim]?.zone).toBe("exile");
  });

  it("granted deathtouch works through the until-end-of-turn effect", () => {
    const s = scenario();
    const [me, opponent] = s.players as [string, string];
    const sniper = s.add(bear("Test Sniper", 1, 1), me, "battlefield");
    const giant = s.add(bear("Test Giant", 8, 8), opponent, "battlefield");
    const after = applyEffects(s.game, [
      { kind: "keyword_until_eot", cardId: sniper, keyword: "deathtouch" },
      { kind: "deal_damage", sourceId: sniper, target: { type: "creature", cardId: giant }, amount: 1 },
    ]);
    expect(hasKeyword(after, sniper, "deathtouch")).toBe(true);
    expect(after.cards[giant]?.zone).toBe("graveyard");
  });
});
