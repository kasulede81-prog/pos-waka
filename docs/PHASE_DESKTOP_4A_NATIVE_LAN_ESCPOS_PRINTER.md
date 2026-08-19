# WAKA POS DESKTOP — PHASE 4A
# NATIVE LAN ESC/POS PRINTER

**Date:** 2026-08-16  
**Status:** Implemented (native transport + bridge — physical printer certification pending)  
**Depends on:** Phases 1–3 desktop docs

---

## Objective

Secure Windows/Electron native LAN ESC/POS path:

Receipt formatter (shared) → ESC/POS bytes → `window.wakaDesktop.hardware.printer` → dedicated IPC → Electron TCP → private LAN printer.

Cash drawer is **not** included (Phase 4B).

---

## Architecture

| Layer | Location |
|-------|----------|
| Validation | `electron/hardware/lanHostValidation.cjs` |
| TCP transport | `electron/hardware/escPosNetwork.cjs` (main only) |
| IPC register | `electron/hardware/printerIpc.cjs` |
| Channels | `waka:hardware:printer:print-escpos` / `test-connection` / `get-status` |
| Preload | `hardware.printer.*` + `escPosNetwork` alias |
| Adapter | `src/services/hardware/printerAdapter.ts` |
| Capability | `escPosNetwork` true only when bridge API exists |

### Network policy

- Private IPv4 only: `10/8`, `172.16–31/12`, `192.168/16`, link-local `169.254/16`
- Reject: localhost/loopback, public IPs, hostnames/URLs, malformed hosts
- Default port `9100`; port range 1–65535
- Payload: byte array, max 256 KiB
- Connect timeout 5s; write timeout 10s
- User-facing errors: “Printer connected” / “Could not connect to printer”

---

## Explicitly unchanged

- `usePosStore` business / checkout / sale logic
- Offline / sync / auth / deviceId
- Android / iOS / migrations
- Remote Support / RustDesk / transport
- Cash drawer IPC/UI (Phase 4B)

---

## Verification

- Focused unit tests (validation + mocked TCP + safety + RS isolation)
- `npx tsc --noEmit`
- **Windows EXE packaging deferred** until explicit approval:
  `PHASE 4A SOURCE CODE COMPLETE — NOW BUILD THE EXE`

**Physical Windows + thermal printer testing: pending — not certified.**

---

## Stop

Phase 4A source complete for review. Do not start Phase 4B cash drawer.
Do not rebuild the Windows EXE until the approval phrase above is given.
