import type { ReactNode } from "react";
import { AppThemeProvider } from "../context/AppThemeProvider";
import { BusinessBuilderProvider } from "../context/BusinessBuilderContext";
import { AppReleaseUpdateProvider } from "../components/app-update/AppReleaseUpdateProvider";

/** Top-level app providers — mounted from main.tsx before App routes. */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <AppThemeProvider>
      <BusinessBuilderProvider>
        <AppReleaseUpdateProvider>{children}</AppReleaseUpdateProvider>
      </BusinessBuilderProvider>
    </AppThemeProvider>
  );
}
