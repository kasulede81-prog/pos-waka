# Waka POS — Android (Capacitor)

Native shell for the same web app in `dist/`. **Do not run `npx cap init`** — this project already uses `capacitor.config.ts`.

On Android/iOS, the app opens on **Sign in** (`/login`), not the public marketing landing (`/home`). **Register** is at `/register`. Before sign-in, only auth and legal/support pages are reachable (Terms, Privacy, Refund, Acceptable use, Support) — linked from the footer on login/register, same layout as sign-in (no marketing site chrome).

### Cloud sync on Android

Sync uses the same Supabase + offline queue as the web app, with native-specific behavior:

| When | What happens |
|------|----------------|
| After sign-in | Full cloud pull (`hydrateAccountFromCloud` with `forcePull`) |
| After local DB loads | Background pull (~400ms) then push (~12s) |
| Sale completed | Immediate push when online |
| App returns to foreground | Push + pull (throttled; uses Capacitor **Network** plugin, not only `navigator.onLine`) |
| While selling | `SyncStatusProvider` pushes pending rows when connectivity returns |

**Verify on a device:** sign in → confirm products/sales appear → make a sale offline → reconnect → pending count clears in the header. Settings → backup/sync shows last sync time if configured.

Rebuild after code changes: `npm run android`.

| Setting | Value |
|---------|--------|
| App name | Waka POS |
| App ID (Play Console) | `ug.waka.pos` |
| Web bundle | `dist/` (from `npm run build`) |
| Min SDK | 24 |
| Target / compile SDK | 36 |

---

## Prerequisites

1. **Node.js** 20+ and `npm install` in the project root.
2. **Android Studio** (latest stable) with:
   - Android SDK Platform 36
   - Android SDK Build-Tools
   - Android SDK Command-line Tools
3. **JDK 21** — required by Capacitor 8. Easiest: use Android Studio’s embedded JBR (`C:\Program Files\Android\Android Studio\jbr` on Windows). Set **`JAVA_HOME`** to that folder before CLI Gradle builds, or uncomment `org.gradle.java.home` in `android/gradle.properties`. The project also enables Gradle’s **foojay** toolchain resolver to auto-download JDK 21 when needed.
4. Environment variable **`ANDROID_HOME`** or **`ANDROID_SDK_ROOT`** pointing at your SDK (Android Studio → Settings → Android SDK → path).

---

## Daily workflow (one command)

### 1. Production env (once)

Copy `.env.production.example` → `.env.production.local` and set:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_APP_URL=https://pos.waka.ug`

Supabase URL, anon key, and app URL are **baked into** `dist/` at build time.

### 2. Build, sync, and open Android Studio

```bash
npm run android
```

Same as `npm run cap:open:android`. This runs:

1. `npm run build` (production web app → `dist/`)
2. `npx cap sync android` (copy `dist/` + native plugins into `android/`)
3. `npx cap open android` (Android Studio)

Wait for Gradle sync in Android Studio, then press **Run** (▶) on a device or emulator.

**Fast re-open** (web already built): `SKIP_ANDROID_BUILD=1 npm run android`

**Plain Capacitor** (no build/sync — only if you already ran the command above):

```bash
npx cap open android
```

### 3. Run from CLI (optional)

```bash
npm run cap:run:android
```

Build + sync + install debug APK on a connected device/emulator.

---

## Release signing (Play Store)

1. Create a keystore (once), from the `android` folder:

   ```bash
   keytool -genkeypair -v -keystore waka-release.jks -alias waka -keyalg RSA -keysize 2048 -validity 10000
   ```

2. Copy `android/keystore.properties.example` → `android/keystore.properties` and fill in paths/passwords.

3. Never commit `keystore.properties` or `*.jks`.

---

## Generate signed Android App Bundle (.aab)

From project root (Windows):

```bash
npm run cap:bundle:release
```

macOS / Linux:

```bash
npm run cap:build && cd android && ./gradlew bundleRelease
```

### Where is the .aab file?

After a successful build:

```
android/app/build/outputs/bundle/release/app-release.aab
```

Upload this file to **Google Play Console** → your app → **Production** (or testing track) → **Create new release**.

