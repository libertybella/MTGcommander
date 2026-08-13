import { createId } from "./ids";
import type {
  CardDefinition,
  CardInstance,
  GameState,
  ManaPool,
  PlayerState,
  PlayerZones,
} from "./types";

export type CreateGameOptions = {
  playerCount: 2 | 3 | 4;
  playerNames?: string[];
};

export function emptyManaPool(): ManaPool {
  return { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
}

export function emptyPlayerZones(): PlayerZones {
  return {
    library: [],
    hand: [],
    battlefield: [],
    graveyard: [],
    exile: [],
    command: [],
    removed: [],
  };
}

export function createCardDefinition(
  input: Pick<CardDefinition, "name" | "typeLine"> &
    Partial<
      Pick<
        CardDefinition,
        | "manaCost"
        | "oracleText"
        | "id"
        | "power"
        | "toughness"
        | "effects"
        | "targetRequirements"
        | "keywords"
        | "triggers"
        | "replacements"
        | "staticModifiers"
        | "produces"
      >
    >,
): CardDefinition {
  return {
    id: input.id ?? createId("def"),
    name: input.name,
    manaCost: input.manaCost ?? "",
    typeLine: input.typeLine,
    oracleText: input.oracleText ?? "",
    power: input.power ?? null,
    toughness: input.toughness ?? null,
    effects: input.effects ? input.effects.map((effect) => ({ ...effect })) : [],
    targetRequirements: input.targetRequirements
      ? input.targetRequirements.map((requirement) => ({ ...requirement }))
      : [],
    keywords: input.keywords ? [...input.keywords] : [],
    triggers: input.triggers ? input.triggers.map((trigger) => ({ ...trigger, effects: trigger.effects.map((effect) => ({ ...effect })) })) : [],
    replacements: input.replacements ? input.replacements.map((replacement) => ({ ...replacement })) : [],
    staticModifiers: input.staticModifiers ? input.staticModifiers.map((modifier) => ({ ...modifier })) : [],
    produces: input.produces ? { ...input.produces } : {},
  };
}

export function createCardInstance(input: {
  definitionId: CardDefinition["id"];
  ownerId: CardInstance["ownerId"];
  zone: CardInstance["zone"];
  controllerId?: CardInstance["controllerId"];
  id?: CardInstance["id"];
  summoningSick?: boolean;
}): CardInstance {
  return {
    id: input.id ?? createId("card"),
    definitionId: input.definitionId,
    ownerId: input.ownerId,
    controllerId: input.controllerId ?? input.ownerId,
    zone: input.zone,
    tapped: false,
    damageMarked: 0,
    attacking: false,
    blockingAttackerId: null,
    summoningSick: input.summoningSick ?? input.zone === "battlefield",
    counters: {},
  };
}

function createPlayer(displayName: string): PlayerState {
  return {
    id: createId("player"),
    displayName,
    life: 40,
    mana: emptyManaPool(),
    zones: emptyPlayerZones(),
    commander: {
      commanderIds: [],
      tax: 0,
      damageReceived: {},
    },
    lost: false,
    landsPlayedThisTurn: 0,
  };
}

export function createGameState(options: CreateGameOptions): GameState {
  const { playerCount, playerNames } = options;
  if (playerCount < 2 || playerCount > 4) {
    throw new Error("Commander games must have 2–4 players");
  }

  const players = Array.from({ length: playerCount }, (_, index) => {
    const name = playerNames?.[index] ?? `Player ${index + 1}`;
    return createPlayer(name);
  });

  const first = players[0];
  if (!first) {
    throw new Error("Expected at least one player");
  }

  return {
    id: createId("game"),
    players,
    turn: {
      number: 1,
      activePlayerId: first.id,
      phase: "beginning",
      step: "untap",
    },
    stack: [],
    cards: {},
    definitions: {},
    priorityPlayerId: first.id,
    passesSinceAction: 0,
    combat: null,
    winnerId: null,
    log: [],
  };
}
