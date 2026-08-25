import { characteristicsOf, isBasic, isCommander, isCreature, isLand, isLegendary, isMainPhase } from "./cardTypes";
import { abilitiesRemoved, cardMatchesSubtype, computedCard, controlsGate, dynamicCountOf } from "./characteristicsEngine";
import { canPayManaCost, type ParsedManaCost } from "./mana";
import { searchMatches } from "./prompt";
import { triggerConditionHolds } from "./triggers";
import type { ActivatedAbility, AlternativeCastCost, CardDefinition, CardInstance, CardInstanceId, Color, EnterTappedUnless, GameState, ManaPool, PlayerId } from "./types";

/**
 * CR 307.1: the window a sorcery may be cast in — your own main phase with
 * the stack empty. Lives here rather than in legalActions because the
 * discover/cascade path needs the same question answered, and two copies of
 * a rule this small is exactly how the two drift apart.
 */
/**
 * Terror of the Peaks: the life a spell must pay for the opponents'
 * permanents it TARGETS. Summed over the targets, because two taxing
 * permanents both charge and one spell may aim at both.
 *
 * A permanent whose abilities have been removed charges nothing — the tax
 * is a static ability like any other.
 */
export function targetingLifeTaxFor(
  state: GameState,
  casterId: PlayerId,
  targets: Array<{ type: string; cardId?: CardInstanceId }>,
): number {
  let total = 0;
  for (const target of targets) {
    if (!target.cardId) {
      continue;
    }
    const card = state.cards[target.cardId];
    if (!card || card.zone !== "battlefield" || card.controllerId === casterId) {
      continue;
    }
    if (abilitiesRemoved(state, card.id)) {
      continue;
    }
    total += state.definitions[card.definitionId]?.targetingLifeTax ?? 0;
  }
  return total;
}

/**
 * K'rrik: move every pip of a colour into the Phyrexian list, for a player
 * who controls a permanent granting it. The Phyrexian path already prefers
 * mana when it is available and pays life only when it is not, which is the
 * conservative reading of "you MAY pay 2 life" — documented, and the same
 * choice the engine already makes for a printed Phyrexian pip.
 */
export function applyPhyrexianColorGrants(
  state: GameState,
  playerId: PlayerId,
  cost: ParsedManaCost,
): void {
  for (const card of Object.values(state.cards)) {
    if (
      card.zone !== "battlefield" ||
      card.controllerId !== playerId ||
      abilitiesRemoved(state, card.id)
    ) {
      continue;
    }
    // `Color` excludes colourless already, so there is no {C} case to skip.
    const color = state.definitions[card.definitionId]?.payLifeForColor;
    if (!color) {
      continue;
    }
    const pips = cost[color];
    if (pips > 0) {
      cost[color] = 0;
      for (let index = 0; index < pips; index += 1) {
        cost.phyrexian.push(color);
      }
    }
  }
}

/**
 * Coven (CR 702.145): three or more creatures you control with DIFFERENT
 * powers. The distinctness is the whole gate — a headcount would turn it
 * on for three copies of the same creature, which is exactly what the
 * keyword exists to refuse.
 */
export function hasCoven(state: GameState, playerId: PlayerId): boolean {
  const powers = new Set<number>();
  for (const card of Object.values(state.cards)) {
    if (
      card.zone === "battlefield" &&
      card.controllerId === playerId &&
      isCreature(state, card.id)
    ) {
      powers.add(creaturePower(state, card.id));
    }
  }
  return powers.size >= 3;
}

export function inSorceryWindow(state: GameState, playerId: PlayerId): boolean {
  return (
    playerId === state.turn.activePlayerId && isMainPhase(state) && state.stack.length === 0
  );
}

/**
 * Every permanent a player controls, which is NOT the same as the battlefield
 * entries in their own zone list: zone lists are keyed by owner, and control
 * lives on the card. Reading a player's own list and filtering by controller
 * yields a subset — it drops anything they control but do not own — so once
 * control can change, that shape undercounts. Ordered by owner seat and then
 * battlefield position so callers stay deterministic.
 */
export function permanentsControlledBy(state: GameState, playerId: PlayerId): CardInstanceId[] {
  const controlled: CardInstanceId[] = [];
  for (const player of state.players) {
    for (const cardId of player.zones.battlefield) {
      const card = state.cards[cardId];
      // CR 702.26a: treated as though it did not exist, so it is not
      // counted, cannot be chosen, and does nothing.
      if (card?.controllerId === playerId && !card.phasedOut) {
        controlled.push(cardId);
      }
    }
  }
  return controlled;
}

/**
 * Convoke (CR 702.51), improvise (702.126) and delve (702.66): part of a
 * spell's cost may be paid with something other than mana — tapping creatures,
 * tapping artifacts, or exiling cards from your own graveyard.
 *
 * The cost is reduced only as far as it takes to make it payable from the mana
 * actually available, so nothing is tapped or exiled that the caster did not
 * need. That auto-policy replaces a choice the cast action has no field for,
 * and is a documented approximation — a caster who would rather tap a creature
 * than spend mana cannot say so.
 *
 * `cost` is mutated. Returns what to tap and exile, or null when the keyword
 * cannot close the gap (in which case `cost` is left as it was).
 */
export function costRelief(
  state: GameState,
  playerId: PlayerId,
  definition: CardDefinition | undefined,
  cost: ParsedManaCost,
  available: ManaPool,
  life: number,
  /** Harmonize: its convoke half applies only to the graveyard cast. */
  fromGraveyard?: boolean,
): { tapIds: CardInstanceId[]; exileIds: CardInstanceId[] } | null {
  const convoke =
    definition?.convoke === true ||
    (definition?.harmonizeConvoke === true && fromGraveyard === true) ||
    grantedCostKeyword(state, playerId, definition, "convoke");
  const improvise =
    definition?.improvise === true || grantedCostKeyword(state, playerId, definition, "improvise");
  const delve = definition?.delve === true;
  if (!convoke && !improvise && !delve) {
    return null;
  }
  const before = { ...cost, hybrid: [...cost.hybrid], phyrexian: [...cost.phyrexian] };
  const tapIds: CardInstanceId[] = [];
  const exileIds: CardInstanceId[] = [];

  const untapped = (kind: "creature" | "artifact"): CardInstanceId[] =>
    permanentsControlledBy(state, playerId).filter((cardId) => {
      const card = state.cards[cardId];
      if (!card || card.tapped || tapIds.includes(cardId)) {
        return false;
      }
      // A creature that has not been under your control since your turn began
      // may still be tapped for convoke — tapping is not a cost it pays.
      return characteristicsOf(state, cardId).types.includes(kind);
    });

  // Coloured pips first, and only with a creature of that colour: a creature
  // tapped for convoke pays one generic OR one mana of its own colour, so
  // spending a matching creature on a generic pip can strand a coloured one.
  if (convoke) {
    for (const color of ["W", "U", "B", "R", "G"] as const) {
      while (cost[color] > 0 && !canPayManaCost(available, cost, life)) {
        const match = untapped("creature").find((cardId) =>
          characteristicsOf(state, cardId).colors.includes(color),
        );
        if (!match) {
          break;
        }
        tapIds.push(match);
        cost[color] -= 1;
      }
    }
  }
  while (cost.generic > 0 && !canPayManaCost(available, cost, life)) {
    const tapped = convoke
      ? (untapped("creature")[0] ?? (improvise ? untapped("artifact")[0] : undefined))
      : improvise
        ? untapped("artifact")[0]
        : undefined;
    if (tapped) {
      tapIds.push(tapped);
      cost.generic -= 1;
      continue;
    }
    const player = state.players.find((entry) => entry.id === playerId);
    const card = delve
      ? (player?.zones.graveyard ?? []).find((cardId) => !exileIds.includes(cardId))
      : undefined;
    if (!card) {
      break;
    }
    exileIds.push(card);
    cost.generic -= 1;
  }

  if (!canPayManaCost(available, cost, life)) {
    Object.assign(cost, before);
    return null;
  }
  return { tapIds, exileIds };
}

