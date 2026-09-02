import { useId } from "react";
import clsx from "clsx";
import type { HomeTileIntensity } from "../../../lib/homeExecutiveKpis";
import type { HomeDrawerVisualState } from "../../../lib/homeLivingMotion";
import { HomeCashDrawerScene } from "../HomeCashDrawerScene";

type Props = {
  tileId: string;
  intensity?: HomeTileIntensity;
  density?: "compact" | "inline" | "stage" | "comfortable";
  drawerState?: HomeDrawerVisualState;
  onDrawerKickSettled?: () => void;
};

/**
 * Isolated SVG scenes for Home tiles. CSS on the parent card drives idle / hover / event.
 * Presentation only — no business writes.
 */
export function HomeTileScene({
  tileId,
  intensity = "calm",
  density = "comfortable",
  drawerState = "idle",
  onDrawerKickSettled,
}: Props) {
  const uid = useId().replace(/:/g, "");
  const scale = density === "comfortable" ? "inline" : density;
  const frame =
    scale === "compact"
      ? "home-tile-scene h-10 w-14"
      : scale === "stage"
        ? "home-tile-scene h-[5.25rem] w-full sm:h-[6.5rem] lg:h-28"
        : "home-tile-scene h-14 w-[5.25rem] sm:h-[3.75rem] sm:w-[5.5rem]";

  if (tileId === "cash") {
    return (
      <HomeCashDrawerScene
        state={drawerState}
        intensity={intensity}
        className={
          scale === "compact"
            ? "h-10 w-14"
            : scale === "stage"
              ? "h-[5.25rem] w-full sm:h-[6.5rem] lg:h-28"
              : "h-14 w-[5.25rem] sm:h-[3.75rem] sm:w-[5.5rem]"
        }
        onOpenSettled={onDrawerKickSettled}
      />
    );
  }

  return (
    <svg viewBox="0 0 88 58" className={clsx(frame)} data-home-scene={tileId} aria-hidden>
      <defs>
        <linearGradient id={`hs-metal-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#d6d3d1" />
          <stop offset="100%" stopColor="#78716c" />
        </linearGradient>
        <linearGradient id={`hs-wood-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#d6b089" />
          <stop offset="100%" stopColor="#a16207" />
        </linearGradient>
        <linearGradient id={`hs-amber-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fdba74" />
          <stop offset="100%" stopColor="#ea580c" />
        </linearGradient>
        <linearGradient id={`hs-teal-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#5eead4" />
          <stop offset="100%" stopColor="#0f766e" />
        </linearGradient>
        <linearGradient id={`hs-ink-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#44403c" />
          <stop offset="100%" stopColor="#1c1917" />
        </linearGradient>
      </defs>
      <ellipse cx="44" cy="54" rx="30" ry="2.8" fill="rgba(15,23,42,0.16)" />
      {tileId === "inventory" ? <InventoryScene uid={uid} intensity={intensity} /> : null}
      {tileId === "cashPosition" ? <CashPositionScene uid={uid} intensity={intensity} /> : null}
      {tileId === "reports" ? <ReportsScene uid={uid} /> : null}
      {tileId === "debts" ? <DebtsScene uid={uid} intensity={intensity} /> : null}
      {tileId === "salesHistory" ? <SalesHistoryScene uid={uid} intensity={intensity} /> : null}
      {tileId === "shop" ? <BackOfficeScene uid={uid} /> : null}
      {tileId === "profit" ? <ProfitScene uid={uid} intensity={intensity} /> : null}
      {tileId === "commandCenter" ? <CommandCenterScene uid={uid} intensity={intensity} /> : null}
      {tileId === "investigation" ? <InvestigationScene uid={uid} /> : null}
      {tileId === "settings" ? <SettingsScene uid={uid} /> : null}
      {tileId === "dashboard" ? <DashboardScene uid={uid} /> : null}
      {tileId === "agent" ? <AgentScene uid={uid} /> : null}
      {!SCENE_IDS.has(tileId) ? <FallbackScene uid={uid} /> : null}
    </svg>
  );
}

const SCENE_IDS = new Set([
  "inventory",
  "cashPosition",
  "reports",
  "debts",
  "salesHistory",
  "shop",
  "profit",
  "commandCenter",
  "investigation",
  "settings",
  "dashboard",
  "agent",
]);

function InventoryScene({ uid, intensity }: { uid: string; intensity: HomeTileIntensity }) {
  const alert = intensity === "alert";
  return (
    <g className="home-scene-inventory">
      <rect x="8" y="6" width="72" height="46" rx="5" fill={`url(#hs-ink-${uid})`} />
      <rect x="10" y="8" width="68" height="40" rx="3.5" fill="#1c1917" />
      <ellipse cx="44" cy="16" rx="22" ry="6" fill="#fbbf24" opacity="0.08" />
      {[0, 1, 2].map((row) => (
        <g key={row} className="home-scene-shelf">
          <rect x="14" y={20 + row * 11} width="60" height="2.2" rx="0.8" fill="#d6d3d1" />
          <rect x="14" y={22 + row * 11} width="60" height="1.1" fill="#78716c" />
        </g>
      ))}
      <g className="home-scene-box home-scene-box-1">
        <rect x="16" y="12" width="9" height="8" rx="1" fill={`url(#hs-wood-${uid})`} />
        <rect x="27" y="13" width="7" height="7" rx="1" fill="#fdba74" />
        <rect x="48" y="11" width="10" height="9" rx="1" fill={`url(#hs-teal-${uid})`} />
        <rect x="60" y="13" width="8" height="7" rx="1" fill={`url(#hs-wood-${uid})`} />
      </g>
      <g className="home-scene-box home-scene-box-2">
        <rect x="17" y="23" width="11" height="8" rx="1" fill={`url(#hs-wood-${uid})`} />
        <rect
          x="32"
          y={alert ? 28 : 23}
          width="10"
          height={alert ? 3 : 8}
          rx="1"
          fill={alert ? `url(#hs-amber-${uid})` : "#fb923c"}
        />
        <rect x="54" y="24" width="14" height="7" rx="1" fill={`url(#hs-wood-${uid})`} />
      </g>
      <g className="home-scene-box home-scene-box-3">
        <rect x="16" y="34" width="13" height="8" rx="1.1" fill={`url(#hs-wood-${uid})`} />
        <rect x="32" y="35" width="8" height="7" rx="1" fill="#fed7aa" />
        <rect x="52" y="33" width="16" height="9" rx="1.1" fill={`url(#hs-wood-${uid})`} />
      </g>
      {alert ? <rect className="home-scene-stock-gap" x="32" y="23" width="10" height="1.6" rx="0.8" fill="#fbbf24" opacity="0.75" /> : null}
    </g>
  );
}

function CashPositionScene({ uid, intensity }: { uid: string; intensity: HomeTileIntensity }) {
  const rich = intensity === "high";
  return (
    <g className="home-scene-cashPosition">
      <rect x="8" y="10" width="72" height="38" rx="10" fill={`url(#hs-teal-${uid})`} />
      <rect x="11" y="13" width="66" height="18" rx="6" fill="#042f2e" opacity="0.28" />
      <g className="home-scene-flow">
        <path d="M16 24 C28 16, 40 34, 54 22 S74 18, 78 26" fill="none" stroke="#ecfdf5" strokeWidth="1.8" strokeLinecap="round" opacity="0.72" />
      </g>
      <g className="home-scene-disc home-scene-disc-1">
        <ellipse cx="28" cy="42" rx="10" ry="3.6" fill="#134e4a" />
        <ellipse cx="28" cy="38.6" rx="10" ry="3.6" fill="#99f6e4" />
        <ellipse cx="28" cy="36.4" rx="10" ry="3.4" fill="#ccfbf1" />
      </g>
      <g className="home-scene-disc home-scene-disc-2">
        <ellipse cx="48" cy="40" rx="8" ry="3" fill="#115e59" />
        <ellipse cx="48" cy="37.2" rx="8" ry="3" fill="#5eead4" />
      </g>
      {rich ? (
        <g className="home-scene-disc home-scene-disc-3">
          <ellipse cx="64" cy="38" rx="7" ry="2.6" fill="#134e4a" />
          <ellipse cx="64" cy="35.6" rx="7" ry="2.6" fill="#ccfbf1" />
        </g>
      ) : null}
    </g>
  );
}

function ReportsScene({ uid }: { uid: string }) {
  return (
    <g className="home-scene-reports">
      <rect x="8" y="7" width="72" height="44" rx="6" fill={`url(#hs-ink-${uid})`} />
      <rect x="11" y="10" width="66" height="38" rx="4" fill="#0c0a09" />
      <rect x="14" y="13" width="18" height="2" rx="1" fill="#44403c" />
      <rect className="home-scene-bar home-scene-bar-1" x="16" y="34" width="9" height="10" rx="1.4" fill="#fdba74" />
      <rect className="home-scene-bar home-scene-bar-2" x="29" y="28" width="9" height="16" rx="1.4" fill="#fb923c" />
      <rect className="home-scene-bar home-scene-bar-3" x="42" y="24" width="9" height="20" rx="1.4" fill="#f97316" />
      <rect className="home-scene-bar home-scene-bar-4" x="55" y="18" width="9" height="26" rx="1.4" fill="#ea580c" />
      <path className="home-scene-rpt-line" d="M16 32 L30 26 L44 30 L64 16" fill="none" stroke="#fed7aa" strokeWidth="2" strokeLinecap="round" />
    </g>
  );
}

function DebtsScene({ uid, intensity }: { uid: string; intensity: HomeTileIntensity }) {
  const due = intensity === "alert" || intensity === "normal";
  return (
    <g className="home-scene-debts">
      <path className="home-scene-link" d="M22 34 L40 18 L66 32" fill="none" stroke={due ? "#c4b5fd" : "#a8a29e"} strokeWidth="1.8" />
      <circle className="home-scene-node home-scene-node-1" cx="22" cy="34" r="8" fill={`url(#hs-metal-${uid})`} />
      <circle className="home-scene-node home-scene-node-2" cx="40" cy="18" r="7" fill="#ddd6fe" />
      <circle className="home-scene-node home-scene-node-3" cx="66" cy="32" r="8" fill={due ? "#7c3aed" : `url(#hs-metal-${uid})`} />
      {due ? <circle className="home-scene-debt-mark" cx="66" cy="32" r="2.4" fill="#fde68a" /> : null}
    </g>
  );
}

function SalesHistoryScene({ uid, intensity }: { uid: string; intensity: HomeTileIntensity }) {
  const busy = intensity === "high";
  return (
    <g className="home-scene-salesHistory">
      <g className="home-scene-receipt home-scene-receipt-1">
        <rect x="18" y="16" width="40" height="32" rx="2.2" fill="#fff" stroke="#d6d3d1" />
      </g>
      <g className="home-scene-receipt home-scene-receipt-2">
        <rect x="24" y="12" width="40" height="32" rx="2.2" fill="#fafaf9" stroke="#a8a29e" />
        <rect x="29" y="18" width="26" height="1.8" fill="#d6d3d1" />
        <rect x="29" y="24" width="18" height="1.8" fill="#e7e5e4" />
        <rect x="29" y="30" width="22" height="1.8" fill="#e7e5e4" />
      </g>
      {busy ? (
        <g className="home-scene-receipt home-scene-receipt-3">
          <rect x="30" y="7" width="40" height="32" rx="2.2" fill="#fff7ed" stroke={`url(#hs-amber-${uid})`} />
        </g>
      ) : null}
    </g>
  );
}

function BackOfficeScene({ uid }: { uid: string }) {
  return (
    <g className="home-scene-shop">
      <rect x="10" y="30" width="68" height="16" rx="2.4" fill={`url(#hs-wood-${uid})`} />
      <rect x="12" y="32" width="64" height="3" fill="#fde68a" opacity="0.18" />
      <rect className="home-scene-monitor" x="28" y="8" width="34" height="22" rx="2.4" fill={`url(#hs-ink-${uid})`} />
      <rect x="31" y="11" width="28" height="14" rx="1.2" fill="#99f6e4" opacity="0.55" />
      <rect x="42" y="30" width="6" height="4" fill="#44403c" />
      <g className="home-scene-docs">
        <rect x="12" y="24" width="13" height="9" rx="1" fill="#fff" />
        <rect x="64" y="22" width="11" height="9" rx="1" fill="#fed7aa" />
      </g>
    </g>
  );
}

function ProfitScene({ uid, intensity }: { uid: string; intensity: HomeTileIntensity }) {
  const up = intensity === "high" || intensity === "normal";
  return (
    <g className="home-scene-profit">
      <rect className="home-scene-grow home-scene-grow-1" x="14" y="34" width="12" height="14" rx="2" fill="#6ee7b7" />
      <rect className="home-scene-grow home-scene-grow-2" x="30" y="26" width="12" height="22" rx="2" fill="#34d399" />
      <rect className="home-scene-grow home-scene-grow-3" x="46" y="16" width="12" height="32" rx="2" fill="#059669" />
      <path
        className="home-scene-trail"
        d={up ? "M12 38 L32 28 L48 18 L74 10" : "M12 28 L32 30 L48 33 L74 36"}
        fill="none"
        stroke={`url(#hs-amber-${uid})`}
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </g>
  );
}

function CommandCenterScene({ uid, intensity }: { uid: string; intensity: HomeTileIntensity }) {
  const live = intensity === "high" || intensity === "normal";
  return (
    <g className="home-scene-commandCenter">
      <path className="home-scene-net" d="M44 16 L24 34 M44 16 L64 34 M24 34 L44 44 L64 34" fill="none" stroke="#a5b4fc" strokeWidth="1.4" />
      <circle className="home-scene-hub" cx="44" cy="16" r="5.5" fill={live ? `url(#hs-amber-${uid})` : `url(#hs-metal-${uid})`} />
      <circle className="home-scene-spoke home-scene-spoke-1" cx="24" cy="34" r="4.5" fill={`url(#hs-teal-${uid})`} />
      <circle className="home-scene-spoke home-scene-spoke-2" cx="64" cy="34" r="4.5" fill={`url(#hs-teal-${uid})`} />
      <circle className="home-scene-spoke home-scene-spoke-3" cx="44" cy="44" r="4.2" fill={`url(#hs-ink-${uid})`} />
    </g>
  );
}

function InvestigationScene({ uid }: { uid: string }) {
  return (
    <g className="home-scene-investigation">
      <rect x="16" y="14" width="36" height="30" rx="2" fill="#fff" stroke="#d6d3d1" />
      <rect x="21" y="20" width="24" height="2" fill="#e7e5e4" />
      <rect x="21" y="26" width="18" height="2" fill="#e7e5e4" />
      <rect className="home-scene-scan" x="16" y="18" width="36" height="4" fill={`url(#hs-amber-${uid})`} opacity="0.35" />
      <g className="home-scene-lens">
        <circle cx="62" cy="30" r="10" fill="none" stroke={`url(#hs-metal-${uid})`} strokeWidth="3" />
        <line x1="70" y1="38" x2="78" y2="46" stroke={`url(#hs-ink-${uid})`} strokeWidth="3" strokeLinecap="round" />
      </g>
    </g>
  );
}

function SettingsScene({ uid }: { uid: string }) {
  return (
    <g className="home-scene-settings">
      <rect x="16" y="16" width="36" height="8" rx="4" fill={`url(#hs-ink-${uid})`} />
      <circle className="home-scene-knob home-scene-knob-1" cx="28" cy="20" r="4.5" fill={`url(#hs-metal-${uid})`} />
      <rect x="16" y="32" width="36" height="8" rx="4" fill={`url(#hs-ink-${uid})`} />
      <circle className="home-scene-knob home-scene-knob-2" cx="40" cy="36" r="4.5" fill={`url(#hs-amber-${uid})`} />
      <g className="home-scene-gear">
        <circle cx="68" cy="28" r="8" fill={`url(#hs-metal-${uid})`} />
        <circle cx="68" cy="28" r="3" fill="#44403c" />
      </g>
    </g>
  );
}

function DashboardScene({ uid }: { uid: string }) {
  return (
    <g className="home-scene-dashboard">
      <rect x="16" y="12" width="24" height="16" rx="3" fill={`url(#hs-teal-${uid})`} />
      <rect x="44" y="12" width="24" height="16" rx="3" fill={`url(#hs-amber-${uid})`} opacity="0.85" />
      <rect x="16" y="32" width="52" height="14" rx="3" fill={`url(#hs-ink-${uid})`} />
    </g>
  );
}

function AgentScene({ uid }: { uid: string }) {
  return (
    <g className="home-scene-agent">
      <circle cx="30" cy="20" r="7" fill="#f5d0b0" />
      <path d="M20 42c2-12 8-16 10-16s8 4 10 16" fill={`url(#hs-teal-${uid})`} />
      <circle cx="58" cy="20" r="7" fill="#f5d0b0" />
      <path d="M48 42c2-12 8-16 10-16s8 4 10 16" fill={`url(#hs-amber-${uid})`} />
      <rect className="home-scene-handshake" x="38" y="30" width="12" height="6" rx="3" fill="#f5d0b0" />
    </g>
  );
}

function FallbackScene({ uid }: { uid: string }) {
  return (
    <g className="home-scene-fallback">
      <rect x="22" y="14" width="44" height="30" rx="8" fill={`url(#hs-ink-${uid})`} />
      <circle cx="44" cy="29" r="8" fill={`url(#hs-amber-${uid})`} />
    </g>
  );
}
