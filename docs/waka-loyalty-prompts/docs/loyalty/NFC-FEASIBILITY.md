# NFC Feasibility — Loyalty Tap Identification (Phase 07)

## Objective

Tap-based membership identification: the merchant's WAKA device reads a
customer credential over NFC and resolves it to the loyalty account through
the same validated path as QR scanning (`loyalty_account_by_token`).

```
merchant WAKA phone → NFC read → WAKA-LOYALTY:<token> → account lookup
→ customer identified → sale completes → server awards points
```

NFC is identification only. Raw NFC payloads are never trusted for anything
except the opaque-token lookup; points still come exclusively from the
completed-sale trigger.

## Investigation matrix (verified against platform documentation)

| Mechanism | Works? | Notes |
| --- | --- | --- |
| Android phone reads NFC tag/sticker (NDEF) | **Yes** | NDEF `text`/`url` records with the `WAKA-LOYALTY:` payload. NTAG213/215 stickers cost ~$0.20 — the realistic credential for this market. |
| Android phone reads another phone via HCE | Not practical | Customer phone would need a custom host-card-emulation app. Out of scope. |
| Web NFC in Capacitor WebView / Chrome Android | **Where exposed** | `NDEFReader` on secure contexts. Availability varies by WebView version — implemented with graceful detection, not assumed. |
| Native NFC plugin (Capacitor) | Possible later | Would need plugin install + `cap sync` + real-device verification. Deferred; Web NFC covers the first deployment. |
| iPhone reads NDEF tag | Hardware yes, app-level restricted | CoreNFC reading requires a native layer; Capacitor WebView does not expose Web NFC. QR remains the iOS path until a native plugin is adopted. |
| Apple Wallet pass NFC (`nfc` field) | External certification | Requires Apple's NFC-enabled pass entitlement (VAS/Value Added Services Protocol) approval — enterprise application to Apple. Documented dependency, not implemented. |
| Google Wallet Smart Tap | External certification | Requires Google issuer approval and certified terminals — designed for payment terminals, not phone-to-phone. Documented dependency, not implemented. |

## What was implemented

1. **Android manifest**: `android.permission.NFC` +
   `uses-feature android.hardware.nfc required=false` — NFC never blocks
   install on non-NFC devices.
2. **`src/services/hardware/nfcAdapter.ts`**: capability detection
   (`NDEFReader` presence + secure context), session lifecycle over Web NFC,
   and pure NDEF record extraction that only accepts `WAKA-LOYALTY:` text/URL
   payloads — product stickers, foreign payloads, and bare tokens are ignored.
3. **UI**: the Loyalty hub scan card gains a "Tap membership card (NFC)"
   action when NFC is available, with ready/error states; when unsupported it
   shows a hint and QR scanning remains fully available.
4. **Security**: the tapped payload goes through the exact same
   shop-scoped, RLS-checked `loyalty_account_by_token` lookup as QR. A tag
   from the wrong shop, a forged token, or a re-tagged product sticker all
   resolve to nothing. No points are ever derived from the NFC payload.

## Real-device testing status (honest)

- Unit-tested: capability detection, NDEF extraction, forgery guards.
- **Pending real hardware**: NDEF tag tap on an NFC-capable Android running
  the WAKA build. This cannot be performed in this environment — mark the
  acceptance criterion "real-device testing" as pending, not complete.
- iOS: QR/phone identification is the path; Wallet-NFC entitlements are an
  external dependency listed above.

## Deployment note (issuing NFC tags to customers)

Any NDEF-writing tool (NFC Tools app, merchant's own device with an NFC write
capability added later) can store `WAKA-LOYALTY:<qr_token>` as a text record
on a sticker handed to the customer. The token is the same opaque value
printed in the membership QR, so QR and NFC are interchangeable
identification methods for the same account. Writing tags is a merchant-side
operation — no server change needed.
