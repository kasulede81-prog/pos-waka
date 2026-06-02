# WAKA POS — Release distribution (not in Git)

The Git repository contains **source code only**. Installers, Electron unpack trees, and other binary release artifacts must **never** be committed.

---

## What belongs in Git

- Application source (`src/`, `electron/`, `android/`, `supabase/`, etc.)
- Build configuration (`package.json`, Vite/Electron/Capacitor config)
- Migrations, docs, tests
- Small generated Android baseline profiles under `android/app/release/baselineProfiles/` (when required by the Android build)

## What must stay out of Git

Tracked only on disk or in release channels — see `.gitignore`:

| Artifact | Examples |
|----------|----------|
| Windows installers | `*.exe`, `*.msi`, `*.blockmap` |
| Electron output | `release/`, `win-unpacked/`, `app.asar` |
| Builder metadata | `latest.yml`, `builder-debug.yml`, `builder-effective-config.yaml` |
| Archives | `*.zip`, `*.7z` |
| Generated icons | `build/icon.ico`, `build/icon.png` |
| Frontend bundle output | `dist/` |

Local builds may write under `release/windows/` or `release/windows-build/`; those paths are ignored by Git.

---

## Where to publish installers

| Channel | Use for |
|---------|---------|
| **GitHub Releases** | Primary: `WAKA-POS-Setup-<version>.exe`, Android APK/AAB, release notes, checksums |
| **Website / CDN** | Public download links (e.g. pos.waka.ug) |
| **Firebase App Distribution** | Pilot / internal Android builds |
| **Google Play** | Production Android (see `docs/PLAY_STORE.md`) |
| **Google Drive / ops share** | Ad-hoc pilot handoffs (not a substitute for versioned releases) |

### GitHub Release checklist

1. Tag from `main` after merge: `v1.0.x`
2. Run `npm run build` and platform packaging locally or in CI **without** committing `release/`
3. Attach artifacts to the Release (do not `git add` them):
   - Windows: `WAKA-POS-Setup-<version>.exe`
   - Android: signed APK or AAB from `android/` build
4. Paste release notes (features, migrations, known issues)
5. Optional: SHA-256 of `.exe` / APK in release body

### Windows build (local)

```bash
npm run installer:windows
```

Output (ignored by Git): typically `release/windows-build/WAKA-POS-Setup-<version>.exe` or `release/windows/` depending on lock/state — upload the installer only via Releases or your download site.

---

## If artifacts were committed by mistake

1. **Not pushed yet:** `git reset --soft HEAD~1`, expand `.gitignore`, `git rm -r --cached release/`, recommit source only.
2. **Already pushed:** history rewrite (`git filter-repo` / BFG) is required; coordinate with all clones; never force-push `main` without team agreement.

After cleanup, run `git gc --prune=now` locally to drop unreachable blobs from aborted commits.

---

## Related docs

- [DEPLOYMENT.md](./DEPLOYMENT.md) — Vercel, Supabase, PWA
- [ANDROID.md](./ANDROID.md) — Capacitor / Android builds
- [PILOT_RELEASE_CHECKLIST.md](./PILOT_RELEASE_CHECKLIST.md) — Pilot go-live checks
