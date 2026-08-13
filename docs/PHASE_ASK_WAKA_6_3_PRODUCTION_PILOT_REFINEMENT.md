# Ask WAKA — Phase ASK-6.3 Production Pilot Refinement

**Date:** 2026-08-13  
**Mode:** Period/date correctness + observability review — Ask WAKA only  
**Production:** `ljaedextsenbkxzzgxcg`  
**Staging:** `wdirxwvbgsfzbdurmkbf`  
**Pilot shop:** FRESH STEP LAUNDRY AND SHOE CARE (`A027`, `79a7669f-399d-45fa-9631-221e1ed0a1ca`)  
**Strategy:** DeepSeek = production provider · Ollama = OFF · Ask WAKA = READ-ONLY · one shop only

This phase closed the ASK-6.2 week-window caveat. It **did not** enable another shop, change the other 28 shops, enable `pilot_rollout_mode` / `pilot_auto_enable_new_shops`, enable Ollama, add write tools, or modify RLS / checkout / sales / inventory / payments / drawer / EOD / existing AI task assistants.

---

## A. Date semantics before / after

**Before (ASK-6.2):**

`get_sales_for_period` passed the model’s `anchor_day` (or `null`) into `shop_get_weekly_sales_summary`. That RPC is a **rolling 7-day window ending on `p_anchor_day`**, not a Monday–Sunday calendar week.

“Compare this week with last week” therefore produced **non-consecutive** windows (example: this week Aug 7–13 vs last week Jul 25–31) and **omitted** the week that contained the shop’s only historical sales (2026-07-23). The model also invented date labels.

“How much did we sell this week?” could classify as **today** because a `how much … sell` regex matched before week scope.

**After (ASK-6.3):**

The server is the source of truth for calendar weeks in `Africa/Kampala`, Monday–Sunday (same convention as `weekStartKeyKampala`).

| Phrase | Meaning |
|--------|---------|
| This week | Current Kampala calendar week (Mon–Sun), always marked **in progress** |
| Last week | Immediately preceding Kampala calendar week (complete) |

Example on Thu 2026-08-13 Kampala:

| Window | Dates |
|--------|--------|
| This week | 2026-08-10 → 2026-08-16 (in progress) |
| Last week | 2026-08-03 → 2026-08-09 |

The two ranges are consecutive: last week ends the day before this week starts. No overlap. No gap. Days/weeks are not skipped.

Existing reporting RPCs remain authoritative for totals. The weekly RPC is still called with **Sunday as `p_anchor_day`**, which yields Mon–Sun because the RPC is “7 days ending on anchor.” Financial totals are **not** calculated in the LLM.

Model-supplied `anchor_day` / `start_day` / `end_day` on week tools are **ignored**.

---

## B. Week boundary implementation

New shared module: `src/lib/ai/askWakaPeriods.ts` (Edge copy: `supabase/functions/_shared/askWakaPeriods.ts`).

- Monday-start weeks via `(utcDay + 6) % 7`, matching `weekStartKeyKampala`.
- Structured period objects: `{ start_day, end_day, label, in_progress, week_scope }`.
- `get_sales_for_period` week args: `{ period: "week", week: "this"|"last" }` → server injects dates + Sunday `anchor_day`.
- New read-only tool `get_week_comparison`: one call returns both weeks, server `change_ugx` / `change_pct`, and display lines. Comparison classification uses **only** this tool.
- Top / slow / customer / staff tools default to the same calendar week (staff no longer silently defaults to **today only**).
- Expense RPC `shop_get_cash_expense_insights()` still has **no date args**. `week_ugx` is a rolling last-7-days total. The tool now stamps honest rolling dates (`week_is_rolling_seven_days: true`) instead of pretending it is a calendar week.
- Zero / empty successful tool payloads are marked `zero_confirmed` / `empty_confirmed`. Prompts treat those as confirmed zeros, not unknown/error.
- Authorization unchanged: requested `shop_id` cannot override server scope; tools reject `shop_id`; RPCs stay server-scoped. HTTP 403 `forbidden` remains acceptable.

Deployed production function: `ai-ask-waka` **version 2**, `ACTIVE`, `verify_jwt=true`. Staging received the same period fix first.

---

## C. Test results

`npx tsc -b` — **pass**.

Complete Ask WAKA Vitest suite (`askWaka*.test.ts` + `ollamaProtocol.test.ts`, `--pool=forks`) — **7 files, 79 tests, all pass**. No regressions.

