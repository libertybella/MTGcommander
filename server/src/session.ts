import {
  DEFAULT_SHORTCUT_POLICY,
  TURN_SEQUENCE,
  applyAction,
  cloneGameState,
  currentPrompt,
  firstLegalTargetSet,
  hasMeaningfulAction,
  isGameOver,
  isMulliganOpen,
  isOpeningRoll,
  legalEnterCopyIds,
  legalIdsForChooseSources,
  legalSearchIds,
  lookedAtCardIds,
  openingRollPending,
  redactForViewer,
  serializeGameState,
  type GameAction,
  type GameState,
  type PlayerId,
  type ShortcutPolicy,
  type Step,
} from "@mtgcommander/engine";

export type SubmitResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * How a seat wants priority handled (the MTGO/Arena model).
 * - `stops` are steps the player always pauses at, split by whose turn it is.
 * - `fullControl` suspends every shortcut: the player sees every window.
 * - `yield` decides non-stop windows: `stops-only` still pauses whenever the
 *   stack is non-empty (MTGO-style, leaks nothing); `smart` pauses only when
 *   `hasMeaningfulAction` says the player could act (Arena-style — faster,
 *   but not pausing reveals an empty hand).
 */
export type SeatPreferences = {
  stops: { myTurn: Set<Step>; theirTurn: Set<Step> };
  fullControl: boolean;
  yield: "stops-only" | "smart";
};

/** Serializable form for the WebSocket protocol and UI. */
export type SeatPreferencesInput = {
  stops?: { myTurn?: Step[]; theirTurn?: Step[] };
  fullControl?: boolean;
  yield?: "stops-only" | "smart";
};

const STEP_NAMES = new Set<Step>(TURN_SEQUENCE.map((slot) => slot.step));

/**
 * Defaults preserve the table's historical behavior exactly: hold every
 * non-skipped step of your own turn, auto-pass on opponents' turns with an
 * empty stack, and always hold while the stack is populated.
 */
export function defaultSeatPreferences(): SeatPreferences {
  const myTurn = new Set<Step>(
    TURN_SEQUENCE.map((slot) => slot.step).filter(
      (step) => !DEFAULT_SHORTCUT_POLICY.skippableSteps.has(step),
    ),
  );
  return {
    stops: { myTurn, theirTurn: new Set<Step>() },
    fullControl: false,
    yield: "stops-only",
  };
}

export function normalizeSeatPreferences(input: SeatPreferencesInput): SeatPreferences {
  const base = defaultSeatPreferences();
  const parseSteps = (steps: Step[] | undefined, fallback: Set<Step>): Set<Step> => {
    if (steps === undefined) {
      return fallback;
    }
    const parsed = new Set<Step>();
    for (const step of steps) {
      if (!STEP_NAMES.has(step)) {
        throw new Error(`Unknown step ${String(step)}`);
      }
      parsed.add(step);
    }
    return parsed;
  };
  return {
    stops: {
      myTurn: parseSteps(input.stops?.myTurn, base.stops.myTurn),
      theirTurn: parseSteps(input.stops?.theirTurn, base.stops.theirTurn),
    },
    fullControl: input.fullControl === true,
    yield: input.yield === "smart" ? "smart" : "stops-only",
  };
}

/**
 * Authoritative in-process host. Clients may only submit GameActions as
 * themselves. Unseated NAPs auto-pass on an empty stack so a local table can
 * advance; an unseated active player's turn waits for the host to skip.
 * No WebSockets.
 */
export class GameHost {
  /** Per-seat priority preferences. Seats without an entry use defaults. */
  private readonly preferences = new Map<PlayerId, SeatPreferences>();

  /**
   * Stage 6 telemetry: overrides used this game, by change type. The
   * weekly "most-overridden" list is the compiler's sprint queue; the
   * coverage goal is a median of zero per game.
   */
  private readonly overrideCounts = new Map<string, number>();

  getOverrideStats(): { total: number; byChange: Record<string, number> } {
    const byChange: Record<string, number> = {};
    let total = 0;
    for (const [change, count] of this.overrideCounts) {
      byChange[change] = count;
      total += count;
    }
    return { total, byChange };
  }

  private constructor(
    private state: GameState,
    private viewerId: PlayerId,
    private readonly seatedPlayerIds: Set<PlayerId>,
    private readonly listeners: Set<() => void> = new Set(),
    private readonly history: { actorId: PlayerId; state: GameState }[] = [],
  ) {
    this.flushUnseated();
  }

