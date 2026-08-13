import { cloneGameState } from "./clone";
import { isCreature } from "./cardTypes";
import { moveCard } from "./zones";
import type {
  CardInstance,
  CardInstanceId,
  CombatAttack,
  CombatState,
  GameState,
  PlayerId,
} from "./types";

export function emptyCombat(): CombatState {
  return {
    attacks: [],
    blockers: {},
    attackersDeclared: false,
    declaredBlockersFor: [],
  };
}

export function isCommander(state: GameState, cardId: CardInstanceId): boolean {
  return state.players.some((player) => player.commander.commanderIds.includes(cardId));
}

export function creaturePower(state: GameState, cardId: CardInstanceId): number {
  return state.definitions[state.cards[cardId]?.definitionId ?? ""]?.power ?? 0;
}

export function creatureToughness(state: GameState, cardId: CardInstanceId): number {
  return state.definitions[state.cards[cardId]?.definitionId ?? ""]?.toughness ?? 0;
}

export function pendingBlockerPlayer(state: GameState): PlayerId | null {
  if (!state.combat) {
    return null;
  }
  const defenders: PlayerId[] = [];
  for (const attack of state.combat.attacks) {
    if (!defenders.includes(attack.defenderId)) {
      defenders.push(attack.defenderId);
    }
  }
  return defenders.find((id) => !state.combat?.declaredBlockersFor.includes(id)) ?? null;
}

export function priorityForStep(state: GameState): PlayerId {
  if (state.turn.step === "declareBlockers") {
    return pendingBlockerPlayer(state) ?? state.turn.activePlayerId;
  }
  return state.turn.activePlayerId;
}

function requireCombat(state: GameState): CombatState {
  if (!state.combat) {
    throw new Error("Combat has not started");
  }
  return state.combat;
}

function requireCard(state: GameState, cardId: CardInstanceId): CardInstance {
  const card = state.cards[cardId];
  if (!card) {
    throw new Error(`Unknown card ${cardId}`);
  }
  return card;
}

export function ensureCombatInPlace(state: GameState): void {
  if (!state.combat) {
    state.combat = emptyCombat();
  }
}

export function clearCombatFlagsInPlace(state: GameState): void {
  for (const card of Object.values(state.cards)) {
    card.attacking = false;
    card.blockingAttackerId = null;
  }
  state.combat = null;
}

export function clearDamageInPlace(state: GameState): void {
  for (const card of Object.values(state.cards)) {
    card.damageMarked = 0;
  }
}

function assertLegalAttacker(
  state: GameState,
  playerId: PlayerId,
  attackerId: CardInstanceId,
  defenderId: PlayerId,
): void {
  const card = requireCard(state, attackerId);
  if (card.zone !== "battlefield" || !isCreature(state, attackerId)) {
    throw new Error(`Card ${attackerId} cannot attack`);
  }
  if (card.controllerId !== playerId) {
    throw new Error(`Card ${attackerId} is not controlled by the attacking player`);
  }
  if (card.tapped) {
    throw new Error(`Card ${attackerId} is tapped`);
  }
  if (card.summoningSick) {
    throw new Error(`Card ${attackerId} has summoning sickness`);
  }
  if (defenderId === playerId) {
    throw new Error("A player cannot attack themselves");
  }
  if (!state.players.some((player) => player.id === defenderId)) {
    throw new Error(`Unknown player ${defenderId}`);
  }
}

export function declareAttackers(state: GameState, playerId: PlayerId, attacks: CombatAttack[]): GameState {
  if (state.turn.step !== "declareAttackers") {
    throw new Error("Attackers can only be declared in the declare attackers step");
  }
  if (playerId !== state.turn.activePlayerId) {
    throw new Error("Only the active player can declare attackers");
  }
  if (playerId !== state.priorityPlayerId) {
    throw new Error("It is not that player's priority");
  }
  if (state.stack.length > 0) {
    throw new Error("The stack must be empty to declare attackers");
  }
  ensureCombatInPlace(state);
  const current = requireCombat(state);
  if (current.attackersDeclared) {
    throw new Error("Attackers have already been declared");
  }

  const seen = new Set<CardInstanceId>();
  for (const attack of attacks) {
    if (seen.has(attack.attackerId)) {
      throw new Error(`Card ${attack.attackerId} is listed as an attacker twice`);
    }
    seen.add(attack.attackerId);
    assertLegalAttacker(state, playerId, attack.attackerId, attack.defenderId);
  }

  const next = cloneGameState(state);
  ensureCombatInPlace(next);
  const combat = requireCombat(next);
  combat.attacks = attacks.map((attack) => ({ ...attack }));
  combat.blockers = {};
  combat.attackersDeclared = true;
  combat.declaredBlockersFor = [];
  for (const attack of combat.attacks) {
    const card = requireCard(next, attack.attackerId);
    card.attacking = true;
    card.tapped = true;
  }
  next.passesSinceAction = 0;
  next.priorityPlayerId = next.turn.activePlayerId;
  return next;
}

