# WAKA POS — iOS Setup Guide

Native iOS shell for the same Vite web app in `dist/`. **Do not run `npx cap init`** — this repo already uses `capacitor.config.ts`.

| Setting | Value |
|---------|--------|
| App name | Waka POS |
| Bundle ID | `ug.waka.pos` |
| Web bundle | `dist/` (`webDir`) |
| Min iOS | 15.0 |
| Capacitor | 8.x (SPM plugins) |

On iOS, signed-out users land on **Sign in** (`/login`), not the marketing site.

---

## Prerequisites

1. **macOS** with **Xcode** (latest stable) and Command Line Tools  
   `xcode-select -p` should point at Xcode.app
2. **Node.js 20+** and `npm install` at the repo root
3. **Apple ID** (Simulator) or **Apple Developer Program** (device + TestFlight)
4. CocoaPods is **not** required for Capacitor 8 plugin packages (SPM). Xcode resolves `Package.swift` automatically.
5. Production env file (for a usable login build):

```bash
cp .env.production.example .env.production.local
# Set at least:
# VITE_SUPABASE_URL=
# VITE_SUPABASE_ANON_KEY=
# VITE_APP_URL=https://pos.waka.ug
```

Supabase URL, anon key, and app URL are **baked into** `dist/` at build time. After changing them: rebuild + sync.

---

## Daily workflow

### One command (recommended)

```bash
npm install
npm run ios
```

**Login requires** `.env.production.local` with `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`.  
Without it, `npm run ios` now **exits** (cloud auth cannot work in a bundle built without those vars). See `IOS_LOGIN_FIX.md`.

### Live reload (Vite → Simulator)

```bash
npm run ios:dev
```

Loads `http://<Mac-LAN-IP>:5173` inside Capacitor instead of bundled `dist/`. Keep the terminal running.

### Explicit Capacitor workflow

```bash
npm install
npm run build
npx cap sync ios
npx cap open ios
```

### Useful npm scripts

| Script | Purpose |
|--------|---------|
| `npm run ios` | Build (if needed) + sync + open Xcode |
| `npm run build:ios` | Production web build + `cap sync ios` |
| `npm run ios:sync` | Sync only |
| `npm run ios:open` | Open Xcode only |
| `npm run cap:run:ios` | Build + sync + run on default simulator/device |
| `npm run cap:assets` | Regenerate Android + iOS + PWA icons/splash |

Fast reopen when web is already built:

```bash
SKIP_IOS_BUILD=1 SKIP_BRAND_ASSETS=1 npm run ios
```

---

## Simulator

1. Run `npm run ios` (or open Xcode after sync).
2. In Xcode, select an **iPhone** simulator.
3. Press **Run ▶**.
4. First launch may take longer while Swift packages resolve.

CLI alternative:

```bash
npm run build:ios
npx cap run ios
```

---

## Physical device

1. Connect the iPhone/iPad via USB (or enable wireless debugging).
2. In Xcode → **Signing & Capabilities**:
   - Team: your Apple Developer team
   - Bundle Identifier: `ug.waka.pos` (must match App ID)
3. Trust the developer certificate on the device if prompted (**Settings → General → VPN & Device Management**).
4. Run ▶ on the physical device.

**Capabilities already prepared in the project:**

- URL schemes: `wakapos://`, `ug.waka.pos://` (OAuth / auth handoff)
- Associated Domains entitlements for `pos.waka.ug` and `waka.ug` (requires App ID capability + AASA file on the server)

Privacy usage strings are in `ios/App/App/Info.plist` (camera, photos, location, Face ID).

---

## App Store / TestFlight deployment

1. Ensure production env is set and run:

   ```bash
   npm run build:ios
   npx cap open ios
   ```

2. In Xcode: select **Any iOS Device (arm64)** → **Product → Archive**.
3. Organizer → **Distribute App** → **App Store Connect** → Upload.
4. In [App Store Connect](https://appstoreconnect.apple.com):
   - Create the app with bundle ID `ug.waka.pos`
   - Fill privacy labels, screenshots, description
   - Add the build to **TestFlight** for internal testers
   - Submit for App Review when ready

5. Export compliance: Info.plist sets `ITSAppUsesNonExemptEncryption` to `false` (standard HTTPS). Confirm this matches your actual cryptography use.

### Version numbers

Keep these aligned (enforced by `npm run check:app-versions`):

| Field | Location | Current |
|-------|----------|---------|
| Marketing version | `package.json` + iOS `MARKETING_VERSION` + Android `versionName` | `1.0.12` |
| Build number | iOS `CURRENT_PROJECT_VERSION` / Android `versionCode` | `18` |

Bump both marketing + build before each App Store upload.

---

## Auth / deep links checklist

Allow in Supabase Auth redirect URLs (see `getSupabaseAuthRedirectUrls()`):

- `https://pos.waka.ug/auth/callback`
- `https://pos.waka.ug/reset-password`
- `https://localhost/auth/callback`
- `https://localhost/reset-password`
- Custom scheme returns via `wakapos://callback…`

Google OAuth JS origins should include `https://localhost` for the Capacitor WebView.

For Universal Links, host an Apple App Site Association file and enable Associated Domains on the App ID.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Blank screen / wrong API | Missing `.env.production.local` → rebuild + sync |
| `ios/` missing | `npx cap add ios` (already done in this repo) |
| Signing errors | Set Team in Xcode; create matching App ID |
| Associated Domains signing fail | Enable capability in Apple Developer portal, or temporarily remove `CODE_SIGN_ENTITLEMENTS` for local-only builds |
| Stale UI after web change | `npm run build && npx cap sync ios` |
| Splash assets warning | Regenerate: `npm run cap:assets` then sync |

---

## Related docs

- `AUDIT.md` — architecture, risks, remaining App Store work
- `docs/ANDROID.md` — Android Capacitor twin workflow
- `docs/DEPLOYMENT.md` — web / env deployment notes
