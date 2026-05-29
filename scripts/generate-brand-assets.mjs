#!/usr/bin/env node
/**
 * Generate Waka POS app icon, splash, and brand exports from resources/w-symbol-source.png.
 * Run: npm run brand:assets
 */
import sharp from "sharp";
import { mkdirSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const srcPath = resolve(root, "resources/w-symbol-source.png");
const outDir = resolve(root, "resources/brand");

const CREAM = "#fffaf5";
const WHITE = "#ffffff";
const DARK = "#0c0a09";
const DARK_CHARCOAL = "#1c1917";
const ORANGE = "#f97316";
const SLOGAN = "100% Local. Affordable for Every Business.";

/** Symbol occupies this fraction of the canvas (rest = padding). Tuned for adaptive icon safe zone. */
const ICON_SYMBOL_SCALE = 0.58;
const SPLASH_SYMBOL_SCALE = 0.22;

mkdirSync(outDir, { recursive: true });

if (!existsSync(srcPath)) {
  console.error("Missing resources/w-symbol-source.png");
  process.exit(1);
}

/** Trim near-white margins; keep orange symbol only area tight. */
async function loadSymbol() {
  return sharp(srcPath).trim({ threshold: 12 }).png().toBuffer();
}

async function symbolMeta(buf) {
  return sharp(buf).metadata();
}

async function placeSymbol(symbolBuf, size, bg, scale, opts = {}) {
  const meta = await sharp(symbolBuf).metadata();
  const maxSide = Math.round(size * scale);
  const resized = await sharp(symbolBuf)
    .resize(maxSide, maxSide, { fit: "inside", withoutEnlargement: false })
    .png()
    .toBuffer();
  const rMeta = await sharp(resized).metadata();
  const left = Math.round((size - rMeta.width) / 2);
  const top = Math.round((size - rMeta.height) / 2);

  const layers = [{ input: resized, left, top }];
  if (opts.glow) {
    const glow = await sharp(resized).blur(8).modulate({ brightness: 1.1 }).png().toBuffer();
    layers.unshift({ input: glow, left, top: top + 2, blend: "over" });
  }

  return sharp({
    create: { width: size, height: size, channels: 4, background: bg },
  }).composite(layers);
}

async function writeIcon(symbolBuf, size, bg, scale, dest) {
  await (await placeSymbol(symbolBuf, size, bg, scale)).png().toFile(dest);
}

async function splashPortrait(symbolBuf, { width, height, bg, dark }) {
  const symbolW = Math.round(width * SPLASH_SYMBOL_SCALE);
  const resized = await sharp(symbolBuf)
    .resize(symbolW, symbolW, { fit: "inside" })
    .png()
    .toBuffer();
  const rMeta = await sharp(resized).metadata();
  const symLeft = Math.round((width - rMeta.width) / 2);
  const symTop = Math.round(height * 0.28);

  const titleColor = dark ? WHITE : DARK;
  const subColor = dark ? "#a8a29e" : "#78716c";

  const svg = `
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="${bg}"/>
  <text x="50%" y="${symTop + rMeta.height + Math.round(height * 0.06)}"
    text-anchor="middle" font-family="system-ui,Segoe UI,Roboto,sans-serif"
    font-size="${Math.round(width * 0.078)}" font-weight="800" fill="${titleColor}" letter-spacing="-0.02em">Waka POS</text>
  <text x="50%" y="${symTop + rMeta.height + Math.round(height * 0.11)}"
    text-anchor="middle" font-family="system-ui,Segoe UI,Roboto,sans-serif"
    font-size="${Math.round(width * 0.032)}" font-weight="600" fill="${subColor}">${SLOGAN}</text>
</svg>`;

  return sharp(Buffer.from(svg))
    .composite([{ input: resized, left: symLeft, top: symTop }])
    .png();
}

/** Google Play feature graphic (1024×500). */
async function generateFeatureGraphic(symbolBuf) {
  const W = 1024;
  const H = 500;
  const logoSize = 172;
  const logo = await sharp(symbolBuf).resize(logoSize, logoSize, { fit: "inside" }).png().toBuffer();
  const logoMeta = await sharp(logo).metadata();
  const logoTop = Math.round((H - (logoMeta.height ?? logoSize)) / 2) - 16;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="0.85">
      <stop offset="0%" stop-color="#fffaf5"/>
      <stop offset="50%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#fff7ed"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="5" fill="#f97316"/>
  <ellipse cx="900" cy="100" rx="220" ry="150" fill="#ffedd5" opacity="0.55"/>
  <text x="252" y="112" font-family="Segoe UI, system-ui, Roboto, Arial, sans-serif" font-size="12" font-weight="700" fill="#ea580c" letter-spacing="2.5">TECH FOR NEXT GENERATION</text>
  <text x="252" y="186" font-family="Segoe UI, system-ui, Roboto, Arial, sans-serif" font-size="44" font-weight="800" fill="#0c0a09">Simple POS for shops</text>
  <text x="252" y="240" font-family="Segoe UI, system-ui, Roboto, Arial, sans-serif" font-size="44" font-weight="800" fill="#0c0a09">in Uganda</text>
  <text x="252" y="288" font-family="Segoe UI, system-ui, Roboto, Arial, sans-serif" font-size="17" font-weight="500" fill="#57534e">Sales · Stock · Receipts · Works offline</text>
  <text x="252" y="338" font-family="Segoe UI, system-ui, Roboto, Arial, sans-serif" font-size="26" font-weight="800" fill="#f97316">Waka POS</text>
  <rect x="692" y="70" width="280" height="360" rx="22" fill="#ffffff" stroke="#fed7aa" stroke-width="2"/>
  <text x="832" y="104" text-anchor="middle" font-family="Segoe UI, system-ui, Roboto, Arial, sans-serif" font-size="13" font-weight="700" fill="#78716c">Product preview</text>
  <rect x="720" y="122" width="224" height="128" rx="14" fill="#f5f5f4"/>
  <rect x="720" y="268" width="150" height="11" rx="5" fill="#e7e5e4"/>
  <rect x="720" y="290" width="190" height="11" rx="5" fill="#e7e5e4"/>
  <rect x="720" y="312" width="110" height="11" rx="5" fill="#e7e5e4"/>
  <rect x="720" y="358" width="224" height="52" rx="14" fill="#fff7ed" stroke="#fdba74" stroke-width="1"/>
  <text x="832" y="390" text-anchor="middle" font-family="Segoe UI, system-ui, Roboto, Arial, sans-serif" font-size="17" font-weight="800" fill="#ea580c">Free to start</text>
</svg>`;

  const base = await sharp(Buffer.from(svg)).png().toBuffer();
  const outPath = resolve(outDir, "feature-graphic-1024x500.png");
  await sharp(base)
    .composite([{ input: logo, left: 52, top: logoTop }])
    .png()
    .toFile(outPath);
  return outPath;
}

async function monoSymbol(symbolBuf, color) {
  const { width, height } = await sharp(symbolBuf).metadata();
  const alpha = await sharp(symbolBuf).ensureAlpha().extractChannel(3).toBuffer();
  const fill = await sharp({
    create: { width, height, channels: 3, background: color },
  })
    .png()
    .toBuffer();
  return sharp(fill).joinChannel(alpha).png().toBuffer();
}

async function main() {
  console.log("Generating Waka brand assets…\n");
  const symbol = await loadSymbol();
  const symbolB64 = symbol.toString("base64");

  // —— App icons ——
  await writeIcon(symbol, 1024, CREAM, ICON_SYMBOL_SCALE, resolve(outDir, "icon-1024-cream.png"));
  await writeIcon(symbol, 512, CREAM, ICON_SYMBOL_SCALE, resolve(outDir, "icon-512-cream.png"));
  await writeIcon(symbol, 1024, WHITE, ICON_SYMBOL_SCALE, resolve(outDir, "icon-1024-white.png"));
  await writeIcon(symbol, 1024, { r: 0, g: 0, b: 0, alpha: 0 }, ICON_SYMBOL_SCALE, resolve(outDir, "icon-1024-transparent.png"));

  await writeIcon(symbol, 1024, { r: 0, g: 0, b: 0, alpha: 0 }, ICON_SYMBOL_SCALE * 0.92, resolve(outDir, "icon-adaptive-foreground.png"));
  await sharp({
    create: { width: 1024, height: 1024, channels: 3, background: CREAM },
  })
    .png()
    .toFile(resolve(outDir, "icon-adaptive-background.png"));

  copyFileSync(resolve(outDir, "icon-1024-cream.png"), resolve(root, "resources/logo.png"));

  const featurePath = await generateFeatureGraphic(symbol);
  console.log("✓", featurePath);

  // —— Splash ——
  const splashLightBuf = await splashPortrait(symbol, {
    width: 1080,
    height: 1920,
    bg: CREAM,
    dark: false,
  }).then((img) => img.toBuffer());

  await sharp(splashLightBuf).toFile(resolve(outDir, "splash-light-portrait.png"));

  await splashPortrait(symbol, {
    width: 1080,
    height: 1920,
    bg: WHITE,
    dark: false,
  }).then((img) => img.toFile(resolve(outDir, "splash-light-white.png")));

  await splashPortrait(symbol, {
    width: 1080,
    height: 1920,
    bg: DARK_CHARCOAL,
    dark: true,
  }).then((img) => img.toFile(resolve(outDir, "splash-dark-portrait.png")));

  await sharp(splashLightBuf)
    .resize(2732, 2732, { fit: "cover", position: "centre" })
    .toFile(resolve(outDir, "splash-capacitor-master.png"));
  copyFileSync(resolve(outDir, "splash-capacitor-master.png"), resolve(root, "resources/splash.png"));

  // —— Monochrome ——
  const blackSym = await monoSymbol(symbol, "#000000");
  const whiteSym = await monoSymbol(symbol, "#ffffff");
  await writeIcon(blackSym, 1024, WHITE, ICON_SYMBOL_SCALE, resolve(outDir, "icon-mono-black-on-white.png"));
  await writeIcon(whiteSym, 1024, DARK, ICON_SYMBOL_SCALE, resolve(outDir, "icon-mono-white-on-dark.png"));
  await writeIcon(blackSym, 512, { r: 0, g: 0, b: 0, alpha: 0 }, 0.85, resolve(outDir, "icon-mono-black-transparent.png"));
  await writeIcon(whiteSym, 512, { r: 0, g: 0, b: 0, alpha: 0 }, 0.85, resolve(outDir, "icon-mono-white-transparent.png"));

  // —— Small / sidebar / favicon ——
  const smallSizes = [16, 24, 32, 48, 64, 96, 128, 192, 256];
  mkdirSync(resolve(outDir, "sizes"), { recursive: true });
  for (const s of smallSizes) {
    await writeIcon(symbol, s, { r: 0, g: 0, b: 0, alpha: 0 }, 0.88, resolve(outDir, `sizes/w-icon-${s}.png`));
    await writeIcon(symbol, s, CREAM, 0.82, resolve(outDir, `sizes/w-icon-${s}-cream.png`));
  }

  // —— SVG exports ——
  const svgSymbol = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 512 512" role="img" aria-label="Waka">
  <title>Waka</title>
  <image width="512" height="512" preserveAspectRatio="xMidYMid meet" xlink:href="data:image/png;base64,${symbolB64}"/>
</svg>`;
  writeFileSync(resolve(outDir, "w-symbol.svg"), svgSymbol);

  const svgIconCream = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1024 1024" role="img" aria-label="Waka POS">
  <rect width="1024" height="1024" fill="${CREAM}"/>
  <image x="215" y="215" width="594" height="594" preserveAspectRatio="xMidYMid meet" xlink:href="data:image/png;base64,${symbolB64}"/>
</svg>`;
  writeFileSync(resolve(outDir, "icon-1024-cream.svg"), svgIconCream);

  const svgSplash = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1080 1920" role="img" aria-label="Waka POS splash">
  <rect width="1080" height="1920" fill="${CREAM}"/>
  <image x="421" y="422" width="238" height="238" preserveAspectRatio="xMidYMid meet" xlink:href="data:image/png;base64,${symbolB64}"/>
  <text x="540" y="780" text-anchor="middle" font-family="system-ui,Segoe UI,Roboto,sans-serif" font-size="84" font-weight="800" fill="${DARK}">Waka POS</text>
  <text x="540" y="840" text-anchor="middle" font-family="system-ui,Segoe UI,Roboto,sans-serif" font-size="34" font-weight="600" fill="#78716c">${SLOGAN}</text>
</svg>`;
  writeFileSync(resolve(outDir, "splash-light.svg"), svgSplash);

  // —— Web / public copies ——
  copyFileSync(resolve(outDir, "icon-1024-cream.png"), resolve(root, "public/waka-logo.png"));
  await sharp(resolve(outDir, "icon-512-cream.png")).png().toFile(resolve(root, "public/icons/icon-512-playstore.png"));
  await (await placeSymbol(symbol, 512, CREAM, 0.72)).webp({ quality: 92 }).toFile(resolve(root, "public/icons/icon-512.webp"));
  await (await placeSymbol(symbol, 192, CREAM, 0.72)).webp({ quality: 92 }).toFile(resolve(root, "public/icons/icon-192.webp"));
  await (await placeSymbol(symbol, 32, CREAM, 0.78)).png().toFile(resolve(root, "public/favicon-32.png"));

  const faviconSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 64 64" role="img" aria-label="Waka POS">
  <rect width="64" height="64" rx="14" fill="${CREAM}"/>
  <image x="8" y="8" width="48" height="48" preserveAspectRatio="xMidYMid meet" xlink:href="data:image/png;base64,${symbolB64}"/>
</svg>`;
  writeFileSync(resolve(root, "public/favicon.svg"), faviconSvg);

  writeFileSync(
    resolve(outDir, "README.md"),
    `# Waka POS brand assets

Generated from \`resources/w-symbol-source.png\` (official W cart mark). Do not redesign the symbol — regenerate with:

\`\`\`bash
npm run brand:assets
npm run cap:assets
\`\`\`

## App icon
| File | Use |
|------|-----|
| \`icon-1024-cream.png\` | Play Store, master icon (cream \`${CREAM}\`) |
| \`icon-1024-white.png\` | White background variant |
| \`icon-1024-transparent.png\` | Symbol + padding, transparent |
| \`icon-adaptive-foreground.png\` | Android adaptive foreground |
| \`icon-adaptive-background.png\` | Android adaptive background |
| \`icon-1024-cream.svg\` | Vector wrapper (embedded symbol) |
| \`w-symbol.svg\` | Symbol only |

## Splash
| File | Use |
|------|-----|
| \`splash-light-portrait.png\` | Light splash 1080×1920 |
| \`splash-light-white.png\` | White background splash |
| \`splash-dark-portrait.png\` | Dark mode splash |
| \`splash-capacitor-master.png\` | Capacitor \`resources/splash.png\` source |
| \`splash-light.svg\` | Light splash vector |

## Monochrome
| File | Use |
|------|-----|
| \`icon-mono-black-on-white.png\` | Print / light UI |
| \`icon-mono-white-on-dark.png\` | Dark UI |
| \`icon-mono-black-transparent.png\` | Black symbol only |
| \`icon-mono-white-transparent.png\` | White symbol only |

## Small sizes
\`sizes/w-icon-*.png\` — sidebar, notifications, favicon (16–256px).

Brand orange: \`${ORANGE}\` · Cream: \`${CREAM}\`
`,
  );

  console.log("✓ resources/brand/ — all exports");
  console.log("✓ resources/logo.png + splash.png updated");
  console.log("✓ public/waka-logo.png, favicon.svg, PWA icons updated");
  console.log("\nNext: npm run cap:assets && npm run cap:build\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
