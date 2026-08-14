import {
  applyAction,
  isGameOver,
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
    private readonly viewerId: PlayerId,
    private readonly seatedPlayerIds: ReadonlySet<PlayerId>,
  ) {
    this.flushUnseated();
  }

  static start(state: GameState, viewerId: PlayerId): GameHost {
    if (!state.players.some((player) => player.id === viewerId)) {
      throw new Error(`Unknown player ${viewerId}`);
    }
    return new GameHost(state, viewerId, new Set([viewerId]));
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

  private flushUnseated(): void {
    let guard = 0;
    while (guard < 200) {
      guard += 1;
      if (isGameOver(this.state)) {
        return;
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
