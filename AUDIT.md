# WAKA POS — iOS Capacitor Audit

**Date:** 2026-07-24  
**App ID / Bundle ID:** `ug.waka.pos`  
**Version:** `1.0.12` (iOS `MARKETING_VERSION`) / build `18` (`CURRENT_PROJECT_VERSION`, aligned with Android `versionCode`)

---

## Architecture

| Layer | Technology |
|-------|------------|
| UI | React 19 + TypeScript |
| Build | Vite 8 (`webDir`: `dist`) |
| Routing | `react-router-dom` v7 — `BrowserRouter` (web + Capacitor), `HashRouter` (Electron only) |
| Backend | Supabase (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) |
| Offline | IndexedDB (`idb`) + sync queue |
| Native shells | Capacitor 8 → **Android** (existing) + **iOS** (added) |
| Desktop | Electron (`electron/main.cjs`) — Windows packaging only |
| Hosting (web) | Vercel SPA (`vercel.json`) |

```
src/  ──Vite──►  dist/  ──cap sync──►  ios/App/App/public
                                  └──►  android/app/src/main/assets/public
electron/ ──loads──► dist/ (file:// + HashRouter)
```

Native entry for signed-out users is `/login` (`src/lib/nativeApp.ts`). Marketing routes are blocked on device via `NativeMarketingGuard`.

---

## Detected stack (audit)

### Framework & build
- Vite + `@vitejs/plugin-react` + `vite-plugin-pwa`
- `base: "/"` for web/Capacitor; `base: "./"` only when `ELECTRON=1`
- TypeScript project references (`tsc -b`)

### Routing
- Capacitor iOS uses `https://localhost` (`server.iosScheme: "https"`) — compatible with `BrowserRouter`
- Electron uses `HashRouter` — unchanged

### Environment / API
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_APP_URL` baked at build time
- Optional: Google OAuth, Sentry, monitoring ingest
- No runtime switch for API hosts inside the IPA — rebuild after env changes

### Electron-specific code (isolated)
- `src/lib/electronDesktop.ts` — UA detection
- `App.tsx` — HashRouter only when Electron
- `main.tsx` — skips PWA SW on Electron **and** Capacitor native
- `electron/main.cjs` + `electron/preload.cjs` — desktop only
- `build:electron` / Windows installer scripts — unchanged

### Capacitor plugins already in use
App, Browser, Camera, Filesystem, Geolocation, Haptics, Keyboard, Network, Preferences, Share, Splash Screen, Biometric Auth

### Browser / WebView caveats on iOS

| Feature | Status on iOS WebView | Existing / recommended approach |
|---------|----------------------|----------------------------------|
| Service Worker / PWA | Unreliable / undesirable | **Skipped** on native (`main.tsx`) |
| `window.print()` | Often no-op | Share PDF fallback (`documentPrint.ts`, `fileDownload.ts`) |
| File download `<a download>` | Limited | Capacitor Filesystem + Share |
| Web Bluetooth / USB / Serial | Unsupported | N/A for current POS flows |
| `navigator.onLine` | Flaky | Capacitor Network plugin |
| Camera / barcodes | Needs plugin + permission | `@capacitor/camera` + Info.plist |
| Biometrics | Needs plugin + Face ID string | `@aparajita/capacitor-biometric-auth` |
| Geolocation | Needs permission string | `@capacitor/geolocation` |
| IndexedDB / localStorage | Supported | Existing offline stack |
| Mapbox GL | Works with caveats | Used in internal admin; heavy — keep lazy |

---

## Changes made

1. **`capacitor.config.ts`** — iOS block, `iosScheme: "https"`, splash background `#fffaf5`
2. **`ios/` platform** — `npx cap add ios` (Xcode project + SPM plugin packages)
3. **`ios/App/App/Info.plist`** — camera, photos, location, Face ID usage strings; `wakapos` / `ug.waka.pos` URL schemes; encryption export flag
4. **`ios/App/App/App.entitlements`** — Associated Domains for `pos.waka.ug` / `waka.ug`
5. **Version alignment** — `MARKETING_VERSION = 1.0.12`, `CURRENT_PROJECT_VERSION = 18`
6. **Icons & splash** — generated via `@capacitor/assets` into `Assets.xcassets`
7. **`package.json` scripts** — `ios`, `ios:sync`, `ios:open`, `build:ios`, `cap:sync:ios`, `cap:open:ios`, `cap:run:ios`, `cap:build:ios`; `cap:assets` now includes `--ios`
8. **`scripts/ios-open.mjs`**, **`scripts/ensure-capacitor-icon.mjs`**
9. **`src/main.tsx`** — do not register PWA service worker on Capacitor native (web + Electron behavior preserved)
10. **`.gitignore`** — iOS DerivedData / user state / copied `public` noise
11. **`scripts/check-app-version-alignment.mjs`** — also checks iOS `MARKETING_VERSION`
12. Docs: this file + `IOS_SETUP.md`

**Not changed:** POS business logic, Electron packaging, Android app id, Vite `webDir`, React routes.

---

## Remaining work (App Store / production)

- [ ] Apple Developer Program membership + App ID `ug.waka.pos`
- [ ] Create App Store Connect app + privacy nutrition labels
- [ ] Enable **Associated Domains** on the App ID; host `apple-app-site-association` on `pos.waka.ug` / `waka.ug`
- [ ] Add `https://localhost` (and production URLs) to Supabase Auth redirect allowlist / Google OAuth JS origins (already documented in `authConfig.ts`)
- [ ] Configure signing team in Xcode (Automatic → your Team)
- [ ] Production `.env.production.local` before shipping (Supabase + `VITE_APP_URL=https://pos.waka.ug`)
- [ ] Implement real iOS update path (`IOSUpdateAdapter` is currently a placeholder)
- [ ] App Store screenshots (iPhone + iPad if universal)
- [ ] TestFlight internal → external testing
- [ ] Optional: push notifications (not required for current POS core)

---

## App Store readiness

| Area | Ready? | Notes |
|------|--------|-------|
| Bundle ID | Yes | `ug.waka.pos` |
| Icons / splash | Yes | Generated from `resources/` |
| Privacy strings | Yes | Camera, photos, location, Face ID |
| Encryption questionnaire | Yes | `ITSAppUsesNonExemptEncryption = false` (HTTPS only) |
| Signing / ASC | No | Requires your Apple team |
| Universal Links AASA | Partial | Entitlement present; server file + portal capability TBD |
| TestFlight binary | Near | Build + archive in Xcode after signing |

---

## Performance recommendations

1. Keep **lazy routes** for internal admin / Mapbox — already chunked in Vite.
2. Avoid registering a **service worker** inside Capacitor (done).
3. Prefer Capacitor **Share / Filesystem** over large base64 data URLs for receipts.
4. Profile cold start: splash is manually dismissed after auth/POS ready — keep that path fast.
5. On low-memory iPads, avoid opening Mapbox + large report PDFs simultaneously.
6. Re-run `npm run build && npx cap sync ios` after any web change before device QA.

---

## Verification performed

- `npm run build` → `dist/` produced (web OK)
- `npx cap add ios` + `npx cap sync ios`
- `capacitor-assets generate --ios`
- `xcodebuild … -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO` → **succeeded**
- `npm run check:app-versions` → aligned
