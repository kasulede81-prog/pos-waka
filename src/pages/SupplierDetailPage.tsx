import { useMemo, useState, type FormEvent } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { ArrowDownLeft, ArrowUpRight, Scale } from "lucide-react";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { useSessionActor } from "../context/SessionActorContext";
import { hasPermission } from "../lib/permissions";
import { PageHeader } from "../components/layout/PageHeader";
import { HistoryHeroCard } from "../components/shared/HistoryHeroCard";
import { HistoryListCard } from "../components/shared/HistoryListCard";
import {
  buildSupplierStatement,
  filterSupplierPayments,
  resolvePurchaseFilterBounds,
  sumSupplierPaymentsUgx,
} from "../lib/purchaseReporting";
import { supplierPaymentCreatedByLabel } from "../lib/purchaseCorrections";
import { downloadSupplierStatementCsv, downloadSupplierStatementPdf, printSupplierStatementReport } from "../lib/purchaseExport";
import { receiptPrintActionLabel } from "../lib/printActionLabels";
import { dateKeyKampala } from "../lib/datesUg";
import { isWalkInSupplierId } from "../lib/walkInSupplier";
import { dateMatchesFilter, resolveDateFilterBounds, type DateFilterValue } from "../lib/dateFilters";

export function SupplierDetailPage({
  lang,
  supplierId: supplierIdProp,
  embedded,
  onClose,
  onOpenPurchase: _onOpenPurchase,
}: {
  lang: Language;
  supplierId?: string;
  embedded?: boolean;
  onClose?: () => void;
  onOpenPurchase?: (purchaseId: string) => void;
}) {
  const { supplierId: routeSupplierId } = useParams<{ supplierId: string }>();
  const supplierId = supplierIdProp ?? routeSupplierId;
  const actor = useSessionActor();
  const canView = hasPermission(actor.role, "suppliers.view");
  const canManage = hasPermission(actor.role, "suppliers.manage");

  const suppliers = usePosStore((s) => s.suppliers);
  const auditLogs = usePosStore((s) => s.auditLogs);
  const updateSupplier = usePosStore((s) => s.updateSupplier);
  const purchases = usePosStore((s) => s.purchases);
  const supplierPayments = usePosStore((s) => s.supplierPayments);
  const preferences = usePosStore((s) => s.preferences);
  const shopName = preferences.shopDisplayName?.trim() || "Waka POS";

  const [exportHint, setExportHint] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editSaved, setEditSaved] = useState(false);
  const [statementFilter, setStatementFilter] = useState<DateFilterValue>({ kind: "preset", preset: "this_month" });

  const statementBounds = useMemo(() => resolveDateFilterBounds(statementFilter), [statementFilter]);

  const supplier = useMemo(
    () => suppliers.find((s) => s.id === supplierId) ?? null,
    [suppliers, supplierId],
  );

  const allTimeBounds = useMemo(
    () => resolvePurchaseFilterBounds({ kind: "range", fromKey: "2000-01-01", toKey: "2099-12-31" }),
    [],
  );

  const statement = useMemo(() => {
    if (!supplier) return [];
    return buildSupplierStatement(supplier.id, supplier.name, purchases, supplierPayments);
  }, [supplier, purchases, supplierPayments]);

  const filteredStatement = useMemo(
    () => statement.filter((entry) => dateMatchesFilter(entry.dayKey, statementBounds)),
    [statement, statementBounds],
  );

  const statementTotals = useMemo(() => {
    let purchases = 0;
    let payments = 0;
    for (const entry of filteredStatement) {
      if (entry.kind === "purchase") purchases += entry.amountUgx;
      else payments += entry.amountUgx;
    }
    return { purchases, payments };
  }, [filteredStatement]);

  const payments = useMemo(() => {
    if (!supplier) return [];
    return filterSupplierPayments(supplierPayments, allTimeBounds, supplier.id);
  }, [supplier, supplierPayments, allTimeBounds]);

  const runExport = async (kind: "csv" | "pdf") => {
    if (!supplier) return;
    setExportBusy(true);
    try {
      const stem = supplier.id.slice(0, 8);
      const ok =
        kind === "csv"
          ? await downloadSupplierStatementCsv(supplier.name, filteredStatement, stem)
          : await downloadSupplierStatementPdf(lang, shopName, supplier.name, filteredStatement, stem);
      setExportHint(ok ? t(lang, "purchasesExportOk") : t(lang, "purchasesExportFail"));
      window.setTimeout(() => setExportHint(null), 3500);
    } finally {
      setExportBusy(false);
    }
  };

  const runPrint = async () => {
    if (!supplier) return;
    setExportBusy(true);
    try {
      const stem = supplier.id.slice(0, 8);
      const ok = await printSupplierStatementReport(lang, shopName, supplier.name, filteredStatement, stem);
      setExportHint(ok ? t(lang, "purchasesExportOk") : t(lang, "purchasesExportFail"));
      window.setTimeout(() => setExportHint(null), 3500);
    } finally {
      setExportBusy(false);
    }
  };

  if (!canView) {
    return <Navigate to="/" replace />;
  }

  if (!supplier || isWalkInSupplierId(supplier.id)) {
    if (embedded) return <p className="text-sm text-stone-600">{t(lang, "suppliersEmpty")}</p>;
    return <Navigate to="/stock?tab=suppliers" replace />;
  }

  const openEdit = () => {
    setEditName(supplier.name);
    setEditPhone(supplier.phone);
    setEditLocation(supplier.location);
    setEditNotes(supplier.notes);
    setEditOpen(true);
    setEditSaved(false);
  };

  const submitEdit = (e: FormEvent) => {
    e.preventDefault();
    const r = updateSupplier(supplier.id, {
      name: editName,
      phone: editPhone,
      location: editLocation,
      notes: editNotes,
    });
    if (r.ok) {
      setEditOpen(false);
      setEditSaved(true);
      window.setTimeout(() => setEditSaved(false), 3000);
    }
  };

  return (
    <div className="space-y-5 pb-16">
      {!embedded ? (
        <PageHeader
          lang={lang}
          title={supplier.name}
          subtitle={t(lang, "supplierDetailTitle")}
          backFallback="/stock?tab=suppliers"
          backLabel={t(lang, "suppliersTitle")}
        />
      ) : onClose ? (
        <button type="button" onClick={onClose} className="text-sm font-black text-waka-700">
          ← {t(lang, "suppliersTitle")}
        </button>
      ) : null}

      <section className="rounded-3xl border border-stone-200 bg-white p-5 shadow-waka-sm">
        {editSaved ? (
          <p className="mb-3 text-sm font-bold text-emerald-800">{t(lang, "supplierEditSave")}</p>
        ) : null}
        {canManage && !editOpen ? (
          <button
            type="button"
            onClick={openEdit}
            className="mb-4 w-full rounded-2xl border-2 border-stone-200 bg-stone-50 py-2.5 text-sm font-black text-stone-800"
          >
            {t(lang, "supplierEditTitle")}
          </button>
        ) : null}
        {editOpen ? (
          <form onSubmit={submitEdit} className="mb-4 space-y-3 rounded-2xl border border-waka-200 bg-waka-50/40 p-4">
            <h3 className="text-sm font-black text-waka-950">{t(lang, "supplierEditTitle")}</h3>
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder={t(lang, "supplierNamePh")}
              className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm"
              required
            />
            <input
              value={editPhone}
              onChange={(e) => setEditPhone(e.target.value)}
              placeholder={t(lang, "supplierPhonePh")}
              className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm"
            />
            <input
              value={editLocation}
              onChange={(e) => setEditLocation(e.target.value)}
              placeholder={t(lang, "supplierLocationPh")}
              className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm"
            />
            <textarea
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              placeholder={t(lang, "supplierNotesPh")}
              rows={2}
              className="w-full rounded-xl border border-stone-200 px-3 py-2 text-sm"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setEditOpen(false)}
                className="flex-1 rounded-xl border border-stone-200 bg-white py-2 text-sm font-bold"
              >
                {t(lang, "pendingSalesCancel")}
              </button>
              <button type="submit" className="flex-1 rounded-xl bg-waka-600 py-2 text-sm font-black text-white">
                {t(lang, "supplierEditSave")}
              </button>
            </div>
          </form>
        ) : null}
        <dl className="space-y-2 text-sm">
          {supplier.phone ? (
            <div>
              <dt className="font-bold text-stone-500">Phone</dt>
              <dd className="font-semibold text-stone-900">{supplier.phone}</dd>
            </div>
          ) : null}
          {supplier.location ? (
            <div>
              <dt className="font-bold text-stone-500">Location</dt>
              <dd className="font-semibold text-stone-900">{supplier.location}</dd>
            </div>
          ) : null}
          {supplier.notes ? (
            <div>
              <dt className="font-bold text-stone-500">Notes</dt>
              <dd className="font-semibold text-stone-900">{supplier.notes}</dd>
            </div>
          ) : null}
        </dl>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-amber-50 px-3 py-3">
            <p className="text-[10px] font-black uppercase text-amber-800">{t(lang, "supplierBalanceLabel")}</p>
            <p className="mt-1 text-xl font-black text-amber-950">UGX {supplier.balanceOwedUgx.toLocaleString()}</p>
          </div>
          <div className="rounded-2xl bg-stone-50 px-3 py-3">
            <p className="text-[10px] font-black uppercase text-stone-500">{t(lang, "supplierTotalBuy")}</p>
            <p className="mt-1 text-xl font-black text-stone-900">UGX {supplier.totalPurchasesUgx.toLocaleString()}</p>
          </div>
          {supplier.lastSupplyAt ? (
            <div className="col-span-2 rounded-2xl bg-stone-50 px-3 py-3">
              <p className="text-[10px] font-black uppercase text-stone-500">{t(lang, "supplierLastSupply")}</p>
              <p className="mt-1 font-bold text-stone-900">{dateKeyKampala(supplier.lastSupplyAt)}</p>
            </div>
          ) : null}
        </div>
      </section>

      <section className="rounded-3xl border-2 border-waka-200 bg-waka-50/40 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-black text-waka-950">{t(lang, "supplierStatementTitle")}</h2>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={exportBusy || filteredStatement.length === 0}
              onClick={() => void runPrint()}
              className="min-h-[40px] rounded-2xl bg-slate-900 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
            >
              {receiptPrintActionLabel(lang)}
            </button>
            <button
              type="button"
              disabled={exportBusy || filteredStatement.length === 0}
              onClick={() => void runExport("csv")}
              className="min-h-[40px] rounded-2xl border-2 border-stone-300 bg-white px-3 py-2 text-xs font-black disabled:opacity-50"
            >
              {t(lang, "purchasesExportCsv")}
            </button>
            <button
              type="button"
              disabled={exportBusy || filteredStatement.length === 0}
              onClick={() => void runExport("pdf")}
              className="min-h-[40px] rounded-2xl bg-waka-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
            >
              {t(lang, "purchasesExportPdf")}
            </button>
          </div>
        </div>
        {exportHint ? <p className="mt-2 text-sm font-bold text-waka-800">{exportHint}</p> : null}
        <div className="mt-4">
          <HistoryHeroCard
            lang={lang}
            filter={statementFilter}
            onFilterChange={setStatementFilter}
            metrics={[
              {
                label: t(lang, "supplierStatementPurchase"),
                icon: ArrowUpRight,
                value: `UGX ${statementTotals.purchases.toLocaleString()}`,
              },
              {
                label: t(lang, "supplierStatementPayment"),
                icon: ArrowDownLeft,
                value: `UGX ${statementTotals.payments.toLocaleString()}`,
              },
              {
                label: t(lang, "supplierBalanceLabel"),
                icon: Scale,
                value: `UGX ${supplier.balanceOwedUgx.toLocaleString()}`,
              },
            ]}
          />
        </div>
        {filteredStatement.length === 0 ? (
          <p className="mt-3 text-sm text-stone-600">{t(lang, "purchasesEmpty")}</p>
        ) : (
          <HistoryListCard className="mt-4">
            <ul>
            {filteredStatement.map((entry) => (
              <li key={`${entry.kind}-${entry.id}`} className="border-b border-stone-100 last:border-b-0">
                <div className="flex items-start justify-between gap-3 px-3 py-3 sm:px-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-bold uppercase text-stone-500">{entry.dayKey}</p>
                    <p className="mt-0.5 text-sm font-black text-stone-950">
                      {entry.kind === "purchase"
                        ? t(lang, "supplierStatementPurchase")
                        : t(lang, "supplierStatementPayment")}
                    </p>
                    {entry.kind === "purchase" ? (
                      <Link
                        to={`/stock?tab=purchases&purchaseId=${encodeURIComponent(entry.purchaseId)}`}
                        className="text-xs font-semibold text-waka-700 underline"
                      >
                        UGX {entry.amountUgx.toLocaleString()}
                      </Link>
                    ) : (
                      <p className="text-xs font-semibold text-stone-800">UGX {entry.amountUgx.toLocaleString()}</p>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={`text-sm font-black ${entry.deltaUgx >= 0 ? "text-amber-900" : "text-teal-800"}`}>
                      {entry.deltaUgx >= 0 ? "+" : ""}
                      UGX {entry.deltaUgx.toLocaleString()}
                    </p>
                    <p className="mt-0.5 text-[11px] font-bold text-stone-500">
                      {t(lang, "supplierStatementBalance")}: UGX {entry.runningBalanceUgx.toLocaleString()}
                    </p>
                  </div>
                </div>
              </li>
            ))}
            </ul>
          </HistoryListCard>
        )}
      </section>

      <section className="rounded-3xl border border-stone-200 bg-white p-5 shadow-waka-sm">
        <h2 className="text-lg font-black text-stone-900">{t(lang, "supplierPaymentHistory")}</h2>
        <p className="mt-1 text-sm font-semibold text-stone-600">
          {t(lang, "purchasesColTotal")}: UGX {sumSupplierPaymentsUgx(payments).toLocaleString()}
        </p>
        {payments.length === 0 ? (
          <p className="mt-3 text-sm text-stone-500">{t(lang, "supplierPaymentEmpty")}</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {payments.map((pay) => (
              <li key={pay.id} className="flex justify-between gap-3 rounded-2xl bg-stone-50 px-4 py-3">
                <div>
                  <p className="text-xs font-semibold text-stone-500">{dateKeyKampala(pay.createdAt)}</p>
                  <p className="text-xs font-semibold text-stone-600">
                    {t(lang, "supplierPaymentCreatedBy")}:{" "}
                    {supplierPaymentCreatedByLabel(
                      pay,
                      auditLogs.find(
                        (e) => e.action === "supplier_payment" && e.payload.paymentId === pay.id,
                      ) ?? null,
                    )}
                  </p>
                  {pay.paymentMethod ? (
                    <p className="text-xs text-stone-500">
                      {t(lang, "supplierPaymentMethod")}: {pay.paymentMethod}
                    </p>
                  ) : null}
                  {pay.reference ? (
                    <p className="text-xs text-stone-500">
                      {t(lang, "supplierPaymentReference")}: {pay.reference}
                    </p>
                  ) : null}
                </div>
                <p className="font-black text-teal-800">UGX {pay.amountUgx.toLocaleString()}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
