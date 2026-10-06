import type { Language } from "../../types";
import { t } from "../i18n";

/**
 * Phase B — the wallet button's label, decided ONLY from what the backend knows
 * (audit §24 state table):
 *
 *   busy                    → "Creating your card…"
 *   issued + sync stale     → "Update wallet card"
 *   issued                  → "Open in Google Wallet"
 *   not issued / unknown    → "Add to Google Wallet"
 *
 * "Installed"/"saved on device" is deliberately impossible here: this architecture
 * has no Google save-state signal, and a button that claims one would lie.
 */
export function memberWalletButtonLabel(params: {
  lang: Language;
  busy: boolean;
  issued: boolean;
  stale: boolean;
}): string {
  if (params.busy) return t(params.lang, "loyaltyWalletMemberCreating");
  if (params.stale) return t(params.lang, "memberWalletUpdate");
  if (params.issued) return t(params.lang, "memberWalletOpen");
  return t(params.lang, "loyaltyWalletMemberAdd");
}
