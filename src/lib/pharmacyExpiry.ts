import type { Product } from "../types";
import { dateKeyKampala } from "./datesUg";

export type ExpiryBucket = "none" | "ok" | "d90" | "d60" | "d30" | "expired";

export type ExpiryBucketCounts = {
  none: number;
  ok: number;
  d90: number;
  d60: number;
  d30: number;
  expired: number;
};

/** Normalize to YYYY-MM-DD or null. */
export function normalizeExpiryDate(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function productHasExpiry(product: Product): boolean {
  return normalizeExpiryDate(product.expiryDate) != null;
}

/** Whole days until expiry (negative = expired). Null if no expiry set. */
export function daysUntilExpiry(product: Product, today: Date = new Date()): number | null {
  const exp = normalizeExpiryDate(product.expiryDate);
  if (!exp) return null;
  const todayKey = dateKeyKampala(today);
  const todayMs = Date.parse(`${todayKey}T12:00:00.000Z`);
  const expMs = Date.parse(`${exp}T12:00:00.000Z`);
  if (!Number.isFinite(todayMs) || !Number.isFinite(expMs)) return null;
  return Math.floor((expMs - todayMs) / 86_400_000);
}

export function isProductExpired(product: Product, today: Date = new Date()): boolean {
  const days = daysUntilExpiry(product, today);
  return days != null && days < 0;
}

export function expiryBucketForProduct(product: Product, today: Date = new Date()): ExpiryBucket {
  if (product.stockOnHand <= 0) return "none";
  const days = daysUntilExpiry(product, today);
  if (days == null) return "none";
  if (days < 0) return "expired";
  if (days <= 30) return "d30";
  if (days <= 60) return "d60";
  if (days <= 90) return "d90";
  return "ok";
}

export function countExpiryBuckets(products: Product[], today: Date = new Date()): ExpiryBucketCounts {
  const counts: ExpiryBucketCounts = { none: 0, ok: 0, d90: 0, d60: 0, d30: 0, expired: 0 };
  for (const p of products) {
    if (p.stockOnHand <= 0) continue;
    const bucket = expiryBucketForProduct(p, today);
    if (bucket === "none") counts.none += 1;
    else counts[bucket] += 1;
  }
  return counts;
}

export function medicinesInExpiryBucket(products: Product[], bucket: ExpiryBucket, today: Date = new Date()): Product[] {
  return products
    .filter((p) => p.stockOnHand > 0 && expiryBucketForProduct(p, today) === bucket)
    .sort((a, b) => {
      const da = daysUntilExpiry(a, today) ?? 9999;
      const db = daysUntilExpiry(b, today) ?? 9999;
      return da - db;
    });
}

export function formatExpiryLabel(product: Product, lang: "en" | "lg" = "en", today: Date = new Date()): string | null {
  const days = daysUntilExpiry(product, today);
  if (days == null) return null;
  if (days < 0) return lang === "lg" ? "Eweddewo" : "Expired";
  if (days === 0) return lang === "lg" ? "Leero" : "Today";
  if (days === 1) return lang === "lg" ? "Enkya" : "Tomorrow";
  return lang === "lg" ? `${days} nnaku` : `${days}d`;
}

export type PharmacyExpiredSaleBehavior = "warn" | "block";

export function shouldBlockExpiredSale(behavior: PharmacyExpiredSaleBehavior | undefined | null): boolean {
  return behavior === "block";
}

export type ExpiryVisualStatus = "none" | "safe" | "d90" | "d60" | "d30" | "expired";

export function expiryVisualStatus(product: Product, today: Date = new Date()): ExpiryVisualStatus {
  if (product.stockOnHand <= 0 || !productHasExpiry(product)) return "none";
  const bucket = expiryBucketForProduct(product, today);
  if (bucket === "expired") return "expired";
  if (bucket === "d30") return "d30";
  if (bucket === "d60") return "d60";
  if (bucket === "d90") return "d90";
  if (bucket === "ok") return "safe";
  return "none";
}

export function expiryStatusPresentation(status: ExpiryVisualStatus): {
  badgeClass: string;
  labelKey: string;
} {
  switch (status) {
    case "safe":
      return { badgeClass: "bg-emerald-100 text-emerald-900 ring-1 ring-emerald-200", labelKey: "pharmacyExpirySafe" };
    case "d90":
      return { badgeClass: "bg-yellow-100 text-yellow-950 ring-1 ring-yellow-300", labelKey: "pharmacyExpiry90" };
    case "d60":
      return { badgeClass: "bg-waka-100 text-waka-950 ring-1 ring-waka-300", labelKey: "pharmacyExpiry60" };
    case "d30":
      return { badgeClass: "bg-red-100 text-red-950 ring-1 ring-red-300", labelKey: "pharmacyExpiry30" };
    case "expired":
      return { badgeClass: "bg-stone-800 text-stone-100 ring-1 ring-stone-600", labelKey: "pharmacyExpiryExpired" };
    default:
      return { badgeClass: "bg-stone-100 text-stone-600 ring-1 ring-stone-200", labelKey: "pharmacyExpiryNone" };
  }
}

export function expiryTilePresentation(bucket: "d90" | "d60" | "d30" | "expired" | "safe"): {
  borderClass: string;
  bgClass: string;
  labelClass: string;
  valueClass: string;
} {
  switch (bucket) {
    case "safe":
      return {
        borderClass: "border-emerald-200",
        bgClass: "bg-emerald-50",
        labelClass: "text-emerald-800",
        valueClass: "text-emerald-950",
      };
    case "d90":
      return {
        borderClass: "border-yellow-300",
        bgClass: "bg-yellow-50",
        labelClass: "text-yellow-900",
        valueClass: "text-yellow-950",
      };
    case "d60":
      return {
        borderClass: "border-waka-300",
        bgClass: "bg-waka-50",
        labelClass: "text-waka-900",
        valueClass: "text-waka-950",
      };
    case "d30":
      return {
        borderClass: "border-red-300",
        bgClass: "bg-red-50",
        labelClass: "text-red-900",
        valueClass: "text-red-950",
      };
    case "expired":
      return {
        borderClass: "border-stone-400",
        bgClass: "bg-stone-100",
        labelClass: "text-stone-700",
        valueClass: "text-stone-950",
      };
  }
}