/**
 * The most a cost keyword could cover, for legal-action enumeration — which
 * works from POTENTIAL mana rather than a real pool, so it asks the optimistic
 * question ("could this be paid?") and must not under-report. Returns a cost
 * copy with that much removed, or null when no keyword applies.
 */
export function reliefAdjustedCost(
  state: GameState,
  playerId: PlayerId,
  definition: CardDefinition | undefined,
  cost: ParsedManaCost,
  /** Harmonize: its convoke half applies only to the graveyard cast. */
  fromGraveyard?: boolean,
): ParsedManaCost | null {
  const convoke =
    definition?.convoke === true ||
    (definition?.harmonizeConvoke === true && fromGraveyard === true) ||
    grantedCostKeyword(state, playerId, definition, "convoke");
  const improvise =
    definition?.improvise === true || grantedCostKeyword(state, playerId, definition, "improvise");
  const delve = definition?.delve === true;
  if (!convoke && !improvise && !delve) {
    return null;
  }
  const untappedOf = (kind: "creature" | "artifact"): number =>
    permanentsControlledBy(state, playerId).filter(
      (cardId) =>
        state.cards[cardId]?.tapped === false &&
        characteristicsOf(state, cardId).types.includes(kind),
    ).length;
  let budget = 0;
  if (convoke) {
    budget += untappedOf("creature");
  }
  if (improvise) {
    budget += untappedOf("artifact");
  }
  if (delve) {
    budget += state.players.find((entry) => entry.id === playerId)?.zones.graveyard.length ?? 0;
  }
  const relieved: ParsedManaCost = {
    ...cost,
    hybrid: [...cost.hybrid],
    phyrexian: [...cost.phyrexian],
  };
  // Convoke can cover coloured pips; improvise and delve cannot.
  if (convoke) {
    for (const color of ["W", "U", "B", "R", "G"] as const) {
      const paid = Math.min(relieved[color], budget);
      relieved[color] -= paid;
      budget -= paid;
    }
  }
  const generic = Math.min(relieved.generic, budget);
  relieved.generic -= generic;
  return relieved;
}

/** Inspiring Statuary / Dazzling Theater: the keyword granted from elsewhere. */
function grantedCostKeyword(
  state: GameState,
  playerId: PlayerId,
  definition: CardDefinition | undefined,
  keyword: "convoke" | "improvise",
): boolean {
  if (!definition) {
    return false;
  }
  // Archway of Innovation grants it to the next spell rather than to a class
  // of spells, so it is read from the pending grant, not from a permanent.
  if (
    keyword === "improvise" &&
    (state.nextSpellGrants ?? []).some((grant) => grant.playerId === playerId && grant.improvise)
  ) {
    return true;
  }
  return permanentsControlledBy(state, playerId).some((cardId) => {
    const grant = state.definitions[state.cards[cardId]?.definitionId ?? ""]?.grantsCostKeyword;
    if (!grant || grant.keyword !== keyword || abilitiesRemoved(state, cardId)) {
      return false;
    }
    const types = definition.characteristics.types;
    if (grant.types && !grant.types.some((type) => types.includes(type))) {
      return false;
    }
    return !grant.nonTypes?.some((type) => types.includes(type));
  });
}

/**
 * CR 616: damage-modifying replacements, applied wherever damage is actually
 * applied — noncombat effects, sweeps, and combat. `targetPlayerId` is the
 * damaged player, or the controller of the damaged permanent.
 *
 * Documented approximation: multiplications apply before additions and
 * holders apply in timestamp order, where the rules let the affected player
 * choose the order. With one holder — the realistic table — the two agree.
 */
/**
 * Bloodletter of Aclazotz: life LOSS after replacements. Kept apart from
 * `damageAfterReplacements` because the printed effect replaces the loss, not
 * the damage — which is how it reaches a drain, a Phyrexian payment and a
 * combat strike alike with one rule.
 *
 * Called from both places a player's life goes down: the `lose_life` effect
 * and the combat-damage step, which decrements directly. A doubler honoured
 * in only one of them would be off by half the game.
 */
export function lifeLossAfterReplacements(
  state: GameState,
  playerId: PlayerId,
  amount: number,
): number {
  if (amount <= 0) {
    return amount;
  }
  let total = amount;
  for (const card of Object.values(state.cards)) {
    if (card.zone !== "battlefield" || abilitiesRemoved(state, card.id)) {
      continue;
    }
    const doubles = (state.definitions[card.definitionId]?.replacements ?? []).filter(
      (replacement) =>
        replacement.kind === "double_opponent_life_loss_on_your_turn" &&
        // "An OPPONENT": the holder's own life is untouched.
        card.controllerId !== playerId &&
        // "DURING YOUR TURN": the holder must be the active player.
        state.turn.activePlayerId === card.controllerId,
    ).length;
    total *= 2 ** doubles;
  }
  return total;
}

export function damageAfterReplacements(
  state: GameState,
  sourceId: CardInstanceId | null | undefined,
  targetPlayerId: PlayerId | undefined,
  amount: number,
  /** Solphim: combat damage is exempt. Only the combat step passes this. */
  isCombat = false,
): number {
  if (amount <= 0 || !sourceId) {
    return amount;
  }
  const source = state.cards[sourceId];
  if (!source) {
    return amount;
  }
  const holders = Object.values(state.cards)
    .filter((card) => {
      if (card.zone !== "battlefield" || abilitiesRemoved(state, card.id)) {
        return false;
      }
      const rule = state.definitions[card.definitionId]?.damageReplacement;
      if (!rule) {
        return false;
      }
      // "a source YOU control" — the holder's controller must control it.
      if (source.controllerId !== card.controllerId) {
        return false;
      }
      if (rule.opponentsOnly && (targetPlayerId === undefined || targetPlayerId === card.controllerId)) {
        return false;
      }
      if (rule.noncombatOnly && isCombat) {
        return false;
      }
      if (rule.sourceMustBeCreature && !isCreature(state, sourceId)) {
        return false;
      }
      const colors = characteristicsOf(state, sourceId).colors;
      return (rule.sourceColors ?? []).every((color) => colors.includes(color));
    })
    .sort((a, b) => a.timestamp - b.timestamp);

  let result = amount;
  for (const holder of holders) {
    const rule = state.definitions[holder.definitionId]!.damageReplacement!;
    result = result * (rule.times ?? 1) + (rule.plus ?? 0);
  }
  return result;
}

/**
 * Mana Reflection, Nyxbloom Ancient: "If you tap a permanent for mana, it
 * produces twice as much of that mana instead." Several holders multiply
 * together, which is what CR 616 gives regardless of the chosen order.
 */
export function manaTapMultiplier(state: GameState, playerId: PlayerId): number {
  let multiplier = 1;
  for (const card of Object.values(state.cards)) {
    if (card.zone !== "battlefield" || card.controllerId !== playerId) {
      continue;
    }
    if (abilitiesRemoved(state, card.id)) {
      continue;
    }
    multiplier *= state.definitions[card.definitionId]?.manaTapMultiplier ?? 1;
  }
  return multiplier;
}

