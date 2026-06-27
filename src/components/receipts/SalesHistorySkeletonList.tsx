export function SalesHistorySkeletonList({ count = 6 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="animate-pulse rounded-xl border border-stone-200/80 bg-white p-3 motion-reduce:animate-none"
        >
          <div className="flex gap-2.5">
            <div className="h-10 w-10 shrink-0 rounded-xl bg-stone-200" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-3.5 w-2/5 rounded bg-stone-200" />
              <div className="h-3 w-3/5 rounded bg-stone-100" />
              <div className="h-3 w-1/3 rounded bg-stone-100" />
            </div>
            <div className="h-8 w-16 shrink-0 rounded-lg bg-stone-200" />
          </div>
        </div>
      ))}
    </div>
  );
}
