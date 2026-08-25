import { declareAttackers, declareBlockers, lockRemainingBlockers, pendingBlockerPlayer, priorityForStep } from "./combat";
import {
  abilitiesRemoved,
  activatedOf,
  cardMatchesSubtype,
  controlsGate,
} from "./characteristicsEngine";
import { characteristicsOf, isCommander, isCreature, isInstant, isInstantOrSorcery, isLand, isLegendary, isMainPhase } from "./cardTypes";
import { abilityLifeCost } from "./commanderIdentity";
import { cloneGameState } from "./clone";
import { applyPhyrexianColorGrants, retraceReaches, targetingLifeTaxFor, splitSecondActive, costRelief, affinityArtifactDiscount, allBattlefieldCreatureCount, canActivateTapAbility, canPlayLandFromTop, canPlayLandsFromGraveyard, castCostReduction, castableFromTop, controlsCommander, creaturePower, freeEquipGranted, hasFlashGrant, activationNonManaPayment, altCastPayment, landDropAllowance, manaTapMultiplier, lockedByAbolisher, lockedFromCasting, noncreatureSpellCap, opponentControlsMoreLands, findFreeHandGrantIndex, opponentsCastLockedToHand, selfDiscountAmount, staticFreeCastCap, usesOncePerTurnFreeCast , topOfLibraryGrant } from "./derived";
import { eliminatePlayerInPlace } from "./elimination";
import { applyEffects, bindCardEffects, devotionTo } from "./effects";
import { hasKeyword } from "./keywords";
import { controlsMatching, sacrificeColorMatches, sacrificeScopeMatches } from "./legalActions";
import { addMana, addRestrictedMana, canPayManaCost, manaSpentBetween, parseManaCost, payManaCost, poolWith, tapCard, tapForMana, totalManaAvailable, usableRestrictedMana, type ManaPurpose } from "./mana";
import { colorsAmongControlled, manaAbilityAmount, manaAbilitiesFor, manaTapOptionsFor } from "./manaOptions";
import { createId } from "./ids";
import { isLiving, livingPlayerCount, requireLiving } from "./players";
import { passPriority, putActivatedAbilityOnStack, putSpellOnStack, resolveTopOfStack } from "./stack";
import { applyStateBasedActionsInPlace, redirectPriorityIfLost } from "./status";
import { dispatchEventsInPlace, triggerConditionHolds } from "./triggers";
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
import { applyChooseEnterReplacement, applyChooseTargets, applyResolveChooseCard, applyResolveChooseFromHand, applyResolveCardName, applyResolveChoosePile, applyResolveColor, applyResolveCreatureType, applyResolveDividePiles, applyResolveDredge, applyResolveExileUntilTaken, applyResolvePunisher, applyResolveTapOwnForX, applyResolveTemptingOffer, applyResolveDiscard, applyResolveEnterCopy, applyResolveLookAssign, applyResolveOrderTriggers, applyResolvePay, applyResolveScry, applyResolveSearch, applyResolveSurveil, applyResolveTriggerMode, currentPrompt, dropLostPlayerPromptsInPlace, isPromptOpen, applyResolveDiscardLandOrGraveyard } from "./prompt";
import { manaValueOf } from "./characteristics";
import { findCardZone, moveCard } from "./zones";
import type { ActivatedAbility, AdditionalCastCost, CardInstanceId, ChosenTarget, Color, GameAction, GameState, ManaColor, ManaPool, PlayerId } from "./types";

/**
 * Run the mana riders that fired while a cost was paid (Path of Ancestry).
 * The payment path records them instead of applying them, because effects.ts
 * imports mana.ts and the arrow does not go back.
 */
/**
 * Underworld Breach: the cards escape exiles as part of its cost, or null
 * when no grant reaches this card or the graveyard cannot pay.
 *
 * The cards are AUTO-PICKED cheapest-first, the same documented
 * approximation `altCastPayment` already makes — a player exiling for
 * escape reaches for their spent lands and cantrips first.
 */
/**
 * Retrace (CR 702.81): the land card discarded to cast this from the
 * graveyard, or null when retrace does not reach this card or the hand
 * holds no land.
 *
 * The land is AUTO-PICKED — the first one in hand — which is the same
 * documented approximation `escapeExilePayment` and `altCastPayment` make.
 * A retrace player is discarding a land they were never going to play.
 *
 * Both sources are read here: the card's own printed retrace, and a
 * permanent granting it to what is in the graveyard (Six, Deeproot
 * Historian). A granted retrace is not on the card being cast, so it has
 * to be looked up rather than read off the definition.
 */
function retracePayment(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
): CardInstanceId | null {
  const definition = state.definitions[state.cards[cardId]?.definitionId ?? ""];
  if (!definition) {
    return null;
  }
  if (!retraceReaches(state, playerId, cardId)) {
    return null;
  }
  const hand = state.players.find((entry) => entry.id === playerId)?.zones.hand ?? [];
  return hand.find((entry) => isLand(state, entry)) ?? null;
}

function escapeExilePayment(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
): CardInstanceId[] | null {
  if (isLand(state, cardId)) {
    return null;
  }
  let exileOther = 0;
  for (const card of Object.values(state.cards)) {
    if (card.zone !== "battlefield" || card.controllerId !== playerId) {
      continue;
    }
    const grant = state.definitions[card.definitionId]?.grantsEscape;
    if (grant) {
      // Two Breaches do not stack their costs; the cheapest grant applies.
      exileOther = exileOther === 0 ? grant.exileOther : Math.min(exileOther, grant.exileOther);
    }
  }
  if (exileOther === 0) {
    return null;
  }
  const graveyard = state.players.find((entry) => entry.id === playerId)?.zones.graveyard ?? [];
  const others = graveyard
    .filter((entry) => entry !== cardId)
    .sort(
      (left, right) =>
        manaValueOf(state.definitions[state.cards[left]!.definitionId]?.manaCost ?? "") -
        manaValueOf(state.definitions[state.cards[right]!.definitionId]?.manaCost ?? ""),
    );
  if (others.length < exileOther) {
    return null;
  }
  return others.slice(0, exileOther);
}

function drainManaRiders(state: GameState, spellCardId?: CardInstanceId): GameState {
  const pending = state.pendingManaRiders ?? [];
  if (pending.length === 0) {
    return state;
  }
  let current = cloneGameState(state);
  delete current.pendingManaRiders;
  for (const entry of pending) {
    current = applyEffects(
      current,
      bindCardEffects(current, entry.effects, {
        controllerId: entry.controllerId,
        sourceId: entry.sourceId,
        // Arena of Glory: "it gains haste" means the SPELL the mana paid
        // for, which is on the stack by the time this drains.
        ...(spellCardId ? { subjectCardId: spellCardId } : {}),
      }),
    );
  }
  return current;
}

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

/**
 * "Whenever you tap … for mana, add an additional …" — a triggered mana
 * ability, so it resolves immediately with no stack (CR 605.1b).
 *
 * The plain form (Mirari's Wake) adds one mana of a type the land produced,
 * auto-picked as the biggest slice of what was added — a documented
 * approximation of the free choice. The narrowed forms name their own colour
 * (Crypt Ghast) or gate on what the tap produced (Forsaken Monument).
 */
function applyManaTapEchoes(
  state: GameState,
  playerId: PlayerId,
  tappedId: CardInstanceId,
  addition: Partial<ManaPool>,
): GameState {
  let next = state;
  // A permanent's echo only watches ITS controller's taps; High Tide's
  // watches everyone's, which is why the turn-scoped list is appended here
  // rather than being modelled as an invisible permanent.
  const rules = [
    ...Object.values(next.cards)
      .filter((echo) => echo.zone === "battlefield" && echo.controllerId === playerId)
      .map((echo) => next.definitions[echo.definitionId]?.landTapEcho),
    ...(next.turnManaEchoes ?? []),
  ];
  for (const rule of rules) {
    if (!rule) {
      continue;
    }
    if (!rule.anyPermanent && !isLand(next, tappedId)) {
      continue;
    }
    if (rule.subtype && !cardMatchesSubtype(next, tappedId, rule.subtype)) {
      continue;
    }
    if (rule.requiresProduced && (addition[rule.requiresProduced] ?? 0) <= 0) {
      continue;
    }
    const produced = (Object.entries(addition) as [ManaColor, number][])
      .filter(([, amount]) => amount > 0)
      .sort((a, b) => b[1] - a[1])[0]?.[0];
    const color = rule.addColor ?? produced;
    if (color) {
      next = addMana(next, playerId, { [color]: 1 });
    }
  }
  return next;
}

function findFreeHandGrant(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
): boolean {
  return findFreeHandGrantIndex(state, playerId, cardId) >= 0;
}

/**
 * Which branch of an either-or additional cost the caster is paying.
 *
 * The choice is read from the cast action's own fields rather than from a new
 * prompt: supplying a sacrifice id means the sacrifice branch, discard ids
 * mean the discard branch. When nothing distinguishes them the first
 * affordable branch is taken — a documented auto-pick, in the same spirit as
 * the other free choices the bot cannot reason about.
 */