  preferencesFor(playerId: PlayerId): SeatPreferences {
    return this.preferences.get(playerId) ?? defaultSeatPreferences();
  }

  /** Set a seated player's stops / yield / full control. Reflows priority. */
  setPreferences(playerId: PlayerId, input: SeatPreferencesInput): void {
    if (!this.seatedPlayerIds.has(playerId)) {
      throw new Error("That player is not seated at this client");
    }
    this.preferences.set(playerId, normalizeSeatPreferences(input));
    this.flushUnseated();
    this.notify();
  }

  /**
   * The digital-shortcut skip set, shrunk by seated players' stops: the
   * active seat's own-turn stops and every other seated player's their-turn
   * stops keep those steps from being fast-forwarded past.
   */
  private effectiveShortcuts(): ShortcutPolicy {
    const skippable = new Set<Step>(DEFAULT_SHORTCUT_POLICY.skippableSteps);
    const activeId = this.state.turn.activePlayerId;
    for (const playerId of this.seatedPlayerIds) {
      const prefs = this.preferencesFor(playerId);
      if (prefs.fullControl) {
        return { skippableSteps: new Set<Step>() };
      }
      const stops = playerId === activeId ? prefs.stops.myTurn : prefs.stops.theirTurn;
      for (const step of stops) {
        skippable.delete(step);
      }
    }
    return { skippableSteps: skippable };
  }

  private apply(action: GameAction): void {
    this.state = applyAction(this.state, action, { shortcuts: this.effectiveShortcuts() });
  }

  /**
   * Should the host wait for this seated player's input at priority, or pass
   * for them? Full control always waits. A stop on the current step always
   * waits. Otherwise: with a populated stack, `stops-only` waits and `smart`
   * waits only when the player could meaningfully act; with an empty stack,
   * `smart` also pauses an opponent's turn when the player has an action.
   */
  private shouldHoldPriority(playerId: PlayerId): boolean {
    const prefs = this.preferencesFor(playerId);
    if (prefs.fullControl) {
      return true;
    }
    const isActive = playerId === this.state.turn.activePlayerId;
    const stops = isActive ? prefs.stops.myTurn : prefs.stops.theirTurn;
    if (this.state.stack.length > 0) {
      return prefs.yield === "stops-only" ? true : hasMeaningfulAction(this.state, playerId);
    }
    if (stops.has(this.state.turn.step)) {
      return true;
    }
    if (!isActive && prefs.yield === "smart") {
      return hasMeaningfulAction(this.state, playerId);
    }
    return false;
  }

  static start(
    state: GameState,
    viewerId: PlayerId,
    options: { hotseat?: boolean } = {},
  ): GameHost {
    if (!state.players.some((player) => player.id === viewerId)) {
      throw new Error(`Unknown player ${viewerId}`);
    }
    const seated = options.hotseat
      ? new Set(state.players.map((player) => player.id))
      : new Set([viewerId]);
    return new GameHost(state, viewerId, seated);
  }

  static restore(state: GameState, viewerId: PlayerId, seatedPlayerIds: PlayerId[]): GameHost {
    return new GameHost(state, viewerId, new Set(seatedPlayerIds));
  }

  getViewerId(): PlayerId {
    return this.viewerId;
  }

  getSeatedPlayerIds(): PlayerId[] {
    return [...this.seatedPlayerIds];
  }

  /** Switch which seated player this local client is showing. */
  setViewer(playerId: PlayerId): void {
    if (!this.seatedPlayerIds.has(playerId)) {
      throw new Error("That player is not seated at this client");
    }
    this.viewerId = playerId;
    this.notify();
  }

  seatPlayer(playerId: PlayerId): void {
    if (!this.state.players.some((player) => player.id === playerId)) {
      throw new Error(`Unknown player ${playerId}`);
    }
    this.seatedPlayerIds.add(playerId);
    this.notify();
  }

