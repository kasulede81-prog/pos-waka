import type { BusinessType, ShopSellingStyle } from "../../types";
import type { BusinessSceneState } from "./businessSceneState";

export type ShopSceneInput = {
  shopName?: string | null;
  ownerName?: string | null;
  businessType?: BusinessType | null;
  sellingStyle?: ShopSellingStyle | null;
  phoneE164?: string | null;
  productCount: number;
  staffCount?: number;
};

export function businessCardIdFromType(businessType: BusinessType | null): string | null {
  if (!businessType) return null;
  switch (businessType) {
    case "pharmacy":
      return "pharmacy";
    case "hardware":
      return "hardware";
    case "boutique":
      return "boutique";
    case "wholesale":
      return "wholesale";
    case "electronics":
      return "electronics";
    case "restaurant":
    case "bar":
    case "hotel":
    case "restaurant_bar":
      return "hospitality";
    default:
      return "retail";
  }
}

/** Live shop fields merged into the builder scene (session funnel fields are preserved). */
export function deriveScenePatchFromShop(input: ShopSceneInput): Partial<BusinessSceneState> {
  const shopName = input.shopName?.trim() ?? "";
  const ownerName = input.ownerName?.trim() ?? "";
  const businessType = input.businessType ?? null;
  const sellingStyle = input.sellingStyle ?? null;
  const productCount = Math.max(0, input.productCount);
  const hasProducts = productCount > 0;
  const phone = Boolean(input.phoneE164?.trim());

  return {
    shopName,
    ownerName,
    businessType,
    businessCardId: businessCardIdFromType(businessType),
    sellingStyle,
    hasBuilding: true,
    hasSign: Boolean(shopName),
    hasOwner: Boolean(ownerName),
    hasPhone: phone,
    hasMailbox: phone,
    isLocked: true,
    hasShelves: Boolean(businessType),
    hasProducts,
    productCount,
    hasPrinter: hasProducts,
    hasStaff: (input.staffCount ?? 0) > 0,
    hasCloudSync: true,
    emailPending: false,
    isOpen: true,
    grandOpeningPlayed: true,
    activationMode: "active",
  };
}
