# WAKA POS DESKTOP — PHASE 4A.1
# PACKAGED ELECTRON ASSET / SPLASH SCREEN FIX

**Date:** 2026-08-16  
**Status:** Source fix verified via `build:electron` (Windows EXE not rebuilt in this phase)  
**Depends on:** Phase 4A native LAN ESC/POS

---

## Root cause

Splash / logos used **root-absolute** public paths in JS:

- `/waka-logo.png`
- `/brand/w-icon-*-cream.png`
- `/lottie/home/*.json`

Vite `base: "./"` rewrites HTML/`import` assets, but **not** string literals in React.

Under packaged `file://.../dist/index.html`, `/waka-logo.png` resolves to the **filesystem root** (`file:///waka-logo.png`), so the splash logo is missing. Dev/web with `http://localhost` or `https://…` still works because `/` is the site origin.

---

## Fix

`publicAssetUrl()` joins paths with `import.meta.env.BASE_URL`:

- Web / Capacitor (`base: "/"`) → `/waka-logo.png`
- Electron (`ELECTRON=1`, `base: "./"`) → `./waka-logo.png`

Applied to brand logo, home Lottie tiles, and founder photo public asset.

---

## Explicitly unchanged

POS business logic, offline/sync, auth, RS, Phase 4A printer, Android/iOS/Capacitor config, package version.

---

## Windows EXE

**NOT BUILT** in Phase 4A.1 — awaiting approval after review.
