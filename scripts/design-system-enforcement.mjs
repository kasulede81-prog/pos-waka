#!/usr/bin/env node
/**
 * Phase 22.6 + Phase 29.1 — Design system enforcement scanner + premium polish adoption metrics.
 * Run: npm run design-system:check
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const SRC = join(ROOT, "src");

const POS_DENSITY_ALLOW = [
  "posShelfLayout.ts",
  "displayScale",
  "EnterprisePinPad.tsx",
  "PosShelfTile.tsx",
  "PosSellProductCard.tsx",
  "pos/",
  "components/pos/",
];

const HIGH_TRAFFIC_PATHS = [
  "pages/OwnerDashboardPage.tsx",
  "pages/StockPage.tsx",
  "pages/CustomersPage.tsx",
  "pages/InventoryPurchasingPage.tsx",
  "pages/SettingsHubPage.tsx",
  "pages/OfficeHubPage.tsx",
  "pages/StaffAccessPage.tsx",
  "pages/DeviceManagementPage.tsx",
  "pages/CashManagementPage.tsx",
  "pages/CashExpensesPage.tsx",
  "pages/SupplierDetailPage.tsx",
  "pages/ReportsPage.tsx",
  "pages/HospitalityDashboardPage.tsx",
  "pages/PharmacyDashboardPage.tsx",
  "features/inventory-purchasing/",
  "components/debts/",
  "components/stock/InventoryStatGrid.tsx",
  "components/office/OfficeNav",
  "components/command-center/",
];

const BUSINESS_WORKSPACE_PATHS = [
  "features/inventory-purchasing/components/SuppliersTab.tsx",
  "pages/SupplierDetailPage.tsx",
  "pages/CashExpensesPage.tsx",
  "pages/CashManagementPage.tsx",
  "pages/StockPage.tsx",
  "components/command-center/",
];

const RULES = [
  {
    id: "fractional-typography",
    pattern: /text-\[(8|9|10|11|13|15|17|18|22)px\]/g,
    message: "Use enterpriseTypeClass or EnterpriseTypography components",
  },
  {
    id: "inline-waka-cta",
    pattern: /\bbg-waka-600\b.*\bmin-h-\[(36|40|44|48|52|56)px\]/g,
    message: "Use WakaButton variant primary",
  },
  {
    id: "custom-page-wrapper",
    pattern: /className="space-y-5 pb-8"/g,
    message: "Use EnterprisePageContainer",
  },
  {
    id: "raw-desktop-table",
    pattern: /<table className="min-w-full text-left text-sm"/g,
    message: "Use EnterpriseResponsiveTable or ResponsiveDataTable",
  },
  {
    id: "legacy-page-title",
    pattern: /className="[^"]*text-xl font-black[^"]*"/g,
    message: "Use EnterprisePageHeader or PageTitle typography",
  },
  {
    id: "inline-rose-badge",
    pattern: /bg-rose-100 text-rose-9/g,
    message: "Use statusTokens.danger for badges",
  },
  {
    id: "module-spectacle-palette",
    pattern: /\bborder-(emerald|violet|purple|fuchsia|indigo)-[0-9]{2,3}\b.*\bbg-(emerald|violet|purple|fuchsia|indigo)-/g,
    message: "Personality unification: use statusTokens / EnterpriseKpiCard tones (not module-specific spectacle palettes)",
  },
  {
    id: "truncated-waka-shade",
    pattern: /\b(bg|text|border|from|to|via|ring)-waka-(?![0-9]|50\b|950\b)/g,
    message: "Incomplete waka-* shade (e.g. bg-waka- without 50–950) — restore full Tailwind class",
  },
  {
    id: "palette-typo-muted0",
    pattern: /\b(bg|text|border)-(success|warning|danger|info)-muted0\b/g,
    message: "Palette replace typo (*-muted0) — use *-muted or solid token",
  },
  {
    id: "adhoc-card-shell",
    pattern: /rounded-3xl border(?:-2)? border-(?:border|emerald|violet|amber|rose)/g,
    message: "Prefer EnterpriseCard / themeUi.surface for production cards",
  },
];

const ADOPTION_SIGNALS = [
  { id: "enterprise-page-container", pattern: /EnterprisePageContainer/g, label: "EnterprisePageContainer" },
  { id: "enterprise-page-header", pattern: /EnterprisePageHeader/g, label: "EnterprisePageHeader" },
  { id: "waka-button", pattern: /\bWakaButton\b/g, label: "WakaButton" },
  { id: "enterprise-type-class", pattern: /enterpriseTypeClass\(/g, label: "enterpriseTypeClass" },
  { id: "enterprise-typography", pattern: /EnterpriseTypography|PageTitle|SectionTitle|MonoNumber|Caption/g, label: "EnterpriseTypography" },
  { id: "enterprise-card", pattern: /\bEnterpriseCard\b/g, label: "EnterpriseCard" },
  { id: "enterprise-kpi", pattern: /\bEnterpriseKpiCard\b/g, label: "EnterpriseKpiCard" },
  { id: "enterprise-table", pattern: /EnterpriseResponsiveTable/g, label: "EnterpriseResponsiveTable" },
  { id: "enterprise-form", pattern: /\bEnterpriseTextField\b/g, label: "EnterpriseTextField" },
  { id: "enterprise-modal", pattern: /\bModalSheet\b|\bEnterpriseDialog\b|\bConfirmationDialog\b|\bEnterpriseAuthenticationDialog\b|\bEnterpriseActionSheet\b/g, label: "Enterprise modals" },
  { id: "enterprise-empty", pattern: /\bEnterpriseEmptyState\b/g, label: "EnterpriseEmptyState" },
  { id: "enterprise-loading", pattern: /\bEnterpriseSkeleton(Table|Form|Dashboard|Dialog|ProductList|Report)?\b|\bEnterpriseAsyncShell\b|\bEnterpriseSkeletonList\b|\bEnterpriseSkeletonKpiGrid\b/g, label: "Enterprise loading" },
  { id: "enterprise-feedback", pattern: /\bEnterpriseFeedbackBanner\b|\bEnterpriseSpinner\b|statusTokens\.(success|warning|danger|info|offline|syncing)\.banner/g, label: "Enterprise feedback" },
  { id: "enterprise-action-sheet", pattern: /\bEnterpriseActionSheet\b/g, label: "EnterpriseActionSheet" },
  { id: "enterprise-motion", pattern: /enterpriseMotion\.|animate-enterprise-|transition-waka|waka-skeleton-bar/g, label: "Enterprise motion" },
  { id: "status-tokens", pattern: /statusTokens\./g, label: "statusTokens" },
  { id: "enterprise-spacing", pattern: /enterpriseSpace\.|enterpriseSpaceCss/g, label: "enterpriseSpace" },
  { id: "shadow-elev", pattern: /\bshadow-elev(-md)?\b/g, label: "shadow-elev tokens" },
];

const LEGACY_SIGNALS = [
  { id: "app-modal-overlay", pattern: /\bAppModalOverlay\b/g, label: "AppModalOverlay (legacy)" },
  { id: "legacy-page-header", pattern: /\bPageHeader\b/g, label: "PageHeader (legacy)" },
  { id: "legacy-inline-cta", pattern: /\bbg-waka-600\b/g, label: "inline bg-waka-600 CTAs" },
  { id: "legacy-fractional-type", pattern: /text-\[(8|9|10|11|13|15|17|18|22)px\]/g, label: "fractional typography" },
  { id: "legacy-pulse-skeleton", pattern: /animate-pulse bg-muted/g, label: "pulse skeleton (use waka-skeleton-bar)" },
  { id: "legacy-raw-spinner", pattern: /border-t-transparent|animate-spin rounded-full border-2/g, label: "raw CSS spinners" },
  { id: "legacy-font-black", pattern: /\bfont-black\b/g, label: "font-black (prefer font-bold outside display)" },
  { id: "legacy-module-spectacle", pattern: /\bbg-(emerald|violet|purple)-[0-9]{2,3}\b/g, label: "module spectacle fills" },
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "dist") continue;
      walk(p, out);
    } else if (/\.(tsx|ts|jsx|js)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

function allowedForPosDensity(filePath) {
  const rel = relative(SRC, filePath).replace(/\\/g, "/");
  return POS_DENSITY_ALLOW.some((frag) => rel.includes(frag));
}

function isHighTraffic(filePath) {
  const rel = relative(SRC, filePath).replace(/\\/g, "/");
  return HIGH_TRAFFIC_PATHS.some((frag) => rel.includes(frag));
}

function isBusinessWorkspace(filePath) {
  const rel = relative(SRC, filePath).replace(/\\/g, "/");
  return BUSINESS_WORKSPACE_PATHS.some((frag) => rel.includes(frag));
}

function countMatches(content, pattern) {
  pattern.lastIndex = 0;
  const matches = content.match(pattern);
  return matches ? matches.length : 0;
}

const files = walk(SRC);
const violations = [];
const adoptionCounts = Object.fromEntries(ADOPTION_SIGNALS.map((s) => [s.id, 0]));
const legacyCounts = Object.fromEntries(LEGACY_SIGNALS.map((s) => [s.id, 0]));
let highTrafficFiles = 0;
let highTrafficAdopted = 0;
let businessWorkspaceFiles = 0;
let businessWorkspaceAdopted = 0;

for (const file of files) {
  const content = readFileSync(file, "utf8");
  const rel = relative(ROOT, file).replace(/\\/g, "/");

  for (const signal of ADOPTION_SIGNALS) {
    adoptionCounts[signal.id] += countMatches(content, signal.pattern);
  }

  for (const signal of LEGACY_SIGNALS) {
    if (signal.id === "legacy-fractional-type" && allowedForPosDensity(file)) continue;
    legacyCounts[signal.id] += countMatches(content, signal.pattern);
  }

  if (isHighTraffic(file)) {
    highTrafficFiles += 1;
    if (/EnterprisePage(Container|Header)|enterpriseTypeClass|EnterpriseTypography|EnterpriseKpiCard|EnterpriseCard/.test(content)) {
      highTrafficAdopted += 1;
    }
  }

  if (isBusinessWorkspace(file)) {
    businessWorkspaceFiles += 1;
    if (/EnterprisePage(Container|Header)|EnterpriseKpiCard|EnterpriseResponsiveTable|EnterpriseEmptyState|ModalSheet|WakaButton/.test(content)) {
      businessWorkspaceAdopted += 1;
    }
  }

  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    let match;
    while ((match = rule.pattern.exec(content)) !== null) {
      if (rule.id === "fractional-typography" && allowedForPosDensity(file)) continue;
      const line = content.slice(0, match.index).split("\n").length;
      violations.push({ file: rel, line, rule: rule.id, message: rule.message, sample: match[0] });
    }
  }
}

const adoptionPct =
  highTrafficFiles > 0 ? Math.round((highTrafficAdopted / highTrafficFiles) * 100) : 0;
const businessPct =
  businessWorkspaceFiles > 0 ? Math.round((businessWorkspaceAdopted / businessWorkspaceFiles) * 100) : 0;

console.log("design-system:check — Phase 29.1 enterprise token enforcement summary\n");
console.log(`High-traffic module primitive adoption: ${highTrafficAdopted}/${highTrafficFiles} files (${adoptionPct}%)`);
console.log(`Business workspace adoption (Suppliers/Expenses/Cash/Stock/CC): ${businessWorkspaceAdopted}/${businessWorkspaceFiles} files (${businessPct}%)`);
console.log("\nEnterprise primitive references:");
for (const signal of ADOPTION_SIGNALS) {
  console.log(`  ${signal.label}: ${adoptionCounts[signal.id]}`);
}
console.log("\nLegacy component reduction (lower is better):");
for (const signal of LEGACY_SIGNALS) {
  console.log(`  ${signal.label}: ${legacyCounts[signal.id]}`);
}
console.log("");

if (violations.length === 0) {
  console.log("No violations in scanned rules.");
} else {
  console.log(`${violations.length} violation(s) (informational — fix incrementally):\n`);
  for (const v of violations.slice(0, 60)) {
    console.log(`${v.file}:${v.line} [${v.rule}] ${v.message}`);
  }
  if (violations.length > 60) {
    console.log(`… and ${violations.length - 60} more`);
  }
}

console.log("\nPremium polish:");
console.log(`  Enterprise motion refs: ${adoptionCounts["enterprise-motion"] ?? 0}`);
console.log(`  Legacy pulse skeletons (lower is better): ${legacyCounts["legacy-pulse-skeleton"] ?? 0}`);
console.log(`  Legacy raw spinners (lower is better): ${legacyCounts["legacy-raw-spinner"] ?? 0}`);
process.exit(0);
