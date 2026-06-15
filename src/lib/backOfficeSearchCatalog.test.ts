import { describe, expect, it } from "vitest";
import { filterBackOfficeSearch, type ResolvedBackOfficeSearchEntry } from "./backOfficeSearchCatalog";

const entries: ResolvedBackOfficeSearchEntry[] = [
  {
    id: "stock",
    path: "/stock",
    title: "Stock & products",
    subtitle: "Manage items and prices",
    section: "Daily",
    haystack: "stock & products manage items inventory",
  },
  {
    id: "reports",
    path: "/reports",
    title: "Reports",
    subtitle: "Sales and trends",
    section: "Insights",
    haystack: "reports sales trends analytics",
  },
];

describe("filterBackOfficeSearch", () => {
  it("matches partial letters", () => {
    expect(filterBackOfficeSearch(entries, "sto").map((e) => e.id)).toEqual(["stock"]);
  });

  it("matches keywords", () => {
    expect(filterBackOfficeSearch(entries, "inv").map((e) => e.id)).toEqual(["stock"]);
  });

  it("matches multiple tokens", () => {
    expect(filterBackOfficeSearch(entries, "sales rep").map((e) => e.id)).toEqual(["reports"]);
  });
});
