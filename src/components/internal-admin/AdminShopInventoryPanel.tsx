import type { AdminShopProductRow } from "../../lib/wakaInternalAdmin";

type Props = {
  products: AdminShopProductRow[];
  productCountTable: number;
  productCountSnapshot: number;
  salesInSnapshot: number;
  cloudSnapshotAt: string | null;
  loading?: boolean;
};

export function AdminShopInventoryPanel({
  products,
  productCountTable,
  productCountSnapshot,
  salesInSnapshot,
  cloudSnapshotAt,
  loading,
}: Props) {
  if (loading) {
    return <p className="text-sm font-semibold text-stone-500">Loading inventory…</p>;
  }

  const onlyOnPhone = productCountSnapshot > productCountTable && productCountTable === 0;

  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-xl bg-stone-50 px-3 py-2">
          <dt className="font-bold text-stone-500">In cloud (products table)</dt>
          <dd className="font-mono text-lg font-black text-stone-900">{productCountTable}</dd>
        </div>
        <div className="rounded-xl bg-orange-50 px-3 py-2">
          <dt className="font-bold text-orange-800">In cloud backup</dt>
          <dd className="font-mono text-lg font-black text-orange-950">{productCountSnapshot}</dd>
        </div>
      </dl>

      {onlyOnPhone ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-950">
          Products exist in the phone backup but not in live cloud tables yet. Ask the owner to open Waka online
          for a few minutes so sync finishes.
        </p>
      ) : null}

      {cloudSnapshotAt ? (
        <p className="text-[11px] font-medium text-stone-600">
          Last cloud backup: {new Date(cloudSnapshotAt).toLocaleString("en-GB")}
          {salesInSnapshot > 0 ? ` · ${salesInSnapshot.toLocaleString()} sales in backup` : null}
        </p>
      ) : (
        <p className="text-[11px] font-medium text-stone-500">No cloud backup snapshot on file yet.</p>
      )}

      {products.length === 0 ? (
        <p className="text-sm font-semibold text-stone-500">No products in cloud for this shop.</p>
      ) : (
        <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
          {products.map((p) => (
            <li key={p.id} className="rounded-xl border border-stone-100 bg-stone-50/80 px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-black text-stone-900">{p.name}</p>
                  <p className="text-[10px] font-semibold text-stone-500">
                    {[p.category, p.is_active ? null : "inactive"].filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs font-black text-stone-900">
                    {p.selling_price_ugx != null ? `UGX ${p.selling_price_ugx.toLocaleString("en-UG")}` : "—"}
                  </p>
                  <p className="text-[10px] font-bold text-stone-500">Stock {p.stock_quantity ?? 0}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
