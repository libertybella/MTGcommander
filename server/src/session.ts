import {
  DEFAULT_SHORTCUT_POLICY,
  applyAction,
  cloneGameState,
  currentPrompt,
  firstLegalTargetSet,
  isGameOver,
  isMulliganOpen,
  isOpeningRoll,
  legalIdsForChooseSources,
  lookedAtCardIds,
  openingRollPending,
  redactForViewer,
  serializeGameState,
  type GameAction,
  type GameState,
  type PlayerId,
  type ShortcutPolicy,
} from "@mtgcommander/engine";

export type SubmitResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Authoritative in-process host. Clients may only submit GameActions as
 * themselves. Unseated NAPs auto-pass on an empty stack so a local table can
 * advance; an unseated active player's turn waits for the host to skip.
 * No WebSockets.
 */
export class GameHost {
  /** Host-owned digital-shortcut policy; seat stops shrink it (Stage 1). */
  private shortcuts: ShortcutPolicy = DEFAULT_SHORTCUT_POLICY;

  private constructor(
    private state: GameState,
    private viewerId: PlayerId,
    private readonly seatedPlayerIds: Set<PlayerId>,
    private readonly listeners: Set<() => void> = new Set(),
    private readonly history: { actorId: PlayerId; state: GameState }[] = [],
  ) {
    this.flushUnseated();
  }

  private apply(action: GameAction): void {
    this.state = applyAction(this.state, action, { shortcuts: this.shortcuts });
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
      this.state = applyAction(this.state, action, { shortcuts: this.shortcuts });
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
      if (seatedPriority && (activePriority || this.state.stack.length > 0)) {
        return;
      }
      if (!seatedPriority && activePriority) {
        return;
      }
      this.apply({
        kind: "pass_priority",
        playerId: priorityId,
      });
    }
    throw new Error("Unseated priority flush did not settle");
  }
}