/**
 * What paying an alternative cast cost would actually take, or null if it
 * cannot be paid. The cards are auto-picked cheapest-first — a documented
 * approximation of the caster's choice, tolerable because the alternative is
 * only ever reached when the printed cost was unpayable.
 */
export function altCastPayment(
  state: GameState,
  playerId: PlayerId,
  cost: AlternativeCastCost,
  spellId: CardInstanceId,
): { exileIds: CardInstanceId[]; sacrificeId?: CardInstanceId } | null {
  const player = state.players.find((entry) => entry.id === playerId);
  if (!player) {
    return null;
  }
  if (cost.requires && !controlsGate(state, playerId, cost.requires)) {
    return null;
  }
  // Force of Negation: "If it's NOT your turn." A free counterspell you
  // could also fire on your own turn is a different, better card, so the
  // gate is checked where the payment is offered rather than left to the
  // player's honesty.
  if (cost.onlyOnOpponentsTurn && state.turn.activePlayerId === playerId) {
    return null;
  }
  /**
   * Mindbreak Trap: "if an OPPONENT cast three or more spells this turn."
   * Any one opponent, off the per-player tally — a trap gated on the
   * table's combined total would go off far too often at four players.
   */
  if (cost.opponentSpellsThisTurn !== undefined) {
    const cast = state.spellsCastByPlayerThisTurn ?? {};
    const reached = state.players.some(
      (entry) =>
        entry.id !== playerId &&
        !entry.lost &&
        (cast[entry.id] ?? 0) >= cost.opponentSpellsThisTurn!,
    );
    if (!reached) {
      return null;
    }
  }
  // CR 118.4: a cost that would reduce life to zero or below cannot be paid.
  if (cost.life !== undefined && player.life <= cost.life) {
    return null;
  }
  const exileIds: CardInstanceId[] = [];
  if (cost.exileFromHand) {
    const candidates = player.zones.hand
      .filter((id) => id !== spellId)
      .filter((id) => {
        const colors = characteristicsOf(state, id).colors;
        return (cost.exileFromHand!.colors ?? []).every((color) => colors.includes(color));
      })
      .sort(
        (a, b) => characteristicsOf(state, a).manaValue - characteristicsOf(state, b).manaValue,
      );
    if (candidates.length < cost.exileFromHand.count) {
      return null;
    }
    exileIds.push(...candidates.slice(0, cost.exileFromHand.count));
  }
  let sacrificeId: CardInstanceId | undefined;
  if (cost.sacrificeCreature) {
    const rule = cost.sacrificeCreature;
    sacrificeId = Object.values(state.cards)
      .filter(
        (card) =>
          card.zone === "battlefield" &&
          card.controllerId === playerId &&
          isCreature(state, card.id) &&
          (!rule.nontoken || !card.isToken) &&
          (rule.colors ?? []).every((color) =>
            characteristicsOf(state, card.id).colors.includes(color),
          ),
      )
      .sort((a, b) => creaturePower(state, a.id) - creaturePower(state, b.id))[0]?.id;
    if (!sacrificeId) {
      return null;
    }
  }
  return { exileIds, ...(sacrificeId ? { sacrificeId } : {}) };
}

/**
 * The non-mana halves of an activation cost — counters off or on the source,
 * a discard, a mill, an exile from the graveyard — or null if any of them
 * cannot be paid. The cards are auto-picked cheapest-first, a documented
 * approximation of a choice the activation has no field to express.
 *
 * Shared by the activation path and legal-action enumeration so an ability
 * is never offered that the payment path would then refuse.
 */
export function activationNonManaPayment(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
  ability: ActivatedAbility,
): { discardIds: CardInstanceId[]; exileIds: CardInstanceId[] } | null {
  const player = state.players.find((entry) => entry.id === playerId);
  const source = state.cards[cardId];
  if (!player || !source) {
    return null;
  }
  if (ability.removeCounterCost) {
    const held = source.counters[ability.removeCounterCost.counter] ?? 0;
    if (held < ability.removeCounterCost.count) {
      return null;
    }
  }
  const byManaValue = (a: CardInstanceId, b: CardInstanceId): number =>
    characteristicsOf(state, a).manaValue - characteristicsOf(state, b).manaValue;
  const matchesTypes = (id: CardInstanceId, types?: string[]): boolean =>
    (types ?? []).every((type) => characteristicsOf(state, id).types.includes(type));

  const discardIds: CardInstanceId[] = [];
  if (ability.discardCost) {
    const candidates = player.zones.hand
      .filter((id) => id !== cardId && matchesTypes(id, ability.discardCost!.types))
      .sort(byManaValue);
    if (candidates.length < ability.discardCost.count) {
      return null;
    }
    discardIds.push(...candidates.slice(0, ability.discardCost.count));
  }
  const exileIds: CardInstanceId[] = [];
  if (ability.exileFromGraveyardCost) {
    const candidates = player.zones.graveyard
      .filter((id) => id !== cardId && matchesTypes(id, ability.exileFromGraveyardCost!.types))
      .sort(byManaValue);
    if (candidates.length < ability.exileFromGraveyardCost.count) {
      return null;
    }
    exileIds.push(...candidates.slice(0, ability.exileFromGraveyardCost.count));
  }
  if (ability.millCost && player.zones.library.length < ability.millCost) {
    return null;
  }
  return { discardIds, exileIds };
}

function plus1Plus1(state: GameState, cardId: CardInstanceId): number {
  return state.cards[cardId]?.counters["p1p1"] ?? 0;
}

/** Final power: the layer engine for battlefield objects, printed elsewhere. */
export function creaturePower(state: GameState, cardId: CardInstanceId): number {
  const card = state.cards[cardId];
  if (card?.zone === "battlefield") {
    return computedCard(state, cardId)?.power ?? 0;
  }
  const base = state.definitions[card?.definitionId ?? ""]?.power ?? 0;
  return Math.max(0, base + plus1Plus1(state, cardId));
}

export function creatureToughness(state: GameState, cardId: CardInstanceId): number {
  const card = state.cards[cardId];
  if (card?.zone === "battlefield") {
    return computedCard(state, cardId)?.toughness ?? 0;
  }
  const base = state.definitions[card?.definitionId ?? ""]?.toughness ?? 0;
  return Math.max(0, base + plus1Plus1(state, cardId));
}

/**
 * Narset: the lowest cap any opponent's permanent puts on this player's draws
 * this turn, or null for none. Counted against the per-turn tally, so the
 * first draw goes through and the rest do not.
 */
/**
 * The tightest per-turn noncreature-spell cap that applies to this player.
 *
 * It takes no player, because it binds every player equally — `drawCapFor`
 * skips the controller because its card says opponents, and this one says
 * each player. Making that visible in the signature is the point.
 */
/**
 * Platinum Angel: does this player control something that vetoes losing?
 *
 * Read on the battlefield and through `abilitiesRemoved`, so a Humility'd
 * Angel stops working — which is the usual way this card is answered.
 */
/**
 * The tightest cap on how many creatures may attack this player in one
 * combat, or null for no cap. Read off the DEFENDING player's own
 * permanents, because the printed text says "attack you".
 */
/**
 * How many attackers one creature may block this combat. One by default
 * (CR 509.1a), plus whatever its controller's permanents grant.
 *
 * Additive rather than a maximum: two Brave the Sands should let a
 * creature block three attackers, which a `Math.min` reading of the same
 * field would silently refuse.
 */
