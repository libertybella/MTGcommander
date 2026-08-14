import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    include: [
      "engine/src/**/*.test.ts",
      "server/src/**/*.test.ts",
      "client/src/**/*.test.ts",
      "client/src/**/*.test.tsx",
    ],
  },
});
