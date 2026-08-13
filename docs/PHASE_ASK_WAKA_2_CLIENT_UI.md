# Ask WAKA — Phase ASK-2 Client UI

**Date:** 2026-08-12  
**Scope:** Read-only client UI that invokes `ai-ask-waka`. No Ollama, no write actions, no POS engine changes.

---

## What shipped

| Piece | Path |
|-------|------|
| Invoke wrapper | `src/lib/ai/askWaka.ts` |
| Client tests | `src/lib/ai/askWaka.test.ts` |
| Hook | `src/hooks/useAskWaka.ts` |
| Chat panel | `src/components/ask-waka/AskWakaPanel.tsx` |
| Page | `src/pages/AskWakaPage.tsx` |
| Route | `/office/ask-waka` (reports.view + sensitive reports gate) |
| Office Hub entry | Insights section card (only when `useAiFeatureGate("ask_waka")` enabled) |
| Search | `backOfficeSearchCatalog` entry |

---

## Behavior

1. Gate via `useAiFeatureGate("ask_waka")` (platform + shop).
2. Client sends `{ message, shop_id?, conversation_id?, locale? }` through `invokeSupabaseEdgeFunction`.
3. No SQL, no tool execution, no service-role usage on the client.
4. Empty state with suggestion chips; offline banner; disabled-state copy.
5. Assistant messages show `data_as_of` + tool source names when present.
6. Read-only note under the composer.

---

## Explicitly not in ASK-2

- Production deploy / enabling `ask_waka` on production shops
- Home launcher tile (Office Insights is the entry)
- Streaming responses
- Ollama / local models
- Write tools or action buttons that mutate POS data

---

## How to try (staging)

1. Staging shop with platform + shop `ask_waka` enabled (see ASK-1.2A/B).
2. Sign in as staging test owner.
3. Back office → Insights → **Ask WAKA**, or open `/office/ask-waka`.
4. Ask: “How much did we sell today?”

---

## Follow-ups (ASK-3+)

- Prompt quality / force-tools for numeric claims
- Admin usage metrics surfacing
- Optional Home tile
- Dashboard edge-log spot-check before production enablement
- Apply migration `147` on production before enabling Ask WAKA there
