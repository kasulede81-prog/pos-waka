import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../supabaseEdgeInvoke", () => ({
  invokeSupabaseEdgeFunction: vi.fn(),
}));

import { invokeSupabaseEdgeFunction } from "../supabaseEdgeInvoke";
import { askWaka } from "./askWaka";

const invoke = vi.mocked(invokeSupabaseEdgeFunction);

describe("askWaka", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("rejects empty messages without calling the edge", async () => {
    const res = await askWaka({ message: "   " });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errorCode).toBe("invalid_message");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("maps a successful edge payload", async () => {
    invoke.mockResolvedValue({
      ok: true,
      data: {
        success: true,
        answer: "Today sales: UGX 1000",
        tools_used: ["get_today_sales"],
        data_as_of: "2026-08-12T09:00:00.000Z",
        conversation_id: "c1",
        usage: { tokens_in: 10, tokens_out: 5, latency_ms: 100 },
      },
    });

    const res = await askWaka({
      message: "How much did we sell today?",
      shopId: "shop-1",
      conversationId: "c1",
      locale: "en",
    });

    expect(invoke).toHaveBeenCalledWith(
      "ai-ask-waka",
      {
        message: "How much did we sell today?",
        shop_id: "shop-1",
        conversation_id: "c1",
        locale: "en",
      },
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    );
    expect(res).toEqual({
      ok: true,
      answer: "Today sales: UGX 1000",
      tools_used: ["get_today_sales"],
      sources: [],
      data_as_of: "2026-08-12T09:00:00.000Z",
      conversation_id: "c1",
      usage: { tokens_in: 10, tokens_out: 5, latency_ms: 100 },
    });
  });

  it("maps edge failure envelopes", async () => {
    invoke.mockResolvedValue({
      ok: true,
      data: {
        success: false,
        error: "forbidden",
        reason: "shop access denied",
        code: "forbidden",
      },
    });

    const res = await askWaka({ message: "How much did we sell today?" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain("shop access denied");
      expect(res.errorCode).toBeTruthy();
    }
  });
});
