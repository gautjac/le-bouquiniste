import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";
import { ensurePersistentStorage } from "./persist";
import { SettingsProvider } from "./store/settings";

// Ask the browser not to evict the library (it's the only copy). Best effort; never blocks.
void ensurePersistentStorage();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SettingsProvider>
      <App />
    </SettingsProvider>
  </StrictMode>,
);
