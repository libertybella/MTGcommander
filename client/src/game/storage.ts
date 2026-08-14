import type { SnapshotStore } from "@mtgcommander/server";

const emptyStore: SnapshotStore = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

export function browserStore(): SnapshotStore {
  try {
    return window.localStorage;
  } catch {
    return emptyStore;
  }
}
