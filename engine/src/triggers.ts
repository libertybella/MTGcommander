import { createId } from "./ids";
import type { CardInstanceId, GameState } from "./types";

/**
 * Queue enter-the-battlefield triggers as stack abilities. V1: no target
 * choices and no AP-order for simultaneous triggers.
 */
export function queueEnterBattlefieldTriggersInPlace(
  state: GameState,
  cardId: CardInstanceId,
): void {
  const card = state.cards[cardId];
  if (!card || card.zone !== "battlefield") {
    return;
  }
  const definition = state.definitions[card.definitionId];
  const triggers = definition?.triggers ?? [];
  let queued = 0;
  for (let index = 0; index < triggers.length; index += 1) {
    const trigger = triggers[index];
    if (trigger?.event !== "enter_battlefield") {
      continue;
    }
    state.stack.push({
      id: createId("stack"),
      controllerId: card.controllerId,
      sourceId: cardId,
      kind: "ability",
      targets: [],
      triggerIndex: index,
    });
    queued += 1;
  }
  if (queued > 0) {
    state.passesSinceAction = 0;
    state.priorityPlayerId = state.turn.activePlayerId;
  }
}
