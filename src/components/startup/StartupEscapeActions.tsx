import { useState } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";

type Props = {
  lang: Language;
  onRetry: () => void;
  onContinueOffline?: () => void;
  canContinueOffline?: boolean;
  onSignOut: () => void | Promise<void>;
  onSwitchAccount?: () => void | Promise<void>;
  title?: string;
  subtitle?: string;
};

export function StartupEscapeActions({
  lang,
  onRetry,
  onContinueOffline,
  canContinueOffline = false,
  onSignOut,
  onSwitchAccount,
  title,
  subtitle,
}: Props) {
  const [busy, setBusy] = useState(false);

  const run = (fn: () => void | Promise<void>) => {
    if (busy) return;
    setBusy(true);
    void Promise.resolve(fn()).finally(() => setBusy(false));
  };

  return (
    <div className="space-y-3">
      {title ? <p className="text-center text-base font-black text-stone-900">{title}</p> : null}
      {subtitle ? <p className="text-center text-sm font-medium text-stone-600">{subtitle}</p> : null}

      <button
        type="button"
        disabled={busy}
        onClick={() => run(onRetry)}
        className="flex min-h-[48px] w-full items-center justify-center rounded-2xl bg-stone-900 text-base font-black text-white disabled:opacity-60"
      >
        {t(lang, "startupRetry")}
      </button>

      {canContinueOffline && onContinueOffline ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => run(onContinueOffline)}
          className="flex min-h-[48px] w-full items-center justify-center rounded-2xl border-2 border-waka-300 bg-white text-base font-black text-waka-900 disabled:opacity-60"
        >
          {t(lang, "startupContinueOffline")}
        </button>
      ) : null}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => run(onSignOut)}
          className="min-h-[44px] rounded-xl border-2 border-stone-200 bg-white text-sm font-black text-stone-800 disabled:opacity-60"
        >
          {t(lang, "startupLogout")}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => run(onSwitchAccount ?? onSignOut)}
          className="min-h-[44px] rounded-xl border-2 border-stone-200 bg-white text-sm font-black text-stone-800 disabled:opacity-60"
        >
          {t(lang, "startupSwitchAccount")}
        </button>
      </div>
    </div>
  );
}
