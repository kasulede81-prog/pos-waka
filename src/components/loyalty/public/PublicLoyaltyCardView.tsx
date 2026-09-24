import type { CSSProperties } from "react";
import type { PublicCardData, PublicCardReward } from "../../../lib/loyalty/loyaltyPublicCard";
import type { LoyaltyCardDesign } from "../../../lib/loyalty/loyaltyCardDesign";
import {
  buildRewardProgress,
  isRewardAffordable,
} from "../../../lib/loyalty/loyaltyPublicCardProgress";

type Props = {
  card: PublicCardData;
  design?: LoyaltyCardDesign;
  qrDataUrl: string | null;
  walletBusy: boolean;
  walletMessage: string | null;
  walletError: string | null;
  onAddToWallet: () => void;
  onSharePage: () => void;
  /** When true, CTAs are visual-only (merchant preview). */
  previewMode?: boolean;
};

function RewardRow({
  reward,
  balancePoints,
  index,
  layout,
}: {
  reward: PublicCardReward;
  balancePoints: number;
  index: number;
  layout: "list" | "cards";
}) {
  const available = isRewardAffordable(balancePoints, reward.points_required);
  return (
    <li
      className={`loyalty-public-stagger rounded-2xl border px-4 py-3.5 ${
        layout === "cards" ? "h-full" : ""
      } ${
        available
          ? "border-emerald-200/90 bg-gradient-to-br from-emerald-50 to-white"
          : "border-stone-200/90 bg-white/95"
      }`}
      style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
      aria-label={`${reward.name}, ${reward.points_required} points, ${available ? "available" : "need more points"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="break-words text-[15px] font-black leading-snug text-stone-900">
            {reward.name}
          </p>
          {reward.description ? (
            <p className="mt-1 break-words text-xs font-medium leading-relaxed text-stone-500">
              {reward.description}
            </p>
          ) : null}
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-black tabular-nums text-stone-900">{reward.points_required}</p>
          <p className="text-[10px] font-bold uppercase tracking-wide text-stone-400">pts</p>
        </div>
      </div>
      <p
        className={`mt-2.5 inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${
          available ? "bg-emerald-600/10 text-emerald-800" : "bg-stone-100 text-stone-500"
        }`}
      >
        {available ? "Available" : "Need more points"}
      </p>
      {available ? (
        <p className="mt-1.5 text-[11px] font-medium text-stone-500">
          Ask the shop to redeem at checkout
        </p>
      ) : null}
    </li>
  );
}

function heroRadius(style: LoyaltyCardDesign["cardStyle"] | undefined): string {
  if (style === "minimal") return "rounded-xl";
  if (style === "modern") return "rounded-3xl";
  if (style === "premium") return "rounded-[2rem]";
  return "rounded-[1.75rem]";
}

/**
 * Premium mobile presentation for a loaded public loyalty card (B1).
 * Optional B2 `design` tokens — when omitted, B1 defaults remain.
 * Display-only — no redemption.
 */
export function PublicLoyaltyCardView({
  card,
  design,
  qrDataUrl,
  walletBusy,
  walletMessage,
  walletError,
  onAddToWallet,
  onSharePage,
  previewMode = false,
}: Props) {
  const progress = buildRewardProgress(card.balance_points, card.rewards);
  const showWallet = card.wallet_configured && card.account_active;
  const programName =
    design?.programDisplayName?.trim() || card.program_name;
  const welcome = design?.welcomeMessage?.trim() || null;
  const logoUrl = design?.logoUrl || null;
  const rewardLayout = design?.rewardLayout ?? "list";
  const cardStyle = design?.cardStyle;

  const cssVars: CSSProperties | undefined = design
    ? ({
        ["--loyalty-primary" as string]: design.primaryColor,
        ["--loyalty-accent" as string]: design.accentColor,
        ["--loyalty-bg" as string]: design.backgroundColor,
        ["--loyalty-text" as string]: design.textColor,
      } as CSSProperties)
    : undefined;

  const heroBg = design?.backgroundColor;
  const heroText = design?.textColor;
  const starColor = design?.primaryColor;

  return (
    <div
      className="loyalty-public-enter mt-6 flex flex-1 flex-col gap-5"
      style={cssVars}
      data-card-style={cardStyle ?? "classic"}
    >
      <header className="text-center">
        <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-amber-800/70">
          WAKA Loyalty
        </p>
        {logoUrl ? (
          <div className="mt-3 flex justify-center">
            <img
              src={logoUrl}
              alt=""
              width={64}
              height={64}
              referrerPolicy="no-referrer"
              className="h-16 w-16 rounded-2xl object-contain bg-white/80 p-1 shadow-sm"
            />
          </div>
        ) : null}
        <h1 className="mt-2 break-words text-[1.65rem] font-black leading-tight tracking-tight text-stone-900">
          {card.shop_name}
        </h1>
        <p className="mt-1 break-words text-sm font-semibold text-stone-500">{programName}</p>
        {welcome ? (
          <p className="mx-auto mt-2 max-w-sm break-words text-sm font-medium leading-relaxed text-stone-600">
            {welcome}
          </p>
        ) : null}
      </header>

      <article
        className={`loyalty-public-hero relative overflow-hidden ${heroRadius(cardStyle)} px-5 pb-6 pt-6 shadow-[0_20px_50px_-24px_rgba(28,25,23,0.75)] ${
          heroBg ? "" : "bg-stone-950 text-white"
        }`}
        style={
          heroBg
            ? { backgroundColor: heroBg, color: heroText ?? "#fafaf9" }
            : undefined
        }
        aria-labelledby="loyalty-member-name"
      >
        <div
          className="pointer-events-none absolute -right-10 -top-16 h-44 w-44 rounded-full blur-3xl"
          style={{ backgroundColor: starColor ? `${starColor}33` : undefined }}
          aria-hidden="true"
        />
        {!starColor ? (
          <div
            className="pointer-events-none absolute -right-10 -top-16 h-44 w-44 rounded-full bg-amber-400/20 blur-3xl"
            aria-hidden="true"
          />
        ) : null}
        <div
          className="pointer-events-none absolute -bottom-20 -left-8 h-40 w-40 rounded-full blur-3xl"
          style={{
            backgroundColor: design?.accentColor ? `${design.accentColor}26` : undefined,
          }}
          aria-hidden="true"
        />
        {!design?.accentColor ? (
          <div
            className="pointer-events-none absolute -bottom-20 -left-8 h-40 w-40 rounded-full bg-orange-500/15 blur-3xl"
            aria-hidden="true"
          />
        ) : null}

        <div className="relative">
          <p
            className={`text-[10px] font-bold uppercase tracking-[0.18em] ${
              heroBg ? "opacity-70" : "text-stone-400"
            }`}
          >
            Member
          </p>
          <h2
            id="loyalty-member-name"
            className="mt-1 break-words text-2xl font-black tracking-tight"
          >
            {card.customer_name}
          </h2>
          {!card.account_active ? (
            <p className="mt-2 inline-flex rounded-full bg-amber-400/20 px-2.5 py-1 text-[11px] font-bold text-amber-200">
              Account inactive
            </p>
          ) : null}

          <div className="loyalty-public-points mt-7 text-center">
            <p
              className={`text-[10px] font-bold uppercase tracking-[0.2em] ${
                heroBg ? "opacity-80" : "text-amber-200/80"
              }`}
              style={starColor && heroBg ? { color: starColor } : undefined}
            >
              Point balance
            </p>
            <p
              className="mt-2 flex items-end justify-center gap-2"
              aria-label={`${card.balance_points} points`}
            >
              <span
                className={`mb-2 text-2xl ${heroBg ? "" : "text-amber-300"}`}
                style={starColor ? { color: starColor } : undefined}
                aria-hidden="true"
              >
                ★
              </span>
              <span className="text-6xl font-black tabular-nums leading-none tracking-tight sm:text-7xl">
                {card.balance_points}
              </span>
            </p>
            <p
              className={`mt-2 text-sm font-bold uppercase tracking-[0.28em] ${
                heroBg ? "opacity-60" : "text-stone-400"
              }`}
            >
              Points
            </p>
          </div>

          {progress ? (
            <div
              className={`mt-6 rounded-2xl px-4 py-3 text-center text-sm font-semibold leading-snug ${
                progress.kind === "affordable"
                  ? "bg-emerald-400/15 text-emerald-100"
                  : heroBg
                    ? "bg-white/10"
                    : "bg-white/10 text-stone-200"
              }`}
              role="status"
            >
              {progress.message}
            </div>
          ) : null}
        </div>
      </article>

      <section aria-labelledby="loyalty-rewards-heading">
        <h2
          id="loyalty-rewards-heading"
          className="text-[11px] font-bold uppercase tracking-[0.18em] text-stone-500"
        >
          Your rewards
        </h2>
        {card.rewards.length === 0 ? (
          <div className="mt-3 rounded-2xl border border-dashed border-stone-300/90 bg-white/60 px-4 py-6 text-center">
            <p className="text-sm font-black text-stone-800">You&apos;re all set.</p>
            <p className="mt-1 text-sm font-medium text-stone-500">
              Keep shopping to unlock rewards.
            </p>
          </div>
        ) : (
          <ul
            className={`mt-3 list-none p-0 ${
              rewardLayout === "cards"
                ? "grid grid-cols-1 gap-2.5 sm:grid-cols-2"
                : "flex flex-col gap-2.5"
            }`}
          >
            {card.rewards.map((reward, index) => (
              <RewardRow
                key={`${reward.name}-${reward.points_required}-${index}`}
                reward={reward}
                balancePoints={card.balance_points}
                index={index}
                layout={rewardLayout}
              />
            ))}
          </ul>
        )}
      </section>

      <section
        className="loyalty-public-qr rounded-[1.75rem] border border-stone-200/90 bg-white px-4 py-6 shadow-[0_12px_40px_-28px_rgba(28,25,23,0.45)]"
        aria-labelledby="loyalty-checkout-heading"
      >
        <h2
          id="loyalty-checkout-heading"
          className="text-center text-[11px] font-bold uppercase tracking-[0.18em] text-stone-500"
        >
          Show at checkout
        </h2>
        <div className="mx-auto mt-4 flex w-full max-w-[280px] flex-col items-center">
          {qrDataUrl ? (
            <img
              src={qrDataUrl}
              width={260}
              height={260}
              alt="Loyalty membership QR code. Show this at checkout to collect your points."
              className="aspect-square w-full max-w-[260px] rounded-2xl border border-stone-100 bg-white p-3"
            />
          ) : (
            <div
              className="aspect-square w-full max-w-[260px] animate-pulse rounded-2xl bg-stone-100"
              aria-hidden="true"
            />
          )}
          <p className="mt-4 max-w-[18rem] text-center text-sm font-medium leading-relaxed text-stone-600">
            Show this QR at checkout to collect your points.
          </p>
        </div>
      </section>

      {!previewMode ? (
        <section className="flex flex-col gap-2.5" aria-label="Card actions">
          {showWallet ? (
            <button
              type="button"
              disabled={walletBusy}
              onClick={onAddToWallet}
              className="min-h-12 w-full rounded-2xl bg-[#1a73e8] px-4 text-[15px] font-black text-white shadow-md shadow-blue-900/10 transition active:scale-[0.98] disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1a73e8]"
            >
              {walletBusy ? "Creating your loyalty card..." : "Add to Google Wallet"}
            </button>
          ) : null}

          <button
            type="button"
            onClick={onSharePage}
            className="min-h-12 w-full rounded-2xl border border-stone-300/90 bg-white/90 px-4 text-[15px] font-bold text-stone-800 shadow-sm transition active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-400"
          >
            Share my loyalty card
          </button>

          {walletMessage ? (
            <p className="text-center text-xs font-bold text-emerald-700" role="status">
              {walletMessage}
            </p>
          ) : null}
          {walletError ? (
            <p className="text-center text-xs font-bold text-red-700" role="alert">
              {walletError}
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
