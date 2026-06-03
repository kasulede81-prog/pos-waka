import type {
  BusinessType,
  DebtPayment,
  ReceiptDisplayOptions,
  ReceiptFooterSnapshot,
  ReceiptHeaderConfig,
  ReceiptHeaderSnapshot,
  Sale,
  ShopPreferences,
} from "../types";
import type { SubscriptionPlanCode } from "./subscriptionEntitlements";
import { tierMeetsMinimum } from "./subscriptionEntitlements";

export type ReceiptBranding = {
  headerLines: string[];
  footerLines: string[];
  footerPowered: string | null;
  displayOptions: ReceiptDisplayOptions;
  /** @deprecated Use footerLines — kept for callers during migration */
  customHeaderLines: string[] | null;
  footerThanks: string;
  returnPolicy: string | null;
};

const DEFAULT_FOOTER = "Thank you for shopping with us";
const DEFAULT_RETURN_POLICY = "Returns accepted with receipt within 24 hours.";
const POWERED_BY = "Powered by Waka POS";
export const RECEIPT_FOOTER_SLOT_COUNT = 4;

/** Footer slots as stored in settings (preserves spaces; does not trim). */
export function padReceiptFooterSlots(lines: string[] | null | undefined): string[] {
  const base = (lines ?? []).slice(0, RECEIPT_FOOTER_SLOT_COUNT).map((l) => String(l ?? ""));
  while (base.length < RECEIPT_FOOTER_SLOT_COUNT) base.push("");
  return base;
}

/**
 * Footer lines for print/PDF/preview — keeps intentional blank rows between non-empty slots.
 */
export function receiptFooterLinesForPrint(slots: string[] | null | undefined): string[] {
  const padded = padReceiptFooterSlots(slots);
  const out: string[] = [];
  for (let i = 0; i < padded.length; i++) {
    const raw = padded[i];
    if (raw.trim()) {
      out.push(raw);
      continue;
    }
    const hasLater = padded.slice(i + 1).some((l) => l.trim().length > 0);
    if (out.length > 0 && hasLater) out.push("");
  }
  return out;
}

export function defaultReceiptDisplayOptions(): ReceiptDisplayOptions {
  return {
    showCashier: true,
    showReceiptNumber: true,
    showPaymentMethod: true,
    showCustomerName: true,
    showCustomerPhone: true,
    showDebtInfo: true,
    showShopAddress: true,
    showShopPhone: true,
  };
}

/** Industry default footer lines (RCPT-04) — applied only on new shop setup. */
export function industryReceiptFooterTemplate(businessType: BusinessType): string[] {
  switch (businessType) {
    case "pharmacy":
      return ["Keep medicines away from children", "Drugs sold are not returnable", "", ""];
    case "restaurant":
    case "hotel":
      return ["Thank you for dining with us", "Visit again", "", ""];
    case "bar":
    case "restaurant_bar":
      return ["Drink responsibly", "Thank you for visiting", "", ""];
    case "wholesale":
      return ["Thank you for doing business with us", "", "", ""];
    default:
      return ["Thank you for shopping with us", "Returns accepted within 24 hours", "", ""];
  }
}

export function receiptFooterLinesFromPreferences(preferences: ShopPreferences): string[] {
  const structured = preferences.receiptFooterLines;
  if (Array.isArray(structured) && structured.some((l) => String(l ?? "").trim())) {
    const printed = receiptFooterLinesForPrint(structured);
    if (printed.length) return printed;
  }
  const legacy = preferences.receiptCustomFooterText?.trim();
  if (legacy) return [legacy];
  const policy = resolveReturnPolicy(preferences);
  if (policy) return [DEFAULT_FOOTER, policy];
  return [DEFAULT_FOOTER];
}

export function resolveReceiptHeaderConfig(preferences: ShopPreferences): ReceiptHeaderConfig {
  const h = preferences.receiptHeader;
  if (h && (h.businessName?.trim() || h.address?.trim() || h.phone?.trim() || h.email?.trim() || h.tin?.trim())) {
    return {
      businessName: String(h.businessName ?? ""),
      address: String(h.address ?? ""),
      phone: String(h.phone ?? ""),
      email: String(h.email ?? ""),
      tin: String(h.tin ?? ""),
    };
  }
  const legacyHeader = preferences.receiptCustomHeaderText?.trim();
  if (legacyHeader) {
    const lines = legacyHeader.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    return {
      businessName: lines[0] ?? preferences.shopDisplayName?.trim() ?? "",
      address: lines[1] ?? preferences.shopAddressLine?.trim() ?? "",
      phone: lines[2] ?? preferences.shopPhoneE164?.trim() ?? "",
      email: lines[3] ?? "",
      tin: "",
    };
  }
  return {
    businessName: preferences.shopDisplayName?.trim() || "Waka POS",
    address: preferences.shopAddressLine?.trim() ?? "",
    phone: preferences.shopPhoneE164?.trim() ?? "",
    email: "",
    tin: "",
  };
}

function appendMultilineField(lines: string[], raw: string): void {
  const parts = raw.split(/\r?\n/);
  for (let i = 0; i < parts.length; i++) {
    const line = parts[i];
    if (line.trim()) {
      lines.push(line);
      continue;
    }
    const hasLater = parts.slice(i + 1).some((p) => p.trim().length > 0);
    if (lines.length > 0 && hasLater) lines.push("");
  }
}

