import { describe, expect, it } from "vitest";
import {
  applyAction,
  applyEffect,
  applyEffects,
  bindCardEffects,
  compileOracleCard,
  createCardDefinition,
  createCardInstance,
  createGameState,
  isChosenTargetLegal,
  moveCard,
  putSpellOnStack,
  resolveTopOfStack,
} from "./index";
import { cardMatchesSubtype, computedCard } from "./characteristicsEngine";
import { applyCombatDamage } from "./combat";
import { manaAbilitiesFor } from "./manaOptions";
import { legalActions } from "./legalActions";
import { searchMatches } from "./prompt";
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

describe("activation gates and dies-return", () => {
  it("compiles a Swamp-gated ability and enforces the condition", () => {
    const compiled = compileOracleCard({
      oracleId: "lake",
      name: "Test Lake of the Dead",
      manaCost: "",
      typeLine: "Land",
      oracleText: "{T}: Add {B}.\n{1}, {T}: Draw a card. Activate only if you control a Swamp.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(compiled.notes).toEqual([]);
    expect(compiled.definition.activated[0]?.requiresControlled).toEqual({ subtypes: ["swamp"] });

    const { game, p1 } = twoPlayers();
    fillLibraries(game);
    game.definitions[compiled.definition.id] = compiled.definition;
    const lake = createCardInstance({
      definitionId: compiled.definition.id,
      ownerId: p1.id,
      zone: "battlefield",
    });
    game.cards[lake.id] = lake;
    p1.zones.battlefield.push(lake.id);
    game.players[0]!.mana.C = 1;
    game.priorityPlayerId = p1.id;
    expect(() =>
      applyAction(game, {
        kind: "activate_ability",
        playerId: p1.id,
        cardId: lake.id,
        abilityIndex: 0,
        targets: [],
      }),
    ).toThrow(/activation condition/);

    const swamp = createCardDefinition({ name: "Swamp", typeLine: "Basic Land — Swamp" });
    game.definitions[swamp.id] = swamp;
    const swampCard = createCardInstance({ definitionId: swamp.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[swampCard.id] = swampCard;
    p1.zones.battlefield.push(swampCard.id);
    const activated = applyAction(game, {
      kind: "activate_ability",
      playerId: p1.id,
      cardId: lake.id,
      abilityIndex: 0,
      targets: [],
    });
    expect(activated.stack).toHaveLength(1);
  });

  it("compiles dies-return-tapped and re-enters the battlefield", () => {
    const compiled = compileOracleCard({
      oracleId: "returner",
      name: "Stubborn Sentry",
      manaCost: "{2}{W}",
      typeLine: "Creature — Spirit",
      oracleText:
        "When Stubborn Sentry dies, return it to the battlefield tapped under its owner's control.",
      power: "2",
      toughness: "2",
      printedKeywords: [],
      imageUrl: "",
    });
    expect(compiled.notes).toEqual([]);
    expect(compiled.definition.triggers[0]?.effects[0]).toEqual({
      kind: "move_card",
      cardId: "self",
      toZone: "battlefield",
      entersTapped: true,
    });
  });
});

describe("mana-value filters", () => {
  it("compiles Abrupt Decay's body and Despark, and enforces the bounds", () => {
    const decay = compileOracleCard({
      oracleId: "decay2",
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
    expect(decay.notes).toEqual([]);
    expect(decay.definition.targetRequirements).toEqual([
      { kind: "noncreature_nonland_permanent", maxManaValue: 3 },
    ]);

    const despark = compileOracleCard({
      oracleId: "despark",
      name: "Despark",
      manaCost: "{W}{B}",
      typeLine: "Instant",
      oracleText: "Exile target permanent with mana value 4 or greater.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(despark.notes).toEqual([]);
    expect(despark.definition.targetRequirements).toEqual([
      { kind: "permanent", minManaValue: 4 },
    ]);

    const { game, p1, p2 } = twoPlayers();
    const cheap = createCardDefinition({ name: "Mind Stone", typeLine: "Artifact", manaCost: "{2}" });
    const pricey = createCardDefinition({
      name: "Big Golem",
      typeLine: "Artifact Creature — Golem",
      manaCost: "{6}",
      power: 6,
      toughness: 6,
    });
    game.definitions[cheap.id] = cheap;
    game.definitions[pricey.id] = pricey;
    const small = createCardInstance({ definitionId: cheap.id, ownerId: p2.id, zone: "battlefield" });
    const large = createCardInstance({ definitionId: pricey.id, ownerId: p2.id, zone: "battlefield" });
    game.cards[small.id] = small;
    game.cards[large.id] = large;
    p2.zones.battlefield.push(small.id, large.id);

    const desparkReq = { kind: "permanent" as const, minManaValue: 4 };
    expect(isChosenTargetLegal(game, desparkReq, { type: "creature", cardId: small.id }, p1.id)).toBe(false);
    expect(isChosenTargetLegal(game, desparkReq, { type: "creature", cardId: large.id }, p1.id)).toBe(true);

    // "Destroy all creatures with mana value 3 or less" spares the golem.
    const swept = applyEffect(game, { kind: "destroy_all", what: "creatures", maxManaValue: 3 });
    expect(swept.cards[large.id]?.zone).toBe("battlefield");
  });
});

describe("multi-mode spells", () => {
  it("compiles a Choose-two command and resolves both chosen modes", () => {
    const compiled = compileOracleCard({
      oracleId: "command",
      name: "Practical Command",
      manaCost: "{3}{G}{W}",
      typeLine: "Sorcery",
      oracleText:
        "Choose two —\n• Destroy target artifact.\n• Destroy target enchantment.\n• You gain 4 life.\n• Draw a card.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(compiled.notes).toEqual([]);
    expect(compiled.definition.modes).toHaveLength(4);
    expect(compiled.definition.modeChoice).toEqual({ min: 2, max: 2 });

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
    const ready = advanceSteps(game, 3);
    ready.players[0]!.mana.G = 1;
    ready.players[0]!.mana.W = 1;
    ready.players[0]!.mana.C = 3;
    ready.priorityPlayerId = p1.id;

    // One mode is refused.
    expect(() =>
      applyAction(ready, {
        kind: "cast_spell",
        playerId: p1.id,
        cardId: spell.id,
        targets: [],
        modeIndexes: [2],
      }),
    ).toThrow(/Choose 2/);

    const cast = applyAction(ready, {
      kind: "cast_spell",
      playerId: p1.id,
      cardId: spell.id,
      targets: [],
      modeIndexes: [2, 3],
    });
    const handBefore = cast.players[0]!.zones.hand.length;
    const resolved = resolveTopOfStack(cast);
    expect(resolved.players[0]?.life).toBe(44);
    expect(resolved.players[0]?.zones.hand).toHaveLength(handBefore + 1);
    expect(resolved.cards[spell.id]?.zone).toBe("graveyard");
  });
});

describe("edicts and symmetrical effects", () => {
  it("compiles the Fleshbag edict and walks each player's choice", () => {
    const compiled = compileOracleCard({
      oracleId: "fleshbag",
      name: "Fleshbag Marauder",
      manaCost: "{2}{B}",
      typeLine: "Creature — Zombie Warrior",
      oracleText: "When Fleshbag Marauder enters, each player sacrifices a creature of their choice.",
      power: "3",
      toughness: "1",
      printedKeywords: [],
      imageUrl: "",
    });
    expect(compiled.notes).toEqual([]);
    expect(compiled.definition.triggers[0]?.effects[0]).toMatchObject({
      kind: "choose_card",
      chooserId: "each_player",
    });

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
    game.cards[mine.id] = mine;
    game.cards[theirs.id] = theirs;
    p1.zones.battlefield.push(mine.id);
    p2.zones.battlefield.push(theirs.id);

    const bound = bindCardEffects(game, compiled.definition.triggers[0]!.effects, {
      controllerId: p1.id,
      sourceId: null,
    });
    expect(bound).toHaveLength(2);
    let next = applyEffects(game, bound);
    expect(next.prompts[0]?.kind).toBe("choose_card");
    expect(next.prompts[0]?.playerId).toBe(p1.id);
    next = applyAction(next, { kind: "resolve_choose_card", playerId: p1.id, cardId: mine.id });
    expect(next.cards[mine.id]?.zone).toBe("graveyard");
    // The resume chain hands the second edict choice to the opponent.
    expect(next.prompts[0]?.playerId).toBe(p2.id);
    next = applyAction(next, { kind: "resolve_choose_card", playerId: p2.id, cardId: theirs.id });
    expect(next.cards[theirs.id]?.zone).toBe("graveyard");
  });

  it("compiles 'Each player draws a card'", () => {
    const compiled = compileOracleCard({
      oracleId: "font",
      name: "Fountain of Youthful Ideas",
      manaCost: "{2}{U}",
      typeLine: "Sorcery",
      oracleText: "Each player draws a card.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(compiled.notes).toEqual([]);
    expect(compiled.definition.effects).toEqual([
      { kind: "draw", playerId: "each_player", count: 1 },
    ]);
  });
});

describe("granted mana abilities and land subtypes", () => {
  it("compiles Urborg and lets other lands tap for black", () => {
    const compiled = compileOracleCard({
      oracleId: "urborg",
      name: "Urborg, Tomb of Yawgmoth",
      manaCost: "",
      typeLine: "Legendary Land",
      oracleText: "Each land is a Swamp in addition to its other land types.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(compiled.notes).toEqual([]);
    expect(compiled.definition.staticAbilities[0]).toMatchObject({
      selector: { scope: "all", types: ["land"] },
      effect: { kind: "add_types", subtypes: ["swamp"] },
    });

    const { game, p1 } = twoPlayers();
    game.definitions[compiled.definition.id] = compiled.definition;
    const urborg = createCardInstance({
      definitionId: compiled.definition.id,
      ownerId: p1.id,
      zone: "battlefield",
    });
    game.cards[urborg.id] = urborg;
    p1.zones.battlefield.push(urborg.id);
    const forest = createCardDefinition({ name: "Forest", typeLine: "Basic Land — Forest" });
    game.definitions[forest.id] = forest;
    const land = createCardInstance({ definitionId: forest.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[land.id] = land;
    p1.zones.battlefield.push(land.id);

    const abilities = manaAbilitiesFor(game, land.id);
    const colors = abilities.flatMap((ability) =>
      Object.entries(ability.produces).filter(([, n]) => (n ?? 0) > 0).map(([c]) => c),
    );
    expect(colors.sort()).toEqual(["B", "G"]);
    // Urborg itself taps for black too.
    const urborgColors = manaAbilitiesFor(game, urborg.id).flatMap((ability) =>
      Object.entries(ability.produces).filter(([, n]) => (n ?? 0) > 0).map(([c]) => c),
    );
    expect(urborgColors).toEqual(["B"]);
  });

  it("compiles Cryptolith Rite and taps creatures for any color", () => {
    const compiled = compileOracleCard({
      oracleId: "cryptolith",
      name: "Cryptolith Rite",
      manaCost: "{1}{G}",
      typeLine: "Enchantment",
      oracleText: 'Creatures you control have "{T}: Add one mana of any color."',
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(compiled.notes).toEqual([]);
    expect(compiled.definition.staticAbilities[0]?.effect.kind).toBe("grant_mana_ability");

    const { game, p1 } = twoPlayers();
    game.definitions[compiled.definition.id] = compiled.definition;
    const rite = createCardInstance({
      definitionId: compiled.definition.id,
      ownerId: p1.id,
      zone: "battlefield",
    });
    game.cards[rite.id] = rite;
    p1.zones.battlefield.push(rite.id);
    const bear = createCardDefinition({
      name: "Bear",
      typeLine: "Creature — Bear",
      power: 2,
      toughness: 2,
    });
    game.definitions[bear.id] = bear;
    const dork = createCardInstance({ definitionId: bear.id, ownerId: p1.id, zone: "battlefield" });
    dork.summoningSick = false;
    game.cards[dork.id] = dork;
    p1.zones.battlefield.push(dork.id);

    expect(manaAbilitiesFor(game, dork.id)).toHaveLength(1);
    game.priorityPlayerId = p1.id;
    const tapped = applyAction(game, {
      kind: "tap_for_mana",
      playerId: p1.id,
      cardId: dork.id,
      color: "G",
    });
    expect(tapped.players[0]?.mana.G).toBe(1);
    expect(tapped.cards[dork.id]?.tapped).toBe(true);
  });
});

describe("may-pay effects", () => {
  it("compiles the ETB pay-to-draw pair and applies effects only when paid", () => {
    const compiled = compileOracleCard({
      oracleId: "maypay",
      name: "Curious Obelisk",
      manaCost: "{2}",
      typeLine: "Artifact",
      oracleText: "When Curious Obelisk enters, you may pay {2}. If you do, draw a card.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(compiled.notes).toEqual([]);
    expect(compiled.definition.triggers[0]?.effects[0]).toMatchObject({
      kind: "may_pay",
      cost: "{2}",
    });

    const { game, p1 } = twoPlayers();
    fillLibraries(game);
    const prompted = applyEffect(game, {
      kind: "may_pay",
      playerId: p1.id,
      cost: "{2}",
      effects: [{ kind: "draw", playerId: p1.id, count: 1 }],
    });
    expect(prompted.prompts[0]?.kind).toBe("pay_or_effect");

    const declined = applyAction(prompted, { kind: "resolve_pay", playerId: p1.id, pay: false });
    expect(declined.players[0]?.zones.hand).toHaveLength(0);

    prompted.players[0]!.mana.C = 2;
    const paid = applyAction(prompted, { kind: "resolve_pay", playerId: p1.id, pay: true });
    expect(paid.players[0]?.zones.hand).toHaveLength(1);
    expect(paid.players[0]?.mana.C).toBe(0);
  });
});

describe("wave 18: mixed removal and graveyard exile", () => {
  it("compiles Putrefy, Abrade, and Bojuka Bog cleanly", () => {
    const putrefy = compileOracleCard({
      oracleId: "putrefy",
      name: "Putrefy",
      manaCost: "{1}{B}{G}",
      typeLine: "Instant",
      oracleText: "Destroy target artifact or creature. It can't be regenerated.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(putrefy.notes).toEqual([]);
    expect(putrefy.definition.targetRequirements).toEqual([{ kind: "creature_or_artifact" }]);

    const abrade = compileOracleCard({
      oracleId: "abrade",
      name: "Abrade",
      manaCost: "{1}{R}",
      typeLine: "Instant",
      oracleText: "Choose one —\n• Abrade deals 3 damage to target creature.\n• Destroy target artifact.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(abrade.notes).toEqual([]);
    expect(abrade.definition.modes).toHaveLength(2);

    const bog = compileOracleCard({
      oracleId: "bog",
      name: "Bojuka Bog",
      manaCost: "",
      typeLine: "Land",
      oracleText:
        "Bojuka Bog enters tapped.\nWhen Bojuka Bog enters, exile target player's graveyard.\n{T}: Add {B}.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(bog.notes).toEqual([]);
    expect(bog.definition.triggers[0]?.effects[0]).toMatchObject({ kind: "exile_graveyard" });
  });

  it("exile_graveyard empties the chosen player's graveyard", () => {
    const { game, p1, p2 } = twoPlayers();
    const bear = createCardDefinition({
      name: "Bear",
      typeLine: "Creature — Bear",
      power: 2,
      toughness: 2,
    });
    game.definitions[bear.id] = bear;
    for (let i = 0; i < 3; i += 1) {
      const card = createCardInstance({ definitionId: bear.id, ownerId: p2.id, zone: "graveyard" });
      game.cards[card.id] = card;
      p2.zones.graveyard.push(card.id);
    }
    const exiled = applyEffect(game, { kind: "exile_graveyard", playerId: p2.id });
    expect(exiled.players[1]?.zones.graveyard).toEqual([]);
    expect(exiled.players[1]?.zones.exile).toHaveLength(3);
    expect(p1.zones.exile).toEqual([]);
  });
});

describe("star power and toughness", () => {
  it("compiles Psychosis Crawler's CDA and tracks the hand", () => {
    const compiled = compileOracleCard({
      oracleId: "crawler",
      name: "Psychosis Crawler",
      manaCost: "{5}",
      typeLine: "Artifact Creature — Phyrexian Horror",
      oracleText:
        "Psychosis Crawler's power and toughness are each equal to the number of cards in your hand.\nWhenever you draw a card, each opponent loses 1 life.",
      power: "*",
      toughness: "*",
      printedKeywords: [],
      imageUrl: "",
    });
    expect(compiled.definition.dynamicPt).toEqual({ count: "cards_in_your_hand" });
    expect(
      compiled.notes.filter((note) => /not a simple number/.test(note)),
    ).toEqual([]);

    const { game, p1 } = twoPlayers();
    game.definitions[compiled.definition.id] = compiled.definition;
    const crawler = createCardInstance({
      definitionId: compiled.definition.id,
      ownerId: p1.id,
      zone: "battlefield",
    });
    game.cards[crawler.id] = crawler;
    p1.zones.battlefield.push(crawler.id);
    addHandCards(game, p1, 3);
    expect(computedCard(game, crawler.id)?.power).toBe(3);
    expect(computedCard(game, crawler.id)?.toughness).toBe(3);
  });
});

describe("flicker and controlled bounce", () => {
  it("compiles Ephemerate's flicker and re-runs enter triggers", () => {
    const compiled = compileOracleCard({
      oracleId: "ephemerate",
      name: "Ephemerate",
      manaCost: "{W}",
      typeLine: "Instant",
      oracleText:
        "Exile target creature you control, then return it to the battlefield under its owner's control.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(compiled.definition.targetRequirements).toEqual([{ kind: "creature", control: "own" }]);
    expect(compiled.definition.effects).toEqual([
      { kind: "flicker", cardId: { type: "chosen", index: 0 } },
    ]);

    const { game, p1 } = twoPlayers();
    fillLibraries(game);
    const etbDrawer = createCardDefinition({
      name: "Wall of Omens Jr",
      typeLine: "Creature — Wall",
      power: 0,
      toughness: 4,
      triggers: [
        {
          event: "enter_battlefield",
          effects: [{ kind: "draw", playerId: "controller", count: 1 }],
          targetRequirements: [],
        },
      ],
    });
    game.definitions[etbDrawer.id] = etbDrawer;
    const wall = createCardInstance({ definitionId: etbDrawer.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[wall.id] = wall;
    p1.zones.battlefield.push(wall.id);
    const flickered = applyEffect(game, { kind: "flicker", cardId: wall.id });
    expect(flickered.cards[wall.id]?.zone).toBe("battlefield");
    expect(flickered.cards[wall.id]?.summoningSick).toBe(true);
    // The ETB trigger queued again from the return.
    expect(flickered.stack).toHaveLength(1);
  });

  it("Cyclonic Rift's base mode only bounces what you don't control", () => {
    const compiled = compileOracleCard({
      oracleId: "cyc",
      name: "Cyclonic Rift Lite",
      manaCost: "{1}{U}",
      typeLine: "Instant",
      oracleText: "Return target nonland permanent you don't control to its owner's hand.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(compiled.notes).toEqual([]);
    expect(compiled.definition.targetRequirements).toEqual([
      { kind: "nonland_permanent", control: "not_own" },
    ]);

    const { game, p1, p2 } = twoPlayers();
    const rock = createCardDefinition({ name: "Mind Stone", typeLine: "Artifact" });
    game.definitions[rock.id] = rock;
    const mine = createCardInstance({ definitionId: rock.id, ownerId: p1.id, zone: "battlefield" });
    const theirs = createCardInstance({ definitionId: rock.id, ownerId: p2.id, zone: "battlefield" });
    game.cards[mine.id] = mine;
    game.cards[theirs.id] = theirs;
    p1.zones.battlefield.push(mine.id);
    p2.zones.battlefield.push(theirs.id);
    const requirement = { kind: "nonland_permanent" as const, control: "not_own" as const };
    expect(isChosenTargetLegal(game, requirement, { type: "creature", cardId: mine.id }, p1.id)).toBe(
      false,
    );
    expect(
      isChosenTargetLegal(game, requirement, { type: "creature", cardId: theirs.id }, p1.id),
    ).toBe(true);
  });
});

describe("mass damage", () => {
  it("compiles Pyroclasm-style sweeps and kills as one batch", () => {
    const compiled = compileOracleCard({
      oracleId: "pyro",
      name: "Pyroclasm",
      manaCost: "{1}{R}",
      typeLine: "Sorcery",
      oracleText: "Pyroclasm deals 2 damage to each creature.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(compiled.notes).toEqual([]);
    expect(compiled.definition.effects).toEqual([
      { kind: "damage_all", sourceId: "self", amount: 2 },
    ]);

    const { game, p1, p2 } = twoPlayers();
    const bear = createCardDefinition({
      name: "Bear",
      typeLine: "Creature — Bear",
      power: 2,
      toughness: 2,
    });
    const ox = createCardDefinition({
      name: "Sturdy Ox",
      typeLine: "Creature — Ox",
      power: 2,
      toughness: 4,
    });
    game.definitions[bear.id] = bear;
    game.definitions[ox.id] = ox;
    const small = createCardInstance({ definitionId: bear.id, ownerId: p1.id, zone: "battlefield" });
    const big = createCardInstance({ definitionId: ox.id, ownerId: p2.id, zone: "battlefield" });
    game.cards[small.id] = small;
    game.cards[big.id] = big;
    p1.zones.battlefield.push(small.id);
    p2.zones.battlefield.push(big.id);
    const swept = applyEffect(game, { kind: "damage_all", sourceId: null, amount: 2 });
    expect(swept.cards[small.id]?.zone).toBe("graveyard");
    expect(swept.cards[big.id]?.zone).toBe("battlefield");
    expect(swept.cards[big.id]?.damageMarked).toBe(2);
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

describe("wave 25: spell copying (CR 707.10)", () => {
  function stackedLifeSpell() {
    const { game, p1, p2 } = twoPlayers();
    const def = createCardDefinition({
      name: "Warm Reflection",
      typeLine: "Sorcery",
      effects: [{ kind: "gain_life", playerId: "controller", amount: 3 }],
    });
    game.definitions[def.id] = def;
    const spell = createCardInstance({ definitionId: def.id, ownerId: p1.id, zone: "stack" });
    game.cards[spell.id] = spell;
    game.stack.push({
      id: "stack-orig",
      kind: "spell",
      sourceId: spell.id,
      controllerId: p1.id,
      targets: [],
    });
    return { game, p1, p2, spell };
  }

  it("a copy resolves for its own controller and never moves the original card", () => {
    const { game, p1, p2, spell } = stackedLifeSpell();
    const copied = applyEffect(game, {
      kind: "copy_spell",
      stackObjectId: "stack-orig",
      controllerId: p2.id,
    });
    expect(copied.stack).toHaveLength(2);
    expect(copied.stack[1]?.isCopy).toBe(true);
    expect(copied.stack[1]?.controllerId).toBe(p2.id);

    const afterCopy = resolveTopOfStack(copied);
    expect(afterCopy.players[1]?.life).toBe(43);
    expect(afterCopy.players[0]?.life).toBe(40);
    // The copy ceased to exist; the card still belongs to the original spell.
    expect(afterCopy.stack).toHaveLength(1);
    expect(afterCopy.cards[spell.id]?.zone).toBe("stack");

    const afterBoth = resolveTopOfStack(afterCopy);
    expect(afterBoth.players[0]?.life).toBe(43);
    expect(afterBoth.cards[spell.id]?.zone).toBe("graveyard");
    expect(afterBoth.stack).toEqual([]);
    void p1;
  });

  it("countering the copy leaves the original spell on the stack", () => {
    const { game, p1, spell } = stackedLifeSpell();
    const copied = applyEffect(game, {
      kind: "copy_spell",
      stackObjectId: "stack-orig",
      controllerId: p1.id,
    });
    const copyId = copied.stack[1]?.id ?? "";
    const countered = applyEffect(copied, { kind: "counter_spell", stackObjectId: copyId });
    expect(countered.stack).toHaveLength(1);
    expect(countered.stack[0]?.id).toBe("stack-orig");
    expect(countered.cards[spell.id]?.zone).toBe("stack");
  });

  it("only instants and sorceries are legal copy targets", () => {
    const { game, p1 } = stackedLifeSpell();
    const bear = createCardDefinition({
      name: "Runeclaw Bear",
      typeLine: "Creature - Bear",
      power: 2,
      toughness: 2,
    });
    game.definitions[bear.id] = bear;
    const bearSpell = createCardInstance({ definitionId: bear.id, ownerId: p1.id, zone: "stack" });
    game.cards[bearSpell.id] = bearSpell;
    game.stack.push({
      id: "stack-bear",
      kind: "spell",
      sourceId: bearSpell.id,
      controllerId: p1.id,
      targets: [],
    });
    const requirement = { kind: "instant_or_sorcery_spell" } as const;
    expect(
      isChosenTargetLegal(game, requirement, { type: "spell", stackObjectId: "stack-orig" }, p1.id),
    ).toBe(true);
    expect(
      isChosenTargetLegal(game, requirement, { type: "spell", stackObjectId: "stack-bear" }, p1.id),
    ).toBe(false);
  });

  it("compiles Reverberate fully, with the kept-targets approximation noted", () => {
    const compiled = compileOracleCard({
      oracleId: "reverberate",
      name: "Reverberate",
      manaCost: "{R}{R}",
      typeLine: "Instant",
      oracleText: "Copy target instant or sorcery spell. You may choose new targets for the copy.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(compiled.definition.targetRequirements).toEqual([{ kind: "instant_or_sorcery_spell" }]);
    expect(compiled.definition.effects).toEqual([
      { kind: "copy_spell", target: { type: "chosen", index: 0 } },
    ]);
    expect(compiled.notes).toEqual([]);
  });

  it("compiles an enters-the-battlefield copy trigger (Dualcaster Mage shape)", () => {
    const compiled = compileOracleCard({
      oracleId: "echo-caster",
      name: "Echo Caster",
      manaCost: "{1}{R}{R}",
      typeLine: "Creature - Human Wizard",
      oracleText:
        "When Echo Caster enters, copy target instant or sorcery spell. You may choose new targets for the copy.",
      power: "2",
      toughness: "2",
      printedKeywords: [],
      imageUrl: "",
    });
    expect(compiled.definition.triggers).toHaveLength(1);
    expect(compiled.definition.triggers[0]?.event).toBe("enter_battlefield");
    expect(compiled.definition.triggers[0]?.effects).toEqual([
      { kind: "copy_spell", target: { type: "chosen", index: 0 } },
    ]);
    expect(compiled.definition.triggers[0]?.targetRequirements).toEqual([
      { kind: "instant_or_sorcery_spell" },
    ]);
    expect(compiled.notes.some((note) => note.startsWith("Some oracle text"))).toBe(false);
  });

  it("the rider alone does not compile without a copy effect", () => {
    const compiled = compileOracleCard({
      oracleId: "stray-rider",
      name: "Stray Rider",
      manaCost: "{U}",
      typeLine: "Instant",
      oracleText: "You may choose new targets for the copy.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(compiled.notes.some((note) => note.startsWith("Some oracle text"))).toBe(true);
  });
});

describe("wave 25b: subject-spell copy and counter triggers", () => {
  it("a cast trigger copies the subject spell for its own controller", () => {
    const { game, p1 } = twoPlayers();
    const sage = createCardDefinition({
      name: "Mirror Sage",
      typeLine: "Creature - Human Wizard",
      power: 2,
      toughness: 2,
      triggers: [
        {
          event: "cast_spell",
          watch: "controlled",
          subjectFilter: { typesAny: ["instant", "sorcery"] },
          effects: [{ kind: "copy_subject_spell" }],
          targetRequirements: [],
        },
      ],
    });
    game.definitions[sage.id] = sage;
    const body = createCardInstance({ definitionId: sage.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[body.id] = body;
    p1.zones.battlefield.push(body.id);

    const lifeDef = createCardDefinition({
      name: "Warm Reflection",
      typeLine: "Sorcery",
      effects: [{ kind: "gain_life", playerId: "controller", amount: 3 }],
    });
    game.definitions[lifeDef.id] = lifeDef;
    const spell = createCardInstance({ definitionId: lifeDef.id, ownerId: p1.id, zone: "hand" });
    game.cards[spell.id] = spell;
    p1.zones.hand.push(spell.id);

    let state = putSpellOnStack(game, spell.id);
    // The cast trigger sits above the spell.
    expect(state.stack).toHaveLength(2);
    state = resolveTopOfStack(state); // trigger -> pushes the copy
    expect(state.stack).toHaveLength(2);
    expect(state.stack[1]?.isCopy).toBe(true);
    state = resolveTopOfStack(state); // copy resolves
    expect(state.players[0]?.life).toBe(43);
    expect(state.cards[spell.id]?.zone).toBe("stack");
    state = resolveTopOfStack(state); // original resolves
    expect(state.players[0]?.life).toBe(46);
    expect(state.cards[spell.id]?.zone).toBe("graveyard");
  });

  it("a cast trigger counters the subject spell", () => {
    const { game, p1, p2 } = twoPlayers();
    const praetor = createCardDefinition({
      name: "Cold Praetor",
      typeLine: "Creature - Phyrexian Praetor",
      power: 5,
      toughness: 5,
      triggers: [
        {
          event: "cast_spell",
          watch: "opponents",
          subjectFilter: { typesAny: ["instant", "sorcery"] },
          effects: [{ kind: "counter_subject_spell" }],
          targetRequirements: [],
        },
      ],
    });
    game.definitions[praetor.id] = praetor;
    const body = createCardInstance({ definitionId: praetor.id, ownerId: p2.id, zone: "battlefield" });
    game.cards[body.id] = body;
    p2.zones.battlefield.push(body.id);

    const lifeDef = createCardDefinition({
      name: "Warm Reflection",
      typeLine: "Sorcery",
      effects: [{ kind: "gain_life", playerId: "controller", amount: 3 }],
    });
    game.definitions[lifeDef.id] = lifeDef;
    const spell = createCardInstance({ definitionId: lifeDef.id, ownerId: p1.id, zone: "hand" });
    game.cards[spell.id] = spell;
    p1.zones.hand.push(spell.id);

    let state = putSpellOnStack(game, spell.id);
    expect(state.stack).toHaveLength(2);
    state = resolveTopOfStack(state); // trigger -> counters the spell
    expect(state.stack).toEqual([]);
    expect(state.cards[spell.id]?.zone).toBe("graveyard");
    expect(state.players[0]?.life).toBe(40);
  });

  it("compiles Jin-Gitaxias, Progress Tyrant fully", () => {
    const compiled = compileOracleCard({
      oracleId: "jin-gitaxias",
      name: "Jin-Gitaxias, Progress Tyrant",
      manaCost: "{4}{U}{U}{U}",
      typeLine: "Legendary Creature - Phyrexian Praetor",
      oracleText:
        "Whenever you cast an artifact, instant, or sorcery spell, copy that spell. You may choose new targets for the copy. This ability triggers only once each turn. (A copy of a permanent spell becomes a token.)\nWhenever an opponent casts an artifact, instant, or sorcery spell, counter that spell. This ability triggers only once each turn.",
      power: "5",
      toughness: "5",
      printedKeywords: [],
      imageUrl: "",
    });
    expect(compiled.definition.triggers).toHaveLength(2);
    expect(compiled.definition.triggers[0]?.effects).toEqual([{ kind: "copy_subject_spell" }]);
    expect(compiled.definition.triggers[0]?.oncePerTurn).toBe(true);
    expect(compiled.definition.triggers[1]?.effects).toEqual([{ kind: "counter_subject_spell" }]);
    expect(compiled.definition.triggers[1]?.oncePerTurn).toBe(true);
    expect(compiled.notes).toEqual([]);
  });
});

describe("wave 26: reveal lands (SOI/STX shape)", () => {
  it("compiles Port Town fully", () => {
    const compiled = compileOracleCard({
      oracleId: "port-town",
      name: "Port Town",
      manaCost: "",
      typeLine: "Land",
      oracleText:
        "As this land enters, you may reveal a Plains or Island card from your hand. If you don't, this land enters tapped.\n{T}: Add {W} or {U}.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(compiled.definition.replacements).toEqual([
      {
        kind: "enters_tapped_unless",
        unless: { kind: "hand_reveals_types", types: ["plains", "island"] },
      },
    ]);
    expect(compiled.notes).toEqual([]);
  });

  it("enters untapped with a matching card in hand, tapped without", () => {
    const { game, p1 } = twoPlayers();
    const port = createCardDefinition({
      name: "Port Town",
      typeLine: "Land",
      producesOptions: ["W", "U"],
      replacements: [
        {
          kind: "enters_tapped_unless",
          unless: { kind: "hand_reveals_types", types: ["plains", "island"] },
        },
      ],
    });
    game.definitions[port.id] = port;

    // Empty hand beyond the land itself: no reveal, so it enters tapped.
    const first = createCardInstance({ definitionId: port.id, ownerId: p1.id, zone: "hand" });
    game.cards[first.id] = first;
    p1.zones.hand.push(first.id);
    const tapped = moveCard(game, first.id, "battlefield");
    expect(tapped.cards[first.id]?.tapped).toBe(true);

    // An Island-subtype card in hand (a nonbasic dual counts): enters untapped.
    const dual = createCardDefinition({
      name: "Hallowed Fountain",
      typeLine: "Land - Plains Island",
      producesOptions: ["W", "U"],
    });
    game.definitions[dual.id] = dual;
    const revealCard = createCardInstance({ definitionId: dual.id, ownerId: p1.id, zone: "hand" });
    game.cards[revealCard.id] = revealCard;
    p1.zones.hand.push(revealCard.id);
    const second = createCardInstance({ definitionId: port.id, ownerId: p1.id, zone: "hand" });
    game.cards[second.id] = second;
    p1.zones.hand.push(second.id);
    const untapped = moveCard(game, second.id, "battlefield");
    expect(untapped.cards[second.id]?.tapped).toBe(false);
  });
});

describe("wave 27: free-spell cycle (cast free with a commander)", () => {
  it("compiles Fierce Guardianship fully", () => {
    const compiled = compileOracleCard({
      oracleId: "fierce-guardianship",
      name: "Fierce Guardianship",
      manaCost: "{2}{U}",
      typeLine: "Instant",
      oracleText:
        "If you control a commander, you may cast this spell without paying its mana cost.\nCounter target noncreature spell.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(compiled.definition.freeIfCommander).toBe(true);
    expect(compiled.definition.effects).toEqual([
      { kind: "counter_spell", target: { type: "chosen", index: 0 } },
    ]);
    expect(compiled.notes).toEqual([]);
  });

  it("casts free with a commander on the battlefield, else needs mana", () => {
    const { game, p1 } = twoPlayers();
    const freeDef = createCardDefinition({
      name: "Loyal Aid",
      manaCost: "{2}{B}",
      typeLine: "Instant",
      freeIfCommander: true,
      effects: [{ kind: "gain_life", playerId: "controller", amount: 2 }],
    });
    game.definitions[freeDef.id] = freeDef;
    const spell = createCardInstance({ definitionId: freeDef.id, ownerId: p1.id, zone: "hand" });
    game.cards[spell.id] = spell;
    p1.zones.hand.push(spell.id);

    // No commander, empty pool: the cast is refused.
    expect(() =>
      applyAction(game, { kind: "cast_spell", playerId: p1.id, cardId: spell.id, targets: [] }),
    ).toThrow();

    // Commander on the battlefield: same cast is free.
    const cmdDef = createCardDefinition({
      name: "General",
      manaCost: "{1}{B}",
      typeLine: "Legendary Creature - Human Soldier",
      power: 2,
      toughness: 2,
    });
    game.definitions[cmdDef.id] = cmdDef;
    const commander = createCardInstance({
      definitionId: cmdDef.id,
      ownerId: p1.id,
      zone: "battlefield",
    });
    game.cards[commander.id] = commander;
    p1.zones.battlefield.push(commander.id);
    p1.commander.commanderIds.push(commander.id);

    const cast = applyAction(game, {
      kind: "cast_spell",
      playerId: p1.id,
      cardId: spell.id,
      targets: [],
    });
    expect(cast.stack).toHaveLength(1);
    const resolved = resolveTopOfStack(cast);
    expect(resolved.players[0]?.life).toBe(42);
  });
});

describe("wave 29: changeling (CR 702.73)", () => {
  it("compiles Changeling Outcast fully", () => {
    const compiled = compileOracleCard({
      oracleId: "changeling-outcast",
      name: "Changeling Outcast",
      manaCost: "{B}",
      typeLine: "Creature - Shapeshifter",
      oracleText: "Changeling\nThis creature can't block and can't be blocked.",
      power: "1",
      toughness: "1",
      printedKeywords: ["Changeling"],
      imageUrl: "",
    });
    expect(compiled.definition.changeling).toBe(true);
    expect(compiled.definition.staticAbilities).toEqual([
      {
        selector: { scope: "self" },
        effect: { kind: "restrict", cantBlock: true, cantBeBlocked: true },
      },
    ]);
    expect(compiled.notes).toEqual([]);
  });

  it("matches every creature type in any zone, but never land subtypes", () => {
    const { game, p1 } = twoPlayers();
    const shifter = createCardDefinition({
      name: "Woodland Changeling",
      typeLine: "Creature - Shapeshifter",
      power: 2,
      toughness: 2,
      changeling: true,
    });
    game.definitions[shifter.id] = shifter;
    const onField = createCardInstance({
      definitionId: shifter.id,
      ownerId: p1.id,
      zone: "battlefield",
    });
    game.cards[onField.id] = onField;
    p1.zones.battlefield.push(onField.id);
    expect(cardMatchesSubtype(game, onField.id, "sliver")).toBe(true);
    expect(cardMatchesSubtype(game, onField.id, "elf")).toBe(true);
    expect(cardMatchesSubtype(game, onField.id, "plains")).toBe(false);
    expect(cardMatchesSubtype(game, onField.id, "equipment")).toBe(false);

    const inLibrary = createCardInstance({
      definitionId: shifter.id,
      ownerId: p1.id,
      zone: "library",
    });
    game.cards[inLibrary.id] = inLibrary;
    p1.zones.library.push(inLibrary.id);
    expect(cardMatchesSubtype(game, inLibrary.id, "goblin")).toBe(true);
    expect(
      searchMatches(game, inLibrary.id, { types: ["creature"], subtypesAny: ["elf"] }),
    ).toBe(true);
  });

  it("a changeling triggers chosen-type watchers (Kindred Discovery shape)", () => {
    const { game, p1 } = twoPlayers();
    const watcherDef = createCardDefinition({
      name: "Kindred Watcher",
      typeLine: "Enchantment",
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
    game.definitions[watcherDef.id] = watcherDef;
    const watcher = createCardInstance({
      definitionId: watcherDef.id,
      ownerId: p1.id,
      zone: "battlefield",
    });
    watcher.chosenCreatureType = "sliver";
    game.cards[watcher.id] = watcher;
    p1.zones.battlefield.push(watcher.id);
    fillLibraries(game, 5);

    const shifter = createCardDefinition({
      name: "Woodland Changeling",
      typeLine: "Creature - Shapeshifter",
      power: 2,
      toughness: 2,
      changeling: true,
    });
    game.definitions[shifter.id] = shifter;
    const entering = createCardInstance({
      definitionId: shifter.id,
      ownerId: p1.id,
      zone: "hand",
    });
    game.cards[entering.id] = entering;
    p1.zones.hand.push(entering.id);
    const after = moveCard(game, entering.id, "battlefield");
    // The changeling counts as a Sliver: the trigger is on the stack.
    expect(after.stack).toHaveLength(1);
  });
});

describe("wave 30: top-of-library grants (Oracle of Mul Daya shape)", () => {
  it("compiles Oracle of Mul Daya fully", () => {
    const compiled = compileOracleCard({
      oracleId: "oracle-of-mul-daya",
      name: "Oracle of Mul Daya",
      manaCost: "{3}{G}",
      typeLine: "Creature - Elf Shaman",
      oracleText:
        "You may play an additional land on each of your turns.\nYou may look at the top card of your library any time.\nYou may play lands from the top of your library.",
      power: "2",
      toughness: "2",
      printedKeywords: [],
      imageUrl: "",
    });
    expect(compiled.definition.extraLandDrops).toBe(1);
    expect(compiled.definition.topOfLibrary).toEqual({ look: true, playLands: true });
    expect(compiled.notes).toEqual([]);
  });

  it("compiles Elven Chorus fully", () => {
    const compiled = compileOracleCard({
      oracleId: "elven-chorus",
      name: "Elven Chorus",
      manaCost: "{3}{G}",
      typeLine: "Enchantment",
      oracleText:
        'You may look at the top card of your library any time.\nYou may cast creature spells from the top of your library.\nCreatures you control have "{T}: Add one mana of any color."',
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(compiled.definition.topOfLibrary).toEqual({
      look: true,
      castTypesAny: ["creature"],
    });
    expect(compiled.notes).toEqual([]);
  });

  it("plays a land and casts a creature from the top of the library", () => {
    const { game, p1 } = twoPlayers();
    game.turn.phase = "precombatMain";
    game.turn.step = "precombatMain";
    const granter = createCardDefinition({
      name: "Seer of the Top",
      typeLine: "Enchantment",
      topOfLibrary: { look: true, playLands: true, castTypesAny: ["creature"] },
    });
    game.definitions[granter.id] = granter;
    const seer = createCardInstance({ definitionId: granter.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[seer.id] = seer;
    p1.zones.battlefield.push(seer.id);

    // A land on top: playable from the library.
    const forest = createCardDefinition({ name: "Forest", typeLine: "Basic Land - Forest" });
    game.definitions[forest.id] = forest;
    const topLand = createCardInstance({ definitionId: forest.id, ownerId: p1.id, zone: "library" });
    game.cards[topLand.id] = topLand;
    p1.zones.library.unshift(topLand.id);
    const landActions = legalActions(game, p1.id);
    expect(landActions).toContainEqual({ kind: "play_land", cardId: topLand.id, faceIndex: 0 });
    const played = applyAction(game, { kind: "play_land", playerId: p1.id, cardId: topLand.id });
    expect(played.cards[topLand.id]?.zone).toBe("battlefield");

    // A creature now on top: castable from the library with mana available.
    const bear = createCardDefinition({
      name: "Runeclaw Bear",
      manaCost: "{G}",
      typeLine: "Creature - Bear",
      power: 2,
      toughness: 2,
    });
    const next = structuredClone(played);
    next.definitions[bear.id] = bear;
    const p1After = next.players[0]!;
    const topBear = createCardInstance({ definitionId: bear.id, ownerId: p1After.id, zone: "library" });
    next.cards[topBear.id] = topBear;
    p1After.zones.library.unshift(topBear.id);
    p1After.mana.G = 1;
    const castActions = legalActions(next, p1After.id);
    expect(castActions).toContainEqual({
      kind: "cast_spell",
      cardId: topBear.id,
      faceIndex: 0,
      fromCommand: false,
    });
    const cast = applyAction(next, {
      kind: "cast_spell",
      playerId: p1After.id,
      cardId: topBear.id,
      targets: [],
    });
    expect(cast.stack).toHaveLength(1);
    const resolved = resolveTopOfStack(cast);
    expect(resolved.cards[topBear.id]?.zone).toBe("battlefield");

    // A sorcery on top is not castable under a creature-only grant.
    const bolt = createCardDefinition({
      name: "Simple Sorcery",
      manaCost: "{G}",
      typeLine: "Sorcery",
      effects: [{ kind: "gain_life", playerId: "controller", amount: 1 }],
    });
    const blocked = structuredClone(resolved);
    blocked.definitions[bolt.id] = bolt;
    const p1Blocked = blocked.players[0]!;
    const topBolt = createCardInstance({ definitionId: bolt.id, ownerId: p1Blocked.id, zone: "library" });
    blocked.cards[topBolt.id] = topBolt;
    p1Blocked.zones.library.unshift(topBolt.id);
    p1Blocked.mana.G = 1;
    expect(() =>
      applyAction(blocked, {
        kind: "cast_spell",
        playerId: p1Blocked.id,
        cardId: topBolt.id,
        targets: [],
      }),
    ).toThrow();
  });
});

describe("wave 31: flashback (CR 702.34)", () => {
  it("compiles Faithless Looting and Deep Analysis fully", () => {
    const looting = compileOracleCard({
      oracleId: "faithless-looting",
      name: "Faithless Looting",
      manaCost: "{R}",
      typeLine: "Sorcery",
      oracleText: "Draw two cards, then discard two cards.\nFlashback {2}{R} (You may cast this card from your graveyard for its flashback cost. Then exile it.)",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(looting.definition.flashback).toEqual({ manaCost: "{2}{R}" });
    expect(looting.notes).toEqual([]);

    const analysis = compileOracleCard({
      oracleId: "deep-analysis",
      name: "Deep Analysis",
      manaCost: "{3}{U}",
      typeLine: "Sorcery",
      oracleText: "Target player draws two cards.\nFlashback—{1}{U}, Pay 3 life. (You may cast this card from your graveyard for its flashback cost. Then exile it.)",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(analysis.definition.flashback).toEqual({ manaCost: "{1}{U}", life: 3 });
    expect(analysis.notes).toEqual([]);
  });

  it("casts from the graveyard for the flashback cost, then exiles", () => {
    const { game, p1 } = twoPlayers();
    game.turn.phase = "precombatMain";
    game.turn.step = "precombatMain";
    const def = createCardDefinition({
      name: "Echoing Lesson",
      manaCost: "{U}",
      typeLine: "Sorcery",
      effects: [{ kind: "gain_life", playerId: "controller", amount: 2 }],
      flashback: { manaCost: "{2}", life: 1 },
    });
    game.definitions[def.id] = def;
    const spell = createCardInstance({ definitionId: def.id, ownerId: p1.id, zone: "graveyard" });
    game.cards[spell.id] = spell;
    p1.zones.graveyard.push(spell.id);

    // The printed {U} cannot pay it; the flashback {2} can.
    p1.mana.C = 2;
    const actions = legalActions(game, p1.id);
    expect(actions).toContainEqual({
      kind: "cast_spell",
      cardId: spell.id,
      faceIndex: 0,
      fromCommand: false,
    });
    const cast = applyAction(game, {
      kind: "cast_spell",
      playerId: p1.id,
      cardId: spell.id,
      targets: [],
    });
    expect(cast.stack).toHaveLength(1);
    expect(cast.players[0]?.life).toBe(39); // paid 1 life
    const resolved = resolveTopOfStack(cast);
    expect(resolved.players[0]?.life).toBe(41); // gained 2
    expect(resolved.cards[spell.id]?.zone).toBe("exile");
  });

  it("a countered flashback spell is exiled, not returned to the graveyard", () => {
    const { game, p1 } = twoPlayers();
    game.turn.phase = "precombatMain";
    game.turn.step = "precombatMain";
    const def = createCardDefinition({
      name: "Echoing Lesson",
      manaCost: "{U}",
      typeLine: "Sorcery",
      effects: [{ kind: "gain_life", playerId: "controller", amount: 2 }],
      flashback: { manaCost: "{2}" },
    });
    game.definitions[def.id] = def;
    const spell = createCardInstance({ definitionId: def.id, ownerId: p1.id, zone: "graveyard" });
    game.cards[spell.id] = spell;
    p1.zones.graveyard.push(spell.id);
    p1.mana.C = 2;
    const cast = applyAction(game, {
      kind: "cast_spell",
      playerId: p1.id,
      cardId: spell.id,
      targets: [],
    });
    const stackId = cast.stack[0]?.id ?? "";
    const countered = applyEffect(cast, { kind: "counter_spell", stackObjectId: stackId });
    expect(countered.stack).toEqual([]);
    expect(countered.cards[spell.id]?.zone).toBe("exile");
  });
});

describe("wave 32: token and counter doubling (CR 614.1c)", () => {
  it("compiles Anointed Procession, Doubling Season, and Branching Evolution fully", () => {
    const procession = compileOracleCard({
      oracleId: "anointed-procession",
      name: "Anointed Procession",
      manaCost: "{3}{W}",
      typeLine: "Enchantment",
      oracleText:
        "If one or more tokens would be created under your control, twice that many of those tokens are created instead.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(procession.definition.replacements).toEqual([{ kind: "double_tokens" }]);
    expect(procession.notes).toEqual([]);

    const season = compileOracleCard({
      oracleId: "doubling-season",
      name: "Doubling Season",
      manaCost: "{4}{G}",
      typeLine: "Enchantment",
      oracleText:
        "If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.\nIf an effect would put one or more counters on a permanent you control, it puts twice that many of those counters on it instead.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(season.definition.replacements).toEqual([
      { kind: "double_tokens" },
      { kind: "double_counters" },
    ]);
    expect(season.notes).toEqual([]);

    const evolution = compileOracleCard({
      oracleId: "branching-evolution",
      name: "Branching Evolution",
      manaCost: "{2}{G}",
      typeLine: "Enchantment",
      oracleText:
        "If one or more +1/+1 counters would be put on a creature you control, twice that many +1/+1 counters are put on that creature instead.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(evolution.definition.replacements).toEqual([
      { kind: "double_counters", counter: "p1p1", creaturesOnly: true },
    ]);
    expect(evolution.notes).toEqual([]);
  });

  it("doubles created tokens and added counters, stacking multiplicatively", () => {
    const { game, p1, p2 } = twoPlayers();
    const doubler = createCardDefinition({
      name: "Anointed Procession",
      typeLine: "Enchantment",
      replacements: [{ kind: "double_tokens" }, { kind: "double_counters" }],
    });
    game.definitions[doubler.id] = doubler;
    const one = createCardInstance({ definitionId: doubler.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[one.id] = one;
    p1.zones.battlefield.push(one.id);

    let state = applyEffects(game, [
      {
        kind: "create_token",
        ownerId: p1.id,
        name: "Treasure",
        typeLine: "Token Artifact - Treasure",
      },
    ]);
    const treasures = state.players[0]!.zones.battlefield.filter(
      (id) => state.definitions[state.cards[id]!.definitionId]?.name === "Treasure",
    );
    expect(treasures).toHaveLength(2);

    // A second doubler stacks: 1 -> 4.
    const two = createCardInstance({ definitionId: doubler.id, ownerId: p1.id, zone: "battlefield" });
    state = structuredClone(state);
    state.cards[two.id] = two;
    state.players[0]!.zones.battlefield.push(two.id);
    const redoubled = applyEffects(state, [
      {
        kind: "create_token",
        ownerId: state.players[0]!.id,
        name: "Clue",
        typeLine: "Token Artifact - Clue",
      },
    ]);
    const clues = redoubled.players[0]!.zones.battlefield.filter(
      (id) => redoubled.definitions[redoubled.cards[id]!.definitionId]?.name === "Clue",
    );
    expect(clues).toHaveLength(4);

    // Counters double for the doubler's controller, not for opponents.
    const bear = createCardDefinition({
      name: "Runeclaw Bear",
      typeLine: "Creature - Bear",
      power: 2,
      toughness: 2,
    });
    const withBears = structuredClone(redoubled);
    withBears.definitions[bear.id] = bear;
    const mine = createCardInstance({ definitionId: bear.id, ownerId: withBears.players[0]!.id, zone: "battlefield" });
    const theirs = createCardInstance({ definitionId: bear.id, ownerId: p2.id, zone: "battlefield" });
    withBears.cards[mine.id] = mine;
    withBears.cards[theirs.id] = theirs;
    withBears.players[0]!.zones.battlefield.push(mine.id);
    withBears.players[1]!.zones.battlefield.push(theirs.id);
    const counted = applyEffects(withBears, [
      { kind: "add_counter", cardId: mine.id, counter: "p1p1", amount: 1 },
      { kind: "add_counter", cardId: theirs.id, counter: "p1p1", amount: 1 },
    ]);
    expect(counted.cards[mine.id]?.counters["p1p1"]).toBe(4); // two doublers
    expect(counted.cards[theirs.id]?.counters["p1p1"]).toBe(1);
  });
});

describe("wave 33: extra combat phases", () => {
  it("compiles Aggravated Assault and Seize the Day fully", () => {
    const assault = compileOracleCard({
      oracleId: "aggravated-assault",
      name: "Aggravated Assault",
      manaCost: "{2}{R}",
      typeLine: "Enchantment",
      oracleText:
        "{3}{R}{R}: Untap all creatures you control. After this main phase, there is an additional combat phase followed by an additional main phase. Activate only as a sorcery.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(assault.notes).toEqual([]);
    expect(assault.definition.activated).toHaveLength(1);
    const ability = assault.definition.activated[0]!;
    expect(ability.timing).toBe("sorcery");
    expect(ability.effects).toEqual([
      { kind: "untap_all", playerId: "controller", what: "creature" },
      { kind: "extra_combat" },
    ]);

    const seize = compileOracleCard({
      oracleId: "seize-the-day",
      name: "Seize the Day",
      manaCost: "{3}{R}",
      typeLine: "Sorcery",
      oracleText:
        "Untap target creature. After this main phase, there is an additional combat phase followed by an additional main phase.\nFlashback {2}{R} (You may cast this card from your graveyard for its flashback cost. Then exile it.)",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(seize.notes).toEqual([]);
    expect(seize.definition.targetRequirements).toEqual([{ kind: "creature" }]);
    expect(seize.definition.effects).toEqual([
      { kind: "untap", cardId: { type: "chosen", index: 0 } },
      { kind: "extra_combat" },
    ]);
    expect(seize.definition.flashback).toEqual({ manaCost: "{2}{R}" });
  });

  it("re-enters combat once after the postcombat main phase, then ends normally", () => {
    const { game } = twoPlayers();
    game.turn.phase = "postcombatMain";
    game.turn.step = "postcombatMain";
    const withExtra = applyEffect(game, { kind: "extra_combat" });
    expect(withExtra.pendingExtraCombats).toBe(1);

    const backToCombat = advanceSteps(withExtra, 1);
    expect(backToCombat.turn.phase).toBe("combat");
    expect(backToCombat.turn.step).toBe("beginCombat");
    expect(backToCombat.pendingExtraCombats).toBe(0);

    // Walk the extra combat through to the second postcombat main, then out.
    const secondMain = advanceSteps(backToCombat, 5);
    expect(secondMain.turn.phase).toBe("postcombatMain");
    const ending = advanceSteps(secondMain, 1);
    expect(ending.turn.phase).toBe("ending");
  });
});

describe("wave 34: proliferate, self-untap, and tribal cast heads", () => {
  it("compiles Unnatural Restoration and Leaf-Crowned Visionary shapes", () => {
    const restoration = compileOracleCard({
      oracleId: "unnatural-restoration",
      name: "Unnatural Restoration",
      manaCost: "{1}{G}",
      typeLine: "Sorcery",
      oracleText:
        "Return target permanent card from your graveyard to your hand. Proliferate. (Choose any number of permanents and/or players, then give each another counter of each kind already there.)",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(restoration.definition.effects.some((e) => e.kind === "proliferate")).toBe(true);
    expect(restoration.notes).toEqual([]);

    const visionary = compileOracleCard({
      oracleId: "leaf-crowned-visionary",
      name: "Leaf-Crowned Visionary",
      manaCost: "{G}{G}",
      typeLine: "Creature - Elf Druid",
      oracleText:
        "Other Elves you control get +1/+1.\nWhenever you cast an Elf spell, you may pay {G}. If you do, draw a card.",
      power: "2",
      toughness: "2",
      printedKeywords: [],
      imageUrl: "",
    });
    const cast = visionary.definition.triggers.find((t) => t.event === "cast_spell");
    expect(cast?.subjectFilter).toEqual({ subtypes: ["elf"] });
    expect(cast?.effects[0]?.kind).toBe("may_pay");
  });

  it("proliferate adds one of each counter kind to own permanents only", () => {
    const { game, p1, p2 } = twoPlayers();
    const bear = createCardDefinition({
      name: "Runeclaw Bear",
      typeLine: "Creature - Bear",
      power: 2,
      toughness: 2,
    });
    game.definitions[bear.id] = bear;
    const mine = createCardInstance({ definitionId: bear.id, ownerId: p1.id, zone: "battlefield" });
    mine.counters["p1p1"] = 2;
    mine.counters["m1m1"] = 1;
    const bare = createCardInstance({ definitionId: bear.id, ownerId: p1.id, zone: "battlefield" });
    const theirs = createCardInstance({ definitionId: bear.id, ownerId: p2.id, zone: "battlefield" });
    theirs.counters["p1p1"] = 1;
    game.cards[mine.id] = mine;
    game.cards[bare.id] = bare;
    game.cards[theirs.id] = theirs;
    p1.zones.battlefield.push(mine.id, bare.id);
    p2.zones.battlefield.push(theirs.id);

    const after = applyEffect(game, { kind: "proliferate", playerId: p1.id });
    expect(after.cards[mine.id]?.counters["p1p1"]).toBe(3);
    expect(after.cards[mine.id]?.counters["m1m1"]).toBe(1); // skipped
    expect(after.cards[bare.id]?.counters["p1p1"]).toBeUndefined(); // no counters, none added
    expect(after.cards[theirs.id]?.counters["p1p1"]).toBe(1); // opponents untouched
  });

  it("compiles and applies '{5}: Untap ~'", () => {
    const compiled = compileOracleCard({
      oracleId: "untapper",
      name: "Basalt Monolith",
      manaCost: "{3}",
      typeLine: "Artifact",
      oracleText: "{T}: Add {C}{C}{C}.\n{3}: Untap Basalt Monolith.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(compiled.definition.activated).toHaveLength(1);
    expect(compiled.definition.activated[0]?.effects).toEqual([{ kind: "untap", cardId: "self" }]);
    expect(compiled.notes).toEqual([]);
  });
});

describe("wave 35: any-damage triggers and aura host watching (Curiosity)", () => {
  it("compiles Curiosity fully", () => {
    const compiled = compileOracleCard({
      oracleId: "curiosity",
      name: "Curiosity",
      manaCost: "{U}",
      typeLine: "Enchantment - Aura",
      oracleText:
        "Enchant creature\nWhenever enchanted creature deals damage to an opponent, you may draw a card.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(compiled.notes).toEqual([]);
    expect(compiled.definition.enchant).toBe("creature");
    const trigger = compiled.definition.triggers[0];
    expect(trigger?.event).toBe("deals_damage_to_player");
    expect(trigger?.watch).toBe("attached");
    expect(trigger?.subjectPlayerOpponent).toBe(true);
  });

  it("fires on noncombat damage from the host, not on damage to its controller", () => {
    const { game, p1, p2 } = twoPlayers();
    fillLibraries(game, 5);
    const hostDef = createCardDefinition({
      name: "Sparker",
      typeLine: "Creature - Elemental",
      power: 1,
      toughness: 1,
    });
    const auraDef = createCardDefinition({
      name: "Curiosity",
      typeLine: "Enchantment - Aura",
      enchant: "creature",
      triggers: [
        {
          event: "deals_damage_to_player",
          watch: "attached",
          subjectPlayerOpponent: true,
          effects: [{ kind: "draw", playerId: "controller", count: 1 }],
          targetRequirements: [],
        },
      ],
    });
    game.definitions[hostDef.id] = hostDef;
    game.definitions[auraDef.id] = auraDef;
    const host = createCardInstance({ definitionId: hostDef.id, ownerId: p1.id, zone: "battlefield" });
    const aura = createCardInstance({ definitionId: auraDef.id, ownerId: p1.id, zone: "battlefield" });
    aura.attachedTo = host.id;
    game.cards[host.id] = host;
    game.cards[aura.id] = aura;
    p1.zones.battlefield.push(host.id, aura.id);

    // Noncombat damage to the opponent: the trigger goes on the stack.
    const zapped = applyEffects(game, [
      {
        kind: "deal_damage",
        sourceId: host.id,
        amount: 1,
        target: { type: "player", playerId: p2.id },
      },
    ]);
    expect(zapped.stack).toHaveLength(1);

    // Damage to the aura controller's own face: no trigger.
    const selfHit = applyEffects(game, [
      {
        kind: "deal_damage",
        sourceId: host.id,
        amount: 1,
        target: { type: "player", playerId: p1.id },
      },
    ]);
    expect(selfHit.stack).toHaveLength(0);

    // Damage from a different creature: the aura is not watching it.
    const other = createCardInstance({ definitionId: hostDef.id, ownerId: p1.id, zone: "battlefield" });
    const withOther = structuredClone(game);
    withOther.cards[other.id] = other;
    withOther.players[0]!.zones.battlefield.push(other.id);
    const otherHit = applyEffects(withOther, [
      {
        kind: "deal_damage",
        sourceId: other.id,
        amount: 1,
        target: { type: "player", playerId: p2.id },
      },
    ]);
    expect(otherHit.stack).toHaveLength(0);
  });
});

describe("wave 36: multi-sentence ability bodies and delayed end-step riders", () => {
  it("compiles Ozolith, the Shattered Spire's counter ability fully", () => {
    const compiled = compileOracleCard({
      oracleId: "ozolith-spire",
      name: "Ozolith, the Shattered Spire",
      manaCost: "{1}{G}",
      typeLine: "Legendary Artifact",
      oracleText:
        "{1}{G}, {T}: Put a +1/+1 counter on target artifact or creature you control. Activate only as a sorcery.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(compiled.notes).toEqual([]);
    const ability = compiled.definition.activated[0];
    expect(ability?.timing).toBe("sorcery");
    expect(ability?.targetRequirements).toEqual([{ kind: "creature_or_artifact", control: "own" }]);
    expect(ability?.effects).toEqual([
      { kind: "add_counter", cardId: { type: "chosen", index: 0 }, counter: "p1p1", amount: 1 },
    ]);
  });

  it("compiles a Jaxis-lite temporary-copy ability as one multi-sentence body", () => {
    const compiled = compileOracleCard({
      oracleId: "copy-forge",
      name: "Copy Forge",
      manaCost: "{3}",
      typeLine: "Artifact",
      oracleText:
        "{2}, {T}: Create a token that's a copy of target creature you control. It gains haste. Sacrifice it at the beginning of the next end step. Activate only as a sorcery.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(compiled.notes).toEqual([]);
    const ability = compiled.definition.activated[0];
    expect(ability?.timing).toBe("sorcery");
    expect(ability?.effects).toEqual([
      {
        kind: "copy_token",
        ownerId: "controller",
        ofCardId: { type: "chosen", index: 0 },
        gainsHaste: true,
        atEndStep: "sacrifice",
      },
    ]);
  });

  it("temporary copies get haste and die at the beginning of the end step", () => {
    const { game, p1 } = twoPlayers();
    const bear = createCardDefinition({
      name: "Runeclaw Bear",
      typeLine: "Creature - Bear",
      power: 2,
      toughness: 2,
    });
    game.definitions[bear.id] = bear;
    const original = createCardInstance({ definitionId: bear.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[original.id] = original;
    p1.zones.battlefield.push(original.id);

    const copied = applyEffect(game, {
      kind: "copy_token",
      ownerId: p1.id,
      ofCardId: original.id,
      gainsHaste: true,
      atEndStep: "sacrifice",
    });
    const tokenId = copied.players[0]!.zones.battlefield.find(
      (id) => id !== original.id && copied.cards[id]?.isToken,
    )!;
    expect(copied.cards[tokenId]?.summoningSick).toBe(false);
    expect(copied.delayedEndStep).toEqual([{ cardId: tokenId, action: "sacrifice" }]);

    // Walk to the end step: the token is sacrificed, the original survives.
    copied.turn.phase = "postcombatMain";
    copied.turn.step = "postcombatMain";
    const atEnd = advanceSteps(copied, 1);
    expect(atEnd.turn.step).toBe("end");
    expect(atEnd.cards[tokenId]?.zone).not.toBe("battlefield");
    expect(atEnd.cards[original.id]?.zone).toBe("battlefield");
    expect(atEnd.delayedEndStep).toEqual([]);
  });
});
