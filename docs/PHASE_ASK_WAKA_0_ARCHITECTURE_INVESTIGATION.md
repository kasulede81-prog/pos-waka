# Ask WAKA — Architecture Investigation (Read-Only)

**Date:** 2026-08-12  
**Mode:** ARCHITECTURE-ONLY — no POS business logic, RLS, or AI engine rewrite  
**Product name:** Ask WAKA (AI business assistant)

---

## A. Existing AI architecture

### Summary

WAKA already has a **fail-closed, DeepSeek-only, Edge Function AI stack** for **task assistants** (product prefill, business setup, bulk inventory). There is **no free-form chat assistant** today. `AiProvider.chat()` is stubbed to throw `not_implemented`.

### Core modules (`src/lib/ai/`)

| Area | Paths |
|------|-------|
| Feature registry | `aiFeatures.ts` — `AiFeatureName`, `AI_FEATURES` |
| Client gates | `canUseAi.ts`, `useAiFeatureGate.ts` |
| Platform settings | `platformAiSettings.ts`, `platformAiSettings.v2.ts`, `platformAiAdmin.ts` |
| Shop settings | `shopAiSettings.ts`, `shopAiAdmin.ts` |
| Errors | `aiErrors.ts`, `parseAiEdgeResponse.ts` |
| Task clients | `productAiSuggest.ts`, `businessSetupAi.ts`, `bulkInventoryAi.ts` |
| Schemas | `aiProductSchemas.ts`, `aiBusinessSchemas.ts` (hand-rolled; **no Zod**) |
| Provider scaffold | `providers/types.ts`, `providers/registry.ts`, `providers/deepseek.ts` |

### Deployed Edge Functions

| Function | Feature | Auth |
|----------|---------|------|
| `ai-suggest-product` | `product_assistant` | Bearer JWT → `auth.getUser` + service-role RPCs |
| `ai-business-setup` | `business_setup_assistant` | Same |
| `ai-bulk-inventory` | `inventory_assistant` | Same |
| `ai-health` | Ops probe | JWT + `waka_internal_me` admin roles |

Shared: `_shared/aiGuard.ts`, `aiContext.ts`, `aiUsage.ts`, `aiResponse.ts`, `deepseekClient.ts`.

### Feature registry (today)

**Deployed:** `product_assistant`, `business_setup_assistant`, `inventory_assistant`  
**Reserved / not deployed:** `product_scanner`, `ocr`, `barcode_detection`, `restock_suggestions`, `marketing_assistant`, `marketplace_assistant`  
**Ask WAKA:** not yet in registry — should add e.g. `business_qa_assistant` / `ask_waka`.

### Provider reality

| Claim | Reality |
|-------|---------|
| Pluggable providers | **Scaffold only** — `AiProviderName` includes openai/gemini/claude |
| Runtime | Edge calls DeepSeek directly via `DEEPSEEK_API_KEY` |
| Gate | `assertAiFeatureAllowed` requires `settings.provider === "deepseek"` |
| Local / Ollama / Qwen | **Not present anywhere** |
| Chat | Interface stub only |

### Entitlement / logging

- Platform: `platform_settings` key `ai_settings` (JSONB v2)  
- Shop: `shop_ai_settings`  
- RPC: `check_ai_feature_allowed`  
- Usage: `ai_generation_usage_log` via `log_ai_request`  
- Migrations: `098`, `100`, `101`, `102`

### Existing AI UIs (task, not chat)

- `AiProductAssistSheet.tsx`  
- `BulkInventoryAiModal.tsx`  
- `AiBusinessSetupCard.tsx`  
- Internal Admin AI settings / shop AI tabs  

**Vision** (`src/lib/vision/*`) is a separate camera entitlement system — not LLM chat.

---

## B. Existing POS data architecture

### Pattern

**Offline-first Zustand + IndexedDB (`waka-pos-offline`)** with **Supabase cloud authority**. Operational data scoped by **`shop_id`**; billing/tenant by **`organization_id`**.

### Cloud tables (verified)

