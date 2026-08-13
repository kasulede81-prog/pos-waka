# Ask WAKA — Phase ASK-6.1 Production Hardening

**Date:** 2026-08-12  
**Mode:** Hardening only — **no production changes made**  
**Production:** `ljaedextsenbkxzzgxcg`  
**Staging:** `wdirxwvbgsfzbdurmkbf`  
**Strategy:** DeepSeek = production provider · Ollama/Qwen = development only · Ask WAKA remains READ-ONLY

**This phase did NOT:** deploy `ai-ask-waka`, apply migration 147, enable platform or shop flags, enable `pilot_rollout_mode`, enable Ollama, rotate secrets, modify POS/checkout/inventory/payments/drawer/EOD, add write tools, or weaken RLS.

Tests passing is **not** production readiness. ASK-6.1 is hardening of the repo plus confirmation that production was left untouched.

---

## A. Files changed

| File | Change |
|------|--------|
| `supabase/config.toml` | Pinned `[functions.ai-ask-waka] verify_jwt = true` |
| `src/lib/ai/platformAiSettings.v2.ts` | Production provider list (no Ollama); admin selectable providers; coerce-on-save; refuse Ollama when targeting the production project |
| `src/lib/ai/platformAiSettings.v2.test.ts` | Provider isolation + DeepSeek default tests |
| `src/components/internal-admin/v2/pages/AdminAiSettingsPage.tsx` | Provider dropdown uses `adminSelectableAiProviders()` |
| `src/hooks/useAdminGlobalSearchData.ts` | Admin search uses the same selectable list |
| `src/lib/ai/shopAiSettings.ts` | `isAskWakaPilotShopReady()` documents the explicit-row prerequisite |
| `src/lib/ai/shopAiSettings.test.ts` | Shop-level Ask WAKA gating + missing-row gap tests |
| `src/lib/ai/askWakaHardening.test.ts` | JWT pin, default-off flags, localhost Ollama isolation |
| `.env.development.example` | Documents `VITE_ALLOW_OLLAMA_PROVIDER` as local/dev only |
| `docs/PHASE_ASK_WAKA_6_1_PRODUCTION_HARDENING.md` | This report |

Ollama implementation (`ollamaClient.ts`, `ollamaProtocol.ts`, local harness) was **not** deleted.

---

## B. JWT configuration

`supabase/config.toml` now contains:

```toml
[functions.ai-ask-waka]
verify_jwt = true
```

| Check | Result |
|-------|--------|
| Explicit pin | **Yes** |
| `verify_jwt = false` for this function | **Absent** |
| `--no-verify-jwt` on `ai-ask-waka` deploy | **Absent** (`package.json` `supabase:deploy:ai` does not pass it) |
| TOML syntax | **Valid** (section parse + regex) |

`--no-verify-jwt` remains only on `auth-send-email` (unrelated branded-email hook).

**Not deployed.** The pin is repo configuration for a future authorized deploy.

---

## C. Migration 147 verification procedure

**Do not run `supabase db push` against production.** Historical mismatch around migration `041` makes that unsafe.

Production already appears to contain migration **146**. Migration **147** only widens `ai_generation_usage_log_kind_check` to allow `'ask_waka_chat'`.

### C.1 Inspect (SQL Editor on `ljaedextsenbkxzzgxcg`) — read-only

```sql
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conname = 'ai_generation_usage_log_kind_check';
```

| Result | Meaning |
|--------|---------|
| Definition includes `'ask_waka_chat'` | 147 **already applied** — do not re-apply |
| Only `'product_suggest'`, `'business_setup'`, `'bulk_inventory'` | 147 **required** before first live Ask WAKA log |
| No row | Constraint missing — apply 147 (it uses `drop constraint if exists`) |

**This phase did not execute that query.** ASK-6 could not verify the constraint via CLI (IPv6 / history mismatch). Treat 147 as **unverified / likely required** until the SQL Editor result is recorded.

