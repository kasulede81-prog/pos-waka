# Ask WAKA — Phase ASK-3 Quality, Guardrails & Trust

**Date:** 2026-08-12  
**Scope:** Response quality, numerical tool enforcement, refusals, UI source labels, observability.  
**Production:** not deployed / not enabled.

---

## A. Files changed

| Path | Change |
|------|--------|
| `src/lib/ai/askWakaGuardrails.ts` | New — classify, force-tool state, final guard, UGX/as-of, labels |
| `src/lib/ai/askWakaGuardrails.test.ts` | New — ASK-3 cases A–Q |
| `src/lib/ai/askWakaToolContracts.ts` | Re-export `answerRequiresToolData` from guardrails |
| `supabase/functions/_shared/askWakaGuardrails.ts` | Edge mirror |
| `supabase/functions/_shared/askWakaPrompts.ts` | Stronger BI prompt (UGX, FACT vs RECOMMENDATION, read-only) |
| `supabase/functions/ai-ask-waka/index.ts` | Classify → short-circuit / force tools / final guard / meta tags |
| `src/components/ask-waka/AskWakaPanel.tsx` | Human-readable source labels + clearer errors |
| `src/hooks/useAskWaka.ts` | ESLint fix (no ref during render) |
| `src/lib/i18n.ts` | Error copy keys |
| `docs/PHASE_ASK_WAKA_3_QUALITY_GUARDRAILS.md` | This report |

---

## B. Guardrails implemented

- Question classification: quantitative / write / SQL / out-of-scope / general
- Short-circuit canned refusals (no tools, minimal LLM spend)
- Quantitative required-tool map
- Server force-execute of primary required tools when model skips
- Final answer guard (structured tool success — no fragile number regex)
- Internal tool/RPC name scrubbing
- Data-as-of append for quantitative success

---

## C. Numerical-tool enforcement

| Intent | Required tool(s) |
|--------|------------------|
| Today sales | `get_today_sales` |
| Period sales | `get_sales_for_period` |
| Top products | `get_top_products` |
| Low stock | `get_low_stock_products` |
| Expenses | `get_expense_summary` |
| Staff | `get_staff_sales_summary` |
| … | … |

If required tools missing/fail →  
`I couldn't retrieve the latest POS figures right now.`

Live staging after redeploy: “How much did we sell today?” → `tools_used: ["get_today_sales"]`, answer cites UGX 2,515,000.

---

## D. Prompt improvements

Ask WAKA framed as shop BI assistant: concise, UGX, period/as-of, FACT vs RECOMMENDATION, no invented figures, no internal tool names, read-only, POS-focused scope.

---

## E. UI/source-label improvements

`get_today_sales` → **Today's sales**; `get_inventory_summary` → **Inventory**; etc. via `formatAskWakaToolLabels`.

---

## F. Refusal behavior

| Input | Result |
|-------|--------|
| Change price / refund / delete / adjust stock | Read-only refusal, `tools=[]` |
| SQL / DROP | SQL refusal, `tools=[]` |
| Joke / World Cup / love letter | Out-of-scope, `tools=[]` |

Verified live on staging.

---

## G. Error handling

- Provider failure → logged + generic 502 envelope
- Tool RPC failure → safe fallback when no successful required tools
- Client: offline / timeout / unauthorized / provider friendly strings
- No stack traces / SQL / RPC / keys in user answers (response scan on staging smoke: leak=False)

---

## H. Tests added

`askWakaGuardrails.test.ts` covers A–Q plus write/out-of-scope variants.

---

## I. Full test results

- `tsc -b` → **0**
- ESLint (Ask WAKA touched files) → **0**
- Vitest Ask WAKA suite → **50 passed / 50**

---

## J. Dashboard log review

| Check | Result |
|-------|--------|
| Staging Edge redeployed with ASK-3 | **Yes** (`wdirxwvbgsfzbdurmkbf`) |
| Management API / CLI function logs | **UNKNOWN** — no Supabase access token in this environment; CLI has no `functions logs` |
| Static source review | **PASS** — no `console.log` of keys/JWTs/PII; DeepSeek key only used in Authorization header to DeepSeek; customer phones stripped in tools |
| Live response payload scan | **PASS** — no `sk-` / JWT / service_role in answers |

**Outstanding:** manual Supabase Dashboard → Edge Functions → Logs spot-check before production.

---

## K. Remaining risks

1. Classifier is keyword-heuristic — unusual phrasing may miss required tools (force-exec + final guard mitigate for known categories).
2. Dashboard log review still manual.
3. Migration 147 + Ask WAKA still **not** enabled on production (intentional).
4. Rotate chat-exposed DeepSeek key if not already done.

---

## L. ASK-3 PASS?

**PASS** (with dashboard log review = UNKNOWN / recommended follow-up)

---

## M. Ready for production deployment?

**NO** — not until deliberate production migration 147, Edge deploy, secret hygiene, feature flags, and dashboard log review. ASK-3 quality work is staging-verified only.
