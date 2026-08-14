import { describe, expect, it } from "vitest";
import { parseMoxfieldPublicId, parseTextDecklist } from "./decklist";
import { startDefinitionGame } from "./setup";
import { compileOracleCard, type OracleCard } from "./oracle";

describe("decklist parsing", () => {
  it("reads a Moxfield URL or public ID", () => {
    expect(parseMoxfieldPublicId("https://www.moxfield.com/decks/AbC123_x/")).toBe("AbC123_x");
    expect(parseMoxfieldPublicId("AbC123_x")).toBe("AbC123_x");
    expect(() => parseMoxfieldPublicId("not a deck")).toThrow(/Moxfield/);
  });

  it("parses a Commander text export with a commander section", () => {
    const parsed = parseTextDecklist(`
Name: Test List
Commander
1 Atraxa, Praetors' Voice

Deck
1 Sol Ring (C21) 263
2 Forest
Sideboard
1 Negate
`);
    expect(parsed.commanders).toEqual([{ name: "Atraxa, Praetors' Voice", quantity: 1 }]);
    expect(parsed.library).toEqual([
      { name: "Sol Ring", quantity: 1 },
      { name: "Forest", quantity: 2 },
    ]);
  });
});

describe("definition seating", () => {
  it("seats compiled oracle cards and can shuffle with a stub RNG", () => {
    const forest: OracleCard = {
      oracleId: "f",
      name: "Forest",
      manaCost: "",
      typeLine: "Basic Land — Forest",
      oracleText: "{T}: Add {G}.",
      power: null,
      toughness: null,
      printedKeywords: [],
    };
    const dragon: OracleCard = {
      oracleId: "d",
      name: "Test Dragon",
      manaCost: "{5}",
      typeLine: "Legendary Creature — Dragon",
      oracleText: "Flying",
      power: "5",
      toughness: "5",
      printedKeywords: ["Flying"],
    };
    const forestDef = compileOracleCard(forest).definition;
    const dragonDef = compileOracleCard(dragon).definition;
    const game = startDefinitionGame({
      playerCount: 2,
      playerNames: ["You", "Opponent"],
      definitions: {
        [forestDef.id]: forestDef,
        [dragonDef.id]: dragonDef,
      },
      openingHandSize: 2,
      shuffle: true,
      random: () => 0,
      decks: [
        {
          commanderDefinitionId: dragonDef.id,
          libraryDefinitionIds: [forestDef.id, forestDef.id, forestDef.id],
        },
        {
          commanderDefinitionId: dragonDef.id,
          libraryDefinitionIds: [forestDef.id, forestDef.id, forestDef.id],
        },
      ],
    });
    expect(game.players[0]?.zones.command).toHaveLength(1);
    expect(game.players[0]?.zones.hand).toHaveLength(2);
    expect(game.players[0]?.zones.library).toHaveLength(1);
    expect(game.definitions[forestDef.id]?.produces).toEqual({ G: 1 });
  });

  it("seats three definition decks", () => {
    const forest: OracleCard = {
      oracleId: "f3",
      name: "Forest",
      manaCost: "",
      typeLine: "Basic Land — Forest",
      oracleText: "{T}: Add {G}.",
      power: null,
      toughness: null,
      printedKeywords: [],
    };
    const dragon: OracleCard = {
      oracleId: "d3",
      name: "Test Dragon",
      manaCost: "{5}",
      typeLine: "Legendary Creature — Dragon",
      oracleText: "Flying",
      power: "5",
      toughness: "5",
      printedKeywords: ["Flying"],
    };
    const forestDef = compileOracleCard(forest).definition;
    const dragonDef = compileOracleCard(dragon).definition;
    const deck = {
      commanderDefinitionId: dragonDef.id,
      libraryDefinitionIds: [forestDef.id, forestDef.id, forestDef.id],
    };
    const game = startDefinitionGame({
      playerCount: 3,
      playerNames: ["You", "Opponent 1", "Opponent 2"],
      definitions: {
        [forestDef.id]: forestDef,
        [dragonDef.id]: dragonDef,
      },
      openingHandSize: 2,
      shuffle: false,
      decks: [deck, deck, deck],
    });
    expect(game.players).toHaveLength(3);
    expect(game.players.every((player) => player.zones.command.length === 1)).toBe(true);
    expect(game.players.every((player) => player.zones.hand.length === 2)).toBe(true);
  });
});