| Domain | Tables |
|--------|--------|
| Sales | `sales`, `sale_line_items`, `sale_payments`, `receipts`, `sale_returns`, `customer_debt_payments` |
| Catalog / stock | `products`, `product_categories`, `inventory_movements`, `shop_stock_movements`, `shop_inventory_count_sessions` |
| People | `customers`, `shop_pos_staff`, `shop_members` |
| Expenses | `expenses` (`cash_drawer` / `legacy`) |
| Shifts / EOD / drawer | `shop_shifts`, `shop_day_closes`, `shop_day_drawer_opens`, `shop_cash_drawer_adjustments` |
| Purchasing | `shop_suppliers`, `shop_purchases`, `shop_supplier_payments` |

Local mirrors live on `PosState` (`sales`, `products`, `cashExpenses`, `dayCloses`, `preferences.staffAccounts`, …) via `usePosStore` + entity buckets.

### Best existing aggregates for Ask WAKA tools

Server RPCs (migration `061_shop_server_reporting.sql` + patches), shop resolved via `_report_assert_shop()` / `waka_primary_shop_for_user()` — **not** free-form `p_shop_id` from the model:

| RPC | Maps to tool concept |
|-----|----------------------|
| `shop_get_daily_sales_summary` | `get_today_sales` / day slice |
| `shop_get_weekly_sales_summary` / `shop_get_monthly_sales_summary` | `get_sales_for_period` |
| `shop_get_top_products` | `get_top_products` / `get_slow_products` (order param) |
| `shop_get_inventory_insights` + `rpc_low_stock` | `get_inventory_summary` / `get_low_stock_products` |
| `shop_get_customer_insights` | `get_customer_summary` |
| `shop_get_cash_expense_insights` | `get_expense_summary` |
| `shop_get_dashboard_analytics` | Bundle / bootstrap context |
| `enterprise_dashboard_metrics` | Multi-branch HQ only (later) |

Client wrappers: `src/lib/shopReporting.ts`  
Offline mirrors: `src/lib/localReporting.ts`, `todaySalesSummary.ts`

**Gap:** No dedicated staff sales summary RPC identified; may need a **new read-only RPC** or careful aggregate over existing sales (server-side only). Do not let the model query raw `sales` rows.

### Supabase / RLS

- Client: `src/lib/supabase.ts` (anon + user JWT)  
- Helpers: `user_can_access_shop`, `user_can_manage_shop` (`007`, patched `029`)  
- Policies: `008_row_level_security.sql` + per-domain migrations  
- Edge AI pattern: user JWT for identity + **service role** only for gated RPCs after `assertAiFeatureAllowed`

---

## C. Recommended Ask WAKA architecture

```text
UI: Ask WAKA panel (Home / Back Office — TBD)
        ↓
Client: askWakaChat.ts (invoke only; no SQL; no service role)
        ↓
Edge: ai-ask-waka
  1) auth.getUser()
  2) resolveShopIdForUser (aiContext)
  3) assertAiFeatureAllowed(admin, "ask_waka", { userId, shopId })
  4) LLM tool-calling loop (DeepSeek first; later Ollama adapter)
  5) Tool executor: ONLY allowlisted tools → shop-scoped RPCs
  6) Return answer + citations/metrics; log_ai_request
        ↓
Postgres: existing shop_* reporting RPCs (+ new staff summary RPC if needed)
```

### Design principles (aligned with existing AI)

1. **Same security envelope** as `ai-suggest-product` (JWT + feature gate + shop resolve + usage log).  
2. **Tools are server-side only** — model never sees DB credentials or invents SQL.  
3. **Aggregates in, prose out** — minimum data to the model.  
4. **READ-ONLY tools in v1** — no stock adjustments, voids, expenses, or settings mutations.  
5. **Reuse** `shopReporting` RPC surface; do not reimplement financial math in the Edge Function.  
6. **Do not touch** sales processing, inventory calc, payments, drawer, EOD, or existing RLS.

### Why not client-side tools against Zustand?

Offline local aggregates exist (`localReporting.ts`), but sending them from the device to a cloud model still needs a server gate, and offline-only answers can diverge from cloud truth. **v1: online, server RPCs.** Optional later: offline FAQ from local aggregates with clear “device data” labeling — out of scope for first ship.

---

## D. Exact files that should be modified (later implementation)

| File | Change |
|------|--------|
| `src/lib/ai/aiFeatures.ts` | Register `ask_waka` (or `business_qa_assistant`) + edge name |
| `src/lib/ai/platformAiSettings.v2.ts` (+ edge mirror) | Feature flag default in platform settings schema if required |
| Platform/shop AI admin UI | Toggle for Ask WAKA entitlement |
| `supabase/migrations/100_*` / `101_*` patterns | New migration: feature allowlist entry + optional RPCs |
| `package.json` | Add `ai-ask-waka` to `supabase:deploy:ai` if script lists functions |
| Navigation / Home or Back Office shell | Entry point to Ask WAKA UI (presentation only) |

