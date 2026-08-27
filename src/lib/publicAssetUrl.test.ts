import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { publicAssetUrl } from "./publicAssetUrl";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("publicAssetUrl", () => {
  it("joins BASE_URL with a public path without duplicating slashes", () => {
    const url = publicAssetUrl("/waka-logo.png");
    expect(url.endsWith("waka-logo.png")).toBe(true);
    expect(url.includes("//waka")).toBe(false);
    expect(url).toBe(publicAssetUrl("waka-logo.png"));
  });

  it("keeps brand icon paths under public/brand", () => {
    const url = publicAssetUrl("brand/w-icon-32-cream.png");
    expect(url.endsWith("brand/w-icon-32-cream.png")).toBe(true);
  });

  it("WakaLogo no longer hard-codes root-absolute /waka-logo.png", () => {
    const src = readFileSync(join(ROOT, "src/components/brand/WakaLogo.tsx"), "utf8");
    expect(src).toContain("publicAssetUrl");
    expect(src).not.toMatch(/LOGO_SRC\s*=\s*["']\/waka-logo\.png["']/);
    expect(src).not.toMatch(/["']\/brand\/w-icon-/);
  });

  it("checkout note picker uses local publicAssetUrl paths, not hotlinks", () => {
    const src = readFileSync(join(ROOT, "src/components/pos/CheckoutNotePicker.tsx"), "utf8");
    expect(src).toContain("publicAssetUrl");
    expect(src).toContain("checkoutNoteAssetPath");
    expect(src).toContain("checkoutCoinAssetPath");
    expect(src).toContain("Add UGX");
    expect(src).toContain("Add UGX ${formatDenominationLabel(denom)} coin");
    expect(src).not.toMatch(/https?:\/\//);
    expect(src).toContain("object-contain");
    expect(src).toContain("rounded-full");
    expect(src).toContain("grid-cols-3");
    expect(src).not.toContain("grid-cols-6");
  });
});
