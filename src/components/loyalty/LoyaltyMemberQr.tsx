import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { encodeLoyaltyQrPayload } from "../../lib/loyalty/loyaltyEnrollment";

/**
 * Membership QR for a loyalty account (Phase 05).
 *
 * The rendered payload is `WAKA-LOYALTY:<qr_token>` — an opaque token only.
 * No name, phone, or balance ever enters the QR; scanning it only lets a
 * shop member resolve the account via `loyalty_account_by_token`.
 */
export function LoyaltyMemberQr({ qrToken, size = 180 }: { qrToken: string; size?: number }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    QRCode.toDataURL(encodeLoyaltyQrPayload(qrToken), {
      width: size,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#1c1917", light: "#ffffff" },
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [qrToken, size]);

  if (failed) {
    return (
      <p className="max-w-[220px] break-all rounded-xl bg-muted px-3 py-2 text-center text-xs font-bold text-muted-foreground">
        {qrToken}
      </p>
    );
  }
  if (!dataUrl) {
    return <div style={{ width: size, height: size }} className="animate-pulse rounded-xl bg-muted" />;
  }
  return (
    <img
      src={dataUrl}
      width={size}
      height={size}
      alt="Loyalty membership QR"
      className="rounded-xl border border-border bg-white p-1"
    />
  );
}
