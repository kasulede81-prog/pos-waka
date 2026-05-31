# WAKA POS — Agent Verification QR System

Public verification for marketing agents. Shop owners scan a QR on an agent’s ID card and confirm the person is a registered, active Waka agent.

## URLs

| Purpose | URL |
|--------|-----|
| **Verification (QR target)** | `https://pos.waka.ug/verify-agent/{referralCode}` |
| **Signup referral (unchanged)** | `https://pos.waka.ug/register?ref={referralCode}` |

Example: `https://pos.waka.ug/verify-agent/WAKA-A8F7`

The path parameter is the **referral code** (`WAKA-XXXX`), not the internal UUID.

---

## Database changes

Migration: [`supabase/migrations/070_agent_verification_qr.sql`](../supabase/migrations/070_agent_verification_qr.sql)

### Schema

| Column | Table | Purpose |
|--------|-------|---------|
| `credential_expires_at` | `marketing_agents` | When the verification credential expires. Backfilled to `created_at + 1 year` for existing rows. Set on new grants. |

### RPC: `public_verify_marketing_agent(p_code text)`

- **Access:** `anon` + `authenticated` (public, no login)
- **Lookup:** `normalize_referral_code(referral_code) = normalize_referral_code(p_code)`
- **Returns (safe fields only):**

| Field | Notes |
|-------|--------|
| `referral_code` | e.g. `WAKA-A8F7` |
| `agent_name` | Display name or `"Waka Agent"` |
| `status` | `active` \| `suspended` \| `expired` |
| `is_active` | `true` only when status is `active` |
| `issued_at` | `created_at` |
| `expires_at` | `credential_expires_at` or `created_at + 1 year` |
| `phone_e164` | Only when **active**; omitted otherwise |

**Status rules:**

- `suspended` — `active = false`
- `expired` — `credential_expires_at < now()` (or fallback expiry)
- `active` — otherwise

**Errors:** `invalid_code`, `not_found` (no row for code)

Apply in Supabase SQL editor after deploy.

---

## Verification page

**Route:** `/verify-agent/:agentId`  
**Component:** `src/pages/public/VerifyAgentPage.tsx`

Mobile-first card layout:

- Waka POS header + logo
- Green “Verified Waka agent” banner when active
- Red **“Agent Not Active”** banner when suspended or expired
- Agent name, ID, status badge, issue/expiry dates
- Phone (tap-to-call) when active
- Warning copy for inactive agents
- No login, no app shell, no back-office chrome

Works on web; allowed on native app without sign-in (`isVerifyAgentPath`).

---

## QR generation

**Helper:** `buildAgentVerificationUrl(code)` in `src/lib/referralAgents.ts`  
**Component:** `src/components/agents/AgentVerificationQr.tsx` (uses `react-qr-code`)

QR encodes: `https://pos.waka.ug/verify-agent/{CODE}`

**Where shown:**

| Location | Who |
|----------|-----|
| Agent portal (`/agent`) | Logged-in marketing agents |
| Internal admin → Agents | Waka staff |

Agents can copy the verification link or use the on-screen QR for print/export.

**Print guidance:** Use the agent portal QR at ≥180×180 px; test scan distance before mass printing.

---

## Security considerations

### What is exposed publicly

Only fields returned by `public_verify_marketing_agent`. No email, user UUID, shop IDs, referral counts, or internal notes.

### What is not exposed

- Inactive agents still show name + ID + status (for fraud awareness) but **phone is hidden** when not active.
- Unknown codes return “Agent not found” without confirming partial matches.

### RPC hardening

- `SECURITY DEFINER` with fixed `search_path = public`
- `EXECUTE` granted only to `anon` and `authenticated` — not broad `PUBLIC`
- Lookup by normalized referral code only (case-insensitive)

### Abuse / rate limiting

- Verification is read-only; no writes from the public page.
- Consider Supabase rate limits / Cloudflare on `/verify-agent/*` if scan traffic spikes.
- Optional future: `agent_verification_logs` table + edge rate limit (not in v1).

### QR vs signup link

- **Verification QR** → trust / identity check  
- **Signup link** → attribution only  

Do not replace signup links with bare `pos.waka.ug`; always use `/verify-agent/{code}` on printed materials.

### Credential renewal

- `credential_expires_at` defaults to 1 year from grant.
- Internal staff can extend by updating `marketing_agents.credential_expires_at` or re-granting (sets expiry if null).
- Expired agents show **Expired** and **Agent Not Active**.

### Pilot rollout

1. Apply migration `070_agent_verification_qr.sql`
2. Deploy web app
3. Re-print agent cards with new QR URL
4. Old generic `pos.waka.ug` QRs remain valid as marketing home only — they do **not** verify agents
