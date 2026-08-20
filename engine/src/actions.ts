import { declareAttackers, declareBlockers, lockRemainingBlockers, pendingBlockerPlayer, priorityForStep } from "./combat";
import { abilitiesRemoved } from "./characteristicsEngine";
import { isCommander, isCreature, isInstant, isInstantOrSorcery, isLand, isMainPhase } from "./cardTypes";
import { cloneGameState } from "./clone";
import { eliminatePlayerInPlace } from "./elimination";
import { applyEffects, bindCardEffects } from "./effects";
import { hasKeyword } from "./keywords";
import { canPayManaCost, parseManaCost, payManaCost, tapCard, tapForMana } from "./mana";
import { canTapForMana, manaAbilitiesOf, manaTapOptionsFor } from "./manaOptions";
import { isLiving, livingPlayerCount, requireLiving } from "./players";
import { passPriority, putActivatedAbilityOnStack, putSpellOnStack, resolveTopOfStack } from "./stack";
import { applyStateBasedActionsInPlace, redirectPriorityIfLost } from "./status";
import { validateChosenTargets } from "./targeting";
import {
  DEFAULT_SHORTCUT_POLICY,
  advanceStep,
  beginNextLivingTurnInPlace,
  skipPriorityShortcuts,
  type ShortcutPolicy,
} from "./turn";
import { applyBottomCards, applyKeepHand, applyTakeMulligan, isMulliganOpen, reconcileMulliganAfterLoss } from "./mulligan";
import { applyRollDie } from "./dice";
import { applyOpeningRoll, isOpeningRoll } from "./openingRoll";
import { applyManualOverride } from "./override";
import { applyChooseEnterReplacement, applyChooseTargets, applyResolveChooseCard, applyResolveDiscard, applyResolveLookAssign, applyResolveOrderTriggers, applyResolvePay, applyResolveScry, applyResolveSearch, applyResolveSurveil, currentPrompt, dropLostPlayerPromptsInPlace, isPromptOpen } from "./prompt";
import { findCardZone, moveCard } from "./zones";
import type { CardInstanceId, ChosenTarget, GameAction, GameState, ManaColor, ManaPool, PlayerId } from "./types";

function requirePlayer(state: GameState, playerId: PlayerId): void {
  if (!state.players.some((player) => player.id === playerId)) {
    throw new Error(`Unknown player ${playerId}`);
  }
}

function requirePlaying(state: GameState): void {
  if (isOpeningRoll(state)) {
    throw new Error("Roll for first player first");
  }
  if (isMulliganOpen(state)) {
    throw new Error("Finish mulligans before taking that action");
  }
  if (isPromptOpen(state)) {
    throw new Error("Finish the pending choice first");
  }
}

function requirePriority(state: GameState, playerId: PlayerId): void {
  requireLiving(state, playerId);
  if (playerId !== state.priorityPlayerId) {
    throw new Error("It is not that player's priority");
  }
}

function snapshot(state: GameState): string {
  return JSON.stringify(state);
}

function assertUnchanged(before: string, state: GameState, label: string): void {
  if (JSON.stringify(state) !== before) {
    throw new Error(`${label} mutated GameState`);
  }
}

function canCastNonInstantNow(state: GameState, playerId: PlayerId): boolean {
  return (
    playerId === state.turn.activePlayerId &&
    isMainPhase(state) &&
    state.stack.length === 0
  );
}

function finalizeActionState(state: GameState): GameState {
  applyStateBasedActionsInPlace(state);
  dropLostPlayerPromptsInPlace(state);
  const active = state.players.find((player) => player.id === state.turn.activePlayerId);
  if (active?.lost && livingPlayerCount(state) > 0) {
    beginNextLivingTurnInPlace(state);
    applyStateBasedActionsInPlace(state);
    return state;
  }
  redirectPriorityIfLost(state);
  return state;
}

