/**
 * Marketing website content — pricing and plan details align with
 * subscriptionPricing.ts and public PricingPage. Hardware prices from Waka POS brochure.
 */
import type { PaidPlanCode } from "../lib/subscriptionPricing";
import { CANONICAL_PLAN_PRICES, computePlanDisplayPrice } from "../lib/subscriptionPricing";

export const MARKETING_HARDWARE_PACKAGES = [
  {
    id: "complete",
    name: "Complete POS System",
    priceUgx: 780_000,
    priceLabel: "UGX 780,000",
    badge: "Full terminal setup",
    includes: ["POS Terminal", "Receipt Printer", "Cash Drawer", "1 Year License"],
  },
  {
    id: "tablet",
    name: "Tablet POS Package",
    priceUgx: 480_000,
    priceLabel: "UGX 480,000",
    badge: "Counter-ready",
    includes: ["Tablet", "Printer", "POS Software", "1 Year License"],
  },
  {
    id: "software",
    name: "Software Only",
    priceUgx: 180_000,
    priceLabel: "UGX 180,000 / year",
    badge: "Bring your own device",
    includes: ["Installation FREE", "Works on Phone", "Tablet", "Desktop", "Laptop"],
  },
] as const;

export type MarketingPlanCode = PaidPlanCode | "free";

export type MarketingPlan = {
  code: MarketingPlanCode;
  name: string;
  monthlyUgx: number;
  annualUgx: number;
  blurb: string;
  features: string[];
  limits: string[];
  goodFor: string;
  popular?: boolean;
};

const starterPrice = computePlanDisplayPrice("starter", { monthlyDiscountType: "none", monthlyDiscountValue: 0 });
const businessPrice = computePlanDisplayPrice("business", { monthlyDiscountType: "none", monthlyDiscountValue: 0 });
const wakaPlusPrice = computePlanDisplayPrice("waka_plus", { monthlyDiscountType: "none", monthlyDiscountValue: 0 });

/** Subscription plans — no AI features in public marketing. */
export const MARKETING_PLANS: MarketingPlan[] = [
  {
    code: "free",
    name: "Free",
    monthlyUgx: 0,
    annualUgx: 0,
    blurb: "Perfect for trying Waka POS and running a very small shop.",
    features: [
      "Sales & Checkout",
      "Inventory Management",
      "Customer Management",
      "Debt Tracking",
      "Receipts",
      "Offline Mode",
      "Basic Reports",
    ],
    limits: ["1 Device", "1 User", "Up to 7 Products"],
    goodFor: "Testing, kiosks, startups, very small shops",
  },
  {
    code: "starter",
    name: "Starter",
    monthlyUgx: starterPrice.finalMonthlyUgx,
    annualUgx: starterPrice.finalAnnualUgx,
    blurb: "For owners who run the shop themselves.",
    features: [
      "Unlimited Products",
      "Supplier Management",
      "Purchase Tracking",
      "Expense Tracking",
      "Profit Reports",
      "Advanced Reports",
      "Customer Debt Management",
      "Supplier Payments",
      "Inventory Counts",
      "Backup & Restore",
      "Cloud Sync",
      "Stock Movement Tracking",
      "Daily Business Reports",
    ],
    limits: ["1 Device", "2 Users", "2 Staff Accounts"],
    goodFor: "Boutiques, salons, groceries, pharmacies, mini markets",
  },
  {
    code: "business",
    name: "Business",
    monthlyUgx: businessPrice.finalMonthlyUgx,
    annualUgx: businessPrice.finalAnnualUgx,
    blurb: "For growing businesses with employees.",
    popular: true,
    features: [
      "Everything in Starter",
      "Staff Accounts",
      "Staff Switching",
      "Owner Dashboard",
      "Cash Drawer Management",
      "Day Open & Day Close",
      "Shift Management",
      "Opening Float Verification",
      "Cash Reconciliation",
      "Returns & Refunds",
      "Activity Logs",
      "Audit Center",
      "Role Permissions",
      "Multi-Device Sync",
      "Inventory Count Approval Workflow",
      "Staff Accountability Tracking",
      "Cash History",
      "Business Analytics",
    ],
    limits: ["Up to 4 Devices", "Up to 4 Staff Accounts"],
    goodFor: "Supermarkets, hardware stores, pharmacies, businesses with employees",
  },
  {
    code: "waka_plus",
    name: "Waka Plus",
    monthlyUgx: wakaPlusPrice.finalMonthlyUgx,
    annualUgx: wakaPlusPrice.finalAnnualUgx,
    blurb: "For wholesalers and larger businesses.",
    features: [
      "Everything in Business",
      "Up to 10 Devices",
      "Up to 10 Staff Accounts",
      "Multi-Shop Support",
      "Advanced Backups",
      "Cloud Recovery",
      "Priority Support",
      "Advanced Audit Center",
      "Operational Analytics",
      "Cash Control Dashboard",
      "Inventory Intelligence",
      "Business Performance Insights",
      "Early Access Features",
    ],
    limits: ["Up to 10 Devices", "Up to 10 Staff Accounts"],
    goodFor: "Wholesalers, distributors, chain stores, multi-branch businesses",
  },
];

