import { createContext, useContext, type ReactNode } from "react";
import type { Language, ShopPreferences } from "../../types";
import { usePosStore } from "../../store/usePosStore";
import { EnterpriseSaveIndicator } from "./EnterpriseSaveIndicator";
import { usePreferencesAutoSave } from "./usePreferencesAutoSave";

type PatchFn = (patch: Partial<ShopPreferences>) => void;

const PreferencesAutoSaveContext = createContext<PatchFn | null>(null);

export function PreferencesAutoSaveProvider({ lang, children }: { lang: Language; children: ReactNode }) {
  const { savePreferences, saveStatus } = usePreferencesAutoSave(lang);

  return (
    <PreferencesAutoSaveContext.Provider value={savePreferences}>
      {children}
      <div className="pointer-events-none fixed bottom-[calc(var(--waka-bottom-nav-h,0px)+5.5rem)] right-3 z-[34] md:bottom-6 md:right-6">
        <EnterpriseSaveIndicator lang={lang} mode="auto" status={saveStatus} className="pointer-events-auto shadow-md" />
      </div>
    </PreferencesAutoSaveContext.Provider>
  );
}

/** Prefer this over raw setPreferences on auto-save settings pages. */
export function usePreferencesPatch(): PatchFn {
  const patch = useContext(PreferencesAutoSaveContext);
  const setPreferences = usePosStore((s) => s.setPreferences);
  return patch ?? setPreferences;
}
