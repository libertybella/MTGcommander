/**
 * Authoritative host process.
 * Local tables use GameHost in-process. WebSockets and rooms remain later.
 */

import { getEngineInfo, type EngineInfo } from "@mtgcommander/engine";

export type ServerInfo = {
  name: "mtgcommander-server";
  version: string;
  engine: EngineInfo;
};

export function getServerInfo(): ServerInfo {
  return {
    name: "mtgcommander-server",
    version: "0.1.0",
    engine: getEngineInfo(),
  };
}

export { GameHost, type SubmitResult } from "./session";
export {
  TABLE_STORAGE_KEY,
  TABLE_SNAPSHOT_VERSION,
  snapshotHost,
  hostFromSnapshot,
  saveTable,
  loadTable,
  clearTable,
  type SnapshotStore,
  type TableSnapshot,
} from "./persist";
export { CardDatabase, ORACLE_CACHE_KEY } from "./cards";
export type { HttpFetch, HttpRequestInit, HttpResponse } from "./http";
export { fetchMoxfieldDeck, parseMoxfieldDeckJson } from "./moxfield";
export {
  compileParsedDeck,
  importMoxfieldDeck,
  importTextDeck,
  startImportedTable,
} from "./importDeck";
export type { CompiledDeck, ImportedTable } from "./importDeck";
export { oracleCardFromScryfall, fetchOracleCardsByName } from "./scryfall";
