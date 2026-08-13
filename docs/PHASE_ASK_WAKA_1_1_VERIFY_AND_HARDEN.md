# Ask WAKA — Phase ASK-1.1 Verify and Harden

**Date:** 2026-08-12  
**Mode:** Security/implementation review of ASK-1 git diff + hardening  
**No UI / Ollama / write actions / POS engine changes**

---

## A. Security review result

**CONDITIONAL GO for ASK-2** after hardening applied in this phase.

Core controls (auth, shop binding, feature gate, allowlisted read-only tools, no SQL, usage logging) are present and were strengthened. Remaining items are deployment/ops prerequisites and residual product limitations (see J).

---

## Checklist (verified against code)

| Control | Result |
|---------|--------|
| Authenticated user required | PASS — Bearer + `auth.getUser()` |
| Shop resolved server-side | PASS — `waka_primary_shop_for_user` + membership/access |
| Request `shop_id` cannot override scope | PASS — hint only; mismatch → `shop_context_mismatch` |
| `user_can_access_shop` enforced | PASS — hint path + **post-resolve mandatory check (ASK-1.1)** |
| `assertAiFeatureAllowed` | PASS — includes platform/shop flags + budgets |
| Service role never to browser/model | PASS — edge-only `admin` client |
| No arbitrary SQL | PASS — no SQL path; SQL-like args rejected |
| No arbitrary RPC | PASS — fixed RPC names in switch |
| Tool allowlist | PASS |
| Arg validation / limits / date span | PASS |
| Customer PII minimized | PASS — name + aggregates only (ids stripped in ASK-1.1) |
| No write tools | PASS |
| Unknown tools rejected | PASS — validate + fallback drop |
| Model cannot execute code | PASS — only allowlisted tool executor |

---

## Migration 146

- `shop_get_staff_sales_summary`: `STABLE`, `SECURITY DEFINER`, `search_path = public`, shop via `_report_assert_shop()` (no model shop_id param)
- Grants: revoke public; grant `authenticated` — matches reporting RPCs
- Read-only `SELECT` aggregates on `sales`; no writes
- Does not alter sales/inventory/payment logic
- RPC may return `staff_key` as `created_by` text; **edge now redacts to `staff_label`** before model

---

## Reporting RPC contract match (verified)

| Tool | RPC | Params used | Match |
|------|-----|-------------|-------|
| today | `shop_get_daily_sales_summary` | `p_day` | YES (080) |
| period week | `shop_get_weekly_sales_summary` | `p_anchor_day` | YES |
| period month | `shop_get_monthly_sales_summary` | `p_month` | YES |
| top/slow | `shop_get_top_products` | `p_start_day,p_end_day,p_limit,p_order` | YES |
| inventory/low | `shop_get_inventory_insights` | (none) | YES |
| expenses | `shop_get_cash_expense_insights` | (none) | YES |
| customers | `shop_get_customer_insights` | `p_start_day,p_end_day,p_limit` | YES |
| staff | `shop_get_staff_sales_summary` | `p_start_day,p_end_day,p_limit` | YES (146) |

`user_can_access_shop` param name: `p_shop` — matches edge calls.

---

## DeepSeek tool-calling

| Item | Finding |
|------|---------|
| Request payload | `model`, `messages`, `temperature`, `max_tokens`, optional `tools` + `tool_choice: auto` |
| Native tools in this impl | Requested when tools offered; responses parsed from `message.tool_calls` |
| Live DeepSeek success | **UNKNOWN** (not exercised against a live key in ASK-1.1) |
| Fallback | JSON `tool_requests` / `tool_calls` — **allowlist-only**; ignored when tools not offered |
| Malformed tool JSON args | → `__invalid_json` → tool error, no execution |
| Multiple rounds | Up to 3 rounds × 4 tools; closing call has **no tools** |

---

## Hardening changes (ASK-1.1)

1. Mandatory `user_can_access_shop(shopId)` after shop resolve  
2. Structured/native tool parse: allowlist filter; fallback only when tools offered  
3. Ignore JSON answers that only have `answer` (no tool arrays)  
4. Customer `customer_id` stripped from model payload  
5. Staff UUIDs not forwarded — opaque `staff_label`  
6. Added `askWakaLlmProtocol` tests for fallback safety  

---

## Production prerequisites (before deploy)

1. Apply migration `146_ask_waka.sql`  
2. Deploy `ai-ask-waka` (+ shared deps) via `npm run supabase:deploy:ai`  
3. Enable platform AI + `ask_waka` + shop `ask_waka` in Internal Admin  
4. Confirm `DEEPSEEK_API_KEY` set on Edge secrets  
5. Staging smoke with a **non-production** test user JWT  
6. ASK-2 UI still required for end-user access  

---

## Known residual risks

- Multi-shop: primary shop only (`shop_context_mismatch` otherwise)  
- `_report_assert_shop` membership model matches existing Reports (org-only without `shop_members` may fail RPCs)  
- Model may still **hallucinate numbers** if it answers without tools — prompt/policy mitigates; not cryptographically enforced  
- Live DeepSeek tool-calling behavior: **UNKNOWN** until staging smoke  
