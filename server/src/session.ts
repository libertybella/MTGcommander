import {
  applyAction,
  isGameOver,
  isMulliganOpen,
  redactForViewer,
  serializeGameState,
  type GameAction,
  type GameState,
  type PlayerId,
} from "@mtgcommander/engine";

export type SubmitResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Authoritative in-process host. Clients may only submit GameActions as
 * themselves. Unseated players auto-pass so a local table can advance.
 * No WebSockets.
 */
export class GameHost {
  private constructor(
    private state: GameState,
    private viewerId: PlayerId,
    private readonly seatedPlayerIds: Set<PlayerId>,
    private readonly listeners: Set<() => void> = new Set(),
  ) {
    this.flushUnseated();
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

  /** Player-specific projection. Mutating it cannot change the host. */
  viewFor(playerId: PlayerId): GameState {
    return redactForViewer(this.state, playerId);
  }

  submit(actorId: PlayerId, action: GameAction): SubmitResult {
    if (action.playerId !== actorId) {
      return { ok: false, error: "Cannot act as another player" };
    }
    if (!this.seatedPlayerIds.has(actorId)) {
      return { ok: false, error: "That player is not seated at this client" };
    }
    const before = serializeGameState(this.state);
    try {
      this.state = applyAction(this.state, action);
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
      if (isMulliganOpen(this.state) && this.state.mulligan) {
        const decidingId = this.state.mulligan.decidingPlayerId;
        if (this.seatedPlayerIds.has(decidingId)) {
          return;
        }
        if (this.state.mulligan.pendingBottom > 0) {
          const player = this.state.players.find((entry) => entry.id === decidingId);
          const cardIds = player?.zones.hand.slice(0, this.state.mulligan.pendingBottom) ?? [];
          this.state = applyAction(this.state, {
            kind: "bottom_cards",
            playerId: decidingId,
            cardIds,
          });
          continue;
        }
        this.state = applyAction(this.state, { kind: "keep_hand", playerId: decidingId });
        continue;
      }
      if (this.seatedPlayerIds.has(this.state.priorityPlayerId)) {
        return;
      }
      this.state = applyAction(this.state, {
        kind: "pass_priority",
        playerId: this.state.priorityPlayerId,
      });
    }
    throw new Error("Unseated priority flush did not settle");
  }
}
