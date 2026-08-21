import { isClass, isCommander, isCreature, isLand, isMainPhase } from "./cardTypes";
import { abilitiesRemoved, cardMatchesSubtype } from "./characteristicsEngine";
import { hasKeyword } from "./keywords";
import { emptyManaPool } from "./createGame";
import { pendingBlockerPlayer } from "./combat";
import { affinityArtifactDiscount, canPlayLandsFromGraveyard, castCostReduction, controlsCommander, hasFlashGrant, landDropAllowance, topOfLibraryGrant } from "./derived";
import { canPayManaCost, parseManaCost, type ParsedManaCost } from "./mana";
import { manaAbilitiesFor, manaTapOptionsFor } from "./manaOptions";
import { isMulliganOpen } from "./mulligan";
import { isOpeningRoll } from "./openingRoll";
import { isPromptOpen } from "./prompt";
import { isLiving } from "./players";
import { hasAnyLegalTargetSet } from "./targeting";
import type {
  ActivatedAbility,
  CardDefinition,
  CardInstance,
  AdditionalCastCost,
  CardInstanceId,
  GameState,
  ManaColor,
  ManaPool,
  PlayerId,
} from "./types";

/**
 * One thing a player could legally do right now if they held priority.
 * Advisory data for auto-yield policy and UI affordances; submissions are
 * still validated by applyAction. `mana` entries are pure mana taps and do
 * not count as meaningful (nobody stops a game to float mana).
 */
export type LegalAction =
  | { kind: "cast_spell"; cardId: CardInstanceId; faceIndex: number; fromCommand: boolean }
  | { kind: "play_land"; cardId: CardInstanceId; faceIndex: number }
  | { kind: "activate_ability"; cardId: CardInstanceId; abilityIndex: number }
  | { kind: "mana"; cardId: CardInstanceId }
  | { kind: "declare_attackers" }
  | { kind: "declare_blockers" };

/**
 * Mana a player could produce right now: the floating pool plus untapped
 * producers. Producers with a color choice become option sets; a permanent
 * with several abilities is flattened to one unit of any color it could make
 * (slightly optimistic on flexibility — correct bias for auto-yield, which
 * must never pass away a window the player could have used).
 */
export type PotentialMana = {
  fixed: ManaPool;
  optionSets: ManaColor[][];
};

const ALL_COLORS: ManaColor[] = ["W", "U", "B", "R", "G"];

function producerUsableNow(state: GameState, card: CardInstance): boolean {
  if (card.zone !== "battlefield" || card.tapped) {
    return false;
  }
  if (abilitiesRemoved(state, card.id)) {
    return false;
  }
  if (isCreature(state, card.id) && card.summoningSick && !hasKeyword(state, card.id, "haste")) {
    return false;
  }
  return true;
}

export function potentialMana(state: GameState, playerId: PlayerId): PotentialMana {
  const player = state.players.find((entry) => entry.id === playerId);
  const fixed: ManaPool = { ...(player?.mana ?? emptyManaPool()) };
  const optionSets: ManaColor[][] = [];
  for (const card of Object.values(state.cards)) {
    if (card.controllerId !== playerId || !producerUsableNow(state, card)) {
      continue;
    }
    const definition = state.definitions[card.definitionId];
    if (!definition) {
      continue;
    }
    const abilities = manaAbilitiesFor(state, card.id);
    if (abilities.length === 0) {
      continue;
    }
    if (abilities.length === 1 && !abilities[0]!.producesAnyColor && abilities[0]!.producesOptions.length === 0) {
      for (const color of Object.keys(abilities[0]!.produces) as ManaColor[]) {
        fixed[color] += abilities[0]!.produces[color] ?? 0;
      }
      continue;
    }
    const union = new Set<ManaColor>();
    for (const ability of abilities) {
      if (ability.producesAnyColor) {
        for (const color of ALL_COLORS) {
          union.add(color);
        }
        continue;
      }
      const options = manaTapOptionsFor(ability);
      if (options) {
        for (const color of options) {
          union.add(color);
        }
        continue;
      }
      for (const color of Object.keys(ability.produces) as ManaColor[]) {
        if ((ability.produces[color] ?? 0) > 0) {
          union.add(color);
        }
      }
    }
    if (union.size > 0) {
      optionSets.push([...union]);
    }
  }
  return { fixed, optionSets };
}

type Resource = { colors: Set<ManaColor>; used: boolean };

