/**
 * Pure TypeScript game-engine package.
 * Must not import React, DOM, Electron, or networking.
 */

export { getEngineInfo, type EngineInfo } from "./info";
export { cloneGameState } from "./clone";
export { countCardPlacements, findCardZone, moveCard, PLAYER_ZONES } from "./zones";
export type { MoveCardOptions } from "./zones";
export { TURN_SEQUENCE, advanceStep, advanceSteps } from "./turn";
export type { TurnSlot } from "./turn";
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
  CardInstance,
  CardInstanceId,
  Color,
  CommanderState,
  GameAction,
  GameEvent,
  GameId,
  GameState,
  ManaColor,
  ManaPool,
  Phase,
  PlayerId,
  PlayerState,
  PlayerZones,
  StackObject,
  StackObjectId,
  Step,
  TurnState,
  ZoneName,
} from "./types";