function validateCast(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
): { cost: ReturnType<typeof parseManaCost>; fromCommand: boolean } {
  requirePriority(state, playerId);

  const card = state.cards[cardId];
  if (!card) {
    throw new Error(`Unknown card ${cardId}`);
  }
  const definition = state.definitions[card.definitionId];
  if (!definition) {
    throw new Error(`Unknown card definition for ${cardId}`);
  }

  const located = findCardZone(state, cardId);
  const fromHand = Boolean(located && located.zone === "hand" && located.playerId === playerId);
  const fromCommand = Boolean(
    located &&
      located.zone === "command" &&
      located.playerId === playerId &&
      isCommander(state, cardId),
  );
  if (!fromHand && !fromCommand) {
    throw new Error(`Card ${cardId} must be in the player's hand`);
  }

  if (isLand(state, cardId) && !isInstantOrSorcery(state, cardId)) {
    throw new Error(`Card ${cardId} is a land and cannot be cast as a spell`);
  }

  if (!isInstant(state, cardId) && !hasKeyword(state, cardId, "flash") && !canCastNonInstantNow(state, playerId)) {
    throw new Error("That spell cannot be cast at this time");
  }

  const player = state.players.find((entry) => entry.id === playerId);
  if (!player) {
    throw new Error(`Unknown player ${playerId}`);
  }
  const cost = parseManaCost(definition.manaCost);
  if (fromCommand) {
    cost.generic += player.commander.tax;
  }
  if (!canPayManaCost(player.mana, cost, player.life)) {
    throw new Error("Cannot pay mana cost");
  }

  return { cost, fromCommand };
}

function applyChosenFace(
  state: GameState,
  cardId: CardInstanceId,
  faceIndex: number | undefined,
): GameState {
  if (faceIndex === undefined || faceIndex === 0) {
    return state;
  }
  if (faceIndex !== 1) {
    throw new Error("Invalid face");
  }
  const card = state.cards[cardId];
  const definition = card ? state.definitions[card.definitionId] : undefined;
  if (!card || !definition?.otherFaceId || definition.layout !== "modal_dfc") {
    throw new Error("That card has no other face to play");
  }
  if (!state.definitions[definition.otherFaceId]) {
    throw new Error("Missing other face");
  }
  const next = cloneGameState(state);
  const moved = next.cards[cardId];
  if (!moved) {
    throw new Error(`Unknown card ${cardId}`);
  }
  moved.definitionId = definition.otherFaceId;
  return next;
}

function applyCastSpell(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
  targets: ChosenTarget[] | undefined,
  faceIndex: number | undefined,
  modeIndex: number | undefined,
  xValue: number | undefined,
  division: number[] | undefined,
): GameState {
  requirePlaying(state);
  const faced = applyChosenFace(state, cardId, faceIndex);
  const { cost, fromCommand } = validateCast(faced, playerId, cardId);
  const card = faced.cards[cardId];
  const definition = card ? faced.definitions[card.definitionId] : undefined;
  if (cost.xCount > 0) {
    if (xValue === undefined || !Number.isInteger(xValue) || xValue < 0) {
      throw new Error("Announce a value for X");
    }
    cost.generic += xValue * cost.xCount;
    const player = faced.players.find((entry) => entry.id === playerId);
    if (!player || !canPayManaCost(player.mana, cost)) {
      throw new Error("Cannot pay mana cost");
    }
  } else if (xValue !== undefined) {
    throw new Error("That spell has no X in its cost");
  }
  const dividedEffect = definition?.effects.find((effect) => effect.kind === "divided_damage");
  if (dividedEffect?.kind === "divided_damage") {
    const expected = dividedEffect.amount === "x" ? xValue ?? 0 : dividedEffect.amount;
    if (!division || division.length !== (targets ?? []).length) {
      throw new Error("Divide the damage among the chosen targets");
    }
    if (division.some((part) => !Number.isInteger(part) || part < 1)) {
      throw new Error("Each target must be assigned at least 1 damage");
    }
    if (division.reduce((sum, part) => sum + part, 0) !== expected) {
      throw new Error(`The division must total ${expected}`);
    }
  } else if (division !== undefined) {
    throw new Error("That spell does not divide damage");
  }
  if (definition?.modes && definition.modes.length > 0) {
    if (
      modeIndex === undefined ||
      !Number.isInteger(modeIndex) ||
      !definition.modes[modeIndex]
    ) {
      throw new Error("Choose a mode");
    }
    validateChosenTargets(
      faced,
      definition.modes[modeIndex]!.targetRequirements,
      targets ?? [],
      playerId,
      definition.characteristics.colors,
    );
  } else {
    if (modeIndex !== undefined) {
      throw new Error("That spell has no modes");
    }
    validateChosenTargets(
      faced,
      definition?.targetRequirements ?? [],
      targets ?? [],
      playerId,
      definition?.characteristics.colors,
    );
  }
  const paid = payManaCost(faced, playerId, cost);
  const stacked = putSpellOnStack(paid, cardId, targets ?? [], modeIndex, xValue, division);
  if (!fromCommand) {
    return stacked;
  }
  const caster = stacked.players.find((player) => player.id === playerId);
  if (!caster) {
    throw new Error(`Unknown player ${playerId}`);
  }
  caster.commander.tax += 2;
  return stacked;
}

