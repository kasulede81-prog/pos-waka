import { useEffect, useId, useRef, type ReactNode } from "react";
import clsx from "clsx";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { t } from "../../lib/i18n";
import type { Language } from "../../types";
import { WakaPosLogo } from "../brand/WakaLogo";
import { EnterpriseSpinner } from "../enterprise/EnterpriseSpinner";
import { ReleaseNotes } from "./ReleaseNotes";

/**
 * The DKASU POS update surface — one full-screen, branded screen for every pre-install update
 * state. It is a PRESENTATION/CONTROLLER layer only: every action is a callback into
 * `EnterpriseUpdateEngine` (see `AppReleaseUpdateProvider`), so no update logic lives here.
 *
 * Variants:
 *   flexible  — a new version is available; the merchant may update now or cancel.
 *   mandatory — below the minimum supported version (force_block); no cancel by design.
 *   failure   — the in-app flow could not start; offers Retry and the Play Store listing.
 *   info      — post-install "What's New" (shares the same shell and notes renderer).
 *
 * Layer: `UPDATE_LAYER.fullScreen` (z-[210]) — always above the bottom update banners and above
 * the app, never reusing the ad-hoc 180/185/186/190/200 values the old surfaces used.
 */
export const UPDATE_LAYER = {
  fullScreen: "z-[210]",
  banner: "z-[205]",
} as const;

export type UpdateScreenVariant = "flexible" | "mandatory" | "failure" | "info";

type Props = {
  variant: UpdateScreenVariant;
  lang: Language;
  /** e.g. "1.0.16" — the published version number from the release policy. */
  versionLabel?: string | null;
  /** e.g. "#24" — the Play versionCode, shown when there is no published version number. */
  versionCodeLabel?: string | null;
  releaseName?: string | null;
  notesHtml?: string | null;
  /** False when the release row disables "What's New" for this release. */
  showNotes?: boolean;
  busy?: boolean;
  /** True while the primary action is opening the Play Store rather than Play Core. */
  openingStore?: boolean;
  errorMessage?: string | null;
  fallbackOffered?: boolean;
  /** Flexible only. Absent (and not rendered) for a mandatory update. */
  onCancel?: () => void;
  onUpdate: () => void;
  onRetry?: () => void;
  onOpenPlayStore?: () => void;
  /** `info` only. */
  onContinue?: () => void;
};

function Shell({
  labelledBy,
  children,
}: {
  labelledBy: string;
  children: ReactNode;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      className={clsx(
        "fixed inset-0 flex flex-col bg-background text-foreground",
        UPDATE_LAYER.fullScreen,
      )}
      style={{
        paddingTop: "max(1rem, env(safe-area-inset-top))",
        paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))",
      }}
      data-update-surface
    >
      {children}
    </div>
  );
}

