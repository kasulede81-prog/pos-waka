# Vision V1.4.5 — Enterprise Vision Activation, Licensing & Internal Admin Certification

**Mode:** Read-only enterprise audit  
**Date:** 2026-08-04  
**Scope:** Activation · licensing · provisioning · permissions · installer workflow  
**Explicitly out of scope:** Code changes · activation implementation · permission matrix edits · subscription SKU shipping

---

## Executive Summary

**Verdict: Vision is currently ungated as a product module.**

Anyone with `settings.view` (Owner, Manager, Supervisor) can open Vision Manager, Live View, and Monitor. There is:

- no Vision feature flag  
- no Vision subscription entitlement  
- no Internal Admin enable/disable  
- no camera / DVR limits  
- no dedicated `vision.*` permissions  

Architecture docs from V1.0 already intended `vision.view` / `vision.manage`, but shipped V1.1–V1.4 use Settings access only.

**Recommended model (do not implement in this audit):**

1. **Internal Admin Dashboard** is the source of truth for Vision enablement, license tier, camera/DVR caps, multi-branch, remote monitoring, and future AI.  
2. **Business owners configure** licensed Vision (cameras, layouts, assignment, monitoring) but **cannot self-enable** Vision or raise limits.  
3. **Installers** provision after Admin enablement — connect DVR → import → assign — without holding licensing power.  
4. Reuse the proven **Shop AI** pattern (`ai_enabled` default false + Internal Admin Shop Console panel + limits), not a customer Settings toggle.

**Freeze recommendation:** Freeze Vision feature expansion (timeline / AI / commercial packaging) until an activation gate exists. Continue DVR-first UX polish only behind the understanding that the module must become licensed before broad customer exposure.

---

## Current Activation Audit

### Is Vision visible to everyone?

| Audience | Visible? | Evidence |
|----------|----------|----------|
| Owner / Manager / Supervisor | **Yes** | `settings.view` in `src/lib/permissions.ts`; Settings hub card always rendered in `SettingsHubPage.tsx` |
| Cashier / Stock / Waiter / Kitchen / Bar | **No** (routes) | Lack `settings.view`; `RoleProtectedRoute` redirects to `/` |
| Any authenticated user with Settings access | **Yes — no plan check** | Contrast pharmacy/hospitality cards which require business-mode gates |

### Activation paths today

| Path | Gated by | Vision-specific? |
|------|----------|------------------|
| `/office/vision` | `settings.view` | No |
| `/office/vision/live` | `settings.view` | No |
| `/office/vision/monitor` | `settings.view` | No |
| Settings hub card `officeCardVision` | Hub requires `settings.view`; card unconditional | No |
| Back-office search (`vision`, `vision-live`, `vision-monitor`) | Catalog entries have **no `perm` field** | No |
| Office hub | Vision **not listed** | N/A — Settings launcher only |
| Feature flag | None | — |
| Subscription entitlement | None (`subscriptionEntitlements.ts` has no Vision keys) | — |
| Internal Admin Shop Console | No Vision tab (`SHOP_CONSOLE_TABS` ends at `ai`) | — |

### Feature flags / subscriptions / internal control

| Mechanism | Used by Vision? | Closest analogue |
|-----------|-----------------|------------------|
| `INTERNAL_ADMIN_FEATURE_FLAGS` | No | Pilot / display / business types |
| `ShopAiSettings.ai_enabled` | No | **Best template** — Admin enables AI, default off |
| Plan tiers (`STARTER_PLUS`, `BUSINESS_PLUS`) | No | Backup, profit reports, owner tools |
| Shop activation license (`maxDevices`) | No | POS device caps — pattern for camera caps |
| Pharmacy / hospitality mode | No | Business-type + Admin profile override |

### Planned vs shipped permissions

| Spec (V1.0 architecture doc) | Shipped |
|------------------------------|---------|
| `vision.view`, `vision.manage` | **Missing** from `Permission` union / role matrix |
| Per-role live / manage / export | Collapsed into `settings.view` |

---

## Recommended Activation Architecture

```text
Internal Admin (source of truth)
  → Vision Enabled (bool, default false)
  → Vision License (none | starter | business | enterprise)
  → Max Cameras / Max DVRs
  → Multi-Branch Vision (bool)
  → Remote Monitoring (bool, future)
  → Vision AI (bool, future)
        ↓
Customer app entitlement check (shop_id scoped)
        ↓
Settings / Office show Vision ONLY if enabled
        ↓
Installer or Owner configures licensed surfaces
        ↓
Edge Agent + local vault remain device/LAN boundary
```

