/**
 * Pure TypeScript game-engine package.
 * Must not import React, DOM, Electron, or networking.
 */

export { getEngineInfo, type EngineInfo } from "./info";
export { cloneGameState } from "./clone";
export {
  countCardPlacements,
  enterOwnerZone,
  findCardZone,
  isPlayerZone,
  moveCard,
  PLAYER_ZONES,
} from "./zones";
export { applyAction, applyActions } from "./actions";
export type { ApplyActionOptions } from "./actions";
export { applyManualOverride } from "./override";
export { applyRollDie, D20_SIDES, MIN_DIE_SIDES, MAX_DIE_SIDES, normalizeDieSides } from "./dice";
export {
  applyOpeningRoll,
  beginOpeningRoll,
  isOpeningRoll,
  openingRollPending,
} from "./openingRoll";
export { declareAttackers, declareBlockers, lockRemainingBlockers, priorityForStep, creaturePower, creatureToughness } from "./combat";
export { applyEffect, applyEffects, bindCardEffect, bindCardEffects } from "./effects";
export type { BindEffectContext } from "./effects";
export { hasKeyword } from "./keywords";
export { wouldSkipDraw, wouldEnterTapped } from "./derived";
export {
  testBear,
  testBlankInstant,
  testDrain,
  testForest,
  testGift,
  testRecruit,
  testRitual,
  testShock,
  testStudy,
  testTerror,
  testCounter,
} from "./catalog";
export { POOL_ID, syntheticPool, syntheticPoolById } from "./pool";
export {
  dealOpeningHands,
  defaultPlayerNames,
  seatCatalogDecks,
  seatDecks,
  startCatalogGame,
  startDefinitionGame,
} from "./setup";
export type {
  CatalogDeckSpec,
  StartCatalogGameOptions,
  StartDefinitionGameOptions,
  TablePlayerCount,
} from "./setup";
export { passPriority, putActivatedAbilityOnStack, putSpellOnStack, resolveTopOfStack } from "./stack";
export {
  characteristicsOf,
  definitionTypeLine,
  hasSubtype,
  hasSupertype,
  hasType,
  isBasic,
  isCommander,
  isCreature,
  COMMANDER_DAMAGE_TO_LOSE,
  isInstant,
  isInstantOrSorcery,
  isLand,
  isLegendary,
  isClass,
  isMainPhase,
  isPlaneswalker,
  isSorcery,
} from "./cardTypes";
export {
  colorsFromManaCost,
  deriveCharacteristics,
  manaValueOf,
  parseTypeLine,
} from "./characteristics";
export {
  canPayWithPotential,
  hasMeaningfulAction,
  legalActions,
  potentialMana,
} from "./legalActions";
export type { LegalAction, PotentialMana } from "./legalActions";
export type { MoveCardOptions } from "./zones";
export {
  DEFAULT_SHORTCUT_POLICY,
  TURN_SEQUENCE,
  advanceStep,
  advanceSteps,
  skipPriorityShortcuts,
} from "./turn";
export type { ShortcutPolicy, TurnSlot } from "./turn";
export { livingPlayers, livingPlayerCount, nextLivingPlayerId, winnerId } from "./players";
export { eliminatePlayer } from "./elimination";
export { isGameOver } from "./status";
export {
  applyBottomCards,
  applyKeepHand,
  applyTakeMulligan,
  beginMulligan,
  countedMulligans,
  DEFAULT_STARTING_HAND_SIZE,
  freeMulliganCount,
  isMulliganOpen,
} from "./mulligan";
export { redactForViewer, isHiddenFromViewer, HIDDEN_DEFINITION_ID } from "./visibility";
export { applyChooseTargets, applyChooseEnterReplacement, applyResolveOrderTriggers, applyResolvePay, applyResolveScry, applyResolveSearch, applyResolveSurveil, applyResolveDiscard, applyResolveChooseCard, applyResolveLookAssign, currentPrompt, isPromptOpen, legalSearchIds, lookedAtCardIds, legalIdsForChooseSources, searchMatches } from "./prompt";
export { queueSimultaneousTriggersInPlace } from "./triggers";
export { abilitiesRemoved, computedCard, computedCards } from "./characteristicsEngine";
export type { ComputedCard } from "./characteristicsEngine";
export { isChosenTargetLegal, validateChosenTargets, legalChoicesForRequirement, firstLegalTargetSet, hasAnyLegalTargetSet } from "./targeting";
export {
  addMana,
  canPayManaCost,
  COLOR_PIPS,
  emptyManaPools,
  MANA_COLORS,
  parseManaCost,
  payManaCost,
  removeMana,
  tapCard,
  tapForMana,
  untapCard,
} from "./mana";
export type { HybridPip, ParsedManaCost } from "./mana";
export { canTapForMana, manaAbilitiesOf, manaTapOptions, manaTapOptionsFor } from "./manaOptions";
export { createId } from "./ids";
export {
  createCardDefinition,
  createCardInstance,
  createGameState,
  emptyManaPool,
  emptyPlayerZones,
  type CreateGameOptions,
} from "./createGame";
export {
  parseGameAction,
  parseGameEvent,
  parseGameState,
  serializeGameAction,
  serializeGameEvent,
  serializeGameState,
} from "./serialize";
export {
  compileOracleCard,
  definitionIdForOracle,
  inferProduces,
  inferTapDraw,
  keywordsFromOracle,
  normalizeCardName,
} from "./oracle";
export type { OracleCard, OracleCompileResult } from "./oracle";
export {
  deckNames,
  expandDeckCards,
  parseMoxfieldPublicId,
  parseTextDecklist,
} from "./decklist";
export type { ParsedDeckCard, ParsedDecklist } from "./decklist";
export { shuffleInPlace } from "./shuffle";
export type {
  ActivatedAbility,
  CardCharacteristics,
  CardDefinition,
  CardDefinitionId,
  CardEffect,
  CardEffectTarget,
  CardIdSelector,
  CardInstance,
  CardInstanceId,
  ChosenTarget,
  ChosenTargetRef,
  Color,
  CommanderState,
  CombatAttack,
  CombatState,
  CardTrigger,
  EnterTappedUnless,
  GameAction,
  GameEffect,
  EffectTarget,
  GameEvent,
  GameId,
  GameLogEntry,
  GameState,
  ManualOverrideChange,
  Keyword,
  ManaAbility,
  ManaColor,
  ManaPool,
  MulliganState,
  OpeningRollState,
  PendingPrompt,
  Phase,
  PlayerSelector,
  RelativePlayer,
  PlayerId,
  PlayerState,
  PlayerZones,
  ReplacementEffect,
  StackObject,
  StackObjectId,
  StaticAbility,
  ContinuousEffect,
  ContinuousEffectData,
  EffectSelector,
  SearchDestination,
  SearchFilter,
  SpellMode,
  LoyaltyAbility,
  Step,
  TargetKind,
  TargetRequirement,
  TokenTemplate,
  TriggerCandidate,
  TurnState,
  ZoneName,
  ZoneReveal,
  LookDestination,
  CardFilter,
  ChooseCardSource,
  BoundChooseCardSource,
} from "./types";
export { tokenTemplatesOf, amassArmyTemplate, parseAmassClause } from "./tokens";
