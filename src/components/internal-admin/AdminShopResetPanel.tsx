import { useState } from "react";
import type { ShopOpsDetail } from "../../lib/wakaInternalAdmin";
import {
  adminPreviewShopReset,
  adminResetShopBusinessData,
  isShopResetVerified,
  type AdminShopResetExecuteResult,
  type ShopResetCounts,
} from "../../lib/adminShopDataReset";
import { formatWakaShopNumber } from "../../lib/shopNumber";
import { WakaCheckbox } from "../enterprise/WakaCheckbox";

type Props = {
  detail: ShopOpsDetail;
  busy: boolean;
  previewMode: boolean;
  onBusy: (busy: boolean) => void;
  onToast: (toast: { kind: "ok" | "err"; text: string }) => void;
};

const COUNT_LABELS: Record<keyof ShopResetCounts, string> = {
  loyalty_redemptions: "Loyalty redemptions",
  loyalty_transactions: "Loyalty transactions",
  loyalty_accounts: "Loyalty accounts",
  financial_correction_requests: "Financial correction requests",
  sale_line_item_corrections: "Sale line corrections",
  kitchen_ticket_items: "Kitchen ticket items",
  kitchen_tickets: "Kitchen tickets",
  table_session_events: "Table session events",
  waitlist_entries: "Waitlist entries",
  table_reservations: "Table reservations",
  table_sessions: "Table sessions",
  sale_line_items: "Sale line items",
  sale_payments: "Payments",
  receipts: "Receipts",
  sale_voids: "Sale voids",
  sale_returns: "Sale returns",
  customer_debt_payments: "Customer debt payments",
  sales: "Sales",
  inventory_movements: "Inventory movements",
  shop_stock_movements: "Stock movement ledger",
  shop_cash_drawer_adjustments: "Cash drawer adjustments",
  shop_inventory_count_sessions: "Inventory count sessions",
  shop_supplier_payments: "Supplier payments",
  shop_purchases: "Purchases",
  expenses: "Expenses",
  shop_suppliers: "Suppliers",
  print_jobs: "Print jobs",
  barcode_labels: "Barcode labels",
  products: "Products",
  customers: "Customers",
  ai_generation_usage_log: "AI usage log entries",
  shop_day_closes: "Day closes",
  shop_day_drawer_opens: "Drawer opens",
  shop_shifts: "Shifts",
  shop_activity: "Shop activity feed",
  shop_cloud_snapshots: "Stale cloud snapshot",
  audit_logs: "Shop audit log entries",
};

function CountsTable({ counts }: { counts: ShopResetCounts }) {
  const nonZero = (Object.keys(counts) as (keyof ShopResetCounts)[]).filter((k) => counts[k] > 0);
  if (nonZero.length === 0) {
    return <p className="mt-2 text-xs font-semibold text-rose-900">Nothing to reset — all counts are already 0.</p>;
  }
  return (
    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg bg-white/60 p-2">
      {nonZero.map((k) => (
        <div key={k} className="flex items-center justify-between text-xs">
          <dt className="font-medium text-rose-900">{COUNT_LABELS[k]}</dt>
          <dd className="font-mono font-bold text-rose-950">{counts[k].toLocaleString()}</dd>
        </div>
      ))}
    </dl>
  );
}

