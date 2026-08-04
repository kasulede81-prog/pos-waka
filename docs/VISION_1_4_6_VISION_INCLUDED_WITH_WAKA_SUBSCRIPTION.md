# Vision V1.4.6 — Unify Vision Into WAKA Subscription Plans

**Mode:** Surgical licensing / provisioning refactor  
**Date:** 2026-08-04  
**Scope:** Entitlements · Internal Admin · Settings copy · migration · docs  
**Out of scope:** Edge Agent · streaming · Timeline · Live View engine · Camera Manager architecture · premium add-on products

---

## Business model

Customers purchase CCTV hardware (DVR, cameras, HDD, installation).  
WAKA provides the software integration.

**Vision is included with every paid WAKA subscription.**  
Plans control **capacity** (max DVRs / max cameras) — not feature fragmentation.

| WAKA plan | DVRs | Cameras | Core Vision features |
|-----------|-----:|--------:|----------------------|
| Starter | 1 | 4 | Live View, Monitoring, DVR mgmt, Camera assignment, POS Timeline (when shipped) |
| Business | 2 | 16 | Same |
| Enterprise (`waka_plus`) | Unlimited | Unlimited | Same |
| Free / expired | — | — | Registry preserved; Live / Monitor locked |

**Customer message:** *Buy your cameras once. Subscribe to WAKA once. Everything works together.*

---

## What changed

| Before (V1.4.5) | After (V1.4.6) |
|-----------------|----------------|
| Separate Vision License (none / starter / business / enterprise) | Removed as a product SKU |
| Separate Vision trial | Follows WAKA trial / subscription |
| Admin enables Vision license | Admin manages capacity overrides + support kill-switch |
| Settings: “Vision License” | Settings: “Included with {Plan}” + usage caps |

### Unchanged

- Camera registry, vault, layouts, monitoring workspace  
- Edge Agent, MediaMTX / WebRTC / HLS  
- Live View, Monitor, Camera Manager UX architecture  

---

## Entitlement resolution

`resolveVisionAccess` reads:

1. **WAKA `SubscriptionSnapshot`** via `resolveEffectiveSubscription`  
2. Optional **`shop_vision_settings`** capacity overrides (`max_dvrs` / `max_cameras`)  
3. Support kill-switch **`admin_disabled`**

Enablement rule:

```text
paid or trial WAKA  →  Vision enabled (full core features)
expired / free      →  Live + Monitor off; registry preserved
admin_disabled      →  Vision off; registry preserved
local_full          →  unlimited bypass (offline owner device)
```

Capacity:

```text
Admin max_* set  →  use override
else             →  VISION_CAPACITY_BY_WAKA_PLAN[effectivePlan]
```

---

## Internal Admin

Shop Console → **Vision**:

- Status derived from shop WAKA plan  
- Maximum DVRs / cameras overrides (empty = plan default)  
- Disable Vision for this shop (support)  
- Installer label  
- Future add-on flags (Remote Monitoring, AI Analytics) — not core product  

No Vision License radio. No separate Vision trial editor.

---

## Migration

Migration: `supabase/migrations/145_shop_vision_included_with_subscription.sql`

- Adds `admin_disabled`  
- Soft-migrates previously licensed / trial rows  
- Keeps deprecated `license_tier` / `trial_*` columns for compat (ignored by client enablement)  
- Preserves all camera / DVR / layout / monitoring data (client KV unchanged)

---

## Future premium add-ons (not implemented)

Reserve architecture only:

- AI Analytics  
- Cloud Recording  
- Remote Monitoring  
- Advanced Notifications  

Core Vision remains included with WAKA.

---

## Key files

| Piece | Path |
|-------|------|
| Capacity + settings | `src/lib/vision/shopVisionSettings.ts` |
| Entitlements | `src/lib/vision/canUseVision.ts` |
| Hook | `src/hooks/useShopVisionSettings.ts` |
| Admin panel | `src/components/internal-admin/v2/ShopVisionSettingsPanel.tsx` |
| Gate | `src/components/VisionProtectedRoute.tsx` |
| DB | `supabase/migrations/144_*.sql`, `145_*.sql` |

---

## Verification

```bash
npm run build
npm test
```

Success criteria:

- Vision is not sold as a separate module  
- Every paid WAKA subscriber receives Vision  
- Plans control only capacity  
- Existing Vision architecture unchanged  
- Future premium services remain optional add-ons  

*End of Vision V1.4.6.*
