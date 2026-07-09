import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  // ws:true wajib — tanpa itu proxy menjawab upgrade /api/terminal/... dengan 404 HTTP.
  server: { proxy: { "/api": { target: "http://localhost:8787", ws: true } } },
  build: { outDir: "dist" },
  test: { environment: "jsdom", setupFiles: "./test/setup.ts", globals: true },
});
