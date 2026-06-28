import type { BusinessType, ShopSellingStyle } from "../../types";

export type BuilderActivationMode = "none" | "opening_soon" | "active";

export type BusinessSceneState = {
  shopName: string;
  ownerName: string;
  districtName: string;
  hasBuilding: boolean;
  hasSign: boolean;
  hasOwner: boolean;
  hasPhone: boolean;
  hasMailbox: boolean;
  hasMapPin: boolean;
  isLocked: boolean;
  hasReferral: boolean;
  businessType: BusinessType | null;
  businessCardId: string | null;
  sellingStyle: ShopSellingStyle | null;
  hasShelves: boolean;
  hasProducts: boolean;
  productCount: number;
  hasPrinter: boolean;
  hasStaff: boolean;
  hasWakaBadge: boolean;
  hasCloudSync: boolean;
  hasAiAssistant: boolean;
  activationMode: BuilderActivationMode;
  emailPending: boolean;
  mailboxOpen: boolean;
  isOpen: boolean;
  grandOpeningPlayed: boolean;
};

export const INITIAL_BUSINESS_SCENE: BusinessSceneState = {
  shopName: "",
  ownerName: "",
  districtName: "",
  hasBuilding: false,
  hasSign: false,
  hasOwner: false,
  hasPhone: false,
  hasMailbox: false,
  hasMapPin: false,
  isLocked: false,
  hasReferral: false,
  businessType: null,
  businessCardId: null,
  sellingStyle: null,
  hasShelves: false,
  hasProducts: false,
  productCount: 0,
  hasPrinter: false,
  hasStaff: false,
  hasWakaBadge: false,
  hasCloudSync: false,
  hasAiAssistant: false,
  activationMode: "none",
  emailPending: false,
  mailboxOpen: false,
  isOpen: false,
  grandOpeningPlayed: false,
};

export type BuilderUnlockId =
  | "sign"
  | "owner"
  | "contact"
  | "location"
  | "security"
  | "agent"
  | "businessType"
  | "selling"
  | "products"
  | "ready";

export type BuilderUnlock = {
  id: BuilderUnlockId;
  labelKey: string;
  done: boolean;
};

export function registrationUnlocks(state: BusinessSceneState): BuilderUnlock[] {
  return [
    { id: "sign", labelKey: "builderUnlockSign", done: state.hasSign },
    { id: "owner", labelKey: "builderUnlockOwner", done: state.hasOwner },
    {
      id: "contact",
      labelKey: "builderUnlockContact",
      done: state.hasPhone && state.hasMailbox,
    },
    { id: "location", labelKey: "builderUnlockLocation", done: state.hasMapPin },
    { id: "security", labelKey: "builderUnlockSecurity", done: state.isLocked },
    { id: "agent", labelKey: "builderUnlockAgent", done: state.hasReferral },
    {
      id: "ready",
      labelKey: "builderUnlockReady",
      done: state.isLocked && state.hasSign && state.hasOwner,
    },
  ];
}

export function onboardingUnlocks(state: BusinessSceneState): BuilderUnlock[] {
  const base = registrationUnlocks(state).filter((u) => u.done || u.id !== "ready");
  return [
    ...base,
    {
      id: "businessType",
      labelKey: "builderUnlockBusinessType",
      done: Boolean(state.businessType),
    },
    {
      id: "selling",
      labelKey: "builderUnlockSelling",
      done: Boolean(state.sellingStyle),
    },
    {
      id: "products",
      labelKey: "builderUnlockProducts",
      done: state.hasProducts || state.productCount > 0,
    },
    {
      id: "ready",
      labelKey: "builderUnlockReadyOpen",
      done: state.isOpen,
    },
  ];
}

export function mergeSceneState(
  prev: BusinessSceneState,
  patch: Partial<BusinessSceneState>,
): BusinessSceneState {
  const next = { ...prev, ...patch };
  if (!next.hasBuilding && (next.shopName || next.hasSign)) {
    next.hasBuilding = true;
  }
  return next;
}

/** Map business card id to scene interior variant. */
export function sceneVariantFromBusiness(
  businessType: BusinessType | null,
  cardId: string | null,
): string {
  if (!businessType && !cardId) return "retail";
  if (cardId === "pharmacy" || businessType === "pharmacy") return "pharmacy";
  if (cardId === "hardware" || businessType === "hardware") return "hardware";
  if (businessType === "boutique") return "boutique";
  if (
    cardId === "hospitality" ||
    businessType === "restaurant" ||
    businessType === "bar" ||
    businessType === "hotel"
  ) {
    return "hospitality";
  }
  if (businessType === "wholesale") return "wholesale";
  return "retail";
}