### Authority split

| Concern | Owner |
|---------|--------|
| Enable / disable Vision | **Internal Admin only** |
| License tier & limits | **Internal Admin only** |
| Future AI / remote monitoring flags | **Internal Admin only** |
| Connect DVR / import channels | Installer or Owner (after enable) |
| Rename / assign / layouts / monitor prefs | Business Owner / Manager (licensed) |
| Live view | Owner / Manager / (optional) Supervisor |
| Self-serve “Vision Enabled” in Settings | **Forbidden** |

### Implementation template (future — not this audit)

Mirror Shop AI:

- Per-shop row: `shop_vision_settings` (or features JSON on subscription)  
- Fields: `vision_enabled`, `license_tier`, `max_cameras`, `max_dvrs`, `multi_branch`, `remote_monitoring`, `ai_enabled`  
- Internal Admin Shop Console tab: **Vision** (sibling of AI)  
- Client gate: hide Settings card + block routes if `!vision_enabled`  
- Enforce limits at import/save time in Vision Manager UI  

Do **not** store licensing in local Vision KV (`vision-camera-registry::*`) — that is inventory, not entitlement.

---

## Business Settings — What Owners May Edit

### Allowed (when Vision licensed)

| Capability | Roles (recommended) |
|------------|---------------------|
| Rename cameras / locations | Owner, Manager |
| Assign POS / zone / branch label / profile | Owner, Manager |
| Floor plans, layouts, favorites | Owner, Manager |
| Test cameras / view health | Owner, Manager, Supervisor |
| Live View / Monitor workspace | Owner, Manager, Supervisor |
| Connect additional DVR (within max_dvrs) | Owner (+ installer role if introduced) |

### Forbidden for business self-service

| Capability | Reason |
|------------|--------|
| Enable / disable Vision module | Licensing / support control |
| Change license tier | Commercial |
| Raise camera / DVR limits | Commercial |
| Enable Vision AI / remote monitoring | Commercial + security |
| Cross-shop Vision access | Tenancy |

---

## Installer Workflow

### Target flow

```text
Internal Admin → Enable Vision + set license/limits
        ↓
Installer authenticates to the shop device (trusted device / owner PIN)
        ↓
Connect DVR (analog-first path)
        ↓
Import channels (all / selected)
        ↓
Assign location / POS / zone / branch
        ↓
Business ready (Monitor + Live View)
```

### Does this flow exist today?

| Step | Exists? | Gap |
|------|---------|-----|
| Admin enable Vision | **No** | No Admin Vision controls |
| Installer-specific login | **Partial** | Staff roles exist; no `installer` role or Vision-only scope |
| Connect DVR / import / assign | **Yes** | Vision Manager V1.3–V1.4 |
| Business-ready monitoring | **Yes** | Monitor + Live View V1.3.5 |
| License-aware limits during import | **No** | Unlimited import today |

**Conclusion:** Configuration UX is ahead of provisioning. Ship Admin enablement before promoting Vision commercially.

---

## Subscription Model (Architecture Only)

Recommended SKUs (informational — not implemented):

| Tier | Vision | Max cameras | Max DVRs | Multi-branch | Remote / AI |
|------|--------|-------------|----------|--------------|-------------|
| **No Vision** | Off | 0 | 0 | — | — |
| **Starter** | On | 4 | 1 | Single branch | Off |
| **Business** | On | 16 | 2 | Optional | Off (AI later) |
| **Enterprise** | On | Unlimited* | Unlimited* | Yes | Negotiated |

\*Unlimited still subject to Edge Agent / device capacity; Admin may set custom caps.

Camera limits **must be Admin-configurable** (override SKU defaults per shop), matching POS `max_devices` and AI `monthly_request_limit` patterns.

Vision should be an **add-on module**, not implied by base POS plan alone (unless Enterprise bundle includes it explicitly).

---

## Permission Matrix (Recommended)

| Capability | Internal Admin | Owner | Manager | Supervisor | Cashier |
|------------|----------------|-------|---------|------------|---------|
| Enable / license Vision | ✅ | ❌ | ❌ | ❌ | ❌ |
| Set camera/DVR limits | ✅ | ❌ | ❌ | ❌ | ❌ |
| Configure Vision (assign, layouts) | support override | ✅ | ✅ | ⚠️ view-only preferred | ❌ |
| Add / remove DVR | support override | ✅ | ⚠️ optional | ❌ | ❌ |
| Delete cameras | support override | ✅ | ⚠️ optional | ❌ | ❌ |
| Change recorder credentials | support override | ✅ | ❌ | ❌ | ❌ |
| View Live cameras | — | ✅ | ✅ | ✅ | ❌* |
| View Replay (future) | — | ✅ | ✅ | ⚠️ | ❌ |
| Export evidence (future) | — | ✅ | ⚠️ | ❌ | ❌ |

