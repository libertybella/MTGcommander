/** @vitest-environment happy-dom */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import App from "./App";

afterEach(() => {
  cleanup();
});

function startGame() {
  render(<App />);
  fireEvent.click(screen.getByTestId("start-game"));
}

function passUntil(step: string) {
  let guard = 0;
  while (!screen.getByTestId("turn-step").textContent?.includes(step)) {
    fireEvent.click(screen.getByTestId("pass"));
    guard += 1;
    if (guard > 80) {
      throw new Error(`Could not reach ${step}`);
    }
  }
}

describe("battlefield UI", () => {
  it("starts the synthetic table and renders life, hand, and turn state", () => {
    startGame();
    expect(screen.getByTestId("life-you").textContent).toContain("Life 40");
    expect(screen.getByTestId("life-opponent").textContent).toContain("Life 40");
    expect(within(screen.getByTestId("hand-you")).getAllByRole("button").length).toBe(7);
    expect(screen.getByTestId("turn-step").textContent).toContain("untap");
    expect(screen.getByTestId("priority").textContent).toContain("You");
  });

  it("plays a land, taps it for mana through applyAction, and shows tapped state", () => {
    startGame();
    passUntil("precombatMain");
    const mountain = within(screen.getByTestId("hand-you")).getByText("Test Mountain");
    fireEvent.click(mountain);
    expect(within(screen.getByTestId("battlefield-you")).getByText("Test Mountain")).toBeTruthy();
    fireEvent.click(within(screen.getByTestId("battlefield-you")).getByText("Test Mountain"));
    const land = within(screen.getByTestId("battlefield-you")).getByText("Test Mountain").closest("button");
    expect(land?.getAttribute("data-tapped")).toBe("true");
    expect(screen.getByTestId("mana-you").textContent).toContain("R:1");
  });

  it("casts a supported spell through applyAction", () => {
    startGame();
    passUntil("precombatMain");
    fireEvent.click(within(screen.getByTestId("hand-you")).getByText("Test Mountain"));
    fireEvent.click(within(screen.getByTestId("battlefield-you")).getByText("Test Mountain"));
    fireEvent.click(within(screen.getByTestId("hand-you")).getByText("Test Shock"));
    fireEvent.click(screen.getByTestId("target-opponent"));
    fireEvent.click(screen.getByTestId("pass"));
    fireEvent.click(screen.getByTestId("pass"));
    expect(screen.getByTestId("life-opponent").textContent).toContain("Life 38");
  });

  it("shows game-over after concede and hides play actions", () => {
    startGame();
    fireEvent.click(screen.getByTestId("concede"));
    expect(screen.getByTestId("game-over").textContent).toContain("Opponent");
    expect(screen.queryByTestId("pass")).toBeNull();
    expect(screen.getByTestId("new-game")).toBeTruthy();
  });
});
