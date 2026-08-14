import { describe, expect, it } from "vitest";
import {
  HIDDEN_DEFINITION_ID,
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
});
