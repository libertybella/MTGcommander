import { parseGameState, type PlayerId } from "@mtgcommander/engine";
import { GameHost } from "./session";

export const TABLE_STORAGE_KEY = "mtgcommander.table.v1";
export const TABLE_SNAPSHOT_VERSION = 1 as const;

export type SnapshotStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export type TableSnapshot = {
  version: typeof TABLE_SNAPSHOT_VERSION;
  viewerId: PlayerId;
  seatedPlayerIds: PlayerId[];
  state: string;
};

export function snapshotHost(host: GameHost): TableSnapshot {
  return {
    version: TABLE_SNAPSHOT_VERSION,
    viewerId: host.getViewerId(),
    seatedPlayerIds: host.getSeatedPlayerIds(),
    state: host.serializeAuthority(),
  };
}

export function hostFromSnapshot(snapshot: TableSnapshot): GameHost {
  if (snapshot.version !== TABLE_SNAPSHOT_VERSION) {
    throw new Error("Unsupported table snapshot version");
  }
  return GameHost.restore(
    parseGameState(snapshot.state),
    snapshot.viewerId,
    snapshot.seatedPlayerIds,
  );
}

export function saveTable(store: SnapshotStore, host: GameHost): void {
  store.setItem(TABLE_STORAGE_KEY, JSON.stringify(snapshotHost(host)));
}

export function loadTable(store: SnapshotStore): GameHost | null {
  const raw = store.getItem(TABLE_STORAGE_KEY);
  if (!raw) {
    return null;
  }
  const parsed: unknown = JSON.parse(raw);
  if (!isTableSnapshot(parsed)) {
    return null;
  }
  try {
    return hostFromSnapshot(parsed);
  } catch {
    return null;
  }
}

export function clearTable(store: SnapshotStore): void {
  store.removeItem(TABLE_STORAGE_KEY);
}

function isTableSnapshot(value: unknown): value is TableSnapshot {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.version === TABLE_SNAPSHOT_VERSION &&
    typeof record.viewerId === "string" &&
    Array.isArray(record.seatedPlayerIds) &&
    record.seatedPlayerIds.every((id) => typeof id === "string") &&
    typeof record.state === "string"
  );
}
