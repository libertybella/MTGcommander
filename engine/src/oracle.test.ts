import { describe, expect, it } from "vitest";
import {
  compileOracleCard,
  inferProduces,
  keywordsFromOracle,
  normalizeCardName,
  type OracleCard,
} from "./oracle";

function forest(): OracleCard {
  return {
    oracleId: "forest-id",
    name: "Forest",
    manaCost: "",
    typeLine: "Basic Land — Forest",
    oracleText: "{T}: Add {G}.",
    power: null,
    toughness: null,
    printedKeywords: [],
  };
}

function solRing(): OracleCard {
  return {
    oracleId: "sol-ring-id",
    name: "Sol Ring",
    manaCost: "{1}",
    typeLine: "Artifact",
    oracleText: "{T}: Add {C}{C}.",
    power: null,
    toughness: null,
    printedKeywords: [],
  };
}

function bolt(): OracleCard {
  return {
    oracleId: "bolt-id",
    name: "Lightning Bolt",
    manaCost: "{R}",
    typeLine: "Instant",
    oracleText: "Lightning Bolt deals 3 damage to any target.",
    power: null,
    toughness: null,
    printedKeywords: [],
  };
}

function dragon(): OracleCard {
  return {
    oracleId: "dragon-id",
    name: "Shivan Dragon",
    manaCost: "{4}{R}{R}",
    typeLine: "Creature — Dragon",
    oracleText: "Flying\n{R}: This creature gets +1/+0 until end of turn.",
    power: "5",
    toughness: "5",
    printedKeywords: ["Flying"],
  };
}

