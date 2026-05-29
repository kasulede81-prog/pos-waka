import type { Product, SaleLine } from "../types";

const QTY_EPS = 0.012;

const UNIT_FRACTIONS = [
  { value: 0.25, short: "¼", words: "Quarter" },
  { value: 0.5, short: "½", words: "Half" },
  { value: 0.75, short: "¾", words: "Three-quarter" },
] as const;

function near(a: number, b: number, eps = QTY_EPS): boolean {
  return Math.abs(a - b) < eps;
}

function capitalizeUnit(unit: string): string {
  const u = unit.trim() || "item";
  return u.length <= 3 ? u : u.charAt(0).toUpperCase() + u.slice(1);
}

/**
 * Human-readable amount for shelf units (kg, bottle, …).
 * Uses Quarter/Half/Three-quarter kg on receipts; ¼/½/¾ in compact UI.
 */
export function formatFriendlyQuantity(
  qty: number,
  baseUnit: string,
  style: "short" | "receipt" = "short",
): string {
  const unit = baseUnit.trim() || "item";
  const unitShown = style === "receipt" ? capitalizeUnit(unit) : unit;

  if (qty <= 0) return `0 ${unitShown}`;

  const whole = Math.floor(qty + QTY_EPS);
  const frac = Math.round((qty - whole) * 10000) / 10000;

  if (near(frac, 0) || frac < QTY_EPS) {
    const n = whole || Math.round(qty);
    return n === 1 ? `1 ${unitShown}` : `${n} ${unitShown}`;
  }

  for (const f of UNIT_FRACTIONS) {
    if (near(frac, f.value)) {
      if (whole > 0) {
        const mixed = style === "receipt" ? `${whole} ${f.words} ${unitShown}` : `${whole}${f.short} ${unitShown}`;
        return mixed;
      }
      return style === "receipt" ? `${f.words} ${unitShown}` : `${f.short} ${unitShown}`;
    }
  }

  if (near(qty, 1)) return `1 ${unitShown}`;

  for (const f of UNIT_FRACTIONS) {
    if (near(qty, f.value)) {
      return style === "receipt" ? `${f.words} ${unitShown}` : `${f.short} ${unitShown}`;
    }
  }

  const shown = Number.isInteger(qty) ? String(qty) : qty.toFixed(2).replace(/\.?0+$/, "");
  return `${shown} ${unitShown}`;
}

export type ReceiptLineQuantityDisplay = {
  quantityLabel: string;
  showCalculation: boolean;
};

/** Quantity text for receipts (custom UGX amounts → Half kg — UGX 1,750). */
export function buildReceiptLineQuantityDisplay(
  line: SaleLine,
  product?: Product,
): ReceiptLineQuantityDisplay {
  const baseUnit = product?.baseUnit?.trim() || "item";
  const buyingUnit = product?.buyingUnit?.trim();
  const conversionRate = Math.max(0, Number(product?.conversionRate ?? 0));

  const canRenderAsPack =
    !!buyingUnit &&
    conversionRate > 1 &&
    Number.isFinite(line.quantity) &&
    line.quantity > 0 &&
    Math.abs(Math.round((line.quantity / conversionRate) * 1000) / 1000 - line.quantity / conversionRate) <
      0.0001;

  if (canRenderAsPack && buyingUnit) {
    const packs = line.quantity / conversionRate;
    const whole = Math.abs(packs - Math.round(packs)) < 0.0001 ? Math.round(packs) : packs;
    const label = `${whole.toLocaleString()} ${buyingUnit}${whole === 1 ? "" : "s"}`;
    const money =
      line.inputMode === "money" && line.moneyAmountUgx != null && line.moneyAmountUgx > 0
        ? ` — UGX ${line.moneyAmountUgx.toLocaleString()}`
        : "";
    return {
      quantityLabel: `${label}${money}`,
      showCalculation: false,
    };
  }

  const qtyLabel = formatFriendlyQuantity(line.quantity, baseUnit, "receipt");

  if (line.inputMode === "money" && line.moneyAmountUgx != null && line.moneyAmountUgx > 0) {
    return {
      quantityLabel: `${qtyLabel} — UGX ${line.moneyAmountUgx.toLocaleString()}`,
      showCalculation: false,
    };
  }

  return {
    quantityLabel: qtyLabel,
    showCalculation: line.unitPriceUgx > 0,
  };
}
