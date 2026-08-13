import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron/simple";
import path from "node:path";
import { fileURLToPath } from "node:url";

const clientDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(clientDir, "..");

export default defineConfig({
  root: clientDir,
  plugins: [
    react(),
    electron({
      main: {
        entry: path.join(repoRoot, "electron/main.ts"),
        vite: {
          build: {
            outDir: path.join(repoRoot, "dist-electron"),
            rollupOptions: {
              external: ["electron"],
            },
          },
        },
      },
      preload: {
        input: path.join(repoRoot, "electron/preload.ts"),
        vite: {
          build: {
            outDir: path.join(repoRoot, "dist-electron"),
            rollupOptions: {
              external: ["electron"],
              output: {
                format: "cjs",
                entryFileNames: "preload.cjs",
              },
            },
          },
        },
      },
    }),
  ],
  server: {
    port: 5175,
    strictPort: true,
  },
  build: {
    outDir: path.join(repoRoot, "dist"),
    emptyOutDir: true,
  },
});
