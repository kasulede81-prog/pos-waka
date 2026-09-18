import { useCallback, useEffect, useRef, useState } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import {
  enrollCustomerWithConsent,
  fetchShopCustomersForEnrollment,
  lookupAccountByToken,
  type ShopCustomerOption,
  type TokenLookupResult,
} from "../../lib/loyalty/loyaltyEnrollment";
import { useLoyaltyQrScanner } from "../../hooks/useLoyaltyQrScanner";
import { LoyaltyMemberQr } from "./LoyaltyMemberQr";

type EnrollState =
  | { phase: "idle" }
  | { phase: "enrolling" }
  | { phase: "done"; qrToken: string; alreadyEnrolled: boolean }
  | { phase: "error"; error: string };

/**
 * Merchant-driven enrollment + QR identification (Phase 05).
 *
 * Flow: search existing shop customers → record consent → enroll (idempotent,
 * duplicate memberships are impossible per `unique(shop_id, customer_id)`) →
 * show the membership QR carrying only the opaque token. A camera scan of any
 * membership QR resolves back to the customer via `loyalty_account_by_token`.
 */
export function LoyaltyEnrollmentPanel({
  lang,
  shopId,
  onEnrollmentChanged,
}: {
  lang: Language;
  shopId: string;
  onEnrollmentChanged: () => void;
}) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<ShopCustomerOption[]>([]);
  const [selected, setSelected] = useState<ShopCustomerOption | null>(null);
  const [consent, setConsent] = useState(false);
  const [consentNote, setConsentNote] = useState("");
  const [enrollState, setEnrollState] = useState<EnrollState>({ phase: "idle" });
  const [lookupResult, setLookupResult] = useState<TokenLookupResult | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);
  const searchSeq = useRef(0);

  const runSearch = useCallback(
    async (q: string) => {
      const seq = ++searchSeq.current;
      const rows = await fetchShopCustomersForEnrollment(shopId, q);
      if (seq !== searchSeq.current) return;
      setOptions(rows);
      setSelected((prev) => (prev && rows.some((r) => r.id === prev.id) ? prev : null));
    },
    [shopId],
  );

  useEffect(() => {
    const handle = window.setTimeout(() => void runSearch(query), 250);
    return () => window.clearTimeout(handle);
  }, [query, runSearch]);

  const submitEnroll = async () => {
    if (!selected) return;
    setEnrollState({ phase: "enrolling" });
    const result = await enrollCustomerWithConsent(shopId, selected.id, consent, consentNote);
    if (result.ok) {
      setEnrollState({ phase: "done", qrToken: result.qrToken, alreadyEnrolled: result.alreadyEnrolled });
      onEnrollmentChanged();
    } else {
      setEnrollState({ phase: "error", error: result.error });
    }
  };

  const onScanned = useCallback(
    async (code: string) => {
      setLookupBusy(true);
      const result = await lookupAccountByToken(shopId, code);
      setLookupResult(result);
      setLookupBusy(false);
    },
    [shopId],
  );

  const scanner = useLoyaltyQrScanner({ lang, onScan: (code) => void onScanned(code) });

  const canEnroll = selected != null && consent && enrollState.phase !== "enrolling";

  return (
    <div className="space-y-4">
      <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <p className="text-base font-black text-foreground">{t(lang, "loyaltyAddCustomerTitle")}</p>
        <p className="mt-1 text-sm font-medium text-muted-foreground">
          {t(lang, "loyaltyAddCustomerSub")}
        </p>

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t(lang, "loyaltySearchPlaceholder")}
          className="mt-3 min-h-[48px] w-full rounded-xl border-2 border-border bg-card px-3 py-2 text-base font-semibold"
        />
        {options.length > 0 ? (
          <ul className="mt-2 divide-y divide-border rounded-xl border border-border">
            {options.map((option) => (
              <li key={option.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(option);
                    setEnrollState({ phase: "idle" });
                  }}
                  className={
                    selected?.id === option.id
                      ? "flex w-full items-center justify-between gap-3 bg-waka-50 px-3 py-2.5 text-left"
                      : "flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-muted"
                  }
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold text-foreground">{option.name}</span>
                    <span className="block text-xs font-medium text-muted-foreground">
                      {option.phoneE164 ?? ""}
                      {option.alreadyEnrolled ? ` · ${t(lang, "loyaltyAlreadyEnrolledState")}` : ""}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {selected ? (
          <div className="mt-4 space-y-3">
            <label className="flex min-h-[44px] cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-1 h-5 w-5 shrink-0 accent-waka-600"
              />
              <span className="text-sm font-bold text-foreground">{t(lang, "loyaltyConsentLabel")}</span>
            </label>
            <input
              value={consentNote}
              onChange={(e) => setConsentNote(e.target.value)}
              placeholder={t(lang, "loyaltyAdjustNotePlaceholder")}
              className="min-h-[44px] w-full rounded-xl border-2 border-border bg-card px-3 py-2 text-base font-semibold"
            />
            {!consent ? (
              <p className="text-xs font-bold text-warning-foreground">
                {t(lang, "loyaltyConsentRequired")}
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => void submitEnroll()}
              disabled={!canEnroll}
              className="min-h-[48px] rounded-2xl bg-waka-600 px-5 text-sm font-black text-white disabled:opacity-50"
            >
              {t(lang, "loyaltyEnrollAction")}
            </button>
          </div>
        ) : null}

        {enrollState.phase === "enrolling" ? (
          <p className="mt-3 text-sm font-bold text-muted-foreground">{t(lang, "loyaltyLoading")}</p>
        ) : null}
        {enrollState.phase === "error" ? (
          <p className="mt-3 rounded-xl bg-destructive/10 px-3 py-2 text-sm font-bold text-destructive">
            {enrollState.error === "consent_required"
              ? t(lang, "loyaltyConsentRequired")
              : t(lang, "loyaltyEnrollFailed")}
          </p>
        ) : null}
        {enrollState.phase === "done" ? (
          <div className="mt-4 flex flex-col items-center gap-3 rounded-2xl border border-border bg-muted/50 p-4">
            <p className="text-center text-sm font-black text-foreground">
              {enrollState.alreadyEnrolled
                ? t(lang, "loyaltyAlreadyEnrolledState")
                : t(lang, "loyaltyEnrollSuccess")}
            </p>
            <LoyaltyMemberQr qrToken={enrollState.qrToken} />
          </div>
        ) : null}
      </article>

      <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <p className="text-base font-black text-foreground">{t(lang, "loyaltyScanQrTitle")}</p>
        <p className="mt-1 text-sm font-medium text-muted-foreground">{t(lang, "loyaltyScanQrSub")}</p>
        {scanner.cameraScanOpen ? (
          <div className="mt-3 space-y-3">
            <video
              ref={scanner.cameraVideoRef}
              playsInline
              muted
              className="aspect-square w-full max-w-[320px] rounded-2xl bg-black object-cover"
            />
            {scanner.cameraScanStatus ? (
              <p className="text-sm font-medium text-muted-foreground">{scanner.cameraScanStatus}</p>
            ) : null}
            <button
              type="button"
              onClick={scanner.closeCameraScan}
              className="min-h-[44px] rounded-xl border-2 border-border px-4 text-sm font-black text-foreground"
            >
              {t(lang, "loyaltyScanClose")}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={scanner.openCameraScan}
            disabled={!scanner.caps.cameraScan}
            className="mt-3 min-h-[48px] rounded-2xl bg-waka-600 px-5 text-sm font-black text-white disabled:opacity-50"
          >
            {t(lang, "loyaltyScanQrAction")}
          </button>
        )}
        {lookupBusy ? (
          <p className="mt-3 text-sm font-bold text-muted-foreground">{t(lang, "loyaltyLoading")}</p>
        ) : null}
        {lookupResult && !lookupBusy ? (
          lookupResult.ok ? (
            <div className="mt-3 rounded-2xl border border-success/40 bg-success-muted p-3">
              <p className="text-sm font-black text-foreground">{lookupResult.customerName}</p>
              <p className="text-xs font-medium text-muted-foreground">
                {lookupResult.customerPhone ?? ""}
              </p>
              <p className="mt-1 text-sm font-bold text-foreground">
                {t(lang, "loyaltyBalanceLabel")}: {lookupResult.balancePoints}{" "}
                {t(lang, "loyaltyPointsUnit")}
              </p>
            </div>
          ) : (
            <p className="mt-3 rounded-xl bg-warning-muted px-3 py-2 text-sm font-bold text-warning-foreground">
              {t(lang, "loyaltyScanNotFound")}
            </p>
          )
        ) : null}
      </article>
    </div>
  );
}