function resourcesOf(potential: PotentialMana): Resource[] {
  const resources: Resource[] = [];
  for (const color of ["W", "U", "B", "R", "G", "C"] as ManaColor[]) {
    for (let i = 0; i < potential.fixed[color]; i += 1) {
      resources.push({ colors: new Set([color]), used: false });
    }
  }
  for (const set of potential.optionSets) {
    resources.push({ colors: new Set(set), used: false });
  }
  return resources;
}

/**
 * Exact bipartite matching (augmenting paths) of cost pips onto mana
 * resources, so a payable cost is never reported unpayable. Pip counts and
 * resource counts at a Commander table are small.
 */
export function canPayWithPotential(potential: PotentialMana, cost: ParsedManaCost): boolean {
  const pips: ManaColor[][] = [];
  for (const color of ["W", "U", "B", "R", "G", "C"] as ManaColor[]) {
    for (let i = 0; i < cost[color]; i += 1) {
      pips.push([color]);
    }
  }
  for (const pip of cost.hybrid) {
    pips.push([pip.a, pip.b]);
  }
  const resources = resourcesOf(potential);
  const assignment = new Array<number>(resources.length).fill(-1);

  function augment(pipIndex: number, visited: boolean[]): boolean {
    const wants = pips[pipIndex]!;
    for (let r = 0; r < resources.length; r += 1) {
      if (visited[r] || !wants.some((color) => resources[r]!.colors.has(color))) {
        continue;
      }
      visited[r] = true;
      if (assignment[r] === -1 || augment(assignment[r]!, visited)) {
        assignment[r] = pipIndex;
        return true;
      }
    }
    return false;
  }

  for (let p = 0; p < pips.length; p += 1) {
    if (!augment(p, new Array<boolean>(resources.length).fill(false))) {
      return false;
    }
  }
  const leftover = resources.length - pips.length;
  return leftover >= cost.generic;
}

function payableCost(manaCost: string): ParsedManaCost | null {
  try {
    return parseManaCost(manaCost);
  } catch {
    return null;
  }
}

function inSorceryWindow(state: GameState, playerId: PlayerId): boolean {
  return (
    playerId === state.turn.activePlayerId && isMainPhase(state) && state.stack.length === 0
  );
}

/** "Activate only if you control a Swamp": any controlled match satisfies. */
export function controlsMatching(
  state: GameState,
  playerId: PlayerId,
  wanted: { types?: string[]; subtypes?: string[] },
): boolean {
  return Object.values(state.cards).some((card) => {
    if (card.zone !== "battlefield" || card.controllerId !== playerId) {
      return false;
    }
    const traits = state.definitions[card.definitionId]?.characteristics;
    if (!traits) {
      return false;
    }
    return (
      (wanted.types ?? []).every((type) => traits.types.includes(type)) &&
      (wanted.subtypes ?? []).every((subtype) => cardMatchesSubtype(state, card.id, subtype))
    );
  });
}

/** Does this battlefield card satisfy an additional-cost sacrifice scope? */
export function sacrificeScopeMatches(
  state: GameState,
  cardId: CardInstanceId,
  scope: NonNullable<AdditionalCastCost["sacrifice"]>,
): boolean {
  const types =
    state.definitions[state.cards[cardId]?.definitionId ?? ""]?.characteristics.types ?? [];
  if (scope === "creature") {
    return types.includes("creature");
  }
  if (scope === "artifact") {
    return types.includes("artifact");
  }
  if (scope === "land") {
    return types.includes("land");
  }
  return types.includes("creature") || types.includes("artifact");
}

function castableFace(
  state: GameState,
  playerId: PlayerId,
  definition: CardDefinition,
  potential: PotentialMana,
  extraGeneric: number,
  costOverride?: string,
): boolean {
  const isInstantSpeed =
    definition.characteristics.types.includes("instant") ||
    definition.keywords.includes("flash") ||
    hasFlashGrant(state, playerId);
  if (!isInstantSpeed && !inSorceryWindow(state, playerId)) {
    return false;
  }
  const cost = payableCost(costOverride ?? definition.manaCost);
  if (!cost) {
    return false;
  }
  cost.generic += extraGeneric;
  cost.generic = Math.max(0, cost.generic - castCostReduction(state, playerId, definition));
  if (definition.affinityArtifacts) {
    cost.generic = Math.max(0, cost.generic - affinityArtifactDiscount(state, playerId));
  }
  const castsFree = definition.freeIfCommander === true && controlsCommander(state, playerId);
  if (!castsFree && !canPayWithPotential(potential, cost)) {
    return false;
  }
  const additional = definition.additionalCost;
  if (additional) {
    const player = state.players.find((entry) => entry.id === playerId);
    if (!player) {
      return false;
    }
    if (
      additional.sacrifice &&
      !player.zones.battlefield.some((cardId) =>
        sacrificeScopeMatches(state, cardId, additional.sacrifice!),
      )
    ) {
      return false;
    }
    if (additional.discard && player.zones.hand.length <= additional.discard) {
      return false;
    }
    if (additional.life && player.life <= additional.life) {
      return false;
    }
  }
  if (definition.modes && definition.modes.length > 0) {
    return definition.modes.some((mode) =>
      mode.targetRequirements.length === 0
        ? true
        : hasAnyLegalTargetSet(state, mode.targetRequirements, playerId),
    );
  }
  if (definition.targetRequirements.length > 0) {
    return hasAnyLegalTargetSet(state, definition.targetRequirements, playerId);
  }
  return true;
}

