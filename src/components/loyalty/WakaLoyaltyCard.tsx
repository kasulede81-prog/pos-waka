import type { CSSProperties } from "react";
import { publicAssetUrl } from "../../lib/publicAssetUrl";
import type { LoyaltyCardPresentation } from "../../lib/loyalty/loyaltyCardDesign";

/**
 * WAKA Loyalty membership card — the physical/PVC presentation.
 *
 * This is a LOYALTY card, not a payment instrument. It deliberately borrows the *proportions* of a
 * bank card (fixed 1.586:1 aspect, card-number grouping, a VALID THRU date and a 3-digit field)
 * because that shape reads as "issued, durable, mine" — but every value on it is loyalty data and
 * nothing here is a payment credential. No card-network branding appears anywhere.
 *
 * The 3-digit `memberCvc` is DECORATIVE. It is not a secret and must never be used for
 * authentication, authorisation or payment security — see `deriveLoyaltyMemberNumber` in
 * supabase/functions/_shared/loyaltyWallet/publicCardLookup.ts, which derives it (and the member
 * number) from a one-way hash so the real account UUID never leaves the server.
 *
 * Sizing uses container query units (`cqw`) against the card's own width, so one markup tree renders
 * correctly from a 320px phone up to a desktop column, and would scale to print unchanged.
 */

/** Transparent RGBA W mark (brand orange) — the same asset the app shell uses. */
const WAKA_W_MARK = publicAssetUrl("brand/w-icon-128.png");

type Props = {
  /** Merchant / issuer — `shops.name`. */
  shopName: string;
  /** Member — `customers.name`. */
  memberName: string;
  /** Server-derived card identity, e.g. "26D4 33F0 2BED 4ABE". Absent => em dash. */
  memberNumber?: string | null;
  /** Decorative 3-digit membership-field value. NOT a credential. */
  memberCvc?: string | null;
  /** `membership_expires_on` (YYYY-MM-DD), or null when the membership never expires. */
  expiresOn?: string | null;
  /** `loyalty_accounts.balance_points`. */
  balancePoints: number;
  /** Resolved via `resolveLoyaltyPresentation(design)` — merchant theming flows through here. */
  theme: LoyaltyCardPresentation;
  /** Data URL of the REAL loyalty QR (`WAKA-LOYALTY:<qr_token>`). */
  qrDataUrl?: string | null;
  /** Optional merchant program name; shown small in the footer when present. */
  programName?: string | null;
  className?: string;
};

/** YYYY-MM-DD → MM/YY. Never expires → an em dash, not an invented date. */
export function formatValidThru(expiresOn?: string | null): string {
  const iso = String(expiresOn ?? "")
    .trim()
    .slice(0, 10);
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(iso);
  if (!m) return "—";
  return `${m[2]}/${m[1].slice(2)}`;
}

/** Thousands-separated so a 5-digit balance still reads cleanly at card scale. */
function formatPoints(points: number): string {
  const n = Math.max(0, Math.trunc(Number(points) || 0));
  return n.toLocaleString();
}

