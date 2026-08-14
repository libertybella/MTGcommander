import {
  HIDDEN_DEFINITION_ID,
  MANA_COLORS,
  isCreature,
  isGameOver,
  isLand,
  type CardInstanceId,
  type ChosenTarget,
  type GameAction,
  type GameState,
  type PlayerId,
} from "@mtgcommander/engine";

export type UiMode =
  | { type: "idle" }
  | { type: "targets"; cardId: CardInstanceId; chosen: ChosenTarget[] }
  | { type: "attackers"; attackerIds: CardInstanceId[] }
  | { type: "block-pick-blocker" }
  | { type: "block-pick-attacker"; blockerId: CardInstanceId };

type Props = {
  state: GameState;
  viewerId: PlayerId;
  error: string | null;
  mode: UiMode;
  onMode: (mode: UiMode) => void;
  onAction: (action: GameAction) => void;
  onNewGame: () => void;
};

function definition(state: GameState, cardId: CardInstanceId) {
  const card = state.cards[cardId];
  return card ? state.definitions[card.definitionId] : undefined;
}

function producesMana(state: GameState, cardId: CardInstanceId): boolean {
  const produces = definition(state, cardId)?.produces ?? {};
  return MANA_COLORS.some((color) => (produces[color] ?? 0) > 0);
}

function manaLine(mana: GameState["players"][number]["mana"]): string {
  return MANA_COLORS.filter((color) => mana[color] > 0)
    .map((color) => `${color}:${mana[color]}`)
    .join(" ") || "none";
}

function CardTile(props: {
  state: GameState;
  cardId: CardInstanceId;
  testId?: string;
  onClick?: () => void;
}) {
  const card = props.state.cards[props.cardId];
  const def = definition(props.state, props.cardId);
  if (!card || !def) {
    return null;
  }
  const pt =
    def.power !== null && def.toughness !== null ? `${def.power}/${def.toughness}` : null;
  const classes = [
    "card-tile",
    card.tapped ? "is-tapped" : "",
    card.attacking ? "is-attacking" : "",
    def.id === HIDDEN_DEFINITION_ID ? "is-hidden" : "",
    props.onClick ? "is-clickable" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      type="button"
      className={classes}
      data-testid={props.testId ?? `card-${card.id}`}
      data-card-name={def.name}
      data-tapped={card.tapped ? "true" : "false"}
      onClick={props.onClick}
      disabled={!props.onClick}
    >
      <span className="card-name">{def.name}</span>
      <span className="card-type">{def.typeLine}</span>
      {pt ? <span className="card-pt">{pt}</span> : null}
      {card.tapped ? <span className="card-flag">Tapped</span> : null}
    </button>
  );
}

