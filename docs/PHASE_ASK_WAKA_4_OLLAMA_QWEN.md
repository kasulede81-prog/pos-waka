# Ask WAKA — Phase ASK-4 Ollama / Qwen Provider Integration

**Date:** 2026-08-12  
**Local Ollama:** 0.32.9  
**Local model:** `qwen3:4b`  
**Production:** not deployed / Ollama not enabled  
**Staging:** edge code deployed; provider remains **deepseek** by default

---

## A. Provider architecture

```text
Ask WAKA (ai-ask-waka)
  → createLlmChatProvider(provider)
       ├── DeepSeekChatProvider   (default; unchanged behavior)
       └── OllamaChatProvider     (optional)
              → POST {OLLAMA_BASE_URL}/api/chat
              → Qwen3 / compatible models
  → existing allowlisted tool executor (unchanged)
```

Tool validation / shop binding / RPC execution remain outside the provider.

---

## B. Files created/modified

| Path | Change |
|------|--------|
| `supabase/functions/_shared/ollamaClient.ts` | **New** OllamaChatProvider |
| `supabase/functions/_shared/llmProvider.ts` | Wire `ollama` in factory; DeepSeek untouched |
| `supabase/functions/_shared/platformAiSettings.v2.ts` | Optional `ollama_base_url` / `ollama_model`; `llmModelFromSettings` |
| `supabase/functions/ai-ask-waka/index.ts` | Provider/model resolution for deepseek \| ollama |
| `src/lib/ai/platformAiSettings.v2.ts` | Additive ollama config fields; provider option |
| `src/lib/ai/ollamaProtocol.ts` | Testable URL/tool/content helpers |
| `src/lib/ai/ollamaProtocol.test.ts` | Unit tests |
| `scripts/dev/ollama_qwen_ask_waka_harness.py` | Local live harness |
| `scripts/dev/run_ollama_qwen_harness.sh` | Wrapper |
| `docs/PHASE_ASK_WAKA_4_OLLAMA_QWEN.md` | This report |

---

## C. Ollama API behavior verified

Against `http://127.0.0.1:11434` (local only):

| Behavior | Result |
|----------|--------|
| `GET /api/version` | `0.32.9` |
| `POST /api/chat` simple | Works (`content` and/or `thinking`) |
| Native `tools` + `message.tool_calls` | **Works** for single-tool asks (`get_today_sales`) |
| Tool args shape | Object `{}` (normalized to JSON string for Ask WAKA) |
| OpenAI-compatible `/v1/chat/completions` tools | Also returns tool_calls |
| Final prose after tool result | Often **empty `content`**; answer text in `thinking` |
| Structured JSON fallback | **Reliable**: `{"tool_requests":[{"name":"get_today_sales","arguments":{}}]}` in `content` |

**Edge constraint:** localhost is rejected unless `OLLAMA_ALLOW_LOCALHOST=1` (local deno only). Hosted Edge must use a reachable `OLLAMA_BASE_URL`.

---

## D. Qwen3:4b tool calling: **VERIFIED** (with caveats)

**VERIFIED**

- Single native tool call for quantitative sales questions: confirmed repeatedly.
- Structured allowlisted JSON fallback: confirmed.
- Unknown / write tools: dropped by allowlist (never executed).
- Simultaneous multi-tool in one turn: **unreliable / often empty** on qwen3:4b in harness (8/9 cases pass; `E_multi_tool` failed). Sequential tool use + ASK-3 force-exec still covers shop questions.

---

## E. Normalized provider contract

Provider returns existing `LlmChatResult`:

- `toolCalls: [{ id, type:"function", function:{ name, arguments:string } }]` (allowlisted only)
- or `content` final text (`thinking` used as fallback when content empty and no tools)

No Ollama-specific shapes leak into the Ask WAKA executor.

---

## F. Security controls

- Provider never executes tools / SQL
- Same allowlist as DeepSeek path
- No service-role / JWT / DB credentials sent to Ollama
- Localhost base URL blocked for Edge by default
- Browser never gets Ollama URL/secrets (Edge/env/settings server-side only)
- Mac `:11434` not port-forwarded / not exposed

---

## G. Tests

- `tsc -b` → **0**
- ESLint (touched AI files) → **0**
- Vitest Ask WAKA + Ollama protocol → **54 passed**
- Local harness → **8/9** (multi-tool simultaneous flaky)

---

## H. Staging changes

- Deployed `ai-ask-waka` to `wdirxwvbgsfzbdurmkbf` including Ollama provider code
- **Did not** switch staging platform provider to `ollama`
- DeepSeek remains the active staging provider

To try Ollama on a reachable host later (not localhost from Edge):

```bash
# staging secrets / platform settings only — never production
OLLAMA_BASE_URL=https://<reachable-host>
OLLAMA_MODEL=qwen3:4b
# platform provider = ollama (staging only)
```

---

## I. Production changes

**NONE** — no deploy, no flags, no secrets, no Ollama enablement on `ljaedextsenbkxzzgxcg`.

---

## J. Exact local test commands

```bash
# Ensure Ollama is local-only
ollama --version
ollama list   # expect qwen3:4b

# Live harness (127.0.0.1 only)
python3 scripts/dev/ollama_qwen_ask_waka_harness.py

# Unit / type / lint
npx tsc -b
npx vitest run src/lib/ai/ollamaProtocol.test.ts src/lib/ai/askWaka*.test.ts src/lib/ai/shopAiSettings.test.ts --pool=threads --maxWorkers=1
npx eslint src/lib/ai/ollamaProtocol.ts src/lib/ai/platformAiSettings.v2.ts --max-warnings=0
```

---

## K. Blockers / remaining risks

1. **Hosted Edge cannot use Mac localhost** — needs a private reachable Ollama URL for staging Edge Ollama mode.
2. **Qwen3 empty `content`** — provider falls back to `thinking` for finals; UX may include chain-of-thought unless post-processed further.
3. **Multi-tool single turn unreliable** on qwen3:4b — mitigated by ASK-3 force-exec / multi-round loop.
4. Do not enable Ollama in production until a hardened private inference endpoint exists.

---

## Verdict

ASK-4 **PASS** for provider integration + local Qwen tool verification.  
Ollama is available as a second provider; **DeepSeek remains default**. Production untouched.
