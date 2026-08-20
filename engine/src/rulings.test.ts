import { describe, expect, it } from "vitest";
import { applyEffect } from "./effects";
import { compileOracleCard } from "./oracle";
import { createCardDefinition } from "./createGame";
import { currentPrompt } from "./prompt";
import { scenario } from "./scenario";
import type { CardDefinition, PlayerId } from "./types";

/**
 * The Stage 6 rulings corpus (pilot). Each test converts one *actual*
 * Gatherer ruling (fetched via api.scryfall.com/cards/:id/rulings) into a
 * scenario: the ruling text is quoted verbatim in the test name, so a
 * failure points straight at the rules gap. Growing this corpus is the
 * standing verification loop for layers 2 and 3.
 */

function bloodArtist(): CardDefinition {
  const compiled = compileOracleCard({
    oracleId: "blood-artist",
    name: "Blood Artist",
    manaCost: "{1}{B}",
    typeLine: "Creature — Vampire",
    oracleText:
      "Whenever Blood Artist or another creature dies, target player loses 1 life and you gain 1 life.",
    power: "0",
    toughness: "1",
    printedKeywords: [],
  });
  expect(compiled.notes).toEqual([]);
  return compiled.definition;
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
  return compiled.definition;
}

describe("rulings corpus", () => {
  it("[Blood Artist, 2016-06-08] 'If Blood Artist and one or more other creatures die at the same time, its ability will trigger for each of those creatures.'", () => {
    const s = scenario();
    const [me, opponent] = s.players as [PlayerId, PlayerId];
    void opponent;
    const artist = s.add(bloodArtist(), me, "battlefield");
    const bear = s.add(
      createCardDefinition({ name: "Test Bear", typeLine: "Creature — Bear", power: 2, toughness: 2 }),
      me,
      "battlefield",
    );
    // A simultaneous board wipe: both take lethal damage, one SBA sweep.
    s.game.cards[artist]!.damageMarked = 5;
    s.game.cards[bear]!.damageMarked = 5;
    const after = applyEffect(s.game, { kind: "gain_life", playerId: me, amount: 1 });
    expect(after.cards[artist]?.zone).toBe("graveyard");
    expect(after.cards[bear]?.zone).toBe("graveyard");
    // One trigger per death — Blood Artist watches its own death and the
    // bear's from the graveyard (look-back). Two simultaneous triggers from
    // one controller arrive as an APNAP ordering choice of two entries.
    const prompt = currentPrompt(after);
    expect(prompt?.kind).toBe("order_triggers");
    expect(prompt?.kind === "order_triggers" ? prompt.entries : []).toHaveLength(2);
  });

  it("[Rest in Peace, 2012-10-01] 'abilities that trigger whenever a creature dies won't trigger because cards and tokens are never put into a player's graveyard.'", () => {
    const s = scenario();
    const me = s.players[0]!;
    s.add(restInPeace(), me, "battlefield");
    s.add(bloodArtist(), me, "battlefield");
    const bear = s.add(
      createCardDefinition({ name: "Test Bear", typeLine: "Creature — Bear", power: 2, toughness: 2 }),
      me,
      "battlefield",
    );
    const after = applyEffect(s.game, {
      kind: "deal_damage",
      sourceId: null,
      target: { type: "creature", cardId: bear },
      amount: 5,
    });
    expect(after.cards[bear]?.zone).toBe("exile");
    expect(after.stack).toHaveLength(0);
    expect(currentPrompt(after)).toBeNull();
  });

  it("[Rest in Peace, 2012-10-01] 'If Rest in Peace is destroyed by a spell, Rest in Peace will be exiled'", () => {
    const s = scenario();
    const me = s.players[0]!;
    const rip = s.add(restInPeace(), me, "battlefield");
    const after = applyEffect(s.game, { kind: "move_card", cardId: rip, toZone: "graveyard" });
    // Its own replacement still applies as it leaves: exiled, not buried.
    expect(after.cards[rip]?.zone).toBe("exile");
  });
});
