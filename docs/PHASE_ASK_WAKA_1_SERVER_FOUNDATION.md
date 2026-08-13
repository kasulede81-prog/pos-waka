# Ask WAKA — Phase ASK-1 Server Foundation

**Date:** 2026-08-12  
**Scope:** Secure READ-ONLY server foundation. No UI, no Ollama, no write actions.

---

## Architecture

```text
Client (future ASK-2)
  → Edge: ai-ask-waka
      1. JWT auth.getUser()
      2. Resolve + verify shop (primary reporting context)
      3. assertAiFeatureAllowed("ask_waka")
      4. LLM provider (DeepSeek via llmProvider abstraction)
      5. Allowlisted tools → existing shop_* reporting RPCs (+ staff summary)
      6. log_ai_request / ai_generation_usage_log
```

Shop scope is bound server-side. The model never receives DB credentials, service-role keys, or arbitrary SQL.

---

## Available tools (READ-ONLY)

| Tool | Backend |
|------|---------|
| `get_today_sales` | `shop_get_daily_sales_summary` |
| `get_sales_for_period` | `shop_get_weekly_sales_summary` / `shop_get_monthly_sales_summary` |
| `get_top_products` | `shop_get_top_products` (order=top) |
| `get_slow_products` | `shop_get_top_products` (order=slow) |
| `get_inventory_summary` | `shop_get_inventory_insights` |
| `get_low_stock_products` | `shop_get_inventory_insights` (low_stock slice) |
| `get_expense_summary` | `shop_get_cash_expense_insights` |
| `get_customer_summary` | `shop_get_customer_insights` (PII-minimized) |
| `get_staff_sales_summary` | `shop_get_staff_sales_summary` (new, migration 146) |

Limits: max 20 rows, max 92-day spans, max 3 tool rounds, message ≤ 2000 chars.

---

## Shop scoping

1. Request `shop_id` is a **hint only**.
2. Server resolves `waka_primary_shop_for_user()` (same as reporting RPCs).
3. Membership / `user_can_access_shop` is verified independently.
4. If preferred `shop_id` ≠ primary → `shop_context_mismatch` (ASK-1 limitation).
5. Tool args cannot include `shop_id`; unknown tools / SQL-like args are rejected.

---

## Security model

- Feature gate: platform `ask_waka` + shop `ask_waka` + budgets via `check_ai_feature_allowed`
- No write tools in allowlist
- Aggregates only; customer phone/email stripped
- Service role used only for entitlement/usage logging — not exposed to client
- Reporting RPCs execute under the **user JWT** (`auth.uid()`)

---

## Provider behavior

| Item | Status |
|------|--------|
| Existing `deepseekClient.ts` | JSON task helpers only — **no** native tool calling |
| DeepSeek API docs | Describe OpenAI-compatible `tools` / function calling |
| Ask WAKA ASK-1 | Uses `_shared/llmProvider.ts` → `DeepSeekChatProvider` with `tools` |
| Structured fallback | JSON `{ tool_requests: [...] }` parsed then allowlist-validated |
| Live DeepSeek tool-calling | **NOT VERIFIED** against a running API key in this phase |
| Ollama / Qwen | Interface reserved; `createLlmChatProvider` throws `provider_not_implemented` |

Tool layer does not depend on DeepSeek; future providers only need to implement `LlmChatProvider`.

---

## Known limitations

- No Ask WAKA UI (ASK-2)
- Online-only; uses cloud reporting RPCs
- Multi-shop: only primary shop reporting context
- Staff keys are `sales.created_by` (UUID when synced); local `staff:*` ids may collapse to owner on push
- `assertAiFeatureAllowed` still requires platform provider `deepseek` (Ollama needs a later guard change)

---

## Deploy / test

```bash
# Apply migration 146 (ask_waka flags + staff RPC)
supabase db push   # or your usual migration apply path

# Deploy AI functions (includes ai-ask-waka)
npm run supabase:deploy:ai

# Unit tests (tool contracts / security)
npx vitest run src/lib/ai/askWakaToolContracts.test.ts src/lib/ai/canUseAi.test.ts src/lib/ai/shopAiSettings.test.ts

# Manual smoke (after enable platform+shop ask_waka)
curl -X POST "$SUPABASE_URL/functions/v1/ai-ask-waka" \
  -H "Authorization: Bearer $USER_JWT" \
  -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"message":"How were sales today?"}'
```

Enable in Internal Admin → AI settings (`ask_waka`) and per-shop AI panel.

---

## Response contract

```json
{
  "success": true,
  "ok": true,
  "answer": "...",
  "tools_used": ["get_today_sales"],
  "data_as_of": "2026-08-12T...",
  "usage": { "tokens_in": 0, "tokens_out": 0, "latency_ms": 0 }
}
```

Errors use existing `aiBlocked` / `aiFailure` envelopes.
