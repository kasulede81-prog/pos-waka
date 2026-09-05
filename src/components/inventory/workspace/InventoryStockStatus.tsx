import { AlertTriangle, PackageX } from "lucide-react";
import clsx from "clsx";
import type { Product } from "../../../types";
import { formatStockLabel, isLowStock } from "../../../lib/sellingEngine";
import { formatPharmacyStockPrimary, isPharmacyPackagingActive } from "../../../lib/pharmacyPackaging";

export type InventoryStockKind = "ok" | "low" | "out";

export function inventoryStockKind(product: Product): InventoryStockKind {
  if (product.stockOnHand <= 0) return "out";
  if (isLowStock(product)) return "low";
  return "ok";
}

export function InventoryStockStatus({ product, className }: { product: Product; className?: string }) {
  const kind = inventoryStockKind(product);
  const label = isPharmacyPackagingActive(product)
    ? formatPharmacyStockPrimary(product)
    : formatStockLabel(product);

  return (
    <span className={clsx("inventory-stock-status", `inventory-stock-status--${kind}`, className)}>
      {kind === "ok" ? <span className="inventory-stock-status__dot" aria-hidden /> : null}
      {kind === "low" ? <AlertTriangle className="inventory-stock-status__icon" aria-hidden /> : null}
      {kind === "out" ? <PackageX className="inventory-stock-status__icon" aria-hidden /> : null}
      <span className="inventory-stock-status__qty">{label}</span>
    </span>
  );
}
