# Waka POS — Android release

## One-time: create a signing key

From the `android` folder:

```bash
keytool -genkeypair -v -keystore waka-release.jks -alias waka -keyalg RSA -keysize 2048 -validity 10000
```

Place `waka-release.jks` in this `android` folder (or set `storeFile` to another path in `keystore.properties`).

## Configure signing

1. Copy `keystore.properties.example` to `keystore.properties`.
2. Set `storeFile` to the path of your `.jks` relative to this `android` folder (e.g. `waka-release.jks`).
3. Fill `storePassword`, `keyAlias`, and `keyPassword`.

`keystore.properties` and `*.jks` must stay out of git (see `.gitignore`).

## Build from project root

After `npm run build` and `npx cap sync android` (or `npm run cap:build`):

### Signed release APK

```bash
cd android
gradlew.bat assembleRelease
```

macOS/Linux: `./gradlew assembleRelease`

**Output:** `android/app/build/outputs/apk/release/app-release.apk`

### Signed Android App Bundle (Play Store)

```bash
cd android
gradlew.bat bundleRelease
```

macOS/Linux: `./gradlew bundleRelease`

**Output:** `android/app/build/outputs/bundle/release/app-release.aab`

Or from repo root: `npm run cap:bundle:release` (Windows).

If `keystore.properties` is missing, Gradle still builds an **unsigned** release (internal testing only).

## Play / updates

Bump `versionCode` in `app/build.gradle` for every store upload. Keep `versionName` human-readable (e.g. `1.0.1`).

Full guide: `docs/ANDROID.md`
