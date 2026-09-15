import { useCallback, useRef, useState } from "react";
import type { Language } from "../../types";
import type { ShopPreferences } from "../../types";
import { usePosStore } from "../../store/usePosStore";
import type { EnterpriseSaveIndicatorProps } from "./EnterpriseSaveIndicator";

type PreferencesPatch = Partial<ShopPreferences>;

export function usePreferencesAutoSave(_lang: Language) {
  const setPreferences = usePosStore((s) => s.setPreferences);
  const [status, setStatus] = useState<EnterpriseSaveIndicatorProps["status"]>("idle");
  const timerRef = useRef<number | null>(null);

  const savePreferences = useCallback(
    (patch: PreferencesPatch) => {
      setStatus("saving");
      setPreferences(patch);
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
      setStatus("saved");
      timerRef.current = window.setTimeout(() => setStatus("idle"), 2200);
    },
    [setPreferences],
  );

  return { savePreferences, saveStatus: status };
}
