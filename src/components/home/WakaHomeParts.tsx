import { useEffect, useState } from "react";
import { ArrowUpRight, ChevronRight, Plus, ShieldCheck, Wifi } from "lucide-react";
import {
  HOME_HEALTH,
  HOME_KPIS,
  HOME_SPARKLINE,
  HOME_TILES,
  greetingFor,
  type HealthStatus,
  type HomeTile,
  type KpiTone,
} from "@/lib/wakaHomeData";

const toneText: Record<KpiTone, string> = {
  neutral: "text-muted-foreground",
  positive: "text-success",
  warning: "text-warning",
  danger: "text-danger",
};

const statusDot: Record<HealthStatus, string> = {
  ok: "bg-success",
  warn: "bg-warning",
  bad: "bg-danger",
};

export function WakaLogo({ className = "" }: { className?: string }) {
  return (
    <span
      className={`grid size-11 shrink-0 place-items-center rounded-2xl text-lg font-black tracking-tight ${className}`}
      style={{ backgroundImage: "var(--gradient-waka)", color: "var(--waka-foreground)", boxShadow: "var(--shadow-waka)" }}
      aria-hidden
    >
      W
    </span>
  );
}

export function HomeHero({ operator, shop }: { operator: string; shop: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <section className="waka-rise grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-3">
          <WakaLogo />
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-waka">Waka POS · Terminal home</p>
            <h1 className="truncate text-2xl font-black sm:text-3xl lg:text-4xl">
              {greetingFor(now.getHours())}, {operator}
            </h1>
          </div>
        </div>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground sm:text-base">
          Here's what's happening in your business today — {shop}.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <span className="waka-card flex items-center gap-2 rounded-full px-3.5 py-2 text-xs font-bold">
          <span className={`waka-live-dot size-2 rounded-full ${statusDot.ok}`} />
          Online · synced
        </span>
        <button
          type="button"
          className="group inline-flex items-center gap-2 rounded-2xl px-5 py-3.5 text-sm font-black tracking-tight transition-transform duration-200 hover:-translate-y-0.5 active:translate-y-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-waka sm:text-base"
          style={{ backgroundImage: "var(--gradient-waka)", color: "var(--waka-foreground)", boxShadow: "var(--shadow-waka)" }}
        >
          <Plus className="size-5" />
          New sale
          <ArrowUpRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </button>
      </div>
    </section>
  );
}

