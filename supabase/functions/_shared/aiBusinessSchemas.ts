/** Shared AI business setup + bulk inventory schemas (Edge Functions). */

export type AiStarterProductRow = {
  name: string;
  category: string;
  unit: string;
  sellingMode: "unit" | "weighted" | "portion";
  suggestedPriceUgx: number;
  suggestedStockQty: number;
};

export type AiBusinessSetupResult = {
  detectedNature: string;
  shelves: string[];
  starterProducts: AiStarterProductRow[];
};

export type AiBulkInventoryRow = {
  name: string;
  category: string;
  unit: string;
  sellingMode: "unit" | "weighted" | "portion";
  suggestedPriceUgx: number;
};

function normalizeSellingMode(raw: unknown, unit: string): "unit" | "weighted" | "portion" {
  const m = String(raw ?? "").trim().toLowerCase();
  if (m === "unit" || m === "weighted" || m === "portion") return m;
  const u = unit.trim().toLowerCase();
  if (u === "kg" || u === "litre" || u === "liter" || u === "g") return "weighted";
  if (u.includes("litre") || u.includes("oil")) return "portion";
  return "unit";
}

function normalizeUnit(raw: unknown): string {
  const u = String(raw ?? "piece").trim().toLowerCase();
  if (!u) return "piece";
  if (u === "pieces" || u === "pcs" || u === "ea") return "piece";
  if (u === "bottles") return "bottle";
  if (u === "packets") return "packet";
  if (u === "kilo") return "kg";
  if (u === "liter" || u === "l") return "litre";
  return u;
}

function clampPrice(raw: unknown): number {
  const n = Math.floor(Number(raw ?? 0));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function clampStock(raw: unknown): number {
  const n = Math.max(0, Math.floor(Number(raw ?? 0)));
  return Number.isFinite(n) ? n : 0;
}

export function parseAiBusinessSetup(raw: unknown): AiBusinessSetupResult | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const detectedNature = String(o.detected_nature ?? o.detectedNature ?? "General Retail").trim() || "General Retail";

  const shelvesRaw = o.shelves ?? o.categories;
  const shelves = Array.isArray(shelvesRaw)
    ? shelvesRaw.map((s) => String(s).trim()).filter(Boolean).slice(0, 24)
    : [];

  const productsRaw = o.starter_products ?? o.starterProducts ?? o.products;
  const starterProducts: AiStarterProductRow[] = [];
  if (Array.isArray(productsRaw)) {
    for (const row of productsRaw) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const name = String(r.name ?? "").trim();
      if (!name) continue;
      const unit = normalizeUnit(r.unit ?? r.baseUnit);
      starterProducts.push({
        name,
        category: String(r.category ?? r.shelf ?? "General").trim() || "General",
        unit,
        sellingMode: normalizeSellingMode(r.sellingMode ?? r.selling_mode, unit),
        suggestedPriceUgx: clampPrice(r.suggestedPriceUgx ?? r.suggested_price_ugx ?? r.priceUgx ?? r.price_ugx),
        suggestedStockQty: clampStock(r.suggestedStockQty ?? r.suggested_stock_qty ?? r.stockQty ?? r.stock_qty ?? 10),
      });
      if (starterProducts.length >= 60) break;
    }
  }

  if (shelves.length === 0 && starterProducts.length === 0) return null;

  const shelfSet = new Set(shelves);
  for (const p of starterProducts) {
    if (p.category && !shelfSet.has(p.category)) {
      shelves.push(p.category);
      shelfSet.add(p.category);
    }
  }

  return {
    detectedNature,
    shelves: shelves.slice(0, 24),
    starterProducts: starterProducts.slice(0, 60),
  };
}

export function parseAiBulkInventory(raw: unknown): AiBulkInventoryRow[] {
  if (!raw || typeof raw !== "object") return [];
  const o = raw as Record<string, unknown>;
  const productsRaw = o.products ?? o.items ?? o.inventory;
  if (!Array.isArray(productsRaw)) return [];

  const rows: AiBulkInventoryRow[] = [];
  for (const row of productsRaw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const name = String(r.name ?? "").trim();
    if (!name) continue;
    const unit = normalizeUnit(r.unit ?? r.baseUnit);
    rows.push({
      name,
      category: String(r.category ?? r.shelf ?? "General").trim() || "General",
      unit,
      sellingMode: normalizeSellingMode(r.sellingMode ?? r.selling_mode, unit),
      suggestedPriceUgx: clampPrice(r.suggestedPriceUgx ?? r.suggested_price_ugx ?? r.priceUgx ?? 0),
    });
    if (rows.length >= 100) break;
  }
  return rows;
}

export const BUSINESS_SETUP_SYSTEM_PROMPT = `You are a Uganda retail POS onboarding assistant. Analyze a shop and suggest shelves (categories) and starter inventory.

Output JSON only:
{
  "detected_nature": "Grocery|Hardware|Boutique|Electronics|Pharmacy|Restaurant|Cosmetics|Agriculture|General Retail|...",
  "shelves": ["string", ...],
  "starter_products": [
    {
      "name": "string",
      "category": "shelf name",
      "unit": "piece|bottle|kg|litre|...",
      "sellingMode": "unit|weighted|portion",
      "suggestedPriceUgx": number,
      "suggestedStockQty": number
    }
  ]
}

Provide 8-20 realistic starter products for Uganda shops. Use UGX prices that are plausible for small retailers.`;

export const BULK_INVENTORY_SYSTEM_PROMPT = `You are a Uganda retail POS assistant. Generate a starter product list for a shop description.

Output JSON only:
{
  "products": [
    {
      "name": "string",
      "category": "shelf/category",
      "unit": "piece|bottle|kg|litre|...",
      "sellingMode": "unit|weighted|portion",
      "suggestedPriceUgx": number
    }
  ]
}

Return 50-80 common products. Use realistic Uganda product names and UGX prices. No duplicate names.`;
