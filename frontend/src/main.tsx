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
