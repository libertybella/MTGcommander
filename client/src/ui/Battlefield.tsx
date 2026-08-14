import {
  HIDDEN_DEFINITION_ID,
  MANA_COLORS,
  canTapForMana,
  countedMulligans,
  isCreature,
  isGameOver,
  isLand,
  isMulliganOpen,
  manaTapOptions,
  type CardInstanceId,
  type ChosenTarget,
  type GameAction,
  type GameLogEntry,
  type GameState,
  type ManaColor,
  type ManualOverrideChange,
  type PlayerId,
  type PlayerZones,
  type PlayerState,
  type StackObjectId,
  type TargetRequirement,
} from "@mtgcommander/engine";

export type UiMode =
  | { type: "idle" }
  | {
      type: "targets";
      cardId: CardInstanceId;
      chosen: ChosenTarget[];
      origin: "spell" | "ability";
      abilityIndex?: number;
    }
  | { type: "attackers"; attackerIds: CardInstanceId[]; defenderId: PlayerId | null }
  | { type: "block-pick-blocker" }
  | { type: "block-pick-attacker"; blockerId: CardInstanceId }
  | { type: "bottom"; selected: CardInstanceId[] }
  | { type: "mana-color"; cardId: CardInstanceId; colors: ManaColor[] }
  | { type: "override"; selectedCardId: CardInstanceId | null; targetPlayerId: PlayerId };

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
  const def = definition(state, cardId);
  return def ? canTapForMana(def) : false;
}

function activatedAbility(state: GameState, cardId: CardInstanceId, abilityIndex = 0) {
  return definition(state, cardId)?.activated[abilityIndex];
}

function modeRequirements(state: GameState, mode: UiMode): TargetRequirement[] {
  if (mode.type !== "targets") {
    return [];
  }
  if (mode.origin === "ability") {
    return activatedAbility(state, mode.cardId, mode.abilityIndex)?.targetRequirements ?? [];
  }
  return definition(state, mode.cardId)?.targetRequirements ?? [];
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
  if (entry.kind === "override") {
    const player = state.players.find((item) => item.id === entry.playerId);
    const name = player?.displayName ?? entry.playerId;
    return `${name} override: ${entry.summary}`;
  }
  const name = definition(state, entry.cardId)?.name ?? "Unknown Card";
  return `${name}: ${entry.from} → ${entry.to}`;
}

