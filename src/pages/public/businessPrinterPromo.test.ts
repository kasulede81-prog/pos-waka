/**
 * The Business + free WP-58 promotional page.
 *
 * This is a FRONTEND-ONLY phase, and most of what could go wrong here is a
 * boundary being crossed rather than a function returning the wrong value: the
 * page quietly reading a table it should not, retyping a feature list that then
 * drifts from the pricing page, hard-coding a support number, or implying an
 * activation it cannot perform. Those are pinned below.
 *
 * Where a component is pure enough to render without a router, a price feed or
 * a session, it is rendered and asserted against real markup. The page itself
 * needs all three, so its wiring is pinned as a source contract — the same
 * approach `liveRefreshWiring.contract.test.ts` takes in this repo.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { PrinterFulfilment } from "../../components/marketing/businessPrinter/PrinterFulfilment";
import { PrinterShowcase } from "../../components/marketing/businessPrinter/PrinterShowcase";
import { MarketingMotionProvider } from "../../components/marketing/website2026/MarketingMotion";
import { WAKA_SUPPORT_WHATSAPP_WA_ME } from "../../config/company";
import { isMarketingIndexablePath } from "../../config/seoRoutes";
import { MARKETING_PLANS } from "../../config/marketingSiteData";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

/** Strip JS comments so an assertion tests code rather than the prose around it. */
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const page = read("src/pages/public/BusinessPrinterPage.tsx");
const showcase = read("src/components/marketing/businessPrinter/PrinterShowcase.tsx");
const fulfilment = read("src/components/marketing/businessPrinter/PrinterFulfilment.tsx");
const app = read("src/App.tsx");
const layout = read("src/components/marketing/MarketingLayout.tsx");

