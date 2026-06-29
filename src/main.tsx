import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/700.css";
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/500.css";
import "@fontsource/roboto/700.css";
import "@fontsource/roboto/900.css";
import "./index.css";
import { AppRootErrorBoundary } from "./components/AppRootErrorBoundary";
import App from "./App";
import { AppProviders } from "./providers/AppProviders";
import { isElectronDesktop } from "./lib/electronDesktop";
import { initCapacitorShell } from "./lib/capacitorInit";
import { initCrashReporting, installGlobalErrorHandlers } from "./lib/crashReporting";
import { bootTrace } from "./lib/bootTrace";
import { recoverStuckStartupState, recordStartupStep } from "./lib/startupDiagnostics";
import { reportPwaIssue } from "./lib/monitoring";
import { installChunkLoadRecovery } from "./lib/siteDataRecovery";
import { warmupLocalDb } from "./offline/localDb";
import { bootstrapAppThemeClass } from "./lib/appTheme";

bootstrapAppThemeClass();

initCrashReporting();
installGlobalErrorHandlers();
installChunkLoadRecovery();
recoverStuckStartupState();
bootTrace("BOOT-001", "App mounted", "START");
recordStartupStep("app_launch");
bootTrace("BOOT-001", "App mounted", "SUCCESS");
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
void initCapacitorShell().then(() => recordStartupStep("capacitor_init"));
const queryClient = new QueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppRootErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AppProviders>
          <App />
        </AppProviders>
      </QueryClientProvider>
    </AppRootErrorBoundary>
  </StrictMode>,
)
