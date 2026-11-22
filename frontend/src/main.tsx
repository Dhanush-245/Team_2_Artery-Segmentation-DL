import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "next-themes";
import { BrowserRouter } from "react-router-dom";
// Global styles, in cascade order. Section styles load with the signed-in workspace (styles/sections.css).
import "./styles/foundation.css";
import "./styles/app.css";
import "./styles/design-variants.css";
import "./styles/theme.css";
import "./designPreview";

// After a new deployment, a tab opened earlier asks for code chunks that no longer
// exist. Reload once to pick up the current build instead of showing a crash;
// the timestamp guard stops a reload loop if the chunk is genuinely missing.
window.addEventListener("vite:preloadError", (event) => {
  const key = "cv-chunk-reload-at";
  let last = 0;
  try { last = Number(sessionStorage.getItem(key)) || 0; } catch { /* storage blocked */ }
  if (Date.now() - last < 60_000) return;
  event.preventDefault();
  try { sessionStorage.setItem(key, String(Date.now())); } catch { /* storage blocked */ }
  window.location.reload();
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
      <BrowserRouter>
        <ErrorBoundary label="CoroVision AI">
          <App />
        </ErrorBoundary>
      </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>,
);