export function Sparkline() {
  const max = Math.max(...HOME_SPARKLINE);
  const pts = HOME_SPARKLINE.map((v, i) => `${(i / (HOME_SPARKLINE.length - 1)) * 100},${34 - (v / max) * 30}`).join(" ");
  return (
    <svg viewBox="0 0 100 36" preserveAspectRatio="none" className="h-10 w-full" aria-hidden>
      <defs>
        <linearGradient id="waka-spark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--waka)" stopOpacity="0.45" />
          <stop offset="100%" stopColor="var(--waka)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,36 ${pts} 100,36`} fill="url(#waka-spark)" />
      <polyline points={pts} fill="none" stroke="var(--waka)" strokeWidth="1.6" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function KpiStrip() {
  return (
    <section aria-label="Today at a glance" className="waka-rise" style={{ animationDelay: "60ms" }}>
      <SectionHead title="Today at a glance" sub="Live figures from this terminal" />
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {HOME_KPIS.map((kpi, i) => (
          <button
            key={kpi.id}
            type="button"
            className="waka-tile group flex flex-col items-start gap-2 p-3.5 text-left sm:p-4"
            style={{ ["--tile-accent" as string]: "var(--waka)", animationDelay: `${80 + i * 35}ms` }}
          >
            <span className="flex w-full items-center justify-between gap-2">
              <kpi.Icon className={`size-4 shrink-0 ${toneText[kpi.tone]}`} />
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
            </span>
            <span className="truncate text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{kpi.label}</span>
            <span className="text-lg font-black tabular-nums leading-none sm:text-xl">{kpi.value}</span>
            <span className={`truncate text-[11px] font-semibold ${toneText[kpi.tone]}`}>{kpi.hint}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function PulseCard() {
  return (
    <div className="waka-card flex flex-col gap-3 p-4 sm:p-5">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Sales pulse</p>
          <p className="mt-1 text-2xl font-black tabular-nums">UGX 4.82M</p>
        </div>
        <span className="shrink-0 rounded-full bg-success/15 px-2.5 py-1 text-[11px] font-black text-success">+12.4%</span>
      </div>
      <Sparkline />
      <p className="text-xs text-muted-foreground">Last 12 hours · peak at 14:00</p>
    </div>
  );
}

export function HealthRail() {
  return (
    <div className="waka-card flex flex-col gap-3 p-4 sm:p-5">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Business health</p>
          <p className="truncate text-sm font-bold">All critical systems steady</p>
        </div>
        <button type="button" className="shrink-0 text-xs font-black text-waka underline-offset-4 hover:underline">
          Command center
        </button>
      </div>
      <ul className="grid gap-1.5 sm:grid-cols-2">
        {HOME_HEALTH.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className="flex min-h-11 w-full items-center gap-2 rounded-xl border border-border bg-secondary/40 px-2.5 py-2 text-left text-xs font-bold transition-colors duration-200 hover:bg-secondary"
            >
              <span className={`waka-live-dot size-2 shrink-0 rounded-full ${statusDot[item.status]}`} />
              <span className="truncate">{item.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Tile({ tile, index }: { tile: HomeTile; index: number }) {
  return (
    <button
      type="button"
      className="waka-tile waka-rise group flex flex-col items-start gap-3 p-4 text-left sm:p-5"
      style={{ ["--tile-accent" as string]: tile.accent, animationDelay: `${120 + index * 40}ms` }}
    >
      <span className="waka-tile-glow" />
      <span
        className="grid size-11 place-items-center rounded-2xl border border-border transition-transform duration-300 group-hover:scale-105"
        style={{ backgroundColor: `color-mix(in oklab, ${tile.accent} 18%, transparent)`, color: tile.accent }}
      >
        <tile.Icon className="size-5" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-base font-black tracking-tight">{tile.label}</span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{tile.hint}</span>
      </span>
    </button>
  );
}

export function SectionHead({ title, sub, action }: { title: string; sub: string; action?: string }) {
  return (
    <div className="mb-3 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
      <div className="min-w-0">
        <h2 className="text-sm font-black uppercase tracking-[0.16em] sm:text-base">{title}</h2>
        <p className="truncate text-xs text-muted-foreground">{sub}</p>
      </div>
      {action ? (
        <button type="button" className="shrink-0 text-xs font-black text-waka underline-offset-4 hover:underline">
          {action}
        </button>
      ) : null}
    </div>
  );
}

export function TileGrid({ group, title, sub }: { group: HomeTile["group"]; title: string; sub: string }) {
  const tiles = HOME_TILES.filter((t) => t.group === group);
  return (
    <section aria-label={title}>
      <SectionHead title={title} sub={sub} />
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-3 xl:grid-cols-5">
        {tiles.map((tile, i) => (
          <Tile key={tile.id} tile={tile} index={i} />
        ))}
      </div>
    </section>
  );
}

export function LicenseBar({ shop }: { shop: string }) {
  return (
    <footer className="waka-card mt-2 grid grid-cols-1 items-center gap-3 rounded-2xl px-4 py-3 text-xs sm:grid-cols-[minmax(0,1fr)_auto] sm:px-5">
      <div className="flex min-w-0 items-center gap-2.5">
        <ShieldCheck className="size-4 shrink-0 text-success" />
        <span className="truncate font-bold">{shop} · Business plan licensed</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Wifi className="size-3.5 text-success" /> Synced
        </span>
        <span>Device WAKA-TERM-02</span>
        <span>v4.2.0</span>
      </div>
    </footer>
  );
}
