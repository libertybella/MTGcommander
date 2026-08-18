import { describe, expect, it } from "vitest";
import {
  addMana,
  applyAction,
  applyEffect,
  compileOracleCard,
  createCardDefinition,
  createCardInstance,
  createGameState,
  creaturePower,
  creatureToughness,
  currentPrompt,
  legalIdsForChooseSources,
  parseGameAction,
  parseGameState,
  redactForViewer,
  serializeGameAction,
  serializeGameState,
  tokenTemplatesOf,
  type CardDefinition,
  type GameState,
} from "./index";
import { fillLibraries } from "./testSupport";
import { advanceSteps } from "./turn";

function twoPlayers() {
  const game = createGameState({ playerCount: 2 });
  const p1 = game.players[0];
  const p2 = game.players[1];
  if (!p1 || !p2) {
    throw new Error("need players");
  }
  return { game, p1, p2 };
}

function threePlayers() {
  const game = createGameState({ playerCount: 3 });
  const p1 = game.players[0];
  const p2 = game.players[1];
  const p3 = game.players[2];
  if (!p1 || !p2 || !p3) {
    throw new Error("need players");
  }
  return { game, p1, p2, p3 };
}

function toPrecombatMain(game: GameState): GameState {
  fillLibraries(game);
  return advanceSteps(game, 3);
}

function addToHand(game: GameState, ownerId: string, definition: CardDefinition) {
  const owner = game.players.find((player) => player.id === ownerId);
  if (!owner) {
    throw new Error("missing owner");
  }
  game.definitions[definition.id] = definition;
  const card = createCardInstance({
    definitionId: definition.id,
    ownerId,
    zone: "hand",
  });
  game.cards[card.id] = card;
  owner.zones.hand.push(card.id);
  return card;
}

function addToZone(
  game: GameState,
  ownerId: string,
  definition: CardDefinition,
  zone: "hand" | "graveyard" | "library" | "battlefield",
) {
  const owner = game.players.find((player) => player.id === ownerId);
  if (!owner) {
    throw new Error("missing owner");
  }
  game.definitions[definition.id] = definition;
  const card = createCardInstance({
    definitionId: definition.id,
    ownerId,
    zone,
  });
  game.cards[card.id] = card;
  owner.zones[zone].push(card.id);
  return card;
}

function passUntilEmptyStack(game: GameState): GameState {
  let next = game;
  let guard = 0;
  while (next.stack.length > 0) {
    next = applyAction(next, { kind: "pass_priority", playerId: next.priorityPlayerId });
    guard += 1;
    if (guard > 40) {
      throw new Error("stack did not clear");
    }
  }
  return next;
}

function armyOnBattlefield(state: GameState, playerId: string) {
  const player = state.players.find((entry) => entry.id === playerId);
  return player?.zones.battlefield.filter((cardId) => {
    const typeLine = state.definitions[state.cards[cardId]?.definitionId ?? ""]?.typeLine.toLowerCase() ?? "";
    return typeLine.includes("army");
  });
}

describe("amass", () => {
  it("creates an Orc Army when none exists and stacks counters on a later amass", () => {
    const { game, p1 } = twoPlayers();
    let next = applyEffect(game, { kind: "amass", playerId: p1.id, amount: 1, subtype: "Orc" });
    const armies = armyOnBattlefield(next, p1.id);
    expect(armies).toHaveLength(1);
    const armyId = armies![0]!;
    expect(next.definitions[next.cards[armyId]?.definitionId ?? ""]?.name).toBe("Orc Army");
    expect(creaturePower(next, armyId)).toBe(1);
    expect(creatureToughness(next, armyId)).toBe(1);

    next = applyEffect(next, { kind: "amass", playerId: p1.id, amount: 2, subtype: "Orc" });
    expect(armyOnBattlefield(next, p1.id)).toEqual([armyId]);
    expect(creaturePower(next, armyId)).toBe(3);
    expect(creatureToughness(next, armyId)).toBe(3);
  });

  it("creates an Army from March from the Black Gate entering", () => {
    const { game, p1, p2 } = twoPlayers();
    const compiled = compileOracleCard({
      oracleId: "march",
      name: "March from the Black Gate",
      manaCost: "{1}{B}",
      typeLine: "Enchantment",
      oracleText:
        "When March from the Black Gate enters the battlefield and whenever an Army you control attacks, amass Orcs 1.",
      power: null,
      toughness: null,
      printedKeywords: [],
    });
    const card = addToHand(game, p1.id, compiled.definition);
    let next = toPrecombatMain(game);
    next = addMana(next, p1.id, { C: 1, B: 1 });
    next = applyAction(next, { kind: "cast_spell", playerId: p1.id, cardId: card.id });
    next = applyAction(next, { kind: "pass_priority", playerId: p1.id });
    next = applyAction(next, { kind: "pass_priority", playerId: p2.id });
    next = passUntilEmptyStack(next);
    const armies = armyOnBattlefield(next, p1.id);
    expect(armies).toHaveLength(1);
    expect(creaturePower(next, armies![0]!)).toBe(1);
  });

  it("lists an Army token on leftover attack-amass cards for the right-click override", () => {
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
    expect(tokenTemplatesOf(rider.definition)).toEqual([
      { name: "Orc Army", typeLine: "Creature — Orc Army Token", power: 1, toughness: 1 },
    ]);
  });
});

