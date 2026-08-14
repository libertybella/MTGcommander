import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { POOL_ID, startCatalogGame, type GameState } from "@mtgcommander/engine";
import { GameHost } from "./session";
import { GameServer } from "./realtime";

function catalogTable() {
  const library = [
    POOL_ID.mountain,
    POOL_ID.shock,
    POOL_ID.forest,
    POOL_ID.bear,
    POOL_ID.plains,
    POOL_ID.gift,
    POOL_ID.island,
  ];
  const state = startCatalogGame({
    playerCount: 2,
    playerNames: ["You", "Opponent"],
    skipMulligan: true,
    openingHandSize: 7,
    decks: [
      { commanderDefinitionId: POOL_ID.dragon, libraryDefinitionIds: library },
      { commanderDefinitionId: POOL_ID.dragon, libraryDefinitionIds: library },
    ],
  });
  const you = state.players[0]?.id;
  const them = state.players[1]?.id;
  if (!you || !them) {
    throw new Error("need players");
  }
  return { host: GameHost.start(state, you), you, them };
}

function waitFor(
  socket: WebSocket,
  type: string,
  match?: (message: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), 4000);
    const onMessage = (data: { toString(): string }) => {
      const parsed = JSON.parse(data.toString()) as Record<string, unknown>;
      if (parsed.type === "error" && type !== "error") {
        clearTimeout(timer);
        socket.off("message", onMessage);
        reject(new Error(String(parsed.message)));
        return;
      }
      if (parsed.type !== type || (match && !match(parsed))) {
        return;
      }
      clearTimeout(timer);
      socket.off("message", onMessage);
      resolve(parsed);
    };
    socket.on("message", onMessage);
  });
}

async function openSocket(url: string): Promise<WebSocket> {
  const socket = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
  return socket;
}

describe("websocket game server", () => {
  let server: GameServer | null = null;
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    for (const socket of sockets) {
      socket.close();
    }
    sockets.length = 0;
    if (server) {
      await server.stop();
      server = null;
    }
  });

  it("lets a second client join by room code and receive a redacted view", async () => {
    const { host, you } = catalogTable();
    server = new GameServer();
    const roomCode = server.attach(host, "ROOM01");
    const info = await server.listen(0);
    const hostSocket = await openSocket(`ws://127.0.0.1:${info.port}`);
    sockets.push(hostSocket);
    const joinedHost = waitFor(hostSocket, "joined");
    hostSocket.send(
      JSON.stringify({
        type: "join",
        roomCode,
        displayName: "You",
        playerId: you,
      }),
    );
    const hostHello = await joinedHost;
    expect(hostHello.playerId).toBe(you);

    const friendSocket = await openSocket(`ws://127.0.0.1:${info.port}`);
    sockets.push(friendSocket);
    const joinedFriend = waitFor(friendSocket, "joined");
    friendSocket.send(
      JSON.stringify({
        type: "join",
        roomCode,
        displayName: "Friend",
      }),
    );
    const friendHello = await joinedFriend;
    expect(friendHello.playerId).not.toBe(you);
    const view = friendHello.view as GameState;
    const youPlayer = view.players.find((player) => player.id === you);
    const hidden = youPlayer?.zones.hand[0];
    expect(view.cards[hidden ?? ""]?.definitionId).toBe("def-hidden");
  });

  it("forwards a pass from the host to the joined friend", async () => {
    const { host, you } = catalogTable();
    server = new GameServer();
    server.attach(host, "ROOM02");
    const info = await server.listen(0);
    const hostSocket = await openSocket(`ws://127.0.0.1:${info.port}`);
    const friendSocket = await openSocket(`ws://127.0.0.1:${info.port}`);
    sockets.push(hostSocket, friendSocket);

    const hostJoined = waitFor(hostSocket, "joined");
    hostSocket.send(JSON.stringify({ type: "join", roomCode: "ROOM02", displayName: "You", playerId: you }));
    await hostJoined;

    const friendJoined = waitFor(friendSocket, "joined");
    friendSocket.send(JSON.stringify({ type: "join", roomCode: "ROOM02", displayName: "Friend" }));
    const friendHello = await friendJoined;
    const friendId = friendHello.playerId;
    expect(typeof friendId).toBe("string");

    const friendState = waitFor(
      friendSocket,
      "state",
      (message) => (message.view as GameState).priorityPlayerId === friendId,
    );
    hostSocket.send(
      JSON.stringify({
        type: "submit",
        action: { kind: "pass_priority", playerId: you },
      }),
    );
    const update = await friendState;
    const view = update.view as GameState;
    expect(view.priorityPlayerId).toBe(friendId);
  });
});
