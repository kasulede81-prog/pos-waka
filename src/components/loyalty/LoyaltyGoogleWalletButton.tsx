import { useEffect, useState } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import {
  fetchGoogleWalletConfigured,
  issueGoogleWalletPass,
  requestGoogleWalletBalanceSync,
} from "../../lib/loyalty/loyaltyGoogleWallet";

/**
 * Merchant action: Add loyalty member to Google Wallet (Phase 5).
 * Shows a clear "not configured" state when secrets are missing — never a fake button.
 */
export function LoyaltyGoogleWalletButton({
  lang,
  shopId,
  accountId,
  canManage,
}: {
  lang: Language;
  shopId: string;
  accountId: string;
  canManage: boolean;
}) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchGoogleWalletConfigured().then((status) => {
      if (cancelled) return;
      if (status.ok) setConfigured(status.configured);
      else setConfigured(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!canManage) return null;

  if (configured === null) {
    return (
      <p className="text-xs font-medium text-muted-foreground">{t(lang, "loyaltyLoading")}</p>
    );
  }

  if (!configured) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-muted/40 px-3 py-3">
        <p className="text-sm font-black text-foreground">{t(lang, "loyaltyGoogleWalletTitle")}</p>
        <p className="mt-1 text-xs font-medium text-muted-foreground">
          {t(lang, "loyaltyGoogleWalletNotConfigured")}
        </p>
      </div>
    );
  }

  const onIssue = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    const result = await issueGoogleWalletPass(shopId, accountId);
    setBusy(false);
    if (!result.ok) {
      setError(
        result.error === "wallet_not_configured"
          ? t(lang, "loyaltyGoogleWalletNotConfigured")
          : result.error === "account_not_found" || result.error === "shop_not_found"
            ? t(lang, "loyaltyGoogleWalletDenied")
            : t(lang, "loyaltyGoogleWalletFailed"),
      );
      return;
    }
    setMessage(t(lang, "loyaltyGoogleWalletOpened"));
    void requestGoogleWalletBalanceSync(shopId, accountId);
    try {
      window.open(result.saveUrl, "_blank", "noopener,noreferrer");
    } catch {
      setError(t(lang, "loyaltyGoogleWalletFailed"));
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card px-3 py-3">
      <p className="text-sm font-black text-foreground">{t(lang, "loyaltyGoogleWalletTitle")}</p>
      <p className="mt-0.5 text-xs font-medium text-muted-foreground">
        {t(lang, "loyaltyGoogleWalletHint")}
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => void onIssue()}
        className="mt-3 min-h-[44px] w-full rounded-xl bg-[#1a73e8] px-4 text-sm font-black text-white disabled:opacity-50"
      >
        {busy ? t(lang, "loyaltyLoading") : t(lang, "loyaltyGoogleWalletAdd")}
      </button>
      {message ? <p className="mt-2 text-xs font-bold text-success">{message}</p> : null}
      {error ? <p className="mt-2 text-xs font-bold text-destructive">{error}</p> : null}
    </div>
  );
}
