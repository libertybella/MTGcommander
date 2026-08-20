import { deriveCharacteristics } from "./characteristics";
import { createId } from "./ids";
import type {
  CardDefinition,
  CardInstance,
  Color,
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
        | "staticAbilities"
        | "produces"
        | "producesAnyColor"
        | "producesOptions"
        | "manaAbilities"
        | "activated"
        | "imageUrl"
        | "otherFaceId"
        | "layout"
        | "ward"
        | "modes"
        | "protectionFrom"
      >
    > & { colors?: Color[] },
): CardDefinition {
  return {
    id: input.id ?? createId("def"),
    name: input.name,
    manaCost: input.manaCost ?? "",
    typeLine: input.typeLine,
    characteristics: deriveCharacteristics(input.typeLine, input.manaCost ?? "", input.colors),
    oracleText: input.oracleText ?? "",
    power: input.power ?? null,
    toughness: input.toughness ?? null,
    effects: input.effects ? input.effects.map((effect) => ({ ...effect })) : [],
    targetRequirements: input.targetRequirements
      ? input.targetRequirements.map((requirement) => ({ ...requirement }))
      : [],
    keywords: input.keywords ? [...input.keywords] : [],
    triggers: input.triggers
      ? input.triggers.map((trigger) => ({
          event: trigger.event,
          ...(trigger.watch ? { watch: trigger.watch } : {}),
          ...(trigger.excludeSelf ? { excludeSelf: true } : {}),
          ...(trigger.subjectFilter
            ? {
                subjectFilter: {
                  ...(trigger.subjectFilter.types ? { types: [...trigger.subjectFilter.types] } : {}),
                  ...(trigger.subjectFilter.subtypes
                    ? { subtypes: [...trigger.subjectFilter.subtypes] }
                    : {}),
                },
              }
            : {}),
          effects: trigger.effects.map((effect) => ({ ...effect })),
          targetRequirements: (trigger.targetRequirements ?? []).map((requirement) => ({
            ...requirement,
          })),
        }))
      : [],
    replacements: input.replacements ? input.replacements.map((replacement) => ({ ...replacement })) : [],
    staticAbilities: input.staticAbilities
      ? input.staticAbilities.map((ability) => ({
          selector: { ...ability.selector },
          effect: { ...ability.effect },
        }))
      : [],
    produces: input.produces ? { ...input.produces } : {},
    producesAnyColor: input.producesAnyColor === true,
    producesOptions: input.producesOptions ? [...input.producesOptions] : [],
    manaAbilities: input.manaAbilities
      ? input.manaAbilities.map((ability) => ({
          produces: { ...ability.produces },
          producesOptions: [...ability.producesOptions],
          producesAnyColor: ability.producesAnyColor,
          damageToController: ability.damageToController,
        }))
      : [],
    activated: input.activated
      ? input.activated.map((ability) => ({
          tap: ability.tap,
          manaCost: ability.manaCost,
          effects: ability.effects.map((effect) => ({ ...effect })),
          targetRequirements: ability.targetRequirements.map((requirement) => ({ ...requirement })),
          ...(ability.zone && ability.zone !== "battlefield" ? { zone: ability.zone } : {}),
          ...(ability.discard ? { discard: true } : {}),
          ...(ability.sacrificeSelf ? { sacrificeSelf: true } : {}),
          ...(ability.timing === "sorcery" ? { timing: "sorcery" as const } : {}),
        }))
      : [],
    imageUrl: input.imageUrl ?? "",
    ...(input.ward && input.ward > 0 ? { ward: input.ward } : {}),
    ...(input.protectionFrom && input.protectionFrom.length > 0
      ? { protectionFrom: [...input.protectionFrom] }
      : {}),
    ...(input.modes && input.modes.length > 0
      ? {
          modes: input.modes.map((mode) => ({
            label: mode.label,
            effects: mode.effects.map((effect) => ({ ...effect })),
            targetRequirements: mode.targetRequirements.map((requirement) => ({ ...requirement })),
          })),
        }
      : {}),
    ...(input.otherFaceId ? { otherFaceId: input.otherFaceId } : {}),
    ...(input.layout && input.layout !== "normal" ? { layout: input.layout } : {}),
  };
}

export function createCardInstance(input: {
  definitionId: CardDefinition["id"];
  ownerId: CardInstance["ownerId"];
  zone: CardInstance["zone"];
  controllerId?: CardInstance["controllerId"];
  id?: CardInstance["id"];
  summoningSick?: boolean;
  isToken?: boolean;
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
    classLevel: 0,
    timestamp: 0,
    isToken: input.isToken === true,
    deathtouched: false,
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
    attackedThisTurn: false,
    failedToDraw: false,
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
    mulligan: null,
    openingRoll: null,
    firstPlayerId: first.id,
    prompts: [],
    reveals: [],
    activeEffects: [],
    nextTimestamp: 1,
  };
}
