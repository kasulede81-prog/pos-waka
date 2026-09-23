import { useEffect, useState } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import {
  fetchGoogleWalletConfigured,
  issueGoogleWalletPass,
  requestGoogleWalletBalanceSync,
} from "../../lib/loyalty/loyaltyGoogleWallet";
import {
  buildSmsShareHref,
  buildWhatsAppShareHref,
  copyWalletLink,
  isWebShareAvailable,
  openWalletLinkOnThisDevice,
  shareWalletLinkViaWebShare,
} from "../../lib/loyalty/loyaltyWalletShare";

/**
 * Merchant Google Wallet delivery (Phase 2).
 *
 * Generates the existing Save URL, then offers Copy / Share / WhatsApp / SMS.
 * Opening Wallet on this device is secondary (testing / customer's phone in hand).
 * The Save URL is kept only in component state — never logged or persisted.
 */
export function LoyaltyGoogleWalletButton({
  lang,
  shopId,
  accountId,
  canIssue,
}: {
  lang: Language;
  shopId: string;
  accountId: string;
  canIssue: boolean;
}) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveUrl, setSaveUrl] = useState<string | null>(null);
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

  // Drop the in-memory Save URL when switching members.
  useEffect(() => {
    setSaveUrl(null);
    setMessage(null);
    setError(null);
  }, [shopId, accountId]);

  if (!canIssue) return null;

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

  const clearFeedback = () => {
    setError(null);
    setMessage(null);
  };

  const onCreateCard = async () => {
    if (busy) return;
    setBusy(true);
    clearFeedback();
    setSaveUrl(null);
    const result = await issueGoogleWalletPass(shopId, accountId);
    setBusy(false);
    if (!result.ok) {
      setError(
        result.error === "wallet_not_configured"
          ? t(lang, "loyaltyGoogleWalletNotConfigured")
          : result.error === "account_not_found" || result.error === "shop_not_found"
            ? t(lang, "loyaltyGoogleWalletDenied")
            : t(lang, "loyaltyGoogleWalletCreateFailed"),
      );
      return;
    }
    setSaveUrl(result.saveUrl);
    void requestGoogleWalletBalanceSync(shopId, accountId);
  };

  const onCopy = async () => {
    if (!saveUrl) return;
    clearFeedback();
    const result = await copyWalletLink(saveUrl);
    setMessage(result === "copied" ? t(lang, "loyaltyGoogleWalletLinkCopied") : t(lang, "loyaltyGoogleWalletCopyFailed"));
  };

  const onShare = async () => {
    if (!saveUrl) return;
    clearFeedback();
    const result = await shareWalletLinkViaWebShare(saveUrl);
    if (result === "shared") {
      setMessage(t(lang, "loyaltyGoogleWalletShareOpened"));
      return;
    }
    if (result === "cancelled") return;
    // Fallback: copy when Web Share missing or failed.
    const copied = await copyWalletLink(saveUrl);
    setMessage(
      copied === "copied"
        ? t(lang, "loyaltyGoogleWalletShareFallbackCopied")
        : t(lang, "loyaltyGoogleWalletCopyFailed"),
    );
  };

  const onWhatsApp = () => {
    if (!saveUrl) return;
    clearFeedback();
    window.open(buildWhatsAppShareHref(saveUrl), "_blank", "noopener,noreferrer");
    setMessage(t(lang, "loyaltyGoogleWalletShareOpened"));
  };

  const onSms = () => {
    if (!saveUrl) return;
    clearFeedback();
    window.location.href = buildSmsShareHref(saveUrl);
    setMessage(t(lang, "loyaltyGoogleWalletShareOpened"));
  };

  const onOpenHere = () => {
    if (!saveUrl) return;
    clearFeedback();
    const ok = openWalletLinkOnThisDevice(saveUrl);
    setMessage(ok ? t(lang, "loyaltyGoogleWalletOpenedHere") : t(lang, "loyaltyGoogleWalletCreateFailed"));
  };

  const webShareOk = isWebShareAvailable();

  return (
    <div className="rounded-2xl border border-border bg-card px-3 py-3">
      <p className="text-sm font-black text-foreground">{t(lang, "loyaltyGoogleWalletTitle")}</p>
      <p className="mt-0.5 text-xs font-medium text-muted-foreground">
        {t(lang, "loyaltyGoogleWalletHintVsPage")}
      </p>

      {!saveUrl ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void onCreateCard()}
          className="mt-3 min-h-[44px] w-full rounded-xl bg-[#1a73e8] px-4 text-sm font-black text-white disabled:opacity-50"
        >
          {busy ? t(lang, "loyaltyGoogleWalletCreating") : t(lang, "loyaltyGoogleWalletSendCard")}
        </button>
      ) : (
        <div className="mt-3 space-y-2">
          <p className="text-xs font-bold text-foreground">{t(lang, "loyaltyGoogleWalletSendTitle")}</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => void onCopy()}
              className="min-h-[44px] rounded-xl border-2 border-border bg-background px-3 text-sm font-black text-foreground"
            >
              {t(lang, "loyaltyGoogleWalletCopyLink")}
            </button>
            <button
              type="button"
              onClick={() => void onShare()}
              className="min-h-[44px] rounded-xl border-2 border-border bg-background px-3 text-sm font-black text-foreground"
            >
              {webShareOk ? t(lang, "loyaltyGoogleWalletShare") : t(lang, "loyaltyGoogleWalletShareOrCopy")}
            </button>
            <button
              type="button"
              onClick={onWhatsApp}
              className="min-h-[44px] rounded-xl border-2 border-border bg-background px-3 text-sm font-black text-foreground"
            >
              {t(lang, "loyaltyGoogleWalletWhatsApp")}
            </button>
            <button
              type="button"
              onClick={onSms}
              className="min-h-[44px] rounded-xl border-2 border-border bg-background px-3 text-sm font-black text-foreground"
            >
              {t(lang, "loyaltyGoogleWalletSms")}
            </button>
          </div>
          <button
            type="button"
            onClick={onOpenHere}
            className="min-h-[40px] w-full rounded-xl px-3 text-xs font-bold text-muted-foreground underline-offset-2 hover:underline"
          >
            {t(lang, "loyaltyGoogleWalletOpenHere")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onCreateCard()}
            className="min-h-[40px] w-full rounded-xl border border-dashed border-border px-3 text-xs font-bold text-muted-foreground disabled:opacity-50"
          >
            {busy ? t(lang, "loyaltyGoogleWalletCreating") : t(lang, "loyaltyGoogleWalletCreateAgain")}
          </button>
        </div>
      )}

      {message ? <p className="mt-2 text-xs font-bold text-success">{message}</p> : null}
      {error ? <p className="mt-2 text-xs font-bold text-destructive">{error}</p> : null}
    </div>
  );
}
