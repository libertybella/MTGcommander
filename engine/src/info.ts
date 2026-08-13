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
