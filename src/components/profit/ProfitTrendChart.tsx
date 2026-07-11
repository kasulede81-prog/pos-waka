import type { DailyProfitPoint } from "../../lib/profitPageView";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { chartFill, chartShellClass, chartStroke } from "../../lib/chartTokens";

type Props = {
  lang: Language;
  points: DailyProfitPoint[];
};

export function ProfitTrendChart({ lang, points }: Props) {
  if (points.length < 2) return null;

  const profits = points.map((p) => p.profitUgx);
  const max = Math.max(...profits, 1);
  const min = Math.min(...profits, 0);
  const span = max - min || 1;
  const w = 320;
  const h = 120;
  const padX = 8;
  const padY = 12;
  const innerW = w - padX * 2;
  const innerH = h - padY * 2;

  const coords = points.map((p, i) => {
    const x = padX + (i / (points.length - 1)) * innerW;
    const y = padY + innerH - ((p.profitUgx - min) / span) * innerH;
    return { x, y, ...p };
  });

  const line = coords.map((c) => `${c.x},${c.y}`).join(" ");
  const area = `M${coords[0]!.x},${h - padY} L${coords.map((c) => `${c.x} ${c.y}`).join(" L")} L${coords[coords.length - 1]!.x},${h - padY} Z`;

  const showLabels = points.length <= 7;
  const labelStep = Math.max(1, Math.ceil(points.length / 7));

  return (
    <section className={chartShellClass}>
      <h3 className="text-xs font-black text-foreground">{t(lang, "profitTrendTitle")}</h3>
      <div className="mt-2 overflow-x-auto">
        <svg viewBox={`0 0 ${w} ${h + (showLabels ? 18 : 0)}`} className="h-auto w-full min-w-[280px]" aria-hidden>
          <defs>
            <linearGradient id="profitTrendFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={chartFill.areaStart} />
              <stop offset="100%" stopColor={chartFill.areaEnd} />
            </linearGradient>
          </defs>
          {[0.25, 0.5, 0.75].map((pct) => (
            <line
              key={pct}
              x1={padX}
              x2={w - padX}
              y1={padY + innerH * (1 - pct)}
              y2={padY + innerH * (1 - pct)}
              stroke={chartStroke.grid}
              strokeWidth="1"
              strokeDasharray="4 4"
            />
          ))}
          <path d={area} fill="url(#profitTrendFill)" />
          <polyline
            fill="none"
            stroke={chartStroke.secondary}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={line}
          />
          {coords.map((c) => (
            <circle key={c.dayKey} cx={c.x} cy={c.y} r="3.5" fill={chartStroke.secondary} />
          ))}
          {showLabels
            ? coords.map((c, i) =>
                i % labelStep === 0 || i === coords.length - 1 ? (
                  <text
                    key={`lbl-${c.dayKey}`}
                    x={c.x}
                    y={h + 14}
                    textAnchor="middle"
                    fill={chartStroke.label}
                  >
                    {c.label}
                  </text>
                ) : null,
              )
            : null}
        </svg>
      </div>
    </section>
  );
}
