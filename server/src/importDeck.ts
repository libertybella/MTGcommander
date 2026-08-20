import {
  compileOracleCard,
  defaultPlayerNames,
  expandDeckCards,
  normalizeCardName,
  parseTextDecklist,
  startDefinitionGame,
  type CardDefinition,
  type GameState,
  type OracleCard,
  type ParsedDecklist,
  type TablePlayerCount,
} from "@mtgcommander/engine";
import { CardDatabase } from "./cards";
import { cardOverrideFor } from "./cardOverrides";
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
    // Hand-authored registry entries beat the sentence compiler (Stage 6).
    const override = cardOverrideFor(card);
    const compiled = override
      ? { definition: override, otherDefinition: undefined, notes: [] as string[] }
      : compileOracleCard(card);
    definitions[compiled.definition.id] = compiled.definition;
    if (compiled.otherDefinition) {
      definitions[compiled.otherDefinition.id] = compiled.otherDefinition;
    }
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
  decks: CompiledDeck[];
  playerNames?: string[];
  random?: () => number;
}): ImportedTable {
  const playerCount = options.decks.length;
  if (playerCount !== 2 && playerCount !== 3 && playerCount !== 4) {
    throw new Error("Imported tables need 2–4 decks");
  }
  const count = playerCount as TablePlayerCount;
  const names = options.playerNames ?? defaultPlayerNames(count);
  const definitions: Record<string, CardDefinition> = {};
  for (const deck of options.decks) {
    Object.assign(definitions, deck.definitions);
  }
  const state = startDefinitionGame({
    playerCount: count,
    playerNames: names,
    definitions,
    shuffle: true,
    random: options.random,
    skipMulligan: false,
    decks: options.decks.map((deck) => ({
      commanderDefinitionIds: deck.commanderDefinitionIds,
      libraryDefinitionIds: deck.libraryDefinitionIds,
    })),
  });
  return {
    state,
    missing: [],
    notes: options.decks.map((deck, index) => ({
      player: names[index] ?? `Player ${index + 1}`,
      cards: deck.notes,
    })),
  };
}
