import { useCallback, useRef, useState } from "react";
import { askWaka, type AskWakaLocale, type AskWakaUsage } from "../lib/ai/askWaka";
import { useAiFeatureGate } from "./useAiFeatureGate";

export type AskWakaChatRole = "user" | "assistant";

export type AskWakaChatMessage = {
  id: string;
  role: AskWakaChatRole;
  content: string;
  tools_used?: string[];
  data_as_of?: string | null;
  usage?: AskWakaUsage | null;
  error?: boolean;
};

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `ask_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function useAskWaka(opts?: { locale?: AskWakaLocale | null }) {
  const gate = useAiFeatureGate("ask_waka");
  const [messages, setMessages] = useState<AskWakaChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const conversationIdRef = useRef<string>(newId());
  const inflightRef = useRef(false);

  const reset = useCallback(() => {
    conversationIdRef.current = newId();
    setMessages([]);
    setError(null);
    setErrorCode(null);
    setSending(false);
    inflightRef.current = false;
  }, []);

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || inflightRef.current) return;

      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        setError("You are offline. Ask WAKA needs an internet connection.");
        setErrorCode("offline");
        return;
      }

      if (!gate.enabled && !gate.loading) {
        setError(gate.reason ?? "Ask WAKA is disabled for this shop.");
        setErrorCode(gate.code ?? "ai_disabled");
        return;
      }

      const userMsg: AskWakaChatMessage = {
        id: newId(),
        role: "user",
        content: text,
      };

      inflightRef.current = true;
      setSending(true);
      setError(null);
      setErrorCode(null);
      setMessages((prev) => [...prev, userMsg]);

      try {
        const result = await askWaka({
          message: text,
          shopId: gate.shopId,
          conversationId: conversationIdRef.current,
          locale: opts?.locale ?? null,
        });

        if (!result.ok) {
          setError(result.error);
          setErrorCode(result.errorCode ?? null);
          setMessages((prev) => [
            ...prev,
            {
              id: newId(),
              role: "assistant",
              content: result.error,
              error: true,
            },
          ]);
          return;
        }

        if (result.conversation_id) {
          conversationIdRef.current = result.conversation_id;
        }

        setMessages((prev) => [
          ...prev,
          {
            id: newId(),
            role: "assistant",
            content: result.answer,
            tools_used: result.tools_used,
            data_as_of: result.data_as_of,
            usage: result.usage,
          },
        ]);
      } finally {
        setSending(false);
        inflightRef.current = false;
      }
    },
    [gate.code, gate.enabled, gate.loading, gate.reason, gate.shopId, opts?.locale],
  );

  return {
    enabled: gate.enabled,
    gateLoading: gate.loading,
    gateReason: gate.reason,
    gateCode: gate.code,
    shopId: gate.shopId,
    messages,
    sending,
    error,
    errorCode,
    send,
    reset,
  };
}
