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
  category?: string;
  medicineStrength?: string;
  medicineForm?: string;
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

  const pharmacy: StarterLine[] = [
    {
      nameKey: "starterPharmacy_paracetamol",
      inferName: "Paracetamol",
      defaultPriceUgx: 500,
      defaultStock: 120,
      category: "Pain Relief",
      medicineStrength: "500mg",
      medicineForm: "Tablet",
    },
    {
      nameKey: "starterPharmacy_amox",
      inferName: "Amoxicillin",
      defaultPriceUgx: 1500,
      defaultStock: 60,
      category: "Antibiotics",
      medicineStrength: "500mg",
      medicineForm: "Capsule",
    },
    {
      nameKey: "starterPharmacy_ors",
      inferName: "ORS",
      defaultPriceUgx: 1000,
      defaultStock: 40,
      category: "First Aid",
      medicineForm: "Other",
    },
    {
      nameKey: "starterPharmacy_artemether",
      inferName: "Artemether-Lumefantrine",
      defaultPriceUgx: 5000,
      defaultStock: 24,
      category: "Malaria",
      medicineStrength: "20/120mg",
      medicineForm: "Tablet",
    },
  ];

  const restaurant: StarterLine[] = [
    { nameKey: "starterRestaurant_pilau", inferName: "pilau", defaultPriceUgx: 8000, defaultStock: 0, sellingMode: "unit", baseUnit: "ea", category: "Main" },
    { nameKey: "starterRestaurant_chapati", inferName: "chapati", defaultPriceUgx: 1000, defaultStock: 0, sellingMode: "unit", baseUnit: "ea", category: "Main" },
    { nameKey: "starterItem_soda", inferName: "soda", defaultPriceUgx: 1500, defaultStock: 24, sellingMode: "unit", baseUnit: "ea", category: "Drinks" },
    { nameKey: "starterItem_water", inferName: "water", defaultPriceUgx: 1000, defaultStock: 24, sellingMode: "unit", baseUnit: "ea", category: "Drinks" },
  ];

  const bar: StarterLine[] = [
    { nameKey: "starterBar_nileSpecial", inferName: "Nile Special", defaultPriceUgx: 3500, defaultStock: 48, sellingMode: "unit", baseUnit: "ea", category: "Beer" },
    { nameKey: "starterBar_bellLager", inferName: "Bell Lager", defaultPriceUgx: 3500, defaultStock: 48, sellingMode: "unit", baseUnit: "ea", category: "Beer" },
    { nameKey: "starterBar_waragi", inferName: "waragi", defaultPriceUgx: 2000, defaultStock: 24, sellingMode: "unit", baseUnit: "ea", category: "Spirits" },
    { nameKey: "starterItem_soda", inferName: "soda", defaultPriceUgx: 1500, defaultStock: 36, sellingMode: "unit", baseUnit: "ea", category: "Soft drinks" },
  ];

  const electronics: StarterLine[] = [
    { nameKey: "starterElectronics_charger", inferName: "phone charger", defaultPriceUgx: 15000, defaultStock: 12, sellingMode: "unit", baseUnit: "ea", category: "Accessories" },
    { nameKey: "starterElectronics_earphones", inferName: "earphones", defaultPriceUgx: 12000, defaultStock: 15, sellingMode: "unit", baseUnit: "ea", category: "Accessories" },
    { nameKey: "starterElectronics_smartphone", inferName: "smartphone", defaultPriceUgx: 350000, defaultStock: 3, sellingMode: "unit", baseUnit: "ea", category: "Phones" },
    { nameKey: "starterElectronics_powerBank", inferName: "power bank", defaultPriceUgx: 45000, defaultStock: 6, sellingMode: "unit", baseUnit: "ea", category: "Accessories" },
  ];

  const boutique: StarterLine[] = [
    { nameKey: "starterBoutique_dress", inferName: "dress", defaultPriceUgx: 45000, defaultStock: 8, sellingMode: "unit", baseUnit: "ea", category: "Women" },
    { nameKey: "starterBoutique_tShirt", inferName: "t-shirt", defaultPriceUgx: 25000, defaultStock: 12, sellingMode: "unit", baseUnit: "ea", category: "Unisex" },
    { nameKey: "starterBoutique_shoes", inferName: "shoes", defaultPriceUgx: 55000, defaultStock: 6, sellingMode: "unit", baseUnit: "ea", category: "Footwear" },
    { nameKey: "starterBoutique_handbag", inferName: "handbag", defaultPriceUgx: 35000, defaultStock: 5, sellingMode: "unit", baseUnit: "ea", category: "Accessories" },
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
      return hardware;
    case "electronics":
      return electronics;
    case "salon":
      return salon;
    case "pharmacy":
      return pharmacy;
    case "boutique":
      return boutique;
    case "wholesale":
    case "mini_supermarket":
      return wholesale;
    case "restaurant":
      return restaurant;
    case "bar":
    case "restaurant_bar":
      return bar;
    case "hotel":
      return [...restaurant, ...bar.slice(0, 2)];
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
