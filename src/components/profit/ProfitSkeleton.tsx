export function ProfitSkeletonList({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="animate-pulse rounded-2xl border border-border/80 bg-card p-3 motion-reduce:animate-none"
        >
          <div className="flex gap-2.5">
            <div className="h-10 w-10 shrink-0 rounded-xl bg-muted" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-3.5 w-2/5 rounded bg-muted" />
              <div className="h-3 w-3/5 rounded bg-muted" />
              <div className="grid grid-cols-2 gap-2">
                <div className="h-3 rounded bg-muted" />
                <div className="h-3 rounded bg-muted" />
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function ProfitStatGridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-2">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="min-h-[76px] animate-pulse rounded-2xl border border-border bg-card p-2.5 motion-reduce:animate-none">
          <div className="h-7 w-7 rounded-lg bg-muted" />
          <div className="mt-3 h-5 w-2/3 rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}
