import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
// The fonts come with the app (same address, kept by the phone with its other files), not from Google:
// a phone on mobile data then doesn't wait on a second server before it can show the page.
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "@fontsource/inter/latin-800.css";
import "@fontsource/cinzel/latin-600.css";
import "@fontsource/cinzel/latin-700.css";
import "./styles.css";
import { loadLanguage, startTranslating } from "./i18n.ts";
import { PageAnalytics } from "./analytics.tsx";
import { ErrorBoundary, tolerateExtensions } from "./guard.tsx";

tolerateExtensions();
// The app's files kept on the phone (web/public/sw.js): opens at once, also without signal.
if ("serviceWorker" in navigator && location.protocol === "https:") window.addEventListener("load", () => void navigator.serviceWorker.register("/sw.js").catch(() => undefined));
// Spanish players wait for their phrases (a moment, once: then the phone keeps them), so the app never flashes in English.
void loadLanguage()
  .catch(() => undefined)
  .then(() => {
    startTranslating();
    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
        <PageAnalytics />
      </StrictMode>,
    );
  });
