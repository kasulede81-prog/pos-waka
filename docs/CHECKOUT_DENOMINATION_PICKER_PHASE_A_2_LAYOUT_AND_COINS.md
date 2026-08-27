# Checkout denomination picker — Phase A.2 layout and coins

Visual/layout expansion of the desktop/full-tablet cash keypad. Click behavior is unchanged from Phase A / A.1.

Accessed: **27 August 2026**.

## Layout

### Old layout problem

Phase A.1 put six Ugandan banknote pictures in one `grid-cols-6` row above a full-width numeric keypad (`h-7` / `h-8` images). The notes were correct and tappable, but they read as tiny thumbnails.

The expanded surface is `PosDesktopCatalogCheckoutDock`, mounted from `PosPage` inside `[data-pos-catalog-keypad-overlay]` when `useDesktopCatalogCheckoutDock` is true and the catalog cash keypad is open.

### New desktop/full layout

Inside the existing “Hide keyboard” workspace:

1. Header (Hide keyboard) — unchanged
2. Cash customer gave / change — unchanged copy and math; slightly more opaque so it stays readable on the translucent surface
3. **Left / main:** large cash visuals
   - six notes in **3 columns × 2 rows** (50k / 20k / 10k, then 5k / 2k / 1k)
   - three coins in a smaller row below (500 / 200 / 100)
4. **Right / compact:** existing `CheckoutNumpadDock` constrained to `13.5rem`

Notes grow with the leftover overlay height (`object-contain`, aspect ratio preserved). The keypad is the same 3-digit + Clear/Save control as before — narrower, not rewritten.

### Why notes moved to 3 × 2

A single row of six cannot make Bank of Uganda note pictures recognizable. Three columns uses the unused catalog overlay width; two rows plus a compact keypad uses the unused overlay height.

### Keypad placement

`CheckoutNumpadDock` is unchanged and still shared with credit/sidebar/mobile. Only the desktop cash workspace wraps it in a `13.5rem` column. Clear, backspace, `00`, Save, and hardware capture are unchanged.

### Transparency / background

The dock surface is `bg-card/80` with `backdrop-blur-md` (`supports-[backdrop-filter]:bg-card/70`). Product shelves stay in the catalog underneath the overlay; they remain a subtle background. Cash amount uses `bg-muted/95` so the tender figure stays readable. No extra filters, no catalog DOM changes, no move of the right-hand “This sale” panel.

Overlay height is `min(56dvh, 28rem)` so the 3 × 2 notes fit on short Windows viewports without horizontal scrolling.

## Coin sources

Bank of Uganda Currency Management SPA. Same API as Phase A.1 notes:

`GET https://bou.or.ug/api/currency-management?populate=banknotesCoins.noteImages.image`

Each `type: "coin"` row is a **GLB 3D model** with one embedded texture showing **both faces**. WAKA cropped the **denomination face** (the side with the numeral) to a square. Coins are displayed circular (`rounded-full` + `object-contain`); they are not stretched into note rectangles.

BoU also publishes a **1,000 coin**. Checkout 1,000 remains the **banknote** from Phase A.1.

API document id at fetch time: `thcx8s1acj7mmfl6qpjp5f29` (updated 2026-07-15).

| Denomination | Asset file | Source organization | Source page | Original source | Notes |
|---|---|---|---|---|---|
| UGX 500 | `public/currency/ugx/ugx-500-coin.webp` | Bank of Uganda | https://bou.or.ug/currency_management | CMS `noteImages` title `500 UGX` → `/uploads/500_UGX_b8e48e7dcf.glb` (embedded JPEG 316×159, both faces; crop = right / crane + “500 SHILLINGS”, 2008). | Gold/brass. Visual check: Grey Crowned Crane, “BANK OF UGANDA”, “500 SHILLINGS”. Square 256px WebP from official texture (source face is small). |
| UGX 200 | `public/currency/ugx/ugx-200-coin.webp` | Bank of Uganda | https://bou.or.ug/currency_management | title `200 UGX` → `/uploads/200_new_coin_UGX_1_290cbd7271.glb` (embedded JPEG 1600×801; crop = left / tilapia + “200 SHILLINGS”, 2015). | Silver. Visual check: Nile tilapia, “200”, “SHILLINGS”. |
| UGX 100 | `public/currency/ugx/ugx-100-coin.webp` | Bank of Uganda | https://bou.or.ug/currency_management | title `100 UGX coins` → `/uploads/100_coins_cb09bd326c.glb` (embedded PNG 1800×1200; crop = left / Ankole bull + “100 SHILLINGS”, 2022). | Silver. Visual check: Ankole-Watusi, “100”, “SHILLINGS”. |

### Processing

1. Download official GLB from `https://bou.or.ug` + path above (not committed).
2. Extract the embedded texture.
3. Crop the denomination face (left or right half, then centered square).
4. Resize to **256×256**. Encode **WebP quality 82**.
5. Serve from `public/currency/ugx/` via `publicAssetUrl()`.

No AI-generated coins. No Google Images. No runtime hotlink.

Bank of Uganda holds copyright in its currency designs. Same Penal Code s.120(373) identification-only use as Phase A.1. Do not redistribute the full-resolution GLB/JPEG originals.

## Interaction

Unchanged from Phase A:

`denomination tap → addDenominationToCashInput → cashInput → existing totalPaidInput / changeDue / finishSale / finalizeDraftSale`

Notes and coins call the same `onAddNote(ugx)` / `addCheckoutCashNote`. Integer UGX only.

## Mobile isolation

Picker is imported **only** by `PosDesktopCatalogCheckoutDock`. Compact slideover, mobile overlay `PosCheckoutPanel`, Android, and iOS are unchanged. No new global breakpoints.

Counting / cash-position list `UGX_DENOMINATIONS` (including **100,000**) is unchanged.

## Exact UI scope

ENABLE: desktop web, Windows browser, Windows desktop app, large tablet when the existing full desktop checkout dock is used.

DO NOT CHANGE: web mobile, compact checkout slideover, Android, iOS, payment math, database, migrations, sync, receipts, drawer.

## Runtime external image requests

No. All note and coin images are local `public/` assets.
