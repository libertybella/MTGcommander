import { describe, expect, it } from "vitest";
import { applyAction } from "./actions";
import { compileOracleCard } from "./oracle";
import { createCardDefinition } from "./createGame";
import { scenario } from "./scenario";
import type { CardDefinition } from "./types";

function heartlessAct(): CardDefinition {
  const compiled = compileOracleCard({
    oracleId: "heartless",
    name: "Test Heartless Act",
    manaCost: "{1}{B}",
    typeLine: "Instant",
    oracleText:
      "Choose one —\n• Destroy target creature.\n• Target player draws two cards.",
    power: null,
    toughness: null,
    printedKeywords: [],
  });
  expect(compiled.notes).toEqual([]);
  return compiled.definition;
}

describe("[CR 700.2] modal spells", () => {
  it("compiles a Choose one block into modes", () => {
    const definition = heartlessAct();
    expect(definition.modes).toHaveLength(2);
    expect(definition.modes?.[0]).toMatchObject({
      label: "Destroy target creature",
      targetRequirements: [{ kind: "creature" }],
    });
    expect(definition.modes?.[1]).toMatchObject({
      targetRequirements: [{ kind: "player" }],
    });
    expect(definition.effects).toEqual([]);
  });

  it("casting requires a mode and resolves only the chosen one", () => {
    const s = scenario();
    const [me, opponent] = s.players as [string, string];
    s.mainPhase(me);
    const bear = s.add(
      createCardDefinition({ name: "Test Bear", typeLine: "Creature — Bear", power: 2, toughness: 2 }),
      opponent,
      "battlefield",
    );
    const spellDef = { ...heartlessAct(), manaCost: "" };
    const spell = s.add(createCardDefinition({ ...spellDef, id: undefined as never }), me, "hand");
    expect(() =>
      applyAction(s.game, { kind: "cast_spell", playerId: me, cardId: spell }),
    ).toThrow(/Choose a mode/);

    let state = applyAction(s.game, {
      kind: "cast_spell",
      playerId: me,
      cardId: spell,
      modeIndex: 0,
      targets: [{ type: "creature", cardId: bear }],
    });
    state = applyAction(state, { kind: "pass_priority", playerId: me });
    state = applyAction(state, { kind: "pass_priority", playerId: opponent });
    expect(state.cards[bear]?.zone).toBe("graveyard");
    // The other mode's draw did not happen.
    expect(state.players[1]!.zones.hand).toHaveLength(0);
  });

  it("rejects targets that fit the other mode", () => {
    const s = scenario();
    const [me, opponent] = s.players as [string, string];
    s.mainPhase(me);
    const spellDef = { ...heartlessAct(), manaCost: "" };
    const spell = s.add(createCardDefinition({ ...spellDef, id: undefined as never }), me, "hand");
    expect(() =>
      applyAction(s.game, {
        kind: "cast_spell",
        playerId: me,
        cardId: spell,
        modeIndex: 0,
        targets: [{ type: "player", playerId: opponent }],
      }),
    ).toThrow();
  });
});
