import { useEffect, useState } from "react";
import { readSyncQueue } from "../../offline/localDb";
import { estimateEntityStoreBytes } from "../../offline/entityStore";
import { usePosStore } from "../../store/usePosStore";
import {
  getCloudPullStats,
  getLastMergeMs,
  getLastSyncMs,
  getLongTaskCount,
  getPersistStats,
  networkRequestsLastMinute,
  readJsHeapMb,
} from "../../lib/stabilityDiagnostics";
import { readSyncCheckpoints } from "../../lib/syncCheckpoints";

export function StabilityDiagnosticsOverlay() {
  const [tick, setTick] = useState(0);
  const [idbBytes, setIdbBytes] = useState(0);
  const [queueLen, setQueueLen] = useState(0);

  const salesLen = usePosStore((s) => s.sales.length);
  const archivedLen = usePosStore((s) => s.archivedSales.length);
  const productsLen = usePosStore((s) => s.products.length);
  const customersLen = usePosStore((s) => s.customers.length);

  useEffect(() => {
    const id = window.setInterval(() => {
      setTick((t) => t + 1);
      void estimateEntityStoreBytes().then(setIdbBytes);
      void readSyncQueue().then((q) => setQueueLen(q.length));
    }, 2000);
    return () => window.clearInterval(id);
  }, []);

  const heap = readJsHeapMb();
  const persist = getPersistStats();
  const cloudPull = getCloudPullStats();
  const checkpoints = readSyncCheckpoints();
  const mergeMs = getLastMergeMs();
  const syncMs = getLastSyncMs();
  const netMin = networkRequestsLastMinute();
  const longTasks = getLongTaskCount();

  return (
    <div
      className="pointer-events-none fixed bottom-2 left-2 z-[9999] max-w-[min(100vw-1rem,24rem)] rounded-xl border border-stone-700/80 bg-stone-950/92 px-3 py-2 font-mono text-[10px] leading-relaxed text-emerald-300 shadow-lg backdrop-blur-sm"
      aria-hidden
    >
      <p className="font-bold text-amber-300">Waka stability</p>
      <p>
        Sales active {salesLen} · archived {archivedLen} · products {productsLen} · customers {customersLen}
      </p>
      <p>
        Heap {heap != null ? `${heap} MB` : "n/a"} · IDB ~{(idbBytes / 1024).toFixed(0)} KB · queue {queueLen}
      </p>
      <p>
        Net/min {netMin} · incr persists {persist.incrementalCount} ({persist.lastIncrementalEntityWrites} ents,{" "}
        {persist.lastIncrementalDurationMs}ms)
      </p>
      <p>
        Full snapshots {persist.fullCount} ({persist.lastFullDurationMs}ms) · merge {mergeMs ?? "—"}ms · sync{" "}
        {syncMs ?? "—"}ms
      </p>
      <p>
        Cloud pulls incr {cloudPull.incrementalPulls} · full {cloudPull.fullPulls} · records {cloudPull.totalRecords}{" "}
        · payload ~{(cloudPull.totalPayloadBytes / 1024).toFixed(0)} KB
      </p>
      {cloudPull.lastPull ? (
        <p>
          Last pull {cloudPull.lastPull.mode} · {cloudPull.lastPull.sales} sales · {cloudPull.lastPull.products} prod ·{" "}
          {cloudPull.lastPull.durationMs}ms · {(cloudPull.lastPull.payloadBytes / 1024).toFixed(1)} KB
        </p>
      ) : null}
      <p className="text-stone-500">
        Checkpoints bootstrap {checkpoints.bootstrapComplete ? "yes" : "no"} · sales{" "}
        {checkpoints.lastSalesSyncAt?.slice(11, 19) ?? "—"}
      </p>
      <p className={longTasks > 0 ? "text-rose-400" : "text-stone-500"}>
        Long tasks {longTasks} · listeners 0 realtime · tick {tick}
      </p>
    </div>
  );
}
