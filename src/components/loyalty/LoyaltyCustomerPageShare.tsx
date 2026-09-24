import { useEffect, useState } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { fetchLoyaltyAccountPublicCardToken } from "../../lib/loyalty/loyaltyMerchant";
import {
  buildCustomerLoyaltyCardUrl,
  copyCustomerPageLink,
  isWebShareAvailable,
  shareCustomerPageViaWebShare,
} from "../../lib/loyalty/loyaltyPublicCardShare";

/**
 * Merchant controls to copy/share the customer loyalty *page* URL
 * (https://loyalty.waka.ug/c/<public_card_token>).
 * Does not expose the raw token in the UI. Distinct from Google Wallet Save URL.
 */
export function LoyaltyCustomerPageShare({
  lang,
  shopId,
  accountId,
}: {
  lang: Language;
  shopId: string;
  accountId: string;
}) {
  const [pageUrl, setPageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPageUrl(null);
    setMessage(null);
    setError(null);
    void fetchLoyaltyAccountPublicCardToken(shopId, accountId).then((token) => {
      if (cancelled) return;
      setLoading(false);
      if (!token) {
        setError(t(lang, "loyaltyCustomerPageUnavailable"));
        return;
      }
      setPageUrl(buildCustomerLoyaltyCardUrl(token));
    });
    return () => {
      cancelled = true;
    };
  }, [shopId, accountId, lang]);

  if (loading) {
    return <p className="text-xs font-medium text-muted-foreground">{t(lang, "loyaltyLoading")}</p>;
  }

  if (!pageUrl) {
    return error ? <p className="text-xs font-bold text-destructive">{error}</p> : null;
  }

  const onCopy = async () => {
    setError(null);
    const result = await copyCustomerPageLink(pageUrl);
    setMessage(
      result === "copied" ? t(lang, "loyaltyCustomerPageLinkCopied") : t(lang, "loyaltyCustomerPageCopyFailed"),
    );
  };

  const onShare = async () => {
    setError(null);
    const result = await shareCustomerPageViaWebShare(pageUrl);
    if (result === "shared") {
      setMessage(t(lang, "loyaltyCustomerPageShareOpened"));
      return;
    }
    if (result === "cancelled") return;
    const copied = await copyCustomerPageLink(pageUrl);
    setMessage(
      copied === "copied"
        ? t(lang, "loyaltyCustomerPageShareFallbackCopied")
        : t(lang, "loyaltyCustomerPageCopyFailed"),
    );
  };

  return (
    <div className="rounded-2xl border border-border bg-card px-3 py-3">
      <p className="text-sm font-black text-foreground">{t(lang, "loyaltyCustomerPageTitle")}</p>
      <p className="mt-0.5 text-xs font-medium text-muted-foreground">
        {t(lang, "loyaltyCustomerPageHint")}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => void onCopy()}
          className="min-h-[44px] rounded-xl border-2 border-border bg-background px-3 text-sm font-black text-foreground"
        >
          {t(lang, "loyaltyCustomerPageCopyLink")}
        </button>
        <button
          type="button"
          onClick={() => void onShare()}
          className="min-h-[44px] rounded-xl border-2 border-border bg-background px-3 text-sm font-black text-foreground"
        >
          {isWebShareAvailable()
            ? t(lang, "loyaltyCustomerPageShare")
            : t(lang, "loyaltyCustomerPageShareOrCopy")}
        </button>
      </div>
      {message ? <p className="mt-2 text-xs font-bold text-success">{message}</p> : null}
      {error ? <p className="mt-2 text-xs font-bold text-destructive">{error}</p> : null}
    </div>
  );
}
