import { describe, expect, it } from "vitest";
import {
  applyEffect,
  createCardDefinition,
  createCardInstance,
  createGameState,
  creaturePower,
  creatureToughness,
} from "./index";

function twoPlayers() {
  const game = createGameState({ playerCount: 2 });
  const p1 = game.players[0];
  const p2 = game.players[1];
  if (!p1 || !p2) {
    throw new Error("need players");
  }
  return { game, p1, p2 };
}

describe("derived characteristics", () => {
  it("adds +1/+1 counters to power and toughness", () => {
    const { game, p1 } = twoPlayers();
    const definition = createCardDefinition({
      name: "Bear",
      typeLine: "Creature — Bear",
      power: 2,
      toughness: 2,
    });
    const card = createCardInstance({
      definitionId: definition.id,
      ownerId: p1.id,
      zone: "battlefield",
    });
    game.definitions[definition.id] = definition;
    game.cards[card.id] = card;
    p1.zones.battlefield.push(card.id);

    expect(creaturePower(game, card.id)).toBe(2);
    expect(creatureToughness(game, card.id)).toBe(2);
    const next = applyEffect(game, {
      kind: "add_counter",
      cardId: card.id,
      counter: "p1p1",
      amount: 3,
    });
    expect(creaturePower(next, card.id)).toBe(5);
    expect(creatureToughness(next, card.id)).toBe(5);
  });

  it("applies self and controlled-creature static P/T modifiers", () => {
    const { game, p1 } = twoPlayers();
    const lordDef = createCardDefinition({
      name: "Lord",
      typeLine: "Creature — Soldier",
      power: 2,
      toughness: 2,
      staticAbilities: [
        {
          selector: { scope: "controlled", types: ["creature"] },
          effect: { kind: "modify_pt", power: 1, toughness: 1 },
        },
      ],
    });
    const selfDef = createCardDefinition({
      name: "Pump",
      typeLine: "Creature — Spirit",
      power: 1,
      toughness: 1,
      staticAbilities: [
        { selector: { scope: "self" }, effect: { kind: "modify_pt", power: 2, toughness: 0 } },
      ],
    });
    const lord = createCardInstance({
      definitionId: lordDef.id,
      ownerId: p1.id,
      zone: "battlefield",
    });
    const pump = createCardInstance({
      definitionId: selfDef.id,
      ownerId: p1.id,
      zone: "battlefield",
    });
    game.definitions[lordDef.id] = lordDef;
    game.definitions[selfDef.id] = selfDef;
    game.cards[lord.id] = lord;
    game.cards[pump.id] = pump;
    p1.zones.battlefield.push(lord.id, pump.id);

    expect(creaturePower(game, lord.id)).toBe(3);
    expect(creatureToughness(game, lord.id)).toBe(3);
    expect(creaturePower(game, pump.id)).toBe(4);
    expect(creatureToughness(game, pump.id)).toBe(2);
  });
});
