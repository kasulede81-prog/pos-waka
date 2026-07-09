# Phase 13.3 — Enterprise Custom Roles & Permission Manager

## Summary

Exposes the Phase 13.1 permission framework to business owners through a Role Management Center at `/settings/staff-roles`.

## Deliverables

| Area | Location |
|------|----------|
| Role Management Center | `src/pages/SettingsStaffRolesPage.tsx` |
| Roles UI | `src/components/staff/StaffRolesCenter.tsx` |
| Permission editor | `src/components/staff/CustomRolePermissionEditor.tsx` |
| Custom role helpers | `src/lib/enterpriseRoles/customRoles.ts` |
| Permission labels | `src/lib/enterpriseRoles/permissionLabels.ts` |
| Store CRUD | `usePosStore` — `add/update/remove/cloneCustomStaffRole` |

## Features

- System roles (industry templates) — read-only, cloneable
- Custom roles — create, edit, clone, disable/archive, delete
- Grouped permission editor by category (industry-filtered)
- Permission preview summary before save
- Staff assignment via custom roles in `StaffTeamList`
- Audit: `custom_role_*`, `staff_role_assigned`, `staff_role_removed`

## Unchanged

- Permission engine (`permissions.ts`, `resolveStaffPermissions` logic)
- Authentication / lock screen (Phase 13.2)
- Owner PIN, SensitiveActionGate, cloud sync engines

## Verification

- `npm run build`
- `src/lib/enterpriseRoles.customRoles.test.ts`
- `src/lib/enterpriseRoles.test.ts` (industry template isolation)

## Next phase

13.4 — migrate in-app checks to `hasActorPermission` so custom roles enforce everywhere (route guards already partial).
