import { getEngineInfo, type GameAction, type GameState, type PlayerId } from "@mtgcommander/engine";
import type { SeatPreferencesInput } from "@mtgcommander/server";

export type SeatInfo = {
  playerId: PlayerId;
  displayName: string;
  connected: boolean;
};

export type RemoteHandlers = {
  onJoined: (info: {
    playerId: PlayerId;
    roomCode: string;
    view: GameState;
    seats: SeatInfo[];
    /** Keep this: rejoining the same seat later requires it. */
    token?: string;
  }) => void;
  onState: (view: GameState, seats: SeatInfo[]) => void;
  onError: (message: string) => void;
  onClose: () => void;
};

export type RemoteTable = {
  send: (action: GameAction) => void;
  sendPreferences: (preferences: SeatPreferencesInput) => void;
  close: () => void;
};

export function openRemoteTable(
  url: string,
  join: { roomCode: string; displayName: string; playerId?: PlayerId; token?: string },
  handlers: RemoteHandlers,
): RemoteTable {
  const socket = new WebSocket(url);
  socket.addEventListener("open", () => {
    socket.send(JSON.stringify({ type: "join", engine: getEngineInfo().version, ...join }));
  });
  socket.addEventListener("message", (event) => {
    const parsed: unknown = JSON.parse(String(event.data));
    if (typeof parsed !== "object" || parsed === null || !("type" in parsed)) {
      return;
    }
    const message = parsed as {
      type: string;
      playerId?: PlayerId;
      roomCode?: string;
      view?: GameState;
      seats?: SeatInfo[];
      message?: string;
      token?: string;
    };
    if (message.type === "error") {
      handlers.onError(message.message ?? "Table error");
      return;
    }
    if (message.type === "joined" && message.playerId && message.roomCode && message.view) {
      handlers.onJoined({
        playerId: message.playerId,
        roomCode: message.roomCode,
        view: message.view,
        seats: message.seats ?? [],
        ...(message.token ? { token: message.token } : {}),
      });
      return;
    }
    if (message.type === "state" && message.view) {
      handlers.onState(message.view, message.seats ?? []);
    }
  });
  socket.addEventListener("close", () => handlers.onClose());
  socket.addEventListener("error", () => handlers.onError("Could not reach the host"));
  return {
    send(action) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "submit", action }));
      }
    },
    sendPreferences(preferences) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "preferences", preferences }));
      }
    },
    close() {
      socket.close();
    },
  };
}
