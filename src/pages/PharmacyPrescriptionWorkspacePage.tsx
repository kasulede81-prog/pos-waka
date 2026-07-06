import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import clsx from "clsx";
import type { Language, PharmacyPrescription, PharmacyPrescriptionType } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { isPharmacyMode } from "../lib/pharmacy";
import { useSessionActor } from "../context/SessionActorContext";
import { hasEffectivePermission } from "../lib/subscriptionEntitlements";
import { useSubscription } from "../context/SubscriptionContext";
import {
  activePrescriptionQueue,
  PHARMACY_PRESCRIPTION_TYPES,
  prescriptionHasControlledMedicines,
  prescriptionStatusLabelKey,
  prescriptionTypeLabelKey,
  searchPrescriptions,
} from "../lib/pharmacyPrescriptions";
import { buildPatientTimeline, patientSummary } from "../lib/pharmacyPatientTimeline";
import { productMatchesSellSearch } from "../lib/productCategories";
import { addLineToPrescription } from "../lib/pharmacyPrescriptionOps";
import { printPrescriptionSummary } from "../lib/pharmacyPrescriptionPrint";
import { PharmacyVerificationSheet } from "../components/pharmacy/prescription/PharmacyVerificationSheet";
import { PharmacyControlledApprovalModal } from "../components/pharmacy/prescription/PharmacyControlledApprovalModal";
import { PharmacyControlledDispenseGate } from "../components/pharmacy/compliance/PharmacyControlledDispenseGate";
import { usePharmacyControlledCheckout } from "../hooks/usePharmacyControlledCheckout";
import { PharmacyFefoBatchChip } from "../components/pharmacy/PharmacyFefoBatchPicker";
import { formatUgx } from "../lib/formatUgx";
import { pinnedPatientNotes, ensurePharmacyPatientProfile } from "../lib/pharmacyPatientProfile";
import { PharmacyAllergyWarningBanner } from "../components/pharmacy/patient/PharmacyAllergyWarningBanner";

const RX_TYPES: PharmacyPrescriptionType[] = PHARMACY_PRESCRIPTION_TYPES;

