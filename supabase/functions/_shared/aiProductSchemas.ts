/** Shared AI product suggestion schema (Edge Functions). */

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

export type PlatformAiSettings = {
  ai_enabled: boolean;
  ai_business_setup_enabled: boolean;
  ai_product_assistant_enabled: boolean;
  monthly_ai_generation_limit: number;
  deepseek_model: string;
};

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

export function normalizeProductNameKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[''`]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parsePlatformAiSettings(raw: unknown): PlatformAiSettings {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const limit = Number(obj.monthly_ai_generation_limit ?? 5000);
  const model = String(obj.deepseek_model ?? "deepseek-chat");
  return {
    ai_enabled: obj.ai_enabled === true,
    ai_business_setup_enabled: obj.ai_business_setup_enabled === true,
    ai_product_assistant_enabled: obj.ai_product_assistant_enabled === true,
    monthly_ai_generation_limit: Number.isFinite(limit) && limit >= 0 ? Math.floor(limit) : 5000,
    deepseek_model: model === "deepseek-reasoner" ? "deepseek-reasoner" : "deepseek-chat",
  };
}

function inferSellingMode(unit: string): "unit" | "weighted" | "portion" {
  const u = unit.trim().toLowerCase();
  if (u === "kg" || u === "litre" || u === "liter" || u === "g" || u === "l") return "weighted";
  if (u.includes("litre") || u.includes("liter") || u.includes("oil")) return "portion";
  return "unit";
}

function normalizeUnit(raw: string): string {
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

  const unit = normalizeUnit(String(o.unit ?? o.baseUnit ?? "piece"));
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
    confidence: confidence,
    detectedNature: o.detectedNature != null ? String(o.detectedNature) : null,
  };
}

export function suggestionToCachePayload(s: AiProductSuggestion): Record<string, unknown> {
  return {
    category: s.category,
    unit: s.unit,
    selling_mode: s.sellingMode,
    pack_type: s.packType,
    pieces_per_pack: s.piecesPerPack,
    confidence_score: s.confidence,
    detected_nature: s.detectedNature ?? null,
    source: "deepseek",
  };
}

export function cacheRowToSuggestion(
  row: Record<string, unknown>,
  displayName: string,
): AiProductSuggestion {
  return {
    name: displayName,
    category: String(row.category ?? "General"),
    unit: normalizeUnit(String(row.unit ?? "piece")),
    sellingMode: (String(row.selling_mode ?? "unit") as "unit" | "weighted" | "portion") || "unit",
    packType: normalizePackType(row.pack_type),
    piecesPerPack: row.pieces_per_pack != null ? Number(row.pieces_per_pack) : null,
    confidence: Number(row.confidence_score ?? 0.85),
    detectedNature: row.detected_nature != null ? String(row.detected_nature) : null,
  };
}

export const PRODUCT_SUGGEST_SYSTEM_PROMPT = `You are a Uganda retail POS assistant. Given a product name and optional business type, suggest how shops catalogue the item.

Output JSON only with this exact shape:
{
  "name": "string",
  "category": "shelf or category name",
  "unit": "piece|bottle|packet|kg|litre|...",
  "sellingMode": "unit|weighted|portion",
  "packType": "crate|carton|box|sack|pack|tray|bale|custom|null",
  "piecesPerPack": number or null,
  "confidence": 0.0 to 1.0
}

Use realistic East African shop categories. packType and piecesPerPack apply when items are bought in bulk packs (e.g. soda crates).`;
