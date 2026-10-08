/**
 * M3-D — customer self-service checkout (inline flow).
 *
 * Plan → billing cycle → server price → Pay → pending → confirmed.
 *
 * Honesty rules enforced here:
 *   - every displayed price comes from the server quote (never local math);
 *   - "confirmed" is rendered only after subscription_payment_get says so;
 *   - provider_not_configured renders "Online payment is being prepared."
 *     (no fake instructions, no fake provider, no support-as-purchase path);
 *   - one client reference per attempt (M3-A idempotency), reused on retry;
 *   - recovery is server-backed via my_subscription_payments.
 *
 * No provider/PesaPal code: payment-initiate is called as an opaque Edge
 * Function whose response the state machine classifies.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { usePublicPricing } from "../../hooks/usePublicPricing";
import { WakaButton } from "../ui/wakaPrimitives";
import { ConfirmationDialog } from "../layout/ConfirmationDialog";
import {
  CHECKOUT_PLANS,
  checkoutActionKey,
  checkoutReducer,
  createCheckoutBackend,
  createCheckoutIntent,
  createPaymentPoller,
  displayPricingFor,
  initialCheckoutState,
  initiateCheckoutPayment,
  isValidE164,
  isDowngradePlan,
  needsInitiateAction,
  newAttemptReference,
  paymentStatusKey,
  quoteCheckout,
  recoverLatestPendingPayment,
  renewalNoteKey,
  canPayForPlan,
  type CheckoutCycle,
  type CheckoutPlanCode,
  type PaymentPoller,
} from "../../lib/paymentCheckout";

type Props = {
  lang: Language;
  /** Shop pinned at checkout start (server keeps the intent bound to it). */
  shopId: string | null;
  plan: CheckoutPlanCode;
  setPlan: (plan: CheckoutPlanCode) => void;
  initialCycle: CheckoutCycle;
  currentPlanCode: string;
  effectiveStatus: string;
  hasFuturePeriodEnd: boolean;
  onClose: () => void;
};

