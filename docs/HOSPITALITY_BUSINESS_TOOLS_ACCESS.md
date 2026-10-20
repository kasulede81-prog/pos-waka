# Hospitality → shared Kiosk Duka business tools

Hospitality keeps Kiosk Duka as the single source of truth. `/hospitality/tools`
is a discoverable entry point to the **existing** Kiosk Duka launcher; it does
not add a second ledger, settings page, product store, or financial model.

## Entry points

- Hospitality mobile nav: **Tools** (`/hospitality/tools`)
- Floor plan bottom bar: **Tools** (visible only when a launcher permission is held)
- Hospitality dashboard header: **Tools**
- Direct route: `/hospitality/tools`

The page renders the existing `DesktopHomeTiles`, which uses
`LAUNCHER_TILE_CATALOG` and `resolveHomeMenuTiles`. The same Home Menu order and
visibility settings (`preferences.launcherTileOrder`,
`preferences.launcherTileLayout`) apply. Back Office and Settings buttons are
shown only with `back_office.access` / `settings.view` and navigate to the
existing `/office` and `/settings` routes.

## Guards

- `HospitalityBusinessRoute` still requires the shop to be Hospitality.
- `AnyPermissionRoute` requires at least one launcher permission
  (`BUSINESS_TOOLS_PERMISSIONS`, derived from `LAUNCHER_TILE_CATALOG`).
- Every tile is still filtered by its own permission; the page never broadens
  access.
- The root `/` redirect is unchanged. `/hospitality/tools` is an additional
  route, not a bypass.
- `/office` keeps `back_office.access`, `BackOfficeRouteGuard`, and the
  back-office PIN behavior.
- `/settings` and its subpages keep their existing permission and capability
  guards.

## Role availability (default role permissions)

| Role | Tool entry | Launcher tiles normally available |
|---|---|---|
| Owner | Yes | All catalog tiles, including Command Center, Investigation, Profit, Settings |
| Manager / Supervisor | Yes | Sell, Inventory, Debts, Back Office, Cash Drawer, Cash Position, Sales History, Reports, Profit, Investigation, Settings (no owner-only Command Center unless granted) |
| Cashier | Yes | Sell, Inventory, Debts, Sales History |
| Stock keeper | Yes | Inventory, Sales History |
| Waiter | Yes | Sell, Sales History |
| Bar | No | None of the business-tool permissions; operational Hospitality nav only |
| Kitchen-only | No | KDS only; no launcher permission and no Tools nav |

Saved Home Menu settings can hide or reorder allowed tiles. They never grant a
permission that the role/account does not hold. A tile that is hidden by the
shop's Home Menu settings also stays hidden here.