export function declareBlockers(
  state: GameState,
  playerId: PlayerId,
  blocks: { blockerId: CardInstanceId; attackerId: CardInstanceId }[],
): GameState {
  if (state.turn.step !== "declareBlockers") {
    throw new Error("Blockers can only be declared in the declare blockers step");
  }
  if (playerId !== state.priorityPlayerId) {
    throw new Error("It is not that player's priority");
  }
  if (state.stack.length > 0) {
    throw new Error("The stack must be empty to declare blockers");
  }
  const combat = requireCombat(state);
  if (combat.declaredBlockersFor.includes(playerId)) {
    throw new Error("That player has already declared blockers");
  }

  const attackingThisPlayer = combat.attacks.filter((attack) => attack.defenderId === playerId);
  const legalAttackers = new Set(attackingThisPlayer.map((attack) => attack.attackerId));
  const seenBlockers = new Set<CardInstanceId>();

  for (const block of blocks) {
    if (seenBlockers.has(block.blockerId)) {
      throw new Error(`Card ${block.blockerId} is listed as a blocker twice`);
    }
    seenBlockers.add(block.blockerId);
    if (!legalAttackers.has(block.attackerId)) {
      throw new Error(`Card ${block.attackerId} is not attacking that player`);
    }
    const blocker = requireCard(state, block.blockerId);
    if (blocker.zone !== "battlefield" || !isCreature(state, block.blockerId)) {
      throw new Error(`Card ${block.blockerId} cannot block`);
    }
    if (blocker.controllerId !== playerId) {
      throw new Error(`Card ${block.blockerId} is not controlled by the defending player`);
    }
    if (blocker.tapped) {
      throw new Error(`Card ${block.blockerId} is tapped`);
    }
    if (blocker.attacking) {
      throw new Error(`Card ${block.blockerId} is attacking`);
    }
  }

  const next = cloneGameState(state);
  const nextCombat = requireCombat(next);
  for (const block of blocks) {
    const list = nextCombat.blockers[block.attackerId] ?? [];
    list.push(block.blockerId);
    nextCombat.blockers[block.attackerId] = list;
    const blocker = requireCard(next, block.blockerId);
    blocker.blockingAttackerId = block.attackerId;
  }
  nextCombat.declaredBlockersFor.push(playerId);
  next.passesSinceAction = 0;
  next.priorityPlayerId = priorityForStep(next);
  return next;
}

function destroyLethalCreatures(state: GameState): GameState {
  let next = state;
  const doomed = Object.values(next.cards).filter((card) => {
    if (card.zone !== "battlefield" || !isCreature(next, card.id)) {
      return false;
    }
    const toughness = creatureToughness(next, card.id);
    return toughness > 0 && card.damageMarked >= toughness;
  });
  for (const card of doomed) {
    if (next.cards[card.id]?.zone === "battlefield") {
      next = moveCard(next, card.id, "graveyard");
    }
  }
  return next;
}

export function dealCombatDamageInPlace(state: GameState): void {
  if (!state.combat) {
    return;
  }
  for (const attack of state.combat.attacks) {
    const attacker = state.cards[attack.attackerId];
    if (!attacker || attacker.zone !== "battlefield") {
      continue;
    }
    const power = creaturePower(state, attack.attackerId);
    const blockerIds = state.combat.blockers[attack.attackerId] ?? [];
    const livingBlockers = blockerIds.filter((id) => state.cards[id]?.zone === "battlefield");

    if (livingBlockers.length === 0) {
      const defender = state.players.find((player) => player.id === attack.defenderId);
      if (defender) {
        defender.life -= power;
        if (isCommander(state, attack.attackerId) && power > 0) {
          defender.commander.damageReceived[attack.attackerId] =
            (defender.commander.damageReceived[attack.attackerId] ?? 0) + power;
        }
      }
      continue;
    }

    let remaining = power;
    for (let index = 0; index < livingBlockers.length; index += 1) {
      const blockerId = livingBlockers[index];
      const blocker = state.cards[blockerId];
      if (!blocker || remaining <= 0) {
        continue;
      }
      const toughness = creatureToughness(state, blockerId);
      const lethalNeeded = Math.max(0, toughness - blocker.damageMarked);
      const assigned =
        index === livingBlockers.length - 1 ? remaining : Math.min(remaining, Math.max(lethalNeeded, 1));
      blocker.damageMarked += assigned;
      remaining -= assigned;
      attacker.damageMarked += creaturePower(state, blockerId);
    }
  }
}

export function applyCombatDamage(state: GameState): GameState {
  const next = cloneGameState(state);
  dealCombatDamageInPlace(next);
  return destroyLethalCreatures(next);
}