export function UpdateFullScreen({
  variant,
  lang,
  versionLabel,
  versionCodeLabel,
  releaseName,
  notesHtml,
  showNotes = true,
  busy = false,
  openingStore = false,
  errorMessage,
  fallbackOffered = false,
  onCancel,
  onUpdate,
  onRetry,
  onOpenPlayStore,
  onContinue,
}: Props) {
  const titleId = useId();
  const primaryRef = useRef<HTMLButtonElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  // Focus moves into the surface when it opens and back to where it was when it closes, so the
  // screen never behaves like an unlabelled pile of divs for keyboard / TalkBack users.
  useEffect(() => {
    returnFocusRef.current = (document.activeElement as HTMLElement | null) ?? null;
    const id = window.setTimeout(() => primaryRef.current?.focus(), 60);
    return () => {
      window.clearTimeout(id);
      returnFocusRef.current?.focus?.();
    };
  }, []);

  const mandatory = variant === "mandatory";
  const failure = variant === "failure";
  const info = variant === "info";

  const eyebrow = info
    ? t(lang, "updateWhatsNewTitle")
    : mandatory
      ? t(lang, "updateRequiredTitle")
      : failure
        ? t(lang, "updateFailedTitle")
        : t(lang, "updateAvailableTitle");

  const headline = info
    ? t(lang, "updateWhatsNewTitle")
    : mandatory
      ? t(lang, "updateRequiredTitle")
      : failure
        ? t(lang, "updateFailedTitle")
        : t(lang, "updateAvailableTitle");

  const message = info
    ? t(lang, "updateWhatsNewBody")
    : mandatory
      ? t(lang, "updateRequiredWhy")
      : failure
        ? t(lang, "updateFailedBody")
        : t(lang, "updateAvailableBody");

  const versionLine = versionLabel
    ? t(lang, "updateWhatsNewVersion").replace("{version}", versionLabel)
    : versionCodeLabel
      ? versionCodeLabel
      : null;

  const primaryLabel = info
    ? t(lang, "updateContinue")
    : failure
      ? t(lang, "updateRetry")
      : busy && openingStore
        ? t(lang, "updateOpeningPlayStore")
        : t(lang, "updateFromGooglePlay");

  const onPrimary = info ? onContinue ?? onUpdate : failure ? onRetry ?? onUpdate : onUpdate;

  return (
    <Shell labelledBy={titleId}>
      {/* Brand header — fixed, never scrolls away */}
      <header className="flex shrink-0 flex-col items-center gap-2 px-5 pt-2 text-center">
        <WakaPosLogo size="sm" className="max-w-[190px]" />
        <p className="text-[11px] font-black uppercase tracking-[0.22em] text-muted-foreground">
          DKASU POS
        </p>
        <span
          className={clsx(
            "mt-1 inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-wide",
            mandatory
              ? "bg-danger-muted text-danger"
              : failure
                ? "bg-danger-muted text-danger"
                : "bg-business-muted text-waka-800 dark:text-waka-200",
          )}
        >
          {!info && !failure ? null : <AlertTriangle aria-hidden className="h-3.5 w-3.5" />}
          {eyebrow}
        </span>
      </header>

      {/* Scrollable body — long release notes scroll here, the actions never leave the screen */}
      <div className="mt-4 min-h-0 flex-1 overflow-y-auto overscroll-contain px-5">
        <div className="mx-auto w-full max-w-xl space-y-5 pb-6">
          <div className="space-y-1 text-center">
            <h1 id={titleId} className="text-2xl font-black leading-tight text-foreground">
              {headline}
            </h1>
            <p className="text-sm font-medium leading-relaxed text-muted-foreground">{message}</p>
            {mandatory && versionLine ? (
              <p className="text-sm font-bold text-foreground">{versionLine}</p>
            ) : null}
          </div>

          {failure ? (
            <div className="rounded-2xl border border-danger/40 bg-danger-muted px-4 py-3">
              <p className="text-sm font-semibold text-foreground">
                {t(lang, "updatePlayCoreFailedBody")}
              </p>
              {errorMessage ? (
                <p className="mt-1 break-words text-xs font-medium text-muted-foreground">
                  {errorMessage}
                </p>
              ) : null}
            </div>
          ) : null}

          {!info && !failure ? (
            <div className="rounded-2xl border border-border bg-card px-4 py-3 text-center">
              {versionLine ? (
                <p className="text-base font-black text-foreground">{versionLine}</p>
              ) : null}
              {releaseName ? (
                <p className="mt-0.5 text-sm font-semibold text-muted-foreground">{releaseName}</p>
              ) : null}
            </div>
          ) : null}

          {!failure ? (
            <section aria-label={t(lang, "updateWhatsNewTitle")} className="space-y-3">
              <h2 className="text-xs font-black uppercase tracking-[0.16em] text-muted-foreground">
                {t(lang, "updateWhatsNewTitle")}
              </h2>
              <ReleaseNotes
                html={showNotes ? notesHtml : null}
                emptyLabel={t(lang, "updateWhatsNewEmpty")}
              />
            </section>
          ) : null}
        </div>
      </div>

      {/* Sticky action area — always reachable, safe-area aware */}
      <footer className="shrink-0 border-t border-border bg-background/95 px-5 pt-4 backdrop-blur">
        <div className="mx-auto w-full max-w-xl space-y-2">
          <button
            ref={primaryRef}
            type="button"
            onClick={onPrimary}
            disabled={busy}
            aria-busy={busy}
            className={clsx(
              "flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-waka-700 px-4 text-base font-black text-white shadow-sm transition active:bg-waka-800",
              "disabled:cursor-not-allowed disabled:opacity-60",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            )}
          >
            {busy ? <EnterpriseSpinner size="sm" label={primaryLabel} className="text-white" /> : null}
            <span>{primaryLabel}</span>
          </button>

          {failure && onOpenPlayStore ? (
            <button
              type="button"
              onClick={onOpenPlayStore}
              disabled={busy}
              className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl border border-border px-4 text-sm font-bold text-foreground transition active:bg-muted disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <RefreshCw aria-hidden className="h-4 w-4" />
              {t(lang, "updateOpenPlayStore")}
            </button>
          ) : null}

          {!failure && !info && fallbackOffered && onOpenPlayStore ? (
            <button
              type="button"
              onClick={onOpenPlayStore}
              disabled={busy}
              className="flex min-h-[48px] w-full items-center justify-center rounded-2xl border border-border px-4 text-sm font-bold text-foreground transition active:bg-muted disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t(lang, "updateOpenPlayStore")}
            </button>
          ) : null}

          {!mandatory && !info && !failure && onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="flex min-h-[48px] w-full items-center justify-center rounded-2xl border border-border bg-card px-4 text-sm font-bold text-foreground transition active:bg-muted disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t(lang, "updateCancel")}
            </button>
          ) : null}
        </div>
      </footer>
    </Shell>
  );
}
