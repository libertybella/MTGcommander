import { useState } from "react";
import { isGameOver, type GameAction, type GameState } from "@mtgcommander/engine";
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

function hostFromState(state: GameState): GameHost {
  const viewerId = state.players[0]?.id;
  if (!viewerId) {
    throw new Error("Imported table is missing a viewer");
  }
  const host = GameHost.start(state, viewerId);
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
  const [opponentUrl, setOpponentUrl] = useState("");
  const [youList, setYouList] = useState("");
  const [loading, setLoading] = useState(false);
  const bridge = window.mtgCommander;

  function startGame(playerCount: SyntheticPlayerCount = 2) {
    setError(null);
    setNotes([]);
    setMode({ type: "idle" });
    setSession(sessionFrom(createHost(playerCount)));
  }

  async function loadImported(you: CompiledDeck, opponent: CompiledDeck) {
    const table = startImportedTable({ you, opponent });
    setNotes(formatNotes(table.notes));
    setError(null);
    setMode({ type: "idle" });
    setSession(sessionFrom(hostFromState(table.state)));
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
      const opponent = opponentUrl.trim()
        ? await importMoxfieldDeck(db, fetchImpl, opponentUrl.trim())
        : you;
      await loadImported(you.compiled, opponent.compiled);
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
        <section className="import-panel">
          <h2>Load a Moxfield / text deck</h2>
          <label>
            Your Moxfield URL
            <input
              data-testid="moxfield-you"
              value={youUrl}
              onChange={(event) => setYouUrl(event.target.value)}
              placeholder="https://www.moxfield.com/decks/..."
            />
          </label>
          <label>
            Opponent Moxfield URL (optional — mirrors your deck if empty)
            <input
              data-testid="moxfield-opponent"
              value={opponentUrl}
              onChange={(event) => setOpponentUrl(event.target.value)}
              placeholder="https://www.moxfield.com/decks/..."
            />
          </label>
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
