import { useEffect } from "react";
import { AdminShopProfileOverridePanel } from "../../../AdminShopProfileOverridePanel";
import { AdminShopInventoryPanel } from "../../../AdminShopInventoryPanel";
import { AdminCollapsible } from "../../../adminUi";
import { formatUgx } from "../../../../../lib/formatUgx";
import { AdminShopOpsLedgerPanel } from "../AdminShopOpsLedgerPanel";
import type { ShopConsoleState } from "../useShopConsoleState";

type Props = { ctx: ShopConsoleState };

function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB");
}

function fmtQty(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export function ShopConsoleBusinessTab({ ctx }: Props) {
  const {
    detail,
    perms,
    busy,
    previewMode,
    setBusy,
    setToast,
    loadShop,
    canSupport,
    saleReturns,
    saleVoids,
    cashExpenses,
    ensureOpsLedgers,
    loadMoreSaleReturns,
    loadMoreSaleVoids,
    loadMoreCashExpenses,
  } = ctx;

  useEffect(() => {
    if (!detail || !canSupport) return;
    void ensureOpsLedgers();
  }, [detail, canSupport, ensureOpsLedgers]);

  if (!detail) return null;

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <h2 className="text-sm font-black text-foreground">Business profile</h2>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between gap-2">
            <dt className="font-bold text-muted-foreground">District</dt>
            <dd className="font-semibold text-foreground">{detail.shop.district ?? "—"}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="font-bold text-muted-foreground">City</dt>
            <dd className="font-semibold text-foreground">{detail.shop.city ?? "—"}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="font-bold text-muted-foreground">Organization</dt>
            <dd className="font-mono text-xs text-muted-foreground">{detail.shop.organization_id}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="font-bold text-muted-foreground">Business type</dt>
            <dd className="font-semibold text-foreground">{detail.shop.business_type ?? "—"}</dd>
          </div>
        </dl>
      </div>

      {perms.canEditShopProfile ? (
        <AdminShopProfileOverridePanel
          detail={detail}
          busy={busy}
          previewMode={previewMode}
          onBusy={setBusy}
          onToast={setToast}
          onSaved={() => void loadShop()}
        />
      ) : null}

      {canSupport ? (
        <AdminCollapsible
          title="Shop products (cloud)"
          summary={`${detail.product_count} products · ${detail.sale_count_30d} sales (30d)`}
        >
          <AdminShopInventoryPanel
            products={detail.products_preview ?? []}
            productCountTable={detail.product_count_table ?? detail.product_count}
            productCountSnapshot={detail.product_count_snapshot ?? 0}
            salesInSnapshot={detail.sales_in_snapshot ?? 0}
            cloudSnapshotAt={detail.cloud_snapshot_at ?? null}
          />
        </AdminCollapsible>
      ) : null}

      {canSupport ? (
        <AdminCollapsible
          title="Returns"
          summary={
            saleReturns.loading
              ? "Loading…"
              : saleReturns.error
                ? "Could not load"
                : `${saleReturns.rows.length}${saleReturns.hasMore ? "+" : ""} loaded`
          }
        >
          <AdminShopOpsLedgerPanel
            loading={saleReturns.loading}
            loadingMore={saleReturns.loadingMore}
            error={saleReturns.error}
            emptyLabel="No returns in cloud for this shop."
            hasMore={saleReturns.hasMore}
            onLoadMore={() => void loadMoreSaleReturns()}
            rowCount={saleReturns.rows.length}
            table={
              <>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Product</th>
                    <th>Qty</th>
                    <th>Refund</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {saleReturns.rows.map((row) => (
                    <tr key={row.id}>
                      <td>{fmtWhen(row.created_at)}</td>
                      <td className="max-w-[180px] truncate" title={row.product_name ?? row.product_id ?? ""}>
                        {row.product_name ?? "—"}
                      </td>
                      <td>{fmtQty(row.quantity)}</td>
                      <td>{formatUgx(row.refund_amount_ugx)}</td>
                      <td>{row.reason || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </>
            }
          />
        </AdminCollapsible>
      ) : null}

      {canSupport ? (
        <AdminCollapsible
          title="Sale voids / refunds"
          summary={
            saleVoids.loading
              ? "Loading…"
              : saleVoids.error
                ? "Could not load"
                : `${saleVoids.rows.length}${saleVoids.hasMore ? "+" : ""} loaded`
          }
        >
          <AdminShopOpsLedgerPanel
            loading={saleVoids.loading}
            loadingMore={saleVoids.loadingMore}
            error={saleVoids.error}
            emptyLabel="No sale voids in cloud for this shop."
            hasMore={saleVoids.hasMore}
            onLoadMore={() => void loadMoreSaleVoids()}
            rowCount={saleVoids.rows.length}
            table={
              <>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Product</th>
                    <th>Qty</th>
                    <th>Amount</th>
                    <th>Line</th>
                  </tr>
                </thead>
                <tbody>
                  {saleVoids.rows.map((row) => (
                    <tr key={row.id}>
                      <td>{fmtWhen(row.created_at)}</td>
                      <td className="max-w-[180px] truncate" title={row.product_name ?? row.product_id ?? ""}>
                        {row.product_name ?? "—"}
                      </td>
                      <td>{fmtQty(row.quantity)}</td>
                      <td>{formatUgx(row.amount_ugx)}</td>
                      <td>{row.line_index}</td>
                    </tr>
                  ))}
                </tbody>
              </>
            }
          />
        </AdminCollapsible>
      ) : null}

      {canSupport ? (
        <AdminCollapsible
          title="Cash expenses"
          summary={
            cashExpenses.loading
              ? "Loading…"
              : cashExpenses.error
                ? "Could not load"
                : `${cashExpenses.rows.length}${cashExpenses.hasMore ? "+" : ""} loaded`
          }
        >
          <AdminShopOpsLedgerPanel
            loading={cashExpenses.loading}
            loadingMore={cashExpenses.loadingMore}
            error={cashExpenses.error}
            emptyLabel="No cash expenses in cloud for this shop."
            hasMore={cashExpenses.hasMore}
            onLoadMore={() => void loadMoreCashExpenses()}
            rowCount={cashExpenses.rows.length}
            table={
              <>
                <thead>
                  <tr>
                    <th>Paid on</th>
                    <th>Category</th>
                    <th>Amount</th>
                    <th>By</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {cashExpenses.rows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.paid_on || "—"}</td>
                      <td>{row.category || "—"}</td>
                      <td>{formatUgx(row.amount_ugx)}</td>
                      <td>{row.recorded_by_label ?? "—"}</td>
                      <td className="max-w-[180px] truncate" title={row.description ?? ""}>
                        {row.description ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </>
            }
          />
        </AdminCollapsible>
      ) : null}
    </div>
  );
}
