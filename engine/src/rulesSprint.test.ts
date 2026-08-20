import { describe, expect, it } from "vitest";
import {
  applyAction,
  applyEffect,
  compileOracleCard,
  createCardDefinition,
  createCardInstance,
  createGameState,
  isChosenTargetLegal,
  moveCard,
  putSpellOnStack,
  resolveTopOfStack,
} from "./index";
import { applyCombatDamage } from "./combat";
import { fillLibraries } from "./testSupport";
import { advanceSteps } from "./turn";
import type { GameState, PlayerState } from "./types";

function twoPlayers() {
  const game = createGameState({ playerCount: 2 });
  const p1 = game.players[0];
  const p2 = game.players[1];
  if (!p1 || !p2) {
    throw new Error("need players");
  }
  return { game, p1, p2 };
}

function addLandsInPlay(game: GameState, player: PlayerState, count: number): void {
  const forest = createCardDefinition({ name: "Forest", typeLine: "Basic Land — Forest" });
  game.definitions[forest.id] = forest;
  for (let i = 0; i < count; i += 1) {
    const card = createCardInstance({
      definitionId: forest.id,
      ownerId: player.id,
      zone: "battlefield",
    });
    game.cards[card.id] = card;
    player.zones.battlefield.push(card.id);
  }
}

function addHandCards(game: GameState, player: PlayerState, count: number): string[] {
  const island = createCardDefinition({ name: "Island", typeLine: "Basic Land — Island" });
  game.definitions[island.id] = island;
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const card = createCardInstance({
      definitionId: island.id,
      ownerId: player.id,
      zone: "hand",
    });
    game.cards[card.id] = card;
    player.zones.hand.push(card.id);
    ids.push(card.id);
  }
  return ids;
}

describe("CR 800.4a: caster eliminated mid-resolution", () => {
  // Fuzz seeds 676/783/801 (offset burns): a draw spell empties its caster's
  // library, the failed draw eliminates them inside applyEffects, and the
  // resolving card has already left the game — resolution must not throw
  // (it livelocked the table before this guard).
  it("resolves a spell whose own draw eliminates its caster", () => {
    const { game, p1, p2 } = twoPlayers();
    const drawDef = createCardDefinition({
      name: "Final Gambit",
      typeLine: "Sorcery",
      effects: [{ kind: "draw", playerId: "controller", count: 1 }],
    });
    game.definitions[drawDef.id] = drawDef;
    const spell = createCardInstance({ definitionId: drawDef.id, ownerId: p1.id, zone: "stack" });
    game.cards[spell.id] = spell;
    game.stack.push({
      id: "stack-gambit",
      kind: "spell",
      sourceId: spell.id,
      controllerId: p1.id,
      targets: [],
    });
    // p1's library is empty: the draw fails and the SBA eliminates p1
    // while their spell is still resolving.
    expect(p1.zones.library).toEqual([]);
    const resolved = resolveTopOfStack(game);
    expect(resolved.stack).toEqual([]);
    expect(resolved.players[0]?.lost).toBe(true);
    expect(resolved.cards[spell.id]?.zone).toBe("removed");
    expect(resolved.winnerId).toBe(p2.id);
  });
});