\*Cashier live view only if a future “till camera” entitlement is explicitly granted — default deny.

### Suggested permission keys (future)

| Key | Purpose |
|-----|---------|
| `vision.view` | Live / Monitor / health |
| `vision.manage` | Registry, DVR connect, credentials, delete |
| `vision.export` | Future evidence export |

Keep Internal Admin Vision licensing **outside** the shop role matrix (platform admin auth).

---

## Multi-Branch Activation Model

### Current architecture

| Mechanism | Behavior |
|-----------|----------|
| `resolveVisionShopScopeId()` | `getActiveAccountKey()` — **account-scoped local KV**, not cloud `shop_id` |
| `organizationId` / `branchId` on cameras | Stubs; not set on save |
| `branchLabel` | Free-text filter in Monitor |

### Recommendation

| Question | Answer |
|----------|--------|
| Business-wide vs branch-by-branch? | **License business-wide**; optionally allow **branch enable masks** for Enterprise |
| Activation unit | Cloud **`shop_id` / organization** (migrate off account-key scope for licensed multi-device) |
| Branch assignment | Keep `branchLabel` for UX; wire `branchId` when enterprise branches are licensed |

**RC:** Licensing without migrating scope to org/shop id will break multi-device and multi-branch commercial stories.

---

## Security Audit

| Area | Current state | Activation implication |
|------|---------------|------------------------|
| Credential vault | AES-GCM; `vision-cred-vault::${shopScopeId}`; device-bound key material | Must remain shop-scoped after license gate |
| Recorder credentials | Sent only to local Edge Agent | Installers on device can see vault-backed flows — restrict `vision.manage` |
| Installer permissions | No distinct installer role | Prefer time-boxed Owner PIN / Admin-provisioned staff with `vision.manage` |
| Business ownership | Local account key isolation | Different users don’t share KV; **not** full org tenancy |
| Internal override | None for Vision | Admin must enable module without reading camera passwords |
| Cross-business access | No cloud Vision API yet | Keep Edge Agent `127.0.0.1`; never expose RTSP credentials to browser |

**Hard rule:** Business A must never read Business B’s registry/vault. Entitlement checks must use the same shop identity as future cloud sync.

---

## Enterprise Benchmark (Provisioning Patterns)

| Pattern | Typical enterprise CCTV / optional module | WAKA analogue |
|---------|-------------------------------------------|---------------|
| Central provisioning | MSP / HQ enables site | **Internal Admin Shop Console** |
| License SKU + seat/channel caps | Camera channel licenses | `max_cameras` / `max_dvrs` |
| Installer ≠ licensee | Technician configures after enable | Staff/owner after Admin enable |
| Customer cannot self-license | No self-serve enterprise SKU flip | No Settings “Vision Enabled” |
| Role separation | Operator vs admin vs viewer | `vision.manage` vs `vision.view` |
| Site isolation | Tenant ID | `shop_id` / org (migrate from account key) |

Closest in-repo benchmark: **Shop AI** (Admin enable + limits + default off).

---

## Root Cause Register

| ID | Rank | Finding | Evidence | Impact |
|----|------|---------|----------|--------|
| **RC-1** | P0 | Vision activation location undefined — module always on for Settings users | `App.tsx` routes; `SettingsHubPage` unconditional card | Unlicensed commercial exposure |
| **RC-2** | P0 | Permission boundaries missing (`vision.*` never shipped) | `types.ts` Permission union; V1.0 doc §10 vs `settings.view` | Managers share full manage surface with owners |
| **RC-3** | P1 | Installer workflow incomplete — no Admin enable step | No Vision Admin tab; DVR import exists | Cannot separate licensing from install |
| **RC-4** | P1 | Subscription model absent — no camera/DVR caps | No Vision keys in entitlements; unlimited import | Cannot sell Starter/Business safely |
| **RC-5** | P1 | Multi-branch activation unclear — label-only branches; account-key scope | `shopScope.ts`; unused `branchId` | Enterprise multi-site licensing blocked |
| **RC-6** | P1 | Search catalog Vision entries lack `perm` | `backOfficeSearchCatalog.ts` | Discoverability wider than intended once roles expand |
| **RC-7** | P2 | Office hub omits Vision while Settings always shows it | `OfficeHubSectionBody` vs Settings | IA inconsistency after gating |
| **RC-8** | P2 | Doc/code drift on permissions | V1.0 certification vs shipped V1.x | Implementation risk at monetization |

