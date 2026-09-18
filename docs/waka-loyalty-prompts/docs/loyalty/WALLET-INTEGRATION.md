# Wallet Integration — Architecture & Setup (Phase 06)

## Summary

Loyalty passes for **Google Wallet** and **Apple Wallet** are implemented as a
server-side issuance pipeline with all signing material kept in Supabase Edge
Function secrets. The internal abstraction is fully implemented and unit-tested;
**external platform credentials do not yet exist for WAKA**, so no live pass has
been issued. The QR-code identification flow (Phase 05) remains the universal
fallback and is untouched by this phase.

## What was verified (external requirements)

### Google Wallet

- Requires a **Google Wallet API issuer account** (Google Pay & Wallet Console)
  with the Wallet API enabled.
- Requires a **service account** (IAM) with the `walletobjects` permission;
  pass issuance is a server-side REST/JWT flow — the "Save to Google Wallet"
  URL carries an **ES256-signed JWT** (`iss` = service account email,
  `aud` = `google`, `typ` = `savetowallet`) containing the `LoyaltyClass` +
  `LoyaltyObject`.
- Dynamic balance updates are supported by the platform (PATCH the
  `LoyaltyObject`'s `loyaltyPoints.balance` via the REST API) — implemented as a
  future hook, not claimed as real-time (no sandbox account to test against).

### Apple Wallet

- Requires **Apple Developer Program membership** and a **Pass Type ID**
  certificate (CSR through the developer portal or Keychain Access), plus the
  **Apple WWDR certificate**.
- A `.pkpass` is a ZIP bundle (`pass.json`, `manifest.json` with SHA-1 hashes,
  detached **PKCS#7 SignedData** `signature` over the manifest, images). Apple
  uses `storeCard` for loyalty passes.
- Dynamic updates require a `webServiceURL` on the pass + Apple Push — out of
  scope for the initial integration; passes show the balance at issue time.
  This is documented, not hidden.

### Current blocker (honest status)

| Requirement | Status |
| --- | --- |
| Google Wallet issuer + service account | **Missing** — must be created in the Google Pay & Wallet Console |
| Apple Developer Program + Pass Type ID cert | **Missing** — requires paid Apple Developer account |
| Hosted HTTPS logo for both platforms | **Missing** — needed by Google (`programLogo`) and Apple (`logo.png`) |

Without these, the edge function fails closed with `wallet_not_configured`
(HTTP 409). Nothing in the frontend depends on Wallet.

## Architecture

```
Merchant app (POS / Loyalty hub)
    │  POST /functions/v1/loyalty-wallet-pass
    │  { provider: "apple" | "google", shop_id, account_id }
    │  Authorization: Bearer <user JWT>
    ▼
Supabase Edge Function  loyalty-wallet-pass
    │  1. user-context client reads account + customer + shop + program
    │     (RLS enforces user_can_access_shop — cross-shop requests 404)
    │  2. builds LoyaltyPassInput (shop name, member name, opaque QR token
    │     payload, balance, earning-rule label — no phone numbers)
    │  3. provider branch, secrets from Deno.env only
    ▼
_shared/loyaltyWallet modules (pure TS + WebCrypto, unit-tested)
    • appleWalletPass.ts   pass.json (storeCard), manifest SHA-1, store-only ZIP
    • applePkcs7Signer.ts  PKCS#7 SignedData (DER), RSA-2048/SHA-256, cert+WWDR embedded
    • googleWalletPass.ts  LoyaltyClass/Object JSON, ES256 JWT, save URL
    • loyaltyWalletService.ts  validation, fail-closed config checks, orchestration
```

### Pass identity security

- The pass barcode payload is the **opaque `qr_token`** in the
  `WAKA-LOYALTY:<token>` format — the same identifier used by the QR fallback.
  A scanned pass code resolves only via `loyalty_account_by_token` (RLS-checked).
- Passes display member **name, points balance, earning rule, shop name** only.
  No phone numbers, no customer IDs.
- `serialNumber` / object id = loyalty account id (an opaque UUID, meaningless
  outside the system).

### Secrets (never committed, never frontend)

Set via `supabase secrets set`:

```
GOOGLE_WALLET_ISSUER_ID=3388000000000000001
GOOGLE_WALLET_SERVICE_ACCOUNT_JSON={"client_email":"...","private_key":"-----BEGIN PRIVATE KEY-----\n..."}
WALLET_ALLOWED_ORIGINS=https://<your-domain>
APPLE_PASS_TYPE_IDENTIFIER=pass.com.waka.pos
APPLE_TEAM_ID=XXXXXXXXXX
APPLE_PASS_CERTIFICATE_PEM=-----BEGIN CERTIFICATE-----\n...
APPLE_WWDR_PEM=-----BEGIN CERTIFICATE-----\n...
APPLE_PASS_PRIVATE_KEY_PEM=-----BEGIN PRIVATE KEY-----\n...
```

## Setup checklist (when credentials are obtained)

1. **Google**
   1. Create issuer in Google Pay & Wallet Console; note the issuer ID.
   2. Create a service account, grant `walletobjects.admin`, export JSON key.
   3. `supabase secrets set GOOGLE_WALLET_ISSUER_ID=... GOOGLE_WALLET_SERVICE_ACCOUNT_JSON='...' WALLET_ALLOWED_ORIGINS=...`
   4. `supabase functions deploy loyalty-wallet-pass --project-ref ljaedextsenbkxzzgxcg`
   5. First issuance puts the class `UNDER_REVIEW` (platform rule); test with a
      real device via the returned save URL.
2. **Apple**
   1. Apple Developer → Identifiers → Pass Type IDs → create `pass.com.waka.pos`.
   2. Generate a certificate signing request, obtain the pass signing
      certificate, export cert + private key (PKCS#8 PEM).
   3. Download the current WWDR certificate (G4) from Apple.
   4. Set the `APPLE_*` secrets; deploy as above.
   5. Distribute by returning `pkpass_base64` to a device (the merchant app can
      offer a download link); test with the iOS simulator / a real device.
3. Optional UI: add "Save to Wallet" buttons in the Loyalty hub calling the
   function — deferred until credentials exist so no dead UI ships.

## Test coverage (internal abstraction)

- `wallet/appleWalletPass.test.ts` — CRC-32 vector, ZIP structure (local
  headers + EOCD), pass.json shape, manifest SHA-1, bundle assembly.
- `wallet/applePkcs7Signer.test.ts` — issuer/serial extraction, full PKCS#7
  SignedData structure, RSA-2048 signature **verified against the manifest**.
- `wallet/googleWalletPass.test.ts` — class/object payloads, claims, save URL,
  ES256 JWT **signed and verified with a WebCrypto-generated key**.
- `wallet/loyaltyWalletService.test.ts` — validation, fail-closed behavior,
  end-to-end issuance with stub signers.

25 tests, all passing. What is NOT tested: real Google/Apple platform round
trips (blocked on the credentials above) — deliberately, rather than faked.
