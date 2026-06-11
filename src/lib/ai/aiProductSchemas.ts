/**
 * AI product suggestion types and parsers (client + tests).
 * Keep in sync with supabase/functions/_shared/aiProductSchemas.ts
 */

export type AiProductSuggestion = {
  name: string;
  category: string;
  unit: string;
  sellingMode: "unit" | "weighted" | "portion";
  packType: string | null;
  piecesPerPack: number | null;
  confidence: number;
  detectedNature?: string | null;
};

import { canUseAiAllowed } from "./canUseAi";
import {
  DEFAULT_PLATFORM_AI_SETTINGS_V2,
  DEEPSEEK_MODEL_OPTIONS,
  deepseekModelFromSettings,
  parsePlatformAiSettingsV2,
  type DeepSeekModel,
  type PlatformAiSettingsV2,
} from "./platformAiSettings.v2";

/** @deprecated Use PlatformAiSettingsV2 */
export type PlatformAiSettings = PlatformAiSettingsV2;

export { DEEPSEEK_MODEL_OPTIONS, type DeepSeekModel };

export const DEFAULT_PLATFORM_AI_SETTINGS = DEFAULT_PLATFORM_AI_SETTINGS_V2;

const PACK_TYPES = new Set([
  "crate",
  "carton",
  "box",
  "sack",
  "pack",
  "tray",
  "bale",
  "custom",
]);

/** Cache lookup key — lowercase, collapsed whitespace, stripped punctuation. */
export function normalizeProductNameKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[''`]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parsePlatformAiSettings(raw: unknown): PlatformAiSettingsV2 {
  return parsePlatformAiSettingsV2(raw);
}

/** @deprecated Use canUseAi("product_assistant", { settings }) */
export function isAiProductAssistantActive(settings: PlatformAiSettingsV2): boolean {
  return canUseAiAllowed("product_assistant", settings);
}

/** @deprecated Use canUseAi("business_setup_assistant", { settings }) */
export function isAiBusinessSetupActive(settings: PlatformAiSettingsV2): boolean {
  return canUseAiAllowed("business_setup_assistant", settings);
}

export function isAiInventoryAssistantActive(settings: PlatformAiSettingsV2): boolean {
  return canUseAiAllowed("inventory_assistant", settings);
}

export { deepseekModelFromSettings };

function inferSellingMode(unit: string): "unit" | "weighted" | "portion" {
  const u = unit.trim().toLowerCase();
  if (u === "kg" || u === "litre" || u === "liter" || u === "g" || u === "l") return "weighted";
  if (u.includes("litre") || u.includes("liter") || u.includes("oil")) return "portion";
  return "unit";
}

export function normalizeAiUnit(raw: string): string {
  const u = raw.trim().toLowerCase();
  if (u === "bottle" || u === "bottles") return "bottle";
  if (u === "piece" || u === "pieces" || u === "pcs" || u === "ea") return "piece";
  if (u === "packet" || u === "pack") return "packet";
  if (u === "kg" || u === "kilo") return "kg";
  if (u === "litre" || u === "liter" || u === "l") return "litre";
  return u || "piece";
}

function normalizePackType(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  const p = String(raw).trim().toLowerCase();
  if (!p || p === "none" || p === "null") return null;
  return PACK_TYPES.has(p) ? p : "custom";
}

export function parseAiProductSuggestion(raw: unknown, fallbackName: string): AiProductSuggestion | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const name = String(o.name ?? fallbackName).trim();
  if (!name) return null;

  const unit = normalizeAiUnit(String(o.unit ?? o.baseUnit ?? "piece"));
  let sellingMode = String(o.sellingMode ?? o.selling_mode ?? "").trim().toLowerCase();
  if (sellingMode !== "unit" && sellingMode !== "weighted" && sellingMode !== "portion") {
    sellingMode = inferSellingMode(unit);
  }

  const piecesRaw = o.piecesPerPack ?? o.pieces_per_pack;
  const pieces = piecesRaw == null || piecesRaw === "" ? null : Math.max(1, Math.floor(Number(piecesRaw)));

  const confRaw = Number(o.confidence ?? o.confidence_score ?? 0.7);
  const confidence = Number.isFinite(confRaw) ? Math.min(1, Math.max(0, confRaw)) : 0.7;

  return {
    name,
    category: String(o.category ?? "General").trim() || "General",
    unit,
    sellingMode: sellingMode as "unit" | "weighted" | "portion",
    packType: normalizePackType(o.packType ?? o.pack_type),
    piecesPerPack: pieces,
    confidence,
    detectedNature: o.detectedNature != null ? String(o.detectedNature) : null,
  };
}
