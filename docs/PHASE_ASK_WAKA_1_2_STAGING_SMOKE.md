# Ask WAKA — Phase ASK-1.2 Staging Smoke Test

**Date:** 2026-08-12  
**Mode:** Staging smoke only — no UI, no Ollama, no production deploy  
**Target:** `wdirxwvbgsfzbdurmkbf` (`waka-pos-staging`)  
**Verdict:** **PASS** — live DeepSeek native tool-calling **VERIFIED**

---

## A. Deployment status

| Prerequisite | Status |
|--------------|--------|
| Separate staging Supabase project | **YES** — `wdirxwvbgsfzbdurmkbf` |
| Staging env files | `.env.staging.local`, `.local/waka-pos-staging.env`, `.local/waka-pos-staging-test-owner.env` (gitignored) |
| Migration 146 on staging | Applied |
| Migration 147 on staging | Applied — expands `ai_generation_usage_log.kind` for `ask_waka_chat` |
| `ai-ask-waka` on staging | **ACTIVE** (verify_jwt=true) |
| `DEEPSEEK_API_KEY` on staging | **Present** (value not logged) |
| Platform `ask_waka` | **true** (provider=`deepseek`) |
| Staging test shop `ask_waka` | **true** (`ai_enabled=true`) |
| Non-production test owner JWT | Available via staging seed credentials |

**Actions deliberately NOT taken (safety):**

- Did **not** deploy `ai-ask-waka` to production `ljaedextsenbkxzzgxcg`
- Did **not** enable production platform/shop `ask_waka`
- Did **not** modify production secrets or data

---

## B. DeepSeek live tool-calling result

**VERIFIED**

Successful live invoke returned `tools_used: ["get_today_sales"]` with a grounded sales answer (UGX totals from synthetic staging data), `data_as_of`, and `usage` token/latency fields.

Native tool-calling path is working (not HTTP-200-only / empty tools).

---

## C. Test case results 1–12

| # | Case | Result |
|---|------|--------|
| 1 | Basic quantitative (“sold today”) | **PASS** — `get_today_sales` |
| 2 | Top products this week | **PASS** — `get_top_products`, `get_sales_for_period` |
| 3 | Low stock | **PASS** — `get_low_stock_products` |
| 4 | Multi-tool sales / expenses / inventory | **PASS** — 4 tools (`get_today_sales`, `get_expense_summary`, `get_low_stock_products`, `get_inventory_summary`) |
| 5 | Unauthorized/mismatched `shop_id` | **PASS** — HTTP 403, `success=false`, `tools=[]` |
| 6 | Write attempt (delete/refund) | **PASS** — refused; no write tools |
| 7 | SQL attempt | **PASS** — refused; no SQL/tools |
| 8 | Unknown tool (`hack_database`) | **PASS** — refused; tool not executed |
| 9 | Provider failure envelope | **NOT LIVE-FORCED** — unit coverage remains; live path healthy so failure envelope not re-triggered |
| 10 | Usage logging | **PASS** after migration **147** — rows in `ai_generation_usage_log` with `feature=ask_waka`, `kind=ask_waka_chat` |
| 11 | Response integrity | **PASS** — `answer`, `tools_used`, `data_as_of`, `usage` present on success |
| 12 | Server logs secret/PII leakage | **PARTIAL** — CLI has no `supabase functions logs`; static redaction from ASK-1.1 still holds; response payloads reviewed with no key/PII dumps |

---

## D. Example successful response (redacted)

```json
{
  "success": true,
  "tools_used": ["get_today_sales"],
  "data_as_of": "2026-08-12T09:36:10.813Z",
  "usage": {
    "tokens_in": 2495,
    "tokens_out": 188,
    "latency_ms": 3201
  },
  "answer_preview": "Here's your sales summary for today ... Total revenue: UGX 2,515,000 ..."
}
```

---

## E. Usage-log verification

**Initially FAIL, then PASS after 147.**

Defect: `ai_generation_usage_log_kind_check` only allowed `product_suggest` / `business_setup` / `bulk_inventory`. Edge logged `kind=ask_waka_chat`, inserts were rejected (HTTP responses still succeeded).

Fix: `supabase/migrations/147_ask_waka_usage_kind.sql` applied on **staging only**.

Post-fix sample row:

- `feature=ask_waka`, `kind=ask_waka_chat`, `provider=deepseek`, `success=true`, tokens + latency populated

**Note:** Production still needs migration 147 before Ask WAKA usage logging will work there (do not apply until a deliberate production migration window).

---

## F. Security/logging verification

- Mismatched shop → 403 / no tools
- Write + SQL + unknown-tool prompts → model refusal; only allowlisted `get_*` tools ever appeared in other cases
- Customer identifiers not requested in these smoke prompts; tool layer still strips `customer_id` per ASK-1.1
- DeepSeek key not echoed by helpers; do not paste keys into chat

---

## G. Defects discovered

1. **Usage log kind constraint** blocked `ask_waka_chat` — fixed by migration 147 (staging applied).
2. Staging `db push --linked` still awkward because remote history includes both `041` and `0411` (apply via pooler SQL when needed).
3. `supabase functions logs` subcommand unavailable in current CLI — dashboard log review still recommended before prod.

No tool-calling or shop-scope defects found in live smoke.

---

## H. Whether ASK-1.2 PASSES

**YES — PASS**

Live DeepSeek native tool-calling executed successfully against staging with allowlisted tools and grounded answers.

---

## I. Whether ASK-2 UI is now approved

**CONDITIONAL YES** for starting ASK-2 UI work, with these holdouts:

1. Apply migration **147** to production only when intentionally enabling Ask WAKA there (not now).
2. Rotate any DeepSeek key that was pasted into chat history.
3. Prefer a dashboard edge-log spot-check before production enablement.

---

## Commands used

```bash
./scripts/staging/set_staging_deepseek_secret.sh   # staging only
./scripts/staging/smoke_ask_waka.sh
```

Expanded cases 1–10/11 run via authenticated staging JWT against `https://wdirxwvbgsfzbdurmkbf.supabase.co/functions/v1/ai-ask-waka`.

---

## L. Production was NOT modified

Confirmed during this phase:

- No `ai-ask-waka` on production function list from earlier guards
- Production `ask_waka` left disabled
- Production secrets not set/changed in this smoke
- CLI `project-ref` restored to `ljaedextsenbkxzzgxcg` after staging DB work

---

*End of ASK-1.2 staging smoke report (PASS).*
