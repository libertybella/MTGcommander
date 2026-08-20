import type { GameState, Step } from "@mtgcommander/engine";
import {
  LADDER_STEPS,
  STEP_SHORT_LABELS,
  toggleStop,
  type StopPrefs,
  type StopScope,
} from "./stopPrefs";

type Props = {
  state: GameState;
  prefs: StopPrefs;
  onChange: (prefs: StopPrefs) => void;
};

/**
 * Arena-style phase ladder: one cell per step with the current step
 * highlighted. The two dots under each cell are stops — top row your turn,
 * bottom row opponents' turns; click to toggle. Full control and the yield
 * mode sit at the end of the ladder.
 */
export function PhaseLadder({ state, prefs, onChange }: Props) {
  function toggle(scope: StopScope, step: Step) {
    onChange(toggleStop(prefs, scope, step));
  }

  return (
    <div className="phase-ladder" data-testid="phase-ladder">
      {LADDER_STEPS.map((step) => (
        <div
          key={step}
          className={`ladder-step${state.turn.step === step ? " is-current" : ""}`}
          data-testid={`ladder-${step}`}
        >
          <span className="ladder-label">{STEP_SHORT_LABELS[step]}</span>
          <button
            type="button"
            title={`Stop at ${STEP_SHORT_LABELS[step]} on your turn`}
            aria-pressed={prefs.myTurn.has(step)}
            data-testid={`stop-my-${step}`}
            className={`stop-dot${prefs.myTurn.has(step) ? " is-on" : ""}`}
            onClick={() => toggle("myTurn", step)}
          />
          <button
            type="button"
            title={`Stop at ${STEP_SHORT_LABELS[step]} on opponents' turns`}
            aria-pressed={prefs.theirTurn.has(step)}
            data-testid={`stop-their-${step}`}
            className={`stop-dot their${prefs.theirTurn.has(step) ? " is-on" : ""}`}
            onClick={() => toggle("theirTurn", step)}
          />
        </div>
      ))}
      <label className="ladder-control" title="See every priority window">
        <input
          type="checkbox"
          data-testid="full-control"
          checked={prefs.fullControl}
          onChange={(event) => onChange({ ...prefs, fullControl: event.target.checked })}
        />
        Full control
      </label>
      <label className="ladder-control" title="With a spell on the stack: always pause, or only when you can respond">
        <select
          data-testid="yield-mode"
          value={prefs.yield}
          onChange={(event) =>
            onChange({ ...prefs, yield: event.target.value === "smart" ? "smart" : "stops-only" })
          }
        >
          <option value="stops-only">Always pause on stack</option>
          <option value="smart">Pause only when I can act</option>
        </select>
      </label>
    </div>
  );
}
