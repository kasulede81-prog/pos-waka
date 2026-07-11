import { useMemo, useState } from "react";
import { actorHasEffectivePermission } from "../lib/actorAuthorization";
import { Link } from "react-router-dom";
import type { Language } from "../types";
import { t, tTemplate } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { isPharmacyMode } from "../lib/pharmacy";
import { groupExpiryRowsByBucket } from "../lib/pharmacyInventoryReports";
import { formatUgx } from "../lib/formatUgx";
import { EnterprisePageContainer } from "../components/layout/EnterprisePageContainer";
import { formatMedicineFullLabel } from "../lib/pharmacyMedicine";
import { useSessionActor } from "../context/SessionActorContext";
import { useSubscription } from "../context/SubscriptionContext";

import { buildExpiryCenterRows } from "../lib/pharmacyBatches";
import { AdjustmentConfirmDialog } from "../components/inventory/adjustments/AdjustmentConfirmDialog";
import { AdjustmentMovementPreview } from "../components/inventory/adjustments/AdjustmentMovementPreview";
import { WakaSwitch } from "../components/enterprise/WakaSwitch";
import { EnterpriseEmptyState } from "../components/enterprise/EnterpriseEmptyState";
import { Pill } from "lucide-react";

const BUCKETS = ["expired", "today", "d7", "d30", "d60", "d90"] as const;

const BUCKET_LABEL: Record<(typeof BUCKETS)[number], string> = {
  expired: "pharmacyExpiryExpired",
  today: "pharmacyExpiryToday",
  d7: "pharmacyExpiry7",
  d30: "pharmacyExpiry30",
  d60: "pharmacyExpiry60",
  d90: "pharmacyExpiry90",
};

export function PharmacyExpiryCenterPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const { snapshot, authMode } = useSubscription();
  const preferences = usePosStore((s) => s.preferences);
  const products = usePosStore((s) => s.products);
  const writeOffExpiredStock = usePosStore((s) => s.writeOffExpiredStock);
  const pharmacySupplierReturn = usePosStore((s) => s.pharmacySupplierReturn);
  const [activeBucket, setActiveBucket] = useState<(typeof BUCKETS)[number]>("expired");
  const [toast, setToast] = useState<string | null>(null);
  const [supplierFilter, setSupplierFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [manufacturerFilter, setManufacturerFilter] = useState("");
  const [controlledOnly, setControlledOnly] = useState(false);
  const [pendingAction, setPendingAction] = useState<{
    kind: "writeoff" | "return";
    productId: string;
    batchId: string;
    qty: number;
    productName: string;
    batchNumber: string;
    currentStock: number;
    unit: string;
  } | null>(null);

  const pharmacy = isPharmacyMode(preferences.businessType, preferences.pharmacyModeEnabled);
  const canWriteOff = actorHasEffectivePermission(actor, "pharmacy.expired_writeoff", snapshot, authMode);
  const canReturn = actorHasEffectivePermission(actor, "purchases.record", snapshot, authMode);

  const grouped = useMemo(() => groupExpiryRowsByBucket(products), [products]);
  const allRows = useMemo(() => buildExpiryCenterRows(products), [products]);

  const filterOptions = useMemo(() => {
    const suppliers = new Set<string>();
    const categories = new Set<string>();
    const manufacturers = new Set<string>();
    for (const row of allRows) {
      if (row.supplierName) suppliers.add(row.supplierName);
      const p = products.find((x) => x.id === row.productId);
      if (p?.category) categories.add(p.category);
      if (p?.pharmacyMaster?.medicineCategory) categories.add(p.pharmacyMaster.medicineCategory);
      if (p?.pharmacyMaster?.manufacturer) manufacturers.add(p.pharmacyMaster.manufacturer);
    }
    return {
      suppliers: [...suppliers].sort(),
      categories: [...categories].sort(),
      manufacturers: [...manufacturers].sort(),
    };
  }, [allRows, products]);

  const rows = useMemo(() => {
    let list = grouped[activeBucket] ?? [];
    if (supplierFilter) list = list.filter((r) => r.supplierName === supplierFilter);
    if (categoryFilter) {
      list = list.filter((r) => {
        const p = products.find((x) => x.id === r.productId);
        return p?.category === categoryFilter || p?.pharmacyMaster?.medicineCategory === categoryFilter;
      });
    }
    if (manufacturerFilter) {
      list = list.filter((r) => products.find((x) => x.id === r.productId)?.pharmacyMaster?.manufacturer === manufacturerFilter);
    }
    if (controlledOnly) {
      list = list.filter((r) => products.find((x) => x.id === r.productId)?.pharmacyMaster?.controlledDrug);
    }
    return list;
  }, [grouped, activeBucket, supplierFilter, categoryFilter, manufacturerFilter, controlledOnly, products]);

  const totalValue = rows.reduce((s, r) => s + r.valueUgx, 0);
  const totalQty = rows.reduce((s, r) => s + r.quantity, 0);

  const exportCsv = () => {
    const header = "Product,Batch,Expiry,Qty,Value,Supplier\n";
    const body = rows
      .map((r) => {
        const name = products.find((p) => p.id === r.productId)?.name ?? r.productName;
        return `"${name}","${r.batchNumber}","${r.expiryDate}",${r.quantity},${r.valueUgx},"${r.supplierName ?? ""}"`;
      })
      .join("\n");
    const blob = new Blob([header + body], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `expiry-${activeBucket}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!pharmacy) return null;

  const handleWriteOff = (productId: string, batchId: string, qty: number) => {
    const r = writeOffExpiredStock({ productId, quantity: qty, reason: "expired", batchId });
    setPendingAction(null);
    setToast(r.ok ? t(lang, "pharmacyWriteOffCta") + " ✓" : t(lang, r.errorKey ?? "invalid"));
    window.setTimeout(() => setToast(null), 2500);
  };

  const handleReturn = (productId: string, batchId: string, qty: number) => {
    const r = pharmacySupplierReturn({ productId, batchId, quantity: qty, reason: "near_expiry_return" });
    setPendingAction(null);
    setToast(r.ok ? t(lang, "pharmacyReturnSupplier") + " ✓" : t(lang, r.errorKey ?? "invalid"));
    window.setTimeout(() => setToast(null), 2500);
  };

  const queueWriteOff = (row: (typeof rows)[number]) => {
    const p = products.find((x) => x.id === row.productId);
    setPendingAction({
      kind: "writeoff",
      productId: row.productId,
      batchId: row.batchId,
      qty: row.quantity,
      productName: p ? formatMedicineFullLabel(p) : row.productName,
      batchNumber: row.batchNumber,
      currentStock: p?.stockOnHand ?? row.quantity,
      unit: p?.baseUnit ?? "",
    });
  };

  const queueReturn = (row: (typeof rows)[number]) => {
    const p = products.find((x) => x.id === row.productId);
    setPendingAction({
      kind: "return",
      productId: row.productId,
      batchId: row.batchId,
      qty: row.quantity,
      productName: p ? formatMedicineFullLabel(p) : row.productName,
      batchNumber: row.batchNumber,
      currentStock: p?.stockOnHand ?? row.quantity,
      unit: p?.baseUnit ?? "",
    });
  };

  return (
    <EnterprisePageContainer>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-foreground">{t(lang, "pharmacyExpiryCenterTitle")}</h1>
          <p className="mt-1 text-base font-medium text-muted-foreground">{t(lang, "pharmacyExpiryCenterSub")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex min-h-[48px] items-center rounded-2xl border border-border bg-card px-4 text-sm font-black text-foreground touch-manipulation"
          >
            {t(lang, "pharmacyExpiryPrint")}
          </button>
          <button
            type="button"
            onClick={exportCsv}
            className="inline-flex min-h-[48px] items-center rounded-2xl border border-teal-200 bg-teal-50 px-4 text-sm font-black text-teal-950 touch-manipulation"
          >
            {t(lang, "pharmacyExpiryExport")}
          </button>
          <Link
            to="/pharmacy/reports/inventory"
            className="inline-flex min-h-[48px] items-center rounded-2xl border border-teal-200 bg-teal-50 px-4 text-sm font-black text-teal-950 touch-manipulation"
          >
            {t(lang, "pharmacyInventoryReports")}
          </Link>
        </div>
      </div>

      {toast ? (
        <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-950">{toast}</p>
      ) : null}

      <div className="grid gap-3 rounded-2xl border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
        <FilterSelect
          label={t(lang, "pharmacyExpiryFilterSupplier")}
          value={supplierFilter}
          onChange={setSupplierFilter}
          options={filterOptions.suppliers}
        />
        <FilterSelect
          label={t(lang, "pharmacyExpiryFilterCategory")}
          value={categoryFilter}
          onChange={setCategoryFilter}
          options={filterOptions.categories}
        />
        <FilterSelect
          label={t(lang, "pharmacyExpiryFilterManufacturer")}
          value={manufacturerFilter}
          onChange={setManufacturerFilter}
          options={filterOptions.manufacturers}
        />
        <div className="rounded-2xl border border-border px-4 touch-manipulation">
          <WakaSwitch
            checked={controlledOnly}
            onCheckedChange={setControlledOnly}
            label={t(lang, "pharmacyExpiryFilterControlled")}
          />
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {BUCKETS.map((bucket) => {
          const count = grouped[bucket]?.length ?? 0;
          return (
            <button
              key={bucket}
              type="button"
              onClick={() => setActiveBucket(bucket)}
              className={`inline-flex min-h-[48px] shrink-0 flex-col items-center justify-center rounded-2xl border px-4 py-2 text-sm font-black touch-manipulation ${
                activeBucket === bucket
                  ? bucket === "expired"
                    ? "border-rose-400 bg-rose-600 text-white"
                    : "border-teal-400 bg-teal-600 text-white"
                  : "border-border bg-card text-foreground"
              }`}
            >
              <span>{t(lang, BUCKET_LABEL[bucket])}</span>
              <span className="text-xs opacity-80">{count}</span>
            </button>
          );
        })}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-xs font-black uppercase text-muted-foreground">{t(lang, "pharmacyExpiryQty")}</p>
          <p className="mt-1 text-3xl font-black text-foreground">{totalQty}</p>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-xs font-black uppercase text-amber-800">{t(lang, "pharmacyExpiryValue")}</p>
          <p className="mt-1 text-3xl font-black text-amber-950">{formatUgx(totalValue)}</p>
        </div>
      </div>

      {rows.length === 0 ? (
        <EnterpriseEmptyState icon={Pill} title={t(lang, "pharmacyExpiryEmpty")} />
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li
              key={`${row.productId}-${row.batchId}`}
              className="rounded-3xl border border-border bg-card p-4 shadow-waka-sm touch-manipulation"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-lg font-black text-foreground">
                    {products.find((p) => p.id === row.productId)
                      ? formatMedicineFullLabel(products.find((p) => p.id === row.productId)!)
                      : row.productName}
                  </p>
                  <p className="text-sm font-semibold text-muted-foreground">
                    {t(lang, "pharmacyBatchNumber")}: {row.batchNumber} · {row.expiryDate}
                  </p>
                  <p className="text-xs font-medium text-muted-foreground">
                    {row.quantity} {t(lang, "pharmacyTerm_medicine").toLowerCase()} · {formatUgx(row.valueUgx)}
                    {row.supplierName ? ` · ${row.supplierName}` : ""}
                    {row.location ? ` · ${row.location}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {canReturn ? (
                    <button
                      type="button"
                      onClick={() => {
                        window.location.assign(`/pharmacy/inventory?productId=${row.productId}&receive=1`);
                      }}
                      className="min-h-[48px] rounded-2xl border border-teal-200 bg-teal-50 px-4 text-sm font-black text-teal-900 touch-manipulation"
                    >
                      {t(lang, "pharmacyReceiveReplacement")}
                    </button>
                  ) : null}
                  {canWriteOff && (activeBucket === "expired" || activeBucket === "today") ? (
                    <button
                      type="button"
                      onClick={() => queueWriteOff(row)}
                      className="min-h-[48px] rounded-2xl bg-rose-700 px-4 text-sm font-black text-white touch-manipulation"
                    >
                      {t(lang, "pharmacyWriteOffCta")}
                    </button>
                  ) : null}
                  {canReturn ? (
                    <button
                      type="button"
                      onClick={() => queueReturn(row)}
                      className="min-h-[48px] rounded-2xl border border-border bg-card px-4 text-sm font-black text-foreground touch-manipulation"
                    >
                      {t(lang, "pharmacyReturnSupplier")}
                    </button>
                  ) : null}
                  <Link
                    to={`/pharmacy/inventory?productId=${row.productId}`}
                    className="inline-flex min-h-[48px] items-center rounded-2xl border border-teal-200 bg-teal-50 px-4 text-sm font-black text-teal-900 touch-manipulation"
                  >
                    {t(lang, "pharmacyViewMedicine")}
                  </Link>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {pendingAction ? (
        <AdjustmentConfirmDialog
          lang={lang}
          open
          danger={pendingAction.kind === "writeoff"}
          title={
            pendingAction.kind === "writeoff"
              ? t(lang, "pharmacyWriteOffConfirmTitle")
              : t(lang, "adjConfirmSupplierReturnTitle")
          }
          confirmLabelKey={
            pendingAction.kind === "writeoff" ? "pharmacyWriteOffCta" : "pharmacyReturnSupplier"
          }
          onCancel={() => setPendingAction(null)}
          onConfirm={() => {
            if (pendingAction.kind === "writeoff") {
              handleWriteOff(pendingAction.productId, pendingAction.batchId, pendingAction.qty);
            } else {
              handleReturn(pendingAction.productId, pendingAction.batchId, pendingAction.qty);
            }
          }}
          body={
            <p>
              {tTemplate(lang, pendingAction.kind === "writeoff" ? "adjConfirmWriteOffBody" : "adjConfirmReturnBody", {
                name: pendingAction.productName,
                batch: pendingAction.batchNumber,
                qty: String(pendingAction.qty),
                unit: pendingAction.unit,
              })}
            </p>
          }
        >
          <div className="mt-4">
            <AdjustmentMovementPreview
              lang={lang}
              mode="return"
              currentStock={pendingAction.currentStock}
              adjustment={-pendingAction.qty}
              unitLabel={pendingAction.unit}
            />
          </div>
        </AdjustmentConfirmDialog>
      ) : null}
    </EnterprisePageContainer>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <label className="block text-sm font-bold text-muted-foreground">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 min-h-[48px] w-full rounded-2xl border-2 border-border px-3 text-base font-semibold touch-manipulation"
      >
        <option value="">—</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}
