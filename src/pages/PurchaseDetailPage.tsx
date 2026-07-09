import { useMemo, useState } from "react";
import { actorHasPermission } from "../lib/actorAuthorization";
import { Link, Navigate, useParams } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { useSessionActor } from "../context/SessionActorContext";
import { PageHeader } from "../components/layout/PageHeader";
import {
  findPurchaseAudit,
  purchaseLineTotalUgx,
  purchaseQuantityReceivedForPurchase,
} from "../lib/purchaseReporting";
import { findPurchaseVoidAudit, isPurchaseVoided } from "../lib/purchaseCorrections";
import { dateKeyKampala } from "../lib/datesUg";
import { isWalkInSupplierId } from "../lib/walkInSupplier";

export function PurchaseDetailPage({
  lang,
  purchaseId: purchaseIdProp,
  embedded,
  onClose,
}: {
  lang: Language;
  purchaseId?: string;
  embedded?: boolean;
  onClose?: () => void;
}) {
  const { purchaseId: routePurchaseId } = useParams<{ purchaseId: string }>();
  const purchaseId = purchaseIdProp ?? routePurchaseId;
  const actor = useSessionActor();
  const canView = actorHasPermission(actor, "purchases.view");
  const canVoid = actorHasPermission(actor, "purchases.void");

  const purchases = usePosStore((s) => s.purchases);
  const products = usePosStore((s) => s.products);
  const stockMovements = usePosStore((s) => s.stockMovements);
  const auditLogs = usePosStore((s) => s.auditLogs);
  const voidPurchase = usePosStore((s) => s.voidPurchase);

  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [voidError, setVoidError] = useState<string | null>(null);

  const purchase = useMemo(
    () => purchases.find((p) => p.id === purchaseId) ?? null,
    [purchases, purchaseId],
  );

  const audit = useMemo(
    () => (purchase ? findPurchaseAudit(auditLogs, purchase.id) : null),
    [auditLogs, purchase],
  );

  const voidAudit = useMemo(
    () => (purchase ? findPurchaseVoidAudit(auditLogs, purchase.id) : null),
    [auditLogs, purchase],
  );

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  if (!canView) {
    return <Navigate to="/" replace />;
  }

  if (!purchase) {
    return (
      <div className="space-y-4 pb-12">
        {!embedded ? <PageHeader lang={lang} title={t(lang, "purchaseDetailTitle")} backFallback="/stock?tab=purchases" /> : null}
        <p className="text-stone-600">{t(lang, "purchaseNotFound")}</p>
      </div>
    );
  }

  const voided = isPurchaseVoided(purchase);
  const qtyReceived = purchaseQuantityReceivedForPurchase(purchase, stockMovements);
  const supplierLink = !isWalkInSupplierId(purchase.supplierId)
    ? `/stock?tab=suppliers&supplierId=${encodeURIComponent(purchase.supplierId)}`
    : null;

  const submitVoid = () => {
    setVoidError(null);
    const r = voidPurchase(purchase.id, voidReason);
    if (!r.ok) {
      setVoidError(r.errorKey ?? "invalid");
      return;
    }
    setVoidOpen(false);
    setVoidReason("");
  };

  return (
    <div className="space-y-5 pb-16">
      {!embedded ? (
        <PageHeader
          lang={lang}
          title={t(lang, "purchaseDetailTitle")}
          backFallback="/stock?tab=purchases"
          backLabel={t(lang, "purchasesTitle")}
        />
      ) : onClose ? (
        <button type="button" onClick={onClose} className="text-sm font-black text-waka-700">
          ← {t(lang, "purchasesTitle")}
        </button>
      ) : null}

      <section className="rounded-3xl border border-stone-200 bg-white p-5 shadow-waka-sm">
        <h2 className="text-sm font-black uppercase text-stone-500">{t(lang, "purchaseAuditMeta")}</h2>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="font-bold text-stone-600">{t(lang, "purchasesColSupplier")}</dt>
            <dd className="font-black text-stone-900">
              {supplierLink ? (
                <Link to={supplierLink} className="text-waka-700 underline">
                  {purchase.supplierName}
                </Link>
              ) : (
                purchase.supplierName
              )}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="font-bold text-stone-600">{t(lang, "purchasesColDate")}</dt>
            <dd className="font-black text-stone-900">{dateKeyKampala(purchase.createdAt)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="font-bold text-stone-600">{t(lang, "purchaseCreatedBy")}</dt>
            <dd className="font-black text-stone-900">{audit?.actorName ?? audit?.actorUserId ?? "—"}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="font-bold text-stone-600">Status</dt>
            <dd className={`font-black ${voided ? "text-rose-800" : "text-emerald-800"}`}>
              {voided ? t(lang, "purchaseStatusVoided") : t(lang, "purchaseStatusCompleted")}
            </dd>
          </div>
          {voided && purchase.voidReason ? (
            <div>
              <dt className="font-bold text-stone-600">{t(lang, "purchaseVoidReason")}</dt>
              <dd className="mt-1 font-medium text-stone-800">{purchase.voidReason}</dd>
            </div>
          ) : null}
          {voidAudit ? (
            <>
              <div className="flex justify-between gap-3">
                <dt className="font-bold text-stone-600">{t(lang, "purchaseVoidedBy")}</dt>
                <dd className="font-black text-stone-900">{voidAudit.actorName ?? voidAudit.actorUserId ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="font-bold text-stone-600">{t(lang, "purchaseVoidedAt")}</dt>
                <dd className="font-black text-stone-900">{dateKeyKampala(voidAudit.at)}</dd>
              </div>
            </>
          ) : null}
          {purchase.invoiceNumber ? (
            <div className="flex justify-between gap-3">
              <dt className="font-bold text-stone-600">{t(lang, "purchaseInvoiceNumber")}</dt>
              <dd className="font-black text-stone-900">{purchase.invoiceNumber}</dd>
            </div>
          ) : null}
          {purchase.notes ? (
            <div>
              <dt className="font-bold text-stone-600">{t(lang, "purchaseNotes")}</dt>
              <dd className="mt-1 font-medium text-stone-800">{purchase.notes}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section className="rounded-3xl border border-stone-200 bg-white p-5 shadow-waka-sm">
        <h2 className="text-lg font-black text-stone-900">{t(lang, "purchaseProductsReceived")}</h2>
        <p className="mt-1 text-xs font-semibold text-stone-500">
          {t(lang, "purchasesColQty")}: {qtyReceived.toLocaleString()}
        </p>
        <ul className="mt-4 space-y-2">
          {purchase.lines.map((line, idx) => {
            const product = productById.get(line.productId);
            const unit = product?.baseUnit ?? "";
            return (
              <li key={`${line.productId}-${idx}`} className="rounded-2xl bg-stone-50 px-4 py-3">
                <p className="font-bold text-stone-900">{line.name}</p>
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs font-semibold text-stone-600">
                  <span>
                    {t(lang, "purchaseLineQty")}: {line.qtyBuyingUnits} {unit}
                  </span>
                  <span>
                    {t(lang, "purchaseLineUnitCost")}: UGX {line.costPerBuyingUnitUgx.toLocaleString()}
                  </span>
                  <span className="text-right font-black text-stone-900">
                    UGX {purchaseLineTotalUgx(line).toLocaleString()}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="rounded-3xl border-2 border-waka-200 bg-waka-50/60 p-5">
        <h2 className="text-lg font-black text-waka-950">{t(lang, "purchaseFinancialSummary")}</h2>
        <dl className="mt-4 space-y-3">
          <div className="flex justify-between rounded-2xl bg-white px-4 py-3">
            <dt className="font-bold text-stone-700">{t(lang, "purchaseTotalCost")}</dt>
            <dd className="text-lg font-black">UGX {purchase.totalCostUgx.toLocaleString()}</dd>
          </div>
          <div className="flex justify-between rounded-2xl bg-white px-4 py-3">
            <dt className="font-bold text-stone-700">{t(lang, "purchaseAmountPaid")}</dt>
            <dd className="text-lg font-black text-teal-800">UGX {purchase.amountPaidUgx.toLocaleString()}</dd>
          </div>
          <div className="flex justify-between rounded-2xl bg-white px-4 py-3">
            <dt className="font-bold text-stone-700">{t(lang, "purchaseBalanceImpact")}</dt>
            <dd className={`text-lg font-black ${voided ? "text-stone-500 line-through" : "text-amber-900"}`}>
              {purchase.balanceDeltaUgx >= 0 ? "+" : ""}
              UGX {purchase.balanceDeltaUgx.toLocaleString()}
            </dd>
          </div>
        </dl>
        {audit ? (
          <p className="mt-4 text-xs font-medium text-stone-500">{audit.payloadSummary}</p>
        ) : null}
      </section>

      {canVoid && !voided ? (
        <section className="rounded-3xl border border-rose-200 bg-rose-50/50 p-5">
          {!voidOpen ? (
            <button
              type="button"
              onClick={() => setVoidOpen(true)}
              className="w-full rounded-2xl border-2 border-rose-300 bg-white py-3 text-sm font-black text-rose-900"
            >
              {t(lang, "purchaseVoidTitle")}
            </button>
          ) : (
            <div className="space-y-3">
              <h3 className="text-sm font-black text-rose-950">{t(lang, "purchaseVoidTitle")}</h3>
              <p className="text-xs font-semibold text-rose-800">{t(lang, "purchaseVoidHint")}</p>
              <label className="block text-xs font-bold text-stone-700">{t(lang, "purchaseVoidReason")}</label>
              <textarea
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                rows={3}
                className="w-full rounded-2xl border border-stone-200 px-3 py-2 text-sm"
              />
              {voidError ? (
                <p className="text-xs font-bold text-rose-800">{voidError}</p>
              ) : null}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setVoidOpen(false);
                    setVoidReason("");
                    setVoidError(null);
                  }}
                  className="flex-1 rounded-2xl border border-stone-200 bg-white py-3 text-sm font-bold text-stone-700"
                >
                  {t(lang, "pendingSalesCancel")}
                </button>
                <button
                  type="button"
                  onClick={submitVoid}
                  disabled={!voidReason.trim()}
                  className="flex-1 rounded-2xl bg-rose-700 py-3 text-sm font-black text-white disabled:opacity-50"
                >
                  {t(lang, "purchaseVoidConfirm")}
                </button>
              </div>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