### C.2 Exact SQL that would apply 147 if required

**Do not execute in this phase.** Paste only after C.1 shows `ask_waka_chat` is missing:

```sql
-- From supabase/migrations/147_ask_waka_usage_kind.sql
-- Additive check-constraint only. No RLS, no POS logic, no data backfill.

alter table public.ai_generation_usage_log
  drop constraint if exists ai_generation_usage_log_kind_check;

alter table public.ai_generation_usage_log
  add constraint ai_generation_usage_log_kind_check
  check (
    kind in (
      'product_suggest',
      'business_setup',
      'bulk_inventory',
      'ask_waka_chat'
    )
  );
```

Without 147, the first successful Ask WAKA request can fail at usage-log insert.

---

## D. Secret hygiene result

Tracked source, scripts, docs, and environment examples were searched for literal DeepSeek keys (`sk-…` assigned to `DEEPSEEK_API_KEY` or long `sk-` tokens).

| Check | Result |
|-------|--------|
| Literal DeepSeek key in git-tracked files | **None found** |
| Literal DeepSeek key in untracked Ask WAKA scripts/docs | **None found** |
| Staging setter | Reads env; refuses if staging ref equals production; does not print the value |
| Env examples | Placeholders only; production example has no DeepSeek key |

ASK-6 found production `DEEPSEEK_API_KEY` present (last updated **2026-06-11**). A DeepSeek key was pasted into chat during ASK-1.2 work (2026-08-12). That paste **could have been** the production key.

**ROTATION REQUIRED**

Do **not** rotate automatically. Rotation is an explicit later authorization (see §K). This phase did not inspect or print any secret value.

---

## E. Ollama production isolation

| Control | Status |
|---------|--------|
| `normalize_ai_settings` (migration 101) | Persists only `deepseek \| openai \| gemini \| claude`; **ollama coerced to deepseek** |
| `assertAiFeatureAllowed` | Requires `provider === "deepseek"` |
| Hosted Edge localhost | Rejected unless `OLLAMA_ALLOW_LOCALHOST=1` |
| Production secrets (ASK-6) | `OLLAMA_BASE_URL` / `OLLAMA_MODEL` / `OLLAMA_ALLOW_LOCALHOST` **absent** |
| `OLLAMA_BASE_URL` / `OLLAMA_MODEL` required in production | **No** |
| Browser-side Ollama connection | **None** (`ollamaProtocol` is test/helper only; no `fetch` to `:11434`) |
| Admin save payload | Strips `ollama_base_url` / `ollama_model` unless Ollama is selectable |

New client rule: **Ollama is never selectable when `VITE_SUPABASE_URL` targets `ljaedextsenbkxzzgxcg`**, even if `VITE_ALLOW_OLLAMA_PROVIDER=true` or `npm run dev` is used against production.

Local development still works:

- `npm run dev` against a non-production URL → Ollama remains in the dropdown
- `VITE_ALLOW_OLLAMA_PROVIDER=true` on a non-production target → Ollama remains available
- Local harness / `OLLAMA_ALLOW_LOCALHOST=1` on local Edge is unchanged

Never set `VITE_ALLOW_OLLAMA_PROVIDER` on the production Vercel project.

---

## F. Admin provider UI change

Internal Admin AI provider `<select>` no longer maps `AI_PROVIDER_OPTIONS` (which includes `ollama`).

It now uses:

- `adminSelectableAiProviders()`
- `coerceAdminSelectableProvider()`

| Environment | Options |
|-------------|---------|
| Production project / production build targeting production | `deepseek`, `openai`, `gemini`, `claude` |
| Local/dev against non-production | Same list **plus** `ollama` |

DeepSeek remains the default and the production Ask WAKA provider. OpenAI / Gemini / Claude keep their existing architecture behavior (they still cannot run Ask WAKA today because `assertAiFeatureAllowed` requires DeepSeek). Ollama code is not deleted.