describe("oracle compile", () => {
  it("normalizes card names for lookup", () => {
    expect(normalizeCardName("  Sol  Ring ")).toBe("sol ring");
    expect(normalizeCardName("Lim-Dûl's Vault")).toBe("lim-dul's vault");
  });

  it("gives basic forests a green tap and no compile notes", () => {
    expect(inferProduces(forest())).toEqual({ G: 1 });
    const compiled = compileOracleCard(forest());
    expect(compiled.definition.produces).toEqual({ G: 1 });
    expect(compiled.notes).toEqual([]);
    expect(compiled.definition.id).toBe("oracle:forest-id");
  });

  it("lets Sol Ring tap for two colorless", () => {
    expect(inferProduces(solRing())).toEqual({ C: 2 });
    expect(compileOracleCard(solRing()).definition.produces).toEqual({ C: 2 });
  });

  it("lets Command Tower tap for any color", () => {
    const tower: OracleCard = {
      oracleId: "tower",
      name: "Command Tower",
      manaCost: "",
      typeLine: "Land",
      oracleText: "{T}: Add one mana of any color in your commander's color identity.",
      power: null,
      toughness: null,
      printedKeywords: [],
    };
    expect(inferProduces(tower)).toEqual({});
    const compiled = compileOracleCard(tower);
    expect(compiled.definition.producesAnyColor).toBe(true);
    expect(compiled.notes.some((note) => /color identity is not enforced/.test(note))).toBe(true);
  });

  it("copies printed keywords and power/toughness", () => {
    expect(keywordsFromOracle(dragon())).toEqual(["flying"]);
    const compiled = compileOracleCard(dragon());
    expect(compiled.definition.power).toBe(5);
    expect(compiled.definition.toughness).toBe(5);
    expect(compiled.definition.keywords).toContain("flying");
  });

  it("compiles a lone {T}: Draw a card ability", () => {
    const tome: OracleCard = {
      oracleId: "tome",
      name: "Tap Tome",
      manaCost: "{4}",
      typeLine: "Artifact",
      oracleText: "{T}: Draw a card.",
      power: null,
      toughness: null,
      printedKeywords: [],
    };
    const compiled = compileOracleCard(tome);
    expect(compiled.notes).toEqual([]);
    expect(compiled.definition.activated).toEqual([
      {
        tap: true,
        manaCost: "",
        targetRequirements: [],
        effects: [{ kind: "draw", playerId: "controller", count: 1 }],
      },
    ]);
  });

  it("compiles Lightning Bolt as targeted damage", () => {
    const compiled = compileOracleCard(bolt());
    expect(compiled.definition.targetRequirements).toEqual([{ kind: "player_or_creature" }]);
    expect(compiled.definition.effects).toEqual([
      {
        kind: "deal_damage",
        sourceId: "self",
        target: { type: "chosen", index: 0 },
        amount: 3,
      },
    ]);
    expect(compiled.notes).toEqual([]);
  });

  it("pays hybrid mana costs", () => {
    const hybrid: OracleCard = {
      oracleId: "hybrid",
      name: "Boros Reckoner",
      manaCost: "{R/W}{R/W}{R/W}",
      typeLine: "Creature — Minotaur Wizard",
      oracleText: "",
      power: "3",
      toughness: "3",
      printedKeywords: [],
    };
    expect(compileOracleCard(hybrid).notes.some((note) => /cannot be paid/.test(note))).toBe(false);
    expect(compileOracleCard(hybrid).notes).toEqual([]);
  });

  it("compiles dual lands as a color choice, not both colors at once", () => {
    const shock: OracleCard = {
      oracleId: "breeding",
      name: "Breeding Pool",
      manaCost: "",
      typeLine: "Land — Forest Island",
      oracleText:
        "As Breeding Pool enters, you may pay 2 life. If you don't, it enters tapped.\n{T}: Add {G} or {U}.",
      power: null,
      toughness: null,
      printedKeywords: [],
    };
    const compiled = compileOracleCard(shock);
    expect(compiled.definition.produces).toEqual({});
    expect(compiled.definition.producesOptions).toEqual(["G", "U"]);
    expect(compiled.definition.replacements).toEqual([
      { kind: "may_pay_life_or_enter_tapped", amount: 2 },
    ]);
    expect(compiled.notes).toEqual([]);
  });

  it("compiles slow lands, check lands, temples, and legendary-unless lands", () => {
    const marsh = compileOracleCard({
      oracleId: "marsh",
      name: "Shipwreck Marsh",
      manaCost: "",
      typeLine: "Land",
      oracleText:
        "Shipwreck Marsh enters the battlefield tapped unless you control two or more other lands.\n{T}: Add {U} or {B}.",
      power: null,
      toughness: null,
      printedKeywords: [],
    });
    expect(marsh.definition.replacements).toEqual([
      { kind: "enters_tapped_unless", unless: { kind: "other_lands", count: 2 } },
    ]);
    expect(marsh.notes).toEqual([]);

    const summit = compileOracleCard({
      oracleId: "summit",
      name: "Dragonskull Summit",
      manaCost: "",
      typeLine: "Land",
      oracleText:
        "Dragonskull Summit enters tapped unless you control a Swamp or a Mountain.\n{T}: Add {B} or {R}.",
      power: null,
      toughness: null,
      printedKeywords: [],
    });
    expect(summit.definition.replacements).toEqual([
      {
        kind: "enters_tapped_unless",
        unless: { kind: "controlled_types", types: ["swamp", "mountain"] },
      },
    ]);

    const temple = compileOracleCard({
      oracleId: "temple",
      name: "Temple of Deceit",
      manaCost: "",
      typeLine: "Land",
      oracleText:
        "Temple of Deceit enters the battlefield tapped.\nWhen Temple of Deceit enters, scry 1.\n{T}: Add {U} or {B}.",
      power: null,
      toughness: null,
      printedKeywords: [],
    });
    expect(temple.definition.replacements).toEqual([{ kind: "enters_tapped" }]);
    expect(temple.definition.triggers).toEqual([
      {
        event: "enter_battlefield",
        effects: [{ kind: "scry", playerId: "controller", count: 1 }],
        targetRequirements: [],
      },
    ]);
    expect(temple.notes).toEqual([]);

    const barad = compileOracleCard({
      oracleId: "barad",
      name: "Barad-dûr",
      manaCost: "",
      typeLine: "Legendary Land",
      oracleText:
        "Barad-dûr enters tapped unless you control a legendary creature.\n{T}: Add {B}.",
      power: null,
      toughness: null,
      printedKeywords: [],
    });
    expect(barad.definition.replacements).toEqual([
      { kind: "enters_tapped_unless", unless: { kind: "legendary_creature" } },
    ]);
  });

  it("compiles unconditional enter-tapped lands as a replacement", () => {
    const gate = compileOracleCard({
      oracleId: "gate",
      name: "Simic Guildgate",
      manaCost: "",
      typeLine: "Land — Gate",
      oracleText: "Simic Guildgate enters tapped.\n{T}: Add {G} or {U}.",
      power: null,
      toughness: null,
      printedKeywords: [],
    });
    expect(gate.definition.replacements).toEqual([{ kind: "enters_tapped" }]);
    expect(gate.definition.producesOptions).toEqual(["G", "U"]);
    expect(gate.notes).toEqual([]);

    const modern = compileOracleCard({
      oracleId: "modern-gate",
      name: "Simic Guildgate",
      manaCost: "",
      typeLine: "Land — Gate",
      oracleText: "This land enters tapped.\n{T}: Add {G} or {U}.",
      power: null,
      toughness: null,
      printedKeywords: [],
    });
    expect(modern.definition.replacements).toEqual([{ kind: "enters_tapped" }]);
    expect(modern.notes).toEqual([]);
  });

  it("compiles a cleric ETB, anthem, destroy, counter, and paid tap-draw", () => {
    const cleric = compileOracleCard({
      oracleId: "cleric",
      name: "Soul Warden",
      manaCost: "{W}",
      typeLine: "Creature — Human Cleric",
      oracleText: "Whenever another creature enters, you gain 1 life.",
      power: "1",
      toughness: "1",
      printedKeywords: [],
    });
    // Compiles as of Stage 3: an enters-watcher excluding itself.
    expect(cleric.definition.triggers).toEqual([
      {
        event: "enter_battlefield",
        watch: "any",
        excludeSelf: true,
        subjectFilter: { types: ["creature"] },
        effects: [{ kind: "gain_life", playerId: "controller", amount: 1 }],
        targetRequirements: [],
      },
    ]);
    expect(cleric.notes).toEqual([]);

    const etb = compileOracleCard({
      oracleId: "etb",
      name: "Test Cleric",
      manaCost: "{W}",
      typeLine: "Creature — Cleric",
      oracleText: "When Test Cleric enters, you gain 3 life.",
      power: "1",
      toughness: "1",
      printedKeywords: [],
    });
    expect(etb.definition.triggers).toEqual([
      {
        event: "enter_battlefield",
        effects: [{ kind: "gain_life", playerId: "controller", amount: 3 }],
        targetRequirements: [],
      },
    ]);

    const sage = compileOracleCard({
      oracleId: "sage",
      name: "Test Sage",
      manaCost: "{2}{G}",
      typeLine: "Creature — Elf Shaman",
      oracleText: "When Test Sage enters, destroy target creature.",
      power: "2",
      toughness: "1",
      printedKeywords: [],
    });
    expect(sage.definition.triggers).toEqual([
      {
        event: "enter_battlefield",
        effects: [{ kind: "move_card", cardId: { type: "chosen", index: 0 }, toZone: "graveyard" }],
        targetRequirements: [{ kind: "creature" }],
      },
    ]);
    expect(sage.definition.targetRequirements).toEqual([]);

    const lord = compileOracleCard({
      oracleId: "lord",
      name: "Honor of the Pure",
      manaCost: "{1}{W}",
      typeLine: "Enchantment",
      oracleText: "Creatures you control get +1/+1.",
      power: null,
      toughness: null,
      printedKeywords: [],
    });
    expect(lord.definition.staticAbilities).toEqual([
      {
        selector: { scope: "controlled", types: ["creature"] },
        effect: { kind: "modify_pt", power: 1, toughness: 1 },
      },
    ]);

    const terror = compileOracleCard({
      oracleId: "terror",
      name: "Doom Blade",
      manaCost: "{1}{B}",
      typeLine: "Instant",
      oracleText: "Destroy target creature.",
      power: null,
      toughness: null,
      printedKeywords: [],
    });
    expect(terror.definition.targetRequirements).toEqual([{ kind: "creature" }]);

    const counter = compileOracleCard({
      oracleId: "counter",
      name: "Counterspell",
      manaCost: "{U}{U}",
      typeLine: "Instant",
      oracleText: "Counter target spell.",
      power: null,
      toughness: null,
      printedKeywords: [],
    });
    expect(counter.definition.effects[0]?.kind).toBe("counter_spell");

    const tome = compileOracleCard({
      oracleId: "jayemdae",
      name: "Jayemdae Tome",
      manaCost: "{4}",
      typeLine: "Artifact",
      oracleText: "{4}, {T}: Draw a card.",
      power: null,
      toughness: null,
      printedKeywords: [],
    });
    expect(tome.definition.activated).toEqual([
      {
        tap: true,
        manaCost: "{4}",
        targetRequirements: [],
        effects: [{ kind: "draw", playerId: "controller", count: 1 }],
      },
    ]);
  });

  it("compiles Surveil N then draw as sequential effects", () => {
    const consider = compileOracleCard({
      oracleId: "consider",
      name: "Consider",
      manaCost: "{U}",
      typeLine: "Instant",
      oracleText: "Surveil 1.\nDraw a card.",
      power: null,
      toughness: null,
      printedKeywords: [],
    });
    expect(consider.definition.effects).toEqual([
      { kind: "surveil", playerId: "controller", count: 1 },
      { kind: "draw", playerId: "controller", count: 1 },
    ]);
    expect(consider.notes).toEqual([]);
  });

  it("compiles every {T}: Add mana ability, including pain lands", () => {
    const river = compileOracleCard({
      oracleId: "river",
      name: "Underground River",
      manaCost: "",
      typeLine: "Land",
      oracleText:
        "{T}: Add {C}.\n{T}: Add {U} or {B}. Underground River deals 1 damage to you.",
      power: null,
      toughness: null,
      printedKeywords: [],
    });
    expect(river.definition.produces).toEqual({ C: 1 });
    expect(river.definition.manaAbilities).toEqual([
      {
        produces: { C: 1 },
        producesOptions: [],
        producesAnyColor: false,
        damageToController: 0,
      },
      {
        produces: {},
        producesOptions: ["U", "B"],
        producesAnyColor: false,
        damageToController: 1,
      },
    ]);
    expect(river.notes).toEqual([]);
  });

  it("compiles Hive-style lands that enter tapped if you already have two lands", () => {
    const hive = compileOracleCard({
      oracleId: "hive",
      name: "Hive of the Eye Tyrant",
      manaCost: "",
      typeLine: "Land",
      oracleText:
        "If you control two or more other lands, Hive of the Eye Tyrant enters the battlefield tapped.\n{T}: Add {B}.",
      power: null,
      toughness: null,
      printedKeywords: [],
    });
    expect(hive.definition.replacements).toEqual([
      { kind: "enters_tapped_if", if: { kind: "other_lands", count: 2 } },
    ]);
    expect(hive.definition.produces).toEqual({ B: 1 });
    expect(hive.notes).toEqual([]);
  });

  it("compiles Channel as a hand ability that discards the card", () => {
    const sokenzan = compileOracleCard({
      oracleId: "sokenzan",
      name: "Sokenzan, Crucible of Defiance",
      manaCost: "",
      typeLine: "Legendary Land",
      oracleText:
        "{T}: Add {R}.\nChannel — {3}{R}, Discard this card: Create two 1/1 colorless Spirit creature tokens.",
      power: null,
      toughness: null,
      printedKeywords: ["Channel"],
    });
    expect(sokenzan.definition.activated).toEqual([
      {
        tap: false,
        manaCost: "{3}{R}",
        zone: "hand",
        discard: true,
        targetRequirements: [],
        effects: [
          {
            kind: "create_token",
            ownerId: "controller",
            name: "Spirit",
            typeLine: "Creature — Spirit Token",
            power: 1,
            toughness: 1,
          },
          {
            kind: "create_token",
            ownerId: "controller",
            name: "Spirit",
            typeLine: "Creature — Spirit Token",
            power: 1,
            toughness: 1,
          },
        ],
      },
    ]);
  });

  it("compiles Class level-up costs as sorcery-speed abilities", () => {
    const wizard = compileOracleCard({
      oracleId: "wizard-class",
      name: "Wizard Class",
      manaCost: "{U}",
      typeLine: "Enchantment — Class",
      oracleText:
        "You have no maximum hand size.\n{2}{U}: Level 2\n{4}{U}: Level 3",
      power: null,
      toughness: null,
      printedKeywords: [],
    });
    expect(
      wizard.definition.activated.filter((ability) => ability.effects[0]?.kind === "set_class_level"),
    ).toEqual([
      {
        tap: false,
        manaCost: "{2}{U}",
        timing: "sorcery",
        targetRequirements: [],
        effects: [{ kind: "set_class_level", cardId: "self", level: 2 }],
      },
      {
        tap: false,
        manaCost: "{4}{U}",
        timing: "sorcery",
        targetRequirements: [],
        effects: [{ kind: "set_class_level", cardId: "self", level: 3 }],
      },
    ]);
  });

  it("links modal double-faced lands so either face can be played", () => {
    const pathway = compileOracleCard({
      oracleId: "pathway",
      name: "Clearwater Pathway // Murkwater Pathway",
      manaCost: "",
      typeLine: "Land",
      oracleText: "{T}: Add {U}.",
      power: null,
      toughness: null,
      printedKeywords: [],
      layout: "modal_dfc",
      faces: [
        {
          name: "Clearwater Pathway",
          manaCost: "",
          typeLine: "Land",
          oracleText: "{T}: Add {U}.",
          power: null,
          toughness: null,
        },
        {
          name: "Murkwater Pathway",
          manaCost: "",
          typeLine: "Land",
          oracleText: "{T}: Add {B}.",
          power: null,
          toughness: null,
        },
      ],
    });
    expect(pathway.definition.name).toBe("Clearwater Pathway");
    expect(pathway.definition.layout).toBe("modal_dfc");
    expect(pathway.otherDefinition?.name).toBe("Murkwater Pathway");
    expect(pathway.definition.otherFaceId).toBe(pathway.otherDefinition?.id);
    expect(pathway.otherDefinition?.produces).toEqual({ B: 1 });
  });

  it("compiles amass with a default of 1 and a stated number", () => {
    const march = compileOracleCard({
      oracleId: "march",
      name: "March from the Black Gate",
      manaCost: "{1}{B}",
      typeLine: "Enchantment",
      oracleText:
        "When March from the Black Gate enters the battlefield and whenever an Army you control attacks, amass Orcs 1. (Put a +1/+1 counter on an Army you control. It's also an Orc. If you don't control an Army, create a 0/0 black Orc Army creature token first.)",
      power: null,
      toughness: null,
      printedKeywords: [],
    });
    expect(march.definition.triggers).toEqual([
      {
        event: "enter_battlefield",
        effects: [{ kind: "amass", playerId: "controller", amount: 1, subtype: "Orc" }],
        targetRequirements: [],
      },
    ]);

    const rider = compileOracleCard({
      oracleId: "rider",
      name: "Warg Rider",
      manaCost: "{4}{B}",
      typeLine: "Creature — Orc Warrior",
      oracleText: "Haste\nWhenever Warg Rider attacks, amass Orcs 2.",
      power: "4",
      toughness: "3",
      printedKeywords: ["Haste"],
    });
    expect(rider.definition.keywords).toContain("haste");
    // Compiles as of Stage 3: attack triggers are real events now.
    expect(rider.definition.triggers).toEqual([
      {
        event: "attacks",
        effects: [{ kind: "amass", playerId: "controller", amount: 2, subtype: "Orc" }],
        targetRequirements: [],
      },
    ]);
    expect(rider.notes).toEqual([]);

    const brutality = compileOracleCard({
      oracleId: "brutality",
      name: "Widespread Brutality",
      manaCost: "{1}{B}{R}{R}",
      typeLine: "Sorcery",
      oracleText:
        "Amass Orcs 2, then the Army you amassed deals damage to each creature and each opponent equal to the number of +1/+1 counters on it.",
      power: null,
      toughness: null,
      printedKeywords: [],
    });
    expect(brutality.definition.effects).toEqual([
      { kind: "amass", playerId: "controller", amount: 2, subtype: "Orc" },
    ]);
    expect(brutality.notes.some((note) => /Then the Army/.test(note))).toBe(true);

    const bare = compileOracleCard({
      oracleId: "bare-amass",
      name: "Test Amass",
      manaCost: "{B}",
      typeLine: "Sorcery",
      oracleText: "Amass Orcs.",
      power: null,
      toughness: null,
      printedKeywords: [],
    });
    expect(bare.definition.effects).toEqual([
      { kind: "amass", playerId: "controller", amount: 1, subtype: "Orc" },
    ]);
  });

  it("compiles Chart a Course, Agonizing Remorse, and Expressive Iteration", () => {
    const chart = compileOracleCard({
      oracleId: "chart",
      name: "Chart a Course",
      manaCost: "{1}{U}",
      typeLine: "Sorcery",
      oracleText: "Draw two cards. Then discard a card unless you attacked this turn.",
      power: null,
      toughness: null,
      printedKeywords: [],
    });
    expect(chart.definition.effects).toEqual([
      { kind: "draw", playerId: "controller", count: 2 },
      { kind: "discard_unless_attacked", playerId: "controller", count: 1 },
    ]);
    expect(chart.notes).toEqual([]);

    const remorse = compileOracleCard({
      oracleId: "remorse",
      name: "Agonizing Remorse",
      manaCost: "{1}{B}",
      typeLine: "Sorcery",
      oracleText:
        "Target opponent reveals their hand. You choose a nonland card from it or a card from their graveyard. Exile that card. You lose 1 life.",
      power: null,
      toughness: null,
      printedKeywords: [],
    });
    expect(remorse.definition.targetRequirements).toEqual([{ kind: "opponent" }]);
    expect(remorse.definition.effects).toEqual([
      {
        kind: "reveal_zone",
        fromPlayerId: { type: "chosen", index: 0 },
        toPlayerId: "controller",
        zone: "hand",
      },
      {
        kind: "choose_card",
        chooserId: "controller",
        sources: [
          { playerId: { type: "chosen", index: 0 }, zone: "hand", filter: "nonland" },
          { playerId: { type: "chosen", index: 0 }, zone: "graveyard", filter: "any" },
        ],
        thenEffects: [{ kind: "move_card", cardId: "chosen_card", toZone: "exile" }],
      },
      { kind: "lose_life", playerId: "controller", amount: 1 },
    ]);
    expect(remorse.notes).toEqual([]);

    const iteration = compileOracleCard({
      oracleId: "iteration",
      name: "Expressive Iteration",
      manaCost: "{U}{R}",
      typeLine: "Sorcery",
      oracleText:
        "Look at the top three cards of your library. Put one of them into your hand, put one of them on the bottom of your library, and exile one of them. You may play the exiled card this turn.",
      power: null,
      toughness: null,
      printedKeywords: [],
    });
    expect(iteration.definition.effects).toEqual([
      {
        kind: "look_and_assign",
        playerId: "controller",
        count: 3,
        destinations: ["hand", "library_bottom", "exile"],
      },
    ]);
    expect(iteration.notes.some((note) => /play the exiled card/i.test(note))).toBe(true);
  });

  it("compiles Duress, Sign in Blood, Behold, counters, Go for the Throat, battle lands, and begin-combat amass", () => {
    const duress = compileOracleCard({
      oracleId: "duress",
      name: "Duress",
      manaCost: "{B}",
      typeLine: "Sorcery",
      oracleText:
        "Target opponent reveals their hand. You choose a noncreature, nonland card from it. That player discards that card.",
      power: null,
      toughness: null,
      printedKeywords: [],
    });
    expect(duress.definition.targetRequirements).toEqual([{ kind: "opponent" }]);
    expect(duress.definition.effects).toEqual([
      {
        kind: "reveal_zone",
        fromPlayerId: { type: "chosen", index: 0 },
        toPlayerId: "controller",
        zone: "hand",
      },
      {
        kind: "choose_card",
        chooserId: "controller",
        sources: [{ playerId: { type: "chosen", index: 0 }, zone: "hand", filter: "noncreature_nonland" }],
        thenEffects: [{ kind: "move_card", cardId: "chosen_card", toZone: "graveyard" }],
      },
    ]);
    expect(duress.notes).toEqual([]);

    const sign = compileOracleCard({
      oracleId: "sign",
      name: "Sign in Blood",
      manaCost: "{B}{B}",
      typeLine: "Sorcery",
      oracleText: "Target player draws two cards and loses 2 life.",
      power: null,
      toughness: null,
      printedKeywords: [],
    });
    expect(sign.definition.targetRequirements).toEqual([{ kind: "player" }]);
    expect(sign.definition.effects).toEqual([
      { kind: "draw", playerId: { type: "chosen", index: 0 }, count: 2 },
      { kind: "lose_life", playerId: { type: "chosen", index: 0 }, amount: 2 },
    ]);
    expect(sign.notes).toEqual([]);

    const behold = compileOracleCard({
      oracleId: "behold",
      name: "Behold the Multiverse",
      manaCost: "{3}{U}",
      typeLine: "Instant",
      oracleText: "Scry 2, then draw two cards.\nForetell {1}{U} (During your turn, you may pay {2} and exile this card from your hand face down. Cast it on a later turn for its foretell cost.)",
      power: null,
      toughness: null,
      printedKeywords: [],
    });
    expect(behold.definition.effects).toEqual([
      { kind: "scry", playerId: "controller", count: 2 },
      { kind: "draw", playerId: "controller", count: 2 },
    ]);
    expect(behold.notes.some((note) => /Foretell/i.test(note))).toBe(true);

    const negate = compileOracleCard({
      oracleId: "negate",
      name: "Negate",
      manaCost: "{1}{U}",
      typeLine: "Instant",
      oracleText: "Counter target noncreature spell.",
      power: null,
      toughness: null,
      printedKeywords: [],
    });
    expect(negate.definition.targetRequirements).toEqual([{ kind: "noncreature_spell" }]);
    expect(negate.notes).toEqual([]);

    const scatter = compileOracleCard({
      oracleId: "scatter",
      name: "Essence Scatter",
      manaCost: "{1}{U}",
      typeLine: "Instant",
      oracleText: "Counter target creature spell.",
      power: null,
      toughness: null,
      printedKeywords: [],
    });
    expect(scatter.definition.targetRequirements).toEqual([{ kind: "creature_spell" }]);
    expect(scatter.notes).toEqual([]);

    const throat = compileOracleCard({
      oracleId: "throat",
      name: "Go for the Throat",
      manaCost: "{1}{B}",
      typeLine: "Instant",
      oracleText: "Destroy target nonartifact creature.",
      power: null,
      toughness: null,
      printedKeywords: [],
    });
    expect(throat.definition.targetRequirements).toEqual([{ kind: "nonartifact_creature" }]);
    expect(throat.notes).toEqual([]);

    const smoldering = compileOracleCard({
      oracleId: "smoldering",
      name: "Smoldering Marsh",
      manaCost: "",
      typeLine: "Land — Swamp Mountain",
      oracleText:
        "Smoldering Marsh enters tapped unless you control two or more basic lands.\n{T}: Add {B} or {R}.",
      power: null,
      toughness: null,
      printedKeywords: [],
    });
    expect(smoldering.definition.replacements).toEqual([
      { kind: "enters_tapped_unless", unless: { kind: "basic_lands", count: 2 } },
    ]);
    expect(smoldering.notes).toEqual([]);

    const gothmog = compileOracleCard({
      oracleId: "gothmog",
      name: "Gothmog, Morgul Lieutenant",
      manaCost: "{1}{B}",
      typeLine: "Legendary Creature — Human Soldier",
      oracleText:
        "When Gothmog enters, amass Orcs 1.\nGothmog can't be blocked by creatures with power 2 or less.",
      power: "3",
      toughness: "3",
      printedKeywords: [],
    });
    expect(gothmog.definition.triggers).toEqual([
      {
        event: "enter_battlefield",
        effects: [{ kind: "amass", playerId: "controller", amount: 1, subtype: "Orc" }],
        targetRequirements: [],
      },
    ]);
    expect(gothmog.notes.some((note) => /can't be blocked/i.test(note))).toBe(true);

    const rider = compileOracleCard({
      oracleId: "warg-begin",
      name: "Warg Rider",
      manaCost: "{4}{B}",
      typeLine: "Creature — Orc Warrior",
      oracleText: "Menace\nAt the beginning of combat on your turn, amass Orcs 2.",
      power: "4",
      toughness: "3",
      printedKeywords: ["Menace"],
    });
    expect(rider.definition.keywords).toContain("menace");
    expect(rider.definition.triggers).toEqual([
      {
        event: "begin_combat",
        effects: [{ kind: "amass", playerId: "controller", amount: 2, subtype: "Orc" }],
        targetRequirements: [],
      },
    ]);
    expect(rider.notes).toEqual([]);
  });
});

describe("Stage 2 compile patterns", () => {
  it("compiles Giant Growth as a targeted until-end-of-turn pump", () => {
    const compiled = compileOracleCard({
      oracleId: "growth",
      name: "Giant Growth",
      manaCost: "{G}",
      typeLine: "Instant",
      oracleText: "Target creature gets +3/+3 until end of turn.",
      power: null,
      toughness: null,
      printedKeywords: [],
    });
    expect(compiled.notes).toEqual([]);
    expect(compiled.definition.targetRequirements).toEqual([{ kind: "creature" }]);
    expect(compiled.definition.effects).toEqual([
      { kind: "pt_until_eot", cardId: { type: "chosen", index: 0 }, power: 3, toughness: 3 },
    ]);
  });

  it("compiles a targeted keyword grant until end of turn", () => {
    const compiled = compileOracleCard({
      oracleId: "jump",
      name: "Jump",
      manaCost: "{U}",
      typeLine: "Instant",
      oracleText: "Target creature gains flying until end of turn.",
      power: null,
      toughness: null,
      printedKeywords: [],
    });
    expect(compiled.notes).toEqual([]);
    expect(compiled.definition.effects).toEqual([
      { kind: "keyword_until_eot", cardId: { type: "chosen", index: 0 }, keyword: "flying" },
    ]);
  });

  it("compiles a team pump until end of turn", () => {
    const compiled = compileOracleCard({
      oracleId: "charge",
      name: "Charge",
      manaCost: "{W}",
      typeLine: "Instant",
      oracleText: "Creatures you control get +1/+1 until end of turn.",
      power: null,
      toughness: null,
      printedKeywords: [],
    });
    expect(compiled.notes).toEqual([]);
    expect(compiled.definition.effects).toEqual([
      { kind: "team_pt_until_eot", playerId: "controller", power: 1, toughness: 1 },
    ]);
  });

  it("compiles a tribal keyword grant as a static ability", () => {
    const compiled = compileOracleCard({
      oracleId: "crystalline",
      name: "Crystalline Sliver",
      manaCost: "{W}{U}",
      typeLine: "Creature — Sliver",
      oracleText: "All Slivers have shroud.",
      power: "1",
      toughness: "1",
      printedKeywords: [],
    });
    expect(compiled.notes).toEqual([]);
    expect(compiled.definition.staticAbilities).toEqual([
      {
        selector: { scope: "all", subtypes: ["sliver"] },
        effect: { kind: "grant_keyword", keyword: "shroud" },
      },
    ]);
  });
});
