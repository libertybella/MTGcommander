import {
  compileOracleCard,
  expandDeckCards,
  normalizeCardName,
  parseTextDecklist,
  startDefinitionGame,
  type CardDefinition,
  type GameState,
  type OracleCard,
  type ParsedDecklist,
} from "@mtgcommander/engine";
import { CardDatabase } from "./cards";
import { fetchMoxfieldDeck } from "./moxfield";
import type { HttpFetch } from "./http";

export type CompiledDeck = {
  name: string | null;
  commanderDefinitionIds: string[];
  libraryDefinitionIds: string[];
  definitions: Record<string, CardDefinition>;
  notes: { name: string; notes: string[] }[];
};

export type ImportedTable = {
  state: GameState;
  notes: { player: string; cards: { name: string; notes: string[] }[] }[];
  missing: string[];
};

function compiledFromOracle(cards: OracleCard[]): {
  byName: Map<string, { definition: CardDefinition; notes: string[] }>;
  definitions: Record<string, CardDefinition>;
} {
  const byName = new Map<string, { definition: CardDefinition; notes: string[] }>();
  const definitions: Record<string, CardDefinition> = {};
  for (const card of cards) {
    const compiled = compileOracleCard(card);
    definitions[compiled.definition.id] = compiled.definition;
    byName.set(normalizeCardName(card.name), compiled);
    const front = card.name.split(" // ")[0];
    if (front) {
      byName.set(normalizeCardName(front), compiled);
    }
  }
  return { byName, definitions };
}

function lookup(byName: Map<string, { definition: CardDefinition; notes: string[] }>, name: string) {
  return byName.get(normalizeCardName(name)) ?? null;
}

export function compileParsedDeck(
  list: ParsedDecklist,
  oracleCards: OracleCard[],
): CompiledDeck {
  const { byName, definitions } = compiledFromOracle(oracleCards);
  const notes: { name: string; notes: string[] }[] = [];
  const commanderDefinitionIds: string[] = [];
  for (const commander of expandDeckCards(list.commanders)) {
    const compiled = lookup(byName, commander);
    if (!compiled) {
      throw new Error(`Missing oracle data for commander ${commander}`);
    }
    commanderDefinitionIds.push(compiled.definition.id);
    if (compiled.notes.length > 0) {
      notes.push({ name: compiled.definition.name, notes: compiled.notes });
    }
  }
  if (commanderDefinitionIds.length === 0) {
    throw new Error("Deck has no commander");
  }
  const libraryDefinitionIds: string[] = [];
  for (const cardName of expandDeckCards(list.library)) {
    const compiled = lookup(byName, cardName);
    if (!compiled) {
      throw new Error(`Missing oracle data for ${cardName}`);
    }
    libraryDefinitionIds.push(compiled.definition.id);
    if (compiled.notes.length > 0 && !notes.some((entry) => entry.name === compiled.definition.name)) {
      notes.push({ name: compiled.definition.name, notes: compiled.notes });
    }
  }
  return {
    name: list.name,
    commanderDefinitionIds,
    libraryDefinitionIds,
    definitions,
    notes,
  };
}

async function resolveList(database: CardDatabase, list: ParsedDecklist) {
  const names = [
    ...expandDeckCards(list.commanders),
    ...expandDeckCards(list.library),
  ];
  return database.resolveNames(names);
}

export async function importMoxfieldDeck(
  database: CardDatabase,
  fetchImpl: HttpFetch,
  urlOrId: string,
): Promise<{ list: ParsedDecklist; compiled: CompiledDeck; missing: string[] }> {
  const list = await fetchMoxfieldDeck(fetchImpl, urlOrId);
  const resolved = await resolveList(database, list);
  if (resolved.missing.length > 0) {
    throw new Error(`Scryfall could not find: ${resolved.missing.join(", ")}`);
  }
  return { list, compiled: compileParsedDeck(list, resolved.cards), missing: [] };
}

export async function importTextDeck(
  database: CardDatabase,
  text: string,
): Promise<{ list: ParsedDecklist; compiled: CompiledDeck; missing: string[] }> {
  const list = parseTextDecklist(text);
  const resolved = await resolveList(database, list);
  if (resolved.missing.length > 0) {
    throw new Error(`Scryfall could not find: ${resolved.missing.join(", ")}`);
  }
  return { list, compiled: compileParsedDeck(list, resolved.cards), missing: [] };
}

export function startImportedTable(options: {
  you: CompiledDeck;
  opponent: CompiledDeck;
  playerNames?: [string, string];
  random?: () => number;
}): ImportedTable {
  const definitions = { ...options.you.definitions, ...options.opponent.definitions };
  const state = startDefinitionGame({
    playerCount: 2,
    playerNames: options.playerNames ?? ["You", "Opponent"],
    definitions,
    shuffle: true,
    random: options.random,
    decks: [
      {
        commanderDefinitionIds: options.you.commanderDefinitionIds,
        libraryDefinitionIds: options.you.libraryDefinitionIds,
      },
      {
        commanderDefinitionIds: options.opponent.commanderDefinitionIds,
        libraryDefinitionIds: options.opponent.libraryDefinitionIds,
      },
    ],
  });
  return {
    state,
    missing: [],
    notes: [
      { player: options.playerNames?.[0] ?? "You", cards: options.you.notes },
      { player: options.playerNames?.[1] ?? "Opponent", cards: options.opponent.notes },
    ],
  };
}
