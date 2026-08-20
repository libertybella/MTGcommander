import { describe, expect, it } from "vitest";
import { applyEffect } from "./effects";
import { creaturePower, creatureToughness } from "./derived";
import { abilitiesRemoved } from "./characteristicsEngine";
import { hasKeyword } from "./keywords";
import { createCardDefinition } from "./createGame";
import { legalChoicesForRequirement } from "./targeting";
import { advanceSteps, TURN_SEQUENCE } from "./turn";
import { scenario } from "./scenario";
import { fillLibraries } from "./testSupport";
import type { CardDefinition } from "./types";

function crystallineSliver(): CardDefinition {
  return createCardDefinition({
    name: "Test Crystalline Sliver",
    typeLine: "Creature — Sliver",
    manaCost: "{W}{U}",
    power: 1,
    toughness: 1,
    staticAbilities: [
      {
        selector: { scope: "all", subtypes: ["sliver"] },
        effect: { kind: "grant_keyword", keyword: "shroud" },
      },
    ],
  });
}

function sliver(name: string): CardDefinition {
  return createCardDefinition({
    name,
    typeLine: "Creature — Sliver",
    power: 1,
    toughness: 1,
  });
}

function humility(): CardDefinition {
  return createCardDefinition({
    name: "Test Humility",
    typeLine: "Enchantment",
    staticAbilities: [
      {
        selector: { scope: "all", types: ["creature"] },
        effect: { kind: "remove_all_abilities" },
      },
      {
        selector: { scope: "all", types: ["creature"] },
        effect: { kind: "set_pt", power: 1, toughness: 1 },
      },
    ],
  });
}

function anthem(): CardDefinition {
  return createCardDefinition({
    name: "Test Anthem",
    typeLine: "Enchantment",
    staticAbilities: [
      {
        selector: { scope: "controlled", types: ["creature"] },
        effect: { kind: "modify_pt", power: 1, toughness: 1 },
      },
    ],
  });
}

describe("[CR 613] the Sliver test", () => {
  it("grants shroud to every Sliver, including opponents' and later ones", () => {
    const s = scenario();
    const [me, opponent] = s.players as [string, string];
    const crystalline = s.add(crystallineSliver(), me, "battlefield");
    const mine = s.add(sliver("Test Muscle Sliver"), me, "battlefield");
    const theirs = s.add(sliver("Test Enemy Sliver"), opponent, "battlefield");
    expect(hasKeyword(s.game, crystalline, "shroud")).toBe(true);
    expect(hasKeyword(s.game, mine, "shroud")).toBe(true);
    expect(hasKeyword(s.game, theirs, "shroud")).toBe(true);
    // A non-Sliver is unaffected.
    const bear = s.add(
      createCardDefinition({ name: "Test Bear", typeLine: "Creature — Bear", power: 2, toughness: 2 }),
      opponent,
      "battlefield",
    );
    expect(hasKeyword(s.game, bear, "shroud")).toBe(false);
  });

  it("[CR 702.18] shroud makes Slivers illegal targets for everyone", () => {
    const s = scenario();
    const [me, opponent] = s.players as [string, string];
    s.add(crystallineSliver(), me, "battlefield");
    const mine = s.add(sliver("Test Muscle Sliver"), me, "battlefield");
    const myChoices = legalChoicesForRequirement(s.game, { kind: "creature" }, me);
    const theirChoices = legalChoicesForRequirement(s.game, { kind: "creature" }, opponent);
    expect(myChoices).toEqual([]);
    expect(theirChoices).toEqual([]);
    void mine;
  });

  it("stops granting the moment the source leaves the battlefield", () => {
    const s = scenario();
    const me = s.players[0]!;
    const crystalline = s.add(crystallineSliver(), me, "battlefield");
    const mine = s.add(sliver("Test Muscle Sliver"), me, "battlefield");
    expect(hasKeyword(s.game, mine, "shroud")).toBe(true);
    const after = applyEffect(s.game, { kind: "move_card", cardId: crystalline, toZone: "graveyard" });
    expect(hasKeyword(after, mine, "shroud")).toBe(false);
  });
});

