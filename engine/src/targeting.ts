import { characteristicsOf, isCreature, isPlaneswalker } from "./cardTypes";
import { hasKeyword } from "./keywords";
import { isLiving, livingPlayers } from "./players";
import type {
  CardInstanceId,
  ChosenTarget,
  Color,
  GameState,
  PlayerId,
  StackObjectId,
  TargetRequirement,
} from "./types";

function isLegalPlayerTarget(state: GameState, playerId: string): boolean {
  return isLiving(state, playerId);
}

function isLegalCreatureTarget(
  state: GameState,
  cardId: string,
  casterId?: PlayerId,
  sourceColors?: Color[],
): boolean {
  const card = state.cards[cardId];
  if (!card || card.zone !== "battlefield" || !isCreature(state, cardId)) {
    return false;
  }
  // Shroud blocks everyone, including its own controller (CR 702.18).
  if (hasKeyword(state, cardId, "shroud")) {
    return false;
  }
  if (
    casterId &&
    hasKeyword(state, cardId, "hexproof") &&
    casterId !== card.controllerId
  ) {
    return false;
  }
  if (sourceColors && sourceColors.length > 0) {
    const protection = state.definitions[card.definitionId]?.protectionFrom ?? [];
    if (protection.some((color) => sourceColors.includes(color))) {
      return false;
    }
  }
  return true;
}

function violatesColorExclusion(
  state: GameState,
  cardId: CardInstanceId,
  requirement: TargetRequirement,
): boolean {
  if (!requirement.excludeColors || requirement.excludeColors.length === 0) {
    return false;
  }
  const colors = characteristicsOf(state, cardId).colors;
  return requirement.excludeColors.some((color) => colors.includes(color));
}

/** Colors of a spell or ability source, for protection checks. */
export function sourceColorsOf(state: GameState, sourceId: CardInstanceId | null): Color[] {
  if (!sourceId) {
    return [];
  }
  const card = state.cards[sourceId];
  const definition = card ? state.definitions[card.definitionId] : undefined;
  return definition?.characteristics.colors ?? [];
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
  sourceColors?: Color[],
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
    return (
      target.type === "creature" &&
      isLegalCreatureTarget(state, target.cardId, casterId, sourceColors) &&
      !violatesColorExclusion(state, target.cardId, requirement)
    );
  }
  if (requirement.kind === "own_creature") {
    return (
      target.type === "creature" &&
      isLegalCreatureTarget(state, target.cardId, casterId, sourceColors) &&
      state.cards[target.cardId]?.controllerId === casterId
    );
  }
  if (requirement.kind === "permanent") {
    if (target.type !== "creature") {
      return false;
    }
    const card = state.cards[target.cardId];
    if (!card || card.zone !== "battlefield") {
      return false;
    }
    if (hasKeyword(state, target.cardId, "shroud")) {
      return false;
    }
    if (
      casterId &&
      hasKeyword(state, target.cardId, "hexproof") &&
      casterId !== card.controllerId
    ) {
      return false;
    }
    if (sourceColors && sourceColors.length > 0) {
      const protection = state.definitions[card.definitionId]?.protectionFrom ?? [];
      if (protection.some((color) => sourceColors.includes(color))) {
        return false;
      }
    }
    return true;
  }
  if (requirement.kind === "nonartifact_creature") {
    return (
      target.type === "creature" &&
      isLegalCreatureTarget(state, target.cardId, casterId, sourceColors) &&
      !isArtifactPermanent(state, target.cardId)
    );
  }
  if (
    requirement.kind === "own_graveyard_card" ||
    requirement.kind === "own_graveyard_creature_card"
  ) {
    if (target.type !== "creature" || !casterId) {
      return false;
    }
    const card = state.cards[target.cardId];
    if (!card || card.zone !== "graveyard" || card.ownerId !== casterId) {
      return false;
    }
    if (requirement.kind === "own_graveyard_creature_card") {
      return characteristicsOf(state, target.cardId).types.includes("creature");
    }
    return true;
  }
  if (
    requirement.kind === "creature_or_planeswalker" ||
    requirement.kind === "artifact" ||
    requirement.kind === "enchantment" ||
    requirement.kind === "artifact_or_enchantment" ||
    requirement.kind === "nonland_permanent"
  ) {
    if (target.type !== "creature") {
      return false;
    }
    const permanentLegal = isChosenTargetLegal(
      state,
      { kind: "permanent" },
      target,
      casterId,
      sourceColors,
    );
    if (!permanentLegal) {
      return false;
    }
    const types = characteristicsOf(state, target.cardId).types;
    switch (requirement.kind) {
      case "creature_or_planeswalker":
        return isCreature(state, target.cardId) || isPlaneswalker(state, target.cardId);
      case "artifact":
        return types.includes("artifact");
      case "enchantment":
        return types.includes("enchantment");
      case "artifact_or_enchantment":
        return types.includes("artifact") || types.includes("enchantment");
      case "nonland_permanent":
        return !types.includes("land");
    }
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
  return isLegalCreatureTarget(state, target.cardId, casterId, sourceColors);
}

