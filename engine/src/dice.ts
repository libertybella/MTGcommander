import { cloneGameState } from "./clone";
import { requireLiving } from "./players";
import type { GameState, PlayerId } from "./types";

export const D20_SIDES = 20;
export const MIN_DIE_SIDES = 2;
export const MAX_DIE_SIDES = 1000;

export function normalizeDieSides(sides: number): number {
  if (!Number.isInteger(sides) || sides < MIN_DIE_SIDES || sides > MAX_DIE_SIDES) {
    throw new Error(`Die must have between ${MIN_DIE_SIDES} and ${MAX_DIE_SIDES} sides`);
  }
  return sides;
}

function rollDie(sides: number, random: () => number = Math.random): number {
  return Math.floor(random() * sides) + 1;
}

/**
 * Table die roll. Does not require priority. Result is public on the game log.
 */
export function applyRollDie(
  state: GameState,
  playerId: PlayerId,
  sides: number = D20_SIDES,
  random: () => number = Math.random,
): GameState {
  requireLiving(state, playerId);
  const normalized = normalizeDieSides(sides);
  const result = rollDie(normalized, random);
  const next = cloneGameState(state);
  next.log.push({ kind: "die_roll", playerId, sides: normalized, result });
  return next;
}

export function rollDieResult(sides: number, random: () => number = Math.random): number {
  return rollDie(normalizeDieSides(sides), random);
}
