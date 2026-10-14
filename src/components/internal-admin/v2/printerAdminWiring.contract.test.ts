/**
 * Wiring contract for the Printers console.
 *
 * WHAT THIS IS FOR. The console's visibility is decided in four separate places
 * — the role helper, the nav entry, the route, and the section dispatch — and
 * the one thing that must never drift is the ROLE SET, because it mirrors a
 * database gate. A mismatch is invisible to TypeScript and only shows up as a
 * screen that either cannot be reached or is shown to a role the server refuses.
 *
 * There is no DOM test project here (vitest runs `environment: "node"`), so the
 * wiring is pinned by reading the source — the same approach
 * `liveRefreshWiring.contract.test.ts` takes.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  adminPermissions,
  canManagePrinterFulfilment,
  canManagePrinterStock,
} from "./adminRoles";

// src/components/internal-admin/v2 → the repository root is four levels up.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

/** Strip JS comments so an assertion tests code rather than the prose around it. */
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const shell = read("src/components/internal-admin/v2/AdminShell.tsx");
const dispatch = read("src/pages/InternalWakaAdminPage.tsx");
const app = read("src/App.tsx");
const inventoryPanel = read("src/components/internal-admin/v2/printer/PrinterInventoryPanel.tsx");
const fulfilmentPanel = read("src/components/internal-admin/v2/printer/PrinterFulfilmentPanel.tsx");
const historyPanel = read("src/components/internal-admin/v2/printer/PrinterHistoryPanel.tsx");
const migration = read("supabase/migrations/20261013100000_printer_inventory_and_fulfilment.sql");

describe("printer permissions", () => {
  it("grants fulfilment to exactly the three server-authorized roles", () => {
    expect(canManagePrinterFulfilment("super_admin")).toBe(true);
    expect(canManagePrinterFulfilment("subscriptions_admin")).toBe(true);
    expect(canManagePrinterFulfilment("operations_admin")).toBe(true);
  });

  it("refuses every other role, including the billing role it is NOT inherited from", () => {
    for (const role of ["finance_admin", "support_admin", "field_agent", "owner", "cashier", "", "unknown"]) {
      expect(canManagePrinterFulfilment(role), role).toBe(false);
    }
  });

  it("keeps stock narrower than fulfilment", () => {
    expect(canManagePrinterStock("super_admin")).toBe(true);
    expect(canManagePrinterStock("operations_admin")).toBe(true);
    // A subscriptions_admin may fulfil but may NOT register, correct or retire stock.
    expect(canManagePrinterStock("subscriptions_admin")).toBe(false);
    expect(canManagePrinterStock("finance_admin")).toBe(false);
  });

  it("exposes both flags through adminPermissions", () => {
    const perms = adminPermissions({ role: "subscriptions_admin" } as never);
    expect(perms.canManagePrinterFulfilment).toBe(true);
    expect(perms.canManagePrinterStock).toBe(false);
  });

  it("MIRRORS the database gates it claims to mirror", () => {
    // The two arrays in the migration are the authority. If either changes
    // without the helper, this fails rather than shipping a screen the server
    // refuses — or hiding one it would allow.
    const stockGate = migration.slice(
      migration.indexOf("function public._printer_require_stock_admin"),
      migration.indexOf("function public._printer_require_fulfilment_admin"),
    );
    expect(stockGate, "stock gate delegates to is_waka_internal_admin").toContain("is_waka_internal_admin");

    const gateStart = migration.indexOf("create or replace function public._printer_require_fulfilment_admin");
    const fulfilmentGate = migration.slice(gateStart, migration.indexOf("$$;", gateStart));
    expect(fulfilmentGate).toContain("'super_admin', 'subscriptions_admin', 'operations_admin'");
    // The excluded roles appear in the doc comment ON PURPOSE; what must be
    // absent is any grant of them inside the body.
    expect(fulfilmentGate.slice(fulfilmentGate.indexOf("begin"))).not.toContain("finance_admin");
    expect(fulfilmentGate.slice(fulfilmentGate.indexOf("begin"))).not.toContain("support_admin");
  });

  it("does NOT reuse the billing permission", () => {
    const roles = read("src/components/internal-admin/v2/adminRoles.ts");
    const block = roles.slice(
      roles.indexOf("export function canManagePrinterFulfilment"),
      roles.indexOf("export function canManagePrinterStock"),
    );
    expect(block).not.toContain("canManageBillingOffers");
    expect(block).not.toContain("canManageTrials");
  });
});

