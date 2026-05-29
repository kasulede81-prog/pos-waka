import { Capacitor } from "@capacitor/core";

function triggerAnchorDownload(url: string, filename: string): boolean {
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener";
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    window.setTimeout(() => anchor.remove(), 400);
    return true;
  } catch {
    return false;
  }
}

/** Reliable browser download for PDF/CSV/Word exports (works on mobile WebView when triggered from click). */
export function downloadBlobFile(filename: string, body: string | Blob, mime: string): boolean {
  try {
    const blob = body instanceof Blob ? body : new Blob([body], { type: mime });
    const file = new File([blob], filename, { type: mime });

    if (typeof navigator !== "undefined" && navigator.share && navigator.canShare?.({ files: [file] })) {
      void navigator.share({ files: [file], title: filename }).catch(() => {
        const url = URL.createObjectURL(blob);
        triggerAnchorDownload(url, filename);
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      });
      return true;
    }

    const url = URL.createObjectURL(blob);

    if (Capacitor.isNativePlatform()) {
      const opened = window.open(url, "_blank");
      if (!opened) triggerAnchorDownload(url, filename);
      window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
      return true;
    }

    const ok = triggerAnchorDownload(url, filename);
    window.setTimeout(() => URL.revokeObjectURL(url), 400);
    return ok;
  } catch {
    return false;
  }
}
