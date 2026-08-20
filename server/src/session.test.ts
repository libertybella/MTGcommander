import { describe, expect, it, vi } from "vitest";
import {
  HIDDEN_DEFINITION_ID,
  createCardDefinition,
  createCardInstance,
  createGameState,
  moveCard,
  startCatalogGame,
  POOL_ID,
} from "@mtgcommander/engine";
import { GameHost } from "./session";
import { clearTable, loadTable, saveTable, type SnapshotStore } from "./persist";

function memoryStore(): SnapshotStore {
  const data = new Map<string, string>();
  return {
    getItem(key) {
      return data.get(key) ?? null;
    },
    setItem(key, value) {
      data.set(key, value);
    },
    removeItem(key) {
      data.delete(key);
    },
  };
}

function twoPlayerTable() {
  const state = startCatalogGame({
    playerCount: 2,
    playerNames: ["You", "Opponent"],
    openingHandSize: 7,
    decks: [
      {
        commanderDefinitionId: POOL_ID.dragon,
        libraryDefinitionIds: [
          POOL_ID.mountain,
          POOL_ID.shock,
          POOL_ID.forest,
          POOL_ID.bear,
          POOL_ID.plains,
          POOL_ID.gift,
          POOL_ID.island,
          POOL_ID.swamp,
          POOL_ID.ritual,
        ],
      },
      {
        commanderDefinitionId: POOL_ID.dragon,
        libraryDefinitionIds: [
          POOL_ID.mountain,
          POOL_ID.shock,
          POOL_ID.forest,
          POOL_ID.bear,
          POOL_ID.plains,
          POOL_ID.gift,
          POOL_ID.island,
          POOL_ID.swamp,
          POOL_ID.ritual,
        ],
      },
    ],
  });
  const viewerId = state.players[0]?.id;
  const opponentId = state.players[1]?.id;
  if (!viewerId || !opponentId) {
    throw new Error("need players");
  }
  return { host: GameHost.start(state, viewerId), viewerId, opponentId };
}

