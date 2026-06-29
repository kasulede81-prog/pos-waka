import type { ReactNode } from "react";
import { AppThemeProvider } from "../context/AppThemeProvider";
import { BusinessBuilderProvider } from "../context/BusinessBuilderContext";

/** Top-level app providers — mounted from main.tsx before App routes. */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <AppThemeProvider>
      <BusinessBuilderProvider>{children}</BusinessBuilderProvider>
    </AppThemeProvider>
  );
}
