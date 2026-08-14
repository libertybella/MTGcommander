import { useState } from "react";
import { isGameOver, type GameAction, type GameState, type PlayerId, type TablePlayerCount } from "@mtgcommander/engine";
import {
  GameHost,
  TABLE_STORAGE_KEY,
  clearTable,
  importMoxfieldDeck,
  importTextDeck,
  loadTable,
  saveTable,
  startImportedTable,
  type CompiledDeck,
} from "@mtgcommander/server";
import { cardDatabase, hostFetch } from "./game/cardDatabase";
import { browserStore } from "./game/storage";
import { startSyntheticTable, type SyntheticPlayerCount } from "./game/syntheticTable";
import { Battlefield, type UiMode } from "./ui/Battlefield";

function persist(next: GameHost): void {
  saveTable(browserStore(), next);
}

function createHost(playerCount: SyntheticPlayerCount = 2, hotseat = false): GameHost {
  const table = startSyntheticTable(playerCount);
  const viewerId = table.players[0]?.id;
  if (!viewerId) {
    throw new Error("Synthetic table is missing a viewer");
  }
  const host = GameHost.start(table, viewerId, { hotseat });
  persist(host);
  return host;
}

function hostFromState(state: GameState, hotseat = false): GameHost {
  const viewerId = state.players[0]?.id;
  if (!viewerId) {
    throw new Error("Imported table is missing a viewer");
  }
  const host = GameHost.start(state, viewerId, { hotseat });
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

function formatNotes(notes: { player: string; cards: { name: string; notes: string[] }[] }[]): string[] {
  const lines: string[] = [];
  for (const group of notes) {
    for (const card of group.cards) {
      for (const note of card.notes) {
        lines.push(`${group.player}: ${card.name} — ${note}`);
      }
    }
  }
  return lines;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(() => {
    const restored = loadTable(browserStore());
    return restored ? sessionFrom(restored) : null;
  });
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<UiMode>({ type: "idle" });
  const [notes, setNotes] = useState<string[]>([]);
  const [youUrl, setYouUrl] = useState("");
  const [opponentUrls, setOpponentUrls] = useState(["", "", ""]);
  const [youList, setYouList] = useState("");
  const [loading, setLoading] = useState(false);
  const [hotseat, setHotseat] = useState(false);
  const [importCount, setImportCount] = useState<TablePlayerCount>(2);
  const bridge = window.mtgCommander;

  function startGame(playerCount: SyntheticPlayerCount = 2) {
    setError(null);
    setNotes([]);
    setMode({ type: "idle" });
    setSession(sessionFrom(createHost(playerCount, hotseat)));
  }

  async function loadImported(decks: CompiledDeck[]) {
    const table = startImportedTable({ decks });
    setNotes(formatNotes(table.notes));
    setError(null);
    setMode({ type: "idle" });
    setSession(sessionFrom(hostFromState(table.state, hotseat)));
  }

  function setOpponentUrl(index: number, value: string) {
    setOpponentUrls((current) => current.map((entry, entryIndex) => (entryIndex === index ? value : entry)));
  }

  async function importDecks() {
    setLoading(true);
    setError(null);
    try {
      const db = cardDatabase();
      const fetchImpl = hostFetch();
      const youSource = youUrl.trim() || youList.trim();
      if (!youSource) {
        throw new Error("Paste a Moxfield URL or a Commander decklist.");
      }
      const you = youUrl.trim()
        ? await importMoxfieldDeck(db, fetchImpl, youUrl.trim())
        : await importTextDeck(db, youList);
      const decks: CompiledDeck[] = [you.compiled];
      for (let index = 0; index < importCount - 1; index += 1) {
        const url = opponentUrls[index]?.trim();
        const compiled = url
          ? (await importMoxfieldDeck(db, fetchImpl, url)).compiled
          : you.compiled;
        decks.push(compiled);
      }
      await loadImported(decks);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Import failed");
    } finally {
      setLoading(false);
    }
  }

  if (!session) {
    const hasSave = Boolean(browserStore().getItem(TABLE_STORAGE_KEY));
    return (
      <main className="shell">
        <header>
          <p className="eyebrow">BizzyMTG Commander</p>
          <h1>Commander table</h1>
        </header>
        <p>
          Start a synthetic test game, or load a real Commander deck from a
          public Moxfield URL or pasted list. Oracle data comes from Scryfall
          and is cached locally. Unsupported card text is listed after load.
        </p>
        <p className="muted">{bridge?.isElectron ? "Electron shell" : "Browser (Vite)"}</p>
        {error ? (
          <p className="action-error" data-testid="action-error">
            {error}
          </p>
        ) : null}
        <div className="actions">
          <button type="button" data-testid="start-game" onClick={() => startGame(2)}>
            Start 2-player synthetic
          </button>
          <button type="button" data-testid="start-3p" onClick={() => startGame(3)}>
            Start 3-player synthetic
          </button>
          <button type="button" data-testid="start-4p" onClick={() => startGame(4)}>
            Start 4-player synthetic
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
                setNotes([]);
                setMode({ type: "idle" });
                setSession(sessionFrom(restored));
              }}
            >
              Resume saved game
            </button>
          ) : null}
        </div>
        <label className="hotseat-toggle">
          <input
            type="checkbox"
            data-testid="hotseat"
            checked={hotseat}
            onChange={(event) => setHotseat(event.target.checked)}
          />
          Local hotseat — every player acts at this PC (no auto-pass)
        </label>
        <section className="import-panel">
          <h2>Load a Moxfield / text deck</h2>
          <div className="table-size" data-testid="import-player-count">
            {([2, 3, 4] as const).map((count) => (
              <button
                key={count}
                type="button"
                data-testid={`import-size-${count}`}
                className={importCount === count ? "is-selected" : ""}
                onClick={() => setImportCount(count)}
              >
                {count} players
              </button>
            ))}
          </div>
          <label>
            Your Moxfield URL
            <input
              data-testid="moxfield-you"
              value={youUrl}
              onChange={(event) => setYouUrl(event.target.value)}
              placeholder="https://www.moxfield.com/decks/..."
            />
          </label>
          {Array.from({ length: importCount - 1 }, (_, index) => (
            <label key={index}>
              {importCount === 2
                ? "Opponent Moxfield URL (optional — mirrors your deck if empty)"
                : `Opponent ${index + 1} Moxfield URL (optional — mirrors you if empty)`}
              <input
                data-testid={`moxfield-opponent-${index}`}
                value={opponentUrls[index] ?? ""}
                onChange={(event) => setOpponentUrl(index, event.target.value)}
                placeholder="https://www.moxfield.com/decks/..."
              />
            </label>
          ))}
          <label>
            Or paste a Commander list
            <textarea
              data-testid="decklist-you"
              value={youList}
              onChange={(event) => setYouList(event.target.value)}
              rows={8}
              placeholder={"Commander\n1 Atraxa, Praetors' Voice\n\nDeck\n1 Sol Ring\n99 Forest"}
            />
          </label>
          <button
            type="button"
            data-testid="import-deck"
            disabled={loading}
            onClick={() => {
              void importDecks();
            }}
          >
            {loading ? "Loading…" : "Load deck and start"}
          </button>
          <p className="muted">
            Moxfield URL import uses Electron to avoid browser CORS. In a
            plain browser window, paste the exported list instead.
          </p>
        </section>
      </main>
    );
  }

  const { host, view } = session;
  const viewerId = host.getViewerId();
  const seatedIds = host.getSeatedPlayerIds();
  const hotseatTable = seatedIds.length > 1;

  function switchSeat(playerId: PlayerId) {
    host.setViewer(playerId);
    persist(host);
    setMode({ type: "idle" });
    setSession(sessionFrom(host));
    setError(null);
  }

  return (
    <>
      {notes.length > 0 ? (
        <aside className="import-notes" data-testid="import-notes">
          <p>Unsupported oracle text (cards still sit in the deck):</p>
          <ul>
            {notes.slice(0, 20).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {notes.length > 20 ? <p className="muted">…and {notes.length - 20} more.</p> : null}
        </aside>
      ) : null}
      {hotseatTable ? (
        <div className="seat-switcher" data-testid="seat-switcher">
          {view.players.map((player) => (
            <button
              key={player.id}
              type="button"
              data-testid={`play-as-${player.displayName}`}
              className={player.id === viewerId ? "is-selected" : ""}
              onClick={() => switchSeat(player.id)}
            >
              Play as {player.displayName}
            </button>
          ))}
        </div>
      ) : null}
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
    </>
  );
}
