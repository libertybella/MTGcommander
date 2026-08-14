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
export { declareAttackers, declareBlockers, priorityForStep, creaturePower, creatureToughness } from "./combat";
export { applyEffect, applyEffects, bindCardEffect, bindCardEffects } from "./effects";
export type { BindEffectContext } from "./effects";
export { hasKeyword } from "./keywords";
export { wouldSkipDraw } from "./derived";
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
export { dealOpeningHands, seatCatalogDecks, seatDecks, startCatalogGame, startDefinitionGame } from "./setup";
export type { CatalogDeckSpec, StartCatalogGameOptions, StartDefinitionGameOptions } from "./setup";
export { passPriority, putSpellOnStack, resolveTopOfStack } from "./stack";
export {
  definitionTypeLine,
  isCommander,
  isCreature,
  COMMANDER_DAMAGE_TO_LOSE,
  isInstant,
  isInstantOrSorcery,
  isLand,
  isMainPhase,
  isSorcery,
} from "./cardTypes";
export type { MoveCardOptions } from "./zones";
export { TURN_SEQUENCE, advanceStep, advanceSteps } from "./turn";
export type { TurnSlot } from "./turn";
export { livingPlayers, livingPlayerCount, winnerId } from "./players";
export { eliminatePlayer } from "./elimination";
export { isGameOver } from "./status";
export { redactForViewer, isHiddenFromViewer, HIDDEN_DEFINITION_ID } from "./visibility";
export { isChosenTargetLegal, validateChosenTargets } from "./targeting";
export {
  addMana,
  canPayManaCost,
  emptyManaPools,
  MANA_COLORS,
  parseManaCost,
  payManaCost,
  removeMana,
  tapCard,
  tapForMana,
  untapCard,
} from "./mana";
export type { ParsedManaCost } from "./mana";
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
  GameAction,
  GameEffect,
  EffectTarget,
  GameEvent,
  GameId,
  GameLogEntry,
  GameState,
  Keyword,
  ManaColor,
  ManaPool,
  Phase,
  PlayerSelector,
  RelativePlayer,
  PlayerId,
  PlayerState,
  PlayerZones,
  ReplacementEffect,
  StackObject,
  StackObjectId,
  StaticModifier,
  Step,
  TargetKind,
  TargetRequirement,
  TurnState,
  ZoneName,
} from "./types";
