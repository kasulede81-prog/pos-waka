/**
 * Resolve a file from Vite `public/` for the active deploy base.
 *
 * Web / Capacitor typically use `base: "/"` → `/waka-logo.png`.
 * Electron packaged builds use `base: "./"` → `./waka-logo.png` so assets
 * resolve next to `dist/index.html` under `file://` (not the drive root).
 *
 * ABSOLUTE URLS PASS THROUGH UNTOUCHED. Some assets no longer live in `public/`
 * — the printer setup video is hosted in Supabase Storage because a 35 MB file
 * does not belong in git, in `dist/`, or in a mobile bundle. A hosted asset is
 * already a complete URL, and joining it to BASE_URL would produce
 * `/https://xyz.supabase.co/…`, which is not a URL at all. So anything with a
 * scheme is returned as-is and everything else is treated as a repo path.
 *
 * This is what makes swapping a hosted asset a ONE-LINE change: the caller
 * keeps calling `publicAssetUrl(...)` with either form.
 */
const ABSOLUTE_URL = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i;

export function publicAssetUrl(path: string): string {
  const raw = String(path ?? "").trim();

  // `https://…`, `//cdn.example.com/…`, `blob:…`, `data:…` — already absolute.
  if (ABSOLUTE_URL.test(raw) || /^(?:blob|data):/i.test(raw)) return raw;

  const cleaned = raw.replace(/^\/+/, "");
  if (!cleaned) return import.meta.env.BASE_URL || "./";
  const base = import.meta.env.BASE_URL || "/";
  return base.endsWith("/") ? `${base}${cleaned}` : `${base}/${cleaned}`;
}
