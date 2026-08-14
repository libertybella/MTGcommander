/** @vitest-environment happy-dom */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ORACLE_CACHE_KEY } from "@mtgcommander/server";
import App from "./App";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function seedOracleCache() {
  window.localStorage.setItem(
    ORACLE_CACHE_KEY,
    JSON.stringify({
      version: 1,
      cards: {
        forest: {
          oracleId: "forest",
          name: "Forest",
          manaCost: "",
          typeLine: "Basic Land — Forest",
          oracleText: "{T}: Add {G}.",
          power: null,
          toughness: null,
          printedKeywords: [],
        },
        "sol ring": {
          oracleId: "sol",
          name: "Sol Ring",
          manaCost: "{1}",
          typeLine: "Artifact",
          oracleText: "{T}: Add {C}{C}.",
          power: null,
          toughness: null,
          printedKeywords: [],
        },
        "atraxa, praetors' voice": {
          oracleId: "atraxa",
          name: "Atraxa, Praetors' Voice",
          manaCost: "{G}{W}{U}{B}",
          typeLine: "Legendary Creature — Phyrexian Angel Horror",
          oracleText: "Flying, vigilance, deathtouch, lifelink",
          power: "4",
          toughness: "4",
          printedKeywords: ["Flying", "Vigilance", "Deathtouch", "Lifelink"],
        },
      },
    }),
  );
}

function keepOpeningHands() {
  const keep = screen.queryByTestId("keep-hand");
  if (keep) {
    fireEvent.click(keep);
  }
}

