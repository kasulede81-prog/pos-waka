import { useMemo, useState, type FormEvent } from "react";
import { actorHasPermission } from "../lib/actorAuthorization";
import { Link, Navigate, useParams } from "react-router-dom";
import { ArrowDownLeft, ArrowUpRight, Scale, Wallet } from "lucide-react";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { useSessionActor } from "../context/SessionActorContext";
import { EnterprisePageContainer } from "../components/layout/EnterprisePageContainer";
import { EnterprisePageHeader } from "../components/enterprise/EnterprisePageHeader";
import { EnterpriseCard } from "../components/enterprise/EnterpriseCard";
import { EnterpriseKpiCard } from "../components/enterprise/EnterpriseKpiCard";
import { EnterpriseTextField } from "../components/enterprise/EnterpriseTextField";
import { EnterpriseEmptyState } from "../components/enterprise/EnterpriseEmptyState";
import { Caption, MonoNumber, SectionTitle } from "../components/enterprise/EnterpriseTypography";
import { WakaButton } from "../components/ui/wakaPrimitives";
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
  const canView = actorHasPermission(actor, "suppliers.view");
  const canManage = actorHasPermission(actor, "suppliers.manage");

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
    if (embedded) return <p className="text-sm text-muted-foreground">{t(lang, "suppliersEmpty")}</p>;
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

  const content = (
    <>
      {!embedded ? (
        <EnterprisePageHeader
          lang={lang}
          title={supplier.name}
          subtitle={t(lang, "supplierDetailTitle")}
          backFallback="/stock?tab=suppliers"
          backLabel={t(lang, "suppliersTitle")}
        />
      ) : onClose ? (
        <WakaButton type="button" variant="ghost" onClick={onClose} className="!px-0">
          ← {t(lang, "suppliersTitle")}
        </WakaButton>
      ) : null}

      <EnterpriseCard>
        {editSaved ? (
          <p className="mb-3 text-sm font-bold text-success-foreground">{t(lang, "supplierEditSave")}</p>
        ) : null}
        {canManage && !editOpen ? (
          <WakaButton type="button" variant="secondary" onClick={openEdit} className="mb-4 w-full">
            {t(lang, "supplierEditTitle")}
          </WakaButton>
        ) : null}
        {editOpen ? (
          <form onSubmit={submitEdit} className="mb-4 space-y-3 rounded-2xl border border-waka-200 bg-waka-50/40 p-4">
            <SectionTitle as="h3">{t(lang, "supplierEditTitle")}</SectionTitle>
            <EnterpriseTextField
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder={t(lang, "supplierNamePh")}
              required
            />
            <EnterpriseTextField
              value={editPhone}
              onChange={(e) => setEditPhone(e.target.value)}
              placeholder={t(lang, "supplierPhonePh")}
            />
            <EnterpriseTextField
              value={editLocation}
              onChange={(e) => setEditLocation(e.target.value)}
              placeholder={t(lang, "supplierLocationPh")}
            />
            <label className="block">
              <span className="text-sm font-bold text-foreground">{t(lang, "supplierNotesPh")}</span>
              <textarea
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                placeholder={t(lang, "supplierNotesPh")}
                rows={2}
                className="mt-1.5 w-full rounded-xl border border-border px-3 py-2 text-sm"
              />
            </label>
            <div className="flex gap-2">
              <WakaButton type="button" variant="secondary" className="flex-1" onClick={() => setEditOpen(false)}>
                {t(lang, "pendingSalesCancel")}
              </WakaButton>
              <WakaButton type="submit" className="flex-1">
                {t(lang, "supplierEditSave")}
              </WakaButton>
            </div>
          </form>
        ) : null}
        <dl className="space-y-2 text-sm">
          {supplier.phone ? (
            <div>
              <dt className="font-bold text-muted-foreground">Phone</dt>
              <dd className="font-semibold text-foreground">{supplier.phone}</dd>
            </div>
          ) : null}
          {supplier.location ? (
            <div>
              <dt className="font-bold text-muted-foreground">Location</dt>
              <dd className="font-semibold text-foreground">{supplier.location}</dd>
            </div>
          ) : null}
          {supplier.notes ? (
            <div>
              <dt className="font-bold text-muted-foreground">Notes</dt>
              <dd className="font-semibold text-foreground">{supplier.notes}</dd>
            </div>
          ) : null}
        </dl>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <EnterpriseKpiCard
            icon={Wallet}
            label={t(lang, "supplierBalanceLabel")}
            value={`UGX ${supplier.balanceOwedUgx.toLocaleString()}`}
            tone={supplier.balanceOwedUgx > 0 ? "warning" : "default"}
          />
          <EnterpriseKpiCard
            icon={ArrowUpRight}
            label={t(lang, "supplierTotalBuy")}
            value={`UGX ${supplier.totalPurchasesUgx.toLocaleString()}`}
          />
          {supplier.lastSupplyAt ? (
            <div className="col-span-2">
              <EnterpriseKpiCard
                icon={Scale}
                label={t(lang, "supplierLastSupply")}
                value={dateKeyKampala(supplier.lastSupplyAt)}
              />
            </div>
          ) : null}
        </div>
      </EnterpriseCard>

      <EnterpriseCard
        title={t(lang, "supplierStatementTitle")}
        actions={
          <div className="flex flex-wrap gap-2">
            <WakaButton type="button" disabled={exportBusy || filteredStatement.length === 0} onClick={() => void runPrint()}>
              {receiptPrintActionLabel(lang)}
            </WakaButton>
            <WakaButton type="button" variant="secondary" disabled={exportBusy || filteredStatement.length === 0} onClick={() => void runExport("csv")}>
              {t(lang, "purchasesExportCsv")}
            </WakaButton>
            <WakaButton type="button" disabled={exportBusy || filteredStatement.length === 0} onClick={() => void runExport("pdf")}>
              {t(lang, "purchasesExportPdf")}
            </WakaButton>
          </div>
        }
      >
        {exportHint ? <p className="text-sm font-bold text-success-foreground">{exportHint}</p> : null}
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
          <EnterpriseEmptyState
            icon={Scale}
            title={t(lang, "purchasesEmpty")}
            className="mt-4 !border-0 !bg-transparent !p-0 !shadow-none"
          />
        ) : (
          <HistoryListCard className="mt-4">
            <ul>
            {filteredStatement.map((entry) => (
              <li key={`${entry.kind}-${entry.id}`} className="border-b border-border last:border-b-0">
                <div className="flex items-start justify-between gap-3 px-3 py-3 sm:px-4">
                  <div className="min-w-0 flex-1">
                    <Caption>{entry.dayKey}</Caption>
                    <p className="mt-0.5 text-sm font-black text-foreground">
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
                      <p className="text-xs font-semibold text-foreground">UGX {entry.amountUgx.toLocaleString()}</p>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <MonoNumber className={entry.deltaUgx >= 0 ? "text-warning-foreground" : "text-success-foreground"}>
                      {entry.deltaUgx >= 0 ? "+" : ""}
                      UGX {entry.deltaUgx.toLocaleString()}
                    </MonoNumber>
                    <Caption className="mt-0.5">
                      {t(lang, "supplierStatementBalance")}: UGX {entry.runningBalanceUgx.toLocaleString()}
                    </Caption>
                  </div>
                </div>
              </li>
            ))}
            </ul>
          </HistoryListCard>
        )}
      </EnterpriseCard>

      <EnterpriseCard title={t(lang, "supplierPaymentHistory")} subtitle={`${t(lang, "purchasesColTotal")}: UGX ${sumSupplierPaymentsUgx(payments).toLocaleString()}`}>
        {payments.length === 0 ? (
          <EnterpriseEmptyState
            icon={ArrowDownLeft}
            title={t(lang, "supplierPaymentEmpty")}
            className="mt-3 !border-0 !bg-transparent !p-0 !shadow-none"
          />
        ) : (
          <ul className="mt-4 space-y-2">
            {payments.map((pay) => (
              <li key={pay.id} className="flex justify-between gap-3 rounded-2xl bg-muted px-4 py-3">
                <div>
                  <Caption>{dateKeyKampala(pay.createdAt)}</Caption>
                  <Caption className="mt-0.5">
                    {t(lang, "supplierPaymentCreatedBy")}:{" "}
                    {supplierPaymentCreatedByLabel(
                      pay,
                      auditLogs.find(
                        (e) => e.action === "supplier_payment" && e.payload.paymentId === pay.id,
                      ) ?? null,
                    )}
                  </Caption>
                  {pay.paymentMethod ? (
                    <Caption>{t(lang, "supplierPaymentMethod")}: {pay.paymentMethod}</Caption>
                  ) : null}
                  {pay.reference ? (
                    <Caption>{t(lang, "supplierPaymentReference")}: {pay.reference}</Caption>
                  ) : null}
                </div>
                <MonoNumber className="text-success-foreground">UGX {pay.amountUgx.toLocaleString()}</MonoNumber>
              </li>
            ))}
          </ul>
        )}
      </EnterpriseCard>
    </>
  );

  if (embedded) {
    return <div className="space-y-5 pb-16">{content}</div>;
  }

  return (
    <EnterprisePageContainer className="space-y-5 pb-16">
      {content}
    </EnterprisePageContainer>
  );
}