describe("the promotional page is wired as a public marketing route", () => {
  it("is registered, lazily, inside the marketing guard", () => {
    expect(app).toMatch(/const BusinessPrinterPage = lazy\(\(\) =>\s*\n?\s*import\("\.\/pages\/public\/BusinessPrinterPage"\)/);
    expect(app).toContain('path="/business-printer"');

    // Inside the NativeMarketingGuard block, so native builds redirect it like
    // every other marketing page instead of trying to render it offline.
    const guard = app.indexOf("<NativeMarketingGuard");
    const guardEnd = app.indexOf("</Route>", app.indexOf('path="/demo"'));
    const route = app.indexOf('path="/business-printer"');
    expect(route).toBeGreaterThan(guard);
    expect(route).toBeLessThan(guardEnd);
  });

  it("supplies the LazyMotion context its Reveal sections need", () => {
    // `Reveal` renders a framer-motion `m` element, and `m` only works inside a
    // LazyMotion provider. MarketingLayout does not supply one — only the
    // marketing home page does — so a page that uses Reveal without wrapping
    // itself would throw at runtime. TypeScript cannot see this, and the page is
    // too context-heavy to render in this suite, so it is pinned here.
    expect(page).toContain("MarketingMotionProvider");
    expect(page).toContain("<Reveal");
    const open = page.indexOf("<MarketingMotionProvider>");
    const close = page.indexOf("</MarketingMotionProvider>");
    const firstReveal = page.indexOf("<Reveal");
    expect(open).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(firstReveal);
    expect(open).toBeLessThan(firstReveal);
  });

  it("is indexable and listed in the sitemap", () => {
    expect(isMarketingIndexablePath("/business-printer")).toBe(true);
    expect(read("public/sitemap.xml")).toContain("<loc>https://dkasu.com/business-printer</loc>");
  });

  it("is reachable from the marketing navigation", () => {
    expect(layout).toContain('{ href: "/business-printer", label: "Free printer" }');
    expect(layout).toContain('{ to: "/business-printer", label: "Free printer offer" }');
  });
});

describe("the printer assets ship from public/ and resolve through publicAssetUrl", () => {
  it("both files exist where the page expects them", () => {
    expect(existsSync(join(ROOT, "public/brand/waka-printer/wp58-hero.webp"))).toBe(true);
    expect(existsSync(join(ROOT, "public/brand/waka-printer/wp58-sheet.webp"))).toBe(true);
  });

  it("are referenced through publicAssetUrl, never as a bare /path", () => {
    // Electron builds with base "./", so a hard-coded "/brand/…" 404s there.
    // `publicAssetUrl.test.ts` guards the helper; this guards the call site.
    expect(showcase).toContain('publicAssetUrl("brand/waka-printer/wp58-hero.webp")');
    expect(showcase).toContain('publicAssetUrl("brand/waka-printer/wp58-sheet.webp")');
    expect(showcase).not.toMatch(/["'`]\/brand\/waka-printer/);
  });

  it("renders the hero through the helper, at a real URL", () => {
    const html = renderToStaticMarkup(
      createElement(MarketingMotionProvider, null, createElement(PrinterShowcase)),
    );
    expect(html).toContain("brand/waka-printer/wp58-hero.webp");
    expect(html).toContain("Model WP-58");
    // The alt text is what a screen reader gets instead of the product shot.
    expect(html).toContain("WP-58");
  });
});

describe("the page reuses pricing rather than touching it", () => {
  it("reads the live price book and computes nothing itself", () => {
    expect(page).toContain("usePublicPricing()");
    expect(page).toContain("pricingForPlan(");
    expect(page).toContain("<PlanPriceDisplay");
    // No arithmetic on a price anywhere on the page.
    expect(page).not.toMatch(/250[_,]?000/);
    expect(page).not.toMatch(/finalAnnualUgx\s*[*/+-]/);
  });

  it("touches no pricing, discount, plan or payment structure", () => {
    for (const [name, source] of [["page", page], ["showcase", showcase], ["fulfilment", fulfilment]] as const) {
      expect(source, `${name} must not open a Supabase client`).not.toMatch(/from\s+["'][^"']*supabase["']/);
      expect(source, `${name} must not call an RPC`).not.toMatch(/\.rpc\(/);
      expect(source, `${name} must not write to a table`).not.toMatch(/\.from\(["']/);
      expect(source, `${name} must not name the plan-availability column`).not.toContain("is_active");
      expect(source, `${name} must not name a pricing table`).not.toMatch(/subscription_plans|pricing_campaign|admin_plan_discounts|subscription_canonical_prices/);
    }
  });

  it("does not claim to activate a subscription", () => {
    // The only calls to action are the existing public funnel and the existing
    // contact channel — no button on this page grants a plan.
    expect(page).toContain('to="/register"');
    expect(page).not.toMatch(/(activate|grant|start)\s*(the\s*)?(subscription|plan)["'`]/i);
    // The copy wraps in JSX, so match the contiguous fragment.
    expect(page).toContain("This page does not activate");
  });
});

describe("Business features are shown, not retyped", () => {
  it("comes from the shared plan data the pricing page also uses", () => {
    expect(page).toContain("MARKETING_PLANS");
    expect(page).toContain('.find((plan) => plan.code === "business")');
    // Guards the drift this arrangement exists to prevent: the list is derived,
    // so a feature added to the plan data appears here automatically.
    const business = MARKETING_PLANS.find((plan) => plan.code === "business");
    expect(business, "the Business plan exists in the shared marketing data").toBeTruthy();
    expect(business!.features.length).toBeGreaterThan(5);
  });

  it("says the features need an active subscription", () => {
    expect(page).toMatch(/features unlock (when|as soon as) the subscription is active/i);
  });
});

describe("the fulfilment journey describes only what exists", () => {
  const html = renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(PrinterFulfilment)),
  );

  it("explains both real routes", () => {
    expect(html).toMatch(/main branch/i);
    expect(html).toMatch(/WhatsApp/i);
  });

  it("uses the configured support number rather than a hard-coded one", () => {
    expect(html).toContain(`wa.me/${WAKA_SUPPORT_WHATSAPP_WA_ME}`);
    expect(fulfilment).toContain("wakaSupportWhatsAppUrl");
    // A literal number typed into the component is exactly the drift this prevents.
    expect(fulfilment).not.toMatch(/\+?2567\d{8}/);
  });

  it("invents no serial number, stock level or tracking state", () => {
    // Serials are recorded at handover by staff; there is no registry behind this
    // page and no fulfilment record to read, so any serial-shaped literal here
    // would be fabricated data.
    for (const [name, source] of [["showcase", showcase], ["fulfilment", fulfilment], ["page", page]] as const) {
      expect(source, `${name} must not invent a serial-shaped value`).not.toMatch(/[A-Z]{2,}-?\d{3,}/);
      expect(source, `${name} must not simulate stock`).not.toMatch(/stock_?on_?hand|inventory_count|units_?remaining/i);
      expect(source, `${name} must not simulate a tracking state`).not.toMatch(/tracking_?(id|number)|waybill|shipment_?id/i);
    }
    // The word "serial" appears only in the description of what staff do.
    expect(fulfilment).toContain("serial number against your account");
  });

  it("does not promise the printer before the subscription is active", () => {
    expect(html).toMatch(/Nothing is promised against a trial/i);
  });
});

// ---------------------------------------------------------------------------
// The setup video — HOSTED in Supabase Storage
// ---------------------------------------------------------------------------

const videoPanel = read("src/components/marketing/businessPrinter/PrinterSetupVideo.tsx");

/** The verified object. Size and hash were checked against the live download. */
const HOSTED_VIDEO_URL =
  "https://ljaedextsenbkxzzgxcg.supabase.co/storage/v1/object/public/waka-printer-setup.mp4/waka-printer-setup.mp4.mp4";
const VERIFIED_BYTES = 37_140_796;
const VERIFIED_SHA256 = "aeee670900a129a3d16ecdd82159e1d14056d0dfe9b5efc41fde9a25ed800b53";

describe("the setup video section", () => {
  it("points at the verified hosted object, not a guessed URL", () => {
    expect(videoPanel).toContain(`"${HOSTED_VIDEO_URL}"`);
    // This project, the public object path, and the exact object name.
    expect(HOSTED_VIDEO_URL).toContain("https://ljaedextsenbkxzzgxcg.supabase.co/storage/v1/object/public/");
    expect(HOSTED_VIDEO_URL.endsWith("/waka-printer-setup.mp4/waka-printer-setup.mp4.mp4")).toBe(true);
  });

  it("records the verification facts that were checked against the download", () => {
    // Kept as documentation of a real check, not a live assertion — the suite
    // makes no network calls. If the object is ever replaced, re-verify size and
    // hash and update these, together with the URL above.
    expect(VERIFIED_BYTES).toBe(37140796);
    expect(VERIFIED_SHA256).toHaveLength(64);
    expect(videoPanel).toMatch(/VERIFIED, NOT ASSUMED/);
  });

  it("goes through publicAssetUrl, which passes an absolute URL through untouched", () => {
    expect(videoPanel).toContain("publicAssetUrl(PRINTER_SETUP_VIDEO_PATH)");
    // A repo-relative video path would mean the file is bundled again.
    expect(videoPanel).not.toMatch(/PRINTER_SETUP_VIDEO_PATH\s*=\s*["']videos\//);
  });

  it("is wired into the promotional page", () => {
    expect(page).toContain("PrinterSetupVideo");
    expect(page).toContain("<PrinterSetupVideo />");
  });

  it("loads metadata only — never autoplays and never preloads the file", () => {
    expect(videoPanel).toContain('preload="metadata"');
    expect(videoPanel).toContain("controls");
    expect(videoPanel).toContain("playsInline");
    // Assert on CODE: the component explains these omissions in comments.
    expect(code(videoPanel)).not.toContain("autoPlay");
    expect(code(videoPanel)).not.toContain('preload="auto"');
  });

  it("reserves the video's box so the section does not jump", () => {
    expect(videoPanel).toContain("width={1280}");
    expect(videoPanel).toContain("height={720}");
  });

  it("offers a way out when playback fails", () => {
    expect(videoPanel).toContain("Trouble playing? Open the video separately");
    expect(videoPanel).toMatch(/href=\{src\}[\s\S]{0,120}target="_blank"/);
  });

  it("adds no poster, because no thumbnail exists to point at", () => {
    expect(code(videoPanel)).not.toContain("poster=");
  });

  it("explains what the video shows", () => {
    expect(videoPanel).toMatch(/printer tested, set up/i);
    expect(videoPanel).toMatch(/Bluetooth/);
    expect(videoPanel).toMatch(/receipt/i);
    expect(videoPanel).toContain("aria-label=");
  });

  it("keeps NO local copy, so 35 MB cannot be bundled into dist/ or the mobile apps", () => {
    expect(existsSync(join(ROOT, "public/videos"))).toBe(false);
    expect(existsSync(join(ROOT, "public/videos/waka-printer-setup.mp4.mp4"))).toBe(false);
  });
});