export const MARKETING_TRUST_PILLARS = [
  { icon: "offline" as const, title: "Offline First", body: "Keep selling when the network drops." },
  { icon: "cloud" as const, title: "Cloud Sync", body: "Your data is backed up when online." },
  { icon: "support" as const, title: "Local Support", body: "WhatsApp and email from Kampala." },
  { icon: "devices" as const, title: "Multi Device", body: "Phone, tablet, laptop, or terminal." },
  { icon: "reports" as const, title: "Daily Reports", body: "See sales and stock at a glance." },
  { icon: "secure" as const, title: "Secure Backups", body: "Restore when you change devices." },
];

export const MARKETING_BUSINESS_TYPES = [
  { slug: "retail-pos-uganda", label: "Retail Shops", icon: "🛍️" },
  { slug: "retail-pos-uganda", label: "Mini Markets", icon: "🏪" },
  { slug: "supermarket-pos-uganda", label: "Supermarkets", icon: "🛒" },
  { slug: "restaurant-pos-uganda", label: "Restaurants", icon: "🍽️" },
  { slug: "restaurant-pos-uganda", label: "Bars", icon: "🍹" },
  { slug: "retail-pos-uganda", label: "Hardware", icon: "🔧" },
  { slug: "pharmacy-pos-uganda", label: "Pharmacies", icon: "💊" },
  { slug: "retail-pos-uganda", label: "Salons", icon: "💇" },
  { slug: "retail-pos-uganda", label: "Boutiques", icon: "👗" },
  { slug: "inventory-management-uganda", label: "Wholesale", icon: "📦" },
];

export const MARKETING_FEATURES = [
  { title: "Sales & Checkout", body: "Fast sell screen for busy counters.", icon: "🛒" },
  { title: "Inventory Management", body: "Track stock, shelves, and movements.", icon: "📦" },
  { title: "Debt Management", body: "Customer credit and payments in one place.", icon: "💳" },
  { title: "Expenses Tracking", body: "Record cash expenses from the shop.", icon: "💸" },
  { title: "Reports & Analytics", body: "Daily summaries and business analytics.", icon: "📊" },
  { title: "Receipts & Invoices", body: "Print or share professional receipts.", icon: "🧾" },
  { title: "Purchase Tracking", body: "Record supplier purchases and costs.", icon: "🚚" },
  { title: "Supplier Management", body: "Suppliers, balances, and restock.", icon: "🏭" },
  { title: "Cash Drawer", body: "Opening float, shifts, and reconciliation.", icon: "💰" },
  { title: "Customers", body: "Directory with balances and history.", icon: "👥" },
  { title: "Barcode Scanning", body: "Keyboard wedge and camera scan support.", icon: "📷" },
  { title: "Staff Management", body: "PIN accounts with role permissions.", icon: "👤" },
  { title: "Returns & Refunds", body: "Handle returns with clear records.", icon: "↩️" },
  { title: "Stock Counts", body: "Inventory counts with approval workflow.", icon: "🔢" },
  { title: "Offline Mode", body: "Sell without internet; sync later.", icon: "📴" },
  { title: "Cloud Sync", body: "Multi-device sync and cloud backup.", icon: "☁️" },
  { title: "Daily Reports", body: "Close the day with clear totals.", icon: "📅" },
  { title: "Role Permissions", body: "Control who can sell, stock, or view profit.", icon: "🔐" },
  { title: "Audit Logs", body: "Activity and investigation center.", icon: "🔍" },
  { title: "Business Analytics", body: "Owner dashboard and performance insights.", icon: "📈" },
];

