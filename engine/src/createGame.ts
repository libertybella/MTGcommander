import { deriveCharacteristics } from "./characteristics";
import { createId } from "./ids";
import type {
  ProtectionFrom,
  CardDefinition,
  CardInstance,
  CardTrigger,
  Color,
  ControlledGate,
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

/**
 * Deep-copies an "Activate only if you control …" gate. Shared by the
 * activated-ability, mana-ability, and static-ability mappers below: the three
 * used to carry identical inline spreads, which meant every new gate field had
 * to be added in three places or it silently dropped on intake.
 */
function copyProtection(from: ProtectionFrom): ProtectionFrom {
  // Destructured for the same reason as `copyControlledGate`: a new
  // ProtectionFrom field must be a tsc error here, not a silent drop.
  const {
    colors,
    types,
    subtypes,
    multicolored,
    colorless,
    everything,
    colorsOutsideCommanderIdentity,
    ...rest
  } = from;
  const exhaustive: Record<string, never> = rest;
  void exhaustive;
  return {
    ...(colors ? { colors: [...colors] } : {}),
    ...(types ? { types: [...types] } : {}),
    ...(subtypes ? { subtypes: [...subtypes] } : {}),
    ...(multicolored ? { multicolored: true } : {}),
    ...(colorless ? { colorless: true } : {}),
    ...(everything ? { everything: true } : {}),
    ...(colorsOutsideCommanderIdentity ? { colorsOutsideCommanderIdentity: true } : {}),
  };
}

function copyControlledGate(gate: ControlledGate): ControlledGate {
  // Destructured, so a new ControlledGate field is a tsc error HERE rather
  // than a silent drop: `rest` has to stay empty. `atLeast` was added in wave
  // 219 and never reached this copier, so every counted gate lost its count
  // on the way through `createCardDefinition` — the gate stayed, asking
  // "do you control a land" instead of "do you control six".
  const { types, subtypes, subtypesAny, legendary, minPower, atLeast, ...rest } = gate;
  const exhaustive: Record<string, never> = rest;
  void exhaustive;
  return {
    ...(types ? { types: [...types] } : {}),
    ...(subtypes ? { subtypes: [...subtypes] } : {}),
    ...(subtypesAny ? { subtypesAny: [...subtypesAny] } : {}),
    ...(legendary ? { legendary: true } : {}),
    ...(minPower !== undefined ? { minPower } : {}),
    ...(atLeast !== undefined ? { atLeast } : {}),
  };
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

function copySubjectFilter(
  filter: NonNullable<CardTrigger["subjectFilter"]>,
): NonNullable<CardTrigger["subjectFilter"]> {
  return {
    ...filter,
    ...(filter.types ? { types: [...filter.types] } : {}),
    ...(filter.typesAny ? { typesAny: [...filter.typesAny] } : {}),
    ...(filter.nonTypes ? { nonTypes: [...filter.nonTypes] } : {}),
    ...(filter.subtypes ? { subtypes: [...filter.subtypes] } : {}),
    ...(filter.subtypesAny ? { subtypesAny: [...filter.subtypesAny] } : {}),
    ...(filter.nonSubtypes ? { nonSubtypes: [...filter.nonSubtypes] } : {}),
    ...(filter.colors ? { colors: [...filter.colors] } : {}),
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
        | "wardLife"
        | "modes"
        | "protectionFrom"
        | "hexproofFrom"
        | "retrace"
        | "spliceOntoArcane"
        | "dredge"
        | "opponentsSkipExtraTurns"
        | "grantsRetrace"
        | "enchant"
        | "reanimateOnEnter"
        | "copySelfWhenCastFromGraveyard"
        | "cascade"
        | "harmonizeConvoke"
        | "loyalty"
        | "loyaltyAbilities"
        | "noMaxHandSize"
        | "landsEnterUntapped"
        | "totemArmor"
        | "targetingLifeTax"
        | "opponentsEnterTriggersSuppressed"
        | "payLifeForColor"
        | "handSizeEffect"
        | "opponentsDrawCap"
        | "noncreatureSpellCap"
        | "cantLoseGame"
        | "creaturesDontUntap"
        | "controllerHexproof"
        | "attackLimitPerCombat"
        | "extraBlocksGranted"
        | "damageReplacement"
        | "manaTapMultiplier"
        | "altCost"
        | "extraLandDrops"
        | "extraLandDropsForAll"
        | "opponentNonbasicLandsEnterTapped"
        | "cantBeCountered"
        | "spellsCantBeCountered"
        | "opponentsLockedDuringYourTurn"
        | "opponentsCantCastDuringYourTurn"
        | "mustAttack"
        | "notCreatureBelowDevotion"
        | "freeIfCommander"
        | "altCostIfCreatures"
        | "changeling"
        | "storm"
        | "doesntUntap"
        | "toxic"
        | "artifactAbilityDiscount"
        | "untapRestriction"
        | "grantsFlash"
        | "controlsOpponentSearches"
        | "convoke"
        | "improvise"
        | "delve"
        | "grantsCostKeyword"
        | "grantsFlashFor"
        | "castFreeFromHand"
        | "extraDrawStepDraws"
        | "affinityArtifacts"
        | "selfDiscount"
        | "affinityAllCreatures"
        | "topOfLibrary"
        | "flashback"
        | "evoke"
        | "splitSecond"
        | "blockPowerGate"
        | "echo"
        | "escalate"
        | "costReductions"
        | "chooseCreatureTypeOnEnter"
        | "chooseCardTypeOnEnter"
        | "enterCountersPerChosenType"
        | "freeEquipIfArtifacts"
        | "opponentsCastOnlyFromHand"
        | "selfIsChosenType"
        | "triggerDoubling"
        | "landChosenColorBonus"
        | "landTapEcho"
        | "opponentLandTapsSkipUntap"
        | "rebound"
        | "chooseColorOnEnter"
        | "chooseColorExcludes"
        | "enchantedTappedBonus"
        | "entersWithXCounters"
        | "entersWithXCounterKind"
        | "entersWithCounters"
        | "enterAsCopy"
        | "grantsEscape"
        | "playLandsFromGraveyard"
        | "leyline"
        | "openingHandStart"
        | "saga"
        | "castFromGraveyard"
        | "castFromExile"
        | "playExiledWithStashCounters"
        | "spendBlueAsAnyForAbilities"
        | "ascend"
        | "untapDuringEachUntap"
        | "abilityHaste"
        | "opponentCreaturesEnterTapped"
        | "opponentArtifactsEnterTapped"
        | "additionalCost"
        | "bargain"
        | "bestow"
        | "reconfigure"
        | "sacrificeIfCastAtInstantSpeed"
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
          // Copied WHOLE. A field-by-field rebuild here drops any trigger
          // flag added later, in silence and while typechecking — this list
          // ate `fromGraveyard` the same afternoon it was written, which is
          // the fourth time the same defect has eaten the same wave's flag.
          // Only the nested objects and arrays are rebuilt, so the copy
          // stays deep.
          ...trigger,
          ...(trigger.condition ? { condition: { ...trigger.condition } } : {}),
          ...(trigger.subjectFilter
            ? { subjectFilter: copySubjectFilter(trigger.subjectFilter) }
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
          ...(trigger.modeChoice ? { modeChoice: { ...trigger.modeChoice } } : {}),
        }))
      : [],
    replacements: input.replacements ? input.replacements.map((replacement) => ({ ...replacement })) : [],
    staticAbilities: input.staticAbilities
      ? input.staticAbilities.map((ability) => ({
          // Copied whole, for the reason the triggers above are.
          ...ability,
          selector: { ...ability.selector },
          effect: { ...ability.effect },
          ...(ability.requiresControlled
            ? { requiresControlled: copyControlledGate(ability.requiresControlled) }
            : {}),
          ...(ability.requiresCounters
            ? { requiresCounters: { ...ability.requiresCounters } }
            : {}),
          ...(ability.requiresControlledBelow
            ? { requiresControlledBelow: { ...ability.requiresControlledBelow } }
            : {}),
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
          ...(ability.poisonToController === undefined
            ? {}
            : { poisonToController: ability.poisonToController }),
          ...(ability.gainLifeToController === undefined
            ? {}
            : { gainLifeToController: ability.gainLifeToController }),
          ...(ability.count && ability.count > 1 ? { count: ability.count } : {}),
          ...(ability.sacrificeSelf ? { sacrificeSelf: true } : {}),
          ...(ability.costMana ? { costMana: ability.costMana } : {}),
          ...(ability.costSacrifice ? { costSacrifice: ability.costSacrifice } : {}),
          ...(ability.costDiscardHand ? { costDiscardHand: true } : {}),
          ...(ability.upgrade
            ? {
                upgrade: {
                  requires: ability.upgrade.requires.map((gate) => copyControlledGate(gate)),
                  ...(ability.upgrade.selfCounter
                    ? { selfCounter: ability.upgrade.selfCounter }
                    : {}),
                  ...(ability.upgrade.produces ? { produces: { ...ability.upgrade.produces } } : {}),
                  ...(ability.upgrade.anyColor !== undefined
                    ? { anyColor: ability.upgrade.anyColor }
                    : {}),
                  ...(ability.upgrade.sameTypeCount !== undefined
                    ? { sameTypeCount: ability.upgrade.sameTypeCount }
                    : {}),
                },
              }
            : {}),
          ...(ability.costSacrificeSubtype
            ? { costSacrificeSubtype: ability.costSacrificeSubtype }
            : {}),
          ...(ability.noTap ? { noTap: true } : {}),
          ...(ability.countFromPower ? { countFromPower: true } : {}),
          ...(ability.countFromDevotion ? { countFromDevotion: true } : {}),
          ...(ability.exertSelf ? { exertSelf: true } : {}),
          ...(ability.countFromChosenTypeCreatures
            ? { countFromChosenTypeCreatures: true }
            : {}),
          ...(ability.countFromGreatestControlledPower
            ? { countFromGreatestControlledPower: true }
            : {}),
          ...(ability.countFromEnchantments ? { countFromEnchantments: true } : {}),
          ...(ability.countFromArtifacts ? { countFromArtifacts: true } : {}),
          ...(ability.oncePerTurn ? { oncePerTurn: true } : {}),
          ...(ability.onlyYourTurn ? { onlyYourTurn: true } : {}),
          ...(ability.requiresManaCounters
            ? { requiresManaCounters: { ...ability.requiresManaCounters } }
            : {}),
          ...(ability.costTapCreature ? { costTapCreature: true } : {}),
          ...(ability.costTapArtifact ? { costTapArtifact: true } : {}),
          ...(ability.costTapCreatureLegendary ? { costTapCreatureLegendary: true } : {}),
          ...(ability.requiresCondition ? { requiresCondition: ability.requiresCondition } : {}),
          ...(ability.anyColorAmong ? { anyColorAmong: ability.anyColorAmong } : {}),
          ...(ability.producesChosenColor ? { producesChosenColor: true } : {}),
          ...(ability.producesColorsAmong
            ? { producesColorsAmong: ability.producesColorsAmong }
            : {}),
          ...(ability.requiresCount ? { requiresCount: { ...ability.requiresCount } } : {}),
          ...(ability.spendOnly ? { spendOnly: { ...ability.spendOnly } } : {}),
          ...(ability.rider ? { rider: { ...ability.rider } } : {}),
          ...(ability.spendOnly ? { spendOnly: { ...ability.spendOnly } } : {}),
          ...(ability.rider ? { rider: { ...ability.rider } } : {}),
          ...(ability.requiresControlled
            ? { requiresControlled: copyControlledGate(ability.requiresControlled) }
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
          ...(ability.sacrificeSubtype ? { sacrificeSubtype: ability.sacrificeSubtype } : {}),
          ...(ability.sacrificeCount && ability.sacrificeCount > 1
            ? { sacrificeCount: ability.sacrificeCount }
            : {}),
          ...(ability.removeCounterCost
            ? { removeCounterCost: { ...ability.removeCounterCost } }
            : {}),
          ...(ability.addCounterCost ? { addCounterCost: { ...ability.addCounterCost } } : {}),
          ...(ability.discardCost
            ? {
                discardCost: {
                  count: ability.discardCost.count,
                  ...(ability.discardCost.types ? { types: [...ability.discardCost.types] } : {}),
                },
              }
            : {}),
          ...(ability.millCost !== undefined ? { millCost: ability.millCost } : {}),
          ...(ability.exileFromGraveyardCost
            ? {
                exileFromGraveyardCost: {
                  count: ability.exileFromGraveyardCost.count,
                  ...(ability.exileFromGraveyardCost.types
                    ? { types: [...ability.exileFromGraveyardCost.types] }
                    : {}),
                },
              }
            : {}),
          ...(ability.exileSelf ? { exileSelf: true } : {}),
          ...(ability.oncePerTurn ? { oncePerTurn: true } : {}),
          ...(ability.costTapCreatureOther ? { costTapCreatureOther: true } : {}),
          ...(ability.legendaryDiscount ? { legendaryDiscount: true } : {}),
          ...(ability.subtypeDiscount ? { subtypeDiscount: ability.subtypeDiscount } : {}),
          ...(ability.lifeCostFromCommanderColors
            ? { lifeCostFromCommanderColors: true }
            : {}),
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
          ...(ability.payWithChosenColorOnly ? { payWithChosenColorOnly: true } : {}),
          ...(ability.timing === "sorcery" || ability.timing === "your_turn"
            ? { timing: ability.timing }
            : {}),
          ...(ability.requiresAttackersThisTurn !== undefined
            ? { requiresAttackersThisTurn: ability.requiresAttackersThisTurn }
            : {}),
          ...(ability.xCost === undefined ? {} : { xCost: ability.xCost }),
          ...(ability.sacrificeCountFromX ? { sacrificeCountFromX: true } : {}),
          ...(ability.requiresCreatedToken ? { requiresCreatedToken: true } : {}),
          ...(ability.requiresCondition ? { requiresCondition: ability.requiresCondition } : {}),
          ...(ability.requiresOpponentMoreLands ? { requiresOpponentMoreLands: true } : {}),
          ...(ability.requiresControlled
            ? { requiresControlled: copyControlledGate(ability.requiresControlled) }
            : {}),
        }))
      : [],
    imageUrl: input.imageUrl ?? "",
    ...(input.ward && input.ward > 0 ? { ward: input.ward } : {}),
    ...(input.wardLife && input.wardLife > 0 ? { wardLife: input.wardLife } : {}),
    ...(input.hexproofFrom && input.hexproofFrom.length > 0
      ? { hexproofFrom: [...input.hexproofFrom] }
      : {}),
    ...(input.protectionFrom && Object.keys(input.protectionFrom).length > 0
      ? { protectionFrom: copyProtection(input.protectionFrom) }
      : {}),
    ...(input.enchant ? { enchant: input.enchant } : {}),
    ...(input.reanimateOnEnter ? { reanimateOnEnter: true } : {}),
    ...(input.cascade ? { cascade: input.cascade } : {}),
    ...(input.harmonizeConvoke ? { harmonizeConvoke: true } : {}),
    ...(input.copySelfWhenCastFromGraveyard
      ? { copySelfWhenCastFromGraveyard: true }
      : {}),
    ...(input.loyalty && input.loyalty > 0 ? { loyalty: input.loyalty } : {}),
    ...(input.loyaltyAbilities && input.loyaltyAbilities.length > 0
      ? {
          loyaltyAbilities: input.loyaltyAbilities.map((ability) => ({
            cost: ability.cost,
            ...(ability.xLoyaltyCost ? { xLoyaltyCost: true } : {}),
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
            ...(mode.replacesCost ? { replacesCost: mode.replacesCost } : {}),
            ...(mode.dash ? { dash: true } : {}),
            effects: mode.effects.map((effect) => ({ ...effect })),
            targetRequirements: mode.targetRequirements.map((requirement) => ({ ...requirement })),
          })),
        }
      : {}),
    ...(input.noMaxHandSize ? { noMaxHandSize: true } : {}),
    ...(input.landsEnterUntapped ? { landsEnterUntapped: true } : {}),
    ...(input.totemArmor ? { totemArmor: true } : {}),
    ...(input.targetingLifeTax ? { targetingLifeTax: input.targetingLifeTax } : {}),
    ...(input.opponentsEnterTriggersSuppressed
      ? { opponentsEnterTriggersSuppressed: true }
      : {}),
    ...(input.payLifeForColor ? { payLifeForColor: input.payLifeForColor } : {}),
    ...(input.handSizeEffect
      ? {
          handSizeEffect: {
            scope: input.handSizeEffect.scope,
            mode: input.handSizeEffect.mode,
            amount: input.handSizeEffect.amount,
          },
        }
      : {}),
    ...(input.opponentsDrawCap === undefined
      ? {}
      : { opponentsDrawCap: input.opponentsDrawCap }),
    ...(input.noncreatureSpellCap === undefined
      ? {}
      : { noncreatureSpellCap: input.noncreatureSpellCap }),
    ...(input.cantLoseGame ? { cantLoseGame: true } : {}),
    ...(input.creaturesDontUntap ? { creaturesDontUntap: true } : {}),
    ...(input.controllerHexproof ? { controllerHexproof: true } : {}),
    ...(input.attackLimitPerCombat === undefined
      ? {}
      : { attackLimitPerCombat: input.attackLimitPerCombat }),
    ...(input.extraBlocksGranted === undefined
      ? {}
      : { extraBlocksGranted: input.extraBlocksGranted }),
    ...(input.damageReplacement ? { damageReplacement: { ...input.damageReplacement } } : {}),
    ...(input.manaTapMultiplier ? { manaTapMultiplier: input.manaTapMultiplier } : {}),
    ...(input.altCost ? { altCost: { ...input.altCost } } : {}),
    ...(input.extraLandDropsForAll && input.extraLandDropsForAll > 0
      ? { extraLandDropsForAll: input.extraLandDropsForAll }
      : {}),
    ...(input.opponentNonbasicLandsEnterTapped
      ? { opponentNonbasicLandsEnterTapped: true }
      : {}),
    ...(input.extraLandDrops && input.extraLandDrops > 0
      ? { extraLandDrops: input.extraLandDrops }
      : {}),
    ...(input.cantBeCountered ? { cantBeCountered: true } : {}),
    ...(input.spellsCantBeCountered
      ? {
          spellsCantBeCountered: {
            ...(input.spellsCantBeCountered.types
              ? { types: [...input.spellsCantBeCountered.types] }
              : {}),
          },
        }
      : {}),
    ...(input.opponentsLockedDuringYourTurn ? { opponentsLockedDuringYourTurn: true } : {}),
    ...(input.opponentsCantCastDuringYourTurn ? { opponentsCantCastDuringYourTurn: true } : {}),
    ...(input.mustAttack ? { mustAttack: true } : {}),
    ...(input.notCreatureBelowDevotion
      ? { notCreatureBelowDevotion: { ...input.notCreatureBelowDevotion } }
      : {}),
    ...(input.freeIfCommander ? { freeIfCommander: true } : {}),
    ...(input.altCostIfCreatures ? { altCostIfCreatures: { ...input.altCostIfCreatures } } : {}),
    ...(input.changeling ? { changeling: true } : {}),
    ...(input.storm ? { storm: true } : {}),
    ...(input.doesntUntap ? { doesntUntap: true } : {}),
    ...(typeof input.toxic === "number" ? { toxic: input.toxic } : {}),
    ...(typeof input.artifactAbilityDiscount === "number" ? { artifactAbilityDiscount: input.artifactAbilityDiscount } : {}),
    ...(input.untapRestriction
      ? { untapRestriction: { max: input.untapRestriction.max, scope: input.untapRestriction.scope } }
      : {}),
    ...(input.convoke ? { convoke: true } : {}),
    ...(input.improvise ? { improvise: true } : {}),
    ...(input.delve ? { delve: true } : {}),
    ...(input.grantsCostKeyword ? { grantsCostKeyword: { ...input.grantsCostKeyword } } : {}),
    ...(input.grantsFlash ? { grantsFlash: true } : {}),
    ...(input.controlsOpponentSearches ? { controlsOpponentSearches: true } : {}),
    ...(input.grantsFlashFor ? { grantsFlashFor: { ...input.grantsFlashFor } } : {}),
    ...(input.castFreeFromHand ? { castFreeFromHand: { ...input.castFreeFromHand } } : {}),
    ...(input.extraDrawStepDraws ? { extraDrawStepDraws: true } : {}),
    ...(input.affinityArtifacts ? { affinityArtifacts: true } : {}),
    ...(input.selfDiscount ? { selfDiscount: { ...input.selfDiscount } } : {}),
    ...(input.affinityAllCreatures ? { affinityAllCreatures: true } : {}),
    ...(input.flashback
      ? {
          flashback: {
            manaCost: input.flashback.manaCost,
            ...(input.flashback.life ? { life: input.flashback.life } : {}),
            ...(input.flashback.sacrificeCreatures
              ? { sacrificeCreatures: input.flashback.sacrificeCreatures }
              : {}),
          },
        }
      : {}),
    ...(input.evoke ? { evoke: { manaCost: input.evoke.manaCost } } : {}),
    ...(input.splitSecond ? { splitSecond: true } : {}),
    ...(input.blockPowerGate ? { blockPowerGate: { ...input.blockPowerGate } } : {}),
    ...(input.echo ? { echo: { manaCost: input.echo.manaCost } } : {}),
    ...(input.escalate ? { escalate: input.escalate } : {}),
    ...(input.topOfLibrary
      ? {
          // Copied whole rather than field by field: a hand-written list here
          // falls behind the grant's own type and drops the newest flag in
          // silence, which is how wave 350 lost `requiresCoven`.
          topOfLibrary: {
            ...input.topOfLibrary,
            ...(input.topOfLibrary.castTypesAny
              ? { castTypesAny: [...input.topOfLibrary.castTypesAny] }
              : {}),
          },
        }
      : {}),
    ...(input.chooseCreatureTypeOnEnter ? { chooseCreatureTypeOnEnter: true } : {}),
    ...(input.chooseCardTypeOnEnter ? { chooseCardTypeOnEnter: true } : {}),
    ...(input.enterCountersPerChosenType
      ? { enterCountersPerChosenType: input.enterCountersPerChosenType }
      : {}),
    ...(input.freeEquipIfArtifacts ? { freeEquipIfArtifacts: input.freeEquipIfArtifacts } : {}),
    ...(input.opponentsCastOnlyFromHand ? { opponentsCastOnlyFromHand: true } : {}),
    ...(input.selfIsChosenType ? { selfIsChosenType: true } : {}),
    ...(input.landChosenColorBonus ? { landChosenColorBonus: true } : {}),
    ...(input.landTapEcho ? { landTapEcho: { ...input.landTapEcho } } : {}),
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
    ...(input.chooseColorExcludes ? { chooseColorExcludes: input.chooseColorExcludes } : {}),
    ...(input.enchantedTappedBonus
      ? { enchantedTappedBonus: { ...input.enchantedTappedBonus } }
      : {}),
    ...(input.entersWithXCounters ? { entersWithXCounters: true } : {}),
    ...(input.entersWithXCounterKind
      ? { entersWithXCounterKind: input.entersWithXCounterKind }
      : {}),
    ...(input.entersWithCounters ? { entersWithCounters: { ...input.entersWithCounters } } : {}),
    ...(input.enterAsCopy ? { enterAsCopy: { ...input.enterAsCopy } } : {}),
    ...(input.grantsEscape ? { grantsEscape: { ...input.grantsEscape } } : {}),
    ...(input.retrace ? { retrace: true } : {}),
    ...(input.spliceOntoArcane
      ? { spliceOntoArcane: { ...input.spliceOntoArcane } }
      : {}),
    ...(input.dredge ? { dredge: input.dredge } : {}),
    ...(input.opponentsSkipExtraTurns ? { opponentsSkipExtraTurns: true } : {}),
    ...(input.grantsRetrace
      ? {
          grantsRetrace: {
            filter: { ...input.grantsRetrace.filter },
            ...(input.grantsRetrace.onlyYourTurn ? { onlyYourTurn: true } : {}),
          },
        }
      : {}),
    ...(input.playLandsFromGraveyard ? { playLandsFromGraveyard: true } : {}),
    ...(input.leyline ? { leyline: true } : {}),
    ...(input.saga
      ? { saga: { chapters: input.saga.chapters.map((chapter) => chapter.map((effect) => ({ ...effect }))) } }
      : {}),
    ...(input.openingHandStart
      ? { openingHandStart: { ...input.openingHandStart } }
      : {}),
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
    ...(input.castFromExile ? { castFromExile: true } : {}),
    ...(input.playExiledWithStashCounters
      ? { playExiledWithStashCounters: true }
      : {}),
    ...(input.spendBlueAsAnyForAbilities
      ? { spendBlueAsAnyForAbilities: true }
      : {}),
    ...(input.abilityHaste ? { abilityHaste: true } : {}),
    ...(input.untapDuringEachUntap
      ? { untapDuringEachUntap: input.untapDuringEachUntap }
      : {}),
    ...(input.opponentCreaturesEnterTapped ? { opponentCreaturesEnterTapped: true } : {}),
    ...(input.opponentArtifactsEnterTapped ? { opponentArtifactsEnterTapped: true } : {}),
    ...(input.ascend ? { ascend: true } : {}),
    ...(input.bargain ? { bargain: true } : {}),
    ...(input.bestow ? { bestow: { ...input.bestow } } : {}),
    ...(input.reconfigure ? { reconfigure: { ...input.reconfigure } } : {}),
    ...(input.sacrificeIfCastAtInstantSpeed ? { sacrificeIfCastAtInstantSpeed: true } : {}),
    ...(input.additionalCost ? { additionalCost: { ...input.additionalCost } } : {}),
    ...(input.attackTax ? { attackTax: { ...input.attackTax } } : {}),
    ...(input.dynamicPt
      ? {
          dynamicPt: {
            count: input.dynamicPt.count,
            ...(input.dynamicPt.powerOnly ? { powerOnly: true } : {}),
          },
        }
      : {}),
    ...(input.bonusPt ? { bonusPt: { ...input.bonusPt } } : {}),
    ...(input.modeChoice ? { modeChoice: { ...input.modeChoice } } : {}),
    ...(input.costReductions && input.costReductions.length > 0
      ? {
          costReductions: input.costReductions.map((entry) => ({
            generic: entry.generic,
            ...(entry.scope ? { scope: entry.scope } : {}),
            ...(entry.condition ? { condition: entry.condition } : {}),
            ...(entry.notDuringControllersTurn ? { notDuringControllersTurn: true } : {}),
            filter: {
              ...(entry.filter.types ? { types: [...entry.filter.types] } : {}),
              ...(entry.filter.typesAny ? { typesAny: [...entry.filter.typesAny] } : {}),
              ...(entry.filter.subtypesAny ? { subtypesAny: [...entry.filter.subtypesAny] } : {}),
              ...(entry.filter.colors ? { colors: [...entry.filter.colors] } : {}),
              ...(entry.filter.chosenSubtype ? { chosenSubtype: true } : {}),
              ...(entry.filter.chosenCardType ? { chosenCardType: true } : {}),
              ...(entry.filter.minPower !== undefined ? { minPower: entry.filter.minPower } : {}),
              ...(entry.filter.keyword ? { keyword: entry.filter.keyword } : {}),
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
    poisonCounters: 0,
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
      startTimestamp: 0,
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
    delayedTriggers: [],
    spellsCastThisTurn: 0,
    preventCombatDamage: false,
  };
}
