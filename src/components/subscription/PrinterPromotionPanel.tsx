import { useCallback, useEffect, useState } from "react";
import { Printer, Store, MessageCircle, CheckCircle2, Clock, AlertTriangle } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { wakaSupportWhatsAppUrl } from "../../config/company";
import { Link } from "react-router-dom";
import {
  ASSIGNMENT_STATUS_LABELS,
  ELIGIBILITY_REASON_LABELS,
  fetchMyOrgPrinterStatus,
  requestPrinterCollection,
  type CustomerPrinterStatus,
} from "../../lib/printerFulfilment";

/**
 * The free WP-58 printer, as the MERCHANT sees it.
 *
 * WHAT THIS IS. A read of the merchant's own account — eligibility, whatever
 * claim they hold, and any collection request they have made — plus the two
 * real ways to ask for the printer. Every value comes from
 * `my_org_printer_status()`, whose verdict is delegated to the same predicate
 * the reservation desk uses.
 *
 * WHAT IT IS DELIBERATELY NOT.
 *   * It invents nothing. With no server answer it says so; it never shows a
 *     status, a serial or a success it has not been told.
 *   * A request here is NOT a reservation. It records the ask and the desk
 *     allocates a real unit; the copy says so rather than implying a printer is
 *     already held.
 *   * Failure is an error state, not an empty one. "We could not check" must
 *     never look like "you do not qualify".
 */