export function blockAllowanceFor(state: GameState, blockerId: string): number {
  const blocker = state.cards[blockerId];
  if (!blocker) {
    return 1;
  }
  let extra = 0;
  for (const card of Object.values(state.cards)) {
    if (
      card.zone !== "battlefield" ||
      card.controllerId !== blocker.controllerId ||
      abilitiesRemoved(state, card.id)
    ) {
      continue;
    }
    extra += state.definitions[card.definitionId]?.extraBlocksGranted ?? 0;
  }
  return 1 + extra;
}

export function attackLimitFor(state: GameState, playerId: string): number | null {
  let cap: number | null = null;
  for (const card of Object.values(state.cards)) {
    if (
      card.zone !== "battlefield" ||
      card.controllerId !== playerId ||
      abilitiesRemoved(state, card.id)
    ) {
      continue;
    }
    const limit = state.definitions[card.definitionId]?.attackLimitPerCombat;
    if (limit !== undefined && (cap === null || limit < cap)) {
      cap = limit;
    }
  }
  return cap;
}

/**
 * Shalai: does this player have hexproof? Read through `abilitiesRemoved`,
 * so a silenced Shalai stops protecting.
 */
/**
 * Does retrace reach this card in this player's graveyard? Printed on the
 * card, or granted by a permanent they control (Six, Deeproot Historian).
 *
 * Shared with the cast path rather than written twice: an offer the cast
 * refuses, or a cast the offer never makes, is exactly how the two drift.
 */
export function retraceReaches(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
): boolean {
  const definition = state.definitions[state.cards[cardId]?.definitionId ?? ""];
  if (!definition) {
    return false;
  }
  if (definition.retrace === true) {
    return true;
  }
  for (const permanent of Object.values(state.cards)) {
    if (permanent.zone !== "battlefield" || permanent.controllerId !== playerId) {
      continue;
    }
    const grant = state.definitions[permanent.definitionId]?.grantsRetrace;
    if (!grant) {
      continue;
    }
    if (grant.onlyYourTurn && state.turn.activePlayerId !== playerId) {
      continue;
    }
    if (searchMatches(state, cardId, grant.filter)) {
      return true;
    }
  }
  return false;
}

/**
 * The cards in this player's graveyard that could replace a draw right now
 * (CR 702.52a): they have dredge, and the library holds at least that many
 * cards to mill.
 *
 * A library too short for the DRAW does not matter — replacing a draw that
 * would deck you is the whole reason the keyword exists.
 */
export function dredgeableCardIds(state: GameState, playerId: PlayerId): CardInstanceId[] {
  const player = state.players.find((entry) => entry.id === playerId);
  if (!player) {
    return [];
  }
  return player.zones.graveyard.filter((cardId) => {
    const dredge = state.definitions[state.cards[cardId]?.definitionId ?? ""]?.dredge;
    return dredge !== undefined && dredge > 0 && player.zones.library.length >= dredge;
  });
}

export function playerHasHexproof(state: GameState, playerId: string): boolean {
  return Object.values(state.cards).some(
    (card) =>
      card.zone === "battlefield" &&
      card.controllerId === playerId &&
      !abilitiesRemoved(state, card.id) &&
      state.definitions[card.definitionId]?.controllerHexproof === true,
  );
}

/**
 * Protection from everything, read on a PLAYER (Teferi's Protection, The
 * One Ring). Unlike hexproof this stops the holder's own spells too:
 * CR 702.16e makes no exception for the protected object's controller,
 * and Teferi's Protection is famous for locking you out of your own
 * targeted effects for the turn.
 */
/**
 * Veil of Summer, read on a PLAYER. Like hexproof on a permanent it stops
 * opponents only, so the caller checks the caster; unlike protection it
 * stops targeting and nothing else.
 */
export function playerHexproofFromColors(state: GameState, playerId: string): Color[] {
  const colors: Color[] = [];
  for (const shield of state.playerShields ?? []) {
    if (shield.playerId !== playerId) {
      continue;
    }
    for (const color of shield.hexproofFromColors ?? []) {
      if (!colors.includes(color)) {
        colors.push(color);
      }
    }
  }
  return colors;
}

export function playerProtectedFromEverything(
  state: GameState,
  playerId: string,
): boolean {
  return (state.playerShields ?? []).some(
    (shield) => shield.playerId === playerId && shield.protectionFromEverything === true,
  );
}

/** Teferi's Protection: "your life total can't change" — gains as well */
/** as losses, so a lifelink swing gives its controller nothing either. */
export function playerLifeLocked(state: GameState, playerId: string): boolean {
  return (state.playerShields ?? []).some(
    (shield) => shield.playerId === playerId && shield.lifeLocked === true,
  );
}

export function cantLoseGame(state: GameState, playerId: string): boolean {
  return Object.values(state.cards).some(
    (card) =>
      card.zone === "battlefield" &&
      card.controllerId === playerId &&
      !abilitiesRemoved(state, card.id) &&
      state.definitions[card.definitionId]?.cantLoseGame === true,
  );
}

/**
 * Intruder Alarm: creatures do not untap in any untap step while one is on
 * the battlefield. Global rather than per-player — the lock is symmetric,
 * and reading it off the untapping player would let the Alarm's own
 * controller untap freely, which is the opposite of the card.
 *
 * `abilitiesRemoved` still applies: a Humility'd Alarm locks nothing.
 */
export function creaturesDontUntap(state: GameState): boolean {
  return Object.values(state.cards).some(
    (card) =>
      card.zone === "battlefield" &&
      !abilitiesRemoved(state, card.id) &&
      state.definitions[card.definitionId]?.creaturesDontUntap === true,
  );
}

export function noncreatureSpellCap(state: GameState): number | null {
  let cap: number | null = null;
  for (const card of Object.values(state.cards)) {
    if (card.zone !== "battlefield" || abilitiesRemoved(state, card.id)) {
      continue;
    }
    const limit = state.definitions[card.definitionId]?.noncreatureSpellCap;
    if (limit !== undefined && (cap === null || limit < cap)) {
      cap = limit;
    }
  }
  return cap;
}

export function drawCapFor(state: GameState, playerId: string): number | null {
  let cap: number | null = null;
  for (const card of Object.values(state.cards)) {
    if (card.zone !== "battlefield" || card.controllerId === playerId) {
      continue;
    }
    if (abilitiesRemoved(state, card.id)) {
      continue;
    }
    const limit = state.definitions[card.definitionId]?.opponentsDrawCap;
    if (limit !== undefined && (cap === null || limit < cap)) {
      cap = limit;
    }
  }
  return cap;
}

export function wouldSkipDraw(state: GameState, playerId: string): boolean {
  const cap = drawCapFor(state, playerId);
  if (cap !== null && (state.drawsByPlayerThisTurn?.[playerId] ?? 0) >= cap) {
    return true;
  }
  return Object.values(state.cards).some((card) => {
    if (card.zone !== "battlefield" || card.controllerId !== playerId) {
      return false;
    }
    if (abilitiesRemoved(state, card.id)) {
      return false;
    }
    return (state.definitions[card.definitionId]?.replacements ?? []).some(
      (replacement) => replacement.kind === "replace_draw" && replacement.instead === "skip",
    );
  });
}