### Signed APK (optional sideload)

```bash
npm run cap:apk:release
```

Output:

```
android/app/build/outputs/apk/release/app-release.apk
```

If `keystore.properties` is missing, Gradle still builds an **unsigned** release artifact (fine for local testing; Play needs signing).

---

## Version bumps for each store upload

Edit `android/app/build.gradle`:

- `versionCode` — integer, **must increase** every Play upload.
- `versionName` — user-visible string (e.g. `1.0.1`).

---

## App icon & splash artwork

Official W cart mark: `resources/w-symbol-source.png`. Regenerate all exports:

```bash
npm run brand:assets   # resources/brand/* + logo.png + splash.png + public icons
npm run cap:assets     # Android mipmaps + PWA (includes brand:assets)
```

Play Store icon: `resources/brand/icon-1024-cream.png` (1024×1024).

---

## What is already configured

- **Capacitor 8** (`@capacitor/core`, `cli`, `android`, splash, status bar, app, camera, network, …)
- **Splash screen** — Android 12+ splash API + `@capacitor/splash-screen` (hidden after shop data loads in `PosDataProvider`)
- **Adaptive icons** — `mipmap-anydpi-v26` + legacy `drawable/app_icon`
- **Edge-to-edge** — `MainActivity` + CSS `safe-area` / `viewport-fit=cover`
- **Android back button** — `useAndroidBackButton` in `AppShell`
- **HTTPS-only** network security config (no cleartext in production)
- **Permissions** — `INTERNET`, `CAMERA` (barcode scan / take-photo OCR). Gallery picks use the **Android Photo Picker** — no `READ_MEDIA_IMAGES`, `READ_MEDIA_VIDEO`, or legacy storage permissions.
- **On-device OCR** — custom `WakaMlkitOcrPlugin` (ML Kit)

---

## Google Sign-In on Android

The **website** uses Google Identity Services (popup). **Android/iOS** use the **system browser** + Supabase OAuth, then return to the app.

### Supabase (required)

**Authentication → URL configuration → Redirect URLs** — add:

- `https://localhost/auth/callback`
- `https://localhost/reset-password`
- `https://localhost/auth/recovery` (legacy reset emails)

(Keep your production URLs too: `https://pos.waka.ug/auth/callback`, `https://pos.waka.ug/reset-password`, etc. See [PASSWORD_RESET_BRANDED_FLOW.md](./PASSWORD_RESET_BRANDED_FLOW.md).)

`AndroidManifest.xml` includes intent filters for `/auth/callback`, `/auth/recovery`, and `/reset-password` on `https://localhost` (Capacitor WebView origin).

### Google Cloud

For native OAuth, Supabase uses the **Google provider** configured in the Supabase dashboard (not `VITE_GOOGLE_OAUTH_CLIENT_ID`). Ensure Google is enabled under **Supabase → Authentication → Providers → Google**.

Optional for web GIS popup: add `https://localhost` to **Authorized JavaScript origins** on your Web OAuth client.

### Shop data on a new phone

After sign-in, the app **pulls products and shop name from Supabase**. If the shop looks empty:

1. Confirm you signed in with the **same account** as on the web app.
2. Check internet on the device.
3. Open **Back Office → Backup & sync** (or wait a few seconds after login for background sync).

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `cap init` fails with non-JSON config | Expected — use existing `capacitor.config.ts`, only `cap sync`. |
| Blank / old UI on device | Run `npm run build` then `npx cap sync android` again. |
| Gradle sync failed | Open SDK Manager; install API 36 + Build-Tools; use JDK 21. |
| Google Sign-In fails on Android | Add `https://localhost/auth/callback` to Supabase redirect URLs; rebuild & reinstall app. |
| Shop empty after login | Same Google/email account as web; wait for sync or check network. |
| Auth redirect fails on device | Native uses `https://localhost` — not `VITE_APP_URL` for OAuth return. |
| Splash never hides | Ensure `PosDataProvider` mounts (signed-in / local account flow). |

See also `android/README-RELEASE.md` and `docs/DEPLOYMENT.md` §6.
