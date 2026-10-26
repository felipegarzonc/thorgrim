import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
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