/**
 * CR 402.2: 7, unless a permanent removes the maximum (null) or changes it.
 *
 * A removed maximum wins over any numeric change: "no maximum hand size"
 * and "reduced by seven" together is still no maximum, because there is
 * nothing left to reduce. Numeric effects apply in set-then-reduce order
 * and floor at zero — a hand size cannot go negative, and Jin-Gitaxias
 * against the default seven is exactly zero.
 */
export function maxHandSizeOf(state: GameState, playerId: string): number | null {
  // Sea Gate Restoration: a grant with no permanent behind it, so it is read
  // off the game rather than off the battlefield.
  let unlimited = (state.noMaxHandSizePlayers ?? []).includes(playerId);
  const effects: NonNullable<CardDefinition["handSizeEffect"]>[] = [];
  for (const card of Object.values(state.cards)) {
    if (card.zone !== "battlefield" || abilitiesRemoved(state, card.id)) {
      continue;
    }
    const definition = state.definitions[card.definitionId];
    if (!definition) {
      continue;
    }
    if (card.controllerId === playerId && definition.noMaxHandSize === true) {
      unlimited = true;
    }
    const effect = definition.handSizeEffect;
    if (!effect) {
      continue;
    }
    // "Each OPPONENT's maximum hand size" is read from the other side of
    // the table: the card's controller is not who it affects.
    const affected =
      effect.scope === "controller"
        ? card.controllerId === playerId
        : card.controllerId !== playerId;
    if (affected) {
      effects.push(effect);
    }
  }
  if (unlimited) {
    return null;
  }
  let size = 7;
  for (const effect of effects.filter((entry) => entry.mode === "set")) {
    size = effect.amount;
  }
  for (const effect of effects.filter((entry) => entry.mode === "reduce")) {
    size -= effect.amount;
  }
  return Math.max(0, size);
}

/**
 * CR 601.2f: total generic discount the player's permanents give a spell
 * with these printed characteristics (medallions, Foundry Inspector).
 */
export function castCostReduction(
  state: GameState,
  playerId: string,
  spell: {
    characteristics: { types: string[]; subtypes?: string[]; colors: string[] };
    changeling?: boolean;
    power?: number | null;
  },
): number {
  let total = 0;
  for (const card of Object.values(state.cards)) {
    if (card.zone !== "battlefield") {
      continue;
    }
    if (abilitiesRemoved(state, card.id)) {
      continue;
    }
    for (const reduction of state.definitions[card.definitionId]?.costReductions ?? []) {
      // Whose spells this touches. Unscoped means the holder's own, which is
      // what every discount written before taxes existed meant.
      const scope = reduction.scope ?? "you";
      const own = card.controllerId === playerId;
      if ((scope === "you" && !own) || (scope === "opponents" && own)) {
        continue;
      }
      // Defense Grid: the tax lifts on the holder's own turn.
      if (reduction.notDuringControllersTurn && state.turn.activePlayerId === card.controllerId) {
        continue;
      }
      // Bolt Bend: the discount only applies while its condition holds.
      if (
        reduction.condition &&
        !triggerConditionHolds(state, card.controllerId, reduction.condition, undefined, card.id)
      ) {
        continue;
      }
      const { types, typesAny, subtypesAny, colors, chosenSubtype, chosenCardType } =
        reduction.filter;
      if (types && !types.every((type) => spell.characteristics.types.includes(type))) {
        continue;
      }
      // Urza's Incubator / Herald's Horn: the discount reads the source's
      // as-enters chosen creature type.
      if (chosenSubtype) {
        const chosen = card.chosenCreatureType;
        if (
          !chosen ||
          (!spell.changeling && !(spell.characteristics.subtypes ?? []).includes(chosen))
        ) {
          continue;
        }
      }
      // Cloud Key: the spell must have the source's auto-picked card type.
      if (chosenCardType) {
        const chosen = card.chosenCardType;
        if (!chosen || !spell.characteristics.types.includes(chosen)) {
          continue;
        }
      }
      // Goreclaw: printed power floor on the discounted spell.
      if (reduction.filter.minPower !== undefined && (spell.power ?? 0) < reduction.filter.minPower) {
        continue;
      }
      if (typesAny && !typesAny.some((type) => spell.characteristics.types.includes(type))) {
        continue;
      }
      if (
        subtypesAny &&
        !spell.changeling &&
        !subtypesAny.some((subtype) => (spell.characteristics.subtypes ?? []).includes(subtype))
      ) {
        continue;
      }
      if (colors && !colors.some((color) => spell.characteristics.colors.includes(color))) {
        continue;
      }
      total += reduction.generic;
    }
  }
  return total;
}

/** "You may play lands from your graveyard" (Crucible of Worlds). */
export function canPlayLandsFromGraveyard(state: GameState, playerId: string): boolean {
  return Object.values(state.cards).some((card) => {
    if (card.zone !== "battlefield" || card.controllerId !== playerId) {
      return false;
    }
    if (abilitiesRemoved(state, card.id)) {
      return false;
    }
    return state.definitions[card.definitionId]?.playLandsFromGraveyard === true;
  });
}

/**
 * Merged top-of-library permissions from the player's battlefield permanents
 * (Oracle of Mul Daya, Elven Chorus). Null when nothing grants any.
 */
export function topOfLibraryGrant(
  state: GameState,
  playerId: string,
): {
  look: boolean;
  playLands: boolean;
  castAll: boolean;
  castColorless: boolean;
  castTypesAny: string[];
  castSubtypesAny: string[];
  payLifeInsteadOfMana: boolean;
} | null {
  let look = false;
  let playLands = false;
  let castAll = false;
  let castColorless = false;
  let payLifeInsteadOfMana = false;
  const castTypes = new Set<string>();
  const castSubtypes = new Set<string>();
  for (const card of Object.values(state.cards)) {
    if (card.zone !== "battlefield" || card.controllerId !== playerId) {
      continue;
    }
    // Cheap grant check before abilitiesRemoved (a layer pass) — this runs
    // inside every legalActions call.
    const grant = state.definitions[card.definitionId]?.topOfLibrary;
    if (!grant) {
      continue;
    }
    if (abilitiesRemoved(state, card.id)) {
      continue;
    }
    // Augur of Autumn: only the CAST half waits on coven. Its look and its
    // land drop are separate abilities printed without the gate, so darken
    // the casting and leave the rest of this record alone.
    const mayCast = grant.castRequiresCoven !== true || hasCoven(state, playerId);
    look = look || grant.look === true;
    playLands = playLands || grant.playLands === true;
    castAll = castAll || (mayCast && grant.castAll === true);
    castColorless = castColorless || (mayCast && grant.castColorless === true);
    payLifeInsteadOfMana =
      payLifeInsteadOfMana || grant.payLifeInsteadOfMana === true;
    if (mayCast) {
      for (const type of grant.castTypesAny ?? []) {
        castTypes.add(type);
      }
    }
    // Realmwalker: "creature spells of the chosen type", read live from the
    // granting card's own chosen creature type.
    if (mayCast && grant.castChosenType && card.chosenCreatureType) {
      castSubtypes.add(card.chosenCreatureType);
    }
  }
  if (!look && !playLands && !castAll && !castColorless && castTypes.size === 0 && castSubtypes.size === 0) {
    return null;
  }
  return {
    look,
    playLands,
    castAll,
    castColorless,
    payLifeInsteadOfMana,
    castTypesAny: [...castTypes],
    castSubtypesAny: [...castSubtypes],
  };
}

