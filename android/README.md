# Waka POS — Android shell

Open this folder from Android Studio after syncing the web app from the **project root**.

## Quick start (from repo root)

```bash
npm install
# Copy .env.production.example → .env.production.local (Supabase + VITE_APP_URL)
npm run android
```

Or from project root on Windows:

```bash
.\cap open android
```

Then **Run** (▶) in Android Studio.

`npx cap open android` (global npx) only opens Studio — use **`npm run android`** or **`.\cap open android`** so build + sync run first.

Full docs: [docs/ANDROID.md](../docs/ANDROID.md)