function applyPlayLand(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
  faceIndex: number | undefined,
): GameState {
  requirePlaying(state);
  requirePriority(state, playerId);
  if (playerId !== state.turn.activePlayerId) {
    throw new Error("Only the active player can play a land");
  }
  if (!isMainPhase(state)) {
    throw new Error("A land can only be played during a main phase");
  }
  if (state.stack.length > 0) {
    throw new Error("A land can only be played when the stack is empty");
  }

  const faced = applyChosenFace(state, cardId, faceIndex);
  const card = faced.cards[cardId];
  if (!card) {
    throw new Error(`Unknown card ${cardId}`);
  }
  if (!isLand(faced, cardId)) {
    throw new Error(`Card ${cardId} is not a land`);
  }

  const located = findCardZone(faced, cardId);
  if (!located || located.zone !== "hand" || located.playerId !== playerId) {
    throw new Error(`Card ${cardId} must be in the player's hand`);
  }

  const player = faced.players.find((entry) => entry.id === playerId);
  if (!player) {
    throw new Error(`Unknown player ${playerId}`);
  }
  if (player.landsPlayedThisTurn >= 1) {
    throw new Error("Already played a land this turn");
  }

  const next = moveCard(faced, cardId, "battlefield");
  const movedPlayer = next.players.find((entry) => entry.id === playerId);
  if (!movedPlayer) {
    throw new Error(`Unknown player ${playerId}`);
  }
  movedPlayer.landsPlayedThisTurn += 1;
  next.passesSinceAction = 0;
  next.priorityPlayerId = playerId;
  return next;
}

function applyPassPriority(
  state: GameState,
  playerId: PlayerId,
  shortcuts: ShortcutPolicy,
): GameState {
  requirePlaying(state);
  requirePriority(state, playerId);
  let current = state;
  // Blocker auto-declaration only happens on an empty stack: with a spell or
  // trigger waiting, a pass is just a pass (found by the 500-game fuzz burn).
  if (
    current.stack.length === 0 &&
    current.turn.step === "declareBlockers" &&
    playerId === current.turn.activePlayerId
  ) {
    current = lockRemainingBlockers(current);
  } else if (
    current.stack.length === 0 &&
    current.turn.step === "declareBlockers" &&
    pendingBlockerPlayer(current) === playerId
  ) {
    current = declareBlockers(current, playerId, []);
  }
  const completingEmptyPass =
    current.stack.length === 0 && current.passesSinceAction + 1 >= livingPlayerCount(current);
  let next = passPriority(current, playerId);
  if (completingEmptyPass) {
    next = skipPriorityShortcuts(advanceStep(next), shortcuts);
    next.priorityPlayerId = priorityForStep(next);
    next.passesSinceAction = 0;
  }
  return next;
}

/**
 * Table fast-forward, not a rules action: it discards the stack and skips
 * remaining priority windows, so it is logged like an override for everyone
 * to see.
 */
function applyAdvanceStep(
  state: GameState,
  playerId: PlayerId,
  shortcuts: ShortcutPolicy,
): GameState {
  requirePlaying(state);
  requireLiving(state, playerId);
  let next = cloneGameState(state);
  const discarded = next.stack.length;
  next.stack = [];
  next.priorityPlayerId = next.turn.activePlayerId;
  if (next.turn.step === "declareAttackers" && !next.combat?.attackersDeclared) {
    next = declareAttackers(next, next.turn.activePlayerId, []);
  }
  if (next.turn.step === "declareBlockers") {
    next = lockRemainingBlockers(next);
  }
  next.log.push({
    kind: "override",
    playerId,
    summary: discarded > 0 ? `skipped the step, discarding ${discarded} stack object(s)` : "skipped the step",
  });
  next = skipPriorityShortcuts(advanceStep(next), shortcuts);
  next.priorityPlayerId = priorityForStep(next);
  next.passesSinceAction = 0;
  return next;
}

