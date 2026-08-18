export type OpponentSeat = "north" | "east" | "west";

export type SeatAssignment<T> = {
  north: T | null;
  east: T | null;
  west: T | null;
};

/**
 * Viewer is always South. Remaining players sit clockwise
 * (next player to the viewer's left):
 * 2 players → North; 3 → West and North; 4 → West, North, and East.
 * `opponents` should be in wrap order after the viewer.
 */
export function assignOpponentSeats<T>(opponents: T[]): SeatAssignment<T> {
  if (opponents.length <= 1) {
    return {
      north: opponents[0] ?? null,
      east: null,
      west: null,
    };
  }
  return {
    west: opponents[0] ?? null,
    north: opponents[1] ?? null,
    east: opponents[2] ?? null,
  };
}

export function opponentsAfterViewer<T extends { id: string }>(players: T[], viewerId: string): T[] {
  const start = players.findIndex((player) => player.id === viewerId);
  if (start < 0) {
    return players.filter((player) => player.id !== viewerId);
  }
  const seated: T[] = [];
  for (let offset = 1; offset < players.length; offset += 1) {
    const player = players[(start + offset) % players.length];
    if (player) {
      seated.push(player);
    }
  }
  return seated;
}
