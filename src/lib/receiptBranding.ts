import type { ShopPreferences } from "../types";

export type ReceiptBranding = {
  customHeaderLines: string[] | null;
  footerThanks: string;
  returnPolicy: string | null;
};

const DEFAULT_FOOTER = "Thank you for shopping with us";
const DEFAULT_RETURN_POLICY = "Returns accepted with receipt within 24 hours.";

export function resolveReceiptBranding(preferences: ShopPreferences): ReceiptBranding {
  const headerRaw = preferences.receiptCustomHeaderText?.trim();
  const footerRaw = preferences.receiptCustomFooterText?.trim();
  const policyRaw = preferences.receiptReturnPolicyText;

  let returnPolicy: string | null;
  if (policyRaw === "") {
    returnPolicy = null;
  } else if (policyRaw?.trim()) {
    returnPolicy = policyRaw.trim();
  } else {
    returnPolicy = DEFAULT_RETURN_POLICY;
  }

  return {
    customHeaderLines: headerRaw
      ? headerRaw
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
      : null,
    footerThanks: footerRaw || DEFAULT_FOOTER,
    returnPolicy,
  };
}
