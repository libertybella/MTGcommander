import { POOL_ID, startCatalogGame, type GameState } from "@mtgcommander/engine";

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

export type SyntheticPlayerCount = 2 | 4;

/** Local Phase 21 synthetic table. Not a real-card or networked game. */
export function startSyntheticTable(playerCount: SyntheticPlayerCount = 2): GameState {
  const library = testLibrary();
  const names =
    playerCount === 2
      ? ["You", "Opponent"]
      : ["You", "Opponent 1", "Opponent 2", "Opponent 3"];
  return startCatalogGame({
    playerCount,
    playerNames: names,
    openingHandSize: 7,
    decks: names.map(() => ({
      commanderDefinitionId: POOL_ID.dragon,
      libraryDefinitionIds: library,
    })),
  });
}