/** Table fast-forward to the next turn. Logged like an override. */
function applyAdvanceTurn(state: GameState, playerId: PlayerId): GameState {
  requirePlaying(state);
  requireLiving(state, playerId);
  const next = cloneGameState(state);
  const discarded = next.stack.length;
  next.stack = [];
  next.log.push({
    kind: "override",
    playerId,
    summary:
      discarded > 0 ? `skipped to the next turn, discarding ${discarded} stack object(s)` : "skipped to the next turn",
  });
  beginNextLivingTurnInPlace(next);
  return next;
}

function applyConcede(state: GameState, playerId: PlayerId): GameState {
  requirePlayer(state, playerId);
  if (!isLiving(state, playerId)) {
    throw new Error("That player has already lost");
  }
  const next = cloneGameState(state);
  eliminatePlayerInPlace(next, playerId);
  return next;
}

function applyTapForMana(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
  color: ManaColor | undefined,
  manaIndex: number | undefined,
): GameState {
  requirePlaying(state);
  requirePriority(state, playerId);
  const card = state.cards[cardId];
  if (!card) {
    throw new Error(`Unknown card ${cardId}`);
  }
  if (card.controllerId !== playerId) {
    throw new Error(`Card ${cardId} is not controlled by that player`);
  }
  if (card.zone !== "battlefield") {
    throw new Error(`Card ${cardId} must be on the battlefield`);
  }
  if (isCreature(state, cardId) && card.summoningSick && !hasKeyword(state, cardId, "haste")) {
    throw new Error(`Card ${cardId} has summoning sickness`);
  }
  const definition = state.definitions[card.definitionId];
  if (!definition || !canTapForMana(definition) || abilitiesRemoved(state, cardId)) {
    throw new Error(`Card ${cardId} does not produce mana`);
  }
  const abilities = manaAbilitiesOf(definition);
  const index = manaIndex ?? 0;
  if (!Number.isInteger(index) || index < 0 || index >= abilities.length) {
    throw new Error("Choose a mana ability");
  }
  const ability = abilities[index]!;
  const options = manaTapOptionsFor(ability);
  let addition: Partial<ManaPool>;
  if (options) {
    if (!color || !options.includes(color)) {
      throw new Error("Choose a mana color");
    }
    addition = { [color]: 1 };
  } else {
    addition = ability.produces;
  }
  let next = tapForMana(state, cardId, addition);
  next.priorityPlayerId = playerId;
  if (ability.damageToController > 0) {
    next = applyEffects(next, [
      {
        kind: "deal_damage",
        sourceId: cardId,
        target: { type: "player", playerId },
        amount: ability.damageToController,
      },
    ]);
  }
  return next;
}

