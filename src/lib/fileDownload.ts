import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

function sanitizeFilename(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, "_").trim() || "waka-export";
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      if (typeof dataUrl !== "string") {
        reject(new Error("read_failed"));
        return;
      }
      const comma = dataUrl.indexOf(",");
      resolve(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
    };
    reader.onerror = () => reject(reader.error ?? new Error("read_failed"));
    reader.readAsDataURL(blob);
  });
}

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

async function saveViaNativeShare(
  filename: string,
  blob: Blob,
  dialogTitle = "Save or share file",
): Promise<boolean> {
  const safeName = sanitizeFilename(filename);
  const path = `WakaReports/${safeName}`;
  const base64 = await blobToBase64(blob);

  await Filesystem.writeFile({
    path,
    data: base64,
    directory: Directory.Cache,
    recursive: true,
  });

  const { uri } = await Filesystem.getUri({
    path,
    directory: Directory.Cache,
  });

  await Share.share({
    title: safeName,
    url: uri,
    dialogTitle,
  });
  return true;
}

function isUserShareCancel(err: unknown): boolean {
  const name = (err as { name?: string })?.name ?? "";
  const msg = String((err as { message?: string })?.message ?? "").toLowerCase();
  return name === "AbortError" || msg.includes("cancel") || msg.includes("dismiss");
}

/**
 * Save export file — awaits share/download so success toasts match real outcomes.
 * On Android/iOS opens the system share sheet (pick Files, Drive, WhatsApp, etc.).
 */
export async function saveExportedFile(
  filename: string,
  body: string | Blob,
  mime: string,
  options?: { shareDialogTitle?: string },
): Promise<boolean> {
  const blob = body instanceof Blob ? body : new Blob([body], { type: mime });
  const safeName = sanitizeFilename(filename);

  if (Capacitor.isNativePlatform()) {
    try {
      return await saveViaNativeShare(safeName, blob, options?.shareDialogTitle);
    } catch (err) {
      if (isUserShareCancel(err)) return false;
      try {
        const url = URL.createObjectURL(blob);
        const opened = window.open(url, "_blank");
        if (opened) {
          window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
          return true;
        }
        URL.revokeObjectURL(url);
      } catch {
        /* fall through */
      }
      return false;
    }
  }

  const file = new File([blob], safeName, { type: mime });
  if (typeof navigator !== "undefined" && navigator.share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: safeName });
      return true;
    } catch (err) {
      if (isUserShareCancel(err)) return false;
    }
  }

  try {
    const url = URL.createObjectURL(blob);
    const ok = triggerAnchorDownload(url, safeName);
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return ok;
  } catch {
    return false;
  }
}

/** @deprecated Use saveExportedFile (async). */
export function downloadBlobFile(filename: string, body: string | Blob, mime: string): boolean {
  void saveExportedFile(filename, body, mime);
  return false;
}
