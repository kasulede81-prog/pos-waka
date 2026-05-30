# Waka POS — Referral & Discount Pilot Test Report

**Date:** 2026-05-28  
**Scope:** Agent referral tracking, registration referral code, cart-level discount, discount labeling.

## Root causes — referral dashboard gaps

| Issue | Root cause | Fix |
|-------|------------|-----|
| New referrals missing from agent list | `apply_referral_code` matched referral codes case-sensitively; codes entered as lowercase failed silently | Migration `065_referral_tracking_fixes.sql`: `normalize_referral_code`, uppercase match on apply |
| Code-only signups (APK/WhatsApp) not attributed | Referral hidden in collapsed UI; no pre-submit validation | Visible **Referral code (optional)** on register; `validate_referral_code` before signup; pending code in localStorage + metadata |
| Apply failures invisible | RPC errors only logged in DEV | `reportAuthIssue` on apply failure; agent page shows load errors |
| Stale agent dashboard | No refresh when returning to tab | `MarketingAgentPage` reloads on `focus` / `visibilitychange` |
| Pending shops invisible | List RPC omitted rows before shop bootstrap | `list_agent_referrals` returns pending rows with placeholder shop name (065) |

**Deploy requirement:** Apply Supabase migration `065_referral_tracking_fixes.sql` (and `057`–`060` if not already applied).

## Code deliverables

### Referral
- `supabase/migrations/065_referral_tracking_fixes.sql`
- `src/lib/referralAgents.ts` — `validateReferralCode`, `applyPendingReferralForSession`
- `src/pages/RegisterPage.tsx` — optional field + validation
- `src/pages/MarketingAgentPage.tsx` — auto-refresh + user-visible errors
- `src/hooks/useAuth.ts` — apply after workspace bootstrap (existing flow, improved logging)

### Cart discount
- `src/lib/draftCart.ts` — `computeDraftCheckoutTotals`
- `src/store/usePosStore.ts` — `draftCartDiscountUgx`, applied in `finalizeDraftSale` → `discountTotalUgx` / `totalUgx`
- `src/offline/draftStorage.ts` — persist cart discount in draft
- `src/components/pos/CartSaleDiscountModal.tsx`
- `src/pages/PosPage.tsx` — checkout UI (original / discount / payable)

### Labeling
- `src/lib/i18n.ts` — "Change price" → "Discount" / "Apply discount" (EN + Luganda)

## Manual test checklist

| # | Test | Expected | Status |
|---|------|----------|--------|
| 1 | Register with valid referral code | Code validated; pending stored; after login referral row created | **Requires migration 065 + live Supabase** |
| 2 | Register via `?ref=CODE` link | Code pre-filled; same as (1) | **Requires live Supabase** |
| 3 | Invalid referral code at register | Error before account creation | **UI implemented** — verify on device |
| 4 | Self-referral / duplicate | RPC returns `self_referral` / `already_applied` | **DB (065)** — verify |
| 5 | Agent dashboard after new signup | New shop in list + count updates | **Requires (1)+(065)** |
| 6 | Agent dashboard tab switch | List refreshes on return | **Implemented** |
| 7 | Cart % discount (multi-line) | Payable = subtotal − % | **Implemented** — verify on POS |
| 8 | Cart fixed discount (UGX) | Payable = subtotal − amount | **Implemented** |
| 9 | Cart discount offline | Draft persists; sale saves locally; syncs `discount_ugx` | **Implemented** — verify soak |
| 10 | Receipt shows discount | `discountTotalUgx` on receipt | **Existing receipt path** — verify print |
| 11 | Reports include discount | `discountTotalUgx` in local/server reporting | **Existing** — verify dashboard |
| 12 | Line discount button label | Shows "Discount" not "Change price" | **Implemented** |
| 13 | `npm run build` | Passes | Run locally |

## Automated verification

```bash
npm run build
```

## Commission / statistics

Commission logic unchanged: referrals drive `agent_referrals` rows; reporting RPCs in `057`/`061` unchanged. Cart discount flows into existing `discountTotalUgx` on sales (same as line discounts combined).

## Notes for pilot

1. Share **referral code** (text) for APK installs; share **signup link** when users have browser.
2. After deploying 065, have agents re-test with a fresh shop signup.
3. Cart discount is one amount per sale (not per line); use line **Discount** for single-item price cuts.
