import { Capacitor } from "@capacitor/core";
import { Camera, CameraErrorCode, MediaTypeSelection } from "@capacitor/camera";

export type PickedImage = {
  file: File;
  /** Native content/file URI when available (for ML Kit OCR, etc.). */
  nativePath?: string;
};

function extensionForFormat(format?: string): string {
  const f = (format ?? "jpeg").toLowerCase();
  if (f === "png") return "png";
  if (f === "gif") return "gif";
  if (f === "webp") return "webp";
  return "jpg";
}

function mimeForFormat(format?: string): string {
  const ext = extensionForFormat(format);
  if (ext === "png") return "image/png";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  return "image/jpeg";
}

async function mediaResultToFile(
  result: { webPath?: string; uri?: string; format?: string; metadata?: { format?: string } },
  fallbackName: string,
): Promise<PickedImage> {
  const format = result.metadata?.format ?? result.format;
  const webPath = result.webPath;
  if (!webPath) {
    throw new Error("image_path_missing");
  }
  const response = await fetch(webPath);
  if (!response.ok) {
    throw new Error("image_read_failed");
  }
  const blob = await response.blob();
  const ext = extensionForFormat(format);
  const file = new File([blob], `${fallbackName}.${ext}`, { type: blob.type || mimeForFormat(format) });
  return { file, nativePath: result.uri ?? webPath };
}

function isUserCancel(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return (
    code === CameraErrorCode.ChooseMediaCancelled ||
    code === CameraErrorCode.TakePhotoCancelled ||
    code === CameraErrorCode.EditPhotoCancelled
  );
}

/**
 * Pick a single image via the system Photo Picker (Android) / gallery (iOS).
 * Does not require READ_MEDIA_IMAGES or READ_EXTERNAL_STORAGE.
 */
export async function pickImageFromGallery(): Promise<PickedImage | null> {
  if (!Capacitor.isNativePlatform()) {
    return null;
  }
  try {
    const { results } = await Camera.chooseFromGallery({
      mediaType: MediaTypeSelection.Photo,
      allowMultipleSelection: false,
      editable: "no",
    });
    const first = results[0];
    if (!first?.webPath) return null;
    return mediaResultToFile(first, `waka-image-${Date.now()}`);
  } catch (err) {
    if (isUserCancel(err)) return null;
    throw err;
  }
}

/**
 * Capture a new photo with the device camera (requires CAMERA permission only).
 */
export async function captureImageWithCamera(): Promise<PickedImage | null> {
  if (!Capacitor.isNativePlatform()) {
    return null;
  }
  try {
    const result = await Camera.takePhoto({
      quality: 90,
      saveToGallery: false,
      editable: "no",
    });
    if (!result.webPath) return null;
    return mediaResultToFile(result, `waka-camera-${Date.now()}`);
  } catch (err) {
    if (isUserCancel(err)) return null;
    throw err;
  }
}

/**
 * Web fallback: open a hidden file input. On native, prefer pickImageFromGallery().
 */
export function pickImageFromFileInput(accept = "image/*"): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.style.display = "none";
    const cleanup = () => {
      input.remove();
    };
    input.addEventListener("change", () => {
      const file = input.files?.[0] ?? null;
      cleanup();
      resolve(file);
    });
    input.addEventListener("cancel", () => {
      cleanup();
      resolve(null);
    });
    document.body.appendChild(input);
    input.click();
  });
}

/** Gallery on native; file input on web. */
export async function pickImageForUpload(): Promise<PickedImage | null> {
  if (Capacitor.isNativePlatform()) {
    return pickImageFromGallery();
  }
  const file = await pickImageFromFileInput("image/*");
  return file ? { file } : null;
}