---

## P0 / P1 / P2 Roadmap (Implementation Later)

### P0 — Before any paid Vision rollout

1. Internal Admin: **Vision Enabled** + license tier + max cameras / max DVRs (Shop AI pattern).  
2. Client gate: hide Settings/search + block `/office/vision*` when disabled.  
3. Introduce `vision.view` / `vision.manage` (or map tightly until roles land).  
4. **No customer self-enable toggle.**

### P1 — Provisioning quality

5. Enforce import/save limits against Admin caps.  
6. Document installer SOP: Admin enable → device trust → DVR connect.  
7. Align search catalog `perm` with Vision entitlements.  
8. Plan migration of Vision scope from account key → `shop_id` / org.

### P2 — Enterprise expansion

9. Branch-level enable masks; wire `branchId`.  
10. Remote monitoring / AI flags (Admin-only).  
11. Optional `vision.export` for evidence.  
12. Office hub card only when licensed.  
13. Promotional trial grants (like subscription promotional access).

---

## Freeze Recommendation

| Area | Recommendation |
|------|----------------|
| Vision Live / Monitor / DVR UX | May continue polish **behind future gate awareness** |
| POS Event Timeline (former “V1.4”) | Proceed as **V1.5** only after P0 activation design accepted |
| Vision AI | Frozen until Admin AI-Vision flag exists |
| Customer Settings “Enable Vision” | **Permanently rejected** as product principle |
| Commercial marketing of Vision | Frozen until Internal Admin provisioning ships |

**Certification statement:**  
Vision V1.4.5 certifies that the **correct enterprise activation model** is Internal-Admin-provisioned, business-configured, installer-executed — and that the current codebase does **not** yet enforce that model.

---

## Success Criteria Checklist

| Criterion | Status |
|-----------|--------|
| Correct activation model fully defined | ✅ Documented |
| Internal Admin as authoritative provisioning point | ✅ Recommended (AI pattern) |
| Owners configure but do not self-enable | ✅ Principle locked |
| Installer workflows separated from licensing | ✅ Gap + target flow documented |
| Ready for implementation without redesigning Vision CCTV architecture | ✅ Additive entitlement layer only |

---

## Appendix — Key Symbols

| Symbol | Path |
|--------|------|
| Vision routes | `src/App.tsx` |
| Settings card | `src/pages/SettingsHubPage.tsx` |
| Search catalog | `src/lib/backOfficeSearchCatalog.ts` |
| Role permissions | `src/lib/permissions.ts` |
| Entitlements (no Vision) | `src/lib/subscriptionEntitlements.ts` |
| Shop AI template | `src/lib/ai/shopAiSettings.ts`, Shop Console AI tab |
| Vision scope | `src/features/vision/shopScope.ts` |
| Vault | `src/features/vision/credentialVault.ts` |
| Architecture perms intent | `docs/VISION_1_0_ENTERPRISE_CAMERA_PLATFORM_ARCHITECTURE_CERTIFICATION.md` §10 |

---

*End of Vision V1.4.5 read-only certification (audit phase).*

---

## Implementation note (post-audit)

**Date:** 2026-08-04  

Provisioning was implemented following this certification:

| Piece | Location |
|-------|----------|
| DB + RPCs | `supabase/migrations/144_shop_vision_settings.sql` |
| Entitlements | `src/lib/vision/canUseVision.ts`, `shopVisionSettings.ts` |
| Admin UI | Shop Console tab **Vision** → `ShopVisionSettingsPanel` |
| Customer gate | `VisionProtectedRoute` + Settings hub status (no self-enable) |
| Trial | Admin-controlled; expiry keeps registry, disables Live/Monitor |
| Limits | Enforced on DVR connect + camera import/save |

Local/offline shops without `shop_id` use a documented **local bypass** so device Vision remains usable for owners; cloud shops require Internal Admin enablement.

### Superseded commercial model (V1.4.6)

**V1.4.6** removes Vision as a separately licensed product. Vision is **included with every paid WAKA subscription**; plans control **capacity only**. See `docs/VISION_1_4_6_VISION_INCLUDED_WITH_WAKA_SUBSCRIPTION.md`.

*End of Vision V1.4.5 certification + implementation notes.*
