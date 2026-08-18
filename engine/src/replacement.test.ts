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

  it("taps a permanent as it enters when its definition replaces the event", () => {
    const { game, p1 } = twoPlayers();
    const gate = createCardDefinition({
      name: "Simic Guildgate",
      typeLine: "Land — Gate",
      replacements: [{ kind: "enters_tapped" }],
    });
    const forest = createCardDefinition({
      name: "Forest",
      typeLine: "Basic Land — Forest",
    });
    const gateCard = createCardInstance({
      definitionId: gate.id,
      ownerId: p1.id,
      zone: "hand",
    });
    const forestCard = createCardInstance({
      definitionId: forest.id,
      ownerId: p1.id,
      zone: "hand",
    });
    game.definitions[gate.id] = gate;
    game.definitions[forest.id] = forest;
    game.cards[gateCard.id] = gateCard;
    game.cards[forestCard.id] = forestCard;
    p1.zones.hand.push(gateCard.id, forestCard.id);

    const tappedLand = moveCard(game, gateCard.id, "battlefield");
    expect(tappedLand.cards[gateCard.id]?.zone).toBe("battlefield");
    expect(tappedLand.cards[gateCard.id]?.tapped).toBe(true);

    const untappedLand = moveCard(game, forestCard.id, "battlefield");
    expect(untappedLand.cards[forestCard.id]?.tapped).toBe(false);

    const restored = parseGameState(serializeGameState(tappedLand));
    expect(restored.definitions[gate.id]?.replacements).toEqual([{ kind: "enters_tapped" }]);
    expect(restored.cards[gateCard.id]?.tapped).toBe(true);
  });

  it("plays an enter-tapped land tapped as a special action", () => {
    const { game, p1 } = twoPlayers();
    fillLibraries(game);
    const gate = createCardDefinition({
      name: "Simic Guildgate",
      typeLine: "Land — Gate",
      replacements: [{ kind: "enters_tapped" }],
    });
    const card = createCardInstance({
      definitionId: gate.id,
      ownerId: p1.id,
      zone: "hand",
    });
    game.definitions[gate.id] = gate;
    game.cards[card.id] = card;
    p1.zones.hand.push(card.id);

    const ready = advanceSteps(game, 3);
    const next = applyAction(ready, { kind: "play_land", playerId: p1.id, cardId: card.id });
    expect(next.cards[card.id]?.zone).toBe("battlefield");
    expect(next.cards[card.id]?.tapped).toBe(true);
    expect(next.stack).toHaveLength(0);
  });

  it("clears tapped when a land leaves, then reapplies the replacement on return", () => {
    const { game, p1 } = twoPlayers();
    const gate = createCardDefinition({
      name: "Simic Guildgate",
      typeLine: "Land — Gate",
      replacements: [{ kind: "enters_tapped" }],
    });
    const card = createCardInstance({
      definitionId: gate.id,
      ownerId: p1.id,
      zone: "battlefield",
    });
    game.definitions[gate.id] = gate;
    game.cards[card.id] = card;
    game.cards[card.id]!.tapped = true;
    p1.zones.battlefield.push(card.id);

    const inHand = moveCard(game, card.id, "hand");
    expect(inHand.cards[card.id]?.tapped).toBe(false);
    const returned = moveCard(inHand, card.id, "battlefield");
    expect(returned.cards[card.id]?.tapped).toBe(true);
  });

  it("taps a slow land without two other lands and a legendary land without a legendary creature", () => {
    const { game, p1 } = twoPlayers();
    const marsh = createCardDefinition({
      name: "Shipwreck Marsh",
      typeLine: "Land",
      replacements: [{ kind: "enters_tapped_unless", unless: { kind: "other_lands", count: 2 } }],
    });
    const barad = createCardDefinition({
      name: "Barad-dûr",
      typeLine: "Legendary Land",
      replacements: [{ kind: "enters_tapped_unless", unless: { kind: "legendary_creature" } }],
    });
    const swamp = createCardDefinition({ name: "Swamp", typeLine: "Basic Land — Swamp" });
    const sauron = createCardDefinition({
      name: "Sauron",
      typeLine: "Legendary Creature — Avatar Horror",
      power: 9,
      toughness: 9,
    });
    const marshCard = createCardInstance({ definitionId: marsh.id, ownerId: p1.id, zone: "hand" });
    const baradCard = createCardInstance({ definitionId: barad.id, ownerId: p1.id, zone: "hand" });
    const swampCard = createCardInstance({
      definitionId: swamp.id,
      ownerId: p1.id,
      zone: "battlefield",
    });
    const commander = createCardInstance({
      definitionId: sauron.id,
      ownerId: p1.id,
      zone: "command",
    });
    game.definitions[marsh.id] = marsh;
    game.definitions[barad.id] = barad;
    game.definitions[swamp.id] = swamp;
    game.definitions[sauron.id] = sauron;
    game.cards[marshCard.id] = marshCard;
    game.cards[baradCard.id] = baradCard;
    game.cards[swampCard.id] = swampCard;
    game.cards[commander.id] = commander;
    p1.zones.hand.push(marshCard.id, baradCard.id);
    p1.zones.battlefield.push(swampCard.id);
    p1.zones.command.push(commander.id);
    p1.commander.commanderIds.push(commander.id);

    expect(moveCard(game, marshCard.id, "battlefield").cards[marshCard.id]?.tapped).toBe(true);
    expect(moveCard(game, baradCard.id, "battlefield").cards[baradCard.id]?.tapped).toBe(true);

    const second = createCardInstance({ definitionId: swamp.id, ownerId: p1.id, zone: "hand" });
    game.cards[second.id] = second;
    p1.zones.hand.push(second.id);
    const withTwo = moveCard(moveCard(game, swampCard.id, "battlefield"), second.id, "battlefield");
    const marshAgain = createCardInstance({ definitionId: marsh.id, ownerId: p1.id, zone: "hand" });
    withTwo.definitions[marsh.id] = marsh;
    withTwo.cards[marshAgain.id] = marshAgain;
    withTwo.players[0]?.zones.hand.push(marshAgain.id);
    expect(moveCard(withTwo, marshAgain.id, "battlefield").cards[marshAgain.id]?.tapped).toBe(false);

    const legend = createCardInstance({
      definitionId: sauron.id,
      ownerId: p1.id,
      zone: "battlefield",
    });
    game.cards[legend.id] = legend;
    p1.zones.battlefield.push(legend.id);
    expect(moveCard(game, baradCard.id, "battlefield").cards[baradCard.id]?.tapped).toBe(false);
  });

  it("taps a battle land unless two basic lands are already out", () => {
    const { game, p1 } = twoPlayers();
    const marsh = createCardDefinition({
      name: "Smoldering Marsh",
      typeLine: "Land — Swamp Mountain",
      replacements: [{ kind: "enters_tapped_unless", unless: { kind: "basic_lands", count: 2 } }],
    });
    const swamp = createCardDefinition({ name: "Swamp", typeLine: "Basic Land — Swamp" });
    const tower = createCardDefinition({ name: "Command Tower", typeLine: "Land" });
    const marshCard = createCardInstance({ definitionId: marsh.id, ownerId: p1.id, zone: "hand" });
    const swampOne = createCardInstance({
      definitionId: swamp.id,
      ownerId: p1.id,
      zone: "battlefield",
    });
    const towerCard = createCardInstance({
      definitionId: tower.id,
      ownerId: p1.id,
      zone: "battlefield",
    });
    game.definitions[marsh.id] = marsh;
    game.definitions[swamp.id] = swamp;
    game.definitions[tower.id] = tower;
    game.cards[marshCard.id] = marshCard;
    game.cards[swampOne.id] = swampOne;
    game.cards[towerCard.id] = towerCard;
    p1.zones.hand.push(marshCard.id);
    p1.zones.battlefield.push(swampOne.id, towerCard.id);

    expect(moveCard(game, marshCard.id, "battlefield").cards[marshCard.id]?.tapped).toBe(true);

    const swampTwo = createCardInstance({ definitionId: swamp.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[swampTwo.id] = swampTwo;
    p1.zones.battlefield.push(swampTwo.id);
    expect(moveCard(game, marshCard.id, "battlefield").cards[marshCard.id]?.tapped).toBe(false);
  });

  it("taps a land that enters tapped if two or more other lands are already out", () => {
    const { game, p1 } = twoPlayers();
    const hive = createCardDefinition({
      name: "Hive of the Eye Tyrant",
      typeLine: "Land",
      replacements: [{ kind: "enters_tapped_if", if: { kind: "other_lands", count: 2 } }],
    });
    const swamp = createCardDefinition({ name: "Swamp", typeLine: "Basic Land — Swamp" });
    const hiveCard = createCardInstance({ definitionId: hive.id, ownerId: p1.id, zone: "hand" });
    game.definitions[hive.id] = hive;
    game.definitions[swamp.id] = swamp;
    game.cards[hiveCard.id] = hiveCard;
    p1.zones.hand.push(hiveCard.id);

    expect(moveCard(game, hiveCard.id, "battlefield").cards[hiveCard.id]?.tapped).toBe(false);

    const first = createCardInstance({ definitionId: swamp.id, ownerId: p1.id, zone: "battlefield" });
    const second = createCardInstance({ definitionId: swamp.id, ownerId: p1.id, zone: "battlefield" });
    game.cards[first.id] = first;
    game.cards[second.id] = second;
    p1.zones.battlefield.push(first.id, second.id);
    expect(moveCard(game, hiveCard.id, "battlefield").cards[hiveCard.id]?.tapped).toBe(true);
  });

  it("asks whether to pay life as a shock land enters", () => {
    const { game, p1 } = twoPlayers();
    const grave = createCardDefinition({
      name: "Watery Grave",
      typeLine: "Land — Island Swamp",
      replacements: [{ kind: "may_pay_life_or_enter_tapped", amount: 2 }],
    });
    const card = createCardInstance({ definitionId: grave.id, ownerId: p1.id, zone: "hand" });
    game.definitions[grave.id] = grave;
    game.cards[card.id] = card;
    p1.zones.hand.push(card.id);

    const entered = moveCard(game, card.id, "battlefield");
    expect(entered.cards[card.id]?.tapped).toBe(false);
    expect(entered.prompts[0]).toMatchObject({
      kind: "may_pay_life_or_enter_tapped",
      playerId: p1.id,
      sourceId: card.id,
      amount: 2,
    });

    const paid = applyAction(entered, {
      kind: "choose_enter_replacement",
      playerId: p1.id,
      pay: true,
    });
    expect(paid.cards[card.id]?.tapped).toBe(false);
    expect(paid.players[0]?.life).toBe(38);
    expect(paid.prompts).toEqual([]);

    const declined = applyAction(entered, {
      kind: "choose_enter_replacement",
      playerId: p1.id,
      pay: false,
    });
    expect(declined.cards[card.id]?.tapped).toBe(true);
    expect(declined.players[0]?.life).toBe(40);
  });
});
