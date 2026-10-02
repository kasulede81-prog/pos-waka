# App icons & splash

Capacitor asset sources for `npx capacitor-assets`. All artwork is DKASU.

## Masters

These are the only files `capacitor-assets` reads here. They stay in custom mode
(`icon-only` / `icon-foreground` / `icon-background` / `splash`), so there is
deliberately **no `logo.png` and no `icon.png`** — either one would switch the
tool into "Easy Mode", which synthesises icons from a single flat logo plus a
background colour and would bypass the DKASU layers below.

- `icon-only.png` — opaque branded square (full-bleed tile gradient + white mark). Legacy icons + iOS.
- `icon-foreground.png` — white mark inside the 66dp safe zone, transparent. Android adaptive foreground.
- `icon-background.png` — full-bleed tile gradient. Android adaptive background.
- `splash.png` — light splash master.
- `splash-dark.png` — dark splash master.

`assets.json` only supplies Easy-Mode colours, which are unused in custom mode;
it is kept accurate for reference.

## Regenerating

```bash
npm run brand:assets   # DKASU masters + brand exports, from public/brand/dkasu/
npm run cap:assets     # brand + Android/iOS/PWA assets + Android finalisation
npm run cap:build      # Android sync
npm run build:ios      # iOS sync
```

`brand:assets` samples the supplied artwork in `public/brand/dkasu/` — it never
redraws the logo. See `brand/README.md` for the export listing, and
`docs/ANDROID.md` for the Android-specific pipeline.

## Not read by any build

`play-store/` and `play-screenshots-source/` are manual Play Console upload
material. They are **not** part of `cap:assets` and are not regenerated.
