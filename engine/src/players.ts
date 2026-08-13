import type { GameState, PlayerId, PlayerState } from "./types";

export function livingPlayers(state: GameState): PlayerState[] {
  return state.players.filter((player) => !player.lost);
}

export function livingPlayerCount(state: GameState): number {
  return livingPlayers(state).length;
}

export function isLiving(state: GameState, playerId: PlayerId): boolean {
  return state.players.some((player) => player.id === playerId && !player.lost);
}

export function requireLiving(state: GameState, playerId: PlayerId): PlayerState {
  const player = state.players.find((entry) => entry.id === playerId);
  if (!player) {
    throw new Error(`Unknown player ${playerId}`);
  }
  if (player.lost) {
    throw new Error("That player has lost");
  }
  return player;
}

export function nextLivingPlayerId(state: GameState, currentId: PlayerId): PlayerId {
  const index = state.players.findIndex((player) => player.id === currentId);
  if (index === -1) {
    throw new Error(`Unknown player ${currentId}`);
  }
  for (let offset = 1; offset <= state.players.length; offset += 1) {
    const candidate = state.players[(index + offset) % state.players.length];
    if (candidate && !candidate.lost) {
      return candidate.id;
    }
  }
  throw new Error("No living players remain");
}

export function winnerId(state: GameState): PlayerId | null {
  const living = livingPlayers(state);
  return living.length === 1 ? (living[0]?.id ?? null) : null;
}