export function AdminShopResetPanel({ detail, busy, previewMode, onBusy, onToast }: Props) {
  const [confirmText, setConfirmText] = useState("");
  const [ack, setAck] = useState(false);
  const [previewCounts, setPreviewCounts] = useState<ShopResetCounts | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [result, setResult] = useState<AdminShopResetExecuteResult | null>(null);
  const shopName = detail.shop.name;

  const runPreview = async () => {
    if (previewMode) {
      onToast({ kind: "err", text: "Preview mode — action blocked." });
      return;
    }
    setPreviewing(true);
    setResult(null);
    const r = await adminPreviewShopReset(detail.shop.id);
    setPreviewing(false);
    if (!r.ok) {
      onToast({ kind: "err", text: r.message });
      return;
    }
    setPreviewCounts(r.counts);
  };

  const runReset = async () => {
    if (previewMode) {
      onToast({ kind: "err", text: "Preview mode — action blocked." });
      return;
    }
    if (!previewCounts) {
      onToast({ kind: "err", text: "Preview the reset first so you can see exactly what will be removed." });
      return;
    }
    if (!ack) {
      onToast({ kind: "err", text: "Check the box to confirm you understand this cannot be undone." });
      return;
    }
    const typed = confirmText.trim();
    if (typed.toUpperCase() !== "RESET SHOP") {
      onToast({ kind: "err", text: "Type RESET SHOP (exactly) to confirm." });
      return;
    }
    if (
      !window.confirm(
        `FINAL WARNING: Reset all business data for "${shopName}"?\n\nProducts, sales, inventory movements, and other transactional data will be permanently removed. The shop, owner login, and configuration are kept. This cannot be undone.`,
      )
    ) {
      return;
    }

    onBusy(true);
    const r = await adminResetShopBusinessData(detail.shop.id, typed);
    onBusy(false);
    setResult(r);

    if (r.ok) {
      onToast({ kind: "ok", text: `Shop business data reset for "${r.shopName}".` });
      setPreviewCounts(null);
      setConfirmText("");
      setAck(false);
    } else {
      onToast({ kind: "err", text: r.message });
    }
  };

  return (
    <section className="rounded-2xl border-2 border-rose-400 bg-rose-50 p-4 shadow-sm">
      <p className="text-[10px] font-black uppercase tracking-wide text-rose-800">Danger zone</p>
      <h2 className="mt-0.5 text-base font-black text-rose-950">Reset shop business data</h2>
      <p className="mt-1 text-xs font-medium text-rose-900">
        Removes products, sales, inventory movements, and other transactional/test data for this shop only. The
        shop, organization, owner login, devices, and configuration (AI settings, subscription, etc.) are kept.
        Internal WAKA admin only. Cannot be recovered.
      </p>
      <p className="mt-2 font-mono text-[11px] text-rose-800">
        Shop no. {formatWakaShopNumber(detail.shop.shop_number) ?? "—"} · ID {detail.shop.id}
      </p>

      <button
        type="button"
        disabled={busy || previewing}
        onClick={() => void runPreview()}
        className="mt-3 min-h-[44px] w-full rounded-xl border-2 border-rose-400 bg-white px-4 text-sm font-black text-rose-900 disabled:opacity-40"
      >
        {previewing ? "Loading preview…" : "Preview what will be removed"}
      </button>

      {previewCounts ? <CountsTable counts={previewCounts} /> : null}

      {previewCounts ? (
        <>
          <WakaCheckbox
            checked={ack}
            onCheckedChange={setAck}
            label="I understand this permanently removes this shop's business data and cannot be undone."
            className="mt-3 text-xs font-semibold text-rose-950"
          />

          <label className="mt-2 block text-xs font-bold text-rose-950">
            Type <span className="font-mono">RESET SHOP</span> to confirm
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              className="mt-1 w-full rounded-lg border border-rose-300 bg-card px-3 py-2 text-sm"
              autoComplete="off"
            />
          </label>

          <button
            type="button"
            disabled={busy}
            onClick={() => void runReset()}
            className="mt-3 min-h-[48px] w-full rounded-xl bg-rose-700 px-4 text-sm font-black text-white disabled:opacity-40"
          >
            {busy ? "Resetting…" : "Reset shop business data"}
          </button>
        </>
      ) : null}

      {result?.ok ? (
        <div className="mt-3 rounded-xl border border-emerald-300 bg-emerald-50 p-3">
          <p className="text-xs font-black uppercase tracking-wide text-emerald-800">Reset complete</p>
          <CountsTable counts={result.deleted} />
          <p className="mt-2 text-xs font-bold text-emerald-900">
            Verification: {isShopResetVerified(result.verification) ? "✓ all counts confirmed at 0" : "⚠ some counts are not 0 — see below"}
          </p>
          {!isShopResetVerified(result.verification) ? <CountsTable counts={result.verification} /> : null}
        </div>
      ) : null}
    </section>
  );
}
