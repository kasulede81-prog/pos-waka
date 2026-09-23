import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { LOYALTY_QR_PREFIX } from "../lib/loyalty/loyaltyEnrollment";
import {
  fetchPublicLoyaltyCard,
  issuePublicGoogleWallet,
  isValidPublicCardTokenFormat,
  type PublicCardData,
} from "../lib/loyalty/loyaltyPublicCard";
import {
  buildCustomerLoyaltyCardUrl,
  isWebShareAvailable,
  shareCustomerPageViaWebShare,
} from "../lib/loyalty/loyaltyPublicCardShare";
import { openWalletSaveUrlWithoutReferrer } from "../lib/loyalty/loyaltyPublicWalletNavigate";
import { SeoHead } from "../components/marketing/SeoHead";

type LoadState =
  | { phase: "loading" }
  | { phase: "ready"; card: PublicCardData }
  | { phase: "error"; kind: "invalid" | "not_found" | "unavailable" };

/**
 * Customer-facing loyalty card — no merchant login required.
 * Route: /loyalty/:publicCardToken
 */
export function PublicLoyaltyCardPage({ publicCardToken }: { publicCardToken: string }) {
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
          kind: result.error === "token_invalid" ? "invalid" : result.error === "not_found" ? "not_found" : "unavailable",
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
      width: 220,
      margin: 1,
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
    setWalletMessage("Creating your loyalty card...");
    const result = await issuePublicGoogleWallet(publicCardToken);
    setWalletBusy(false);
    if (!result.ok) {
      setWalletMessage(null);
      setWalletError(
        result.error === "account_inactive"
          ? "This loyalty card is inactive."
          : "Could not create your Wallet card. Try again.",
      );
      return;
    }
    setWalletMessage(null);
    // Never location.assign — that would send /loyalty/<token> as Referer.
    const nav = openWalletSaveUrlWithoutReferrer(result.saveUrl);
    if (nav === "failed") {
      setWalletError("Could not open Google Wallet. Try again.");
    }
  };

  const onSharePage = async () => {
    const url = buildCustomerLoyaltyCardUrl(publicCardToken);
    const result = await shareCustomerPageViaWebShare(url);
    if (result === "shared" || result === "cancelled") return;
    try {
      await navigator.clipboard?.writeText(url);
      setWalletMessage("Card link copied.");
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="min-h-dvh bg-gradient-to-b from-stone-100 via-amber-50/40 to-stone-50 text-stone-900">
      <SeoHead
        title="WAKA Loyalty"
        description="Your WAKA loyalty card"
        path="/loyalty"
        usePosCanonical
        noindex
        referrerPolicy="no-referrer"
      />

      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-10 pt-8">
        <header className="text-center">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-stone-500">WAKA Loyalty</p>
          {state.phase === "ready" ? (
            <h1 className="mt-2 text-2xl font-black tracking-tight text-stone-900">
              {state.card.shop_name}
            </h1>
          ) : (
            <h1 className="mt-2 text-2xl font-black tracking-tight text-stone-900">Loyalty card</h1>
          )}
        </header>

        {state.phase === "loading" ? (
          <div className="mt-16 flex flex-1 flex-col items-center gap-3">
            <div className="h-10 w-10 animate-pulse rounded-full bg-stone-300/80" />
            <p className="text-sm font-semibold text-stone-500">Loading your card…</p>
          </div>
        ) : null}

        {state.phase === "error" ? (
          <div className="mt-16 rounded-2xl border border-stone-200 bg-white/80 px-5 py-8 text-center shadow-sm">
            <p className="text-lg font-black text-stone-900">
              {state.kind === "invalid" || state.kind === "not_found"
                ? "This loyalty card link is invalid or expired."
                : "Loyalty card unavailable right now."}
            </p>
            <p className="mt-2 text-sm font-medium text-stone-500">
              Ask the shop to share your card link again.
            </p>
          </div>
        ) : null}

        {state.phase === "ready" ? (
          <div className="mt-8 flex flex-1 flex-col gap-8">
            <section className="text-center">
              <p className="text-xs font-bold uppercase tracking-wide text-stone-500">Customer</p>
              <p className="mt-1 text-xl font-black text-stone-900">{state.card.customer_name}</p>
              {!state.card.account_active ? (
                <p className="mt-2 text-xs font-bold text-amber-700">Account inactive</p>
              ) : null}
            </section>

            <section className="rounded-3xl bg-stone-900 px-5 py-6 text-center text-white shadow-lg">
              <p className="text-sm font-semibold text-stone-300">Points balance</p>
              <p className="mt-1 text-4xl font-black tracking-tight">
                <span aria-hidden="true">⭐ </span>
                {state.card.balance_points}{" "}
                <span className="text-lg font-bold text-stone-300">points</span>
              </p>
            </section>

            <section className="flex flex-col items-center gap-3">
              <p className="text-xs font-bold uppercase tracking-wide text-stone-500">Customer QR</p>
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  width={220}
                  height={220}
                  alt="Loyalty membership QR"
                  className="rounded-2xl border border-stone-200 bg-white p-2 shadow-sm"
                />
              ) : (
                <div className="h-[220px] w-[220px] animate-pulse rounded-2xl bg-stone-200" />
              )}
              <p className="max-w-xs text-center text-sm font-medium text-stone-600">
                Show this QR at checkout to collect your points.
              </p>
            </section>

            <section>
              <p className="text-xs font-bold uppercase tracking-wide text-stone-500">Rewards</p>
              {state.card.rewards.length === 0 ? (
                <p className="mt-3 text-sm font-medium text-stone-500">No rewards available right now.</p>
              ) : (
                <ul className="mt-3 divide-y divide-stone-200 rounded-2xl border border-stone-200 bg-white/90">
                  {state.card.rewards.map((reward) => (
                    <li key={`${reward.name}-${reward.points_required}`} className="px-4 py-3">
                      <p className="text-sm font-black text-stone-900">{reward.name}</p>
                      <p className="text-xs font-bold text-stone-500">
                        {reward.points_required} points
                        {reward.description ? ` · ${reward.description}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {state.card.wallet_configured && state.card.account_active ? (
              <section className="space-y-2">
                <button
                  type="button"
                  disabled={walletBusy}
                  onClick={() => void onAddToWallet()}
                  className="min-h-[48px] w-full rounded-2xl bg-[#1a73e8] px-4 text-sm font-black text-white disabled:opacity-50"
                >
                  {walletBusy ? "Creating your loyalty card..." : "Add to Google Wallet"}
                </button>
                {isWebShareAvailable() ? (
                  <button
                    type="button"
                    onClick={() => void onSharePage()}
                    className="min-h-[44px] w-full rounded-2xl border border-stone-300 bg-white/80 px-4 text-sm font-bold text-stone-700"
                  >
                    Share my card link
                  </button>
                ) : null}
              </section>
            ) : null}

            {walletMessage ? (
              <p className="text-center text-xs font-bold text-emerald-700">{walletMessage}</p>
            ) : null}
            {walletError ? (
              <p className="text-center text-xs font-bold text-red-700">{walletError}</p>
            ) : null}
          </div>
        ) : null}

        <footer className="mt-auto pt-10 text-center text-[11px] font-medium text-stone-400">
          Powered by WAKA
        </footer>
      </div>
    </div>
  );
}
