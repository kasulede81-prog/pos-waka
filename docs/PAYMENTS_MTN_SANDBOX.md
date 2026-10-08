# MTN Mobile Money — Sandbox Integration Guide (M3-F / Phase: SANDBOX ONLY)

Adapter: `supabase/functions/_shared/payment/providers/mtnMomo.ts`
Contract source: official MTN MoMo developer documentation (momodeveloper.mtn.com).
Scope: **sandbox only**. The Uganda production target environment (`mtnuganda`) is documented here but must NOT be configured in this phase.

---

## 1. Obtaining sandbox credentials

All three credential artifacts are created through the **Sandbox Provisioning API** on the sandbox host
(`https://sandbox.momodeveloper.mtn.com`), per the official documentation:

1. **Subscription key**
   - Sign in to the MoMo developer portal (momodeveloper.mtn.com) with an MTN account.
   - Create/select the **Collections** API product in the sandbox → the **Ocp-Apim-Subscription-Key**
     for that product is your subscription key.

2. **API user** (provisioned via the Sandbox Provisioning API):
   ```
   POST https://sandbox.momodeveloper.mtn.com/v1/apiuser
   Ocp-Apim-Subscription-Key: <your subscription key>
   Content-Type: application/json

   { "providerCallbackHost": "https://ljaedextsenbkxzzgxcg.supabase.co" }
   ```
   Response contains `apiUser` (the API-user id).

3. **API key** (provisioned via the Sandbox Provisioning API):
   ```
   POST https://sandbox.momodeveloper.mtn.com/v1/apikey/<apiUserId>
   Ocp-Apim-Subscription-Key: <your subscription key>
   ```
   Response contains `apiKey`.

> Keep all three values **server-side only** (Supabase Edge Function secrets, section 3).
> The `providerCallbackHost` registered above must be our Supabase project origin so the
> callback can reach section 4.

## 2. Runtime contract implemented by the adapter

| Step | Official endpoint | Adapter behavior |
|---|---|---|
| Token | `POST /collection/token/` with `Authorization: Basic base64(apiUser:apiKey)`, `Ocp-Apim-Subscription-Key`, `Content-Length: 0`, **no body** (experimentally verified against the sandbox — `grant_type`/form bodies are NOT accepted) | cached per isolate until `expires_in - 30s` |
| RequestToPay | `POST /collection/v1_0/requesttopay` with `Authorization: Bearer`, `Ocp-Apim-Subscription-Key`, `X-Target-Environment`, `X-Reference-Id` (UUID v4) | HTTP **202** = accepted (payment stays `pending`); **409 duplicate X-Reference-Id = already registered → idempotent success**; body derived only from the server payment intent; `amount` sent as a decimal **string**; `payer.partyIdType=MSISDN`, `payer.partyId` = normalized MSISDN (no `+`); `externalId` = our payment reference |
| Status | `GET /collection/v1_0/requesttopay/{X-Reference-Id}` | `PENDING` / `SUCCESSFUL` / `FAILED` → normalized `pending` / `confirmed` / `failed`; unknown vocabulary → `null` (ledger untouched) |
| Callback | plain JSON POST to the configured callback host | see section 4 |

**X-Reference-Id policy:** we use *our* M3-A payment `reference` (a UUIDv4). This keeps a single
idempotency system: retries re-present the same reference; MTN's duplicate-reference semantics make
re-pushes safe; status queries and callbacks address the same id.

**Error mapping (initiate):** 401/403 → `provider_auth_failed` (retryable — payment stays pending,
credentials are an ops problem, never a customer failure) · 400/422 → `provider_rejected`
(definite rejection) · 429/5xx/network/timeout/malformed → retryable (`provider_unavailable` /
`provider_response_invalid`) · a timeout can **never** become success.

## 3. Server-side secrets

Edge Function secrets only — **never** `VITE_*`, never committed, never in the browser:

```
MTN_MOMO_BASE_URL=https://sandbox.momodeveloper.mtn.com
MTN_MOMO_TARGET_ENVIRONMENT=sandbox
MTN_MOMO_COLLECTION_SUBSCRIPTION_KEY=<subscription key>
MTN_MOMO_API_USER=<api user id>
MTN_MOMO_API_KEY=<api key>
```

Provision with (values supplied interactively, never written to the repo):
```
supabase secrets set --project-ref ljaedextsenbkxzzgxcg \
  MTN_MOMO_BASE_URL=... MTN_MOMO_TARGET_ENVIRONMENT=... \
  MTN_MOMO_COLLECTION_SUBSCRIPTION_KEY=... MTN_MOMO_API_USER=... MTN_MOMO_API_KEY=...
```
When **any** of the five is absent the adapter reports `provider_not_configured` and every path
fails closed (initiate → `provider_not_configured`, callback → HTTP 503).

## 4. Callback configuration (registered on the MTN side)

Official callback URL to register for the API user / sandbox callback host:

```
https://ljaedextsenbkxzzgxcg.supabase.co/functions/v1/payment-callback-mtnmomo
```

**Authenticity mechanism (per official contract):** MTN callbacks are a plain JSON POST —
the official documentation specifies **no HMAC/signature header**. What the contract does provide,
all implemented in `verifyCallback()`:

1. TLS + the callback host registered on the MTN API user (only MTN can deliver it);
2. **authoritative server-to-server re-query** — every callback is verified against
   `GET /collection/v1_0/requesttopay/{X-Reference-Id}` with server credentials; settlement is
   refused unless the provider's own status **agrees** with the callback;
3. structural validation (JSON, `status`, `externalId`, `amount`, `currency`);
4. `callbackSettle` cross-checks amount/currency against the immutable ledger row (unchanged);
5. all settlement still flows exclusively through the M1 ledger wrappers.

Callback payload mapping (per the official final-callback fields):

| MTN field | Use |
|---|---|
| `status` | raw status → `normalizeStatus` (must agree with re-query) |
| `externalId` | **our payment reference** (lookup key) |
| `amount`, `currency` | reported values → ledger cross-check only |
| `financialTransactionId` | stored as informational provider reference |

## 5. Sandbox testing checklist

1. Set the five secrets (section 3).
2. Deploy `payment-initiate`, `payment-status`, `payment-callback-mtnmomo`.
3. Register the callback URL (section 4) on the sandbox API user.
4. Create a checkout payment → Pay → expect the payment to leave `pending` only after a real
   sandbox status/callback (`SUCCESSFUL` → confirmed, `FAILED` → failed).
5. Verify no configuration path ever yields `confirmed` without a provider status.
