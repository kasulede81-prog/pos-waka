import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Language } from "../../../../types";
import { internalAdminShopHref } from "../../../../lib/internalAdminPreview";
import { adminSetShopActive, formatDisplayEmail, type WakaInternalAdminRow } from "../../../../lib/wakaInternalAdmin";
import { useInternalOpsData } from "../../../../hooks/useInternalOpsData";
import { adminPermissions } from "../adminRoles";
import { MassActionBar, SupportTagsRow } from "../ops/OpsWidgets";
import { EmptyState, ShopCard } from "../primitives";

type Props = {
  lang: Language;
  adminRow: WakaInternalAdminRow | null;
  previewMode: boolean;
};

export function AdminShopsPage({ adminRow, previewMode }: Props) {
  const navigate = useNavigate();
  const perms = adminPermissions(adminRow);
  const data = useInternalOpsData(adminRow, previewMode);
  const [search, setSearch] = useState("");
  const [district, setDistrict] = useState("");
  const [plan, setPlan] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "inactive">("all");
  const [sort, setSort] = useState<"health" | "recent">("recent");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [massBusy, setMassBusy] = useState(false);

  const districts = useMemo(() => {
    const set = new Set<string>();
    for (const s of data.shopOpenings) {
      if (s.district) set.add(s.district);
    }
    return [...set].sort();
  }, [data.shopOpenings]);

  const plans = useMemo(() => {
    const set = new Set<string>();
    for (const s of data.shopOpenings) {
      if (s.plan_code) set.add(s.plan_code);
    }
    return [...set].sort();
  }, [data.shopOpenings]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = data.shopOpenings.filter((s) => {
      if (district && s.district !== district) return false;
      if (plan && (s.plan_code ?? "") !== plan) return false;
      if (status === "active" && !s.is_active) return false;
      if (status === "inactive" && s.is_active) return false;
      if (!q) return true;
      const owner = formatDisplayEmail(s.owner_email) ?? s.owner_label ?? "";
      return (
        s.name.toLowerCase().includes(q) ||
        owner.toLowerCase().includes(q) ||
        (s.district ?? "").toLowerCase().includes(q)
      );
    });
    if (sort === "health") {
      rows = [...rows].sort((a, b) => {
        const ha = data.shopHealthById.get(a.id)?.score ?? 0;
        const hb = data.shopHealthById.get(b.id)?.score ?? 0;
        return ha - hb;
      });
    } else {
      rows = [...rows].sort((a, b) => {
        const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
        const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
        return tb - ta;
      });
    }
    return rows;
  }, [data.shopOpenings, data.shopHealthById, district, plan, search, sort, status]);

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
    void data.loadAll();
  };

  return (
    <div className="space-y-4 pb-20">
      <div>
        <h1 className="text-xl font-black text-stone-900">Shops</h1>
        <p className="text-sm text-stone-500">{filtered.length} of {data.shopOpenings.length} · health sorted</p>
      </div>

      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search name, owner, district…"
        className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-base font-semibold outline-none focus:ring-2 focus:ring-orange-200"
      />

      <div className="flex flex-wrap gap-2">
        {(["all", "active", "inactive"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={`min-h-[44px] rounded-full px-3 text-xs font-black uppercase ${
              status === s ? "bg-orange-600 text-white" : "bg-white text-stone-600 ring-1 ring-stone-200"
            }`}
          >
            {s}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setSort(sort === "health" ? "recent" : "health")}
          className="min-h-[44px] rounded-full bg-stone-100 px-3 text-xs font-black uppercase text-stone-700"
        >
          Sort: {sort}
        </button>
      </div>

      {plans.length > 0 ? (
        <div className="flex gap-2 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => setPlan("")}
            className={`shrink-0 rounded-full px-3 py-2 text-xs font-bold uppercase ${!plan ? "bg-orange-100 text-orange-800" : "bg-stone-100"}`}
          >
            All plans
          </button>
          {plans.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPlan(p)}
              className={`shrink-0 rounded-full px-3 py-2 text-xs font-bold uppercase ${plan === p ? "bg-orange-100 text-orange-800" : "bg-stone-100"}`}
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
            className={`shrink-0 rounded-full px-3 py-2 text-xs font-bold ${!district ? "bg-orange-100 text-orange-800" : "bg-stone-100"}`}
          >
            All districts
          </button>
          {districts.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDistrict(d)}
              className={`shrink-0 rounded-full px-3 py-2 text-xs font-bold ${district === d ? "bg-orange-100 text-orange-800" : "bg-stone-100"}`}
            >
              {d}
            </button>
          ))}
        </div>
      ) : null}

      {data.opsLoading && !filtered.length ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl bg-stone-200" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState>No shops match filters.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {filtered.map((s) => {
            const health = data.shopHealthById.get(s.id);
            return (
              <li key={s.id}>
                <ShopCard
                  name={s.name}
                  district={[s.district, s.city].filter(Boolean).join(" · ") || "—"}
                  planCode={s.plan_code ?? "—"}
                  isActive={s.is_active}
                  ownerLabel={formatDisplayEmail(s.owner_email) ?? s.owner_label ?? undefined}
                  productCount={s.product_count}
                  salesHint={s.sale_count_30d != null ? `${s.sale_count_30d} sales (30d)` : undefined}
                  healthScore={health?.score}
                  healthLevel={health?.level}
                  selected={Boolean(selected[s.id])}
                  onToggleSelect={
                    perms.canShopSupport
                      ? () => setSelected((prev) => ({ ...prev, [s.id]: !prev[s.id] }))
                      : undefined
                  }
                  onOpen={() => navigate(internalAdminShopHref(s.id, previewMode))}
                />
                {health ? <SupportTagsRow tags={health.tags} /> : null}
              </li>
            );
          })}
        </ul>
      )}

      <MassActionBar
        count={massBusy ? 0 : selectedIds.length}
        onClear={() => setSelected({})}
        onAction={(a) => void runMass(a)}
      />
    </div>
  );
}
