import { cloneGameState } from "./clone";
import { characteristicsOf, isCommander, isCreature } from "./cardTypes";
import { abilitiesRemoved, computedCard } from "./characteristicsEngine";
import { creaturePower, creatureToughness } from "./derived";
import { hasKeyword, protectionColorsOf } from "./keywords";
import { canPayManaCost, parseManaCost, payManaCost } from "./mana";
import { isLiving, nextLivingPlayerId } from "./players";
import { applyStateBasedActionsInPlace } from "./status";
import { dispatchEventsInPlace } from "./triggers";

import type {
  CardInstance,
  CardInstanceId,
  CombatAttack,
  CombatState,
  EngineEvent,
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

export { isCommander };

export { creaturePower, creatureToughness };

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
  return (
    defenders.find((id) => {
      if (state.combat?.declaredBlockersFor.includes(id)) {
        return false;
      }
      return isLiving(state, id);
    }) ?? null
  );
}

export function priorityForStep(state: GameState): PlayerId {
  if (isLiving(state, state.turn.activePlayerId)) {
    return state.turn.activePlayerId;
  }
  return nextLivingPlayerId(state, state.turn.activePlayerId);
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

export function combatDamagePrevented(state: GameState): boolean {
  return state.preventCombatDamage === true;
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
    card.deathtouched = false;
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
  if (card.summoningSick && !hasKeyword(state, attackerId, "haste")) {
    throw new Error(`Card ${attackerId} has summoning sickness`);
  }
  if (hasKeyword(state, attackerId, "defender")) {
    throw new Error(`Card ${attackerId} cannot attack`);
  }
  if (computedCard(state, attackerId)?.cantAttack) {
    throw new Error(`Card ${attackerId} cannot attack`);
  }
  if (defenderId === playerId) {
    throw new Error("A player cannot attack themselves");
  }
  if (!state.players.some((player) => player.id === defenderId)) {
    throw new Error(`Unknown player ${defenderId}`);
  }
  if (!isLiving(state, defenderId)) {
    throw new Error("Cannot attack a player who has lost");
  }
}

/** Sum every defender's per-attacking-creature taxes for this declaration. */
function attackTaxTotals(
  state: GameState,
  attacks: CombatAttack[],
): { generic: number; life: number } {
  let generic = 0;
  let life = 0;
  for (const attack of attacks) {
    const defender = state.players.find((player) => player.id === attack.defenderId);
    if (!defender) {
      continue;
    }
    for (const permanentId of defender.zones.battlefield) {
      const permanent = state.cards[permanentId];
      if (!permanent || permanent.controllerId !== defender.id) {
        continue;
      }
      const tax = state.definitions[permanent.definitionId]?.attackTax;
      if (!tax || abilitiesRemoved(state, permanentId)) {
        continue;
      }
      generic += tax.generic ?? 0;
      if (tax.perEnchantment) {
        generic += defender.zones.battlefield.filter((id) => {
          const card = state.cards[id];
          return (
            card &&
            card.controllerId === defender.id &&
            characteristicsOf(state, id).types.includes("enchantment")
          );
        }).length;
      }
      life += tax.lifePer ?? 0;
    }
  }
  return { generic, life };
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
  // Validate against a view of combat without touching the input state: an
  // illegal declaration must leave the original untouched.
  if ((state.combat ?? emptyCombat()).attackersDeclared) {
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

  // Toski: "attacks each combat if able" — an able must-attacker can't stay
  // home once any attack declaration is made.
  for (const card of Object.values(state.cards)) {
    if (
      card.zone !== "battlefield" ||
      card.controllerId !== playerId ||
      seen.has(card.id) ||
      state.definitions[card.definitionId]?.mustAttack !== true
    ) {
      continue;
    }
    const candidateDefender =
      attacks[0]?.defenderId ??
      state.players.find((player) => player.id !== playerId && !player.lost)?.id;
    if (!candidateDefender) {
      continue;
    }
    try {
      assertLegalAttacker(state, playerId, card.id, candidateDefender);
    } catch {
      continue; // it isn't able to attack — the requirement lifts
    }
    throw new Error(`Card ${card.id} attacks each combat if able`);
  }

  // Pillow forts (Propaganda / Sphere of Safety / Norn's Annex): total the
  // per-creature attack taxes of every defender and pay from the attacker's
  // floating pool (float mana with tap_for_mana first) and life.
  const tax = attackTaxTotals(state, attacks);
  const attackerState = state.players.find((player) => player.id === playerId);
  const taxCost = parseManaCost(tax.generic > 0 ? `{${tax.generic}}` : "");
  if (tax.generic > 0 && (!attackerState || !canPayManaCost(attackerState.mana, taxCost))) {
    throw new Error(
      `Attacking costs {${tax.generic}} — float the mana before declaring attackers`,
    );
  }
  if (tax.life > 0 && (!attackerState || attackerState.life < tax.life)) {
    throw new Error(`Attacking costs ${tax.life} life`);
  }

  let next = cloneGameState(state);
  if (tax.generic > 0) {
    next = payManaCost(next, playerId, taxCost);
  }
  if (tax.life > 0) {
    const payer = next.players.find((player) => player.id === playerId);
    if (payer) {
      payer.life -= tax.life;
      next.log.push({ kind: "life_change", playerId, delta: -tax.life });
    }
  }
  ensureCombatInPlace(next);
  const combat = requireCombat(next);
  combat.attacks = attacks.map((attack) => ({ ...attack }));
  combat.blockers = {};
  combat.attackersDeclared = true;
  combat.declaredBlockersFor = [];
  if (attacks.length > 0) {
    const attacker = next.players.find((player) => player.id === playerId);
    if (attacker) {
      attacker.attackedThisTurn = true;
      // Summed across combat phases — extra combats keep adding to the tally.
      attacker.attackersThisTurn = (attacker.attackersThisTurn ?? 0) + attacks.length;
    }
  }
  const tappedEvents: EngineEvent[] = [];
  for (const attack of combat.attacks) {
    const card = requireCard(next, attack.attackerId);
    card.attacking = true;
    if (!hasKeyword(next, attack.attackerId, "vigilance")) {
      card.tapped = true;
      tappedEvents.push({ kind: "tapped", cardId: attack.attackerId });
    }
  }
  if (tappedEvents.length > 0) {
    dispatchEventsInPlace(next, tappedEvents);
  }
  next.passesSinceAction = 0;
  next.priorityPlayerId = next.turn.activePlayerId;
  if (combat.attacks.length > 0) {
    dispatchEventsInPlace(
      next,
      combat.attacks.map((attack) => ({ kind: "attacks" as const, cardId: attack.attackerId })),
    );
  }
  return next;
}

/**
 * Evasion legality for one block (CR 702): flying/reach, fear, intimidate,
 * horsemanship, shadow (both directions), and skulk. Returns an error
 * message, or null when the block is legal.
 */
export function blockRestriction(
  state: GameState,
  attackerId: CardInstanceId,
  blockerId: CardInstanceId,
): string | null {
  if (computedCard(state, attackerId)?.cantBeBlocked) {
    return `Card ${attackerId} cannot be blocked`;
  }
  if (computedCard(state, blockerId)?.cantBlock) {
    return `Card ${blockerId} cannot block`;
  }
  const blockerTraits = characteristicsOf(state, blockerId);
  const isArtifact = blockerTraits.types.includes("artifact");
  if (
    hasKeyword(state, attackerId, "flying") &&
    !hasKeyword(state, blockerId, "flying") &&
    !hasKeyword(state, blockerId, "reach")
  ) {
    return `Card ${blockerId} cannot block a flying attacker`;
  }
  if (
    hasKeyword(state, attackerId, "fear") &&
    !isArtifact &&
    !blockerTraits.colors.includes("B")
  ) {
    return `Card ${blockerId} cannot block a creature with fear`;
  }
  if (hasKeyword(state, attackerId, "intimidate") && !isArtifact) {
    const attackerColors = characteristicsOf(state, attackerId).colors;
    if (!attackerColors.some((color) => blockerTraits.colors.includes(color))) {
      return `Card ${blockerId} cannot block a creature with intimidate`;
    }
  }
  if (
    hasKeyword(state, attackerId, "horsemanship") &&
    !hasKeyword(state, blockerId, "horsemanship")
  ) {
    return `Card ${blockerId} cannot block a creature with horsemanship`;
  }
  if (hasKeyword(state, attackerId, "shadow") !== hasKeyword(state, blockerId, "shadow")) {
    return hasKeyword(state, attackerId, "shadow")
      ? `Card ${blockerId} cannot block a creature with shadow`
      : `Card ${blockerId} has shadow and can block only creatures with shadow`;
  }
  if (
    hasKeyword(state, attackerId, "skulk") &&
    creaturePower(state, blockerId) > creaturePower(state, attackerId)
  ) {
    return `Card ${blockerId} is too powerful to block a creature with skulk`;
  }
  const attacker = state.cards[attackerId];
  const protection = attacker ? protectionColorsOf(state, attackerId) : [];
  if (protection.some((color) => blockerTraits.colors.includes(color))) {
    return `Card ${blockerId} cannot block a creature with protection from its colors`;
  }
  return null;
}

export function declareBlockers(
  state: GameState,
  playerId: PlayerId,
  blocks: { blockerId: CardInstanceId; attackerId: CardInstanceId }[],
): GameState {
  if (state.turn.step !== "declareBlockers") {
    throw new Error("Blockers can only be declared in the declare blockers step");
  }
  if (state.stack.length > 0) {
    throw new Error("The stack must be empty to declare blockers");
  }
  const combat = requireCombat(state);
  let defenderId = playerId;
  if (blocks.length > 0) {
    const controllers = new Set(
      blocks.map((block) => requireCard(state, block.blockerId).controllerId),
    );
    if (controllers.size !== 1) {
      throw new Error("Blockers must share a controller");
    }
    const [controllerId] = controllers;
    if (!controllerId) {
      throw new Error("Blockers must share a controller");
    }
    defenderId = controllerId;
  }
  if (playerId !== defenderId && playerId !== state.turn.activePlayerId) {
    throw new Error("Only the defending player or the active player can declare those blockers");
  }
  if (combat.declaredBlockersFor.includes(defenderId)) {
    throw new Error("That player has already declared blockers");
  }

  const attackingThisPlayer = combat.attacks.filter((attack) => attack.defenderId === defenderId);
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
    if (blocker.controllerId !== defenderId) {
      throw new Error(`Card ${block.blockerId} is not controlled by the defending player`);
    }
    if (blocker.tapped) {
      throw new Error(`Card ${block.blockerId} is tapped`);
    }
    if (blocker.attacking) {
      throw new Error(`Card ${block.blockerId} is attacking`);
    }
    const evasionError = blockRestriction(state, block.attackerId, block.blockerId);
    if (evasionError) {
      throw new Error(evasionError);
    }
  }

  const blocksByAttacker: Record<string, number> = {};
  for (const block of blocks) {
    blocksByAttacker[block.attackerId] = (blocksByAttacker[block.attackerId] ?? 0) + 1;
  }
  for (const [attackerId, count] of Object.entries(blocksByAttacker)) {
    if (hasKeyword(state, attackerId, "menace") && count === 1) {
      throw new Error(`Card ${attackerId} has menace and cannot be blocked by only one creature`);
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
  nextCombat.declaredBlockersFor.push(defenderId);
  next.passesSinceAction = 0;
  next.priorityPlayerId = priorityForStep(next);
  return next;
}

/** Active player locks in remaining undeclared defenders as no additional blocks. */
export function lockRemainingBlockers(state: GameState): GameState {
  let current = state;
  let guard = 0;
  while (pendingBlockerPlayer(current) && guard < 8) {
    const pending = pendingBlockerPlayer(current);
    if (!pending) {
      break;
    }
    current = declareBlockers(current, pending, []);
    guard += 1;
  }
  return current;
}

function destroyLethalCreatures(state: GameState): GameState {
  // Lethal-damage destruction is a state-based action (CR 704.5g/h).
  applyStateBasedActionsInPlace(state);
  return state;
}

function dealsInStrike(state: GameState, cardId: CardInstanceId, strike: "first" | "normal"): boolean {
  const firstStrike =
    hasKeyword(state, cardId, "first_strike") || hasKeyword(state, cardId, "double_strike");
  if (strike === "first") {
    return firstStrike;
  }
  return hasKeyword(state, cardId, "double_strike") || !hasKeyword(state, cardId, "first_strike");
}

function gainLifeInPlace(state: GameState, playerId: PlayerId, amount: number): void {
  if (amount <= 0) {
    return;
  }
  const player = state.players.find((entry) => entry.id === playerId);
  if (player) {
    player.life += amount;
    dispatchEventsInPlace(state, [{ kind: "gains_life", playerId, amount }]);
  }
}

function dealDamageToPlayerInPlace(
  state: GameState,
  defenderId: PlayerId,
  amount: number,
  sourceId: CardInstanceId,
  collect?: EngineEvent[],
): void {
  if (amount <= 0) {
    return;
  }
  const defender = state.players.find((player) => player.id === defenderId);
  if (!defender) {
    return;
  }
  defender.life -= amount;
  collect?.push({ kind: "combat_damage_to_player", cardId: sourceId, playerId: defenderId, amount });
  collect?.push({ kind: "deals_damage_to_player", cardId: sourceId, playerId: defenderId });
  collect?.push({ kind: "loses_life", playerId: defenderId, amount });
  if (isCommander(state, sourceId)) {
    defender.commander.damageReceived[sourceId] =
      (defender.commander.damageReceived[sourceId] ?? 0) + amount;
  }
  const source = state.cards[sourceId];
  if (source && hasKeyword(state, sourceId, "lifelink")) {
    gainLifeInPlace(state, source.controllerId, amount);
  }
}

function markCreatureDamageInPlace(
  state: GameState,
  targetId: CardInstanceId,
  amount: number,
  sourceId: CardInstanceId,
): void {
  if (amount <= 0) {
    return;
  }
  const target = state.cards[targetId];
  if (!target) {
    return;
  }
  // Maze of Ith: damage TO a shielded creature is prevented.
  if (state.preventCombatFor?.includes(targetId)) {
    return;
  }
  const protection = protectionColorsOf(state, targetId);
  if (protection.length > 0) {
    const colors = characteristicsOf(state, sourceId).colors;
    if (protection.some((color) => colors.includes(color))) {
      return;
    }
  }
  target.damageMarked += amount;
  if (hasKeyword(state, sourceId, "deathtouch")) {
    target.deathtouched = true;
  }
  // Enrage (Apex Altisaur): combat damage counts too.
  dispatchEventsInPlace(state, [{ kind: "damaged", cardId: targetId }]);
  const source = state.cards[sourceId];
  if (source && hasKeyword(state, sourceId, "lifelink")) {
    gainLifeInPlace(state, source.controllerId, amount);
  }
}

export function dealCombatDamageInPlace(
  state: GameState,
  strike: "first" | "normal" = "normal",
): void {
  if (!state.combat) {
    return;
  }
  const damageEvents: EngineEvent[] = [];
  for (const attack of state.combat.attacks) {
    const attacker = state.cards[attack.attackerId];
    if (!attacker || attacker.zone !== "battlefield") {
      continue;
    }
    const power = creaturePower(state, attack.attackerId);
    const blockerIds = state.combat.blockers[attack.attackerId] ?? [];
    const wasBlocked = blockerIds.length > 0;
    const livingBlockers = blockerIds.filter((id) => state.cards[id]?.zone === "battlefield");
    // Maze of Ith: a shielded creature neither deals nor takes combat damage.
    const shielded = (id: CardInstanceId): boolean =>
      state.preventCombatFor?.includes(id) === true;
    const attackerDeals =
      dealsInStrike(state, attack.attackerId, strike) && !shielded(attack.attackerId);

    if (!wasBlocked) {
      if (attackerDeals) {
        dealDamageToPlayerInPlace(state, attack.defenderId, power, attack.attackerId, damageEvents);
      }
      continue;
    }

    if (attackerDeals) {
      if (livingBlockers.length === 0) {
        if (hasKeyword(state, attack.attackerId, "trample")) {
          dealDamageToPlayerInPlace(state, attack.defenderId, power, attack.attackerId, damageEvents);
        }
      } else {
        let remaining = power;
        const trample = hasKeyword(state, attack.attackerId, "trample");
        const deathtouch = hasKeyword(state, attack.attackerId, "deathtouch");
        for (let index = 0; index < livingBlockers.length; index += 1) {
          const blockerId = livingBlockers[index];
          const blocker = state.cards[blockerId];
          if (!blocker || remaining <= 0) {
            continue;
          }
          const toughness = creatureToughness(state, blockerId);
          const lethalNeeded = deathtouch
            ? blocker.damageMarked > 0
              ? 0
              : 1
            : Math.max(0, toughness - blocker.damageMarked);
          const isLast = index === livingBlockers.length - 1;
          const needed = lethalNeeded <= 0 ? 0 : Math.max(lethalNeeded, 1);
          const assigned = isLast && !trample ? remaining : Math.min(remaining, needed);
          markCreatureDamageInPlace(state, blockerId, assigned, attack.attackerId);
          remaining -= assigned;
        }
        if (trample && remaining > 0) {
          dealDamageToPlayerInPlace(state, attack.defenderId, remaining, attack.attackerId, damageEvents);
        }
      }
    }

    for (const blockerId of livingBlockers) {
      if (!dealsInStrike(state, blockerId, strike) || shielded(blockerId)) {
        continue;
      }
      markCreatureDamageInPlace(
        state,
        attack.attackerId,
        creaturePower(state, blockerId),
        blockerId,
      );
    }
  }
  if (damageEvents.length > 0) {
    dispatchEventsInPlace(state, damageEvents);
  }
}

export function applyCombatDamage(state: GameState): GameState {
  // Fog: all combat damage this turn is prevented.
  if (combatDamagePrevented(state)) {
    return state;
  }
  let next = cloneGameState(state);
  dealCombatDamageInPlace(next, "first");
  applyStateBasedActionsInPlace(next);
  next = destroyLethalCreatures(next);
  dealCombatDamageInPlace(next, "normal");
  applyStateBasedActionsInPlace(next);
  return destroyLethalCreatures(next);
}
