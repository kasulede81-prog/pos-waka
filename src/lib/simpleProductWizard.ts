import type { Language, SellingMode } from "../types";
import { t } from "./i18n";
import { inferFromProductName } from "./smartProductGuess";

export type BuyPackKind = "tray" | "box" | "carton" | "packet" | "bottle" | "kg" | "piece" | "custom";

export type WizardSellOption = { label: string; priceUgx: string };

export type ProductNameHint = {
  buyHow: BuyPackKind;
  buyLabel: string;
  piecesInside: number;
  sellBaseUnit: string;
  suggestLineKey: "simpleAddHintEggs" | "simpleAddHintSoda" | "simpleAddHintSugar" | null;
  defaultSellOptions: WizardSellOption[];
};

export const COMMON_PRODUCT_CHIPS = ["Eggs", "Sugar", "Soda", "Rice", "Milk", "Bread", "Soap", "Salt", "Oil"] as const;

export const BUY_PACK_OPTIONS: { id: BuyPackKind; icon: string; labelKey: string }[] = [
  { id: "tray", icon: "🥚", labelKey: "buyHow_tray" },
  { id: "box", icon: "📦", labelKey: "buyHow_box" },
  { id: "carton", icon: "📦", labelKey: "buyHow_carton" },
  { id: "packet", icon: "🧃", labelKey: "buyHow_packet" },
  { id: "bottle", icon: "🍾", labelKey: "buyHow_bottle" },
  { id: "kg", icon: "⚖️", labelKey: "buyHow_kg" },
  { id: "piece", icon: "1️⃣", labelKey: "buyHow_piece" },
  { id: "custom", icon: "✏️", labelKey: "buyHow_custom" },
];

export function hintForProductName(raw: string): ProductNameHint | null {
  const n = raw.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

  if (/\begg/.test(n)) {
    return {
      buyHow: "tray",
      buyLabel: "tray",
      piecesInside: 30,
      sellBaseUnit: "egg",
      suggestLineKey: "simpleAddHintEggs",
      defaultSellOptions: [
        { label: "1 egg", priceUgx: "500" },
        { label: "3 eggs", priceUgx: "1000" },
        { label: "Full tray", priceUgx: "15000" },
      ],
    };
  }
  if (/\b(soda|fanta|sprite|coke|cola|stoney|novida|mirinda|pepsi)\b/.test(n)) {
    return {
      buyHow: "carton",
      buyLabel: "crate",
      piecesInside: 24,
      sellBaseUnit: "bottle",
      suggestLineKey: "simpleAddHintSoda",
      defaultSellOptions: [
        { label: "1 bottle", priceUgx: "1000" },
        { label: "2 bottles", priceUgx: "1800" },
        { label: "Full crate", priceUgx: "22000" },
      ],
    };
  }
  if (/\b(sugar|sukari|sukali)\b/.test(n)) {
    return {
      buyHow: "kg",
      buyLabel: "kg",
      piecesInside: 1,
      sellBaseUnit: "kg",
      suggestLineKey: "simpleAddHintSugar",
      defaultSellOptions: [
        { label: "½ kg", priceUgx: "2000" },
        { label: "1 kg", priceUgx: "3500" },
        { label: "2 kg", priceUgx: "7000" },
      ],
    };
  }
  if (/\b(rice|posho|maize|beans|flour)\b/.test(n)) {
    return {
      buyHow: "kg",
      buyLabel: "sack",
      piecesInside: 50,
      sellBaseUnit: "kg",
      suggestLineKey: null,
      defaultSellOptions: [
        { label: "1 kg", priceUgx: "3500" },
        { label: "2 kg", priceUgx: "7000" },
        { label: "5 kg", priceUgx: "17000" },
      ],
    };
  }
  if (/\b(milk|juice|yoghurt|yogurt)\b/.test(n)) {
    return {
      buyHow: "carton",
      buyLabel: "carton",
      piecesInside: 12,
      sellBaseUnit: "packet",
      suggestLineKey: null,
      defaultSellOptions: [
        { label: "1 packet", priceUgx: "1500" },
        { label: "Full carton", priceUgx: "16000" },
      ],
    };
  }

  return null;
}

const BUY_LABEL_EN: Record<BuyPackKind, string> = {
  tray: "tray",
  box: "box",
  carton: "carton",
  packet: "packet",
  bottle: "bottle",
  kg: "kg",
  piece: "piece",
  custom: "pack",
};

export function buyLabelForKind(kind: BuyPackKind, custom: string, lang: Language): string {
  if (kind === "custom") return custom.trim() || t(lang, "buyHow_custom");
  const row = BUY_PACK_OPTIONS.find((b) => b.id === kind);
  if (!row) return BUY_LABEL_EN[kind];
  return t(lang, row.labelKey as "buyHow_tray");
}