export function buildReceiptHeaderLines(
  config: ReceiptHeaderConfig,
  display: ReceiptDisplayOptions,
): string[] {
  const lines: string[] = [];
  if (config.businessName.trim()) lines.push(config.businessName.trim().toUpperCase());
  if (display.showShopAddress && config.address.trim()) appendMultilineField(lines, config.address);
  if (display.showShopPhone && config.phone.trim()) lines.push(config.phone.trim());
  if (config.email.trim()) lines.push(config.email.trim());
  if (config.tin.trim()) lines.push(`TIN: ${config.tin.trim()}`);
  return lines;
}

function resolveReturnPolicy(preferences: ShopPreferences): string | null {
  const policyRaw = preferences.receiptReturnPolicyText;
  if (policyRaw === "") return null;
  if (policyRaw?.trim()) return policyRaw.trim();
  return DEFAULT_RETURN_POLICY;
}

export function resolveReceiptDisplayOptions(preferences: ShopPreferences): ReceiptDisplayOptions {
  const d = preferences.receiptDisplayOptions;
  if (!d) return defaultReceiptDisplayOptions();
  return { ...defaultReceiptDisplayOptions(), ...d };
}

export function canHideWakaReceiptBranding(planTier: SubscriptionPlanCode): boolean {
  return tierMeetsMinimum(planTier, "business");
}

export function resolveFooterPowered(
  preferences: ShopPreferences,
  planTier: SubscriptionPlanCode,
): string | null {
  if (!canHideWakaReceiptBranding(planTier)) return POWERED_BY;
  if (preferences.receiptShowPoweredByWaka === false) return null;
  return POWERED_BY;
}

export function resolveReceiptBranding(
  preferences: ShopPreferences,
  planTier: SubscriptionPlanCode = "waka_plus",
): ReceiptBranding {
  const displayOptions = resolveReceiptDisplayOptions(preferences);
  const headerConfig = resolveReceiptHeaderConfig(preferences);
  const headerLines = buildReceiptHeaderLines(headerConfig, displayOptions);
  const footerLines = receiptFooterLinesFromPreferences(preferences);
  const footerPowered = resolveFooterPowered(preferences, planTier);
  const returnPolicy = resolveReturnPolicy(preferences);

  return {
    headerLines,
    footerLines,
    footerPowered,
    displayOptions,
    customHeaderLines: headerLines.length ? headerLines : null,
    footerThanks: footerLines[0] ?? DEFAULT_FOOTER,
    returnPolicy,
  };
}

/** Snapshot stored on each completed sale / debt payment (RCPT-07). */
export function buildReceiptBrandingSnapshot(
  preferences: ShopPreferences,
  planTier: SubscriptionPlanCode,
): { header: ReceiptHeaderSnapshot; footer: ReceiptFooterSnapshot } {
  const branding = resolveReceiptBranding(preferences, planTier);
  return {
    header: { lines: [...branding.headerLines] },
    footer: {
      lines: [...branding.footerLines],
      poweredBy: branding.footerPowered,
      displayOptions: { ...branding.displayOptions },
    },
  };
}

export function brandingFromSale(sale: Sale, preferences: ShopPreferences, planTier: SubscriptionPlanCode): ReceiptBranding {
  const fromSnap = brandingFromSnapshots(sale.receiptHeaderSnapshot, sale.receiptFooterSnapshot);
  if (fromSnap) return fromSnap;
  return resolveReceiptBranding(preferences, planTier);
}

function brandingFromSnapshots(
  header: ReceiptHeaderSnapshot | null | undefined,
  footer: ReceiptFooterSnapshot | null | undefined,
): ReceiptBranding | null {
  if (!header || !footer) return null;
  const displayOptions = footer.displayOptions ?? defaultReceiptDisplayOptions();
  return {
    headerLines: [...header.lines],
    footerLines: [...footer.lines],
    footerPowered: footer.poweredBy,
    displayOptions,
    customHeaderLines: header.lines.length ? header.lines : null,
    footerThanks: footer.lines[0] ?? DEFAULT_FOOTER,
    returnPolicy: null,
  };
}

export function brandingFromDebtPayment(
  payment: DebtPayment,
  preferences: ShopPreferences,
  planTier: SubscriptionPlanCode,
): ReceiptBranding {
  const fromSnap = brandingFromSnapshots(payment.receiptHeaderSnapshot, payment.receiptFooterSnapshot);
  if (fromSnap) return fromSnap;
  return resolveReceiptBranding(preferences, planTier);
}

export function applyIndustryReceiptDefaults(
  preferences: ShopPreferences,
  businessType: BusinessType,
): Partial<ShopPreferences> {
  const hasFooter =
    (preferences.receiptFooterLines?.some((l) => String(l).trim()) ?? false) ||
    Boolean(preferences.receiptCustomFooterText?.trim());
  const patch: Partial<ShopPreferences> = {};
  if (!hasFooter) {
    patch.receiptFooterLines = industryReceiptFooterTemplate(businessType);
  }
  if (!preferences.receiptDisplayOptions) {
    patch.receiptDisplayOptions = defaultReceiptDisplayOptions();
  }
  if (preferences.receiptShowPoweredByWaka === undefined) {
    patch.receiptShowPoweredByWaka = true;
  }
  return patch;
}

/** @deprecated Use resolveReceiptBranding — kept for gradual migration */
export function resolveReceiptBrandingLegacy(preferences: ShopPreferences): {
  customHeaderLines: string[] | null;
  footerThanks: string;
  returnPolicy: string | null;
} {
  const b = resolveReceiptBranding(preferences);
  return {
    customHeaderLines: b.customHeaderLines,
    footerThanks: b.footerThanks,
    returnPolicy: b.returnPolicy,
  };
}
