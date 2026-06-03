import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import clsx from "clsx";
import { Settings, ChefHat, ClipboardList } from "lucide-react";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { useSessionActor } from "../context/SessionActorContext";
import { hasPermission } from "../lib/permissions";
import {
  TABLE_STATUS_COLORS,
  activeNamedTabs,
  activeSessionForTable,
  isHospitalityMode,
  pendingSaleTotal,
  sessionDisplayLabel,
  totalOpenTablesPendingUgx,
} from "../lib/hospitality";
import { formatUgx } from "../lib/formatUgx";
import { pendingSales } from "../lib/saleStatus";
import { useShallow } from "zustand/react/shallow";

const GUEST_COUNTS = [1, 2, 3, 4, 5, 6] as const;

import { useHospitalityFloorPoll } from "../hooks/useHospitalityFloorPoll";

export function FloorPlanPage({ lang }: { lang: Language }) {
  const navigate = useNavigate();
  const actor = useSessionActor();
  const ensureHospitalityFloor = usePosStore((s) => s.ensureHospitalityFloor);
  const openTable = usePosStore((s) => s.openTable);
  const openNamedTab = usePosStore((s) => s.openNamedTab);
  const resumeTableSession = usePosStore((s) => s.resumeTableSession);
  const { businessType, hospitalityModeEnabled, floor, sales } = usePosStore(
    useShallow((s) => ({
      businessType: s.preferences.businessType,
      hospitalityModeEnabled: s.preferences.hospitalityModeEnabled,
      floor: s.preferences.hospitalityFloor,
      sales: s.sales,
    })),
  );

  const [areaId, setAreaId] = useState<string | null>(null);
  const [openSheetTableId, setOpenSheetTableId] = useState<string | null>(null);
  const [newTabOpen, setNewTabOpen] = useState(false);
  const [tabLabel, setTabLabel] = useState("");
  const [guestCount, setGuestCount] = useState(2);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    ensureHospitalityFloor();
  }, [ensureHospitalityFloor]);

  const hospitality = isHospitalityMode(businessType, hospitalityModeEnabled);
  useHospitalityFloorPoll(hospitality);
  const areas = floor?.areas.filter((a) => a.isActive) ?? [];
  const activeAreaId = areaId ?? areas[0]?.id ?? null;
  const tables = useMemo(
    () => (floor?.tables ?? []).filter((tbl) => tbl.areaId === activeAreaId && tbl.isActive).sort((a, b) => a.sortOrder - b.sortOrder),
    [floor?.tables, activeAreaId],
  );

  const pendingTotal = floor ? totalOpenTablesPendingUgx(sales, floor) : 0;
  const pendingCount = useMemo(() => pendingSales(sales).length, [sales]);
  const canKitchen = hasPermission(actor.role, "hospitality.kitchen");
  const canPendingList = hasPermission(actor.role, "pending_sales.manage");
  const canOrder = hasPermission(actor.role, "hospitality.order");
  const namedTabs = floor ? activeNamedTabs(floor) : [];

  if (!hospitality) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center">
        <p className="text-sm font-medium text-slate-600">{t(lang, "hospitalityNotEnabled")}</p>
      </div>
    );
  }

  const openSheetTable = tables.find((tbl) => tbl.id === openSheetTableId);

  const handleOpenTable = () => {
    if (!openSheetTableId || busy) return;
    setBusy(true);
    const res = openTable({
      tableId: openSheetTableId,
      guestCount: guestCount >= 6 ? 6 : guestCount,
      customerName: customerName.trim() || undefined,
      customerPhone: customerPhone.trim() || undefined,
    });
    setBusy(false);
    if (!res.ok) return;
    setOpenSheetTableId(null);
    setCustomerName("");
    setCustomerPhone("");
    if (res.sessionId) navigate(`/floor/order/${res.sessionId}`);
  };

  const handleTableTap = (tableId: string) => {
    const session = floor ? activeSessionForTable(floor, tableId) : undefined;
    if (session) {
      void (async () => {
        const res = await resumeTableSession(session.id);
        if (res.ok) navigate(`/floor/order/${session.id}`);
      })();
      return;
    }
    if (!canOrder) return;
    setGuestCount(2);
    setOpenSheetTableId(tableId);
  };

  const handleOpenNamedTab = () => {
    if (busy || !tabLabel.trim()) return;
    setBusy(true);
    const res = openNamedTab({
      tabLabel: tabLabel.trim(),
      guestCount: guestCount >= 6 ? 6 : guestCount,
      customerName: customerName.trim() || undefined,
      customerPhone: customerPhone.trim() || undefined,
    });
    setBusy(false);
    if (!res.ok) return;
    setNewTabOpen(false);
    setTabLabel("");
    setCustomerName("");
    setCustomerPhone("");
    if (res.sessionId) navigate(`/floor/order/${res.sessionId}`);
  };

  const handleTabTap = (sessionId: string) => {
    void (async () => {
      const res = await resumeTableSession(sessionId);
      if (res.ok) navigate(`/floor/order/${sessionId}`);
    })();
  };

  return (
    <div className="space-y-4 pb-24">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-stone-950">{t(lang, "floorPlanTitle")}</h1>
          <p className="mt-1 text-sm font-medium text-stone-500">
            {pendingTotal > 0
              ? t(lang, "floorOpenTotal").replace("{amount}", formatUgx(pendingTotal))
              : t(lang, "floorPlanSub")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canKitchen ? (
            <>
              <button
                type="button"
                onClick={() => navigate("/kitchen?station=kitchen")}
                className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800"
              >
                <ChefHat className="h-4 w-4" />
                {t(lang, "floorKitchenLink")}
              </button>
              <button
                type="button"
                onClick={() => navigate("/kitchen?station=bar")}
                className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800"
              >
                {t(lang, "floorBarLink")}
              </button>
            </>
          ) : null}
          {canPendingList ? (
            <button
              type="button"
              onClick={() => navigate("/pending-sales")}
              className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800"
            >
              <ClipboardList className="h-4 w-4" />
              {t(lang, "pendingSalesLink")}
              {pendingCount > 0 ? (
                <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-black text-white">{pendingCount}</span>
              ) : null}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => navigate("/pos")}
            className="min-h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-800"
          >
            {t(lang, "floorTakeaway")}
          </button>
          {hasPermission(actor.role, "settings.shop") ? (
            <button
              type="button"
              onClick={() => navigate("/settings/floor")}
              className="flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700"
              aria-label={t(lang, "floorSetupTitle")}
            >
              <Settings className="h-5 w-5" />
            </button>
          ) : null}
        </div>
      </div>

      {areas.length > 1 ? (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {areas.map((area) => (
            <button
              key={area.id}
              type="button"
              onClick={() => setAreaId(area.id)}
              className={clsx(
                "shrink-0 rounded-full px-4 py-2 text-sm font-bold",
                activeAreaId === area.id ? "bg-waka-600 text-white" : "bg-slate-100 text-slate-800",
              )}
            >
              {area.name}
            </button>
          ))}
        </div>
      ) : areas[0] ? (
        <p className="text-sm font-bold text-slate-600">{areas[0].name}</p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {tables.map((table) => {
          const session = floor ? activeSessionForTable(floor, table.id) : undefined;
          const sale = session ? sales.find((s) => s.id === session.saleId) : undefined;
          const total = pendingSaleTotal(sale);
          const lineCount = sale?.lines.length ?? 0;
          const colors = TABLE_STATUS_COLORS[table.displayStatus];
          return (
            <button
              key={table.id}
              type="button"
              onClick={() => handleTableTap(table.id)}
              className={clsx(
                "flex min-h-[88px] flex-col items-center justify-center rounded-2xl border-2 px-3 py-4 text-center shadow-sm transition active:scale-[0.98]",
                colors.bg,
                colors.border,
                colors.text,
              )}
            >
              <span className="text-base font-black">{table.label}</span>
              {total > 0 ? (
                <>
                  <span className="mt-1 text-sm font-bold">{formatUgx(total)}</span>
                  {lineCount > 0 ? (
                    <span className="text-xs font-semibold opacity-80">
                      {t(lang, "tableOrderItemCount").replace("{count}", String(lineCount))}
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="mt-1 text-xs font-semibold opacity-80">{t(lang, colors.labelKey)}</span>
              )}
            </button>
          );
        })}
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-black text-stone-950">{t(lang, "floorNamedTabsTitle")}</h2>
            <p className="text-sm font-medium text-stone-500">{t(lang, "floorNamedTabsSub")}</p>
          </div>
          {canOrder ? (
            <button
              type="button"
              onClick={() => {
                setGuestCount(1);
                setTabLabel("");
                setNewTabOpen(true);
              }}
              className="min-h-11 rounded-xl bg-violet-600 px-4 text-sm font-black text-white"
            >
              {t(lang, "floorNewTab")}
            </button>
          ) : null}
        </div>
        {namedTabs.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-violet-200 bg-violet-50/50 px-4 py-6 text-center text-sm font-semibold text-violet-800">
            {t(lang, "floorNamedTabsSub")}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {namedTabs.map((session) => {
              const sale = sales.find((s) => s.id === session.saleId);
              const total = pendingSaleTotal(sale);
              const lineCount = sale?.lines.length ?? 0;
              const label = floor ? sessionDisplayLabel(session, floor) : session.tabLabel ?? "Tab";
              return (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => handleTabTap(session.id)}
                  className={clsx(
                    "flex min-h-[88px] flex-col items-center justify-center rounded-2xl border-2 px-3 py-4 text-center shadow-sm transition active:scale-[0.98]",
                    session.status === "payment_pending"
                      ? "border-red-400 bg-red-50 text-red-950"
                      : "border-violet-400 bg-violet-50 text-violet-950",
                  )}
                >
                  <span className="line-clamp-2 text-base font-black">{label}</span>
                  {total > 0 ? (
                    <>
                      <span className="mt-1 text-sm font-bold">{formatUgx(total)}</span>
                      {lineCount > 0 ? (
                        <span className="text-xs font-semibold opacity-80">
                          {t(lang, "tableOrderItemCount").replace("{count}", String(lineCount))}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span className="mt-1 text-xs font-semibold opacity-80">{t(lang, "tableStatusOccupied")}</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </section>

      <div className="flex flex-wrap gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs font-semibold text-slate-600">
        {(Object.keys(TABLE_STATUS_COLORS) as Array<keyof typeof TABLE_STATUS_COLORS>).map((key) => (
          <span key={key} className="flex items-center gap-2">
            <span className={clsx("h-3 w-3 rounded-full border-2", TABLE_STATUS_COLORS[key].border, TABLE_STATUS_COLORS[key].bg)} />
            {t(lang, TABLE_STATUS_COLORS[key].labelKey)}
          </span>
        ))}
      </div>

      {openSheetTable ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-3xl bg-white p-5 shadow-xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-black text-stone-950">{t(lang, "openTableTitle")}</h2>
                <p className="text-sm font-medium text-stone-500">{openSheetTable.label}</p>
              </div>
              <button type="button" className="text-sm font-bold text-slate-500" onClick={() => setOpenSheetTableId(null)}>
                {t(lang, "cancel")}
              </button>
            </div>

            <p className="mb-2 text-sm font-bold text-slate-700">{t(lang, "openTableGuests")}</p>
            <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
              {GUEST_COUNTS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setGuestCount(n)}
                  className={clsx(
                    "min-h-12 rounded-xl text-base font-black",
                    guestCount === n ? "bg-waka-600 text-white" : "bg-slate-100 text-slate-900",
                  )}
                >
                  {n === 6 ? "6+" : n}
                </button>
              ))}
            </div>

            <label className="mb-3 block">
              <span className="mb-1 block text-sm font-bold text-slate-700">{t(lang, "openTableCustomerName")}</span>
              <input
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-3 text-base"
                placeholder={t(lang, "openTableCustomerNamePh")}
              />
            </label>
            <label className="mb-5 block">
              <span className="mb-1 block text-sm font-bold text-slate-700">{t(lang, "openTablePhone")}</span>
              <input
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-3 text-base"
                placeholder="+256..."
              />
            </label>

            <button
              type="button"
              disabled={busy}
              onClick={handleOpenTable}
              className="flex min-h-14 w-full items-center justify-center rounded-2xl bg-waka-600 text-lg font-black text-white disabled:opacity-60"
            >
              {t(lang, "openTableConfirm")}
            </button>
          </div>
        </div>
      ) : null}

      {newTabOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-3xl bg-white p-5 shadow-xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-black text-stone-950">{t(lang, "floorNewTabTitle")}</h2>
                <p className="text-sm font-medium text-stone-500">{t(lang, "floorNamedTabsSub")}</p>
              </div>
              <button type="button" className="text-sm font-bold text-slate-500" onClick={() => setNewTabOpen(false)}>
                {t(lang, "cancel")}
              </button>
            </div>

            <label className="mb-4 block">
              <span className="mb-1 block text-sm font-bold text-slate-700">{t(lang, "floorTabLabel")}</span>
              <input
                value={tabLabel}
                onChange={(e) => setTabLabel(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-3 text-base"
                placeholder={t(lang, "floorTabLabelPh")}
                autoFocus
              />
            </label>

            <p className="mb-2 text-sm font-bold text-slate-700">{t(lang, "openTableGuests")}</p>
            <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
              {GUEST_COUNTS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setGuestCount(n)}
                  className={clsx(
                    "min-h-12 rounded-xl text-base font-black",
                    guestCount === n ? "bg-violet-600 text-white" : "bg-slate-100 text-slate-900",
                  )}
                >
                  {n === 6 ? "6+" : n}
                </button>
              ))}
            </div>

            <label className="mb-3 block">
              <span className="mb-1 block text-sm font-bold text-slate-700">{t(lang, "openTableCustomerName")}</span>
              <input
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-3 text-base"
                placeholder={t(lang, "openTableCustomerNamePh")}
              />
            </label>
            <label className="mb-5 block">
              <span className="mb-1 block text-sm font-bold text-slate-700">{t(lang, "openTablePhone")}</span>
              <input
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-3 text-base"
                placeholder="+256..."
              />
            </label>

            <button
              type="button"
              disabled={busy || !tabLabel.trim()}
              onClick={handleOpenNamedTab}
              className="flex min-h-14 w-full items-center justify-center rounded-2xl bg-violet-600 text-lg font-black text-white disabled:opacity-60"
            >
              {t(lang, "floorOpenTabConfirm")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