describe("the console is reachable only through its permission", () => {
  it("hides the nav entry behind printerAdmin", () => {
    expect(shell).toContain('{ id: "printers", path: "/internal/waka/printers", label: "Printers", printerAdmin: true }');
    expect(shell).toContain("if (tab.printerAdmin && !opts.canManagePrinters) return false;");
    expect(shell).toContain("canManagePrinterFulfilment(normalizeAdminRole(adminRow?.role))");
  });

  it("registers a route and maps it to its own section", () => {
    expect(app).toContain('path="internal/waka/printers"');
    expect(dispatch).toContain('if (pathname === "/internal/waka/printers") return "printers";');
    expect(dispatch).toContain('} else if (section === "printers") {');
  });

  it("does not gate the panels on the billing permission", () => {
    for (const panel of [inventoryPanel, fulfilmentPanel]) {
      expect(panel).toContain("adminPermissions(adminRow)");
      expect(panel).not.toContain("canManageBillingOffers");
      expect(panel).not.toContain("canManageTrials");
    }
    expect(inventoryPanel).toContain("perms.canManagePrinterStock && !previewMode");
    expect(fulfilmentPanel).toContain("perms.canManagePrinterFulfilment && !previewMode");
  });
});

describe("the UI never bypasses the backend", () => {
  it("reads and writes only through the printer RPCs", () => {
    for (const panel of [inventoryPanel, fulfilmentPanel]) {
      // No direct table access anywhere — the printer tables are RLS-closed.
      expect(code(panel)).not.toMatch(/\.from\(["']/);
      expect(code(panel)).not.toMatch(/waka_printer_units|waka_printer_assignments/);
      // ...and no bespoke SQL or service-role client.
      expect(panel).not.toContain("service_role");
      expect(panel).not.toMatch(/createClient\(/);
    }
  });

  it("never generates a serial", () => {
    for (const panel of [inventoryPanel, fulfilmentPanel]) {
      // A serial is only ever read from an input the operator typed.
      expect(panel).not.toMatch(/serialNumber\s*[:=]\s*[`"'][A-Z0-9-]*[0-9]{3}/);
      expect(panel).not.toMatch(/Math\.random|randomUUID\(\)\s*\.\s*slice/);
    }
    // The register form is the only place a serial enters the console.
    expect(inventoryPanel).toContain("Type the serial exactly as printed");
  });

  it("does not claim a WhatsApp message was sent", () => {
    // It links to the real support chat and says plainly that it records nothing.
    expect(fulfilmentPanel).toContain("wakaSupportWhatsAppUrl");
    expect(fulfilmentPanel).toMatch(/Opening the chat does not record anything/i);
    expect(fulfilmentPanel).not.toMatch(/request (has been )?sent to WhatsApp/i);
  });

  it("reads handover history through its own RPC, and keeps it read-only", () => {
    // Since 20261013110000 a read RPC exists, so the console shows the real
    // record — it no longer points at the audit table as a workaround.
    expect(historyPanel).toContain("fetchHandoverHistory");
    expect(code(historyPanel)).not.toMatch(/\.from\(["']/);
    // No edit, cancel or reassign affordance anywhere on the history screen.
    expect(historyPanel).not.toMatch(/recordHandover|cancelPrinterAssignment|assignPrinter|retirePrinterUnit/);
    expect(historyPanel).toMatch(/read-only/i);
  });

  it("checks eligibility through the server before reserving", () => {
    expect(fulfilmentPanel).toContain("fetchPrinterEligibility");
    expect(fulfilmentPanel).toContain("ELIGIBILITY_REASON_LABELS");
    // The verdict is the server's; the screen only renders it.
    expect(fulfilmentPanel).toContain("preview?.can_reserve === false");
    expect(fulfilmentPanel).not.toMatch(/_printer_promotion_eligible|billing_interval === "year"/);
  });

  it("offers no way to edit or cancel a completed handover", () => {
    // The only destructive control is gated on the OPEN statuses the server accepts.
    expect(fulfilmentPanel).not.toMatch(/handed_over[\s\S]{0,80}onClick=\{\(\) => void onCancel/);
    expect(fulfilmentPanel).toContain('a.status === "reserved" ? (');
  });
});

/**
 * The CUSTOMER surface, which is a different trust boundary from the console.
 *
 * Same approach as above: no DOM test project, so the wiring is pinned by
 * reading the source. What matters here is that the merchant's screen talks to
 * the customer-authorized RPCs and to nothing else — an admin RPC reached from
 * the customer app would either fail or, worse, succeed.
 */
describe("the merchant's printer panel stays on the customer side", () => {
  const panel = read("src/components/subscription/PrinterPromotionPanel.tsx");
  const centre = read("src/components/subscription/AccountSubscriptionCenter.tsx");
  const lib = read("src/lib/printerFulfilment.ts");

  it("reads and writes only through the customer-authorized RPCs", () => {
    // The customer RPCs are the ONLY ones it names…
    expect(lib).toContain('rpc("my_org_printer_status"');
    expect(lib).toContain('rpc("my_org_printer_request_collection"');
    // …and the panel goes through the lib rather than calling out itself.
    expect(panel).toContain("fetchMyOrgPrinterStatus");
    expect(panel).toContain("requestPrinterCollection");
    expect(panel).not.toMatch(/\.rpc\(/);
    expect(panel).not.toMatch(/createClient\(/);
    expect(panel).not.toMatch(/service_role/);
    // No admin RPC may appear anywhere in the customer panel.
    expect(panel).not.toMatch(/internal_ops_printer/);
  });

  it("is mounted with the account's own shop", () => {
    expect(centre).toContain("<PrinterPromotionPanel");
    expect(centre).toMatch(/<PrinterPromotionPanel lang=\{lang\} shopId=\{shopId\}/);
    // …and never rendered without one.
    expect(centre).toMatch(/shopId && authMode === "supabase" \? <PrinterPromotionPanel/);
  });

  it("treats a failed read as an error, not as ineligibility", () => {
    // The distinction the whole panel rests on: "we could not check" must never
    // render as "you do not qualify".
    expect(panel).toMatch(/role="alert"/);
    expect(panel).toContain("printerStatusUnavailable");
    // The not-eligible copy lives in a different branch, behind a real status.
    expect(panel).toMatch(/status && !status\.eligible/);
  });

  it("offers the request only when the SERVER says it may", () => {
    expect(panel).toContain("status?.can_request");
    // No local re-derivation of eligibility from plan/interval on the client.
    expect(panel).not.toMatch(/billing_interval === "year"/);
    expect(panel).not.toMatch(/_printer_promotion_eligible/);
  });

  it("never invents a serial, a stock figure or a completed handover", () => {
    expect(panel).not.toMatch(/WP58-\d{4}-\d{3}/); // no hard-coded serial
    expect(panel).not.toMatch(/Math\.random|randomUUID\(\)/);
    // Every status it prints comes from the server payload.
    expect(panel).toContain("claim.serial_number");
    expect(panel).toContain("ASSIGNMENT_STATUS_LABELS[claim.status]");
  });

  it("says out loud that a request is not a reservation", () => {
    expect(panel).toContain("printerRequestNotReservation");
    expect(read("src/lib/i18n.ts")).toMatch(
      /printerRequestNotReservation:\s*\n?\s*"Asking does not reserve a printer/,
    );
  });
});

/**
 * The request queue closes the loop: the customer half shipped first, so requests
 * could be created with nothing able to read them. This pins the desk end.
 */
describe("the collection-request queue is wired to the desk", () => {
  const requestsPanel = read("src/components/internal-admin/v2/printer/PrinterRequestsPanel.tsx");
  const printersPage = read("src/components/internal-admin/v2/pages/AdminPrintersPage.tsx");
  const lib = read("src/lib/printerFulfilment.ts");

  it("uses the two admin RPCs, through the lib", () => {
    expect(lib).toContain('rpc("internal_ops_printer_requests"');
    expect(lib).toContain('rpc("internal_ops_printer_request_set_status"');
    expect(requestsPanel).toContain("fetchPrinterRequests");
    expect(requestsPanel).toContain("setPrinterRequestStatus");
    // No direct table access and no bespoke client.
    expect(code(requestsPanel)).not.toMatch(/\.from\(["']/);
    expect(requestsPanel).not.toMatch(/createClient\(/);
    expect(requestsPanel).not.toMatch(/service_role/);
  });

  it("is reachable from the Printers console", () => {
    expect(printersPage).toContain('"inventory" | "fulfilment" | "requests" | "history"');
    expect(printersPage).toContain("<PrinterRequestsPanel");
    expect(printersPage).toContain('setTab("requests")');
  });

  it("does NOT allocate a printer — that stays in the Fulfilment tab", () => {
    // One path to stock, one place a serial is recorded.
    expect(requestsPanel).not.toMatch(/internal_ops_printer_assign|assignPrinter|registerPrinterUnit/);
    expect(requestsPanel).toMatch(/not a reservation/i);
  });

  it("gates its actions on the fulfilment permission, and not in preview mode", () => {
    expect(requestsPanel).toContain("perms.canManagePrinterFulfilment && !previewMode");
  });

  it("surfaces a failed read instead of an empty queue", () => {
    expect(requestsPanel).toMatch(/role="alert"/);
    expect(requestsPanel).toMatch(/may be incomplete/);
  });
});

/**
 * THE CUSTOMER'S PRINTER SECTION IS NEVER A DEAD END.
 *
 * Two ways this went wrong or could: the section was unreachable entirely while
 * `shop_get_effective_subscription` was missing, and an ineligible account could
 * have been left with a refusal and nothing to do about it. An ineligible
 * merchant must still see the offer and the setup/pickup instructions.
 */
describe("the merchant's printer section always tells them what to do next", () => {
  const panel = read("src/components/subscription/PrinterPromotionPanel.tsx");

  it("explains an ineligibility using the SERVER's reason, with a route to fix it", () => {
    expect(panel).toContain("ELIGIBILITY_REASON_LABELS");
    // The offer page — which carries the video and the collection steps — and
    // the in-app upgrade, both offered on a refusal.
    expect(panel).toMatch(/status && !status\.eligible/);
    expect(panel).toContain('to="/business-printer"');
    expect(panel).toContain('to="/upgrade"');
  });

  it("keeps the setup block off /upgrade, where the page already renders that journey", () => {
    /*
      THIS ASSERTION USED TO SAY THE OPPOSITE — that the setup block rendered
      unconditionally. It has to be gated now: /upgrade renders the same journey
      inline above the panel, so an ungated block would state it twice. The
      block still never depends on ELIGIBILITY, which was its original point.
    */
    const setupAt = panel.indexOf("printerSetupSectionTitle");
    expect(setupAt).toBeGreaterThan(-1);
    const gateAt = panel.lastIndexOf("{onUpgradePage ? null : (", setupAt);
    expect(gateAt, "the setup block is gated").toBeGreaterThan(-1);
    // Inside that block, and NOT behind an eligibility test.
    const block = panel.slice(gateAt, panel.indexOf("printerRequestNotReservation", gateAt));
    expect(block).toContain("printerSetupInstructions");
    expect(block).not.toMatch(/status\.eligible|status\.can_request/);
  });

  it("never hides the section once a status has loaded", () => {
    /*
      THE PROPERTY THAT MATTERS: every early return requires `!status`, so a
      loaded status — eligible or not — always reaches the render. An account is
      never shown nothing because of how the server answered.
    */
    const guards = panel.match(/if \([^\n]*\) \{/g) ?? [];
    const earlyGuards = guards.filter((g) => g.includes("!status"));
    expect(earlyGuards.length).toBe(2);
    // …and no guard branches on eligibility to drop the section.
    for (const g of guards) expect(g).not.toMatch(/eligible/);
    expect(panel).toContain("printerChecking");
    expect(panel).toContain("printerStatusUnavailable");
  });

  it("does not hide the section because there is no open request", () => {
    // A request list is additive; its absence must not gate anything.
    expect(panel).toMatch(/status\.requests\.length > 0 \?/);
    expect(panel).not.toMatch(/requests\.length > 0 \?[\s\S]{0,200}return null/);
  });
});

/**
 * THE UPGRADE CENTRE MUST CARRY THE OFFER TOO.
 *
 * The panel shipped mounted only through `AccountSubscriptionCenter`, so a
 * signed-in merchant browsing plans on /upgrade saw prices and no printer offer
 * at all — the one screen where someone is actively choosing Business yearly
 * was the one screen that did not mention the free printer. Nothing failed; the
 * component simply was not mounted there.
 */
describe("the upgrade centre mounts the printer panel", () => {
  const upgrade = read("src/pages/UpgradePage.tsx");

  it("imports the EXISTING panel rather than a second implementation", () => {
    expect(upgrade).toContain(
      'import { PrinterPromotionPanel } from "../components/subscription/PrinterPromotionPanel"',
    );
    // One component, two mount points — they cannot drift.
    const mounts = (read("src/components/subscription/AccountSubscriptionCenter.tsx") + upgrade)
      .match(/<PrinterPromotionPanel/g) ?? [];
    expect(mounts.length).toBe(2);
  });

  it("renders it under the SAME guard the account page uses", () => {
    expect(upgrade).toMatch(/shopId && authMode === "supabase" \?/);
    expect(upgrade).toContain("<PrinterPromotionPanel lang={lang} shopId={shopId} onUpgradePage />");
    // The guard must still be the account page's, not a re-invented one.
    expect(upgrade).not.toMatch(/shopId && authMode === "local"/);
  });

  it("uses the shopId and authMode it ALREADY has, without new plumbing", () => {
    // Both come from the existing useSubscription() call — no new hook, no prop.
    expect(upgrade).toContain("useSubscription()");
    expect(upgrade).toMatch(/const shopId = snapshot\.kind === "remote" && snapshot\.row\.shop_id/);
    // It must not invent its own subscription source.
    expect(upgrade).not.toMatch(/rpc\("my_org_printer_status"/);
  });

  it("sits beneath the Business offer, and is the page's only printer block", () => {
    // The page makes ONE offer now; the panel follows it.
    const offer = upgrade.indexOf('aria-labelledby="upgrade-plans-heading"');
    const mount = upgrade.indexOf("<PrinterPromotionPanel");
    const back = upgrade.indexOf('to="/pilot-support"');
    expect(offer).toBeGreaterThan(-1);
    expect(mount).toBeGreaterThan(offer);
    expect(back).toBeGreaterThan(mount);
    // Exactly one live panel — no second, competing printer block.
    expect(upgrade.split("<PrinterPromotionPanel").length - 1).toBe(1);
  });

  it("anchors the on-page journey to that same panel, not to another page", () => {
    // The journey's CTA must scroll within /upgrade.
    expect(upgrade).toContain('href="#printer-steps"');
    expect(upgrade).toContain('id="printer-steps"');
    // …and the printer detour to the marketing page is gone from this page.
    expect(upgrade).not.toContain('to="/business-printer"');
  });
});

/**
 * THE UPGRADE CENTRE MAKES ONE OFFER.
 *
 * It used to open with a full-width hero and then ask the reader to compare
 * four plans, so the thing the page exists to sell — Business yearly, with the
 * printer — was the fourth thing they read, and "how do I get the printer?"
 * left the page entirely. These pin the shape that replaced it.
 */
describe("the upgrade centre presents a single Business offer", () => {
  const upgrade = read("src/pages/UpgradePage.tsx");

  it("no longer renders the four-plan comparison", () => {
    // The comparison is gone from the DEFAULT view; the plans themselves are
    // untouched and still listed on the pricing page.
    expect(upgrade).not.toContain("PLAN_ORDER");
    expect(upgrade).not.toContain("PLAN_ORDER");
    expect(upgrade).not.toContain("plan-select-starter");
    expect(upgrade).not.toContain("plan-select-waka_plus");
    expect(upgrade).not.toContain("expandedPlans");
    // Plus is reached through the existing checkout, from its disclosure —
    // not by listing it as a fourth comparison card.
    expect(upgrade).toContain('openCheckout("waka_plus"');
    expect(upgrade).toContain("<details");
  });

  it("opens on YEARLY, because yearly is what carries the printer", () => {
    expect(upgrade).toMatch(/useState<"monthly" \| "yearly">\("yearly"\)/);
  });

  it("says outright that the printer offer is yearly-only when monthly is chosen", () => {
    expect(upgrade).toContain("upgradeMonthlyNoPrinter");
    expect(upgrade).toContain("upgradeYearlyRequirement");
  });

  it("shows the real WP-58 product image, through the asset helper, with alt text", () => {
    expect(upgrade).toContain('publicAssetUrl("brand/waka-printer/wp58-hero.webp")');
    expect(upgrade).toMatch(/alt=\{t\(lang, "upgradePrinterImageAlt"\)\}/);
    // Never a bare root path — the native/Electron builds resolve via the helper.
    expect(upgrade).not.toMatch(/src="\/brand\/waka-printer/);
    expect(existsSync(join(ROOT, "public/brand/waka-printer/wp58-hero.webp"))).toBe(true);
  });

  it("prices the offer from the LIVE book, never a literal", () => {
    expect(upgrade).toContain('pricingForPlan(pricing, "business")');
    expect(upgrade).not.toMatch(/UGX ?345[,_]?600/);
    expect(upgrade).not.toMatch(/345_600|172_800/);
  });

  it("does not promise a printer — the steps describe process, not outcome", () => {
    // No hard guarantee anywhere in the journey copy.
    const i18n = read("src/lib/i18n.ts");
    for (const key of ["upgradeStep3Body", "upgradeStep4Body", "upgradeYearlyRequirement"]) {
      const at = i18n.indexOf(`${key}:`);
      expect(at, key).toBeGreaterThan(-1);
    }
    expect(upgrade).not.toMatch(/guarantee|will receive|we deliver/i);
  });
});

/**
 * NO DETOURS FROM /upgrade.
 *
 * Every outbound link in the panel points at something /upgrade now carries on
 * the page. Left ungated they become links that look actionable and go nowhere
 * useful — the exact detour the redesign exists to remove. On /office/account
 * the same links are genuinely useful and must survive.
 */
describe("the panel's outbound links follow the surface it is on", () => {
  const panel = read("src/components/subscription/PrinterPromotionPanel.tsx");
  const centre = read("src/components/subscription/AccountSubscriptionCenter.tsx");
  const upgrade = read("src/pages/UpgradePage.tsx");

  it("gates EVERY away-link on onUpgradePage, and defaults to showing them", () => {
    expect(panel).toContain("onUpgradePage?: boolean;");
    // Default false — the account page passes nothing and keeps every link.
    expect(panel).toContain("onUpgradePage = false");
    // One gate per link block: the ineligible pair, and the setup link.
    expect(panel.split("{onUpgradePage ? null : (").length - 1).toBe(2);
  });

  it("still offers the offer, the upgrade and the instructions on the account page", () => {
    expect(panel).toContain('to="/business-printer"');
    expect(panel).toContain('to="/upgrade"');
    // The account page passes no prop, so nothing there is hidden.
    expect(centre).toContain("<PrinterPromotionPanel lang={lang} shopId={shopId} />");
    expect(centre).not.toContain("onUpgradePage");
  });

  it("drops them on /upgrade, where the page carries all three", () => {
    expect(upgrade).toContain("<PrinterPromotionPanel lang={lang} shopId={shopId} onUpgradePage />");
    // The page itself never links out to the marketing offer.
    expect(upgrade).not.toContain('to="/business-printer"');
    // …because it renders the offer, the image and the steps itself.
    expect(upgrade).toContain('aria-labelledby="upgrade-plans-heading"');
    expect(upgrade).toContain("wp58-hero.webp");
    expect(upgrade).toContain('id="printer-steps"');
  });

  it("keeps the REAL request actions on both surfaces", () => {
    // Hiding navigation must never hide the branch/WhatsApp actions.
    expect(panel).toContain("requestPrinterCollection");
    expect(panel).toContain("printerAskBranch");
    expect(panel).toContain("printerAskWhatsApp");
    // Gating appears ONLY on the two link blocks — the type declaration, the
    // parameter default, and two gates. If an action ever moved inside one,
    // this count would drop and the test would say so.
    expect(panel.match(/onUpgradePage/g)?.length).toBe(4);
  });
});