**Do not modify** for Ask WAKA v1: `usePosStore` sale/stock engines, checkout, cash drawer, day close, existing AI task edges (except shared `_shared` additions).

---

## E. Exact new files that should be created (recommended)

### Edge

| Path | Purpose |
|------|---------|
| `supabase/functions/ai-ask-waka/index.ts` | Chat + tool loop entry |
| `supabase/functions/_shared/askWakaTools.ts` | Allowlisted tool defs + executor |
| `supabase/functions/_shared/askWakaPrompts.ts` | System prompt (POS analyst, read-only) |
| Optional: `_shared/llmProvider.ts` | Thin adapter over DeepSeek now; Ollama later |

### Client

| Path | Purpose |
|------|---------|
| `src/lib/ai/askWaka.ts` | `askWaka(...)` invoke wrapper + error mapping |
| `src/lib/ai/askWakaSchemas.ts` | Request/response types (hand-rolled, match existing AI style) |
| `src/hooks/useAskWaka.ts` | UI state / streaming-or-turn handling |
| `src/components/.../AskWakaPanel.tsx` | Chat UI (new surface; no Sell rewrite) |

### Database (only if gaps)

| Path | Purpose |
|------|---------|
| `supabase/migrations/NNN_ask_waka_*.sql` | Feature flag seed; optional `shop_get_staff_sales_summary`; tighten grants |

### Tests

| Path | Purpose |
|------|---------|
| `askWakaTools.test.ts` / edge unit tests | Tool allowlist, shop scoping, refusal of unknown tools |

---

## F. Recommended API / tool contracts

### Edge request (client → `ai-ask-waka`)

```ts
{
  shop_id?: string;           // preferred; server re-validates membership
  message: string;            // user question
  conversation_id?: string;   // optional continuity
  locale?: "en" | "lg";
}
```

### Edge response

```ts
{
  ok: true,
  answer: string,
  tools_used: string[],       // e.g. ["get_today_sales"]
  data_as_of?: string,        // ISO
  usage?: { tokens_in, tokens_out, latency_ms }
}
// or aiBlocked / aiFailure envelope matching aiResponse.ts
```

### Tools (server-executed; model only sees JSON args + aggregate results)

| Tool | Args | Backing RPC / logic |
|------|------|---------------------|
| `get_today_sales` | none / `{ day? }` | `shop_get_daily_sales_summary` |
| `get_sales_for_period` | `{ period: "week"\|"month", anchor? }` | weekly/monthly RPCs |
| `get_top_products` | `{ start?, end?, limit? }` | `shop_get_top_products` (best) |
| `get_slow_products` | `{ start?, end?, limit? }` | same RPC, slow order |
| `get_inventory_summary` | none | `shop_get_inventory_insights` |
| `get_low_stock_products` | `{ limit? }` | insights / `rpc_low_stock` via service after shop assert |
| `get_staff_sales_summary` | `{ day?\|range? }` | **NEW RPC preferred** (aggregated) |
| `get_expense_summary` | `{ day?\|range? }` | `shop_get_cash_expense_insights` |
| `get_customer_summary` | `{ start?, end? }` | `shop_get_customer_insights` |

**Hard rules**

- Unknown tool name → reject.  
- Tool executor always binds `shop_id` from authenticated context, never from model free text.  
- Cap `limit` (e.g. max 20).  
- Strip PII beyond what’s already in existing insights (prefer aggregates).  
- No tool that accepts raw SQL or table names.

---

## G. Security / RLS considerations

| Requirement | How Ask WAKA meets it |
|-------------|------------------------|
| No unrestricted DB access for model | Tools call RPCs only |
| No arbitrary SQL | No SQL generation path |
| Shop/tenant scope server-side | `auth.getUser` + `resolveShopIdForUser` + membership check + reporting RPCs’ `_report_assert_shop` |
| Feature entitlement | Extend `check_ai_feature_allowed` + `assertAiFeatureAllowed` |
| Usage / budget | Reuse `log_ai_request` / monthly limits |
| Least privilege to model | Return aggregates, not full sale line dumps |
| Service role | Only inside Edge after authz; never in browser |
| Existing RLS | Unchanged; RPCs remain SECURITY DEFINER with shop assert |

