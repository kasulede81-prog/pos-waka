# Phase 13.1 — Enterprise Staff Roles & Permission Framework

## Audit summary (pre-implementation)

### Current model
- **Canonical roles:** `UserRole` union in `src/types.ts` (8 system roles).
- **Permission engine:** `src/lib/permissions.ts` — static `ROLE_PERMISSIONS` matrix (v23).
- **Staff UI catalog:** `src/lib/staffRoleCatalog.ts` — previously showed all 8 roles to every business type.
- **Gap:** Pharmacy shops saw Waiter, Kitchen, Bar in staff wizard.

### Enforcement chain
```
BusinessType → RoleTemplate (NEW) → UserRole → Permission matrix
                              ↓
                    SessionActor.permissions (custom roles)
                              ↓
              hasActorPermission → hasEffectivePermission → Route guards / store
```

### Staff creation
- `StaffAccessPage` → `StaffCreateWizard` → `addStaffAccount` (store)
- Cloud-first via `staffSyncQueue`; offline queue for creates
- PIN hashed Argon2id in `staffSecret.ts`

### Persistence
- Local: `preferences.staffAccounts`, `preferences.customStaffRoles` (NEW)
- Cloud: `shopStaffCloud` RPCs (hashes only)
- Staff cache: encrypted `offlineStaffCache.ts`

### Problems fixed in 13.1
| Issue | Fix |
|-------|-----|
| Hospitality roles in pharmacy | `roleTemplatesForBusinessType()` filters templates |
| Team list role dropdown too narrow | Template-based dropdown per industry |
| Custom permissions ignored at runtime | `SessionActor.permissions` + `hasActorPermission()` |
| No industry labels | `roleTemplateId` on `StaffAccount` |

### Preserved (unchanged)
- Authentication, Owner PIN, cloud sync, audit logs, route guard structure
- `UserRole` permission matrix (templates map to existing roles)

---

## Architecture

New module: `src/lib/enterpriseRoles/`

| File | Purpose |
|------|---------|
| `industry.ts` | Maps `BusinessType` → `RoleIndustry` |
| `roleTemplates.ts` | Industry role templates (Retail, Pharmacy, Hospitality, Wholesale) |
| `permissionCategories.ts` | Grouped permission catalog for editors |
| `resolvePermissions.ts` | Custom role + staff permission resolution |

### Future business types
Add templates to `roleTemplates.ts` with a new `industries` entry — no permission engine changes.

### Custom roles (foundation)
- Type: `CustomStaffRole` in `types.ts`
- Storage: `preferences.customStaffRoles`
- Resolution: `resolveStaffPermissions()` used by `sessionActor.ts`

---

## Verification checklist

- [x] Pharmacy wizard excludes Waiter/Kitchen/Bar
- [x] Hospitality excludes Pharmacist/Pharmacy Technician
- [x] Retail excludes hospitality-only base roles
- [x] One shared permission matrix (`permissions.ts`)
- [x] `roleTemplateId` persisted on staff create/update
- [ ] Full custom role editor UI (foundation in place)
- [ ] Permission editor UI (categories defined; UI follow-up)

See also: `docs/PHASE_12_STAFF_PIN_AUTH_AUDIT.md`
