import { applyEffects, bindCardEffects } from "./effects";
import { moveCardInPlace } from "./zones";
import type { CardInstanceId, GameState } from "./types";

/** The counter Sagas measure their chapters in (CR 714.2). */
export const LORE_COUNTER = "lore";

/**
 * Put a lore counter on a Saga and run the chapter that count reaches.
 *
 * A chapter beyond the last one printed does nothing — a Saga can pick up
 * extra counters, and CR 714.2c only fires a chapter the Saga actually has.
 * After the final chapter the Saga is sacrificed.
 *
 * Documented simplification: the sacrifice happens as the chapter finishes
 * resolving rather than when the ability leaves the stack, so a response to
 * the last chapter cannot save the Saga.
 */
export function advanceSagaInPlace(state: GameState, cardId: CardInstanceId): void {
  const card = state.cards[cardId];
  if (!card || card.zone !== "battlefield") {
    return;
  }
  const saga = state.definitions[card.definitionId]?.saga;
  if (!saga || saga.chapters.length === 0) {
    return;
  }
  const next = (card.counters[LORE_COUNTER] ?? 0) + 1;
  card.counters[LORE_COUNTER] = next;
  const chapter = saga.chapters[next - 1];
  if (chapter && chapter.length > 0) {
    const bound = bindCardEffects(state, chapter, {
      controllerId: card.controllerId,
      sourceId: cardId,
    });
    const after = applyEffects(state, bound);
    // applyEffects returns a new state; copy it back into the one the
    // caller is mutating, which is how the other in-place turn actions work.
    Object.assign(state, after);
  }
  const settled = state.cards[cardId];
  if (
    settled &&
    settled.zone === "battlefield" &&
    (settled.counters[LORE_COUNTER] ?? 0) >= saga.chapters.length
  ) {
    moveCardInPlace(state, cardId, "graveyard");
  }
}

/**
 * After the active player's draw step, every Saga they control gets a lore
 * counter (CR 714.2b). Modelled at the start of the precombat main phase,
 * which is the same moment — nothing happens between the two but priority.
 */
export function advanceControlledSagasInPlace(state: GameState): void {
  // Almost no game contains a Saga, and this runs at every precombat main.
  // The definition scan is far cheaper than the card scan below.
  let anySaga = false;
  for (const definition of Object.values(state.definitions)) {
    if (definition.saga) {
      anySaga = true;
      break;
    }
  }
  if (!anySaga) {
    return;
  }
  const activeId = state.turn.activePlayerId;
  for (const card of Object.values(state.cards)) {
    if (
      card.zone !== "battlefield" ||
      card.controllerId !== activeId ||
      !state.definitions[card.definitionId]?.saga
    ) {
      continue;
    }
    advanceSagaInPlace(state, card.id);
  }
}
