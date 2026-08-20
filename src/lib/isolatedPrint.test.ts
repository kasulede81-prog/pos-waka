import { afterEach, describe, expect, it, vi } from "vitest";
import { printIsolatedHtmlDocument } from "./isolatedPrint";

describe("printIsolatedHtmlDocument", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("prints a popup document instead of the current page", () => {
    const print = vi.fn();
    const parentPrint = vi.fn();
    const popupDoc = {
      open: vi.fn(),
      write: vi.fn(),
      close: vi.fn(),
      readyState: "complete",
    };
    const popup = {
      document: popupDoc,
      focus: vi.fn(),
      print,
      close: vi.fn(),
      addEventListener: vi.fn(),
    };
    vi.stubGlobal("window", {
      open: vi.fn(() => popup),
      print: parentPrint,
      setTimeout: (fn: () => void) => {
        fn();
        return 0;
      },
      addEventListener: vi.fn(),
    });
    vi.stubGlobal("document", { createElement: vi.fn(), body: { appendChild: vi.fn() } });

    const ok = printIsolatedHtmlDocument("<html><body>INV-000001</body></html>");

    expect(ok).toBe(true);
    expect(popupDoc.write).toHaveBeenCalledWith(expect.stringContaining("INV-000001"));
    expect(parentPrint).not.toHaveBeenCalled();
    expect(print).toHaveBeenCalled();
  });

  it("falls back to a full-size iframe when popups are blocked", () => {
    const iframeWinPrint = vi.fn();
    const parentPrint = vi.fn();
    const iframeDoc = {
      open: vi.fn(),
      write: vi.fn(),
      close: vi.fn(),
      readyState: "complete",
    };
    const iframe = {
      setAttribute: vi.fn(),
      style: { cssText: "" } as CSSStyleDeclaration,
      contentWindow: {
        document: iframeDoc,
        focus: vi.fn(),
        print: iframeWinPrint,
        addEventListener: vi.fn(),
      },
      contentDocument: iframeDoc,
      parentNode: { removeChild: vi.fn() },
    };
    const body = { appendChild: vi.fn() };
    vi.stubGlobal("window", {
      open: vi.fn(() => null),
      print: parentPrint,
      setTimeout: (fn: () => void) => {
        fn();
        return 0;
      },
      addEventListener: vi.fn(),
    });
    vi.stubGlobal("document", {
      createElement: vi.fn(() => iframe),
      body,
    });

    const ok = printIsolatedHtmlDocument("<html><body>Receipt</body></html>");

    expect(ok).toBe(true);
    expect(iframe.style.cssText).toContain("width:100%");
    expect(iframe.style.cssText).toContain("height:100%");
    expect(parentPrint).not.toHaveBeenCalled();
    expect(iframeWinPrint).toHaveBeenCalled();
  });
});
