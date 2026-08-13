/**
 * Authoritative host process placeholder.
 * Phase 1 only proves the server can import the engine.
 * No listen(), WebSockets, rooms, or GameState yet.
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