export function CheckoutFlow({
  lang,
  shopId,
  plan,
  setPlan,
  initialCycle,
  currentPlanCode,
  effectiveStatus,
  hasFuturePeriodEnd,
  onClose,
}: Props) {
  const [state, dispatch] = useReducer(checkoutReducer, initialCheckoutState(initialCycle));
  const [phone, setPhone] = useState("");
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [pollNonce, setPollNonce] = useState(0);
  /** Cancellation confirmation + its in-flight state (UI-local; the ledger owns the outcome). */
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const inFlightRef = useRef(false);
  const pollerRef = useRef<PaymentPoller | null>(null);
  const backend = useMemo(() => createCheckoutBackend(), []);
  const { pricing } = usePublicPricing();

  // Keep the reducer's plan in sync with the (parent-owned) selection — but
  // never while a payment flow is in flight (RESUMED/intent states own it).
  useEffect(() => {
    if (
      plan !== state.planCode &&
      (state.phase === "idle" || state.phase === "selecting" || state.phase === "quoting")
    ) {
      dispatch({ type: "SELECT_PLAN", plan });
    }
  }, [plan, state.planCode, state.phase]);

  // Quote whenever the selection changes and no quote is held.
  useEffect(() => {
    if (!shopId || !state.planCode || !canPayForPlan(state.planCode) || state.quote) return;
    let live = true;
    dispatch({ type: "QUOTE_STARTED" });
    void quoteCheckout(backend, { shopId, planCode: state.planCode, cycle: state.cycle }).then((r) => {
      if (!live) return;
      if (r.ok) dispatch({ type: "QUOTE_OK", quote: r.quote });
      else dispatch({ type: "QUOTE_FAILED", errorKey: r.errorKey });
    });
    return () => {
      live = false;
    };
  }, [backend, shopId, state.planCode, state.cycle, state.quote]);

  // Server-backed recovery: newest pending intent in this shop's history.
  useEffect(() => {
    if (!shopId) return;
    let live = true;
    void backend.listPayments(shopId).then((list) => {
      if (!live) return;
      const resume = recoverLatestPendingPayment(list);
      if (!resume) return;
      dispatch({
        type: "RESUMED",
        paymentId: resume.paymentId,
        reference: resume.reference,
        amountUgx: resume.amountUgx,
        planCode: resume.planCode,
        cycle: resume.cycle,
      });
    });
    return () => {
      live = false;
    };
  }, [backend, shopId]);

  // Poll subscription_payment_get while pending; stop on terminal/unmount.
  useEffect(() => {
    if (state.phase !== "pending_provider" || !state.intent?.paymentId) return;
    const poller = createPaymentPoller({
      getPayment: (id) => backend.getPayment(id),
      onPoll: (r) => {
        if (r.ok && typeof r.status === "string") {
          dispatch({ type: "POLL_RECEIVED", status: r.status, statusReason: r.statusReason ?? null });
        } else {
          dispatch({ type: "POLL_ERROR" });
        }
      },
    });
    pollerRef.current = poller;
    poller.start(state.intent.paymentId);
    return () => {
      poller.stop();
      if (pollerRef.current === poller) pollerRef.current = null;
    };
  }, [backend, state.phase, state.intent?.paymentId, pollNonce]);

  // A server-side sync is requested (payment_not_pending / conflict): adopt
  // the real ledger state instead of guessing.
  const intentId = state.intent?.paymentId;
  useEffect(() => {
    if (state.errorKey !== "checkoutSyncRequired" || !intentId) return;
    let live = true;
    void backend.getPayment(intentId).then((r) => {
      if (!live) return;
      if (r.ok === true && typeof r.status === "string") {
        dispatch({
          type: "RESUMED",
          paymentId: intentId,
          reference: state.intent?.reference ?? null,
          amountUgx: state.intent?.amountUgx ?? 0,
          planCode: state.planCode,
          cycle: state.cycle,
        });
        dispatch({
          type: "POLL_RECEIVED",
          status: r.status,
          statusReason: typeof r.status_reason === "string" ? r.status_reason : null,
        });
      } else {
        dispatch({ type: "FATAL", errorKey: "checkoutUnavailable" });
      }
    });
    return () => {
      live = false;
    };
  }, [backend, state.errorKey, intentId, state.intent?.reference, state.intent?.amountUgx, state.planCode, state.cycle]);

  // Focus the panel when it opens (focus management without a modal).
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const busy = state.phase === "creating_payment";
  const pending = state.phase === "pending_provider";
  const downgrade =
    state.quote !== null && isDowngradePlan(state.quote.currentPlanCode, state.planCode ?? "");
  const needsDowngradeConfirm = downgrade && !state.downgradeConfirmed;
  const publicRow = pricing.plans.find((p) => p.planCode === state.planCode);
  const display = state.quote ? displayPricingFor(state.quote, publicRow) : null;
  const renewalNote = renewalNoteKey({
    effectiveStatus,
    hasFuturePeriodEnd,
  });

  const runInitiate = useCallback(
    async (paymentId: string, phoneValue: string) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        const event = await initiateCheckoutPayment(backend, { paymentId, phone: phoneValue });
        dispatch(event);
      } finally {
        inFlightRef.current = false;
      }
    },
    [backend],
  );

  const onPay = useCallback(async () => {
    if (inFlightRef.current || busy || pending) return; // double-click guard
    if (!state.planCode || !state.quote || !shopId) {
      dispatch({ type: "PAY_REQUESTED", reference: "", phone: phone.trim() });
      return;
    }
    const e164 = phone.trim();
    if (!isValidE164(e164)) {
      setPhoneError(t(lang, "checkoutPhoneInvalid"));
      return;
    }
    setPhoneError(null);
    if (needsDowngradeConfirm) {
      dispatch({ type: "DOWNGRADE_CONFIRMED" });
      return; // explicit confirmation step BEFORE any payment intent
    }
    // One reference per attempt — reused if this attempt is retried.
    const reference = state.intent?.reference ?? newAttemptReference();
    dispatch({ type: "PAY_REQUESTED", reference, phone: e164 });
    inFlightRef.current = true;
    try {
      const created = await createCheckoutIntent(backend, {
        shopId,
        reference,
        planCode: state.planCode,
        cycle: state.cycle,
        amountUgx: state.quote.amountUgx, // server-quoted value (never client math)
      });
      if (created.ok) {
        dispatch({ type: "INTENT_CREATED", paymentId: created.paymentId, amountUgx: created.amountUgx });
        const event = await initiateCheckoutPayment(backend, {
          paymentId: created.paymentId,
          phone: e164,
        });
        dispatch(event);
      } else if (created.requote) {
        dispatch({ type: "REQUOTE_REQUIRED", errorKey: created.errorKey });
      } else {
        dispatch({
          type: "INTENT_CREATE_FAILED",
          errorKey: created.errorKey,
          retrySameReference: created.retrySameReference,
        });
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [backend, busy, lang, pending, phone, needsDowngradeConfirm, shopId, state.cycle, state.intent, state.planCode, state.quote]);

  const onRetryInitiate = useCallback(() => {
    if (!state.intent?.paymentId || inFlightRef.current) return;
    const e164 = state.intent.phone || phone.trim();
    if (!isValidE164(e164)) {
      setPhoneError(t(lang, "checkoutPhoneInvalid"));
      return;
    }
    setPhoneError(null);
    void runInitiate(state.intent.paymentId, e164);
  }, [lang, phone, runInitiate, state.intent]);

  const closeFlow = useCallback(() => {
    dispatch({ type: "RESET" });
    onClose();
  }, [onClose]);

  /**
   * Abandon a pending payment at the payer's request.
   *
   * The SERVER decides: `subscription_payment_cancel` only accepts a `pending`
   * payment, so if the provider settled it first the call is refused and the
   * payer is told the truth rather than shown a cancellation that never
   * happened. Nothing is inferred from client timing — the status we adopt is
   * the one the ledger returned.
   *
   * This ends OUR checkout; it does not claim the provider-side transaction was
   * reversed (the RPC cannot reach the provider). A late provider success is
   * caught by the existing settlement rules, which refuse to confirm anything
   * that is no longer pending.
   */
  const onCancelPayment = useCallback(async () => {
    const paymentId = state.intent?.paymentId;
    if (!paymentId || cancelling) return;
    setCancelling(true);
    try {
      const result = await backend.cancel(paymentId);
      if (result.ok === true) {
        // The ledger is authoritative and it said cancelled. Leave the checkout:
        // closeFlow resets local state and unmounts the flow, which stops the
        // poller with it. The payment record stays on the server for history
        // and reconciliation — only this screen goes away.
        closeFlow();
        return;
      }
      dispatch({ type: "CANCEL_FAILED", errorKey: "checkoutCancelFailed" });
    } finally {
      setCancelling(false);
      setCancelOpen(false);
    }
  }, [backend, closeFlow, state.intent?.paymentId, cancelling]);

  const statusKey = state.paymentStatus ? paymentStatusKey(state.paymentStatus) : null;
  const primaryActionKey = !state.quote
    ? "checkoutPay"
    : needsDowngradeConfirm
      ? "checkoutConfirm"
      : checkoutActionKey(state.quote);

  const showForm =
    state.phase === "idle" ||
    state.phase === "selecting" ||
    state.phase === "quoting" ||
    state.phase === "creating_payment";

  return (
    <section
      aria-label={t(lang, "checkoutTitle")}
      className="mt-6 rounded-3xl border border-border bg-card p-5 shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="text-xl font-black outline-none text-foreground"
        >
          {t(lang, "checkoutTitle")}
        </h2>
        <button
          type="button"
          onClick={closeFlow}
          aria-label={t(lang, "checkoutClose")}
          className="min-h-[48px] rounded-2xl px-4 text-sm font-bold underline text-muted-foreground"
        >
          {t(lang, "checkoutClose")}
        </button>
      </div>

      {/* Polite live region: every status change is announced. */}
      <div role="status" aria-live="polite" className="sr-only">
        {statusKey ? t(lang, statusKey) : null}
        {state.initiateErrorKey ? t(lang, state.initiateErrorKey) : null}
      </div>

      {showForm ? (
        <div className="mt-4 space-y-5">
          <fieldset>
            <legend className="text-sm font-black uppercase tracking-wide text-muted-foreground">
              {t(lang, "checkoutChoosePlan")}
            </legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {CHECKOUT_PLANS.map((p) => (
                <label
                  key={p}
                  className={`flex min-h-[48px] cursor-pointer items-center gap-2 rounded-2xl border px-4 text-sm font-bold ${
                    state.planCode === p ? "border-waka-500 bg-waka-50 text-waka-700" : "border-border"
                  }`}
                >
                  <input
                    type="radio"
                    name="checkout-plan"
                    value={p}
                    checked={state.planCode === p}
                    onChange={() => setPlan(p)}
                  />
                  {t(lang, `plan${p === "waka_plus" ? "WakaPlus" : p === "business" ? "Business" : "Starter"}Name`)}
                  {p === currentPlanCode ? (
                    <span className="rounded-full bg-waka-100 px-2 py-0.5 text-xs font-black text-waka-700">
                      {t(lang, "upgradeCurrentBadge")}
                    </span>
                  ) : null}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-sm font-black uppercase tracking-wide text-muted-foreground">
              {t(lang, "checkoutChooseCycle")}
            </legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {(["monthly", "yearly"] as const).map((c) => (
                <label
                  key={c}
                  className={`flex min-h-[48px] cursor-pointer items-center gap-2 rounded-2xl border px-4 text-sm font-bold ${
                    state.cycle === c ? "border-waka-500 bg-waka-50 text-waka-700" : "border-border"
                  }`}
                >
                  <input
                    type="radio"
                    name="checkout-cycle"
                    value={c}
                    checked={state.cycle === c}
                    onChange={() => dispatch({ type: "SELECT_CYCLE", cycle: c })}
                  />
                  {c === "monthly" ? t(lang, "checkoutMonthly") : t(lang, "checkoutAnnual")}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="rounded-2xl bg-muted p-4">
            <p className="text-xs font-black uppercase tracking-wide text-muted-foreground">
              {t(lang, "checkoutPrice")}
            </p>
            {state.quote ? (
              <>
                <p className="mt-1 text-3xl font-black text-foreground">
                  UGX {state.quote.amountUgx.toLocaleString("en-UG")}
                </p>
                {display && display.discountUgx > 0 ? (
                  <p className="mt-1 text-sm font-semibold text-emerald-700">
                    <span className="line-through text-muted-foreground">
                      UGX {display.originalUgx.toLocaleString("en-UG")}
                    </span>{" "}
                    {tTemplate(lang, "checkoutSave", { amount: display.discountUgx.toLocaleString("en-UG") })}
                  </p>
                ) : null}
                <p className="mt-1 text-xs text-muted-foreground">
                  {state.quote.cycle === "monthly" ? t(lang, "checkoutMonthly") : t(lang, "checkoutAnnual")}
                  {" · "}
                  {t(lang, state.quote.isCurrent ? "checkoutRenew" : isDowngradePlan(state.quote.currentPlanCode, state.planCode ?? "") ? "checkoutDowngrade" : "checkoutUpgrade")}
                </p>
              </>
            ) : state.quoteLoading || state.phase === "quoting" ? (
              <p className="mt-1 text-sm font-semibold text-muted-foreground">…</p>
            ) : (
              <>
                <p className="mt-1 text-sm font-semibold text-muted-foreground">—</p>
                {state.quoteErrorKey ? (
                  <p role="alert" className="mt-1 text-sm font-semibold text-destructive">
                    {t(lang, state.quoteErrorKey)}
                  </p>
                ) : null}
              </>
            )}
            {renewalNote ? <p className="mt-2 text-xs text-muted-foreground">{t(lang, renewalNote)}</p> : null}
          </div>

          <div>
            <label htmlFor="checkout-phone" className="block text-sm font-black text-foreground">
              {t(lang, "checkoutPhoneLabel")}
            </label>
            <input
              id="checkout-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder={t(lang, "checkoutPhoneHint")}
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                setPhoneError(null);
              }}
              aria-invalid={phoneError ? true : undefined}
              aria-describedby={phoneError ? "checkout-phone-error" : undefined}
              className="mt-2 w-full min-h-[48px] rounded-2xl border border-border bg-background px-4 text-base"
            />
            {phoneError ? (
              <p id="checkout-phone-error" role="alert" className="mt-1 text-sm font-semibold text-destructive">
                {phoneError}
              </p>
            ) : null}
          </div>

          {needsDowngradeConfirm && state.quote ? (
            <p role="alert" className="rounded-2xl bg-amber-50 p-3 text-sm font-semibold text-amber-900">
              {tTemplate(lang, "checkoutDowngradeConfirm", {
                from: state.quote.currentPlanCode,
                to: state.planCode ?? "",
              })}
            </p>
          ) : null}

          {state.errorKey && state.phase !== "reconciliation_required" ? (
            <p role="alert" className="rounded-2xl bg-destructive/10 p-3 text-sm font-semibold text-destructive">
              {t(lang, state.errorKey)}
            </p>
          ) : null}

          <WakaButton
            type="button"
            variant="primary"
            loading={busy}
            disabled={busy || pending || !state.quote || state.quoteLoading}
            onClick={() => void onPay()}
            className="min-h-[48px] w-full"
          >
            {t(lang, primaryActionKey)}
          </WakaButton>

          {state.phase === "creating_payment" && state.intent?.reference ? (
            <p className="text-sm font-semibold text-muted-foreground">{t(lang, "checkoutCreating")}</p>
          ) : null}
        </div>
      ) : null}

      {state.phase === "creating_payment" && state.errorKey && state.intent ? (
        <div className="mt-4 flex flex-wrap gap-3">
          <WakaButton type="button" onClick={() => void onPay()} className="min-h-[48px]">
            {t(lang, "checkoutRetry")}
          </WakaButton>
        </div>
      ) : null}

      {state.phase === "pending_provider" && state.intent ? (
        <div className="mt-4 space-y-3">
          <p className="text-lg font-black text-foreground">{t(lang, "checkoutPendingTitle")}</p>
          <p className="text-sm font-medium text-muted-foreground">{t(lang, "checkoutPendingBody")}</p>
          <p className="text-sm font-bold text-foreground">
            UGX {(state.intent.amountUgx || 0).toLocaleString("en-UG")}
            {state.intent.planCode ? ` · ${state.intent.planCode.replace("_", " ")}` : ""}
          </p>
          {statusKey ? (
            <p className="text-sm font-semibold">{t(lang, statusKey)}</p>
          ) : null}
          <div className="flex flex-wrap gap-3">
            {needsInitiateAction(state) ? (
              <WakaButton type="button" onClick={onRetryInitiate} className="min-h-[48px]">
                {t(lang, "checkoutRetryPayment")}
              </WakaButton>
            ) : !state.initiated && !state.initiateErrorKey ? (
              <WakaButton type="button" onClick={onRetryInitiate} className="min-h-[48px]">
                {t(lang, "checkoutContinuePayment")}
              </WakaButton>
            ) : null}
            <WakaButton
              type="button"
              onClick={() => setPollNonce((n) => n + 1)}
              className="min-h-[48px]"
            >
              {t(lang, "checkoutCheckStatus")}
            </WakaButton>
          </div>
          {state.initiateErrorKey ? (
            <p role="alert" className="text-sm font-semibold text-destructive">
              {t(lang, state.initiateErrorKey)}
            </p>
          ) : null}

          {/*
            ALWAYS AVAILABLE. A pending payment is not a final state and the payer
            must never be trapped on this screen waiting for a provider. This is
            the explicit exit; "Back to plans" above stays the quick one.
          */}
          <div className="border-t border-border pt-3">
            <WakaButton
              type="button"
              variant="secondary"
              onClick={() => setCancelOpen(true)}
              className="min-h-[48px] w-full"
            >
              {t(lang, "checkoutCancelPayment")}
            </WakaButton>
          </div>

          {state.cancelErrorKey ? (
            <p role="alert" className="text-sm font-semibold text-destructive">
              {t(lang, state.cancelErrorKey)}
            </p>
          ) : null}

          <ConfirmationDialog
            lang={lang}
            open={cancelOpen}
            onClose={() => setCancelOpen(false)}
            title={t(lang, "checkoutCancelConfirmTitle")}
            confirmLabelKey="checkoutCancelPayment"
            cancelLabelKey="checkoutCancelKeep"
            confirmBusy={cancelling}
            destructive
            onConfirm={() => void onCancelPayment()}
          >
            {t(lang, "checkoutCancelConfirmBody")}
          </ConfirmationDialog>
        </div>
      ) : null}

      {state.phase === "provider_not_configured" ? (
        <div className="mt-4 space-y-3" role="status">
          <p className="text-lg font-black text-foreground">{t(lang, "checkoutPreparingTitle")}</p>
          <p className="text-sm font-medium text-muted-foreground">{t(lang, "checkoutPreparingBody")}</p>
          <WakaButton type="button" onClick={closeFlow} className="min-h-[48px]">
            {t(lang, "checkoutClose")}
          </WakaButton>
        </div>
      ) : null}

      {state.phase === "confirmed" ? (
        <div className="mt-4 space-y-3" role="status">
          <p className="text-lg font-black text-emerald-700">{t(lang, "checkoutConfirmedTitle")}</p>
          <p className="text-sm font-medium text-muted-foreground">{t(lang, "checkoutConfirmedBody")}</p>
          <WakaButton type="button" variant="primary" onClick={closeFlow} className="min-h-[48px]">
            {t(lang, "checkoutClose")}
          </WakaButton>
        </div>
      ) : null}

      {state.phase === "failed" ? (
        <div className="mt-4 space-y-3" role="status">
          <p className="text-lg font-black text-destructive">{t(lang, "checkoutFailedTitle")}</p>
          <p className="text-sm font-medium text-muted-foreground">{t(lang, "checkoutFailedBody")}</p>
          <WakaButton type="button" onClick={() => dispatch({ type: "RESET" })} className="min-h-[48px]">
            {t(lang, "checkoutRetry")}
          </WakaButton>
        </div>
      ) : null}

      {state.phase === "cancelled" ? (
        <div className="mt-4 space-y-3" role="status">
          <p className="text-lg font-black text-foreground">{t(lang, "checkoutCancelledTitle")}</p>
          <p className="text-sm font-medium text-muted-foreground">{t(lang, "checkoutCancelledBody")}</p>
          <WakaButton type="button" onClick={() => dispatch({ type: "RESET" })} className="min-h-[48px]">
            {t(lang, "checkoutRetry")}
          </WakaButton>
        </div>
      ) : null}

      {state.phase === "reconciliation_required" ? (
        <div className="mt-4 space-y-3" role="status">
          <p className="text-lg font-black text-amber-700">{t(lang, "checkoutUnderReviewTitle")}</p>
          <p className="text-sm font-medium text-muted-foreground">{t(lang, "checkoutUnderReviewBody")}</p>
          <div className="flex flex-wrap gap-3">
            <Link
              to="/pilot-support"
              className="inline-flex min-h-[48px] items-center rounded-2xl border-2 border-border px-4 text-sm font-bold"
            >
              {t(lang, "supportNav")}
            </Link>
            <WakaButton type="button" onClick={() => dispatch({ type: "RESET" })} className="min-h-[48px]">
              {t(lang, "checkoutRetry")}
            </WakaButton>
          </div>
        </div>
      ) : null}
    </section>
  );
}
