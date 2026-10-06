import { useEffect, useState } from "react";
import QRCode from "qrcode";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { PublicLoyaltyCardView } from "../components/loyalty/public/PublicLoyaltyCardView";
import { SeoHead } from "../components/marketing/SeoHead";
import { LOYALTY_QR_PREFIX } from "../lib/loyalty/loyaltyEnrollment";
import {
  fetchPublicLoyaltyCard,
  issuePublicGoogleWallet,
  isValidPublicCardTokenFormat,
  type PublicCardData,
} from "../lib/loyalty/loyaltyPublicCard";
import {
  buildCustomerLoyaltyCardUrl,
  shareCustomerPageViaWebShare,
} from "../lib/loyalty/loyaltyPublicCardShare";
import { openWalletSaveUrlWithoutReferrer } from "../lib/loyalty/loyaltyPublicWalletNavigate";

type LoadState =
  | { phase: "loading" }
  | { phase: "ready"; card: PublicCardData }
  | { phase: "error"; kind: "invalid" | "not_found" | "unavailable" };

/**
 * Customer-facing loyalty card — no merchant login required.
 * Routes: /c/:publicCardToken (canonical) and /loyalty/:publicCardToken (legacy).
 *
 * B1/B2 presentation. Public API, QR payload, Wallet issue, and security controls
 * are unchanged. B3: share URLs use loyalty.waka.ug/c/<token>.
 */
export function PublicLoyaltyCardPage({
  publicCardToken,
  lang,
}: {
  publicCardToken: string;
  lang: Language;
}) {
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletMessage, setWalletMessage] = useState<string | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState({ phase: "loading" });
    setQrDataUrl(null);
    setWalletMessage(null);
    setWalletError(null);

    if (!isValidPublicCardTokenFormat(publicCardToken)) {
      setState({ phase: "error", kind: "invalid" });
      return;
    }

    void fetchPublicLoyaltyCard(publicCardToken).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setState({
          phase: "error",
          kind:
            result.error === "token_invalid"
              ? "invalid"
              : result.error === "not_found"
                ? "not_found"
                : "unavailable",
        });
        return;
      }
      setState({ phase: "ready", card: result.card });
    });

    return () => {
      cancelled = true;
    };
  }, [publicCardToken]);

  useEffect(() => {
    if (state.phase !== "ready") return;
    const payload = state.card.qr_payload;
    if (!payload.startsWith(LOYALTY_QR_PREFIX)) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    void QRCode.toDataURL(payload, {
      width: 260,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#1c1917", light: "#ffffff" },
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [state]);

  const onAddToWallet = async () => {
    if (walletBusy || state.phase !== "ready") return;
    setWalletBusy(true);
    setWalletError(null);
    setWalletMessage(t(lang, "loyaltyWalletMemberCreating"));
    const result = await issuePublicGoogleWallet(publicCardToken);
    setWalletBusy(false);
    if (!result.ok) {
      setWalletMessage(null);
      setWalletError(
        result.error === "account_inactive"
          ? t(lang, "publicCardWalletInactive")
          : t(lang, "publicCardWalletCreateFailed"),
      );
      return;
    }
    setWalletMessage(null);
    // Never location.assign — that would send /loyalty/<token> as Referer.
    const nav = openWalletSaveUrlWithoutReferrer(result.saveUrl);
    if (nav === "failed") {
      setWalletError(t(lang, "publicCardWalletOpenFailed"));
    }
  };

  const onSharePage = async () => {
    const url = buildCustomerLoyaltyCardUrl(publicCardToken);
    const result = await shareCustomerPageViaWebShare(url);
    if (result === "shared" || result === "cancelled") return;
    try {
      await navigator.clipboard?.writeText(url);
      setWalletMessage(t(lang, "publicCardLinkCopied"));
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="loyalty-public-shell min-h-dvh text-stone-900">
      <SeoHead
        title={t(lang, "memberTitle")}
        description={t(lang, "publicCardDescription")}
        path="/c"
        useLoyaltyCanonical
        noindex
        referrerPolicy="no-referrer"
      />

      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pb-12 pt-7 sm:px-5">
        {state.phase === "loading" ? (
          <div className="mt-10 flex flex-1 flex-col gap-5" aria-busy="true" aria-live="polite">
            <div className="text-center">
              <div className="mx-auto h-3 w-28 rounded-full waka-skeleton-bar" />
              <div className="mx-auto mt-3 h-7 w-48 max-w-full rounded-lg waka-skeleton-bar" />
              <div className="mx-auto mt-2 h-4 w-36 rounded-full waka-skeleton-bar" />
            </div>
            <div className="h-56 rounded-[1.75rem] waka-skeleton-bar" />
            <div className="h-28 rounded-2xl waka-skeleton-bar" />
            <div className="mx-auto h-56 w-56 max-w-full rounded-2xl waka-skeleton-bar" />
            <p className="text-center text-sm font-semibold text-stone-500">
              {t(lang, "publicCardLoading")}
            </p>
          </div>
        ) : null}

        {state.phase === "error" ? (
          <div className="mt-16 rounded-[1.75rem] border border-stone-200/90 bg-white/90 px-5 py-10 text-center shadow-sm">
            <p className="text-lg font-black text-stone-900">
              {state.kind === "invalid" || state.kind === "not_found"
                ? t(lang, "publicCardErrorInvalid")
                : t(lang, "publicCardErrorUnavailable")}
            </p>
            <p className="mt-2 text-sm font-medium text-stone-500">
              {t(lang, "publicCardErrorAskShop")}
            </p>
          </div>
        ) : null}

        {state.phase === "ready" ? (
          <PublicLoyaltyCardView
            card={state.card}
            design={state.card.design}
            qrDataUrl={qrDataUrl}
            walletBusy={walletBusy}
            walletMessage={walletMessage}
            walletError={walletError}
            onAddToWallet={() => void onAddToWallet()}
            onSharePage={() => void onSharePage()}
            lang={lang}
          />
        ) : null}

        <footer className="mt-auto pt-10 text-center text-[11px] font-medium text-stone-400">
          {t(lang, "publicCardPoweredBy")}
        </footer>
      </div>
    </div>
  );
}