function parseQtyFromSellLabel(label: string): number | null {
  const n = label.toLowerCase();
  if (/\bfull\b|\bwhole\b|\bentire\b|\btray\b|\bcrate\b|\bcarton\b/.test(n)) return null;
  const m = n.match(/(\d+(?:\.\d+)?)\s*(?:egg|bottle|packet|piece|kg|kilo|litre|liter|ea)?/);
  if (m) return Number(m[1]);
  if (/\bhalf\b|½|1\/2/.test(n)) return 0.5;
  if (/\bone\b|1\s/.test(n) || /^1\b/.test(n.trim())) return 1;
  return null;
}

export type BuiltWizardProduct = {
  name: string;
  priceUgx: number;
  stockQty: number;
  category: string;
  sellingMode: SellingMode;
  baseUnit: string;
  buyingUnit?: string;
  conversionRate?: number;
  costPricePerUnitUgx?: number;
  quickPresetsMoneyUgx: number[];
  quickPresetsQty: number[];
  inferName: string;
};

export function buildProductFromSimpleWizard(
  input: {
    name: string;
    buyHow: BuyPackKind;
    buyCustom: string;
    piecesInside: string;
    buyPackPriceUgx: string;
    stockPacks: string;
    sellOptions: WizardSellOption[];
    shelf: string;
    supplier?: string;
  },
  lang: Language,
): BuiltWizardProduct | null {
  const name = input.name.trim();
  if (!name) return null;

  const hint = hintForProductName(name);
  const guess = inferFromProductName(name);

  const buyLabel =
    input.buyHow === "custom"
      ? input.buyCustom.trim() || "pack"
      : buyLabelForKind(input.buyHow, input.buyCustom, lang).toLowerCase();

  let pieces = Math.floor(Number(input.piecesInside.replace(/[^\d.]/g, "")) || 0);
  if (pieces <= 0) {
    if (input.buyHow === "kg" || input.buyHow === "piece") pieces = 1;
    else pieces = hint?.piecesInside ?? 1;
  }

  const packPrice = Math.floor(Number(input.buyPackPriceUgx.replace(/\D/g, "")) || 0);
  const packsInStock = Math.max(0, Number(input.stockPacks.replace(/[^\d.]/g, "")) || 0);

  const sellParsed = input.sellOptions
    .map((o) => ({
      label: o.label.trim(),
      price: Math.floor(Number(o.priceUgx.replace(/\D/g, "")) || 0),
      qty: parseQtyFromSellLabel(o.label.trim()),
    }))
    .filter((o) => o.price > 0);

  if (!sellParsed.length) return null;

  const fullTrayQty =
    hint && pieces > 1
      ? pieces
      : pieces > 1
        ? pieces
        : null;
  for (const o of sellParsed) {
    if (o.qty == null && fullTrayQty && /\bfull|tray|crate|carton\b/i.test(o.label)) {
      o.qty = fullTrayQty;
    }
  }

  let baseUnit = hint?.sellBaseUnit ?? guess.baseUnit;
  if (input.buyHow === "kg") baseUnit = "kg";
  else if (input.buyHow === "bottle") baseUnit = "bottle";
  else if (input.buyHow === "piece") baseUnit = "piece";

  const sellingMode: SellingMode =
    input.buyHow === "kg" || baseUnit === "kg" ? "weighted" : guess.sellingMode;

  const singleUnit = sellParsed.find((o) => o.qty === 1 || o.qty === 0.5);
  let priceUgx = singleUnit?.price ?? 0;
  if (priceUgx <= 0 && singleUnit?.qty === 0.5) priceUgx = singleUnit.price * 2;
  if (priceUgx <= 0) {
    const withQty = sellParsed.filter((o) => o.qty && o.qty > 0);
    if (withQty.length) {
      const best = withQty[0]!;
      priceUgx = Math.floor(best.price / best.qty!);
    } else {
      priceUgx = sellParsed[0]!.price;
    }
  }

  const moneyPresets = [...new Set(sellParsed.map((o) => o.price))].sort((a, b) => a - b);
  const qtyPresets = [
    ...new Set(
      sellParsed
        .map((o) => o.qty)
        .filter((q): q is number => q != null && q > 0),
    ),
  ].sort((a, b) => a - b);

  const hasPackTrack = packPrice > 0 && pieces > 0 && input.buyHow !== "kg";
  const costPerUnit = hasPackTrack ? Math.floor(packPrice / pieces) : undefined;
  const stockQty =
    input.buyHow === "kg"
      ? packsInStock
      : hasPackTrack && pieces > 1
        ? packsInStock * pieces
        : packsInStock;

  const buyingUnit =
    hasPackTrack && input.buyHow !== "kg"
      ? input.supplier?.trim()
        ? `${buyLabel} · ${input.supplier.trim()}`
        : buyLabel
      : undefined;

  return {
    name,
    priceUgx,
    stockQty,
    category: input.shelf.trim() || "General",
    sellingMode,
    baseUnit,
    buyingUnit,
    conversionRate: hasPackTrack && pieces > 1 ? pieces : input.buyHow === "kg" ? undefined : pieces > 1 ? pieces : undefined,
    costPricePerUnitUgx: costPerUnit,
    quickPresetsMoneyUgx: moneyPresets,
    quickPresetsQty: qtyPresets,
    inferName: name,
  };
}