describe("discard unless attacked", () => {
  it("asks for a discard when Chart a Course resolves and the player did not attack", () => {
    const { game, p1, p2 } = twoPlayers();
    const compiled = compileOracleCard({
      oracleId: "chart",
      name: "Chart a Course",
      manaCost: "{1}{U}",
      typeLine: "Sorcery",
      oracleText: "Draw two cards. Then discard a card unless you attacked this turn.",
      power: null,
      toughness: null,
      printedKeywords: [],
    });
    const extra = addToHand(game, p1.id, createCardDefinition({ name: "Keep", typeLine: "Instant" }));
    const card = addToHand(game, p1.id, compiled.definition);
    let next = toPrecombatMain(game);
    const handBefore = next.players[0]!.zones.hand.length;
    next = addMana(next, p1.id, { C: 1, U: 1 });
    next = applyAction(next, { kind: "cast_spell", playerId: p1.id, cardId: card.id });
    next = applyAction(next, { kind: "pass_priority", playerId: p1.id });
    next = applyAction(next, { kind: "pass_priority", playerId: p2.id });
    expect(next.players[0]!.zones.hand.length).toBe(handBefore - 1 + 2);
    const prompt = currentPrompt(next);
    expect(prompt?.kind).toBe("choose_discard");
    next = applyAction(next, { kind: "resolve_discard", playerId: p1.id, cardIds: [extra.id] });
    expect(next.cards[extra.id]?.zone).toBe("graveyard");
    expect(currentPrompt(next)).toBeNull();
  });

  it("skips the discard if the player attacked this turn", () => {
    const { game, p1 } = twoPlayers();
    p1.attackedThisTurn = true;
    const next = applyEffect(game, { kind: "discard_unless_attacked", playerId: p1.id, count: 1 });
    expect(currentPrompt(next)).toBeNull();
    expect(next.players[0]?.zones.hand).toEqual(p1.zones.hand);
  });
});

