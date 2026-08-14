import { describe, expect, it } from "vitest";
import { startSyntheticTable } from "./syntheticTable";
import { dispatchAction } from "./dispatch";

describe("UI action dispatch", () => {
  it("applies tap_for_mana through the engine and does not mutate the previous state", () => {
    let state = startSyntheticTable();
    const viewerId = state.players[0]?.id;
    if (!viewerId) {
      throw new Error("missing viewer");
    }
    while (state.turn.step !== "precombatMain") {
      const passed = dispatchAction(state, {
        kind: "pass_priority",
        playerId: state.priorityPlayerId,
      });
      if (!passed.ok) {
        throw new Error(passed.error);
      }
      state = passed.state;
    }
    const mountainId = state.players[0]?.zones.hand.find(
      (cardId) => state.definitions[state.cards[cardId]?.definitionId ?? ""]?.name === "Test Mountain",
    );
    if (!mountainId) {
      throw new Error("expected a mountain in hand");
    }
    const played = dispatchAction(state, {
      kind: "play_land",
      playerId: viewerId,
      cardId: mountainId,
    });
    if (!played.ok) {
      throw new Error(played.error);
    }
    const beforeTap = played.state;
    const tapped = dispatchAction(beforeTap, {
      kind: "tap_for_mana",
      playerId: viewerId,
      cardId: mountainId,
    });
    if (!tapped.ok) {
      throw new Error(tapped.error);
    }
    expect(beforeTap.cards[mountainId]?.tapped).toBe(false);
    expect(tapped.state.cards[mountainId]?.tapped).toBe(true);
    expect(tapped.state.players[0]?.mana.R).toBe(1);
  });
});
