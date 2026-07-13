/**
 * Phase 25.3 — [waka-pos] interaction diagnostics (no user/product data).
 */

import { findCatalogScrollElement, POS_CATALOG_SCROLL_ATTR } from "./posCatalogScroll";

type PosDiagEvent =
  | "scroll_owner"
  | "catalog_flex_chain"
  | "viewport"
  | "keyboard_inset"
  | "virtualizer_owner"
  | "touch_routing";

function shouldLog(): boolean {
  if (import.meta.env.DEV) return true;
  try {
    return globalThis.localStorage?.getItem("waka.pos.log") === "1";
  } catch {
    return false;
  }
}

export function logPosInteraction(
  event: PosDiagEvent,
  detail?: Record<string, string | number | boolean | null>,
): void {
  if (!shouldLog()) return;
  console.info("[waka-pos]", { event, ...detail });
}

export function reportPosScrollOwner(from?: HTMLElement | null): void {
  const el = findCatalogScrollElement(from);
  logPosInteraction("scroll_owner", {
    found: el != null,
    attr: POS_CATALOG_SCROLL_ATTR,
    clientHeight: el?.clientHeight ?? null,
    scrollHeight: el?.scrollHeight ?? null,
    scrollable: el ? el.scrollHeight > el.clientHeight : null,
  });
}

/** Phase 25.3B — one-shot dev log for split wrapper + catalog scroll pane bounds. */
export function reportPosCatalogFlexChain(
  wrapper: HTMLElement | null | undefined,
  scrollPaneFrom?: HTMLElement | null,
): void {
  const scrollPane = findCatalogScrollElement(scrollPaneFrom);
  const scrollable = scrollPane ? scrollPane.scrollHeight > scrollPane.clientHeight : false;
  logPosInteraction("catalog_flex_chain", {
    wrapperClientHeight: wrapper?.clientHeight ?? null,
    wrapperScrollHeight: wrapper?.scrollHeight ?? null,
    paneClientHeight: scrollPane?.clientHeight ?? null,
    paneScrollHeight: scrollPane?.scrollHeight ?? null,
    scrollable,
    overflowOwner: scrollable ? POS_CATALOG_SCROLL_ATTR : null,
  });
}

export function reportPosViewportMetrics(): void {
  const vv = globalThis.visualViewport;
  logPosInteraction("viewport", {
    innerHeight: globalThis.innerHeight,
    visualHeight: vv?.height ?? null,
    visualOffsetTop: vv?.offsetTop ?? null,
    dvh: typeof document !== "undefined" ? document.documentElement.clientHeight : null,
  });
}

export function reportPosKeyboardInset(insetPx: number): void {
  if (insetPx <= 0) return;
  logPosInteraction("keyboard_inset", { insetPx });
}

export function reportPosVirtualizerOwner(owner: HTMLElement | null, source: string): void {
  logPosInteraction("virtualizer_owner", {
    source,
    bound: owner != null,
    isCatalogPane: owner?.hasAttribute(POS_CATALOG_SCROLL_ATTR) ?? false,
  });
}
