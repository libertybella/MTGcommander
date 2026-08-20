import { describe, expect, it } from "vitest";
import { blockRestriction } from "./combat";
import { createCardDefinition } from "./createGame";
import { scenario } from "./scenario";
import type { CardDefinition, Keyword } from "./types";

function creature(
  name: string,
  options: { keywords?: Keyword[]; typeLine?: string; manaCost?: string; power?: number } = {},
): CardDefinition {
  return createCardDefinition({
    name,
    typeLine: options.typeLine ?? "Creature — Beast",
    manaCost: options.manaCost ?? "",
    power: options.power ?? 2,
    toughness: 2,
    keywords: options.keywords ?? [],
  });
}

function pair(attackerDef: CardDefinition, blockerDef: CardDefinition) {
  const s = scenario();
  const [active, defender] = s.players as [string, string];
  const attacker = s.add(attackerDef, active, "battlefield");
  const blocker = s.add(blockerDef, defender, "battlefield");
  return { s, attacker, blocker };
}

describe("[CR 702] evasion block restrictions", () => {
  it("[702.36] fear is blocked only by artifact and/or black creatures", () => {
    const fearAttacker = creature("Test Dread", { keywords: ["fear"] });
    const white = pair(fearAttacker, creature("Test Cleric", { manaCost: "{W}" }));
    expect(blockRestriction(white.s.game, white.attacker, white.blocker)).toMatch(/fear/);
    const black = pair(fearAttacker, creature("Test Rat", { manaCost: "{B}" }));
    expect(blockRestriction(black.s.game, black.attacker, black.blocker)).toBeNull();
    const golem = pair(
      fearAttacker,
      creature("Test Golem", { typeLine: "Artifact Creature — Golem" }),
    );
    expect(blockRestriction(golem.s.game, golem.attacker, golem.blocker)).toBeNull();
  });

  it("[702.13] intimidate needs an artifact or color-sharing blocker", () => {
    const red = creature("Test Bully", { keywords: ["intimidate"], manaCost: "{R}" });
    const green = pair(red, creature("Test Elf", { manaCost: "{G}" }));
    expect(blockRestriction(green.s.game, green.attacker, green.blocker)).toMatch(/intimidate/);
    const alsoRed = pair(red, creature("Test Goblin", { manaCost: "{R}" }));
    expect(blockRestriction(alsoRed.s.game, alsoRed.attacker, alsoRed.blocker)).toBeNull();
  });

  it("[702.30] horsemanship is blocked only by horsemanship", () => {
    const rider = creature("Test Rider", { keywords: ["horsemanship"] });
    const walker = pair(rider, creature("Test Walker"));
    expect(blockRestriction(walker.s.game, walker.attacker, walker.blocker)).toMatch(/horsemanship/);
    const other = pair(rider, creature("Test Other Rider", { keywords: ["horsemanship"] }));
    expect(blockRestriction(other.s.game, other.attacker, other.blocker)).toBeNull();
  });

  it("[702.27] shadow blocks only across the shadow boundary", () => {
    const shade = creature("Test Shade", { keywords: ["shadow"] });
    const normal = pair(shade, creature("Test Normal"));
    expect(blockRestriction(normal.s.game, normal.attacker, normal.blocker)).toMatch(/shadow/);
    const reverse = pair(creature("Test Normal"), creature("Test Shade", { keywords: ["shadow"] }));
    expect(blockRestriction(reverse.s.game, reverse.attacker, reverse.blocker)).toMatch(/shadow/);
    const both = pair(shade, creature("Test Other Shade", { keywords: ["shadow"] }));
    expect(blockRestriction(both.s.game, both.attacker, both.blocker)).toBeNull();
  });

  it("[702.72] skulk cannot be blocked by greater power", () => {
    const sneak = creature("Test Sneak", { keywords: ["skulk"], power: 1 });
    const big = pair(sneak, creature("Test Ogre", { power: 4 }));
    expect(blockRestriction(big.s.game, big.attacker, big.blocker)).toMatch(/skulk/);
    const small = pair(sneak, creature("Test Squire", { power: 1 }));
    expect(blockRestriction(small.s.game, small.attacker, small.blocker)).toBeNull();
  });

  it("evasion reads computed characteristics: granted fear works", () => {
    const s = scenario();
    const [active, defender] = s.players as [string, string];
    const attacker = s.add(creature("Test Beast"), active, "battlefield");
    const blocker = s.add(creature("Test Cleric", { manaCost: "{W}" }), defender, "battlefield");
    expect(blockRestriction(s.game, attacker, blocker)).toBeNull();
    // Grant fear via a lord-style static ability.
    s.add(
      createCardDefinition({
        name: "Test Fearmonger",
        typeLine: "Enchantment",
        staticAbilities: [
          {
            selector: { scope: "controlled", types: ["creature"] },
            effect: { kind: "grant_keyword", keyword: "fear" },
          },
        ],
      }),
      active,
      "battlefield",
    );
    expect(blockRestriction(s.game, attacker, blocker)).toMatch(/fear/);
  });
});
