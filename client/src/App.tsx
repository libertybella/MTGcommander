import { useState } from "react";
import { isGameOver, type GameState } from "@mtgcommander/engine";
import { dispatchAction } from "./game/dispatch";
import { startSyntheticTable } from "./game/syntheticTable";
import { Battlefield, type UiMode } from "./ui/Battlefield";

export default function App() {
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<UiMode>({ type: "idle" });
  const bridge = window.mtgCommander;

  function startGame() {
    setState(startSyntheticTable());
    setError(null);
    setMode({ type: "idle" });
  }

  if (!state) {
    return (
      <main className="shell">
        <header>
          <p className="eyebrow">BizzyMTG Commander</p>
          <h1>Synthetic test table</h1>
        </header>
        <p>
          Start the Phase 21 synthetic catalog game. The engine stays
          authoritative; this window only displays GameState and sends
          applyAction.
        </p>
        <p className="muted">{bridge?.isElectron ? "Electron shell" : "Browser (Vite)"}</p>
        <button type="button" data-testid="start-game" onClick={startGame}>
          Start synthetic game
        </button>
      </main>
    );
  }

  const viewerId = state.players[0]?.id;
  if (!viewerId) {
    return <p>Game is missing players.</p>;
  }

  return (
    <Battlefield
      state={state}
      viewerId={viewerId}
      error={error}
      mode={mode}
      onMode={setMode}
      onNewGame={startGame}
      onAction={(action) => {
        const result = dispatchAction(state, action);
        if (result.ok) {
          setState(result.state);
          setError(null);
          if (isGameOver(result.state)) {
            setMode({ type: "idle" });
          }
        } else {
          setError(result.error);
        }
      }}
    />
  );
}
