import { networkInterfaces } from "node:os";
import { WebSocketServer, type WebSocket } from "ws";
import {
  parseGameAction,
  type GameAction,
  type GameState,
  type PlayerId,
} from "@mtgcommander/engine";
import { GameHost, type SeatPreferencesInput } from "./session";

export const DEFAULT_WS_PORT = 8787;

export type SeatInfo = {
  playerId: PlayerId;
  displayName: string;
  connected: boolean;
};

export type HostListenInfo = {
  port: number;
  roomCode: string;
  addresses: string[];
};

type ClientMessage =
  | { type: "join"; roomCode: string; displayName: string; playerId?: PlayerId }
  | { type: "submit"; action: GameAction }
  | { type: "preferences"; preferences: SeatPreferencesInput };

const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function createRoomCode(random: () => number = Math.random): string {
  let code = "";
  for (let index = 0; index < 6; index += 1) {
    const pick = Math.floor(random() * ROOM_ALPHABET.length);
    code += ROOM_ALPHABET[pick] ?? "A";
  }
  return code;
}

export function lanAddresses(): string[] {
  const addresses: string[] = [];
  for (const addrs of Object.values(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === "IPv4" && !addr.internal) {
        addresses.push(addr.address);
      }
    }
  }
  return addresses;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseClientMessage(raw: string): ClientMessage {
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new Error("Invalid message");
  }
  if (value.type === "join") {
    if (typeof value.roomCode !== "string" || typeof value.displayName !== "string") {
      throw new Error("Join needs a room code and display name");
    }
    return {
      type: "join",
      roomCode: value.roomCode,
      displayName: value.displayName,
      ...(typeof value.playerId === "string" ? { playerId: value.playerId } : {}),
    };
  }
  if (value.type === "submit") {
    return {
      type: "submit",
      action: parseGameAction(JSON.stringify(value.action)),
    };
  }
  if (value.type === "preferences") {
    if (!isRecord(value.preferences)) {
      throw new Error("Preferences need a preferences object");
    }
    return {
      type: "preferences",
      preferences: value.preferences as SeatPreferencesInput,
    };
  }
  throw new Error("Unknown message");
}

function send(socket: WebSocket, payload: unknown): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

export class GameServer {
  private wss: WebSocketServer | null = null;
  private host: GameHost | null = null;
  private roomCode = "";
  private readonly sockets = new Map<WebSocket, PlayerId>();
  private unsubscribe: (() => void) | null = null;

  attach(host: GameHost, roomCode = createRoomCode()): string {
    this.detachHost();
    this.host = host;
    this.roomCode = roomCode;
    this.unsubscribe = host.subscribe(() => this.broadcast());
    return roomCode;
  }

  listen(port = DEFAULT_WS_PORT): Promise<HostListenInfo> {
    if (!this.host) {
      return Promise.reject(new Error("Attach a GameHost before listening"));
    }
    if (this.wss) {
      return Promise.reject(new Error("Server is already listening"));
    }
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({ host: "0.0.0.0", port });
      this.wss = wss;
      wss.on("error", (error) => {
        this.wss = null;
        reject(error);
      });
      wss.on("listening", () => {
        const address = wss.address();
        const actual = typeof address === "object" && address ? address.port : port;
        resolve({
          port: actual,
          roomCode: this.roomCode,
          addresses: lanAddresses(),
        });
      });
      wss.on("connection", (socket) => {
        socket.on("message", (data) => {
          this.handleMessage(socket, data.toString());
        });
        socket.on("close", () => {
          this.sockets.delete(socket);
          this.broadcast();
        });
      });
    });
  }

  async stop(): Promise<void> {
    this.detachHost();
    for (const socket of this.sockets.keys()) {
      socket.close();
    }
    this.sockets.clear();
    const wss = this.wss;
    this.wss = null;
    if (!wss) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      wss.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  private detachHost(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.host = null;
    this.roomCode = "";
  }

  private players(): GameState["players"] {
    if (!this.host) {
      return [];
    }
    return this.host.viewFor(this.host.getViewerId()).players;
  }

  private seats(): SeatInfo[] {
    const connected = new Set(this.sockets.values());
    return this.players().map((player) => ({
      playerId: player.id,
      displayName: player.displayName,
      connected: connected.has(player.id),
    }));
  }

  private handleMessage(socket: WebSocket, raw: string): void {
    try {
      const message = parseClientMessage(raw);
      if (message.type === "join") {
        this.handleJoin(socket, message);
        return;
      }
      if (message.type === "preferences") {
        this.handlePreferences(socket, message.preferences);
        return;
      }
      this.handleSubmit(socket, message.action);
    } catch (error) {
      send(socket, {
        type: "error",
        message: error instanceof Error ? error.message : "Invalid message",
      });
    }
  }

  private handleJoin(
    socket: WebSocket,
    message: Extract<ClientMessage, { type: "join" }>,
  ): void {
    if (!this.host) {
      throw new Error("No table is hosted");
    }
    if (message.roomCode.trim().toUpperCase() !== this.roomCode) {
      throw new Error("Wrong room code");
    }
    const players = this.players();
    const taken = new Set<PlayerId>();
    for (const [existing, id] of this.sockets) {
      if (existing !== socket) {
        taken.add(id);
      }
    }
    let playerId = message.playerId;
    if (playerId) {
      if (!players.some((player) => player.id === playerId)) {
        throw new Error("Unknown player");
      }
    } else {
      const free = players.find((player) => !taken.has(player.id));
      if (!free) {
        throw new Error("Table is full");
      }
      playerId = free.id;
    }
    for (const [existing, id] of this.sockets) {
      if (id === playerId && existing !== socket) {
        existing.close();
        this.sockets.delete(existing);
      }
    }
    this.sockets.set(socket, playerId);
    this.host.seatPlayer(playerId);
    const name = message.displayName.trim();
    if (name) {
      this.host.renamePlayer(playerId, name);
    }
    send(socket, {
      type: "joined",
      roomCode: this.roomCode,
      playerId,
      view: this.host.viewFor(playerId),
      seats: this.seats(),
    });
    this.broadcast();
  }

  private handlePreferences(socket: WebSocket, preferences: SeatPreferencesInput): void {
    const playerId = this.sockets.get(socket);
    if (!playerId || !this.host) {
      throw new Error("Join the table first");
    }
    this.host.setPreferences(playerId, preferences);
  }

  private handleSubmit(socket: WebSocket, action: GameAction): void {
    const playerId = this.sockets.get(socket);
    if (!playerId || !this.host) {
      throw new Error("Join the table first");
    }
    const result = this.host.submit(playerId, action);
    if (!result.ok) {
      send(socket, { type: "error", message: result.error });
    }
  }

  private broadcast(): void {
    if (!this.host) {
      return;
    }
    for (const [socket, playerId] of this.sockets) {
      send(socket, {
        type: "state",
        view: this.host.viewFor(playerId),
        seats: this.seats(),
      });
    }
  }
}