function applyActivateAbility(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
  abilityIndex: number,
  targets: ChosenTarget[] | undefined,
): GameState {
  requirePlaying(state);
  requirePriority(state, playerId);
  if (!Number.isInteger(abilityIndex) || abilityIndex < 0) {
    throw new Error("Invalid ability index");
  }
  const card = state.cards[cardId];
  if (!card) {
    throw new Error(`Unknown card ${cardId}`);
  }
  if (card.controllerId !== playerId) {
    throw new Error(`Card ${cardId} is not controlled by that player`);
  }
  const definition = state.definitions[card.definitionId];
  const ability = definition?.activated[abilityIndex];
  if (!ability) {
    throw new Error(`Unknown activated ability ${abilityIndex}`);
  }
  if (card.zone === "battlefield" && abilitiesRemoved(state, cardId)) {
    throw new Error(`Card ${cardId} has lost its abilities`);
  }
  const fromZone = ability.zone ?? "battlefield";
  if (card.zone !== fromZone) {
    throw new Error(`Card ${cardId} must be in ${fromZone}`);
  }
  if (ability.timing === "sorcery") {
    if (playerId !== state.turn.activePlayerId) {
      throw new Error("That ability can only be activated as a sorcery");
    }
    if (!isMainPhase(state) || state.stack.length > 0) {
      throw new Error("That ability can only be activated as a sorcery");
    }
  }
  const levelUp = ability.effects.find((effect) => effect.kind === "set_class_level");
  if (levelUp?.kind === "set_class_level" && levelUp.level !== card.classLevel + 1) {
    throw new Error("Class levels must be gained in order");
  }
  if (ability.tap && card.tapped) {
    throw new Error(`Card ${cardId} is already tapped`);
  }
  if (
    ability.tap &&
    isCreature(state, cardId) &&
    card.summoningSick &&
    !hasKeyword(state, cardId, "haste")
  ) {
    throw new Error(`Card ${cardId} has summoning sickness`);
  }
  const player = state.players.find((entry) => entry.id === playerId);
  if (!player) {
    throw new Error(`Unknown player ${playerId}`);
  }
  const cost = parseManaCost(ability.manaCost);
  if (!canPayManaCost(player.mana, cost)) {
    throw new Error("Cannot pay mana cost");
  }
  let next = payManaCost(state, playerId, cost);
  if (ability.tap) {
    next = tapCard(next, cardId);
  }
  if (ability.discard) {
    next = moveCard(next, cardId, "graveyard");
  }
  next = putActivatedAbilityOnStack(next, cardId, abilityIndex, targets ?? []);
  if (ability.sacrificeSelf) {
    // Sacrificing is part of the cost: it happens on activation, and the
    // ability resolves immediately (fetch lands do not sit in priority).
    next = moveCard(next, cardId, "graveyard");
    return resolveTopOfStack(next);
  }
  if (ability.discard) {
    return resolveTopOfStack(next);
  }
  return next;
}

export type ApplyActionOptions = {
  /** Host-owned digital-shortcut policy. Defaults to the standard skip set. */
  shortcuts?: ShortcutPolicy;
};

/**
 * Authoritative entry point for player actions. Illegal actions throw and leave
 * the original GameState unchanged.
 */
