# Waka POS — Android release

## One-time: create a signing key

From the `android` folder, generate a keystore (adjust names as you like):

```bash
keytool -genkeypair -v -keystore waka-release.jks -alias waka -keyalg RSA -keysize 2048 -validity 10000
```

Place `waka-release.jks` in this `android` folder (or another path you prefer).

## Configure signing

1. Copy `keystore.properties.example` to `keystore.properties`.
2. Set `storeFile` to the path of your `.jks` relative to this `android` folder (e.g. `waka-release.jks`).
3. Fill `storePassword`, `keyAlias`, and `keyPassword`.

`keystore.properties` and `*.jks` must stay out of git (see `.gitignore`).

## Build a signed release APK

From the project root (after `npm run build` and `npx cap sync android`):

```bash
cd android
./gradlew assembleRelease
```

The APK is under `android/app/build/outputs/apk/release/`.

If `keystore.properties` is missing, Gradle still builds an **unsigned** release APK (useful for internal testing); Play Console or sideloading usually needs a signed build.

## Play / updates

Bump `versionCode` in `app/build.gradle` for every store upload. Keep `versionName` human-readable (e.g. `1.0.1`).
