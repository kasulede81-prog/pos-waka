import { actorHasPermission } from "../lib/actorAuthorization";
import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { useSessionActor } from "../context/SessionActorContext";

import { PageHeader } from "../components/layout/PageHeader";
import { EnterpriseApprovalPinPad } from "../components/auth/EnterpriseApprovalPinPad";
import { KeyboardSafePage } from "../components/layout/KeyboardSafePage";
import { dateKeyKampala } from "../lib/datesUg";
import {
  activeDayDrawerOpenForDate,
  canRequestOwnerDayOpenCorrection,
  isDayDrawerOpenMutable,
  isFormulaV2,
  isOwnerDayOpenCorrectionAfterSalesEnabled,
} from "../lib/dayDrawerOpen";

export function DayOpenPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const canOpen = actorHasPermission(actor, "day.open_drawer");
  const preferences = usePosStore((s) => s.preferences);
  const dayDrawerOpens = usePosStore((s) => s.dayDrawerOpens);
  const sales = usePosStore((s) => s.sales);
  const recordDayDrawerOpen = usePosStore((s) => s.recordDayDrawerOpen);
  const supersedeDayDrawerOpen = usePosStore((s) => s.supersedeDayDrawerOpen);
  const voidDayDrawerOpen = usePosStore((s) => s.voidDayDrawerOpen);

  const todayKey = dateKeyKampala(new Date());
  const active = useMemo(() => activeDayDrawerOpenForDate(dayDrawerOpens, todayKey), [dayDrawerOpens, todayKey]);
  const mutable = isDayDrawerOpenMutable(sales, todayKey);
  const correctionEnabled = isOwnerDayOpenCorrectionAfterSalesEnabled(preferences);
  const canOwnerCorrect = canRequestOwnerDayOpenCorrection(sales, todayKey, preferences);
  const v2 = isFormulaV2(preferences);

  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [voidReason, setVoidReason] = useState("");
  const [ownerPin, setOwnerPin] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; key: string } | null>(null);

  const translateKey = (key: string) => (t as (l: Language, k: string) => string)(lang, key);

  if (!canOpen) {
    return <Navigate to="/office" replace />;
  }

  const submitOpen = () => {
    const openingFloatUgx = Math.floor(Number(amount.replace(/\D/g, "")) || 0);
    if (openingFloatUgx <= 0) return;
    const r = active
      ? supersedeDayDrawerOpen({ previousId: active.id, openingFloatUgx, note, reason: note })
      : recordDayDrawerOpen({ openingFloatUgx, note });
    if (r.ok) {
      setAmount("");
      setNote("");
      setMsg({ kind: "ok", key: "dayOpenSuccess" });
    } else {
      setMsg({ kind: "err", key: r.errorKey ?? "saleError" });
    }
  };

  const submitOwnerCorrection = () => {
    if (!active) return;
    const openingFloatUgx = Math.floor(Number(amount.replace(/\D/g, "")) || 0);
    if (openingFloatUgx <= 0) return;
    const r = supersedeDayDrawerOpen({
      previousId: active.id,
      openingFloatUgx,
      note,
      reason: correctionReason,
      ownerOverridePin: ownerPin,
    });
    if (r.ok) {
      setAmount("");
      setNote("");
      setOwnerPin("");
      setCorrectionReason("");
      setMsg({ kind: "ok", key: "dayOpenCorrectionSuccess" });
    } else {
      setMsg({ kind: "err", key: r.errorKey ?? "saleError" });
    }
  };

  const submitVoid = (useOwnerOverride: boolean) => {
    if (!active) return;
    const r = voidDayDrawerOpen({
      dayOpenId: active.id,
      reason: useOwnerOverride ? correctionReason : voidReason,
      ownerOverridePin: useOwnerOverride ? ownerPin : undefined,
    });
    setMsg(r.ok ? { kind: "ok", key: "dayOpenVoided" } : { kind: "err", key: r.errorKey ?? "saleError" });
  };

  return (
    <KeyboardSafePage className="space-y-5 pb-16">
      <PageHeader lang={lang} title={t(lang, "dayOpenTitle")} subtitle={t(lang, "dayOpenSub")} backFallback="/office/cash-drawer" />

      {!v2 ? (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950">
          Formula v1 — legacy opening float. Enable formula v2 in{" "}
          <Link to="/settings/cash-drawer" className="font-black text-waka-800 underline">
            {t(lang, "cashManageDrawerSettings")}
          </Link>{" "}
          when ready.
        </p>
      ) : null}

      {!active && mutable ? (
        <section className="rounded-3xl border-2 border-amber-300 bg-gradient-to-r from-amber-50 to-card p-5">
          <p className="text-sm font-black text-amber-950">{t(lang, "dayOpenHubAlertTitle")}</p>
          <p className="mt-1 text-xs font-semibold text-amber-900/80">{t(lang, "dayOpenHubAlertSub")}</p>
        </section>
      ) : null}

      {active ? (
        <section className="rounded-3xl border-2 border-sky-200 bg-sky-50 p-5">
          <p className="text-sm font-black uppercase text-sky-800">{t(lang, "dayOpenActiveLabel")}</p>
          <p className="mt-2 text-3xl font-black text-sky-950">UGX {active.openingFloatUgx.toLocaleString()}</p>
          <p className="mt-2 text-sm font-semibold text-sky-900">
            {t(lang, "dayOpenOpenedBy")}: {active.countedByLabel}
          </p>
          {active.firstVerifiedByLabel ? (
            <p className="text-sm font-semibold text-sky-900">
              {t(lang, "dayOpenFirstVerified")}: {active.firstVerifiedByLabel}
            </p>
          ) : null}
          {!mutable ? (
            <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-950">
              {canOwnerCorrect
                ? t(lang, "dayOpenLockedHintWithCorrection")
                : t(lang, "dayOpenLockedHint")}
            </p>
          ) : null}
        </section>
      ) : null}

      {mutable ? (
        <section className="rounded-3xl border border-border bg-card p-5 shadow-waka-sm">
          <label className="block text-sm font-bold text-foreground">
            {t(lang, "dayOpenAmountLabel")}
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/\D/g, "").slice(0, 12))}
              inputMode="numeric"
              className="mt-2 min-h-[52px] w-full rounded-2xl border-2 border-border px-4 text-2xl font-black"
            />
          </label>
          <label className="mt-4 block text-sm font-bold text-foreground">
            {t(lang, "dayOpenNoteLabel")}
            <input
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 200))}
              className="mt-2 min-h-[44px] w-full rounded-2xl border-2 border-border px-4 text-sm font-semibold"
            />
          </label>
          <button
            type="button"
            onClick={submitOpen}
            className="mt-4 min-h-[56px] w-full rounded-2xl bg-waka-600 text-lg font-black text-white shadow-md"
          >
            {active ? t(lang, "dayOpenSupersedeBtn") : t(lang, "dayOpenRecordBtn")}
          </button>
          {active ? (
            <>
              <input
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value.slice(0, 200))}
                placeholder={t(lang, "shiftFloatOverrideReason")}
                className="mt-3 min-h-[44px] w-full rounded-2xl border-2 border-border px-4 text-sm"
              />
              <button
                type="button"
                onClick={() => submitVoid(false)}
                className="mt-2 min-h-[44px] w-full rounded-2xl border-2 border-rose-200 font-bold text-rose-800"
              >
                {t(lang, "dayOpenVoidBtn")}
              </button>
            </>
          ) : null}
        </section>
      ) : null}

      {canOwnerCorrect && active ? (
        <section className="rounded-3xl border-2 border-amber-300 bg-card p-5 shadow-waka-sm">
          <h2 className="text-base font-black text-foreground">{t(lang, "dayOpenCorrectionSectionTitle")}</h2>
          <p className="mt-1 text-xs font-semibold text-muted-foreground">{t(lang, "dayOpenCorrectionSectionSub")}</p>
          <label className="mt-4 block text-sm font-bold text-foreground">
            {t(lang, "dayOpenAmountLabel")}
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/\D/g, "").slice(0, 12))}
              inputMode="numeric"
              className="mt-2 min-h-[52px] w-full rounded-2xl border-2 border-border px-4 text-2xl font-black"
            />
          </label>
          <label className="mt-4 block text-sm font-bold text-foreground">
            {t(lang, "dayOpenNoteLabel")}
            <input
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 200))}
              className="mt-2 min-h-[44px] w-full rounded-2xl border-2 border-border px-4 text-sm font-semibold"
            />
          </label>
          <label className="mt-4 block text-sm font-bold text-foreground">
            {t(lang, "shiftFloatOverrideReason")}
            <input
              value={correctionReason}
              onChange={(e) => setCorrectionReason(e.target.value.slice(0, 200))}
              className="mt-2 min-h-[44px] w-full rounded-2xl border-2 border-border px-4 text-sm font-semibold"
            />
          </label>
          <p className="mt-4 text-sm font-bold text-foreground">{t(lang, "dayOpenCorrectionPinLabel")}</p>
          <EnterpriseApprovalPinPad
            lang={lang}
            preferences={preferences}
            disabled={!correctionReason.trim()}
            className="mt-2"
            onApproved={(pin) => {
              setOwnerPin(pin);
            }}
          />
          <button
            type="button"
            onClick={submitOwnerCorrection}
            className="mt-4 min-h-[52px] w-full rounded-2xl bg-amber-600 font-black text-white"
          >
            {t(lang, "dayOpenCorrectionSaveBtn")}
          </button>
          <button
            type="button"
            onClick={() => submitVoid(true)}
            className="mt-2 min-h-[44px] w-full rounded-2xl border-2 border-rose-200 font-bold text-rose-800"
          >
            {t(lang, "dayOpenVoidBtn")}
          </button>
        </section>
      ) : null}

      {!correctionEnabled && !mutable && active ? (
        <p className="text-center text-xs font-semibold text-muted-foreground">
          {t(lang, "dayOpenEnableCorrectionInSettings")}{" "}
          <Link to="/settings/cash-drawer" className="font-black text-waka-700 underline">
            {t(lang, "settingsHubTitle")}
          </Link>
        </p>
      ) : null}

      {msg ? (
        <div
          className={
            msg.kind === "ok"
              ? "rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3"
              : "rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3"
          }
        >
          <p className={`text-sm font-bold ${msg.kind === "ok" ? "text-emerald-950" : "text-rose-900"}`}>
            {translateKey(msg.key)}
          </p>
          {msg.kind === "ok" ? (
            <Link
              to="/pos"
              className="mt-3 flex min-h-[48px] items-center justify-center rounded-2xl bg-waka-600 font-black text-white"
            >
              {t(lang, "dayOpenSuccessGoSell")}
            </Link>
          ) : null}
        </div>
      ) : null}
    </KeyboardSafePage>
  );
}
