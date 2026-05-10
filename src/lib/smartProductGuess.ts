import type { SellingMode } from "../types";

export type SmartGuess = {
  sellingMode: SellingMode;
  baseUnit: string;
  buyingUnit: string | null;
  conversionRate: number | null;
  quickPresetsMoneyUgx: number[];
  quickPresetsQty: number[];
};

/** Guess units + tap buttons from common Uganda kiosk / shop names (English + a few local spellings). */
export function inferFromProductName(raw: string): SmartGuess {
  const n = raw.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

  const portionOil =
    /\b(oil|mafuta|cooking|vegetable|paraffin|keros|kerosene|fuel)\b/.test(n) && !/\bsoap\b/.test(n);
  const weightedDry =
    /\b(sugar|sukari|sukali|rice|posho|maize|beans|gnuts|groundnut|flour|salt|cement|charcoal|makoko)\b/.test(n);
  const unitPack =
    /\b(soda|water|bread|soap|airtime|scratch|card|battery|candle|toothpaste|tablet|phone|charger|cable|bulb|lock|padlock)\b/.test(n);
  const hardwareLen =
    /\b(nail|pipe|wire|cable|chain|hinge|handle|rope|twine|sheet|iron|bar|rod|timber|wood|plank)\b/.test(n);
  const paint = /\b(paint|varnish|thinner)\b/.test(n);
  const salonProduct =
    /\b(shampoo|relaxer|conditioner|hairfood|hair food|weave|braid|gel|spray|dye|hair)\b/.test(n) &&
    !/\b(bread|oil)\b/.test(n);
  const serviceItem = /\b(cut|style|wash|perm|manicure|pedicure|shave|withdraw|deposit|commission)\b/.test(n);

  if (portionOil) {
    return {
      sellingMode: "portion",
      baseUnit: "litre",
      buyingUnit: "20L jerrican",
      conversionRate: 20,
      quickPresetsMoneyUgx: [500, 1000, 2000],
      quickPresetsQty: [0.5, 1, 2],
    };
  }
  if (weightedDry && !/\b(oil|soap)\b/.test(n)) {
    return {
      sellingMode: "weighted",
      baseUnit: "kg",
      buyingUnit: null,
      conversionRate: null,
      quickPresetsMoneyUgx: [3500, 7000, 17500],
      quickPresetsQty: [1, 2, 5],
    };
  }
  if (/\b(cement)\b/.test(n)) {
    return {
      sellingMode: "weighted",
      baseUnit: "kg",
      buyingUnit: "50kg bag",
      conversionRate: 50,
      quickPresetsQty: [1, 2, 5],
      quickPresetsMoneyUgx: [35000, 70000, 120000],
    };
  }
  if (hardwareLen || paint) {
    return {
      sellingMode: "unit",
      baseUnit: "ea",
      buyingUnit: null,
      conversionRate: null,
      quickPresetsMoneyUgx: [500, 1000, 5000],
      quickPresetsQty: [1, 2, 5],
    };
  }
  if (salonProduct || serviceItem) {
    return {
      sellingMode: "unit",
      baseUnit: "ea",
      buyingUnit: null,
      conversionRate: null,
      quickPresetsMoneyUgx: [5000, 10000, 20000],
      quickPresetsQty: [1, 1, 1],
    };
  }
  if (unitPack || /\b(milk|juice|yoghurt|yogurt)\b/.test(n)) {
    return {
      sellingMode: "unit",
      baseUnit: "ea",
      buyingUnit: null,
      conversionRate: null,
      quickPresetsMoneyUgx: [500, 1000, 2000],
      quickPresetsQty: [1, 2, 4],
    };
  }

  return {
    sellingMode: "unit",
    baseUnit: "ea",
    buyingUnit: null,
    conversionRate: null,
    quickPresetsMoneyUgx: [1000, 2000, 5000],
    quickPresetsQty: [1, 2, 3],
  };
}
