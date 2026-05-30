# Shop profile UX redesign

**Scope:** Wording and layout only — no security, RPC, or schema changes (except separate migration `068` for shop number recycling).

**Implemented in:** `SettingsShopPage`, `ShopProfileForm`, `ShopSupportNumberCard`, `src/lib/i18n.ts`.

---

## 1. Current UX issues (before)

| Issue | Why it hurt shopkeepers |
|--------|------------------------|
| Title “Shop info” under “App settings” | Felt like a technical settings screen, not “my business” |
| Large orange Shop ID card at top | Dominant; most owners rarely need the ID day-to-day |
| Single heavy card with thick borders | Looked like an admin form, not a friendly profile |
| Strict locked message | “Locked after registration” sounded punitive |
| Location in orange sub-box | Extra visual layer; “Your area” was vague |
| Address label “Shop address / location” | Overlapped with district/city/area |
| Business type + currency at bottom after long form | Important context buried below GPS buttons |
| `text-lg` inputs everywhere | More scrolling on small phones |
| No direct support CTA when locked | Only text saying contact WhatsApp |

---

## 2. Proposed redesigned layout (implemented)

**Page header**

- Title: **Business profile**
- Subtitle: *Information about your business and shop.*

**Body (top → bottom)**

1. **Protected banner** (only when profile complete) — sky blue info box + **Message Waka Support** button  
2. **Recovery email** (onboarding only, unchanged logic)  
3. **Shop name** — first content section  
4. **Phone number** — short hint under label  
5. **Location** — one section: District → City → Area → optional landmark → compact GPS row  
6. **Type of business** — read-only chip-style line  
7. **Currency** — read-only UGX line  
8. **Save changes** (when editable)  
9. **Need help?** footer — Shop ID + Copy (moved from top)

---

## 3. Mobile-first wireframe

```
┌─────────────────────────────┐
│ ← App settings              │
│ Business profile            │
│ Information about your      │
│ business and shop.          │
├─────────────────────────────┤
│ [Protected info + WhatsApp] │  ← if locked
├─────────────────────────────┤
│ Shop name                   │
│ [________________________]  │
├─────────────────────────────┤
│ Phone number                │
│ [________________________]  │
├─────────────────────────────┤
│ Location                    │
│ District  [▼______________] │
│ City      [________________] │
│ Area      [________________] │
│ Landmark  [________________] │
│ [Use GPS] [Skip]            │
├─────────────────────────────┤
│ Type of business            │
│ Simple Shop                 │
├─────────────────────────────┤
│ Currency                    │
│ Uganda Shillings (UGX)      │
├─────────────────────────────┤
│ [ Save changes ]            │
├─────────────────────────────┤
│ Need help?                  │
│ Shop ID: A042  [ Copy ]     │
└─────────────────────────────┘
```

---

## 4. Revised wording (EN)

| Before | After |
|--------|--------|
| Shop info | Business profile |
| Name, phone, location | Your shop name, phone, and location |
| Shop details are locked after registration… | Your business information is protected… contact Waka Support |
| Your Waka shop ID (large card) | Need help? · Shop ID: A001 · Copy |
| Your area | Location |
| Shop address / location | Street or landmark (optional) |
| Save business profile | Save changes |
| Business profile saved. | Your business profile was saved. |
| Contact support to change business type. | (unchanged, under business type section) |

Luganda strings updated in parallel in `i18n.ts`.

---

## 5. Before vs after

| Dimension | Before | After |
|-----------|--------|--------|
| First impression | System / app settings | My business profile |
| Shop ID prominence | Top, large orange card | Bottom support footer |
| Visual weight | One thick bordered block | Light stacked sections |
| Field size | `text-lg`, `border-2` | Standard mobile-friendly inputs |
| Locked state | Grey “locked” box | Friendly “protected” + WhatsApp button |
| Location | Nested orange panel | Single “Location” group |
| Scroll length | Longer (large ID + padding) | Shorter, clearer hierarchy |
| Support path | Mention in paragraph only | Button + Shop ID at bottom |

---

## 6. Shop number recycling (separate data change)

**Problem:** `next_waka_shop_number()` only incremented; deleted shops (e.g. A042) were never reused.

**Fix:** Migration `068_recycle_released_shop_numbers.sql`

- Table `waka_shop_number_released` holds freed numbers  
- `admin_permanently_delete_shop_account` inserts org shop numbers before delete  
- `next_waka_shop_number()` assigns lowest released number first, else increments counter  

**Apply in Supabase** with other pending migrations. New registrations after a permanent delete can receive the freed number (e.g. A042 again). Historical audit still uses shop UUID in logs.

---

## 7. QA checklist

- [ ] Open Settings → Business profile — title and subtitle correct  
- [ ] Completed onboarding — protected banner + WhatsApp; fields read-only  
- [ ] Incomplete onboarding — editable; save still works  
- [ ] Shop ID at bottom; copy works  
- [ ] EN and LG language toggle  
- [ ] Android narrow screen — no horizontal overflow  
- [ ] After migration 068: permanent delete shop A00X → new shop gets A00X (if lowest released)