function abilityUsable(
  state: GameState,
  playerId: PlayerId,
  card: CardInstance,
  ability: ActivatedAbility,
  potential: PotentialMana,
): boolean {
  const fromZone = ability.zone ?? "battlefield";
  if (card.zone !== fromZone) {
    return false;
  }
  if (fromZone === "battlefield" && abilitiesRemoved(state, card.id)) {
    return false;
  }
  if (ability.timing === "sorcery" && !inSorceryWindow(state, playerId)) {
    return false;
  }
  if (
    ability.requiresControlled &&
    !controlsMatching(state, playerId, ability.requiresControlled)
  ) {
    return false;
  }
  if (ability.tap) {
    if (card.tapped) {
      return false;
    }
    if (isCreature(state, card.id) && card.summoningSick && !hasKeyword(state, card.id, "haste")) {
      return false;
    }
  }
  const levelUp = ability.effects.find((effect) => effect.kind === "set_class_level");
  if (levelUp?.kind === "set_class_level") {
    if (!isClass(state, card.id) || levelUp.level !== card.classLevel + 1) {
      return false;
    }
  }
  const cost = payableCost(ability.manaCost);
  if (!cost || !canPayWithPotential(potential, cost)) {
    return false;
  }
  if (ability.lifeCost) {
    const player = state.players.find((entry) => entry.id === playerId);
    if (!player || player.life < ability.lifeCost) {
      return false;
    }
  }
  if (ability.targetRequirements.length > 0) {
    return hasAnyLegalTargetSet(state, ability.targetRequirements, playerId);
  }
  return true;
}

function faceDefinitions(
  state: GameState,
  definition: CardDefinition,
): { faceIndex: number; definition: CardDefinition }[] {
  const faces = [{ faceIndex: 0, definition }];
  if (definition.layout === "modal_dfc" && definition.otherFaceId) {
    const back = state.definitions[definition.otherFaceId];
    if (back) {
      faces.push({ faceIndex: 1, definition: back });
    }
  }
  return faces;
}

/**
 * Everything `playerId` could legally do if they held priority right now.
 * Returns an empty list while an opening roll, mulligan, or prompt is
 * pending — those pauses have their own dedicated actions.
 */
