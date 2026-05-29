#!/usr/bin/env node
import sharp from "sharp";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const srcPath = resolve(root, "resources/w-symbol-source.png");
const outPath = resolve(root, "resources/brand/feature-graphic-1024x500.png");

const symbol = await sharp(srcPath).trim({ threshold: 12 }).png().toBuffer();
const W = 1024;
const H = 500;
const logoSize = 172;
const logo = await sharp(symbol).resize(logoSize, logoSize, { fit: "inside" }).png().toBuffer();
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
await sharp(base).composite([{ input: logo, left: 52, top: logoTop }]).png().toFile(outPath);
console.log("Created", outPath);