describe("slow and crowd lands", () => {
  it("compiles 'enters tapped unless you control two or fewer other lands'", () => {
    const compiled = compileOracleCard({
      oracleId: "slow-land",
      name: "Deserted Beach",
      manaCost: "",
      typeLine: "Land",
      oracleText:
        "Deserted Beach enters tapped unless you control two or fewer other lands.\n{T}: Add {W} or {U}.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(compiled.notes).toEqual([]);
    expect(compiled.definition.replacements).toEqual([
      { kind: "enters_tapped_unless", unless: { kind: "other_lands_at_most", count: 2 } },
    ]);
  });

  it("slow land enters untapped early and tapped once a fourth land arrives", () => {
    const { game, p1 } = twoPlayers();
    const slowDef = createCardDefinition({
      name: "Deserted Beach",
      typeLine: "Land",
      replacements: [
        { kind: "enters_tapped_unless", unless: { kind: "other_lands_at_most", count: 2 } },
      ],
    });
    game.definitions[slowDef.id] = slowDef;
    addLandsInPlay(game, p1, 2);
    const early = createCardInstance({ definitionId: slowDef.id, ownerId: p1.id, zone: "hand" });
    game.cards[early.id] = early;
    p1.zones.hand.push(early.id);
    const untapped = moveCard(game, early.id, "battlefield");
    expect(untapped.cards[early.id]?.tapped).toBe(false);

    addLandsInPlay(game, p1, 1);
    const late = createCardInstance({ definitionId: slowDef.id, ownerId: p1.id, zone: "hand" });
    game.cards[late.id] = late;
    p1.zones.hand.push(late.id);
    const tapped = moveCard(game, late.id, "battlefield");
    expect(tapped.cards[late.id]?.tapped).toBe(true);
  });

  it("compiles and applies 'enters tapped unless you have two or more opponents'", () => {
    const compiled = compileOracleCard({
      oracleId: "crowd-land",
      name: "Spire Garden",
      manaCost: "",
      typeLine: "Land",
      oracleText:
        "Spire Garden enters tapped unless you have two or more opponents.\n{T}: Add {R} or {G}.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(compiled.notes).toEqual([]);
    expect(compiled.definition.replacements).toEqual([
      { kind: "enters_tapped_unless", unless: { kind: "opponents", count: 2 } },
    ]);

    const duel = createGameState({ playerCount: 2 });
    const fourPlayer = createGameState({ playerCount: 4 });
    for (const game of [duel, fourPlayer]) {
      const player = game.players[0];
      if (!player) {
        throw new Error("need player");
      }
      game.definitions[compiled.definition.id] = compiled.definition;
      const card = createCardInstance({
        definitionId: compiled.definition.id,
        ownerId: player.id,
        zone: "hand",
      });
      game.cards[card.id] = card;
      player.zones.hand.push(card.id);
      const next = moveCard(game, card.id, "battlefield");
      expect(next.cards[card.id]?.tapped).toBe(game.players.length === 2);
    }
  });
});

describe("CR 514.1 cleanup hand-size discard", () => {
  it("prompts the active player to discard down to seven at cleanup", () => {
    const { game, p1 } = twoPlayers();
    fillLibraries(game);
    const handIds = addHandCards(game, p1, 9);
    const atCleanup = advanceSteps(game, 11);
    expect(atCleanup.turn.step).toBe("cleanup");
    const prompt = atCleanup.prompts[0];
    expect(prompt?.kind).toBe("choose_discard");
    if (prompt?.kind !== "choose_discard") {
      throw new Error("expected discard prompt");
    }
    // The draw step added a card, so the hand is 10: discard 3.
    expect(prompt.count).toBe(3);
    const discarded = applyAction(atCleanup, {
      kind: "resolve_discard",
      playerId: p1.id,
      cardIds: handIds.slice(0, 3),
    });
    expect(discarded.players[0]?.zones.hand.length).toBe(7);
    expect(discarded.players[0]?.zones.graveyard.length).toBe(3);
  });

  it("does not prompt while a no-maximum-hand-size permanent is controlled", () => {
    const { game, p1 } = twoPlayers();
    fillLibraries(game);
    addHandCards(game, p1, 9);
    const tower = createCardDefinition({
      name: "Reliquary Tower",
      typeLine: "Land",
      noMaxHandSize: true,
    });
    const towerCard = createCardInstance({
      definitionId: tower.id,
      ownerId: p1.id,
      zone: "battlefield",
    });
    game.definitions[tower.id] = tower;
    game.cards[towerCard.id] = towerCard;
    p1.zones.battlefield.push(towerCard.id);
    const atCleanup = advanceSteps(game, 11);
    expect(atCleanup.turn.step).toBe("cleanup");
    expect(atCleanup.prompts).toEqual([]);
  });

  it("compiles 'You have no maximum hand size.'", () => {
    const compiled = compileOracleCard({
      oracleId: "tower",
      name: "Reliquary Tower",
      manaCost: "",
      typeLine: "Land",
      oracleText: "You have no maximum hand size.\n{T}: Add {C}.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(compiled.notes).toEqual([]);
    expect(compiled.definition.noMaxHandSize).toBe(true);
  });
});

describe("extra land drops", () => {
  it("compiles 'You may play an additional land on each of your turns.'", () => {
    const compiled = compileOracleCard({
      oracleId: "exploration",
      name: "Exploration",
      manaCost: "{G}",
      typeLine: "Enchantment",
      oracleText: "You may play an additional land on each of your turns.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(compiled.notes).toEqual([]);
    expect(compiled.definition.extraLandDrops).toBe(1);
  });

  it("allows a second land drop with Exploration and stops at the third", () => {
    const { game, p1 } = twoPlayers();
    fillLibraries(game);
    const exploration = createCardDefinition({
      name: "Exploration",
      typeLine: "Enchantment",
      extraLandDrops: 1,
    });
    const enchant = createCardInstance({
      definitionId: exploration.id,
      ownerId: p1.id,
      zone: "battlefield",
    });
    game.definitions[exploration.id] = exploration;
    game.cards[enchant.id] = enchant;
    p1.zones.battlefield.push(enchant.id);
    const lands = addHandCards(game, p1, 3);
    const ready = advanceSteps(game, 3);
    const first = applyAction(ready, { kind: "play_land", playerId: p1.id, cardId: lands[0]! });
    const second = applyAction(first, { kind: "play_land", playerId: p1.id, cardId: lands[1]! });
    expect(second.players[0]?.landsPlayedThisTurn).toBe(2);
    expect(() =>
      applyAction(second, { kind: "play_land", playerId: p1.id, cardId: lands[2]! }),
    ).toThrow(/No land drops remain/);
  });
});

describe("this spell can't be countered", () => {
  it("compiles the line and survives a counterspell on the stack", () => {
    const compiled = compileOracleCard({
      oracleId: "decay",
      name: "Abrupt Decay",
      manaCost: "{B}{G}",
      typeLine: "Instant",
      oracleText:
        "This spell can't be countered.\nDestroy target noncreature, nonland permanent with mana value 3 or less.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(compiled.definition.cantBeCountered).toBe(true);

    const { game, p1 } = twoPlayers();
    const decayDef = createCardDefinition({
      name: "Abrupt Decay",
      typeLine: "Instant",
      manaCost: "{B}{G}",
      cantBeCountered: true,
    });
    const decay = createCardInstance({ definitionId: decayDef.id, ownerId: p1.id, zone: "stack" });
    game.definitions[decayDef.id] = decayDef;
    game.cards[decay.id] = decay;
    game.stack.push({
      id: "stack-decay",
      kind: "spell",
      sourceId: decay.id,
      controllerId: p1.id,
      targets: [],
    });
    const next = applyEffect(game, { kind: "counter_spell", stackObjectId: "stack-decay" });
    expect(next.stack).toHaveLength(1);
    expect(next.cards[decay.id]?.zone).toBe("stack");
  });
});

describe("board wipes", () => {
  it("compiles Wrath of God including the inert regeneration denial", () => {
    const compiled = compileOracleCard({
      oracleId: "wrath",
      name: "Wrath of God",
      manaCost: "{2}{W}{W}",
      typeLine: "Sorcery",
      oracleText: "Destroy all creatures. They can't be regenerated.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(compiled.notes).toEqual([]);
    expect(compiled.definition.effects).toEqual([{ kind: "destroy_all", what: "creatures" }]);
  });

  it("destroys every creature at once but spares indestructible ones", () => {
    const { game, p1, p2 } = twoPlayers();
    const bear = createCardDefinition({
      name: "Bear",
      typeLine: "Creature — Bear",
      power: 2,
      toughness: 2,
    });
    const golem = createCardDefinition({
      name: "Darksteel Golem",
      typeLine: "Artifact Creature — Golem",
      power: 3,
      toughness: 3,
      keywords: ["indestructible"],
    });
    game.definitions[bear.id] = bear;
    game.definitions[golem.id] = golem;
    const mine = createCardInstance({ definitionId: bear.id, ownerId: p1.id, zone: "battlefield" });
    const theirs = createCardInstance({ definitionId: bear.id, ownerId: p2.id, zone: "battlefield" });
    const tough = createCardInstance({ definitionId: golem.id, ownerId: p2.id, zone: "battlefield" });
    for (const card of [mine, theirs, tough]) {
      game.cards[card.id] = card;
      game.players.find((p) => p.id === card.ownerId)!.zones.battlefield.push(card.id);
    }
    const swept = applyEffect(game, { kind: "destroy_all", what: "creatures" });
    expect(swept.cards[mine.id]?.zone).toBe("graveyard");
    expect(swept.cards[theirs.id]?.zone).toBe("graveyard");
    expect(swept.cards[tough.id]?.zone).toBe("battlefield");
  });
});

describe("creature-or-planeswalker removal", () => {
  it("compiles Hero's Downfall and hits either permanent type", () => {
    const compiled = compileOracleCard({
      oracleId: "downfall",
      name: "Hero's Downfall",
      manaCost: "{1}{B}{B}",
      typeLine: "Instant",
      oracleText: "Destroy target creature or planeswalker.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(compiled.notes).toEqual([]);
    expect(compiled.definition.targetRequirements).toEqual([{ kind: "creature_or_planeswalker" }]);

    const { game, p1, p2 } = twoPlayers();
    const walkerDef = createCardDefinition({
      name: "Test Walker",
      typeLine: "Legendary Planeswalker — Test",
      loyalty: 3,
    });
    const rockDef = createCardDefinition({ name: "Mind Stone", typeLine: "Artifact" });
    game.definitions[walkerDef.id] = walkerDef;
    game.definitions[rockDef.id] = rockDef;
    const walker = createCardInstance({
      definitionId: walkerDef.id,
      ownerId: p2.id,
      zone: "battlefield",
    });
    const rock = createCardInstance({ definitionId: rockDef.id, ownerId: p2.id, zone: "battlefield" });
    for (const card of [walker, rock]) {
      game.cards[card.id] = card;
      p2.zones.battlefield.push(card.id);
    }
    const requirement = { kind: "creature_or_planeswalker" as const };
    expect(
      isChosenTargetLegal(game, requirement, { type: "creature", cardId: walker.id }, p1.id),
    ).toBe(true);
    expect(
      isChosenTargetLegal(game, requirement, { type: "creature", cardId: rock.id }, p1.id),
    ).toBe(false);
  });
});

describe("own-graveyard recursion", () => {
  it("compiles Regrowth and Zombify shapes and resolves the return", () => {
    const regrowth = compileOracleCard({
      oracleId: "regrowth",
      name: "Regrowth",
      manaCost: "{1}{G}",
      typeLine: "Sorcery",
      oracleText: "Return target card from your graveyard to your hand.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(regrowth.notes).toEqual([]);
    expect(regrowth.definition.targetRequirements).toEqual([{ kind: "own_graveyard_card" }]);

    const zombify = compileOracleCard({
      oracleId: "zombify",
      name: "Zombify",
      manaCost: "{3}{B}",
      typeLine: "Sorcery",
      oracleText: "Return target creature card from your graveyard to the battlefield.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(zombify.notes).toEqual([]);
    expect(zombify.definition.targetRequirements).toEqual([
      { kind: "own_graveyard_creature_card" },
    ]);

    const { game, p1 } = twoPlayers();
    const bear = createCardDefinition({
      name: "Bear",
      typeLine: "Creature — Bear",
      power: 2,
      toughness: 2,
    });
    const sorcery = createCardDefinition({ name: "Dead Spell", typeLine: "Sorcery" });
    game.definitions[bear.id] = bear;
    game.definitions[sorcery.id] = sorcery;
    const deadBear = createCardInstance({ definitionId: bear.id, ownerId: p1.id, zone: "graveyard" });
    const deadSpell = createCardInstance({
      definitionId: sorcery.id,
      ownerId: p1.id,
      zone: "graveyard",
    });
    game.cards[deadBear.id] = deadBear;
    game.cards[deadSpell.id] = deadSpell;
    p1.zones.graveyard.push(deadBear.id, deadSpell.id);

    const requirement = { kind: "own_graveyard_creature_card" as const };
    expect(
      isChosenTargetLegal(game, requirement, { type: "creature", cardId: deadBear.id }, p1.id),
    ).toBe(true);
    expect(
      isChosenTargetLegal(game, requirement, { type: "creature", cardId: deadSpell.id }, p1.id),
    ).toBe(false);

    const returned = applyEffect(game, {
      kind: "move_card",
      cardId: deadBear.id,
      toZone: "battlefield",
    });
    expect(returned.cards[deadBear.id]?.zone).toBe("battlefield");
    expect(returned.cards[deadBear.id]?.summoningSick).toBe(true);
  });
});

describe("library-top tutors", () => {
  it("compiles Mystical and Vampiric Tutor and stacks the pick on top", () => {
    const mystical = compileOracleCard({
      oracleId: "mystical",
      name: "Mystical Tutor",
      manaCost: "{U}",
      typeLine: "Instant",
      oracleText:
        "Search your library for an instant or sorcery card, reveal it, then shuffle and put the card on top of your library.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(mystical.notes).toEqual([]);
    expect(mystical.definition.effects[0]).toMatchObject({
      kind: "search_library",
      destination: "library_top",
      filter: { typesAny: ["instant", "sorcery"] },
    });

    const vampiric = compileOracleCard({
      oracleId: "vampiric",
      name: "Vampiric Tutor",
      manaCost: "{B}",
      typeLine: "Instant",
      oracleText:
        "Search your library for a card, then shuffle and put that card on top of your library. You lose 2 life.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(vampiric.notes).toEqual([]);
    expect(vampiric.definition.effects).toHaveLength(2);

    const { game, p1 } = twoPlayers();
    fillLibraries(game, 5);
    const targetId = p1.zones.library[3]!;
    const prompted = applyEffect(game, {
      kind: "search_library",
      playerId: p1.id,
      filter: {},
      destination: "library_top",
      count: 1,
    });
    const resolved = applyAction(prompted, {
      kind: "resolve_search",
      playerId: p1.id,
      cardIds: [targetId],
    });
    expect(resolved.players[0]?.zones.library[0]).toBe(targetId);
    expect(resolved.players[0]?.zones.library).toHaveLength(5);
  });

  it("any-of search filters distinguish types from subtypes", () => {
    const { game, p1 } = twoPlayers();
    const island = createCardDefinition({ name: "Island", typeLine: "Basic Land — Island" });
    const bolt = createCardDefinition({ name: "Bolt", typeLine: "Instant", manaCost: "{R}" });
    game.definitions[island.id] = island;
    game.definitions[bolt.id] = bolt;
    const landCard = createCardInstance({ definitionId: island.id, ownerId: p1.id, zone: "library" });
    const boltCard = createCardInstance({ definitionId: bolt.id, ownerId: p1.id, zone: "library" });
    game.cards[landCard.id] = landCard;
    game.cards[boltCard.id] = boltCard;
    p1.zones.library.push(landCard.id, boltCard.id);
    const prompted = applyEffect(game, {
      kind: "search_library",
      playerId: p1.id,
      filter: { typesAny: ["instant", "sorcery"] },
      destination: "hand",
      count: 1,
    });
    expect(() =>
      applyAction(prompted, { kind: "resolve_search", playerId: p1.id, cardIds: [landCard.id] }),
    ).toThrow(/does not match/);
    const found = applyAction(prompted, {
      kind: "resolve_search",
      playerId: p1.id,
      cardIds: [boltCard.id],
    });
    expect(found.players[0]?.zones.hand).toContain(boltCard.id);
  });
});

describe("additional casting costs", () => {
  it("compiles Deadly Dispute and pays the sacrifice at cast", () => {
    const compiled = compileOracleCard({
      oracleId: "dispute",
      name: "Deadly Dispute",
      manaCost: "{1}{B}",
      typeLine: "Instant",
      oracleText:
        "As an additional cost to cast this spell, sacrifice an artifact or creature.\nDraw two cards and create a Treasure token.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(compiled.notes).toEqual([]);
    expect(compiled.definition.additionalCost).toEqual({ sacrifice: "creature_or_artifact" });
    expect(compiled.definition.effects[0]).toMatchObject({ kind: "draw", count: 2 });
    expect(compiled.definition.effects[1]).toMatchObject({ kind: "create_token", name: "Treasure" });

    const { game, p1 } = twoPlayers();
    fillLibraries(game);
    game.definitions[compiled.definition.id] = compiled.definition;
    const spell = createCardInstance({
      definitionId: compiled.definition.id,
      ownerId: p1.id,
      zone: "hand",
    });
    game.cards[spell.id] = spell;
    p1.zones.hand.push(spell.id);
    const bear = createCardDefinition({
      name: "Bear",
      typeLine: "Creature — Bear",
      power: 2,
      toughness: 2,
    });
    game.definitions[bear.id] = bear;
    const fodder = createCardInstance({ definitionId: bear.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[fodder.id] = fodder;
    p1.zones.battlefield.push(fodder.id);
    game.players[0]!.mana.B = 1;
    game.players[0]!.mana.C = 1;
    game.priorityPlayerId = p1.id;

    // Without naming the sacrifice, the cast is refused.
    expect(() =>
      applyAction(game, { kind: "cast_spell", playerId: p1.id, cardId: spell.id, targets: [] }),
    ).toThrow(/Sacrifice a/);

    const cast = applyAction(game, {
      kind: "cast_spell",
      playerId: p1.id,
      cardId: spell.id,
      targets: [],
      costSacrificeId: fodder.id,
    });
    expect(cast.cards[fodder.id]?.zone).toBe("graveyard");
    expect(cast.stack).toHaveLength(1);
  });

  it("discard costs consume distinct hand cards", () => {
    const { game, p1 } = twoPlayers();
    fillLibraries(game);
    const bigScore = createCardDefinition({
      name: "Big Score",
      typeLine: "Instant",
      manaCost: "{3}{R}",
      additionalCost: { discard: 1 },
      effects: [{ kind: "draw", playerId: "controller", count: 2 }],
    });
    game.definitions[bigScore.id] = bigScore;
    const spell = createCardInstance({ definitionId: bigScore.id, ownerId: p1.id, zone: "hand" });
    game.cards[spell.id] = spell;
    p1.zones.hand.push(spell.id);
    const extra = addHandCards(game, p1, 1);
    game.players[0]!.mana.R = 1;
    game.players[0]!.mana.C = 3;
    game.priorityPlayerId = p1.id;
    const cast = applyAction(game, {
      kind: "cast_spell",
      playerId: p1.id,
      cardId: spell.id,
      targets: [],
      costDiscardIds: extra,
    });
    expect(cast.cards[extra[0]!]?.zone).toBe("graveyard");
    expect(cast.stack).toHaveLength(1);
  });
});

describe("pay-or-effect taxes", () => {
  it("compiles Rhystic Study and taxes the caster", () => {
    const compiled = compileOracleCard({
      oracleId: "rhystic",
      name: "Rhystic Study",
      manaCost: "{2}{U}",
      typeLine: "Enchantment",
      oracleText:
        "Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(compiled.notes).toEqual([]);
    expect(compiled.definition.triggers[0]).toMatchObject({
      event: "cast_spell",
      watch: "opponents",
    });
    expect(compiled.definition.triggers[0]?.effects[0]).toMatchObject({
      kind: "unless_pays",
      playerId: { type: "subject_player" },
      cost: "{1}",
    });

    const { game, p1, p2 } = twoPlayers();
    fillLibraries(game);
    game.definitions[compiled.definition.id] = compiled.definition;
    const study = createCardInstance({
      definitionId: compiled.definition.id,
      ownerId: p1.id,
      zone: "battlefield",
    });
    game.cards[study.id] = study;
    p1.zones.battlefield.push(study.id);
    const spellDef = createCardDefinition({ name: "Test Sorcery", typeLine: "Sorcery" });
    game.definitions[spellDef.id] = spellDef;
    const spell = createCardInstance({ definitionId: spellDef.id, ownerId: p2.id, zone: "hand" });
    game.cards[spell.id] = spell;
    p2.zones.hand.push(spell.id);

    // p2 casts: the Rhystic trigger goes on the stack above the spell.
    const cast = putSpellOnStack(game, spell.id);
    expect(cast.stack).toHaveLength(2);
    const resolvedTrigger = resolveTopOfStack(cast);
    const prompt = resolvedTrigger.prompts[0];
    expect(prompt?.kind).toBe("pay_or_effect");
    expect(prompt?.playerId).toBe(p2.id);

    // Declining hands p1 the card.
    const declined = applyAction(resolvedTrigger, {
      kind: "resolve_pay",
      playerId: p2.id,
      pay: false,
    });
    expect(declined.players[0]?.zones.hand).toHaveLength(1);

    // Paying {1} keeps the card off p1's hand.
    resolvedTrigger.players[1]!.mana.C = 1;
    const paid = applyAction(resolvedTrigger, { kind: "resolve_pay", playerId: p2.id, pay: true });
    expect(paid.players[0]?.zones.hand).toHaveLength(0);
    expect(paid.players[1]?.mana.C).toBe(0);
  });

  it("compiles Smothering Tithe's opponent-draw Treasure tax", () => {
    const compiled = compileOracleCard({
      oracleId: "tithe",
      name: "Smothering Tithe",
      manaCost: "{3}{W}",
      typeLine: "Enchantment",
      oracleText:
        "Whenever an opponent draws a card, that player may pay {2}. If they don't, you create a Treasure token.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(compiled.notes).toEqual([]);
    const trigger = compiled.definition.triggers[0];
    expect(trigger?.event).toBe("opponent_draws");
    expect(trigger?.effects[0]).toMatchObject({
      kind: "unless_pays",
      cost: "{2}",
    });

    const { game, p1, p2 } = twoPlayers();
    fillLibraries(game);
    game.definitions[compiled.definition.id] = compiled.definition;
    const tithe = createCardInstance({
      definitionId: compiled.definition.id,
      ownerId: p1.id,
      zone: "battlefield",
    });
    game.cards[tithe.id] = tithe;
    p1.zones.battlefield.push(tithe.id);

    const afterDraw = applyEffect(game, { kind: "draw", playerId: p2.id, count: 1 });
    expect(afterDraw.stack).toHaveLength(1);
    const resolved = resolveTopOfStack(afterDraw);
    expect(resolved.prompts[0]?.kind).toBe("pay_or_effect");
    const declined = applyAction(resolved, { kind: "resolve_pay", playerId: p2.id, pay: false });
    const treasure = declined.players[0]!.zones.battlefield
      .map((id) => declined.definitions[declined.cards[id]!.definitionId]!.name)
      .filter((name) => name === "Treasure");
    expect(treasure).toHaveLength(1);
  });
});

describe("wave 10: looks, hydras, graveyard lands", () => {
  it("compiles Impulse into a look-and-assign", () => {
    const compiled = compileOracleCard({
      oracleId: "impulse",
      name: "Impulse",
      manaCost: "{1}{U}",
      typeLine: "Instant",
      oracleText:
        "Look at the top four cards of your library. Put one of them into your hand and the rest on the bottom of your library in any order.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(compiled.notes).toEqual([]);
    expect(compiled.definition.effects).toEqual([
      {
        kind: "look_and_assign",
        playerId: "controller",
        count: 4,
        destinations: ["hand", "library_bottom", "library_bottom", "library_bottom"],
      },
    ]);
  });

  it("an X hydra enters with X +1/+1 counters", () => {
    const compiled = compileOracleCard({
      oracleId: "hydra",
      name: "Hydra Broodmaster Jr",
      manaCost: "{X}{G}",
      typeLine: "Creature — Hydra",
      oracleText: "Hydra Broodmaster Jr enters with X +1/+1 counters on it.",
      power: "0",
      toughness: "0",
      printedKeywords: [],
      imageUrl: "",
    });
    expect(compiled.notes).toEqual([]);
    expect(compiled.definition.entersWithXCounters).toBe(true);

    const { game, p1 } = twoPlayers();
    game.definitions[compiled.definition.id] = compiled.definition;
    const hydra = createCardInstance({
      definitionId: compiled.definition.id,
      ownerId: p1.id,
      zone: "stack",
    });
    game.cards[hydra.id] = hydra;
    game.stack.push({
      id: "stack-hydra",
      kind: "spell",
      sourceId: hydra.id,
      controllerId: p1.id,
      targets: [],
      xValue: 3,
    });
    const resolved = resolveTopOfStack(game);
    expect(resolved.cards[hydra.id]?.zone).toBe("battlefield");
    expect(resolved.cards[hydra.id]?.counters["p1p1"]).toBe(3);
  });

  it("Crucible of Worlds allows land plays from the graveyard", () => {
    const { game, p1 } = twoPlayers();
    fillLibraries(game);
    const crucible = createCardDefinition({
      name: "Crucible of Worlds",
      typeLine: "Artifact",
      playLandsFromGraveyard: true,
    });
    const forest = createCardDefinition({ name: "Forest", typeLine: "Basic Land — Forest" });
    game.definitions[crucible.id] = crucible;
    game.definitions[forest.id] = forest;
    const crucibleCard = createCardInstance({
      definitionId: crucible.id,
      ownerId: p1.id,
      zone: "battlefield",
    });
    const deadLand = createCardInstance({ definitionId: forest.id, ownerId: p1.id, zone: "graveyard" });
    game.cards[crucibleCard.id] = crucibleCard;
    game.cards[deadLand.id] = deadLand;
    p1.zones.battlefield.push(crucibleCard.id);
    p1.zones.graveyard.push(deadLand.id);
    const ready = advanceSteps(game, 3);
    const played = applyAction(ready, { kind: "play_land", playerId: p1.id, cardId: deadLand.id });
    expect(played.cards[deadLand.id]?.zone).toBe("battlefield");
  });
});

describe("optional draws", () => {
  it("compiles Bident of Thassa's saboteur draw and guards empty libraries", () => {
    const compiled = compileOracleCard({
      oracleId: "bident",
      name: "Bident of Thassa",
      manaCost: "{2}{U}{U}",
      typeLine: "Legendary Enchantment Artifact",
      oracleText:
        "Whenever a creature you control deals combat damage to a player, you may draw a card.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(compiled.notes).toEqual([]);
    expect(compiled.definition.triggers[0]?.effects).toEqual([
      { kind: "draw", playerId: "controller", count: 1, optional: true },
    ]);

    const { game, p1 } = twoPlayers();
    // Empty library: the optional draw declines instead of decking the player.
    const skipped = applyEffect(game, {
      kind: "draw",
      playerId: p1.id,
      count: 1,
      optional: true,
    });
    expect(skipped.players[0]?.failedToDraw).toBe(false);
    expect(skipped.players[0]?.lost).toBe(false);
  });
});

describe("combat damage triggers", () => {
  it("compiles the saboteur head and fires on an unblocked hit", () => {
    const compiled = compileOracleCard({
      oracleId: "saboteur",
      name: "Thieving Skydiver",
      manaCost: "{1}{U}",
      typeLine: "Creature — Merfolk Rogue",
      oracleText: "Whenever Thieving Skydiver deals combat damage to a player, draw a card.",
      power: "2",
      toughness: "1",
      printedKeywords: [],
      imageUrl: "",
    });
    expect(compiled.notes).toEqual([]);
    expect(compiled.definition.triggers[0]).toMatchObject({
      event: "deals_combat_damage_to_player",
    });

    const { game, p1, p2 } = twoPlayers();
    fillLibraries(game);
    game.definitions[compiled.definition.id] = compiled.definition;
    const raider = createCardInstance({
      definitionId: compiled.definition.id,
      ownerId: p1.id,
      zone: "battlefield",
    });
    game.cards[raider.id] = raider;
    p1.zones.battlefield.push(raider.id);
    game.combat = {
      attacks: [{ attackerId: raider.id, defenderId: p2.id }],
      blockers: {},
      attackersDeclared: true,
      declaredBlockersFor: [p2.id],
    };
    const afterDamage = applyCombatDamage(game);
    expect(afterDamage.players[1]?.life).toBe(38);
    expect(afterDamage.stack).toHaveLength(1);
    const resolved = resolveTopOfStack(afterDamage);
    // The hand starts empty in this synthetic setup; the saboteur draw adds one.
    expect(resolved.players[0]?.zones.hand).toHaveLength(1);
  });
});

describe("choose a creature type", () => {
  it("compiles Kindred Discovery and Vanquisher's Banner cleanly", () => {
    const discovery = compileOracleCard({
      oracleId: "kindred",
      name: "Kindred Discovery",
      manaCost: "{3}{U}{U}",
      typeLine: "Enchantment",
      oracleText:
        "As Kindred Discovery enters, choose a creature type.\nWhenever a creature you control of the chosen type enters or attacks, draw a card.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(discovery.notes).toEqual([]);
    expect(discovery.definition.chooseCreatureTypeOnEnter).toBe(true);
    expect(discovery.definition.triggers).toHaveLength(2);
    expect(discovery.definition.triggers.map((trigger) => trigger.event)).toEqual([
      "enter_battlefield",
      "attacks",
    ]);

    const banner = compileOracleCard({
      oracleId: "banner",
      name: "Vanquisher's Banner",
      manaCost: "{5}",
      typeLine: "Artifact",
      oracleText:
        "As Vanquisher's Banner enters, choose a creature type.\nCreature spells you cast cost {1} less to cast.\nCreatures you control of the chosen type get +1/+1.\nWhenever you cast a creature spell of the chosen type, draw a card.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(banner.notes).toEqual([]);
    expect(banner.definition.costReductions).toHaveLength(1);
    expect(banner.definition.staticAbilities[0]?.selector.chosenSubtype).toBe(true);
  });

  it("prompts on entry, records the choice, and gates the tribal trigger", () => {
    const { game, p1 } = twoPlayers();
    fillLibraries(game);
    const kindredDef = createCardDefinition({
      name: "Kindred Idol",
      typeLine: "Enchantment",
      chooseCreatureTypeOnEnter: true,
      triggers: [
        {
          event: "enter_battlefield",
          watch: "controlled",
          subjectFilter: { types: ["creature"], chosenSubtype: true },
          effects: [{ kind: "draw", playerId: "controller", count: 1 }],
          targetRequirements: [],
        },
      ],
    });
    game.definitions[kindredDef.id] = kindredDef;
    const idol = createCardInstance({ definitionId: kindredDef.id, ownerId: p1.id, zone: "hand" });
    game.cards[idol.id] = idol;
    p1.zones.hand.push(idol.id);
    const entered = moveCard(game, idol.id, "battlefield");
    expect(entered.prompts[0]?.kind).toBe("choose_creature_type");

    const chosen = applyAction(entered, {
      kind: "resolve_creature_type",
      playerId: p1.id,
      creatureType: "Sliver",
    });
    expect(chosen.cards[idol.id]?.chosenCreatureType).toBe("sliver");

    const sliver = createCardDefinition({
      name: "Metallic Sliver",
      typeLine: "Artifact Creature — Sliver",
      power: 1,
      toughness: 1,
    });
    const bear = createCardDefinition({
      name: "Bear",
      typeLine: "Creature — Bear",
      power: 2,
      toughness: 2,
    });
    chosen.definitions[sliver.id] = sliver;
    chosen.definitions[bear.id] = bear;
    const bearCard = createCardInstance({ definitionId: bear.id, ownerId: p1.id, zone: "hand" });
    chosen.cards[bearCard.id] = bearCard;
    chosen.players[0]!.zones.hand.push(bearCard.id);
    const bearEntered = moveCard(chosen, bearCard.id, "battlefield");
    expect(bearEntered.stack).toHaveLength(0);

    const sliverCard = createCardInstance({ definitionId: sliver.id, ownerId: p1.id, zone: "hand" });
    bearEntered.cards[sliverCard.id] = sliverCard;
    bearEntered.players[0]!.zones.hand.push(sliverCard.id);
    const sliverEntered = moveCard(bearEntered, sliverCard.id, "battlefield");
    expect(sliverEntered.stack).toHaveLength(1);
  });
});

describe("once-per-turn triggers", () => {
  it("compiles Morbid Opportunist and fires only once a turn", () => {
    const compiled = compileOracleCard({
      oracleId: "morbid",
      name: "Morbid Opportunist",
      manaCost: "{2}{B}",
      typeLine: "Creature — Human Rogue",
      oracleText:
        "Whenever one or more creatures die, draw a card. This ability triggers only once each turn.",
      power: "1",
      toughness: "3",
      printedKeywords: [],
      imageUrl: "",
    });
    expect(compiled.notes).toEqual([]);
    expect(compiled.definition.triggers[0]).toMatchObject({
      event: "dies",
      watch: "any",
      oncePerTurn: true,
    });

    const { game, p1, p2 } = twoPlayers();
    fillLibraries(game);
    const watcherDef = createCardDefinition({
      name: "Opportunist Idol",
      typeLine: "Enchantment",
      triggers: [
        {
          event: "dies",
          watch: "any",
          subjectFilter: { types: ["creature"] },
          oncePerTurn: true,
          effects: [{ kind: "draw", playerId: "controller", count: 1 }],
          targetRequirements: [],
        },
      ],
    });
    game.definitions[watcherDef.id] = watcherDef;
    const watcher = createCardInstance({
      definitionId: watcherDef.id,
      ownerId: p1.id,
      zone: "battlefield",
    });
    game.cards[watcher.id] = watcher;
    p1.zones.battlefield.push(watcher.id);
    const bear = createCardDefinition({
      name: "Bear",
      typeLine: "Creature — Bear",
      power: 2,
      toughness: 2,
    });
    game.definitions[bear.id] = bear;
    const addBear = (target: GameState) => {
      const card = createCardInstance({ definitionId: bear.id, ownerId: p2.id, zone: "battlefield" });
      target.cards[card.id] = card;
      target.players[1]!.zones.battlefield.push(card.id);
    };
    addBear(game);
    const swept = applyEffect(game, { kind: "destroy_all", what: "creatures" });
    expect(swept.stack).toHaveLength(1);
    // A second creature death the same turn does not queue another copy.
    addBear(swept);
    const secondSweep = applyEffect(swept, { kind: "destroy_all", what: "creatures" });
    expect(secondSweep.stack).toHaveLength(1);
  });
});

describe("cycling and small statics", () => {
  it("compiles Cycling into a from-hand discard ability", () => {
    const compiled = compileOracleCard({
      oracleId: "triome",
      name: "Zagoth Triome",
      manaCost: "",
      typeLine: "Land — Swamp Forest Island",
      oracleText: "Zagoth Triome enters tapped.\nCycling {3}",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(compiled.notes).toEqual([]);
    expect(compiled.definition.activated[0]).toMatchObject({
      zone: "hand",
      discard: true,
      manaCost: "{3}",
      effects: [{ kind: "draw", playerId: "controller", count: 1 }],
    });
  });

  it("compiles '~ can't block' as a self restriction", () => {
    const compiled = compileOracleCard({
      oracleId: "juggernaut-ish",
      name: "Test Bruiser",
      manaCost: "{3}{R}",
      typeLine: "Creature — Ogre",
      oracleText: "Test Bruiser can't block.",
      power: "5",
      toughness: "3",
      printedKeywords: [],
      imageUrl: "",
    });
    expect(compiled.notes).toEqual([]);
    expect(compiled.definition.staticAbilities).toEqual([
      { selector: { scope: "self" }, effect: { kind: "restrict", cantBlock: true } },
    ]);
  });
});

describe("cost-reduction statics", () => {
  it("compiles medallions and artifact discounts", () => {
    const medallion = compileOracleCard({
      oracleId: "ruby",
      name: "Ruby Medallion",
      manaCost: "{2}",
      typeLine: "Artifact",
      oracleText: "Red spells you cast cost {1} less to cast.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(medallion.notes).toEqual([]);
    expect(medallion.definition.costReductions).toEqual([
      { generic: 1, filter: { colors: ["R"] } },
    ]);

    const inspector = compileOracleCard({
      oracleId: "foundry",
      name: "Foundry Inspector",
      manaCost: "{3}",
      typeLine: "Artifact Creature — Construct",
      oracleText: "Artifact spells you cast cost {1} less to cast.",
      power: "3",
      toughness: "2",
      printedKeywords: [],
      imageUrl: "",
    });
    expect(inspector.notes).toEqual([]);
    expect(inspector.definition.costReductions).toEqual([
      { generic: 1, filter: { types: ["artifact"] } },
    ]);
  });

  it("reduces the generic cost when casting a matching spell", () => {
    const { game, p1 } = twoPlayers();
    fillLibraries(game);
    const inspector = createCardDefinition({
      name: "Foundry Inspector",
      typeLine: "Artifact Creature — Construct",
      power: 3,
      toughness: 2,
      costReductions: [{ generic: 1, filter: { types: ["artifact"] } }],
    });
    const rock = createCardDefinition({ name: "Mind Stone", typeLine: "Artifact", manaCost: "{2}" });
    game.definitions[inspector.id] = inspector;
    game.definitions[rock.id] = rock;
    const inspectorCard = createCardInstance({
      definitionId: inspector.id,
      ownerId: p1.id,
      zone: "battlefield",
    });
    const rockCard = createCardInstance({ definitionId: rock.id, ownerId: p1.id, zone: "hand" });
    game.cards[inspectorCard.id] = inspectorCard;
    game.cards[rockCard.id] = rockCard;
    p1.zones.battlefield.push(inspectorCard.id);
    p1.zones.hand.push(rockCard.id);

    const ready = advanceSteps(game, 3);
    ready.players[0]!.mana.C = 1;
    // {2} rock costs {1} with the Inspector out: one colorless is enough.
    const cast = applyAction(ready, {
      kind: "cast_spell",
      playerId: p1.id,
      cardId: rockCard.id,
      targets: [],
    });
    expect(cast.stack).toHaveLength(1);
    expect(cast.players[0]?.mana.C).toBe(0);
  });
});

describe("predefined artifact tokens", () => {
  it("compiles attack-for-Treasure triggers", () => {
    const compiled = compileOracleCard({
      oracleId: "prosperous",
      name: "Test Innkeeper",
      manaCost: "{1}{R}",
      typeLine: "Creature — Goblin Citizen",
      oracleText: "Whenever Test Innkeeper attacks, create a Treasure token.",
      power: "1",
      toughness: "2",
      printedKeywords: [],
      imageUrl: "",
    });
    expect(compiled.notes).toEqual([]);
    expect(compiled.definition.triggers[0]?.effects).toEqual([
      {
        kind: "create_token",
        ownerId: "controller",
        name: "Treasure",
        typeLine: "Artifact — Treasure Token",
        power: null,
        toughness: null,
      },
    ]);
  });

  it("a Treasure taps for any color and sacrifices itself", () => {
    const { game, p1 } = twoPlayers();
    const made = applyEffect(game, {
      kind: "create_token",
      ownerId: p1.id,
      name: "Treasure",
      typeLine: "Artifact — Treasure Token",
      power: null,
      toughness: null,
    });
    const treasureId = made.players[0]!.zones.battlefield[0]!;
    made.priorityPlayerId = p1.id;
    const tapped = applyAction(made, {
      kind: "tap_for_mana",
      playerId: p1.id,
      cardId: treasureId,
      color: "U",
    });
    expect(tapped.players[0]?.mana.U).toBe(1);
    // Sacrificed, and tokens cease to exist outside the battlefield.
    expect(tapped.players[0]?.zones.battlefield).toEqual([]);
  });

  it("a Clue pays two and sacrifices to draw", () => {
    const { game, p1 } = twoPlayers();
    fillLibraries(game);
    let next = applyEffect(game, {
      kind: "create_token",
      ownerId: p1.id,
      name: "Clue",
      typeLine: "Artifact — Clue Token",
      power: null,
      toughness: null,
    });
    const clueId = next.players[0]!.zones.battlefield[0]!;
    next.players[0]!.mana.C = 2;
    next.priorityPlayerId = p1.id;
    const cracked = applyAction(next, {
      kind: "activate_ability",
      playerId: p1.id,
      cardId: clueId,
      abilityIndex: 0,
      targets: [],
    });
    // The sacrifice happens on activation; the draw resolves from the stack.
    expect(cracked.players[0]?.zones.battlefield).toEqual([]);
  });
});

describe("cast triggers", () => {
  it("compiles the cast-trigger heads", () => {
    const compiled = compileOracleCard({
      oracleId: "guttersnipe",
      name: "Guttersnipe",
      manaCost: "{2}{R}",
      typeLine: "Creature — Goblin Shaman",
      oracleText:
        "Whenever you cast an instant or sorcery spell, Guttersnipe deals 2 damage to each opponent.",
      power: "2",
      toughness: "2",
      printedKeywords: [],
      imageUrl: "",
    });
    expect(compiled.notes).toEqual([]);
    expect(compiled.definition.triggers[0]).toMatchObject({
      event: "cast_spell",
      watch: "controlled",
      subjectFilter: { typesAny: ["instant", "sorcery"] },
    });
  });

  it("Guttersnipe pings opponents when its controller casts an instant", () => {
    const { game, p1 } = twoPlayers();
    const snipe = createCardDefinition({
      name: "Guttersnipe",
      typeLine: "Creature — Goblin Shaman",
      power: 2,
      toughness: 2,
      triggers: [
        {
          event: "cast_spell",
          watch: "controlled",
          subjectFilter: { typesAny: ["instant", "sorcery"] },
          effects: [
            {
              kind: "deal_damage",
              sourceId: "self",
              target: { type: "player", playerId: "each_opponent" },
              amount: 2,
            },
          ],
          targetRequirements: [],
        },
      ],
    });
    const bolt = createCardDefinition({ name: "Test Instant", typeLine: "Instant" });
    const rock = createCardDefinition({ name: "Test Rock", typeLine: "Artifact" });
    game.definitions[snipe.id] = snipe;
    game.definitions[bolt.id] = bolt;
    game.definitions[rock.id] = rock;
    const snipeCard = createCardInstance({ definitionId: snipe.id, ownerId: p1.id, zone: "battlefield" });
    const boltCard = createCardInstance({ definitionId: bolt.id, ownerId: p1.id, zone: "hand" });
    const rockCard = createCardInstance({ definitionId: rock.id, ownerId: p1.id, zone: "hand" });
    game.cards[snipeCard.id] = snipeCard;
    game.cards[boltCard.id] = boltCard;
    game.cards[rockCard.id] = rockCard;
    p1.zones.battlefield.push(snipeCard.id);
    p1.zones.hand.push(boltCard.id, rockCard.id);

    // Casting the artifact does not trip the instant-or-sorcery filter.
    const castRock = putSpellOnStack(game, rockCard.id);
    expect(castRock.stack).toHaveLength(1);

    const castBolt = putSpellOnStack(game, boltCard.id);
    // Spell + the cast trigger above it.
    expect(castBolt.stack).toHaveLength(2);
    const resolvedTrigger = resolveTopOfStack(castBolt);
    expect(resolvedTrigger.players[1]?.life).toBe(38);
    expect(resolvedTrigger.players[0]?.life).toBe(40);
  });

  it("opponent-cast triggers ignore the controller's own spells", () => {
    const { game, p1, p2 } = twoPlayers();
    const remora = createCardDefinition({
      name: "Test Remora",
      typeLine: "Enchantment",
      triggers: [
        {
          event: "cast_spell",
          watch: "opponents",
          effects: [{ kind: "draw", playerId: "controller", count: 1 }],
          targetRequirements: [],
        },
      ],
    });
    const spell = createCardDefinition({ name: "Test Sorcery", typeLine: "Sorcery" });
    game.definitions[remora.id] = remora;
    game.definitions[spell.id] = spell;
    const remoraCard = createCardInstance({ definitionId: remora.id, ownerId: p1.id, zone: "battlefield" });
    const mine = createCardInstance({ definitionId: spell.id, ownerId: p1.id, zone: "hand" });
    const theirs = createCardInstance({ definitionId: spell.id, ownerId: p2.id, zone: "hand" });
    game.cards[remoraCard.id] = remoraCard;
    game.cards[mine.id] = mine;
    game.cards[theirs.id] = theirs;
    p1.zones.battlefield.push(remoraCard.id);
    p1.zones.hand.push(mine.id);
    p2.zones.hand.push(theirs.id);

    expect(putSpellOnStack(game, mine.id).stack).toHaveLength(1);
    expect(putSpellOnStack(game, theirs.id).stack).toHaveLength(2);
  });
});

describe("artifact and enchantment removal targets", () => {
  it("compiles the destroy variants to the right target kinds", () => {
    const cases: Array<[string, string]> = [
      ["Destroy target artifact.", "artifact"],
      ["Destroy target enchantment.", "enchantment"],
      ["Destroy target artifact or enchantment.", "artifact_or_enchantment"],
      ["Destroy target nonland permanent.", "nonland_permanent"],
    ];
    for (const [text, kind] of cases) {
      const compiled = compileOracleCard({
        oracleId: `removal-${kind}`,
        name: "Test Removal",
        manaCost: "{1}{G}",
        typeLine: "Instant",
        oracleText: text,
        power: null,
        toughness: null,
        printedKeywords: [],
        imageUrl: "",
      });
      expect(compiled.notes, text).toEqual([]);
      expect(compiled.definition.targetRequirements, text).toEqual([{ kind }]);
    }
  });

  it("artifact_or_enchantment accepts either type and rejects creatures", () => {
    const { game, p1, p2 } = twoPlayers();
    const rock = createCardDefinition({ name: "Mind Stone", typeLine: "Artifact" });
    const pact = createCardDefinition({ name: "Wild Growth", typeLine: "Enchantment — Aura" });
    const bear = createCardDefinition({
      name: "Bear",
      typeLine: "Creature — Bear",
      power: 2,
      toughness: 2,
    });
    for (const def of [rock, pact, bear]) {
      game.definitions[def.id] = def;
    }
    const cards = [rock, pact, bear].map((def) => {
      const card = createCardInstance({ definitionId: def.id, ownerId: p2.id, zone: "battlefield" });
      game.cards[card.id] = card;
      p2.zones.battlefield.push(card.id);
      return card;
    });
    const requirement = { kind: "artifact_or_enchantment" as const };
    expect(
      isChosenTargetLegal(game, requirement, { type: "creature", cardId: cards[0]!.id }, p1.id),
    ).toBe(true);
    expect(
      isChosenTargetLegal(game, requirement, { type: "creature", cardId: cards[1]!.id }, p1.id),
    ).toBe(true);
    expect(
      isChosenTargetLegal(game, requirement, { type: "creature", cardId: cards[2]!.id }, p1.id),
    ).toBe(false);
  });

  it("compiles Stroke of Midnight's nonland destroy with the consolation token", () => {
    const compiled = compileOracleCard({
      oracleId: "stroke",
      name: "Stroke of Midnight",
      manaCost: "{2}{W}",
      typeLine: "Instant",
      oracleText:
        "Destroy target nonland permanent. Its controller creates a 1/1 white Human creature token.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(compiled.notes).toEqual([]);
    expect(compiled.definition.targetRequirements).toEqual([{ kind: "nonland_permanent" }]);
    expect(compiled.definition.effects).toHaveLength(2);
  });
});

describe("sorcery-only activation rider", () => {
  it("marks the preceding activated ability as sorcery speed", () => {
    const compiled = compileOracleCard({
      oracleId: "monument",
      name: "Test Monument",
      manaCost: "{3}",
      typeLine: "Artifact",
      oracleText: "{2}, {T}: Draw a card. Activate only as a sorcery.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(compiled.notes).toEqual([]);
    expect(compiled.definition.activated).toHaveLength(1);
    expect(compiled.definition.activated[0]?.timing).toBe("sorcery");
  });
});

describe("team keyword pump", () => {
  it("compiles Heroic Intervention and grants both keywords until end of turn", () => {
    const compiled = compileOracleCard({
      oracleId: "heroic",
      name: "Heroic Intervention",
      manaCost: "{1}{G}",
      typeLine: "Instant",
      oracleText: "Creatures you control gain hexproof and indestructible until end of turn.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(compiled.notes).toEqual([]);
    expect(compiled.definition.effects).toEqual([
      { kind: "team_keyword_until_eot", playerId: "controller", keyword: "hexproof" },
      { kind: "team_keyword_until_eot", playerId: "controller", keyword: "indestructible" },
    ]);

    const { game, p1, p2 } = twoPlayers();
    const bear = createCardDefinition({
      name: "Bear",
      typeLine: "Creature — Bear",
      power: 2,
      toughness: 2,
    });
    game.definitions[bear.id] = bear;
    const mine = createCardInstance({ definitionId: bear.id, ownerId: p1.id, zone: "battlefield" });
    const theirs = createCardInstance({ definitionId: bear.id, ownerId: p2.id, zone: "battlefield" });
    for (const card of [mine, theirs]) {
      game.cards[card.id] = card;
      game.players.find((p) => p.id === card.ownerId)!.zones.battlefield.push(card.id);
    }
    let next = applyEffect(game, {
      kind: "team_keyword_until_eot",
      playerId: p1.id,
      keyword: "indestructible",
    });
    next = applyEffect(next, { kind: "destroy_all", what: "creatures" });
    expect(next.cards[mine.id]?.zone).toBe("battlefield");
    expect(next.cards[theirs.id]?.zone).toBe("graveyard");
  });
});

describe("bounce lands", () => {
  it("compiles the Karoo return trigger into a battlefield card choice", () => {
    const compiled = compileOracleCard({
      oracleId: "karoo",
      name: "Boros Garrison",
      manaCost: "",
      typeLine: "Land",
      oracleText:
        "Boros Garrison enters tapped.\nWhen Boros Garrison enters, return a land you control to its owner's hand.\n{T}: Add {R}{W}.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(compiled.notes).toEqual([]);
    expect(compiled.definition.triggers).toHaveLength(1);
    expect(compiled.definition.triggers[0]?.effects).toEqual([
      {
        kind: "choose_card",
        chooserId: "controller",
        sources: [{ playerId: "controller", zone: "battlefield", filter: "land" }],
        thenEffects: [{ kind: "move_card", cardId: "chosen_card", toZone: "hand" }],
      },
    ]);
  });

  it("returns the chosen battlefield land to its owner's hand", () => {
    const { game, p1 } = twoPlayers();
    addLandsInPlay(game, p1, 2);
    const landId = p1.zones.battlefield[0]!;
    const prompted = applyEffect(game, {
      kind: "choose_card",
      chooserId: p1.id,
      sources: [{ playerId: p1.id, zone: "battlefield", filter: "land" }],
      thenEffects: [{ kind: "move_card", cardId: "chosen_card", toZone: "hand" }],
      sourceId: null,
    });
    expect(prompted.prompts[0]?.kind).toBe("choose_card");
    const resolved = applyAction(prompted, {
      kind: "resolve_choose_card",
      playerId: p1.id,
      cardId: landId,
    });
    expect(resolved.cards[landId]?.zone).toBe("hand");
    expect(resolved.players[0]?.zones.hand).toContain(landId);
    expect(resolved.players[0]?.zones.battlefield).not.toContain(landId);
  });
});
