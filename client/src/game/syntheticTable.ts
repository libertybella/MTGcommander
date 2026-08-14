import { POOL_ID, defaultPlayerNames, startCatalogGame, type GameState, type TablePlayerCount } from "@mtgcommander/engine";

function testLibrary(): string[] {
  return [
    POOL_ID.mountain,
    POOL_ID.shock,
    POOL_ID.forest,
    POOL_ID.bear,
    POOL_ID.plains,
    POOL_ID.gift,
    POOL_ID.island,
    POOL_ID.study,
    POOL_ID.swamp,
    POOL_ID.terror,
    POOL_ID.knight,
    POOL_ID.cleric,
    POOL_ID.wall,
    POOL_ID.mountain,
    POOL_ID.counter,
  ];
}

export type SyntheticPlayerCount = TablePlayerCount;

/** Local Phase 21 synthetic table. Not a real-card or networked game. */
export function startSyntheticTable(playerCount: SyntheticPlayerCount = 2): GameState {
  const library = testLibrary();
  const names = defaultPlayerNames(playerCount);
  return startCatalogGame({
    playerCount,
    playerNames: names,
    openingHandSize: 7,
    skipMulligan: false,
    decks: names.map(() => ({
      commanderDefinitionId: POOL_ID.dragon,
      libraryDefinitionIds: library,
    })),
  });
}