Admin global search uses the same selectable list so production search does not advertise Ollama.

---

## G. Feature-gate verification

Read-only live probe of production `get_platform_ai_settings` (anon REST, flags only, no data dump, no writes):

| Flag | Production now | This phase |
|------|----------------|------------|
| `enabled` | **true** (existing AI platform) | Unchanged |
| `provider` | **deepseek** | Unchanged |
| `ask_waka` | **false** | Unchanged |
| `pilot_rollout_mode` | **false** | Unchanged |
| `pilot_auto_enable_new_shops` | **false** | Unchanged |
| `provider_config.ollama_base_url` | absent | Unchanged |

Code defaults match: `DEFAULT_PLATFORM_AI_SETTINGS_V2.ask_waka / pilot_rollout_mode / pilot_auto_enable_new_shops` are all `false`.

`canUseAi("ask_waka")` is blocked when the platform flag is false even if a shop row has `ask_waka=true`.

### Pilot shop prerequisite (do not enable yet)

A shop with **no** `shop_ai_settings` row does **not** receive the shop-level feature check (`check_ai_feature_allowed` / `canUseAi` skip it when `pilot_rollout_mode` is off). That behavior is **unchanged** because it also applies to existing AI features.

**Exact prerequisite for a future one-shop pilot:**

1. The pilot shop **must have** a `shop_ai_settings` row.
2. That row must have `ai_enabled = true` and `ask_waka = true`.
3. Every other shop must have a row with `ask_waka = false` (column default from 146; new rows from `ensure_shop_ai_settings` do not set `ask_waka`, so they inherit `false`).
4. Confirm no shop is missing a settings row before turning platform `ask_waka` on.

Helper: `isAskWakaPilotShopReady(settings)` is true only when a row exists **and** both flags are true. It does not change `canUseAi`.

---

## H. One-shop pilot safety

The existing gate **can** support:

- platform `ask_waka = true`
- exactly one shop `shop_ai_settings.ask_waka = true`
- all other shops `ask_waka = false`

**Not enabled. No production shop rows created or modified.**

| Edge case | Risk | Mitigation |
|-----------|------|------------|
| Shop with **no** `shop_ai_settings` row | Would receive Ask WAKA if platform flag is on | Verify every shop has a row; pilot shop must be `isAskWakaPilotShopReady` |
| `pilot_rollout_mode = true` | Changes gating for **all** AI (product / setup assistants). Production already has `enabled=true` and `business_setup_assistant=true` | **Do not enable** for this pilot |
| `pilot_auto_enable_new_shops = true` | New shops could be auto-approved for AI | Keep **false** |
| New shop insert via `ensure_shop_ai_settings` | Inserts `ai_enabled` for other assistants when pilot is off; `ask_waka` uses column default **false** | Safe for Ask WAKA specifically |
| `npm run supabase:deploy:ai` | Deploys **all** AI functions including `ai-ask-waka` to production | Do not run until Ask WAKA deploy is authorized |
| Cashiers | Lack `reports.view` | Blocked; owners/managers are the intended users |
| Supervisors | Have `reports.view` (residual from ASK-6) | Accept or tighten later |

Recommended later sequence (not this phase): verify/apply 147 → rotate DeepSeek if required → deploy `ai-ask-waka` with JWT → platform `ask_waka=true` → **one** shop `ai_enabled` + `ask_waka=true` → confirm other shops remain `ask_waka=false`.

---

## I. Tests and exact results

```text
npx tsc -b
# exit 0

npx vitest run --pool=forks --maxWorkers=2 \
  src/lib/ai/askWakaHardening.test.ts \
  src/lib/ai/platformAiSettings.v2.test.ts \
  src/lib/ai/shopAiSettings.test.ts \
  src/lib/ai/canUseAi.test.ts \
  src/lib/ai/askWaka.test.ts \
  src/lib/ai/askWakaGuardrails.test.ts \
  src/lib/ai/askWakaLlmProtocol.test.ts \
  src/lib/ai/askWakaToolContracts.test.ts \
  src/lib/ai/ollamaProtocol.test.ts

# Test Files  9 passed (9)
#      Tests  86 passed (86)
```

