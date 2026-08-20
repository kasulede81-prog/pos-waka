/** Central registry for all AI features — no hardcoded feature strings elsewhere. */

export type AiFeatureSection =
  | "general"
  | "product"
  | "vision"
  | "business_setup"
  | "inventory"
  | "marketing"
  | "marketplace"
  | "business_qa";

export type AiFeatureName =
  | "product_assistant"
  | "product_scanner"
  | "ocr"
  | "barcode_detection"
  | "business_setup_assistant"
  | "inventory_assistant"
  | "restock_suggestions"
  | "marketing_assistant"
  | "marketplace_assistant"
  | "ask_waka";

export type AiFeatureMeta = {
  label: string;
  section: AiFeatureSection;
  edgeFunction?: string;
  deployed: boolean;
  description?: string;
};

export const AI_FEATURES: Record<AiFeatureName, AiFeatureMeta> = {
  product_assistant: {
    label: "Product Assistant",
    section: "product",
    edgeFunction: "ai-suggest-product",
    deployed: true,
    description: "Single-product prefill for the add-product wizard.",
  },
  product_scanner: {
    label: "Product Scanner",
    section: "vision",
    deployed: false,
    description: "Camera-based product identification (coming soon).",
  },
  ocr: {
    label: "OCR",
    section: "vision",
    deployed: false,
    description: "Text extraction from labels and invoices (coming soon).",
  },
  barcode_detection: {
    label: "Barcode Detection",
    section: "vision",
    deployed: false,
    description: "Hardware barcode assist (coming soon).",
  },
  business_setup_assistant: {
    label: "Business Setup Assistant",
    section: "business_setup",
    edgeFunction: "ai-business-setup",
    deployed: true,
    description: "Onboarding shelves and starter inventory.",
  },
  inventory_assistant: {
    label: "Inventory Assistant",
    section: "inventory",
    edgeFunction: "ai-bulk-inventory",
    deployed: true,
    description: "Bulk inventory list generation.",
  },
  restock_suggestions: {
    label: "Restock Suggestions",
    section: "inventory",
    deployed: false,
    description: "AI restock recommendations (coming soon).",
  },
  marketing_assistant: {
    label: "Marketing Assistant",
    section: "marketing",
    deployed: false,
    description: "Marketing copy and campaigns (coming soon).",
  },
  marketplace_assistant: {
    label: "Marketplace Assistant",
    section: "marketplace",
    deployed: false,
    description: "Marketplace listing generator (coming soon).",
  },
  ask_waka: {
    label: "Ask WAKA",
    section: "business_qa",
    edgeFunction: "ai-ask-waka",
    deployed: true,
    description: "Read-only AI business assistant for sales, inventory, expenses, and customers.",
  },
};

export const AI_FEATURE_NAMES = Object.keys(AI_FEATURES) as AiFeatureName[];

/** Live Edge-backed features — admin switches and Edge/RPC allowlist. */
export const LIVE_AI_FEATURES: readonly AiFeatureName[] = [
  "ask_waka",
  "product_assistant",
  "inventory_assistant",
  "business_setup_assistant",
] as const;

/** Registered but not deployed — Control Center shows these as coming soon, never as switches. */
export const COMING_SOON_AI_FEATURES: readonly AiFeatureName[] = [
  "product_scanner",
  "ocr",
  "barcode_detection",
  "restock_suggestions",
  "marketing_assistant",
  "marketplace_assistant",
] as const;

export function isAiFeatureName(value: string): value is AiFeatureName {
  return value in AI_FEATURES;
}

export function isLiveAiFeature(value: string): value is AiFeatureName {
  return (LIVE_AI_FEATURES as readonly string[]).includes(value);
}
