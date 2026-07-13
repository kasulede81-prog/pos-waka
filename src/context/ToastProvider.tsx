import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import clsx from "clsx";
import { t } from "../lib/i18n";
import { statusTokens } from "../lib/statusTokens";
import { enterpriseMotion } from "../lib/enterpriseMotion";
import { enterpriseTypeClass } from "../lib/enterpriseTypography";
import { subscribeSubscriptionNotifications } from "../lib/subscriptionNotifications";
import { readUiLanguageCacheSync } from "../lib/uiLanguage";
import { EnterpriseSpinner } from "../components/enterprise/EnterpriseSpinner";
import type { Language } from "../types";

export type ToastKind = "success" | "warning" | "error" | "offline" | "syncing";

export type ToastInput = {
  kind: ToastKind;
  message: string;
  durationMs?: number;
};

type ToastItem = ToastInput & { id: string };

type ToastContextValue = {
  show: (input: ToastInput) => void;
  success: (message: string) => void;
  warning: (message: string) => void;
  error: (message: string) => void;
  offline: (message?: string) => void;
  syncing: (message?: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION: Record<ToastKind, number> = {
  success: 2800,
  warning: 3600,
  error: 4200,
  offline: 4000,
  syncing: 2200,
};

const SYNC_ISSUE_CODES = new Set([
  "debt_payment_push_failed",
  "debt_payment_rpc_failed",
  "cash_expense_push_failed",
  "sync_flush_error",
]);

function toastStyles(kind: ToastKind): string {
  if (kind === "success") return statusTokens.success.banner;
  if (kind === "warning") return statusTokens.warning.banner;
  if (kind === "offline") return statusTokens.offline.banner;
  if (kind === "syncing") return statusTokens.syncing.banner;
  return statusTokens.danger.banner;
}

function ToastViewport({ items, lang }: { items: ToastItem[]; lang: Language }) {
  if (items.length === 0) return null;
  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-[calc(var(--waka-safe-top,0px)+0.75rem)] z-[200] flex flex-col items-center gap-2 px-4"
      aria-live="polite"
      aria-relevant="additions"
    >
      {items.map((item) => (
        <div
          key={item.id}
          role="status"
          className={clsx(
            "pointer-events-auto max-w-md rounded-2xl px-4 py-3 shadow-lg",
            enterpriseMotion.toastEnter,
            toastStyles(item.kind),
          )}
        >
          {item.kind === "syncing" ? (
            <span className={clsx("inline-flex items-center gap-2", enterpriseTypeClass("body", "!font-semibold"))}>
              <EnterpriseSpinner size="sm" label={t(lang, "notifySyncing")} />
              {item.message || t(lang, "notifySyncing")}
            </span>
          ) : (
            <span className={enterpriseTypeClass("body", "!font-semibold")}>{item.message}</span>
          )}
        </div>
      ))}
    </div>
  );
}

export function ToastProvider({ children, lang: langProp }: { children: ReactNode; lang?: Language }) {
  const lang = langProp ?? readUiLanguageCacheSync() ?? "en";
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef<Map<string, number>>(new Map());

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) window.clearTimeout(timer);
    timers.current.delete(id);
    setItems((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const show = useCallback(
    (input: ToastInput) => {
      const id = crypto.randomUUID();
      const duration = input.durationMs ?? DEFAULT_DURATION[input.kind];
      setItems((prev) => [...prev.slice(-4), { ...input, id }]);
      const timer = window.setTimeout(() => dismiss(id), duration);
      timers.current.set(id, timer);
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      show,
      success: (message) => show({ kind: "success", message }),
      warning: (message) => show({ kind: "warning", message }),
      error: (message) => show({ kind: "error", message }),
      offline: (message) => show({ kind: "offline", message: message || t(lang, "notifyOffline") }),
      syncing: (message) => show({ kind: "syncing", message: message || t(lang, "notifySyncing") }),
    }),
    [show, lang],
  );

  useEffect(() => {
    const onSyncIssue = (ev: Event) => {
      const detail = (ev as CustomEvent<{ code?: string }>).detail;
      const code = detail?.code ?? "";
      if (!SYNC_ISSUE_CODES.has(code)) return;
      show({ kind: "warning", message: t(lang, "notifySyncFailed") });
    };
    window.addEventListener("waka:sync-issue", onSyncIssue);
    return () => window.removeEventListener("waka:sync-issue", onSyncIssue);
  }, [show, lang]);

  useEffect(() => {
    return subscribeSubscriptionNotifications((payload) => {
      const kind =
        payload.kind === "subscription_expired" || payload.kind === "subscription_cancelled"
          ? "warning"
          : payload.kind === "grace_period" || payload.kind === "trial_ending"
            ? "warning"
            : "success";
      show({ kind, message: payload.message });
    });
  }, [show]);

  useEffect(() => {
    return () => {
      for (const timer of timers.current.values()) window.clearTimeout(timer);
      timers.current.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport items={items} lang={lang} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return ctx;
}