export function Battlefield(props: Props) {
  const { state, viewerId, error, mode, onMode, onAction, onNewGame } = props;
  const you = state.players.find((player) => player.id === viewerId);
  const opponent = state.players.find((player) => player.id !== viewerId);
  if (!you || !opponent) {
    return <p>Missing players.</p>;
  }
  const opponentId = opponent.id;

  const over = isGameOver(state);
  const winner = state.players.find((player) => player.id === state.winnerId);
  const priority = state.players.find((player) => player.id === state.priorityPlayerId);
  const yourPriority = state.priorityPlayerId === viewerId;

  function send(action: GameAction) {
    onMode({ type: "idle" });
    onAction(action);
  }

  function clickHandCard(cardId: CardInstanceId) {
    if (over || !yourPriority) {
      return;
    }
    if (isLand(state, cardId)) {
      send({ kind: "play_land", playerId: viewerId, cardId });
      return;
    }
    const requirements = definition(state, cardId)?.targetRequirements ?? [];
    if (requirements.length === 0) {
      send({ kind: "cast_spell", playerId: viewerId, cardId });
      return;
    }
    onMode({ type: "targets", cardId, chosen: [] });
  }

  function clickYourPermanent(cardId: CardInstanceId) {
    if (over || !yourPriority) {
      return;
    }
    if (mode.type === "attackers") {
      const next = mode.attackerIds.includes(cardId)
        ? mode.attackerIds.filter((id) => id !== cardId)
        : [...mode.attackerIds, cardId];
      onMode({ type: "attackers", attackerIds: next });
      return;
    }
    if (mode.type === "block-pick-blocker" && isCreature(state, cardId)) {
      onMode({ type: "block-pick-attacker", blockerId: cardId });
      return;
    }
    if (producesMana(state, cardId)) {
      send({ kind: "tap_for_mana", playerId: viewerId, cardId });
    }
  }

  function clickOpponentPermanent(cardId: CardInstanceId) {
    if (over) {
      return;
    }
    if (mode.type === "targets") {
      addTarget({ type: "creature", cardId });
      return;
    }
    if (mode.type === "block-pick-attacker") {
      send({
        kind: "declare_blockers",
        playerId: viewerId,
        blocks: [{ blockerId: mode.blockerId, attackerId: cardId }],
      });
    }
  }

  function addTarget(target: ChosenTarget) {
    if (mode.type !== "targets") {
      return;
    }
    const requirements = definition(state, mode.cardId)?.targetRequirements ?? [];
    const chosen = [...mode.chosen, target];
    if (chosen.length >= requirements.length) {
      send({
        kind: "cast_spell",
        playerId: viewerId,
        cardId: mode.cardId,
        targets: chosen,
      });
      return;
    }
    onMode({ type: "targets", cardId: mode.cardId, chosen });
  }

  function confirmAttackers() {
    if (mode.type !== "attackers") {
      return;
    }
    send({
      kind: "declare_attackers",
      playerId: viewerId,
      attacks: mode.attackerIds.map((attackerId) => ({
        attackerId,
        defenderId: opponentId,
      })),
    });
  }

  const targeting = mode.type === "targets";

  return (
    <div className="table">
      <header className="status-bar">
        <p className="eyebrow">BizzyMTG Commander</p>
        <p data-testid="turn-step">
          Turn {state.turn.number} · {state.turn.phase} · {state.turn.step}
        </p>
        <p data-testid="priority">
          Priority: {priority?.displayName ?? state.priorityPlayerId}
          {state.stack.length > 0 ? ` · Stack ${state.stack.length}` : ""}
        </p>
        {over ? (
          <p className="game-over" data-testid="game-over">
            Game over. Winner: {winner?.displayName ?? state.winnerId ?? "none"}
          </p>
        ) : null}
        {error ? (
          <p className="action-error" data-testid="action-error">
            {error}
          </p>
        ) : null}
        {mode.type === "targets" ? (
          <p data-testid="targeting-hint">Choose a target for {definition(state, mode.cardId)?.name}.</p>
        ) : null}
      </header>

      <section className="player-area opponent" data-testid="area-opponent">
        <div className="player-meta">
          <h2>{opponent.displayName}</h2>
          <p data-testid="life-opponent">Life {opponent.life}</p>
          <p data-testid="counts-opponent">
            Hand {opponent.zones.hand.length} · Library {opponent.zones.library.length} · Graveyard{" "}
            {opponent.zones.graveyard.length} · Command {opponent.zones.command.length}
          </p>
          {targeting ? (
            <button
              type="button"
              data-testid="target-opponent"
              onClick={() => addTarget({ type: "player", playerId: opponentId })}
            >
              Target opponent
            </button>
          ) : null}
        </div>
        <div className="hand" data-testid="hand-opponent">
          {opponent.zones.hand.map((cardId) => (
            <CardTile key={cardId} state={state} cardId={cardId} />
          ))}
        </div>
        <div className="permanents" data-testid="battlefield-opponent">
          {opponent.zones.battlefield.map((cardId) => (
            <CardTile
              key={cardId}
              state={state}
              cardId={cardId}
              onClick={
                targeting || mode.type === "block-pick-attacker"
                  ? () => clickOpponentPermanent(cardId)
                  : undefined
              }
            />
          ))}
        </div>
      </section>

      {state.stack.length > 0 ? (
        <section className="stack-strip" data-testid="stack">
          <h3>Stack</h3>
          <ul>
            {state.stack.map((entry) => {
              const sourceName = entry.sourceId
                ? definition(state, entry.sourceId)?.name ?? entry.sourceId
                : entry.kind;
              return (
                <li key={entry.id}>
                  {entry.kind}: {sourceName}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section className="player-area you" data-testid="area-you">
        <div className="permanents" data-testid="battlefield-you">
          {you.zones.battlefield.map((cardId) => (
            <CardTile
              key={cardId}
              state={state}
              cardId={cardId}
              onClick={!over && yourPriority ? () => clickYourPermanent(cardId) : undefined}
            />
          ))}
        </div>
        <div className="player-meta">
          <h2>{you.displayName}</h2>
          <p data-testid="life-you">Life {you.life}</p>
          <p data-testid="mana-you">Mana {manaLine(you.mana)}</p>
          <p data-testid="counts-you">
            Library {you.zones.library.length} · Graveyard {you.zones.graveyard.length} · Command{" "}
            {you.zones.command.length}
          </p>
        </div>
        <div className="command-row" data-testid="command-you">
          {you.zones.command.map((cardId) => (
            <CardTile
              key={cardId}
              state={state}
              cardId={cardId}
              onClick={!over && yourPriority ? () => clickHandCard(cardId) : undefined}
            />
          ))}
        </div>
        <div className="hand" data-testid="hand-you">
          {you.zones.hand.map((cardId) => (
            <CardTile
              key={cardId}
              state={state}
              cardId={cardId}
              onClick={!over && yourPriority ? () => clickHandCard(cardId) : undefined}
            />
          ))}
        </div>
      </section>

      <footer className="actions">
        {over ? (
          <button type="button" data-testid="new-game" onClick={onNewGame}>
            New game
          </button>
        ) : (
          <>
            <button
              type="button"
              data-testid="pass"
              onClick={() => send({ kind: "pass_priority", playerId: viewerId })}
            >
              Pass priority
            </button>
            {state.turn.step === "declareAttackers" &&
            state.turn.activePlayerId === viewerId &&
            yourPriority ? (
              mode.type === "attackers" ? (
                <button type="button" data-testid="confirm-attackers" onClick={confirmAttackers}>
                  Confirm attackers
                </button>
              ) : (
                <button
                  type="button"
                  data-testid="choose-attackers"
                  onClick={() => onMode({ type: "attackers", attackerIds: [] })}
                >
                  Choose attackers
                </button>
              )
            ) : null}
            {state.turn.step === "declareBlockers" && yourPriority ? (
              <button
                type="button"
                data-testid="choose-blockers"
                onClick={() => onMode({ type: "block-pick-blocker" })}
              >
                Choose blockers
              </button>
            ) : null}
            <button
              type="button"
              data-testid="concede"
              onClick={() => send({ kind: "concede", playerId: viewerId })}
            >
              Concede
            </button>
          </>
        )}
      </footer>
    </div>
  );
}
