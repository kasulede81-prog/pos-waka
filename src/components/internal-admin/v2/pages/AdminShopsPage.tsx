import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Language } from "../../../../types";
import { internalAdminShopHref, PREVIEW_RECENT_SHOPS } from "../../../../lib/internalAdminPreview";
import {
  adminSetShopActive,
  fetchInternalOpsSearchShops,
  filterAdminShopListRows,
  formatDisplayEmail,
  formatOwnerDisplayLabel,
  type RecentShopRow,
  type WakaInternalAdminRow,
} from "../../../../lib/wakaInternalAdmin";
import { computeShopHealth } from "../../../../lib/internalOpsIntelligence";
import { adminPermissions } from "../adminRoles";
import { MassActionBar, SupportTagsRow } from "../ops/OpsWidgets";
import { EmptyState, ShopCard } from "../primitives";

const SHOPS_PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;

/** Shared generation check for search reset vs in-flight load-more. */
export function isCurrentAdminShopsRequest(startedSeq: number, latestSeq: number): boolean {
  return startedSeq === latestSeq;
}

/** Append load-more rows only when the request still belongs to the current search. */
export function applyAdminShopsLoadMore<T>(args: {
  startedSeq: number;
  latestSeq: number;
  previous: T[];
  incoming: T[];
}): { applied: boolean; rows: T[] } {
  if (!isCurrentAdminShopsRequest(args.startedSeq, args.latestSeq)) {
    return { applied: false, rows: args.previous };
  }
  return { applied: true, rows: [...args.previous, ...args.incoming] };
}

type Props = {
  lang: Language;
  adminRow: WakaInternalAdminRow | null;
  previewMode: boolean;
};