Coverage vs requested cases:

| Case | Result |
|------|--------|
| A. `ai-ask-waka` `verify_jwt = true` | Pass (`askWakaHardening.test.ts`) |
| B. Ollama unavailable in production configuration | Pass (`platformAiSettings.v2.test.ts`) |
| C. DeepSeek remains production default | Pass |
| D. Admin provider UI does not expose Ollama as a production option | Pass (helpers used by Admin page + search) |
| E. Existing development Ollama configuration still works | Pass (DEV / non-production URL still includes `ollama`; localhost allowed only when explicit) |
| F. Platform `ask_waka` false remains safe | Pass |
| G. Shop-level Ask WAKA gating | Pass (row present: shop flag enforced; missing row documented, not changed) |

Lint on new/changed lib tests: **clean**.

Lint on `AdminAiSettingsPage.tsx` / `useAdminGlobalSearchData.ts`: two **pre-existing** `react-hooks/set-state-in-effect` errors on `void load()` in `useEffect`. Not introduced by ASK-6.1; not fixed here.

No live production Ask WAKA request was made.

---

## J. Remaining risks

| Risk | Severity | Notes |
|------|----------|--------|
| Migration 147 unverified on production | High at go-live | First usage log can fail until C.1/C.2 |
| DeepSeek key rotation outstanding | High if chat paste was prod | **ROTATION REQUIRED**; not done |
| Missing `shop_ai_settings` row bypasses shop flag | Medium | Prerequisite in §G; do not change other AI features |
| `ai-ask-waka` still **not deployed** on production | Expected | HTTP 404 until authorized deploy |
| Client `AI_FEATURES.ask_waka.deployed = true` while production Edge is missing | Low | Health check still reports 404; UI gate is flag-based |
| `supabase:deploy:ai` would ship Ask WAKA to production | High if run accidentally | Explicit authorization required |
| Supervisors have `reports.view` | Low | Residual from ASK-6 |
| OpenAI/Gemini/Claude still in admin dropdown | Low | Existing architecture; Ask WAKA still DeepSeek-only at the guard |

---

## K. Exact actions still requiring explicit authorization

Do **not** do these until separately approved:

1. Run the production SQL Editor verification in §C.1.
2. Apply 147 (§C.2) **only if** `ask_waka_chat` is missing.
3. Rotate production `DEEPSEEK_API_KEY` (treat the ASK-1.2 paste as compromised). Never commit or log the new value.
4. Deploy `ai-ask-waka` to `ljaedextsenbkxzzgxcg` with JWT (`verify_jwt=true`; never `--no-verify-jwt`).
5. Set platform `ask_waka = true` (keep provider `deepseek`; keep both pilot flags **false**).
6. Set **one** shop `shop_ai_settings.ai_enabled = true` and `ask_waka = true` after confirming that shop has a row and all others are `ask_waka = false`.
7. Enable Ollama / `OLLAMA_ALLOW_LOCALHOST` / `OLLAMA_BASE_URL` on production — **not recommended**; keep DeepSeek-only.

---

## L. ASK-6.1 PASS / FAIL

**ASK-6.1: PASS**

Hardening in the repository is complete, and production remains untouched:

| Production action | This phase |
|-------------------|------------|
| Migration applied | **No** |
| Edge deploy | **No** |
| Flags changed | **No** (re-probed: `ask_waka=false`, both pilot flags `false`) |
| Secret changed / rotated | **No** |
| Shop rows changed | **No** |

**Not a production-readiness GO.** ASK-6 remains **CONDITIONAL GO** for a later one-shop DeepSeek pilot after the authorized actions in §K.