function startGame() {
  render(<App />);
  fireEvent.click(screen.getByTestId("start-game"));
  keepOpeningHands();
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
  it("shows a join form on the start screen", () => {
    render(<App />);
    expect(screen.getByTestId("join-table")).toBeTruthy();
    expect(screen.getByTestId("join-code")).toBeTruthy();
  });
  it("starts the synthetic table and renders life, hand, and turn state", () => {
    startGame();
    expect(screen.getByTestId("life-you").textContent).toContain("Life 40");
    expect(screen.getByTestId("life-opponent").textContent).toContain("Life 40");
    expect(within(screen.getByTestId("hand-you")).getAllByRole("button").length).toBe(7);
    expect(screen.getByTestId("turn-step").textContent).toContain("untap");
    expect(screen.getByTestId("priority").textContent).toContain("You");
  });

  it("hides opponent hand identity", () => {
    startGame();
    expect(within(screen.getByTestId("hand-opponent")).queryByText("Test Shock")).toBeNull();
    expect(within(screen.getByTestId("hand-opponent")).getAllByText("Unknown Card").length).toBe(7);
    expect(within(screen.getByTestId("hand-you")).getByText("Test Shock")).toBeTruthy();
  });

  it("plays a land, taps it for mana through the host, and shows tapped state", () => {
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

  it("casts a supported spell through the host", () => {
    startGame();
    passUntil("precombatMain");
    fireEvent.click(within(screen.getByTestId("hand-you")).getByText("Test Mountain"));
    fireEvent.click(within(screen.getByTestId("battlefield-you")).getByText("Test Mountain"));
    fireEvent.click(within(screen.getByTestId("hand-you")).getByText("Test Shock"));
    fireEvent.click(screen.getByTestId("target-opponent"));
    fireEvent.click(screen.getByTestId("pass"));
    expect(screen.getByTestId("life-opponent").textContent).toContain("Life 38");
    expect(screen.getByTestId("game-log").textContent).toMatch(/life -2/);
  });

  it("shows game-over after concede and hides play actions", () => {
    startGame();
    fireEvent.click(screen.getByTestId("concede"));
    expect(screen.getByTestId("game-over").textContent).toContain("Opponent");
    expect(screen.queryByTestId("pass")).toBeNull();
    expect(screen.getByTestId("new-game")).toBeTruthy();
  });

  it("starts a four-player table with three opponent areas", () => {
    render(<App />);
    fireEvent.click(screen.getByTestId("start-4p"));
    expect(screen.getByTestId("area-opponents").querySelectorAll(".player-area.opponent").length).toBe(
      3,
    );
    expect(screen.getByText("Opponent 1")).toBeTruthy();
    expect(screen.getByText("Opponent 3")).toBeTruthy();
  });

  it("starts a three-player table with two opponent areas", () => {
    render(<App />);
    fireEvent.click(screen.getByTestId("start-3p"));
    expect(screen.getByTestId("area-opponents").querySelectorAll(".player-area.opponent").length).toBe(
      2,
    );
    expect(screen.getByText("Opponent 1")).toBeTruthy();
    expect(screen.getByText("Opponent 2")).toBeTruthy();
    expect(screen.queryByText("Opponent 3")).toBeNull();
  });

  it("lets a hotseat opponent take priority instead of auto-passing", () => {
    render(<App />);
    fireEvent.click(screen.getByTestId("hotseat"));
    fireEvent.click(screen.getByTestId("start-game"));
    fireEvent.click(screen.getByTestId("keep-hand"));
    fireEvent.click(screen.getByTestId("play-as-Opponent"));
    fireEvent.click(screen.getByTestId("keep-hand"));
    fireEvent.click(screen.getByTestId("play-as-You"));
    expect(screen.getByTestId("priority").textContent).toContain("You");
    fireEvent.click(screen.getByTestId("pass"));
    expect(screen.getByTestId("priority").textContent).toContain("Opponent");
    expect(screen.getByTestId("turn-step").textContent).toContain("untap");
    fireEvent.click(screen.getByTestId("play-as-Opponent"));
    expect(within(screen.getByTestId("hand-you")).queryByText("Unknown Card")).toBeNull();
    expect(within(screen.getByTestId("hand-opponent")).getAllByText("Unknown Card").length).toBe(7);
  });

  it("takes a London mulligan and bottoms one card", () => {
    render(<App />);
    fireEvent.click(screen.getByTestId("start-game"));
    expect(screen.getByTestId("keep-hand")).toBeTruthy();
    fireEvent.click(screen.getByTestId("take-mulligan"));
    expect(screen.getByTestId("mulligan-hint").textContent).toMatch(/bottom/i);
    const hand = within(screen.getByTestId("hand-you")).getAllByRole("button");
    fireEvent.click(hand[0]!);
    fireEvent.click(screen.getByTestId("confirm-bottom"));
    expect(within(screen.getByTestId("hand-you")).getAllByRole("button").length).toBe(6);
    fireEvent.click(screen.getByTestId("keep-hand"));
    expect(screen.queryByTestId("keep-hand")).toBeNull();
    expect(screen.getByTestId("pass")).toBeTruthy();
  });

  it("loads a pasted Commander list from the local oracle cache", async () => {
    seedOracleCache();
    render(<App />);
    fireEvent.change(screen.getByTestId("decklist-you"), {
      target: {
        value: "Commander\n1 Atraxa, Praetors' Voice\nDeck\n1 Sol Ring\n10 Forest\n",
      },
    });
    fireEvent.click(screen.getByTestId("import-deck"));
    await waitFor(() => {
      expect(within(screen.getByTestId("command-you")).getByText("Atraxa, Praetors' Voice")).toBeTruthy();
    });
    expect(screen.getByTestId("life-you").textContent).toContain("Life 40");
  });

  it("loads a three-player imported table by mirroring the pasted list", async () => {
    seedOracleCache();
    render(<App />);
    fireEvent.click(screen.getByTestId("import-size-3"));
    fireEvent.change(screen.getByTestId("decklist-you"), {
      target: {
        value: "Commander\n1 Atraxa, Praetors' Voice\nDeck\n1 Sol Ring\n10 Forest\n",
      },
    });
    fireEvent.click(screen.getByTestId("import-deck"));
    await waitFor(() => {
      expect(within(screen.getByTestId("command-you")).getByText("Atraxa, Praetors' Voice")).toBeTruthy();
    });
    expect(screen.getByTestId("area-opponents").querySelectorAll(".player-area.opponent").length).toBe(
      2,
    );
    expect(screen.getByText("Opponent 1")).toBeTruthy();
    expect(screen.getByText("Opponent 2")).toBeTruthy();
  });

  it("restores a saved table after remount", () => {
    startGame();
    fireEvent.click(screen.getByTestId("concede"));
    cleanup();
    render(<App />);
    expect(screen.getByTestId("game-over").textContent).toContain("Opponent");
  });
});
