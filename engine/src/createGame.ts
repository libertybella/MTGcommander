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
        | "enchant"
        | "loyalty"
        | "loyaltyAbilities"
        | "noMaxHandSize"
        | "extraLandDrops"
        | "cantBeCountered"
        | "creatureSpellsCantBeCountered"
        | "opponentsLockedDuringYourTurn"
        | "opponentsCantCastDuringYourTurn"
        | "mustAttack"
        | "notCreatureBelowDevotion"
        | "freeIfCommander"
        | "changeling"
        | "storm"
        | "doesntUntap"
        | "grantsFlash"
        | "extraDrawStepDraws"
        | "affinityArtifacts"
        | "selfDiscount"
        | "affinityAllCreatures"
        | "topOfLibrary"
        | "flashback"
        | "costReductions"
        | "chooseCreatureTypeOnEnter"
        | "selfIsChosenType"
        | "triggerDoubling"
        | "landChosenColorBonus"
        | "landTapEcho"
        | "opponentLandTapsSkipUntap"
        | "rebound"
        | "chooseColorOnEnter"
        | "enchantedTappedBonus"
        | "entersWithXCounters"
        | "enterAsCopy"
        | "playLandsFromGraveyard"
        | "leyline"
        | "castFromGraveyard"
        | "ascend"
        | "untapDuringEachUntap"
        | "opponentCreaturesEnterTapped"
        | "opponentArtifactsEnterTapped"
        | "additionalCost"
        | "attackTax"
        | "dynamicPt"
        | "bonusPt"
        | "modeChoice"
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
          ...(trigger.oncePerTurn ? { oncePerTurn: true } : {}),
          ...(trigger.oncePerBatch ? { oncePerBatch: true } : {}),
          ...(trigger.alsoOnCopy ? { alsoOnCopy: true } : {}),
          ...(trigger.condition ? { condition: { ...trigger.condition } } : {}),
          ...(trigger.subjectPlayerOpponent ? { subjectPlayerOpponent: true } : {}),
          ...(trigger.attacksAlone ? { attacksAlone: true } : {}),
          ...(trigger.subjectFilter
            ? {
                subjectFilter: {
                  ...(trigger.subjectFilter.types ? { types: [...trigger.subjectFilter.types] } : {}),
                  ...(trigger.subjectFilter.subtypes
                    ? { subtypes: [...trigger.subjectFilter.subtypes] }
                    : {}),
                  ...(trigger.subjectFilter.subtypesAny
                    ? { subtypesAny: [...trigger.subjectFilter.subtypesAny] }
                    : {}),
                  ...(trigger.subjectFilter.typesAny
                    ? { typesAny: [...trigger.subjectFilter.typesAny] }
                    : {}),
                  ...(trigger.subjectFilter.nonTypes
                    ? { nonTypes: [...trigger.subjectFilter.nonTypes] }
                    : {}),
                  ...(trigger.subjectFilter.chosenSubtype ? { chosenSubtype: true } : {}),
                  ...(trigger.subjectFilter.nonToken ? { nonToken: true } : {}),
                  ...(trigger.subjectFilter.tokenOnly ? { tokenOnly: true } : {}),
                  ...(trigger.subjectFilter.nonSubtypes
                    ? { nonSubtypes: [...trigger.subjectFilter.nonSubtypes] }
                    : {}),
                  ...(trigger.subjectFilter.minPower !== undefined
                    ? { minPower: trigger.subjectFilter.minPower }
                    : {}),
                  ...(trigger.subjectFilter.maxPower !== undefined
                    ? { maxPower: trigger.subjectFilter.maxPower }
                    : {}),
                  ...(trigger.subjectFilter.greaterPtThanWatcher
                    ? { greaterPtThanWatcher: true }
                    : {}),
                  ...(trigger.subjectFilter.manaValueBelowWatcherPower
                    ? { manaValueBelowWatcherPower: true }
                    : {}),
                  ...(trigger.subjectFilter.counterName
                    ? { counterName: trigger.subjectFilter.counterName }
                    : {}),
                  ...(trigger.subjectFilter.colorless ? { colorless: true } : {}),
                },
              }
            : {}),
          effects: trigger.effects.map((effect) => ({ ...effect })),
          targetRequirements: (trigger.targetRequirements ?? []).map((requirement) => ({
            ...requirement,
          })),
          ...(trigger.modes
            ? {
                modes: trigger.modes.map((mode) => ({
                  label: mode.label,
                  effects: mode.effects.map((effect) => ({ ...effect })),
                  targetRequirements: (mode.targetRequirements ?? []).map((requirement) => ({
                    ...requirement,
                  })),
                })),
              }
            : {}),
        }))
      : [],
    replacements: input.replacements ? input.replacements.map((replacement) => ({ ...replacement })) : [],
    staticAbilities: input.staticAbilities
      ? input.staticAbilities.map((ability) => ({
          selector: { ...ability.selector },
          effect: { ...ability.effect },
          ...(ability.fromGraveyard ? { fromGraveyard: true } : {}),
          ...(ability.requiresControlled
            ? {
                requiresControlled: {
                  ...(ability.requiresControlled.types
                    ? { types: [...ability.requiresControlled.types] }
                    : {}),
                  ...(ability.requiresControlled.subtypes
                    ? { subtypes: [...ability.requiresControlled.subtypes] }
                    : {}),
                },
              }
            : {}),
          ...(ability.requiresCounters
            ? { requiresCounters: { ...ability.requiresCounters } }
            : {}),
          ...(ability.requiresDelirium ? { requiresDelirium: true } : {}),
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
          ...(ability.count && ability.count > 1 ? { count: ability.count } : {}),
          ...(ability.sacrificeSelf ? { sacrificeSelf: true } : {}),
          ...(ability.costMana ? { costMana: ability.costMana } : {}),
          ...(ability.costSacrifice ? { costSacrifice: ability.costSacrifice } : {}),
          ...(ability.noTap ? { noTap: true } : {}),
          ...(ability.countFromPower ? { countFromPower: true } : {}),
          ...(ability.countFromDevotion ? { countFromDevotion: true } : {}),
          ...(ability.costTapCreature ? { costTapCreature: true } : {}),
          ...(ability.anyColorAmong ? { anyColorAmong: ability.anyColorAmong } : {}),
          ...(ability.producesChosenColor ? { producesChosenColor: true } : {}),
          ...(ability.producesColorsAmong
            ? { producesColorsAmong: ability.producesColorsAmong }
            : {}),
          ...(ability.requiresCount ? { requiresCount: { ...ability.requiresCount } } : {}),
          ...(ability.requiresControlled
            ? {
                requiresControlled: {
                  ...(ability.requiresControlled.types
                    ? { types: [...ability.requiresControlled.types] }
                    : {}),
                  ...(ability.requiresControlled.subtypes
                    ? { subtypes: [...ability.requiresControlled.subtypes] }
                    : {}),
                },
              }
            : {}),
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
          ...(ability.sacrificeCost ? { sacrificeCost: ability.sacrificeCost } : {}),
          ...(ability.exileSelf ? { exileSelf: true } : {}),
          ...(ability.legendaryDiscount ? { legendaryDiscount: true } : {}),
          ...(ability.modes
            ? {
                modes: ability.modes.map((mode) => ({
                  label: mode.label,
                  effects: mode.effects.map((effect) => ({ ...effect })),
                  targetRequirements: (mode.targetRequirements ?? []).map((requirement) => ({
                    ...requirement,
                  })),
                })),
              }
            : {}),
          ...(ability.lifeCost && ability.lifeCost > 0 ? { lifeCost: ability.lifeCost } : {}),
          ...(ability.timing === "sorcery" ? { timing: "sorcery" as const } : {}),
          ...(ability.requiresCreatedToken ? { requiresCreatedToken: true } : {}),
          ...(ability.requiresOpponentMoreLands ? { requiresOpponentMoreLands: true } : {}),
          ...(ability.requiresControlled
            ? {
                requiresControlled: {
                  ...(ability.requiresControlled.types
                    ? { types: [...ability.requiresControlled.types] }
                    : {}),
                  ...(ability.requiresControlled.subtypes
                    ? { subtypes: [...ability.requiresControlled.subtypes] }
                    : {}),
                },
              }
            : {}),
        }))
      : [],
    imageUrl: input.imageUrl ?? "",
    ...(input.ward && input.ward > 0 ? { ward: input.ward } : {}),
    ...(input.protectionFrom && input.protectionFrom.length > 0
      ? { protectionFrom: [...input.protectionFrom] }
      : {}),
    ...(input.enchant ? { enchant: input.enchant } : {}),
    ...(input.loyalty && input.loyalty > 0 ? { loyalty: input.loyalty } : {}),
    ...(input.loyaltyAbilities && input.loyaltyAbilities.length > 0
      ? {
          loyaltyAbilities: input.loyaltyAbilities.map((ability) => ({
            cost: ability.cost,
            effects: ability.effects.map((effect) => ({ ...effect })),
            targetRequirements: ability.targetRequirements.map((requirement) => ({ ...requirement })),
          })),
        }
      : {}),
    ...(input.modes && input.modes.length > 0
      ? {
          modes: input.modes.map((mode) => ({
            label: mode.label,
            ...(mode.extraCost ? { extraCost: mode.extraCost } : {}),
            ...(mode.dash ? { dash: true } : {}),
            effects: mode.effects.map((effect) => ({ ...effect })),
            targetRequirements: mode.targetRequirements.map((requirement) => ({ ...requirement })),
          })),
        }
      : {}),
    ...(input.noMaxHandSize ? { noMaxHandSize: true } : {}),
    ...(input.extraLandDrops && input.extraLandDrops > 0
      ? { extraLandDrops: input.extraLandDrops }
      : {}),
    ...(input.cantBeCountered ? { cantBeCountered: true } : {}),
    ...(input.creatureSpellsCantBeCountered ? { creatureSpellsCantBeCountered: true } : {}),
    ...(input.opponentsLockedDuringYourTurn ? { opponentsLockedDuringYourTurn: true } : {}),
    ...(input.opponentsCantCastDuringYourTurn ? { opponentsCantCastDuringYourTurn: true } : {}),
    ...(input.mustAttack ? { mustAttack: true } : {}),
    ...(input.notCreatureBelowDevotion
      ? { notCreatureBelowDevotion: { ...input.notCreatureBelowDevotion } }
      : {}),
    ...(input.freeIfCommander ? { freeIfCommander: true } : {}),
    ...(input.changeling ? { changeling: true } : {}),
    ...(input.storm ? { storm: true } : {}),
    ...(input.doesntUntap ? { doesntUntap: true } : {}),
    ...(input.grantsFlash ? { grantsFlash: true } : {}),
    ...(input.extraDrawStepDraws ? { extraDrawStepDraws: true } : {}),
    ...(input.affinityArtifacts ? { affinityArtifacts: true } : {}),
    ...(input.selfDiscount ? { selfDiscount: { ...input.selfDiscount } } : {}),
    ...(input.affinityAllCreatures ? { affinityAllCreatures: true } : {}),
    ...(input.flashback
      ? {
          flashback: {
            manaCost: input.flashback.manaCost,
            ...(input.flashback.life ? { life: input.flashback.life } : {}),
          },
        }
      : {}),
    ...(input.topOfLibrary
      ? {
          topOfLibrary: {
            ...(input.topOfLibrary.look ? { look: true } : {}),
            ...(input.topOfLibrary.playLands ? { playLands: true } : {}),
            ...(input.topOfLibrary.castAll ? { castAll: true } : {}),
            ...(input.topOfLibrary.castTypesAny
              ? { castTypesAny: [...input.topOfLibrary.castTypesAny] }
              : {}),
          },
        }
      : {}),
    ...(input.chooseCreatureTypeOnEnter ? { chooseCreatureTypeOnEnter: true } : {}),
    ...(input.selfIsChosenType ? { selfIsChosenType: true } : {}),
    ...(input.landChosenColorBonus ? { landChosenColorBonus: true } : {}),
    ...(input.landTapEcho ? { landTapEcho: true } : {}),
    ...(input.opponentLandTapsSkipUntap ? { opponentLandTapsSkipUntap: true } : {}),
    ...(input.rebound ? { rebound: true } : {}),
    ...(input.triggerDoubling
      ? {
          triggerDoubling: {
            ...input.triggerDoubling,
            ...(input.triggerDoubling.causeTypesAny
              ? { causeTypesAny: [...input.triggerDoubling.causeTypesAny] }
              : {}),
            ...(input.triggerDoubling.source
              ? { source: { ...input.triggerDoubling.source } }
              : {}),
          },
        }
      : {}),
    ...(input.chooseColorOnEnter ? { chooseColorOnEnter: true } : {}),
    ...(input.enchantedTappedBonus
      ? { enchantedTappedBonus: { ...input.enchantedTappedBonus } }
      : {}),
    ...(input.entersWithXCounters ? { entersWithXCounters: true } : {}),
    ...(input.enterAsCopy ? { enterAsCopy: { ...input.enterAsCopy } } : {}),
    ...(input.playLandsFromGraveyard ? { playLandsFromGraveyard: true } : {}),
    ...(input.leyline ? { leyline: true } : {}),
    ...(input.castFromGraveyard
      ? {
          castFromGraveyard: {
            ...(input.castFromGraveyard.types ? { types: [...input.castFromGraveyard.types] } : {}),
            ...(input.castFromGraveyard.subtypes
              ? { subtypes: [...input.castFromGraveyard.subtypes] }
              : {}),
          },
        }
      : {}),
    ...(input.untapDuringEachUntap
      ? { untapDuringEachUntap: input.untapDuringEachUntap }
      : {}),
    ...(input.opponentCreaturesEnterTapped ? { opponentCreaturesEnterTapped: true } : {}),
    ...(input.opponentArtifactsEnterTapped ? { opponentArtifactsEnterTapped: true } : {}),
    ...(input.ascend ? { ascend: true } : {}),
    ...(input.additionalCost ? { additionalCost: { ...input.additionalCost } } : {}),
    ...(input.attackTax ? { attackTax: { ...input.attackTax } } : {}),
    ...(input.dynamicPt ? { dynamicPt: { count: input.dynamicPt.count } } : {}),
    ...(input.bonusPt ? { bonusPt: { ...input.bonusPt } } : {}),
    ...(input.modeChoice ? { modeChoice: { ...input.modeChoice } } : {}),
    ...(input.costReductions && input.costReductions.length > 0
      ? {
          costReductions: input.costReductions.map((entry) => ({
            generic: entry.generic,
            filter: {
              ...(entry.filter.types ? { types: [...entry.filter.types] } : {}),
              ...(entry.filter.typesAny ? { typesAny: [...entry.filter.typesAny] } : {}),
              ...(entry.filter.subtypesAny ? { subtypesAny: [...entry.filter.subtypesAny] } : {}),
              ...(entry.filter.colors ? { colors: [...entry.filter.colors] } : {}),
              ...(entry.filter.chosenSubtype ? { chosenSubtype: true } : {}),
            },
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
    attachedTo: null,
    loyaltyActivatedThisTurn: false,
    faceDown: false,
    chosenCreatureType: null,
    chosenColor: null,
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
    oncePerTurnFired: [],
    pendingExtraCombats: 0,
    delayedEndStep: [],
    spellsCastThisTurn: 0,
    preventCombatDamage: false,
  };
}
