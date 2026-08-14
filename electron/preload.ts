import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("mtgCommander", {
  isElectron: true,
  appName: "BizzyMTG Commander",
  httpFetch: async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    const result = (await ipcRenderer.invoke("mtgcommander:fetch", url, init ?? {})) as {
      ok: boolean;
      status: number;
      text: string;
    };
    return {
      ok: result.ok,
      status: result.status,
      text: async () => result.text,
      json: async () => JSON.parse(result.text) as unknown,
    };
  },
});