function CardTile(props: {
  state: GameState;
  cardId: CardInstanceId;
  testId?: string;
  selected?: boolean;
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
    props.selected ? "is-selected" : "",
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
  overriding: boolean;
  selectedCardId: CardInstanceId | null;
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
              props.targeting || props.blockPick || props.overriding
                ? () => props.onPermanent(cardId)
                : undefined
            }
            selected={props.overriding && props.selectedCardId === cardId}
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
  const nextRequirement = targeting ? modeRequirements(state, mode)[mode.chosen.length] : undefined;
  const targetingSpell = targeting && nextRequirement?.kind === "spell";
  const livingOpponents = opponents.filter((player) => !player.lost);
  const logLines = state.log.slice(-12);
  const mulliganOpen = isMulliganOpen(state);
  const deciding = state.mulligan?.decidingPlayerId === viewerId;
  const pendingBottom = state.mulligan?.pendingBottom ?? 0;
  const bottoming = deciding && pendingBottom > 0;
  const selectedBottom = mode.type === "bottom" ? mode.selected : [];
  const decider = state.players.find((player) => player.id === state.mulligan?.decidingPlayerId);
  const overriding = mode.type === "override";
  const overrideTargetId = overriding ? mode.targetPlayerId : viewerId;
  const overrideCardId = overriding ? mode.selectedCardId : null;
  const livingPlayers = state.players.filter((player) => !player.lost);
  const overrideMoveZones: (keyof PlayerZones)[] = [
    "hand",
    "battlefield",
    "graveyard",
    "exile",
    "command",
    "library",
  ];

  function sendOverride(change: ManualOverrideChange) {
    onAction({ kind: "manual_override", playerId: viewerId, change });
  }

  function send(action: GameAction) {
    onMode({ type: "idle" });
    onAction(action);
  }

  function selectOverrideCard(cardId: CardInstanceId) {
    if (mode.type !== "override") {
      return;
    }
    onMode({
      ...mode,
      selectedCardId: mode.selectedCardId === cardId ? null : cardId,
    });
  }

  function toggleBottom(cardId: CardInstanceId) {
    const selected = selectedBottom.includes(cardId)
      ? selectedBottom.filter((id) => id !== cardId)
      : [...selectedBottom, cardId];
    onMode({ type: "bottom", selected });
  }

  function clickHandCard(cardId: CardInstanceId) {
    if (over || mulliganOpen) {
      return;
    }
    if (mode.type === "override") {
      selectOverrideCard(cardId);
      return;
    }
    if (!yourPriority) {
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
    onMode({ type: "targets", cardId, chosen: [], origin: "spell" });
  }

  function clickYourPermanent(cardId: CardInstanceId) {
    if (over) {
      return;
    }
    if (mode.type === "override") {
      selectOverrideCard(cardId);
      return;
    }
    if (!yourPriority) {
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
    if (mode.type === "targets" && !targetingSpell) {
      addTarget({ type: "creature", cardId });
      return;
    }
    if (producesMana(state, cardId)) {
      const def = definition(state, cardId);
      const options = def ? manaTapOptions(def) : null;
      if (options && options.length > 0) {
        onMode({ type: "mana-color", cardId, colors: options });
        return;
      }
      send({ kind: "tap_for_mana", playerId: viewerId, cardId });
      return;
    }
    const ability = activatedAbility(state, cardId, 0);
    if (!ability || mulliganOpen) {
      return;
    }
    if (ability.targetRequirements.length === 0) {
      send({
        kind: "activate_ability",
        playerId: viewerId,
        cardId,
        abilityIndex: 0,
      });
      return;
    }
    onMode({ type: "targets", cardId, chosen: [], origin: "ability", abilityIndex: 0 });
  }

  function clickOpponentPermanent(cardId: CardInstanceId) {
    if (over) {
      return;
    }
    if (mode.type === "override") {
      selectOverrideCard(cardId);
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
    const requirements = modeRequirements(state, mode);
    const chosen = [...mode.chosen, target];
    if (chosen.length >= requirements.length) {
      if (mode.origin === "ability") {
        send({
          kind: "activate_ability",
          playerId: viewerId,
          cardId: mode.cardId,
          abilityIndex: mode.abilityIndex ?? 0,
          targets: chosen,
        });
        return;
      }
      send({
        kind: "cast_spell",
        playerId: viewerId,
        cardId: mode.cardId,
        targets: chosen,
      });
      return;
    }
    onMode({
      type: "targets",
      cardId: mode.cardId,
      chosen,
      origin: mode.origin,
      abilityIndex: mode.abilityIndex,
    });
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
              : `Choose a target for ${definition(state, mode.cardId)?.name}${mode.origin === "ability" ? " ability" : ""}.`}
          </p>
        ) : null}
        {mode.type === "mana-color" ? (
          <p data-testid="mana-color-hint">
            Choose a color for {definition(state, mode.cardId)?.name}.
          </p>
        ) : null}
        {overriding ? (
          <p data-testid="override-hint">
            Table override — pick a player or card. This is table agreement, not a rules action.
          </p>
        ) : null}
        {mulliganOpen ? (
          <p data-testid="mulligan-hint">
            {bottoming
              ? `Put ${pendingBottom} card(s) on the bottom.`
              : deciding
                ? `London mulligan — ${countedMulligans(state, viewerId)} counted. Keep or mulligan.`
                : `Waiting for ${decider?.displayName ?? "a player"} to keep or mulligan.`}
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
            overriding={overriding}
            selectedCardId={overrideCardId}
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
              selected={overrideCardId === cardId}
              onClick={
                !over && (overriding || yourPriority)
                  ? () => clickYourPermanent(cardId)
                  : undefined
              }
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
              selected={overrideCardId === cardId}
              onClick={
                !over && (overriding || yourPriority)
                  ? () => clickHandCard(cardId)
                  : undefined
              }
            />
          ))}
        </div>
        <div className="hand" data-testid="hand-you">
          {you.zones.hand.map((cardId) => (
            <CardTile
              key={cardId}
              state={state}
              cardId={cardId}
              selected={selectedBottom.includes(cardId) || overrideCardId === cardId}
              onClick={
                over
                  ? undefined
                  : bottoming
                    ? () => toggleBottom(cardId)
                    : overriding || (yourPriority && !mulliganOpen)
                      ? () => clickHandCard(cardId)
                      : undefined
              }
            />
          ))}
        </div>
      </section>

      <footer className="actions">
        {over ? (
          <button type="button" data-testid="new-game" onClick={onNewGame}>
            New game
          </button>
        ) : mulliganOpen ? (
          <>
            {deciding && pendingBottom === 0 ? (
              <>
                <button
                  type="button"
                  data-testid="keep-hand"
                  onClick={() => send({ kind: "keep_hand", playerId: viewerId })}
                >
                  Keep hand
                </button>
                <button
                  type="button"
                  data-testid="take-mulligan"
                  onClick={() => send({ kind: "mulligan", playerId: viewerId })}
                >
                  Take mulligan
                </button>
              </>
            ) : null}
            {bottoming ? (
              <button
                type="button"
                data-testid="confirm-bottom"
                disabled={selectedBottom.length !== pendingBottom}
                onClick={() =>
                  send({ kind: "bottom_cards", playerId: viewerId, cardIds: selectedBottom })
                }
              >
                Put on bottom
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
        ) : (
          <>
            <button
              type="button"
              data-testid="pass"
              onClick={() => send({ kind: "pass_priority", playerId: viewerId })}
            >
              Pass priority
            </button>
            {mode.type === "mana-color"
              ? mode.colors.map((color) => (
                  <button
                    key={color}
                    type="button"
                    data-testid={`mana-color-${color}`}
                    onClick={() =>
                      send({
                        kind: "tap_for_mana",
                        playerId: viewerId,
                        cardId: mode.cardId,
                        color,
                      })
                    }
                  >
                    Add {color}
                  </button>
                ))
              : null}
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
              data-testid="override-toggle"
              className={overriding ? "is-selected" : ""}
              onClick={() =>
                onMode(
                  overriding
                    ? { type: "idle" }
                    : { type: "override", selectedCardId: null, targetPlayerId: viewerId },
                )
              }
            >
              Override
            </button>
            {overriding ? (
              <div className="override-panel" data-testid="override-panel">
                {livingPlayers.map((player) => (
                  <button
                    key={player.id}
                    type="button"
                    data-testid={`override-player-${player.displayName}`}
                    className={overrideTargetId === player.id ? "is-selected" : ""}
                    onClick={() =>
                      onMode({
                        type: "override",
                        selectedCardId: overrideCardId,
                        targetPlayerId: player.id,
                      })
                    }
                  >
                    {player.displayName}
                  </button>
                ))}
                <button
                  type="button"
                  data-testid="override-life-plus"
                  onClick={() =>
                    sendOverride({
                      type: "adjust_life",
                      targetPlayerId: overrideTargetId,
                      delta: 1,
                    })
                  }
                >
                  Life +1
                </button>
                <button
                  type="button"
                  data-testid="override-life-minus"
                  onClick={() =>
                    sendOverride({
                      type: "adjust_life",
                      targetPlayerId: overrideTargetId,
                      delta: -1,
                    })
                  }
                >
                  Life -1
                </button>
                <button
                  type="button"
                  data-testid="override-draw"
                  onClick={() =>
                    sendOverride({ type: "draw", targetPlayerId: overrideTargetId, count: 1 })
                  }
                >
                  Draw 1
                </button>
                <button
                  type="button"
                  data-testid="override-mill"
                  onClick={() =>
                    sendOverride({ type: "mill", targetPlayerId: overrideTargetId, count: 1 })
                  }
                >
                  Mill 1
                </button>
                {MANA_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    data-testid={`override-mana-${color}`}
                    onClick={() =>
                      sendOverride({
                        type: "add_mana",
                        targetPlayerId: overrideTargetId,
                        color,
                      })
                    }
                  >
                    +{color}
                  </button>
                ))}
                {overrideCardId ? (
                  <>
                    <button
                      type="button"
                      data-testid="override-tap"
                      onClick={() =>
                        sendOverride({ type: "set_tapped", cardId: overrideCardId, tapped: true })
                      }
                    >
                      Tap
                    </button>
                    <button
                      type="button"
                      data-testid="override-untap"
                      onClick={() =>
                        sendOverride({ type: "set_tapped", cardId: overrideCardId, tapped: false })
                      }
                    >
                      Untap
                    </button>
                    {overrideMoveZones.map((zone) => (
                      <button
                        key={zone}
                        type="button"
                        data-testid={`override-move-${zone}`}
                        onClick={() =>
                          sendOverride({
                            type: "move_card",
                            cardId: overrideCardId,
                            toZone: zone,
                          })
                        }
                      >
                        To {zone}
                      </button>
                    ))}
                  </>
                ) : null}
              </div>
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
