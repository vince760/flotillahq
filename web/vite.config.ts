import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      "/api": { target: "http://localhost:5175", changeOrigin: true },
      // The public pages are served by the API process, so proxy them in dev
      // too — otherwise they 404 here and only work in production.
      "/about": { target: "http://localhost:5175", changeOrigin: true },
      "/privacy": { target: "http://localhost:5175", changeOrigin: true },
      "/terms": { target: "http://localhost:5175", changeOrigin: true },
      "/style.css": { target: "http://localhost:5175", changeOrigin: true },
    },
  },
  build: { outDir: "dist", sourcemap: true },
});
