import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  applyAppThemeClass,
  cycleAppTheme,
  persistAppTheme,
  readStoredAppTheme,
  systemPrefersDark,
  type AppThemePreference,
  type AppThemeResolved,
} from "../lib/appTheme";

type AppThemeContextValue = {
  preference: AppThemePreference;
  resolved: AppThemeResolved;
  cycleTheme: () => void;
  setPreference: (preference: AppThemePreference) => void;
};

const AppThemeContext = createContext<AppThemeContextValue | null>(null);

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<AppThemePreference>(
    () => readStoredAppTheme() ?? "system",
  );
  const [systemDark, setSystemDark] = useState(() => systemPrefersDark());

  const resolved = useMemo((): AppThemeResolved => {
    if (preference === "light") return "light";
    if (preference === "dark") return "dark";
    return systemDark ? "dark" : "light";
  }, [preference, systemDark]);

  useEffect(() => {
    applyAppThemeClass(resolved);
  }, [resolved]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemDark(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const setPreference = useCallback((next: AppThemePreference) => {
    persistAppTheme(next);
    setPreferenceState(next);
  }, []);

  const cycleTheme = useCallback(() => {
    setPreference(cycleAppTheme(preference));
  }, [preference, setPreference]);

  const value = useMemo(
    () => ({ preference, resolved, cycleTheme, setPreference }),
    [preference, resolved, cycleTheme, setPreference],
  );

  return <AppThemeContext.Provider value={value}>{children}</AppThemeContext.Provider>;
}

export function useAppTheme(): AppThemeContextValue {
  const ctx = useContext(AppThemeContext);
  if (!ctx) throw new Error("useAppTheme must be used within AppThemeProvider");
  return ctx;
}
