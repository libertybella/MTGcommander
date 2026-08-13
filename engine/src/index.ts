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
export { declareAttackers, declareBlockers, priorityForStep } from "./combat";
export { applyEffect, applyEffects, bindCardEffect, bindCardEffects } from "./effects";
export type { BindEffectContext } from "./effects";
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
} from "./catalog";
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
  GameAction,
  GameEffect,
  EffectTarget,
  GameEvent,
  GameId,
  GameState,
  ManaColor,
  ManaPool,
  Phase,
  PlayerSelector,
  RelativePlayer,
  PlayerId,
  PlayerState,
  PlayerZones,
  StackObject,
  StackObjectId,
  Step,
  TargetKind,
  TargetRequirement,
  TurnState,
  ZoneName,
} from "./types";