export function legalActions(state: GameState, playerId: PlayerId): LegalAction[] {
  if (
    !isLiving(state, playerId) ||
    isOpeningRoll(state) ||
    isMulliganOpen(state) ||
    isPromptOpen(state) ||
    state.winnerId !== null
  ) {
    return [];
  }
  const player = state.players.find((entry) => entry.id === playerId);
  if (!player) {
    return [];
  }
  const potential = potentialMana(state, playerId);
  const actions: LegalAction[] = [];

  const graveyardLandIds = canPlayLandsFromGraveyard(state, playerId)
    ? player.zones.graveyard.filter((cardId) => {
        const definition = state.cards[cardId]
          ? state.definitions[state.cards[cardId]!.definitionId]
          : undefined;
        return definition?.characteristics.types.includes("land") === true;
      })
    : [];
  const flashbackIds = player.zones.graveyard.filter((cardId) => {
    const definition = state.cards[cardId]
      ? state.definitions[state.cards[cardId]!.definitionId]
      : undefined;
    return Boolean(definition?.flashback);
  });
  for (const cardId of [
    ...player.zones.hand,
    ...graveyardLandIds,
    ...flashbackIds.filter((id) => !graveyardLandIds.includes(id)),
  ]) {
    const card = state.cards[cardId];
    const definition = card ? state.definitions[card.definitionId] : undefined;
    if (!card || !definition) {
      continue;
    }
    const inGraveyard = card.zone === "graveyard";
    for (const face of faceDefinitions(state, definition)) {
      const faceIsLand = face.definition.characteristics.types.includes("land");
      if (faceIsLand) {
        if (
          inSorceryWindow(state, playerId) &&
          player.landsPlayedThisTurn < landDropAllowance(state, playerId)
        ) {
          actions.push({ kind: "play_land", cardId, faceIndex: face.faceIndex });
        }
        continue;
      }
      if (inGraveyard) {
        // Flashback (CR 702.34): castable from the graveyard for its
        // flashback cost; life portions are validated at cast time.
        const flashback = face.definition.flashback;
        if (
          flashback &&
          (face.definition.characteristics.types.includes("instant") ||
            face.definition.characteristics.types.includes("sorcery")) &&
          castableFace(state, playerId, face.definition, potential, 0, flashback.manaCost)
        ) {
          actions.push({
            kind: "cast_spell",
            cardId,
            faceIndex: face.faceIndex,
            fromCommand: false,
          });
        }
        continue;
      }
      if (castableFace(state, playerId, face.definition, potential, 0)) {
        actions.push({ kind: "cast_spell", cardId, faceIndex: face.faceIndex, fromCommand: false });
      }
    }
    for (const [abilityIndex, ability] of definition.activated.entries()) {
      if ((ability.zone ?? "battlefield") !== "hand") {
        continue;
      }
      if (abilityUsable(state, playerId, card, ability, potential)) {
        actions.push({ kind: "activate_ability", cardId, abilityIndex });
      }
    }
  }

  // Top-of-library grants (Oracle of Mul Daya, Elven Chorus): the library's
  // top card joins the playable set when a battlefield permanent allows it.
  const topGrant = topOfLibraryGrant(state, playerId);
  const topCardId = topGrant ? player.zones.library[0] : undefined;
  if (topGrant && topCardId) {
    const topCard = state.cards[topCardId];
    const topDefinition = topCard ? state.definitions[topCard.definitionId] : undefined;
    if (topDefinition) {
      const topIsLand = topDefinition.characteristics.types.includes("land");
      if (
        topIsLand &&
        topGrant.playLands &&
        inSorceryWindow(state, playerId) &&
        player.landsPlayedThisTurn < landDropAllowance(state, playerId)
      ) {
        actions.push({ kind: "play_land", cardId: topCardId, faceIndex: 0 });
      }
      if (
        !topIsLand &&
        (topGrant.castAll ||
          topGrant.castTypesAny.some((type) =>
            topDefinition.characteristics.types.includes(type),
          )) &&
        castableFace(state, playerId, topDefinition, potential, 0)
      ) {
        actions.push({ kind: "cast_spell", cardId: topCardId, faceIndex: 0, fromCommand: false });
      }
    }
  }

  for (const cardId of player.zones.command) {
    const card = state.cards[cardId];
    const definition = card ? state.definitions[card.definitionId] : undefined;
    if (!card || !definition || !isCommander(state, cardId) || isLand(state, cardId)) {
      continue;
    }
    if (castableFace(state, playerId, definition, potential, player.commander.tax)) {
      actions.push({ kind: "cast_spell", cardId, faceIndex: 0, fromCommand: true });
    }
  }

  for (const card of Object.values(state.cards)) {
    if (card.controllerId !== playerId || card.zone !== "battlefield") {
      continue;
    }
    const definition = state.definitions[card.definitionId];
    if (!definition) {
      continue;
    }
    if (producerUsableNow(state, card) && manaAbilitiesFor(state, card.id).length > 0) {
      actions.push({ kind: "mana", cardId: card.id });
    }
    for (const [abilityIndex, ability] of definition.activated.entries()) {
      if ((ability.zone ?? "battlefield") !== "battlefield") {
        continue;
      }
      if (abilityUsable(state, playerId, card, ability, potential)) {
        actions.push({ kind: "activate_ability", cardId: card.id, abilityIndex });
      }
    }
  }

  if (
    state.turn.step === "declareAttackers" &&
    playerId === state.turn.activePlayerId &&
    !state.combat?.attackersDeclared
  ) {
    const hasAttacker = Object.values(state.cards).some(
      (card) =>
        card.controllerId === playerId &&
        card.zone === "battlefield" &&
        isCreature(state, card.id) &&
        !card.tapped &&
        (!card.summoningSick || hasKeyword(state, card.id, "haste")) &&
        !hasKeyword(state, card.id, "defender"),
    );
    if (hasAttacker) {
      actions.push({ kind: "declare_attackers" });
    }
  }
  if (state.turn.step === "declareBlockers" && pendingBlockerPlayer(state) === playerId) {
    actions.push({ kind: "declare_blockers" });
  }

  return actions;
}

