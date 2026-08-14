import {
  HIDDEN_DEFINITION_ID,
  MANA_COLORS,
  isCreature,
  isGameOver,
  isLand,
  type CardInstanceId,
  type ChosenTarget,
  type GameAction,
  type GameLogEntry,
  type GameState,
  type PlayerId,
  type PlayerState,
  type StackObjectId,
} from "@mtgcommander/engine";

export type UiMode =
  | { type: "idle" }
  | { type: "targets"; cardId: CardInstanceId; chosen: ChosenTarget[] }
  | { type: "attackers"; attackerIds: CardInstanceId[]; defenderId: PlayerId | null }
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

function formatLogEntry(state: GameState, entry: GameLogEntry): string {
  if (entry.kind === "life_change") {
    const player = state.players.find((item) => item.id === entry.playerId);
    const name = player?.displayName ?? entry.playerId;
    const delta = entry.delta > 0 ? `+${entry.delta}` : `${entry.delta}`;
    return `${name} life ${delta}`;
  }
  const name = definition(state, entry.cardId)?.name ?? "Unknown Card";
  return `${name}: ${entry.from} → ${entry.to}`;
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

function OpponentArea(props: {
  state: GameState;
  opponent: PlayerState;
  legacyIds: boolean;
  targeting: boolean;
  selectingDefender: boolean;
  selectedDefender: boolean;
  blockPick: boolean;
  onTargetPlayer: () => void;
  onSelectDefender: () => void;
  onPermanent: (cardId: CardInstanceId) => void;
}) {
  const { state, opponent, legacyIds } = props;
  const areaId = legacyIds ? "area-opponent" : `area-${opponent.id}`;
  const lifeId = legacyIds ? "life-opponent" : `life-${opponent.id}`;
  const handId = legacyIds ? "hand-opponent" : `hand-${opponent.id}`;
  const fieldId = legacyIds ? "battlefield-opponent" : `battlefield-${opponent.id}`;
  const targetId = legacyIds ? "target-opponent" : `target-${opponent.id}`;
  const attackId = legacyIds ? "attack-opponent" : `attack-${opponent.id}`;
  return (
    <section className="player-area opponent" data-testid={areaId}>
      <div className="player-meta">
        <h2>{opponent.displayName}</h2>
        <p data-testid={lifeId}>Life {opponent.life}</p>
        <p data-testid={legacyIds ? "counts-opponent" : `counts-${opponent.id}`}>
          Hand {opponent.zones.hand.length} · Library {opponent.zones.library.length} · Graveyard{" "}
          {opponent.zones.graveyard.length} · Command {opponent.zones.command.length}
        </p>
        {props.targeting ? (
          <button type="button" data-testid={targetId} onClick={props.onTargetPlayer}>
            Target {opponent.displayName}
          </button>
        ) : null}
        {props.selectingDefender ? (
          <button
            type="button"
            data-testid={attackId}
            className={props.selectedDefender ? "is-selected" : ""}
            onClick={props.onSelectDefender}
          >
            Attack {opponent.displayName}
          </button>
        ) : null}
      </div>
      <div className="hand" data-testid={handId}>
        {opponent.zones.hand.map((cardId) => (
          <CardTile key={cardId} state={state} cardId={cardId} />
        ))}
      </div>
      <div className="permanents" data-testid={fieldId}>
        {opponent.zones.battlefield.map((cardId) => (
          <CardTile
            key={cardId}
            state={state}
            cardId={cardId}
            onClick={
              props.targeting || props.blockPick ? () => props.onPermanent(cardId) : undefined
            }
          />
        ))}
      </div>
    </section>
  );
}

export function Battlefield(props: Props) {
  const { state, viewerId, error, mode, onMode, onAction, onNewGame } = props;
  const you = state.players.find((player) => player.id === viewerId);
  const opponents = state.players.filter((player) => player.id !== viewerId);
  if (!you || opponents.length === 0) {
    return <p>Missing players.</p>;
  }

  const over = isGameOver(state);
  const winner = state.players.find((player) => player.id === state.winnerId);
  const priority = state.players.find((player) => player.id === state.priorityPlayerId);
  const yourPriority = state.priorityPlayerId === viewerId;
  const targeting = mode.type === "targets";
  const nextRequirement =
    mode.type === "targets"
      ? (definition(state, mode.cardId)?.targetRequirements ?? [])[mode.chosen.length]
      : undefined;
  const targetingSpell = targeting && nextRequirement?.kind === "spell";
  const livingOpponents = opponents.filter((player) => !player.lost);
  const logLines = state.log.slice(-12);

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
      onMode({ type: "attackers", attackerIds: next, defenderId: mode.defenderId });
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

  function clickStack(stackObjectId: StackObjectId) {
    if (targetingSpell) {
      addTarget({ type: "spell", stackObjectId });
    }
  }

  function confirmAttackers() {
    if (mode.type !== "attackers" || !mode.defenderId) {
      return;
    }
    send({
      kind: "declare_attackers",
      playerId: viewerId,
      attacks: mode.attackerIds.map((attackerId) => ({
        attackerId,
        defenderId: mode.defenderId as PlayerId,
      })),
    });
  }

  function beginAttackers() {
    onMode({
      type: "attackers",
      attackerIds: [],
      defenderId: livingOpponents.length === 1 ? (livingOpponents[0]?.id ?? null) : null,
    });
  }

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
          <p data-testid="targeting-hint">
            {targetingSpell
              ? `Choose a spell on the stack for ${definition(state, mode.cardId)?.name}.`
              : `Choose a target for ${definition(state, mode.cardId)?.name}.`}
          </p>
        ) : null}
      </header>

      <div className="opponents" data-testid="area-opponents">
        {opponents.map((opponent, index) => (
          <OpponentArea
            key={opponent.id}
            state={state}
            opponent={opponent}
            legacyIds={index === 0}
            targeting={targeting && !targetingSpell}
            selectingDefender={mode.type === "attackers" && livingOpponents.length > 1}
            selectedDefender={mode.type === "attackers" && mode.defenderId === opponent.id}
            blockPick={mode.type === "block-pick-attacker"}
            onTargetPlayer={() => addTarget({ type: "player", playerId: opponent.id })}
            onSelectDefender={() => {
              if (mode.type === "attackers") {
                onMode({ ...mode, defenderId: opponent.id });
              }
            }}
            onPermanent={clickOpponentPermanent}
          />
        ))}
      </div>

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
                  {targetingSpell ? (
                    <button
                      type="button"
                      data-testid={`stack-target-${entry.id}`}
                      onClick={() => clickStack(entry.id)}
                    >
                      {entry.kind}: {sourceName}
                    </button>
                  ) : (
                    `${entry.kind}: ${sourceName}`
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section className="log-strip" data-testid="game-log">
        <h3>Log</h3>
        {logLines.length === 0 ? (
          <p className="muted">No public events yet.</p>
        ) : (
          <ol>
            {logLines.map((entry, index) => (
              <li key={`${entry.kind}-${index}`}>{formatLogEntry(state, entry)}</li>
            ))}
          </ol>
        )}
      </section>

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
                <button
                  type="button"
                  data-testid="confirm-attackers"
                  disabled={!mode.defenderId}
                  onClick={confirmAttackers}
                >
                  Confirm attackers
                </button>
              ) : (
                <button type="button" data-testid="choose-attackers" onClick={beginAttackers}>
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
