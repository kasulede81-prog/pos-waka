/**
 * Resolve a file from Vite `public/` for the active deploy base.
 *
 * Web / Capacitor typically use `base: "/"` → `/waka-logo.png`.
 * Electron packaged builds use `base: "./"` → `./waka-logo.png` so assets
 * resolve next to `dist/index.html` under `file://` (not the drive root).
 */
export function publicAssetUrl(path: string): string {
  const cleaned = String(path ?? "").replace(/^\/+/, "");
  if (!cleaned) return import.meta.env.BASE_URL || "./";
  const base = import.meta.env.BASE_URL || "/";
  return base.endsWith("/") ? `${base}${cleaned}` : `${base}/${cleaned}`;
}