function chooseAdditionalCostBranch(
  state: GameState,
  playerId: PlayerId,
  cost: AdditionalCastCost | undefined,
  costSacrificeId: CardInstanceId | undefined,
  costDiscardIds: CardInstanceId[] | undefined,
): AdditionalCastCost | undefined {
  if (!cost?.alternatives || cost.alternatives.length === 0) {
    return cost;
  }
  const branches = cost.alternatives;
  if (costSacrificeId !== undefined) {
    const sacrificeBranch = branches.find((branch) => branch.sacrifice);
    if (sacrificeBranch) {
      return sacrificeBranch;
    }
  }
  if (costDiscardIds !== undefined && costDiscardIds.length > 0) {
    const discardBranch = branches.find((branch) => branch.discard);
    if (discardBranch) {
      return discardBranch;
    }
  }
  const player = state.players.find((entry) => entry.id === playerId);
  // A mana branch beside a life branch (Redirect Lightning: "pay 5 life or
  // pay {2}") is tried FIRST when it is payable. The documented rule is
  // "first affordable branch", but taking 5 life off a player holding two
  // spare mana is not a choice anyone makes, and life is the scarcer
  // resource at this table size.
  const manaBranch = branches.find((branch) => branch.mana !== undefined);
  if (manaBranch?.mana !== undefined && player) {
    if (canPayManaCost(player.mana, parseManaCost(manaBranch.mana), player.life)) {
      return manaBranch;
    }
  }
  const affordable = branches.find((branch) => {
    if (branch.mana !== undefined) {
      // Already tried above and not payable.
      return false;
    }
    if (branch.life !== undefined) {
      return (player?.life ?? 0) > branch.life;
    }
    if (branch.discard !== undefined) {
      return (player?.zones.hand.length ?? 0) >= branch.discard;
    }
    if (branch.sacrifice) {
      return Object.values(state.cards).some(
        (entry) =>
          entry.zone === "battlefield" &&
          entry.controllerId === playerId &&
          sacrificeScopeMatches(state, entry.id, branch.sacrifice!),
      );
    }
    return true;
  });
  return affordable ?? branches[0];
}

function validateCast(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
  modeIndexes: number[] = [],
): {
  cost: ReturnType<typeof parseManaCost>;
  fromCommand: boolean;
  flashbackLife: number;
  altCost?: { life: number; exileIds: CardInstanceId[]; sacrificeId?: CardInstanceId };
  /** Underworld Breach: the OTHER graveyard cards escape exiles as a cost. */
  escapeExileIds?: CardInstanceId[];
  /** Retrace (CR 702.81): the land discarded to cast this from the yard. */
  retraceLandId?: CardInstanceId;
  /** Evoke (CR 702.74): the alternative cost was taken, so the permanent is
   * sacrificed as it enters. */
  viaEvoke?: boolean;
  /** Dread Return: creatures sacrificed for a flashback cost, weakest first. */
  flashbackSacrificeIds?: CardInstanceId[];
} {
  requirePriority(state, playerId);
  // Grand Abolisher / Voice of Victory: no casting on the lock's turn.
  if (lockedFromCasting(state, playerId)) {
    throw new Error("An opponent's permanent stops you from casting spells this turn");
  }
  // Split second (CR 702.61): nothing but a mana ability, for anyone,
  // including the caster of the split-second spell itself.
  if (splitSecondActive(state)) {
    throw new Error("A spell with split second is on the stack");
  }
  // Silence: everyone but the caster of the lock is shut out this turn.
  // Conduit of Worlds: this player spent their one spell for the turn.
  if ((state.selfCastLockUntilEot ?? []).includes(playerId)) {
    throw new Error("You can't cast additional spells this turn");
  }
  if (state.castLockUntilEot && state.castLockUntilEot !== playerId) {
    throw new Error("You can't cast spells this turn");
  }

  const card = state.cards[cardId];
  if (!card) {
    throw new Error(`Unknown card ${cardId}`);
  }
  const definition = state.definitions[card.definitionId];
  if (!definition) {
    throw new Error(`Unknown card definition for ${cardId}`);
  }
  // Ranger-Captain of Eos: only noncreature spells are locked.
  if (
    state.noncreatureCastLockUntilEot &&
    state.noncreatureCastLockUntilEot !== playerId &&
    !definition.characteristics.types.includes("creature")
  ) {
    throw new Error("You can't cast noncreature spells this turn");
  }
  // Deafening Silence: a per-turn quota rather than a lock, and it binds
  // the controller too. The tally is bumped as the spell goes on the
  // stack, so the comparison here is against what has ALREADY been cast.
  if (!definition.characteristics.types.includes("creature")) {
    const cap = noncreatureSpellCap(state);
    if (
      cap !== null &&
      (state.noncreatureSpellsCastByPlayerThisTurn?.[playerId] ?? 0) >= cap
    ) {
      throw new Error("You have cast your noncreature spell for the turn");
    }
  }

  const located = findCardZone(state, cardId);
  const fromHand = Boolean(located && located.zone === "hand" && located.playerId === playerId);
  // Drannith Magistrate: opponents may only cast from their hands — the
  // command zone, graveyard, exile, and library top are all shut.
  if (!fromHand && opponentsCastLockedToHand(state, playerId)) {
    throw new Error("An opponent's permanent stops you from casting from there");
  }
  const fromCommand = Boolean(
    located &&
      located.zone === "command" &&
      located.playerId === playerId &&
      isCommander(state, cardId),
  );
  const fromLibraryTop = Boolean(
    located &&
      located.zone === "library" &&
      located.playerId === playerId &&
      castableFromTop(state, playerId, cardId),
  );
  const viaFlashback = Boolean(
    located &&
      located.zone === "graveyard" &&
      located.playerId === playerId &&
      definition.flashback &&
      isInstantOrSorcery(state, cardId),
  );
  // Gravecrawler: a normal cast from the graveyard behind a controlled gate.
  const viaGraveyardGate = Boolean(
    located &&
      located.zone === "graveyard" &&
      located.playerId === playerId &&
      definition.castFromGraveyard &&
      controlsMatching(state, playerId, definition.castFromGraveyard),
  );
  // Underworld Breach: a permanent grants escape to every nonland card in
  // its controller's graveyard, for the mana cost plus exiling others. The
  // grant lives on that permanent, not on the card being cast, so it is
  // looked up rather than read off the definition.
  const escapeExileIds =
    located?.zone === "graveyard" && located.playerId === playerId
      ? escapeExilePayment(state, playerId, cardId)
      : null;
  const viaEscape = escapeExileIds !== null;
  // Retrace: the land is discarded beside the printed cost, and the card
  // goes back to the GRAVEYARD when it resolves rather than exiling —
  // which is why it is not folded in with flashback.
  const retraceLandId =
    located?.zone === "graveyard" && located.playerId === playerId
      ? retracePayment(state, playerId, cardId)
      : null;
  const viaRetrace = retraceLandId !== null;
  const fromGraveyard = viaFlashback || viaGraveyardGate || viaEscape || viaRetrace;
  // Impulse exiles, and Emry's graveyard grant: listed cards may be cast
  // from where they are. Both zones, because the permission is about the
  // CARD rather than the zone it happens to be in.
  const fromExile = Boolean(
    located &&
      (located.zone === "exile" || located.zone === "graveyard") &&
      state.exilePlayable?.some((entry) => entry.cardId === cardId && entry.casterId === playerId),
  );
  if (!fromHand && !fromCommand && !fromLibraryTop && !fromGraveyard && !fromExile) {
    throw new Error(`Card ${cardId} must be in the player's hand`);
  }

  if (isLand(state, cardId) && !isInstantOrSorcery(state, cardId)) {
    throw new Error(`Card ${cardId} is a land and cannot be cast as a spell`);
  }

  if (
    !isInstant(state, cardId) &&
    !hasKeyword(state, cardId, "flash") &&
    !hasFlashGrant(state, playerId, cardId) &&
    !canCastNonInstantNow(state, playerId)
  ) {
    throw new Error("That spell cannot be cast at this time");
  }

  const player = state.players.find((entry) => entry.id === playerId);
  if (!player) {
    throw new Error(`Unknown player ${playerId}`);
  }
  // Flashback replaces the printed mana cost (CR 702.34a). Bolas's
  // Citadel does the same thing to a spell cast off the library top:
  // life equal to its mana value, and no mana at all.
  const citadelLife =
    fromLibraryTop &&
    topOfLibraryGrant(state, playerId)?.payLifeInsteadOfMana === true
      ? definition.characteristics.manaValue
      : 0;
  const flashbackLife = viaFlashback
    ? definition.flashback?.life ?? 0
    : citadelLife;
  // Dread Return: flashback whose whole cost is a sacrifice. The fodder is
  // auto-picked WEAKEST-first, the same documented approximation
  // `altCastPayment` makes — a player paying this reaches for tokens first.
  // The card itself is in the graveyard, so it can never be its own fodder.
  let flashbackSacrificeIds: CardInstanceId[] | undefined;
  if (viaFlashback && definition.flashback?.sacrificeCreatures) {
    const wanted = definition.flashback.sacrificeCreatures;
    const fodder = Object.values(state.cards)
      .filter(
        (entry) =>
          entry.zone === "battlefield" &&
          entry.controllerId === playerId &&
          isCreature(state, entry.id),
      )
      .sort((a, b) => creaturePower(state, a.id) - creaturePower(state, b.id))
      .slice(0, wanted)
      .map((entry) => entry.id);
    if (fodder.length < wanted) {
      throw new Error(`Sacrifice ${wanted} creatures to cast this`);
    }
    flashbackSacrificeIds = fodder;
  }
  // Etali: free-cast impulse exiles pay nothing.
  const freeExileCast =
    fromExile &&
    state.exilePlayable?.some(
      (entry) => entry.cardId === cardId && entry.casterId === playerId && entry.freeCast,
    );
  // Rishkar's Expertise: a hand grant covers this spell if its mana value is
  // inside the cap. Checked before tax and discounts because it replaces the
  // whole cost rather than reducing it.
  const freeHandCast =
    state.cards[cardId]?.zone === "hand" &&
    (findFreeHandGrant(state, playerId, cardId) ||
      staticFreeCastCap(state, playerId, cardId) !== null);
  // Damn: an overload cost in different colours REPLACES the printed one.
  // Folded into the cost expression so it is in force before the commander
  // tax and before any payability check — checked after, the spell would be
  // refused for mana it was never going to spend.
  const overloadSwap = modeIndexes
    .map((chosen) => definition.modes?.[chosen]?.replacesCost)
    .find((entry): entry is string => typeof entry === "string");
  const cost = parseManaCost(
    freeExileCast || freeHandCast
      ? ""
      : overloadSwap
        ? overloadSwap
        : viaFlashback
          ? definition.flashback?.manaCost ?? ""
          : definition.manaCost,
  );
  // K'rrik: every {B} in the cost becomes a Phyrexian pip for its
  // controller. Applied before the tax and the discounts so it works on
  // the printed pips rather than whatever survives them.
  applyPhyrexianColorGrants(state, playerId, cost);
  if (fromCommand) {
    cost.generic += player.commander.tax;
  }
  // CR 601.2f: increases (tax) first, then static discounts, floor zero.
  cost.generic = Math.max(0, cost.generic - castCostReduction(state, playerId, definition));
  if (definition.affinityArtifacts) {
    cost.generic = Math.max(0, cost.generic - affinityArtifactDiscount(state, playerId));
  }
  if (definition.affinityAllCreatures) {
    cost.generic = Math.max(0, cost.generic - allBattlefieldCreatureCount(state));
  }
  if (definition.selfDiscount) {
    cost.generic = Math.max(
      0,
      cost.generic - selfDiscountAmount(state, playerId, definition.selfDiscount),
    );
  }
  // Free-spell cycle: the alternative cost is auto-taken (documented
  // approximation) — the whole mana cost is skipped.
  if (definition.freeIfCommander && controlsCommander(state, playerId)) {
    return { cost: parseManaCost(""), fromCommand, flashbackLife: 0 };
  }
  // Blasphemous Edict: the cheap alternative cost is auto-taken whenever
  // the creature count holds (documented approximation).
  if (
    definition.altCostIfCreatures &&
    allBattlefieldCreatureCount(state) >= definition.altCostIfCreatures.count
  ) {
    Object.assign(cost, parseManaCost(definition.altCostIfCreatures.cost));
  }
  if (citadelLife > 0) {
    // CR 119.4: life may be paid only down to zero, never past it.
    if (player.life < citadelLife) {
      throw new Error(`Pay ${citadelLife} life to cast this`);
    }
    return { cost: parseManaCost(""), fromCommand, flashbackLife: citadelLife };
  }
  if (flashbackLife > 0 && player.life <= flashbackLife) {
    throw new Error(`Pay ${flashbackLife} life to cast this`);
  }
  // Cavern of Souls and friends: restricted mana counts toward this cast if
  // the spell is one it is allowed to pay for.
  const purpose = manaPurposeForSpell(state, cardId);
  const available = poolWith(player.mana, usableRestrictedMana(state, playerId, purpose));
  if (
    !canPayManaCost(available, cost, player.life) &&
    // Convoke / improvise / delve are tried before the alternative cost: they
    // pay the printed one rather than replacing it. This call only tests
    // reachability; the payment path applies its own relief for real.
    !costRelief(
      state,
      playerId,
      definition,
      { ...cost, hybrid: [...cost.hybrid], phyrexian: [...cost.phyrexian] },
      available,
      player.life,
      // Harmonize's convoke half is for the graveyard cast only.
      viaFlashback,
    )
  ) {
    // Evoke (CR 702.74): an alternative MANA cost, taken in the same one
    // direction — a caster who can pay for the body gets the body, and
    // nobody throws away a Mulldrifter they could have kept.
    if (definition.evoke && state.cards[cardId]?.zone === "hand") {
      const evokeCost = parseManaCost(definition.evoke.manaCost);
      if (canPayManaCost(available, evokeCost, player.life)) {
        return {
          cost: evokeCost,
          fromCommand,
          flashbackLife,
          viaEvoke: true,
          ...(escapeExileIds && escapeExileIds.length > 0 ? { escapeExileIds } : {}),
          ...(retraceLandId ? { retraceLandId } : {}),
        };
      }
    }
    // Force of Will / Snuff Out: the printed cost is out of reach, so the
    // alternative is taken. Only in this direction — see AlternativeCastCost.
    const payment = definition.altCost
      ? altCastPayment(state, playerId, definition.altCost, cardId)
      : null;
    if (!payment) {
      throw new Error("Cannot pay mana cost");
    }
    return {
      cost: parseManaCost(""),
      fromCommand,
      flashbackLife,
      altCost: { life: definition.altCost?.life ?? 0, ...payment },
      ...(escapeExileIds && escapeExileIds.length > 0 ? { escapeExileIds } : {}),
      ...(retraceLandId ? { retraceLandId } : {}),
    };
  }

  return {
    cost,
    fromCommand,
    flashbackLife,
    ...(escapeExileIds && escapeExileIds.length > 0 ? { escapeExileIds } : {}),
    ...(retraceLandId ? { retraceLandId } : {}),
    ...(flashbackSacrificeIds ? { flashbackSacrificeIds } : {}),
  };
}

