import type { BusinessType, SellingMode } from "../types";

export type StarterLine = {
  /** i18n key: starterItem_sugar */
  nameKey: string;
  /** English hint for smart presets (name shown is translated) */
  inferName: string;
  defaultPriceUgx: number;
  defaultStock: number;
  sellingMode?: SellingMode;
  baseUnit?: string;
};

export function starterPackForBusinessType(bt: BusinessType): StarterLine[] {
  const kiosk: StarterLine[] = [
    { nameKey: "starterItem_sugar", inferName: "sugar", defaultPriceUgx: 3500, defaultStock: 20, sellingMode: "weighted", baseUnit: "kg" },
    { nameKey: "starterItem_rice", inferName: "rice", defaultPriceUgx: 4500, defaultStock: 25, sellingMode: "weighted", baseUnit: "kg" },
    { nameKey: "starterItem_oil", inferName: "cooking oil", defaultPriceUgx: 10000, defaultStock: 10, sellingMode: "portion", baseUnit: "litre" },
    { nameKey: "starterItem_salt", inferName: "salt", defaultPriceUgx: 1500, defaultStock: 15, sellingMode: "weighted", baseUnit: "kg" },
    { nameKey: "starterItem_soap", inferName: "soap", defaultPriceUgx: 3500, defaultStock: 24, sellingMode: "unit", baseUnit: "ea" },
    { nameKey: "starterItem_bread", inferName: "bread", defaultPriceUgx: 2000, defaultStock: 30, sellingMode: "unit", baseUnit: "ea" },
    { nameKey: "starterItem_soda", inferName: "soda", defaultPriceUgx: 1500, defaultStock: 48, sellingMode: "unit", baseUnit: "ea" },
    { nameKey: "starterItem_water", inferName: "water", defaultPriceUgx: 1000, defaultStock: 36, sellingMode: "unit", baseUnit: "ea" },
    { nameKey: "starterItem_airtime", inferName: "airtime", defaultPriceUgx: 1000, defaultStock: 0, sellingMode: "unit", baseUnit: "ea" },
  ];

  const hardware: StarterLine[] = [
    { nameKey: "starterItem_cement", inferName: "cement", defaultPriceUgx: 32000, defaultStock: 10, sellingMode: "weighted", baseUnit: "kg" },
    { nameKey: "starterItem_nails", inferName: "nails", defaultPriceUgx: 5000, defaultStock: 20, sellingMode: "unit", baseUnit: "ea" },
    { nameKey: "starterItem_pipes", inferName: "pipes", defaultPriceUgx: 8000, defaultStock: 15, sellingMode: "unit", baseUnit: "ea" },
    { nameKey: "starterItem_paint", inferName: "paint", defaultPriceUgx: 25000, defaultStock: 8, sellingMode: "unit", baseUnit: "ea" },
  ];

  const salon: StarterLine[] = [
    { nameKey: "starterItem_hair_food", inferName: "hair food", defaultPriceUgx: 8000, defaultStock: 6, sellingMode: "unit", baseUnit: "ea" },
    { nameKey: "starterItem_shampoo", inferName: "shampoo", defaultPriceUgx: 12000, defaultStock: 8, sellingMode: "unit", baseUnit: "ea" },
    { nameKey: "starterItem_relaxer", inferName: "relaxer", defaultPriceUgx: 15000, defaultStock: 5, sellingMode: "unit", baseUnit: "ea" },
    { nameKey: "starterItem_hair_cut", inferName: "hair cut", defaultPriceUgx: 10000, defaultStock: 0, sellingMode: "unit", baseUnit: "ea" },
  ];

  const wholesale: StarterLine[] = [
    ...kiosk,
    { nameKey: "starterItem_posho", inferName: "posho", defaultPriceUgx: 3200, defaultStock: 50, sellingMode: "weighted", baseUnit: "kg" },
  ];

  switch (bt) {
    case "hardware":
    case "electronics":
      return hardware;
    case "salon":
      return salon;
    case "wholesale":
    case "mini_supermarket":
    case "boutique":
    case "pharmacy":
      return wholesale;
    case "restaurant":
      return [
        { nameKey: "starterItem_rice", inferName: "rice", defaultPriceUgx: 5000, defaultStock: 20, sellingMode: "weighted", baseUnit: "kg" },
        { nameKey: "starterItem_oil", inferName: "cooking oil", defaultPriceUgx: 10000, defaultStock: 8, sellingMode: "portion", baseUnit: "litre" },
        { nameKey: "starterItem_soda", inferName: "soda", defaultPriceUgx: 1500, defaultStock: 24, sellingMode: "unit", baseUnit: "ea" },
        { nameKey: "starterItem_water", inferName: "water", defaultPriceUgx: 1000, defaultStock: 24, sellingMode: "unit", baseUnit: "ea" },
      ];
    case "mobile_money_agent":
      return [
        { nameKey: "starterItem_airtime", inferName: "airtime", defaultPriceUgx: 500, defaultStock: 0, sellingMode: "unit", baseUnit: "ea" },
        { nameKey: "starterItem_withdraw", inferName: "withdraw fee", defaultPriceUgx: 0, defaultStock: 0, sellingMode: "unit", baseUnit: "ea" },
      ];
    case "kiosk_duka":
    case "produce_market":
    case "other":
    default:
      return kiosk;
  }
}
