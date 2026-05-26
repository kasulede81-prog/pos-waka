import type { Language, SellingMode } from "../types";
import { t } from "./i18n";
import { inferFromProductName } from "./smartProductGuess";

/** How customers buy one item at the till. */
export type SellUnitKind = "piece" | "bottle" | "packet" | "kg" | "litre";

/** How stock arrives from the market. */
export type PackKind = "crate" | "carton" | "box" | "sack" | "pack" | "tray" | "bale" | "custom";

export const SELL_UNIT_OPTIONS: { id: SellUnitKind; labelKey: string }[] = [
  { id: "piece", labelKey: "sellUnit_piece" },
  { id: "bottle", labelKey: "sellUnit_bottle" },
  { id: "packet", labelKey: "sellUnit_packet" },
  { id: "kg", labelKey: "sellUnit_kg" },
  { id: "litre", labelKey: "sellUnit_litre" },
];

export const PACK_TYPE_OPTIONS: { id: PackKind; labelKey: string }[] = [
  { id: "crate", labelKey: "packKind_crate" },
  { id: "carton", labelKey: "packKind_carton" },
  { id: "box", labelKey: "packKind_box" },
  { id: "sack", labelKey: "packKind_sack" },
  { id: "pack", labelKey: "packKind_pack" },
  { id: "tray", labelKey: "packKind_tray" },
  { id: "bale", labelKey: "packKind_bale" },
  { id: "custom", labelKey: "packKind_custom" },
];

/** @deprecated kept for imports that reference legacy wizard chips */
export const COMMON_PRODUCT_CHIPS: readonly string[] = [];

/** @deprecated legacy type — use PackKind */
export type BuyPackKind = PackKind | "packet" | "bottle" | "kg" | "piece";

export type WizardSellOption = { label: string; priceUgx: string };

export function sellUnitLabel(kind: SellUnitKind, lang: Language): string {
  const row = SELL_UNIT_OPTIONS.find((o) => o.id === kind);
  return row ? t(lang, row.labelKey as "sellUnit_piece") : kind;
}

export function packKindLabel(kind: PackKind, custom: string, lang: Language): string {
  if (kind === "custom") return custom.trim() || t(lang, "packKind_custom");
  const row = PACK_TYPE_OPTIONS.find((o) => o.id === kind);
  return row ? t(lang, row.labelKey as "packKind_crate") : kind;
}

export function baseUnitFromSellKind(kind: SellUnitKind): string {
  return kind;
}

export function sellingModeFromSellKind(kind: SellUnitKind): SellingMode {
  return kind === "kg" || kind === "litre" ? "weighted" : "unit";
}

/** Cost per sell unit from what you paid for one full pack. */
export function wizardCostPerSellUnitUgx(packPriceUgx: number, piecesInside: number): number | null {
  if (packPriceUgx <= 0 || piecesInside <= 0) return null;
  return Math.floor(packPriceUgx / piecesInside);
}

export function profitPerSellUnitUgx(sellPriceUgx: number, costPerUnitUgx: number | null | undefined): number | null {
  if (sellPriceUgx <= 0 || costPerUnitUgx == null || costPerUnitUgx < 0) return null;
  return sellPriceUgx - costPerUnitUgx;
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

export type SimpleWizardInput = {
  name: string;
  shelf: string;
  sellUnit: SellUnitKind;
  hasPack: boolean;
  packKind: PackKind;
  packCustom: string;
  piecesPerPack: string;
  stockCount: string;
  sellPriceUgx: string;
  buyPackPriceUgx: string;
};

export function buildProductFromSimpleWizard(input: SimpleWizardInput, lang: Language): BuiltWizardProduct | null {
  const name = input.name.trim();
  if (!name) return null;

  const sellPrice = Math.floor(Number(input.sellPriceUgx.replace(/\D/g, "")) || 0);
  if (sellPrice <= 0) return null;

  const guess = inferFromProductName(name);
  const baseUnit = baseUnitFromSellKind(input.sellUnit);
  const sellingMode = sellingModeFromSellKind(input.sellUnit);

  const piecesPerPack = input.hasPack
    ? Math.max(1, Math.floor(Number(input.piecesPerPack.replace(/[^\d.]/g, "")) || 0))
    : 1;

  const stockInput = Math.max(0, Number(input.stockCount.replace(/[^\d.]/g, "")) || 0);
  const packLabel = input.hasPack ? packKindLabel(input.packKind, input.packCustom, lang).toLowerCase() : "";

  const stockQty = input.hasPack ? stockInput * piecesPerPack : stockInput;

  const buyPackPrice = Math.floor(Number(input.buyPackPriceUgx.replace(/\D/g, "")) || 0);
  const costPerUnit =
    input.hasPack && buyPackPrice > 0 && piecesPerPack > 0
      ? Math.floor(buyPackPrice / piecesPerPack)
      : undefined;

  const buyingUnit = input.hasPack && piecesPerPack > 1 ? packLabel : undefined;
  const conversionRate = input.hasPack && piecesPerPack > 1 ? piecesPerPack : undefined;

  const quickPresetsMoneyUgx: number[] = [sellPrice];
  const quickPresetsQty: number[] = [1];

  if (input.hasPack && piecesPerPack > 1) {
    const fullPackPrice = Math.round(sellPrice * piecesPerPack);
    quickPresetsMoneyUgx.push(fullPackPrice);
    quickPresetsQty.push(piecesPerPack);
  }

  return {
    name,
    priceUgx: sellPrice,
    stockQty,
    category: input.shelf.trim() || "General",
    sellingMode: guess.sellingMode === "weighted" && sellingMode === "unit" ? guess.sellingMode : sellingMode,
    baseUnit: guess.baseUnit && !input.hasPack ? guess.baseUnit : baseUnit,
    buyingUnit,
    conversionRate,
    costPricePerUnitUgx: costPerUnit,
    quickPresetsMoneyUgx,
    quickPresetsQty,
    inferName: name,
  };
}

/** @deprecated legacy builder — maps old wizard shape to new builder when possible */
export function buildProductFromLegacyWizard(
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
  const sellParsed = input.sellOptions
    .map((o) => ({
      price: Math.floor(Number(o.priceUgx.replace(/\D/g, "")) || 0),
    }))
    .filter((o) => o.price > 0);
  if (!sellParsed.length) return null;

  const sellUnit: SellUnitKind =
    input.buyHow === "kg" ? "kg" : input.buyHow === "bottle" ? "bottle" : input.buyHow === "packet" ? "packet" : "piece";

  const packKinds: PackKind[] = ["crate", "carton", "box", "sack", "pack", "tray", "bale", "custom"];
  const hasPack = packKinds.includes(input.buyHow as PackKind) && input.buyHow !== "piece" && input.buyHow !== "kg";

  return buildProductFromSimpleWizard(
    {
      name: input.name,
      shelf: input.shelf,
      sellUnit,
      hasPack,
      packKind: (packKinds.includes(input.buyHow as PackKind) ? input.buyHow : "custom") as PackKind,
      packCustom: input.buyCustom,
      piecesPerPack: input.piecesInside,
      stockCount: input.stockPacks,
      sellPriceUgx: String(sellParsed[0]!.price),
      buyPackPriceUgx: input.buyPackPriceUgx,
    },
    lang,
  );
}
