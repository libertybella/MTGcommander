import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("mtgCommander", {
  isElectron: true,
  appName: "BizzyMTG Commander",
});
