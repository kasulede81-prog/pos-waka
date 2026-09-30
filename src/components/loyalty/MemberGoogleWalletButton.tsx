import { useEffect, useState } from "react";
import { useUiLanguage } from "../../hooks/useUiLanguage";
import { t } from "../../lib/i18n";
import { memberWalletErrorKey } from "../../lib/loyalty/loyaltyErrorMessages";
import {
  fetchGoogleWalletConfigured,
  issueMemberGoogleWalletPass,
} from "../../lib/loyalty/loyaltyGoogleWallet";
import { openWalletSaveUrlWithoutReferrer } from "../../lib/loyalty/loyaltyPublicWalletNavigate";

/**
 * "Add to Google Wallet" on the MEMBER's own dashboard.
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
 * infrastructure state, not the customer's, and the merchant-facing copy for it ("ask WAKA
 * support…") would be meaningless and alarming on a customer's phone.
 */
export function MemberGoogleWalletButton({
  shopId,
  shopName,
}: {
  shopId: string;
  shopName: string;
}) {
  const { lang } = useUiLanguage();
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

  const onAdd = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
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
        aria-label={`${t(lang, "loyaltyWalletMemberAdd")} — ${shopName}`}
        className="min-h-[44px] w-full rounded-xl bg-[#1a73e8] px-4 text-sm font-black text-white disabled:opacity-50 active:scale-[0.99]"
      >
        {busy ? t(lang, "loyaltyWalletMemberCreating") : t(lang, "loyaltyWalletMemberAdd")}
      </button>
      <p className="mt-1.5 text-[11px] font-medium leading-relaxed text-muted-foreground">
        {t(lang, "loyaltyWalletMemberHint")}
      </p>
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