describe("game host session", () => {
  it("rejects acting as another player and leaves authority unchanged", () => {
    const { host, viewerId, opponentId } = twoPlayerTable();
    const before = host.viewFor(viewerId).players[0]?.life;
    const result = host.submit(viewerId, { kind: "pass_priority", playerId: opponentId });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected rejection");
    }
    expect(result.error).toMatch(/another player/);
    expect(host.viewFor(viewerId).players[0]?.life).toBe(before);
  });

  it("rejects illegal actions without changing life, mana, or zones", () => {
    const { host, viewerId } = twoPlayerTable();
    const before = host.serializeAuthority();
    const view = host.viewFor(viewerId);
    const shockId = view.players[0]?.zones.hand.find(
      (cardId) => view.definitions[view.cards[cardId]?.definitionId ?? ""]?.name === "Test Shock",
    );
    if (!shockId) {
      throw new Error("expected shock");
    }
    const result = host.submit(viewerId, {
      kind: "cast_spell",
      playerId: viewerId,
      cardId: shockId,
    });
    expect(result.ok).toBe(false);
    expect(host.serializeAuthority()).toBe(before);
  });

  it("does not let a mutated player view change host life or mana", () => {
    const { host, viewerId } = twoPlayerTable();
    const view = host.viewFor(viewerId);
    if (view.players[0]) {
      view.players[0].life = 1;
      view.players[0].mana.R = 99;
    }
    const fresh = host.viewFor(viewerId);
    expect(fresh.players[0]?.life).toBe(40);
    expect(fresh.players[0]?.mana.R).toBe(0);
  });

  it("hides opponent hand and library identity from the viewer", () => {
    const { host, viewerId, opponentId } = twoPlayerTable();
    const view = host.viewFor(viewerId);
    const opponent = view.players.find((player) => player.id === opponentId);
    if (!opponent) {
      throw new Error("missing opponent");
    }
    for (const cardId of [...opponent.zones.hand, ...opponent.zones.library]) {
      expect(view.cards[cardId]?.definitionId).toBe(HIDDEN_DEFINITION_ID);
    }
    const you = view.players.find((player) => player.id === viewerId);
    const known = you?.zones.hand[0];
    expect(view.cards[known ?? ""]?.definitionId).not.toBe(HIDDEN_DEFINITION_ID);
  });

  it("saves and restores the table after an action", () => {
    const { host, viewerId } = twoPlayerTable();
    let current = host;
    while (current.viewFor(viewerId).turn.step !== "precombatMain") {
      const passed = current.submit(viewerId, {
        kind: "pass_priority",
        playerId: viewerId,
      });
      if (!passed.ok) {
        throw new Error(passed.error);
      }
    }
    const view = current.viewFor(viewerId);
    const mountainId = view.players[0]?.zones.hand.find(
      (cardId) => view.definitions[view.cards[cardId]?.definitionId ?? ""]?.name === "Test Mountain",
    );
    if (!mountainId) {
      throw new Error("expected mountain");
    }
    const played = current.submit(viewerId, {
      kind: "play_land",
      playerId: viewerId,
      cardId: mountainId,
    });
    if (!played.ok) {
      throw new Error(played.error);
    }
    const store = memoryStore();
    saveTable(store, current);
    const restored = loadTable(store);
    if (!restored) {
      throw new Error("expected snapshot");
    }
    expect(restored.viewFor(viewerId).cards[mountainId]?.zone).toBe("battlefield");
    expect(restored.viewFor(viewerId).turn.step).toBe("precombatMain");
    clearTable(store);
    expect(loadTable(store)).toBeNull();
  });

  it("does not auto-pass opponents in hotseat", () => {
    const state = startCatalogGame({
      playerCount: 2,
      playerNames: ["You", "Opponent"],
      openingHandSize: 7,
      decks: [
        {
          commanderDefinitionId: POOL_ID.dragon,
          libraryDefinitionIds: [
            POOL_ID.mountain,
            POOL_ID.shock,
            POOL_ID.forest,
            POOL_ID.bear,
            POOL_ID.plains,
            POOL_ID.gift,
            POOL_ID.island,
          ],
        },
        {
          commanderDefinitionId: POOL_ID.dragon,
          libraryDefinitionIds: [
            POOL_ID.mountain,
            POOL_ID.shock,
            POOL_ID.forest,
            POOL_ID.bear,
            POOL_ID.plains,
            POOL_ID.gift,
            POOL_ID.island,
          ],
        },
      ],
    });
    const you = state.players[0]?.id;
    const them = state.players[1]?.id;
    if (!you || !them) {
      throw new Error("need players");
    }
    const host = GameHost.start(state, you, { hotseat: true });
    const passed = host.submit(you, { kind: "pass_priority", playerId: you });
    expect(passed.ok).toBe(true);
    expect(host.viewFor(you).priorityPlayerId).toBe(you);
    expect(host.viewFor(you).turn.step).toBe("upkeep");
    host.setViewer(them);
    expect(host.getViewerId()).toBe(them);
    const asOpponent = host.viewFor(them);
    const theirHand = asOpponent.players.find((player) => player.id === them)?.zones.hand[0];
    expect(asOpponent.cards[theirHand ?? ""]?.definitionId).not.toBe(HIDDEN_DEFINITION_ID);
    const yourCard = asOpponent.players.find((player) => player.id === you)?.zones.hand[0];
    expect(asOpponent.cards[yourCard ?? ""]?.definitionId).toBe(HIDDEN_DEFINITION_ID);
    const open = host.viewFor(them, { revealHidden: true });
    expect(open.cards[yourCard ?? ""]?.definitionId).not.toBe(HIDDEN_DEFINITION_ID);
  });

  it("undoes the seated player's last action including auto-passes", () => {
    const { host, viewerId } = twoPlayerTable();
    while (host.viewFor(viewerId).turn.step !== "precombatMain") {
      const passed = host.submit(viewerId, { kind: "pass_priority", playerId: viewerId });
      if (!passed.ok) {
        throw new Error(passed.error);
      }
    }
    const view = host.viewFor(viewerId);
    const mountainId = view.players[0]?.zones.hand.find(
      (cardId) => view.definitions[view.cards[cardId]?.definitionId ?? ""]?.name === "Test Mountain",
    );
    if (!mountainId) {
      throw new Error("expected mountain");
    }
    const played = host.submit(viewerId, { kind: "play_land", playerId: viewerId, cardId: mountainId });
    if (!played.ok) {
      throw new Error(played.error);
    }
    const tapped = host.submit(viewerId, { kind: "tap_for_mana", playerId: viewerId, cardId: mountainId });
    if (!tapped.ok) {
      throw new Error(tapped.error);
    }
    expect(host.viewFor(viewerId).cards[mountainId]?.tapped).toBe(true);
    expect(host.viewFor(viewerId).players[0]?.mana.R).toBe(1);
    const undone = host.submit(viewerId, { kind: "undo", playerId: viewerId });
    expect(undone.ok).toBe(true);
    expect(host.viewFor(viewerId).cards[mountainId]?.tapped).toBe(false);
    expect(host.viewFor(viewerId).players[0]?.mana.R).toBe(0);
    expect(host.viewFor(viewerId).cards[mountainId]?.zone).toBe("battlefield");
  });

  it("rejects undoing another player's last action", () => {
    const state = startCatalogGame({
      playerCount: 2,
      playerNames: ["You", "Opponent"],
      openingHandSize: 7,
      decks: [
        {
          commanderDefinitionId: POOL_ID.dragon,
          libraryDefinitionIds: [POOL_ID.mountain, POOL_ID.shock, POOL_ID.forest, POOL_ID.bear],
        },
        {
          commanderDefinitionId: POOL_ID.dragon,
          libraryDefinitionIds: [POOL_ID.mountain, POOL_ID.shock, POOL_ID.forest, POOL_ID.bear],
        },
      ],
    });
    const you = state.players[0]?.id;
    const them = state.players[1]?.id;
    if (!you || !them) {
      throw new Error("need players");
    }
    const host = GameHost.start(state, you, { hotseat: true });
    const passed = host.submit(you, { kind: "pass_priority", playerId: you });
    expect(passed.ok).toBe(true);
    const blocked = host.submit(them, { kind: "undo", playerId: them });
    expect(blocked.ok).toBe(false);
    if (blocked.ok) {
      throw new Error("expected rejection");
    }
    expect(blocked.error).toMatch(/your last action/i);
    const allowed = host.submit(you, { kind: "undo", playerId: you });
    expect(allowed.ok).toBe(true);
    expect(host.viewFor(you).priorityPlayerId).toBe(you);
  });

  it("auto-rolls unseated players for first player", () => {
    const state = startCatalogGame({
      playerCount: 2,
      playerNames: ["You", "Opponent"],
      skipMulligan: false,
      openingHandSize: 7,
      decks: [
        {
          commanderDefinitionId: POOL_ID.dragon,
          libraryDefinitionIds: [POOL_ID.mountain, POOL_ID.shock, POOL_ID.forest, POOL_ID.bear],
        },
        {
          commanderDefinitionId: POOL_ID.dragon,
          libraryDefinitionIds: [POOL_ID.mountain, POOL_ID.shock, POOL_ID.forest, POOL_ID.bear],
        },
      ],
    });
    const you = state.players[0]?.id;
    const them = state.players[1]?.id;
    if (!you || !them) {
      throw new Error("need players");
    }
    const random = vi.spyOn(Math, "random");
    random.mockReturnValueOnce(0.999).mockReturnValueOnce(0);
    const host = GameHost.start(state, you);
    expect(host.viewFor(you).openingRoll?.rolls[them]).toBeUndefined();
    expect(host.viewFor(you).openingRoll?.rolls[you]).toBeUndefined();
    const rolled = host.submit(you, { kind: "opening_roll", playerId: you });
    expect(rolled.ok).toBe(true);
    expect(host.viewFor(you).openingRoll).toBeNull();
    expect(host.viewFor(you).turn.activePlayerId).toBe(you);
    expect(host.viewFor(you).mulligan?.decidingPlayerId).toBe(you);
    random.mockRestore();
  });

  it("waits for other seated players to roll before choosing first player", () => {
    const state = startCatalogGame({
      playerCount: 2,
      playerNames: ["You", "Opponent"],
      skipMulligan: false,
      openingHandSize: 7,
      decks: [
        {
          commanderDefinitionId: POOL_ID.dragon,
          libraryDefinitionIds: [POOL_ID.mountain, POOL_ID.shock, POOL_ID.forest, POOL_ID.bear],
        },
        {
          commanderDefinitionId: POOL_ID.dragon,
          libraryDefinitionIds: [POOL_ID.mountain, POOL_ID.shock, POOL_ID.forest, POOL_ID.bear],
        },
      ],
    });
    const you = state.players[0]?.id;
    const them = state.players[1]?.id;
    if (!you || !them) {
      throw new Error("need players");
    }
    const host = GameHost.start(state, you, { hotseat: true });
    // Distinct mocked rolls: a real random tie legitimately re-rolls.
    const random = vi.spyOn(Math, "random");
    random.mockReturnValueOnce(0.1).mockReturnValueOnce(0.9);
    const rolled = host.submit(you, { kind: "opening_roll", playerId: you });
    expect(rolled.ok).toBe(true);
    expect(host.viewFor(you).openingRoll?.rolls[you]).toEqual(expect.any(Number));
    expect(host.viewFor(you).openingRoll?.rolls[them]).toBeUndefined();
    expect(host.viewFor(you).mulligan).toBeNull();
    const second = host.submit(them, { kind: "opening_roll", playerId: them });
    expect(second.ok).toBe(true);
    expect(host.viewFor(you).openingRoll).toBeNull();
    expect(host.viewFor(you).mulligan).not.toBeNull();
    random.mockRestore();
  });

  it("leaves the unseated opening-roll winner as the first player after keeps", () => {
    const state = startCatalogGame({
      playerCount: 2,
      playerNames: ["You", "Opponent"],
      skipMulligan: false,
      openingHandSize: 7,
      decks: [
        {
          commanderDefinitionId: POOL_ID.dragon,
          libraryDefinitionIds: [POOL_ID.mountain, POOL_ID.shock, POOL_ID.forest, POOL_ID.bear],
        },
        {
          commanderDefinitionId: POOL_ID.dragon,
          libraryDefinitionIds: [POOL_ID.mountain, POOL_ID.shock, POOL_ID.forest, POOL_ID.bear],
        },
      ],
    });
    const you = state.players[0]?.id;
    const them = state.players[1]?.id;
    if (!you || !them) {
      throw new Error("need players");
    }
    const random = vi.spyOn(Math, "random");
    random.mockReturnValueOnce(0).mockReturnValueOnce(0.999);
    const host = GameHost.start(state, you);
    const rolled = host.submit(you, { kind: "opening_roll", playerId: you });
    expect(rolled.ok).toBe(true);
    expect(host.viewFor(you).mulligan?.decidingPlayerId).toBe(you);
    const kept = host.submit(you, { kind: "keep_hand", playerId: you });
    expect(kept.ok).toBe(true);
    const view = host.viewFor(you);
    expect(view.mulligan).toBeNull();
    expect(view.turn.activePlayerId).toBe(them);
    expect(view.priorityPlayerId).toBe(them);
    expect(view.turn.step).toBe("upkeep");
    random.mockRestore();
  });

  it("does not auto-play an unseated player's turn", () => {
    const { host, viewerId, opponentId } = twoPlayerTable();
    const skipped = host.submit(viewerId, { kind: "advance_turn", playerId: viewerId });
    expect(skipped.ok).toBe(true);
    const view = host.viewFor(viewerId);
    expect(view.turn.activePlayerId).toBe(opponentId);
    expect(view.priorityPlayerId).toBe(opponentId);
    expect(view.turn.step).toBe("untap");
  });

  it("auto-picks the first legal target for an unseated player's trigger", () => {
    const game = createGameState({ playerCount: 2, playerNames: ["You", "Opponent"] });
    const you = game.players[0];
    const them = game.players[1];
    if (!you || !them) {
      throw new Error("need players");
    }
    const prey = createCardDefinition({
      name: "Prey",
      typeLine: "Creature — Beast",
      power: 2,
      toughness: 2,
    });
    const sage = createCardDefinition({
      name: "Sage",
      typeLine: "Creature — Elf",
      power: 2,
      toughness: 1,
      triggers: [
        {
          event: "enter_battlefield",
          effects: [{ kind: "move_card", cardId: { type: "chosen", index: 0 }, toZone: "graveyard" }],
          targetRequirements: [{ kind: "creature" }],
        },
      ],
    });
    const preyCard = createCardInstance({
      definitionId: prey.id,
      ownerId: you.id,
      zone: "battlefield",
    });
    const sageCard = createCardInstance({
      definitionId: sage.id,
      ownerId: them.id,
      zone: "hand",
    });
    game.definitions[prey.id] = prey;
    game.definitions[sage.id] = sage;
    game.cards[preyCard.id] = preyCard;
    game.cards[sageCard.id] = sageCard;
    you.zones.battlefield.push(preyCard.id);
    them.zones.hand.push(sageCard.id);

    const entered = moveCard(game, sageCard.id, "battlefield");
    expect(entered.prompts).toHaveLength(1);

    const host = GameHost.start(entered, you.id);
    const view = host.viewFor(you.id);
    expect(view.prompts).toEqual([]);
    expect(view.stack).toHaveLength(1);
    expect(view.stack[0]?.targets).toEqual([{ type: "creature", cardId: preyCard.id }]);
    expect(view.cards[preyCard.id]?.zone).toBe("battlefield");

    const passed = host.submit(you.id, { kind: "pass_priority", playerId: you.id });
    expect(passed.ok).toBe(true);
    const after = host.viewFor(you.id);
    expect(after.stack).toHaveLength(0);
    expect(after.cards[preyCard.id]?.zone).toBe("graveyard");
    expect(after.cards[sageCard.id]?.zone).toBe("battlefield");
  });
});
