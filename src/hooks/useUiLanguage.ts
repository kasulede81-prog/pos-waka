import { useCallback, useEffect, useState } from "react";
import type { Language } from "../types";
import { loadPersistedUiLanguage, persistUiLanguage, readUiLanguageCacheSync } from "../lib/uiLanguage";

/**
 * Restores UI language on boot without an English flash when a cached value exists.
 * On first launch, waits for Preferences before rendering children.
 */
export function useUiLanguage() {
  const cached = readUiLanguageCacheSync();
  const [ready, setReady] = useState(cached !== null);
  const [lang, setLangState] = useState<Language>(cached ?? "en");

  useEffect(() => {
    let cancelled = false;
    void loadPersistedUiLanguage().then((loaded) => {
      if (cancelled) return;
      setLangState(loaded);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setLang = useCallback((next: Language) => {
    setLangState(next);
    void persistUiLanguage(next);
  }, []);

  return { lang, setLang, ready };
}
