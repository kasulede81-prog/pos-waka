import { useEffect } from "react";
import type { Language } from "../../types";

/**
 * Warns before closing the tab when a form has unsaved edits.
 * In-app back navigation is not blocked — WAKA uses BrowserRouter, not a data router.
 */
export function useUnsavedChangesGuard(_lang: Language, dirty: boolean, enabled = true): void {
  useEffect(() => {
    if (!enabled || !dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, enabled]);
}
