import clsx from "clsx";
import type { SparkPoint } from "../../lib/commandCenterPageView";

type Props = {
  points: SparkPoint[];
  className?: string;
  strokeClass?: string;
  height?: number;
};

export function MiniSparkline({ points, className, strokeClass = "stroke-waka-500", height = 28 }: Props) {
  if (points.length < 2) return <div className={clsx("h-7", className)} aria-hidden />;

  const values = points.map((p) => p.value);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const w = 64;
  const pad = 2;
  const innerH = height - pad * 2;

  const coords = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - pad * 2);
    const y = pad + innerH - ((v - min) / span) * innerH;
    return `${x},${y}`;
  });

  return (
    <svg viewBox={`0 0 ${w} ${height}`} className={clsx("w-full max-w-[72px]", className)} aria-hidden>
      <polyline
        points={coords.join(" ")}
        fill="none"
        className={clsx(strokeClass, "stroke-[1.5]")}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
