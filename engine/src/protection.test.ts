import { describe, expect, it } from "vitest";
import { applyAction } from "./actions";
import { blockRestriction } from "./combat";
import { compileOracleCard } from "./oracle";
import { applyEffect } from "./effects";
import { createCardDefinition } from "./createGame";
import { scenario } from "./scenario";
import type { CardDefinition } from "./types";

function paladin(): CardDefinition {
  const compiled = compileOracleCard({
    oracleId: "paladin",
    name: "Test Paladin",
    manaCost: "{W}{W}",
    typeLine: "Creature — Human Knight",
    oracleText: "Protection from red and from black",
    power: "2",
    toughness: "2",
    printedKeywords: [],
  });
  expect(compiled.notes).toEqual([]);
  expect(compiled.definition.protectionFrom).toEqual(["R", "B"]);
  return compiled.definition;
}

describe("[CR 702.16] protection from colors", () => {
  it("cannot be targeted by spells of the protected color", () => {
    const s = scenario();
    const [me, opponent] = s.players as [string, string];
    s.mainPhase(opponent);
    s.game.priorityPlayerId = opponent;
    const knight = s.add(paladin(), me, "battlefield");
    const boltDef = createCardDefinition({
      name: "Test Bolt",
      typeLine: "Instant",
      manaCost: "",
      colors: ["R"],
      targetRequirements: [{ kind: "creature" }],
      effects: [
        { kind: "deal_damage", sourceId: "self", target: { type: "chosen", index: 0 }, amount: 3 },
      ],
    });
    const bolt = s.add(boltDef, opponent, "hand");
    expect(() =>
      applyAction(s.game, {
        kind: "cast_spell",
        playerId: opponent,
        cardId: bolt,
        targets: [{ type: "creature", cardId: knight }],
      }),
    ).toThrow(/Illegal target/);
  });

  it("can still be targeted by spells of other colors", () => {
    const s = scenario();
    const [me, opponent] = s.players as [string, string];
    s.mainPhase(opponent);
    s.game.priorityPlayerId = opponent;
    const knight = s.add(paladin(), me, "battlefield");
    const blueDef = createCardDefinition({
      name: "Test Unsummon",
      typeLine: "Instant",
      manaCost: "",
      colors: ["U"],
      targetRequirements: [{ kind: "creature" }],
      effects: [{ kind: "move_card", cardId: { type: "chosen", index: 0 }, toZone: "hand" }],
    });
    const unsummon = s.add(blueDef, opponent, "hand");
    const state = applyAction(s.game, {
      kind: "cast_spell",
      playerId: opponent,
      cardId: unsummon,
      targets: [{ type: "creature", cardId: knight }],
    });
    expect(state.stack).toHaveLength(1);
  });

  it("prevents damage from sources of the protected color", () => {
    const s = scenario();
    const [me, opponent] = s.players as [string, string];
    const knight = s.add(paladin(), me, "battlefield");
    const dragon = s.add(
      createCardDefinition({
        name: "Test Dragon",
        typeLine: "Creature — Dragon",
        manaCost: "{3}{R}{R}",
        power: 5,
        toughness: 5,
      }),
      opponent,
      "battlefield",
    );
    const after = applyEffect(s.game, {
      kind: "deal_damage",
      sourceId: dragon,
      target: { type: "creature", cardId: knight },
      amount: 5,
    });
    expect(after.cards[knight]?.zone).toBe("battlefield");
    expect(after.cards[knight]?.damageMarked).toBe(0);
  });

  it("cannot be blocked by creatures of the protected color", () => {
    const s = scenario();
    const [me, opponent] = s.players as [string, string];
    const knight = s.add(paladin(), me, "battlefield");
    const redBlocker = s.add(
      createCardDefinition({
        name: "Test Goblin",
        typeLine: "Creature — Goblin",
        manaCost: "{R}",
        power: 1,
        toughness: 1,
      }),
      opponent,
      "battlefield",
    );
    expect(blockRestriction(s.game, knight, redBlocker)).toMatch(/protection/);
    const whiteBlocker = s.add(
      createCardDefinition({
        name: "Test Soldier",
        typeLine: "Creature — Soldier",
        manaCost: "{W}",
        power: 1,
        toughness: 1,
      }),
      opponent,
      "battlefield",
    );
    expect(blockRestriction(s.game, knight, whiteBlocker)).toBeNull();
  });
});
