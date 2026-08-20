import { describe, expect, it } from "vitest";
import { createCardDefinition, createCardInstance, createGameState } from "./createGame";
import {
  canPayWithPotential,
  hasMeaningfulAction,
  legalActions,
  potentialMana,
} from "./legalActions";
import { parseManaCost } from "./mana";
import type { CardDefinition, GameState, PlayerId } from "./types";

function addCard(
  game: GameState,
  definition: CardDefinition,
  ownerId: PlayerId,
  zone: "hand" | "battlefield" | "command" | "library",
  options: { tapped?: boolean; summoningSick?: boolean; commander?: boolean } = {},
): string {
  game.definitions[definition.id] = definition;
  const card = createCardInstance({
    definitionId: definition.id,
    ownerId,
    zone,
    summoningSick: options.summoningSick ?? false,
  });
  card.tapped = options.tapped ?? false;
  game.cards[card.id] = card;
  const player = game.players.find((entry) => entry.id === ownerId)!;
  player.zones[zone].push(card.id);
  if (options.commander) {
    player.commander.commanderIds.push(card.id);
  }
  return card.id;
}

function island(): CardDefinition {
  return createCardDefinition({
    name: "Test Island",
    typeLine: "Basic Land — Island",
    produces: { U: 1 },
  });
}

function mainPhase(game: GameState, playerId: PlayerId): void {
  game.turn.activePlayerId = playerId;
  game.turn.phase = "precombatMain";
  game.turn.step = "precombatMain";
  game.priorityPlayerId = playerId;
}

function twoPlayers(): { game: GameState; me: PlayerId; opponent: PlayerId } {
  const game = createGameState({ playerCount: 2 });
  const me = game.players[0]!.id;
  const opponent = game.players[1]!.id;
  return { game, me, opponent };
}

describe("canPayWithPotential", () => {
  it("matches pips onto option sets exactly, not greedily", () => {
    const potential = {
      fixed: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
      optionSets: [
        ["W", "U"],
        ["W"],
      ],
    } as const;
    expect(
      canPayWithPotential(
        { fixed: { ...potential.fixed }, optionSets: potential.optionSets.map((s) => [...s]) },
        parseManaCost("{W}{U}"),
      ),
    ).toBe(true);
  });

  it("counts leftovers toward generic", () => {
    const potential = {
      fixed: { W: 0, U: 1, B: 0, R: 0, G: 0, C: 2 },
      optionSets: [],
    };
    expect(canPayWithPotential(potential, parseManaCost("{2}{U}"))).toBe(true);
    expect(canPayWithPotential(potential, parseManaCost("{3}{U}"))).toBe(false);
  });

  it("pays hybrid pips from either color", () => {
    const potential = {
      fixed: { W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 },
      optionSets: [],
    };
    expect(canPayWithPotential(potential, parseManaCost("{B/R}"))).toBe(true);
    expect(canPayWithPotential(potential, parseManaCost("{W/U}"))).toBe(false);
  });
});