export function PharmacyPrescriptionWorkspacePage({ lang }: { lang: Language }) {
  const [searchParams] = useSearchParams();
  const otcMode = searchParams.get("mode") === "otc";

  const actor = useSessionActor();
  const { snapshot, authMode } = useSubscription();
  const preferences = usePosStore((s) => s.preferences);
  const products = usePosStore((s) => s.products);
  const customers = usePosStore((s) => s.customers);
  const sales = usePosStore((s) => s.sales);
  const debtPayments = usePosStore((s) => s.debtPayments);
  const prescriptions = usePosStore((s) => s.pharmacyPrescriptions);
  const draftLines = usePosStore((s) => s.draftLines);
  const createPharmacyPrescription = usePosStore((s) => s.createPharmacyPrescription);
  const updatePharmacyPrescription = usePosStore((s) => s.updatePharmacyPrescription);
  const transitionPharmacyPrescription = usePosStore((s) => s.transitionPharmacyPrescription);
  const verifyPharmacyPrescription = usePosStore((s) => s.verifyPharmacyPrescription);
  const loadPrescriptionToDraft = usePosStore((s) => s.loadPrescriptionToDraft);
  const setPharmacyDispenseMode = usePosStore((s) => s.setPharmacyDispenseMode);
  const createPharmacyRefill = usePosStore((s) => s.createPharmacyRefill);
  const approveControlledDispense = usePosStore((s) => s.approveControlledDispense);
  const addDraftLineFromInput = usePosStore((s) => s.addDraftLineFromInput);
  const setDraftInput = usePosStore((s) => s.setDraftInput);
  const removeDraftLine = usePosStore((s) => s.removeDraftLine);
  const adjustDraftLineQuantity = usePosStore((s) => s.adjustDraftLineQuantity);

  const [search, setSearch] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [selectedRxId, setSelectedRxId] = useState<string | null>(null);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [controlledOpen, setControlledOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const pharmacy = isPharmacyMode(preferences.businessType, preferences.pharmacyModeEnabled);
  const canDispense = hasEffectivePermission(actor.role, "pos.sell", snapshot, authMode);

  const queue = useMemo(() => activePrescriptionQueue(prescriptions), [prescriptions]);
  const searchResults = useMemo(
    () => searchPrescriptions(prescriptions, search, customers),
    [prescriptions, search, customers],
  );
  const selectedRx = useMemo(
    () => prescriptions.find((r) => r.id === selectedRxId) ?? null,
    [prescriptions, selectedRxId],
  );
  const controlledCheckout = usePharmacyControlledCheckout(selectedRx);
  const selectedPatient = useMemo(
    () => customers.find((c) => c.id === selectedPatientId) ?? null,
    [customers, selectedPatientId],
  );
  const patientTimeline = useMemo(() => {
    if (!selectedPatientId) return [];
    return buildPatientTimeline({
      patientId: selectedPatientId,
      prescriptions,
      sales,
      debtPayments,
      products,
    });
  }, [selectedPatientId, prescriptions, sales, debtPayments, products]);
  const patientStats = useMemo(() => {
    if (!selectedPatient) return null;
    return patientSummary({ patient: selectedPatient, prescriptions, sales });
  }, [selectedPatient, prescriptions, sales]);

  const productHits = useMemo(() => {
    const q = productSearch.trim();
    if (!q) return [];
    return products.filter((p) => productMatchesSellSearch(p, q)).slice(0, 12);
  }, [products, productSearch]);

  const basketTotal = draftLines.reduce((s, l) => s + l.lineTotalUgx, 0);
  const basketProductIds = useMemo(() => {
    const ids = draftLines.map((l) => l.productId);
    if (selectedRx) ids.push(...selectedRx.lines.map((l) => l.productId));
    return [...new Set(ids)];
  }, [draftLines, selectedRx]);
  const pinnedNotes = useMemo(() => {
    if (!selectedPatient) return [];
    return pinnedPatientNotes(ensurePharmacyPatientProfile(selectedPatient));
  }, [selectedPatient]);

  useEffect(() => {
    if (otcMode) {
      setPharmacyDispenseMode("otc");
      setSelectedRxId(null);
    }
  }, [otcMode, setPharmacyDispenseMode]);

  if (!pharmacy) return null;

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2500);
  };

  const startNewRx = (type: PharmacyPrescriptionType = "paper_rx") => {
    const patient = selectedPatient;
    const r = createPharmacyPrescription({
      type,
      patientId: patient?.id ?? null,
      patientName: patient?.name ?? null,
      patientPhone: patient?.phone ?? null,
    });
    if (r.ok && r.prescriptionId) {
      setSelectedRxId(r.prescriptionId);
      setPharmacyDispenseMode("prescription");
    }
  };

  const addMedicineToRx = (productId: string) => {
    if (!selectedRx) return;
    const product = products.find((p) => p.id === productId);
    if (!product) return;
    const updated = addLineToPrescription(selectedRx, product, 1, null);
    updatePharmacyPrescription(selectedRx.id, { lines: updated.lines });
    setProductSearch("");
  };

  const addOtcToBasket = (productId: string) => {
    const product = products.find((p) => p.id === productId);
    if (!product) return;
    setPharmacyDispenseMode("otc");
    setDraftInput({ product, inputMode: "quantity", value: 1 });
    const r = addDraftLineFromInput();
    if (!r.ok) flash(t(lang, r.errorKey ?? "invalid"));
    setProductSearch("");
  };

  const submitForVerification = () => {
    if (!selectedRx) return;
    transitionPharmacyPrescription(selectedRx.id, "waiting_verification");
    flash(t(lang, "pharmacyRxStatusWaiting"));
  };

  const openVerify = () => {
    if (!selectedRx) return;
    if (prescriptionHasControlledMedicines(selectedRx, products) && !selectedRx.controlledMedicinesApproved) {
      setControlledOpen(true);
      return;
    }
    setVerifyOpen(true);
  };

  const confirmVerify = () => {
    if (!selectedRx) return;
    verifyPharmacyPrescription(selectedRx.id);
    setVerifyOpen(false);
    flash(t(lang, "pharmacyRxStatusVerified"));
  };

  const beginDispense = () => {
    if (!selectedRx) return;
    const r = loadPrescriptionToDraft(selectedRx.id);
    flash(r.ok ? t(lang, "pharmacyRxDispensing") : t(lang, r.errorKey ?? "invalid"));
  };

  const runFinalizeDispense = () => {
    const finalizeOpts = {
      debtUgx: 0,
      customerId: selectedPatientId ?? selectedRx?.patientId ?? null,
      customerName: selectedPatient?.name ?? selectedRx?.patientName ?? null,
      customerPhone: selectedPatient?.phone ?? selectedRx?.patientPhone ?? null,
      paymentMethod: "cash" as const,
      amountPaidUgx: basketTotal,
      changeGivenUgx: 0,
    };
    const r = controlledCheckout.runFinalize(finalizeOpts);
    if (r.ok) {
      flash(t(lang, "pharmacyRxDispensed"));
      setSelectedRxId(null);
    } else if (r.errorKey === "pharmacyControlledApprovalRequired") {
      controlledCheckout.setGateOpen(true);
    } else {
      flash(t(lang, r.errorKey ?? "invalid"));
    }
  };

  const completeDispense = () => {
    if (!canDispense || draftLines.length === 0) return;
    const finalizeOpts = {
      debtUgx: 0,
      customerId: selectedPatientId ?? selectedRx?.patientId ?? null,
      customerName: selectedPatient?.name ?? selectedRx?.patientName ?? null,
      customerPhone: selectedPatient?.phone ?? selectedRx?.patientPhone ?? null,
      paymentMethod: "cash" as const,
      amountPaidUgx: basketTotal,
      changeGivenUgx: 0,
    };
    const r = controlledCheckout.attemptFinalize(finalizeOpts);
    if (!r.ok) {
      if (r.errorKey === "pharmacyControlledApprovalRequired") return;
      flash(t(lang, r.errorKey ?? "invalid"));
      return;
    }
    flash(t(lang, "pharmacyRxDispensed"));
    setSelectedRxId(null);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-stone-100">
      <header className="shrink-0 border-b border-stone-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black text-stone-950">{t(lang, "pharmacyRxWorkspaceTitle")}</h1>
            <p className="text-sm font-medium text-stone-500">{t(lang, "pharmacyRxWorkspaceSub")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              to="/pharmacy/prescriptions?mode=otc"
              className={clsx(
                "min-h-[48px] rounded-2xl px-4 text-sm font-black touch-manipulation",
                otcMode ? "bg-waka-600 text-white" : "border border-stone-200 bg-white",
              )}
            >
              {t(lang, "pharmacyRxOtcQuick")}
            </Link>
            <button
              type="button"
              onClick={() => startNewRx("paper_rx")}
              className="min-h-[48px] rounded-2xl bg-teal-600 px-4 text-sm font-black text-white touch-manipulation"
            >
              {t(lang, "pharmacyRxNew")}
            </button>
          </div>
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t(lang, "pharmacyRxSearchPh")}
          className="mt-3 min-h-[48px] w-full rounded-2xl border-2 border-stone-200 px-4 text-base font-semibold"
        />
      </header>

      {toast ? (
        <p className="mx-4 mt-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-950">
          {toast}
        </p>
      ) : null}

      <div className="grid min-h-0 flex-1 gap-3 p-3 lg:grid-cols-[minmax(240px,280px)_1fr_minmax(280px,340px)] landscape:grid-cols-3">
        {/* Patient queue */}
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
          <div className="shrink-0 border-b border-stone-100 px-3 py-3">
            <h2 className="text-sm font-black uppercase text-stone-500">{t(lang, "pharmacyRxPatientQueue")}</h2>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            <p className="px-2 py-1 text-xs font-bold text-stone-500">{t(lang, "pharmacyRxQueueActive")}</p>
            <ul className="space-y-2">
              {queue.map((rx) => (
                <QueueCard
                  key={rx.id}
                  lang={lang}
                  rx={rx}
                  active={selectedRxId === rx.id}
                  onClick={() => {
                    setSelectedRxId(rx.id);
                    if (rx.patientId) setSelectedPatientId(rx.patientId);
                  }}
                />
              ))}
            </ul>
            <p className="mt-4 px-2 py-1 text-xs font-bold text-stone-500">{t(lang, "pharmacyTerm_patients")}</p>
            <ul className="space-y-1">
              {customers.slice(0, 20).map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedPatientId(c.id)}
                    className={clsx(
                      "w-full rounded-xl px-3 py-2 text-left text-sm font-bold touch-manipulation",
                      selectedPatientId === c.id ? "bg-teal-50 text-teal-950" : "hover:bg-stone-50",
                    )}
                  >
                    {c.name}
                    {c.phone ? <span className="block text-xs font-medium text-stone-500">{c.phone}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
            {selectedPatient && patientStats ? (
              <div className="mt-3 space-y-2">
                <Link
                  to={`/pharmacy/patients/${selectedPatient.id}`}
                  className="block rounded-xl bg-teal-50 px-3 py-2 text-xs font-black text-teal-900"
                >
                  {t(lang, "pharmacyPatientOpenProfile")}
                </Link>
                {pinnedNotes.length > 0 ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-black text-amber-950">
                    {pinnedNotes.map((n) => (
                      <p key={n.id}>{n.text}</p>
                    ))}
                  </div>
                ) : null}
                <div className="rounded-xl bg-stone-50 p-3 text-xs font-semibold text-stone-700">
                <p>
                  {t(lang, "pharmacyRxTimelineTitle")}: {patientStats.prescriptionCount} Rx · {patientStats.otcCount}{" "}
                  OTC
                </p>
                {patientStats.outstandingDebtUgx > 0 ? (
                  <p className="mt-1 text-rose-800">
                    {t(lang, "debtBalanceLabel")}: {formatUgx(patientStats.outstandingDebtUgx)}
                  </p>
                ) : null}
                <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto">
                  {patientTimeline.slice(0, 6).map((ev) => (
                    <li key={ev.id} className="truncate">
                      {ev.title} · {ev.at.slice(0, 10)}
                    </li>
                  ))}
                </ul>
                </div>
              </div>
            ) : null}
          </div>
        </aside>

        {/* Prescription center */}
        <main className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
          <div className="shrink-0 border-b border-stone-100 px-4 py-3">
            <h2 className="text-sm font-black uppercase text-stone-500">
              {selectedRx ? t(lang, "pharmacyRxEditor") : t(lang, "pharmacyRxSelectOrCreate")}
            </h2>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <PharmacyAllergyWarningBanner lang={lang} patient={selectedPatient} productIds={basketProductIds} />
            {selectedRx ? (
              <RxEditor
                lang={lang}
                rx={selectedRx}
                onPatch={(patch) => updatePharmacyPrescription(selectedRx.id, patch)}
                types={RX_TYPES}
              />
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {RX_TYPES.map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => startNewRx(type)}
                    className="min-h-[56px] rounded-2xl border-2 border-stone-200 px-4 text-left text-sm font-black touch-manipulation hover:border-teal-300"
                  >
                    {t(lang, prescriptionTypeLabelKey(type))}
                  </button>
                ))}
              </div>
            )}

            <div className="mt-4">
              <input
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                placeholder={t(lang, "pharmacyRxAddMedicinePh")}
                className="min-h-[48px] w-full rounded-2xl border-2 border-stone-200 px-4 text-base font-semibold"
              />
              {productHits.length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {productHits.map((p) => (
                    <li key={p.id} className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => (selectedRx ? addMedicineToRx(p.id) : addOtcToBasket(p.id))}
                        className="min-h-[48px] flex-1 rounded-xl border border-stone-200 px-3 text-left text-sm font-bold touch-manipulation hover:bg-teal-50"
                      >
                        {p.name}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            {search && searchResults.length > 0 ? (
              <div className="mt-4">
                <p className="text-xs font-black uppercase text-stone-500">{t(lang, "pharmacyRxSearchResults")}</p>
                <ul className="mt-1 space-y-1">
                  {searchResults.slice(0, 8).map((rx) => (
                    <li key={rx.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedRxId(rx.id);
                          if (rx.patientId) setSelectedPatientId(rx.patientId);
                        }}
                        className="w-full rounded-xl border border-stone-100 px-3 py-2 text-left text-sm font-bold"
                      >
                        {rx.prescriptionNumber} · {rx.patientName ?? "—"}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
          {selectedRx ? (
            <div className="shrink-0 grid grid-cols-2 gap-2 border-t border-stone-100 p-3 sm:grid-cols-4">
              <ActionBtn label={t(lang, "pharmacyRxSubmitVerify")} onClick={submitForVerification} />
              <ActionBtn label={t(lang, "pharmacyRxVerify")} onClick={openVerify} />
              <ActionBtn label={t(lang, "pharmacyRxBeginDispense")} onClick={beginDispense} primary />
              <ActionBtn
                label={t(lang, "pharmacyRxPrint")}
                onClick={() => printPrescriptionSummary(lang, selectedRx, preferences)}
              />
              <ActionBtn
                label={t(lang, "pharmacyRxRefill")}
                onClick={() => {
                  const r = createPharmacyRefill(selectedRx.id);
                  if (r.ok && r.prescriptionId) setSelectedRxId(r.prescriptionId);
                }}
              />
            </div>
          ) : null}
        </main>

        {/* Dispensing basket */}
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
          <div className="shrink-0 border-b border-stone-100 px-3 py-3">
            <h2 className="text-sm font-black uppercase text-stone-500">{t(lang, "pharmacyRxBasket")}</h2>
            <p className="text-lg font-black text-stone-950">{formatUgx(basketTotal)}</p>
          </div>
          <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
            {draftLines.length === 0 ? (
              <p className="text-center text-sm font-semibold text-stone-500">{t(lang, "pharmacyRxBasketEmpty")}</p>
            ) : (
              draftLines.map((line) => (
                <li key={line.productId} className="rounded-xl border border-stone-200 p-3">
                  <p className="text-sm font-black text-stone-900">{line.name}</p>
                  <p className="text-xs font-semibold text-stone-600">
                    {line.quantity} · {formatUgx(line.lineTotalUgx)}
                  </p>
                  <PharmacyFefoBatchChip lang={lang} line={line} />
                  <div className="mt-2 flex gap-1">
                    <button
                      type="button"
                      onClick={() => adjustDraftLineQuantity(line.productId, -1)}
                      className="min-h-[40px] min-w-[40px] rounded-lg border font-black"
                    >
                      −
                    </button>
                    <button
                      type="button"
                      onClick={() => adjustDraftLineQuantity(line.productId, 1)}
                      className="min-h-[40px] min-w-[40px] rounded-lg border font-black"
                    >
                      +
                    </button>
                    <button
                      type="button"
                      onClick={() => removeDraftLine(line.productId)}
                      className="min-h-[40px] flex-1 rounded-lg border border-rose-200 text-xs font-black text-rose-800"
                    >
                      {t(lang, "removeLine")}
                    </button>
                  </div>
                </li>
              ))
            )}
          </ul>
          <div className="shrink-0 border-t border-stone-100 p-3">
            <button
              type="button"
              disabled={!canDispense || draftLines.length === 0}
              onClick={completeDispense}
              className="min-h-[56px] w-full rounded-2xl bg-waka-600 text-lg font-black text-white disabled:opacity-50 touch-manipulation"
            >
              {t(lang, "pharmacyRxCompletePayment")}
            </button>
          </div>
        </aside>
      </div>

      {selectedRx ? (
        <PharmacyVerificationSheet
          lang={lang}
          prescription={selectedRx}
          products={products}
          patient={selectedPatient}
          open={verifyOpen}
          onClose={() => setVerifyOpen(false)}
          onConfirm={confirmVerify}
        />
      ) : null}

      {selectedRx ? (
        <PharmacyControlledApprovalModal
          lang={lang}
          open={controlledOpen}
          prescriptionNumber={selectedRx.prescriptionNumber}
          onClose={() => setControlledOpen(false)}
          onApproved={(reason) => {
            approveControlledDispense(selectedRx.id, reason);
            setVerifyOpen(true);
          }}
        />
      ) : null}

      {controlledCheckout.hasControlledLines ? (
        <PharmacyControlledDispenseGate
          lang={lang}
          open={controlledCheckout.gateOpen}
          validation={controlledCheckout.validation}
          prescription={selectedRx}
          patientName={selectedPatient?.name ?? selectedRx?.patientName ?? null}
          onClose={() => controlledCheckout.setGateOpen(false)}
          onApproved={runFinalizeDispense}
        />
      ) : null}
    </div>
  );
}

function QueueCard({
  lang,
  rx,
  active,
  onClick,
}: {
  lang: Language;
  rx: PharmacyPrescription;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={clsx(
          "w-full rounded-xl border-2 px-3 py-3 text-left touch-manipulation",
          active ? "border-teal-400 bg-teal-50" : "border-stone-200 bg-white",
        )}
      >
        <p className="text-sm font-black text-stone-950">{rx.prescriptionNumber}</p>
        <p className="text-xs font-semibold text-stone-600">{rx.patientName ?? t(lang, "pharmacyRxWalkIn")}</p>
        <p className="text-[10px] font-black uppercase text-stone-500">{t(lang, prescriptionStatusLabelKey(rx.status))}</p>
      </button>
    </li>
  );
}

function RxEditor({
  lang,
  rx,
  onPatch,
  types,
}: {
  lang: Language;
  rx: PharmacyPrescription;
  onPatch: (patch: Partial<PharmacyPrescription>) => void;
  types: PharmacyPrescriptionType[];
}) {
  const inputClass = "mt-1 min-h-[44px] w-full rounded-xl border-2 border-stone-200 px-3 text-base font-semibold";
  const labelClass = "block text-xs font-bold text-stone-600";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-black">{rx.prescriptionNumber}</span>
        <span className="rounded-full bg-teal-100 px-3 py-1 text-xs font-black text-teal-900">
          {t(lang, prescriptionStatusLabelKey(rx.status))}
        </span>
      </div>
      <label className={labelClass}>
        {t(lang, "pharmacyRxType")}
        <select
          value={rx.type}
          onChange={(e) => onPatch({ type: e.target.value as PharmacyPrescriptionType })}
          className={inputClass}
        >
          {types.map((type) => (
            <option key={type} value={type}>
              {t(lang, prescriptionTypeLabelKey(type))}
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          {t(lang, "pharmacyRxDoctor")}
          <input value={rx.doctorName ?? ""} onChange={(e) => onPatch({ doctorName: e.target.value })} className={inputClass} />
        </label>
        <label className={labelClass}>
          {t(lang, "pharmacyRxDate")}
          <input
            type="date"
            value={rx.prescriptionDate}
            onChange={(e) => onPatch({ prescriptionDate: e.target.value })}
            className={inputClass}
          />
        </label>
      </div>
      <label className={labelClass}>
        {t(lang, "pharmacyRxDiagnosis")}
        <input value={rx.diagnosis ?? ""} onChange={(e) => onPatch({ diagnosis: e.target.value })} className={inputClass} />
      </label>
      <label className={labelClass}>
        {t(lang, "pharmacyRxNotes")}
        <textarea value={rx.notes ?? ""} onChange={(e) => onPatch({ notes: e.target.value })} rows={2} className={inputClass} />
      </label>
      <label className={labelClass}>
        {t(lang, "pharmacyRxRefillCount")}
        <input
          inputMode="numeric"
          value={String(rx.refillCount)}
          onChange={(e) => onPatch({ refillCount: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
          className={inputClass}
        />
      </label>
      {rx.lines.length > 0 ? (
        <ul className="space-y-2">
          {rx.lines.map((line) => (
            <li key={line.id} className="rounded-xl border border-stone-200 p-3 text-sm">
              <p className="font-black">{line.productName}</p>
              <p className="font-semibold text-stone-600">
                {line.quantityPrescribed} · {line.directions ?? "—"}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm font-semibold text-stone-500">{t(lang, "pharmacyRxNoLines")}</p>
      )}
    </div>
  );
}

function ActionBtn({ label, onClick, primary }: { label: string; onClick: () => void; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "min-h-[48px] rounded-xl text-xs font-black touch-manipulation sm:text-sm",
        primary ? "bg-teal-600 text-white" : "border border-stone-200 bg-white text-stone-900",
      )}
    >
      {label}
    </button>
  );
}
