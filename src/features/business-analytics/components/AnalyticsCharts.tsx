import type { SparkPoint } from "../../../lib/commandCenterPageView";
import { chartColorFromClassHint, chartFill, chartSeriesFills, chartShellClass, chartStroke } from "../../../lib/chartTokens";

type Props = {
  points: SparkPoint[];
  title?: string;
  height?: number;
};

export function AnalyticsTrendChart({ points, title, height = 120 }: Props) {
  if (points.length < 2) return null;
  const values = points.map((p) => p.value);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const w = 320;
  const h = height;
  const pad = 12;
  const coords = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / span) * (h - pad * 2);
    return { x, y };
  });
  const line = coords.map((c) => `${c.x},${c.y}`).join(" ");
  const area = `${pad},${h - pad} ${line} ${w - pad},${h - pad}`;

  return (
    <section className={chartShellClass}>
      {title ? <p className="mb-3 text-sm font-black text-foreground">{title}</p> : null}
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" aria-hidden>
        <defs>
          <linearGradient id="baTrendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={chartFill.areaStart} />
            <stop offset="100%" stopColor={chartFill.areaEnd} />
          </linearGradient>
        </defs>
        <polygon points={area} fill="url(#baTrendFill)" />
        <polyline
          points={line}
          fill="none"
          stroke={chartStroke.primary}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {coords.map((c, i) => (
          <circle
            key={i}
            cx={c.x}
            cy={c.y}
            r="3"
            fill={chartFill.dotStroke}
            stroke={chartStroke.primary}
            strokeWidth="2"
          />
        ))}
      </svg>
    </section>
  );
}

type Bar = { label: string; total: number; barPx: number };

export function AnalyticsBarChart({ title, bars }: { title: string; bars: Bar[] }) {
  if (bars.length === 0) return null;
  return (
    <section className={chartShellClass}>
      <p className="mb-3 text-sm font-black text-foreground">{title}</p>
      <div className="flex h-28 items-end justify-between gap-1 px-1">
        {bars.map((b) => (
          <div key={b.label} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1">
            <div
              className="w-full max-w-[2.25rem] rounded-t-lg bg-gradient-to-t from-waka-700 to-waka-500 transition-all"
              style={{ height: b.barPx }}
              title={`UGX ${b.total.toLocaleString()}`}
            />
            <span className="text-[10px] font-bold text-muted-foreground">{b.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

type DonutSlice = { label: string; pct: number; colorClass: string };

export function AnalyticsDonutChart({ title, slices }: { title: string; slices: DonutSlice[] }) {
  if (slices.length === 0) return null;
  let offset = 0;
  const gradient = slices
    .map((s) => {
      const start = offset;
      offset += s.pct;
      const color = chartColorFromClassHint(s.colorClass);
      return `${color} ${start}% ${offset}%`;
    })
    .join(", ");

  return (
    <section className={chartShellClass}>
      <p className="mb-3 text-sm font-black text-foreground">{title}</p>
      <div className="flex items-center gap-4">
        <div
          className="h-24 w-24 shrink-0 rounded-full"
          style={{ background: `conic-gradient(${gradient})` }}
          aria-hidden
        />
        <ul className="min-w-0 flex-1 space-y-1.5">
          {slices.map((s, i) => (
            <li key={s.label} className="flex items-center justify-between gap-2 text-xs font-semibold text-foreground">
              <span className="flex items-center gap-2 truncate">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: chartSeriesFills[i % chartSeriesFills.length] }}
                  aria-hidden
                />
                {s.label}
              </span>
              <span className="tabular-nums text-muted-foreground">{s.pct.toFixed(0)}%</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