describe("private hand reveal and choose", () => {
  it("reveals the targeted hand only to the caster, then exiles the chosen card and loses 1 life", () => {
    const { game, p1, p2, p3 } = threePlayers();
    const compiled = compileOracleCard({
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
    const land = addToHand(
      game,
      p2.id,
      createCardDefinition({ name: "Island", typeLine: "Basic Land — Island" }),
    );
    const secret = addToHand(
      game,
      p2.id,
      createCardDefinition({ name: "Secret", typeLine: "Instant" }),
    );
    const gy = addToZone(
      game,
      p2.id,
      createCardDefinition({ name: "Gone", typeLine: "Creature — Rat", power: 1, toughness: 1 }),
      "graveyard",
    );
    const spell = addToHand(game, p1.id, compiled.definition);
    let next = toPrecombatMain(game);
    expect(() =>
      applyAction(addMana(next, p1.id, { C: 1, B: 1 }), {
        kind: "cast_spell",
        playerId: p1.id,
        cardId: spell.id,
        targets: [{ type: "player", playerId: p1.id }],
      }),
    ).toThrow(/Illegal target/);

    next = addMana(next, p1.id, { C: 1, B: 1 });
    next = applyAction(next, {
      kind: "cast_spell",
      playerId: p1.id,
      cardId: spell.id,
      targets: [{ type: "player", playerId: p2.id }],
    });
    next = passUntilEmptyStack(next);

    const prompt = currentPrompt(next);
    expect(prompt?.kind).toBe("choose_card");
    expect(next.reveals[0]?.viewerId).toBe(p1.id);
    expect(next.reveals[0]?.cardIds).toEqual(expect.arrayContaining([land.id, secret.id]));

    const casterView = redactForViewer(next, p1.id);
    expect(casterView.definitions[casterView.cards[secret.id]?.definitionId ?? ""]?.name).toBe("Secret");
    const otherView = redactForViewer(next, p3.id);
    expect(otherView.definitions[otherView.cards[secret.id]?.definitionId ?? ""]?.name).toBe("Unknown Card");

    expect(legalIdsForChooseSources(next, prompt && prompt.kind === "choose_card" ? prompt.sources : [])).toEqual(
      expect.arrayContaining([secret.id, gy.id]),
    );
    expect(legalIdsForChooseSources(next, prompt && prompt.kind === "choose_card" ? prompt.sources : [])).not.toContain(
      land.id,
    );

    next = applyAction(next, { kind: "resolve_choose_card", playerId: p1.id, cardId: secret.id });
    expect(next.cards[secret.id]?.zone).toBe("exile");
    expect(next.players[0]?.life).toBe(39);
    expect(next.reveals).toEqual([]);
    expect(currentPrompt(next)).toBeNull();
  });
});

describe("look and assign", () => {
  it("puts one looked card in hand, one on the bottom, and one in exile", () => {
    const { game, p1, p2 } = twoPlayers();
    const compiled = compileOracleCard({
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
    const spell = addToHand(game, p1.id, compiled.definition);
    let next = toPrecombatMain(game);
    const top = addToZone(
      next,
      p1.id,
      createCardDefinition({ name: "Top", typeLine: "Instant" }),
      "library",
    );
    const mid = addToZone(
      next,
      p1.id,
      createCardDefinition({ name: "Mid", typeLine: "Instant" }),
      "library",
    );
    const bottomLook = addToZone(
      next,
      p1.id,
      createCardDefinition({ name: "BottomLook", typeLine: "Instant" }),
      "library",
    );
    const library = next.players[0]!.zones.library.filter(
      (cardId) => cardId !== top.id && cardId !== mid.id && cardId !== bottomLook.id,
    );
    next.players[0]!.zones.library = [top.id, mid.id, bottomLook.id, ...library];
    next = addMana(next, p1.id, { U: 1, R: 1 });
    next = applyAction(next, { kind: "cast_spell", playerId: p1.id, cardId: spell.id });
    next = applyAction(next, { kind: "pass_priority", playerId: p1.id });
    next = applyAction(next, { kind: "pass_priority", playerId: p2.id });
    const prompt = currentPrompt(next);
    expect(prompt?.kind).toBe("look_and_assign");
    next = applyAction(next, {
      kind: "resolve_look_assign",
      playerId: p1.id,
      assignments: [
        { cardId: top.id, destination: "hand" },
        { cardId: mid.id, destination: "library_bottom" },
        { cardId: bottomLook.id, destination: "exile" },
      ],
    });
    expect(next.cards[top.id]?.zone).toBe("hand");
    expect(next.players[0]?.zones.library.at(-1)).toBe(mid.id);
    expect(next.cards[bottomLook.id]?.zone).toBe("exile");
  });
});

describe("override create token", () => {
  it("creates a listed token for the acting player", () => {
    const { game, p1 } = twoPlayers();
    const action = {
      kind: "manual_override" as const,
      playerId: p1.id,
      change: {
        type: "create_token" as const,
        template: {
          name: "Orc Army",
          typeLine: "Creature — Orc Army Token",
          power: 1,
          toughness: 1,
        },
      },
    };
    expect(parseGameAction(serializeGameAction(action))).toEqual(action);
    const next = applyAction(game, action);
    const armies = armyOnBattlefield(next, p1.id);
    expect(armies).toHaveLength(1);
    expect(parseGameState(serializeGameState(next))).toEqual(next);
  });
});
