export default function App() {
  const bridge = window.mtgCommander;

  return (
    <main className="shell">
      <header>
        <p className="eyebrow">BizzyMTG Commander</p>
        <h1>Project foundation</h1>
      </header>
      <p>
        Phase 1 scaffold only. No game state, networking, or battlefield lives
        here yet.
      </p>
      <dl>
        <div className="row">
          <dt>Shell</dt>
          <dd>{bridge?.isElectron ? "Electron" : "Browser (Vite)"}</dd>
        </div>
        <div className="row">
          <dt>UI</dt>
          <dd>React + Vite client</dd>
        </div>
        <div className="row">
          <dt>Next</dt>
          <dd>Phase 2 — GameState in the engine package</dd>
        </div>
      </dl>
    </main>
  );
}
