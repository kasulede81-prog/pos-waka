import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";
import {
  applyDisplayScaleCssVars,
  clearDisplayScaleCssVars,
  DEFAULT_DISPLAY_SCALE_LEVEL,
  DISPLAY_SCALE_META,
  stepDisplayScaleLevel,
  type DisplayScaleLevel,
} from "../lib/displayScale/scaleTokens";
import { loadDisplayScaleLevel, saveDisplayScaleLevel } from "../lib/displayScale/displayScaleStorage";
import { fetchPlatformDisplayScaleSettings } from "../lib/displayScale/platformDisplayScale";

type DisplayScaleContextValue = {
  level: DisplayScaleLevel;
  percent: number;
  featureEnabled: boolean;
  ready: boolean;
  setLevel: (level: DisplayScaleLevel) => void;
  stepUp: () => void;
  stepDown: () => void;
  reset: () => void;
};

const DisplayScaleContext = createContext<DisplayScaleContextValue | null>(null);

const POS_SCALE_CLASS = "pos-display-scale-active";

export function DisplayScaleProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [level, setLevelState] = useState<DisplayScaleLevel>(() => loadDisplayScaleLevel());
  const [featureEnabled, setFeatureEnabled] = useState(true);
  const [ready, setReady] = useState(false);

  const onPosRoute = location.pathname === "/pos" || location.pathname.startsWith("/pos/");

  useEffect(() => {
    let cancelled = false;
    void fetchPlatformDisplayScaleSettings().then(({ settings }) => {
      if (!cancelled) {
        setFeatureEnabled(settings.enabled);
        setReady(true);
      }
    });
    const onPlatform = () => {
      void fetchPlatformDisplayScaleSettings(true).then(({ settings }) => setFeatureEnabled(settings.enabled));
    };
    window.addEventListener("waka:platform-display-scale-changed", onPlatform);
    return () => {
      cancelled = true;
      window.removeEventListener("waka:platform-display-scale-changed", onPlatform);
    };
  }, []);

  const setLevel = useCallback((next: DisplayScaleLevel) => {
    setLevelState(next);
    saveDisplayScaleLevel(next);
  }, []);

  const stepUp = useCallback(() => {
    setLevelState((prev) => {
      const next = stepDisplayScaleLevel(prev, 1);
      saveDisplayScaleLevel(next);
      return next;
    });
  }, []);

  const stepDown = useCallback(() => {
    setLevelState((prev) => {
      const next = stepDisplayScaleLevel(prev, -1);
      saveDisplayScaleLevel(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setLevel(DEFAULT_DISPLAY_SCALE_LEVEL);
  }, [setLevel]);

  useEffect(() => {
    const root = document.documentElement;
    if (!onPosRoute || !featureEnabled) {
      root.classList.remove(POS_SCALE_CLASS);
      clearDisplayScaleCssVars(root);
      return;
    }
    root.classList.add(POS_SCALE_CLASS);
    applyDisplayScaleCssVars(root, level);
    return () => {
      root.classList.remove(POS_SCALE_CLASS);
      clearDisplayScaleCssVars(root);
    };
  }, [onPosRoute, featureEnabled, level]);

  const value = useMemo<DisplayScaleContextValue>(
    () => ({
      level,
      percent: DISPLAY_SCALE_META[level].percent,
      featureEnabled,
      ready,
      setLevel,
      stepUp,
      stepDown,
      reset,
    }),
    [level, featureEnabled, ready, setLevel, stepUp, stepDown, reset],
  );

  return <DisplayScaleContext.Provider value={value}>{children}</DisplayScaleContext.Provider>;
}

export function useDisplayScale(): DisplayScaleContextValue {
  const ctx = useContext(DisplayScaleContext);
  if (!ctx) {
    return {
      level: DEFAULT_DISPLAY_SCALE_LEVEL,
      percent: 100,
      featureEnabled: false,
      ready: true,
      setLevel: () => undefined,
      stepUp: () => undefined,
      stepDown: () => undefined,
      reset: () => undefined,
    };
  }
  return ctx;
}
