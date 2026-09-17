# HOSPITALITY BUSINESS TYPE CONSOLIDATION

Branch: `waka/hospitality-business-type` (off `main` @ `21cef22`)

## Current model

- `BusinessType` had three separate top-level hospitality values: `restaurant`, `bar`, `restaurant_bar` (plus `hotel`), each with its own profile, starter pack, menu-category defaults, and kitchen defaults.
- Onboarding showed ONE "Hospitality" group card, but its second step stored three *different* business types for Restaurant / Bar / Restaurant + Bar.
- Stored in `ShopPreferences.businessType` and cloud `shops.business_type` / `organizations.business_type` (CHECK constraints from migration 072).
- Consumed only by UI/operational logic: hospitality mode gating (`isHospitalityBusinessType`), kitchen display default (`bar` → kitchen off), menu category presets, starter packs, dashboard variant, receipt footer templates, role industry, business-builder scene, platform visibility toggles.
- **Financial audit result: no financial, COGS, payment, debt, or day-close code reads businessType.** Sales always flow through `finalizeDraftSale()` regardless of type.

## New model

- ONE top-level business type: **`hospitality`** (added to `BusinessType`, `BUSINESS_TYPE_IDS`, business profiles, i18n in English + Luganda).
- Optional operating configuration: **`ShopPreferences.hospitalityStyle`** ∈ `restaurant` | `bar` | `restaurant_bar` — UI emphasis only (kitchen default, menu categories). It never creates a separate engine, ledger, or checkout path.
- Onboarding: the single Hospitality card's second step now stores `businessType: "hospitality"` for all three configurations, preserving the chosen style. (Café maps to hospitality+restaurant; hotel remains its own business type.)
- Style-aware helpers: `hospitalityStyleForBusinessType(type, style?)` (explicit style wins; legacy types derive theirs), `defaultKitchenEnabledForBusinessType`, `isKitchenEnabledForHospitality`, `isBarOnlyMode`, `defaultMenuCategoriesForBusinessType` — all take an optional style; legacy call sites behave identically.
- All three configurations use the same Hospitality implementation → `finalizeDraftSale()` → shared inventory / COGS / payments / debt / reporting.

## Backward compatibility

- **No data rewrite.** Legacy stored values `restaurant` / `bar` / `restaurant_bar` remain valid `BusinessType` values, remain in `BUSINESS_TYPE_IDS`, keep their business profiles, and `isHospitalityBusinessType` accepts old and new values.
- Existing merchants load exactly as before; their kitchen/menu defaults derive from the stored legacy type (bar → kitchen off).
- Cloud: migration `20260918003000_hospitality_business_type.sql` recreates both `shops_business_type_check` and `organizations_business_type_check` **additively** — old values stay valid, `'hospitality'` is added. The save RPCs pass the value through (no server-side whitelist).
- Platform visibility: `HOSPITALITY_TYPES` includes `"hospitality"` alongside legacy ids, so existing enabled-type settings rows keep the Hospitality card visible.
- `completeBusinessOnboarding` / `updateBusinessType` only set `hospitalityStyle` when one is provided — re-running onboarding completion on legacy data never clobbers derived behavior.

## Files changed

| File | Change |
|---|---|
| `src/types.ts` | Added `"hospitality"` to `BusinessType`; new `HospitalityOperatingStyle`; `ShopPreferences.hospitalityStyle`. |
| `src/config/businessTypes.ts` | `hospitality` profile (service variant); added to `BUSINESS_TYPE_IDS`. Legacy profiles kept. |
| `src/lib/hospitality.ts` | `HOSPITALITY_BUSINESS_TYPES` + `"hospitality"`; new `hospitalityStyleForBusinessType`; style-aware kitchen/bar-only/menu-category helpers. |
| `src/config/hospitalityOnboarding.ts` | The three configurations store `businessType: "hospitality"` + `style`; new `hospitalityStyleForStyleId`; style-aware `hospitalityStyleIdForBusinessType`. |
| `src/config/businessTypeVisibility.ts` | `HOSPITALITY_TYPES` includes `"hospitality"`. |
| `src/store/usePosStore.ts` | `completeBusinessOnboarding` / `completeShopOnboardingWizard` / `updateBusinessType` accept optional style; kitchen default uses style. |
| `src/lib/shopOnboardingPersist.ts` | Passes `hospitalityStyle` into the wizard. |
| `src/pages/ShopOnboardingPage.tsx` | Resolves + persists style; style-aware rehydration. |
| `src/components/BusinessTypeOnboarding.tsx` | Resolves + persists style; draft keeps style id; hospitality feature chips. |
| `src/data/starterPacks.ts` | `hospitality` → combined restaurant+bar starter pack. |
| `src/lib/receiptBranding.ts` | `hospitality` → dining footer template. |
| `src/lib/businessBuilder/syncSceneFromShop.ts` | `hospitality` → hospitality scene family. |
| `src/lib/enterpriseRoles/industry.ts` | `hospitality` → hospitality role industry. |
| `src/lib/i18n.ts` | `businessType_hospitality` (English + Luganda). |
| `supabase/migrations/20260918003000_hospitality_business_type.sql` | Additive CHECK-constraint update (shops + organizations). |
| `src/config/hospitalityOnboarding.test.ts` | Updated to the consolidated model. |
| `src/lib/hospitalityBusinessType.test.ts` | **New** — 9 tests covering the spec's 11 points. |

## Tests

- New `hospitalityBusinessType.test.ts` (spec matrix): (1) one Hospitality option; (2–4) each configuration → `hospitality` + correct style; (5) all three share the same engine path incl. bar kitchen default; (6) food sale through `finalizeDraftSale`; (7) drink sale through `finalizeDraftSale`; (8) combined food+drink = exactly ONE sale (14,000 UGX check); (9) legacy `restaurant`/`bar`/`restaurant_bar` load + derive style + kitchen defaults; (10) retail unchanged; (11) pharmacy unchanged.
- Updated `hospitalityOnboarding.test.ts`: 6/6.
- Hospitality suites: prep batch 14/14, recipe sale 8/8, provenance 8/8.
- Pharmacy suites: batches, partial dispense, prescription ops, prescriptions — all pass.
- Financial: `saleLifecycleIntegrity`, `saleFinancialEngine` — pass.
- Config/visibility/starter-packs/receipt/branding/roles suites — pass (only the known pre-existing `permissionCertification` baseline failures).

## Financial core
UNCHANGED

## Retail
UNCHANGED

## Pharmacy
UNCHANGED

## Build

- `tsc -b --force` — clean.
- `vite build --mode production` — green (PWA emitted).
- Full suite both shards: 5,414 passed; failing files identical to the verified pre-existing baseline (19 files) — **zero regressions**; +15 new tests all passing.
