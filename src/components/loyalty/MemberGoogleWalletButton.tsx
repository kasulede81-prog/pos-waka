import { useEffect, useState } from "react";
import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { memberWalletErrorKey } from "../../lib/loyalty/loyaltyErrorMessages";
import { formatDay } from "../../lib/loyalty/memberDates";
import { memberWalletButtonLabel } from "../../lib/loyalty/memberWalletLabel";
import {
  fetchGoogleWalletConfigured,
  issueMemberGoogleWalletPass,
} from "../../lib/loyalty/loyaltyGoogleWallet";
import { openWalletSaveUrlWithoutReferrer } from "../../lib/loyalty/loyaltyPublicWalletNavigate";

/**
 * Wallet affordance on the MEMBER's own dashboard.
 *
 * THE SAME CARD THE SHOP CAN SEND. This calls the existing `loyalty-wallet-pass` Edge Function
 * with a shop and no account id, so the server resolves the account from the member's own
 * session and issues the existing pass — same issuer, same published class, same deterministic
 * object id as the merchant button (`{issuerId}.acct_{accountId}`) and the public card page. It
 * therefore ADDS THE SAME Google Wallet object: a card the shop already sent is not duplicated,
 * it is the same card. The Save URL is opened with the same referrer-free helper the public card
 * page uses, and is kept only in local state — never logged and never stored.
 *
 * THE ACCOUNT ID NEVER LEAVES THE SERVER. The member cannot ask for a card at a shop they are
 * not linked to, and has no id to tamper with — the request carries the shop, and the authority
 * is the session. Nothing here reveals merchant configuration or credentials.
 *
 * WHEN WALLET IS NOT CONFIGURED, NOTHING IS RENDERED. An unconfigured issuer is the merchant's
 * infrastructure state, not the customer's, and the merchant-facing copy for it ("ask DKASU
 * support…") would be meaningless and alarming on a customer's phone.
 *
 * PHASE B — HONEST STATES FROM WHAT THE BACKEND ACTUALLY KNOWS (audit §24):
 *   not issued            → "Add to Google Wallet"
 *   issued                → "Open in Google Wallet" + "Added {date}"
 *   issued + sync stale   → "Update wallet card" (sync balance ≠ current balance)
 *   unknown (old server)  → behaves as "Add" — never invents state
 * The backend has NO signal for "installed"/"saved on device", so the UI NEVER
 * claims it. Re-clicking is idempotent by construction (deterministic object id).
 *
 * `lang` is a prop from the page (not a local hook instance) so the label follows
 * the dashboard's language toggle immediately instead of going stale until reload.
 */
export function MemberGoogleWalletButton({
  shopId,
  shopName,
  lang,
  walletIssuedAt,
  walletSyncBalance,
  balancePoints,
}: {
  shopId: string;
  shopName: string;
  lang: Language;
  walletIssuedAt?: string | null;
  walletSyncBalance?: number | null;
  balancePoints: number;
}) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchGoogleWalletConfigured().then((status) => {
      if (cancelled) return;
      setConfigured(status.ok && status.configured);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!shopId.trim()) return null;
  // Probing, or genuinely unavailable: no button, and no merchant-infrastructure message.
  if (configured !== true) return null;

  const issued = Boolean(walletIssuedAt);
  const stale = issued && walletSyncBalance != null && walletSyncBalance !== balancePoints;
  const addedDate = walletIssuedAt ? formatDay(walletIssuedAt, lang) : null;

  const buttonLabel = memberWalletButtonLabel({ lang, busy, issued, stale });

  const onAdd = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    // Deterministic object id: issuing again for an issued card returns the same
    // Google Wallet card's Save URL — "Open"/"Update" never creates a duplicate.
    const result = await issueMemberGoogleWalletPass(shopId);
    setBusy(false);
    if (!result.ok) {
      setError(t(lang, memberWalletErrorKey(result.error)));
      return;
    }
    // A new tab with noopener/noreferrer, so this dashboard is never sent as the Referer.
    const nav = openWalletSaveUrlWithoutReferrer(result.saveUrl);
    if (nav === "failed") {
      setError(t(lang, "loyaltyWalletMemberOpenFailed"));
      return;
    }
    setMessage(t(lang, "loyaltyWalletMemberOpened"));
  };

  return (
    <div className="mt-3" data-testid="member-wallet">
      <button
        type="button"
        disabled={busy}
        onClick={() => void onAdd()}
        data-testid="member-wallet-add"
        data-wallet-state={issued ? (stale ? "stale" : "issued") : "not-issued"}
        aria-label={`${buttonLabel} — ${shopName}`}
        className="min-h-[44px] w-full rounded-xl bg-[#1a73e8] px-4 text-sm font-black text-white disabled:opacity-50 active:scale-[0.99]"
      >
        {buttonLabel}
      </button>
      <p className="mt-1.5 text-[11px] font-medium leading-relaxed text-muted-foreground">
        {t(lang, "loyaltyWalletMemberHint")}
      </p>
      {issued && addedDate && !stale ? (
        <p className="mt-1.5 text-[11px] font-semibold text-muted-foreground" data-testid="member-wallet-added">
          {tTemplate(lang, "memberWalletAdded", { date: addedDate })}
        </p>
      ) : null}
      {message ? (
        <p className="mt-1.5 text-xs font-bold text-emerald-600 dark:text-emerald-400" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="mt-1.5 text-xs font-bold text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export default MemberGoogleWalletButton;
