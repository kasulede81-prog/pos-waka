import { useState } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";

type Props = {
  lang: Language;
  onSignOut: () => void | Promise<void>;
};

/** Minimal escape hatch during in-progress recovery — no retry to avoid interrupting active pull. */
export function RecoveryInProgressEscapeFooter({ lang, onSignOut }: Props) {
  const [busy, setBusy] = useState(false);

  const run = (fn: () => void | Promise<void>) => {
    if (busy) return;
    setBusy(true);
    void Promise.resolve(fn()).finally(() => setBusy(false));
  };

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 text-sm font-bold">
        <button type="button" disabled={busy} className="text-muted-foreground underline-offset-2 hover:underline" onClick={() => run(onSignOut)}>
          {t(lang, "startupLogout")}
        </button>
        <button type="button" disabled={busy} className="text-muted-foreground underline-offset-2 hover:underline" onClick={() => run(onSignOut)}>
          {t(lang, "startupSwitchAccount")}
        </button>
      </div>
    </div>
  );
}
