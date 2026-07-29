# App icons & splash

Source artwork:

- `w-symbol-source.png` — official W cart mark (do not redesign)
- `logo.png` — generated 1024 app icon (cream background, symbol only)
- `splash.png` — generated splash master for Capacitor
- `brand/` — full export set (icons, splash, mono, SVG, small sizes)

Regenerate everything:

```bash
npm run brand:assets   # PNG/SVG exports from w-symbol-source.png
npm run cap:assets     # brand + Android/iOS/PWA assets from logo.png + splash.png
npm run cap:build      # Android sync
npm run build:ios      # iOS sync
```

See `brand/README.md` for file listing. iOS setup: `IOS_SETUP.md`.