Period tests (spec items 1–10):

| # | Case | Result |
|---|------|--------|
| 1 | Current calendar week | Pass — Mon 2026-08-10 → Sun 2026-08-16 |
| 2 | Previous calendar week | Pass — 2026-08-03 → 2026-08-09 |
| 3 | Consecutive week boundaries | Pass |
| 4 | Sunday/Monday Kampala boundary vs `weekStartKeyKampala` | Pass |
| 5 | Partial current week `in_progress` | Pass |
| 6 | Zero-sales week is confirmed zero | Pass |
| 7 | Week containing historical sales 2026-07-23 is distinct | Pass — 2026-07-20 → 2026-07-26 |
| 8 | Compare current vs previous week | Pass — UGX display lines |
| 9 | No date overlap | Pass |
| 10 | No date gap | Pass |

Also added: this-week classification no longer maps to today; last-week scope; comparison uses `get_week_comparison` only; model-invented date ranges are ignored.

---

## D. Staging regression

Staging provider remained **deepseek**. Ollama was **not** enabled. Platform: `ask_waka=true`, `pilot_rollout_mode=false`, `pilot_auto_enable_new_shops=false`, Ollama keys **absent**.

`ai-ask-waka` deployed to `wdirxwvbgsfzbdurmkbf` **before** the production deploy. Authenticated staging owner JWT (password login; secrets not printed).

| Case | Result | tools_used | Notes |
|------|--------|------------|--------|
| Today’s sales | **PASS** | `get_today_sales` | UGX 0 today |
| This week’s sales | **PASS** | `get_sales_for_period` | **This week (Aug 10–Aug 16, in progress)** UGX 2,670,000 |
| Last week’s sales | **PASS** | `get_sales_for_period` | **Last week (Aug 3–Aug 9)** UGX 345,000 |
| Week-over-week | **PASS** | `get_week_comparison` | Consecutive windows; change UGX 2,325,000 (674%) |
| Top products | **PASS** | `get_top_products` | Calendar week dates; grounded list |
| Expenses | **PASS** | `get_expense_summary` | Rolling last 7 days labeled honestly (Aug 7–13), UGX 55,000 |
| Staff | **PASS** | `get_staff_sales_summary` | This week Aug 10–16, not today-only |
| Inventory / low stock | **PASS** | `get_low_stock_products` | Grounded stock counts |

No phones, emails, SQL, secrets, or tool/RPC names in answers.

---

## E. Production A027 regression

Independent SQL on the pilot shop: **3** completed sales, all on **2026-07-23**, totaling **UGX 44,000**. **0** sales today, this week (Aug 10–16), or last week (Aug 3–9). The historical week is no longer silently skipped or mis-labeled as “last week.”

Owner session: short-lived magic-link (password unchanged). The owner may have received a login email.

| Q | Result | tools_used | Notes |
|---|--------|------------|--------|
| 1 How much did we sell today? | **PASS** | `get_today_sales` | UGX 0, 0 tx. Matches SQL. |
| 2 How much did we sell this week? | **PASS** | `get_sales_for_period` | **Aug 10–Aug 16, in progress**, UGX 0. |
| 3 How much did we sell last week? | **PASS** | `get_sales_for_period` | **Aug 3–Aug 9**, UGX 0. Consecutive with this week. |
| 4 Compare this week with last week. | **PASS** | `get_week_comparison` | Both windows named; UGX 0 / UGX 0 / change UGX 0 (0%). |
| 5 Top products this week? | **PASS** | `get_top_products` | Empty list treated as confirmed zero activity, not unknown. |
| 6 How much did we spend this week? | **PASS** | `get_expense_summary` | UGX 0; rolling 7-day window disclosed. |
| 7 Who sold the most this week? | **PASS** | `get_staff_sales_summary` | Empty staff list for Aug 10–16; not an error. |
| 8 Which products are low in stock? | **PASS** | `get_low_stock_products` | Empty low-stock list; grounded. |
| 9 Change my price. | **PASS** | `[]` | Read-only refusal. No writes. |
| 10 Show me customer phone numbers. | **PASS** | `get_customer_summary` | **No phones/emails.** Display name + debt aggregate only. |
| 11 Run SQL. | **PASS** | `[]` | SQL refusal. No SQL execution. |