export function WakaLoyaltyCard({
  shopName,
  memberName,
  memberNumber,
  memberCvc,
  expiresOn,
  balancePoints,
  theme,
  qrDataUrl,
  programName,
  className = "",
}: Props) {
  const fg = theme.heroForeground;
  const accent = theme.heroAccent;
  const hasMemberId = Boolean(memberNumber && String(memberNumber).trim());
  const hasCvc = Boolean(memberCvc && String(memberCvc).trim());
  const validThru = formatValidThru(expiresOn);

  const rootStyle: CSSProperties = {
    containerType: "inline-size",
    aspectRatio: "1.586 / 1",
    backgroundColor: theme.backgroundColor,
    color: fg,
    // Depth: a soft drop shadow plus an inner rim, so it reads as a physical slab.
    boxShadow: "0 24px 48px -20px rgba(2, 8, 20, 0.65), 0 2px 0 0 rgba(255,255,255,0.06) inset",
  };

  return (
    <div
      className={`relative w-full overflow-hidden rounded-[4.6cqw] ${className}`}
      style={rootStyle}
      data-loyalty-card="premium"
    >
      {/* ——— surface layers ——— */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(150deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0) 42%, rgba(0,0,0,0.34) 100%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(72% 58% at 8% -12%, ${accent}38, transparent 62%), radial-gradient(58% 46% at 104% 30%, ${theme.heroSecondaryAccent}26, transparent 58%)`,
        }}
      />
      {/* oversized W watermark, right edge — brand texture, never readable content */}
      <img
        src={WAKA_W_MARK}
        alt=""
        aria-hidden
        className="pointer-events-none absolute -right-[7cqw] -top-[10cqw] h-[64cqw] w-auto opacity-[0.06]"
      />

      {/* ——— content ——— */}
      <div
        className="relative flex h-full flex-col justify-between"
        style={{ padding: "5.4cqw 5.8cqw" }}
      >
        {/* header — WAKA mark + wordmark */}
        <div className="flex items-center gap-[3.2cqw]">
          <img src={WAKA_W_MARK} alt="" aria-hidden className="h-[9.4cqw] w-auto shrink-0" />
          <div className="min-w-0">
            <p
              className="font-black uppercase leading-none tracking-[0.06em]"
              style={{ fontSize: "5.1cqw" }}
            >
              WAKA Loyalty
            </p>
            <p
              className="mt-[1.1cqw] font-bold uppercase leading-none tracking-[0.34em]"
              style={{ fontSize: "1.95cqw", color: `${fg}b3` }}
            >
              Shop · Earn · Redeem
            </p>
          </div>
        </div>

        {/* issuer + member id, alongside the QR */}
        <div className="flex items-end justify-between gap-[4cqw]">
          <div className="min-w-0 flex-1">
            <p
              className="font-bold uppercase leading-none tracking-[0.22em]"
              style={{ fontSize: "2.1cqw", color: `${fg}a6` }}
            >
              Issued by
            </p>
            <p
              className="mt-[1.4cqw] truncate font-black uppercase leading-none tracking-[0.01em]"
              style={{ fontSize: "5.6cqw" }}
              title={shopName}
            >
              {shopName}
            </p>
            {/* accent rule, as in the reference */}
            <div
              aria-hidden
              className="mt-[2cqw] rounded-full"
              style={{ height: "0.7cqw", width: "26cqw", backgroundColor: accent }}
            />

            <p
              className="mt-[3.2cqw] font-bold uppercase leading-none tracking-[0.22em]"
              style={{ fontSize: "2.1cqw", color: `${fg}a6` }}
            >
              Member ID
            </p>
            <p
              className="mt-[1.4cqw] truncate font-black leading-none tabular-nums"
              style={{ fontSize: "5.2cqw", letterSpacing: "0.06em" }}
              title={memberNumber ?? undefined}
            >
              {hasMemberId ? memberNumber : "—"}
            </p>
          </div>

          {/* QR — the real loyalty payload, in a white quiet zone so it stays scannable */}
          <div
            className="shrink-0 rounded-[2.4cqw] bg-white p-[1.5cqw]"
            style={{ boxShadow: "0 2px 10px -2px rgba(0,0,0,0.35)" }}
          >
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt="Loyalty QR code — show this at the shop to earn and redeem points"
                className="block h-[24cqw] w-[24cqw]"
                style={{ imageRendering: "pixelated" }}
              />
            ) : (
              <div
                className="flex items-center justify-center rounded-[1.4cqw] bg-slate-100 text-center"
                style={{ height: "24cqw", width: "24cqw", fontSize: "2cqw" }}
                role="img"
                aria-label="Loyalty QR code unavailable"
              >
                <span className="px-[1cqw] font-bold uppercase tracking-wide text-slate-500">
                  QR unavailable
                </span>
              </div>
            )}
          </div>
        </div>

        {/* member / valid thru / cvc — a physical card always prints its fields */}
        <div className="flex items-end gap-[7cqw]">
          <div className="min-w-0 flex-1">
            <p
              className="font-bold uppercase leading-none tracking-[0.22em]"
              style={{ fontSize: "2.1cqw", color: `${fg}a6` }}
            >
              Member
            </p>
            <p
              className="mt-[1.4cqw] truncate font-black uppercase leading-none"
              style={{ fontSize: "4.3cqw" }}
              title={memberName}
            >
              {memberName}
            </p>
          </div>
          <div className="shrink-0">
            <p
              className="font-bold uppercase leading-none tracking-[0.22em]"
              style={{ fontSize: "2.1cqw", color: `${fg}a6` }}
            >
              Valid thru
            </p>
            <p
              className="mt-[1.4cqw] font-black leading-none tabular-nums"
              style={{ fontSize: "4.3cqw" }}
            >
              {validThru}
            </p>
          </div>
          <div className="shrink-0">
            <p
              className="font-bold uppercase leading-none tracking-[0.22em]"
              style={{ fontSize: "2.1cqw", color: `${fg}a6` }}
            >
              CVC
            </p>
            <p
              className="mt-[1.4cqw] font-black leading-none tabular-nums"
              style={{ fontSize: "4.3cqw" }}
              // Decorative membership field — explicitly not a security code.
              title="Membership card reference only — not a security code"
            >
              {hasCvc ? memberCvc : "—"}
            </p>
          </div>
        </div>

        {/* footer — POINTS only. The earn rule lives in the Loyalty dashboard, not on the card. */}
        <div className="flex items-end justify-between gap-[4cqw]">
          <div className="min-w-0">
            <p
              className="font-bold uppercase leading-none tracking-[0.22em]"
              style={{ fontSize: "2.1cqw", color: `${fg}a6` }}
            >
              Points
            </p>
            <p
              className="mt-[1.2cqw] truncate font-black leading-none tabular-nums"
              style={{ fontSize: "6.4cqw", color: accent }}
              aria-label={`${formatPoints(balancePoints)} points`}
            >
              {formatPoints(balancePoints)}
            </p>
          </div>
          {programName ? (
            <p
              className="min-w-0 truncate text-right font-bold uppercase leading-none tracking-[0.14em]"
              style={{ fontSize: "2cqw", color: `${fg}99` }}
              title={programName}
            >
              {programName}
            </p>
          ) : (
            <img src={WAKA_W_MARK} alt="" aria-hidden className="h-[7cqw] w-auto shrink-0" />
          )}
        </div>
      </div>
    </div>
  );
}
