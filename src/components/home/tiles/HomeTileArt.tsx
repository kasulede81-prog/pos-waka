import clsx from "clsx";
import type { HomeTileIntensity } from "../../../hooks/useHomeDashboardMetrics";

type Props = { tileId: string; intensity?: HomeTileIntensity; className?: string };

/** SVG miniature business scenes — motion driven by spotlight CSS on parent card. */
export function HomeTileArt({ tileId, intensity = "normal", className }: Props) {
  const uid = tileId.replace(/[^a-z0-9]/gi, "");
  return (
    <svg
      viewBox="0 0 160 120"
      className={clsx(
        "home-tile-art h-full max-h-[120px] w-full drop-shadow-md",
        `home-art-intensity-${intensity}`,
        className,
      )}
      aria-hidden
    >
      <defs>
        <linearGradient id={`home-metal-${uid}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#e8eaed" />
          <stop offset="100%" stopColor="#9aa3ad" />
        </linearGradient>
        <linearGradient id={`home-gold-${uid}`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#fde68a" />
          <stop offset="100%" stopColor="#d97706" />
        </linearGradient>
      </defs>
      {tileId === "sell" && <SellArt uid={uid} intensity={intensity} />}
      {tileId === "profit" && <ProfitArt uid={uid} intensity={intensity} />}
      {tileId === "inventory" && <InventoryArt intensity={intensity} />}
      {tileId === "cash" && <CashArt intensity={intensity} />}
      {tileId === "salesHistory" && <SalesHistoryArt />}
      {tileId === "debts" && <DebtsArt intensity={intensity} />}
      {tileId === "investigation" && <InvestigationArt />}
      {tileId === "shop" && <ShopArt />}
      {tileId === "settings" && <SettingsArt uid={uid} />}
      {tileId === "reports" && <ReportsArt uid={uid} />}
      {tileId === "agent" && <AgentArt />}
    </svg>
  );
}

function SellArt({ uid, intensity }: { uid: string; intensity: HomeTileIntensity }) {
  const busy = intensity === "high";
  return (
    <g className="home-art-sell">
      <rect x="8" y="62" width="88" height="10" rx="3" fill="#fdba74" opacity="0.9" />
      <rect x="12" y="48" width="80" height="16" rx="4" fill="#fed7aa" stroke="#fb923c" strokeWidth="1" />
      <rect x="78" y="38" width="28" height="22" rx="3" fill="#374151" />
      <rect x="82" y="42" width="20" height="10" rx="1" fill="#4ade80" opacity="0.8" />
      <g className="home-art-receipt-print">
        <rect x="100" y="44" width="10" height="28" rx="1" fill="#fff" />
        <rect x="102" y="48" width="6" height="2" rx="0.5" fill="#d1d5db" />
        <rect x="102" y="53" width="6" height="2" rx="0.5" fill="#d1d5db" />
      </g>
      <g className="home-art-cashier">
        <circle cx="52" cy="34" r="9" fill="#fcd9b6" />
        <path d="M40 48h24c2 0 4 8 4 14H36c0-6 2-14 4-14z" fill="#fb923c" />
      </g>
      <g className="home-art-customer">
        <circle cx="108" cy="30" r="8" fill="#fcd9b6" />
        <path d="M96 44h24c2 0 4 10 4 16H92c0-6 2-16 4-16z" fill="#22c55e" />
      </g>
      <g className="home-art-cart" transform="translate(14, 68)">
        <ellipse cx="34" cy="28" rx="30" ry="4" fill="rgba(0,0,0,0.15)" />
        <path d="M4 4h36l6 18H10z" fill={`url(#home-metal-${uid})`} stroke="#4b5563" strokeWidth="1" />
        <circle cx="12" cy="26" r="5" fill="#1f2937" />
        <circle cx="38" cy="26" r="5" fill="#1f2937" />
        <rect x="14" y="0" width="12" height="10" rx="1" fill="#c4a574" />
        <g className="home-art-bag">
          <path d="M30 -2h10v12c0 3-2 5-5 5s-5-2-5-5V-2z" fill="#fb923c" />
        </g>
        {busy ? (
          <g className="home-art-extra-bags">
            <path d="M46 6h8v10c0 2-1 4-4 4s-4-2-4-4V6z" fill="#f97316" opacity="0.9" />
            <path d="M54 8h7v8c0 2-1 3-3.5 3.5S54 18 54 16V8z" fill="#ea580c" opacity="0.75" />
          </g>
        ) : null}
      </g>
      <circle className="home-art-sparkle" cx="24" cy="56" r="3" fill="#fff" opacity="0.9" />
    </g>
  );
}

function ProfitArt({ uid, intensity }: { uid: string; intensity: HomeTileIntensity }) {
  const rich = intensity === "high" || intensity === "normal";
  return (
    <g className="home-art-profit">
      <g transform="translate(28, 22)">
        <rect x="72" y="44" width="36" height="24" rx="4" fill="#78350f" opacity="0.85" />
        <rect className="home-art-wallet" x="76" y="48" width="28" height="16" rx="3" fill="#92400e" />
        <rect className="home-art-bar home-art-bar-1" x="0" y="52" width="14" height="24" rx="2" fill="#34d399" />
        <rect className="home-art-bar home-art-bar-2" x="18" y="40" width="14" height="36" rx="2" fill="#10b981" />
        <rect className="home-art-bar home-art-bar-3" x="36" y="28" width="14" height="48" rx="2" fill="#059669" />
        <rect className="home-art-bar home-art-bar-4" x="54" y="16" width="14" height="60" rx="2" fill="#047857" />
        <path className="home-art-profit-arrow" d="M4 6 L40 -6 L76 6" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" />
        <g className="home-art-coins" transform="translate(4, 58)">
          <circle cx="10" cy="10" r="9" fill={`url(#home-gold-${uid})`} stroke="#b45309" strokeWidth="1" />
          {rich ? <circle cx="24" cy="6" r="7" fill={`url(#home-gold-${uid})`} stroke="#b45309" strokeWidth="1" /> : null}
          {intensity === "high" ? <circle cx="34" cy="2" r="5" fill={`url(#home-gold-${uid})`} stroke="#b45309" strokeWidth="1" /> : null}
        </g>
      </g>
    </g>
  );
}

function InventoryArt({ intensity }: { intensity: HomeTileIntensity }) {
  const sparse = intensity === "alert";
  return (
    <g className="home-art-inventory" transform="translate(20, 14)">
      <rect x="8" y="12" width="104" height="82" rx="4" fill="#6b7280" stroke="#4b5563" strokeWidth="2" />
      {[0, 1, 2].map((row) => (
        <rect key={row} x="12" y={18 + row * 24} width="96" height="4" fill="#9ca3af" />
      ))}
      {!sparse ? (
        <>
          <g className="home-art-box home-art-box-1">
            <rect x="18" y="58" width="22" height="18" rx="2" fill="#d4a574" stroke="#a16207" />
          </g>
          <g className="home-art-box home-art-box-2">
            <rect x="46" y="50" width="22" height="26" rx="2" fill="#c4a574" stroke="#a16207" />
          </g>
          <g className="home-art-box home-art-box-3">
            <rect x="74" y="42" width="22" height="34" rx="2" fill="#b8956a" stroke="#a16207" />
          </g>
        </>
      ) : (
        <g className="home-art-empty-shelf" opacity="0.6">
          <rect x="24" y="58" width="64" height="3" rx="1" fill="#d1d5db" strokeDasharray="4 3" />
        </g>
      )}
      <g className="home-art-forklift" transform="translate(88, 68)">
        <rect x="0" y="8" width="18" height="10" rx="2" fill="#facc15" />
        <rect x="14" y="0" width="4" height="18" fill="#9ca3af" />
      </g>
      <rect className="home-art-scanner" x="52" y="0" width="36" height="10" rx="2" fill="#111827" />
    </g>
  );
}

function CashArt({ intensity }: { intensity: HomeTileIntensity }) {
  const full = intensity === "high";
  return (
    <g className="home-art-cash" transform="translate(16, 30)">
      <rect x="92" y="16" width="28" height="40" rx="4" fill="#1f2937" />
      <rect x="96" y="22" width="20" height="12" rx="2" fill="#4ade80" opacity="0.7" />
      <rect x="8" y="28" width="104" height="48" rx="6" fill="#374151" stroke="#1f2937" strokeWidth="2" />
      <g className="home-art-drawer">
        <rect x="16" y="36" width="88" height="32" rx="4" fill="#1f2937" />
        <rect className="home-art-cash-bill home-art-bill-1" x="24" y="32" width="20" height="28" rx="2" fill="#4ade80" />
        <rect className="home-art-cash-bill home-art-bill-2" x="48" y="30" width="20" height="30" rx="2" fill="#facc15" />
        <rect className="home-art-cash-bill home-art-bill-3" x="72" y="32" width="20" height="28" rx="2" fill="#60a5fa" />
        {full ? <rect className="home-art-cash-bill" x="60" y="28" width="18" height="32" rx="2" fill="#4ade80" opacity="0.8" /> : null}
      </g>
    </g>
  );
}

function SalesHistoryArt() {
  return (
    <g className="home-art-salesHistory" transform="translate(30, 20)">
      <rect x="20" y="8" width="60" height="36" rx="4" fill="#e5e7eb" stroke="#9ca3af" strokeWidth="2" />
      <rect x="28" y="44" width="44" height="52" rx="2" fill="#fff" stroke="#d1d5db" />
      <g className="home-art-receipt">
        {[0, 1, 2, 3, 4].map((i) => (
          <rect key={i} x="34" y={52 + i * 8} width={32 - i * 4} height="3" rx="1" fill="#d1d5db" />
        ))}
        <text className="home-art-receipt-num" x="50" y="96" textAnchor="middle" fontSize="11" fontWeight="bold" fill="#059669">
          12,450
        </text>
      </g>
    </g>
  );
}

function DebtsArt({ intensity }: { intensity: HomeTileIntensity }) {
  const alert = intensity === "alert";
  return (
    <g className="home-art-debts" transform="translate(38, 22)">
      <rect className="home-art-paper" x="8" y="8" width="68" height="88" rx="4" fill="#fff" stroke="#e5e7eb" strokeWidth="2" />
      <rect x="18" y="24" width="48" height="4" rx="1" fill="#d1d5db" />
      <rect x="18" y="36" width="40" height="4" rx="1" fill="#d1d5db" />
      <text x="44" y="68" textAnchor="middle" fontSize="14" fontWeight="900" fill="#7c3aed">
        DEBT
      </text>
      {alert ? (
        <g className="home-art-debt-badge" transform="translate(62, 0)">
          <circle cx="12" cy="12" r="12" fill="#ef4444" />
          <text x="12" y="16" textAnchor="middle" fontSize="12" fontWeight="bold" fill="#fff">
            !
          </text>
        </g>
      ) : null}
    </g>
  );
}

function InvestigationArt() {
  return (
    <g className="home-art-investigation" transform="translate(28, 28)">
      <rect x="8" y="36" width="72" height="48" rx="4" fill="#fbbf24" />
      <rect x="16" y="44" width="56" height="6" rx="1" fill="#fde68a" />
      <rect x="16" y="56" width="40" height="6" rx="1" fill="#fde68a" />
      <g className="home-art-magnifier">
        <circle cx="72" cy="40" r="22" fill="none" stroke="#fff" strokeWidth="5" />
        <line x1="88" y1="56" x2="102" y2="70" stroke="#fff" strokeWidth="6" strokeLinecap="round" />
      </g>
    </g>
  );
}

function ShopArt() {
  return (
    <g className="home-art-shop" transform="translate(34, 24)">
      <rect x="8" y="20" width="84" height="56" rx="6" fill="#92400e" stroke="#78350f" strokeWidth="2" />
      <rect x="8" y="20" width="84" height="16" rx="6" fill="#a16207" />
      <rect x="36" y="36" width="28" height="8" rx="2" fill="#d97706" />
      <g className="home-art-briefcase-doc">
        <rect x="28" y="8" width="32" height="40" rx="2" fill="#fff" opacity="0.9" />
        <rect x="34" y="18" width="20" height="3" rx="1" fill="#d1d5db" />
        <rect x="34" y="26" width="16" height="3" rx="1" fill="#d1d5db" />
      </g>
    </g>
  );
}

function SettingsArt({ uid }: { uid: string }) {
  return (
    <g className="home-art-settings" transform="translate(40, 18)">
      <g className="home-art-gear">
        <circle cx="40" cy="40" r="18" fill={`url(#home-metal-${uid})`} stroke="#6b7280" strokeWidth="2" />
        <circle cx="40" cy="40" r="7" fill="#4b5563" />
        {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
          <rect
            key={deg}
            x="37"
            y="10"
            width="6"
            height="16"
            rx="2"
            fill="#9ca3af"
            transform={`rotate(${deg} 40 40)`}
          />
        ))}
      </g>
      <rect className="home-art-switch" x="8" y="72" width="20" height="10" rx="5" fill="#fff" opacity="0.35" />
    </g>
  );
}

