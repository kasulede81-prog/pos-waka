import { describe, expect, it } from "vitest";
import {
  findCatalogScrollElement,
  POS_CATALOG_SCROLL_ATTR,
  scrollCatalogToTop,
} from "./posCatalogScroll";

function mockScrollPane(): HTMLElement {
  const pane = {
    scrollTop: 120,
    clientHeight: 400,
    scrollHeight: 800,
    hasAttribute(name: string) {
      return name === POS_CATALOG_SCROLL_ATTR;
    },
    closest(selector: string) {
      return selector.includes(POS_CATALOG_SCROLL_ATTR) ? pane : null;
    },
  };
  return pane as unknown as HTMLElement;
}

describe("posCatalogScroll", () => {
  it("exports catalog scroll attribute name", () => {
    expect(POS_CATALOG_SCROLL_ATTR).toBe("data-pos-catalog-scroll");
  });

  it("finds catalog scroll element from child via closest", () => {
    const pane = mockScrollPane();
    const child = {
      closest: (selector: string) => pane.closest(selector),
    } as unknown as HTMLElement;
    expect(findCatalogScrollElement(child)).toBe(pane);
  });

  it("scrollCatalogToTop resets scroll position", () => {
    const pane = mockScrollPane();
    scrollCatalogToTop(pane);
    expect(pane.scrollTop).toBe(0);
  });
});
