# DKASU POS brand assets

Generated from the supplied DKASU artwork in `public/brand/dkasu/` — the logo is
sampled and composited, never redrawn. Regenerate with:

```bash
npm run brand:assets
npm run cap:assets
```

## App icon
| File | Use |
|------|-----|
| `icon-1024.png` | Master app icon (full-bleed tile gradient + white mark) |
| `icon-512.png` | Play Store icon |
| `icon-1024-transparent.png` | Mark only, transparent |
| `icon-adaptive-foreground.png` | Android adaptive foreground (mark in 66dp safe zone) |
| `icon-adaptive-background.png` | Android adaptive background (full-bleed gradient) |

## Splash
| File | Use |
|------|-----|
| `splash-light.png` | Light splash |
| `splash-dark.png` | Dark splash |
| `logo-horizontal-on-light.png` | Flattened light lockup |
| `logo-horizontal-on-dark.png` | Flattened dark lockup |

## Monochrome
| File | Use |
|------|-----|
| `icon-mono-black-on-white.png` | Print / light UI |
| `icon-mono-white-on-dark.png` | Dark UI |
| `icon-mono-black-transparent.png` | Black tile, transparent |
| `icon-mono-white-transparent.png` | White tile, transparent |

## Small sizes
`sizes/d-icon-*.png` — 16–256px, brand and light-surface (on cream).

Tile gradient (measured from the artwork): `rgb(253,156,27)` → `rgb(250,86,1)` · Cream: `#fffaf5`
