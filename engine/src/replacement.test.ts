import { describe, expect, it } from "vitest";
import {
  applyEffect,
  createCardDefinition,
  createCardInstance,
  createGameState,
} from "./index";
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

describe("replacement effects", () => {
  it("skips a draw while a replace-draw permanent is controlled", () => {
    const { game, p1 } = twoPlayers();
    const skipDef = createCardDefinition({
      name: "Skip Draw",
      typeLine: "Enchantment",
      replacements: [{ kind: "replace_draw", instead: "skip" }],
    });
    const skip = createCardInstance({
      definitionId: skipDef.id,
      ownerId: p1.id,
      zone: "battlefield",
    });
    const libDef = createCardDefinition({ name: "Island", typeLine: "Basic Land — Island" });
    const libCard = createCardInstance({
      definitionId: libDef.id,
      ownerId: p1.id,
      zone: "library",
    });
    game.definitions[skipDef.id] = skipDef;
    game.definitions[libDef.id] = libDef;
    game.cards[skip.id] = skip;
    game.cards[libCard.id] = libCard;
    p1.zones.battlefield.push(skip.id);
    p1.zones.library.push(libCard.id);

    const drawn = applyEffect(game, { kind: "draw", playerId: p1.id, count: 1 });
    expect(drawn.players[0]?.zones.hand).toEqual([]);
    expect(drawn.players[0]?.zones.library).toEqual([libCard.id]);

    const atDraw = advanceSteps(game, 2);
    expect(atDraw.turn.step).toBe("draw");
    expect(atDraw.players[0]?.zones.hand).toEqual([]);
    expect(atDraw.players[0]?.zones.library).toEqual([libCard.id]);
  });
});
