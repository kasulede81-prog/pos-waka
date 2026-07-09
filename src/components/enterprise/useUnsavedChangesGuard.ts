import { useEffect } from "react";
import { useBlocker } from "react-router-dom";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";

/**
 * Blocks in-app navigation when `dirty` and confirms before leaving.
 * Presentation-only guard for explicit-save forms.
 */
export function useUnsavedChangesGuard(lang: Language, dirty: boolean, enabled = true): void {
  const blocker = useBlocker(enabled && dirty);

  useEffect(() => {
    if (!enabled || !dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, enabled]);

  useEffect(() => {
    if (blocker.state !== "blocked") return;
    const ok = window.confirm(t(lang, "enterpriseDiscardChangesConfirm"));
    if (ok) blocker.proceed();
    else blocker.reset();
  }, [blocker, lang]);
}
