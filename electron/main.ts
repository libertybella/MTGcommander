import { app, BrowserWindow, ipcMain, net } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const electronDir = path.dirname(fileURLToPath(import.meta.url));

const ALLOWED_HOSTS = new Set([
  "api.scryfall.com",
  "api2.moxfield.com",
  "api.moxfield.com",
]);

type FetchInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "BizzyMTG Commander",
    backgroundColor: "#0f1419",
    webPreferences: {
      preload: path.join(electronDir, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(path.join(electronDir, "../dist/index.html"));
  }
}

ipcMain.handle("mtgcommander:fetch", async (_event, url: string, init: FetchInit = {}) => {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new Error(`Blocked host ${parsed.hostname}`);
  }
  const response = await net.fetch(url, {
    method: init.method ?? "GET",
    headers: init.headers,
    body: init.body,
  });
  const text = await response.text();
  return { ok: response.ok, status: response.status, text };
});

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
