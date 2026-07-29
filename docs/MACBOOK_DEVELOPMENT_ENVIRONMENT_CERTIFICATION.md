# WAKA POS — macOS Development Environment Certification

**Date:** 2026-07-29  
**Host:** MacBook Pro (Apple Silicon / M1), macOS 26.5.1 (Build 25F80)  
**Project:** `/Users/admin/Developer/pos-waka` (React + Vite + Capacitor)  
**Certification scope:** Android development workstation readiness (emulator, build, run, live reload)

---

## Executive verdict

**CERTIFIED with notes** for daily WAKA POS Android development on this MacBook.

| Criterion | Status |
|---|---|
| Android emulator boots | ✅ `emulator-5554 device` |
| WAKA POS builds without errors | ✅ `npm run build` + `./gradlew assembleDebug` |
| App launches on emulator | ✅ Login screen (“Welcome back!”) |
| Live reload / Vite HMR | ✅ `http://10.0.2.2:5173` — `[vite] connected` |
| Android Studio debugging available | ✅ Studio 2026.1 opened on `android/` |
| Ready for daily Android work | ✅ with RAM/workflow notes below |

---

## Installed software & versions

| Tool | Version / location | Notes |
|---|---|---|
| macOS | 26.5.1 (25F80) | Apple Silicon |
| Node.js | v26.5.0 | Present |
| npm | 11.17.0 | Present |
| pnpm | — | **Not installed** (optional; project uses npm) |
| yarn | — | **Not installed** (optional) |
| Git | 2.50.1 (Apple Git-155) | Present |
| Java (JDK) | OpenJDK 21.0.10 (Android Studio JBR) | Wired via `JAVA_HOME` in `~/.zshrc` |
| System `java` (pre-fix) | Missing from PATH | Fixed by exporting Studio JBR |
| Gradle (wrapper) | 8.14.3 | Via `android/gradlew` (no global Gradle required) |
| Android Studio | 2026.1 (AI-261.25134.95.2612.15822958) | `/Applications/Android Studio.app` |
| Android SDK | `~/Library/Android/sdk` | Present; `ANDROID_HOME` now persisted |
| Android Build Tools | 35.0.0, 36.0.0, 37.0.0 | Present |
| Android Platforms | 34, 36, 36.1, 37.2-beta1 | Present |
| Platform Tools / adb | 37.0.0 / ADB 1.0.41 | Present |
| Android Emulator | 36.6.11.0 | Present; HVF `kern.hv_support=1` |
| Flutter | 3.44.7 (stable) | Present (not required for WAKA Capacitor flow) |
| Dart | 3.12.2 | Present |
| Xcode | 26.6 (17F113) | Present (iOS path) |
| CocoaPods | 1.17.0 | Present |
| Capacitor CLI | 8.4.2 | Project-local |
| Vite | 8.0.11 | Project-local |
| Homebrew | 6.0.13 | Present |

### Environment fixes applied (safe)

1. Appended Android/Java PATH block to `~/.zshrc`:
   - `ANDROID_HOME` / `ANDROID_SDK_ROOT` → `~/Library/Android/sdk`
   - `JAVA_HOME` → Android Studio JBR
   - PATH includes `platform-tools`, `emulator`, `cmdline-tools/latest/bin`
2. Accepted Android SDK licenses (`sdkmanager --licenses`).
3. Wrote `android/local.properties` → `sdk.dir=/Users/admin/Library/Android/sdk`.
4. Installed system images:
   - `system-images;android-36;google_apis;arm64-v8a`
   - `system-images;android-34;google_apis;arm64-v8a`
5. Created AVDs (see Emulator details).

---

## Missing / optional components

| Item | Impact | Action |
|---|---|---|
| pnpm / yarn | None for this repo | Skip unless team standardizes on them |
| Standalone OpenJDK (Homebrew) | None | Studio JBR is sufficient |
| Global Gradle | None | Use project `gradlew` |
| Physical Android device | Optional | Prefer USB device on this 8 GB Mac for heavier sessions |

---

## Android Studio status

| Check | Result |
|---|---|
| Installation | ✅ Present |
| SDK location | ✅ `~/Library/Android/sdk` |
| SDK licenses | ✅ Accepted |
| Build Tools / Platform Tools | ✅ |
| Emulator support | ✅ |
| Hypervisor acceleration | ✅ `kern.hv_support=1` (Apple HVF) |
| Command-line tools | ✅ `cmdline-tools/latest` |
| Project open | ✅ `npx cap open android` launched Studio on `android/` |

