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
    POOL_ID.shock,
  ];
}

/** Local Phase 21 synthetic table. Not a real-card or networked game. */
export function startSyntheticTable(): GameState {
  const library = testLibrary();
  return startCatalogGame({
    playerCount: 2,
    playerNames: ["You", "Opponent"],
    openingHandSize: 7,
    decks: [
      { commanderDefinitionId: POOL_ID.dragon, libraryDefinitionIds: library },
      { commanderDefinitionId: POOL_ID.dragon, libraryDefinitionIds: library },
    ],
  });
}