export const MARKETING_COMPARISON_ROWS = [
  { topic: "Inventory tracking", traditional: "Notebooks & memory", waka: "Live stock with alerts" },
  { topic: "Reports", traditional: "Manual tallies at night", waka: "Daily reports & analytics" },
  { topic: "Receipts", traditional: "Handwritten or none", waka: "Print or share instantly" },
  { topic: "Cloud backup", traditional: "Risk if device is lost", waka: "Sync & restore from cloud" },
  { topic: "Offline selling", traditional: "Stops when network fails", waka: "Offline-first POS" },
  { topic: "Debt tracking", traditional: "Scattered notebooks", waka: "Customer balances in-app" },
  { topic: "Returns", traditional: "Hard to reconcile", waka: "Recorded refunds & stock" },
  { topic: "Stock counts", traditional: "Long manual counts", waka: "Guided inventory counts" },
  { topic: "Checkout speed", traditional: "Slow mental math", waka: "Fast tap-to-sell flow" },
];

export const MARKETING_TESTIMONIALS = [
  {
    name: "Sarah N.",
    business: "Mini market · Kampala",
    quote: "We moved from notebooks to Waka POS in one week. Stock and debts are finally clear.",
    rating: 5,
  },
  {
    name: "James K.",
    business: "Hardware shop · Wakiso",
    quote: "Offline mode saved us during power cuts. Sales still go through and sync when data returns.",
    rating: 5,
  },
  {
    name: "Dr. Amina M.",
    business: "Pharmacy · Entebbe",
    quote: "Expiry alerts and pharmacy mode help us dispense safely without slowing the queue.",
    rating: 5,
  },
  {
    name: "Robert O.",
    business: "Restaurant · Jinja",
    quote: "Staff switching and shift close made cash control much easier for our team.",
    rating: 5,
  },
  {
    name: "Grace T.",
    business: "Salon · Mukono",
    quote: "Simple enough for my team, powerful enough for me to see profit at the end of the day.",
    rating: 5,
  },
];

export const MARKETING_FAQ = [
  {
    q: "Does Waka POS work offline?",
    a: "Yes. Waka POS is offline-first. You can record sales, adjust stock, and manage debts without internet. Data syncs when you are back online.",
  },
  {
    q: "How does cloud sync work?",
    a: "When your device has internet, Waka POS uploads pending sales and downloads updates securely. You can also back up and restore from the cloud.",
  },
  {
    q: "Do you help with installation?",
    a: "Software-only installation is free. For hardware packages, our team helps you set up terminals, printers, and cash drawers.",
  },
  {
    q: "What hardware do you sell?",
    a: "We offer complete POS terminals, tablet packages, or software-only plans that run on phones, tablets, laptops, and desktops you already own.",
  },
  {
    q: "Which payment methods are supported?",
    a: "Cash, mobile money, card-style flows, credit/debt, and mixed payments — depending on how your shop sells.",
  },
  {
    q: "How do I get support?",
    a: "Reach us on WhatsApp, email, or visit our Kampala office during working hours. Business and Waka Plus plans include priority support.",
  },
  {
    q: "Can I start for free?",
    a: "Yes. The Free plan includes sales, inventory, debts, receipts, offline mode, and basic reports for up to 7 products on one device.",
  },
];

export function formatMarketingUgx(amount: number): string {
  return `UGX ${amount.toLocaleString("en-UG")}`;
}

/** Verify canonical prices match marketing display. */
export function assertMarketingPricingIntegrity(): void {
  for (const row of CANONICAL_PLAN_PRICES) {
    const plan = MARKETING_PLANS.find((p) => p.code === row.planCode);
    if (!plan || plan.monthlyUgx !== row.monthlyPriceUgx) {
      throw new Error(`Marketing plan price mismatch for ${row.planCode}`);
    }
  }
}