/** What a cast is, for restricted-mana purposes. */
export function manaPurposeForSpell(
  state: GameState,
  cardId: CardInstanceId,
): ManaPurpose | undefined {
  const definition = state.definitions[state.cards[cardId]?.definitionId ?? ""];
  if (!definition) {
    return undefined;
  }
  const traits = definition.characteristics;
  return {
    types: traits.types,
    subtypes: traits.subtypes,
    supertypes: traits.supertypes,
    colorless: traits.colors.length === 0,
    // A changeling is every creature type, so any chosen-type restriction
    // admits it (CR 702.73a).
    changeling: definition.changeling === true,
    isAbility: false,
    // Opal Palace: whether this is the caster's own commander, read off
    // the card rather than the zone — a commander cast from hand is still
    // a commander spell, and its rider still fires.
    ...(isCommander(state, cardId) ? { commanderSpell: true } : {}),
  };
}

/** The same, for an activated ability's source permanent. */
export function manaPurposeForAbility(
  state: GameState,
  cardId: CardInstanceId,
): ManaPurpose | undefined {
  const spell = manaPurposeForSpell(state, cardId);
  return spell ? { ...spell, isAbility: true } : undefined;
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
  modeIndexes: number[] | undefined,
  xValue: number | undefined,
  division: number[] | undefined,
  costSacrificeId: CardInstanceId | undefined,
  costDiscardIds: CardInstanceId[] | undefined,
  spliceCardIds: CardInstanceId[] | undefined,
): GameState {
  requirePlaying(state);
  const faced = applyChosenFace(state, cardId, faceIndex);
  const {
    cost,
    fromCommand,
    flashbackLife,
    altCost,
    escapeExileIds,
    retraceLandId,
    viaEvoke,
    flashbackSacrificeIds,
  } = validateCast(
    faced,
    playerId,
    cardId,
    modeIndexes ?? (modeIndex !== undefined ? [modeIndex] : []),
  );
  const card = faced.cards[cardId];
  const definition = card ? faced.definitions[card.definitionId] : undefined;
  // "Sacrifice an artifact or discard a card": pick the branch the caster's
  // own inputs point at, then treat it as the only cost.
  const additional = chooseAdditionalCostBranch(
    faced,
    playerId,
    definition?.additionalCost,
    costSacrificeId,
    costDiscardIds,
  );
  if (additional?.sacrifice) {
    const sacrifice = costSacrificeId ? faced.cards[costSacrificeId] : undefined;
    if (
      !costSacrificeId ||
      !sacrifice ||
      sacrifice.zone !== "battlefield" ||
      sacrifice.controllerId !== playerId ||
      !sacrificeScopeMatches(faced, costSacrificeId, additional.sacrifice) ||
      !sacrificeColorMatches(faced, costSacrificeId, additional.sacrificeColor)
    ) {
      throw new Error(
        `Sacrifice a ${additional.sacrificeColor ? `${additional.sacrificeColor} ` : ""}${additional.sacrifice.replace(/_/g, " ")} to cast this`,
      );
    }
  } else if (costSacrificeId !== undefined) {
    throw new Error("That spell has no sacrifice cost");
  }
  if (additional?.discard) {
    const hand = faced.players.find((entry) => entry.id === playerId)?.zones.hand ?? [];
    const chosen = costDiscardIds ?? [];
    const unique = new Set(chosen);
    if (
      chosen.length !== additional.discard ||
      unique.size !== chosen.length ||
      chosen.some((id) => !hand.includes(id) || id === cardId)
    ) {
      throw new Error(`Discard ${additional.discard} card(s) to cast this`);
    }
  } else if (costDiscardIds !== undefined && costDiscardIds.length > 0) {
    throw new Error("That spell has no discard cost");
  }
  if (additional?.life) {
    const player = faced.players.find((entry) => entry.id === playerId);
    if (!player || player.life <= additional.life) {
      throw new Error(`Pay ${additional.life} life to cast this`);
    }
  }
  /**
   * Splice onto Arcane (CR 702.47). Each named card is REVEALED from hand
   * and never cast, so it stays where it is; only its cost joins this
   * spell's. Priced HERE, with the rest of the cost, because one payment
   * covers all of it — priced after the payment it would be free.
   */
  const splices = spliceCardIds ?? [];
  if (splices.length > 0) {
    const spliceHand = faced.players.find((entry) => entry.id === playerId)?.zones.hand ?? [];
    if (!characteristicsOf(faced, cardId).subtypes.includes("arcane")) {
      throw new Error("Only an Arcane spell can be spliced onto");
    }
    const seenSplices = new Set<CardInstanceId>();
    for (const spliceId of splices) {
      const spliceDefinition = faced.definitions[faced.cards[spliceId]?.definitionId ?? ""];
      if (
        !spliceHand.includes(spliceId) ||
        spliceId === cardId ||
        seenSplices.has(spliceId) ||
        !spliceDefinition?.spliceOntoArcane
      ) {
        throw new Error(`Card ${spliceId} cannot be spliced onto this spell`);
      }
      seenSplices.add(spliceId);
      const spliceCost = parseManaCost(spliceDefinition.spliceOntoArcane.manaCost);
      cost.generic += spliceCost.generic;
      for (const color of ["W", "U", "B", "R", "G", "C"] as const) {
        cost[color] += spliceCost[color];
      }
      cost.hybrid.push(...spliceCost.hybrid);
    }
  }
  // "As an additional cost…, pay {2}": added to the spell's cost rather than
  // paid separately, so one payment covers both halves.
  if (additional?.mana) {
    const extra = parseManaCost(additional.mana);
    cost.generic += extra.generic;
    for (const color of ["W", "U", "B", "R", "G", "C"] as const) {
      cost[color] += extra[color];
    }
    cost.hybrid.push(...extra.hybrid);
    const player = faced.players.find((entry) => entry.id === playerId);
    if (!player || !canPayManaCost(player.mana, cost, player.life)) {
      throw new Error("Cannot pay the additional cost");
    }
  }
  if (additional?.lifeX) {
    // "As an additional cost…, pay X life" — the announced X is the life paid
    // and feeds the spell's "x" amounts (Toxic Deluge).
    const player = faced.players.find((entry) => entry.id === playerId);
    if (xValue === undefined || !Number.isInteger(xValue) || xValue < 0) {
      throw new Error("Announce a value for X");
    }
    if (!player || player.life <= xValue) {
      throw new Error(`Pay ${xValue} life to cast this`);
    }
  }
  if (cost.xCount > 0) {
    if (xValue === undefined || !Number.isInteger(xValue) || xValue < 0) {
      throw new Error("Announce a value for X");
    }
    cost.generic += xValue * cost.xCount;
    const player = faced.players.find((entry) => entry.id === playerId);
    if (!player || !canPayManaCost(player.mana, cost)) {
      throw new Error("Cannot pay mana cost");
    }
  } else if (xValue !== undefined && !additional?.lifeX) {
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
  // Kicker-style modes: the chosen mode may carry an extra mana cost.
  const chosenModeIndexes =
    modeIndexes ?? (modeIndex !== undefined ? [modeIndex] : []);
  for (const chosen of chosenModeIndexes) {
    // Damn: an overload cost in different colours replaces the printed
    // one outright. Added to it, a mono-black caster could overload a
    // white spell by paying black.
    // validateCast already swapped the cost; this only re-checks that the
    // caster can actually pay the replacement.
    const replaced = definition?.modes?.[chosen]?.replacesCost;
    if (replaced) {
      const swapPayer = faced.players.find((entry) => entry.id === playerId);
      if (!swapPayer || !canPayManaCost(swapPayer.mana, cost, swapPayer.life)) {
        throw new Error("Cannot pay the overload cost");
      }
      continue;
    }
    const extra = definition?.modes?.[chosen]?.extraCost;
    if (!extra) {
      continue;
    }
    const extraCost = parseManaCost(extra);
    cost.generic += extraCost.generic;
    for (const color of ["W", "U", "B", "R", "G", "C"] as const) {
      cost[color] += extraCost[color];
    }
    cost.hybrid.push(...extraCost.hybrid);
    const payer = faced.players.find((entry) => entry.id === playerId);
    if (!payer || !canPayManaCost(payer.mana, cost, payer.life)) {
      throw new Error("Cannot pay the kicked cost");
    }
  }
  // Escalate (CR 702.120): the cost again for EACH mode beyond the first.
  // Not a per-mode `extraCost`, because which mode is "the first" depends on
  // what the caster picked — charging every mode would tax the first one too.
  if (definition?.escalate && chosenModeIndexes.length > 1) {
    const escalateCost = parseManaCost(definition.escalate);
    for (let extra = 1; extra < chosenModeIndexes.length; extra += 1) {
      cost.generic += escalateCost.generic;
      for (const color of ["W", "U", "B", "R", "G", "C"] as const) {
        cost[color] += escalateCost[color];
      }
      cost.hybrid.push(...escalateCost.hybrid);
    }
    const payer = faced.players.find((entry) => entry.id === playerId);
    if (!payer || !canPayManaCost(payer.mana, cost, payer.life)) {
      throw new Error("Cannot pay the escalate cost");
    }
  }
  if (definition?.modes && definition.modes.length > 0 && definition.modeChoice) {
    const { min, maxIfCommander } = definition.modeChoice;
    // "you may choose both instead" while you control a commander.
    const max =
      maxIfCommander !== undefined && controlsCommander(faced, playerId)
        ? maxIfCommander
        : definition.modeChoice.max;
    const chosen = modeIndexes ?? (modeIndex !== undefined ? [modeIndex] : []);
    if (
      chosen.length < min ||
      chosen.length > max ||
      new Set(chosen).size !== chosen.length ||
      chosen.some((index) => !Number.isInteger(index) || !definition.modes![index])
    ) {
      throw new Error(`Choose ${min === max ? min : `${min}-${max}`} mode(s)`);
    }
    const combined = chosen.flatMap((index) => definition.modes![index]!.targetRequirements);
    validateChosenTargets(faced, combined, targets ?? [], playerId, definition.characteristics.colors);
  } else if (definition?.modes && definition.modes.length > 0) {
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
      null,
      // Agadeem's Awakening: "mana value X or less" needs the announced X.
      xValue,
    );
  }
  // Convoke / improvise / delve close the gap before the mana is spent.
  const payer2 = faced.players.find((entry) => entry.id === playerId);
  // Harmonize's convoke half applies only to the graveyard cast, and by
  // this point the card is still in the graveyard it will be cast from.
  const castFromGraveyard =
    definition?.harmonizeConvoke === true &&
    findCardZone(faced, cardId)?.zone === "graveyard";
  const relief = payer2
    ? costRelief(
        faced,
        playerId,
        definition,
        cost,
        payer2.mana,
        payer2.life,
        castFromGraveyard,
      )
    : null;
  // What this cast actually SPENDS, measured across the payment rather than
  // read off the cost string: adamant, Opus and Boromir all ask about mana
  // that left the pool, and a reduction, convoke, a Phyrexian pip or an
  // alternative cost each make the cost and the spend different numbers.
  const poolBefore = totalManaAvailable(faced, playerId);
  let paid = payManaCost(faced, playerId, cost, manaPurposeForSpell(faced, cardId));
  const spent = manaSpentBetween(poolBefore, totalManaAvailable(paid, playerId));
  if (paid.cards[cardId]) {
    paid.cards[cardId]!.manaSpentToCast = spent;
  }
  if (relief) {
    for (const tapId of relief.tapIds) {
      paid = tapCard(paid, tapId);
    }
    if (relief.exileIds.length > 0) {
      paid = applyEffects(
        paid,
        relief.exileIds.map((exileId) => ({ kind: "move_card", cardId: exileId, toZone: "exile" })),
      );
    }
  }
  // Fling: capture the sacrificed creature's power before it dies.
  const sacrificedPower =
    additional?.sacrifice && costSacrificeId ? creaturePower(paid, costSacrificeId) : undefined;
  // Eldritch Evolution: and its mana value, which the search's cap adds to.
  const sacrificedManaValue =
    additional?.sacrifice && costSacrificeId
      ? characteristicsOf(paid, costSacrificeId).manaValue
      : undefined;
  if (additional?.sacrifice && costSacrificeId) {
    paid = applyEffects(paid, [{ kind: "sacrifice", cardId: costSacrificeId }]);
  }
  for (const discardId of costDiscardIds ?? []) {
    paid = moveCard(paid, discardId, "graveyard");
    dispatchEventsInPlace(paid, [{ kind: "discards", cardId: discardId, playerId }]);
  }
  if (additional?.life) {
    const payer = paid.players.find((entry) => entry.id === playerId);
    if (payer) {
      payer.life -= additional.life;
      paid.log.push({ kind: "life_change", playerId, delta: -additional.life });
    }
  }
  if (additional?.lifeX && xValue !== undefined && xValue > 0) {
    const payer = paid.players.find((entry) => entry.id === playerId);
    if (payer) {
      payer.life -= xValue;
      paid.log.push({ kind: "life_change", playerId, delta: -xValue });
    }
  }
  if (flashbackLife > 0) {
    const payer = paid.players.find((entry) => entry.id === playerId);
    if (payer) {
      payer.life -= flashbackLife;
      paid.log.push({ kind: "life_change", playerId, delta: -flashbackLife });
    }
  }
  // Terror of the Peaks: an additional cost in life for each opponent's
  // permanent this spell targets. Summed rather than taken once, because
  // two Terrors both tax and one spell may aim at both.
  const targetingTax = targetingLifeTaxFor(paid, playerId, targets ?? []);
  if (targetingTax > 0) {
    // CR 119.4: life may be paid only down to zero, and this is a COST —
    // a caster who cannot pay it cannot cast the spell at all.
    const beforeTax = paid.players.find((entry) => entry.id === playerId);
    if (!beforeTax || beforeTax.life < targetingTax) {
      throw new Error(`Pay ${targetingTax} life to target that`);
    }
  }
  if (targetingTax > 0) {
    const payer = paid.players.find((entry) => entry.id === playerId);
    if (payer) {
      payer.life -= targetingTax;
      paid.log.push({ kind: "life_change", playerId, delta: -targetingTax });
    }
  }
  // The alternative cast cost is paid here, alongside the other cost halves
  // and before the spell leaves hand.
  if (altCost) {
    if (altCost.life > 0) {
      const payer = paid.players.find((entry) => entry.id === playerId);
      if (payer) {
        payer.life -= altCost.life;
        paid.log.push({ kind: "life_change", playerId, delta: -altCost.life });
      }
    }
    for (const exileId of altCost.exileIds) {
      paid = applyEffects(paid, [{ kind: "move_card", cardId: exileId, toZone: "exile" }]);
    }
    if (altCost.sacrificeId) {
      paid = applyEffects(paid, [{ kind: "sacrifice", cardId: altCost.sacrificeId }]);
    }
  }
  // Retrace's land, discarded beside the other cost halves.
  if (retraceLandId) {
    paid = moveCard(paid, retraceLandId, "graveyard");
    dispatchEventsInPlace(paid, [{ kind: "discards", cardId: retraceLandId, playerId }]);
  }
  // Underworld Breach: escape's other half. Exiled BEFORE the spell leaves
  // the graveyard, so the count it was chosen against still holds.
  for (const exileId of escapeExileIds ?? []) {
    paid = applyEffects(paid, [{ kind: "move_card", cardId: exileId, toZone: "exile" }]);
  }
  // Dread Return: "Flashback—Sacrifice three creatures." Paid here beside the
  // other cost halves, and before the spell leaves the graveyard.
  for (const fodderId of flashbackSacrificeIds ?? []) {
    paid = applyEffects(paid, [{ kind: "sacrifice", cardId: fodderId }]);
  }
  // Evoke: recorded on the card while it is a spell, and read as it enters.
  if (viaEvoke && paid.cards[cardId]) {
    paid.cards[cardId]!.evoked = true;
  }
  // Spend the free-cast grant before the card leaves hand, so the lookup
  // still sees where it was.
  const inHand = paid.cards[cardId]?.zone === "hand";
  const grantIndex = inHand ? findFreeHandGrantIndex(paid, playerId, cardId) : -1;
  // As Foretold: a once-per-turn static grant latches instead of being spent,
  // and only when no one-shot grant already covered the cast.
  if (
    inHand &&
    grantIndex < 0 &&
    usesOncePerTurnFreeCast(paid, playerId, cardId) &&
    !(paid.freeCastUsedThisTurn ?? []).includes(playerId)
  ) {
    paid.freeCastUsedThisTurn = [...(paid.freeCastUsedThisTurn ?? []), playerId];
  }
  if (grantIndex >= 0) {
    const grants = [...(paid.freeCastFromHand ?? [])];
    const grant = grants[grantIndex]!;
    const remaining = grant.remaining - 1;
    paid.freeCastFromHand =
      remaining > 0
        ? grants.map((entry, index) => (index === grantIndex ? { ...entry, remaining } : entry))
        : grants.filter((_, index) => index !== grantIndex);
  }
  // "The next spell you cast this turn …": the grant is spent here and rides
  // the stack object, so it protects exactly one spell.
  const nextGrantIndex = (paid.nextSpellGrants ?? []).findIndex(
    (grant) => grant.playerId === playerId,
  );
  const nextGrant = nextGrantIndex >= 0 ? paid.nextSpellGrants![nextGrantIndex]! : null;
  if (nextGrant) {
    paid.nextSpellGrants = (paid.nextSpellGrants ?? []).filter(
      (_, index) => index !== nextGrantIndex,
    );
  }
  let stacked = putSpellOnStack(paid, cardId, targets ?? [], modeIndex, xValue, division, modeIndexes, sacrificedPower, sacrificedManaValue);
  // Conduit of Worlds: the lock rides the GRANT, so it fires here — when
  // the granted card is actually cast — rather than when the ability
  // resolved. Declining the cast costs nothing.
  if (
    (paid.exilePlayable ?? []).some(
      (entry) =>
        entry.cardId === cardId && entry.casterId === playerId && entry.locksCastingAfter,
    ) &&
    !(stacked.selfCastLockUntilEot ?? []).includes(playerId)
  ) {
    stacked.selfCastLockUntilEot = [...(stacked.selfCastLockUntilEot ?? []), playerId];
  }
  // The spliced cards are recorded on the SPELL, not moved: they were
  // revealed from hand and that is where they stay.
  if (splices.length > 0) {
    const spell = stacked.stack[stacked.stack.length - 1];
    if (spell) {
      spell.splicedFrom = [...splices];
    }
  }
  if (nextGrant?.cantBeCountered) {
    const top = stacked.stack[stacked.stack.length - 1];
    if (top) {
      top.cantBeCountered = true;
    }
  }
  // Path of Ancestry: the rider fires with the spell already on the
  // stack, so its effect resolves ABOVE the spell that mana paid for.
  stacked = drainManaRiders(stacked, cardId);
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
  const fromGraveyard =
    located?.zone === "graveyard" &&
    located.playerId === playerId &&
    canPlayLandsFromGraveyard(faced, playerId);
  const fromLibraryTop =
    located?.zone === "library" &&
    located.playerId === playerId &&
    canPlayLandFromTop(faced, playerId, cardId);
  const fromExilePlay =
    located?.zone === "exile" &&
    Boolean(
      faced.exilePlayable?.some((entry) => entry.cardId === cardId && entry.casterId === playerId),
    );
  if (
    !located ||
    (located.zone !== "hand" && !fromGraveyard && !fromLibraryTop && !fromExilePlay) ||
    located.playerId !== playerId
  ) {
    throw new Error(`Card ${cardId} must be in the player's hand`);
  }

  const player = faced.players.find((entry) => entry.id === playerId);
  if (!player) {
    throw new Error(`Unknown player ${playerId}`);
  }
  if (player.landsPlayedThisTurn >= landDropAllowance(faced, playerId)) {
    throw new Error("No land drops remain this turn");
  }

  const next = moveCard(faced, cardId, "battlefield");
  const movedPlayer = next.players.find((entry) => entry.id === playerId);
  if (!movedPlayer) {
    throw new Error(`Unknown player ${playerId}`);
  }
  movedPlayer.landsPlayedThisTurn += 1;
  // Burgeoning, City of Traitors: PLAYED, which is not the same as entering.
  // A fetched land enters and was never played, and this is the one site a
  // land is played from.
  dispatchEventsInPlace(next, [{ kind: "plays_land", cardId, playerId }]);
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
  costSacrificeId: CardInstanceId | undefined,
  costTapId: CardInstanceId | undefined,
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
  if (!canActivateTapAbility(state, cardId)) {
    throw new Error(`Card ${cardId} has summoning sickness`);
  }
  const abilities = manaAbilitiesFor(state, cardId);
  if (abilities.length === 0) {
    throw new Error(`Card ${cardId} does not produce mana`);
  }
  const index = manaIndex ?? 0;
  if (!Number.isInteger(index) || index < 0 || index >= abilities.length) {
    throw new Error("Choose a mana ability");
  }
  const ability = abilities[index]!;
  const options = manaTapOptionsFor(ability, state, playerId, cardId);
  // Kami of Whispered Hopes: the amount reads the creature's power at tap.
  // Nykthos: the amount is the devotion to the chosen color at tap.
  const amount = ability.countFromDevotion
    ? Math.max(0, color ? devotionTo(state, playerId, color as Color) : 0)
    : ability.countFromPower
      ? Math.max(0, creaturePower(state, cardId))
      : ability.countFromEnchantments
        ? Object.values(state.cards).filter(
            (entry) =>
              entry.zone === "battlefield" &&
              entry.controllerId === playerId &&
              characteristicsOf(state, entry.id).types.includes("enchantment"),
          ).length
        : ability.countFromGreatestControlledPower
          ? // Selvala: the GREATEST power among creatures you control —
            // not the source's own, and not the sum.
            Object.values(state.cards).reduce((best, entry) => {
              if (
                entry.zone !== "battlefield" ||
                entry.controllerId !== playerId ||
                !isCreature(state, entry.id)
              ) {
                return best;
              }
              return Math.max(best, creaturePower(state, entry.id));
            }, 0)
          : ability.countFromChosenTypeCreatures
          ? // Three Tree City: creatures you control of the type chosen
            // as this land entered. No chosen type means no creatures
            // match, which is nothing rather than everything.
            Object.values(state.cards).filter((entry) => {
              const chosen = state.cards[cardId]?.chosenCreatureType ?? undefined;
              return (
                chosen !== undefined &&
                entry.zone === "battlefield" &&
                entry.controllerId === playerId &&
                isCreature(state, entry.id) &&
                cardMatchesSubtype(state, entry.id, chosen)
              );
            }).length
          : manaAbilityAmount(ability);
  let addition: Partial<ManaPool>;
  if (ability.producesColorsAmong) {
    // Bloom Tender: one mana of each color among controlled permanents.
    addition = {};
    for (const present of colorsAmongControlled(state, playerId, ability.producesColorsAmong)) {
      addition[present] = 1;
    }
  } else if (ability.producesChosenColor) {
    // Heraldic Banner: the color picked as the source entered.
    if (!card.chosenColor) {
      throw new Error("No color was chosen for that mana ability");
    }
    addition = { [card.chosenColor]: amount };
  } else if (options) {
    if (!color || !options.includes(color)) {
      throw new Error("Choose a mana color");
    }
    addition = { [color]: amount };
  } else {
    addition = ability.produces;
  }
  // The Urza lands, Ilysian Caryatid: "If you control …, add <more> instead."
  // Checked before the multipliers, since it replaces what the tap makes.
  // Gemstone Caverns: the upgrade can be gated on the SOURCE's own
  // counters rather than on what its controller has out.
  const selfCounterOk =
    ability.upgrade?.selfCounter === undefined ||
    (state.cards[cardId]?.counters[ability.upgrade.selfCounter] ?? 0) > 0;
  if (
    ability.upgrade &&
    selfCounterOk &&
    ability.upgrade.requires.every((gate) => controlsGate(state, playerId, gate))
  ) {
    if (ability.upgrade.anyColor !== undefined) {
      // Gemstone Caverns: the base ability is colourless, so no colour was
      // ever chosen and there is nothing to rescale. The upgrade is what
      // GRANTS the choice, so the tap's colour is honoured here.
      if (!options && !ability.producesAnyColor) {
        if (!color) {
          throw new Error("Choose a mana color");
        }
        addition = { [color]: ability.upgrade.anyColor };
      } else {
        // Ilysian Caryatid: the colour is already picked above and the
        // upgrade only changes how many of it there are.
        const picked = (Object.keys(addition) as ManaColor[])[0];
        addition = picked ? { [picked]: ability.upgrade.anyColor } : addition;
      }
    } else if (ability.upgrade.sameTypeCount !== undefined) {
      // Incubation Druid: "three mana of THAT type" — the type is already
      // chosen above and only the amount changes. Unlike `anyColor` this
      // never offers a fresh choice, which is the difference between
      // "three of that type" and "three of any one color".
      const scale = ability.upgrade.sameTypeCount;
      addition = Object.fromEntries(
        (Object.entries(addition) as [ManaColor, number][]).map(([color, count]) => [
          color,
          count * scale,
        ]),
      );
    } else if (ability.upgrade.produces) {
      addition = { ...ability.upgrade.produces };
    }
  }
  // Mana Reflection / Nyxbloom Ancient: "If you tap a permanent for mana, it
  // produces twice as much of that mana instead." A replacement on the amount
  // (CR 616), so it only applies to abilities that actually tap.
  if (!ability.noTap) {
    const multiplier = manaTapMultiplier(state, playerId);
    if (multiplier !== 1) {
      addition = Object.fromEntries(
        (Object.entries(addition) as [ManaColor, number][]).map(([color, count]) => [
          color,
          count * multiplier,
        ]),
      );
    }
  }
  // Springleaf Drum-class: the activation's mana cost is paid from the pool.
  let base = state;
  if (ability.costMana) {
    const activation = parseManaCost(ability.costMana);
    const payer = state.players.find((entry) => entry.id === playerId);
    // A mana ability's own cost is an activation, so restricted mana that
    // allows abilities of this permanent may pay for it.
    const abilityPurpose = manaPurposeForAbility(state, cardId);
    const abilityPool = payer
      ? poolWith(payer.mana, usableRestrictedMana(state, playerId, abilityPurpose))
      : null;
    if (!payer || !abilityPool || !canPayManaCost(abilityPool, activation, payer.life)) {
      throw new Error("Cannot pay that mana ability's cost");
    }
    base = payManaCost(state, playerId, activation, abilityPurpose);
    // No rider watching casts can fire for an ability (restrictionAdmits
    // gates on isAbility), but draining here means a future one that CAN
    // fire runs instead of sitting in the pool forever.
    base = drainManaRiders(base);
  }
  // Phyrexian Altar-class: sacrificing a chosen permanent is the cost.
  if (ability.costSacrifice) {
    const fodder = costSacrificeId ? base.cards[costSacrificeId] : undefined;
    if (
      !costSacrificeId ||
      !fodder ||
      fodder.zone !== "battlefield" ||
      fodder.controllerId !== playerId ||
      !sacrificeScopeMatches(base, costSacrificeId, ability.costSacrifice) ||
      // Gilded Goose: the fodder must also be a Food.
      (ability.costSacrificeSubtype !== undefined &&
        !cardMatchesSubtype(base, costSacrificeId, ability.costSacrificeSubtype))
    ) {
      throw new Error(
        `Sacrifice a ${ability.costSacrificeSubtype ?? ability.costSacrifice.replace(/_/g, " ")} to use that mana ability`,
      );
    }
  } else if (costSacrificeId !== undefined) {
    throw new Error("That mana ability has no sacrifice cost");
  }
  // Springleaf Drum: tapping a chosen untapped creature is part of the cost.
  // Summoning sickness doesn't apply — the cost is not that creature's {T}.
  if (ability.costTapCreature) {
    const fodder = costTapId ? base.cards[costTapId] : undefined;
    if (
      !costTapId ||
      costTapId === cardId ||
      !fodder ||
      fodder.zone !== "battlefield" ||
      fodder.controllerId !== playerId ||
      fodder.tapped ||
      !isCreature(base, costTapId) ||
      // Relic of Legends: only a legendary creature pays this one.
      (ability.costTapCreatureLegendary === true && !isLegendary(base, costTapId))
    ) {
      throw new Error("Tap an untapped creature you control to use that mana ability");
    }
  } else if (costTapId !== undefined) {
    throw new Error("That mana ability has no tap-a-creature cost");
  }
  if (ability.costTapCreature && costTapId) {
    base = tapCard(base, costTapId);
    dispatchEventsInPlace(base, [{ kind: "tapped", cardId: costTapId }]);
  }
  // "Spend this mana only to …": the mana lands in the restricted pool
  // instead, tagged with its producer so a chosen-type rule can read it.
  // A rider alone is reason enough to tag the mana: Path of Ancestry's
  // mana is unrestricted, but it has to be watched to fire when spent.
  let next = ability.spendOnly || ability.rider
    ? addRestrictedMana(
        ability.noTap ? base : tapCard(base, cardId),
        playerId,
        addition,
        ability.spendOnly ?? { unrestricted: true },
        cardId,
        ability.rider,
      )
    : ability.noTap
      ? addMana(base, playerId, addition)
      : tapForMana(base, cardId, addition);
  if (ability.exertSelf) {
    // Exert (CR 701.39): the skip is the whole mechanic. Without it the
    // ability is a free tap for two red every turn.
    const exerted = next.cards[cardId];
    if (exerted) {
      exerted.skipNextUntap = true;
    }
  }
  next.priorityPlayerId = playerId;
  // City of Brass: "Whenever this land becomes tapped". Forbidden Orchard
  // asks the narrower question, so both events fire from the one tap.
  if (!ability.noTap) {
    dispatchEventsInPlace(next, [
      { kind: "tapped", cardId },
      { kind: "tapped_for_mana", cardId },
    ]);
  }
  // Wild Growth / Utopia Sprawl: auras on the tapped land pay a bonus to the
  // land's controller (a triggered mana ability — no stack, CR 605.1b).
  if (!ability.noTap && isLand(next, cardId)) {
    for (const aura of Object.values(next.cards)) {
      if (aura.attachedTo !== cardId || aura.zone !== "battlefield") {
        continue;
      }
      const bonus = next.definitions[aura.definitionId]?.enchantedTappedBonus;
      if (!bonus) {
        continue;
      }
      const color = bonus.color === "chosen" ? aura.chosenColor : bonus.color;
      if (!color) {
        continue;
      }
      next = addMana(next, playerId, { [color]: bonus.amount });
    }
  }
  // Caged Sun: a land's ability adding one or more of the chosen color adds
  // one more of it (a triggered mana ability — no stack, CR 605.1b).
  if (!ability.noTap && isLand(next, cardId)) {
    for (const sun of Object.values(next.cards)) {
      if (
        sun.zone !== "battlefield" ||
        sun.controllerId !== playerId ||
        !next.definitions[sun.definitionId]?.landChosenColorBonus
      ) {
        continue;
      }
      const chosen = sun.chosenColor;
      if (chosen && (addition[chosen] ?? 0) > 0) {
        next = addMana(next, playerId, { [chosen]: 1 });
      }
    }
    // Vorinclex's other half: an opponent's land tap freezes that land
    // through its controller's next untap step.
    const frozen = Object.values(next.cards).some(
      (praetor) =>
        praetor.zone === "battlefield" &&
        praetor.controllerId !== playerId &&
        next.definitions[praetor.definitionId]?.opponentLandTapsSkipUntap === true,
    );
    if (frozen) {
      next.cards[cardId]!.skipNextUntap = true;
    }
  }
  // Outside the land gate: Forsaken Monument echoes any permanent's tap.
  if (!ability.noTap) {
    next = applyManaTapEchoes(next, playerId, cardId, addition);
  }
  if (ability.costSacrifice && costSacrificeId) {
    next = applyEffects(next, [{ kind: "sacrifice", cardId: costSacrificeId }]);
  }
  // Lion's Eye Diamond: the whole hand, so there is nothing to choose and
  // nothing to prompt for. Paid before the source is sacrificed only so the
  // log reads in cost order; neither can fail once we are here.
  if (ability.costDiscardHand) {
    for (const discarded of [
      ...(next.players.find((entry) => entry.id === playerId)?.zones.hand ?? []),
    ]) {
      next = moveCard(next, discarded, "graveyard");
      dispatchEventsInPlace(next, [{ kind: "discards", cardId: discarded, playerId }]);
    }
  }
  if (ability.sacrificeSelf) {
    next = applyEffects(next, [{ kind: "sacrifice", cardId }]);
  }
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
  if (ability.gainLifeToController && ability.gainLifeToController > 0) {
    next = applyEffects(next, [
      { kind: "gain_life", playerId, amount: ability.gainLifeToController },
    ]);
  }
  if (ability.poisonToController && ability.poisonToController > 0) {
    next = applyEffects(next, [
      { kind: "add_poison", playerId, amount: ability.poisonToController },
    ]);
  }
  return next;
}

