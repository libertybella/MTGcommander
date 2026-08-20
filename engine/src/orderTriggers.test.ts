import { describe, expect, it } from "vitest";
import { applyAction } from "./actions";
import { createCardDefinition } from "./createGame";
import { currentPrompt } from "./prompt";
import { scenario } from "./scenario";
import { queueSimultaneousTriggersInPlace } from "./triggers";
import type { CardDefinition } from "./types";

function beginCombatTrigger(name: string, amount: number): CardDefinition {
  return createCardDefinition({
    name,
    typeLine: "Creature — Soldier",
    power: 1,
    toughness: 1,
    triggers: [
      {
        event: "begin_combat",
        effects: [{ kind: "gain_life", playerId: "controller", amount }],
      },
    ],
  });
}

describe("[CR 603.3b] simultaneous trigger ordering", () => {
  it("asks the controller to order two simultaneous triggers", () => {
    const s = scenario();
    const me = s.players[0]!;
    s.mainPhase(me);
    const first = s.add(beginCombatTrigger("Test Trumpeter", 1), me, "battlefield");
    const second = s.add(beginCombatTrigger("Test Herald", 2), me, "battlefield");
    queueSimultaneousTriggersInPlace(s.game, [
      { cardId: first, triggerIndex: 0 },
      { cardId: second, triggerIndex: 0 },
    ]);
    const prompt = currentPrompt(s.game);
    expect(prompt).toMatchObject({ kind: "order_triggers", playerId: me });
    expect(prompt?.kind === "order_triggers" && prompt.entries).toHaveLength(2);
  });

  it("stacks the chosen order so the last-ordered trigger resolves first", () => {
    const s = scenario();
    const me = s.players[0]!;
    s.mainPhase(me);
    const first = s.add(beginCombatTrigger("Test Trumpeter", 1), me, "battlefield");
    const second = s.add(beginCombatTrigger("Test Herald", 2), me, "battlefield");
    queueSimultaneousTriggersInPlace(s.game, [
      { cardId: first, triggerIndex: 0 },
      { cardId: second, triggerIndex: 0 },
    ]);
    const chosen = applyAction(s.game, {
      kind: "resolve_order_triggers",
      playerId: me,
      order: [1, 0],
    });
    expect(chosen.stack.map((entry) => entry.sourceId)).toEqual([second, first]);
    expect(currentPrompt(chosen)).toBeNull();
  });

  it("rejects an order that is not a permutation", () => {
    const s = scenario();
    const me = s.players[0]!;
    s.mainPhase(me);
    const first = s.add(beginCombatTrigger("Test Trumpeter", 1), me, "battlefield");
    const second = s.add(beginCombatTrigger("Test Herald", 2), me, "battlefield");
    queueSimultaneousTriggersInPlace(s.game, [
      { cardId: first, triggerIndex: 0 },
      { cardId: second, triggerIndex: 0 },
    ]);
    expect(() =>
      applyAction(s.game, { kind: "resolve_order_triggers", playerId: me, order: [0, 0] }),
    ).toThrow(/exactly once/);
  });

  it("[CR 101.4] puts the active player's triggers on the stack before a non-active player's", () => {
    const s = scenario();
    const active = s.players[0]!;
    const other = s.players[1]!;
    s.mainPhase(active);
    const mine = s.add(beginCombatTrigger("Test Trumpeter", 1), active, "battlefield");
    const theirs = s.add(beginCombatTrigger("Test Herald", 2), other, "battlefield");
    queueSimultaneousTriggersInPlace(s.game, [
      { cardId: theirs, triggerIndex: 0 },
      { cardId: mine, triggerIndex: 0 },
    ]);
    // Single triggers per controller: no prompt, APNAP order on the stack —
    // active player's first (bottom), so the NAP's resolves first.
    expect(currentPrompt(s.game)).toBeNull();
    expect(s.game.stack.map((entry) => entry.sourceId)).toEqual([mine, theirs]);
  });

  it("continues to the next player's group after the first group is ordered", () => {
    const s = scenario();
    const active = s.players[0]!;
    const other = s.players[1]!;
    s.mainPhase(active);
    const mineA = s.add(beginCombatTrigger("Test Trumpeter", 1), active, "battlefield");
    const mineB = s.add(beginCombatTrigger("Test Herald", 2), active, "battlefield");
    const theirsA = s.add(beginCombatTrigger("Test Piper", 3), other, "battlefield");
    const theirsB = s.add(beginCombatTrigger("Test Drummer", 4), other, "battlefield");
    queueSimultaneousTriggersInPlace(s.game, [
      { cardId: mineA, triggerIndex: 0 },
      { cardId: mineB, triggerIndex: 0 },
      { cardId: theirsA, triggerIndex: 0 },
      { cardId: theirsB, triggerIndex: 0 },
    ]);
    const first = currentPrompt(s.game);
    expect(first).toMatchObject({ kind: "order_triggers", playerId: active });
    const afterActive = applyAction(s.game, {
      kind: "resolve_order_triggers",
      playerId: active,
      order: [0, 1],
    });
    const secondPrompt = currentPrompt(afterActive);
    expect(secondPrompt).toMatchObject({ kind: "order_triggers", playerId: other });
    const done = applyAction(afterActive, {
      kind: "resolve_order_triggers",
      playerId: other,
      order: [1, 0],
    });
    expect(done.stack.map((entry) => entry.sourceId)).toEqual([mineA, mineB, theirsB, theirsA]);
  });
});
