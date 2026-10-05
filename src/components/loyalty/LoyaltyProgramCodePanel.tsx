import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { fetchLoyaltyOverview } from "../../lib/loyalty/loyaltyMerchant";
import { buildProgramJoinUrl } from "../../lib/loyalty/loyaltyPublicProgram";
import { EnterpriseSkeletonList } from "../enterprise/EnterpriseSkeleton";

/**
 * The merchant's permanent DKASU Loyalty Code (WPL2026001) and its QR.
 *
 * READ-ONLY on purpose. The code is issued once, server-side, by a trigger on insert; it is
 * immutable, it is never recycled, and no RPC accepts it as an input. There is therefore nothing
 * to edit here and no save button — a merchant can copy it, print it, or put it on a poster, and
 * that is the whole interaction.
 *
 * The QR encodes the same URL the manual entry box posts to (`buildProgramJoinUrl` → `/j/<code>`),
 * so a scan and a typed code cannot diverge.
 *
 * Sibling of `LoyaltyPublicEnrollmentPanel` rather than another section inside it: that panel owns
 * the revocable enrollment LINK (a rotating bearer token), this owns the permanent program CODE (a
 * public identifier). Different lifetimes, different failure modes — keeping them apart stops one
 * being mistaken for the other.
 */
export function LoyaltyProgramCodePanel({
  lang,
  shopId,
  hubPublicCode,
}: {
  lang: Language;
  shopId: string;
  /** Phase 2 P11 — pass the hub's already-loaded publicCode instead of refetching the overview. */
  hubPublicCode?: string | null;
}) {
  const [publicCode, setPublicCode] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(hubPublicCode === undefined);

  const buildQr = useCallback(async (code: string | null) => {
    if (code) {
      const dataUrl = await QRCode.toDataURL(buildProgramJoinUrl(code), { margin: 1, width: 280 });
      setQrDataUrl(dataUrl);
    } else {
      setQrDataUrl(null);
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    const overview = await fetchLoyaltyOverview(shopId);
    const code = overview?.publicCode ?? null;
    setPublicCode(code);
    await buildQr(code);
    setLoading(false);
  }, [shopId, buildQr]);

  useEffect(() => {
    // Reuse the hub's overview when it was passed (P11); otherwise fetch our own.
    if (hubPublicCode !== undefined) {
      setLoading(false);
      setPublicCode(hubPublicCode);
      void buildQr(hubPublicCode);
      return;
    }
    void refresh();
  }, [hubPublicCode, refresh, buildQr]);

  const onCopy = async () => {
    if (!publicCode) return;
    try {
      await navigator.clipboard.writeText(publicCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — the code is on screen to read */
    }
  };

  const onPrint = () => {
    if (!publicCode || !qrDataUrl) return;
    const w = window.open("", "_blank", "width=420,height=620");
    if (!w) return;
    w.document.write(
      `<!doctype html><html><head><title>${publicCode}</title></head>
       <body style="font-family:system-ui;text-align:center;padding:24px">
       <h1 style="font-size:20px;margin:0 0 4px">${t(lang, "loyaltyProgramCodeLabel")}</h1>
       <p style="font-family:ui-monospace,monospace;font-size:28px;font-weight:900;letter-spacing:2px;margin:8px 0 16px">${publicCode}</p>
       <img src="${qrDataUrl}" style="width:280px;height:280px" alt="" />
       <p style="font-size:13px;color:#555;margin-top:12px">${buildProgramJoinUrl(publicCode)}</p>
       </body></html>`,
    );
    w.document.close();
    w.focus();
    w.print();
  };

  if (loading) {
    return (
      <article className="rounded-2xl border border-border bg-card p-4">
        <EnterpriseSkeletonList count={2} />
      </article>
    );
  }

  if (!publicCode) {
    // The code is issued with the program row, so this only happens before the merchant has ever
    // saved their loyalty settings.
    return (
      <article className="rounded-2xl border border-border bg-card p-4">
        <h2 className="text-base font-black text-foreground">{t(lang, "loyaltyProgramCodeLabel")}</h2>
        <p className="mt-1 text-xs font-medium text-muted-foreground">
          {t(lang, "loyaltyJoinMerchantNeedManage")}
        </p>
      </article>
    );
  }

  return (
    <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <h2 className="text-base font-black text-foreground">{t(lang, "loyaltyProgramCodeLabel")}</h2>
      <p className="mt-1 text-sm font-medium text-muted-foreground">
        {t(lang, "loyaltyProgramCodeSub")}
      </p>

      <div className="mt-4 flex flex-col items-center gap-3">
        <p
          data-testid="loyalty-program-code"
          className="font-mono text-2xl font-black uppercase tracking-widest text-foreground"
        >
          {publicCode}
        </p>
        {qrDataUrl ? (
          <img src={qrDataUrl} alt="" className="h-56 w-56 rounded-2xl border border-border bg-white p-2" />
        ) : null}
        <p className="break-all text-center text-[11px] font-medium text-muted-foreground">
          {buildProgramJoinUrl(publicCode)}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={() => void onCopy()}
            className="min-h-[44px] rounded-xl border-2 border-border px-3 text-xs font-black"
          >
            {copied ? t(lang, "loyaltyJoinMerchantCopied") : t(lang, "loyaltyJoinMerchantCopy")}
          </button>
          <button
            type="button"
            onClick={onPrint}
            className="min-h-[44px] rounded-xl border-2 border-border px-3 text-xs font-black"
          >
            {t(lang, "loyaltyJoinMerchantPrint")}
          </button>
        </div>
      </div>
    </article>
  );
}
