import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function read(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

/** VL-1: lock real DM Sans weight files without expanding into a family or 900 change. */
describe("VL-1 DM Sans weights", () => {
  const main = read("src/main.tsx");

  it("loads DM Sans 400 / 500 / 600 / 700 via existing @fontsource imports", () => {
    expect(main).toContain('import "@fontsource/dm-sans/400.css"');
    expect(main).toContain('import "@fontsource/dm-sans/500.css"');
    expect(main).toContain('import "@fontsource/dm-sans/600.css"');
    expect(main).toContain('import "@fontsource/dm-sans/700.css"');
  });

  it("does not load DM Sans 900", () => {
    expect(main).not.toContain("@fontsource/dm-sans/900");
  });

  it("does not add Google Fonts or a second font loader", () => {
    expect(main).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/);
    expect(read("index.html")).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/);
  });

  it("keeps Roboto admin imports unchanged", () => {
    expect(main).toContain('import "@fontsource/roboto/400.css"');
    expect(main).toContain('import "@fontsource/roboto/500.css"');
    expect(main).toContain('import "@fontsource/roboto/700.css"');
    expect(main).toContain('import "@fontsource/roboto/900.css"');
  });

  it("resolves each approved DM Sans CSS file to a local package path", () => {
    for (const weight of [400, 500, 600, 700] as const) {
      const cssPath = resolve(ROOT, `node_modules/@fontsource/dm-sans/${weight}.css`);
      expect(existsSync(cssPath), `missing ${weight}.css`).toBe(true);
      const css = readFileSync(cssPath, "utf8");
      expect(css).toContain(`font-weight: ${weight}`);
      expect(css).toContain("font-family: 'DM Sans'");
      expect(css).toMatch(/\.woff2/);
    }
    expect(existsSync(resolve(ROOT, "node_modules/@fontsource/dm-sans/900.css"))).toBe(true);
    expect(main).not.toContain("@fontsource/dm-sans/900.css");
  });
});