/** May this exact card be cast right now from the top of its owner's library? */
export function castableFromTop(state: GameState, playerId: string, cardId: string): boolean {
  const player = state.players.find((entry) => entry.id === playerId);
  if (!player || player.zones.library[0] !== cardId) {
    return false;
  }
  const card = state.cards[cardId];
  const definition = card ? state.definitions[card.definitionId] : undefined;
  if (!definition || definition.characteristics.types.includes("land")) {
    return false;
  }
  const grant = topOfLibraryGrant(state, playerId);
  if (!grant) {
    return false;
  }
  return (
    grant.castAll ||
    grant.castTypesAny.some((type) => definition.characteristics.types.includes(type)) ||
    // Mystic Forge's colorless half: no colors among the printed characteristics.
    (grant.castColorless && definition.characteristics.colors.length === 0) ||
    // Realmwalker: creature spells of the granting card's chosen type
    // (changelings count via cardMatchesSubtype).
    (grant.castSubtypesAny.length > 0 &&
      definition.characteristics.types.includes("creature") &&
      grant.castSubtypesAny.some((subtype) => cardMatchesSubtype(state, cardId, subtype)))
  );
}

/** May this exact card be played as a land from the top of its owner's library? */
export function canPlayLandFromTop(state: GameState, playerId: string, cardId: string): boolean {
  const player = state.players.find((entry) => entry.id === playerId);
  if (!player || player.zones.library[0] !== cardId) {
    return false;
  }
  return topOfLibraryGrant(state, playerId)?.playLands === true;
}

/**
 * Vedalken Orrery-class: the player may cast a spell at instant speed.
 * `cardId` is the spell being cast — a grant restricted to some spells
 * (Sigarda's Aid, Shimmer Myr) only answers for one it covers, so a caller
 * that does not name a card gets the unrestricted grants only.
 */
/**
 * Split second (CR 702.61): a spell with it is on the stack, so nothing but
 * a mana ability may be cast or activated.
 *
 * Read off the stack rather than latched on the game, because the lock ends
 * the moment the spell leaves — countered, resolved or otherwise — and a
 * flag would have to be cleared at every one of those exits.
 */
export function splitSecondActive(state: GameState): boolean {
  return state.stack.some((object) => {
    if (object.kind !== "spell" || !object.sourceId) {
      return false;
    }
    const card = state.cards[object.sourceId];
    return card ? state.definitions[card.definitionId]?.splitSecond === true : false;
  });
}

/**
 * May this permanent's TAP abilities be activated right now, summoning
 * sickness and all? Haste answers yes; so does Thousand-Year Elixir, which
 * grants the permission for ABILITIES only — a sick creature under it still
 * cannot attack.
 *
 * One helper because the question is asked in four places (the activation
 * validator, the mana-tap validator, and the two legal-action enumerators),
 * and a grant honoured in three of them would offer an ability the payment
 * path then refuses.
 */
export function canActivateTapAbility(state: GameState, cardId: string): boolean {
  const card = state.cards[cardId];
  if (!card) {
    return false;
  }
  if (
    !isCreature(state, cardId) ||
    !card.summoningSick ||
    (computedCard(state, cardId)?.keywords ?? []).includes("haste")
  ) {
    return true;
  }
  return Object.values(state.cards).some(
    (source) =>
      source.zone === "battlefield" &&
      source.controllerId === card.controllerId &&
      state.definitions[source.definitionId]?.abilityHaste === true &&
      !abilitiesRemoved(state, source.id),
  );
}

export function hasFlashGrant(state: GameState, playerId: string, cardId?: string): boolean {
  // Emergence Zone-class one-shot grants last only for this turn.
  if ((state.flashThisTurn ?? []).includes(playerId)) {
    return true;
  }
  return Object.values(state.cards).some((card) => {
    if (card.zone !== "battlefield" || card.controllerId !== playerId) {
      return false;
    }
    const definition = state.definitions[card.definitionId];
    if (!definition || abilitiesRemoved(state, card.id)) {
      return false;
    }
    if (definition.grantsFlash === true) {
      return true;
    }
    const scope = definition.grantsFlashFor;
    if (!scope || !cardId) {
      return false;
    }
    const traits = characteristicsOf(state, cardId);
    if (scope.types && !scope.types.every((type) => traits.types.includes(type))) {
      return false;
    }
    // "Noncreature spells": a type the spell must NOT have.
    if (scope.nonTypes?.some((type) => traits.types.includes(type))) {
      return false;
    }
    if (
      scope.subtypesAny &&
      !scope.subtypesAny.some((subtype) => cardMatchesSubtype(state, cardId, subtype))
    ) {
      return false;
    }
    return true;
  });
}

/** Affinity for artifacts: one generic less per artifact the caster controls. */
/** Weathered Wayfarer / Land Tax: is any opponent ahead on lands? */
export function opponentControlsMoreLands(state: GameState, playerId: string): boolean {
  const landCount = (owner: string): number =>
    Object.values(state.cards).filter(
      (card) =>
        card.zone === "battlefield" &&
        card.controllerId === owner &&
        characteristicsOf(state, card.id).types.includes("land"),
    ).length;
  const mine = landCount(playerId);
  return state.players.some(
    (player) => player.id !== playerId && !player.lost && landCount(player.id) > mine,
  );
}

/** "This spell costs {X} less to cast, where X is …" (the self-discount
 * artifacts and Henges). Historic = artifact, legendary, or Saga (CR 700.4a). */
/** Drannith Magistrate: an opponent's live lock limits casts to the hand. */
export function opponentsCastLockedToHand(state: GameState, playerId: string): boolean {
  return Object.values(state.cards).some(
    (card) =>
      card.zone === "battlefield" &&
      card.controllerId !== playerId &&
      state.definitions[card.definitionId]?.opponentsCastOnlyFromHand === true &&
      !abilitiesRemoved(state, card.id),
  );
}

/** Puresteel Paladin: any live granter makes controlled equips free. */
export function freeEquipGranted(state: GameState, playerId: string): boolean {
  return Object.values(state.cards).some((card) => {
    if (card.zone !== "battlefield" || card.controllerId !== playerId) {
      return false;
    }
    const need = state.definitions[card.definitionId]?.freeEquipIfArtifacts;
    if (!need || abilitiesRemoved(state, card.id)) {
      return false;
    }
    const artifacts = Object.values(state.cards).filter(
      (entry) =>
        entry.zone === "battlefield" &&
        entry.controllerId === playerId &&
        characteristicsOf(state, entry.id).types.includes("artifact"),
    ).length;
    return artifacts >= need;
  });
}

export function selfDiscountAmount(
  state: GameState,
  playerId: string,
  discount: NonNullable<CardDefinition["selfDiscount"]>,
): number {
  // Embercleave: the discount is a plain multiple of a counted noun, so it
  // shares the table rather than earning its own aggregate.
  if (discount.perDynamicCount) {
    return (
      discount.perDynamicCount.generic *
      dynamicCountOf(state, playerId, discount.perDynamicCount.count)
    );
  }
  const per = discount.per;
  if (per === undefined) {
    return 0;
  }
  // Bolt Bend: {3} less while an opponent has a spell or ability on the
  // stack — a documented proxy for "if it targets one".
  if (per === "opponent_stack_3") {
    return state.stack.some((entry) => entry.controllerId !== playerId) ? 3 : 0;
  }
  let total = 0;
  let greatest = 0;
  for (const card of Object.values(state.cards)) {
    if (card.zone !== "battlefield" || card.controllerId !== playerId) {
      continue;
    }
    const traits = characteristicsOf(state, card.id);
    if (per === "greatest_creature_power" || per === "total_creature_power") {
      if (traits.types.includes("creature")) {
        // Ghalta sums; The Great Henge takes the maximum.
        const power = creaturePower(state, card.id);
        if (per === "total_creature_power") {
          total += power;
        } else {
          greatest = Math.max(greatest, power);
        }
      }
      continue;
    }
    if (per === "noncreature_artifacts_total_mv") {
      if (traits.types.includes("artifact") && !traits.types.includes("creature")) {
        total += traits.manaValue;
      }
      continue;
    }
    const historic =
      traits.types.includes("artifact") ||
      traits.supertypes.includes("legendary") ||
      traits.subtypes.includes("saga");
    if (historic) {
      total += traits.manaValue;
    }
  }
  return per === "greatest_creature_power" ? greatest : total;
}