describe("[CR 613] Humility and anthem interact by layer, not by arrival order", () => {
  it("anthem entering after Humility still applies: everything is 2/2", () => {
    const s = scenario();
    const me = s.players[0]!;
    const bear = s.add(
      createCardDefinition({ name: "Test Giant", typeLine: "Creature — Giant", power: 5, toughness: 5, keywords: ["trample"] }),
      me,
      "battlefield",
    );
    s.game.cards[s.add(humility(), me, "battlefield")]!.timestamp = 1;
    s.game.cards[s.add(anthem(), me, "battlefield")]!.timestamp = 2;
    expect(creaturePower(s.game, bear)).toBe(2);
    expect(creatureToughness(s.game, bear)).toBe(2);
    expect(hasKeyword(s.game, bear, "trample")).toBe(false);
    expect(abilitiesRemoved(s.game, bear)).toBe(true);
  });

  it("anthem entering before Humility gives the same result (layers, not timestamps)", () => {
    const s = scenario();
    const me = s.players[0]!;
    const bear = s.add(
      createCardDefinition({ name: "Test Giant", typeLine: "Creature — Giant", power: 5, toughness: 5 }),
      me,
      "battlefield",
    );
    s.game.cards[s.add(anthem(), me, "battlefield")]!.timestamp = 1;
    s.game.cards[s.add(humility(), me, "battlefield")]!.timestamp = 2;
    expect(creaturePower(s.game, bear)).toBe(2);
    expect(creatureToughness(s.game, bear)).toBe(2);
  });

  it("a lord silenced by Humility stops pumping (its statics are gone)", () => {
    const s = scenario();
    const me = s.players[0]!;
    const bear = s.add(
      createCardDefinition({ name: "Test Bear", typeLine: "Creature — Bear", power: 2, toughness: 2 }),
      me,
      "battlefield",
    );
    const lord = createCardDefinition({
      name: "Test Lord",
      typeLine: "Creature — Human",
      power: 2,
      toughness: 2,
      staticAbilities: [
        {
          selector: { scope: "controlled", types: ["creature"] },
          effect: { kind: "modify_pt", power: 1, toughness: 1 },
        },
      ],
    });
    s.game.cards[s.add(lord, me, "battlefield")]!.timestamp = 1;
    s.game.cards[s.add(humility(), me, "battlefield")]!.timestamp = 2;
    // Lord's anthem is silenced by the earlier-layer-6 removal; the bear is 1/1.
    expect(creaturePower(s.game, bear)).toBe(1);
    expect(creatureToughness(s.game, bear)).toBe(1);
  });
});

describe("[CR 611.2c / 514.2] until-end-of-turn effects", () => {
  it("a pump applies immediately and wears off during cleanup", () => {
    const s = scenario();
    const me = s.players[0]!;
    fillLibraries(s.game);
    const bear = s.add(
      createCardDefinition({ name: "Test Bear", typeLine: "Creature — Bear", power: 2, toughness: 2 }),
      me,
      "battlefield",
    );
    const pumped = applyEffect(s.game, {
      kind: "pt_until_eot",
      cardId: bear,
      power: 3,
      toughness: 3,
    });
    expect(creaturePower(pumped, bear)).toBe(5);
    expect(creatureToughness(pumped, bear)).toBe(5);
    const nextTurn = advanceSteps(pumped, TURN_SEQUENCE.length);
    expect(creaturePower(nextTurn, bear)).toBe(2);
    expect(nextTurn.activeEffects).toEqual([]);
  });

  it("a granted keyword wears off during cleanup", () => {
    const s = scenario();
    const me = s.players[0]!;
    fillLibraries(s.game);
    const bear = s.add(
      createCardDefinition({ name: "Test Bear", typeLine: "Creature — Bear", power: 2, toughness: 2 }),
      me,
      "battlefield",
    );
    const granted = applyEffect(s.game, { kind: "keyword_until_eot", cardId: bear, keyword: "flying" });
    expect(hasKeyword(granted, bear, "flying")).toBe(true);
    const nextTurn = advanceSteps(granted, TURN_SEQUENCE.length);
    expect(hasKeyword(nextTurn, bear, "flying")).toBe(false);
  });

  it("a team pump locks its affected set when it resolves", () => {
    const s = scenario();
    const me = s.players[0]!;
    fillLibraries(s.game);
    const bear = s.add(
      createCardDefinition({ name: "Test Bear", typeLine: "Creature — Bear", power: 2, toughness: 2 }),
      me,
      "battlefield",
    );
    const pumped = applyEffect(s.game, {
      kind: "team_pt_until_eot",
      playerId: me,
      power: 2,
      toughness: 2,
    });
    expect(creaturePower(pumped, bear)).toBe(4);
    // CR 611.2c: the affected set locked at resolution — only the bear.
    expect(pumped.activeEffects).toHaveLength(1);
    expect(pumped.activeEffects[0]?.affected).toEqual([bear]);
  });
});
