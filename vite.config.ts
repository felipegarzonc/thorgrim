import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  plugins: [react()],
  build: { outDir: "../dist", emptyOutDir: true },
  server: {
    host: true, // reachable from your phone on the same Wi-Fi
    proxy: { "/api": "http://localhost:8787" },
  },
});
