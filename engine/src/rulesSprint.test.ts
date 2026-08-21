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
  legalChoicesForRequirement,
  moveCard,
  validateChosenTargets,
  putSpellOnStack,
  resolveTopOfStack,
} from "./index";
import { cardMatchesSubtype, computedCard } from "./characteristicsEngine";
import { castCostReduction, landDropAllowance } from "./derived";
import { hasKeyword } from "./keywords";
import { dispatchEventsInPlace } from "./triggers";
import { applyCombatDamage, declareAttackers } from "./combat";
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

describe("wave 37: fetch-sac lands and deckbuilding markers", () => {
  it("compiles Brokers Hideout fully", () => {
    const compiled = compileOracleCard({
      oracleId: "brokers-hideout",
      name: "Brokers Hideout",
      manaCost: "",
      typeLine: "Land",
      oracleText:
        "When this land enters, sacrifice it. When you do, search your library for a basic Forest, Plains, or Island card, put it onto the battlefield tapped, then shuffle and you gain 1 life.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(compiled.notes).toEqual([]);
    const trigger = compiled.definition.triggers[0];
    expect(trigger?.event).toBe("enter_battlefield");
    expect(trigger?.effects).toEqual([
      { kind: "sacrifice", cardId: "self" },
      {
        kind: "search_library",
        playerId: "controller",
        filter: { supertypes: ["basic"], subtypesAny: ["forest", "plains", "island"] },
        destination: "battlefield",
        count: 1,
        entersTapped: true,
      },
      { kind: "gain_life", playerId: "controller", amount: 1 },
    ]);
  });

  it("compiles Kediss with Partner as a deckbuilding no-op", () => {
    const compiled = compileOracleCard({
      oracleId: "kediss",
      name: "Kediss, Emberclaw Familiar",
      manaCost: "{1}{R}",
      typeLine: "Legendary Creature - Elemental Lizard",
      oracleText: "Partner (You can have two commanders if both have partner.)",
      power: "1",
      toughness: "1",
      printedKeywords: ["Partner"],
      imageUrl: "",
    });
    expect(compiled.notes).toEqual([]);
  });
});

describe("wave 38: unblockable-until-EOT, self-shuffle, dies-return counters", () => {
  it("compiles Rogue's Passage fully", () => {
    const compiled = compileOracleCard({
      oracleId: "rogues-passage",
      name: "Rogue's Passage",
      manaCost: "",
      typeLine: "Land",
      oracleText: "{T}: Add {C}.\n{4}, {T}: Target creature can't be blocked this turn.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(compiled.notes).toEqual([]);
    const ability = compiled.definition.activated[0];
    expect(ability?.targetRequirements).toEqual([{ kind: "creature" }]);
    expect(ability?.effects).toEqual([
      { kind: "restrict_until_eot", cardId: { type: "chosen", index: 0 }, cantBeBlocked: true },
    ]);
  });

  it("unblockable wears off during cleanup", () => {
    const { game, p1 } = twoPlayers();
    const bear = createCardDefinition({
      name: "Runeclaw Bear",
      typeLine: "Creature - Bear",
      power: 2,
      toughness: 2,
    });
    game.definitions[bear.id] = bear;
    const runner = createCardInstance({ definitionId: bear.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[runner.id] = runner;
    p1.zones.battlefield.push(runner.id);

    const boosted = applyEffect(game, {
      kind: "restrict_until_eot",
      cardId: runner.id,
      cantBeBlocked: true,
    });
    expect(computedCard(boosted, runner.id)?.cantBeBlocked).toBe(true);
    boosted.turn.phase = "ending";
    boosted.turn.step = "end";
    const cleaned = advanceSteps(boosted, 1);
    expect(cleaned.turn.step).toBe("cleanup");
    expect(computedCard(cleaned, runner.id)?.cantBeBlocked).toBe(false);
  });

  it("shuffles itself into its owner's library and returns with a counter", () => {
    const selfShuffle = compileOracleCard({
      oracleId: "self-shuffler",
      name: "Beacon of Unrest",
      manaCost: "{4}{B}",
      typeLine: "Sorcery",
      oracleText: "Shuffle Beacon of Unrest into its owner's library.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(selfShuffle.definition.effects).toEqual([
      { kind: "move_card", cardId: "self", toZone: "library", libraryPosition: "shuffled" },
    ]);

    const diesReturn = compileOracleCard({
      oracleId: "counter-returner",
      name: "Mishra's Bauble Bearer",
      manaCost: "{2}",
      typeLine: "Artifact Creature - Construct",
      oracleText:
        "When this creature dies, return it to the battlefield tapped under its owner's control with a +1/+1 counter on it.",
      power: "1",
      toughness: "1",
      printedKeywords: [],
      imageUrl: "",
    });
    const trigger = diesReturn.definition.triggers[0];
    expect(trigger?.event).toBe("dies");
    expect(trigger?.effects).toEqual([
      { kind: "move_card", cardId: "self", toZone: "battlefield", entersTapped: true },
      { kind: "add_counter", cardId: "self", counter: "p1p1", amount: 1 },
    ]);
  });
});

describe("wave 39: kicker as an extra-cost mode (CR 702.33)", () => {
  it("compiles Tear Asunder and Rite of Replication fully", () => {
    const tear = compileOracleCard({
      oracleId: "tear-asunder",
      name: "Tear Asunder",
      manaCost: "{1}{G}",
      typeLine: "Instant",
      oracleText:
        "Kicker {1}{B} (You may pay an additional {1}{B} as you cast this spell.)\nExile target artifact or enchantment. If this spell was kicked, exile target nonland permanent instead.",
      power: null,
      toughness: null,
      printedKeywords: ["Kicker"],
      imageUrl: "",
    });
    expect(tear.notes).toEqual([]);
    expect(tear.definition.modes).toHaveLength(2);
    expect(tear.definition.modes?.[0]?.targetRequirements).toEqual([
      { kind: "artifact_or_enchantment" },
    ]);
    expect(tear.definition.modes?.[1]?.extraCost).toBe("{1}{B}");
    expect(tear.definition.modes?.[1]?.targetRequirements).toEqual([{ kind: "nonland_permanent" }]);

    const rite = compileOracleCard({
      oracleId: "rite-of-replication",
      name: "Rite of Replication",
      manaCost: "{2}{U}{U}",
      typeLine: "Sorcery",
      oracleText:
        "Kicker {5} (You may pay an additional {5} as you cast this spell.)\nCreate a token that's a copy of target creature. If this spell was kicked, create five of those tokens instead.",
      power: null,
      toughness: null,
      printedKeywords: ["Kicker"],
      imageUrl: "",
    });
    expect(rite.notes).toEqual([]);
    expect(rite.definition.modes?.[1]?.effects).toEqual([
      { kind: "copy_token", ownerId: "controller", ofCardId: { type: "chosen", index: 0 }, count: 5 },
    ]);
  });

  it("charges the kicked cost and refuses it unpaid", () => {
    const { game, p1, p2 } = twoPlayers();
    game.turn.phase = "precombatMain";
    game.turn.step = "precombatMain";
    const bear = createCardDefinition({
      name: "Runeclaw Bear",
      typeLine: "Creature - Bear",
      power: 2,
      toughness: 2,
    });
    game.definitions[bear.id] = bear;
    const target = createCardInstance({ definitionId: bear.id, ownerId: p2.id, zone: "battlefield" });
    game.cards[target.id] = target;
    p2.zones.battlefield.push(target.id);

    const riteDef = createCardDefinition({
      name: "Rite of Replication",
      manaCost: "{2}{U}{U}",
      typeLine: "Sorcery",
      modes: [
        {
          label: "Unkicked",
          effects: [
            { kind: "copy_token", ownerId: "controller", ofCardId: { type: "chosen", index: 0 } },
          ],
          targetRequirements: [{ kind: "creature" }],
        },
        {
          label: "Kicked {5}",
          extraCost: "{5}",
          effects: [
            {
              kind: "copy_token",
              ownerId: "controller",
              ofCardId: { type: "chosen", index: 0 },
              count: 5,
            },
          ],
          targetRequirements: [{ kind: "creature" }],
        },
      ],
    });
    game.definitions[riteDef.id] = riteDef;
    const spell = createCardInstance({ definitionId: riteDef.id, ownerId: p1.id, zone: "hand" });
    game.cards[spell.id] = spell;
    p1.zones.hand.push(spell.id);
    p1.mana.U = 2;
    p1.mana.C = 2;

    // Base mana only: the kicked mode is refused.
    expect(() =>
      applyAction(game, {
        kind: "cast_spell",
        playerId: p1.id,
        cardId: spell.id,
        targets: [{ type: "creature", cardId: target.id }],
        modeIndex: 1,
      }),
    ).toThrow();

    // With five more: the kicked cast resolves into five copies.
    const rich = structuredClone(game);
    rich.players[0]!.mana.C = 7;
    const cast = applyAction(rich, {
      kind: "cast_spell",
      playerId: rich.players[0]!.id,
      cardId: spell.id,
      targets: [{ type: "creature", cardId: target.id }],
      modeIndex: 1,
    });
    const resolved = resolveTopOfStack(cast);
    const tokens = resolved.players[0]!.zones.battlefield.filter(
      (id) => resolved.cards[id]?.isToken,
    );
    expect(tokens).toHaveLength(5);
  });
});

describe("wave 40: storm (CR 702.40)", () => {
  it("compiles Grapeshot and Flusterstorm fully", () => {
    const grapeshot = compileOracleCard({
      oracleId: "grapeshot",
      name: "Grapeshot",
      manaCost: "{1}{R}",
      typeLine: "Sorcery",
      oracleText:
        "Grapeshot deals 1 damage to any target.\nStorm (When you cast this spell, copy it for each spell cast before it this turn. You may choose new targets for the copies.)",
      power: null,
      toughness: null,
      printedKeywords: ["Storm"],
      imageUrl: "",
    });
    expect(grapeshot.notes).toEqual([]);
    expect(grapeshot.definition.storm).toBe(true);

    const fluster = compileOracleCard({
      oracleId: "flusterstorm",
      name: "Flusterstorm",
      manaCost: "{U}",
      typeLine: "Instant",
      oracleText:
        "Counter target instant or sorcery spell unless its controller pays {1}.\nStorm (When you cast this spell, copy it for each spell cast before it this turn. You may choose new targets for the copies.)",
      power: null,
      toughness: null,
      printedKeywords: ["Storm"],
      imageUrl: "",
    });
    expect(fluster.notes).toEqual([]);
    expect(fluster.definition.storm).toBe(true);
    expect(fluster.definition.targetRequirements).toEqual([{ kind: "instant_or_sorcery_spell" }]);
  });

  it("casting a storm spell copies it per earlier cast this turn", () => {
    const { game, p1 } = twoPlayers();
    game.turn.phase = "precombatMain";
    game.turn.step = "precombatMain";
    const filler = createCardDefinition({
      name: "Simple Rite",
      manaCost: "",
      typeLine: "Sorcery",
      effects: [{ kind: "gain_life", playerId: "controller", amount: 1 }],
    });
    const stormDef = createCardDefinition({
      name: "Life Storm",
      manaCost: "",
      typeLine: "Sorcery",
      storm: true,
      effects: [{ kind: "gain_life", playerId: "controller", amount: 1 }],
    });
    game.definitions[filler.id] = filler;
    game.definitions[stormDef.id] = stormDef;
    const first = createCardInstance({ definitionId: filler.id, ownerId: p1.id, zone: "hand" });
    const second = createCardInstance({ definitionId: filler.id, ownerId: p1.id, zone: "hand" });
    const stormCard = createCardInstance({ definitionId: stormDef.id, ownerId: p1.id, zone: "hand" });
    for (const card of [first, second, stormCard]) {
      game.cards[card.id] = card;
      p1.zones.hand.push(card.id);
    }

    // Cast and resolve two spells first.
    let state = applyAction(game, { kind: "cast_spell", playerId: p1.id, cardId: first.id, targets: [] });
    state = resolveTopOfStack(state);
    state = applyAction(state, { kind: "cast_spell", playerId: p1.id, cardId: second.id, targets: [] });
    state = resolveTopOfStack(state);
    expect(state.spellsCastThisTurn).toBe(2);

    // The storm spell adds two copies above itself: 3 stack objects.
    state = applyAction(state, { kind: "cast_spell", playerId: p1.id, cardId: stormCard.id, targets: [] });
    expect(state.stack).toHaveLength(3);
    expect(state.stack.filter((entry) => entry.isCopy)).toHaveLength(2);
    state = resolveTopOfStack(state);
    state = resolveTopOfStack(state);
    state = resolveTopOfStack(state);
    // 2 filler + storm original + 2 copies = 5 life gained in total.
    expect(state.players[0]?.life).toBe(45);
    expect(state.cards[stormCard.id]?.zone).toBe("graveyard");
    expect(state.stack).toEqual([]);
  });
});

describe("wave 41: spree (CR 702.169)", () => {
  it("compiles Requisition Raid and Three Steps Ahead fully", () => {
    const raid = compileOracleCard({
      oracleId: "requisition-raid",
      name: "Requisition Raid",
      manaCost: "{W}",
      typeLine: "Sorcery",
      oracleText:
        "Spree (Choose one or more additional costs.)\n+ {1} — Destroy target artifact.\n+ {1} — Destroy target enchantment.\n+ {1} — Put a +1/+1 counter on each creature target player controls.",
      power: null,
      toughness: null,
      printedKeywords: ["Spree"],
      imageUrl: "",
    });
    expect(raid.notes).toEqual([]);
    expect(raid.definition.modes).toHaveLength(3);
    expect(raid.definition.modeChoice).toEqual({ min: 1, max: 3 });
    expect(raid.definition.modes?.every((mode) => mode.extraCost === "{1}")).toBe(true);

    const steps = compileOracleCard({
      oracleId: "three-steps-ahead",
      name: "Three Steps Ahead",
      manaCost: "{U}",
      typeLine: "Instant",
      oracleText:
        "Spree (Choose one or more additional costs.)\n+ {1}{U} — Counter target spell.\n+ {3} — Create a token that's a copy of target artifact or creature you control.\n+ {2} — Draw two cards, then discard a card.",
      power: null,
      toughness: null,
      printedKeywords: ["Spree"],
      imageUrl: "",
    });
    expect(steps.notes).toEqual([]);
    expect(steps.definition.modes).toHaveLength(3);
    expect(steps.definition.modes?.[1]?.targetRequirements).toEqual([
      { kind: "creature_or_artifact", control: "own" },
    ]);
  });

  it("charges every chosen spree mode's extra cost", () => {
    const { game, p1 } = twoPlayers();
    game.turn.phase = "precombatMain";
    game.turn.step = "precombatMain";
    const spree = createCardDefinition({
      name: "Twin Errands",
      manaCost: "{W}",
      typeLine: "Sorcery",
      modeChoice: { min: 1, max: 2 },
      modes: [
        {
          label: "+ {1} — gain 2",
          extraCost: "{1}",
          effects: [{ kind: "gain_life", playerId: "controller", amount: 2 }],
          targetRequirements: [],
        },
        {
          label: "+ {2} — gain 5",
          extraCost: "{2}",
          effects: [{ kind: "gain_life", playerId: "controller", amount: 5 }],
          targetRequirements: [],
        },
      ],
    });
    game.definitions[spree.id] = spree;
    const card = createCardInstance({ definitionId: spree.id, ownerId: p1.id, zone: "hand" });
    game.cards[card.id] = card;
    p1.zones.hand.push(card.id);

    // {W} + {1} + {2} = both modes need 4 mana; 3 is refused.
    p1.mana.W = 1;
    p1.mana.C = 2;
    expect(() =>
      applyAction(game, {
        kind: "cast_spell",
        playerId: p1.id,
        cardId: card.id,
        targets: [],
        modeIndexes: [0, 1],
      }),
    ).toThrow();

    const rich = structuredClone(game);
    rich.players[0]!.mana.C = 3;
    const cast = applyAction(rich, {
      kind: "cast_spell",
      playerId: rich.players[0]!.id,
      cardId: card.id,
      targets: [],
      modeIndexes: [0, 1],
    });
    const resolved = resolveTopOfStack(cast);
    expect(resolved.players[0]?.life).toBe(47);
  });
});

describe("wave 42: one-away batch", () => {
  it("doubles life gain per doubler the gaining player controls", () => {
    const { game, p1 } = twoPlayers();
    const mender = createCardDefinition({
      name: "Rhox Faithmender",
      typeLine: "Creature - Rhino Monk",
      power: 1,
      toughness: 5,
      replacements: [{ kind: "double_life_gain" }],
    });
    game.definitions[mender.id] = mender;
    const body = createCardInstance({ definitionId: mender.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[body.id] = body;
    p1.zones.battlefield.push(body.id);
    const after = applyEffect(game, { kind: "gain_life", playerId: p1.id, amount: 3 });
    expect(after.players[0]?.life).toBe(46);
  });

  it("compiles doesn't-untap, top-revealed, tribal discounts, and Other-anthems", () => {
    const winter = compileOracleCard({
      oracleId: "winter-orb-ish",
      name: "Static Orb Post",
      manaCost: "{2}",
      typeLine: "Artifact",
      oracleText: "Static Orb Post doesn't untap during your untap step.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(winter.definition.doesntUntap).toBe(true);
    expect(winter.notes).toEqual([]);

    const courser = compileOracleCard({
      oracleId: "reveal-top",
      name: "Watcher of Ways",
      manaCost: "{2}",
      typeLine: "Artifact",
      oracleText: "Play with the top card of your library revealed.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(courser.definition.topOfLibrary).toEqual({ look: true });
    expect(courser.notes).toEqual([]);

    const dragonspeaker = compileOracleCard({
      oracleId: "dragonspeaker",
      name: "Dragonspeaker Shaman",
      manaCost: "{1}{R}{R}",
      typeLine: "Creature - Human Barbarian Shaman",
      oracleText: "Dragon spells you cast cost {2} less to cast.",
      power: "2",
      toughness: "2",
      printedKeywords: [],
      imageUrl: "",
    });
    expect(dragonspeaker.definition.costReductions).toEqual([
      { generic: 2, filter: { subtypesAny: ["dragon"] } },
    ]);
    expect(dragonspeaker.notes).toEqual([]);

    const visionary = compileOracleCard({
      oracleId: "elf-lord",
      name: "Elvish Archdruid Lite",
      manaCost: "{1}{G}{G}",
      typeLine: "Creature - Elf Druid",
      oracleText: "Other Elves you control get +1/+1.",
      power: "2",
      toughness: "2",
      printedKeywords: [],
      imageUrl: "",
    });
    expect(visionary.definition.staticAbilities).toEqual([
      {
        selector: { scope: "controlled", subtypes: ["elf"], excludeSelf: true },
        effect: { kind: "modify_pt", power: 1, toughness: 1 },
      },
    ]);
    expect(visionary.notes).toEqual([]);
  });

  it("an Other-anthem boosts siblings but not itself, and untap skips locked permanents", () => {
    const { game, p1 } = twoPlayers();
    const lord = createCardDefinition({
      name: "Elf Lord",
      typeLine: "Creature - Elf Druid",
      power: 2,
      toughness: 2,
      staticAbilities: [
        {
          selector: { scope: "controlled", subtypes: ["elf"], excludeSelf: true },
          effect: { kind: "modify_pt", power: 1, toughness: 1 },
        },
      ],
    });
    const grunt = createCardDefinition({
      name: "Elf Grunt",
      typeLine: "Creature - Elf Warrior",
      power: 1,
      toughness: 1,
    });
    game.definitions[lord.id] = lord;
    game.definitions[grunt.id] = grunt;
    const lordCard = createCardInstance({ definitionId: lord.id, ownerId: p1.id, zone: "battlefield" });
    const gruntCard = createCardInstance({ definitionId: grunt.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[lordCard.id] = lordCard;
    game.cards[gruntCard.id] = gruntCard;
    p1.zones.battlefield.push(lordCard.id, gruntCard.id);
    expect(computedCard(game, gruntCard.id)?.power).toBe(2);
    expect(computedCard(game, lordCard.id)?.power).toBe(2); // not itself

    const orb = createCardDefinition({
      name: "Locked Relic",
      typeLine: "Artifact",
      doesntUntap: true,
    });
    game.definitions[orb.id] = orb;
    const relic = createCardInstance({ definitionId: orb.id, ownerId: p1.id, zone: "battlefield" });
    relic.tapped = true;
    gruntCard.tapped = true;
    game.cards[relic.id] = relic;
    p1.zones.battlefield.push(relic.id);
    // Make p1 the incoming active player so their untap step is next.
    game.turn.activePlayerId = game.players[1]!.id;
    game.priorityPlayerId = game.players[1]!.id;
    game.turn.phase = "ending";
    game.turn.step = "cleanup";
    const nextTurn = advanceSteps(game, 1);
    expect(nextTurn.turn.step).toBe("untap");
    expect(nextTurn.cards[gruntCard.id]?.tapped).toBe(false);
    expect(nextTurn.cards[relic.id]?.tapped).toBe(true);
  });
});

describe("wave 43: one-away batch two", () => {
  it("compiles the five new shapes fully", () => {
    const orrery = compileOracleCard({
      oracleId: "orrery", name: "Vedalken Orrery", manaCost: "{4}", typeLine: "Artifact",
      oracleText: "You may cast spells as though they had flash.",
      power: null, toughness: null, printedKeywords: [], imageUrl: "",
    });
    expect(orrery.definition.grantsFlash).toBe(true);
    expect(orrery.notes).toEqual([]);

    const mine = compileOracleCard({
      oracleId: "howling-mine", name: "Howling Mine", manaCost: "{2}", typeLine: "Artifact",
      oracleText: "At the beginning of each player's draw step, that player draws an additional card.",
      power: null, toughness: null, printedKeywords: [], imageUrl: "",
    });
    expect(mine.definition.extraDrawStepDraws).toBe(true);
    expect(mine.notes).toEqual([]);

    const frogmite = compileOracleCard({
      oracleId: "frogmite", name: "Frogmite", manaCost: "{4}", typeLine: "Artifact Creature - Frog",
      oracleText: "Affinity for artifacts (This spell costs {1} less to cast for each artifact you control.)",
      power: "2", toughness: "2", printedKeywords: ["Affinity for artifacts"], imageUrl: "",
    });
    expect(frogmite.definition.affinityArtifacts).toBe(true);
    expect(frogmite.notes).toEqual([]);

    const exalted = compileOracleCard({
      oracleId: "exalted-one", name: "Sublime Guard", manaCost: "{1}{W}", typeLine: "Creature - Human Cleric",
      oracleText: "Exalted (Whenever a creature you control attacks alone, that creature gets +1/+1 until end of turn.)",
      power: "2", toughness: "2", printedKeywords: ["Exalted"], imageUrl: "",
    });
    expect(exalted.definition.triggers[0]).toMatchObject({
      event: "attacks", watch: "controlled", attacksAlone: true,
    });
    expect(exalted.notes).toEqual([]);

    const rekindle = compileOracleCard({
      oracleId: "draw-pain", name: "Sting Mage", manaCost: "{1}{R}", typeLine: "Creature - Human Wizard",
      oracleText: "Whenever an opponent draws a card, Sting Mage deals 1 damage to that player.",
      power: "1", toughness: "1", printedKeywords: [], imageUrl: "",
    });
    expect(rekindle.notes).toEqual([]);
    expect(rekindle.definition.triggers[0]?.effects[0]).toMatchObject({
      kind: "deal_damage",
      target: { type: "player", playerId: { type: "subject_player" } },
    });
  });

  it("affinity and flash grants change castability; untap-up-to frees lands", () => {
    const { game, p1 } = twoPlayers();
    game.turn.phase = "precombatMain";
    game.turn.step = "precombatMain";
    const trinket = createCardDefinition({ name: "Trinket", typeLine: "Artifact" });
    game.definitions[trinket.id] = trinket;
    for (let i = 0; i < 3; i += 1) {
      const piece = createCardInstance({ definitionId: trinket.id, ownerId: p1.id, zone: "battlefield" });
      game.cards[piece.id] = piece;
      p1.zones.battlefield.push(piece.id);
    }
    const frog = createCardDefinition({
      name: "Frogmite",
      manaCost: "{4}",
      typeLine: "Artifact Creature - Frog",
      power: 2,
      toughness: 2,
      affinityArtifacts: true,
    });
    game.definitions[frog.id] = frog;
    const card = createCardInstance({ definitionId: frog.id, ownerId: p1.id, zone: "hand" });
    game.cards[card.id] = card;
    p1.zones.hand.push(card.id);
    p1.mana.C = 1; // {4} minus three artifacts = {1}
    const cast = applyAction(game, { kind: "cast_spell", playerId: p1.id, cardId: card.id, targets: [] });
    expect(cast.stack).toHaveLength(1);

    const tapped = structuredClone(game);
    const landDef = createCardDefinition({ name: "Forest", typeLine: "Basic Land - Forest" });
    tapped.definitions[landDef.id] = landDef;
    const lands = [0, 1, 2, 3].map(() => {
      const land = createCardInstance({ definitionId: landDef.id, ownerId: tapped.players[0]!.id, zone: "battlefield" });
      land.tapped = true;
      tapped.cards[land.id] = land;
      tapped.players[0]!.zones.battlefield.push(land.id);
      return land.id;
    });
    const untapped = applyEffect(tapped, {
      kind: "untap_lands_up_to",
      playerId: tapped.players[0]!.id,
      count: 3,
    });
    const freed = lands.filter((id) => untapped.cards[id]?.tapped === false);
    expect(freed).toHaveLength(3);
  });
});

describe("wave 44: gated mana, costed mana, spirit guides, fog", () => {
  it("compiles Cabal Stronghold-class gate, Springleaf Drum, Simian Spirit Guide, and Fog", () => {
    const gated = compileOracleCard({
      oracleId: "gated-land",
      name: "Crypt of Agadeem",
      manaCost: "",
      typeLine: "Land",
      oracleText: "{T}: Add {B}. Activate only if you control a Swamp.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(gated.notes).toEqual([]);
    expect(gated.definition.manaAbilities[0]?.requiresControlled).toEqual({ subtypes: ["swamp"] });

    const drum = compileOracleCard({
      oracleId: "shores",
      name: "Unknown Shores",
      manaCost: "",
      typeLine: "Land",
      oracleText: "{1}, {T}: Add one mana of any color.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(drum.notes).toEqual([]);
    expect(drum.definition.manaAbilities[0]?.costMana).toBe("{1}");
    expect(drum.definition.manaAbilities[0]?.producesAnyColor).toBe(true);

    const guide = compileOracleCard({
      oracleId: "simian",
      name: "Simian Spirit Guide",
      manaCost: "{2}{R}",
      typeLine: "Creature - Ape Spirit",
      oracleText: "Exile this card from your hand: Add {R}.",
      power: "2",
      toughness: "2",
      printedKeywords: [],
      imageUrl: "",
    });
    expect(guide.notes).toEqual([]);
    expect(guide.definition.activated[0]).toMatchObject({
      zone: "hand",
      exileSelf: true,
      effects: [{ kind: "add_mana", playerId: "controller", mana: { R: 1 } }],
    });

    const fog = compileOracleCard({
      oracleId: "fog",
      name: "Fog",
      manaCost: "{G}",
      typeLine: "Instant",
      oracleText: "Prevent all combat damage that would be dealt this turn.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(fog.notes).toEqual([]);
    expect(fog.definition.effects).toEqual([{ kind: "fog" }]);
  });

  it("gated mana needs the Swamp; costed mana pays from the pool; fog stops combat damage", () => {
    const { game, p1 } = twoPlayers();
    const gatedDef = createCardDefinition({
      name: "Crypt",
      typeLine: "Land",
      manaAbilities: [
        {
          produces: { B: 1 },
          producesOptions: [],
          producesAnyColor: false,
          damageToController: 0,
          requiresControlled: { subtypes: ["swamp"] },
        },
      ],
    });
    game.definitions[gatedDef.id] = gatedDef;
    const crypt = createCardInstance({ definitionId: gatedDef.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[crypt.id] = crypt;
    p1.zones.battlefield.push(crypt.id);
    expect(manaAbilitiesFor(game, crypt.id)).toHaveLength(0);

    const swampDef = createCardDefinition({ name: "Swamp", typeLine: "Basic Land - Swamp" });
    game.definitions[swampDef.id] = swampDef;
    const swamp = createCardInstance({ definitionId: swampDef.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[swamp.id] = swamp;
    p1.zones.battlefield.push(swamp.id);
    expect(manaAbilitiesFor(game, crypt.id).length).toBeGreaterThan(0);

    // Costed mana: {1}, {T}: Add any color — pays 1 from the pool.
    const drumDef = createCardDefinition({
      name: "Springleaf Drum",
      typeLine: "Artifact",
      manaAbilities: [
        {
          produces: {},
          producesOptions: [],
          producesAnyColor: true,
          damageToController: 0,
          costMana: "{1}",
        },
      ],
    });
    game.definitions[drumDef.id] = drumDef;
    const drum = createCardInstance({ definitionId: drumDef.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[drum.id] = drum;
    p1.zones.battlefield.push(drum.id);
    expect(() =>
      applyAction(game, { kind: "tap_for_mana", playerId: p1.id, cardId: drum.id, color: "U" }),
    ).toThrow();
    const funded = structuredClone(game);
    funded.players[0]!.mana.C = 1;
    const tapped = applyAction(funded, {
      kind: "tap_for_mana",
      playerId: funded.players[0]!.id,
      cardId: drum.id,
      color: "U",
    });
    expect(tapped.players[0]?.mana.U).toBe(1);
    expect(tapped.players[0]?.mana.C).toBe(0);

    // Fog: combat damage step deals nothing.
    const fogged = applyEffect(game, { kind: "fog" });
    expect(fogged.preventCombatDamage).toBe(true);
  });
});

describe("wave 45: another-target, put-land, creature affinity", () => {
  it("compiles the Myr Retriever, Walking Atlas body, and creature-affinity shapes", () => {
    const retriever = compileOracleCard({
      oracleId: "myr-retriever",
      name: "Myr Retriever",
      manaCost: "{2}",
      typeLine: "Artifact Creature - Myr",
      oracleText:
        "When Myr Retriever dies, return another target artifact card from your graveyard to your hand.",
      power: "1",
      toughness: "1",
      printedKeywords: [],
      imageUrl: "",
    });
    expect(retriever.notes).toEqual([]);
    expect(retriever.definition.triggers[0]?.targetRequirements).toEqual([
      { kind: "own_graveyard_artifact_card", excludeSource: true },
    ]);

    const atlasBody = compileOracleCard({
      oracleId: "atlas",
      name: "Walking Atlas Lite",
      manaCost: "{2}",
      typeLine: "Artifact Creature - Construct",
      oracleText: "{T}: You may put a land card from your hand onto the battlefield tapped.",
      power: "1",
      toughness: "1",
      printedKeywords: [],
      imageUrl: "",
    });
    expect(atlasBody.notes).toEqual([]);
    const effect = atlasBody.definition.activated[0]?.effects[0];
    expect(effect?.kind).toBe("choose_card");

    const throng = compileOracleCard({
      oracleId: "throng",
      name: "Distant Melody Beast",
      manaCost: "{6}",
      typeLine: "Creature - Beast",
      oracleText: "This spell costs {1} less to cast for each creature on the battlefield.",
      power: "5",
      toughness: "5",
      printedKeywords: [],
      imageUrl: "",
    });
    expect(throng.notes).toEqual([]);
    expect(throng.definition.affinityAllCreatures).toBe(true);
  });

  it("excludeSource keeps an ability from targeting its own source", () => {
    const { game, p1 } = twoPlayers();
    const relicDef = createCardDefinition({
      name: "Voltaic Servant Lite",
      typeLine: "Artifact",
      activated: [
        {
          tap: true,
          manaCost: "",
          effects: [{ kind: "untap", cardId: { type: "chosen", index: 0 } }],
          targetRequirements: [{ kind: "artifact", excludeSource: true }],
        },
      ],
    });
    game.definitions[relicDef.id] = relicDef;
    const relic = createCardInstance({ definitionId: relicDef.id, ownerId: p1.id, zone: "battlefield" });
    const other = createCardInstance({ definitionId: relicDef.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[relic.id] = relic;
    game.cards[other.id] = other;
    p1.zones.battlefield.push(relic.id, other.id);

    expect(() =>
      applyAction(game, {
        kind: "activate_ability",
        playerId: p1.id,
        cardId: relic.id,
        abilityIndex: 0,
        targets: [{ type: "creature", cardId: relic.id }],
      }),
    ).toThrow();
    const legal = applyAction(game, {
      kind: "activate_ability",
      playerId: p1.id,
      cardId: relic.id,
      abilityIndex: 0,
      targets: [{ type: "creature", cardId: other.id }],
    });
    expect(legal.stack).toHaveLength(1);
  });
});

describe("wave 46: that-much life triggers", () => {
  it("compiles Sanguine Bond, Exquisite Blood, and Voltaic Key shapes fully", () => {
    const bond = compileOracleCard({
      oracleId: "bond",
      name: "Sanguine Bond",
      manaCost: "{3}{B}{B}",
      typeLine: "Enchantment",
      oracleText: "Whenever you gain life, target opponent loses that much life.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(bond.notes).toEqual([]);
    expect(bond.definition.triggers[0]?.event).toBe("you_gain_life");
    expect(bond.definition.triggers[0]?.targetRequirements).toEqual([{ kind: "opponent" }]);
    expect(bond.definition.triggers[0]?.effects[0]).toEqual({
      kind: "lose_life",
      playerId: { type: "chosen", index: 0 },
      amount: "subject_amount",
    });

    const blood = compileOracleCard({
      oracleId: "blood",
      name: "Exquisite Blood",
      manaCost: "{4}{B}",
      typeLine: "Enchantment",
      oracleText: "Whenever an opponent loses life, you gain that much life.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(blood.notes).toEqual([]);
    expect(blood.definition.triggers[0]?.event).toBe("opponent_loses_life");

    const key = compileOracleCard({
      oracleId: "key",
      name: "Voltaic Key",
      manaCost: "{1}",
      typeLine: "Artifact",
      oracleText: "{1}, {T}: Untap target artifact.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(key.notes).toEqual([]);
    expect(key.definition.activated[0]?.targetRequirements).toEqual([{ kind: "artifact" }]);
  });

  it("threads the gained amount into the loss and back again", () => {
    const { game, p1, p2 } = twoPlayers();
    const bondDef = createCardDefinition({
      name: "Bond Lite",
      typeLine: "Enchantment",
      triggers: [
        {
          event: "you_gain_life",
          targetRequirements: [{ kind: "opponent" }],
          effects: [
            { kind: "lose_life", playerId: { type: "chosen", index: 0 }, amount: "subject_amount" },
          ],
        },
      ],
    });
    game.definitions[bondDef.id] = bondDef;
    const bond = createCardInstance({ definitionId: bondDef.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[bond.id] = bond;
    p1.zones.battlefield.push(bond.id);

    let next = applyEffect(game, { kind: "gain_life", playerId: p1.id, amount: 3 });
    const prompt = next.prompts[0];
    expect(prompt?.kind).toBe("choose_targets");
    if (prompt?.kind !== "choose_targets") {
      throw new Error("expected target prompt");
    }
    next = applyAction(next, {
      kind: "choose_targets",
      playerId: p1.id,
      targets: [{ type: "player", playerId: p2.id }],
    });
    expect(next.stack).toHaveLength(1);
    const before = next.players.find((p) => p.id === p2.id)!.life;
    next = resolveTopOfStack(next);
    expect(next.players.find((p) => p.id === p2.id)!.life).toBe(before - 3);
  });

  it("gains that much when an opponent loses life to combat or effects", () => {
    const { game, p1, p2 } = twoPlayers();
    const bloodDef = createCardDefinition({
      name: "Blood Lite",
      typeLine: "Enchantment",
      triggers: [
        {
          event: "opponent_loses_life",
          effects: [{ kind: "gain_life", playerId: "controller", amount: "subject_amount" }],
        },
      ],
    });
    game.definitions[bloodDef.id] = bloodDef;
    const blood = createCardInstance({ definitionId: bloodDef.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[blood.id] = blood;
    p1.zones.battlefield.push(blood.id);

    let next = applyEffect(game, { kind: "lose_life", playerId: p2.id, amount: 4 });
    expect(next.stack).toHaveLength(1);
    const before = next.players.find((p) => p.id === p1.id)!.life;
    next = resolveTopOfStack(next);
    expect(next.players.find((p) => p.id === p1.id)!.life).toBe(before + 4);

    // The controller's own life loss does not trigger it.
    const own = applyEffect(game, { kind: "lose_life", playerId: p1.id, amount: 2 });
    expect(own.stack).toHaveLength(0);
  });
});

describe("wave 47: token riders and draw doubling", () => {
  it("compiles Pongify and Rapid Hybridization fully", () => {
    const pongify = compileOracleCard({
      oracleId: "pongify",
      name: "Pongify",
      manaCost: "{U}",
      typeLine: "Instant",
      oracleText:
        "Destroy target creature. It can't be regenerated. Its controller creates a 3/3 green Ape creature token.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(pongify.notes).toEqual([]);
    expect(pongify.definition.targetRequirements).toEqual([{ kind: "creature" }]);
    expect(pongify.definition.effects).toEqual([
      { kind: "move_card", cardId: { type: "chosen", index: 0 }, toZone: "graveyard" },
      {
        kind: "create_token",
        ownerId: { type: "chosen_controller", index: 0 },
        name: "Ape",
        typeLine: "Creature — Ape Token",
        power: 3,
        toughness: 3,
      },
    ]);

    const hybrid = compileOracleCard({
      oracleId: "hybrid",
      name: "Rapid Hybridization",
      manaCost: "{U}",
      typeLine: "Instant",
      oracleText:
        "Destroy target creature. It can't be regenerated. That creature's controller creates a 3/3 green Frog Lizard creature token.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(hybrid.notes).toEqual([]);
    const token = hybrid.definition.effects[1];
    expect(token?.kind === "create_token" && token.name).toBe("Frog Lizard");
  });

  it("gives the token to the destroyed creature's controller", () => {
    const { game, p1, p2 } = twoPlayers();
    const preyDef = createCardDefinition({
      name: "Prey",
      typeLine: "Creature — Beast",
      power: 4,
      toughness: 4,
    });
    const spellDef = createCardDefinition({
      name: "Pongify Lite",
      manaCost: "{U}",
      typeLine: "Instant",
      targetRequirements: [{ kind: "creature" }],
      effects: [
        { kind: "move_card", cardId: { type: "chosen", index: 0 }, toZone: "graveyard" },
        {
          kind: "create_token",
          ownerId: { type: "chosen_controller", index: 0 },
          name: "Ape",
          typeLine: "Creature — Ape Token",
          power: 3,
          toughness: 3,
        },
      ],
    });
    game.definitions[preyDef.id] = preyDef;
    game.definitions[spellDef.id] = spellDef;
    const prey = createCardInstance({ definitionId: preyDef.id, ownerId: p2.id, zone: "battlefield" });
    const spell = createCardInstance({ definitionId: spellDef.id, ownerId: p1.id, zone: "hand" });
    game.cards[prey.id] = prey;
    game.cards[spell.id] = spell;
    p2.zones.battlefield.push(prey.id);
    p1.zones.hand.push(spell.id);

    let next = putSpellOnStack(game, spell.id, [{ type: "creature", cardId: prey.id }]);
    next = resolveTopOfStack(next);
    expect(next.cards[prey.id]?.zone).toBe("graveyard");
    const ape = Object.values(next.cards).find((card) => card.isToken);
    expect(ape).toBeDefined();
    expect(ape?.controllerId).toBe(p2.id);
  });

  it("doubles draws except the first draw-step card", () => {
    const { game, p1 } = twoPlayers();
    fillLibraries(game, 20);
    const archiveDef = createCardDefinition({
      name: "Archive Lite",
      typeLine: "Artifact",
      replacements: [{ kind: "double_draws_except_first" }],
    });
    game.definitions[archiveDef.id] = archiveDef;
    const archive = createCardInstance({ definitionId: archiveDef.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[archive.id] = archive;
    p1.zones.battlefield.push(archive.id);

    const spellDraw = applyEffect(game, { kind: "draw", playerId: p1.id, count: 1 });
    expect(spellDraw.players.find((p) => p.id === p1.id)!.zones.hand).toHaveLength(
      p1.zones.hand.length + 2,
    );

    const turnDraw = applyEffect(game, { kind: "draw", playerId: p1.id, count: 1, turnDraw: true });
    expect(turnDraw.players.find((p) => p.id === p1.id)!.zones.hand).toHaveLength(
      p1.zones.hand.length + 1,
    );

    const withMine = applyEffect(game, { kind: "draw", playerId: p1.id, count: 2, turnDraw: true });
    expect(withMine.players.find((p) => p.id === p1.id)!.zones.hand).toHaveLength(
      p1.zones.hand.length + 3,
    );
  });

  it("compiles the two draw-doubling staples fully", () => {
    const insight = compileOracleCard({
      oracleId: "insight",
      name: "Teferi's Ageless Insight",
      manaCost: "{2}{U}{U}",
      typeLine: "Legendary Enchantment",
      oracleText:
        "If you would draw a card except the first one you draw in each of your draw steps, draw two cards instead.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(insight.notes).toEqual([]);
    expect(insight.definition.replacements).toEqual([{ kind: "double_draws_except_first" }]);

    const archive = compileOracleCard({
      oracleId: "archive",
      name: "Alhammarret's Archive",
      manaCost: "{5}",
      typeLine: "Legendary Artifact",
      oracleText:
        "If you would gain life, you gain twice that much life instead.\nIf you would draw a card except the first one you draw in each of your draw steps, draw two cards instead.",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    });
    expect(archive.notes).toEqual([]);
    expect(archive.definition.replacements).toHaveLength(2);
  });
});

describe("wave 48: until-EOT dies-return grants", () => {
  const oracleBase = {
    manaCost: "{B}",
    typeLine: "Instant",
    power: null,
    toughness: null,
    printedKeywords: [],
    imageUrl: "",
  };

  it("compiles the Feign Death family fully", () => {
    const feign = compileOracleCard({
      ...oracleBase,
      oracleId: "feign",
      name: "Feign Death",
      oracleText:
        "Until end of turn, target creature gains \"When this creature dies, return it to the battlefield tapped under its owner's control with a +1/+1 counter on it.\"",
    });
    expect(feign.notes).toEqual([]);
    expect(feign.definition.effects).toEqual([
      { kind: "grant_dies_return", cardId: { type: "chosen", index: 0 }, counter: true },
    ]);

    const stamina = compileOracleCard({
      ...oracleBase,
      oracleId: "stamina",
      name: "Supernatural Stamina",
      oracleText:
        "Until end of turn, target creature gets +2/+0 and gains \"When this creature dies, return it to the battlefield tapped under its owner's control.\"",
    });
    expect(stamina.notes).toEqual([]);
    expect(stamina.definition.effects).toHaveLength(2);
    expect(stamina.definition.effects[0]?.kind).toBe("pt_until_eot");

    const fake = compileOracleCard({
      ...oracleBase,
      oracleId: "fake",
      name: "Fake Your Own Death",
      oracleText:
        "Until end of turn, target creature gets +2/+0 and gains \"When this creature dies, return it to the battlefield tapped under its owner's control and you create a Treasure token.\" (It's an artifact with \"{T}, Sacrifice this token: Add one mana of any color.\")",
    });
    expect(fake.notes).toEqual([]);
    const grant = fake.definition.effects[1];
    expect(grant?.kind === "grant_dies_return" && grant.treasure).toBe(true);
  });

  it("returns the granted creature tapped with its counter, once", () => {
    const { game, p1 } = twoPlayers();
    const preyDef = createCardDefinition({
      name: "Prey",
      typeLine: "Creature — Beast",
      power: 2,
      toughness: 2,
    });
    game.definitions[preyDef.id] = preyDef;
    const prey = createCardInstance({ definitionId: preyDef.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[prey.id] = prey;
    p1.zones.battlefield.push(prey.id);

    let next = applyEffect(game, {
      kind: "grant_dies_return",
      cardId: prey.id,
      counter: true,
    });
    next = applyEffect(next, { kind: "move_card", cardId: prey.id, toZone: "graveyard" });
    expect(next.cards[prey.id]?.zone).toBe("battlefield");
    expect(next.cards[prey.id]?.tapped).toBe(true);
    expect(next.cards[prey.id]?.counters["p1p1"]).toBe(1);
    expect(next.diesReturnUntilEot ?? []).toHaveLength(0);

    // The grant was consumed: a second death sticks.
    next = applyEffect(next, { kind: "move_card", cardId: prey.id, toZone: "graveyard" });
    expect(next.cards[prey.id]?.zone).toBe("graveyard");
  });

  it("creates the Treasure for the creature's controller", () => {
    const { game, p1 } = twoPlayers();
    const preyDef = createCardDefinition({
      name: "Prey",
      typeLine: "Creature — Beast",
      power: 2,
      toughness: 2,
    });
    game.definitions[preyDef.id] = preyDef;
    const prey = createCardInstance({ definitionId: preyDef.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[prey.id] = prey;
    p1.zones.battlefield.push(prey.id);

    let next = applyEffect(game, {
      kind: "grant_dies_return",
      cardId: prey.id,
      treasure: true,
    });
    next = applyEffect(next, { kind: "move_card", cardId: prey.id, toZone: "graveyard" });
    expect(next.cards[prey.id]?.zone).toBe("battlefield");
    const treasure = Object.values(next.cards).find((card) => card.isToken);
    expect(treasure).toBeDefined();
    expect(treasure?.controllerId).toBe(p1.id);
  });
});

describe("wave 49: sacrifice costs and Fling", () => {
  it("compiles sacrifice-cost staples and Fling fully", () => {
    const base = {
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
    };
    const seer = compileOracleCard({
      ...base,
      oracleId: "seer",
      name: "Viscera Seer",
      manaCost: "{B}",
      typeLine: "Creature — Vampire Wizard",
      power: "1",
      toughness: "1",
      oracleText: "Sacrifice a creature: Scry 1.",
    });
    expect(seer.notes).toEqual([]);
    expect(seer.definition.activated[0]?.sacrificeCost).toBe("creature");

    const orb = compileOracleCard({
      ...base,
      oracleId: "orb",
      name: "Zuran Orb",
      manaCost: "{0}",
      typeLine: "Artifact",
      oracleText: "Sacrifice a land: You gain 2 life.",
    });
    expect(orb.notes).toEqual([]);
    expect(orb.definition.activated[0]?.sacrificeCost).toBe("land");

    const altar = compileOracleCard({
      ...base,
      oracleId: "altar",
      name: "Ashnod's Altar",
      manaCost: "{3}",
      typeLine: "Artifact",
      oracleText: "Sacrifice a creature: Add {C}{C}.",
    });
    expect(altar.notes).toEqual([]);

    const fling = compileOracleCard({
      ...base,
      oracleId: "fling",
      name: "Fling",
      manaCost: "{1}{R}",
      typeLine: "Instant",
      oracleText:
        "As an additional cost to cast this spell, sacrifice a creature.\nFling deals damage equal to the sacrificed creature's power to any target.",
    });
    expect(fling.notes).toEqual([]);
    expect(fling.definition.effects[0]).toEqual({
      kind: "deal_damage",
      sourceId: "self",
      target: { type: "chosen", index: 0 },
      amount: "sacrificed_power",
    });
  });

  it("pays a sacrifice cost on activation, including self", () => {
    const { game, p1 } = twoPlayers();
    const seerDef = createCardDefinition({
      name: "Seer Lite",
      typeLine: "Creature — Vampire",
      power: 1,
      toughness: 1,
      activated: [
        {
          tap: false,
          manaCost: "",
          sacrificeCost: "creature",
          effects: [{ kind: "scry", playerId: "controller", count: 1 }],
          targetRequirements: [],
        },
      ],
    });
    game.definitions[seerDef.id] = seerDef;
    const seer = createCardInstance({ definitionId: seerDef.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[seer.id] = seer;
    p1.zones.battlefield.push(seer.id);
    fillLibraries(game, 10);
    game.cards[seer.id]!.summoningSick = false;

    // No sacrifice chosen: rejected.
    expect(() =>
      applyAction(game, {
        kind: "activate_ability",
        playerId: p1.id,
        cardId: seer.id,
        abilityIndex: 0,
      }),
    ).toThrow(/Sacrifice a creature/);

    let next = applyAction(game, {
      kind: "activate_ability",
      playerId: p1.id,
      cardId: seer.id,
      abilityIndex: 0,
      costSacrificeId: seer.id,
    });
    expect(next.cards[seer.id]?.zone).toBe("graveyard");
    expect(next.stack).toHaveLength(1);
    next = resolveTopOfStack(next);
    expect(next.prompts[0]?.kind).toBe("scry");
  });

  it("flings the sacrificed creature's power at the target", () => {
    const { game, p1, p2 } = twoPlayers();
    const oxDef = createCardDefinition({
      name: "Ox",
      typeLine: "Creature — Ox",
      power: 4,
      toughness: 4,
    });
    const flingDef = createCardDefinition({
      name: "Fling Lite",
      manaCost: "",
      typeLine: "Instant",
      additionalCost: { sacrifice: "creature" },
      targetRequirements: [{ kind: "player_or_creature" }],
      effects: [
        {
          kind: "deal_damage",
          sourceId: "self",
          target: { type: "chosen", index: 0 },
          amount: "sacrificed_power",
        },
      ],
    });
    game.definitions[oxDef.id] = oxDef;
    game.definitions[flingDef.id] = flingDef;
    const ox = createCardInstance({ definitionId: oxDef.id, ownerId: p1.id, zone: "battlefield" });
    const fling = createCardInstance({ definitionId: flingDef.id, ownerId: p1.id, zone: "hand" });
    game.cards[ox.id] = ox;
    game.cards[fling.id] = fling;
    p1.zones.battlefield.push(ox.id);
    p1.zones.hand.push(fling.id);
    game.priorityPlayerId = p1.id;

    let next = applyAction(game, {
      kind: "cast_spell",
      playerId: p1.id,
      cardId: fling.id,
      targets: [{ type: "player", playerId: p2.id }],
      costSacrificeId: ox.id,
    });
    expect(next.cards[ox.id]?.zone).toBe("graveyard");
    const before = next.players.find((p) => p.id === p2.id)!.life;
    next = resolveTopOfStack(next);
    expect(next.players.find((p) => p.id === p2.id)!.life).toBe(before - 4);
  });
});

describe("wave 50: pillow-fort attack taxes", () => {
  const enchantBase = {
    power: null,
    toughness: null,
    printedKeywords: [],
    imageUrl: "",
  };

  it("compiles the pillow-fort staples fully", () => {
    const propaganda = compileOracleCard({
      ...enchantBase,
      oracleId: "prop",
      name: "Propaganda",
      manaCost: "{2}{U}",
      typeLine: "Enchantment",
      oracleText:
        "Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you.",
    });
    expect(propaganda.notes).toEqual([]);
    expect(propaganda.definition.attackTax).toEqual({ generic: 2 });

    const sphere = compileOracleCard({
      ...enchantBase,
      oracleId: "sphere",
      name: "Sphere of Safety",
      manaCost: "{4}{W}",
      typeLine: "Enchantment",
      oracleText:
        "Creatures can't attack you or planeswalkers you control unless their controller pays {X} for each of those creatures, where X is the number of enchantments you control.",
    });
    expect(sphere.notes).toEqual([]);
    expect(sphere.definition.attackTax).toEqual({ perEnchantment: true });

    const annex = compileOracleCard({
      ...enchantBase,
      oracleId: "annex",
      name: "Norn's Annex",
      manaCost: "{3}{W/P}{W/P}",
      typeLine: "Artifact",
      oracleText:
        "({W/P} can be paid with either {W} or 2 life.)\nCreatures can't attack you or planeswalkers you control unless their controller pays {W/P} for each of those creatures.",
    });
    expect(annex.notes).toEqual([]);
    expect(annex.definition.attackTax).toEqual({ lifePer: 2 });
  });

  function fortGame(tax: { generic?: number; perEnchantment?: boolean; lifePer?: number }) {
    const { game, p1, p2 } = twoPlayers();
    const fortDef = createCardDefinition({
      name: "Fort",
      typeLine: "Enchantment",
      attackTax: tax,
    });
    const bearDef = createCardDefinition({
      name: "Bear",
      typeLine: "Creature — Bear",
      power: 2,
      toughness: 2,
    });
    game.definitions[fortDef.id] = fortDef;
    game.definitions[bearDef.id] = bearDef;
    const fort = createCardInstance({ definitionId: fortDef.id, ownerId: p2.id, zone: "battlefield" });
    const bear = createCardInstance({ definitionId: bearDef.id, ownerId: p1.id, zone: "battlefield" });
    bear.summoningSick = false;
    game.cards[fort.id] = fort;
    game.cards[bear.id] = bear;
    p2.zones.battlefield.push(fort.id);
    p1.zones.battlefield.push(bear.id);
    game.turn.step = "declareAttackers";
    game.turn.activePlayerId = p1.id;
    game.priorityPlayerId = p1.id;
    return { game, p1, p2, bear, fortDef };
  }

  it("requires floated mana to attack past Propaganda", () => {
    const { game, p1, p2, bear } = fortGame({ generic: 2 });
    expect(() =>
      applyAction(game, {
        kind: "declare_attackers",
        playerId: p1.id,
        attacks: [{ attackerId: bear.id, defenderId: p2.id }],
      }),
    ).toThrow(/float the mana/);

    game.players.find((p) => p.id === p1.id)!.mana.C = 2;
    const next = applyAction(game, {
      kind: "declare_attackers",
      playerId: p1.id,
      attacks: [{ attackerId: bear.id, defenderId: p2.id }],
    });
    expect(next.combat?.attacks).toHaveLength(1);
    expect(next.players.find((p) => p.id === p1.id)!.mana.C).toBe(0);
  });

  it("scales Sphere of Safety with the defender's enchantments", () => {
    const { game, p1, p2, bear, fortDef } = fortGame({ perEnchantment: true });
    const second = createCardInstance({ definitionId: fortDef.id, ownerId: p2.id, zone: "battlefield" });
    game.cards[second.id] = second;
    game.players.find((p) => p.id === p2.id)!.zones.battlefield.push(second.id);

    game.players.find((p) => p.id === p1.id)!.mana.C = 3;
    // Two tax permanents, each charging one per enchantment (2) = 4 total.
    expect(() =>
      applyAction(game, {
        kind: "declare_attackers",
        playerId: p1.id,
        attacks: [{ attackerId: bear.id, defenderId: p2.id }],
      }),
    ).toThrow(/float the mana/);
    game.players.find((p) => p.id === p1.id)!.mana.C = 4;
    const next = applyAction(game, {
      kind: "declare_attackers",
      playerId: p1.id,
      attacks: [{ attackerId: bear.id, defenderId: p2.id }],
    });
    expect(next.combat?.attacks).toHaveLength(1);
  });

  it("charges Norn's Annex life", () => {
    const { game, p1, p2, bear } = fortGame({ lifePer: 2 });
    const before = game.players.find((p) => p.id === p1.id)!.life;
    const next = applyAction(game, {
      kind: "declare_attackers",
      playerId: p1.id,
      attacks: [{ attackerId: bear.id, defenderId: p2.id }],
    });
    expect(next.players.find((p) => p.id === p1.id)!.life).toBe(before - 2);
  });
});

describe("wave 51: windfall, landfall value, filtered targets", () => {
  const spellBase = {
    power: null,
    toughness: null,
    printedKeywords: [],
    imageUrl: "",
  };

  it("compiles Windfall, Tatyova, Escape Tunnel, and Shizo fully", () => {
    const windfall = compileOracleCard({
      ...spellBase,
      oracleId: "windfall",
      name: "Windfall",
      manaCost: "{2}{U}",
      typeLine: "Sorcery",
      oracleText:
        "Each player discards their hand, then draws cards equal to the greatest number of cards a player discarded this way.",
    });
    expect(windfall.notes).toEqual([]);
    expect(windfall.definition.effects).toEqual([{ kind: "windfall" }]);

    const tatyova = compileOracleCard({
      ...spellBase,
      oracleId: "tatyova",
      name: "Tatyova, Benthic Druid",
      manaCost: "{3}{G}{U}",
      typeLine: "Legendary Creature — Merfolk Druid",
      power: "3",
      toughness: "3",
      oracleText: "Landfall — Whenever a land you control enters, you gain 1 life and draw a card.",
    });
    expect(tatyova.notes).toEqual([]);
    expect(tatyova.definition.triggers[0]?.effects).toHaveLength(2);

    const tunnel = compileOracleCard({
      ...spellBase,
      oracleId: "tunnel",
      name: "Escape Tunnel",
      manaCost: "",
      typeLine: "Land",
      oracleText:
        "{T}: Add {C}.\n{T}, Sacrifice this land: Target creature with power 2 or less can't be blocked this turn.",
    });
    expect(tunnel.notes).toEqual([]);
    expect(tunnel.definition.activated[0]?.targetRequirements).toEqual([
      { kind: "creature", maxPower: 2 },
    ]);

    const shizo = compileOracleCard({
      ...spellBase,
      oracleId: "shizo",
      name: "Shizo, Death's Storehouse",
      manaCost: "",
      typeLine: "Legendary Land",
      oracleText: "{T}: Add {B}.\n{B}, {T}: Target legendary creature gains fear until end of turn.",
    });
    expect(shizo.notes).toEqual([]);
    expect(shizo.definition.activated[0]?.targetRequirements).toEqual([
      { kind: "creature", legendaryOnly: true },
    ]);
  });

  it("windfall discards every hand and refills to the greatest count", () => {
    const { game, p1, p2 } = twoPlayers();
    fillLibraries(game, 10);
    addHandCards(game, p1, 3);
    addHandCards(game, p2, 1);
    const next = applyEffect(game, { kind: "windfall" });
    const one = next.players.find((p) => p.id === p1.id)!;
    const two = next.players.find((p) => p.id === p2.id)!;
    expect(one.zones.hand).toHaveLength(3);
    expect(two.zones.hand).toHaveLength(3);
    expect(one.zones.graveyard.length).toBeGreaterThanOrEqual(3);
  });

  it("filters targets by power and legendary supertype", () => {
    const { game, p1, p2 } = twoPlayers();
    const bigDef = createCardDefinition({
      name: "Big",
      typeLine: "Creature — Giant",
      power: 4,
      toughness: 4,
    });
    const smallDef = createCardDefinition({
      name: "Small",
      typeLine: "Legendary Creature — Mouse",
      power: 1,
      toughness: 1,
    });
    game.definitions[bigDef.id] = bigDef;
    game.definitions[smallDef.id] = smallDef;
    const big = createCardInstance({ definitionId: bigDef.id, ownerId: p2.id, zone: "battlefield" });
    const small = createCardInstance({ definitionId: smallDef.id, ownerId: p2.id, zone: "battlefield" });
    game.cards[big.id] = big;
    game.cards[small.id] = small;
    p2.zones.battlefield.push(big.id, small.id);

    const power2 = { kind: "creature" as const, maxPower: 2 };
    expect(isChosenTargetLegal(game, power2, { type: "creature", cardId: big.id }, p1.id)).toBe(false);
    expect(isChosenTargetLegal(game, power2, { type: "creature", cardId: small.id }, p1.id)).toBe(true);

    const legendary = { kind: "creature" as const, legendaryOnly: true };
    expect(isChosenTargetLegal(game, legendary, { type: "creature", cardId: big.id }, p1.id)).toBe(false);
    expect(isChosenTargetLegal(game, legendary, { type: "creature", cardId: small.id }, p1.id)).toBe(true);
  });
});

describe("wave 52: token keywords, tribal attacks, populate", () => {
  it("compiles Utvara Hellkite and Rootborn Defenses fully", () => {
    const utvara = compileOracleCard({
      oracleId: "utvara",
      name: "Utvara Hellkite",
      manaCost: "{6}{R}{R}",
      typeLine: "Creature — Dragon",
      power: "6",
      toughness: "6",
      printedKeywords: ["Flying"],
      imageUrl: "",
      oracleText:
        "Flying\nWhenever a Dragon you control attacks, create a 6/6 red Dragon creature token with flying.",
    });
    expect(utvara.notes).toEqual([]);
    const trigger = utvara.definition.triggers[0];
    expect(trigger?.event).toBe("attacks");
    expect(trigger?.watch).toBe("controlled");
    expect(trigger?.subjectFilter).toEqual({ subtypes: ["dragon"] });
    const token = trigger?.effects[0];
    expect(token?.kind === "create_token" && token.keywords).toEqual(["flying"]);

    const rootborn = compileOracleCard({
      oracleId: "rootborn",
      name: "Rootborn Defenses",
      manaCost: "{2}{W}",
      typeLine: "Instant",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "Populate. Creatures you control gain indestructible until end of turn. (To populate, create a token that's a copy of a creature token you control.)",
    });
    expect(rootborn.notes).toEqual([]);
    expect(rootborn.definition.effects[0]).toEqual({ kind: "populate", playerId: "controller" });
  });

  it("populate copies the biggest creature token you control", () => {
    const { game, p1 } = twoPlayers();
    const next = applyEffect(game, {
      kind: "create_token",
      ownerId: p1.id,
      name: "Beast",
      typeLine: "Creature — Beast Token",
      power: 3,
      toughness: 3,
    });
    const afterSmall = applyEffect(next, {
      kind: "create_token",
      ownerId: p1.id,
      name: "Bird",
      typeLine: "Creature — Bird Token",
      power: 1,
      toughness: 1,
      keywords: ["flying"],
    });
    const populated = applyEffect(afterSmall, { kind: "populate", playerId: p1.id });
    const tokens = Object.values(populated.cards).filter((card) => card.isToken);
    expect(tokens).toHaveLength(3);
    const beasts = tokens.filter(
      (card) => populated.definitions[card.definitionId]?.name === "Beast",
    );
    expect(beasts).toHaveLength(2);

    // The keyworded token really has flying.
    const bird = tokens.find((card) => populated.definitions[card.definitionId]?.name === "Bird");
    expect(bird && populated.definitions[bird.definitionId]?.keywords).toEqual(["flying"]);
  });
});

describe("wave 53: land targets, commander targets, toughness gains", () => {
  const base = { power: null, toughness: null, printedKeywords: [], imageUrl: "" };

  it("compiles Wasteland, Witch's Clinic, and Trostani fully", () => {
    const wasteland = compileOracleCard({
      ...base,
      oracleId: "wasteland",
      name: "Wasteland",
      manaCost: "",
      typeLine: "Land",
      oracleText: "{T}: Add {C}.\n{T}, Sacrifice this land: Destroy target nonbasic land.",
    });
    expect(wasteland.notes).toEqual([]);
    expect(wasteland.definition.activated[0]?.targetRequirements).toEqual([
      { kind: "land", nonbasicOnly: true },
    ]);

    const clinic = compileOracleCard({
      ...base,
      oracleId: "clinic",
      name: "Witch's Clinic",
      manaCost: "",
      typeLine: "Land",
      oracleText: "{T}: Add {C}.\n{2}, {T}: Target commander gains lifelink until end of turn.",
    });
    expect(clinic.notes).toEqual([]);
    expect(clinic.definition.activated[0]?.targetRequirements).toEqual([{ kind: "commander" }]);

    const trostani = compileOracleCard({
      ...base,
      oracleId: "trostani",
      name: "Trostani, Selesnya's Voice",
      manaCost: "{G}{G}{W}{W}",
      typeLine: "Legendary Creature — Dryad",
      power: "2",
      toughness: "5",
      oracleText:
        "Whenever another creature you control enters, you gain life equal to that creature's toughness.\n{1}{G}{W}, {T}: Populate. (Create a token that's a copy of a creature token you control.)",
    });
    expect(trostani.notes).toEqual([]);
    expect(trostani.definition.triggers[0]?.effects[0]).toEqual({
      kind: "gain_life",
      playerId: "controller",
      amount: "subject_toughness",
    });
  });

  it("validates nonbasic land and commander targets", () => {
    const { game, p1, p2 } = twoPlayers();
    const basicDef = createCardDefinition({ name: "Forest", typeLine: "Basic Land — Forest" });
    const duallDef = createCardDefinition({ name: "Tundra", typeLine: "Land — Plains Island" });
    game.definitions[basicDef.id] = basicDef;
    game.definitions[duallDef.id] = duallDef;
    const basic = createCardInstance({ definitionId: basicDef.id, ownerId: p2.id, zone: "battlefield" });
    const dual = createCardInstance({ definitionId: duallDef.id, ownerId: p2.id, zone: "battlefield" });
    game.cards[basic.id] = basic;
    game.cards[dual.id] = dual;
    p2.zones.battlefield.push(basic.id, dual.id);

    const nonbasic = { kind: "land" as const, nonbasicOnly: true };
    expect(isChosenTargetLegal(game, nonbasic, { type: "creature", cardId: basic.id }, p1.id)).toBe(false);
    expect(isChosenTargetLegal(game, nonbasic, { type: "creature", cardId: dual.id }, p1.id)).toBe(true);
    expect(isChosenTargetLegal(game, { kind: "land" }, { type: "creature", cardId: basic.id }, p1.id)).toBe(true);
  });

  it("gains life equal to the entering creature's toughness", () => {
    const { game, p1 } = twoPlayers();
    const trostaniDef = createCardDefinition({
      name: "Trostani Lite",
      typeLine: "Creature — Dryad",
      power: 2,
      toughness: 5,
      triggers: [
        {
          event: "enter_battlefield",
          watch: "controlled",
          excludeSelf: true,
          subjectFilter: { types: ["creature"] },
          effects: [{ kind: "gain_life", playerId: "controller", amount: "subject_toughness" }],
        },
      ],
    });
    const oxDef = createCardDefinition({
      name: "Ox",
      typeLine: "Creature — Ox",
      power: 4,
      toughness: 6,
    });
    game.definitions[trostaniDef.id] = trostaniDef;
    game.definitions[oxDef.id] = oxDef;
    const trostani = createCardInstance({ definitionId: trostaniDef.id, ownerId: p1.id, zone: "battlefield" });
    const ox = createCardInstance({ definitionId: oxDef.id, ownerId: p1.id, zone: "hand" });
    game.cards[trostani.id] = trostani;
    game.cards[ox.id] = ox;
    p1.zones.battlefield.push(trostani.id);
    p1.zones.hand.push(ox.id);

    const before = game.players.find((p) => p.id === p1.id)!.life;
    let next = moveCard(game, ox.id, "battlefield");
    expect(next.stack).toHaveLength(1);
    next = resolveTopOfStack(next);
    expect(next.players.find((p) => p.id === p1.id)!.life).toBe(before + 6);
  });
});

describe("wave 54: token create/sacrifice events", () => {
  it("compiles Mirkwood Bats fully with sibling triggers", () => {
    const bats = compileOracleCard({
      oracleId: "bats",
      name: "Mirkwood Bats",
      manaCost: "{3}{B}",
      typeLine: "Creature — Bat",
      power: "2",
      toughness: "2",
      printedKeywords: ["Flying"],
      imageUrl: "",
      oracleText: "Flying\nWhenever you create or sacrifice a token, each opponent loses 1 life.",
    });
    expect(bats.notes).toEqual([]);
    expect(bats.definition.triggers.map((t) => t.event)).toEqual([
      "you_create_token",
      "you_sacrifice_token",
    ]);
  });

  it("fires on token creation and on token sacrifice", () => {
    const { game, p1, p2 } = twoPlayers();
    const batsDef = createCardDefinition({
      name: "Bats Lite",
      typeLine: "Creature — Bat",
      power: 2,
      toughness: 2,
      triggers: [
        {
          event: "you_create_token",
          effects: [{ kind: "lose_life", playerId: "each_opponent", amount: 1 }],
        },
        {
          event: "you_sacrifice_token",
          effects: [{ kind: "lose_life", playerId: "each_opponent", amount: 1 }],
        },
      ],
    });
    game.definitions[batsDef.id] = batsDef;
    const bats = createCardInstance({ definitionId: batsDef.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[bats.id] = bats;
    p1.zones.battlefield.push(bats.id);

    let next = applyEffect(game, {
      kind: "create_token",
      ownerId: p1.id,
      name: "Treasure",
      typeLine: "Artifact — Treasure Token",
      power: null,
      toughness: null,
    });
    expect(next.stack).toHaveLength(1);
    const before = next.players.find((p) => p.id === p2.id)!.life;
    next = resolveTopOfStack(next);
    expect(next.players.find((p) => p.id === p2.id)!.life).toBe(before - 1);

    const token = Object.values(next.cards).find((card) => card.isToken)!;
    next = applyEffect(next, { kind: "sacrifice", cardId: token.id });
    expect(next.stack).toHaveLength(1);
    next = resolveTopOfStack(next);
    expect(next.players.find((p) => p.id === p2.id)!.life).toBe(before - 2);

    // Sacrificing a nontoken permanent does not fire the token watcher.
    const oxDef = createCardDefinition({ name: "Ox", typeLine: "Creature — Ox", power: 1, toughness: 1 });
    next = { ...next };
    next.definitions = { ...next.definitions, [oxDef.id]: oxDef };
    const ox = createCardInstance({ definitionId: oxDef.id, ownerId: p1.id, zone: "battlefield" });
    next.cards = { ...next.cards, [ox.id]: ox };
    next.players.find((p) => p.id === p1.id)!.zones.battlefield.push(ox.id);
    const after = applyEffect(next, { kind: "sacrifice", cardId: ox.id });
    expect(after.stack).toHaveLength(0);
  });
});

describe("wave 55: basic-land search riders and leylines", () => {
  const base = { power: null, toughness: null, printedKeywords: [], imageUrl: "" };

  it("compiles Ghost Quarter, Assassin's Trophy, and Leyline of Anticipation fully", () => {
    const quarter = compileOracleCard({
      ...base,
      oracleId: "quarter",
      name: "Ghost Quarter",
      manaCost: "",
      typeLine: "Land",
      oracleText:
        "{T}: Add {C}.\n{T}, Sacrifice this land: Destroy target land. Its controller may search their library for a basic land card, put it onto the battlefield, then shuffle.",
    });
    expect(quarter.notes).toEqual([]);
    const ability = quarter.definition.activated[0];
    expect(ability?.effects[1]).toEqual({
      kind: "search_library",
      playerId: { type: "chosen_controller", index: 0 },
      filter: { supertypes: ["basic"], types: ["land"] },
      destination: "battlefield",
      count: 1,
    });

    const trophy = compileOracleCard({
      ...base,
      oracleId: "trophy",
      name: "Assassin's Trophy",
      manaCost: "{B}{G}",
      typeLine: "Instant",
      oracleText:
        "Destroy target permanent an opponent controls. Its controller may search their library for a basic land card, put it onto the battlefield, then shuffle.",
    });
    expect(trophy.notes).toEqual([]);
    expect(trophy.definition.effects).toHaveLength(2);

    const leyline = compileOracleCard({
      ...base,
      oracleId: "leyline",
      name: "Leyline of Anticipation",
      manaCost: "{2}{U}{U}",
      typeLine: "Enchantment",
      oracleText:
        "If this card is in your opening hand, you may begin the game with it on the battlefield.\nYou may cast spells as though they had flash.",
    });
    expect(leyline.notes).toEqual([]);
    expect(leyline.definition.leyline).toBe(true);
    expect(leyline.definition.grantsFlash).toBe(true);
  });

  it("deploys leylines from opening hands when mulligans finish", () => {
    const { game, p1, p2 } = twoPlayers();
    const leylineDef = createCardDefinition({
      name: "Leyline Lite",
      typeLine: "Enchantment",
      leyline: true,
    });
    game.definitions[leylineDef.id] = leylineDef;
    const ley = createCardInstance({ definitionId: leylineDef.id, ownerId: p1.id, zone: "hand" });
    game.cards[ley.id] = ley;
    p1.zones.hand.push(ley.id);
    game.mulligan = {
      decidingPlayerId: p1.id,
      taken: {},
      kept: {},
      pendingBottom: 0,
      startingHandSize: 7,
    };

    let next = applyAction(game, { kind: "keep_hand", playerId: p1.id });
    expect(next.cards[ley.id]?.zone).toBe("hand");
    next = applyAction(next, { kind: "keep_hand", playerId: p2.id });
    expect(next.cards[ley.id]?.zone).toBe("battlefield");
  });
});

describe("wave 56: color discounts, mass counters, untap statics", () => {
  const base = { power: null, toughness: null, printedKeywords: [], imageUrl: "" };

  it("compiles Oketra's Monument, Black Sun's Zenith, and Drumbellower fully", () => {
    const monument = compileOracleCard({
      ...base,
      oracleId: "monument",
      name: "Oketra's Monument",
      manaCost: "{3}",
      typeLine: "Legendary Artifact",
      oracleText:
        "White creature spells you cast cost {1} less to cast.\nWhenever you cast a creature spell, create a 1/1 white Warrior creature token.",
    });
    expect(monument.notes).toEqual([]);
    expect(monument.definition.costReductions).toEqual([
      { generic: 1, filter: { colors: ["W"], types: ["creature"] } },
    ]);

    const zenith = compileOracleCard({
      ...base,
      oracleId: "zenith",
      name: "Black Sun's Zenith",
      manaCost: "{X}{B}{B}",
      typeLine: "Sorcery",
      oracleText:
        "Put X -1/-1 counters on each creature. Shuffle Black Sun's Zenith into its owner's library.",
    });
    expect(zenith.notes).toEqual([]);
    expect(zenith.definition.effects[0]).toEqual({
      kind: "counter_on_each_creature",
      counter: "m1m1",
      amount: "x",
    });

    const drum = compileOracleCard({
      ...base,
      oracleId: "drum",
      name: "Drumbellower",
      manaCost: "{2}{W}",
      typeLine: "Creature — Human Soldier",
      power: "1",
      toughness: "3",
      oracleText: "Untap all creatures you control during each other player's untap step.",
    });
    expect(drum.notes).toEqual([]);
    expect(drum.definition.untapDuringEachUntap).toBe("creatures");
  });

  it("puts X counters on every creature and sweeps the dead", () => {
    const { game, p1, p2 } = twoPlayers();
    const bearDef = createCardDefinition({ name: "Bear", typeLine: "Creature — Bear", power: 2, toughness: 2 });
    const giantDef = createCardDefinition({ name: "Giant", typeLine: "Creature — Giant", power: 5, toughness: 5 });
    game.definitions[bearDef.id] = bearDef;
    game.definitions[giantDef.id] = giantDef;
    const bear = createCardInstance({ definitionId: bearDef.id, ownerId: p1.id, zone: "battlefield" });
    const giant = createCardInstance({ definitionId: giantDef.id, ownerId: p2.id, zone: "battlefield" });
    game.cards[bear.id] = bear;
    game.cards[giant.id] = giant;
    p1.zones.battlefield.push(bear.id);
    p2.zones.battlefield.push(giant.id);

    const next = applyEffect(game, { kind: "counter_on_each_creature", counter: "m1m1", amount: 2 });
    expect(next.cards[bear.id]?.zone).toBe("graveyard");
    expect(next.cards[giant.id]?.zone).toBe("battlefield");
    expect(next.cards[giant.id]?.counters["m1m1"]).toBe(2);
  });

  it("untaps the controller's creatures in other players' untap steps", () => {
    const { game, p1, p2 } = twoPlayers();
    const drumDef = createCardDefinition({
      name: "Drum Lite",
      typeLine: "Creature — Human",
      power: 1,
      toughness: 3,
      untapDuringEachUntap: "creatures",
    });
    game.definitions[drumDef.id] = drumDef;
    const drum = createCardInstance({ definitionId: drumDef.id, ownerId: p2.id, zone: "battlefield" });
    drum.tapped = true;
    game.cards[drum.id] = drum;
    p2.zones.battlefield.push(drum.id);

    game.turn.activePlayerId = p1.id;
    game.turn.phase = "ending";
    game.turn.step = "cleanup";
    const next = advanceSteps(game, 1);
    expect(next.cards[drum.id]?.tapped).toBe(false);
  });
});

describe("wave 57: overload", () => {
  const base = { power: null, toughness: null, printedKeywords: [], imageUrl: "" };

  it("compiles Vandalblast and Cyclonic Rift fully as two modes", () => {
    const vandal = compileOracleCard({
      ...base,
      oracleId: "vandal",
      name: "Vandalblast",
      manaCost: "{R}",
      typeLine: "Sorcery",
      oracleText:
        "Destroy target artifact you don't control.\nOverload {4}{R} (You may cast this spell for its overload cost. If you do, change its text by replacing all instances of \"target\" with \"each.\")",
    });
    expect(vandal.notes).toEqual([]);
    expect(vandal.definition.modes).toHaveLength(2);
    expect(vandal.definition.modes?.[1]?.extraCost).toBe("{4}");
    expect(vandal.definition.modes?.[1]?.effects[0]?.kind).toBe("overload_each");

    const rift = compileOracleCard({
      ...base,
      oracleId: "rift",
      name: "Cyclonic Rift",
      manaCost: "{1}{U}",
      typeLine: "Instant",
      oracleText:
        "Return target nonland permanent you don't control to its owner's hand.\nOverload {6}{U} (You may cast this spell for its overload cost. If you do, change its text by replacing all instances of \"target\" with \"each.\")",
    });
    expect(rift.notes).toEqual([]);
    expect(rift.definition.modes?.[1]?.extraCost).toBe("{5}");
  });

  it("overload sweeps every object the normal mode could target", () => {
    const { game, p1, p2 } = twoPlayers();
    const relicDef = createCardDefinition({ name: "Relic", typeLine: "Artifact" });
    game.definitions[relicDef.id] = relicDef;
    const mine = createCardInstance({ definitionId: relicDef.id, ownerId: p1.id, zone: "battlefield" });
    const theirs1 = createCardInstance({ definitionId: relicDef.id, ownerId: p2.id, zone: "battlefield" });
    const theirs2 = createCardInstance({ definitionId: relicDef.id, ownerId: p2.id, zone: "battlefield" });
    game.cards[mine.id] = mine;
    game.cards[theirs1.id] = theirs1;
    game.cards[theirs2.id] = theirs2;
    p1.zones.battlefield.push(mine.id);
    p2.zones.battlefield.push(theirs1.id, theirs2.id);

    const next = applyEffect(game, {
      kind: "overload_each",
      controllerId: p1.id,
      sourceId: null,
      requirement: { kind: "artifact", control: "not_own" },
      effects: [{ kind: "move_card", cardId: { type: "chosen", index: 0 }, toZone: "graveyard" }],
    });
    expect(next.cards[mine.id]?.zone).toBe("battlefield");
    expect(next.cards[theirs1.id]?.zone).toBe("graveyard");
    expect(next.cards[theirs2.id]?.zone).toBe("graveyard");
  });
});

describe("wave 58: untap watchers and creature-count damage", () => {
  const base = { power: null, toughness: null, printedKeywords: [], imageUrl: "" };

  it("compiles Mesmeric Orb and Chain Reaction fully", () => {
    const orb = compileOracleCard({
      ...base,
      oracleId: "orb2",
      name: "Mesmeric Orb",
      manaCost: "{2}",
      typeLine: "Artifact",
      oracleText: "Whenever a permanent becomes untapped, that permanent's controller mills a card.",
    });
    expect(orb.notes).toEqual([]);
    expect(orb.definition.triggers[0]?.event).toBe("becomes_untapped");
    expect(orb.definition.triggers[0]?.effects[0]).toEqual({
      kind: "mill",
      playerId: { type: "subject_player" },
      count: 1,
    });

    const chain = compileOracleCard({
      ...base,
      oracleId: "chain",
      name: "Chain Reaction",
      manaCost: "{2}{R}{R}",
      typeLine: "Sorcery",
      oracleText:
        "Chain Reaction deals X damage to each creature, where X is the number of creatures on the battlefield.",
    });
    expect(chain.notes).toEqual([]);
    expect(chain.definition.effects[0]).toEqual({
      kind: "damage_all",
      sourceId: "self",
      amount: "creature_count",
    });
  });

  it("mills the untapping permanent's controller", () => {
    const { game, p1, p2 } = twoPlayers();
    fillLibraries(game, 10);
    const orbDef = createCardDefinition({
      name: "Orb Lite",
      typeLine: "Artifact",
      triggers: [
        {
          event: "becomes_untapped",
          effects: [{ kind: "mill", playerId: { type: "subject_player" }, count: 1 }],
        },
      ],
    });
    const landDef = createCardDefinition({ name: "Wastes", typeLine: "Basic Land" });
    game.definitions[orbDef.id] = orbDef;
    game.definitions[landDef.id] = landDef;
    const orb = createCardInstance({ definitionId: orbDef.id, ownerId: p1.id, zone: "battlefield" });
    const land = createCardInstance({ definitionId: landDef.id, ownerId: p2.id, zone: "battlefield" });
    land.tapped = true;
    game.cards[orb.id] = orb;
    game.cards[land.id] = land;
    p1.zones.battlefield.push(orb.id);
    p2.zones.battlefield.push(land.id);

    let next = applyEffect(game, { kind: "untap", cardId: land.id });
    expect(next.stack).toHaveLength(1);
    const before = next.players.find((p) => p.id === p2.id)!.zones.graveyard.length;
    next = resolveTopOfStack(next);
    expect(next.players.find((p) => p.id === p2.id)!.zones.graveyard.length).toBe(before + 1);

    // Untapping an already-untapped permanent is rejected outright.
    expect(() => applyEffect(next, { kind: "untap", cardId: land.id })).toThrow(/already untapped/);
  });

  it("scales damage with the creature count at bind time", () => {
    const { game, p1, p2 } = twoPlayers();
    const bearDef = createCardDefinition({ name: "Bear", typeLine: "Creature — Bear", power: 2, toughness: 2 });
    game.definitions[bearDef.id] = bearDef;
    for (const owner of [p1, p2, p2]) {
      const bear = createCardInstance({ definitionId: bearDef.id, ownerId: owner.id, zone: "battlefield" });
      game.cards[bear.id] = bear;
      owner.zones.battlefield.push(bear.id);
    }
    const bound = bindCardEffects(game, [
      { kind: "damage_all", sourceId: null, amount: "creature_count" },
    ], { controllerId: p1.id, sourceId: null });
    expect(bound[0]?.kind === "damage_all" && bound[0].amount).toBe(3);
    const next = applyEffects(game, bound);
    expect(Object.values(next.cards).every((card) => card.zone === "graveyard")).toBe(true);
  });
});

describe("wave 59: offspring", () => {
  it("compiles Starscape Cleric fully as two modes", () => {
    const cleric = compileOracleCard({
      oracleId: "cleric",
      name: "Starscape Cleric",
      manaCost: "{1}{B}",
      typeLine: "Creature — Elf Cleric",
      power: "2",
      toughness: "1",
      printedKeywords: ["Flying"],
      imageUrl: "",
      oracleText:
        "Offspring {2}{B} (You may pay an additional {2}{B} as you cast this spell. If you do, when this creature enters, create a 1/1 token copy of it.)\nFlying\nThis creature can't block.\nWhenever you gain life, each opponent loses 1 life.",
    });
    expect(cleric.notes).toEqual([]);
    expect(cleric.definition.modes).toHaveLength(2);
    expect(cleric.definition.modes?.[1]?.extraCost).toBe("{2}{B}");
    const copy = cleric.definition.modes?.[1]?.effects.at(-1);
    expect(copy?.kind === "copy_token" && copy.ofCardId).toBe("self");
    expect(copy?.kind === "copy_token" && copy.setPt).toEqual({ power: 1, toughness: 1 });
  });

  it("creates a 1/1 copy of the entering creature", () => {
    const { game, p1 } = twoPlayers();
    const oxDef = createCardDefinition({
      name: "Ox",
      typeLine: "Creature — Ox",
      power: 4,
      toughness: 4,
    });
    game.definitions[oxDef.id] = oxDef;
    const ox = createCardInstance({ definitionId: oxDef.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[ox.id] = ox;
    p1.zones.battlefield.push(ox.id);

    const next = applyEffect(game, {
      kind: "copy_token",
      ownerId: p1.id,
      ofCardId: ox.id,
      setPt: { power: 1, toughness: 1 },
    });
    const token = Object.values(next.cards).find((card) => card.isToken)!;
    expect(token).toBeDefined();
    const tokenDef = next.definitions[token.definitionId]!;
    expect(tokenDef.name).toBe("Ox");
    expect(tokenDef.power).toBe(1);
    expect(tokenDef.toughness).toBe(1);
    // The original keeps its printed stats.
    expect(next.definitions[ox.definitionId]?.power).toBe(4);
  });
});

describe("wave 60: sacrifice-cost mana abilities", () => {
  it("compiles Phyrexian Altar fully", () => {
    const altar = compileOracleCard({
      oracleId: "phyrexianaltar",
      name: "Phyrexian Altar",
      manaCost: "{3}",
      typeLine: "Artifact",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
      oracleText: "Sacrifice a creature: Add one mana of any color.",
    });
    expect(altar.notes).toEqual([]);
    const ability = altar.definition.manaAbilities[0];
    expect(ability?.costSacrifice).toBe("creature");
    expect(ability?.noTap).toBe(true);
    expect(ability?.producesAnyColor).toBe(true);
  });

  it("pays the sacrifice, adds the chosen color, and never taps", () => {
    const { game, p1 } = twoPlayers();
    const altarDef = createCardDefinition({
      name: "Altar Lite",
      typeLine: "Artifact",
      manaAbilities: [
        {
          produces: {},
          producesOptions: [],
          producesAnyColor: true,
          damageToController: 0,
          costSacrifice: "creature",
          noTap: true,
        },
      ],
    });
    const bearDef = createCardDefinition({ name: "Bear", typeLine: "Creature — Bear", power: 2, toughness: 2 });
    game.definitions[altarDef.id] = altarDef;
    game.definitions[bearDef.id] = bearDef;
    const altar = createCardInstance({ definitionId: altarDef.id, ownerId: p1.id, zone: "battlefield" });
    const bear = createCardInstance({ definitionId: bearDef.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[altar.id] = altar;
    game.cards[bear.id] = bear;
    p1.zones.battlefield.push(altar.id, bear.id);

    // Without fodder chosen the activation is rejected.
    expect(() =>
      applyAction(game, { kind: "tap_for_mana", playerId: p1.id, cardId: altar.id, color: "B" }),
    ).toThrow(/Sacrifice a creature/);

    const next = applyAction(game, {
      kind: "tap_for_mana",
      playerId: p1.id,
      cardId: altar.id,
      color: "B",
      costSacrificeId: bear.id,
    });
    expect(next.players.find((p) => p.id === p1.id)!.mana.B).toBe(1);
    expect(next.cards[bear.id]?.zone).toBe("graveyard");
    expect(next.cards[altar.id]?.tapped).toBe(false);

    // With no creatures left, the ability is no longer offered.
    expect(manaAbilitiesFor(next, altar.id)).toHaveLength(0);
  });
});

describe("wave 61: token filters and search watchers", () => {
  const base = { power: null, toughness: null, printedKeywords: [], imageUrl: "" };

  it("compiles the four filter/search staples fully", () => {
    const slumlord = compileOracleCard({
      ...base,
      oracleId: "slumlord",
      name: "Ogre Slumlord",
      manaCost: "{3}{B}{B}",
      typeLine: "Creature — Ogre Rogue",
      power: "3",
      toughness: "3",
      oracleText:
        "Whenever another nontoken creature dies, you may create a 1/1 black Rat creature token.\nRats you control have deathtouch.",
    });
    expect(slumlord.notes).toEqual([]);
    expect(slumlord.definition.triggers[0]?.subjectFilter?.nonToken).toBe(true);

    const evangel = compileOracleCard({
      ...base,
      oracleId: "evangel",
      name: "Metastatic Evangel",
      manaCost: "{2}{W}",
      typeLine: "Creature — Phyrexian Cleric",
      power: "2",
      toughness: "3",
      oracleText: "Whenever another nontoken creature you control enters, proliferate.",
    });
    expect(evangel.notes).toEqual([]);

    const crafter = compileOracleCard({
      ...base,
      oracleId: "crafter",
      name: "Curiosity Crafter",
      manaCost: "{3}{U}",
      typeLine: "Creature — Bird Wizard",
      power: "3",
      toughness: "3",
      printedKeywords: ["Flying"],
      oracleText:
        "Flying\nWhenever a creature token you control deals combat damage to a player, draw a card.",
    });
    expect(crafter.notes).toEqual([]);
    expect(crafter.definition.triggers[0]?.subjectFilter?.tokenOnly).toBe(true);

    const archivist = compileOracleCard({
      ...base,
      oracleId: "archivist",
      name: "Archivist of Oghma",
      manaCost: "{1}{W}",
      typeLine: "Legendary Creature — Gnome",
      power: "2",
      toughness: "2",
      printedKeywords: ["Flash"],
      oracleText:
        "Flash\nWhenever an opponent searches their library, you gain 1 life and draw a card.",
    });
    expect(archivist.notes).toEqual([]);
    expect(archivist.definition.triggers[0]?.event).toBe("opponent_searches");
  });

  it("fires the search watcher only for opponents' searches", () => {
    const { game, p1, p2 } = twoPlayers();
    fillLibraries(game, 10);
    const archDef = createCardDefinition({
      name: "Archivist Lite",
      typeLine: "Creature — Gnome",
      power: 2,
      toughness: 2,
      triggers: [
        {
          event: "opponent_searches",
          effects: [{ kind: "draw", playerId: "controller", count: 1 }],
        },
      ],
    });
    game.definitions[archDef.id] = archDef;
    const arch = createCardInstance({ definitionId: archDef.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[arch.id] = arch;
    p1.zones.battlefield.push(arch.id);

    // An opponent's search (fail-to-find) still triggers the watcher.
    game.prompts.push({
      kind: "search_library",
      playerId: p2.id,
      filter: {},
      destination: "hand",
      count: 1,
    });
    let next = applyAction(game, { kind: "resolve_search", playerId: p2.id, cardIds: [] });
    expect(next.stack).toHaveLength(1);

    // The controller's own search does not.
    next = resolveTopOfStack(next);
    next.prompts.push({
      kind: "search_library",
      playerId: p1.id,
      filter: {},
      destination: "hand",
      count: 1,
    });
    const own = applyAction(next, { kind: "resolve_search", playerId: p1.id, cardIds: [] });
    expect(own.stack).toHaveLength(0);
  });
});

describe("wave 62: token mana grants and gated graveyard casts", () => {
  const base = { power: null, toughness: null, printedKeywords: [], imageUrl: "" };

  it("compiles Jaheira and Gravecrawler fully", () => {
    const jaheira = compileOracleCard({
      ...base,
      oracleId: "jaheira",
      name: "Jaheira, Friend of the Forest",
      manaCost: "{1}{G}",
      typeLine: "Legendary Creature — Human Druid",
      power: "1",
      toughness: "3",
      oracleText: "Tokens you control have \"{T}: Add {G}.\"",
    });
    expect(jaheira.notes).toEqual([]);
    const grant = jaheira.definition.staticAbilities[0];
    expect(grant?.selector.tokenOnly).toBe(true);
    expect(grant?.effect.kind === "grant_mana_ability" && grant.effect.ability.produces.G).toBe(1);

    const crawler = compileOracleCard({
      ...base,
      oracleId: "crawler",
      name: "Gravecrawler",
      manaCost: "{B}",
      typeLine: "Creature — Zombie",
      power: "2",
      toughness: "1",
      oracleText:
        "Gravecrawler can't block.\nYou may cast Gravecrawler from your graveyard as long as you control a Zombie.",
    });
    expect(crawler.notes).toEqual([]);
    expect(crawler.definition.castFromGraveyard).toEqual({ subtypes: ["zombie"] });
  });

  it("lets the token tap for the granted mana", () => {
    const { game, p1 } = twoPlayers();
    const jaheiraDef = createCardDefinition({
      name: "Jaheira Lite",
      typeLine: "Creature — Druid",
      power: 1,
      toughness: 3,
      staticAbilities: [
        {
          selector: { scope: "controlled", tokenOnly: true },
          effect: {
            kind: "grant_mana_ability",
            ability: { produces: { G: 1 }, producesOptions: [], producesAnyColor: false, damageToController: 0 },
          },
        },
      ],
    });
    game.definitions[jaheiraDef.id] = jaheiraDef;
    const jaheira = createCardInstance({ definitionId: jaheiraDef.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[jaheira.id] = jaheira;
    p1.zones.battlefield.push(jaheira.id);

    let next = applyEffect(game, {
      kind: "create_token",
      ownerId: p1.id,
      name: "Saproling",
      typeLine: "Creature — Saproling Token",
      power: 1,
      toughness: 1,
    });
    const token = Object.values(next.cards).find((card) => card.isToken)!;
    expect(manaAbilitiesFor(next, token.id)).toHaveLength(1);
    // The nontoken Jaheira herself gets nothing.
    expect(manaAbilitiesFor(next, jaheira.id)).toHaveLength(0);
  });

  it("casts from the graveyard only while the gate is satisfied", () => {
    const { game, p1 } = twoPlayers();
    const crawlerDef = createCardDefinition({
      name: "Crawler Lite",
      manaCost: "",
      typeLine: "Creature — Zombie",
      power: 2,
      toughness: 1,
      castFromGraveyard: { subtypes: ["zombie"] },
    });
    const zombieDef = createCardDefinition({
      name: "Walker",
      typeLine: "Creature — Zombie",
      power: 2,
      toughness: 2,
    });
    game.definitions[crawlerDef.id] = crawlerDef;
    game.definitions[zombieDef.id] = zombieDef;
    const crawler = createCardInstance({ definitionId: crawlerDef.id, ownerId: p1.id, zone: "graveyard" });
    game.cards[crawler.id] = crawler;
    p1.zones.graveyard.push(crawler.id);
    game.turn.activePlayerId = p1.id;
    game.turn.phase = "precombatMain";
    game.turn.step = "precombatMain";
    game.priorityPlayerId = p1.id;

    // No Zombie controlled: the cast is rejected.
    expect(() =>
      applyAction(game, { kind: "cast_spell", playerId: p1.id, cardId: crawler.id }),
    ).toThrow();

    const zombie = createCardInstance({ definitionId: zombieDef.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[zombie.id] = zombie;
    p1.zones.battlefield.push(zombie.id);
    let next = applyAction(game, { kind: "cast_spell", playerId: p1.id, cardId: crawler.id });
    expect(next.stack).toHaveLength(1);
    next = resolveTopOfStack(next);
    expect(next.cards[crawler.id]?.zone).toBe("battlefield");
  });
});

describe("wave 63: tribal-count damage and graveyard statics", () => {
  const base = { power: null, toughness: null, printedKeywords: [], imageUrl: "" };

  it("compiles Scourge of Valkas and Brawn fully", () => {
    const scourge = compileOracleCard({
      ...base,
      oracleId: "scourge",
      name: "Scourge of Valkas",
      manaCost: "{2}{R}{R}{R}",
      typeLine: "Creature — Dragon",
      power: "4",
      toughness: "4",
      printedKeywords: ["Flying"],
      oracleText:
        "Flying\nWhenever Scourge of Valkas or another Dragon you control enters, it deals X damage to any target, where X is the number of Dragons you control.",
    });
    expect(scourge.notes).toEqual([]);
    const trigger = scourge.definition.triggers[0];
    expect(trigger?.subjectFilter).toEqual({ subtypes: ["dragon"] });
    expect(trigger?.effects[0]?.kind === "deal_damage" && trigger.effects[0].amount).toEqual({
      subtypeCount: "dragon",
    });

    const brawn = compileOracleCard({
      ...base,
      oracleId: "brawn",
      name: "Brawn",
      manaCost: "{3}{G}",
      typeLine: "Creature — Incarnation",
      power: "3",
      toughness: "3",
      printedKeywords: ["Trample"],
      oracleText:
        "Trample\nAs long as this card is in your graveyard and you control a Forest, creatures you control have trample.",
    });
    expect(brawn.notes).toEqual([]);
    const anthem = brawn.definition.staticAbilities[0];
    expect(anthem?.fromGraveyard).toBe(true);
    expect(anthem?.requiresControlled).toEqual({ subtypes: ["forest"] });
  });

  it("grants trample from the graveyard only while the gate holds", () => {
    const { game, p1 } = twoPlayers();
    const brawnDef = createCardDefinition({
      name: "Brawn Lite",
      typeLine: "Creature — Incarnation",
      power: 3,
      toughness: 3,
      staticAbilities: [
        {
          selector: { scope: "controlled", types: ["creature"] },
          effect: { kind: "grant_keyword", keyword: "trample" },
          fromGraveyard: true,
          requiresControlled: { subtypes: ["forest"] },
        },
      ],
    });
    const bearDef = createCardDefinition({ name: "Bear", typeLine: "Creature — Bear", power: 2, toughness: 2 });
    const forestDef = createCardDefinition({ name: "Forest", typeLine: "Basic Land — Forest" });
    game.definitions[brawnDef.id] = brawnDef;
    game.definitions[bearDef.id] = bearDef;
    game.definitions[forestDef.id] = forestDef;
    const brawn = createCardInstance({ definitionId: brawnDef.id, ownerId: p1.id, zone: "graveyard" });
    const bear = createCardInstance({ definitionId: bearDef.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[brawn.id] = brawn;
    game.cards[bear.id] = bear;
    p1.zones.graveyard.push(brawn.id);
    p1.zones.battlefield.push(bear.id);

    // No Forest: no trample.
    expect(computedCard(game, bear.id)?.keywords.includes("trample")).toBe(false);

    const forest = createCardInstance({ definitionId: forestDef.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[forest.id] = forest;
    p1.zones.battlefield.push(forest.id);
    expect(computedCard(game, bear.id)?.keywords.includes("trample")).toBe(true);
  });
});

describe("wave 64: damage lifegain riders and filtered bounce", () => {
  const base = { power: null, toughness: null, printedKeywords: [], imageUrl: "" };

  it("compiles Creeping Bloodsucker and Wave Goodbye fully", () => {
    const sucker = compileOracleCard({
      ...base,
      oracleId: "sucker",
      name: "Creeping Bloodsucker",
      manaCost: "{1}{B}",
      typeLine: "Creature — Vampire",
      power: "1",
      toughness: "3",
      oracleText:
        "At the beginning of your upkeep, this creature deals 1 damage to each opponent. You gain life equal to the damage dealt this way.",
    });
    expect(sucker.notes).toEqual([]);
    const damage = sucker.definition.triggers[0]?.effects[0];
    expect(damage?.kind === "deal_damage" && damage.gainLife).toBe(true);

    const wave = compileOracleCard({
      ...base,
      oracleId: "wave",
      name: "Wave Goodbye",
      manaCost: "{2}{U}{U}",
      typeLine: "Sorcery",
      oracleText: "Return each creature without a +1/+1 counter on it to its owner's hand.",
    });
    expect(wave.notes).toEqual([]);
    expect(wave.definition.effects).toEqual([
      { kind: "bounce_each_creature", unlessCounter: "p1p1" },
    ]);
  });

  it("gains life per damage instance and spares countered creatures", () => {
    const { game, p1, p2 } = twoPlayers();
    const suckerDef = createCardDefinition({
      name: "Sucker Lite",
      typeLine: "Creature — Vampire",
      power: 1,
      toughness: 3,
    });
    game.definitions[suckerDef.id] = suckerDef;
    const sucker = createCardInstance({ definitionId: suckerDef.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[sucker.id] = sucker;
    p1.zones.battlefield.push(sucker.id);

    const before = game.players.find((p) => p.id === p1.id)!.life;
    const next = applyEffect(game, {
      kind: "deal_damage",
      sourceId: sucker.id,
      target: { type: "player", playerId: p2.id },
      amount: 1,
      gainLife: true,
    });
    expect(next.players.find((p) => p.id === p1.id)!.life).toBe(before + 1);

    // Bounce: countered creature stays.
    const bumped = applyEffect(next, { kind: "add_counter", cardId: sucker.id, counter: "p1p1", amount: 1 });
    const bearDef = createCardDefinition({ name: "Bear", typeLine: "Creature — Bear", power: 2, toughness: 2 });
    const withBear = { ...bumped, definitions: { ...bumped.definitions, [bearDef.id]: bearDef } };
    const bear = createCardInstance({ definitionId: bearDef.id, ownerId: p2.id, zone: "battlefield" });
    withBear.cards = { ...withBear.cards, [bear.id]: bear };
    withBear.players.find((p) => p.id === p2.id)!.zones.battlefield.push(bear.id);
    const bounced = applyEffect(withBear, { kind: "bounce_each_creature", unlessCounter: "p1p1" });
    expect(bounced.cards[sucker.id]?.zone).toBe("battlefield");
    expect(bounced.cards[bear.id]?.zone).toBe("hand");
  });
});

describe("wave 65: darksteel mutation", () => {
  it("compiles fully and rewrites the enchanted creature", () => {
    const mutation = compileOracleCard({
      oracleId: "mutation",
      name: "Darksteel Mutation",
      manaCost: "{1}{W}",
      typeLine: "Enchantment — Aura",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "Enchant creature\nEnchanted creature is an Insect artifact creature with base power and toughness 0/1 and has indestructible, and it loses all other abilities, card types, and creature types.",
    });
    expect(mutation.notes).toEqual([]);
    expect(mutation.definition.staticAbilities).toHaveLength(4);

    const { game, p1, p2 } = twoPlayers();
    const dragonDef = createCardDefinition({
      name: "Dragon",
      typeLine: "Creature — Dragon",
      power: 6,
      toughness: 6,
      keywords: ["flying"],
    });
    game.definitions[mutation.definition.id] = mutation.definition;
    game.definitions[dragonDef.id] = dragonDef;
    const dragon = createCardInstance({ definitionId: dragonDef.id, ownerId: p2.id, zone: "battlefield" });
    const aura = createCardInstance({ definitionId: mutation.definition.id, ownerId: p1.id, zone: "battlefield" });
    aura.attachedTo = dragon.id;
    game.cards[dragon.id] = dragon;
    game.cards[aura.id] = aura;
    p2.zones.battlefield.push(dragon.id);
    p1.zones.battlefield.push(aura.id);

    const computed = computedCard(game, dragon.id);
    expect(computed?.power).toBe(0);
    expect(computed?.toughness).toBe(1);
    expect(computed?.keywords.includes("indestructible")).toBe(true);
    expect(computed?.keywords.includes("flying")).toBe(false);
    expect(computed?.characteristics.types.includes("artifact")).toBe(true);
    expect(computed?.abilitiesRemoved).toBe(true);
  });
});

describe("wave 66: up-to optional targets", () => {
  it("compiles Drakuseth fully", () => {
    const drakuseth = compileOracleCard({
      oracleId: "drakuseth",
      name: "Drakuseth, Maw of Flames",
      manaCost: "{4}{R}{R}{R}",
      typeLine: "Legendary Creature — Dragon",
      power: "7",
      toughness: "7",
      printedKeywords: ["Flying"],
      imageUrl: "",
      oracleText:
        "Flying\nWhenever Drakuseth, Maw of Flames attacks, it deals 4 damage to any target and 3 damage to each of up to two other targets.",
    });
    expect(drakuseth.notes).toEqual([]);
    const trigger = drakuseth.definition.triggers[0];
    expect(trigger?.targetRequirements).toHaveLength(3);
    expect(trigger?.targetRequirements?.[1]?.optional).toBe(true);
  });

  it("accepts partial target sets and skips unfilled slots", () => {
    const { game, p1, p2 } = twoPlayers();
    const requirements = [
      { kind: "player_or_creature" as const },
      { kind: "player_or_creature" as const, optional: true },
      { kind: "player_or_creature" as const, optional: true },
    ];
    // One target only: legal.
    expect(() =>
      validateChosenTargets(game, requirements, [{ type: "player", playerId: p2.id }], p1.id),
    ).not.toThrow();
    // Duplicate targets with optional slots present: rejected.
    expect(() =>
      validateChosenTargets(
        game,
        requirements,
        [
          { type: "player", playerId: p2.id },
          { type: "player", playerId: p2.id },
        ],
        p1.id,
      ),
    ).toThrow(/once/);
    // Zero targets: the required slot is missing.
    expect(() => validateChosenTargets(game, requirements, [], p1.id)).toThrow(/target/);

    // Resolution: absent optional slots simply skip their effects.
    const effects = [0, 1, 2].map((index) => ({
      kind: "deal_damage" as const,
      sourceId: null,
      target: { type: "chosen" as const, index },
      amount: 4,
    }));
    const bound = bindCardEffects(game, effects, {
      controllerId: p1.id,
      sourceId: null,
      targets: [{ type: "player", playerId: p2.id }],
      targetRequirements: requirements,
    });
    expect(bound).toHaveLength(1);
    const next = applyEffects(game, bound);
    expect(next.players.find((p) => p.id === p2.id)!.life).toBe(
      game.players.find((p) => p.id === p2.id)!.life - 4,
    );
  });
});

describe("wave 67: first-attack latches and tuck riders", () => {
  const base = { power: null, toughness: null, printedKeywords: [], imageUrl: "" };

  it("compiles Aurelia and Stormfist Crusader fully", () => {
    const aurelia = compileOracleCard({
      ...base,
      oracleId: "aurelia",
      name: "Aurelia, the Warleader",
      manaCost: "{2}{R}{R}{W}{W}",
      typeLine: "Legendary Creature — Angel",
      power: "3",
      toughness: "4",
      printedKeywords: ["Flying", "Vigilance", "Haste"],
      oracleText:
        "Flying, vigilance, haste\nWhenever Aurelia attacks for the first time each turn, untap all creatures you control. After this phase, there is an additional combat phase.",
    });
    expect(aurelia.notes).toEqual([]);
    const trigger = aurelia.definition.triggers[0];
    expect(trigger?.event).toBe("attacks");
    expect(trigger?.oncePerTurn).toBe(true);
    expect(trigger?.effects.map((e) => e.kind)).toEqual(["untap_all", "extra_combat"]);

    const crusader = compileOracleCard({
      ...base,
      oracleId: "crusader",
      name: "Stormfist Crusader",
      manaCost: "{B}{R}",
      typeLine: "Creature — Human Knight",
      power: "2",
      toughness: "2",
      printedKeywords: ["Menace"],
      oracleText: "Menace\nAt the beginning of your upkeep, each player draws a card and loses 1 life.",
    });
    expect(crusader.notes).toEqual([]);
    expect(crusader.definition.triggers[0]?.effects).toEqual([
      { kind: "draw", playerId: "each_player", count: 1 },
      { kind: "lose_life", playerId: "each_player", amount: 1 },
    ]);
  });

  it("compiles the dies-to-bottom rider", () => {
    const rider = compileOracleCard({
      ...base,
      oracleId: "rider",
      name: "Murderous Rider",
      manaCost: "{1}{B}{B}",
      typeLine: "Creature — Zombie Knight",
      power: "2",
      toughness: "3",
      printedKeywords: ["Lifelink"],
      oracleText: "Lifelink\nWhen Murderous Rider dies, put it on the bottom of its owner's library.",
    });
    expect(rider.notes).toEqual([]);
    expect(rider.definition.triggers[0]?.effects).toEqual([
      { kind: "move_card", cardId: "self", toZone: "library", libraryPosition: "bottom" },
    ]);
  });
});

describe("wave 68: color and X-capped tutors", () => {
  it("compiles Green Sun's Zenith fully", () => {
    const zenith = compileOracleCard({
      oracleId: "gsz",
      name: "Green Sun's Zenith",
      manaCost: "{X}{G}",
      typeLine: "Sorcery",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "Search your library for a green creature card with mana value X or less, put it onto the battlefield, then shuffle. Shuffle Green Sun's Zenith into its owner's library.",
    });
    expect(zenith.notes).toEqual([]);
    const search = zenith.definition.effects[0];
    expect(search?.kind === "search_library" && search.filter).toEqual({
      types: ["creature"],
      colors: ["G"],
      maxManaValueX: true,
    });
  });

  it("filters searches by color and bound mana value", () => {
    const { game, p1 } = twoPlayers();
    const elfDef = createCardDefinition({
      name: "Elf",
      manaCost: "{G}",
      typeLine: "Creature — Elf",
      power: 1,
      toughness: 1,
    });
    const wurmDef = createCardDefinition({
      name: "Wurm",
      manaCost: "{5}{G}",
      typeLine: "Creature — Wurm",
      power: 6,
      toughness: 6,
    });
    const boarDef = createCardDefinition({
      name: "Boar",
      manaCost: "{1}{R}",
      typeLine: "Creature — Boar",
      power: 2,
      toughness: 2,
    });
    game.definitions[elfDef.id] = elfDef;
    game.definitions[wurmDef.id] = wurmDef;
    game.definitions[boarDef.id] = boarDef;
    const ids: string[] = [];
    for (const def of [elfDef, wurmDef, boarDef]) {
      const card = createCardInstance({ definitionId: def.id, ownerId: p1.id, zone: "library" });
      game.cards[card.id] = card;
      p1.zones.library.push(card.id);
      ids.push(card.id);
    }
    const bound = bindCardEffects(
      game,
      [
        {
          kind: "search_library",
          playerId: "controller",
          filter: { types: ["creature"], colors: ["G"], maxManaValueX: true },
          destination: "battlefield",
          count: 1,
        },
      ],
      { controllerId: p1.id, sourceId: null, xValue: 2 },
    );
    const next = applyEffects(game, bound);
    const prompt = next.prompts[0];
    expect(prompt?.kind).toBe("search_library");
    if (prompt?.kind !== "search_library") {
      throw new Error("expected search prompt");
    }
    expect(prompt.filter.maxManaValue).toBe(2);
    expect(searchMatches(next, ids[0]!, prompt.filter)).toBe(true);
    expect(searchMatches(next, ids[1]!, prompt.filter)).toBe(false);
    expect(searchMatches(next, ids[2]!, prompt.filter)).toBe(false);
  });
});

describe("wave 69: intervening-if trigger conditions", () => {
  it("compiles Padeem fully", () => {
    const padeem = compileOracleCard({
      oracleId: "padeem",
      name: "Padeem, Consul of Innovation",
      manaCost: "{3}{U}",
      typeLine: "Legendary Creature — Vedalken Artificer",
      power: "1",
      toughness: "4",
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "Artifacts you control have hexproof. (They can't be the targets of spells or abilities your opponents control.)\nAt the beginning of your upkeep, if you control the artifact with the greatest mana value or tied for the greatest mana value, draw a card.",
    });
    expect(padeem.notes).toEqual([]);
    const trigger = padeem.definition.triggers[0];
    expect(trigger?.condition).toEqual({ kind: "greatest_artifact_mana_value" });
    expect(trigger?.effects).toEqual([{ kind: "draw", playerId: "controller", count: 1 }]);
  });

  it("skips the trigger while the condition fails", () => {
    const { game, p1, p2 } = twoPlayers();
    fillLibraries(game, 10);
    const padeemDef = createCardDefinition({
      name: "Padeem Lite",
      manaCost: "{3}{U}",
      typeLine: "Creature — Artificer",
      power: 1,
      toughness: 4,
      triggers: [
        {
          event: "upkeep",
          condition: { kind: "greatest_artifact_mana_value" },
          effects: [{ kind: "draw", playerId: "controller", count: 1 }],
        },
      ],
    });
    const trinketDef = createCardDefinition({ name: "Trinket", manaCost: "{1}", typeLine: "Artifact" });
    const monumentDef = createCardDefinition({ name: "Monument", manaCost: "{5}", typeLine: "Artifact" });
    game.definitions[padeemDef.id] = padeemDef;
    game.definitions[trinketDef.id] = trinketDef;
    game.definitions[monumentDef.id] = monumentDef;
    const padeem = createCardInstance({ definitionId: padeemDef.id, ownerId: p1.id, zone: "battlefield" });
    const trinket = createCardInstance({ definitionId: trinketDef.id, ownerId: p1.id, zone: "battlefield" });
    const monument = createCardInstance({ definitionId: monumentDef.id, ownerId: p2.id, zone: "battlefield" });
    game.cards[padeem.id] = padeem;
    game.cards[trinket.id] = trinket;
    game.cards[monument.id] = monument;
    p1.zones.battlefield.push(padeem.id, trinket.id);
    p2.zones.battlefield.push(monument.id);
    game.turn.activePlayerId = p1.id;
    game.turn.phase = "beginning";
    game.turn.step = "untap";

    // Opponent holds the biggest artifact: no trigger at upkeep.
    let next = advanceSteps(game, 1);
    expect(next.stack).toHaveLength(0);

    // Give p1 the biggest artifact and try the next upkeep.
    const relic = createCardInstance({ definitionId: monumentDef.id, ownerId: p1.id, zone: "battlefield" });
    next.cards[relic.id] = relic;
    next.players.find((p) => p.id === p1.id)!.zones.battlefield.push(relic.id);
    next.turn.phase = "beginning";
    next.turn.step = "untap";
    next = advanceSteps(next, 1);
    expect(next.stack).toHaveLength(1);
  });
});

describe("wave 70: choose-two wipes", () => {
  it("compiles Austere Command fully with a choose-two mode set", () => {
    const command = compileOracleCard({
      oracleId: "austere",
      name: "Austere Command",
      manaCost: "{4}{W}{W}",
      typeLine: "Sorcery",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "Choose two —\n• Destroy all artifacts.\n• Destroy all enchantments.\n• Destroy all creatures with mana value 3 or less.\n• Destroy all creatures with mana value 4 or greater.",
    });
    expect(command.notes).toEqual([]);
    expect(command.definition.modes).toHaveLength(4);
    expect(command.definition.modeChoice).toEqual({ min: 2, max: 2 });
    const bigWipe = command.definition.modes?.[3]?.effects[0];
    expect(bigWipe?.kind === "destroy_all" && bigWipe.minManaValue).toBe(4);
  });

  it("min-mana-value wipes spare the small creatures", () => {
    const { game, p1 } = twoPlayers();
    const smallDef = createCardDefinition({ name: "Small", manaCost: "{1}", typeLine: "Creature — Rat", power: 1, toughness: 1 });
    const bigDef = createCardDefinition({ name: "Big", manaCost: "{5}", typeLine: "Creature — Giant", power: 5, toughness: 5 });
    game.definitions[smallDef.id] = smallDef;
    game.definitions[bigDef.id] = bigDef;
    const small = createCardInstance({ definitionId: smallDef.id, ownerId: p1.id, zone: "battlefield" });
    const big = createCardInstance({ definitionId: bigDef.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[small.id] = small;
    game.cards[big.id] = big;
    p1.zones.battlefield.push(small.id, big.id);

    const next = applyEffect(game, { kind: "destroy_all", what: "creatures", minManaValue: 4 });
    expect(next.cards[small.id]?.zone).toBe("battlefield");
    expect(next.cards[big.id]?.zone).toBe("graveyard");
  });
});

describe("wave 71: copy retargeting no-op and channel discounts", () => {
  const base = { power: null, toughness: null, printedKeywords: [], imageUrl: "" };

  it("compiles Otawara fully with the legendary discount", () => {
    const otawara = compileOracleCard({
      ...base,
      oracleId: "otawara",
      name: "Otawara, Soaring City",
      manaCost: "",
      typeLine: "Legendary Land",
      oracleText:
        "{T}: Add {U}.\nChannel — {3}{U}, Discard this card: Return target artifact, creature, enchantment, or planeswalker to its owner's hand. This ability costs {1} less to activate for each legendary creature you control.",
    });
    expect(otawara.notes).toEqual([]);
    const channel = otawara.definition.activated[0];
    expect(channel?.legendaryDiscount).toBe(true);
    expect(channel?.zone).toBe("hand");
    expect(channel?.targetRequirements).toEqual([{ kind: "nonland_permanent" }]);
  });

  it("swallows the copy retargeting permission", () => {
    const twincast = compileOracleCard({
      ...base,
      oracleId: "twincast",
      name: "Twincast",
      manaCost: "{U}{U}",
      typeLine: "Instant",
      oracleText: "Copy target instant or sorcery spell. You may choose new targets for the copy.",
    });
    expect(twincast.notes).toEqual([]);
    expect(twincast.definition.effects).toEqual([
      { kind: "copy_spell", target: { type: "chosen", index: 0 } },
    ]);
  });

  it("discounts the activation by controlled legendary creatures", () => {
    const { game, p1 } = twoPlayers();
    const landDef = createCardDefinition({
      name: "Channel Land",
      typeLine: "Legendary Land",
      activated: [
        {
          tap: false,
          manaCost: "{3}{U}",
          zone: "hand",
          discard: true,
          legendaryDiscount: true,
          effects: [{ kind: "draw", playerId: "controller", count: 1 }],
          targetRequirements: [],
        },
      ],
    });
    const legendDef = createCardDefinition({
      name: "Legend",
      typeLine: "Legendary Creature — Human",
      power: 2,
      toughness: 2,
    });
    game.definitions[landDef.id] = landDef;
    game.definitions[legendDef.id] = legendDef;
    const land = createCardInstance({ definitionId: landDef.id, ownerId: p1.id, zone: "hand" });
    game.cards[land.id] = land;
    p1.zones.hand.push(land.id);
    fillLibraries(game, 5);
    for (let i = 0; i < 3; i += 1) {
      const legend = createCardInstance({ definitionId: legendDef.id, ownerId: p1.id, zone: "battlefield" });
      game.cards[legend.id] = legend;
      p1.zones.battlefield.push(legend.id);
    }
    // {3}{U} minus three legends = {U}; give exactly one blue.
    game.players.find((p) => p.id === p1.id)!.mana.U = 1;
    const next = applyAction(game, {
      kind: "activate_ability",
      playerId: p1.id,
      cardId: land.id,
      abilityIndex: 0,
    });
    expect(next.cards[land.id]?.zone).toBe("graveyard");
  });
});

describe("wave 72: impulse digs", () => {
  const base = { power: null, toughness: null, printedKeywords: [], imageUrl: "" };

  it("compiles Silundi Vision's dig fully", () => {
    const vision = compileOracleCard({
      ...base,
      oracleId: "silundi",
      name: "Silundi Vision",
      manaCost: "{1}{U}",
      typeLine: "Instant",
      oracleText:
        "Look at the top six cards of your library. You may reveal an instant or sorcery card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.",
    });
    expect(vision.notes).toEqual([]);
    expect(vision.definition.effects).toEqual([
      {
        kind: "dig_top",
        playerId: "controller",
        count: 6,
        filter: { typesAny: ["instant", "sorcery"] },
        destination: "hand",
      },
    ]);
  });

  it("compiles Kinnan's ability dig with the non-Human filter", () => {
    const kinnan = compileOracleCard({
      ...base,
      oracleId: "kinnan",
      name: "Kinnan, Bonder Prodigy",
      manaCost: "{G}{U}",
      typeLine: "Legendary Creature — Human Druid",
      power: "2",
      toughness: "2",
      oracleText:
        "Whenever you tap a nonland permanent for mana, add one mana of any type that permanent produced.\n{5}{G}{U}: Look at the top five cards of your library. You may put a non-Human creature card from among them onto the battlefield. Put the rest on the bottom of your library in a random order.",
    });
    const dig = kinnan.definition.activated[0]?.effects[0];
    expect(dig?.kind === "dig_top" && dig.filter).toEqual({
      types: ["creature"],
      nonSubtypes: ["human"],
    });
    expect(dig?.kind === "dig_top" && dig.destination).toBe("battlefield");
  });

  it("auto-takes the first match and randomizes the rest to the bottom", () => {
    const { game, p1 } = twoPlayers();
    const boltDef = createCardDefinition({ name: "Bolt", manaCost: "{R}", typeLine: "Instant" });
    const bearDef = createCardDefinition({ name: "Bear", manaCost: "{1}{G}", typeLine: "Creature — Bear", power: 2, toughness: 2 });
    game.definitions[boltDef.id] = boltDef;
    game.definitions[bearDef.id] = bearDef;
    const ids: string[] = [];
    for (const def of [bearDef, boltDef, bearDef, bearDef]) {
      const card = createCardInstance({ definitionId: def.id, ownerId: p1.id, zone: "library" });
      game.cards[card.id] = card;
      p1.zones.library.push(card.id);
      ids.push(card.id);
    }
    const next = applyEffect(game, {
      kind: "dig_top",
      playerId: p1.id,
      count: 3,
      filter: { typesAny: ["instant", "sorcery"] },
      destination: "hand",
    });
    const player = next.players.find((p) => p.id === p1.id)!;
    expect(next.cards[ids[1]!]?.zone).toBe("hand");
    // Two looked cards went to the bottom; the untouched fourth card is on top.
    expect(player.zones.library[0]).toBe(ids[3]);
    expect(player.zones.library).toHaveLength(3);
  });
});

describe("wave 73: once-per-batch combat triggers", () => {
  it("compiles the one-or-more Treasure head fully", () => {
    const breaker = compileOracleCard({
      oracleId: "facebreaker",
      name: "Professional Face-Breaker",
      manaCost: "{2}{R}",
      typeLine: "Creature — Human Warrior",
      power: "3",
      toughness: "2",
      printedKeywords: ["Menace"],
      imageUrl: "",
      oracleText:
        "Menace\nWhenever one or more creatures you control deal combat damage to a player, create a Treasure token.",
    });
    expect(breaker.notes).toEqual([]);
    const trigger = breaker.definition.triggers[0];
    expect(trigger?.oncePerBatch).toBe(true);
    expect(trigger?.effects[0]?.kind).toBe("create_token");
  });

  it("fires once per batch, not once per creature", () => {
    const { game, p1, p2 } = twoPlayers();
    const watcherDef = createCardDefinition({
      name: "Watcher",
      typeLine: "Creature — Human",
      power: 1,
      toughness: 1,
      triggers: [
        {
          event: "deals_combat_damage_to_player",
          watch: "controlled",
          subjectFilter: { types: ["creature"] },
          oncePerBatch: true,
          effects: [{ kind: "draw", playerId: "controller", count: 1 }],
        },
      ],
    });
    game.definitions[watcherDef.id] = watcherDef;
    const watcher = createCardInstance({ definitionId: watcherDef.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[watcher.id] = watcher;
    p1.zones.battlefield.push(watcher.id);
    fillLibraries(game, 10);

    const bearDef = createCardDefinition({ name: "Bear", typeLine: "Creature — Bear", power: 2, toughness: 2 });
    game.definitions[bearDef.id] = bearDef;
    const a = createCardInstance({ definitionId: bearDef.id, ownerId: p1.id, zone: "battlefield" });
    const b = createCardInstance({ definitionId: bearDef.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[a.id] = a;
    game.cards[b.id] = b;
    p1.zones.battlefield.push(a.id, b.id);

    // Two creatures deal combat damage in the same batch: one trigger.
    dispatchEventsInPlace(game, [
      { kind: "combat_damage_to_player", cardId: a.id, playerId: p2.id },
      { kind: "combat_damage_to_player", cardId: b.id, playerId: p2.id },
    ]);
    expect(game.stack).toHaveLength(1);
  });
});

describe("wave 74: smothering tithe and per-controlled tokens", () => {
  const base = { power: null, toughness: null, printedKeywords: [], imageUrl: "" };

  it("compiles Smothering Tithe and Brass's Bounty fully", () => {
    const tithe = compileOracleCard({
      ...base,
      oracleId: "tithe",
      name: "Smothering Tithe",
      manaCost: "{3}{W}",
      typeLine: "Enchantment",
      oracleText:
        "Whenever an opponent draws a card, that player may pay {2}. If the player doesn't, you create a Treasure token. (It's an artifact with \"{T}, Sacrifice this token: Add one mana of any color.\")",
    });
    expect(tithe.notes).toEqual([]);
    const effect = tithe.definition.triggers[0]?.effects[0];
    expect(effect?.kind).toBe("unless_pays");
    expect(effect?.kind === "unless_pays" && effect.effects[0]?.kind).toBe("create_token");

    const bounty = compileOracleCard({
      ...base,
      oracleId: "bounty",
      name: "Brass's Bounty",
      manaCost: "{6}{R}",
      typeLine: "Sorcery",
      oracleText:
        "For each land you control, create a Treasure token. (It's an artifact with \"{T}, Sacrifice this token: Add one mana of any color.\")",
    });
    expect(bounty.notes).toEqual([]);
    const token = bounty.definition.effects[0];
    expect(token?.kind === "create_token" && token.perControlled).toBe("land");
  });

  it("creates one token per controlled land", () => {
    const { game, p1 } = twoPlayers();
    addLandsInPlay(game, p1, 4);
    const bound = bindCardEffects(
      game,
      [
        {
          kind: "create_token",
          ownerId: "controller",
          name: "Treasure",
          typeLine: "Artifact — Treasure Token",
          power: null,
          toughness: null,
          perControlled: "land",
        },
      ],
      { controllerId: p1.id, sourceId: null },
    );
    expect(bound[0]?.kind === "create_token" && bound[0].count).toBe(4);
    const next = applyEffects(game, bound);
    expect(Object.values(next.cards).filter((card) => card.isToken)).toHaveLength(4);
  });
});

describe("wave 75: died-this-turn treasures and second-spell taxes", () => {
  const base = { power: null, toughness: null, printedKeywords: [], imageUrl: "" };

  it("compiles Mahadi and Lotho fully", () => {
    const mahadi = compileOracleCard({
      ...base,
      oracleId: "mahadi",
      name: "Mahadi, Emporium Master",
      manaCost: "{1}{B}{R}",
      typeLine: "Legendary Creature — Leonin Devil",
      power: "3",
      toughness: "3",
      oracleText:
        "At the beginning of your end step, create a Treasure token for each creature that died this turn. (It's an artifact with \"{T}, Sacrifice this token: Add one mana of any color.\")",
    });
    expect(mahadi.notes).toEqual([]);
    const token = mahadi.definition.triggers[0]?.effects[0];
    expect(token?.kind === "create_token" && token.perDiedCreatures).toBe(true);

    const lotho = compileOracleCard({
      ...base,
      oracleId: "lotho",
      name: "Lotho, Corrupt Shirriff",
      manaCost: "{W}{B}",
      typeLine: "Legendary Creature — Halfling Rogue",
      power: "2",
      toughness: "2",
      oracleText:
        "Whenever a player casts their second spell each turn, you lose 1 life and create a Treasure token. (It's an artifact with \"{T}, Sacrifice this token: Add one mana of any color.\")",
    });
    expect(lotho.notes).toEqual([]);
    expect(lotho.definition.triggers[0]?.event).toBe("casts_second_spell");
  });

  it("counts the turn's creature deaths into the token batch", () => {
    const { game, p1 } = twoPlayers();
    const bearDef = createCardDefinition({ name: "Bear", typeLine: "Creature — Bear", power: 2, toughness: 2 });
    game.definitions[bearDef.id] = bearDef;
    let next = game;
    for (let i = 0; i < 2; i += 1) {
      const bear = createCardInstance({ definitionId: bearDef.id, ownerId: p1.id, zone: "battlefield" });
      next.cards[bear.id] = bear;
      next.players.find((p) => p.id === p1.id)!.zones.battlefield.push(bear.id);
      next = applyEffect(next, { kind: "sacrifice", cardId: bear.id });
    }
    expect(next.creaturesDiedThisTurn).toBe(2);
    const bound = bindCardEffects(
      next,
      [
        {
          kind: "create_token",
          ownerId: "controller",
          name: "Treasure",
          typeLine: "Artifact — Treasure Token",
          power: null,
          toughness: null,
          perDiedCreatures: true,
        },
      ],
      { controllerId: p1.id, sourceId: null },
    );
    expect(bound[0]?.kind === "create_token" && bound[0].count).toBe(2);
  });

  it("fires only on each player's second cast of the turn", () => {
    const { game, p1 } = twoPlayers();
    const lothoDef = createCardDefinition({
      name: "Lotho Lite",
      typeLine: "Creature — Halfling",
      power: 2,
      toughness: 2,
      triggers: [
        {
          event: "casts_second_spell",
          effects: [{ kind: "lose_life", playerId: "controller", amount: 1 }],
        },
      ],
    });
    const boltDef = createCardDefinition({ name: "Bolt", manaCost: "", typeLine: "Instant" });
    game.definitions[lothoDef.id] = lothoDef;
    game.definitions[boltDef.id] = boltDef;
    const lotho = createCardInstance({ definitionId: lothoDef.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[lotho.id] = lotho;
    p1.zones.battlefield.push(lotho.id);
    game.turn.activePlayerId = p1.id;
    game.turn.phase = "precombatMain";
    game.turn.step = "precombatMain";
    game.priorityPlayerId = p1.id;

    let next = game;
    for (let i = 0; i < 2; i += 1) {
      const bolt = createCardInstance({ definitionId: boltDef.id, ownerId: p1.id, zone: "hand" });
      next.cards[bolt.id] = bolt;
      next.players.find((p) => p.id === p1.id)!.zones.hand.push(bolt.id);
      next = applyAction(next, { kind: "cast_spell", playerId: p1.id, cardId: bolt.id });
      if (i === 0) {
        // First cast: only the spell is on the stack.
        expect(next.stack).toHaveLength(1);
        next = resolveTopOfStack(next);
      }
    }
    // Second cast: the spell plus Lotho's trigger.
    expect(next.stack).toHaveLength(2);
  });
});

describe("wave 76: impulse exiles", () => {
  const base = { power: null, toughness: null, printedKeywords: [], imageUrl: "" };

  it("compiles Professional Face-Breaker fully", () => {
    const breaker = compileOracleCard({
      ...base,
      oracleId: "breaker2",
      name: "Professional Face-Breaker",
      manaCost: "{2}{R}",
      typeLine: "Creature — Human Warrior",
      power: "3",
      toughness: "2",
      printedKeywords: ["Menace"],
      oracleText:
        "Menace\nWhenever one or more creatures you control deal combat damage to a player, create a Treasure token.\nSacrifice a Treasure: Exile the top card of your library. You may play that card this turn.",
    });
    expect(breaker.notes).toEqual([]);
    const ability = breaker.definition.activated[0];
    expect(ability?.sacrificeCost).toBe("treasure");
    expect(ability?.effects[0]).toEqual({
      kind: "exile_top_play",
      playerId: "controller",
      count: 1,
    });
  });

  it("exiles the top card and lets its controller cast it this turn", () => {
    const { game, p1 } = twoPlayers();
    const boltDef = createCardDefinition({ name: "Bolt", manaCost: "", typeLine: "Instant" });
    game.definitions[boltDef.id] = boltDef;
    const bolt = createCardInstance({ definitionId: boltDef.id, ownerId: p1.id, zone: "library" });
    game.cards[bolt.id] = bolt;
    p1.zones.library.unshift(bolt.id);
    game.turn.activePlayerId = p1.id;
    game.turn.phase = "precombatMain";
    game.turn.step = "precombatMain";
    game.priorityPlayerId = p1.id;

    let next = applyEffect(game, {
      kind: "exile_top_play",
      playerId: p1.id,
      casterId: p1.id,
      count: 1,
    });
    expect(next.cards[bolt.id]?.zone).toBe("exile");
    expect(next.exilePlayable).toEqual([{ cardId: bolt.id, casterId: p1.id }]);

    next = applyAction(next, { kind: "cast_spell", playerId: p1.id, cardId: bolt.id });
    expect(next.stack).toHaveLength(1);
    next = resolveTopOfStack(next);
    expect(next.cards[bolt.id]?.zone).toBe("graveyard");
  });

  it("the permission expires at cleanup", () => {
    const { game, p1 } = twoPlayers();
    const boltDef = createCardDefinition({ name: "Bolt", manaCost: "", typeLine: "Instant" });
    game.definitions[boltDef.id] = boltDef;
    const bolt = createCardInstance({ definitionId: boltDef.id, ownerId: p1.id, zone: "library" });
    game.cards[bolt.id] = bolt;
    p1.zones.library.unshift(bolt.id);
    let next = applyEffect(game, {
      kind: "exile_top_play",
      playerId: p1.id,
      casterId: p1.id,
      count: 1,
    });
    next.turn.activePlayerId = p1.id;
    next.turn.phase = "ending";
    next.turn.step = "end";
    next = advanceSteps(next, 1);
    expect(next.exilePlayable ?? []).toHaveLength(0);
  });
});

describe("wave 77: dash", () => {
  it("compiles Ragavan fully", () => {
    const ragavan = compileOracleCard({
      oracleId: "ragavan",
      name: "Ragavan, Nimble Pilferer",
      manaCost: "{R}",
      typeLine: "Legendary Creature — Monkey Pirate",
      power: "2",
      toughness: "1",
      printedKeywords: ["Dash"],
      imageUrl: "",
      oracleText:
        "Whenever Ragavan deals combat damage to a player, create a Treasure token and exile the top card of that player's library. Until end of turn, you may cast that card.\nDash {1}{R} (You may cast this spell for its dash cost. If you do, it gains haste, and it's returned from the battlefield to its owner's hand at the beginning of the next end step.)",
    });
    expect(ragavan.notes).toEqual([]);
    expect(ragavan.definition.modes).toHaveLength(2);
    expect(ragavan.definition.modes?.[1]?.dash).toBe(true);
    expect(ragavan.definition.modes?.[1]?.extraCost).toBe("{1}");
  });

  it("a dashed creature enters hasty and bounces at the next end step", () => {
    const { game, p1 } = twoPlayers();
    const raiderDef = createCardDefinition({
      name: "Raider",
      manaCost: "",
      typeLine: "Creature — Human Warrior",
      power: 3,
      toughness: 2,
      modes: [
        { label: "Cast normally", effects: [], targetRequirements: [] },
        { label: "Dash", dash: true, effects: [], targetRequirements: [] },
      ],
    });
    game.definitions[raiderDef.id] = raiderDef;
    const raider = createCardInstance({ definitionId: raiderDef.id, ownerId: p1.id, zone: "hand" });
    game.cards[raider.id] = raider;
    p1.zones.hand.push(raider.id);
    game.turn.activePlayerId = p1.id;
    game.turn.phase = "precombatMain";
    game.turn.step = "precombatMain";
    game.priorityPlayerId = p1.id;

    let next = applyAction(game, {
      kind: "cast_spell",
      playerId: p1.id,
      cardId: raider.id,
      modeIndex: 1,
    });
    next = resolveTopOfStack(next);
    expect(next.cards[raider.id]?.zone).toBe("battlefield");
    expect(next.cards[raider.id]?.summoningSick).toBe(false);
    expect(next.delayedEndStep).toEqual([{ cardId: raider.id, action: "hand" }]);

    next.turn.phase = "ending";
    next.turn.step = "beginCombat";
    next.turn.phase = "combat";
    // Advance into the end step: the raider bounces home.
    next.turn.phase = "postcombatMain";
    next.turn.step = "postcombatMain";
    next = advanceSteps(next, 1);
    expect(next.cards[raider.id]?.zone).toBe("hand");
  });
});

describe("wave 78: ascend and the city's blessing", () => {
  it("compiles Wayward Swordtooth fully", () => {
    const swordtooth = compileOracleCard({
      oracleId: "swordtooth",
      name: "Wayward Swordtooth",
      manaCost: "{2}{G}",
      typeLine: "Creature — Dinosaur",
      power: "5",
      toughness: "5",
      printedKeywords: ["Ascend"],
      imageUrl: "",
      oracleText:
        "Ascend (If you control ten or more permanents, you get the city's blessing for the rest of the game.)\nYou may play an additional land on each of your turns.\nThis creature can't attack or block unless you have the city's blessing.",
    });
    expect(swordtooth.notes).toEqual([]);
    expect(swordtooth.definition.ascend).toBe(true);
    const restrict = swordtooth.definition.staticAbilities[0];
    expect(restrict?.effect.kind === "restrict" && restrict.effect.unlessCityBlessing).toBe(true);
  });

  it("grants the blessing at ten permanents and lifts the restriction", () => {
    const { game, p1 } = twoPlayers();
    const toothDef = createCardDefinition({
      name: "Tooth",
      typeLine: "Creature — Dinosaur",
      power: 5,
      toughness: 5,
      ascend: true,
      staticAbilities: [
        {
          selector: { scope: "self" },
          effect: { kind: "restrict", cantAttack: true, cantBlock: true, unlessCityBlessing: true },
        },
      ],
    });
    game.definitions[toothDef.id] = toothDef;
    const tooth = createCardInstance({ definitionId: toothDef.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[tooth.id] = tooth;
    p1.zones.battlefield.push(tooth.id);
    addLandsInPlay(game, p1, 5);

    // Six permanents: no blessing, restriction holds.
    let next = applyEffect(game, { kind: "gain_life", playerId: p1.id, amount: 1 });
    expect(next.players.find((p) => p.id === p1.id)!.cityBlessing).toBeUndefined();
    expect(computedCard(next, tooth.id)?.cantAttack).toBe(true);

    // Four more permanents: the SBA sweep grants the blessing permanently.
    addLandsInPlay(next, next.players.find((p) => p.id === p1.id)!, 4);
    next = applyEffect(next, { kind: "gain_life", playerId: p1.id, amount: 1 });
    expect(next.players.find((p) => p.id === p1.id)!.cityBlessing).toBe(true);
    expect(computedCard(next, tooth.id)?.cantAttack).toBe(false);
  });
});

describe("wave 79: boseiju", () => {
  it("compiles Boseiju, Who Endures fully", () => {
    const boseiju = compileOracleCard({
      oracleId: "boseiju",
      name: "Boseiju, Who Endures",
      manaCost: "",
      typeLine: "Legendary Land",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "{T}: Add {G}.\nChannel — {1}{G}, Discard this card: Destroy target artifact, enchantment, or nonbasic land an opponent controls. That player may search their library for a land card with a basic land type, put it onto the battlefield, then shuffle. This ability costs {1} less to activate for each legendary creature you control.",
    });
    expect(boseiju.notes).toEqual([]);
    const channel = boseiju.definition.activated[0];
    expect(channel?.legendaryDiscount).toBe(true);
    expect(channel?.targetRequirements).toEqual([
      { kind: "artifact_enchantment_or_nonbasic_land", control: "not_own" },
    ]);
    expect(channel?.effects).toHaveLength(2);
    expect(channel?.effects[1]?.kind).toBe("search_library");
  });

  it("hits artifacts, enchantments, and nonbasic lands but not basics", () => {
    const { game, p1, p2 } = twoPlayers();
    const basicDef = createCardDefinition({ name: "Forest", typeLine: "Basic Land — Forest" });
    const dualDef = createCardDefinition({ name: "Tundra", typeLine: "Land — Plains Island" });
    const relicDef = createCardDefinition({ name: "Relic", typeLine: "Artifact" });
    for (const def of [basicDef, dualDef, relicDef]) {
      game.definitions[def.id] = def;
    }
    const basic = createCardInstance({ definitionId: basicDef.id, ownerId: p2.id, zone: "battlefield" });
    const dual = createCardInstance({ definitionId: dualDef.id, ownerId: p2.id, zone: "battlefield" });
    const relic = createCardInstance({ definitionId: relicDef.id, ownerId: p2.id, zone: "battlefield" });
    for (const card of [basic, dual, relic]) {
      game.cards[card.id] = card;
      p2.zones.battlefield.push(card.id);
    }
    const requirement = { kind: "artifact_enchantment_or_nonbasic_land" as const, control: "not_own" as const };
    expect(isChosenTargetLegal(game, requirement, { type: "creature", cardId: basic.id }, p1.id)).toBe(false);
    expect(isChosenTargetLegal(game, requirement, { type: "creature", cardId: dual.id }, p1.id)).toBe(true);
    expect(isChosenTargetLegal(game, requirement, { type: "creature", cardId: relic.id }, p1.id)).toBe(true);
    // Your own permanents are off-limits.
    const own = createCardInstance({ definitionId: relicDef.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[own.id] = own;
    p1.zones.battlefield.push(own.id);
    expect(isChosenTargetLegal(game, requirement, { type: "creature", cardId: own.id }, p1.id)).toBe(false);
  });
});

describe("wave 80: free multi-player impulses", () => {
  it("compiles Etali, Primal Storm fully", () => {
    const etali = compileOracleCard({
      oracleId: "etali",
      name: "Etali, Primal Storm",
      manaCost: "{4}{R}{R}",
      typeLine: "Legendary Creature — Elder Dinosaur",
      power: "6",
      toughness: "6",
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "Whenever Etali attacks, exile the top card of each player's library, then you may cast any number of spells from among those cards without paying their mana costs.",
    });
    expect(etali.notes).toEqual([]);
    expect(etali.definition.triggers[0]?.effects[0]).toEqual({
      kind: "exile_top_play",
      playerId: "each_player",
      count: 1,
      freeCast: true,
    });
  });

  it("free-casts an expensive exiled spell without mana", () => {
    const { game, p1, p2 } = twoPlayers();
    const bombDef = createCardDefinition({ name: "Bomb", manaCost: "{5}{R}{R}", typeLine: "Sorcery" });
    game.definitions[bombDef.id] = bombDef;
    const bomb = createCardInstance({ definitionId: bombDef.id, ownerId: p2.id, zone: "library" });
    game.cards[bomb.id] = bomb;
    p2.zones.library.unshift(bomb.id);
    game.turn.activePlayerId = p1.id;
    game.turn.phase = "precombatMain";
    game.turn.step = "precombatMain";
    game.priorityPlayerId = p1.id;

    const bound = bindCardEffects(
      game,
      [{ kind: "exile_top_play", playerId: "each_player", count: 1, freeCast: true }],
      { controllerId: p1.id, sourceId: null },
    );
    let next = applyEffects(game, bound);
    expect(next.cards[bomb.id]?.zone).toBe("exile");
    // p1 casts the opponent's exiled bomb with zero mana floating.
    next = applyAction(next, { kind: "cast_spell", playerId: p1.id, cardId: bomb.id });
    expect(next.stack).toHaveLength(1);
    next = resolveTopOfStack(next);
    expect(next.cards[bomb.id]?.zone).toBe("graveyard");
  });
});

describe("wave 81: fabled passage and staff of compleation", () => {
  const base = { power: null, toughness: null, printedKeywords: [], imageUrl: "" };

  it("compiles both fully", () => {
    const passage = compileOracleCard({
      ...base,
      oracleId: "passage",
      name: "Fabled Passage",
      manaCost: "",
      typeLine: "Land",
      oracleText:
        "{T}, Sacrifice this land: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle. Then if you control four or more lands, untap that land.",
    });
    expect(passage.notes).toEqual([]);
    const search = passage.definition.activated[0]?.effects[0];
    expect(search?.kind === "search_library" && search.untapIfLands).toBe(4);

    const staff = compileOracleCard({
      ...base,
      oracleId: "staff",
      name: "Staff of Compleation",
      manaCost: "{3}",
      typeLine: "Artifact",
      oracleText:
        "{T}, Pay 1 life: Destroy target permanent you own.\n{T}, Pay 2 life: Add one mana of any color.\n{T}, Pay 3 life: Proliferate.\n{T}, Pay 4 life: Draw a card.\n{5}: Untap this artifact.",
    });
    expect(staff.notes).toEqual([]);
  });

  it("untaps the fetched land at the threshold", () => {
    const { game, p1 } = twoPlayers();
    addLandsInPlay(game, p1, 3);
    const basicDef = createCardDefinition({ name: "Swamp", typeLine: "Basic Land — Swamp" });
    game.definitions[basicDef.id] = basicDef;
    const target = createCardInstance({ definitionId: basicDef.id, ownerId: p1.id, zone: "library" });
    game.cards[target.id] = target;
    p1.zones.library.push(target.id);
    game.prompts.push({
      kind: "search_library",
      playerId: p1.id,
      filter: { supertypes: ["basic"], types: ["land"] },
      destination: "battlefield",
      count: 1,
      entersTapped: true,
      untapIfLands: 4,
    });
    // Fetching the fourth land clears its tap.
    const next = applyAction(game, { kind: "resolve_search", playerId: p1.id, cardIds: [target.id] });
    expect(next.cards[target.id]?.zone).toBe("battlefield");
    expect(next.cards[target.id]?.tapped).toBe(false);
  });
});

describe("wave 82: venser bounce and life exchange", () => {
  const base = { power: null, toughness: null, printedKeywords: [], imageUrl: "" };

  it("compiles Venser and Tree of Perdition fully", () => {
    const venser = compileOracleCard({
      ...base,
      oracleId: "venser",
      name: "Venser, Shaper Savant",
      manaCost: "{2}{U}{U}",
      typeLine: "Legendary Creature — Human Wizard",
      power: "2",
      toughness: "2",
      printedKeywords: ["Flash"],
      oracleText:
        "Flash (You may cast this spell any time you could cast an instant.)\nWhen Venser enters, return target spell or permanent to its owner's hand.",
    });
    expect(venser.notes).toEqual([]);
    expect(venser.definition.triggers[0]?.targetRequirements).toEqual([
      { kind: "spell_or_permanent" },
    ]);

    const tree = compileOracleCard({
      ...base,
      oracleId: "tree",
      name: "Tree of Perdition",
      manaCost: "{3}{B}",
      typeLine: "Creature — Plant",
      power: "0",
      toughness: "13",
      printedKeywords: ["Defender"],
      oracleText: "Defender\n{T}: Exchange target opponent's life total with this creature's toughness.",
    });
    expect(tree.notes).toEqual([]);
    expect(tree.definition.activated[0]?.effects[0]?.kind).toBe("exchange_life_toughness");
  });

  it("bounces a spell off the stack to its owner's hand", () => {
    const { game, p2 } = twoPlayers();
    const boltDef = createCardDefinition({ name: "Bolt", manaCost: "", typeLine: "Instant" });
    game.definitions[boltDef.id] = boltDef;
    const bolt = createCardInstance({ definitionId: boltDef.id, ownerId: p2.id, zone: "hand" });
    game.cards[bolt.id] = bolt;
    p2.zones.hand.push(bolt.id);
    let next = putSpellOnStack(game, bolt.id);
    const stackId = next.stack[0]!.id;
    next = applyEffects(next, [{ kind: "bounce_spell_or_permanent", stackObjectId: stackId }]);
    expect(next.stack).toHaveLength(0);
    expect(next.cards[bolt.id]?.zone).toBe("hand");
  });

  it("swaps life with toughness both directions", () => {
    const { game, p1, p2 } = twoPlayers();
    const treeDef = createCardDefinition({
      name: "Tree",
      typeLine: "Creature — Plant",
      power: 0,
      toughness: 13,
    });
    game.definitions[treeDef.id] = treeDef;
    const tree = createCardInstance({ definitionId: treeDef.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[tree.id] = tree;
    p1.zones.battlefield.push(tree.id);

    const next = applyEffect(game, {
      kind: "exchange_life_toughness",
      playerId: p2.id,
      sourceId: tree.id,
    });
    expect(next.players.find((p) => p.id === p2.id)!.life).toBe(13);
    const newTree = next.cards[tree.id]!;
    expect(next.definitions[newTree.definitionId]?.toughness).toBe(40);
  });
});

describe("wave 83: anim pakal", () => {
  it("compiles fully", () => {
    const pakal = compileOracleCard({
      oracleId: "pakal",
      name: "Anim Pakal, Thousandth Moon",
      manaCost: "{1}{R}{W}",
      typeLine: "Legendary Creature — Human Soldier",
      power: "1",
      toughness: "3",
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "Whenever you attack with one or more non-Gnome creatures, put a +1/+1 counter on Anim Pakal, then create X 1/1 colorless Gnome artifact creature tokens that are tapped and attacking, where X is the number of +1/+1 counters on Anim Pakal.",
    });
    expect(pakal.notes).toEqual([]);
    const trigger = pakal.definition.triggers[0];
    expect(trigger?.oncePerBatch).toBe(true);
    expect(trigger?.subjectFilter?.nonSubtypes).toEqual(["gnome"]);
    const token = trigger?.effects[1];
    expect(token?.kind === "create_token" && token.perSourceCounters).toBe("p1p1");
  });

  it("counts the counters after the add and joins the combat", () => {
    const { game, p1, p2 } = twoPlayers();
    const pakalDef = createCardDefinition({
      name: "Pakal Lite",
      typeLine: "Creature — Human Soldier",
      power: 1,
      toughness: 3,
    });
    const bearDef = createCardDefinition({ name: "Bear", typeLine: "Creature — Bear", power: 2, toughness: 2 });
    game.definitions[pakalDef.id] = pakalDef;
    game.definitions[bearDef.id] = bearDef;
    const pakal = createCardInstance({ definitionId: pakalDef.id, ownerId: p1.id, zone: "battlefield" });
    const bear = createCardInstance({ definitionId: bearDef.id, ownerId: p1.id, zone: "battlefield" });
    bear.summoningSick = false;
    game.cards[pakal.id] = pakal;
    game.cards[bear.id] = bear;
    p1.zones.battlefield.push(pakal.id, bear.id);
    pakal.counters["p1p1"] = 1;
    game.combat = {
      attacks: [{ attackerId: bear.id, defenderId: p2.id }],
      blockers: {},
      attackersDeclared: true,
      declaredBlockersFor: [],
    };

    const bound = bindCardEffects(
      game,
      [
        { kind: "add_counter", cardId: "self", counter: "p1p1", amount: 1 },
        {
          kind: "create_token",
          ownerId: "controller",
          name: "Gnome",
          typeLine: "Artifact Creature — Gnome Token",
          power: 1,
          toughness: 1,
          perSourceCounters: "p1p1",
          entersTappedAttacking: true,
        },
      ],
      { controllerId: p1.id, sourceId: pakal.id },
    );
    const next = applyEffects(game, bound);
    const gnomes = Object.values(next.cards).filter((card) => card.isToken);
    // 1 existing counter + 1 added = 2 gnomes, tapped and attacking.
    expect(gnomes).toHaveLength(2);
    expect(gnomes.every((gnome) => gnome.tapped && gnome.attacking)).toBe(true);
    expect(next.combat?.attacks).toHaveLength(3);
  });
});

describe("wave 84: modal staples", () => {
  it("compiles Boros Charm fully", () => {
    const charm = compileOracleCard({
      oracleId: "boros-charm",
      name: "Boros Charm",
      manaCost: "{R}{W}",
      typeLine: "Instant",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "Choose one —\n• Boros Charm deals 4 damage to target player or planeswalker.\n• Permanents you control gain indestructible until end of turn.\n• Target creature gains double strike until end of turn.",
    });
    expect(charm.notes).toEqual([]);
    expect(charm.definition.modes).toHaveLength(3);
    expect(charm.definition.modes?.[0]?.targetRequirements).toEqual([
      { kind: "player_or_planeswalker" },
    ]);
    const grant = charm.definition.modes?.[1]?.effects[0];
    expect(grant?.kind === "team_keyword_until_eot" && grant.scope).toBe("permanents");
  });

  it("compiles Return of the Wildspeaker fully", () => {
    const wildspeaker = compileOracleCard({
      oracleId: "wildspeaker",
      name: "Return of the Wildspeaker",
      manaCost: "{4}{G}",
      typeLine: "Instant",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "Choose one —\n• Draw cards equal to the greatest power among non-Human creatures you control.\n• Non-Human creatures you control get +3/+3 until end of turn.",
    });
    expect(wildspeaker.notes).toEqual([]);
    expect(wildspeaker.definition.modes).toHaveLength(2);
    const draw = wildspeaker.definition.modes?.[0]?.effects[0];
    expect(draw?.kind === "draw" && draw.countFromGreatestPower).toEqual({
      nonSubtypes: ["human"],
    });
    const pump = wildspeaker.definition.modes?.[1]?.effects[0];
    expect(pump?.kind === "team_pt_until_eot" && pump.nonSubtypes).toEqual(["human"]);
  });

  it("damage to a planeswalker removes loyalty and kills it at zero", () => {
    const { game, p1, p2 } = twoPlayers();
    const walkerDef = createCardDefinition({
      name: "Walker",
      typeLine: "Legendary Planeswalker — Test",
    });
    game.definitions[walkerDef.id] = walkerDef;
    const walker = createCardInstance({
      definitionId: walkerDef.id,
      ownerId: p2.id,
      zone: "battlefield",
    });
    walker.counters["loyalty"] = 4;
    game.cards[walker.id] = walker;
    p2.zones.battlefield.push(walker.id);
    expect(p1.id).toBeTruthy();

    const dinged = applyEffect(game, {
      kind: "deal_damage",
      sourceId: null,
      target: { type: "creature", cardId: walker.id },
      amount: 3,
    });
    expect(dinged.cards[walker.id]?.counters["loyalty"]).toBe(1);
    expect(dinged.cards[walker.id]?.zone).toBe("battlefield");

    const killed = applyEffect(dinged, {
      kind: "deal_damage",
      sourceId: null,
      target: { type: "creature", cardId: walker.id },
      amount: 4,
    });
    expect(killed.cards[walker.id]?.zone).toBe("graveyard");
  });

  it("grants indestructible to noncreature permanents with the permanents scope", () => {
    const { game, p1 } = twoPlayers();
    const rockDef = createCardDefinition({ name: "Rock", typeLine: "Artifact" });
    const bearDef = createCardDefinition({ name: "Bear", typeLine: "Creature — Bear", power: 2, toughness: 2 });
    game.definitions[rockDef.id] = rockDef;
    game.definitions[bearDef.id] = bearDef;
    const rock = createCardInstance({ definitionId: rockDef.id, ownerId: p1.id, zone: "battlefield" });
    const bear = createCardInstance({ definitionId: bearDef.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[rock.id] = rock;
    game.cards[bear.id] = bear;
    p1.zones.battlefield.push(rock.id, bear.id);

    const next = applyEffect(game, {
      kind: "team_keyword_until_eot",
      playerId: p1.id,
      keyword: "indestructible",
      scope: "permanents",
    });
    expect(hasKeyword(next, rock.id, "indestructible")).toBe(true);
    expect(hasKeyword(next, bear.id, "indestructible")).toBe(true);
  });

  it("skips excluded subtypes in team pumps and greatest-power draws", () => {
    const { game, p1 } = twoPlayers();
    const humanDef = createCardDefinition({ name: "Human", typeLine: "Creature — Human", power: 5, toughness: 5 });
    const beastDef = createCardDefinition({ name: "Beast", typeLine: "Creature — Beast", power: 3, toughness: 3 });
    game.definitions[humanDef.id] = humanDef;
    game.definitions[beastDef.id] = beastDef;
    const human = createCardInstance({ definitionId: humanDef.id, ownerId: p1.id, zone: "battlefield" });
    const beast = createCardInstance({ definitionId: beastDef.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[human.id] = human;
    game.cards[beast.id] = beast;
    p1.zones.battlefield.push(human.id, beast.id);
    fillLibraries(game, 10);

    const pumped = applyEffect(game, {
      kind: "team_pt_until_eot",
      playerId: p1.id,
      power: 3,
      toughness: 3,
      nonSubtypes: ["human"],
    });
    expect(computedCard(pumped, beast.id)?.power).toBe(6);
    expect(computedCard(pumped, human.id)?.power).toBe(5);

    // The human's 5 power is excluded, so the beast's 3 sets the draw.
    const bound = bindCardEffects(
      game,
      [{ kind: "draw", playerId: "controller", count: 0, countFromGreatestPower: { nonSubtypes: ["human"] } }],
      { controllerId: p1.id, sourceId: null },
    );
    const handBefore = p1.zones.hand.length;
    const drawn = applyEffects(game, bound);
    expect(drawn.players.find((player) => player.id === p1.id)?.zones.hand).toHaveLength(
      handBefore + 3,
    );
  });
});

describe("wave 85: commander wills", () => {
  it("compiles Jeska's Will fully", () => {
    const will = compileOracleCard({
      oracleId: "jeska",
      name: "Jeska's Will",
      manaCost: "{2}{R}",
      typeLine: "Sorcery",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "Choose one. If you control a commander as you cast this spell, you may choose both instead.\n• Add {R} for each card in target opponent's hand.\n• Exile the top three cards of your library. You may play them this turn.",
    });
    expect(will.notes).toEqual([]);
    expect(will.definition.modeChoice).toEqual({ min: 1, max: 1, maxIfCommander: 2 });
    const mana = will.definition.modes?.[0]?.effects[0];
    expect(mana?.kind === "add_mana" && mana.perChosenPlayerHand).toBe(true);
    expect(will.definition.modes?.[0]?.targetRequirements).toEqual([{ kind: "opponent" }]);
    const impulse = will.definition.modes?.[1]?.effects[0];
    expect(impulse?.kind === "exile_top_play" && impulse.count).toBe(3);
  });

  it("compiles Akroma's Will fully", () => {
    const will = compileOracleCard({
      oracleId: "akroma",
      name: "Akroma's Will",
      manaCost: "{3}{W}",
      typeLine: "Instant",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "Choose one. If you control a commander as you cast this spell, you may choose both instead.\n• Creatures you control gain flying, vigilance, and double strike until end of turn.\n• Creatures you control gain lifelink, indestructible, and protection from each color until end of turn.",
    });
    expect(will.notes).toEqual([]);
    expect(will.definition.modeChoice).toEqual({ min: 1, max: 1, maxIfCommander: 2 });
    expect(will.definition.modes?.[0]?.effects).toHaveLength(3);
    const protection = will.definition.modes?.[1]?.effects[2];
    expect(protection?.kind === "team_protection_until_eot" && protection.colors).toEqual([
      "W",
      "U",
      "B",
      "R",
      "G",
    ]);
  });

  it("allows both modes only while you control a commander", () => {
    const { game, p1 } = twoPlayers();
    game.turn.phase = "precombatMain";
    game.turn.step = "precombatMain";
    const will = createCardDefinition({
      name: "Test Will",
      manaCost: "",
      typeLine: "Sorcery",
      modeChoice: { min: 1, max: 1, maxIfCommander: 2 },
      modes: [
        {
          label: "gain 2",
          effects: [{ kind: "gain_life", playerId: "controller", amount: 2 }],
          targetRequirements: [],
        },
        {
          label: "gain 5",
          effects: [{ kind: "gain_life", playerId: "controller", amount: 5 }],
          targetRequirements: [],
        },
      ],
    });
    game.definitions[will.id] = will;
    const card = createCardInstance({ definitionId: will.id, ownerId: p1.id, zone: "hand" });
    game.cards[card.id] = card;
    p1.zones.hand.push(card.id);

    expect(() =>
      applyAction(game, {
        kind: "cast_spell",
        playerId: p1.id,
        cardId: card.id,
        targets: [],
        modeIndexes: [0, 1],
      }),
    ).toThrow();

    const generalDef = createCardDefinition({
      name: "General",
      typeLine: "Legendary Creature — Human Soldier",
      power: 2,
      toughness: 2,
    });
    game.definitions[generalDef.id] = generalDef;
    const general = createCardInstance({
      definitionId: generalDef.id,
      ownerId: p1.id,
      zone: "battlefield",
    });
    game.cards[general.id] = general;
    p1.zones.battlefield.push(general.id);
    p1.commander.commanderIds.push(general.id);

    const cast = applyAction(game, {
      kind: "cast_spell",
      playerId: p1.id,
      cardId: card.id,
      targets: [],
      modeIndexes: [0, 1],
    });
    const resolved = resolveTopOfStack(cast);
    expect(resolved.players[0]?.life).toBe(47);
  });

  it("granted protection blocks targeting and color-matched sweeps", () => {
    const { game, p1, p2 } = twoPlayers();
    const bearDef = createCardDefinition({ name: "Bear", typeLine: "Creature — Bear", power: 2, toughness: 2 });
    const boltDef = createCardDefinition({ name: "Bolt Source", manaCost: "{R}", typeLine: "Creature — Elemental", power: 1, toughness: 1 });
    game.definitions[bearDef.id] = bearDef;
    game.definitions[boltDef.id] = boltDef;
    const bear = createCardInstance({ definitionId: bearDef.id, ownerId: p1.id, zone: "battlefield" });
    const bolt = createCardInstance({ definitionId: boltDef.id, ownerId: p2.id, zone: "battlefield" });
    game.cards[bear.id] = bear;
    game.cards[bolt.id] = bolt;
    p1.zones.battlefield.push(bear.id);
    p2.zones.battlefield.push(bolt.id);

    const shielded = applyEffect(game, {
      kind: "team_protection_until_eot",
      playerId: p1.id,
      colors: ["W", "U", "B", "R", "G"],
    });
    expect(
      isChosenTargetLegal(
        shielded,
        { kind: "creature" },
        { type: "creature", cardId: bear.id },
        p2.id,
        ["R"],
      ),
    ).toBe(false);

    const swept = applyEffect(shielded, {
      kind: "damage_all",
      sourceId: bolt.id,
      amount: 5,
    });
    expect(swept.cards[bear.id]?.zone).toBe("battlefield");
    expect(swept.cards[bolt.id]?.zone).toBe("graveyard");
  });

  it("multiplies Jeska mana by the chosen opponent's hand", () => {
    const { game, p1, p2 } = twoPlayers();
    addHandCards(game, p2, 3);
    const bound = bindCardEffects(
      game,
      [
        {
          kind: "add_mana",
          playerId: "controller",
          mana: { R: 1 },
          perChosenPlayerHand: true,
        },
      ],
      {
        controllerId: p1.id,
        sourceId: null,
        targets: [{ type: "player", playerId: p2.id }],
        targetRequirements: [{ kind: "opponent" }],
      },
    );
    const next = applyEffects(game, bound);
    expect(next.players.find((player) => player.id === p1.id)?.mana.R).toBe(3);
  });
});

describe("wave 86: reanimation and deluges", () => {
  it("compiles Reanimate fully", () => {
    const reanimate = compileOracleCard({
      oracleId: "reanimate",
      name: "Reanimate",
      manaCost: "{B}",
      typeLine: "Sorcery",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "Put target creature card from a graveyard onto the battlefield under your control. You lose life equal to that card's mana value.",
    });
    expect(reanimate.notes).toEqual([]);
    expect(reanimate.definition.targetRequirements).toEqual([{ kind: "graveyard_creature_card" }]);
    const steal = reanimate.definition.effects[0];
    expect(steal?.kind === "move_card" && steal.underControlOf).toBe("controller");
    const drain = reanimate.definition.effects[1];
    expect(drain?.kind === "lose_life" && drain.amount).toBe("target_mana_value");
  });

  it("compiles Toxic Deluge fully", () => {
    const deluge = compileOracleCard({
      oracleId: "deluge",
      name: "Toxic Deluge",
      manaCost: "{2}{B}",
      typeLine: "Sorcery",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "As an additional cost to cast this spell, pay X life.\nAll creatures get -X/-X until end of turn.",
    });
    expect(deluge.notes).toEqual([]);
    expect(deluge.definition.additionalCost?.lifeX).toBe(true);
    const sweep = deluge.definition.effects[0];
    expect(sweep?.kind === "all_pt_until_eot" && sweep.power).toBe("-x");
  });

  it("steals a creature from an opponent's graveyard and drains its mana value", () => {
    const { game, p1, p2 } = twoPlayers();
    const dragonDef = createCardDefinition({
      name: "Dragon",
      manaCost: "{3}{G}",
      typeLine: "Creature — Dragon",
      power: 5,
      toughness: 5,
    });
    game.definitions[dragonDef.id] = dragonDef;
    const dragon = createCardInstance({ definitionId: dragonDef.id, ownerId: p2.id, zone: "graveyard" });
    game.cards[dragon.id] = dragon;
    p2.zones.graveyard.push(dragon.id);

    const bound = bindCardEffects(
      game,
      [
        {
          kind: "move_card",
          cardId: { type: "chosen", index: 0 },
          toZone: "battlefield",
          underControlOf: "controller",
        },
        { kind: "lose_life", playerId: "controller", amount: "target_mana_value" },
      ],
      {
        controllerId: p1.id,
        sourceId: null,
        targets: [{ type: "creature", cardId: dragon.id }],
        targetRequirements: [{ kind: "graveyard_creature_card" }],
      },
    );
    const next = applyEffects(game, bound);
    expect(next.cards[dragon.id]?.zone).toBe("battlefield");
    expect(next.cards[dragon.id]?.controllerId).toBe(p1.id);
    expect(next.players.find((player) => player.id === p1.id)?.life).toBe(36);
  });

  it("pays X life for Toxic Deluge and sweeps by -X/-X", () => {
    const { game, p1, p2 } = twoPlayers();
    game.turn.phase = "precombatMain";
    game.turn.step = "precombatMain";
    const delugeDef = createCardDefinition({
      name: "Test Deluge",
      manaCost: "",
      typeLine: "Sorcery",
      additionalCost: { lifeX: true },
      effects: [{ kind: "all_pt_until_eot", power: "-x", toughness: "-x" }],
    });
    const smallDef = createCardDefinition({ name: "Small", typeLine: "Creature — Goblin", power: 2, toughness: 2 });
    const bigDef = createCardDefinition({ name: "Big", typeLine: "Creature — Beast", power: 3, toughness: 3 });
    game.definitions[delugeDef.id] = delugeDef;
    game.definitions[smallDef.id] = smallDef;
    game.definitions[bigDef.id] = bigDef;
    const spell = createCardInstance({ definitionId: delugeDef.id, ownerId: p1.id, zone: "hand" });
    const small = createCardInstance({ definitionId: smallDef.id, ownerId: p2.id, zone: "battlefield" });
    const big = createCardInstance({ definitionId: bigDef.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[spell.id] = spell;
    game.cards[small.id] = small;
    game.cards[big.id] = big;
    p1.zones.hand.push(spell.id);
    p2.zones.battlefield.push(small.id);
    p1.zones.battlefield.push(big.id);

    // No X announced → refused.
    expect(() =>
      applyAction(game, { kind: "cast_spell", playerId: p1.id, cardId: spell.id, targets: [] }),
    ).toThrow();

    const cast = applyAction(game, {
      kind: "cast_spell",
      playerId: p1.id,
      cardId: spell.id,
      targets: [],
      xValue: 2,
    });
    expect(cast.players[0]?.life).toBe(38);
    const resolved = resolveTopOfStack(cast);
    // The 2/2 dies to the -2/-2; the 3/3 survives at 1 toughness.
    expect(resolved.cards[small.id]?.zone).toBe("graveyard");
    expect(resolved.cards[big.id]?.zone).toBe("battlefield");
    expect(computedCard(resolved, big.id)?.toughness).toBe(1);
  });

  it("enumerates creature cards in every graveyard", () => {
    const { game, p1, p2 } = twoPlayers();
    const bearDef = createCardDefinition({ name: "Bear", typeLine: "Creature — Bear", power: 2, toughness: 2 });
    const rockDef = createCardDefinition({ name: "Rock", typeLine: "Artifact" });
    game.definitions[bearDef.id] = bearDef;
    game.definitions[rockDef.id] = rockDef;
    const own = createCardInstance({ definitionId: bearDef.id, ownerId: p1.id, zone: "graveyard" });
    const theirs = createCardInstance({ definitionId: bearDef.id, ownerId: p2.id, zone: "graveyard" });
    const rock = createCardInstance({ definitionId: rockDef.id, ownerId: p2.id, zone: "graveyard" });
    game.cards[own.id] = own;
    game.cards[theirs.id] = theirs;
    game.cards[rock.id] = rock;
    p1.zones.graveyard.push(own.id);
    p2.zones.graveyard.push(theirs.id, rock.id);

    const choices = legalChoicesForRequirement(game, { kind: "graveyard_creature_card" }, p1.id);
    const ids = choices.flatMap((choice) => (choice.type === "creature" ? [choice.cardId] : []));
    expect(ids.sort()).toEqual([own.id, theirs.id].sort());
  });
});

describe("wave 87: consuls, plunderers, provisioners", () => {
  it("compiles the trio fully", () => {
    const authority = compileOracleCard({
      oracleId: "authority",
      name: "Authority of the Consuls",
      manaCost: "{W}",
      typeLine: "Enchantment",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "Creatures your opponents control enter tapped.\nWhenever a creature an opponent controls enters, you gain 1 life.",
    });
    expect(authority.notes).toEqual([]);
    expect(authority.definition.opponentCreaturesEnterTapped).toBe(true);
    expect(authority.definition.triggers[0]?.watch).toBe("opponents");

    const plunderer = compileOracleCard({
      oracleId: "plunderer",
      name: "Pitiless Plunderer",
      manaCost: "{3}{B}",
      typeLine: "Creature — Human Pirate",
      power: "1",
      toughness: "4",
      printedKeywords: [],
      imageUrl: "",
      oracleText: "Whenever another creature you control dies, create a Treasure token.",
    });
    expect(plunderer.notes).toEqual([]);
    expect(plunderer.definition.triggers[0]?.excludeSelf).toBe(true);
    expect(plunderer.definition.triggers[0]?.watch).toBe("controlled");

    const provisioner = compileOracleCard({
      oracleId: "provisioner",
      name: "Tireless Provisioner",
      manaCost: "{2}{G}",
      typeLine: "Creature — Elf Scout",
      power: "3",
      toughness: "2",
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "Landfall — Whenever a land you control enters, create a Food token or a Treasure token. (Food is an artifact with \"{2}, {T}, Sacrifice this token: You gain 3 life.\" Treasure is an artifact with \"{T}, Sacrifice this token: Add one mana of any color.\")",
    });
    expect(provisioner.notes).toEqual([]);
    const body = provisioner.definition.triggers[0]?.effects[0];
    expect(body?.kind === "create_token" && body.name).toBe("Treasure");
  });

  it("taps arriving creatures for opponents of the Authority controller only", () => {
    const { game, p1, p2 } = twoPlayers();
    const authorityDef = createCardDefinition({
      name: "Authority",
      typeLine: "Enchantment",
      opponentCreaturesEnterTapped: true,
    });
    const bearDef = createCardDefinition({ name: "Bear", typeLine: "Creature — Bear", power: 2, toughness: 2 });
    game.definitions[authorityDef.id] = authorityDef;
    game.definitions[bearDef.id] = bearDef;
    const authority = createCardInstance({ definitionId: authorityDef.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[authority.id] = authority;
    p1.zones.battlefield.push(authority.id);

    const theirBear = createCardInstance({ definitionId: bearDef.id, ownerId: p2.id, zone: "hand" });
    game.cards[theirBear.id] = theirBear;
    p2.zones.hand.push(theirBear.id);
    const arrived = moveCard(game, theirBear.id, "battlefield");
    expect(arrived.cards[theirBear.id]?.tapped).toBe(true);

    const ownBear = createCardInstance({ definitionId: bearDef.id, ownerId: p1.id, zone: "hand" });
    game.cards[ownBear.id] = ownBear;
    p1.zones.hand.push(ownBear.id);
    const ownArrived = moveCard(game, ownBear.id, "battlefield");
    expect(ownArrived.cards[ownBear.id]?.tapped).toBe(false);
  });

  it("plunders a Treasure when another controlled creature dies, but not itself", () => {
    const { game, p1 } = twoPlayers();
    const plundererDef = createCardDefinition({
      name: "Plunderer",
      typeLine: "Creature — Human Pirate",
      power: 1,
      toughness: 4,
      triggers: [
        {
          event: "dies",
          watch: "controlled",
          excludeSelf: true,
          subjectFilter: { types: ["creature"] },
          effects: [
            {
              kind: "create_token",
              ownerId: "controller",
              name: "Treasure",
              typeLine: "Artifact — Treasure Token",
              power: null,
              toughness: null,
            },
          ],
        },
      ],
    });
    const bearDef = createCardDefinition({ name: "Bear", typeLine: "Creature — Bear", power: 2, toughness: 2 });
    game.definitions[plundererDef.id] = plundererDef;
    game.definitions[bearDef.id] = bearDef;
    const plunderer = createCardInstance({ definitionId: plundererDef.id, ownerId: p1.id, zone: "battlefield" });
    const bear = createCardInstance({ definitionId: bearDef.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[plunderer.id] = plunderer;
    game.cards[bear.id] = bear;
    p1.zones.battlefield.push(plunderer.id, bear.id);

    let next = moveCard(game, bear.id, "graveyard");
    while (next.stack.length > 0) {
      next = resolveTopOfStack(next);
    }
    const treasures = Object.values(next.cards).filter(
      (card) => card.isToken && next.definitions[card.definitionId]?.name === "Treasure",
    );
    expect(treasures).toHaveLength(1);
  });
});

describe("wave 88: land auras", () => {
  it("compiles Wild Growth and Utopia Sprawl fully", () => {
    const growth = compileOracleCard({
      oracleId: "growth",
      name: "Wild Growth",
      manaCost: "{G}",
      typeLine: "Enchantment — Aura",
      power: null,
      toughness: null,
      printedKeywords: ["Enchant land"],
      imageUrl: "",
      oracleText:
        "Enchant land\nWhenever enchanted land is tapped for mana, its controller adds an additional {G}.",
    });
    expect(growth.notes).toEqual([]);
    expect(growth.definition.enchant).toBe("land");
    expect(growth.definition.enchantedTappedBonus).toEqual({ color: "G", amount: 1 });
    expect(growth.definition.targetRequirements).toEqual([{ kind: "land" }]);

    const sprawl = compileOracleCard({
      oracleId: "sprawl",
      name: "Utopia Sprawl",
      manaCost: "{G}",
      typeLine: "Enchantment — Aura",
      power: null,
      toughness: null,
      printedKeywords: ["Enchant Forest"],
      imageUrl: "",
      oracleText:
        "Enchant Forest\nAs this Aura enters, choose a color.\nWhenever enchanted Forest is tapped for mana, its controller adds an additional one mana of the chosen color.",
    });
    expect(sprawl.notes).toEqual([]);
    expect(sprawl.definition.enchant).toBe("land");
    expect(sprawl.definition.chooseColorOnEnter).toBe(true);
    expect(sprawl.definition.enchantedTappedBonus).toEqual({ color: "chosen", amount: 1 });
    expect(sprawl.definition.targetRequirements).toEqual([
      { kind: "land", requiredSubtypes: ["forest"] },
    ]);
  });

  it("adds bonus mana when the enchanted land taps", () => {
    const { game, p1 } = twoPlayers();
    const forestDef = createCardDefinition({
      name: "Forest",
      typeLine: "Basic Land — Forest",
      produces: { G: 1 },
    });
    const growthDef = createCardDefinition({
      name: "Wild Growth",
      typeLine: "Enchantment — Aura",
      enchant: "land",
      enchantedTappedBonus: { color: "G", amount: 1 },
    });
    const sprawlDef = createCardDefinition({
      name: "Utopia Sprawl",
      typeLine: "Enchantment — Aura",
      enchant: "land",
      chooseColorOnEnter: true,
      enchantedTappedBonus: { color: "chosen", amount: 1 },
    });
    game.definitions[forestDef.id] = forestDef;
    game.definitions[growthDef.id] = growthDef;
    game.definitions[sprawlDef.id] = sprawlDef;
    const forest = createCardInstance({ definitionId: forestDef.id, ownerId: p1.id, zone: "battlefield" });
    const growth = createCardInstance({ definitionId: growthDef.id, ownerId: p1.id, zone: "battlefield" });
    const sprawl = createCardInstance({ definitionId: sprawlDef.id, ownerId: p1.id, zone: "battlefield" });
    growth.attachedTo = forest.id;
    sprawl.attachedTo = forest.id;
    sprawl.chosenColor = "R";
    game.cards[forest.id] = forest;
    game.cards[growth.id] = growth;
    game.cards[sprawl.id] = sprawl;
    p1.zones.battlefield.push(forest.id, growth.id, sprawl.id);

    game.priorityPlayerId = p1.id;
    const tapped = applyAction(game, {
      kind: "tap_for_mana",
      playerId: p1.id,
      cardId: forest.id,
    });
    expect(tapped.players[0]?.mana.G).toBe(2);
    expect(tapped.players[0]?.mana.R).toBe(1);
  });

  it("prompts for a color on entry and stores the choice", () => {
    const { game, p1 } = twoPlayers();
    const sprawlDef = createCardDefinition({
      name: "Utopia Sprawl",
      typeLine: "Enchantment — Aura",
      enchant: "land",
      chooseColorOnEnter: true,
      enchantedTappedBonus: { color: "chosen", amount: 1 },
    });
    const forestDef = createCardDefinition({ name: "Forest", typeLine: "Basic Land — Forest" });
    game.definitions[sprawlDef.id] = sprawlDef;
    game.definitions[forestDef.id] = forestDef;
    const forest = createCardInstance({ definitionId: forestDef.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[forest.id] = forest;
    p1.zones.battlefield.push(forest.id);
    const sprawl = createCardInstance({ definitionId: sprawlDef.id, ownerId: p1.id, zone: "hand" });
    game.cards[sprawl.id] = sprawl;
    p1.zones.hand.push(sprawl.id);

    let next = moveCard(game, sprawl.id, "battlefield");
    next.cards[sprawl.id]!.attachedTo = forest.id;
    expect(next.prompts[0]?.kind).toBe("choose_color");
    next = applyAction(next, { kind: "resolve_color", playerId: p1.id, color: "U" });
    expect(next.cards[sprawl.id]?.chosenColor).toBe("U");
    // A land host keeps the aura through the SBA sweep.
    expect(next.cards[sprawl.id]?.zone).toBe("battlefield");
  });
});

describe("wave 89: hardened scales", () => {
  it("compiles Hardened Scales and Kami of Whispered Hopes fully", () => {
    const scales = compileOracleCard({
      oracleId: "scales",
      name: "Hardened Scales",
      manaCost: "{G}",
      typeLine: "Enchantment",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "If one or more +1/+1 counters would be put on a creature you control, that many plus one +1/+1 counters are put on it instead.",
    });
    expect(scales.notes).toEqual([]);
    expect(scales.definition.replacements[0]).toEqual({
      kind: "bonus_counters",
      counter: "p1p1",
      creaturesOnly: true,
    });

    const kami = compileOracleCard({
      oracleId: "kami",
      name: "Kami of Whispered Hopes",
      manaCost: "{2}{G}",
      typeLine: "Creature — Spirit",
      power: "2",
      toughness: "2",
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "If one or more +1/+1 counters would be put on a permanent you control, that many plus one +1/+1 counters are put on that permanent instead.\n{T}: Add X mana of any one color, where X is this creature's power.",
    });
    expect(kami.notes).toEqual([]);
    expect(kami.definition.replacements[0]).toEqual({ kind: "bonus_counters", counter: "p1p1" });
    expect(kami.definition.manaAbilities[0]?.countFromPower).toBe(true);
    expect(kami.definition.manaAbilities[0]?.producesAnyColor).toBe(true);
  });

  it("adds a bonus counter per Scales, before doublers", () => {
    const { game, p1 } = twoPlayers();
    const scalesDef = createCardDefinition({
      name: "Scales",
      typeLine: "Enchantment",
      replacements: [{ kind: "bonus_counters", counter: "p1p1", creaturesOnly: true }],
    });
    const doublerDef = createCardDefinition({
      name: "Evolution",
      typeLine: "Enchantment",
      replacements: [{ kind: "double_counters", counter: "p1p1", creaturesOnly: true }],
    });
    const bearDef = createCardDefinition({ name: "Bear", typeLine: "Creature — Bear", power: 2, toughness: 2 });
    game.definitions[scalesDef.id] = scalesDef;
    game.definitions[doublerDef.id] = doublerDef;
    game.definitions[bearDef.id] = bearDef;
    const scales = createCardInstance({ definitionId: scalesDef.id, ownerId: p1.id, zone: "battlefield" });
    const bear = createCardInstance({ definitionId: bearDef.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[scales.id] = scales;
    game.cards[bear.id] = bear;
    p1.zones.battlefield.push(scales.id, bear.id);

    const bumped = applyEffect(game, { kind: "add_counter", cardId: bear.id, counter: "p1p1", amount: 2 });
    expect(bumped.cards[bear.id]?.counters["p1p1"]).toBe(3);

    const doubler = createCardInstance({ definitionId: doublerDef.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[doubler.id] = doubler;
    p1.zones.battlefield.push(doubler.id);
    const both = applyEffect(game, { kind: "add_counter", cardId: bear.id, counter: "p1p1", amount: 2 });
    // (2 + 1) × 2 — the controller's optimal CR 616.1 ordering.
    expect(both.cards[bear.id]?.counters["p1p1"]).toBe(6);
  });

  it("taps Kami for mana equal to its power", () => {
    const { game, p1 } = twoPlayers();
    const kamiDef = createCardDefinition({
      name: "Kami",
      typeLine: "Creature — Spirit",
      power: 2,
      toughness: 2,
      manaAbilities: [
        {
          produces: {},
          producesOptions: [],
          producesAnyColor: true,
          damageToController: 0,
          countFromPower: true,
        },
      ],
    });
    game.definitions[kamiDef.id] = kamiDef;
    const kami = createCardInstance({ definitionId: kamiDef.id, ownerId: p1.id, zone: "battlefield" });
    kami.summoningSick = false;
    kami.counters["p1p1"] = 1;
    game.cards[kami.id] = kami;
    p1.zones.battlefield.push(kami.id);

    game.priorityPlayerId = p1.id;
    const tapped = applyAction(game, {
      kind: "tap_for_mana",
      playerId: p1.id,
      cardId: kami.id,
      color: "U",
    });
    expect(tapped.players[0]?.mana.U).toBe(3);
  });
});

describe("wave 90: warps, drains, taxes", () => {
  it("compiles Chaos Warp, Exsanguinate, and Land Tax fully", () => {
    const warp = compileOracleCard({
      oracleId: "warp",
      name: "Chaos Warp",
      manaCost: "{2}{R}",
      typeLine: "Instant",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "The owner of target permanent shuffles it into their library, then reveals the top card of their library. If it's a permanent card, they put it onto the battlefield.",
    });
    expect(warp.notes).toEqual([]);
    expect(warp.definition.targetRequirements).toEqual([{ kind: "permanent" }]);
    expect(warp.definition.effects[1]).toEqual({
      kind: "reveal_top_put_permanent",
      playerId: { type: "chosen_owner", index: 0 },
    });

    const drain = compileOracleCard({
      oracleId: "drain",
      name: "Exsanguinate",
      manaCost: "{X}{B}{B}",
      typeLine: "Sorcery",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
      oracleText: "Each opponent loses X life. You gain life equal to the life lost this way.",
    });
    expect(drain.notes).toEqual([]);
    expect(drain.definition.effects[0]).toEqual({
      kind: "drain_opponents",
      playerId: "controller",
      amount: "x",
    });

    const tax = compileOracleCard({
      oracleId: "tax",
      name: "Land Tax",
      manaCost: "{W}",
      typeLine: "Enchantment",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "At the beginning of your upkeep, if an opponent controls more lands than you, you may search your library for up to three basic land cards, reveal them, put them into your hand, then shuffle.",
    });
    expect(tax.notes).toEqual([]);
    expect(tax.definition.triggers[0]?.condition).toEqual({
      kind: "opponent_controls_more_lands",
    });
  });

  it("shuffles the target away and puts a revealed permanent onto the battlefield", () => {
    const { game, p1, p2 } = twoPlayers();
    const bearDef = createCardDefinition({ name: "Bear", typeLine: "Creature — Bear", power: 2, toughness: 2 });
    const boltDef = createCardDefinition({ name: "Bolt", typeLine: "Instant" });
    game.definitions[bearDef.id] = bearDef;
    game.definitions[boltDef.id] = boltDef;
    const victim = createCardInstance({ definitionId: bearDef.id, ownerId: p2.id, zone: "battlefield" });
    const replacement = createCardInstance({ definitionId: bearDef.id, ownerId: p2.id, zone: "library" });
    game.cards[victim.id] = victim;
    game.cards[replacement.id] = replacement;
    p2.zones.battlefield.push(victim.id);
    p2.zones.library.push(replacement.id);

    const bound = bindCardEffects(
      game,
      [
        {
          kind: "move_card",
          cardId: { type: "chosen", index: 0 },
          toZone: "library",
          libraryPosition: "shuffled",
        },
        { kind: "reveal_top_put_permanent", playerId: { type: "chosen_owner", index: 0 } },
      ],
      {
        controllerId: p1.id,
        sourceId: null,
        targets: [{ type: "creature", cardId: victim.id }],
        targetRequirements: [{ kind: "permanent" }],
      },
    );
    const next = applyEffects(game, bound);
    // The shuffle is genuinely random: the revealed top is one of the two
    // bears (both permanent cards), so exactly one lands and one stays.
    const after = next.players.find((player) => player.id === p2.id)!;
    expect(after.zones.battlefield).toHaveLength(1);
    expect(after.zones.library).toHaveLength(1);
    expect(next.definitions[next.cards[after.zones.battlefield[0]!]!.definitionId]?.name).toBe(
      "Bear",
    );
  });

  it("drains each opponent and gains the total", () => {
    const { game, p1 } = twoPlayers();
    const bound = bindCardEffects(
      game,
      [{ kind: "drain_opponents", playerId: "controller", amount: "x" }],
      { controllerId: p1.id, sourceId: null, xValue: 5 },
    );
    const next = applyEffects(game, bound);
    expect(next.players[1]?.life).toBe(35);
    expect(next.players[0]?.life).toBe(45);
  });

  it("holds the Land Tax condition only while an opponent has more lands", () => {
    const { game, p1, p2 } = twoPlayers();
    const taxDef = createCardDefinition({
      name: "Tax",
      typeLine: "Enchantment",
      triggers: [
        {
          event: "upkeep",
          condition: { kind: "opponent_controls_more_lands" },
          effects: [{ kind: "draw", playerId: "controller", count: 1 }],
        },
      ],
    });
    game.definitions[taxDef.id] = taxDef;
    const tax = createCardInstance({ definitionId: taxDef.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[tax.id] = tax;
    p1.zones.battlefield.push(tax.id);
    fillLibraries(game, 10);

    // Equal lands (zero each): the trigger is skipped.
    expect(queueTrigger(game)).toBe(false);
    addLandsInPlay(game, p2, 2);
    expect(queueTrigger(game)).toBe(true);

    function queueTrigger(state: GameState): boolean {
      const cloned = structuredClone(state);
      const before = cloned.stack.length;
      dispatchEventsInPlace(cloned, [{ kind: "step_begins", step: "upkeep" }]);
      return cloned.stack.length > before || cloned.prompts.length > 0;
    }
  });
});

describe("wave 91: devotion and revelations", () => {
  it("compiles Gray Merchant and Shamanic Revelation fully", () => {
    const merchant = compileOracleCard({
      oracleId: "gary",
      name: "Gray Merchant of Asphodel",
      manaCost: "{3}{B}{B}",
      typeLine: "Creature — Zombie",
      power: "2",
      toughness: "4",
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "When this creature enters, each opponent loses X life, where X is your devotion to black. You gain life equal to the life lost this way. (Each {B} in the mana costs of permanents you control counts toward your devotion to black.)",
    });
    expect(merchant.notes).toEqual([]);
    expect(merchant.definition.triggers[0]?.effects[0]).toEqual({
      kind: "drain_opponents",
      playerId: "controller",
      amount: { devotion: "B" },
    });

    const revelation = compileOracleCard({
      oracleId: "revelation",
      name: "Shamanic Revelation",
      manaCost: "{3}{G}{G}",
      typeLine: "Sorcery",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "Draw a card for each creature you control.\nFerocious — You gain 4 life for each creature you control with power 4 or greater.",
    });
    expect(revelation.notes).toEqual([]);
    const draw = revelation.definition.effects[0];
    expect(draw?.kind === "draw" && draw.countPerControlled).toBe("creature");
    const ferocious = revelation.definition.effects[1];
    expect(ferocious?.kind === "gain_life" && ferocious.perControlledCreature).toEqual({
      minPower: 4,
    });
  });

  it("drains devotion pips from each opponent", () => {
    const { game, p1 } = twoPlayers();
    const garyDef = createCardDefinition({
      name: "Gary",
      manaCost: "{3}{B}{B}",
      typeLine: "Creature — Zombie",
      power: 2,
      toughness: 4,
    });
    const ritesDef = createCardDefinition({ name: "Rites", manaCost: "{B}", typeLine: "Enchantment" });
    game.definitions[garyDef.id] = garyDef;
    game.definitions[ritesDef.id] = ritesDef;
    const gary = createCardInstance({ definitionId: garyDef.id, ownerId: p1.id, zone: "battlefield" });
    const rites = createCardInstance({ definitionId: ritesDef.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[gary.id] = gary;
    game.cards[rites.id] = rites;
    p1.zones.battlefield.push(gary.id, rites.id);

    const bound = bindCardEffects(
      game,
      [{ kind: "drain_opponents", playerId: "controller", amount: { devotion: "B" } }],
      { controllerId: p1.id, sourceId: gary.id },
    );
    const next = applyEffects(game, bound);
    // Devotion 3: {B}{B} on Gary plus {B} on the enchantment.
    expect(next.players[1]?.life).toBe(37);
    expect(next.players[0]?.life).toBe(43);
  });

  it("scales revelation draws and ferocious life by the board", () => {
    const { game, p1 } = twoPlayers();
    const bigDef = createCardDefinition({ name: "Big", typeLine: "Creature — Beast", power: 5, toughness: 5 });
    const smallDef = createCardDefinition({ name: "Small", typeLine: "Creature — Goblin", power: 2, toughness: 2 });
    game.definitions[bigDef.id] = bigDef;
    game.definitions[smallDef.id] = smallDef;
    const big = createCardInstance({ definitionId: bigDef.id, ownerId: p1.id, zone: "battlefield" });
    const small = createCardInstance({ definitionId: smallDef.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[big.id] = big;
    game.cards[small.id] = small;
    p1.zones.battlefield.push(big.id, small.id);
    fillLibraries(game, 10);

    const bound = bindCardEffects(
      game,
      [
        { kind: "draw", playerId: "controller", count: 0, countPerControlled: "creature" },
        {
          kind: "gain_life",
          playerId: "controller",
          amount: 4,
          perControlledCreature: { minPower: 4 },
        },
      ],
      { controllerId: p1.id, sourceId: null },
    );
    const handBefore = p1.zones.hand.length;
    const next = applyEffects(game, bound);
    expect(next.players[0]?.zones.hand).toHaveLength(handBefore + 2);
    // Only the 5-power beast meets ferocious.
    expect(next.players[0]?.life).toBe(44);
  });
});

describe("wave 92: konrad and guardians", () => {
  it("compiles Syr Konrad and Guardian Project fully", () => {
    const konrad = compileOracleCard({
      oracleId: "konrad",
      name: "Syr Konrad, the Grim",
      manaCost: "{3}{B}{B}",
      typeLine: "Legendary Creature — Human Knight",
      power: "5",
      toughness: "4",
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "Whenever another creature dies, or a creature card is put into a graveyard from anywhere other than the battlefield, or a creature card leaves your graveyard, Syr Konrad deals 1 damage to each opponent.\n{1}{B}: Each player mills a card.",
    });
    expect(konrad.notes).toEqual([]);
    expect(konrad.definition.triggers).toHaveLength(3);
    expect(konrad.definition.triggers.map((trigger) => trigger.event)).toEqual([
      "dies",
      "graveyard_from_elsewhere",
      "leaves_your_graveyard",
    ]);
    expect(konrad.definition.activated).toHaveLength(1);

    const project = compileOracleCard({
      oracleId: "project",
      name: "Guardian Project",
      manaCost: "{3}{G}",
      typeLine: "Enchantment",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "Whenever a nontoken creature you control enters, if it doesn't have the same name as another creature you control or a creature card in your graveyard, draw a card.",
    });
    expect(project.notes).toEqual([]);
    expect(project.definition.triggers[0]?.condition).toEqual({ kind: "subject_name_unique" });
    expect(project.definition.triggers[0]?.subjectFilter?.nonToken).toBe(true);
  });

  it("fires Konrad on graveyard traffic in both directions", () => {
    const { game, p1 } = twoPlayers();
    const konradDef = createCardDefinition({
      name: "Konrad",
      typeLine: "Creature — Human Knight",
      power: 5,
      toughness: 4,
      triggers: [
        {
          event: "graveyard_from_elsewhere",
          subjectFilter: { types: ["creature"] },
          effects: [
            {
              kind: "deal_damage",
              sourceId: "self",
              target: { type: "player", playerId: "each_opponent" },
              amount: 1,
            },
          ],
        },
        {
          event: "leaves_your_graveyard",
          subjectFilter: { types: ["creature"] },
          effects: [
            {
              kind: "deal_damage",
              sourceId: "self",
              target: { type: "player", playerId: "each_opponent" },
              amount: 1,
            },
          ],
        },
      ],
    });
    const bearDef = createCardDefinition({ name: "Bear", typeLine: "Creature — Bear", power: 2, toughness: 2 });
    game.definitions[konradDef.id] = konradDef;
    game.definitions[bearDef.id] = bearDef;
    const konrad = createCardInstance({ definitionId: konradDef.id, ownerId: p1.id, zone: "battlefield" });
    const bear = createCardInstance({ definitionId: bearDef.id, ownerId: p1.id, zone: "hand" });
    game.cards[konrad.id] = konrad;
    game.cards[bear.id] = bear;
    p1.zones.battlefield.push(konrad.id);
    p1.zones.hand.push(bear.id);

    // Hand → graveyard: "from anywhere other than the battlefield".
    let next = moveCard(game, bear.id, "graveyard");
    while (next.stack.length > 0) {
      next = resolveTopOfStack(next);
    }
    expect(next.players[1]?.life).toBe(39);

    // Graveyard → battlefield: "leaves your graveyard".
    next = moveCard(next, bear.id, "battlefield");
    while (next.stack.length > 0) {
      next = resolveTopOfStack(next);
    }
    expect(next.players[1]?.life).toBe(38);
  });

  it("draws only for uniquely named arrivals", () => {
    const { game, p1 } = twoPlayers();
    const projectDef = createCardDefinition({
      name: "Project",
      typeLine: "Enchantment",
      triggers: [
        {
          event: "enter_battlefield",
          watch: "controlled",
          condition: { kind: "subject_name_unique" },
          subjectFilter: { types: ["creature"], nonToken: true },
          effects: [{ kind: "draw", playerId: "controller", count: 1 }],
        },
      ],
    });
    const bearDef = createCardDefinition({ name: "Bear", typeLine: "Creature — Bear", power: 2, toughness: 2 });
    game.definitions[projectDef.id] = projectDef;
    game.definitions[bearDef.id] = bearDef;
    const project = createCardInstance({ definitionId: projectDef.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[project.id] = project;
    p1.zones.battlefield.push(project.id);
    fillLibraries(game, 10);

    const first = createCardInstance({ definitionId: bearDef.id, ownerId: p1.id, zone: "hand" });
    game.cards[first.id] = first;
    p1.zones.hand.push(first.id);
    const handBefore = p1.zones.hand.length - 1;
    let next = moveCard(game, first.id, "battlefield");
    while (next.stack.length > 0) {
      next = resolveTopOfStack(next);
    }
    expect(next.players[0]?.zones.hand).toHaveLength(handBefore + 1);

    // A second Bear shares a name with the first: no draw.
    const second = createCardInstance({ definitionId: bearDef.id, ownerId: p1.id, zone: "hand" });
    next.cards[second.id] = second;
    next.players[0]!.zones.hand.push(second.id);
    const handMid = next.players[0]!.zones.hand.length - 1;
    let after = moveCard(next, second.id, "battlefield");
    while (after.stack.length > 0) {
      after = resolveTopOfStack(after);
    }
    expect(after.players[0]?.zones.hand).toHaveLength(handMid);
  });
});

describe("wave 93: abolishers and rhythms", () => {
  it("compiles Grand Abolisher and Rhythm of the Wild fully", () => {
    const abolisher = compileOracleCard({
      oracleId: "abolisher",
      name: "Grand Abolisher",
      manaCost: "{W}{W}",
      typeLine: "Creature — Human Cleric",
      power: "2",
      toughness: "2",
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "During your turn, your opponents can't cast spells or activate abilities of artifacts, creatures, or enchantments.",
    });
    expect(abolisher.notes).toEqual([]);
    expect(abolisher.definition.opponentsLockedDuringYourTurn).toBe(true);

    const rhythm = compileOracleCard({
      oracleId: "rhythm",
      name: "Rhythm of the Wild",
      manaCost: "{1}{R}{G}",
      typeLine: "Enchantment",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "Creature spells you control can't be countered.\nNontoken creatures you control have riot. (They can enter with a +1/+1 counter or with haste.)",
    });
    expect(rhythm.notes).toEqual([]);
    expect(rhythm.definition.creatureSpellsCantBeCountered).toBe(true);
    expect(rhythm.definition.staticAbilities[0]?.selector.nonToken).toBe(true);
  });

  it("locks opponents out of casting on the abolisher controller's turn", () => {
    const { game, p1, p2 } = twoPlayers();
    game.turn.phase = "precombatMain";
    game.turn.step = "precombatMain";
    const abolisherDef = createCardDefinition({
      name: "Abolisher",
      typeLine: "Creature — Human Cleric",
      power: 2,
      toughness: 2,
      opponentsLockedDuringYourTurn: true,
    });
    const boltDef = createCardDefinition({
      name: "Bolt",
      manaCost: "",
      typeLine: "Instant",
      effects: [{ kind: "gain_life", playerId: "controller", amount: 1 }],
    });
    game.definitions[abolisherDef.id] = abolisherDef;
    game.definitions[boltDef.id] = boltDef;
    const abolisher = createCardInstance({ definitionId: abolisherDef.id, ownerId: p1.id, zone: "battlefield" });
    const bolt = createCardInstance({ definitionId: boltDef.id, ownerId: p2.id, zone: "hand" });
    game.cards[abolisher.id] = abolisher;
    game.cards[bolt.id] = bolt;
    p1.zones.battlefield.push(abolisher.id);
    p2.zones.hand.push(bolt.id);

    // p1 is active; the opponent can't cast even with priority.
    game.priorityPlayerId = p2.id;
    expect(() =>
      applyAction(game, { kind: "cast_spell", playerId: p2.id, cardId: bolt.id, targets: [] }),
    ).toThrow(/stops you from casting/);
    expect(
      legalActions(game, p2.id).some((action) => action.kind === "cast_spell"),
    ).toBe(false);

    // On the opponent's own turn the lock is silent.
    game.turn.activePlayerId = p2.id;
    const cast = applyAction(game, {
      kind: "cast_spell",
      playerId: p2.id,
      cardId: bolt.id,
      targets: [],
    });
    expect(cast.stack).toHaveLength(1);
  });

  it("makes controlled creature spells uncounterable and grants riot haste", () => {
    const { game, p1, p2 } = twoPlayers();
    game.turn.phase = "precombatMain";
    game.turn.step = "precombatMain";
    const rhythmDef = createCardDefinition({
      name: "Rhythm",
      typeLine: "Enchantment",
      creatureSpellsCantBeCountered: true,
      staticAbilities: [
        {
          selector: { scope: "controlled", types: ["creature"], nonToken: true },
          effect: { kind: "grant_keyword", keyword: "haste" },
        },
      ],
    });
    const bearDef = createCardDefinition({ name: "Bear", manaCost: "", typeLine: "Creature — Bear", power: 2, toughness: 2 });
    game.definitions[rhythmDef.id] = rhythmDef;
    game.definitions[bearDef.id] = bearDef;
    const rhythm = createCardInstance({ definitionId: rhythmDef.id, ownerId: p1.id, zone: "battlefield" });
    const bear = createCardInstance({ definitionId: bearDef.id, ownerId: p1.id, zone: "hand" });
    game.cards[rhythm.id] = rhythm;
    game.cards[bear.id] = bear;
    p1.zones.battlefield.push(rhythm.id);
    p1.zones.hand.push(bear.id);

    game.priorityPlayerId = p1.id;
    const cast = applyAction(game, {
      kind: "cast_spell",
      playerId: p1.id,
      cardId: bear.id,
      targets: [],
    });
    const spellId = cast.stack[0]!.id;
    const countered = applyEffect(cast, { kind: "counter_spell", stackObjectId: spellId });
    // The counter fizzles: the spell is still on the stack.
    expect(countered.stack).toHaveLength(1);

    let resolved = resolveTopOfStack(countered);
    expect(resolved.cards[bear.id]?.zone).toBe("battlefield");
    expect(hasKeyword(resolved, bear.id, "haste")).toBe(true);
    expect(p2.id).toBeTruthy();
  });
});

describe("wave 94: magecraft and crawlers", () => {
  it("compiles the magecraft pair, Psychosis Crawler, and Aetherize fully", () => {
    const archmage = compileOracleCard({
      oracleId: "archmage",
      name: "Archmage Emeritus",
      manaCost: "{2}{U}{U}",
      typeLine: "Creature — Human Wizard",
      power: "2",
      toughness: "2",
      printedKeywords: [],
      imageUrl: "",
      oracleText: "Magecraft — Whenever you cast or copy an instant or sorcery spell, draw a card.",
    });
    expect(archmage.notes).toEqual([]);
    expect(archmage.definition.triggers[0]?.alsoOnCopy).toBe(true);
    expect(archmage.definition.triggers[0]?.subjectFilter?.typesAny).toEqual([
      "instant",
      "sorcery",
    ]);

    const artist = compileOracleCard({
      oracleId: "artist",
      name: "Storm-Kiln Artist",
      manaCost: "{3}{R}",
      typeLine: "Creature — Dwarf Shaman",
      power: "2",
      toughness: "2",
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "This creature gets +1/+0 for each artifact you control.\nMagecraft — Whenever you cast or copy an instant or sorcery spell, create a Treasure token. (It's an artifact with \"{T}, Sacrifice this token: Add one mana of any color.\")",
    });
    expect(artist.notes).toEqual([]);
    expect(artist.definition.bonusPt).toEqual({
      power: 1,
      toughness: 0,
      per: "artifacts_you_control",
    });

    const crawler = compileOracleCard({
      oracleId: "crawler",
      name: "Psychosis Crawler",
      manaCost: "{5}",
      typeLine: "Artifact Creature — Phyrexian Horror",
      power: "*",
      toughness: "*",
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "Psychosis Crawler's power and toughness are each equal to the number of cards in your hand.\nWhenever you draw a card, each opponent loses 1 life.",
    });
    expect(crawler.notes).toEqual([]);
    expect(crawler.definition.triggers[0]?.event).toBe("you_draw");

    const aetherize = compileOracleCard({
      oracleId: "aetherize",
      name: "Aetherize",
      manaCost: "{3}{U}",
      typeLine: "Instant",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
      oracleText: "Return all attacking creatures to their owner's hand.",
    });
    expect(aetherize.notes).toEqual([]);
    expect(aetherize.definition.effects[0]).toEqual({
      kind: "bounce_each_creature",
      onlyAttacking: true,
    });
  });

  it("fires magecraft on spell copies and scales the artist's power", () => {
    const { game, p1 } = twoPlayers();
    const artistDef = createCardDefinition({
      name: "Artist",
      typeLine: "Creature — Dwarf Shaman",
      power: 2,
      toughness: 2,
      bonusPt: { power: 1, toughness: 0, per: "artifacts_you_control" },
      triggers: [
        {
          event: "cast_spell",
          watch: "controlled",
          alsoOnCopy: true,
          subjectFilter: { typesAny: ["instant", "sorcery"] },
          effects: [
            {
              kind: "create_token",
              ownerId: "controller",
              name: "Treasure",
              typeLine: "Artifact — Treasure Token",
              power: null,
              toughness: null,
            },
          ],
        },
      ],
    });
    const boltDef = createCardDefinition({
      name: "Bolt",
      manaCost: "",
      typeLine: "Instant",
      effects: [{ kind: "gain_life", playerId: "controller", amount: 1 }],
    });
    game.definitions[artistDef.id] = artistDef;
    game.definitions[boltDef.id] = boltDef;
    const artist = createCardInstance({ definitionId: artistDef.id, ownerId: p1.id, zone: "battlefield" });
    const bolt = createCardInstance({ definitionId: boltDef.id, ownerId: p1.id, zone: "hand" });
    game.cards[artist.id] = artist;
    game.cards[bolt.id] = bolt;
    p1.zones.battlefield.push(artist.id);
    p1.zones.hand.push(bolt.id);
    game.turn.phase = "precombatMain";
    game.turn.step = "precombatMain";
    game.priorityPlayerId = p1.id;

    let next = applyAction(game, { kind: "cast_spell", playerId: p1.id, cardId: bolt.id, targets: [] });
    const spellId = next.stack[next.stack.length - 1]!.kind === "spell" ? next.stack[next.stack.length - 1]!.id : next.stack[0]!.id;
    // Copying the spell fires the "or copy" half.
    next = applyEffect(next, { kind: "copy_spell", stackObjectId: spellId, controllerId: p1.id });
    while (next.stack.length > 0) {
      next = resolveTopOfStack(next);
    }
    const treasures = Object.values(next.cards).filter(
      (card) => card.isToken && next.definitions[card.definitionId]?.name === "Treasure",
    );
    // One for the cast, one for the copy.
    expect(treasures).toHaveLength(2);
    // +1/+0 per artifact: two Treasures on the battlefield.
    expect(computedCard(next, artist.id)?.power).toBe(4);
    expect(computedCard(next, artist.id)?.toughness).toBe(2);
  });

  it("bounces only attackers and drains on draws", () => {
    const { game, p1, p2 } = twoPlayers();
    const bearDef = createCardDefinition({ name: "Bear", typeLine: "Creature — Bear", power: 2, toughness: 2 });
    game.definitions[bearDef.id] = bearDef;
    const attacker = createCardInstance({ definitionId: bearDef.id, ownerId: p2.id, zone: "battlefield" });
    const bystander = createCardInstance({ definitionId: bearDef.id, ownerId: p2.id, zone: "battlefield" });
    attacker.attacking = true;
    game.cards[attacker.id] = attacker;
    game.cards[bystander.id] = bystander;
    p2.zones.battlefield.push(attacker.id, bystander.id);

    const bounced = applyEffect(game, { kind: "bounce_each_creature", onlyAttacking: true });
    expect(bounced.cards[attacker.id]?.zone).toBe("hand");
    expect(bounced.cards[bystander.id]?.zone).toBe("battlefield");

    // Psychosis Crawler: the controller's own draw drains each opponent.
    const crawlerDef = createCardDefinition({
      name: "Crawler",
      typeLine: "Artifact Creature — Horror",
      power: 1,
      toughness: 1,
      triggers: [
        {
          event: "you_draw",
          effects: [{ kind: "lose_life", playerId: "each_opponent", amount: 1 }],
        },
      ],
    });
    game.definitions[crawlerDef.id] = crawlerDef;
    const crawler = createCardInstance({ definitionId: crawlerDef.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[crawler.id] = crawler;
    p1.zones.battlefield.push(crawler.id);
    fillLibraries(game, 5);

    let drawn = applyEffect(game, { kind: "draw", playerId: p1.id, count: 1 });
    while (drawn.stack.length > 0) {
      drawn = resolveTopOfStack(drawn);
    }
    expect(drawn.players[1]?.life).toBe(39);
  });
});

describe("wave 95: silence and blasts", () => {
  it("compiles Silence, Red Elemental Blast, and Pyroblast fully", () => {
    const silence = compileOracleCard({
      oracleId: "silence",
      name: "Silence",
      manaCost: "{W}",
      typeLine: "Instant",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
      oracleText: "Your opponents can't cast spells this turn.",
    });
    expect(silence.notes).toEqual([]);
    expect(silence.definition.effects[0]).toEqual({ kind: "silence", playerId: "controller" });

    const blast = compileOracleCard({
      oracleId: "reb",
      name: "Red Elemental Blast",
      manaCost: "{R}",
      typeLine: "Instant",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
      oracleText: "Choose one —\n• Counter target blue spell.\n• Destroy target blue permanent.",
    });
    expect(blast.notes).toEqual([]);
    expect(blast.definition.modes?.[0]?.targetRequirements).toEqual([
      { kind: "spell", requiredColors: ["U"] },
    ]);
    expect(blast.definition.modes?.[1]?.targetRequirements).toEqual([
      { kind: "permanent", requiredColors: ["U"] },
    ]);

    const pyroblast = compileOracleCard({
      oracleId: "pyroblast",
      name: "Pyroblast",
      manaCost: "{R}",
      typeLine: "Instant",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "Choose one —\n• Counter target spell if it's blue.\n• Destroy target permanent if it's blue.",
    });
    expect(pyroblast.notes).toEqual([]);
  });

  it("locks casting for opponents until cleanup after a Silence", () => {
    const { game, p1, p2 } = twoPlayers();
    game.turn.phase = "precombatMain";
    game.turn.step = "precombatMain";
    const boltDef = createCardDefinition({
      name: "Bolt",
      manaCost: "",
      typeLine: "Instant",
      effects: [{ kind: "gain_life", playerId: "controller", amount: 1 }],
    });
    game.definitions[boltDef.id] = boltDef;
    const bolt = createCardInstance({ definitionId: boltDef.id, ownerId: p2.id, zone: "hand" });
    game.cards[bolt.id] = bolt;
    p2.zones.hand.push(bolt.id);

    let next = applyEffect(game, { kind: "silence", playerId: p1.id });
    expect(next.castLockUntilEot).toBe(p1.id);
    next.priorityPlayerId = p2.id;
    expect(() =>
      applyAction(next, { kind: "cast_spell", playerId: p2.id, cardId: bolt.id, targets: [] }),
    ).toThrow(/can't cast spells this turn/);

    // The lock clears at cleanup.
    next.turn.phase = "ending";
    next.turn.step = "end";
    const swept = advanceSteps(next, 1);
    expect(swept.castLockUntilEot).toBeUndefined();
  });

  it("only lets blue targets through required-color filters", () => {
    const { game, p1, p2 } = twoPlayers();
    const blueDef = createCardDefinition({ name: "Blue Bear", manaCost: "{U}", typeLine: "Creature — Bear", power: 2, toughness: 2 });
    const redDef = createCardDefinition({ name: "Red Bear", manaCost: "{R}", typeLine: "Creature — Bear", power: 2, toughness: 2 });
    game.definitions[blueDef.id] = blueDef;
    game.definitions[redDef.id] = redDef;
    const blue = createCardInstance({ definitionId: blueDef.id, ownerId: p2.id, zone: "battlefield" });
    const red = createCardInstance({ definitionId: redDef.id, ownerId: p2.id, zone: "battlefield" });
    game.cards[blue.id] = blue;
    game.cards[red.id] = red;
    p2.zones.battlefield.push(blue.id, red.id);

    const requirement = { kind: "permanent" as const, requiredColors: ["U" as const] };
    expect(
      isChosenTargetLegal(game, requirement, { type: "creature", cardId: blue.id }, p1.id),
    ).toBe(true);
    expect(
      isChosenTargetLegal(game, requirement, { type: "creature", cardId: red.id }, p1.id),
    ).toBe(false);
  });
});

describe("wave 96: bedevils and avengers", () => {
  it("compiles Bedevil, Rakdos Charm, Avenger of Zendikar, and Sram fully", () => {
    const bedevil = compileOracleCard({
      oracleId: "bedevil",
      name: "Bedevil",
      manaCost: "{B}{B}{R}",
      typeLine: "Instant",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
      oracleText: "Destroy target artifact, creature, or planeswalker.",
    });
    expect(bedevil.notes).toEqual([]);
    expect(bedevil.definition.targetRequirements).toEqual([
      { kind: "artifact_creature_or_planeswalker" },
    ]);

    const charm = compileOracleCard({
      oracleId: "rakdos-charm",
      name: "Rakdos Charm",
      manaCost: "{B}{R}",
      typeLine: "Instant",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "Choose one —\n• Exile target player's graveyard.\n• Destroy target artifact.\n• Each creature deals 1 damage to its controller.",
    });
    expect(charm.notes).toEqual([]);
    expect(charm.definition.modes?.[2]?.effects[0]).toEqual({
      kind: "each_creature_damages_controller",
      amount: 1,
    });

    const avenger = compileOracleCard({
      oracleId: "avenger",
      name: "Avenger of Zendikar",
      manaCost: "{5}{G}{G}",
      typeLine: "Creature — Elemental",
      power: "5",
      toughness: "5",
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "When this creature enters, create a 0/1 green Plant creature token for each land you control.\nLandfall — Whenever a land you control enters, you may put a +1/+1 counter on each Plant creature you control.",
    });
    expect(avenger.notes).toEqual([]);
    const plants = avenger.definition.triggers[0]?.effects[0];
    expect(plants?.kind === "create_token" && plants.perControlled).toBe("land");
    const landfall = avenger.definition.triggers[1]?.effects[0];
    expect(landfall?.kind === "counter_on_each_creature" && landfall.subtype).toBe("plant");

    const sram = compileOracleCard({
      oracleId: "sram",
      name: "Sram, Senior Edificer",
      manaCost: "{1}{W}",
      typeLine: "Legendary Creature — Dwarf Advisor",
      power: "2",
      toughness: "2",
      printedKeywords: [],
      imageUrl: "",
      oracleText: "Whenever you cast an Aura, Equipment, or Vehicle spell, draw a card.",
    });
    expect(sram.notes).toEqual([]);
    expect(sram.definition.triggers[0]?.subjectFilter?.subtypesAny).toEqual([
      "aura",
      "equipment",
      "vehicle",
    ]);
  });

  it("pings controllers and buffs only the tribe under one player", () => {
    const { game, p1, p2 } = twoPlayers();
    const plantDef = createCardDefinition({ name: "Plant", typeLine: "Creature — Plant", power: 0, toughness: 1 });
    const bearDef = createCardDefinition({ name: "Bear", typeLine: "Creature — Bear", power: 2, toughness: 2 });
    game.definitions[plantDef.id] = plantDef;
    game.definitions[bearDef.id] = bearDef;
    const myPlant = createCardInstance({ definitionId: plantDef.id, ownerId: p1.id, zone: "battlefield" });
    const theirPlant = createCardInstance({ definitionId: plantDef.id, ownerId: p2.id, zone: "battlefield" });
    const bear = createCardInstance({ definitionId: bearDef.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[myPlant.id] = myPlant;
    game.cards[theirPlant.id] = theirPlant;
    game.cards[bear.id] = bear;
    p1.zones.battlefield.push(myPlant.id, bear.id);
    p2.zones.battlefield.push(theirPlant.id);

    const bound = bindCardEffects(
      game,
      [
        {
          kind: "counter_on_each_creature",
          counter: "p1p1",
          amount: 1,
          subtype: "plant",
          controlledOnly: true,
        },
      ],
      { controllerId: p1.id, sourceId: null },
    );
    const buffed = applyEffects(game, bound);
    expect(buffed.cards[myPlant.id]?.counters["p1p1"]).toBe(1);
    expect(buffed.cards[theirPlant.id]?.counters["p1p1"]).toBeUndefined();
    expect(buffed.cards[bear.id]?.counters["p1p1"]).toBeUndefined();

    const pinged = applyEffect(game, { kind: "each_creature_damages_controller", amount: 1 });
    // p1 controls two creatures, p2 controls one.
    expect(pinged.players[0]?.life).toBe(38);
    expect(pinged.players[1]?.life).toBe(39);
  });
});

describe("wave 97: incubators and growth", () => {
  it("compiles Urza's Incubator, Conjurer's Closet, and Unnatural Growth fully", () => {
    const incubator = compileOracleCard({
      oracleId: "incubator",
      name: "Urza's Incubator",
      manaCost: "{3}",
      typeLine: "Artifact",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "As this artifact enters, choose a creature type.\nCreature spells of the chosen type cost {2} less to cast.",
    });
    expect(incubator.notes).toEqual([]);
    expect(incubator.definition.chooseCreatureTypeOnEnter).toBe(true);
    expect(incubator.definition.costReductions?.[0]).toEqual({
      generic: 2,
      filter: { types: ["creature"], chosenSubtype: true },
    });

    const closet = compileOracleCard({
      oracleId: "closet",
      name: "Conjurer's Closet",
      manaCost: "{5}",
      typeLine: "Artifact",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "At the beginning of your end step, you may exile target creature you control, then return that card to the battlefield under your control.",
    });
    expect(closet.notes).toEqual([]);
    expect(closet.definition.triggers[0]?.event).toBe("end_step");

    const growth = compileOracleCard({
      oracleId: "growth-x",
      name: "Unnatural Growth",
      manaCost: "{1}{G}{G}{G}{G}",
      typeLine: "Enchantment",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "At the beginning of each combat, double the power and toughness of each creature you control until end of turn.",
    });
    expect(growth.notes).toEqual([]);
    expect(growth.definition.triggers[0]?.watch).toBe("any");
    expect(growth.definition.triggers[0]?.effects[0]).toEqual({
      kind: "double_team_pt_until_eot",
      playerId: "controller",
    });
  });

  it("discounts chosen-type creature spells and doubles team stats", () => {
    const { game, p1 } = twoPlayers();
    const incubatorDef = createCardDefinition({
      name: "Incubator",
      typeLine: "Artifact",
      chooseCreatureTypeOnEnter: true,
      costReductions: [{ generic: 2, filter: { types: ["creature"], chosenSubtype: true } }],
    });
    game.definitions[incubatorDef.id] = incubatorDef;
    const incubator = createCardInstance({ definitionId: incubatorDef.id, ownerId: p1.id, zone: "battlefield" });
    incubator.chosenCreatureType = "goblin";
    game.cards[incubator.id] = incubator;
    p1.zones.battlefield.push(incubator.id);

    const goblinSpell = {
      characteristics: { types: ["creature"], subtypes: ["goblin"], colors: ["R"] },
    };
    const elfSpell = {
      characteristics: { types: ["creature"], subtypes: ["elf"], colors: ["G"] },
    };
    expect(castCostReduction(game, p1.id, goblinSpell)).toBe(2);
    expect(castCostReduction(game, p1.id, elfSpell)).toBe(0);

    const bigDef = createCardDefinition({ name: "Big", typeLine: "Creature — Beast", power: 3, toughness: 4 });
    game.definitions[bigDef.id] = bigDef;
    const big = createCardInstance({ definitionId: bigDef.id, ownerId: p1.id, zone: "battlefield" });
    big.counters["p1p1"] = 1;
    game.cards[big.id] = big;
    p1.zones.battlefield.push(big.id);

    const doubled = applyEffect(game, { kind: "double_team_pt_until_eot", playerId: p1.id });
    // 3+1 counters = 4 power computed, doubled to 8; 4+1 = 5 toughness → 10.
    expect(computedCard(doubled, big.id)?.power).toBe(8);
    expect(computedCard(doubled, big.id)?.toughness).toBe(10);
  });
});

describe("wave 98: marauders, ignitions, obedience", () => {
  it("compiles Accursed Marauder, Chandra's Ignition, and Blind Obedience fully", () => {
    const marauder = compileOracleCard({
      oracleId: "marauder",
      name: "Accursed Marauder",
      manaCost: "{1}{B}",
      typeLine: "Creature — Zombie Warrior",
      power: "2",
      toughness: "1",
      printedKeywords: [],
      imageUrl: "",
      oracleText: "When this creature enters, each player sacrifices a nontoken creature of their choice.",
    });
    expect(marauder.notes).toEqual([]);
    const edict = marauder.definition.triggers[0]?.effects[0];
    expect(edict?.kind === "choose_card" && edict.sources[0]?.filter).toBe("nontoken_creature");

    const ignition = compileOracleCard({
      oracleId: "ignition",
      name: "Chandra's Ignition",
      manaCost: "{3}{R}{R}",
      typeLine: "Sorcery",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "Target creature you control deals damage equal to its power to each other creature and each opponent.",
    });
    expect(ignition.notes).toEqual([]);
    expect(ignition.definition.targetRequirements).toEqual([{ kind: "creature", control: "own" }]);

    const obedience = compileOracleCard({
      oracleId: "obedience",
      name: "Blind Obedience",
      manaCost: "{1}{W}",
      typeLine: "Enchantment",
      power: null,
      toughness: null,
      printedKeywords: ["Extort"],
      imageUrl: "",
      oracleText:
        "Extort (Whenever you cast a spell, you may pay {W/B}. If you do, each opponent loses 1 life and you gain that much life.)\nArtifacts and creatures your opponents control enter tapped.",
    });
    expect(obedience.notes).toEqual([]);
    expect(obedience.definition.opponentArtifactsEnterTapped).toBe(true);
    expect(obedience.definition.triggers[0]?.event).toBe("cast_spell");
  });

  it("novas everything but the source and taps arriving opponent artifacts", () => {
    const { game, p1, p2 } = twoPlayers();
    const dragonDef = createCardDefinition({ name: "Dragon", typeLine: "Creature — Dragon", power: 4, toughness: 4 });
    const bearDef = createCardDefinition({ name: "Bear", typeLine: "Creature — Bear", power: 2, toughness: 2 });
    game.definitions[dragonDef.id] = dragonDef;
    game.definitions[bearDef.id] = bearDef;
    const dragon = createCardInstance({ definitionId: dragonDef.id, ownerId: p1.id, zone: "battlefield" });
    const myBear = createCardInstance({ definitionId: bearDef.id, ownerId: p1.id, zone: "battlefield" });
    const theirBear = createCardInstance({ definitionId: bearDef.id, ownerId: p2.id, zone: "battlefield" });
    game.cards[dragon.id] = dragon;
    game.cards[myBear.id] = myBear;
    game.cards[theirBear.id] = theirBear;
    p1.zones.battlefield.push(dragon.id, myBear.id);
    p2.zones.battlefield.push(theirBear.id);

    const bound = bindCardEffects(
      game,
      [{ kind: "power_nova", cardId: { type: "chosen", index: 0 } }],
      {
        controllerId: p1.id,
        sourceId: null,
        targets: [{ type: "creature", cardId: dragon.id }],
        targetRequirements: [{ kind: "creature", control: "own" }],
      },
    );
    const nova = applyEffects(game, bound);
    // Both bears die to 4 damage; the dragon is untouched; p2 takes 4.
    expect(nova.cards[dragon.id]?.zone).toBe("battlefield");
    expect(nova.cards[myBear.id]?.zone).toBe("graveyard");
    expect(nova.cards[theirBear.id]?.zone).toBe("graveyard");
    expect(nova.players[1]?.life).toBe(36);
    expect(nova.players[0]?.life).toBe(40);

    // Blind Obedience taps an opponent's arriving artifact.
    const obedienceDef = createCardDefinition({
      name: "Obedience",
      typeLine: "Enchantment",
      opponentArtifactsEnterTapped: true,
    });
    const rockDef = createCardDefinition({ name: "Rock", typeLine: "Artifact" });
    game.definitions[obedienceDef.id] = obedienceDef;
    game.definitions[rockDef.id] = rockDef;
    const obedience = createCardInstance({ definitionId: obedienceDef.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[obedience.id] = obedience;
    p1.zones.battlefield.push(obedience.id);
    const rock = createCardInstance({ definitionId: rockDef.id, ownerId: p2.id, zone: "hand" });
    game.cards[rock.id] = rock;
    p2.zones.hand.push(rock.id);
    const arrived = moveCard(game, rock.id, "battlefield");
    expect(arrived.cards[rock.id]?.tapped).toBe(true);
  });
});

describe("wave 99: sentinels and moxen", () => {
  it("compiles Esper Sentinel and Mox Opal fully", () => {
    const sentinel = compileOracleCard({
      oracleId: "sentinel",
      name: "Esper Sentinel",
      manaCost: "{W}",
      typeLine: "Artifact Creature — Human Soldier",
      power: "1",
      toughness: "1",
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "Whenever an opponent casts their first noncreature spell each turn, draw a card unless that player pays {X}, where X is this creature's power.",
    });
    expect(sentinel.notes).toEqual([]);
    expect(sentinel.definition.triggers[0]?.event).toBe(
      "opponent_casts_first_noncreature_spell",
    );
    const tax = sentinel.definition.triggers[0]?.effects[0];
    expect(tax?.kind === "unless_pays" && tax.costFromPower).toBe(true);

    const opal = compileOracleCard({
      oracleId: "opal",
      name: "Mox Opal",
      manaCost: "{0}",
      typeLine: "Legendary Artifact",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "Metalcraft — {T}: Add one mana of any color. Activate only if you control three or more artifacts.",
    });
    expect(opal.notes).toEqual([]);
    expect(opal.definition.manaAbilities[0]?.requiresCount).toEqual({
      what: "artifact",
      atLeast: 3,
    });
  });

  it("taxes the first noncreature cast by the sentinel's power", () => {
    const { game, p1, p2 } = twoPlayers();
    game.turn.phase = "precombatMain";
    game.turn.step = "precombatMain";
    game.turn.activePlayerId = p2.id;
    const sentinelDef = createCardDefinition({
      name: "Sentinel",
      typeLine: "Artifact Creature — Human Soldier",
      power: 1,
      toughness: 1,
      triggers: [
        {
          event: "opponent_casts_first_noncreature_spell",
          effects: [
            {
              kind: "unless_pays",
              playerId: { type: "subject_player" },
              cost: "{1}",
              costFromPower: true,
              effects: [{ kind: "draw", playerId: "controller", count: 1 }],
            },
          ],
        },
      ],
    });
    const boltDef = createCardDefinition({
      name: "Bolt",
      manaCost: "",
      typeLine: "Instant",
      effects: [{ kind: "gain_life", playerId: "controller", amount: 1 }],
    });
    game.definitions[sentinelDef.id] = sentinelDef;
    game.definitions[boltDef.id] = boltDef;
    const sentinel = createCardInstance({ definitionId: sentinelDef.id, ownerId: p1.id, zone: "battlefield" });
    sentinel.counters["p1p1"] = 2;
    const bolt = createCardInstance({ definitionId: boltDef.id, ownerId: p2.id, zone: "hand" });
    game.cards[sentinel.id] = sentinel;
    game.cards[bolt.id] = bolt;
    p1.zones.battlefield.push(sentinel.id);
    p2.zones.hand.push(bolt.id);
    fillLibraries(game, 5);

    game.priorityPlayerId = p2.id;
    let next = applyAction(game, { kind: "cast_spell", playerId: p2.id, cardId: bolt.id, targets: [] });
    while (next.stack.length > 0 && next.prompts.length === 0) {
      next = resolveTopOfStack(next);
    }
    // The tax prompt reads power 3 (1 base + 2 counters).
    const prompt = next.prompts[0];
    expect(prompt?.kind).toBe("pay_or_effect");
    expect(prompt?.kind === "pay_or_effect" && prompt.cost).toBe("{3}");
  });

  it("gates Mox Opal's mana on metalcraft", () => {
    const { game, p1 } = twoPlayers();
    const opalDef = createCardDefinition({
      name: "Opal",
      typeLine: "Legendary Artifact",
      manaAbilities: [
        {
          produces: {},
          producesOptions: [],
          producesAnyColor: true,
          damageToController: 0,
          requiresCount: { what: "artifact", atLeast: 3 },
        },
      ],
    });
    const rockDef = createCardDefinition({ name: "Rock", typeLine: "Artifact" });
    game.definitions[opalDef.id] = opalDef;
    game.definitions[rockDef.id] = rockDef;
    const opal = createCardInstance({ definitionId: opalDef.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[opal.id] = opal;
    p1.zones.battlefield.push(opal.id);

    expect(manaAbilitiesFor(game, opal.id)).toHaveLength(0);
    for (let index = 0; index < 2; index += 1) {
      const rock = createCardInstance({ definitionId: rockDef.id, ownerId: p1.id, zone: "battlefield" });
      game.cards[rock.id] = rock;
      p1.zones.battlefield.push(rock.id);
    }
    // Opal + two rocks = three artifacts: the gate opens.
    expect(manaAbilitiesFor(game, opal.id)).toHaveLength(1);
  });
});

describe("wave 100: deflecting swat", () => {
  it("compiles Deflecting Swat fully", () => {
    const swat = compileOracleCard({
      oracleId: "swat",
      name: "Deflecting Swat",
      manaCost: "{2}{R}",
      typeLine: "Instant",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "If you control a commander, you may cast this spell without paying its mana cost.\nYou may choose new targets for target spell or ability.",
    });
    expect(swat.notes).toEqual([]);
    expect(swat.definition.freeIfCommander).toBe(true);
    expect(swat.definition.targetRequirements).toEqual([{ kind: "spell" }]);
    expect(swat.definition.effects[0]).toEqual({
      kind: "retarget",
      target: { type: "chosen", index: 0 },
    });
  });

  it("retargets a spell on the stack through the prompt", () => {
    const { game, p1, p2 } = twoPlayers();
    game.turn.phase = "precombatMain";
    game.turn.step = "precombatMain";
    const boltDef = createCardDefinition({
      name: "Bolt",
      manaCost: "",
      typeLine: "Instant",
      targetRequirements: [{ kind: "creature" }],
      effects: [
        {
          kind: "deal_damage",
          sourceId: "self",
          target: { type: "chosen", index: 0 },
          amount: 3,
        },
      ],
    });
    const bearDef = createCardDefinition({ name: "Bear", typeLine: "Creature — Bear", power: 2, toughness: 2 });
    game.definitions[boltDef.id] = boltDef;
    game.definitions[bearDef.id] = bearDef;
    const bolt = createCardInstance({ definitionId: boltDef.id, ownerId: p2.id, zone: "hand" });
    const myBear = createCardInstance({ definitionId: bearDef.id, ownerId: p1.id, zone: "battlefield" });
    const theirBear = createCardInstance({ definitionId: bearDef.id, ownerId: p2.id, zone: "battlefield" });
    game.cards[bolt.id] = bolt;
    game.cards[myBear.id] = myBear;
    game.cards[theirBear.id] = theirBear;
    p2.zones.hand.push(bolt.id);
    p1.zones.battlefield.push(myBear.id);
    p2.zones.battlefield.push(theirBear.id);

    // p2 bolts p1's bear; p1 retargets it at p2's own bear.
    game.turn.activePlayerId = p2.id;
    game.priorityPlayerId = p2.id;
    let next = applyAction(game, {
      kind: "cast_spell",
      playerId: p2.id,
      cardId: bolt.id,
      targets: [{ type: "creature", cardId: myBear.id }],
    });
    const spellId = next.stack[0]!.id;
    next = applyEffects(next, [
      { kind: "retarget", stackObjectId: spellId, controllerId: p1.id },
    ]);
    expect(next.prompts[0]?.kind).toBe("choose_targets");
    next = applyAction(next, {
      kind: "choose_targets",
      playerId: p1.id,
      targets: [{ type: "creature", cardId: theirBear.id }],
    });
    next = resolveTopOfStack(next);
    expect(next.cards[theirBear.id]?.zone).toBe("graveyard");
    expect(next.cards[myBear.id]?.zone).toBe("battlefield");
  });
});

describe("wave 101: wurms, bonds, dark realms", () => {
  it("compiles Massacre Wurm, Elemental Bond, and Rise of the Dark Realms fully", () => {
    const wurm = compileOracleCard({
      oracleId: "wurm",
      name: "Massacre Wurm",
      manaCost: "{3}{B}{B}{B}",
      typeLine: "Creature — Phyrexian Wurm",
      power: "6",
      toughness: "5",
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "When this creature enters, creatures your opponents control get -2/-2 until end of turn.\nWhenever a creature an opponent controls dies, that player loses 2 life.",
    });
    expect(wurm.notes).toEqual([]);
    expect(wurm.definition.triggers[0]?.effects[0]).toEqual({
      kind: "team_pt_until_eot",
      playerId: "each_opponent",
      power: -2,
      toughness: -2,
    });
    expect(wurm.definition.triggers[1]?.watch).toBe("opponents");

    const bond = compileOracleCard({
      oracleId: "bond",
      name: "Elemental Bond",
      manaCost: "{2}{G}",
      typeLine: "Enchantment",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
      oracleText: "Whenever a creature you control with power 3 or greater enters, draw a card.",
    });
    expect(bond.notes).toEqual([]);
    expect(bond.definition.triggers[0]?.subjectFilter?.minPower).toBe(3);

    const rise = compileOracleCard({
      oracleId: "rise",
      name: "Rise of the Dark Realms",
      manaCost: "{7}{B}{B}",
      typeLine: "Sorcery",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
      oracleText: "Put all creature cards from all graveyards onto the battlefield under your control.",
    });
    expect(rise.notes).toEqual([]);
    expect(rise.definition.effects[0]).toEqual({ kind: "mass_reanimate", playerId: "controller" });
  });

  it("debuffs only opponents' creatures and mass-reanimates under the caster", () => {
    const { game, p1, p2 } = twoPlayers();
    const bearDef = createCardDefinition({ name: "Bear", typeLine: "Creature — Bear", power: 2, toughness: 2 });
    game.definitions[bearDef.id] = bearDef;
    const myBear = createCardInstance({ definitionId: bearDef.id, ownerId: p1.id, zone: "battlefield" });
    const theirBear = createCardInstance({ definitionId: bearDef.id, ownerId: p2.id, zone: "battlefield" });
    game.cards[myBear.id] = myBear;
    game.cards[theirBear.id] = theirBear;
    p1.zones.battlefield.push(myBear.id);
    p2.zones.battlefield.push(theirBear.id);

    const bound = bindCardEffects(
      game,
      [{ kind: "team_pt_until_eot", playerId: "each_opponent", power: -2, toughness: -2 }],
      { controllerId: p1.id, sourceId: null },
    );
    const swept = applyEffects(game, bound);
    // The opponent's 2/2 dies to -2/-2; the caster's survives untouched.
    expect(swept.cards[theirBear.id]?.zone).toBe("graveyard");
    expect(swept.cards[myBear.id]?.zone).toBe("battlefield");
    expect(computedCard(swept, myBear.id)?.power).toBe(2);

    // Rise: both graveyard creatures arrive under p1.
    const mine = createCardInstance({ definitionId: bearDef.id, ownerId: p1.id, zone: "graveyard" });
    game.cards[mine.id] = mine;
    p1.zones.graveyard.push(mine.id);
    const theirs = createCardInstance({ definitionId: bearDef.id, ownerId: p2.id, zone: "graveyard" });
    game.cards[theirs.id] = theirs;
    p2.zones.graveyard.push(theirs.id);
    const risen = applyEffect(game, { kind: "mass_reanimate", playerId: p1.id });
    expect(risen.cards[mine.id]?.zone).toBe("battlefield");
    expect(risen.cards[theirs.id]?.zone).toBe("battlefield");
    expect(risen.cards[theirs.id]?.controllerId).toBe(p1.id);
  });

  it("only fires the bond for big arrivals", () => {
    const { game, p1 } = twoPlayers();
    const bondDef = createCardDefinition({
      name: "Bond",
      typeLine: "Enchantment",
      triggers: [
        {
          event: "enter_battlefield",
          watch: "controlled",
          subjectFilter: { types: ["creature"], minPower: 3 },
          effects: [{ kind: "draw", playerId: "controller", count: 1 }],
        },
      ],
    });
    const smallDef = createCardDefinition({ name: "Small", typeLine: "Creature — Goblin", power: 2, toughness: 2 });
    const bigDef = createCardDefinition({ name: "Big", typeLine: "Creature — Beast", power: 4, toughness: 4 });
    game.definitions[bondDef.id] = bondDef;
    game.definitions[smallDef.id] = smallDef;
    game.definitions[bigDef.id] = bigDef;
    const bond = createCardInstance({ definitionId: bondDef.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[bond.id] = bond;
    p1.zones.battlefield.push(bond.id);
    fillLibraries(game, 10);

    const small = createCardInstance({ definitionId: smallDef.id, ownerId: p1.id, zone: "hand" });
    game.cards[small.id] = small;
    p1.zones.hand.push(small.id);
    const handBefore = p1.zones.hand.length - 1;
    let next = moveCard(game, small.id, "battlefield");
    while (next.stack.length > 0) {
      next = resolveTopOfStack(next);
    }
    expect(next.players[0]?.zones.hand).toHaveLength(handBefore);

    const big = createCardInstance({ definitionId: bigDef.id, ownerId: p1.id, zone: "hand" });
    next.cards[big.id] = big;
    next.players[0]!.zones.hand.push(big.id);
    const handMid = next.players[0]!.zones.hand.length - 1;
    let after = moveCard(next, big.id, "battlefield");
    while (after.stack.length > 0) {
      after = resolveTopOfStack(after);
    }
    expect(after.players[0]?.zones.hand).toHaveLength(handMid + 1);
  });
});

describe("wave 102: clocks, anarchists, ascensions", () => {
  it("compiles the quartet fully", () => {
    const clock = compileOracleCard({
      oracleId: "clock",
      name: "Unwinding Clock",
      manaCost: "{4}",
      typeLine: "Artifact",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
      oracleText: "Untap all artifacts you control during each other player's untap step.",
    });
    expect(clock.notes).toEqual([]);
    expect(clock.definition.untapDuringEachUntap).toBe("artifacts");

    const anarchomancer = compileOracleCard({
      oracleId: "anarchomancer",
      name: "Goblin Anarchomancer",
      manaCost: "{R}{G}",
      typeLine: "Creature — Goblin Shaman",
      power: "2",
      toughness: "2",
      printedKeywords: [],
      imageUrl: "",
      oracleText: "Each spell you cast that's red or green costs {1} less to cast.",
    });
    expect(anarchomancer.notes).toEqual([]);
    expect(anarchomancer.definition.costReductions?.[0]).toEqual({
      generic: 1,
      filter: { colors: ["R", "G"] },
    });

    const ascension = compileOracleCard({
      oracleId: "ascension",
      name: "Beastmaster Ascension",
      manaCost: "{2}{G}",
      typeLine: "Enchantment",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "Whenever a creature you control attacks, you may put a quest counter on this enchantment.\nAs long as this enchantment has seven or more quest counters on it, creatures you control get +5/+5.",
    });
    expect(ascension.notes).toEqual([]);
    expect(ascension.definition.staticAbilities[0]?.requiresCounters).toEqual({
      counter: "quest",
      atLeast: 7,
    });

    const apprentice = compileOracleCard({
      oracleId: "apprentice",
      name: "Marionette Apprentice",
      manaCost: "{1}{B}",
      typeLine: "Creature — Human Artificer",
      power: "1",
      toughness: "2",
      printedKeywords: ["Fabricate 1"],
      imageUrl: "",
      oracleText:
        "Fabricate 1 (When this creature enters, put a +1/+1 counter on it or create a 1/1 colorless Servo artifact creature token.)\nWhenever another creature or artifact you control is put into a graveyard from the battlefield, each opponent loses 1 life.",
    });
    expect(apprentice.notes).toEqual([]);
    expect(apprentice.definition.triggers.map((trigger) => trigger.event)).toEqual([
      "enter_battlefield",
      "dies",
    ]);
    expect(apprentice.definition.triggers[1]?.subjectFilter?.typesAny).toEqual([
      "creature",
      "artifact",
    ]);
  });

  it("only turns the anthem on past the counter threshold", () => {
    const { game, p1 } = twoPlayers();
    const ascensionDef = createCardDefinition({
      name: "Ascension",
      typeLine: "Enchantment",
      staticAbilities: [
        {
          selector: { scope: "controlled", types: ["creature"] },
          effect: { kind: "modify_pt", power: 5, toughness: 5 },
          requiresCounters: { counter: "quest", atLeast: 7 },
        },
      ],
    });
    const bearDef = createCardDefinition({ name: "Bear", typeLine: "Creature — Bear", power: 2, toughness: 2 });
    game.definitions[ascensionDef.id] = ascensionDef;
    game.definitions[bearDef.id] = bearDef;
    const ascension = createCardInstance({ definitionId: ascensionDef.id, ownerId: p1.id, zone: "battlefield" });
    const bear = createCardInstance({ definitionId: bearDef.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[ascension.id] = ascension;
    game.cards[bear.id] = bear;
    p1.zones.battlefield.push(ascension.id, bear.id);

    ascension.counters["quest"] = 6;
    expect(computedCard(game, bear.id)?.power).toBe(2);
    ascension.counters["quest"] = 7;
    expect(computedCard(game, bear.id)?.power).toBe(7);
  });
});

describe("wave 103: mobilize and soultraders", () => {
  it("compiles Voice of Victory and Warren Soultrader fully", () => {
    const voice = compileOracleCard({
      oracleId: "voice",
      name: "Voice of Victory",
      manaCost: "{1}{W}",
      typeLine: "Creature — Human Bard",
      power: "2",
      toughness: "2",
      printedKeywords: ["Mobilize 2"],
      imageUrl: "",
      oracleText:
        "Mobilize 2 (Whenever this creature attacks, create two tapped and attacking 1/1 red Warrior creature tokens. Sacrifice them at the beginning of the next end step.)\nYour opponents can't cast spells during your turn.",
    });
    expect(voice.notes).toEqual([]);
    expect(voice.definition.opponentsCantCastDuringYourTurn).toBe(true);
    expect(voice.definition.triggers[0]?.event).toBe("attacks");
    expect(voice.definition.triggers[0]?.effects).toHaveLength(2);
    const warrior = voice.definition.triggers[0]?.effects[0];
    expect(warrior?.kind === "create_token" && warrior.atEndStep).toBe("sacrifice");

    const soultrader = compileOracleCard({
      oracleId: "soultrader",
      name: "Warren Soultrader",
      manaCost: "{2}{B}",
      typeLine: "Creature — Goblin Zombie",
      power: "3",
      toughness: "2",
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "Pay 1 life, Sacrifice another creature: Create a Treasure token. (It's an artifact with \"{T}, Sacrifice this token: Add one mana of any color.\")",
    });
    expect(soultrader.notes).toEqual([]);
    expect(soultrader.definition.activated[0]?.sacrificeCost).toBe("another_creature");
    expect(soultrader.definition.activated[0]?.lifeCost).toBe(1);
  });

  it("locks opponents out of casting only, and mobilize tokens sac at end step", () => {
    const { game, p1, p2 } = twoPlayers();
    game.turn.phase = "precombatMain";
    game.turn.step = "precombatMain";
    const voiceDef = createCardDefinition({
      name: "Voice",
      typeLine: "Creature — Human Bard",
      power: 2,
      toughness: 2,
      opponentsCantCastDuringYourTurn: true,
    });
    const boltDef = createCardDefinition({
      name: "Bolt",
      manaCost: "",
      typeLine: "Instant",
      effects: [{ kind: "gain_life", playerId: "controller", amount: 1 }],
    });
    game.definitions[voiceDef.id] = voiceDef;
    game.definitions[boltDef.id] = boltDef;
    const voice = createCardInstance({ definitionId: voiceDef.id, ownerId: p1.id, zone: "battlefield" });
    const bolt = createCardInstance({ definitionId: boltDef.id, ownerId: p2.id, zone: "hand" });
    game.cards[voice.id] = voice;
    game.cards[bolt.id] = bolt;
    p1.zones.battlefield.push(voice.id);
    p2.zones.hand.push(bolt.id);

    game.priorityPlayerId = p2.id;
    expect(() =>
      applyAction(game, { kind: "cast_spell", playerId: p2.id, cardId: bolt.id, targets: [] }),
    ).toThrow(/stops you from casting/);

    // Mobilize: a token with end-step cleanup queued.
    const made = applyEffect(game, {
      kind: "create_token",
      ownerId: p1.id,
      name: "Warrior",
      typeLine: "Creature — Warrior Token",
      power: 1,
      toughness: 1,
      atEndStep: "sacrifice",
    });
    const tokenId = made.players[0]!.zones.battlefield.find(
      (id) => made.cards[id]?.isToken,
    );
    expect(tokenId).toBeTruthy();
    expect(made.delayedEndStep.some((entry) => entry.cardId === tokenId)).toBe(true);
  });

  it("refuses the soultrader's own body as its sacrifice fodder", () => {
    const { game, p1 } = twoPlayers();
    const traderDef = createCardDefinition({
      name: "Trader",
      typeLine: "Creature — Goblin Zombie",
      power: 3,
      toughness: 2,
      activated: [
        {
          tap: false,
          manaCost: "",
          lifeCost: 1,
          sacrificeCost: "another_creature",
          effects: [
            {
              kind: "create_token",
              ownerId: "controller",
              name: "Treasure",
              typeLine: "Artifact — Treasure Token",
              power: null,
              toughness: null,
            },
          ],
          targetRequirements: [],
        },
      ],
    });
    const bearDef = createCardDefinition({ name: "Bear", typeLine: "Creature — Bear", power: 2, toughness: 2 });
    game.definitions[traderDef.id] = traderDef;
    game.definitions[bearDef.id] = bearDef;
    const trader = createCardInstance({ definitionId: traderDef.id, ownerId: p1.id, zone: "battlefield" });
    const bear = createCardInstance({ definitionId: bearDef.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[trader.id] = trader;
    game.cards[bear.id] = bear;
    p1.zones.battlefield.push(trader.id, bear.id);
    game.priorityPlayerId = p1.id;

    expect(() =>
      applyAction(game, {
        kind: "activate_ability",
        playerId: p1.id,
        cardId: trader.id,
        abilityIndex: 0,
        costSacrificeId: trader.id,
      }),
    ).toThrow(/another creature/);

    const activated = applyAction(game, {
      kind: "activate_ability",
      playerId: p1.id,
      cardId: trader.id,
      abilityIndex: 0,
      costSacrificeId: bear.id,
    });
    expect(activated.cards[bear.id]?.zone).toBe("graveyard");
    expect(activated.players[0]?.life).toBe(39);
  });
});

describe("wave 104: maniacs and mazes", () => {
  it("compiles Laboratory Maniac and Maze of Ith fully", () => {
    const maniac = compileOracleCard({
      oracleId: "maniac",
      name: "Laboratory Maniac",
      manaCost: "{2}{U}",
      typeLine: "Creature — Human Wizard",
      power: "2",
      toughness: "2",
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "If you would draw a card while your library has no cards in it, you win the game instead.",
    });
    expect(maniac.notes).toEqual([]);
    expect(maniac.definition.replacements[0]).toEqual({ kind: "empty_draw_wins" });

    const maze = compileOracleCard({
      oracleId: "maze",
      name: "Maze of Ith",
      manaCost: "",
      typeLine: "Land",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "{T}: Untap target attacking creature. Prevent all combat damage that would be dealt to and dealt by that creature this turn.",
    });
    expect(maze.notes).toEqual([]);
    expect(maze.definition.activated[0]?.targetRequirements).toEqual([
      { kind: "creature", attackingOnly: true },
    ]);
    expect(maze.definition.activated[0]?.effects).toHaveLength(2);
  });

  it("wins on the empty draw with the maniac out", () => {
    const { game, p1 } = twoPlayers();
    const maniacDef = createCardDefinition({
      name: "Maniac",
      typeLine: "Creature — Human Wizard",
      power: 2,
      toughness: 2,
      replacements: [{ kind: "empty_draw_wins" }],
    });
    game.definitions[maniacDef.id] = maniacDef;
    const maniac = createCardInstance({ definitionId: maniacDef.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[maniac.id] = maniac;
    p1.zones.battlefield.push(maniac.id);
    // Empty library: the draw becomes a win.
    const drawn = applyEffect(game, { kind: "draw", playerId: p1.id, count: 1 });
    expect(drawn.winnerId).toBe(p1.id);
  });

  it("shields a mazed attacker from dealing and taking combat damage", () => {
    const { game, p1, p2 } = twoPlayers();
    const bigDef = createCardDefinition({ name: "Big", typeLine: "Creature — Beast", power: 4, toughness: 4 });
    const bearDef = createCardDefinition({ name: "Bear", typeLine: "Creature — Bear", power: 2, toughness: 2 });
    game.definitions[bigDef.id] = bigDef;
    game.definitions[bearDef.id] = bearDef;
    const attacker = createCardInstance({ definitionId: bigDef.id, ownerId: p2.id, zone: "battlefield" });
    const blocker = createCardInstance({ definitionId: bearDef.id, ownerId: p1.id, zone: "battlefield" });
    attacker.attacking = true;
    game.cards[attacker.id] = attacker;
    game.cards[blocker.id] = blocker;
    p2.zones.battlefield.push(attacker.id);
    p1.zones.battlefield.push(blocker.id);
    game.combat = {
      attacks: [{ attackerId: attacker.id, defenderId: p1.id }],
      blockers: { [attacker.id]: [blocker.id] },
      attackersDeclared: true,
      declaredBlockersFor: [],
    };

    const shieldedState = applyEffects(game, [
      { kind: "prevent_combat_for", cardId: attacker.id },
    ]);
    const fought = applyCombatDamage(shieldedState);
    // Neither side takes damage: the 4/4 was shielded both ways.
    expect(fought.cards[blocker.id]?.zone).toBe("battlefield");
    expect(fought.cards[blocker.id]?.damageMarked ?? 0).toBe(0);
    expect(fought.cards[attacker.id]?.damageMarked ?? 0).toBe(0);
  });
});

describe("wave 105: plowshares and clamps", () => {
  it("compiles the eight-card batch fully", () => {
    const compile = (name: string, typeLine: string, oracleText: string, manaCost = "{1}") =>
      compileOracleCard({
        oracleId: name,
        name,
        manaCost,
        typeLine,
        power: typeLine.includes("Creature") ? "2" : null,
        toughness: typeLine.includes("Creature") ? "2" : null,
        printedKeywords: [],
        imageUrl: "",
        oracleText,
      });

    const swords = compile(
      "Swords to Plowshares",
      "Instant",
      "Exile target creature. Its controller gains life equal to its power.",
      "{W}",
    );
    expect(swords.notes).toEqual([]);

    const clamp = compile(
      "Skullclamp",
      "Artifact — Equipment",
      "Equipped creature gets +1/-1.\nWhenever equipped creature dies, draw two cards.\nEquip {1}",
    );
    expect(clamp.notes).toEqual([]);
    expect(clamp.definition.triggers[0]?.watch).toBe("attached");

    const greaves = compile(
      "Lightning Greaves",
      "Artifact — Equipment",
      "Equipped creature has haste and shroud.\nEquip {0}",
    );
    expect(greaves.notes).toEqual([]);
    expect(greaves.definition.staticAbilities).toHaveLength(2);

    const explore = compile(
      "Explore",
      "Sorcery",
      "You may play an additional land this turn.\nDraw a card.",
      "{1}{G}",
    );
    expect(explore.notes).toEqual([]);
    expect(explore.definition.effects[0]).toEqual({
      kind: "extra_land_drop",
      playerId: "controller",
    });

    const uprising = compile(
      "Garruk's Uprising",
      "Enchantment",
      "When this enchantment enters, if you control a creature with power 4 or greater, draw a card.\nWhenever a creature you control with power 4 or greater enters, draw a card.",
      "{2}{G}",
    );
    expect(uprising.notes).toEqual([]);
    expect(uprising.definition.triggers[0]?.condition).toEqual({
      kind: "controls_power_at_least",
      power: 4,
    });
  });

  it("pays the plowshared creature's controller and clamps draw on death", () => {
    const { game, p1, p2 } = twoPlayers();
    const bigDef = createCardDefinition({ name: "Big", typeLine: "Creature — Beast", power: 5, toughness: 5 });
    game.definitions[bigDef.id] = bigDef;
    const big = createCardInstance({ definitionId: bigDef.id, ownerId: p2.id, zone: "battlefield" });
    game.cards[big.id] = big;
    p2.zones.battlefield.push(big.id);

    const bound = bindCardEffects(
      game,
      [
        { kind: "move_card", cardId: { type: "chosen", index: 0 }, toZone: "exile" },
        {
          kind: "gain_life",
          playerId: { type: "chosen_controller", index: 0 },
          amount: "target_power",
        },
      ],
      {
        controllerId: p1.id,
        sourceId: null,
        targets: [{ type: "creature", cardId: big.id }],
        targetRequirements: [{ kind: "creature" }],
      },
    );
    const exiled = applyEffects(game, bound);
    expect(exiled.cards[big.id]?.zone).toBe("exile");
    expect(exiled.players[1]?.life).toBe(45);

    // Skullclamp: the equipment sees its host die even though it detaches.
    const clampDef = createCardDefinition({
      name: "Clamp",
      typeLine: "Artifact — Equipment",
      triggers: [
        {
          event: "dies",
          watch: "attached",
          effects: [{ kind: "draw", playerId: "controller", count: 2 }],
        },
      ],
    });
    const bearDef = createCardDefinition({ name: "Bear", typeLine: "Creature — Bear", power: 2, toughness: 2 });
    game.definitions[clampDef.id] = clampDef;
    game.definitions[bearDef.id] = bearDef;
    const clamp = createCardInstance({ definitionId: clampDef.id, ownerId: p1.id, zone: "battlefield" });
    const bear = createCardInstance({ definitionId: bearDef.id, ownerId: p1.id, zone: "battlefield" });
    clamp.attachedTo = bear.id;
    game.cards[clamp.id] = clamp;
    game.cards[bear.id] = bear;
    p1.zones.battlefield.push(clamp.id, bear.id);
    fillLibraries(game, 10);

    const handBefore = p1.zones.hand.length;
    let next = moveCard(game, bear.id, "graveyard");
    while (next.stack.length > 0) {
      next = resolveTopOfStack(next);
    }
    expect(next.players[0]?.zones.hand).toHaveLength(handBefore + 2);
  });

  it("grants a one-shot extra land drop that expires with the turn", () => {
    const { game, p1 } = twoPlayers();
    expect(landDropAllowance(game, p1.id)).toBe(1);
    const granted = applyEffect(game, { kind: "extra_land_drop", playerId: p1.id });
    expect(landDropAllowance(granted, p1.id)).toBe(2);
  });
});

describe("wave 106: beacons and brass", () => {
  it("compiles the six-card batch fully", () => {
    const compile = (name: string, typeLine: string, oracleText: string, manaCost = "") =>
      compileOracleCard({
        oracleId: name,
        name,
        manaCost,
        typeLine,
        power: null,
        toughness: null,
        printedKeywords: [],
        imageUrl: "",
        oracleText,
      });

    const path = compile(
      "Path to Exile",
      "Instant",
      "Exile target creature. Its controller may search their library for a basic land card, put that card onto the battlefield tapped, then shuffle.",
      "{W}",
    );
    expect(path.notes).toEqual([]);
    const consolation = path.definition.effects[1];
    expect(consolation?.kind === "search_library" && consolation.entersTapped).toBe(true);

    const brass = compile(
      "City of Brass",
      "Land",
      "Whenever this land becomes tapped, it deals 1 damage to you.\n{T}: Add one mana of any color.",
    );
    expect(brass.notes).toEqual([]);
    expect(brass.definition.triggers[0]?.event).toBe("becomes_tapped");

    const beacon = compile(
      "Command Beacon",
      "Land",
      "{T}: Add {C}.\n{T}, Sacrifice this land: Put your commander into your hand from the command zone.",
    );
    expect(beacon.notes).toEqual([]);

    const ruin = compile(
      "Buried Ruin",
      "Land",
      "{T}: Add {C}.\n{2}, {T}, Sacrifice this land: Return target artifact card from your graveyard to your hand.",
    );
    expect(ruin.notes).toEqual([]);

    const coat = compile(
      "Mithril Coat",
      "Legendary Artifact — Equipment",
      "Flash\nIndestructible\nWhen Mithril Coat enters, attach it to target legendary creature you control.\nEquipped creature has indestructible.\nEquip {3}",
      "{3}",
    );
    expect(coat.notes).toEqual([]);
    expect(coat.definition.triggers[0]?.targetRequirements).toEqual([
      { kind: "creature", control: "own", legendaryOnly: true },
    ]);

    const sword = compile(
      "Sword of the Animist",
      "Legendary Artifact — Equipment",
      "Equipped creature gets +1/+1.\nWhenever equipped creature attacks, you may search your library for a basic land card, put it onto the battlefield tapped, then shuffle.\nEquip {2}",
      "{2}",
    );
    expect(sword.notes).toEqual([]);
    expect(sword.definition.triggers[0]?.watch).toBe("attached");
  });

  it("pings the controller when City of Brass taps for mana", () => {
    const { game, p1 } = twoPlayers();
    const brassDef = createCardDefinition({
      name: "Brass",
      typeLine: "Land",
      producesAnyColor: true,
      triggers: [
        {
          event: "becomes_tapped",
          effects: [
            {
              kind: "deal_damage",
              sourceId: "self",
              target: { type: "player", playerId: "controller" },
              amount: 1,
            },
          ],
        },
      ],
    });
    game.definitions[brassDef.id] = brassDef;
    const brass = createCardInstance({ definitionId: brassDef.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[brass.id] = brass;
    p1.zones.battlefield.push(brass.id);
    game.priorityPlayerId = p1.id;

    let next = applyAction(game, {
      kind: "tap_for_mana",
      playerId: p1.id,
      cardId: brass.id,
      color: "R",
    });
    while (next.stack.length > 0) {
      next = resolveTopOfStack(next);
    }
    expect(next.players[0]?.mana.R).toBe(1);
    expect(next.players[0]?.life).toBe(39);
  });

  it("returns the commander to hand from the command zone", () => {
    const { game, p1 } = twoPlayers();
    const generalDef = createCardDefinition({
      name: "General",
      typeLine: "Legendary Creature — Human Soldier",
      power: 2,
      toughness: 2,
    });
    game.definitions[generalDef.id] = generalDef;
    const general = createCardInstance({ definitionId: generalDef.id, ownerId: p1.id, zone: "command" });
    game.cards[general.id] = general;
    p1.zones.command.push(general.id);
    p1.commander.commanderIds.push(general.id);

    const next = applyEffect(game, { kind: "commander_to_hand", playerId: p1.id });
    expect(next.cards[general.id]?.zone).toBe("hand");
    expect(next.players[0]?.zones.hand).toContain(general.id);
  });
});

describe("wave 107: titans and reservoirs", () => {
  it("compiles the five-card batch fully", () => {
    const compile = (name: string, typeLine: string, oracleText: string, manaCost = "{1}", pt?: string) =>
      compileOracleCard({
        oracleId: name,
        name,
        manaCost,
        typeLine,
        power: pt ?? null,
        toughness: pt ?? null,
        printedKeywords: [],
        imageUrl: "",
        oracleText,
      });

    const claim = compile("Nature's Claim", "Instant", "Destroy target artifact or enchantment. Its controller gains 4 life.", "{G}");
    expect(claim.notes).toEqual([]);

    const titan = compile(
      "Sun Titan",
      "Creature — Giant",
      "Vigilance\nWhenever this creature enters or attacks, you may return target permanent card with mana value 3 or less from your graveyard to the battlefield.",
      "{4}{W}{W}",
      "6",
    );
    expect(titan.notes).toEqual([]);
    expect(titan.definition.triggers).toHaveLength(2);
    expect(titan.definition.triggers[0]?.targetRequirements?.[0]).toEqual({
      kind: "own_graveyard_permanent_card",
      maxManaValue: 3,
    });

    const hoof = compile(
      "Craterhoof Behemoth",
      "Creature — Beast",
      "Haste\nWhen this creature enters, creatures you control gain trample and get +X/+X until end of turn, where X is the number of creatures you control.",
      "{5}{G}{G}{G}",
      "5",
    );
    expect(hoof.notes).toEqual([]);

    const reservoir = compile(
      "Aetherflux Reservoir",
      "Artifact",
      "Whenever you cast a spell, you gain 1 life for each spell you've cast this turn.\nPay 50 life: Aetherflux Reservoir deals 50 damage to any target.",
      "{4}",
    );
    expect(reservoir.notes).toEqual([]);

    const toski = compile(
      "Toski, Bearer of Secrets",
      "Legendary Creature — Squirrel",
      "This spell can't be countered.\nIndestructible\nToski, Bearer of Secrets attacks each combat if able.\nWhenever a creature you control deals combat damage to a player, draw a card.",
      "{3}{G}",
      "1",
    );
    expect(toski.notes).toEqual([]);
    expect(toski.definition.mustAttack).toBe(true);
  });

  it("scales Craterhoof pumps and Aetherflux gains at bind", () => {
    const { game, p1 } = twoPlayers();
    const bearDef = createCardDefinition({ name: "Bear", typeLine: "Creature — Bear", power: 2, toughness: 2 });
    game.definitions[bearDef.id] = bearDef;
    for (let index = 0; index < 3; index += 1) {
      const bear = createCardInstance({ definitionId: bearDef.id, ownerId: p1.id, zone: "battlefield" });
      game.cards[bear.id] = bear;
      p1.zones.battlefield.push(bear.id);
    }

    const bound = bindCardEffects(
      game,
      [
        {
          kind: "team_pt_until_eot",
          playerId: "controller",
          power: "creature_count",
          toughness: "creature_count",
        },
      ],
      { controllerId: p1.id, sourceId: null },
    );
    const pumped = applyEffects(game, bound);
    const anyBear = p1.zones.battlefield[0]!;
    // Three creatures: +3/+3 each.
    expect(computedCard(pumped, anyBear)?.power).toBe(5);

    game.spellsCastByPlayerThisTurn = { [p1.id]: 3 };
    const gains = bindCardEffects(
      game,
      [{ kind: "gain_life", playerId: "controller", amount: 1, perSpellsCastThisTurn: true }],
      { controllerId: p1.id, sourceId: null },
    );
    const gained = applyEffects(game, gains);
    expect(gained.players[0]?.life).toBe(43);
  });

  it("forces an able must-attacker into combat", () => {
    const { game, p1, p2 } = twoPlayers();
    game.turn.phase = "combat";
    game.turn.step = "declareAttackers";
    const toskiDef = createCardDefinition({
      name: "Toski",
      typeLine: "Legendary Creature — Squirrel",
      power: 1,
      toughness: 1,
      mustAttack: true,
    });
    const bearDef = createCardDefinition({ name: "Bear", typeLine: "Creature — Bear", power: 2, toughness: 2 });
    game.definitions[toskiDef.id] = toskiDef;
    game.definitions[bearDef.id] = bearDef;
    const toski = createCardInstance({ definitionId: toskiDef.id, ownerId: p1.id, zone: "battlefield" });
    const bear = createCardInstance({ definitionId: bearDef.id, ownerId: p1.id, zone: "battlefield" });
    toski.summoningSick = false;
    bear.summoningSick = false;
    game.cards[toski.id] = toski;
    game.cards[bear.id] = bear;
    p1.zones.battlefield.push(toski.id, bear.id);
    game.priorityPlayerId = p1.id;

    // Leaving Toski home is illegal while it can attack.
    expect(() =>
      declareAttackers(game, p1.id, [{ attackerId: bear.id, defenderId: p2.id }]),
    ).toThrow(/attacks each combat/);
    const declared = declareAttackers(game, p1.id, [
      { attackerId: toski.id, defenderId: p2.id },
      { attackerId: bear.id, defenderId: p2.id },
    ]);
    expect(declared.combat?.attacks).toHaveLength(2);
  });
});


describe("wave 108: idols, spears, swarms, masterminds", () => {
  it("compiles the quartet fully", () => {
    const idol = compileOracleCard({
      oracleId: "idol",
      name: "Idol of Oblivion",
      manaCost: "{2}",
      typeLine: "Artifact",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "{T}: Draw a card. Activate only if you created a token this turn.\n{8}, {T}, Sacrifice this artifact: Create a 10/10 colorless Eldrazi creature token.",
    });
    expect(idol.notes).toEqual([]);
    expect(idol.definition.activated[0]?.requiresCreatedToken).toBe(true);
    expect(idol.definition.activated[1]?.sacrificeSelf).toBe(true);

    const spear = compileOracleCard({
      oracleId: "spear",
      name: "Shadowspear",
      manaCost: "{1}",
      typeLine: "Legendary Artifact — Equipment",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "Equipped creature gets +1/+1 and has trample and lifelink.\n{1}: Permanents your opponents control lose hexproof and indestructible until end of turn.\nEquip {2}",
    });
    expect(spear.notes).toEqual([]);
    expect(spear.definition.activated[0]?.effects).toEqual([
      { kind: "opponents_lose_keywords_until_eot", keywords: ["hexproof", "indestructible"] },
    ]);

    const swarm = compileOracleCard({
      oracleId: "swarm",
      name: "Scute Swarm",
      manaCost: "{2}{G}",
      typeLine: "Creature — Insect",
      power: "1",
      toughness: "1",
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "Landfall — Whenever a land you control enters, create a 1/1 green Insect creature token. If you control six or more lands, create a token that's a copy of this creature instead.",
    });
    expect(swarm.notes).toEqual([]);
    expect(swarm.definition.triggers[0]?.event).toBe("enter_battlefield");
    expect(swarm.definition.triggers[0]?.effects[0]).toMatchObject({
      kind: "create_token",
      name: "Insect",
      copySelfIfLandsAtLeast: 6,
    });

    const mastermind = compileOracleCard({
      oracleId: "mastermind",
      name: "Faerie Mastermind",
      manaCost: "{1}{U}",
      typeLine: "Legendary Creature — Faerie Rogue",
      power: "2",
      toughness: "1",
      printedKeywords: ["Flash", "Flying"],
      imageUrl: "",
      oracleText:
        "Flash\nFlying\nWhenever an opponent draws their second card each turn, you draw a card.\n{3}{U}: Each player draws a card.",
    });
    expect(mastermind.notes).toEqual([]);
    expect(mastermind.definition.triggers[0]?.event).toBe("opponent_draws_second");
    expect(mastermind.definition.activated[0]?.effects).toEqual([
      { kind: "draw", playerId: "each_player", count: 1 },
    ]);
  });

  it("gates the idol on this turn's token creation", () => {
    const { game, p1 } = twoPlayers();
    fillLibraries(game, 10);
    const idolDef = createCardDefinition({
      name: "Idol",
      typeLine: "Artifact",
      activated: [
        {
          tap: true,
          manaCost: "",
          effects: [{ kind: "draw", playerId: "controller", count: 1 }],
          targetRequirements: [],
          requiresCreatedToken: true,
        },
      ],
    });
    game.definitions[idolDef.id] = idolDef;
    const idol = createCardInstance({ definitionId: idolDef.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[idol.id] = idol;
    p1.zones.battlefield.push(idol.id);
    game.priorityPlayerId = p1.id;

    expect(() =>
      applyAction(game, {
        kind: "activate_ability",
        playerId: p1.id,
        cardId: idol.id,
        abilityIndex: 0,
        targets: [],
      }),
    ).toThrow(/created a token/);

    const withToken = applyEffect(game, {
      kind: "create_token",
      ownerId: p1.id,
      name: "Servo",
      typeLine: "Artifact Creature — Servo Token",
      power: 1,
      toughness: 1,
    });
    withToken.priorityPlayerId = p1.id;
    const activated = applyAction(withToken, {
      kind: "activate_ability",
      playerId: p1.id,
      cardId: idol.id,
      abilityIndex: 0,
      targets: [],
    });
    expect(activated.stack).toHaveLength(1);
  });

  it("strips only opponents' keywords until end of turn", () => {
    const { game, p1, p2 } = twoPlayers();
    const hexDef = createCardDefinition({
      name: "Hexbear",
      typeLine: "Creature — Bear",
      power: 2,
      toughness: 2,
      keywords: ["hexproof", "indestructible"],
    });
    game.definitions[hexDef.id] = hexDef;
    const mine = createCardInstance({ definitionId: hexDef.id, ownerId: p1.id, zone: "battlefield" });
    const theirs = createCardInstance({ definitionId: hexDef.id, ownerId: p2.id, zone: "battlefield" });
    game.cards[mine.id] = mine;
    game.cards[theirs.id] = theirs;
    p1.zones.battlefield.push(mine.id);
    p2.zones.battlefield.push(theirs.id);

    const next = applyEffect(game, {
      kind: "opponents_lose_keywords_until_eot",
      playerId: p1.id,
      keywords: ["hexproof", "indestructible"],
    });
    expect(computedCard(next, theirs.id)?.keywords).toEqual([]);
    expect(computedCard(next, mine.id)?.keywords).toEqual(["hexproof", "indestructible"]);
  });

  it("upgrades the swarm token to a copy at six lands", () => {
    const { game, p1 } = twoPlayers();
    const swarmDef = createCardDefinition({
      name: "Scute Swarm",
      typeLine: "Creature — Insect",
      power: 1,
      toughness: 1,
      triggers: [
        {
          event: "enter_battlefield",
          watch: "controlled",
          subjectFilter: { types: ["land"] },
          effects: [
            {
              kind: "create_token",
              ownerId: "controller",
              name: "Insect",
              typeLine: "Creature — Insect Token",
              power: 1,
              toughness: 1,
              copySelfIfLandsAtLeast: 6,
            },
          ],
          targetRequirements: [],
        },
      ],
    });
    const landDef = createCardDefinition({ name: "Forest", typeLine: "Basic Land — Forest" });
    game.definitions[swarmDef.id] = swarmDef;
    game.definitions[landDef.id] = landDef;
    const swarm = createCardInstance({ definitionId: swarmDef.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[swarm.id] = swarm;
    p1.zones.battlefield.push(swarm.id);
    addLandsInPlay(game, p1, 4);

    // Fifth land: still shy of the threshold, so a plain Insect arrives.
    const fifth = createCardInstance({ definitionId: landDef.id, ownerId: p1.id, zone: "hand" });
    game.cards[fifth.id] = fifth;
    p1.zones.hand.push(fifth.id);
    let next = moveCard(game, fifth.id, "battlefield");
    while (next.stack.length > 0) {
      next = resolveTopOfStack(next);
    }
    const insects = Object.values(next.cards).filter(
      (card) => card.isToken && next.definitions[card.definitionId]?.name === "Insect",
    );
    expect(insects).toHaveLength(1);

    // Sixth land: the token is a copy of Scute Swarm instead.
    const sixth = createCardInstance({ definitionId: landDef.id, ownerId: p1.id, zone: "hand" });
    next.cards[sixth.id] = sixth;
    next.players[0]!.zones.hand.push(sixth.id);
    let after = moveCard(next, sixth.id, "battlefield");
    while (after.stack.length > 0) {
      after = resolveTopOfStack(after);
    }
    const copies = Object.values(after.cards).filter(
      (card) =>
        card.isToken && after.definitions[card.definitionId]?.name === "Scute Swarm",
    );
    expect(copies).toHaveLength(1);
  });

  it("rewards the mastermind when an opponent draws their second card", () => {
    const { game, p1, p2 } = twoPlayers();
    fillLibraries(game, 10);
    const mastermindDef = createCardDefinition({
      name: "Mastermind",
      typeLine: "Creature — Faerie Rogue",
      power: 2,
      toughness: 1,
      triggers: [
        {
          event: "opponent_draws_second",
          effects: [{ kind: "draw", playerId: "controller", count: 1 }],
          targetRequirements: [],
        },
      ],
    });
    game.definitions[mastermindDef.id] = mastermindDef;
    const mastermind = createCardInstance({
      definitionId: mastermindDef.id,
      ownerId: p1.id,
      zone: "battlefield",
    });
    game.cards[mastermind.id] = mastermind;
    p1.zones.battlefield.push(mastermind.id);
    const myHand = p1.zones.hand.length;

    // The opponent's first draw stays quiet.
    let next = applyEffect(game, { kind: "draw", playerId: p2.id, count: 1 });
    expect(next.stack).toHaveLength(0);
    expect(next.players[0]?.zones.hand).toHaveLength(myHand);

    // Their second draw this turn feeds the faerie.
    next = applyEffect(next, { kind: "draw", playerId: p2.id, count: 1 });
    while (next.stack.length > 0) {
      next = resolveTopOfStack(next);
    }
    expect(next.players[0]?.zones.hand).toHaveLength(myHand + 1);
  });
});

describe("wave 109: elves, drums, tenders, ambers", () => {
  it("compiles the quartet fully", () => {
    const elf = compileOracleCard({
      oracleId: "arbor",
      name: "Arbor Elf",
      manaCost: "{G}",
      typeLine: "Creature — Elf Druid",
      power: "1",
      toughness: "1",
      printedKeywords: [],
      imageUrl: "",
      oracleText: "{T}: Untap target Forest.",
    });
    expect(elf.notes).toEqual([]);
    expect(elf.definition.activated[0]?.targetRequirements).toEqual([
      { kind: "land", requiredSubtypes: ["forest"] },
    ]);

    const drum = compileOracleCard({
      oracleId: "drum",
      name: "Springleaf Drum",
      manaCost: "{1}",
      typeLine: "Artifact",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
      oracleText: "{T}, Tap an untapped creature you control: Add one mana of any color.",
    });
    expect(drum.notes).toEqual([]);
    expect(drum.definition.manaAbilities[0]).toMatchObject({
      producesAnyColor: true,
      costTapCreature: true,
    });

    const tender = compileOracleCard({
      oracleId: "tender",
      name: "Bloom Tender",
      manaCost: "{1}{G}",
      typeLine: "Creature — Elf Druid",
      power: "1",
      toughness: "1",
      printedKeywords: [],
      imageUrl: "",
      oracleText: "Vivid — {T}: For each color among permanents you control, add one mana of that color.",
    });
    expect(tender.notes).toEqual([]);
    expect(tender.definition.manaAbilities[0]?.producesColorsAmong).toBe("permanents");

    const mox = compileOracleCard({
      oracleId: "amber",
      name: "Mox Amber",
      manaCost: "{0}",
      typeLine: "Legendary Artifact",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
      oracleText: "{T}: Add one mana of any color among legendary creatures and planeswalkers you control.",
    });
    expect(mox.notes).toEqual([]);
    expect(mox.definition.manaAbilities[0]?.anyColorAmong).toBe("legendary");
  });

  it("taps a creature as the drum's cost", () => {
    const { game, p1 } = twoPlayers();
    const drumDef = createCardDefinition({
      name: "Drum",
      typeLine: "Artifact",
      manaAbilities: [
        {
          produces: {},
          producesOptions: [],
          producesAnyColor: true,
          damageToController: 0,
          costTapCreature: true,
        },
      ],
    });
    const bearDef = createCardDefinition({ name: "Bear", typeLine: "Creature — Bear", power: 2, toughness: 2 });
    game.definitions[drumDef.id] = drumDef;
    game.definitions[bearDef.id] = bearDef;
    const drum = createCardInstance({ definitionId: drumDef.id, ownerId: p1.id, zone: "battlefield" });
    const bear = createCardInstance({ definitionId: bearDef.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[drum.id] = drum;
    game.cards[bear.id] = bear;
    p1.zones.battlefield.push(drum.id, bear.id);
    game.priorityPlayerId = p1.id;

    // Skipping the creature cost is refused.
    expect(() =>
      applyAction(game, { kind: "tap_for_mana", playerId: p1.id, cardId: drum.id, color: "U" }),
    ).toThrow(/untapped creature/);

    const next = applyAction(game, {
      kind: "tap_for_mana",
      playerId: p1.id,
      cardId: drum.id,
      color: "U",
      costTapId: bear.id,
    });
    expect(next.players[0]?.mana.U).toBe(1);
    expect(next.cards[bear.id]?.tapped).toBe(true);
    expect(next.cards[drum.id]?.tapped).toBe(true);

    // With every creature tapped, the ability disappears entirely.
    expect(manaAbilitiesFor(next, drum.id)).toHaveLength(0);
  });

  it("limits the mox to colors among controlled legendaries", () => {
    const { game, p1 } = twoPlayers();
    const moxDef = createCardDefinition({
      name: "Mox",
      typeLine: "Legendary Artifact",
      manaAbilities: [
        {
          produces: {},
          producesOptions: [],
          producesAnyColor: false,
          damageToController: 0,
          anyColorAmong: "legendary",
        },
      ],
    });
    game.definitions[moxDef.id] = moxDef;
    const mox = createCardInstance({ definitionId: moxDef.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[mox.id] = mox;
    p1.zones.battlefield.push(mox.id);
    game.priorityPlayerId = p1.id;

    // No legendary creature or planeswalker: the ability is unusable.
    expect(manaAbilitiesFor(game, mox.id)).toHaveLength(0);

    const legendDef = createCardDefinition({
      name: "Legend",
      typeLine: "Legendary Creature — Human Wizard",
      colors: ["U"],
      power: 2,
      toughness: 2,
    });
    game.definitions[legendDef.id] = legendDef;
    const legend = createCardInstance({ definitionId: legendDef.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[legend.id] = legend;
    p1.zones.battlefield.push(legend.id);

    expect(manaAbilitiesFor(game, mox.id)).toHaveLength(1);
    expect(() =>
      applyAction(game, { kind: "tap_for_mana", playerId: p1.id, cardId: mox.id, color: "R" }),
    ).toThrow(/color/);
    const next = applyAction(game, {
      kind: "tap_for_mana",
      playerId: p1.id,
      cardId: mox.id,
      color: "U",
    });
    expect(next.players[0]?.mana.U).toBe(1);
  });

  it("adds one mana of each color on the tender's board", () => {
    const { game, p1 } = twoPlayers();
    const tenderDef = createCardDefinition({
      name: "Tender",
      typeLine: "Creature — Elf Druid",
      colors: ["G"],
      power: 1,
      toughness: 1,
      manaAbilities: [
        {
          produces: {},
          producesOptions: [],
          producesAnyColor: false,
          damageToController: 0,
          producesColorsAmong: "permanents",
        },
      ],
    });
    const angelDef = createCardDefinition({
      name: "Angel",
      typeLine: "Creature — Angel",
      colors: ["W"],
      power: 4,
      toughness: 4,
    });
    game.definitions[tenderDef.id] = tenderDef;
    game.definitions[angelDef.id] = angelDef;
    const tender = createCardInstance({ definitionId: tenderDef.id, ownerId: p1.id, zone: "battlefield" });
    const angel = createCardInstance({ definitionId: angelDef.id, ownerId: p1.id, zone: "battlefield" });
    tender.summoningSick = false;
    game.cards[tender.id] = tender;
    game.cards[angel.id] = angel;
    p1.zones.battlefield.push(tender.id, angel.id);
    game.priorityPlayerId = p1.id;

    const next = applyAction(game, { kind: "tap_for_mana", playerId: p1.id, cardId: tender.id });
    expect(next.players[0]?.mana.G).toBe(1);
    expect(next.players[0]?.mana.W).toBe(1);
    expect(next.players[0]?.mana.U).toBe(0);
  });
});

describe("wave 110: pacts, tops, mothers, devils", () => {
  it("compiles the quartet fully", () => {
    const pact = compileOracleCard({
      oracleId: "pact",
      name: "Grave Pact",
      manaCost: "{1}{B}{B}{B}",
      typeLine: "Enchantment",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "Whenever a creature you control dies, each other player sacrifices a creature of their choice.",
    });
    expect(pact.notes).toEqual([]);
    expect(pact.definition.triggers[0]?.event).toBe("dies");
    expect(pact.definition.triggers[0]?.effects[0]).toMatchObject({
      kind: "choose_card",
      chooserId: "each_opponent",
    });

    const top = compileOracleCard({
      oracleId: "top",
      name: "Sensei's Divining Top",
      manaCost: "{1}",
      typeLine: "Artifact",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "{1}: Look at the top three cards of your library, then put them back in any order.\n{T}: Draw a card, then put this artifact on top of its owner's library.",
    });
    expect(top.notes).toEqual([]);
    expect(top.definition.activated[0]?.effects[0]).toMatchObject({
      kind: "look_and_assign",
      count: 3,
      destinations: ["library_top", "library_top", "library_top"],
    });
    expect(top.definition.activated[1]?.effects).toEqual([
      { kind: "draw", playerId: "controller", count: 1 },
      { kind: "move_card", cardId: "self", toZone: "library", libraryPosition: "top" },
    ]);

    const mother = compileOracleCard({
      oracleId: "mother",
      name: "Mother of Runes",
      manaCost: "{W}",
      typeLine: "Creature — Human Cleric",
      power: "1",
      toughness: "1",
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "{T}: Target creature you control gains protection from the color of your choice until end of turn.",
    });
    expect(mother.notes).toEqual([]);
    expect(mother.definition.activated[0]?.effects[0]).toMatchObject({
      kind: "grant_protection_choice",
    });

    const devil = compileOracleCard({
      oracleId: "devil",
      name: "Mayhem Devil",
      manaCost: "{B}{R}",
      typeLine: "Creature — Devil",
      power: "3",
      toughness: "3",
      printedKeywords: [],
      imageUrl: "",
      oracleText: "Whenever a player sacrifices a permanent, this creature deals 1 damage to any target.",
    });
    expect(devil.notes).toEqual([]);
    expect(devil.definition.triggers[0]?.event).toBe("player_sacrifices");
  });

  it("reorders the top of the library and spins itself back on top", () => {
    const { game, p1 } = twoPlayers();
    fillLibraries(game, 10);
    const topDef = createCardDefinition({
      name: "Top",
      typeLine: "Artifact",
      activated: [
        {
          tap: false,
          manaCost: "{1}",
          effects: [
            {
              kind: "look_and_assign",
              playerId: "controller",
              count: 3,
              destinations: ["library_top", "library_top", "library_top"],
            },
          ],
          targetRequirements: [],
        },
        {
          tap: true,
          manaCost: "",
          effects: [
            { kind: "draw", playerId: "controller", count: 1 },
            { kind: "move_card", cardId: "self", toZone: "library", libraryPosition: "top" },
          ],
          targetRequirements: [],
        },
      ],
    });
    game.definitions[topDef.id] = topDef;
    const top = createCardInstance({ definitionId: topDef.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[top.id] = top;
    p1.zones.battlefield.push(top.id);
    game.priorityPlayerId = p1.id;
    game.players[0]!.mana.C = 1;

    let next = applyAction(game, {
      kind: "activate_ability",
      playerId: p1.id,
      cardId: top.id,
      abilityIndex: 0,
      targets: [],
    });
    while (next.stack.length > 0) {
      next = resolveTopOfStack(next);
    }
    expect(next.prompts[0]?.kind).toBe("look_and_assign");
    const looked = next.players[0]!.zones.library.slice(0, 3);
    next = applyAction(next, {
      kind: "resolve_look_assign",
      playerId: p1.id,
      assignments: looked.map((cardId) => ({ cardId, destination: "library_top" as const })),
    });
    // Later top placements land above earlier ones: the order reverses.
    expect(next.players[0]!.zones.library.slice(0, 3)).toEqual([...looked].reverse());

    // The tap ability draws and perches the Top back on the library.
    const handBefore = next.players[0]!.zones.hand.length;
    next.priorityPlayerId = p1.id;
    let spun = applyAction(next, {
      kind: "activate_ability",
      playerId: p1.id,
      cardId: top.id,
      abilityIndex: 1,
      targets: [],
    });
    while (spun.stack.length > 0) {
      spun = resolveTopOfStack(spun);
    }
    expect(spun.players[0]!.zones.hand.length).toBe(handBefore + 1);
    expect(spun.players[0]!.zones.library[0]).toBe(top.id);
    expect(spun.cards[top.id]?.zone).toBe("library");
  });

  it("grants chosen-color protection until end of turn", () => {
    const { game, p1 } = twoPlayers();
    const motherDef = createCardDefinition({
      name: "Mother",
      typeLine: "Creature — Human Cleric",
      power: 1,
      toughness: 1,
      activated: [
        {
          tap: true,
          manaCost: "",
          effects: [{ kind: "grant_protection_choice", target: { type: "chosen", index: 0 } }],
          targetRequirements: [{ kind: "own_creature" }],
        },
      ],
    });
    const bearDef = createCardDefinition({ name: "Bear", typeLine: "Creature — Bear", power: 2, toughness: 2 });
    game.definitions[motherDef.id] = motherDef;
    game.definitions[bearDef.id] = bearDef;
    const mother = createCardInstance({ definitionId: motherDef.id, ownerId: p1.id, zone: "battlefield" });
    const bear = createCardInstance({ definitionId: bearDef.id, ownerId: p1.id, zone: "battlefield" });
    mother.summoningSick = false;
    game.cards[mother.id] = mother;
    game.cards[bear.id] = bear;
    p1.zones.battlefield.push(mother.id, bear.id);
    game.priorityPlayerId = p1.id;

    let next = applyAction(game, {
      kind: "activate_ability",
      playerId: p1.id,
      cardId: mother.id,
      abilityIndex: 0,
      targets: [{ type: "creature", cardId: bear.id }],
    });
    while (next.stack.length > 0) {
      next = resolveTopOfStack(next);
    }
    expect(next.prompts[0]?.kind).toBe("choose_color");
    next = applyAction(next, { kind: "resolve_color", playerId: p1.id, color: "R" });
    expect(computedCard(next, bear.id)?.protectionFrom).toContain("R");
  });

  it("pings off every sacrifice at the table", () => {
    const { game, p1, p2 } = twoPlayers();
    const devilDef = createCardDefinition({
      name: "Devil",
      typeLine: "Creature — Devil",
      power: 3,
      toughness: 3,
      triggers: [
        {
          event: "player_sacrifices",
          effects: [
            {
              kind: "deal_damage",
              sourceId: "self",
              target: { type: "chosen", index: 0 },
              amount: 1,
            },
          ],
          targetRequirements: [{ kind: "player_or_creature" }],
        },
      ],
    });
    const foodDef = createCardDefinition({ name: "Food", typeLine: "Artifact — Food" });
    game.definitions[devilDef.id] = devilDef;
    game.definitions[foodDef.id] = foodDef;
    const devil = createCardInstance({ definitionId: devilDef.id, ownerId: p1.id, zone: "battlefield" });
    const food = createCardInstance({ definitionId: foodDef.id, ownerId: p2.id, zone: "battlefield" });
    game.cards[devil.id] = devil;
    game.cards[food.id] = food;
    p1.zones.battlefield.push(devil.id);
    p2.zones.battlefield.push(food.id);

    // An OPPONENT's sacrifice still feeds the devil.
    const next = applyEffect(game, { kind: "sacrifice", cardId: food.id });
    expect(next.cards[food.id]?.zone).toBe("graveyard");
    const sawTrigger = next.prompts.length > 0 || next.stack.length > 0;
    expect(sawTrigger).toBe(true);
  });
});

describe("wave 111: orchards, pools, cutthroats, orchids", () => {
  it("compiles the batch fully", () => {
    const orchard = compileOracleCard({
      oracleId: "orchard",
      name: "Exotic Orchard",
      manaCost: "",
      typeLine: "Land",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
      oracleText: "{T}: Add one mana of any color that a land an opponent controls could produce.",
    });
    expect(orchard.notes).toEqual([]);
    expect(orchard.definition.manaAbilities[0]?.anyColorAmong).toBe("opponent_lands");

    const pool = compileOracleCard({
      oracleId: "pool",
      name: "Reflecting Pool",
      manaCost: "",
      typeLine: "Land",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
      oracleText: "{T}: Add one mana of any type that a land you control could produce.",
    });
    expect(pool.notes).toEqual([]);
    expect(pool.definition.manaAbilities[0]?.anyColorAmong).toBe("your_lands");

    const cutthroat = compileOracleCard({
      oracleId: "cutthroat",
      name: "Zulaport Cutthroat",
      manaCost: "{1}{B}",
      typeLine: "Creature — Human Rogue Ally",
      power: "1",
      toughness: "1",
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "Whenever this creature or another creature you control dies, each opponent loses 1 life and you gain 1 life.",
    });
    expect(cutthroat.notes).toEqual([]);
    expect(cutthroat.definition.triggers[0]?.event).toBe("dies");
    expect(cutthroat.definition.triggers[0]?.effects).toEqual([
      { kind: "lose_life", playerId: "each_opponent", amount: 1 },
      { kind: "gain_life", playerId: "controller", amount: 1 },
    ]);

    const knight = compileOracleCard({
      oracleId: "knight",
      name: "Knight of the White Orchid",
      manaCost: "{W}{W}",
      typeLine: "Creature — Human Knight",
      power: "2",
      toughness: "2",
      printedKeywords: ["First strike"],
      imageUrl: "",
      oracleText:
        "First strike\nWhen this creature enters, if an opponent controls more lands than you, you may search your library for a Plains card, put it onto the battlefield, then shuffle.",
    });
    expect(knight.notes).toEqual([]);
    expect(knight.definition.triggers[0]?.condition).toEqual({
      kind: "opponent_controls_more_lands",
    });
  });

  it("limits the orchard to what opponent lands could produce", () => {
    const { game, p1, p2 } = twoPlayers();
    const orchardDef = createCardDefinition({
      name: "Orchard",
      typeLine: "Land",
      manaAbilities: [
        {
          produces: {},
          producesOptions: [],
          producesAnyColor: false,
          damageToController: 0,
          anyColorAmong: "opponent_lands",
        },
      ],
    });
    const mountainDef = createCardDefinition({
      name: "Mountain",
      typeLine: "Basic Land — Mountain",
      produces: { R: 1 },
    });
    game.definitions[orchardDef.id] = orchardDef;
    game.definitions[mountainDef.id] = mountainDef;
    const orchard = createCardInstance({ definitionId: orchardDef.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[orchard.id] = orchard;
    p1.zones.battlefield.push(orchard.id);
    game.priorityPlayerId = p1.id;

    // No opponent lands: the orchard offers nothing.
    expect(manaAbilitiesFor(game, orchard.id)).toHaveLength(0);

    const mountain = createCardInstance({ definitionId: mountainDef.id, ownerId: p2.id, zone: "battlefield" });
    game.cards[mountain.id] = mountain;
    p2.zones.battlefield.push(mountain.id);
    expect(manaAbilitiesFor(game, orchard.id)).toHaveLength(1);
    expect(() =>
      applyAction(game, { kind: "tap_for_mana", playerId: p1.id, cardId: orchard.id, color: "U" }),
    ).toThrow(/color/);
    const next = applyAction(game, {
      kind: "tap_for_mana",
      playerId: p1.id,
      cardId: orchard.id,
      color: "R",
    });
    expect(next.players[0]?.mana.R).toBe(1);
  });

  it("lets the pool copy a colorless-producing land type", () => {
    const { game, p1 } = twoPlayers();
    const poolDef = createCardDefinition({
      name: "Pool",
      typeLine: "Land",
      manaAbilities: [
        {
          produces: {},
          producesOptions: [],
          producesAnyColor: false,
          damageToController: 0,
          anyColorAmong: "your_lands",
        },
      ],
    });
    const wastesDef = createCardDefinition({
      name: "Wastes",
      typeLine: "Basic Land",
      produces: { C: 1 },
    });
    game.definitions[poolDef.id] = poolDef;
    game.definitions[wastesDef.id] = wastesDef;
    const pool = createCardInstance({ definitionId: poolDef.id, ownerId: p1.id, zone: "battlefield" });
    const wastes = createCardInstance({ definitionId: wastesDef.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[pool.id] = pool;
    game.cards[wastes.id] = wastes;
    p1.zones.battlefield.push(pool.id, wastes.id);
    game.priorityPlayerId = p1.id;

    // "Any type" includes colorless — the Wastes teaches the pool {C}.
    const next = applyAction(game, {
      kind: "tap_for_mana",
      playerId: p1.id,
      cardId: pool.id,
      color: "C",
    });
    expect(next.players[0]?.mana.C).toBe(1);
  });

  it("drains a flat amount when the cutthroat's crew dies", () => {
    const { game, p1 } = twoPlayers();
    const cutthroatDef = createCardDefinition({
      name: "Cutthroat",
      typeLine: "Creature — Human Rogue",
      power: 1,
      toughness: 1,
      triggers: [
        {
          event: "dies",
          watch: "controlled",
          subjectFilter: { types: ["creature"] },
          effects: [
            { kind: "lose_life", playerId: "each_opponent", amount: 1 },
            { kind: "gain_life", playerId: "controller", amount: 1 },
          ],
          targetRequirements: [],
        },
      ],
    });
    const bearDef = createCardDefinition({ name: "Bear", typeLine: "Creature — Bear", power: 2, toughness: 2 });
    game.definitions[cutthroatDef.id] = cutthroatDef;
    game.definitions[bearDef.id] = bearDef;
    const cutthroat = createCardInstance({ definitionId: cutthroatDef.id, ownerId: p1.id, zone: "battlefield" });
    const bear = createCardInstance({ definitionId: bearDef.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[cutthroat.id] = cutthroat;
    game.cards[bear.id] = bear;
    p1.zones.battlefield.push(cutthroat.id, bear.id);

    let next = applyEffect(game, { kind: "sacrifice", cardId: bear.id });
    while (next.stack.length > 0) {
      next = resolveTopOfStack(next);
    }
    expect(next.players[1]?.life).toBe(39);
    expect(next.players[0]?.life).toBe(41);
  });
});

describe("wave 112: masks, axes, and swords", () => {
  it("compiles the equipment batch fully", () => {
    const mask = compileOracleCard({
      oracleId: "mask",
      name: "Mask of Memory",
      manaCost: "{1}",
      typeLine: "Artifact — Equipment",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "Whenever equipped creature deals combat damage to a player, you may draw two cards. If you do, discard a card.\nEquip {1}",
    });
    expect(mask.notes).toEqual([]);
    expect(mask.definition.triggers[0]).toMatchObject({
      event: "deals_combat_damage_to_player",
      watch: "attached",
    });
    expect(mask.definition.triggers[0]?.effects).toEqual([
      { kind: "draw", playerId: "controller", count: 2 },
      { kind: "discard", playerId: "controller", count: 1 },
    ]);

    const axe = compileOracleCard({
      oracleId: "axe",
      name: "Bloodforged Battle-Axe",
      manaCost: "{1}{R}",
      typeLine: "Artifact — Equipment",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "Equipped creature gets +2/+0.\nWhenever equipped creature deals combat damage to a player, create a token that's a copy of this Equipment.\nEquip {2}",
    });
    expect(axe.notes).toEqual([]);
    expect(axe.definition.triggers[0]?.effects[0]).toMatchObject({
      kind: "copy_token",
      ofCardId: "self",
    });

    const fireIce = compileOracleCard({
      oracleId: "fireice",
      name: "Sword of Fire and Ice",
      manaCost: "{3}",
      typeLine: "Artifact — Equipment",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "Equipped creature gets +2/+2 and has protection from red and from blue.\nWhenever equipped creature deals combat damage to a player, this Equipment deals 2 damage to any target and you draw a card.\nEquip {2}",
    });
    expect(fireIce.notes).toEqual([]);
    expect(fireIce.definition.staticAbilities).toEqual([
      {
        selector: { scope: "attached" },
        effect: { kind: "modify_pt", power: 2, toughness: 2 },
      },
      {
        selector: { scope: "attached" },
        effect: { kind: "grant_protection", colors: ["R", "U"] },
      },
    ]);

    const feastFamine = compileOracleCard({
      oracleId: "feastfamine",
      name: "Sword of Feast and Famine",
      manaCost: "{3}",
      typeLine: "Artifact — Equipment",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "Equipped creature gets +2/+2 and has protection from black and from green.\nWhenever equipped creature deals combat damage to a player, that player discards a card and you untap all lands you control.\nEquip {2}",
    });
    expect(feastFamine.notes).toEqual([]);
    expect(feastFamine.definition.triggers[0]?.effects).toEqual([
      { kind: "discard", playerId: { type: "subject_player" }, count: 1 },
      { kind: "untap_all", playerId: "controller", what: "land" },
    ]);
  });

  it("fires only for the host's strikes and shields it in layer six", () => {
    const { game, p1, p2 } = twoPlayers();
    fillLibraries(game, 10);
    const swordDef = createCardDefinition({
      name: "Sword",
      typeLine: "Artifact — Equipment",
      staticAbilities: [
        {
          selector: { scope: "attached" },
          effect: { kind: "modify_pt", power: 2, toughness: 2 },
        },
        {
          selector: { scope: "attached" },
          effect: { kind: "grant_protection", colors: ["R", "U"] },
        },
      ],
      triggers: [
        {
          event: "deals_combat_damage_to_player",
          watch: "attached",
          effects: [{ kind: "draw", playerId: "controller", count: 1 }],
          targetRequirements: [],
        },
      ],
    });
    const bearDef = createCardDefinition({ name: "Bear", typeLine: "Creature — Bear", power: 2, toughness: 2 });
    game.definitions[swordDef.id] = swordDef;
    game.definitions[bearDef.id] = bearDef;
    const sword = createCardInstance({ definitionId: swordDef.id, ownerId: p1.id, zone: "battlefield" });
    const host = createCardInstance({ definitionId: bearDef.id, ownerId: p1.id, zone: "battlefield" });
    const other = createCardInstance({ definitionId: bearDef.id, ownerId: p1.id, zone: "battlefield" });
    sword.attachedTo = host.id;
    game.cards[sword.id] = sword;
    game.cards[host.id] = host;
    game.cards[other.id] = other;
    p1.zones.battlefield.push(sword.id, host.id, other.id);

    // The host reads 4/4 with protection; the bystander stays a plain bear.
    expect(computedCard(game, host.id)?.power).toBe(4);
    expect(computedCard(game, host.id)?.protectionFrom).toEqual(["R", "U"]);
    expect(computedCard(game, other.id)?.protectionFrom).toEqual([]);

    // A bystander's strike is silent...
    dispatchEventsInPlace(game, [
      { kind: "combat_damage_to_player", cardId: other.id, playerId: p2.id },
    ]);
    expect(game.stack).toHaveLength(0);

    // ...the host's strike feeds the sword.
    dispatchEventsInPlace(game, [
      { kind: "combat_damage_to_player", cardId: host.id, playerId: p2.id },
    ]);
    expect(game.stack).toHaveLength(1);
  });
});

describe("wave 113: constellations and welcoming committees", () => {
  it("compiles the batch fully", () => {
    const champion = compileOracleCard({
      oracleId: "champion",
      name: "Setessan Champion",
      manaCost: "{2}{G}",
      typeLine: "Creature — Human Warrior",
      power: "1",
      toughness: "3",
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "Constellation — Whenever an enchantment you control enters, put a +1/+1 counter on this creature and draw a card.",
    });
    expect(champion.notes).toEqual([]);
    expect(champion.definition.triggers[0]).toMatchObject({
      event: "enter_battlefield",
      watch: "controlled",
      subjectFilter: { types: ["enchantment"] },
    });
    expect(champion.definition.triggers[0]?.effects).toEqual([
      { kind: "add_counter", cardId: "self", counter: "+1/+1", amount: 1 },
      { kind: "draw", playerId: "controller", count: 1 },
    ]);

    const eidolon = compileOracleCard({
      oracleId: "eidolon",
      name: "Eidolon of Blossoms",
      manaCost: "{2}{G}{G}",
      typeLine: "Enchantment Creature — Spirit",
      power: "2",
      toughness: "2",
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "Constellation — Whenever this creature or another enchantment you control enters, draw a card.",
    });
    expect(eidolon.notes).toEqual([]);
    expect(eidolon.definition.triggers[0]?.subjectFilter?.types).toEqual(["enchantment"]);

    const giant = compileOracleCard({
      oracleId: "giant",
      name: "Doomwake Giant",
      manaCost: "{4}{B}",
      typeLine: "Enchantment Creature — Giant",
      power: "4",
      toughness: "6",
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "Constellation — Whenever this creature or another enchantment you control enters, creatures your opponents control get -1/-1 until end of turn.",
    });
    expect(giant.notes).toEqual([]);

    const vampire = compileOracleCard({
      oracleId: "vampire",
      name: "Welcoming Vampire",
      manaCost: "{2}{W}",
      typeLine: "Creature — Vampire",
      power: "2",
      toughness: "3",
      printedKeywords: ["Flying"],
      imageUrl: "",
      oracleText:
        "Flying\nWhenever one or more other creatures you control with power 2 or less enter, draw a card. This ability triggers only once each turn.",
    });
    expect(vampire.notes).toEqual([]);
    expect(vampire.definition.triggers[0]).toMatchObject({
      event: "enter_battlefield",
      excludeSelf: true,
      oncePerBatch: true,
      oncePerTurn: true,
      subjectFilter: { types: ["creature"], maxPower: 2 },
    });
  });

  it("greets only small newcomers and only once a turn", () => {
    const { game, p1 } = twoPlayers();
    fillLibraries(game, 10);
    const vampireDef = createCardDefinition({
      name: "Vampire",
      typeLine: "Creature — Vampire",
      power: 2,
      toughness: 3,
      triggers: [
        {
          event: "enter_battlefield",
          watch: "controlled",
          excludeSelf: true,
          oncePerBatch: true,
          oncePerTurn: true,
          subjectFilter: { types: ["creature"], maxPower: 2 },
          effects: [{ kind: "draw", playerId: "controller", count: 1 }],
          targetRequirements: [],
        },
      ],
    });
    const smallDef = createCardDefinition({ name: "Small", typeLine: "Creature — Goblin", power: 1, toughness: 1 });
    const bigDef = createCardDefinition({ name: "Big", typeLine: "Creature — Beast", power: 4, toughness: 4 });
    game.definitions[vampireDef.id] = vampireDef;
    game.definitions[smallDef.id] = smallDef;
    game.definitions[bigDef.id] = bigDef;
    const vampire = createCardInstance({ definitionId: vampireDef.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[vampire.id] = vampire;
    p1.zones.battlefield.push(vampire.id);

    // A big arrival is ignored.
    const big = createCardInstance({ definitionId: bigDef.id, ownerId: p1.id, zone: "hand" });
    game.cards[big.id] = big;
    p1.zones.hand.push(big.id);
    let next = moveCard(game, big.id, "battlefield");
    expect(next.stack).toHaveLength(0);

    // A small arrival draws...
    const small = createCardInstance({ definitionId: smallDef.id, ownerId: p1.id, zone: "hand" });
    next.cards[small.id] = small;
    next.players[0]!.zones.hand.push(small.id);
    const handBefore = next.players[0]!.zones.hand.length - 1;
    next = moveCard(next, small.id, "battlefield");
    while (next.stack.length > 0) {
      next = resolveTopOfStack(next);
    }
    expect(next.players[0]?.zones.hand).toHaveLength(handBefore + 1);

    // ...and a second small arrival the same turn stays quiet.
    const second = createCardInstance({ definitionId: smallDef.id, ownerId: p1.id, zone: "hand" });
    next.cards[second.id] = second;
    next.players[0]!.zones.hand.push(second.id);
    next = moveCard(next, second.id, "battlefield");
    expect(next.stack).toHaveLength(0);
  });

  it("fires constellation for enchantments only, including itself", () => {
    const { game, p1 } = twoPlayers();
    fillLibraries(game, 10);
    const eidolonDef = createCardDefinition({
      name: "Eidolon",
      typeLine: "Enchantment Creature — Spirit",
      power: 2,
      toughness: 2,
      triggers: [
        {
          event: "enter_battlefield",
          watch: "controlled",
          subjectFilter: { types: ["enchantment"] },
          effects: [{ kind: "draw", playerId: "controller", count: 1 }],
          targetRequirements: [],
        },
      ],
    });
    const bearDef = createCardDefinition({ name: "Bear", typeLine: "Creature — Bear", power: 2, toughness: 2 });
    game.definitions[eidolonDef.id] = eidolonDef;
    game.definitions[bearDef.id] = bearDef;

    // Its own arrival is an enchantment entering.
    const eidolon = createCardInstance({ definitionId: eidolonDef.id, ownerId: p1.id, zone: "hand" });
    game.cards[eidolon.id] = eidolon;
    p1.zones.hand.push(eidolon.id);
    const handBefore = p1.zones.hand.length - 1;
    let next = moveCard(game, eidolon.id, "battlefield");
    while (next.stack.length > 0) {
      next = resolveTopOfStack(next);
    }
    expect(next.players[0]?.zones.hand).toHaveLength(handBefore + 1);

    // A plain creature's arrival is not.
    const bear = createCardInstance({ definitionId: bearDef.id, ownerId: p1.id, zone: "hand" });
    next.cards[bear.id] = bear;
    next.players[0]!.zones.hand.push(bear.id);
    next = moveCard(next, bear.id, "battlefield");
    expect(next.stack).toHaveLength(0);
  });
});

describe("wave 114: shrines, casualties, ruined fields", () => {
  it("compiles the batch fully", () => {
    const nykthos = compileOracleCard({
      oracleId: "nykthos",
      name: "Nykthos, Shrine to Nyx",
      manaCost: "",
      typeLine: "Legendary Land",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "{T}: Add {C}.\n{2}, {T}: Choose a color. Add an amount of mana of that color equal to your devotion to that color.",
    });
    expect(nykthos.notes).toEqual([]);
    expect(nykthos.definition.manaAbilities[1]).toMatchObject({
      producesAnyColor: true,
      countFromDevotion: true,
      costMana: "{2}",
    });

    const casualties = compileOracleCard({
      oracleId: "casualties",
      name: "Casualties of War",
      manaCost: "{2}{B}{B}{G}{G}",
      typeLine: "Sorcery",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "Choose one or more —\n• Destroy target artifact.\n• Destroy target creature.\n• Destroy target enchantment.\n• Destroy target land.\n• Destroy target planeswalker.",
    });
    expect(casualties.notes).toEqual([]);
    expect(casualties.definition.modes).toHaveLength(5);
    expect(casualties.definition.modes?.[4]?.targetRequirements).toEqual([
      { kind: "planeswalker" },
    ]);
    expect(casualties.definition.modeChoice).toMatchObject({ min: 1, max: 5 });

    const field = compileOracleCard({
      oracleId: "field",
      name: "Field of Ruin",
      manaCost: "",
      typeLine: "Land",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "{T}: Add {C}.\n{2}, {T}, Sacrifice this land: Destroy target nonbasic land an opponent controls. Each player searches their library for a basic land card, puts it onto the battlefield, then shuffles.",
    });
    expect(field.notes).toEqual([]);
    const ability = field.definition.activated[0];
    expect(ability?.sacrificeSelf).toBe(true);
    expect(ability?.targetRequirements).toEqual([
      { kind: "land", nonbasicOnly: true, control: "not_own" },
    ]);
    expect(ability?.effects[1]).toMatchObject({
      kind: "search_library",
      playerId: "each_player",
      destination: "battlefield",
    });
  });

  it("scales the shrine to devotion of the chosen color", () => {
    const { game, p1 } = twoPlayers();
    const shrineDef = createCardDefinition({
      name: "Shrine",
      typeLine: "Legendary Land",
      manaAbilities: [
        {
          produces: {},
          producesOptions: [],
          producesAnyColor: true,
          damageToController: 0,
          countFromDevotion: true,
          costMana: "{2}",
        },
      ],
    });
    const elfDef = createCardDefinition({
      name: "Elf",
      typeLine: "Creature — Elf",
      manaCost: "{G}{G}",
      power: 2,
      toughness: 2,
    });
    const druidDef = createCardDefinition({
      name: "Druid",
      typeLine: "Creature — Elf Druid",
      manaCost: "{1}{G}",
      power: 1,
      toughness: 1,
    });
    game.definitions[shrineDef.id] = shrineDef;
    game.definitions[elfDef.id] = elfDef;
    game.definitions[druidDef.id] = druidDef;
    const shrine = createCardInstance({ definitionId: shrineDef.id, ownerId: p1.id, zone: "battlefield" });
    const elf = createCardInstance({ definitionId: elfDef.id, ownerId: p1.id, zone: "battlefield" });
    const druid = createCardInstance({ definitionId: druidDef.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[shrine.id] = shrine;
    game.cards[elf.id] = elf;
    game.cards[druid.id] = druid;
    p1.zones.battlefield.push(shrine.id, elf.id, druid.id);
    game.priorityPlayerId = p1.id;
    game.players[0]!.mana.C = 2;

    // Devotion to green is three ({G}{G} + {1}{G}); the {2} cost is paid
    // from the floating pool.
    const next = applyAction(game, {
      kind: "tap_for_mana",
      playerId: p1.id,
      cardId: shrine.id,
      color: "G",
    });
    expect(next.players[0]?.mana.G).toBe(3);
    expect(next.players[0]?.mana.C).toBe(0);
  });

  it("targets planeswalkers and only planeswalkers", () => {
    const { game, p1, p2 } = twoPlayers();
    const walkerDef = createCardDefinition({
      name: "Walker",
      typeLine: "Legendary Planeswalker — Test",
      loyalty: 3,
    });
    const bearDef = createCardDefinition({ name: "Bear", typeLine: "Creature — Bear", power: 2, toughness: 2 });
    game.definitions[walkerDef.id] = walkerDef;
    game.definitions[bearDef.id] = bearDef;
    const walker = createCardInstance({ definitionId: walkerDef.id, ownerId: p2.id, zone: "battlefield" });
    const bear = createCardInstance({ definitionId: bearDef.id, ownerId: p2.id, zone: "battlefield" });
    game.cards[walker.id] = walker;
    game.cards[bear.id] = bear;
    p2.zones.battlefield.push(walker.id, bear.id);

    expect(
      isChosenTargetLegal(game, { kind: "planeswalker" }, { type: "creature", cardId: walker.id }, p1.id),
    ).toBe(true);
    expect(
      isChosenTargetLegal(game, { kind: "planeswalker" }, { type: "creature", cardId: bear.id }, p1.id),
    ).toBe(false);
  });
});

describe("wave 115: apes, altisaurs, and fights", () => {
  it("compiles the fight batch fully", () => {
    const kogla = compileOracleCard({
      oracleId: "kogla",
      name: "Kogla, the Titan Ape",
      manaCost: "{2}{G}{G}{G}",
      typeLine: "Legendary Creature — Ape",
      power: "7",
      toughness: "6",
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "When Kogla enters, it fights up to one target creature you don't control.\nWhenever Kogla attacks, destroy target artifact or enchantment defending player controls.\n{1}{G}: Return target Human you control to its owner's hand. Kogla gains indestructible until end of turn.",
    });
    expect(kogla.notes).toEqual([]);
    expect(kogla.definition.triggers[0]?.targetRequirements).toEqual([
      { kind: "creature", control: "not_own", optional: true },
    ]);
    expect(kogla.definition.triggers[0]?.effects[0]).toMatchObject({ kind: "fight", cardId: "self" });
    expect(kogla.definition.activated[0]?.targetRequirements).toEqual([
      { kind: "creature", control: "own", requiredSubtypes: ["human"] },
    ]);
    expect(kogla.definition.activated[0]?.effects[1]).toEqual({
      kind: "keyword_until_eot",
      cardId: "self",
      keyword: "indestructible",
    });

    const apex = compileOracleCard({
      oracleId: "apex",
      name: "Apex Altisaur",
      manaCost: "{8}{G}{G}",
      typeLine: "Creature — Dinosaur",
      power: "10",
      toughness: "10",
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "When this creature enters, it fights up to one target creature you don't control.\nEnrage — Whenever this creature is dealt damage, it fights up to one target creature you don't control.",
    });
    expect(apex.notes).toEqual([]);
    expect(apex.definition.triggers[1]?.event).toBe("is_dealt_damage");

    const prey = compileOracleCard({
      oracleId: "prey",
      name: "Prey Upon",
      manaCost: "{G}",
      typeLine: "Sorcery",
      power: null,
      toughness: null,
      printedKeywords: [],
      imageUrl: "",
      oracleText:
        "Target creature you control fights target creature you don't control. (Each deals damage equal to its power to the other.)",
    });
    expect(prey.notes).toEqual([]);
    expect(prey.definition.targetRequirements).toEqual([
      { kind: "creature", control: "own" },
      { kind: "creature", control: "not_own" },
    ]);
  });

  it("marks both fighters' damage from pre-fight powers", () => {
    const { game, p1, p2 } = twoPlayers();
    const bigDef = createCardDefinition({ name: "Big", typeLine: "Creature — Beast", power: 4, toughness: 5 });
    const smallDef = createCardDefinition({ name: "Small", typeLine: "Creature — Goblin", power: 2, toughness: 2 });
    game.definitions[bigDef.id] = bigDef;
    game.definitions[smallDef.id] = smallDef;
    const big = createCardInstance({ definitionId: bigDef.id, ownerId: p1.id, zone: "battlefield" });
    const small = createCardInstance({ definitionId: smallDef.id, ownerId: p2.id, zone: "battlefield" });
    game.cards[big.id] = big;
    game.cards[small.id] = small;
    p1.zones.battlefield.push(big.id);
    p2.zones.battlefield.push(small.id);

    const next = applyEffect(game, { kind: "fight", cardId: big.id, otherId: small.id });
    // The 2/2 dies to 4 damage; the 4/5 survives with 2 marked.
    expect(next.cards[small.id]?.zone).toBe("graveyard");
    expect(next.cards[big.id]?.zone).toBe("battlefield");
    expect(next.cards[big.id]?.damageMarked).toBe(2);
  });

  it("enrages when dealt noncombat damage", () => {
    const { game, p1 } = twoPlayers();
    fillLibraries(game, 10);
    const enragedDef = createCardDefinition({
      name: "Enraged",
      typeLine: "Creature — Dinosaur",
      power: 10,
      toughness: 10,
      triggers: [
        {
          event: "is_dealt_damage",
          effects: [{ kind: "draw", playerId: "controller", count: 1 }],
          targetRequirements: [],
        },
      ],
    });
    game.definitions[enragedDef.id] = enragedDef;
    const dino = createCardInstance({ definitionId: enragedDef.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[dino.id] = dino;
    p1.zones.battlefield.push(dino.id);
    const handBefore = p1.zones.hand.length;

    let next = applyEffect(game, {
      kind: "deal_damage",
      sourceId: null,
      target: { type: "creature", cardId: dino.id },
      amount: 3,
    });
    while (next.stack.length > 0) {
      next = resolveTopOfStack(next);
    }
    expect(next.players[0]?.zones.hand).toHaveLength(handBefore + 1);
  });
});
