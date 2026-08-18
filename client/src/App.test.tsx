/** @vitest-environment happy-dom */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ORACLE_CACHE_KEY } from "@mtgcommander/server";
import App from "./App";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

function seedOracleCache() {
  window.localStorage.setItem(
    ORACLE_CACHE_KEY,
    JSON.stringify({
      version: 3,
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
        "command tower": {
          oracleId: "tower",
          name: "Command Tower",
          manaCost: "",
          typeLine: "Land",
          oracleText: "{T}: Add one mana of any color in your commander's color identity.",
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

function switchHotseatSeat(): boolean {
  const switcher = screen.queryByTestId("seat-switcher");
  if (!switcher) {
    return false;
  }
  const buttons = within(switcher).getAllByRole("button");
  if (buttons.length === 0) {
    return false;
  }
  const current = buttons.findIndex((button) => button.className.includes("is-selected"));
  const next = buttons[(current + 1 + buttons.length) % buttons.length];
  if (!next) {
    return false;
  }
  fireEvent.click(next);
  return true;
}

function finishOpeningRolls() {
  let guard = 0;
  while (guard < 24) {
    const roll = screen.queryByTestId("roll-first");
    if (roll) {
      fireEvent.click(roll);
      guard += 1;
      continue;
    }
    if (
      screen.queryByTestId("keep-hand") ||
      screen.queryByTestId("take-mulligan") ||
      screen.queryByTestId("pass")
    ) {
      return;
    }
    if (screen.queryByTestId("roll-first-wait") && switchHotseatSeat()) {
      guard += 1;
      continue;
    }
    return;
  }
}

function keepOpeningHands() {
  let guard = 0;
  while (guard < 24) {
    const keep = screen.queryByTestId("keep-hand");
    if (keep) {
      fireEvent.click(keep);
      guard += 1;
      continue;
    }
    if (screen.queryByTestId("pass") || screen.queryByTestId("new-game")) {
      return;
    }
    if (switchHotseatSeat()) {
      guard += 1;
      continue;
    }
    return;
  }
}

function startGame() {
  render(<App />);
  const random = vi.spyOn(Math, "random");
  random.mockReturnValueOnce(0.999).mockReturnValueOnce(0);
  fireEvent.click(screen.getByTestId("start-game"));
  finishOpeningRolls();
  keepOpeningHands();
  random.mockRestore();
}

function openPlayerOptions() {
  fireEvent.click(screen.getByTestId("player-toggle"));
}

function passUntil(step: string) {
  let guard = 0;
  while (true) {
    const onStep = screen.getByTestId("turn-step").textContent?.includes(step);
    const ourTurn = screen.getByTestId("hand-you").className.includes("is-active-turn");
    if (onStep && ourTurn) {
      return;
    }
    const pass = screen.queryByTestId("pass");
    if (pass && !(pass as HTMLButtonElement).disabled) {
      fireEvent.click(pass);
    } else {
      if (screen.getByTestId("host-controls").hidden) {
        fireEvent.click(screen.getByTestId("host-toggle"));
      }
      const skip = screen.getByTestId("host-next-action");
      if ((skip as HTMLButtonElement).disabled) {
        throw new Error(`Could not reach ${step}`);
      }
      fireEvent.click(skip);
    }
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
    expect(screen.getByTestId("turn-step").textContent).toContain("upkeep");
    expect(screen.getByTestId("priority").textContent).toContain("Player 1");
    expect(screen.getByTestId("pass").textContent).toBe("Draw a card");
    expect(screen.getByTestId("area-opponent").getAttribute("data-seat")).toBe("north");
    expect(screen.getByTestId("hand-you").className).toMatch(/is-active-turn/);
    expect(screen.getByTestId("pile-library-you").className).not.toMatch(/is-empty/);
    expect(screen.getByTestId("pile-exile-you").className).toMatch(/is-empty/);
    expect(screen.getByTestId("pile-graveyard-you").className).toMatch(/is-empty/);
    expect(screen.getByTestId("pile-exile-opponent").className).toMatch(/is-empty/);
    expect(screen.getByTestId("pile-graveyard-opponent").className).toMatch(/is-empty/);
    expect(screen.getByTestId("pile-library-opponent").className).not.toMatch(/is-empty/);
    expect(screen.getByTestId("command-opponent-tax").textContent).toBe("Tax = 0");
    expect(screen.getByTestId("log-toggle").textContent).toBe("Log");
    expect(screen.getByTestId("host-toggle").textContent).toBe("Host");
    expect(screen.getByTestId("player-toggle").textContent).toBe("Player");
    expect(screen.getByTestId("host-controls").hidden).toBe(true);
    expect(screen.getByTestId("host-controls").className).not.toMatch(/is-open/);
    expect(screen.getByTestId("player-controls").hidden).toBe(true);
    expect(screen.getByTestId("game-log").hidden).toBe(true);
    fireEvent.click(screen.getByTestId("host-toggle"));
    expect(screen.getByTestId("host-controls").hidden).toBe(false);
    expect(screen.getByTestId("host-controls").className).toMatch(/is-open/);
    expect(screen.getByTestId("host-new-game")).toBeTruthy();
    expect(screen.getByTestId("leave-table")).toBeTruthy();
    fireEvent.click(screen.getByTestId("host-toggle"));
    expect(screen.getByTestId("host-controls").hidden).toBe(true);
    expect(screen.getByTestId("host-controls").className).not.toMatch(/is-open/);
    expect(screen.getByTestId("table-chat")).toBeTruthy();
    expect(screen.getByTestId("command-you-tax").textContent).toBe("Tax = 0");
    expect(within(screen.getByTestId("command-you")).getByText("Test Dragon")).toBeTruthy();
  });

  it("rolls a d20 so the highest player goes first", () => {
    render(<App />);
    const random = vi.spyOn(Math, "random");
    random.mockReturnValueOnce(0).mockReturnValueOnce(0.999);
    fireEvent.click(screen.getByTestId("start-game"));
    expect(screen.getByTestId("roll-first").textContent).toBe("Roll d20");
    fireEvent.click(screen.getByTestId("roll-first"));
    fireEvent.click(screen.getByTestId("keep-hand"));
    expect(screen.queryByTestId("keep-hand")).toBeNull();
    expect(screen.queryByTestId("pass")).toBeNull();
    expect(screen.getByTestId("pass-wait").textContent).toMatch(/Player 2/);
    expect(screen.getByTestId("turn-step").textContent).toContain("Player 2");
    expect(screen.getByTestId("priority").textContent).toContain("Player 2");
    expect(screen.getByTestId("hand-you").className).not.toMatch(/is-active-turn/);
    random.mockRestore();
  });

  it("starts the game on player 4 when they win the opening roll", () => {
    render(<App />);
    const random = vi.spyOn(Math, "random");
    random.mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValueOnce(0.999);
    fireEvent.click(screen.getByTestId("start-4p"));
    fireEvent.click(screen.getByTestId("roll-first"));
    fireEvent.click(screen.getByTestId("keep-hand"));
    expect(screen.queryByTestId("pass")).toBeNull();
    expect(screen.getByTestId("pass-wait").textContent).toMatch(/Player 4/);
    expect(screen.getByTestId("turn-step").textContent).toContain("Player 4");
    expect(screen.getByTestId("priority").textContent).toContain("Player 4");
    expect(screen.getByTestId("hand-you").className).not.toMatch(/is-active-turn/);
    random.mockRestore();
  });

  it("waits for other seated players after you roll the opening d20", () => {
    render(<App />);
    fireEvent.click(screen.getByTestId("hotseat"));
    fireEvent.click(screen.getByTestId("start-game"));
    expect(screen.getByTestId("roll-first").textContent).toBe("Roll d20");
    fireEvent.click(screen.getByTestId("roll-first"));
    expect(screen.getByTestId("roll-first").textContent).toMatch(/Player 2/);
    expect(screen.queryByTestId("keep-hand")).toBeNull();
    fireEvent.click(screen.getByTestId("roll-first"));
    expect(screen.queryByTestId("roll-first")).toBeNull();
    expect(screen.queryByTestId("roll-first-wait")).toBeNull();
    expect(screen.queryByTestId("keep-hand") ?? screen.queryByTestId("mulligan-wait")).toBeTruthy();
  });

  it("labels the advance button with the next step", () => {
    startGame();
    expect(screen.getByTestId("pass").textContent).toBe("Draw a card");
    fireEvent.click(screen.getByTestId("pass"));
    expect(screen.getByTestId("turn-step").textContent).toContain("precombatMain");
    expect(screen.getByTestId("pass").textContent).toBe("Move to combat phase");
    fireEvent.click(screen.getByTestId("pass"));
    expect(screen.getByTestId("turn-step").textContent).toContain("declareAttackers");
    expect(screen.getByTestId("pass").textContent).toBe("Declare attackers");
  });

  it("lets the host skip to the next action or the next player's turn", () => {
    startGame();
    fireEvent.click(screen.getByTestId("host-toggle"));
    expect(screen.getByTestId("host-next-action").textContent).toBe("Pass to next action");
    expect(screen.getByTestId("host-next-turn").textContent).toBe("Pass to next player's turn");
    fireEvent.click(screen.getByTestId("host-next-action"));
    expect(screen.getByTestId("turn-step").textContent).toContain("precombatMain");
    fireEvent.click(screen.getByTestId("host-next-turn"));
    expect(screen.getByTestId("turn-step").textContent).toMatch(/Turn 1/);
    expect(screen.getByTestId("turn-step").textContent).toContain("Player 2");
    expect(screen.getByTestId("turn-step").textContent).toContain("untap");
    expect(screen.queryByTestId("pass")).toBeNull();
    expect(screen.getByTestId("pass-wait").textContent).toMatch(/Player 2/);
  });

  it("posts a table chat line from the seated player", () => {
    startGame();
    fireEvent.change(screen.getByTestId("chat-input"), { target: { value: "Hello table" } });
    fireEvent.click(screen.getByTestId("chat-send"));
    expect(screen.getByTestId("table-chat").textContent).toMatch(/Player 1:\s*Hello table/);
    fireEvent.click(screen.getByTestId("chat-expand"));
    expect(screen.getByTestId("chat-expand").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("table-chat").className).toMatch(/is-expanded/);
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
    expect(screen.getByTestId("battlefield-you").querySelector('[data-lane="creature"]')).toBeTruthy();
    expect(screen.getByTestId("battlefield-you").querySelector('[data-lane="land"]')).toBeTruthy();
    fireEvent.click(within(screen.getByTestId("battlefield-you")).getByText("Test Mountain"));
    const land = within(screen.getByTestId("battlefield-you")).getByText("Test Mountain").closest("button");
    expect(land?.getAttribute("data-tapped")).toBe("true");
    expect(screen.getByTestId("mana-you").textContent).toContain("R:1");
  });

  it("rejects an illegal second land with a red shake", () => {
    startGame();
    passUntil("precombatMain");
    fireEvent.click(within(screen.getByTestId("hand-you")).getByText("Test Mountain"));
    const forest = within(screen.getByTestId("hand-you")).getByText("Test Forest");
    fireEvent.click(forest);
    expect(forest.closest("button")?.className).toMatch(/is-rejected/);
    expect(screen.getByTestId("action-error")).toBeTruthy();
    expect(within(screen.getByTestId("hand-you")).getByText("Test Forest")).toBeTruthy();
  });

  it("casts a supported spell through the host", () => {
    startGame();
    passUntil("precombatMain");
    fireEvent.click(within(screen.getByTestId("hand-you")).getByText("Test Mountain"));
    fireEvent.click(within(screen.getByTestId("battlefield-you")).getByText("Test Mountain"));
    fireEvent.click(within(screen.getByTestId("hand-you")).getByText("Test Shock"));
    fireEvent.click(screen.getByTestId("target-opponent"));
    expect(screen.getByTestId("stack").textContent).toMatch(/Shock/);
    fireEvent.click(screen.getByTestId("pass"));
    expect(screen.getByTestId("life-opponent").textContent).toContain("Life 38");
    expect(screen.getByTestId("game-log").textContent).toMatch(/life -2/);
    fireEvent.click(screen.getByTestId("log-toggle"));
    expect(screen.getByTestId("log-toggle").getAttribute("aria-expanded")).toBe("true");
  });

  it("activates Test Oracle to draw a card", () => {
    startGame();
    passUntil("precombatMain");
    const handBefore = within(screen.getByTestId("hand-you")).getAllByRole("button").length;
    fireEvent.click(within(screen.getByTestId("hand-you")).getByText("Test Oracle"));
    fireEvent.click(screen.getByTestId("pass"));
    expect(within(screen.getByTestId("battlefield-you")).getByText("Test Oracle")).toBeTruthy();
    fireEvent.click(within(screen.getByTestId("battlefield-you")).getByText("Test Oracle"));
    fireEvent.click(screen.getByTestId("pass"));
    expect(within(screen.getByTestId("hand-you")).getAllByRole("button").length).toBe(handBefore);
    const oracle = within(screen.getByTestId("battlefield-you")).getByText("Test Oracle").closest("button");
    expect(oracle?.getAttribute("data-tapped")).toBe("true");
  });

  it("lets a seated player change only their own life from player options", () => {
    startGame();
    const handBefore = within(screen.getByTestId("hand-you")).getAllByRole("button").length;
    openPlayerOptions();
    fireEvent.click(screen.getByTestId("player-life-minus"));
    expect(screen.getByTestId("life-you").textContent).toContain("Life 39");
    expect(screen.getByTestId("life-opponent").textContent).toContain("Life 40");
    expect(screen.queryByTestId("override-player-Player 2")).toBeNull();
    expect(screen.getByTestId("game-log").textContent).toMatch(/override/i);
    fireEvent.click(screen.getByTestId("player-draw"));
    expect(within(screen.getByTestId("hand-you")).getAllByRole("button").length).toBe(handBefore + 1);
  });

  it("undoes the last action, rolls a d20 into chat, and concedes from player options", () => {
    startGame();
    passUntil("precombatMain");
    fireEvent.click(within(screen.getByTestId("hand-you")).getByText("Test Mountain"));
    fireEvent.click(within(screen.getByTestId("battlefield-you")).getByText("Test Mountain"));
    expect(screen.getByTestId("mana-you").textContent).toContain("R:1");
    openPlayerOptions();
    fireEvent.click(screen.getByTestId("player-undo"));
    const land = within(screen.getByTestId("battlefield-you")).getByText("Test Mountain").closest("button");
    expect(land?.getAttribute("data-tapped")).toBe("false");
    expect(screen.getByTestId("mana-you").textContent).not.toContain("R:1");
    fireEvent.click(screen.getByTestId("player-roll"));
    expect(screen.getByTestId("die-sides-pop")).toBeTruthy();
    fireEvent.change(screen.getByTestId("die-sides-input"), { target: { value: "6" } });
    fireEvent.click(screen.getByTestId("die-sides-roll"));
    expect(screen.getByTestId("table-chat").textContent).toMatch(/rolled a d6:\s*\d+/);
    fireEvent.click(screen.getByTestId("concede"));
    expect(screen.getByTestId("game-over").textContent).toContain("Player 2");
    expect(screen.queryByTestId("pass")).toBeNull();
    expect(screen.getByTestId("new-game")).toBeTruthy();
  });

  it("starts a four-player table with three opponent areas", () => {
    render(<App />);
    fireEvent.click(screen.getByTestId("start-4p"));
    expect(screen.getByTestId("area-opponents").querySelectorAll(".player-area.opponent").length).toBe(
      3,
    );
    expect(screen.getByText("Player 2")).toBeTruthy();
    expect(screen.getByText("Player 4")).toBeTruthy();
    expect(screen.getByTestId("area-opponent").getAttribute("data-seat")).toBe("north");
    expect(screen.getByTestId("area-opponents").querySelector('[data-seat="west"] h2')?.textContent).toBe(
      "Player 2",
    );
    expect(screen.getByTestId("area-opponents").querySelector('[data-seat="north"] h2')?.textContent).toBe(
      "Player 3",
    );
    expect(screen.getByTestId("area-opponents").querySelector('[data-seat="east"] h2')?.textContent).toBe(
      "Player 4",
    );
    expect(screen.getByTestId("orient-east").className).toMatch(/is-east/);
    expect(screen.getByTestId("orient-west").className).toMatch(/is-west/);
    expect(screen.getByTestId("orient-north").className).toMatch(/is-north/);
    expect(screen.getByTestId("area-opponents").querySelector('[data-seat="east"] .zone-hud.is-east')).toBeTruthy();
    expect(screen.getByTestId("area-opponents").querySelector('[data-seat="west"] .zone-hud.is-west')).toBeTruthy();
    expect(screen.getByTestId("area-opponents").querySelector('[data-seat="east"] .side-cluster.is-east')).toBeTruthy();
    expect(screen.getByTestId("area-opponents").querySelector('[data-seat="west"] .side-cluster.is-west')).toBeTruthy();
  });

  it("starts a three-player table with two opponent areas", () => {
    render(<App />);
    fireEvent.click(screen.getByTestId("start-3p"));
    expect(screen.getByTestId("area-opponents").querySelectorAll(".player-area.opponent").length).toBe(
      2,
    );
    expect(screen.getByText("Player 2")).toBeTruthy();
    expect(screen.getByText("Player 3")).toBeTruthy();
    expect(screen.queryByText("Player 4")).toBeNull();
    expect(screen.getByTestId("area-opponent").getAttribute("data-seat")).toBe("north");
    expect(screen.getByTestId("area-opponents").querySelector('[data-seat="west"] h2')?.textContent).toBe(
      "Player 2",
    );
    expect(screen.getByTestId("area-opponents").querySelector('[data-seat="north"] h2')?.textContent).toBe(
      "Player 3",
    );
    expect(screen.getByTestId("area-opponents").querySelector('[data-seat="west"]')).toBeTruthy();
    expect(screen.getByTestId("area-opponents").querySelector('[data-seat="east"].player-area')).toBeNull();
    expect(screen.getByTestId("orient-west").className).toMatch(/is-west/);
    expect(screen.getByTestId("area-opponents").querySelector('[data-seat="west"] .zone-hud.is-west')).toBeTruthy();
  });

  it("lets a hotseat opponent take a seat without showing the other player's advance button", () => {
    render(<App />);
    fireEvent.click(screen.getByTestId("hotseat"));
    fireEvent.click(screen.getByTestId("start-game"));
    finishOpeningRolls();
    keepOpeningHands();
    fireEvent.click(screen.getByTestId("play-as-Player 1"));
    const p1HasPass = Boolean(screen.queryByTestId("pass"));
    fireEvent.click(screen.getByTestId("play-as-Player 2"));
    const p2HasPass = Boolean(screen.queryByTestId("pass"));
    expect(p1HasPass || p2HasPass).toBe(true);
    fireEvent.click(screen.getByTestId("play-as-Player 2"));
    expect(within(screen.getByTestId("hand-you")).queryByText("Unknown Card")).toBeNull();
    expect(within(screen.getByTestId("hand-opponent")).queryByText("Unknown Card")).toBeNull();
    expect(within(screen.getByTestId("hand-opponent")).getAllByRole("button").length).toBe(7);
  });

  it("plays a land from another player's hand in solo playtest", () => {
    render(<App />);
    const random = vi.spyOn(Math, "random");
    random.mockReturnValueOnce(0.999).mockReturnValueOnce(0);
    fireEvent.click(screen.getByTestId("hotseat"));
    fireEvent.click(screen.getByTestId("start-game"));
    finishOpeningRolls();
    keepOpeningHands();
    fireEvent.click(screen.getByTestId("host-toggle"));
    fireEvent.click(screen.getByTestId("host-next-turn"));
    let guard = 0;
    while (
      !(
        screen.getByTestId("turn-step").textContent?.includes("precombatMain") &&
        screen.getByTestId("turn-step").textContent?.includes("Player 2")
      )
    ) {
      const pass = screen.queryByTestId("pass");
      if (!pass || (pass as HTMLButtonElement).disabled) {
        throw new Error("Could not reach Player 2 precombatMain");
      }
      fireEvent.click(pass);
      guard += 1;
      if (guard > 80) {
        throw new Error("Could not reach Player 2 precombatMain");
      }
    }
    const hand = screen.getByTestId("hand-opponent");
    const land =
      within(hand).queryByText("Test Mountain") ??
      within(hand).queryByText("Test Forest") ??
      within(hand).queryByText("Test Plains") ??
      within(hand).queryByText("Test Island") ??
      within(hand).getByText("Test Swamp");
    fireEvent.click(land);
    expect(within(screen.getByTestId("battlefield-opponent")).getByText(land.textContent ?? "")).toBeTruthy();
    random.mockRestore();
  });

  it("applies player options to the hotseat actor instead of the camera seat", () => {
    render(<App />);
    const random = vi.spyOn(Math, "random");
    random.mockReturnValueOnce(0.999).mockReturnValueOnce(0);
    fireEvent.click(screen.getByTestId("hotseat"));
    fireEvent.click(screen.getByTestId("start-game"));
    finishOpeningRolls();
    keepOpeningHands();
    fireEvent.click(screen.getByTestId("host-toggle"));
    fireEvent.click(screen.getByTestId("host-next-turn"));
    let guard = 0;
    while (
      !(
        screen.getByTestId("turn-step").textContent?.includes("precombatMain") &&
        screen.getByTestId("turn-step").textContent?.includes("Player 2")
      )
    ) {
      const pass = screen.queryByTestId("pass");
      if (!pass || (pass as HTMLButtonElement).disabled) {
        throw new Error("Could not reach Player 2 precombatMain");
      }
      fireEvent.click(pass);
      guard += 1;
      if (guard > 80) {
        throw new Error("Could not reach Player 2 precombatMain");
      }
    }
    const opponentHand = within(screen.getByTestId("hand-opponent")).getAllByRole("button").length;
    const youHand = within(screen.getByTestId("hand-you")).getAllByRole("button").length;
    openPlayerOptions();
    fireEvent.click(screen.getByTestId("player-life-plus"));
    expect(screen.getByTestId("life-opponent").textContent).toContain("Life 41");
    expect(screen.getByTestId("life-you").textContent).toContain("Life 40");
    fireEvent.click(screen.getByTestId("player-draw"));
    expect(within(screen.getByTestId("hand-opponent")).getAllByRole("button").length).toBe(opponentHand + 1);
    expect(within(screen.getByTestId("hand-you")).getAllByRole("button").length).toBe(youHand);
    random.mockRestore();
  });

  it("takes a London mulligan and bottoms one card", () => {
    render(<App />);
    const random = vi.spyOn(Math, "random");
    random.mockReturnValueOnce(0.999).mockReturnValueOnce(0);
    fireEvent.click(screen.getByTestId("start-game"));
    finishOpeningRolls();
    expect(screen.getByTestId("keep-hand")).toBeTruthy();
    fireEvent.click(screen.getByTestId("take-mulligan"));
    expect(screen.getByTestId("mulligan-hint").textContent).toMatch(/bottom/i);
    expect(screen.getByTestId("confirm-bottom").textContent).toBe("Put 1 on bottom");
    const hand = within(screen.getByTestId("hand-you")).getAllByRole("button");
    fireEvent.click(hand[0]!);
    expect(hand[0]?.className).toMatch(/is-selected/);
    fireEvent.click(screen.getByTestId("confirm-bottom"));
    expect(within(screen.getByTestId("hand-you")).getAllByRole("button").length).toBe(6);
    fireEvent.click(screen.getByTestId("keep-hand"));
    expect(screen.queryByTestId("keep-hand")).toBeNull();
    expect(screen.getByTestId("pass")).toBeTruthy();
    random.mockRestore();
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

  it("lets Command Tower choose a color when tapping for mana", async () => {
    seedOracleCache();
    render(<App />);
    fireEvent.change(screen.getByTestId("decklist-you"), {
      target: {
        value: "Commander\n1 Atraxa, Praetors' Voice\nDeck\n15 Command Tower\n",
      },
    });
    fireEvent.click(screen.getByTestId("import-deck"));
    await waitFor(() => {
      expect(within(screen.getByTestId("command-you")).getByText("Atraxa, Praetors' Voice")).toBeTruthy();
    });
    finishOpeningRolls();
    keepOpeningHands();
    passUntil("precombatMain");
    fireEvent.click(within(screen.getByTestId("hand-you")).getAllByText("Command Tower")[0]!);
    fireEvent.click(within(screen.getByTestId("battlefield-you")).getByText("Command Tower"));
    expect(screen.getByTestId("mana-color-hint")).toBeTruthy();
    fireEvent.click(screen.getByTestId("mana-color-G"));
    expect(screen.getByTestId("mana-you").textContent).toContain("G:1");
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
    expect(screen.getByText("Player 2")).toBeTruthy();
    expect(screen.getByText("Player 3")).toBeTruthy();
  });

  it("restores a saved table after remount", () => {
    startGame();
    fireEvent.click(screen.getByTestId("player-toggle"));
    fireEvent.click(screen.getByTestId("concede"));
    cleanup();
    render(<App />);
    expect(screen.getByTestId("start-game")).toBeTruthy();
    fireEvent.click(screen.getByTestId("resume-game"));
    expect(screen.getByTestId("game-over").textContent).toContain("Player 2");
  });

  it("returns to table setup from a running game", () => {
    startGame();
    fireEvent.click(screen.getByTestId("host-toggle"));
    fireEvent.click(screen.getByTestId("leave-table"));
    expect(screen.getByTestId("start-game")).toBeTruthy();
    expect(screen.getByTestId("start-4p")).toBeTruthy();
    expect(screen.getByTestId("import-deck")).toBeTruthy();
    expect(screen.getByTestId("resume-game")).toBeTruthy();
  });

  it("starts a new game from host controls and returns to setup", () => {
    startGame();
    fireEvent.click(screen.getByTestId("host-toggle"));
    fireEvent.click(screen.getByTestId("host-new-game"));
    expect(screen.getByTestId("start-game")).toBeTruthy();
    expect(screen.getByTestId("import-player-count")).toBeTruthy();
    expect(screen.queryByTestId("resume-game")).toBeNull();
  });

  it("returns to table setup after a finished game", () => {
    startGame();
    fireEvent.click(screen.getByTestId("player-toggle"));
    fireEvent.click(screen.getByTestId("concede"));
    fireEvent.click(screen.getByTestId("new-game"));
    expect(screen.getByTestId("start-game")).toBeTruthy();
    expect(screen.getByTestId("import-player-count")).toBeTruthy();
    expect(screen.queryByTestId("resume-game")).toBeNull();
  });
});