describe("legalActions: casting", () => {
  it("offers an instant off untapped lands on an opponent's turn", () => {
    const { game, me, opponent } = twoPlayers();
    mainPhase(game, opponent);
    addCard(game, island(), me, "battlefield");
    const bolt = createCardDefinition({
      name: "Test Instant",
      typeLine: "Instant",
      manaCost: "{U}",
    });
    const cardId = addCard(game, bolt, me, "hand");
    const actions = legalActions(game, me);
    expect(actions).toContainEqual({
      kind: "cast_spell",
      cardId,
      faceIndex: 0,
      fromCommand: false,
    });
    expect(hasMeaningfulAction(game, me)).toBe(true);
  });

  it("does not offer a sorcery outside the caster's own main phase", () => {
    const { game, me, opponent } = twoPlayers();
    mainPhase(game, opponent);
    addCard(game, island(), me, "battlefield");
    const sorcery = createCardDefinition({
      name: "Test Sorcery",
      typeLine: "Sorcery",
      manaCost: "{U}",
    });
    addCard(game, sorcery, me, "hand");
    expect(legalActions(game, me).filter((a) => a.kind === "cast_spell")).toEqual([]);
    mainPhase(game, me);
    expect(legalActions(game, me).filter((a) => a.kind === "cast_spell")).toHaveLength(1);
  });

  it("does not offer a spell the player cannot pay for", () => {
    const { game, me } = twoPlayers();
    mainPhase(game, me);
    addCard(game, island(), me, "battlefield");
    const big = createCardDefinition({
      name: "Test Big Instant",
      typeLine: "Instant",
      manaCost: "{U}{U}",
    });
    addCard(game, big, me, "hand");
    expect(legalActions(game, me).filter((a) => a.kind === "cast_spell")).toEqual([]);
  });

  it("counts color options from dual producers", () => {
    const { game, me } = twoPlayers();
    mainPhase(game, me);
    const dual = createCardDefinition({
      name: "Test Dual",
      typeLine: "Land",
      producesOptions: ["G", "W"],
    });
    addCard(game, dual, me, "battlefield");
    const white = createCardDefinition({ name: "Test White", typeLine: "Instant", manaCost: "{W}" });
    const blue = createCardDefinition({ name: "Test Blue", typeLine: "Instant", manaCost: "{U}" });
    addCard(game, white, me, "hand");
    addCard(game, blue, me, "hand");
    const casts = legalActions(game, me).filter((a) => a.kind === "cast_spell");
    expect(casts).toHaveLength(1);
  });

  it("ignores mana from summoning-sick creature producers", () => {
    const { game, me } = twoPlayers();
    mainPhase(game, me);
    const dork = createCardDefinition({
      name: "Test Dork",
      typeLine: "Creature — Elf",
      power: 1,
      toughness: 1,
      produces: { G: 1 },
    });
    addCard(game, dork, me, "battlefield", { summoningSick: true });
    const pump = createCardDefinition({ name: "Test Pump", typeLine: "Instant", manaCost: "{G}" });
    addCard(game, pump, me, "hand");
    expect(legalActions(game, me).filter((a) => a.kind === "cast_spell")).toEqual([]);
  });

  it("adds commander tax to command-zone casts", () => {
    const { game, me } = twoPlayers();
    mainPhase(game, me);
    const commander = createCardDefinition({
      name: "Test Commander",
      typeLine: "Legendary Creature — Dragon",
      manaCost: "{1}",
      power: 4,
      toughness: 4,
    });
    const commanderId = addCard(game, commander, me, "command", { commander: true });
    game.players[0]!.commander.tax = 2;
    addCard(game, island(), me, "battlefield");
    addCard(game, island(), me, "battlefield");
    expect(legalActions(game, me).filter((a) => a.kind === "cast_spell")).toEqual([]);
    addCard(game, island(), me, "battlefield");
    expect(legalActions(game, me)).toContainEqual({
      kind: "cast_spell",
      cardId: commanderId,
      faceIndex: 0,
      fromCommand: true,
    });
  });

  it("does not offer a targeted spell with no legal target", () => {
    const { game, me } = twoPlayers();
    mainPhase(game, me);
    addCard(game, island(), me, "battlefield");
    const removal = createCardDefinition({
      name: "Test Removal",
      typeLine: "Instant",
      manaCost: "{U}",
      targetRequirements: [{ kind: "creature" }],
      effects: [{ kind: "deal_damage", sourceId: null, target: { type: "chosen", index: 0 }, amount: 3 }],
    });
    addCard(game, removal, me, "hand");
    expect(legalActions(game, me).filter((a) => a.kind === "cast_spell")).toEqual([]);
    const bear = createCardDefinition({
      name: "Test Bear",
      typeLine: "Creature — Bear",
      power: 2,
      toughness: 2,
    });
    addCard(game, bear, me, "battlefield");
    expect(legalActions(game, me).filter((a) => a.kind === "cast_spell")).toHaveLength(1);
  });
});

describe("legalActions: lands, abilities, and meaning", () => {
  it("offers one land drop per turn", () => {
    const { game, me } = twoPlayers();
    mainPhase(game, me);
    const cardId = addCard(game, island(), me, "hand");
    expect(legalActions(game, me)).toContainEqual({ kind: "play_land", cardId, faceIndex: 0 });
    game.players[0]!.landsPlayedThisTurn = 1;
    expect(legalActions(game, me).filter((a) => a.kind === "play_land")).toEqual([]);
  });

  it("treats mana taps alone as not meaningful", () => {
    const { game, me, opponent } = twoPlayers();
    mainPhase(game, opponent);
    addCard(game, island(), me, "battlefield");
    const actions = legalActions(game, me);
    expect(actions.some((a) => a.kind === "mana")).toBe(true);
    expect(hasMeaningfulAction(game, me)).toBe(false);
  });

  it("offers battlefield activated abilities only when usable", () => {
    const { game, me, opponent } = twoPlayers();
    mainPhase(game, opponent);
    const oracle = createCardDefinition({
      name: "Test Oracle",
      typeLine: "Creature — Wizard",
      power: 1,
      toughness: 1,
      activated: [
        { tap: true, manaCost: "", effects: [{ kind: "draw", playerId: "controller", count: 1 }], targetRequirements: [] },
      ],
    });
    const cardId = addCard(game, oracle, me, "battlefield", { tapped: true });
    expect(legalActions(game, me).filter((a) => a.kind === "activate_ability")).toEqual([]);
    game.cards[cardId]!.tapped = false;
    expect(legalActions(game, me)).toContainEqual({
      kind: "activate_ability",
      cardId,
      abilityIndex: 0,
    });
    expect(hasMeaningfulAction(game, me)).toBe(true);
  });

  it("returns nothing for an eliminated player", () => {
    const { game, me } = twoPlayers();
    mainPhase(game, me);
    addCard(game, island(), me, "hand");
    game.players[0]!.lost = true;
    expect(legalActions(game, me)).toEqual([]);
  });
});

describe("potentialMana", () => {
  it("includes floating mana, fixed producers, and option sets", () => {
    const { game, me } = twoPlayers();
    game.players[0]!.mana.R = 1;
    addCard(game, island(), me, "battlefield");
    const dual = createCardDefinition({
      name: "Test Dual",
      typeLine: "Land",
      producesOptions: ["G", "W"],
    });
    addCard(game, dual, me, "battlefield");
    const tappedIsland = addCard(game, island(), me, "battlefield", { tapped: true });
    void tappedIsland;
    const potential = potentialMana(game, me);
    expect(potential.fixed.R).toBe(1);
    expect(potential.fixed.U).toBe(1);
    expect(potential.optionSets).toEqual([["G", "W"]]);
  });
});