---

## Emulator details

### AVDs created

1. **`WAKA_Pixel_8_API_36`** (recommended profile from brief)
   - Device: Pixel 8  
   - Image: Android 36 / Google APIs / ARM64  
   - Note: Heavier; on this **8 GB** host it often OOMs if Chrome/Studio/other apps compete for RAM.

2. **`WAKA_Medium_Phone_API_34`** (**certified daily driver on this machine**)
   - Device: medium_phone  
   - Image: Android 34 / Google APIs / ARM64  
   - Runtime flags used: `-memory 1536 -cores 2 -accel on -gpu host`  
   - Result: boots cleanly; appears as **`emulator-5554 device`**

### Runtime verification

```text
List of devices attached
emulator-5554          device product:sdk_gphone64_arm64 ...
```

- Hardware GPU: Apple M1 Metal (`OpenGL ES Translator (Apple M1)`)
- Boot completed (~30–40s cold)
- Host free RAM is the limiting factor — close Chrome/ChatGPT/extra Studio windows before launching AVDs on 8 GB Macs

### Launch recipe (daily)

```bash
# New terminal (env from ~/.zshrc)
emulator -avd WAKA_Medium_Phone_API_34 -memory 1536 -cores 2 -accel on -gpu host -no-boot-anim &
adb wait-for-device
adb shell getprop sys.boot_completed   # expect: 1
```

---

## Capacitor status

| Check | Result |
|---|---|
| `capacitor.config.ts` | ✅ App ID `ug.waka.pos`, webDir `dist` |
| `npx cap sync android` | ✅ Sync finished; 12 plugins |
| Live-reload config | ✅ Via `CAPACITOR_LIVE_RELOAD` / `CAPACITOR_DEV_SERVER_URL` |
| Production assets | ✅ Re-synced without `server.url` after live-reload test |

### Native config adjustments (Android only — no business logic)

- `android/app/src/debug/AndroidManifest.xml` — debug cleartext for Vite HTTP  
- `android/app/src/debug/res/xml/network_security_config.xml` — debug cleartext overlay  
- Main release manifest remains `usesCleartextTraffic="false"` with `tools:replace` for merger safety  
- `scripts/android-dev.mjs` + `npm run android:dev` — Android live-reload workflow (mirrors `ios:dev`)

---

## Flutter status

Flutter **3.44.7** / Dart **3.12.2** are installed and healthy.  
WAKA POS Android shipping path is **Capacitor**, not Flutter — Flutter is available but unused for this certification.

---

## Build status

| Step | Result |
|---|---|
| `npm install` | ✅ up to date (1252 packages) |
| `npm run build` | ✅ production web bundle + PWA |
| `npx cap sync android` | ✅ |
| `./android/gradlew assembleDebug` | ✅ `BUILD SUCCESSFUL` (~10 min first cold; ~4s incremental) |
| Debug APK | ✅ `android/app/build/outputs/apk/debug/app-debug.apk` (~57 MB) |
| App version | `1.0.12` (versionCode 18), `minSdk 24`, `targetSdk 36` |

---

## Runtime status (emulator)

| Check | Result |
|---|---|
| Install | ✅ `adb install -r` Success |
| Launch | ✅ `ug.waka.pos/.MainActivity` |
| Process | ✅ pid present; activity resumed |
| Login UI | ✅ “Welcome back!” / Sign in / Staff sign in |
| Crashes | ✅ None observed (`AndroidRuntime` clean for app start) |
| White screen | ✅ No — branded splash then login |
| Assets | ✅ Logo, fonts (DM Sans), icons via `https://localhost/...` |
| Network | ✅ Capacitor Network: `{ connected: true, connectionType: "wifi" }` |

Evidence screenshots (local):

- `docs/waka-emulator-launch.png` — home screen with WAKA POS icon  
- `docs/waka-emulator-app.png` — login screen  
- `docs/waka-emulator-livereload.png` / `docs/waka-emulator-hmr.png` — live-reload session

---

## Live reload status

