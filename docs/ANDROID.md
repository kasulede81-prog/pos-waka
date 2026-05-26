# Waka POS — Android (Capacitor)

Native shell for the same web app in `dist/`. **Do not run `npx cap init`** — this project already uses `capacitor.config.ts`.

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

## Daily workflow

### 1. Build the web app (production env)

Set `VITE_*` in `.env.production.local` (see `.env.production.example`), then:

```bash
npm run build
```

Supabase URL, anon key, and `VITE_APP_URL` are **baked into** `dist/` at build time.

### 2. Sync into the Android project

```bash
npx cap sync android
```

Or one command:

```bash
npm run cap:build
```

### 3. Open in Android Studio

```bash
npm run cap:open:android
```

Opens the `android/` folder. Wait for Gradle sync to finish.

### 4. Run on a device or emulator

- Android Studio: **Run** (green play) with a device selected, **or**
- CLI: `npm run cap:run:android` (build + sync + install debug).

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

## What is already configured

- **Capacitor 8** (`@capacitor/core`, `cli`, `android`, splash, status bar, app, camera, network, …)
- **Splash screen** — Android 12+ splash API + `@capacitor/splash-screen` (hidden after shop data loads in `PosDataProvider`)
- **Adaptive icons** — `mipmap-anydpi-v26` + legacy `drawable/app_icon`
- **Edge-to-edge** — `MainActivity` + CSS `safe-area` / `viewport-fit=cover`
- **Android back button** — `useAndroidBackButton` in `AppShell`
- **HTTPS-only** network security config (no cleartext in production)
- **Permissions** — `INTERNET`, `CAMERA`, `READ_MEDIA_IMAGES` (optional camera for stock OCR)
- **On-device OCR** — custom `WakaMlkitOcrPlugin` (ML Kit)

---

## Google Sign-In on Android

The **website** uses Google Identity Services (popup). **Android/iOS** use the **system browser** + Supabase OAuth, then return to the app.

### Supabase (required)

**Authentication → URL configuration → Redirect URLs** — add:

- `https://localhost/auth/callback`
- `https://localhost/auth/recovery`

(Keep your production URLs too: `https://pos.waka.ug/auth/callback`, etc.)

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
