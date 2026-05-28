import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { registerSW } from "virtual:pwa-register";
import "./index.css";
import App from "./App";
import { initCapacitorShell } from "./lib/capacitorInit";
import { reportPwaIssue } from "./lib/monitoring";
import { warmupLocalDb } from "./offline/localDb";

warmupLocalDb();

registerSW({
  immediate: true,
  onNeedRefresh() {
    window.dispatchEvent(new CustomEvent("waka:pwa-update"));
  },
  onRegisterError(error) {
    reportPwaIssue("sw_register_failed", { detail: error instanceof Error ? error.name : "unknown" });
  },
});
void initCapacitorShell();
const queryClient = new QueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
