/**
 * Print an HTML or PDF document without printing the live POS UI.
 *
 * iOS Safari prints the parent page if you call print() on a 0×0 hidden iframe
 * or remove that iframe before afterprint. Isolated popup / off-screen iframe
 * keeps the receipt (or report) as the only printed document.
 */

export function printIsolatedHtmlDocument(fullHtml: string): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false;

  if (printViaPopup(fullHtml)) return true;
  return printViaIframe(fullHtml);
}

export function printIsolatedPdfBlob(blob: Blob, title = "Waka report"): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  const url = URL.createObjectURL(blob);
  const opened = printViaPopupUrl(url, () => URL.revokeObjectURL(url));
  if (opened) return true;
  return printPdfViaIframe(url, title);
}

function printViaPopup(fullHtml: string): boolean {
  let popup: Window | null = null;
  try {
    popup = window.open("", "_blank", "width=480,height=720");
  } catch {
    return false;
  }
  if (!popup) return false;

  try {
    popup.document.open();
    popup.document.write(fullHtml);
    popup.document.close();
  } catch {
    try {
      popup.close();
    } catch {
      /* ignore */
    }
    return false;
  }

  schedulePrint(popup, () => {
    try {
      popup?.close();
    } catch {
      /* ignore */
    }
  });
  return true;
}

function printViaPopupUrl(url: string, onDone: () => void): boolean {
  let popup: Window | null = null;
  try {
    popup = window.open(url, "_blank");
  } catch {
    onDone();
    return false;
  }
  if (!popup) {
    onDone();
    return false;
  }
  schedulePrint(popup, () => {
    onDone();
    try {
      popup?.close();
    } catch {
      /* ignore */
    }
  });
  return true;
}

function printViaIframe(fullHtml: string): boolean {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", "Waka print");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText =
    "position:fixed;inset:0;width:100%;height:100%;border:0;opacity:0;pointer-events:none;z-index:-1;";
  document.body.appendChild(iframe);

  const win = iframe.contentWindow;
  const doc = iframe.contentDocument ?? win?.document;
  if (!win || !doc) {
    iframe.remove();
    return false;
  }

  doc.open();
  doc.write(fullHtml);
  doc.close();

  schedulePrint(win, () => {
    window.setTimeout(() => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    }, 400);
  });
  return true;
}

function printPdfViaIframe(url: string, title = "Waka print"): boolean {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", title);
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText =
    "position:fixed;inset:0;width:100%;height:100%;border:0;opacity:0;pointer-events:none;z-index:-1;";
  iframe.src = url;
  document.body.appendChild(iframe);

  const cleanup = () => {
    window.setTimeout(() => {
      URL.revokeObjectURL(url);
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    }, 800);
  };

  iframe.onload = () => {
    const win = iframe.contentWindow;
    if (!win) {
      cleanup();
      return;
    }
    schedulePrint(win, cleanup);
  };
  return true;
}

function schedulePrint(win: Window, onAfterPrint: () => void): void {
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    onAfterPrint();
  };

  try {
    win.addEventListener("afterprint", finish);
  } catch {
    /* ignore */
  }

  const run = () => {
    try {
      win.focus();
      win.print();
    } catch {
      finish();
      return;
    }
    window.setTimeout(finish, 120_000);
  };

  const doc = win.document;
  if (!doc || doc.readyState === "complete") {
    window.setTimeout(run, 60);
    return;
  }
  win.addEventListener("load", () => window.setTimeout(run, 60), { once: true });
}
