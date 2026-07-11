import { AdminShopProfileOverridePanel } from "../../../AdminShopProfileOverridePanel";
import { AdminShopInventoryPanel } from "../../../AdminShopInventoryPanel";
import { AdminCollapsible } from "../../../adminUi";
import type { ShopConsoleState } from "../useShopConsoleState";

type Props = { ctx: ShopConsoleState };

export function ShopConsoleBusinessTab({ ctx }: Props) {
  const { detail, perms, busy, previewMode, setBusy, setToast, loadShop, canSupport } = ctx;
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
    </div>
  );
}