export function affinityArtifactDiscount(state: GameState, playerId: string): number {
  let count = 0;
  for (const card of Object.values(state.cards)) {
    if (
      card.zone === "battlefield" &&
      card.controllerId === playerId &&
      characteristicsOf(state, card.id).types.includes("artifact")
    ) {
      count += 1;
    }
  }
  return count;
}

/** "for each creature on the battlefield" — anyone's (Ghoulcaller's-class). */
export function allBattlefieldCreatureCount(state: GameState): number {
  let count = 0;
  for (const card of Object.values(state.cards)) {
    if (card.zone === "battlefield" && isCreature(state, card.id)) {
      count += 1;
    }
  }
  return count;
}

/** "If you control a commander" (the free-spell cycle): any commander on the
 * battlefield under this player's control, their own or a stolen one. */
/** Grand Abolisher: the active player controls a lock and it isn't you. */
export function lockedByAbolisher(state: GameState, playerId: string): boolean {
  const activeId = state.turn.activePlayerId;
  if (activeId === playerId) {
    return false;
  }
  return Object.values(state.cards).some(
    (card) =>
      card.zone === "battlefield" &&
      card.controllerId === activeId &&
      state.definitions[card.definitionId]?.opponentsLockedDuringYourTurn === true &&
      !abilitiesRemoved(state, card.id),
  );
}

/** Casting lock: the Abolisher lock, or a cast-only "opponents can't cast
 * spells during your turn" (Voice of Victory, Kutzil). */
export function lockedFromCasting(state: GameState, playerId: string): boolean {
  if (lockedByAbolisher(state, playerId)) {
    return true;
  }
  const activeId = state.turn.activePlayerId;
  if (activeId === playerId) {
    return false;
  }
  return Object.values(state.cards).some(
    (card) =>
      card.zone === "battlefield" &&
      card.controllerId === activeId &&
      state.definitions[card.definitionId]?.opponentsCantCastDuringYourTurn === true &&
      !abilitiesRemoved(state, card.id),
  );
}

export function controlsCommander(state: GameState, playerId: string): boolean {
  return Object.values(state.cards).some(
    (card) =>
      card.zone === "battlefield" &&
      card.controllerId === playerId &&
      isCommander(state, card.id),
  );
}

/** CR 305.2: one land drop plus any extras granted by permanents (Exploration). */
export function landDropAllowance(state: GameState, playerId: string): number {
  let extra = 0;
  for (const card of Object.values(state.cards)) {
    if (card.zone !== "battlefield" || card.controllerId !== playerId) {
      continue;
    }
    if (abilitiesRemoved(state, card.id)) {
      continue;
    }
    extra += state.definitions[card.definitionId]?.extraLandDrops ?? 0;
  }
  // Rites of Flourishing: a grant that reaches every player, so it is counted
  // from the whole battlefield rather than only this player's side of it.
  for (const card of Object.values(state.cards)) {
    if (card.zone !== "battlefield" || abilitiesRemoved(state, card.id)) {
      continue;
    }
    extra += state.definitions[card.definitionId]?.extraLandDropsForAll ?? 0;
  }
  // Explore: one-shot grants for this turn only.
  const player = state.players.find((entry) => entry.id === playerId);
  return 1 + extra + (player?.extraLandDropsThisTurn ?? 0);
}

function controlledBattlefield(state: GameState, controllerId: string): CardInstance[] {
  return Object.values(state.cards).filter(
    (card) => card.zone === "battlefield" && card.controllerId === controllerId,
  );
}

function unlessSatisfied(
  state: GameState,
  card: CardInstance,
  unless: EnterTappedUnless,
): boolean {
  const controlled = controlledBattlefield(state, card.controllerId);
  if (unless.kind === "other_lands") {
    const others = controlled.filter((entry) => entry.id !== card.id && isLand(state, entry.id));
    return others.length >= unless.count;
  }
  if (unless.kind === "other_lands_at_most") {
    const others = controlled.filter((entry) => entry.id !== card.id && isLand(state, entry.id));
    return others.length <= unless.count;
  }
  if (unless.kind === "opponents") {
    const opponents = state.players.filter(
      (player) => player.id !== card.controllerId && !player.lost,
    );
    return opponents.length >= unless.count;
  }
  if (unless.kind === "legendary_creature") {
    return controlled.some((entry) => isLegendary(state, entry.id) && isCreature(state, entry.id));
  }
  if (unless.kind === "basic_lands") {
    const basics = controlled.filter(
      (entry) => isLand(state, entry.id) && isBasic(state, entry.id),
    );
    return basics.length >= unless.count;
  }
  if (unless.kind === "controlled_subtype") {
    const matching = controlled.filter(
      (entry) =>
        !(unless.excludeSelf && entry.id === card.id) &&
        characteristicsOf(state, entry.id).subtypes.includes(unless.subtype),
    );
    return matching.length >= unless.count;
  }
  if (unless.kind === "turn_at_most") {
    // Starting Town: "your first, second, or third turn of the game". The
    // round counter advances once per seat cycle, so round N is every
    // player's Nth turn and the two agree without a per-player tally.
    return state.turn.number <= unless.count;
  }
  if (unless.kind === "hand_reveals_types") {
    // Documented approximation: the reveal "may" is auto-taken — any matching
    // card in hand means the land enters untapped.
    const player = state.players.find((entry) => entry.id === card.controllerId);
    return (player?.zones.hand ?? []).some((id) => {
      const printed = characteristicsOf(state, id);
      return unless.types.some(
        (type) => printed.subtypes.includes(type) || printed.types.includes(type),
      );
    });
  }
  return controlled.some((entry) => {
    const printed = characteristicsOf(state, entry.id);
    return unless.types.some(
      (type) => printed.subtypes.includes(type) || printed.types.includes(type),
    );
  });
}

