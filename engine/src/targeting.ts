import { isCreature } from "./cardTypes";
import { isLiving } from "./players";
import type {
  ChosenTarget,
  GameState,
  TargetRequirement,
} from "./types";

function isLegalPlayerTarget(state: GameState, playerId: string): boolean {
  return isLiving(state, playerId);
}

function isLegalCreatureTarget(state: GameState, cardId: string): boolean {
  const card = state.cards[cardId];
  return Boolean(card && card.zone === "battlefield" && isCreature(state, cardId));
}

export function isChosenTargetLegal(
  state: GameState,
  requirement: TargetRequirement,
  target: ChosenTarget,
): boolean {
  if (requirement.kind === "player") {
    return target.type === "player" && isLegalPlayerTarget(state, target.playerId);
  }
  if (requirement.kind === "creature") {
    return target.type === "creature" && isLegalCreatureTarget(state, target.cardId);
  }
  if (target.type === "player") {
    return isLegalPlayerTarget(state, target.playerId);
  }
  return isLegalCreatureTarget(state, target.cardId);
}

/**
 * Cast-time check: the number of targets must match, and every target must be legal now.
 */
export function validateChosenTargets(
  state: GameState,
  requirements: TargetRequirement[],
  targets: ChosenTarget[],
): void {
  if (requirements.length === 0) {
    if (targets.length > 0) {
      throw new Error("That spell does not require targets");
    }
    return;
  }
  if (targets.length !== requirements.length) {
    throw new Error(`Expected ${requirements.length} target(s)`);
  }
  for (let index = 0; index < requirements.length; index += 1) {
    const requirement = requirements[index];
    const target = targets[index];
    if (!requirement || !target || !isChosenTargetLegal(state, requirement, target)) {
      throw new Error("Illegal target");
    }
  }
}

/** Resolve-time check: at least one required target is still legal. */
export function hasLegalTargetRemaining(
  state: GameState,
  requirements: TargetRequirement[],
  targets: ChosenTarget[],
): boolean {
  if (requirements.length === 0) {
    return true;
  }
  return requirements.some((requirement, index) => {
    const target = targets[index];
    return Boolean(target && isChosenTargetLegal(state, requirement, target));
  });
}