/**
 * How many permanents this activation's sacrifice cost eats. Printed on the
 * card for the Dominus cycle, announced as X for Grim Hireling — read in one
 * place so the check that there is enough fodder and the payment that takes
 * it can never disagree about the number.
 */
function abilitySacrificeCount(
  ability: ActivatedAbility,
  xValue: number | undefined,
): number {
  if (ability.sacrificeCountFromX) {
    return Math.max(1, xValue ?? 1);
  }
  return ability.sacrificeCount ?? 1;
}

/**
 * The permanents that could pay the rest of a multi-victim sacrifice cost,
 * cheapest first. `except` is the one the activation already named, which is
 * still on the battlefield while the cost is being checked and gone by the
 * time it is being paid.
 */
function sacrificeFodderFor(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
  ability: ActivatedAbility,
  except?: CardInstanceId,
): CardInstanceId[] {
  return Object.values(state.cards)
    .filter(
      (entry) =>
        entry.zone === "battlefield" &&
        entry.controllerId === playerId &&
        entry.id !== cardId &&
        entry.id !== except &&
        sacrificeScopeMatches(state, entry.id, ability.sacrificeCost!, cardId) &&
        // "Sacrifice three Foods": the subtype is the whole filter, and
        // leaving it out here would auto-eat permanents the cost never
        // asked for.
        (ability.sacrificeSubtype === undefined ||
          cardMatchesSubtype(state, entry.id, ability.sacrificeSubtype)),
    )
    .sort((a, b) => creaturePower(state, a.id) - creaturePower(state, b.id))
    .map((entry) => entry.id);
}