/** Self-replacement: the permanent enters the battlefield tapped (CR 614.12). */
export function wouldEnterTapped(state: GameState, cardId: CardInstanceId): boolean {
  const card = state.cards[cardId];
  if (!card) {
    return false;
  }
  // Authority of the Consuls / Blind Obedience: an opponent's static taps
  // arriving creatures (and artifacts, when the flag says so).
  const arrivingTypes = characteristicsOf(state, cardId).types;
  if (
    Object.values(state.cards).some((other) => {
      if (other.zone !== "battlefield" || other.controllerId === card.controllerId) {
        return false;
      }
      const flags = state.definitions[other.definitionId];
      return (
        (flags?.opponentCreaturesEnterTapped === true && arrivingTypes.includes("creature")) ||
        (flags?.opponentArtifactsEnterTapped === true && arrivingTypes.includes("artifact")) ||
        // Thalia: nonbasic lands only — a basic still enters untapped.
        (flags?.opponentNonbasicLandsEnterTapped === true &&
          arrivingTypes.includes("land") &&
          !characteristicsOf(state, cardId).supertypes.includes("basic"))
      );
    })
  ) {
    return true;
  }
  // Spelunking: "Lands you control enter untapped" CANCELS an enters-tapped
  // replacement rather than adding one, so it is asked last and wins. It is
  // scoped to the arriving land's own controller.
  if (
    arrivingTypes.includes("land") &&
    Object.values(state.cards).some(
      (other) =>
        other.zone === "battlefield" &&
        other.controllerId === card.controllerId &&
        state.definitions[other.definitionId]?.landsEnterUntapped === true &&
        !abilitiesRemoved(state, other.id),
    )
  ) {
    return false;
  }
  return (state.definitions[card.definitionId]?.replacements ?? []).some((replacement) => {
    if (replacement.kind === "enters_tapped") {
      return true;
    }
    if (replacement.kind === "enters_tapped_unless") {
      return !unlessSatisfied(state, card, replacement.unless);
    }
    if (replacement.kind === "enters_tapped_if") {
      return unlessSatisfied(state, card, replacement.if);
    }
    return false;
  });
}

export function queueEnterReplacementChoicesInPlace(state: GameState, cardId: CardInstanceId): void {
  const card = state.cards[cardId];
  if (!card || card.zone !== "battlefield") {
    return;
  }
  const definition = state.definitions[card.definitionId];
  if (!card.tapped) {
    for (const replacement of definition?.replacements ?? []) {
      if (replacement.kind !== "may_pay_life_or_enter_tapped") {
        continue;
      }
      state.prompts.push({
        kind: "may_pay_life_or_enter_tapped",
        playerId: card.controllerId,
        sourceId: card.id,
        amount: replacement.amount,
      });
    }
  }
  for (const replacement of definition?.replacements ?? []) {
    if (replacement.kind !== "discard_land_or_graveyard") {
      continue;
    }
    state.prompts.push({
      kind: "discard_land_or_graveyard",
      playerId: card.controllerId,
      sourceId: card.id,
    });
  }
  if (definition?.chooseCreatureTypeOnEnter && card.chosenCreatureType === null) {
    state.prompts.push({
      kind: "choose_creature_type",
      playerId: card.controllerId,
      sourceId: card.id,
    });
  }
  // Cloud Key: the card-type choice is auto-picked — the most common card
  // type among the controller's hand, else "creature" (documented).
  if (definition?.chooseCardTypeOnEnter && (card.chosenCardType ?? null) === null) {
    const tally: Record<string, number> = {};
    const hand =
      state.players.find((entry) => entry.id === card.controllerId)?.zones.hand ?? [];
    for (const handId of hand) {
      const types = state.definitions[state.cards[handId]?.definitionId ?? ""]?.characteristics
        .types;
      for (const type of types ?? []) {
        if (["artifact", "creature", "enchantment", "instant", "sorcery"].includes(type)) {
          tally[type] = (tally[type] ?? 0) + 1;
        }
      }
    }
    const best = Object.entries(tally).sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    )[0]?.[0];
    card.chosenCardType = best ?? "creature";
  }
  if (definition?.chooseColorOnEnter && card.chosenColor === null) {
    state.prompts.push({
      kind: "choose_color",
      playerId: card.controllerId,
      sourceId: card.id,
      ...(definition.chooseColorExcludes
        ? { excludeColor: definition.chooseColorExcludes }
        : {}),
    });
  }
  if (definition?.enterAsCopy) {
    // maxManaValue starts at 0 for spent-mana-capped clones (CR 707.12a: a
    // copy that wasn't cast spent no mana); stack resolution raises it to the
    // announced amount when the card enters from a cast.
    state.prompts.push({
      kind: "enter_as_copy",
      playerId: card.controllerId,
      sourceId: card.id,
      scope: definition.enterAsCopy.scope,
      ...(definition.enterAsCopy.extraCounters
        ? { extraCounters: definition.enterAsCopy.extraCounters }
        : {}),
      ...(definition.enterAsCopy.maxManaValueBySpent ? { maxManaValue: 0 } : {}),
      ...(definition.enterAsCopy.entersTapped ? { entersTapped: true } : {}),
      ...(definition.enterAsCopy.untilEot ? { untilEot: true } : {}),
      ...(definition.enterAsCopy.grantHaste ? { grantHaste: true } : {}),
    });
  }
}

/**
 * The index of a free-cast-from-hand grant this spell could use, or -1.
 * Grants are matched most-restrictive-first so a broad grant is not spent on
 * a spell that a narrower one would have covered.
 *
 * Lives here rather than in actions.ts so both the cast path and the
 * legal-action enumeration can read it without an import cycle.
 */
/**
 * Omniscience / As Foretold: a permanent that grants free casting from hand
 * continuously, rather than the one-shot grants above. Returns the loosest
 * cap available (Infinity for uncapped), or null when nothing grants it.
 *
 * As Foretold's "once each turn" is tracked on the player rather than the
 * card, which is a documented simplification: two copies would each allow a
 * cast, and here the second is refused.
 */
export function staticFreeCastCap(
  state: GameState,
  playerId: string,
  cardId: CardInstanceId,
): number | null {
  const manaValue = characteristicsOf(state, cardId).manaValue;
  let best: number | null = null;
  for (const card of Object.values(state.cards)) {
    if (card.zone !== "battlefield" || card.controllerId !== playerId) {
      continue;
    }
    const grant = state.definitions[card.definitionId]?.castFreeFromHand;
    if (!grant || abilitiesRemoved(state, card.id)) {
      continue;
    }
    if (grant.oncePerTurn && (state.freeCastUsedThisTurn ?? []).includes(playerId)) {
      continue;
    }
    const cap = grant.capFromCounter
      ? card.counters[grant.capFromCounter] ?? 0
      : Number.POSITIVE_INFINITY;
    if (manaValue > cap) {
      continue;
    }
    if (best === null || cap > best) {
      best = cap;
    }
  }
  return best;
}

/** Did a once-per-turn static grant cover this cast? */
export function usesOncePerTurnFreeCast(
  state: GameState,
  playerId: string,
  cardId: CardInstanceId,
): boolean {
  const manaValue = characteristicsOf(state, cardId).manaValue;
  return Object.values(state.cards).some((card) => {
    if (card.zone !== "battlefield" || card.controllerId !== playerId) {
      return false;
    }
    const grant = state.definitions[card.definitionId]?.castFreeFromHand;
    if (!grant?.oncePerTurn || abilitiesRemoved(state, card.id)) {
      return false;
    }
    const cap = grant.capFromCounter
      ? card.counters[grant.capFromCounter] ?? 0
      : Number.POSITIVE_INFINITY;
    return manaValue <= cap;
  });
}

export function findFreeHandGrantIndex(
  state: GameState,
  playerId: string,
  cardId: CardInstanceId,
): number {
  const grants = state.freeCastFromHand ?? [];
  const manaValue = characteristicsOf(state, cardId).manaValue;
  let best = -1;
  let bestCap = Number.POSITIVE_INFINITY;
  for (let index = 0; index < grants.length; index += 1) {
    const grant = grants[index]!;
    if (grant.casterId !== playerId || grant.remaining <= 0) {
      continue;
    }
    const cap = grant.maxManaValue ?? Number.POSITIVE_INFINITY;
    if (manaValue > cap) {
      continue;
    }
    if (cap < bestCap) {
      best = index;
      bestCap = cap;
    }
  }
  return best;
}
