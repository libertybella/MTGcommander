import {
  currentPrompt,
  isMulliganOpen,
  isOpeningRoll,
  isPromptOpen,
  nextLivingPlayerId,
  openingRollPending,
  type GameState,
  type PlayerId,
  type Step,
} from "@mtgcommander/engine";

const STEP_LABELS: Partial<Record<Step, string>> = {
  untap: "Untap",
  upkeep: "Draw",
  draw: "Draw",
  precombatMain: "Move to combat phase",
  beginCombat: "Declare attackers",
  declareAttackers: "Declare attackers",
  declareBlockers: "Assign blockers",
  combatDamage: "Combat damage",
  endCombat: "Move to Main Phase 2",
  postcombatMain: "Move to End Phase",
  end: "Pass to next player",
  cleanup: "Pass to next player",
};

export function showAdvanceButton(state: GameState, viewerId: PlayerId): boolean {
  if (isPromptOpen(state)) {
    return false;
  }
  if (state.priorityPlayerId !== viewerId) {
    return false;
  }
  if (state.stack.length > 0) {
    return true;
  }
  return state.turn.activePlayerId === viewerId;
}

export function advanceButtonLabel(state: GameState, viewerId: PlayerId): string {
  if (state.stack.length > 0) {
    return "Pass priority";
  }
  if (state.priorityPlayerId !== viewerId || state.turn.activePlayerId !== viewerId) {
    return "Pass priority";
  }
  if (state.turn.step === "end" || state.turn.step === "cleanup") {
    const nextId = nextLivingPlayerId(state, state.turn.activePlayerId);
    const nextName = state.players.find((player) => player.id === nextId)?.displayName ?? "next player";
    return `Pass to ${nextName}`;
  }
  if (state.turn.step === "upkeep" || state.turn.step === "draw") {
    return "Draw a card";
  }
  return STEP_LABELS[state.turn.step] ?? "Pass priority";
}

/** In solo playtest, act as whoever must roll, keep, choose, or take priority. */
export function playtestActorId(state: GameState, viewerId: PlayerId, playAll: boolean): PlayerId {
  if (!playAll) {
    return viewerId;
  }
  if (isOpeningRoll(state)) {
    const pending = state.players.find(
      (player) => !player.lost && openingRollPending(state, player.id),
    );
    return pending?.id ?? viewerId;
  }
  if (isMulliganOpen(state) && state.mulligan) {
    return state.mulligan.decidingPlayerId;
  }
  const prompt = currentPrompt(state);
  if (prompt) {
    return prompt.playerId;
  }
  return state.priorityPlayerId;
}

export function actorButtonSuffix(state: GameState, actorId: PlayerId, viewerId: PlayerId): string {
  if (actorId === viewerId) {
    return "";
  }
  const name = state.players.find((player) => player.id === actorId)?.displayName;
  return name ? ` for ${name}` : "";
}
