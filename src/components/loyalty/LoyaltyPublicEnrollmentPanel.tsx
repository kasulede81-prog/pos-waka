import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import {
  fetchEnrollmentLink,
  regenerateEnrollmentLink,
  revokeEnrollmentLink,
  type EnrollmentLinkState,
} from "../../lib/loyalty/loyaltyEnrollmentLink";
import { buildLoyaltyJoinUrl } from "../../lib/loyalty/loyaltyPublicEnroll";

export function LoyaltyPublicEnrollmentPanel({
  lang,
  shopId,
  canManage,
}: {
  lang: Language;
  shopId: string;
  canManage: boolean;
}) {
  const [state, setState] = useState<EnrollmentLinkState | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const next = await fetchEnrollmentLink(shopId);
    setState(next);
    if (next?.active && next.token) {
      const url = buildLoyaltyJoinUrl(next.token);
      const dataUrl = await QRCode.toDataURL(url, { margin: 1, width: 280 });
      setQrDataUrl(dataUrl);
    } else {
      setQrDataUrl(null);
    }
  }, [shopId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onGenerate = async () => {
    if (!canManage) return;
    setBusy(true);
    setError(null);
    const result = await regenerateEnrollmentLink(shopId);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await refresh();
  };

  const onRevoke = async () => {
    if (!canManage) return;
    if (!window.confirm(t(lang, "loyaltyJoinMerchantRevokeConfirm"))) return;
    setBusy(true);
    setError(null);
    const result = await revokeEnrollmentLink(shopId);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await refresh();
  };

  const onCopy = async () => {
    if (!state?.token) return;
    const url = buildLoyaltyJoinUrl(state.token);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("copy_failed");
    }
  };

  const onPrint = () => {
    if (!qrDataUrl || !state?.token) return;
    const url = buildLoyaltyJoinUrl(state.token);
    const w = window.open("", "_blank", "noopener,noreferrer,width=480,height=640");
    if (!w) return;
    w.document.write(`<!doctype html><html><head><title>Join Loyalty</title>
      <style>body{font-family:system-ui,sans-serif;text-align:center;padding:24px}
      img{width:280px;height:280px} h1{font-size:22px;margin:12px 0 4px}
      p{color:#444;font-size:14px}</style></head><body>
      <h1>${t(lang, "loyaltyJoinMerchantPrintTitle")}</h1>
      <p>${t(lang, "loyaltyJoinMerchantPrintSub")}</p>
      <img src="${qrDataUrl}" alt="QR" />
      <p style="word-break:break-all;font-size:11px;margin-top:16px">${url}</p>
      <script>window.onload=()=>window.print()</script>
      </body></html>`);
    w.document.close();
  };

  if (!canManage) {
    return (
      <article className="rounded-2xl border border-border bg-card p-4">
        <p className="text-sm font-black text-foreground">{t(lang, "loyaltyJoinMerchantTitle")}</p>
        <p className="mt-1 text-xs font-medium text-muted-foreground">
          {t(lang, "loyaltyJoinMerchantNeedManage")}
        </p>
      </article>
    );
  }

  return (
    <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <p className="text-base font-black text-foreground">{t(lang, "loyaltyJoinMerchantTitle")}</p>
      <p className="mt-1 text-sm font-medium text-muted-foreground">
        {t(lang, "loyaltyJoinMerchantSub")}
      </p>

      {state?.active && qrDataUrl ? (
        <div className="mt-4 flex flex-col items-center gap-3">
          <img src={qrDataUrl} alt="" className="h-56 w-56 rounded-2xl border border-border bg-white p-2" />
          <p className="break-all text-center text-[11px] font-medium text-muted-foreground">
            {buildLoyaltyJoinUrl(state.token!)}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={() => void onCopy()}
              className="min-h-[40px] rounded-xl border-2 border-border px-3 text-xs font-black"
            >
              {copied ? t(lang, "loyaltyJoinMerchantCopied") : t(lang, "loyaltyJoinMerchantCopy")}
            </button>
            <button
              type="button"
              onClick={onPrint}
              className="min-h-[40px] rounded-xl border-2 border-border px-3 text-xs font-black"
            >
              {t(lang, "loyaltyJoinMerchantPrint")}
            </button>
            <button
              type="button"
              onClick={() => void onGenerate()}
              disabled={busy}
              className="min-h-[40px] rounded-xl border-2 border-border px-3 text-xs font-black disabled:opacity-50"
            >
              {t(lang, "loyaltyJoinMerchantRegenerate")}
            </button>
            <button
              type="button"
              onClick={() => void onRevoke()}
              disabled={busy}
              className="min-h-[40px] rounded-xl border-2 border-destructive/40 px-3 text-xs font-black text-destructive disabled:opacity-50"
            >
              {t(lang, "loyaltyJoinMerchantRevoke")}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => void onGenerate()}
            disabled={busy}
            className="min-h-[44px] rounded-xl bg-waka-600 px-4 text-sm font-black text-white disabled:opacity-50"
          >
            {t(lang, "loyaltyJoinMerchantGenerate")}
          </button>
        </div>
      )}

      {state ? (
        <div className="mt-4 border-t border-border pt-3 text-sm">
          <p className="font-bold text-foreground">
            {t(lang, "loyaltyJoinMerchantRegistrations")}: {state.registrationsTotal}
          </p>
          {state.recentRegistrations.length > 0 ? (
            <ul className="mt-2 space-y-1 text-xs font-medium text-muted-foreground">
              {state.recentRegistrations.map((row) => (
                <li key={row.accountId}>
                  {row.customerName || "—"} · {row.enrolledAt.slice(0, 10)}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p className="mt-2 text-sm font-bold text-destructive">{t(lang, "loyaltySaveFailed")}</p>
      ) : null}
    </article>
  );
}