  renamePlayer(playerId: PlayerId, displayName: string): void {
    const player = this.state.players.find((entry) => entry.id === playerId);
    if (!player) {
      throw new Error(`Unknown player ${playerId}`);
    }
    player.displayName = displayName.trim() || player.displayName;
    this.notify();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Player-specific projection. Mutating it cannot change the host.
   * Local hotseat can pass `revealHidden` so every hand and library is face up.
   */
  viewFor(playerId: PlayerId, options: { revealHidden?: boolean } = {}): GameState {
    if (options.revealHidden) {
      return cloneGameState(this.state);
    }
    return redactForViewer(this.state, playerId);
  }

  submit(actorId: PlayerId, action: GameAction): SubmitResult {
    if (action.playerId !== actorId) {
      return { ok: false, error: "Cannot act as another player" };
    }
    if (!this.seatedPlayerIds.has(actorId)) {
      return { ok: false, error: "That player is not seated at this client" };
    }
    if (action.kind === "undo") {
      return this.undoLast(actorId);
    }
    const previous = cloneGameState(this.state);
    const before = serializeGameState(this.state);
    try {
      this.state = applyAction(this.state, action, { shortcuts: this.effectiveShortcuts() });
      if (action.kind === "manual_override") {
        this.overrideCounts.set(
          action.change.type,
          (this.overrideCounts.get(action.change.type) ?? 0) + 1,
        );
      }
      this.history.push({ actorId, state: previous });
      if (this.history.length > 100) {
        this.history.shift();
      }
      this.flushUnseated();
      this.notify();
      return { ok: true };
    } catch (error) {
      if (serializeGameState(this.state) !== before) {
        throw new Error("Illegal action mutated host GameState");
      }
      const message = error instanceof Error ? error.message : "That action failed";
      return { ok: false, error: message };
    }
  }

  /** Full authoritative JSON for persistence. Not a player view. */
  serializeAuthority(): string {
    return serializeGameState(this.state);
  }

  private undoLast(actorId: PlayerId): SubmitResult {
    const last = this.history[this.history.length - 1];
    if (!last) {
      return { ok: false, error: "Nothing to undo" };
    }
    if (last.actorId !== actorId) {
      return { ok: false, error: "You can only undo your last action" };
    }
    this.history.pop();
    this.state = cloneGameState(last.state);
    this.flushUnseated();
    this.notify();
    return { ok: true };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private flushUnseated(): void {
    let guard = 0;
    while (guard < 200) {
      guard += 1;
      if (isGameOver(this.state)) {
        return;
      }
      if (isOpeningRoll(this.state) && this.state.openingRoll) {
        const seatedPending = this.state.players.find(
          (player) =>
            !player.lost &&
            openingRollPending(this.state, player.id) &&
            this.seatedPlayerIds.has(player.id),
        );
        if (seatedPending) {
          return;
        }
        const pending = this.state.players.find(
          (player) =>
            !player.lost &&
            this.state.openingRoll?.rolls[player.id] === undefined &&
            !this.seatedPlayerIds.has(player.id),
        );
        if (pending) {
          this.apply({ kind: "opening_roll", playerId: pending.id });
          continue;
        }
        continue;
      }
      if (isMulliganOpen(this.state) && this.state.mulligan) {
        const decidingId = this.state.mulligan.decidingPlayerId;
        if (this.seatedPlayerIds.has(decidingId)) {
          return;
        }
        if (this.state.mulligan.pendingBottom > 0) {
          const player = this.state.players.find((entry) => entry.id === decidingId);
          const cardIds = player?.zones.hand.slice(0, this.state.mulligan.pendingBottom) ?? [];
          this.apply({
            kind: "bottom_cards",
            playerId: decidingId,
            cardIds,
          });
          continue;
        }
        this.apply({ kind: "keep_hand", playerId: decidingId });
        continue;
      }
      const prompt = currentPrompt(this.state);
      if (prompt) {
        if (this.seatedPlayerIds.has(prompt.playerId)) {
          return;
        }
        if (prompt.kind === "order_triggers") {
          this.apply({
            kind: "resolve_order_triggers",
            playerId: prompt.playerId,
            order: prompt.entries.map((_, index) => index),
          });
          continue;
        }
        if (prompt.kind === "discard_land_or_graveyard") {
          this.apply({
            kind: "choose_discard_land_or_graveyard",
            playerId: prompt.playerId,
            discard: true,
          });
          continue;
        }
        if (prompt.kind === "may_pay_life_or_enter_tapped") {
          this.apply({
            kind: "choose_enter_replacement",
            playerId: prompt.playerId,
            pay: false,
          });
          continue;
        }
        if (prompt.kind === "scry") {
          this.apply({
            kind: "resolve_scry",
            playerId: prompt.playerId,
            bottomIds: [],
          });
          continue;
        }
        if (prompt.kind === "surveil") {
          this.apply({
            kind: "resolve_surveil",
            playerId: prompt.playerId,
            graveyardIds: [],
          });
          continue;
        }
        if (prompt.kind === "choose_discard") {
          const player = this.state.players.find((entry) => entry.id === prompt.playerId);
          this.apply({
            kind: "resolve_discard",
            playerId: prompt.playerId,
            cardIds: player?.zones.hand.slice(0, prompt.count) ?? [],
          });
          continue;
        }
        if (prompt.kind === "choose_from_hand") {
          // The auto-answer takes NONE, which "any number" allows and which
          // is the only choice that is always legal.
          this.apply({
            kind: "resolve_choose_from_hand",
            playerId: prompt.playerId,
            cardIds: [],
          });
          continue;
        }
        if (prompt.kind === "enter_as_copy") {
          const pick = legalEnterCopyIds(this.state, prompt)[0] ?? null;
          this.apply({ kind: "resolve_enter_copy", playerId: prompt.playerId, cardId: pick });
          continue;
        }
        if (prompt.kind === "choose_trigger_mode") {
          const bounds = prompt.modeChoice ?? { min: 1, max: 1 };
          const available =
            this.state.definitions[this.state.cards[prompt.sourceId]?.definitionId ?? ""]
              ?.triggers[prompt.triggerIndex]?.modes?.length ?? 0;
          const take = Math.min(Math.max(bounds.min, 1), bounds.max, available);
          this.apply({
            kind: "resolve_trigger_mode",
            playerId: prompt.playerId,
            modeIndexes: Array.from({ length: take }, (_, index) => index),
          });
          continue;
        }
        if (prompt.kind === "choose_card_name") {
          // A documented auto-take for an unseated player: name the top card
          // of their own library. Any name is legal, and naming one they do
          // not have would exile the library — a real line for a human
          // Demonic Consultation, and never what an absent player wants.
          const owner = this.state.players.find((entry) => entry.id === prompt.playerId);
          const topId = owner?.zones.library[0];
          const named = topId
            ? this.state.definitions[this.state.cards[topId]?.definitionId ?? ""]?.name
            : undefined;
          this.apply({
            kind: "resolve_card_name",
            playerId: prompt.playerId,
            cardName: named ?? "Forest",
          });
          continue;
        }
        if (prompt.kind === "choose_card") {
          const pick = legalIdsForChooseSources(this.state, prompt.sources)[0];
          if (!pick) {
            return;
          }
          this.apply({
            kind: "resolve_choose_card",
            playerId: prompt.playerId,
            cardId: pick,
          });
          continue;
        }
        if (prompt.kind === "pay_or_counter" || prompt.kind === "pay_or_effect") {
          this.apply({ kind: "resolve_pay", playerId: prompt.playerId, pay: false });
          continue;
        }
        if (prompt.kind === "choose_creature_type") {
          this.apply({
            kind: "resolve_creature_type",
            playerId: prompt.playerId,
            creatureType: "sliver",
          });
          continue;
        }
        if (prompt.kind === "choose_color") {
          // Green unless the card forbids it (Thriving Grove).
          this.apply({
            kind: "resolve_color",
            playerId: prompt.playerId,
            color: prompt.excludeColor === "G" ? "U" : "G",
          });
          continue;
        }
        if (prompt.kind === "search_library") {
          const legal = legalSearchIds(this.state, prompt).slice(0, prompt.count);
          this.apply({ kind: "resolve_search", playerId: prompt.playerId, cardIds: legal });
          continue;
        }
        if (prompt.kind === "look_and_assign") {
          const cards = lookedAtCardIds(this.state, prompt);
          this.apply({
            kind: "resolve_look_assign",
            playerId: prompt.playerId,
            assignments: cards.map((cardId, index) => ({
              cardId,
              destination: prompt.destinations[index] ?? prompt.destinations[0] ?? "hand",
            })),
          });
          continue;
        }
        const targets = firstLegalTargetSet(
          this.state,
          prompt.requirements,
          prompt.playerId,
        );
        this.apply({
          kind: "choose_targets",
          playerId: prompt.playerId,
          targets: targets ?? [],
        });
        continue;
      }
      const priorityId = this.state.priorityPlayerId;
      const seatedPriority = this.seatedPlayerIds.has(priorityId);
      const activePriority = priorityId === this.state.turn.activePlayerId;
      if (seatedPriority && this.shouldHoldPriority(priorityId)) {
        return;
      }
      if (!seatedPriority && activePriority) {
        // An unseated active player's turn waits for the host to skip.
        return;
      }
      this.apply({
        kind: "pass_priority",
        playerId: priorityId,
      });
    }
    // A table where every seat yields indefinitely (e.g. all stops removed)
    // parks here instead of crashing; the next human input resumes the flush.
  }
}
