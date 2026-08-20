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
  resolveTopOfStack,
} from "./index";
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
