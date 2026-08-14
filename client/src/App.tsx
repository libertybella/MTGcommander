import { useState } from "react";
import { isGameOver, type GameAction, type GameState } from "@mtgcommander/engine";
import {
  GameHost,
  TABLE_STORAGE_KEY,
  clearTable,
  loadTable,
  saveTable,
  type SnapshotStore,
} from "@mtgcommander/server";
import { startSyntheticTable, type SyntheticPlayerCount } from "./game/syntheticTable";
import { Battlefield, type UiMode } from "./ui/Battlefield";

const emptyStore: SnapshotStore = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

function browserStore(): SnapshotStore {
  try {
    return window.localStorage;
  } catch {
    return emptyStore;
  }
}

function persist(next: GameHost): void {
  saveTable(browserStore(), next);
}

function createHost(playerCount: SyntheticPlayerCount = 2): GameHost {
  const table = startSyntheticTable(playerCount);
  const viewerId = table.players[0]?.id;
  if (!viewerId) {
    throw new Error("Synthetic table is missing a viewer");
  }
  const host = GameHost.start(table, viewerId);
  persist(host);
  return host;
}

type Session = {
  host: GameHost;
  view: GameState;
};

function sessionFrom(host: GameHost): Session {
  return { host, view: host.viewFor(host.getViewerId()) };
}

export default function App() {
  const [session, setSession] = useState<Session | null>(() => {
    const restored = loadTable(browserStore());
    return restored ? sessionFrom(restored) : null;
  });
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<UiMode>({ type: "idle" });
  const bridge = window.mtgCommander;

  function startGame(playerCount: SyntheticPlayerCount = 2) {
    setError(null);
    setMode({ type: "idle" });
    setSession(sessionFrom(createHost(playerCount)));
  }

  if (!session) {
    const hasSave = Boolean(browserStore().getItem(TABLE_STORAGE_KEY));
    return (
      <main className="shell">
        <header>
          <p className="eyebrow">BizzyMTG Commander</p>
          <h1>Synthetic test table</h1>
        </header>
        <p>
          Start the Phase 21 synthetic catalog game. The host keeps
          authoritative GameState; this window shows a player view and sends
          GameActions.
        </p>
        <p className="muted">{bridge?.isElectron ? "Electron shell" : "Browser (Vite)"}</p>
        <div className="actions">
          <button type="button" data-testid="start-game" onClick={() => startGame(2)}>
            Start 2-player game
          </button>
          <button type="button" data-testid="start-4p" onClick={() => startGame(4)}>
            Start 4-player game
          </button>
          {hasSave ? (
            <button
              type="button"
              data-testid="resume-game"
              onClick={() => {
                const restored = loadTable(browserStore());
                if (!restored) {
                  setError("No saved table");
                  return;
                }
                setError(null);
                setMode({ type: "idle" });
                setSession(sessionFrom(restored));
              }}
            >
              Resume saved game
            </button>
          ) : null}
        </div>
      </main>
    );
  }

  const { host, view } = session;
  const viewerId = host.getViewerId();

  return (
    <Battlefield
      state={view}
      viewerId={viewerId}
      error={error}
      mode={mode}
      onMode={setMode}
      onNewGame={() => {
        clearTable(browserStore());
        startGame(2);
      }}
      onAction={(action: GameAction) => {
        const result = host.submit(viewerId, action);
        if (result.ok) {
          persist(host);
          setSession(sessionFrom(host));
          setError(null);
          if (isGameOver(host.viewFor(viewerId))) {
            setMode({ type: "idle" });
          }
        } else {
          setError(result.error);
        }
      }}
    />
  );
}