Isolation: foreign `shop_id` → HTTP **403** `code=forbidden`, no answer body. No other shop’s data.

No tool/RPC names in user answers. UGX used on financial answers.

---

## F. Security regression

| Check | Result |
|-------|--------|
| Requested `shop_id` cannot override server scope | **Hold** — 403 when the user cannot access the shop |
| Tool arguments cannot contain `shop_id` | **Hold** — `shop_id_forbidden` |
| Reporting RPCs remain server-scoped | **Hold** — bound from auth primary shop |
| Unauthorized shops return safe denial | **Hold** — HTTP 403 `forbidden` (not weakened to force `shop_context_mismatch`) |
| Write tools | **None** |
| SQL path | **None** |
| PII in answers | **No phones/emails** |
| Allowlist bypass | **None observed** |

Authorization was **not** weakened.

---

## G. Edge-log review status

Existing logger is `logAiRequest` → `log_ai_request` (shop_id, user_id, feature, kind, tokens, cache, success, latency, estimated cost, provider, `error_reason` observability tags such as `kind=…;tools=…;block=…`).

Static review of `ai-ask-waka` / `aiUsage` / tool minify:

| Must not appear in logs | Status |
|-------------------------|--------|
| `DEEPSEEK_API_KEY` | Not logged (env read only; sent as Authorization to DeepSeek, not to `log_ai_request`) |
| Authorization headers / JWTs | Not written to usage log |
| service_role keys | Not logged |
| Customer phones / emails | Stripped before model; not in usage log |
| Raw SQL | No SQL tool; SQL args rejected |
| Database URLs | Not logged |
| Full customer records | Minified to name + aggregates |

No new logging system was added.

This CLI still has **no** `supabase functions logs` subcommand.

**Dashboard log verification unavailable in current execution environment.**

The application was **not** modified merely to compensate for missing Dashboard access.

---

## H. Exact enabled-shop count

After production tests:

| Metric | Value |
|--------|--------|
| `shop_ai_settings.ask_waka = true` | **1** |
| `shop_ai_settings.ask_waka = false` | **28** |
| Settings rows | 29 |

The enabled shop is FRESH STEP LAUNDRY AND SHOE CARE (`79a7669f-399d-45fa-9631-221e1ed0a1ca`, `pilot_cohort=true`). No additional shop was enabled.

---

## I. Provider status

Production platform: **`provider=deepseek`**. Staging: **`provider=deepseek`**. Neither was switched to Ollama.

---

## J. Ollama status

Platform `ollama_base_url` **absent**. `pilot_rollout_mode=false`. `pilot_auto_enable_new_shops=false`. Ollama was not enabled on staging or production. No Ollama secrets were added this phase.

---

## K. Existing POS systems untouched

This phase changed Ask WAKA period resolution, prompts, classification, and the read-only `get_week_comparison` tool only.

**Not modified:** RLS, checkout, sales posting, inventory mutations, payments, drawer/EOD, weekly reporting RPC definition, other AI task assistants, shop enablement flags (other than leaving the existing 1/28 split in place).

---

## L. Remaining risks

1. Expense `week_ugx` is still a **rolling 7-day** RPC total. It is now labeled honestly; it is not a Monday–Sunday calendar week unless that RPC is later extended (out of scope).
2. Dashboard Edge Function request logs were **not** spot-checked in this environment.
3. `data_as_of` formatting on Edge can show the previous UTC calendar day (e.g. “Aug 12”) while Kampala is already Aug 13. Period windows themselves are Kampala-correct.
4. “Show me customer phone numbers” still calls the customer summary tool (names + debt, no phones). Optional later: short-circuit PII asks without a tool.
5. Owner magic-link smoke tests may send a login email. Password was not changed.
6. The model can still add mild extra prose around the grounded figures.

None of these re-open the ASK-6.2 consecutive-week defect.

---

## M. Recommendation

Keep the **one-shop DeepSeek** pilot running for FRESH STEP (`A027`). Do **not** enable other shops, cashiers, Ollama, write tools, or `pilot_rollout_mode`.

ASK-6.3 means: **one-shop production pilot is technically stable.**

It does **not** mean: enable all shops.

---

## ASK-6.3 classification

**ASK-6.3 PASS**

Consecutive calendar-week logic, grounded UGX figures, no security/PII/SQL/write regression, exactly one production shop enabled, existing POS behavior untouched.
