import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

import AuthGate from "./AuthGate";
import App from "./App";

import { registerSW } from "virtual:pwa-register";

registerSW({
  immediate: true,
  onOfflineReady() {
    console.log("✅ App pronta offline");
  },
  onNeedRefresh() {
    console.log("🔄 Aggiornamento disponibile");
  }
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthGate>
      <App />
    </AuthGate>
  </StrictMode>
);
