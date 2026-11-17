import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/**
 * Spanish players need the Spanish phrases (shared/i18n/es.ts, a chunk of
 * its own) before the app shows. Without help the phone only asks for it once
 * the app's main file has arrived and run: two downloads one after the other.
 * This puts a few lines in the page that, for a Spanish phone, ask for it at
 * the same time as the main file (same rule as web/src/i18n.ts, currentLang).
 */
function preloadSpanish(): Plugin {
  return {
    name: "thorgrim-preload-spanish",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        const es = Object.values(ctx.bundle ?? {}).find((c) => c.type === "chunk" && /(^|\/)es-[\w-]+\.js$/.test(c.fileName));
        if (!es) return html;
        const script = `<script>(function(){try{var s=localStorage.getItem("thorgrim-lang");var es=s?s==="es":(navigator.languages||[navigator.language]).some(function(l){return l&&l.toLowerCase().indexOf("es")===0});if(es){var l=document.createElement("link");l.rel="modulepreload";l.crossOrigin="";l.href="/${es.fileName}";document.head.appendChild(l)}}catch(e){}})()</script>`;
        // First in <head>: a script placed after the stylesheet waits for it to load before it runs.
        return html.replace("<head>", `<head>\n    ${script}`);
      },
    },
  };
}

export default defineConfig({
  root: "web",
  plugins: [react(), preloadSpanish()],
  build: { outDir: "../dist", emptyOutDir: true },
  server: {
    host: true, // reachable from your phone on the same Wi-Fi
    proxy: { "/api": "http://localhost:8787" },
  },
});