function applyActivateAbility(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
  abilityIndex: number,
  targets: ChosenTarget[] | undefined,
  costSacrificeId: CardInstanceId | undefined,
  modeIndex: number | undefined,
  xValue: number | undefined,
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
  const ability = activatedOf(state, cardId)[abilityIndex];
  if (!ability) {
    throw new Error(`Unknown activated ability ${abilityIndex}`);
  }
  if (card.zone === "battlefield" && abilitiesRemoved(state, cardId)) {
    throw new Error(`Card ${cardId} has lost its abilities`);
  }
  // Grand Abolisher: battlefield artifact/creature/enchantment activations
  // are locked on the lock controller's turn (hand channels are not).
  if (card.zone === "battlefield" && lockedByAbolisher(state, playerId)) {
    const types = characteristicsOf(state, cardId).types;
    if (
      types.includes("artifact") ||
      types.includes("creature") ||
      types.includes("enchantment")
    ) {
      throw new Error("An opponent's permanent stops that activation this turn");
    }
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
  // Wishclaw Talisman: "only during your turn" is NOT sorcery timing — it may
  // be activated in combat, or with the stack full, as long as it is your
  // turn. Handing the artifact over at instant speed on somebody else's turn
  // is the whole reason the card is playable.
  if (ability.timing === "your_turn" && playerId !== state.turn.activePlayerId) {
    throw new Error("That ability can only be activated during your turn");
  }
  if (
    ability.requiresControlled &&
    !controlsMatching(state, playerId, ability.requiresControlled)
  ) {
    throw new Error("The activation condition is not met");
  }
  // Minas Tirith: gated on how many creatures attacked this turn.
  if (
    ability.requiresAttackersThisTurn !== undefined &&
    (state.players.find((player) => player.id === playerId)?.attackersThisTurn ?? 0) <
      ability.requiresAttackersThisTurn
  ) {
    throw new Error("The activation condition is not met");
  }
  if (
    ability.requiresCondition &&
    !triggerConditionHolds(state, playerId, ability.requiresCondition, undefined, cardId)
  ) {
    throw new Error("The activation condition is not met");
  }
  // Idol of Oblivion: gated on this turn's token creation.
  if (ability.requiresCreatedToken && !(state.createdTokenThisTurn ?? []).includes(playerId)) {
    throw new Error("Activate only if you created a token this turn");
  }
  // Weathered Wayfarer: gated on being behind on lands.
  if (ability.requiresOpponentMoreLands && !opponentControlsMoreLands(state, playerId)) {
    throw new Error("Activate only if an opponent controls more lands than you");
  }
  const levelUp = ability.effects.find((effect) => effect.kind === "set_class_level");
  if (levelUp?.kind === "set_class_level" && levelUp.level !== card.classLevel + 1) {
    throw new Error("Class levels must be gained in order");
  }
  if (ability.tap && card.tapped) {
    throw new Error(`Card ${cardId} is already tapped`);
  }
  if (ability.tap && !canActivateTapAbility(state, cardId)) {
    throw new Error(`Card ${cardId} has summoning sickness`);
  }
  // Split second stops every non-mana activation. The mana-tap path is a
  // separate entry point and is deliberately left alone.
  if (splitSecondActive(state)) {
    throw new Error("A spell with split second is on the stack");
  }
  const player = state.players.find((entry) => entry.id === playerId);
  if (!player) {
    throw new Error(`Unknown player ${playerId}`);
  }
  const cost = parseManaCost(ability.manaCost);
  // K'rrik says "in a COST", which is every cost its controller pays —
  // activations included, not only spells.
  applyPhyrexianColorGrants(state, playerId, cost);
  // {X} in an activation cost is announced the same way a spell's is.
  if (ability.xCost) {
    if (xValue === undefined || !Number.isInteger(xValue) || xValue < 0) {
      throw new Error("Announce a value for X");
    }
    cost.generic += xValue * ability.xCost;
  } else if (ability.sacrificeCountFromX) {
    // Grim Hireling: the {X} is in the sacrifice, not the mana cost, so X
    // is announced without adding a single generic pip. Zero is refused —
    // it would sacrifice nothing and pump nothing, and the sacrifice cost
    // has no way to name no victim.
    if (xValue === undefined || !Number.isInteger(xValue) || xValue < 1) {
      throw new Error("Announce a value for X");
    }
  } else if (xValue !== undefined) {
    throw new Error("That ability has no X in its cost");
  }
  if (ability.legendaryDiscount) {
    // Kamigawa channel lands: {1} less per legendary creature you control.
    const legends = Object.values(state.cards).filter(
      (entry) =>
        entry.zone === "battlefield" &&
        entry.controllerId === playerId &&
        isCreature(state, entry.id) &&
        isLegendary(state, entry.id),
    ).length;
    cost.generic = Math.max(0, cost.generic - legends);
  }
  // Puresteel Paladin: equip abilities cost {0} while a metalcraft granter
  // is live.
  if (
    ability.effects[0]?.kind === "attach" &&
    ability.effects[0].cardId === "self" &&
    freeEquipGranted(state, playerId)
  ) {
    Object.assign(cost, parseManaCost(""));
  }
  if (!canPayManaCost(player.mana, cost)) {
    throw new Error("Cannot pay mana cost");
  }
  const lifeDue = abilityLifeCost(state, playerId, ability);
  if (lifeDue > 0 && player.life < lifeDue) {
    throw new Error("Cannot pay that much life");
  }
  if (ability.sacrificeCost) {
    const sacrifice = costSacrificeId ? state.cards[costSacrificeId] : undefined;
    if (
      !costSacrificeId ||
      !sacrifice ||
      sacrifice.zone !== "battlefield" ||
      sacrifice.controllerId !== playerId ||
      !sacrificeScopeMatches(state, costSacrificeId, ability.sacrificeCost, cardId) ||
      // Scavenger Grounds: the land must be a Desert, not just a land.
      (ability.sacrificeSubtype !== undefined &&
        !cardMatchesSubtype(state, costSacrificeId, ability.sacrificeSubtype))
    ) {
      throw new Error(`Sacrifice a ${ability.sacrificeCost.replace(/_/g, " ")} to activate this`);
    }
    // The activation names one victim and the rest are auto-taken, so the
    // board has to actually hold them before any of the cost is paid.
    const due = abilitySacrificeCount(ability, xValue);
    if (due > 1 && sacrificeFodderFor(state, playerId, cardId, ability, costSacrificeId).length < due - 1) {
      throw new Error(`Sacrifice ${due} to activate this`);
    }
  } else if (costSacrificeId !== undefined) {
    throw new Error("That ability has no sacrifice cost");
  }
  // Counters, cards from hand, library and graveyard: costs that are neither
  // mana nor a permanent. Checked together so an ability with an unpayable
  // half never half-pays.
  const nonManaCost = activationNonManaPayment(state, playerId, cardId, ability);
  if (!nonManaCost) {
    throw new Error("Cannot pay that ability's cost");
  }
  let next = payManaCost(state, playerId, cost);
  if (lifeDue > 0) {
    const payer = next.players.find((entry) => entry.id === playerId)!;
    payer.life -= lifeDue;
    next.log.push({ kind: "life_change", playerId, delta: -lifeDue });
  }
  if (ability.removeCounterCost) {
    const source = next.cards[cardId]!;
    source.counters[ability.removeCounterCost.counter] =
      (source.counters[ability.removeCounterCost.counter] ?? 0) - ability.removeCounterCost.count;
  }
  if (ability.addCounterCost) {
    // A cost, not an effect: no doubling and no counter_added watchers.
    const source = next.cards[cardId]!;
    source.counters[ability.addCounterCost.counter] =
      (source.counters[ability.addCounterCost.counter] ?? 0) + ability.addCounterCost.count;
  }
  for (const discardId of nonManaCost.discardIds) {
    next = moveCard(next, discardId, "graveyard");
    dispatchEventsInPlace(next, [{ kind: "discards", cardId: discardId, playerId }]);
  }
  for (const exileId of nonManaCost.exileIds) {
    next = moveCard(next, exileId, "exile");
  }
  if (ability.millCost) {
    next = applyEffects(next, [{ kind: "mill", playerId, count: ability.millCost }]);
  }
  if (ability.tap) {
    next = tapCard(next, cardId);
    dispatchEventsInPlace(next, [{ kind: "tapped", cardId }]);
  }
  if (ability.discard) {
    next = moveCard(next, cardId, "graveyard");
    dispatchEventsInPlace(next, [{ kind: "discards", cardId, playerId }]);
  }
  if (ability.exileSelf) {
    // Spirit Guides: exiling from hand is the cost; resolve immediately.
    next = putActivatedAbilityOnStack(
      next,
      cardId,
      abilityIndex,
      targets ?? [],
      modeIndex,
      undefined,
      xValue,
    );
    next = moveCard(next, cardId, "exile");
    return resolveTopOfStack(next);
  }
  next = putActivatedAbilityOnStack(
    next,
    cardId,
    abilityIndex,
    targets ?? [],
    modeIndex,
    // Altar of Dementia: capture the fodder's power before it dies.
    ability.sacrificeCost && costSacrificeId
      ? Math.max(0, creaturePower(next, costSacrificeId))
      : undefined,
    xValue,
  );
  if (ability.sacrificeCost && costSacrificeId) {
    // Sacrificing is part of the cost (paid on activation); the ability
    // itself waits on the stack normally.
    next = applyEffects(next, [{ kind: "sacrifice", cardId: costSacrificeId }]);
    // The Dominus cycle asks for two or three, Grim Hireling for however
    // many X was announced as. The activation names one and the rest are
    // auto-taken, cheapest first — a documented approximation of a choice
    // the caller has no way to express.
    const extra = abilitySacrificeCount(ability, xValue) - 1;
    if (extra > 0) {
      for (const victim of sacrificeFodderFor(next, playerId, cardId, ability).slice(0, extra)) {
        next = applyEffects(next, [{ kind: "sacrifice", cardId: victim }]);
      }
    }
  }
  if (ability.sacrificeSelf) {
    // Sacrificing is part of the cost: it happens on activation, and the
    // ability resolves immediately (fetch lands do not sit in priority).
    next = applyEffects(next, [{ kind: "sacrifice", cardId }]);
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
 * Turn a manifested creature card face up by paying its mana cost
 * (CR 708.3). Non-creature cards cannot be turned face up this way.
 */
function applyTurnFaceUp(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
): GameState {
  requirePlaying(state);
  requirePriority(state, playerId);
  const card = state.cards[cardId];
  if (!card || card.controllerId !== playerId || card.zone !== "battlefield" || !card.faceDown) {
    throw new Error(`Card ${cardId} is not a face-down permanent you control`);
  }
  const definition = state.definitions[card.definitionId];
  if (!definition?.characteristics.types.includes("creature")) {
    throw new Error("Only a creature card can be turned face up");
  }
  const player = state.players.find((entry) => entry.id === playerId)!;
  const cost = parseManaCost(definition.manaCost);
  if (!canPayManaCost(player.mana, cost, player.life)) {
    throw new Error("Cannot pay mana cost");
  }
  let next = payManaCost(state, playerId, cost);
  next.cards[cardId]!.faceDown = false;
  next.priorityPlayerId = playerId;
  next.passesSinceAction = 0;
  return next;
}

/**
 * Activate a planeswalker loyalty ability: sorcery speed, once per walker
 * per turn, loyalty adjusts as a cost, and the ability uses the stack.
 */
function applyActivateLoyalty(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
  abilityIndex: number,
  targets: ChosenTarget[] | undefined,
): GameState {
  requirePlaying(state);
  requirePriority(state, playerId);
  const card = state.cards[cardId];
  if (!card || card.controllerId !== playerId || card.zone !== "battlefield") {
    throw new Error(`Card ${cardId} is not a battlefield permanent you control`);
  }
  const definition = state.definitions[card.definitionId];
  const ability = definition?.loyaltyAbilities?.[abilityIndex];
  if (!ability) {
    throw new Error(`Unknown loyalty ability ${abilityIndex}`);
  }
  if (abilitiesRemoved(state, cardId)) {
    throw new Error(`Card ${cardId} has lost its abilities`);
  }
  if (playerId !== state.turn.activePlayerId || !isMainPhase(state) || state.stack.length > 0) {
    throw new Error("Loyalty abilities are sorcery-speed");
  }
  if (card.loyaltyActivatedThisTurn) {
    throw new Error("That planeswalker already used a loyalty ability this turn");
  }
  const loyalty = card.counters["loyalty"] ?? 0;
  if (ability.cost < 0 && loyalty + ability.cost < 0) {
    throw new Error("Not enough loyalty");
  }
  validateChosenTargets(
    state,
    ability.targetRequirements,
    targets ?? [],
    playerId,
    definition?.characteristics.colors,
  );
  let next = cloneGameState(state);
  const walker = next.cards[cardId]!;
  walker.counters["loyalty"] = loyalty + ability.cost;
  if (walker.counters["loyalty"] === 0) {
    delete walker.counters["loyalty"];
    walker.counters["loyalty"] = 0;
  }
  walker.loyaltyActivatedThisTurn = true;
  next.stack.push({
    id: createId("stack"),
    controllerId: playerId,
    sourceId: cardId,
    kind: "ability",
    targets: (targets ?? []).map((target) => ({ ...target })),
    loyaltyIndex: abilityIndex,
  });
  next.passesSinceAction = 0;
  next.priorityPlayerId = playerId;
  return next;
}

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
          action.modeIndexes,
          action.xValue,
          action.division,
          action.costSacrificeId,
          action.costDiscardIds,
          action.spliceCardIds,
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
          action.costSacrificeId,
          action.costTapId,
        );
        break;
      case "activate_ability":
        next = applyActivateAbility(
          state,
          action.playerId,
          action.cardId,
          action.abilityIndex,
          action.targets,
          action.costSacrificeId,
          action.modeIndex,
          action.xValue,
        );
        break;
      case "turn_face_up":
        next = applyTurnFaceUp(state, action.playerId, action.cardId);
        break;
      case "activate_loyalty":
        next = applyActivateLoyalty(
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
      case "choose_discard_land_or_graveyard":
        return finalizeActionState(
          applyResolveDiscardLandOrGraveyard(state, action.playerId, action.discard),
        );
      case "choose_enter_replacement":
        next = applyChooseEnterReplacement(state, action.playerId, action.pay);
        break;
      case "resolve_creature_type":
        next = applyResolveCreatureType(state, action.playerId, action.creatureType);
        break;
      case "resolve_card_name":
        next = applyResolveCardName(state, action.playerId, action.cardName);
        break;
      case "resolve_divide_piles":
        next = applyResolveDividePiles(state, action.playerId, action.cardIds);
        break;
      case "resolve_choose_pile":
        next = applyResolveChoosePile(state, action.playerId, action.takeFirst);
        break;
      case "resolve_tempting_offer":
        next = applyResolveTemptingOffer(state, action.playerId, action.accept);
        break;
      case "resolve_tap_own_for_x":
        next = applyResolveTapOwnForX(state, action.playerId, action.cardIds);
        break;
      case "resolve_dredge":
        next = applyResolveDredge(state, action.playerId, action.cardId);
        break;
      case "resolve_punisher":
        next = applyResolvePunisher(state, action.playerId, action.take);
        break;
      case "resolve_exile_until_taken":
        next = applyResolveExileUntilTaken(state, action.playerId, action.take);
        break;
      case "resolve_color":
        next = applyResolveColor(state, action.playerId, action.color);
        break;
      case "resolve_enter_copy":
        next = applyResolveEnterCopy(state, action.playerId, action.cardId);
        break;
      case "resolve_trigger_mode":
        next = applyResolveTriggerMode(
          state,
          action.playerId,
          action.modeIndexes ?? action.modeIndex ?? [],
        );
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
      case "resolve_choose_from_hand": {
        const prompt = currentPrompt(state);
        const resume = prompt?.kind === "choose_from_hand" ? prompt.resumeEffects ?? [] : [];
        next = applyResolveChooseFromHand(state, action.playerId, action.cardIds);
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
          // Braids: the ABILITY's controller, not the chooser. "You draw a
          // card" while an opponent is choosing means the controller, and
          // binding against the chooser would hand them the card.
          controllerId: chosen.controllerId ?? action.playerId,
          sourceId: chosen.sourceId,
          ...(chosen.cardId ? { chosenCardId: chosen.cardId } : {}),
          // A declining opponent is "that player" for the punisher.
          ...(chosen.declined ? { subjectPlayerId: action.playerId } : {}),
          // Read BEFORE thenEffects runs, because the first of those
          // effects is usually the sacrifice itself — after it the card
          // is in the graveyard and its power is gone. Disciple of Bolas
          // pays out what the creature was worth, not what is left.
          sacrificedPower: chosen.cardId ? Math.max(0, creaturePower(next, chosen.cardId)) : 0,
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
        const resume =
          prompt?.kind === "pay_or_counter" || prompt?.kind === "pay_or_effect"
            ? prompt.resumeEffects ?? []
            : [];
        next = applyResolvePay(state, action.playerId, action.pay, action.taps ?? []);
        if (resume.length > 0 && !isPromptOpen(next)) {
          next = applyEffects(next, resume);
        } else if (resume.length > 0) {
          const open = currentPrompt(next);
          if (open && "resumeEffects" in open) {
            open.resumeEffects = [...(open.resumeEffects ?? []), ...resume];
          }
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
