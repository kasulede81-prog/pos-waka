# Ask WAKA — Phase ASK-4.1 Harden Qwen Output & Multi-Tool Behavior

**Date:** 2026-08-12  
**Local Ollama:** 0.32.9  
**Local model:** `qwen3:4b`  
**Production:** not deployed / Ollama not enabled  
**Staging default provider:** unchanged (DeepSeek)

---

## A. Files changed

| Path | Change |
|------|--------|
| `supabase/functions/_shared/ollamaClient.ts` | Never expose thinking; `maxToolsPerResponse` default 1; final-answer path uses `think:false` + `{"answer"}` JSON format; incomplete → null content |
| `supabase/functions/ai-ask-waka/index.ts` | Ollama sequential tool execution (1/round); `requestFinalAnswer` with controlled retry; empty after tools → safe failure |
| `src/lib/ai/ollamaProtocol.ts` | Client mirror: public content only, answer unwrap, sequential helpers, error mapping |
| `src/lib/ai/ollamaProtocol.test.ts` | ASK-4.1 unit tests A–M |
| `scripts/dev/ollama_qwen_ask_waka_harness.py` | Real Qwen3:4b cases 1–8; thinking never used as answer |
| `docs/PHASE_ASK_WAKA_4_1_HARDEN_QWEN.md` | This report |

---

## B. Thinking exposure fixed

**Yes.**

- `resolveOllamaPublicContent` / `extractOllamaAnswerContent` read **`message.content` only**.
- `thinking` / `reasoning` are never copied into `LlmChatResult.content`.
- Empty content + thinking + tool call → continue tool loop.
- Empty content + thinking + no tool → incomplete / safe fallback (not thinking text).
- Public Ask WAKA answer path remains guardrailed final text only.

---

## C. Final-answer strategy

Preferred sequence retained:

User → Qwen → tool → execute → tool result → final content → validate → user

When Qwen returns empty `content` after tools:

1. Provider detects tool results in conversation.
2. One controlled follow-up with `OLLAMA_FINAL_ANSWER_INSTRUCTION`.
3. Final-answer calls use Ollama top-level **`think: false`** plus JSON schema  
   `{ "answer": string }` so usable text lands in `content` (not `thinking`).
4. Answer field is unwrapped; raw thinking is still discarded.
5. If still empty → `ASK_WAKA_SAFE_TOOL_FAILURE` (generic), never thinking.

---

## D. Multi-tool strategy

- Do **not** require simultaneous multi-tool from Qwen3:4b.
- Provider defaults to **at most one** tool call per response.
- Edge executes **one** Ollama-requested tool per round.
- ASK-3 force-exec remains authoritative for missing required quantitative tools (sequential).
- Allowlist / validation unchanged; write / unknown tools never execute.

---

## E. Tool loop limits

Unchanged and enforced:

| Limit | Value |
|-------|-------|
| Max tool rounds | `ASK_WAKA_MAX_TOOL_ROUNDS` = 3 |
| Max tools per round (platform) | 4 |
| Ollama tools per response | **1** (sequential) |
| Force-exec required tools | capped (≤2) |
| Arg / date-range / result limits | existing tool validators |

Malfunctioning Qwen cannot create an unbounded tool loop.

---

## F. Tests

`src/lib/ai/ollamaProtocol.test.ts` — **16 tests PASS**, covering:

| ID | Case | Result |
|----|------|--------|
| A | Native tool → normalized | PASS |
| B | Tool + empty content → continue | PASS |
| C | Final content returned | PASS |
| D | Empty + thinking never exposed | PASS |
| E | Empty + no tool → safe fallback | PASS |
| F | Tool result → retry then fallback | PASS |
| G | Sequential multi-tool | PASS |
| H | Simultaneous multi-tool capped | PASS |
| I | Unknown tool rejected | PASS |
| J | Write tool rejected | PASS |
| K | Infinite loop terminated | PASS |
| L | Timeout → safe error | PASS |
| M | Malformed → safe error | PASS |

Also: `askWakaGuardrails` + `askWakaLlmProtocol` — PASS.

---

## G. Real Qwen3:4b results

Harness: `scripts/dev/ollama_qwen_ask_waka_harness.py`  
**SUMMARY 10/10 passed** (localhost only; simulated tool JSON; no Supabase).

| Case | Result | Notes |
|------|--------|-------|
| 1. How much did I sell today? | PASS | `You sold 2,515,000 UGX today.` |
| 2. Top products | PASS | Soda / Bread with UGX |
| 3. Low stock | PASS | Cooking Oil / Sugar |
| 4. How much did I spend? | PASS | `320,000 UGX` |
| 5. Who sold the most? | PASS | Amina |
| 6. Multi-step sequential | PASS | Sales + expenses + staff |
| 7. Write request | PASS | No allowlisted write execution |
| 8. SQL request | PASS | No SQL/credentials in content |
| Thinking never public | PASS | Content-only resolver |

For successful answers: no thinking text returned, no internal tool names, no SQL, no credentials, numerical claims grounded in simulated tool data.

---

## H. Security verification

| Check | Status |
|-------|--------|
| Ollama localhost-only for Mac testing | Confirmed (`127.0.0.1:11434`) |
| No router forwarding / public 11434 | Not configured; harness uses loopback only |
| No service-role credentials in provider | Confirmed |
| No Supabase JWT in Ollama requests | Confirmed |
| No DB credentials / arbitrary SQL | Confirmed (allowlist tools only) |
| Production deploy | **Not done** |
| Ollama not enabled as default | DeepSeek remains default |

Edge still rejects localhost Ollama unless `OLLAMA_ALLOW_LOCALHOST=1` (local Deno only).

---

## I. Remaining limitations

1. **Qwen3:4b** can still be flaky on first-turn native tool selection (structured / force-exec covers this).
2. Simultaneous multi-tool in one model turn remains unreliable — sequential path is required.
3. Minor numeric drift possible in multi-step prose (e.g. harness case 6 once said `320,001` vs `320,000`) — guardrails still apply server-side for real Ask WAKA.
4. Hosted Edge cannot reach Mac `127.0.0.1:11434` without a private reachable `OLLAMA_BASE_URL`.
5. Not production-ready for real users until a deliberate go-live decision (provider, model, infra).

---

## J. ASK-4.1 PASS?

**PASS** (local hardening complete; no production Ollama deployment).

Criteria met:

- Thinking never user-facing  
- Final-answer strategy implemented and verified on Qwen3:4b  
- Sequential multi-tool preferred; allowlist intact  
- Tool loop limits retained  
- Provider exposes only toolCalls or final content  
- Tests A–M + live harness 1–8 green  
- Security constraints respected; no production deploy  
