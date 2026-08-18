import { isCreature } from "./cardTypes";
import { hasKeyword } from "./keywords";
import { isLiving, livingPlayers } from "./players";
import type {
  ChosenTarget,
  GameState,
  PlayerId,
  StackObjectId,
  TargetRequirement,
} from "./types";

function isLegalPlayerTarget(state: GameState, playerId: string): boolean {
  return isLiving(state, playerId);
}

function isLegalCreatureTarget(state: GameState, cardId: string, casterId?: PlayerId): boolean {
  const card = state.cards[cardId];
  if (!card || card.zone !== "battlefield" || !isCreature(state, cardId)) {
    return false;
  }
  if (
    casterId &&
    hasKeyword(state, cardId, "hexproof") &&
    casterId !== card.controllerId
  ) {
    return false;
  }
  return true;
}

function isLegalSpellTarget(state: GameState, stackObjectId: StackObjectId): boolean {
  const entry = state.stack.find((object) => object.id === stackObjectId);
  return Boolean(entry && entry.kind === "spell");
}

function isArtifactPermanent(state: GameState, cardId: string): boolean {
  const card = state.cards[cardId];
  const typeLine = card ? state.definitions[card.definitionId]?.typeLine.toLowerCase() ?? "" : "";
  return /\bartifact\b/.test(typeLine);
}

function isCreatureSpell(state: GameState, stackObjectId: StackObjectId): boolean {
  const entry = state.stack.find((object) => object.id === stackObjectId);
  if (!entry || entry.kind !== "spell" || !entry.sourceId) {
    return false;
  }
  const card = state.cards[entry.sourceId];
  const typeLine = card ? state.definitions[card.definitionId]?.typeLine.toLowerCase() ?? "" : "";
  return /\bcreature\b/.test(typeLine);
}

export function isChosenTargetLegal(
  state: GameState,
  requirement: TargetRequirement,
  target: ChosenTarget,
  casterId?: PlayerId,
): boolean {
  if (requirement.kind === "player") {
    return target.type === "player" && isLegalPlayerTarget(state, target.playerId);
  }
  if (requirement.kind === "opponent") {
    return (
      target.type === "player" &&
      Boolean(casterId) &&
      target.playerId !== casterId &&
      isLegalPlayerTarget(state, target.playerId)
    );
  }
  if (requirement.kind === "creature") {
    return target.type === "creature" && isLegalCreatureTarget(state, target.cardId, casterId);
  }
  if (requirement.kind === "nonartifact_creature") {
    return (
      target.type === "creature" &&
      isLegalCreatureTarget(state, target.cardId, casterId) &&
      !isArtifactPermanent(state, target.cardId)
    );
  }
  if (requirement.kind === "spell") {
    return target.type === "spell" && isLegalSpellTarget(state, target.stackObjectId);
  }
  if (requirement.kind === "creature_spell") {
    return target.type === "spell" && isLegalSpellTarget(state, target.stackObjectId) && isCreatureSpell(state, target.stackObjectId);
  }
  if (requirement.kind === "noncreature_spell") {
    return (
      target.type === "spell" &&
      isLegalSpellTarget(state, target.stackObjectId) &&
      !isCreatureSpell(state, target.stackObjectId)
    );
  }
  if (target.type === "player") {
    return isLegalPlayerTarget(state, target.playerId);
  }
  if (target.type === "spell") {
    return false;
  }
  return isLegalCreatureTarget(state, target.cardId, casterId);
}

/**
 * Cast-time check: the number of targets must match, and every target must be legal now.
 */
export function validateChosenTargets(
  state: GameState,
  requirements: TargetRequirement[],
  targets: ChosenTarget[],
  casterId?: PlayerId,
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
    if (!requirement || !target || !isChosenTargetLegal(state, requirement, target, casterId)) {
      throw new Error("Illegal target");
    }
  }
}

/** Resolve-time check: at least one required target is still legal. */
export function hasLegalTargetRemaining(
  state: GameState,
  requirements: TargetRequirement[],
  targets: ChosenTarget[],
  casterId?: PlayerId,
): boolean {
  if (requirements.length === 0) {
    return true;
  }
  return requirements.some((requirement, index) => {
    const target = targets[index];
    return Boolean(target && isChosenTargetLegal(state, requirement, target, casterId));
  });
}

/** Legal choices for one requirement, in seat then battlefield order. */
export function legalChoicesForRequirement(
  state: GameState,
  requirement: TargetRequirement,
  casterId: PlayerId,
): ChosenTarget[] {
  if (requirement.kind === "player") {
    return livingPlayers(state).map((player) => ({ type: "player" as const, playerId: player.id }));
  }
  if (requirement.kind === "opponent") {
    return livingPlayers(state)
      .filter((player) => player.id !== casterId)
      .map((player) => ({ type: "player" as const, playerId: player.id }));
  }
  if (requirement.kind === "creature") {
    return legalCreatureTargets(state, casterId);
  }
  if (requirement.kind === "nonartifact_creature") {
    return legalCreatureTargets(state, casterId).filter(
      (choice) => choice.type === "creature" && !isArtifactPermanent(state, choice.cardId),
    );
  }
  if (requirement.kind === "spell" || requirement.kind === "creature_spell" || requirement.kind === "noncreature_spell") {
    return state.stack
      .filter((entry) => entry.kind === "spell")
      .map((entry) => ({ type: "spell" as const, stackObjectId: entry.id }))
      .filter((choice) => isChosenTargetLegal(state, requirement, choice, casterId));
  }
  return [
    ...livingPlayers(state).map((player) => ({ type: "player" as const, playerId: player.id })),
    ...legalCreatureTargets(state, casterId),
  ];
}

function legalCreatureTargets(state: GameState, casterId: PlayerId): ChosenTarget[] {
  const choices: ChosenTarget[] = [];
  for (const player of state.players) {
    for (const cardId of player.zones.battlefield) {
      if (isLegalCreatureTarget(state, cardId, casterId)) {
        choices.push({ type: "creature", cardId });
      }
    }
  }
  return choices;
}

export function hasAnyLegalTargetSet(
  state: GameState,
  requirements: TargetRequirement[],
  casterId: PlayerId,
): boolean {
  if (requirements.length === 0) {
    return true;
  }
  return requirements.every(
    (requirement) => legalChoicesForRequirement(state, requirement, casterId).length > 0,
  );
}

/** First legal target per requirement, or null if any requirement has none. */
export function firstLegalTargetSet(
  state: GameState,
  requirements: TargetRequirement[],
  casterId: PlayerId,
): ChosenTarget[] | null {
  const chosen: ChosenTarget[] = [];
  for (const requirement of requirements) {
    const pick = legalChoicesForRequirement(state, requirement, casterId)[0];
    if (!pick) {
      return null;
    }
    chosen.push(pick);
  }
  return chosen;
}
