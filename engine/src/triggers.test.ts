import { describe, expect, it } from "vitest";
import {
  applyAction,
  applyEffect,
  createCardDefinition,
  createCardInstance,
  createGameState,
  moveCard,
  parseGameState,
  serializeGameState,
  skipPriorityShortcuts,
  advanceStep,
} from "./index";
import type { GameState } from "./types";

function twoPlayers() {
  const game = createGameState({ playerCount: 2 });
  const p1 = game.players[0];
  const p2 = game.players[1];
  if (!p1 || !p2) {
    throw new Error("need players");
  }
  return { game, p1, p2 };
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

describe("triggered abilities", () => {
  it("puts an enter-the-battlefield trigger on the stack and resolves its effects", () => {
    const { game, p1 } = twoPlayers();
    const definition = createCardDefinition({
      name: "ETB Cleric",
      typeLine: "Creature — Cleric",
      power: 1,
      toughness: 1,
      triggers: [
        {
          event: "enter_battlefield",
          effects: [{ kind: "gain_life", playerId: "controller", amount: 3 }],
        },
      ],
    });
    const card = createCardInstance({
      definitionId: definition.id,
      ownerId: p1.id,
      zone: "hand",
    });
    game.definitions[definition.id] = definition;
    game.cards[card.id] = card;
    p1.zones.hand.push(card.id);

    const entered = moveCard(game, card.id, "battlefield");
    expect(entered.cards[card.id]?.zone).toBe("battlefield");
    expect(entered.stack).toHaveLength(1);
    expect(entered.stack[0]?.kind).toBe("ability");
    expect(entered.stack[0]?.sourceId).toBe(card.id);
    expect(entered.players[0]?.life).toBe(40);

    const resolved = passUntilEmptyStack(entered);
    expect(resolved.stack).toHaveLength(0);
    expect(resolved.players[0]?.life).toBe(43);
    expect(resolved.cards[card.id]?.zone).toBe("battlefield");
  });

  it("pauses a targeted enter trigger until the controller chooses a target", () => {
    const { game, p1, p2 } = twoPlayers();
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
      ownerId: p2.id,
      zone: "battlefield",
    });
    const sageCard = createCardInstance({
      definitionId: sage.id,
      ownerId: p1.id,
      zone: "hand",
    });
    game.definitions[prey.id] = prey;
    game.definitions[sage.id] = sage;
    game.cards[preyCard.id] = preyCard;
    game.cards[sageCard.id] = sageCard;
    p2.zones.battlefield.push(preyCard.id);
    p1.zones.hand.push(sageCard.id);

    const entered = moveCard(game, sageCard.id, "battlefield");
    expect(entered.stack).toHaveLength(0);
    expect(entered.prompts).toEqual([
      {
        kind: "choose_targets",
        playerId: p1.id,
        sourceId: sageCard.id,
        origin: "trigger",
        triggerIndex: 0,
        requirements: [{ kind: "creature" }],
        subjectCardId: sageCard.id,
        subjectPlayerId: p1.id,
      },
    ]);
    expect(() =>
      applyAction(entered, { kind: "pass_priority", playerId: entered.priorityPlayerId }),
    ).toThrow(/pending choice/);

    const chosen = applyAction(entered, {
      kind: "choose_targets",
      playerId: p1.id,
      targets: [{ type: "creature", cardId: preyCard.id }],
    });
    expect(chosen.prompts).toEqual([]);
    expect(chosen.stack).toHaveLength(1);
    expect(chosen.stack[0]?.targets).toEqual([{ type: "creature", cardId: preyCard.id }]);

    const resolved = passUntilEmptyStack(chosen);
    expect(resolved.cards[preyCard.id]?.zone).toBe("graveyard");
    expect(resolved.cards[sageCard.id]?.zone).toBe("battlefield");

    const restored = parseGameState(serializeGameState(entered));
    expect(restored.prompts).toEqual(entered.prompts);
  });

  it("skips a targeted enter trigger when no legal target exists", () => {
    const { game, p1 } = twoPlayers();
    const edict = createCardDefinition({
      name: "Edict",
      typeLine: "Enchantment",
      triggers: [
        {
          event: "enter_battlefield",
          effects: [{ kind: "move_card", cardId: { type: "chosen", index: 0 }, toZone: "graveyard" }],
          targetRequirements: [{ kind: "creature" }],
        },
      ],
    });
    const card = createCardInstance({
      definitionId: edict.id,
      ownerId: p1.id,
      zone: "hand",
    });
    game.definitions[edict.id] = edict;
    game.cards[card.id] = card;
    p1.zones.hand.push(card.id);

    const entered = moveCard(game, card.id, "battlefield");
    expect(entered.stack).toHaveLength(0);
    expect(entered.prompts).toEqual([]);
    expect(entered.cards[card.id]?.zone).toBe("battlefield");
  });

  it("opens a private scry choice immediately, without putting the trigger on the stack", () => {
    const { game, p1 } = twoPlayers();
    const temple = createCardDefinition({
      name: "Temple of Deceit",
      typeLine: "Land",
      replacements: [{ kind: "enters_tapped" }],
      triggers: [
        {
          event: "enter_battlefield",
          effects: [{ kind: "scry", playerId: "controller", count: 1 }],
        },
      ],
    });
    const island = createCardDefinition({ name: "Island", typeLine: "Basic Land — Island" });
    const templeCard = createCardInstance({
      definitionId: temple.id,
      ownerId: p1.id,
      zone: "hand",
    });
    const libCard = createCardInstance({
      definitionId: island.id,
      ownerId: p1.id,
      zone: "library",
    });
    game.definitions[temple.id] = temple;
    game.definitions[island.id] = island;
    game.cards[templeCard.id] = templeCard;
    game.cards[libCard.id] = libCard;
    p1.zones.hand.push(templeCard.id);
    p1.zones.library.push(libCard.id);

    const entered = moveCard(game, templeCard.id, "battlefield");
    expect(entered.cards[templeCard.id]?.tapped).toBe(true);
    expect(entered.stack).toHaveLength(0);
    expect(entered.prompts).toEqual([{ kind: "scry", playerId: p1.id, count: 1 }]);

    const bottomed = applyAction(entered, {
      kind: "resolve_scry",
      playerId: p1.id,
      bottomIds: [libCard.id],
    });
    expect(bottomed.prompts).toEqual([]);
    expect(bottomed.players[0]?.zones.library).toEqual([libCard.id]);
  });

  it("does not let other players pass or look during a scry", () => {
    const { game, p1, p2 } = twoPlayers();
    const temple = createCardDefinition({
      name: "Temple of Deceit",
      typeLine: "Land",
      replacements: [{ kind: "enters_tapped" }],
      triggers: [
        {
          event: "enter_battlefield",
          effects: [{ kind: "scry", playerId: "controller", count: 1 }],
        },
      ],
    });
    const island = createCardDefinition({ name: "Island", typeLine: "Basic Land — Island" });
    const templeCard = createCardInstance({
      definitionId: temple.id,
      ownerId: p1.id,
      zone: "hand",
    });
    const libCard = createCardInstance({
      definitionId: island.id,
      ownerId: p1.id,
      zone: "library",
    });
    game.definitions[temple.id] = temple;
    game.definitions[island.id] = island;
    game.cards[templeCard.id] = templeCard;
    game.cards[libCard.id] = libCard;
    p1.zones.hand.push(templeCard.id);
    p1.zones.library.push(libCard.id);

    const entered = moveCard(game, templeCard.id, "battlefield");
    expect(entered.stack).toHaveLength(0);
    expect(() =>
      applyAction(entered, { kind: "pass_priority", playerId: entered.priorityPlayerId }),
    ).toThrow(/pending choice/);
    expect(() =>
      applyAction(entered, { kind: "resolve_scry", playerId: p2.id, bottomIds: [] }),
    ).toThrow(/not that player's choice/);
  });

  it("queues beginning-of-combat triggers instead of skipping the step", () => {
    const { game, p1 } = twoPlayers();
    const definition = createCardDefinition({
      name: "Warg Rider",
      typeLine: "Creature — Orc Warrior",
      power: 4,
      toughness: 3,
      triggers: [
        {
          event: "begin_combat",
          effects: [{ kind: "amass", playerId: "controller", amount: 2, subtype: "Orc" }],
        },
      ],
    });
    const card = createCardInstance({
      definitionId: definition.id,
      ownerId: p1.id,
      zone: "battlefield",
    });
    game.definitions[definition.id] = definition;
    game.cards[card.id] = card;
    p1.zones.battlefield.push(card.id);
    game.turn.phase = "precombatMain";
    game.turn.step = "precombatMain";
    game.turn.activePlayerId = p1.id;
    game.priorityPlayerId = p1.id;

    const next = skipPriorityShortcuts(advanceStep(game));
    expect(next.turn.step).toBe("beginCombat");
    expect(next.stack).toHaveLength(1);
    expect(next.stack[0]?.kind).toBe("ability");
    expect(next.stack[0]?.sourceId).toBe(card.id);

    const roundTrip = parseGameState(JSON.parse(JSON.stringify(serializeGameState(next))));
    expect(roundTrip.definitions[definition.id]?.triggers[0]?.event).toBe("begin_combat");
  });

  it("creating a token without triggers does not put an ability on the stack", () => {
    const { game, p1 } = twoPlayers();
    const next = applyEffect(game, {
      kind: "create_token",
      ownerId: p1.id,
      name: "Soldier",
      typeLine: "Creature — Soldier Token",
      power: 1,
      toughness: 1,
    });
    expect(next.stack).toHaveLength(0);
    expect(next.players[0]?.zones.battlefield).toHaveLength(1);
  });
});
