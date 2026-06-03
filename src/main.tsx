import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./index.css";
import App from "./App";
import { isElectronDesktop } from "./lib/electronDesktop";
import { initCapacitorShell } from "./lib/capacitorInit";
import { initCrashReporting, installGlobalErrorHandlers } from "./lib/crashReporting";
import { reportPwaIssue } from "./lib/monitoring";
import { warmupLocalDb } from "./offline/localDb";

initCrashReporting();
installGlobalErrorHandlers();
warmupLocalDb();

if (!isElectronDesktop()) {
  void import("virtual:pwa-register").then(({ registerSW }) => {
    registerSW({
      immediate: true,
      onNeedRefresh() {
        window.dispatchEvent(new CustomEvent("waka:pwa-update"));
      },
      onRegisterError(error) {
        reportPwaIssue("sw_register_failed", { detail: error instanceof Error ? error.name : "unknown" });
      },
    });
  });
}
void initCapacitorShell();
const queryClient = new QueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
