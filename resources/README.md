# App icons & splash

Source artwork:

- `logo.png` — master logo (also copied to `public/waka-logo.png` for the web app)
- `splash.png` — same artwork used for Android splash screens

Regenerate native + PWA assets after changing the PNGs:

```bash
npm run cap:assets
npm run cap:build
```
