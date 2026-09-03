import { useEffect, useRef, useState } from "react";
import { MessageCircle, Send, Sparkles } from "lucide-react";
import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { formatAiErrorMessage } from "../../lib/ai/aiErrors";
import { formatAskWakaToolLabels } from "../../lib/ai/askWakaGuardrails";
import { formatAskWakaSourceCitation } from "../../lib/ai/askWakaKnowledge";
import { useAskWaka } from "../../hooks/useAskWaka";
import { WakaButton } from "../ui/wakaPrimitives";
import { enterpriseTypeClass } from "../../lib/enterpriseTypography";
import { Caption } from "../enterprise/EnterpriseTypography";

const SUGGESTION_KEYS = [
  "askWakaSuggestTodaySales",
  "askWakaSuggestWhatIsWaka",
  "askWakaSuggestLowStock",
  "askWakaSuggestExpenses",
] as const;

type Props = {
  lang: Language;
  /** When false, render as page body (no outer card chrome assumed by parent). */
  embedded?: boolean;
};

export function AskWakaPanel({ lang, embedded = false }: Props) {
  const locale = lang === "lg" ? "lg" : "en";
  const {
    enabled,
    gateLoading,
    gateReason,
    gateCode,
    messages,
    sending,
    error,
    errorCode,
    send,
    reset,
  } = useAskWaka({ locale });
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages, sending]);

  const submit = () => {
    const text = draft.trim();
    if (!text || sending) return;
    setDraft("");
    void send(text);
  };

  if (gateLoading) {
    return (
      <div className={embedded ? "p-4" : "rounded-2xl border border-border bg-card p-4"}>
        <p className="text-sm font-semibold text-muted-foreground">{t(lang, "askWakaLoadingGate")}</p>
      </div>
    );
  }

  if (!enabled) {
    return (
      <div className={embedded ? "p-4" : "rounded-2xl border border-border bg-card p-4"}>
        <p className={enterpriseTypeClass("body", "font-bold")}>{t(lang, "askWakaDisabledTitle")}</p>
        <p className="mt-2 text-sm font-semibold text-muted-foreground">
          {formatAiErrorMessage({ code: gateCode, detail: gateReason })}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">{t(lang, "askWakaDisabledHint")}</p>
      </div>
    );
  }

  return (
    <div className={embedded ? "flex min-h-0 flex-1 flex-col" : "flex min-h-[60dvh] flex-col rounded-2xl border border-border bg-card"}>
      <div className="flex items-start gap-3 border-b border-border px-4 py-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-waka-600 text-white">
          <Sparkles className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className={enterpriseTypeClass("body", "!font-black")}>{t(lang, "askWakaTitle")}</p>
          <Caption className="mt-0.5 normal-case">{t(lang, "askWakaSubtitle")}</Caption>
        </div>
        {messages.length > 0 ? (
          <WakaButton type="button" variant="ghost" className="!min-h-9 shrink-0 px-2 text-xs" onClick={reset}>
            {t(lang, "askWakaNewChat")}
          </WakaButton>
        ) : null}
      </div>

      {offline ? (
        <p className="mx-4 mt-3 rounded-xl bg-warning-muted px-3 py-2 text-sm font-semibold text-warning-foreground">
          {t(lang, "askWakaOffline")}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {messages.length === 0 ? (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-xl bg-muted/70 px-3 py-3">
              <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <p className="text-sm font-semibold text-muted-foreground">{t(lang, "askWakaEmptyHint")}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {SUGGESTION_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  disabled={sending || offline}
                  onClick={() => void send(t(lang, key))}
                  className="rounded-full border border-border bg-background px-3 py-1.5 text-left text-xs font-bold text-foreground transition active:scale-[0.99] disabled:opacity-50"
                >
                  {t(lang, key)}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {messages.map((m) => (
          <div
            key={m.id}
            className={
              m.role === "user"
                ? "ml-8 rounded-2xl bg-waka-600 px-3 py-2 text-sm font-semibold text-white"
                : m.error
                  ? "mr-4 rounded-2xl bg-warning-muted px-3 py-2 text-sm font-semibold text-warning-foreground"
                  : "mr-4 rounded-2xl bg-muted px-3 py-2 text-sm font-semibold text-foreground"
            }
          >
            <p className="whitespace-pre-wrap break-words">{m.content}</p>
            {m.role === "assistant" && !m.error && m.sources && m.sources.length > 0 ? (
              <Caption className="mt-2 normal-case opacity-80">
                {t(lang, "askWakaSourcesHeading")}
                {m.sources.slice(0, 6).map((s, i) => (
                  <span key={s.chunk_id ?? `${s.type}-${i}`} className="block font-semibold">
                    {formatAskWakaSourceCitation(s)}
                  </span>
                ))}
              </Caption>
            ) : null}
            {m.role === "assistant" && !m.error && (m.data_as_of || (m.tools_used && m.tools_used.length > 0)) ? (
              <Caption className="mt-2 normal-case opacity-80">
                {m.data_as_of
                  ? tTemplate(lang, "askWakaAsOf", { when: new Date(m.data_as_of).toLocaleString() })
                  : null}
                {m.tools_used && m.tools_used.length > 0
                  ? `${m.data_as_of ? " · " : ""}${tTemplate(lang, "askWakaToolsUsed", {
                      tools: formatAskWakaToolLabels(m.tools_used).join(", "),
                    })}`
                  : null}
              </Caption>
            ) : null}
          </div>
        ))}

        {sending ? (
          <p className="mr-4 rounded-2xl bg-waka-50 px-3 py-2 text-sm font-bold text-waka-800">
            {t(lang, "askWakaThinking")}
          </p>
        ) : null}

        {error && !sending ? (
          <p className="rounded-xl bg-warning-muted px-3 py-2 text-sm font-semibold text-warning-foreground">
            {errorCode === "offline"
              ? t(lang, "askWakaOffline")
              : errorCode === "timeout"
                ? t(lang, "askWakaErrorTimeout")
                : errorCode === "forbidden" || errorCode === "unauthorized"
                  ? t(lang, "askWakaErrorUnauthorized")
                  : errorCode === "ai_provider_failed" || errorCode === "deepseek_not_configured"
                    ? t(lang, "askWakaErrorProvider")
                    : formatAiErrorMessage({ code: errorCode, detail: error })}
          </p>
        ) : null}

        <div ref={bottomRef} />
      </div>

      <div className="border-t border-border p-3">
        <div className="flex items-end gap-2">
          <label className="min-w-0 flex-1">
            <span className="sr-only">{t(lang, "askWakaInputLabel")}</span>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              rows={2}
              maxLength={2000}
              disabled={sending || offline}
              placeholder={t(lang, "askWakaInputPlaceholder")}
              className="min-h-[52px] w-full resize-none rounded-xl border-2 border-border bg-background px-3 py-2 text-sm font-semibold outline-none ring-waka-300 focus:ring disabled:opacity-60"
            />
          </label>
          <WakaButton
            type="button"
            variant="primary"
            className="!min-h-[52px] !min-w-[52px] shrink-0 !px-0"
            disabled={sending || offline || !draft.trim()}
            onClick={submit}
            aria-label={t(lang, "askWakaSend")}
          >
            <Send className="h-5 w-5" aria-hidden />
          </WakaButton>
        </div>
        <Caption className="mt-1.5 normal-case">{t(lang, "askWakaReadOnlyNote")}</Caption>
      </div>
    </div>
  );
}