/**
 * True when the player could do something a reasonable table would pause
 * for: anything except floating mana. This is the auto-yield question.
 */
export function hasMeaningfulAction(state: GameState, playerId: PlayerId): boolean {
  return legalActions(state, playerId).some((action) => action.kind !== "mana");
}

export type AutoTap = { cardId: CardInstanceId; color?: ManaColor; manaIndex?: number };

/**
 * The Arena convenience: which producers to tap (and which colors to pick)
 * so the floating pool covers `cost`. Fixed producers are preferred and
 * flexible ones are assigned by matching, so duals are not wasted on pips a
 * basic could pay. Returns null when even tapping everything cannot pay.
 */
export function autoTapPlan(
  state: GameState,
  playerId: PlayerId,
  cost: string | ParsedManaCost,
): AutoTap[] | null {
  const parsed = typeof cost === "string" ? parseManaCost(cost) : cost;
  const player = state.players.find((entry) => entry.id === playerId);
  if (!player) {
    return null;
  }
  const potential = potentialMana(state, playerId);
  if (!canPayWithPotential(potential, parsed)) {
    return null;
  }

  // Work against a copy of the floating pool; tap producers until it pays.
  const pool: ManaPool = { ...player.mana };
  const taps: AutoTap[] = [];
  type Producer = { cardId: CardInstanceId; manaIndex: number; options: ManaColor[] | null; produces: Partial<ManaPool> };
  const producers: Producer[] = [];
  for (const card of Object.values(state.cards)) {
    if (card.controllerId !== playerId || !producerUsableNow(state, card)) {
      continue;
    }
    const abilities = manaAbilitiesFor(state, card.id);
    abilities.forEach((ability, manaIndex) => {
      if (manaIndex > 0) {
        return; // one candidate ability per permanent keeps the plan simple
      }
      if (ability.sacrificeSelf) {
        return; // never auto-sacrifice a Treasure — tapping it stays a choice
      }
      producers.push({
        cardId: card.id,
        manaIndex,
        options: manaTapOptionsFor(ability),
        produces: ability.produces,
      });
    });
  }

  const stillNeeded = (): ManaColor | "generic" | null => {
    for (const color of ["W", "U", "B", "R", "G", "C"] as ManaColor[]) {
      if (parsed[color] > (pool[color] ?? 0)) {
        return color;
      }
    }
    const pips = (["W", "U", "B", "R", "G", "C"] as ManaColor[]).reduce(
      (sum, color) => sum + Math.min(pool[color], parsed[color]),
      0,
    );
    void pips;
    const poolTotal = (["W", "U", "B", "R", "G", "C"] as ManaColor[]).reduce(
      (sum, color) => sum + pool[color],
      0,
    );
    const pipTotal = (["W", "U", "B", "R", "G", "C"] as ManaColor[]).reduce(
      (sum, color) => sum + parsed[color],
      0,
    );
    const hybridTotal = parsed.hybrid.length;
    if (poolTotal < pipTotal + hybridTotal + parsed.generic) {
      return "generic";
    }
    return null;
  };

  let guard = 0;
  while (!canPayManaCost(pool, parsed) && guard < 50) {
    guard += 1;
    const need = stillNeeded();
    if (need === null) {
      break;
    }
    let picked = -1;
    if (need !== "generic") {
      picked = producers.findIndex(
        (producer) =>
          (producer.options === null && (producer.produces[need] ?? 0) > 0) ||
          (producer.options !== null && producer.options.includes(need)),
      );
    }
    if (picked === -1) {
      picked = producers.findIndex((producer) => producer.options === null);
    }
    if (picked === -1) {
      picked = producers.length > 0 ? 0 : -1;
    }
    if (picked === -1) {
      return null;
    }
    const producer = producers.splice(picked, 1)[0]!;
    if (producer.options) {
      const color =
        need !== "generic" && producer.options.includes(need)
          ? need
          : producer.options[0]!;
      pool[color] += 1;
      taps.push({ cardId: producer.cardId, color, manaIndex: producer.manaIndex });
    } else {
      for (const color of ["W", "U", "B", "R", "G", "C"] as ManaColor[]) {
        pool[color] += producer.produces[color] ?? 0;
      }
      taps.push({ cardId: producer.cardId, manaIndex: producer.manaIndex });
    }
  }
  return canPayManaCost(pool, parsed) ? taps : null;
}