export function AdminShopsPage({ adminRow, previewMode }: Props) {
  const navigate = useNavigate();
  const perms = adminPermissions(adminRow);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [district, setDistrict] = useState("");
  const [plan, setPlan] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "inactive">("all");
  const [sort, setSort] = useState<"health" | "recent">("recent");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [massBusy, setMassBusy] = useState(false);
  const [serverRows, setServerRows] = useState<RecentShopRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(!previewMode);
  const [loadingMore, setLoadingMore] = useState(false);
  const requestSeq = useRef(0);

  useEffect(() => {
    const delay = search.trim() ? SEARCH_DEBOUNCE_MS : 0;
    const timer = window.setTimeout(() => setDebouncedSearch(search), delay);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (previewMode) {
      setServerRows([]);
      setHasMore(false);
      setSearchError(null);
      setListLoading(false);
      return;
    }

    let cancelled = false;
    const seq = ++requestSeq.current;
    setListLoading(true);
    setLoadingMore(false);
    setSearchError(null);
    setSelected({});

    void fetchInternalOpsSearchShops({
      query: debouncedSearch,
      limit: SHOPS_PAGE_SIZE,
      offset: 0,
    }).then((result) => {
      if (cancelled || seq !== requestSeq.current) return;
      setServerRows(result.rows);
      setHasMore(result.hasMore);
      setSearchError(result.error);
      setListLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [debouncedSearch, previewMode]);

  const loadMore = async () => {
    if (previewMode || loadingMore || !hasMore || searchError) return;
    const seq = requestSeq.current;
    setLoadingMore(true);
    const result = await fetchInternalOpsSearchShops({
      query: debouncedSearch,
      limit: SHOPS_PAGE_SIZE,
      offset: serverRows.length,
    });
    if (!isCurrentAdminShopsRequest(seq, requestSeq.current)) return;
    if (result.error) {
      setSearchError(result.error);
    } else {
      const merged = applyAdminShopsLoadMore({
        startedSeq: seq,
        latestSeq: requestSeq.current,
        previous: serverRows,
        incoming: result.rows,
      });
      if (!merged.applied) return;
      setServerRows(merged.rows);
      setHasMore(result.hasMore);
    }
    setLoadingMore(false);
  };

  const sourceRows = previewMode ? PREVIEW_RECENT_SHOPS : serverRows;

  const districts = useMemo(() => {
    const set = new Set<string>();
    for (const s of sourceRows) {
      if (s.district) set.add(s.district);
    }
    return [...set].sort();
  }, [sourceRows]);

  const plans = useMemo(() => {
    const set = new Set<string>();
    for (const s of sourceRows) {
      if (s.plan_code) set.add(s.plan_code);
    }
    return [...set].sort();
  }, [sourceRows]);

  const filtered = useMemo(() => {
    let rows = filterAdminShopListRows(sourceRows, {
      query: debouncedSearch,
      district,
      plan,
      status,
      applyQuery: previewMode,
    });
    if (sort === "health") {
      rows = [...rows].sort((a, b) => computeShopHealth(a).score - computeShopHealth(b).score);
    } else {
      rows = [...rows].sort((a, b) => {
        const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
        const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
        return tb - ta;
      });
    }
    return rows;
  }, [sourceRows, district, plan, debouncedSearch, sort, status, previewMode]);

  const selectedIds = Object.keys(selected).filter((id) => selected[id]);

  const runMass = async (action: "suspend" | "extend_trial") => {
    if (previewMode || !perms.canShopSupport) return;
    if (action === "extend_trial") {
      window.alert("Open each shop profile to extend trials (subscription required).");
      return;
    }
    if (!window.confirm(`Suspend ${selectedIds.length} shop(s)?`)) return;
    setMassBusy(true);
    for (const id of selectedIds) {
      await adminSetShopActive(id, false);
    }
    setMassBusy(false);
    setSelected({});
    const result = await fetchInternalOpsSearchShops({
      query: debouncedSearch,
      limit: Math.max(serverRows.length, SHOPS_PAGE_SIZE),
      offset: 0,
    });
    setServerRows(result.rows);
    setHasMore(result.hasMore);
    setSearchError(result.error);
  };

  const emptyMessage = searchError
    ? `Shop search failed. ${searchError}`
    : debouncedSearch.trim()
      ? "No shops match this search."
      : "No shops match filters.";

  return (
    <div className="space-y-4 pb-20">
      <div>
        <h1 className="text-xl font-black text-foreground">Shops</h1>
        <p className="text-sm text-muted-foreground">
          {filtered.length}
          {previewMode ? ` of ${PREVIEW_RECENT_SHOPS.length}` : hasMore ? "+" : ""} loaded ·{" "}
          {sort === "health" ? "health sorted" : "recent sorted"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Status, plan, and district filter loaded results only.
        </p>
        <p className="mt-1 text-xs font-semibold text-amber-900">
          Open a shop → yellow <strong>Account recovery</strong> card to reset owner login or clear Shop Security PIN.
        </p>
      </div>

      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search name, shop number, owner…"
        className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-base font-semibold outline-none focus:ring-2 focus:ring-waka-200"
      />

      <div className="flex flex-wrap gap-2">
        {(["all", "active", "inactive"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={`min-h-[44px] rounded-full px-3 text-xs font-black uppercase ${
              status === s ? "bg-waka-600 text-white" : "bg-card text-muted-foreground ring-1 ring-border"
            }`}
          >
            {s}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setSort(sort === "health" ? "recent" : "health")}
          className="min-h-[44px] rounded-full bg-muted px-3 text-xs font-black uppercase text-muted-foreground"
        >
          Sort: {sort}
        </button>
      </div>

      {plans.length > 0 ? (
        <div className="flex gap-2 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => setPlan("")}
            className={`shrink-0 rounded-full px-3 py-2 text-xs font-bold uppercase ${!plan ? "bg-waka-100 text-waka-800" : "bg-muted"}`}
          >
            All plans
          </button>
          {plans.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPlan(p)}
              className={`shrink-0 rounded-full px-3 py-2 text-xs font-bold uppercase ${plan === p ? "bg-waka-100 text-waka-800" : "bg-muted"}`}
            >
              {p}
            </button>
          ))}
        </div>
      ) : null}

      {districts.length > 0 ? (
        <div className="flex gap-2 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => setDistrict("")}
            className={`shrink-0 rounded-full px-3 py-2 text-xs font-bold ${!district ? "bg-waka-100 text-waka-800" : "bg-muted"}`}
          >
            All districts
          </button>
          {districts.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDistrict(d)}
              className={`shrink-0 rounded-full px-3 py-2 text-xs font-bold ${district === d ? "bg-waka-100 text-waka-800" : "bg-muted"}`}
            >
              {d}
            </button>
          ))}
        </div>
      ) : null}

      {searchError && filtered.length ? (
        <p className="text-sm font-semibold text-red-700">Shop search failed. {searchError}</p>
      ) : null}

      {listLoading && !filtered.length ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
      ) : searchError && !filtered.length ? (
        <EmptyState>{emptyMessage}</EmptyState>
      ) : filtered.length === 0 ? (
        <EmptyState>{emptyMessage}</EmptyState>
      ) : (
        <ul className="space-y-3">
          {filtered.map((s) => {
            const health = computeShopHealth(s);
            return (
              <li key={s.id}>
                <ShopCard
                  name={s.name}
                  shopNumber={s.shop_number}
                  district={[s.district, s.city].filter(Boolean).join(" · ") || "—"}
                  planCode={s.plan_code ?? "—"}
                  isActive={s.is_active}
                  ownerLabel={
                    formatDisplayEmail(s.owner_email) ??
                    formatOwnerDisplayLabel({ ownerFullName: s.owner_full_name, ownerLabel: s.owner_label }) ??
                    undefined
                  }
                  productCount={s.product_count}
                  salesHint={s.sale_count_30d != null ? `${s.sale_count_30d} sales (30d)` : undefined}
                  healthScore={health.score}
                  healthLevel={health.level}
                  selected={Boolean(selected[s.id])}
                  onToggleSelect={
                    perms.canShopSupport
                      ? () => setSelected((prev) => ({ ...prev, [s.id]: !prev[s.id] }))
                      : undefined
                  }
                  onOpen={() => navigate(internalAdminShopHref(s.id, previewMode))}
                />
                <SupportTagsRow tags={health.tags} />
              </li>
            );
          })}
        </ul>
      )}

      {!previewMode && hasMore && !searchError ? (
        <button
          type="button"
          onClick={() => void loadMore()}
          disabled={loadingMore}
          className="min-h-[44px] w-full rounded-2xl bg-card text-sm font-black text-waka-800 ring-1 ring-border disabled:opacity-60"
        >
          {loadingMore ? "Loading…" : "Load more"}
        </button>
      ) : null}

      <MassActionBar
        count={massBusy ? 0 : selectedIds.length}
        onClear={() => setSelected({})}
        onAction={(a) => void runMass(a)}
      />
    </div>
  );
}