| Check | Result |
|---|---|
| Vite dev server | ✅ `npx vite --host 0.0.0.0 --port 5173` |
| Emulator → host | ✅ `10.0.2.2` reachable |
| Capacitor loads Vite | ✅ `Loading app at http://10.0.2.2:5173` |
| Vite client | ✅ `[vite] connecting...` → `[vite] connected.` |
| HMR on edit | ✅ Vite reported HMR updates after `src/lib/i18n.ts` touch (reverted) |
| Chrome DevTools | ✅ Use `chrome://inspect` → WebView `ug.waka.pos` (webContentsDebuggingEnabled when live-reload URL set) |
| Logcat | ✅ `adb logcat` / Capacitor Console tags |

### Daily live-reload command

```bash
npm run android:dev
```

This starts Vite, syncs Capacitor with the emulator host alias (`10.0.2.2`) or LAN IP for physical devices, builds debug, installs, and launches.

Alternate manual flow:

```bash
npm run dev   # or: npx vite --host 0.0.0.0 --port 5173
CAPACITOR_LIVE_RELOAD=1 CAPACITOR_DEV_SERVER_URL=http://10.0.2.2:5173 npx cap sync android
./android/gradlew -p android assembleDebug
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n ug.waka.pos/.MainActivity
```

---

## Developer experience checklist

| Capability | Status | How |
|---|---|---|
| Android Studio debugging | ✅ | Open `android/` → Run/Debug configurations |
| Chrome DevTools (WebView) | ✅ | `chrome://inspect` while live-reload / debug WebView enabled |
| Source maps | ✅ | Vite dev serves mapped modules |
| Logcat | ✅ | Studio Logcat or `adb logcat` |
| Hot / live reload | ✅ | Vite HMR via `android:dev` |
| Automatic rebuild detection | ✅ | Vite watches sources; native rebuild only when plugins/manifest change |

---

## Remaining issues / operational notes

1. **8 GB RAM constraint**  
   Pixel 8 / API 36 AVD + Android Studio + Cursor + browsers often kills the emulator. Prefer **`WAKA_Medium_Phone_API_34`** with 1536–2048 MB guest RAM, and close heavy apps before launch.

2. **Emulator process lifetime**  
   Launch the emulator from a dedicated terminal (or Android Studio Device Manager) so it is not tied to a short-lived script process group.

3. **Recommended AVD RAM vs brief**  
   Brief asked for 6 GB guest RAM; this host cannot sustain that. Certified config uses **1.5–2 GB** guest RAM with host GPU.

4. **Keyboard plugin**  
   Log: `Keyboard.setResizeMode` → `UNIMPLEMENTED` on Android — pre-existing Capacitor plugin limitation; does not block login/POS.

5. **pnpm / yarn**  
   Not installed; not required for WAKA POS npm scripts.

6. **Production vs live-reload APK**  
   After `android:dev`, re-run a normal `npm run build && npx cap sync android` (or `npm run android`) before shipping/store builds so `server.url` is not left pointing at Vite.

---

## Success criteria mapping

| Success criterion | Evidence |
|---|---|
| Android emulator boots successfully | `emulator-5554 device`, boot_completed=1 |
| WAKA POS builds without errors | Vite production build + Gradle `assembleDebug` SUCCESS |
| WAKA POS launches inside the emulator | Login UI screenshot / MainActivity resumed |
| Live reload is working | Capacitor loads `10.0.2.2:5173`; `[vite] connected`; HMR events |
| Android Studio debugging is available | Studio 2026.1 opened on project |
| MacBook ready for daily WAKA POS Android development | PATH/SDK/AVD/scripts certified above |

---

## Quick start (next session)

```bash
# 1) Ensure shell env (new terminal after ~/.zshrc update)
echo "$ANDROID_HOME" "$JAVA_HOME"

# 2) Start lean emulator
emulator -avd WAKA_Medium_Phone_API_34 -memory 1536 -cores 2 -accel on -gpu host -no-boot-anim &

# 3a) Bundled production-like run
npm run android          # build + sync + open Studio

# 3b) Or fastest UI iteration
npm run android:dev      # Vite live reload on emulator
```

---

**Certified by:** Cursor agent environment setup run — 2026-07-29  
**Primary Android target on this Mac:** AVD `WAKA_Medium_Phone_API_34` → `emulator-5554`