/**
 * Cast-time check: the number of targets must match, and every target must be legal now.
 */
export function validateChosenTargets(
  state: GameState,
  requirements: TargetRequirement[],
  targets: ChosenTarget[],
  casterId?: PlayerId,
  sourceColors?: Color[],
): void {
  if (requirements.length === 0) {
    if (targets.length > 0) {
      throw new Error("That spell does not require targets");
    }
    return;
  }
  if (requirements.length === 1 && requirements[0]?.variable) {
    if (targets.length === 0) {
      throw new Error("Choose at least one target");
    }
    const seen = new Set(targets.map((target) => JSON.stringify(target)));
    if (seen.size !== targets.length) {
      throw new Error("Choose each target once");
    }
    for (const target of targets) {
      if (!isChosenTargetLegal(state, requirements[0]!, target, casterId, sourceColors)) {
        throw new Error("Illegal target");
      }
    }
    return;
  }
  if (targets.length !== requirements.length) {
    throw new Error(`Expected ${requirements.length} target(s)`);
  }
  for (let index = 0; index < requirements.length; index += 1) {
    const requirement = requirements[index];
    const target = targets[index];
    if (!requirement || !target || !isChosenTargetLegal(state, requirement, target, casterId, sourceColors)) {
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
  sourceColors?: Color[],
): boolean {
  if (requirements.length === 0) {
    return true;
  }
  if (requirements.length === 1 && requirements[0]?.variable) {
    return targets.some((target) =>
      isChosenTargetLegal(state, requirements[0]!, target, casterId, sourceColors),
    );
  }
  return requirements.some((requirement, index) => {
    const target = targets[index];
    return Boolean(target && isChosenTargetLegal(state, requirement, target, casterId, sourceColors));
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
  if (requirement.kind === "own_creature") {
    return legalCreatureTargets(state, casterId).filter(
      (choice) =>
        choice.type === "creature" && state.cards[choice.cardId]?.controllerId === casterId,
    );
  }
  if (
    requirement.kind === "own_graveyard_card" ||
    requirement.kind === "own_graveyard_creature_card"
  ) {
    const caster = state.players.find((entry) => entry.id === casterId);
    return (caster?.zones.graveyard ?? [])
      .map((cardId) => ({ type: "creature" as const, cardId }))
      .filter((choice) => isChosenTargetLegal(state, requirement, choice, casterId));
  }
  if (
    requirement.kind === "permanent" ||
    requirement.kind === "creature_or_planeswalker" ||
    requirement.kind === "artifact" ||
    requirement.kind === "enchantment" ||
    requirement.kind === "artifact_or_enchantment" ||
    requirement.kind === "nonland_permanent"
  ) {
    const choices: ChosenTarget[] = [];
    for (const player of livingPlayers(state)) {
      for (const cardId of player.zones.battlefield) {
        const choice: ChosenTarget = { type: "creature", cardId };
        if (isChosenTargetLegal(state, requirement, choice, casterId)) {
          choices.push(choice);
        }
      }
    }
    return choices;
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
