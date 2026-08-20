import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import {
  POOL_ID,
  createCardDefinition,
  createCardInstance,
  createGameState,
  startCatalogGame,
  type GameState,
} from "@mtgcommander/engine";
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
      (message) => (message.view as GameState).turn.step === "upkeep",
    );
    hostSocket.send(
      JSON.stringify({
        type: "submit",
        action: { kind: "pass_priority", playerId: you },
      }),
    );
    const update = await friendState;
    const view = update.view as GameState;
    expect(view.turn.step).toBe("upkeep");
    expect(view.priorityPlayerId).toBe(you);
  });

  it("a joined friend with an end-step stop casts flash on the host's turn", async () => {
    const state = createGameState({ playerCount: 2 });
    const you = state.players[0]!.id;
    const them = state.players[1]!.id;
    const filler = createCardDefinition({ name: "Test Filler", typeLine: "Instant" });
    state.definitions[filler.id] = filler;
    for (const player of state.players) {
      for (let i = 0; i < 8; i += 1) {
        const card = createCardInstance({ definitionId: filler.id, ownerId: player.id, zone: "library" });
        state.cards[card.id] = card;
        player.zones.library.push(card.id);
      }
    }
    const islandDef = createCardDefinition({
      name: "Test Island",
      typeLine: "Basic Land — Island",
      produces: { U: 1 },
    });
    const trickDef = createCardDefinition({
      name: "Test Trick",
      typeLine: "Instant",
      manaCost: "{U}",
      effects: [{ kind: "draw", playerId: "controller", count: 1 }],
    });
    state.definitions[islandDef.id] = islandDef;
    state.definitions[trickDef.id] = trickDef;
    const islandCard = createCardInstance({ definitionId: islandDef.id, ownerId: them, zone: "battlefield", summoningSick: false });
    const trickCard = createCardInstance({ definitionId: trickDef.id, ownerId: them, zone: "hand" });
    state.cards[islandCard.id] = islandCard;
    state.cards[trickCard.id] = trickCard;
    state.players[1]!.zones.battlefield.push(islandCard.id);
    state.players[1]!.zones.hand.push(trickCard.id);
    state.turn.phase = "ending";
    state.turn.step = "end";
    state.priorityPlayerId = you;

    server = new GameServer();
    server.attach(GameHost.start(state, you), "ROOM03");
    const info = await server.listen(0);
    const hostSocket = await openSocket(`ws://127.0.0.1:${info.port}`);
    const friendSocket = await openSocket(`ws://127.0.0.1:${info.port}`);
    sockets.push(hostSocket, friendSocket);

    const hostJoined = waitFor(hostSocket, "joined");
    hostSocket.send(JSON.stringify({ type: "join", roomCode: "ROOM03", displayName: "You", playerId: you }));
    await hostJoined;
    const friendJoined = waitFor(friendSocket, "joined");
    friendSocket.send(JSON.stringify({ type: "join", roomCode: "ROOM03", displayName: "Friend", playerId: them }));
    await friendJoined;

    friendSocket.send(
      JSON.stringify({ type: "preferences", preferences: { stops: { theirTurn: ["end"] } } }),
    );
    // Preferences produce no reply; the next state broadcast proves the hold.
    const held = waitFor(
      friendSocket,
      "state",
      (message) =>
        (message.view as GameState).turn.step === "end" &&
        (message.view as GameState).priorityPlayerId === them,
    );
    hostSocket.send(
      JSON.stringify({ type: "submit", action: { kind: "pass_priority", playerId: you } }),
    );
    await held;

    const tapped = waitFor(
      friendSocket,
      "state",
      (message) => (message.view as GameState).players[1]!.mana.U === 1,
    );
    friendSocket.send(
      JSON.stringify({
        type: "submit",
        action: { kind: "tap_for_mana", playerId: them, cardId: islandCard.id },
      }),
    );
    await tapped;

    const stacked = waitFor(
      friendSocket,
      "state",
      (message) => (message.view as GameState).stack.length === 1,
    );
    friendSocket.send(
      JSON.stringify({
        type: "submit",
        action: { kind: "cast_spell", playerId: them, cardId: trickCard.id },
      }),
    );
    const update = await stacked;
    const view = update.view as GameState;
    expect(view.turn.step).toBe("end");
    expect(view.stack[0]?.sourceId).toBe(trickCard.id);
  });
});

describe("Stage 7: session hardening", () => {
  let server2: GameServer | null = null;
  const sockets2: WebSocket[] = [];

  afterEach(async () => {
    for (const socket of sockets2) {
      socket.close();
    }
    sockets2.length = 0;
    if (server2) {
      await server2.stop();
      server2 = null;
    }
  });

  it("issues seat tokens and refuses a claimed seat without one", async () => {
    const { host, you } = catalogTable();
    server2 = new GameServer();
    server2.attach(host, "ROOM04");
    const info = await server2.listen(0);
    const first = await openSocket(`ws://127.0.0.1:${info.port}`);
    sockets2.push(first);
    const joined = waitFor(first, "joined");
    first.send(JSON.stringify({ type: "join", roomCode: "ROOM04", displayName: "You", playerId: you }));
    const hello = await joined;
    expect(typeof hello.token).toBe("string");

    const intruder = await openSocket(`ws://127.0.0.1:${info.port}`);
    sockets2.push(intruder);
    const refused = waitFor(intruder, "error");
    intruder.send(
      JSON.stringify({ type: "join", roomCode: "ROOM04", displayName: "Sneak", playerId: you }),
    );
    const error = await refused;
    expect(String(error.message)).toMatch(/seat token/);

    // Rejoining with the token succeeds (and bumps the old socket).
    const rejoin = await openSocket(`ws://127.0.0.1:${info.port}`);
    sockets2.push(rejoin);
    const rejoined = waitFor(rejoin, "joined");
    rejoin.send(
      JSON.stringify({
        type: "join",
        roomCode: "ROOM04",
        displayName: "You again",
        playerId: you,
        token: hello.token,
      }),
    );
    expect((await rejoined).playerId).toBe(you);
  });

  it("seats spectators with fully hidden hands and refuses their actions", async () => {
    const { host, you } = catalogTable();
    server2 = new GameServer();
    server2.attach(host, "ROOM05");
    const info = await server2.listen(0);
    const watcher = await openSocket(`ws://127.0.0.1:${info.port}`);
    sockets2.push(watcher);
    const joined = waitFor(watcher, "joined");
    watcher.send(JSON.stringify({ type: "join", roomCode: "ROOM05", displayName: "Railbird", spectate: true }));
    const hello = await joined;
    expect(hello.spectator).toBe(true);
    const view = hello.view as GameState;
    const anyHand = view.players[0]!.zones.hand[0]!;
    expect(view.cards[anyHand]?.definitionId).toBe("def-hidden");

    const refused = waitFor(watcher, "error");
    watcher.send(
      JSON.stringify({ type: "submit", action: { kind: "pass_priority", playerId: you } }),
    );
    expect(String((await refused).message)).toMatch(/Spectators/);
  });

  it("refuses a client with a mismatched engine version", async () => {
    const { host } = catalogTable();
    server2 = new GameServer();
    server2.attach(host, "ROOM06");
    const info = await server2.listen(0);
    const outdated = await openSocket(`ws://127.0.0.1:${info.port}`);
    sockets2.push(outdated);
    const refused = waitFor(outdated, "error");
    outdated.send(
      JSON.stringify({ type: "join", roomCode: "ROOM06", displayName: "Old", engine: "0.0.0-old" }),
    );
    expect(String((await refused).message)).toMatch(/Version mismatch/);
  });
});
