# Checkout denomination picker — Phase A.1 assets

Local Ugandan banknote pictures for the desktop cash keypad. Visual only. Phase A click behavior is unchanged.

Accessed: **27 August 2026**.

## Why local assets (not hotlinked)

Checkout must work offline and in the Windows/Electron app (`file://` with Vite `base: "./"`). Runtime must not fetch Bank of Uganda or any other third-party host. Assets live in `public/currency/ugx/` and are resolved with `publicAssetUrl()`.

## Official source

Bank of Uganda publishes current notes on [Currency Management](https://bou.or.ug/currency_management) for identification. The public site is a SPA; the note models come from:

`GET https://bou.or.ug/api/currency-management?populate=banknotesCoins.noteImages.image`

Each `type: "note"` row is a **GLB 3D model** whose embedded JPEG is a front+back atlas (front on top, back below). WAKA extracted the **front** half only.

Bank of Uganda holds copyright in its currency designs. The Currency Management page also cites Penal Code s.120(373): reproducing a BoU note or coin without prior written permission is an offence. These files are used only as **cashier identification** on the POS keypad, not as printable currency. Do not redistribute the full-resolution GLB/JPEG originals.

## Asset table

| Denomination | Asset file | Source organization | Source page | Original source | Notes |
|---|---|---|---|---|---|
| UGX 50,000 | `public/currency/ugx/ugx-50000-front.webp` | Bank of Uganda | https://bou.or.ug/currency_management | CMS `noteImages` title `50000` → `/uploads/50000_be0cb70d0e.glb` (embedded JPEG, front = top half). Visual check: gold/yellow, Stride Monument, “50000”, “FIFTY THOUSAND SHILLINGS”. | Front. Specimen serial AA0000000. |
| UGX 20,000 | `public/currency/ugx/ugx-20000-front.webp` | Bank of Uganda | https://bou.or.ug/currency_management | `/uploads/20000_7c5b5a638a.glb` | Front. Red/pink, Centenary Park monument, “20000”. |
| UGX 10,000 | `public/currency/ugx/ugx-10000-front.webp` | Bank of Uganda | https://bou.or.ug/currency_management | `/uploads/10000_6b8bfed465.glb` | Front. Purple, Key to Success / Sipi Falls, “10000”. |
| UGX 5,000 | `public/currency/ugx/ugx-5000-front.webp` | Bank of Uganda | https://bou.or.ug/currency_management | `/uploads/5000_c988885dfd.glb` | Front. Green, WWII memorial, “5000”. |
| UGX 2,000 | `public/currency/ugx/ugx-2000-front.webp` | Bank of Uganda | https://bou.or.ug/currency_management | `/uploads/2000_c5b48d5269.glb` | Front. Blue, Source of the Nile, “2000”. |
| UGX 1,000 | `public/currency/ugx/ugx-1000-front.webp` | Bank of Uganda | https://bou.or.ug/currency_management | `/uploads/1000_eee9c750a0.glb` | Front. Brown, Nyero rock paintings, “1000”. |

API document id at fetch time: `thcx8s1acj7mmfl6qpjp5f29` (updated 2026-07-15).

## Processing

1. Download official GLB from `https://bou.or.ug` + path above (not committed).
2. Extract the single embedded `image/jpeg` texture (1524×1520, front stacked above back).
3. Crop top half (1524×760) = **front**.
4. Resize to width **560px** (height 279, aspect ratio kept).
5. Encode **WebP quality 72**. Output ~21–30 KB per note.

No AI-generated notes. No Google Images. No runtime hotlink.

## UI

`CheckoutNotePicker` still sits under “Cash customer gave” and above the keypad. Each control is the note image (`object-contain`) plus the existing numeric label. `object-contain` keeps the banknote aspect ratio. Click still calls `onAddNote(denom)` → `cashInput`.

Counting / cash-position denominations (`UGX_DENOMINATIONS`, including 100,000 and coins) are unchanged.