type Props = {
  lang: Language;
  shopId: string;
};

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function PrinterPromotionPanel({ lang, shopId }: Props) {
  const [status, setStatus] = useState<CustomerPrinterStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetchMyOrgPrinterStatus({ shopId });
    if (res.ok) {
      setStatus(res.data);
      setError(null);
    } else {
      // Keep the last good value; never fall back to a fabricated one.
      setError(res.error);
    }
    setLoading(false);
  }, [shopId]);

  useEffect(() => {
    void load();
  }, [load]);

  const ask = async (channel: "branch" | "whatsapp") => {
    setAsking(true);
    setNotice(null);
    const res = await requestPrinterCollection({ shopId, channel });
    if (res.ok) {
      setNotice(t(lang, res.data.alreadyOpen ? "printerRequestAlreadyOpen" : "printerRequestRecorded"));
      await load();
    } else {
      setNotice(res.error);
    }
    setAsking(false);
  };

  const claim = status?.open_claim ?? null;
  const card = "rounded-2xl border border-border bg-card p-4 shadow-sm";

  if (loading && !status) {
    return (
      <article className={card}>
        <p className="text-sm text-muted-foreground">{t(lang, "printerChecking")}</p>
      </article>
    );
  }

  // A failed read is an ERROR, never a quiet "not eligible".
  if (error && !status) {
    return (
      <article className={card}>
        <p role="alert" className="text-sm font-semibold text-destructive">
          {t(lang, "printerStatusUnavailable")}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{error}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-3 min-h-[44px] rounded-2xl bg-card px-4 text-sm font-black text-waka-800 ring-1 ring-border"
        >
          {t(lang, "printerRetry")}
        </button>
      </article>
    );
  }

  return (
    <article className={card}>
      <div className="flex items-center gap-2">
        <Printer className="h-4 w-4 text-waka-600" />
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
          {t(lang, "printerPanelTitle")}
        </p>
      </div>
      <p className="mt-1 text-sm font-semibold text-muted-foreground">{t(lang, "printerPanelSub")}</p>

      {error && status ? (
        <p role="alert" className="mt-2 text-xs font-semibold text-amber-800">
          {t(lang, "printerStatusStale")}
        </p>
      ) : null}

      {/* --- a printer already held -------------------------------------- */}
      {claim ? (
        <div className="mt-3 rounded-xl bg-muted px-3 py-3">
          <p className="flex items-center gap-1.5 text-sm font-black text-foreground">
            {claim.status === "handed_over" ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            ) : (
              <Clock className="h-4 w-4 text-amber-600" />
            )}
            {ASSIGNMENT_STATUS_LABELS[claim.status] ?? claim.status}
          </p>
          {claim.serial_number ? (
            <p className="mt-1 text-sm font-semibold">
              {t(lang, "printerSerial")}: <span className="font-mono">{claim.serial_number}</span>
            </p>
          ) : null}
          {claim.status === "handed_over" ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {t(lang, "printerHandedOverOn")} {fmtDate(claim.handed_over_at)}
            </p>
          ) : claim.reserved_until ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {t(lang, "printerHoldUntil")} {fmtDate(claim.reserved_until)}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* --- what happens next ------------------------------------------- */}
      {claim ? null : status?.can_request ? (
        <>
          <p className="mt-3 text-sm font-semibold text-foreground">{t(lang, "printerEligible")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t(lang, "printerRequestExplainer")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={asking}
              onClick={() => void ask("branch")}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-2xl bg-waka-600 px-4 text-sm font-black text-white disabled:opacity-60"
            >
              <Store className="h-4 w-4" />
              {t(lang, "printerAskBranch")}
            </button>
            <a
              href={wakaSupportWhatsAppUrl(
                "Hello DKASU, I would like to collect the free WP-58 printer with my Business annual plan.",
              )}
              target="_blank"
              rel="noreferrer"
              onClick={() => void ask("whatsapp")}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-2xl bg-card px-4 text-sm font-black text-waka-800 ring-1 ring-border"
            >
              <MessageCircle className="h-4 w-4" />
              {t(lang, "printerAskWhatsApp")}
            </a>
          </div>
        </>
      ) : status && !status.eligible ? (
        /*
          AN INELIGIBLE ACCOUNT STILL SEES THE WHOLE OFFER. The section is never
          hidden for a refusal — the merchant is told the server's own reason,
          given the way to fix it (the offer page, and the in-app upgrade), and
          keeps the setup/collection link that is always rendered below.
          (A bare block comment, not `{/* *\/}`: this is a JS expression position.)
        */
        <div className="mt-3 rounded-xl bg-muted px-3 py-3">
          <p className="flex items-start gap-1.5 text-sm font-semibold text-foreground">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            {ELIGIBILITY_REASON_LABELS[status.reason ?? ""] ?? t(lang, "printerNotEligible")}
          </p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            <Link
              to="/business-printer"
              className="inline-flex min-h-[44px] items-center text-sm font-black text-waka-700 underline underline-offset-2"
            >
              {t(lang, "printerSeeOffer")}
            </Link>
            <Link
              to="/upgrade"
              className="inline-flex min-h-[44px] items-center text-sm font-black text-waka-700 underline underline-offset-2"
            >
              {t(lang, "printerSeeBusinessAnnual")}
            </Link>
          </div>
        </div>
      ) : null}

      {/* --- what the merchant has already asked for --------------------- */}
      {status && status.requests.length > 0 ? (
        <div className="mt-3 border-t border-border pt-3">
          <p className="text-[10px] font-bold uppercase text-muted-foreground">{t(lang, "printerYourRequests")}</p>
          <ul className="mt-1 space-y-1">
            {status.requests.slice(0, 4).map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-muted-foreground">{fmtDate(r.created_at)}</span>
                <span className="font-bold">
                  {r.channel === "branch" ? t(lang, "printerChannelBranch") : t(lang, "printerChannelWhatsApp")}
                </span>
                <span className="font-black">{t(lang, `printerRequest_${r.status}` as "printerRequest_requested")}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {notice ? (
        <p role="status" className="mt-3 text-xs font-semibold text-waka-800">
          {notice}
        </p>
      ) : null}

      {/*
        ALWAYS RENDERED, IN EVERY STATE. The offer page carries the setup video,
        the branch-pickup steps and the WhatsApp route, so it is the one link a
        merchant needs whatever their eligibility or request state. It is also
        what keeps this section useful to an ineligible account rather than a
        dead end.
      */}
      <p className="mt-3 text-xs font-semibold">
        <Link to="/business-printer" className="text-waka-700 underline underline-offset-2">
          {t(lang, "printerSetupInstructions")}
        </Link>
      </p>

      <p className="mt-2 text-[11px] text-muted-foreground">{t(lang, "printerRequestNotReservation")}</p>
    </article>
  );
}
