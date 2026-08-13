/**
 * Pure TypeScript game-engine package.
 * Must not import React, DOM, Electron, or networking.
 * GameState and rules belong to Phase 2 — this file is a health check only.
 */

export type EngineInfo = {
  name: "mtgcommander-engine";
  version: string;
};

export function getEngineInfo(): EngineInfo {
  return {
    name: "mtgcommander-engine",
    version: "0.1.0",
  };
}
