import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./styles.css";
import { startTranslating } from "./i18n.ts";
import { PageAnalytics } from "./analytics.tsx";
import { ErrorBoundary, tolerateExtensions } from "./guard.tsx";

tolerateExtensions();
startTranslating();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
    <PageAnalytics />
  </StrictMode>,
);