**Roles:** Start with **owner/manager** (reporting-capable). Cashiers may be phase-gated via shop AI settings / permissions.

---

## H. How Ollama / Qwen3:4b should eventually connect

Current stack **cannot** switch to Ollama without work:

1. `assertAiFeatureAllowed` hard-requires `provider === "deepseek"`.  
2. Edge uses `_shared/deepseekClient.ts` only.  
3. Client `getAiProvider` has no `ollama` name.

**Recommended path (later phase, not v1):**

```text
_shared/llmProvider.ts
  → deepseek (cloud, default)
  → ollama (base URL + model qwen3:4b) for self-hosted / offline-shop pilots

Platform settings:
  provider: "deepseek" | "ollama" | …
  provider_config.ollama_base_url
  provider_config.ollama_model = "qwen3:4b"
```

Constraints for Ollama:

- Must run **outside** the browser (Edge, sidecar, or shop gateway) — never expose shop DB to the model host.  
- Tool execution stays on Supabase Edge/RPC; only the **LLM completion** moves to Ollama.  
- Same allowlisted tools + shop scope.  
- Tool-calling format must be validated for Qwen (may need prompt-shaped JSON tools if native tools differ).

**v1 recommendation:** Ship Ask WAKA on **DeepSeek** using existing secrets and gates; add Ollama adapter in a dedicated phase after tool contracts stabilize.

---

## I. Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Hallucinated numbers if tools skipped | High | Force tool use for quantitative questions; refuse when tools fail |
| Over-sharing PII/line-level data | High | Aggregates only; harden tool payloads |
| Cost / abuse | Medium | Existing AI budgets + rate limits + feature flag |
| Offline expectation | Medium | Clear “Ask WAKA needs network” in v1 |
| Staff summary gap | Medium | Add RPC before claiming staff analytics |
| Provider lock-in | Medium | Introduce `llmProvider` adapter before Ollama |
| Accidental write tools | Critical | Explicit allowlist; no write RPCs in v1 |
| Confusing with Vision / product AI | Low | Separate feature name + UI entry |

---

## J. Phased implementation plan

### Phase ASK-0 — Architecture (this document)
Investigation only. **DONE when accepted.**

### Phase ASK-1 — Server tools + Edge skeleton
- Register feature `ask_waka`  
- Migration for flag + optional `shop_get_staff_sales_summary`  
- `ai-ask-waka` Edge: auth → gate → tool executor (DeepSeek) → log  
- Unit tests: allowlist, shop binding, unknown tool rejection  
- **No POS engine changes**

### Phase ASK-2 — Client Ask WAKA UI
- Panel + hook + invoke wrapper  
- Gate via `useAiFeatureGate("ask_waka")`  
- Entry from Home or Back Office (not Sell checkout)  
- Empty/error/offline states  

### Phase ASK-3 — Prompt quality + guardrails
- Prompt: Ugandan retail POS analyst; currency UGX; cite “as of”  
- Force tools for numeric claims  
- Admin metrics in existing AI control center  

### Phase ASK-4 — Ollama / Qwen3:4b (optional)
- `llmProvider` adapter  
- Platform settings for Ollama base URL/model  
- Pilot shops only; same tools  

### Explicit non-goals for ASK-1…3
- Write actions (restock, price change, void, expense create)  
- Arbitrary SQL / “query builder” for the model  
- Refactor of existing product/setup/bulk AI  
- Changes to sales, inventory, payment, drawer, EOD logic  
- RLS policy rewrites  

---

## Safest extension points (summary)

1. **New Edge Function** alongside existing AI functions (same auth/guard/usage).  
2. **New feature flag** in `aiFeatures.ts` + platform/shop settings.  
3. **Existing reporting RPCs** as tool backends.  
4. **New UI surface** that only invokes the Edge Function.  
5. **Shared `_shared` modules** for tools/prompts — do not fork DeepSeek client until Ollama phase.

---

## Verification note

All table names, RPCs, Edge Functions, and AI paths above were confirmed from the repository. Live DeepSeek tool-calling capability and Qwen tool format are **NOT VERIFIED** against a running model in this investigation.

---

*End of Ask WAKA architecture investigation. No POS business logic or AI production paths were modified for this report.*
