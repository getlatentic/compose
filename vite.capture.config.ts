import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * The quick-capture window's page, built on its own after the app. In the app's
 * build a second entry would split what the two share (React, the Tauri API) out
 * of the main entry, whose eager graph is kept to one file for launch speed.
 */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: false,
    rollupOptions: {
      input: { capture: fileURLToPath(new URL("capture.html", import.meta.url)) },
    },
  },
});
