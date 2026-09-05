import { enterpriseMotion } from "../../lib/enterpriseMotion";

export function SalesHistorySkeletonList({ count = 6 }: { count?: number }) {
  return (
    <div className="space-y-3" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-2xl border border-border/80 bg-card p-4 shadow-elev">
          <div className="flex gap-3">
            <div className={`h-11 w-11 shrink-0 rounded-xl ${enterpriseMotion.skeleton}`} />
            <div className="min-w-0 flex-1 space-y-2.5">
              <div className={`h-4 w-2/5 rounded ${enterpriseMotion.skeleton}`} />
              <div className={`h-3.5 w-3/5 rounded ${enterpriseMotion.skeleton}`} />
              <div className={`h-3.5 w-1/3 rounded ${enterpriseMotion.skeleton}`} />
            </div>
            <div className={`h-9 w-20 shrink-0 rounded-xl ${enterpriseMotion.skeleton}`} />
          </div>
        </div>
      ))}
    </div>
  );
}
