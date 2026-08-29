import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/dm-sans/700.css";
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/500.css";
import "@fontsource/roboto/700.css";
import "@fontsource/roboto/900.css";
import "./index.css";
import { AppRootErrorBoundary } from "./components/AppRootErrorBoundary";
import App from "./App";
import { AppProviders } from "./providers/AppProviders";
import { Capacitor } from "@capacitor/core";
import { isElectronDesktop } from "./lib/electronDesktop";
import { initCapacitorShell } from "./lib/capacitorInit";
import { initCrashReporting, installGlobalErrorHandlers } from "./lib/crashReporting";
import { bootTrace } from "./lib/bootTrace";
import { recoverStuckStartupState, recordStartupStep } from "./lib/startupDiagnostics";
import { reportPwaIssue } from "./lib/monitoring";
import { installChunkLoadRecovery } from "./lib/siteDataRecovery";
import { warmupLocalDb } from "./offline/localDb";
import { bootstrapAppThemeClass } from "./lib/appTheme";
import { bootstrapDesktopDensityClass } from "./lib/desktopDensity";
import { queryClient } from "./lib/queryClient";

bootstrapAppThemeClass();
bootstrapDesktopDensityClass();

initCrashReporting();
installGlobalErrorHandlers();
installChunkLoadRecovery();
recoverStuckStartupState();
bootTrace("BOOT-001", "App mounted", "START");
recordStartupStep("app_launch");
bootTrace("BOOT-001", "App mounted", "SUCCESS");
warmupLocalDb();

/** PWA service worker: web only. Skip Electron (file://) and Capacitor WebViews (iOS/Android). */
if (!isElectronDesktop() && !Capacitor.isNativePlatform()) {
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