function ReportsArt({ uid }: { uid: string }) {
  return (
    <g className="home-art-reports" transform="translate(16, 20)">
      <rect x="8" y="8" width="88" height="72" rx="6" fill="#fff" opacity="0.15" />
      <rect className="home-art-rpt-bar home-art-rpt-bar-1" x="20" y="52" width="10" height="20" rx="2" fill="#fff" opacity="0.9" />
      <rect className="home-art-rpt-bar home-art-rpt-bar-2" x="36" y="44" width="10" height="28" rx="2" fill="#fff" opacity="0.85" />
      <rect className="home-art-rpt-bar home-art-rpt-bar-3" x="52" y="36" width="10" height="36" rx="2" fill="#fff" opacity="0.8" />
      <rect className="home-art-rpt-bar home-art-rpt-bar-4" x="68" y="28" width="10" height="44" rx="2" fill="#fff" opacity="0.75" />
      <path className="home-art-rpt-line" d="M20 48 L40 40 L56 44 L76 24" fill="none" stroke="#fde68a" strokeWidth="3" strokeLinecap="round" />
      <circle className="home-art-rpt-coin" cx="82" cy="20" r="8" fill={`url(#home-gold-${uid})`} />
      <path className="home-art-rpt-arrow" d="M88 12 L100 4 L100 20 Z" fill="#fff" />
    </g>
  );
}

function AgentArt() {
  return (
    <g className="home-art-agent" transform="translate(20, 24)">
      <g className="home-art-person home-art-person-1">
        <circle cx="28" cy="20" r="12" fill="#fcd9b6" />
        <path d="M12 56c2-16 14-24 16-24s14 8 16 24" fill="#22c55e" />
      </g>
      <g className="home-art-person home-art-person-2">
        <circle cx="72" cy="20" r="12" fill="#fcd9b6" />
        <path d="M56 56c2-16 14-24 16-24s14 8 16 24" fill="#fb923c" />
      </g>
      <g className="home-art-handshake">
        <rect x="42" y="38" width="16" height="10" rx="4" fill="#fcd9b6" />
      </g>
    </g>
  );
}
