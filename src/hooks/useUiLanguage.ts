import { useCallback, useEffect, useState } from "react";
import type { Language } from "../types";
import { loadPersistedUiLanguage, persistUiLanguage, readUiLanguageCacheSync } from "../lib/uiLanguage";

/**
 * Restores UI language on boot. Never blocks the shell — iOS Safari can hang on Preferences.
 */
export function useUiLanguage() {
  const cached = readUiLanguageCacheSync();
  const [lang, setLangState] = useState<Language>(cached ?? "en");

  useEffect(() => {
    let cancelled = false;
    void loadPersistedUiLanguage().then((loaded) => {
      if (cancelled) return;
      setLangState(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setLang = useCallback((next: Language) => {
    setLangState(next);
    void persistUiLanguage(next);
  }, []);

  return { lang, setLang, ready: true };
}
