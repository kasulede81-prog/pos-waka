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
  /** Optional default expiry offset in days from today (starter onboarding). */
  defaultExpiryDaysFromNow?: number;
  /** Pharmacy: explicit buy price per unit (required for pharmacy starter apply). */
  defaultCostUgx?: number;
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
      defaultCostUgx: 320,
      defaultStock: 120,
      category: "Pain Relief",
      medicineStrength: "500mg",
      medicineForm: "Tablet",
      defaultExpiryDaysFromNow: 365,
    },
    {
      nameKey: "starterPharmacy_amox",
      inferName: "Amoxicillin",
      defaultPriceUgx: 1500,
      defaultCostUgx: 1100,
      defaultStock: 60,
      category: "Antibiotics",
      medicineStrength: "250mg",
      medicineForm: "Capsule",
      defaultExpiryDaysFromNow: 540,
    },
    {
      nameKey: "starterPharmacy_ibuprofen",
      inferName: "Ibuprofen",
      defaultPriceUgx: 800,
      defaultCostUgx: 520,
      defaultStock: 80,
      category: "Pain Relief",
      medicineStrength: "400mg",
      medicineForm: "Tablet",
      defaultExpiryDaysFromNow: 365,
    },
    {
      nameKey: "starterPharmacy_omeprazole",
      inferName: "Omeprazole",
      defaultPriceUgx: 1200,
      defaultCostUgx: 850,
      defaultStock: 48,
      category: "Hypertension",
      medicineStrength: "20mg",
      medicineForm: "Capsule",
      defaultExpiryDaysFromNow: 540,
    },
    {
      nameKey: "starterPharmacy_metronidazole",
      inferName: "Metronidazole",
      defaultPriceUgx: 900,
      defaultCostUgx: 620,
      defaultStock: 40,
      category: "Antibiotics",
      medicineStrength: "400mg",
      medicineForm: "Tablet",
      defaultExpiryDaysFromNow: 365,
    },
    {
      nameKey: "starterPharmacy_vitc",
      inferName: "Vitamin C",
      defaultPriceUgx: 600,
      defaultCostUgx: 400,
      defaultStock: 72,
      category: "Vitamins",
      medicineStrength: "1000mg",
      medicineForm: "Tablet",
      defaultExpiryDaysFromNow: 730,
    },
    {
      nameKey: "starterPharmacy_diclofenac",
      inferName: "Diclofenac",
      defaultPriceUgx: 700,
      defaultCostUgx: 480,
      defaultStock: 60,
      category: "Pain Relief",
      medicineStrength: "50mg",
      medicineForm: "Tablet",
      defaultExpiryDaysFromNow: 365,
    },
    {
      nameKey: "starterPharmacy_cetirizine",
      inferName: "Cetirizine",
      defaultPriceUgx: 500,
      defaultCostUgx: 330,
      defaultStock: 48,
      category: "Cough & Cold",
      medicineStrength: "10mg",
      medicineForm: "Tablet",
      defaultExpiryDaysFromNow: 540,
    },
    {
      nameKey: "starterPharmacy_ors",
      inferName: "ORS",
      defaultPriceUgx: 1000,
      defaultCostUgx: 700,
      defaultStock: 40,
      category: "First Aid",
      medicineForm: "Other",
      defaultExpiryDaysFromNow: 730,
    },
    {
      nameKey: "starterPharmacy_artemether",
      inferName: "Artemether-Lumefantrine",
      defaultPriceUgx: 5000,
      defaultCostUgx: 3800,
      defaultStock: 24,
      category: "Malaria",
      medicineStrength: "20/120mg",
      medicineForm: "Tablet",
      defaultExpiryDaysFromNow: 540,
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

  const restaurantBar: StarterLine[] = [
    { nameKey: "starterRestaurantBar_pilau", inferName: "pilau", defaultPriceUgx: 8000, defaultStock: 0, sellingMode: "unit", baseUnit: "ea", category: "Food" },
    { nameKey: "starterRestaurantBar_rice", inferName: "rice", defaultPriceUgx: 3000, defaultStock: 0, sellingMode: "unit", baseUnit: "ea", category: "Food" },
    { nameKey: "starterRestaurantBar_chicken", inferName: "chicken", defaultPriceUgx: 12000, defaultStock: 0, sellingMode: "unit", baseUnit: "ea", category: "Food" },
    { nameKey: "starterRestaurantBar_chips", inferName: "chips", defaultPriceUgx: 5000, defaultStock: 0, sellingMode: "unit", baseUnit: "ea", category: "Food" },
    { nameKey: "starterRestaurantBar_chapati", inferName: "chapati", defaultPriceUgx: 1000, defaultStock: 0, sellingMode: "unit", baseUnit: "ea", category: "Food" },
    { nameKey: "starterBar_nileSpecial", inferName: "Nile Special", defaultPriceUgx: 3500, defaultStock: 48, sellingMode: "unit", baseUnit: "ea", category: "Beer" },
    { nameKey: "starterItem_soda", inferName: "soda", defaultPriceUgx: 1500, defaultStock: 36, sellingMode: "unit", baseUnit: "ea", category: "Soft drinks" },
    { nameKey: "starterRestaurantBar_juice", inferName: "fresh juice", defaultPriceUgx: 3000, defaultStock: 12, sellingMode: "unit", baseUnit: "ea", category: "Drinks" },
    { nameKey: "starterItem_water", inferName: "water", defaultPriceUgx: 1000, defaultStock: 24, sellingMode: "unit", baseUnit: "ea", category: "Drinks" },
    { nameKey: "starterBar_waragi", inferName: "waragi", defaultPriceUgx: 2000, defaultStock: 24, sellingMode: "unit", baseUnit: "ea", category: "Spirits" },
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
    {
      nameKey: "starterWholesale_rice25",
      inferName: "Rice 25kg Bag",
      defaultPriceUgx: 95_000,
      defaultStock: 40,
      sellingMode: "weighted",
      baseUnit: "kg",
      category: "Grains",
    },
    {
      nameKey: "starterWholesale_rice50",
      inferName: "Rice 50kg Bag",
      defaultPriceUgx: 185_000,
      defaultStock: 25,
      sellingMode: "weighted",
      baseUnit: "kg",
      category: "Grains",
    },
    {
      nameKey: "starterWholesale_sugar50",
      inferName: "Sugar 50kg Sack",
      defaultPriceUgx: 210_000,
      defaultStock: 18,
      sellingMode: "weighted",
      baseUnit: "kg",
      category: "Sugar & Flour",
    },
    {
      nameKey: "starterWholesale_oilCarton",
      inferName: "Cooking Oil Carton",
      defaultPriceUgx: 240_000,
      defaultStock: 24,
      sellingMode: "unit",
      baseUnit: "bottle",
      category: "Edible Oil",
    },
    {
      nameKey: "starterWholesale_softDrinkCrate",
      inferName: "Soft Drink Crate",
      defaultPriceUgx: 42_000,
      defaultStock: 30,
      sellingMode: "unit",
      baseUnit: "bottle",
      category: "Beverage Crates",
    },
    {
      nameKey: "starterWholesale_waterCase",
      inferName: "Water Case",
      defaultPriceUgx: 18_000,
      defaultStock: 30,
      sellingMode: "unit",
      baseUnit: "bottle",
      category: "Beverage Crates",
    },
    {
      nameKey: "starterWholesale_soapCarton",
      inferName: "Laundry Soap Carton",
      defaultPriceUgx: 78_000,
      defaultStock: 20,
      sellingMode: "unit",
      baseUnit: "piece",
      category: "Home Care",
    },
    {
      nameKey: "starterWholesale_detergentCarton",
      inferName: "Detergent Carton",
      defaultPriceUgx: 132_000,
      defaultStock: 20,
      sellingMode: "unit",
      baseUnit: "pack",
      category: "Home Care",
    },
    {
      nameKey: "starterWholesale_biscuitsCarton",
      inferName: "Biscuits Carton",
      defaultPriceUgx: 64_000,
      defaultStock: 25,
      sellingMode: "unit",
      baseUnit: "pack",
      category: "Snacks",
    },
    {
      nameKey: "starterWholesale_saltBag",
      inferName: "Salt Bag",
      defaultPriceUgx: 68_000,
      defaultStock: 25,
      sellingMode: "weighted",
      baseUnit: "kg",
      category: "Salt",
    },
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
      return bar;
    case "restaurant_bar":
      return restaurantBar;
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

/** ISO date YYYY-MM-DD for starter expiry defaults. */
export function starterExpiryDateIso(daysFromNow: number, now: Date = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() + Math.max(0, daysFromNow));
  return d.toISOString().slice(0, 10);
}
