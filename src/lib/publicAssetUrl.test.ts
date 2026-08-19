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
});
