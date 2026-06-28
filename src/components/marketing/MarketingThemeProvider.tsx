import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  cycleMarketingTheme,
  marketingThemeColorMeta,
  persistMarketingTheme,
  readStoredMarketingTheme,
  systemPrefersDark,
  type MarketingThemePreference,
  type MarketingThemeResolved,
} from "../../lib/marketingTheme";

type MarketingThemeContextValue = {
  preference: MarketingThemePreference;
  resolved: MarketingThemeResolved;
  cycleTheme: () => void;
  setPreference: (preference: MarketingThemePreference) => void;
};

const MarketingThemeContext = createContext<MarketingThemeContextValue | null>(null);

export function MarketingThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<MarketingThemePreference>(
    () => readStoredMarketingTheme() ?? "system",
  );
  const [systemDark, setSystemDark] = useState(() => systemPrefersDark());

  const resolved = useMemo((): MarketingThemeResolved => {
    if (preference === "light") return "light";
    if (preference === "dark") return "dark";
    return systemDark ? "dark" : "light";
  }, [preference, systemDark]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("marketing-theme-dark", resolved === "dark");
    root.style.colorScheme = resolved;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", marketingThemeColorMeta(resolved));
    return () => {
      root.classList.remove("marketing-theme-dark");
      root.style.colorScheme = "";
      if (meta) meta.setAttribute("content", "#FFFFFF");
    };
  }, [resolved]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemDark(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const setPreference = useCallback((next: MarketingThemePreference) => {
    persistMarketingTheme(next);
    setPreferenceState(next);
  }, []);

  const cycleTheme = useCallback(() => {
    setPreference(cycleMarketingTheme(preference));
  }, [preference, setPreference]);

  const value = useMemo(
    () => ({ preference, resolved, cycleTheme, setPreference }),
    [preference, resolved, cycleTheme, setPreference],
  );

  return <MarketingThemeContext.Provider value={value}>{children}</MarketingThemeContext.Provider>;
}

export function useMarketingTheme(): MarketingThemeContextValue {
  const ctx = useContext(MarketingThemeContext);
  if (!ctx) throw new Error("useMarketingTheme must be used within MarketingThemeProvider");
  return ctx;
}
