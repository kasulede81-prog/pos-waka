import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HomeLiveValue } from "../components/home/HomeLiveValue";

describe("HomeLiveValue", () => {
  it("renders the exact formatted value without counting", () => {
    const html = renderToStaticMarkup(createElement(HomeLiveValue, { value: "UGX 12,400" }));
    expect(html).toContain("UGX 12,400");
    expect(html).toContain("home-live-value");
  });

  it("marks loading and unavailable values for Home", () => {
    const loading = renderToStaticMarkup(
      createElement(HomeLiveValue, { value: "—", availability: "loading" }),
    );
    expect(loading).toContain('data-home-kpi-availability="loading"');
    expect(loading).toContain("aria-busy");
    const unavailable = renderToStaticMarkup(
      createElement(HomeLiveValue, { value: "—", availability: "unavailable" }),
    );
    expect(unavailable).toContain('data-home-kpi-availability="unavailable"');
    expect(unavailable).not.toContain("aria-busy");
  });

  it("restarts CSS illumination from the formatted string key", () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../components/home/HomeLiveValue.tsx"),
      "utf8",
    );
    expect(src).toContain("key={value}");
    expect(src).toContain("home-live-value--changed");
    expect(src).not.toContain("setInterval");
    expect(src).not.toContain("requestAnimationFrame");
  });
});