export function applyAction(
  state: GameState,
  action: GameAction,
  options: ApplyActionOptions = {},
): GameState {
  const shortcuts = options.shortcuts ?? DEFAULT_SHORTCUT_POLICY;
  const before = snapshot(state);
  try {
    let next: GameState;
    switch (action.kind) {
      case "pass_priority":
        next = applyPassPriority(state, action.playerId, shortcuts);
        break;
      case "cast_spell":
        next = applyCastSpell(
          state,
          action.playerId,
          action.cardId,
          action.targets,
          action.faceIndex,
          action.modeIndex,
          action.xValue,
          action.division,
        );
        break;
      case "play_land":
        next = applyPlayLand(state, action.playerId, action.cardId, action.faceIndex);
        break;
      case "declare_attackers":
        requirePlaying(state);
        requireLiving(state, action.playerId);
        next = declareAttackers(state, action.playerId, action.attacks);
        break;
      case "declare_blockers":
        requirePlaying(state);
        requireLiving(state, action.playerId);
        next = declareBlockers(state, action.playerId, action.blocks);
        break;
      case "concede":
        next = reconcileMulliganAfterLoss(applyConcede(state, action.playerId));
        break;
      case "tap_for_mana":
        next = applyTapForMana(
          state,
          action.playerId,
          action.cardId,
          action.color,
          action.manaIndex,
        );
        break;
      case "activate_ability":
        next = applyActivateAbility(
          state,
          action.playerId,
          action.cardId,
          action.abilityIndex,
          action.targets,
        );
        break;
      case "keep_hand":
        next = applyKeepHand(state, action.playerId);
        break;
      case "mulligan":
        next = applyTakeMulligan(state, action.playerId);
        break;
      case "bottom_cards":
        next = applyBottomCards(state, action.playerId, action.cardIds);
        break;
      case "manual_override":
        next = applyManualOverride(state, action.playerId, action.change);
        break;
      case "roll_die":
        next = applyRollDie(state, action.playerId, action.sides);
        break;
      case "opening_roll":
        next = applyOpeningRoll(state, action.playerId);
        break;
      case "advance_step":
        next = applyAdvanceStep(state, action.playerId, shortcuts);
        break;
      case "advance_turn":
        next = applyAdvanceTurn(state, action.playerId);
        break;
      case "choose_targets":
        next = applyChooseTargets(state, action.playerId, action.targets);
        break;
      case "resolve_order_triggers":
        next = applyResolveOrderTriggers(state, action.playerId, action.order);
        break;
      case "choose_enter_replacement":
        next = applyChooseEnterReplacement(state, action.playerId, action.pay);
        break;
      case "resolve_scry": {
        const prompt = currentPrompt(state);
        const resume = prompt?.kind === "scry" ? prompt.resumeEffects ?? [] : [];
        next = applyResolveScry(state, action.playerId, action.bottomIds);
        if (resume.length > 0) {
          next = applyEffects(next, resume);
        }
        break;
      }
      case "resolve_surveil": {
        const prompt = currentPrompt(state);
        const resume = prompt?.kind === "surveil" ? prompt.resumeEffects ?? [] : [];
        next = applyResolveSurveil(state, action.playerId, action.graveyardIds);
        if (resume.length > 0) {
          next = applyEffects(next, resume);
        }
        break;
      }
      case "resolve_discard": {
        const prompt = currentPrompt(state);
        const resume = prompt?.kind === "choose_discard" ? prompt.resumeEffects ?? [] : [];
        next = applyResolveDiscard(state, action.playerId, action.cardIds);
        if (resume.length > 0) {
          next = applyEffects(next, resume);
        }
        break;
      }
      case "resolve_choose_card": {
        const prompt = currentPrompt(state);
        const resume = prompt?.kind === "choose_card" ? prompt.resumeEffects ?? [] : [];
        const chosen = applyResolveChooseCard(state, action.playerId, action.cardId);
        next = chosen.next;
        const bound = bindCardEffects(next, chosen.thenEffects, {
          controllerId: action.playerId,
          sourceId: chosen.sourceId,
          chosenCardId: chosen.cardId,
        });
        if (bound.length > 0) {
          next = applyEffects(next, bound);
        }
        if (resume.length > 0 && !isPromptOpen(next)) {
          next = applyEffects(next, resume);
        } else if (resume.length > 0 && isPromptOpen(next)) {
          const open = currentPrompt(next);
          if (open && "resumeEffects" in open) {
            open.resumeEffects = [...(open.resumeEffects ?? []), ...resume];
          }
        }
        break;
      }
      case "resolve_look_assign": {
        const prompt = currentPrompt(state);
        const resume = prompt?.kind === "look_and_assign" ? prompt.resumeEffects ?? [] : [];
        next = applyResolveLookAssign(state, action.playerId, action.assignments);
        if (resume.length > 0) {
          next = applyEffects(next, resume);
        }
        break;
      }
      case "resolve_pay": {
        const prompt = currentPrompt(state);
        const resume = prompt?.kind === "pay_or_counter" ? prompt.resumeEffects ?? [] : [];
        next = applyResolvePay(state, action.playerId, action.pay, action.taps ?? []);
        if (resume.length > 0) {
          next = applyEffects(next, resume);
        }
        break;
      }
      case "resolve_search": {
        const prompt = currentPrompt(state);
        const resume = prompt?.kind === "search_library" ? prompt.resumeEffects ?? [] : [];
        next = applyResolveSearch(state, action.playerId, action.cardIds);
        if (resume.length > 0) {
          next = applyEffects(next, resume);
        }
        break;
      }
      case "undo":
        throw new Error("Undo is applied by the table host");
      default: {
        const exhaustive: never = action;
        throw new Error(`Unknown GameAction ${(exhaustive as GameAction).kind}`);
      }
    }
    return finalizeActionState(next);
  } catch (error) {
    assertUnchanged(before, state, "Illegal action");
    throw error;
  }
}

export function applyActions(
  state: GameState,
  actions: GameAction[],
  options: ApplyActionOptions = {},
): GameState {
  let current = state;
  for (const action of actions) {
    current = applyAction(current, action, options);
  }
  return current;
}
