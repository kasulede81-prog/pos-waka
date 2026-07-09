import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { actorHasPermission } from "../lib/actorAuthorization";
import { useNavigate } from "react-router-dom";
import clsx from "clsx";
import { Settings, Wrench } from "lucide-react";
import type { Language, TableReservation, WaitlistEntry } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { useSessionActor } from "../context/SessionActorContext";
import {
  TABLE_STATUS_COLORS,
  activeNamedTabs,
  activeSessionForTable,
  ensureHospitalityFloor,
  isHospitalityMode,
  pendingSaleTotal,
  sessionDisplayLabel,
  totalOpenTablesPendingUgx,
} from "../lib/hospitality";
import { formatUgx } from "../lib/formatUgx";
import { useShallow } from "zustand/react/shallow";
import { useHospitalityFloorPoll } from "../hooks/useHospitalityFloorPoll";
import { OpenTableDialog } from "../components/hospitality/OpenTableDialog";
import { RestaurantTableCard } from "../components/hospitality/RestaurantTableCard";
import { FloorPlanRightPanel } from "../components/hospitality/FloorPlanRightPanel";
import { FloorPlanBottomBar } from "../components/hospitality/FloorPlanBottomBar";
import { HospitalityManagerToolsSheet } from "../components/hospitality/HospitalityManagerToolsSheet";
import { ReservationDetailDialog, ReservationFormDialog } from "../components/hospitality/ReservationDialogs";
import { WaitlistFormDialog } from "../components/hospitality/WaitlistPanel";
import { loadFloorViewState, saveFloorViewState } from "../lib/floorViewState";
import {
  computeFloorNotifications,
  reservationForTable,
  visibleFloorTables,
} from "../lib/hospitalityFrontOfHouse";
import { FLOOR_GRID_CLASS } from "../lib/floorDisplayPrefs";
import { HospitalityOpsStatusStrip } from "../components/hospitality/HospitalityOpsStatusStrip";

export function FloorPlanPage({ lang }: { lang: Language }) {
  const navigate = useNavigate();
  const actor = useSessionActor();
  const scrollRef = useRef<HTMLDivElement>(null);
  const ensureFloorInStore = usePosStore((s) => s.ensureHospitalityFloor);
  const openTable = usePosStore((s) => s.openTable);
  const openNamedTab = usePosStore((s) => s.openNamedTab);
  const resumeTableSession = usePosStore((s) => s.resumeTableSession);
  const createTableReservation = usePosStore((s) => s.createTableReservation);
  const confirmTableReservation = usePosStore((s) => s.confirmTableReservation);
  const cancelTableReservation = usePosStore((s) => s.cancelTableReservation);
  const markReservationNoShow = usePosStore((s) => s.markReservationNoShow);
  const addWaitlistEntry = usePosStore((s) => s.addWaitlistEntry);
  const suggestTablesForGuests = usePosStore((s) => s.suggestTablesForGuests);
  const startTableCleaning = usePosStore((s) => s.startTableCleaning);
  const finishTableCleaning = usePosStore((s) => s.finishTableCleaning);
  const { businessType, hospitalityModeEnabled, rawFloor, sales, floorDisplayPrefs } = usePosStore(
    useShallow((s) => {
      const ext = s.preferences.hospitalityFloorDisplay;
      return {
        businessType: s.preferences.businessType,
        hospitalityModeEnabled: s.preferences.hospitalityModeEnabled,
        rawFloor: s.preferences.hospitalityFloor,
        sales: s.sales,
        floorDisplayPrefs: {
          tableShape: ext?.tableShape ?? "classic",
          tableSize: ext?.tableSize ?? "md",
          gridDensity: ext?.gridDensity ?? "normal",
        },
      };
    }),
  );
  const floor = useMemo(
    () => (rawFloor ? ensureHospitalityFloor(rawFloor) : undefined),
    [rawFloor],
  );

  const savedView = useMemo(() => loadFloorViewState(), []);
  const [areaId, setAreaId] = useState<string | null>(savedView?.areaId ?? null);
  const [zoom] = useState(savedView?.zoom ?? 1);
  const [openSheetTableId, setOpenSheetTableId] = useState<string | null>(null);
  const [newTabOpen, setNewTabOpen] = useState(false);
  const [tabLabel, setTabLabel] = useState("");
  const [guestCount, setGuestCount] = useState(2);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [reservationFormOpen, setReservationFormOpen] = useState(false);
  const [waitlistFormOpen, setWaitlistFormOpen] = useState(false);
  const [activeReservation, setActiveReservation] = useState<TableReservation | null>(null);
  const [seatWaitlistEntry, setSeatWaitlistEntry] = useState<WaitlistEntry | null>(null);
  const [managerToolsOpen, setManagerToolsOpen] = useState(false);
  const [tableLookup, setTableLookup] = useState("");
  const [viewFilter, setViewFilter] = useState<"all" | "occupied" | "available" | "bill">("all");

  useLayoutEffect(() => {
    if (!rawFloor) {
      ensureFloorInStore();
      return;
    }
    const normalized = ensureHospitalityFloor(rawFloor);
    if (normalized !== rawFloor) ensureFloorInStore();
  }, [ensureFloorInStore, rawFloor]);

  const hospitality = isHospitalityMode(businessType, hospitalityModeEnabled);
  useHospitalityFloorPoll(hospitality);
  const areas = floor?.areas?.filter((a) => a.isActive) ?? [];
  const activeAreaId = areaId ?? areas[0]?.id ?? null;
  const tables = useMemo(() => {
    if (!floor) return [];
    let list = visibleFloorTables(floor, activeAreaId).filter((tbl) => tbl.isActive);
    if (viewFilter === "occupied") {
      list = list.filter((tbl) => {
        const s = activeSessionForTable(floor, tbl.id);
        return Boolean(s && s.status === "open");
      });
    } else if (viewFilter === "available") {
      list = list.filter((tbl) => tbl.displayStatus === "available");
    } else if (viewFilter === "bill") {
      list = list.filter((tbl) => tbl.displayStatus === "payment_pending");
    }
    return list;
  }, [floor, activeAreaId, viewFilter]);

  const floorNotifications = useMemo(() => (floor ? computeFloorNotifications(floor) : []), [floor]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || savedView?.scrollTop == null) return;
    el.scrollTop = savedView.scrollTop;
  }, [activeAreaId, savedView?.scrollTop]);

  const persistView = useCallback(() => {
    saveFloorViewState({
      areaId: activeAreaId,
      scrollTop: scrollRef.current?.scrollTop ?? 0,
      zoom,
    });
  }, [activeAreaId, zoom]);

  const pendingTotal = floor ? totalOpenTablesPendingUgx(sales, floor) : 0;
  const canKitchen = actorHasPermission(actor, "hospitality.kitchen");
  const canOrder = actorHasPermission(actor, "hospitality.order");
  const namedTabs = floor ? activeNamedTabs(floor) : [];

  if (!hospitality) {
    return (
      <div className="rounded-2xl border border-stone-200 bg-white p-6 text-center">
        <p className="text-sm font-medium text-stone-600">{t(lang, "hospitalityNotEnabled")}</p>
      </div>
    );
  }

  const openSheetTable = tables.find((tbl) => tbl.id === openSheetTableId);
  const openSheetArea = openSheetTable ? areas.find((a) => a.id === openSheetTable.areaId) : undefined;

  const goToOrder = (sessionId: string) => {
    persistView();
    navigate(`/floor/order/${sessionId}`);
  };

  const handleOpenTableConfirm = (input: {
    guestCount: number;
    adultCount: number;
    childrenCount: number;
    customerName?: string;
    customerPhone?: string;
    specialNotes?: string;
    reservationId?: string;
    waitlistEntryId?: string;
  }) => {
    if (!openSheetTableId || busy) return;
    setBusy(true);
    const res = openTable({
      tableId: openSheetTableId,
      guestCount: input.guestCount,
      adultCount: input.adultCount,
      childrenCount: input.childrenCount,
      customerName: input.customerName ?? activeReservation?.guestName ?? seatWaitlistEntry?.name,
      customerPhone: input.customerPhone ?? activeReservation?.phone ?? seatWaitlistEntry?.phone ?? undefined,
      specialNotes: input.specialNotes,
      reservationId: input.reservationId ?? activeReservation?.id,
      waitlistEntryId: input.waitlistEntryId ?? seatWaitlistEntry?.id,
    });
    setBusy(false);
    if (!res.ok) return;
    setOpenSheetTableId(null);
    setActiveReservation(null);
    setSeatWaitlistEntry(null);
    persistView();
    if (res.sessionId) navigate(`/floor/order/${res.sessionId}`);
  };

  const handleTableTap = (tableId: string) => {
    if (!floor) return;
    const session = activeSessionForTable(floor, tableId);
    if (session) {
      void (async () => {
        const res = await resumeTableSession(session.id);
        if (res.ok) goToOrder(session.id);
      })();
      return;
    }
    const table = floor.tables.find((t) => t.id === tableId);
    if (table?.displayStatus === "needs_cleaning") {
      startTableCleaning(tableId);
      return;
    }
    if (table?.displayStatus === "cleaning") {
      finishTableCleaning(tableId);
      return;
    }
    const reservation = reservationForTable(floor, tableId);
    if (reservation) {
      setActiveReservation(reservation);
      return;
    }
    if (!canOrder) return;
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
    persistView();
    if (res.sessionId) navigate(`/floor/order/${res.sessionId}`);
  };

  const handleTabTap = (sessionId: string) => {
    void (async () => {
      const res = await resumeTableSession(sessionId);
      if (res.ok) goToOrder(sessionId);
    })();
  };

  const handleTableLookupConfirm = () => {
    if (!floor || !tableLookup.trim()) return;
    const num = tableLookup.trim();
    const match = floor.tables.find(
      (tbl) =>
        tbl.isActive &&
        (tbl.label === num ||
          tbl.label.replace(/\D/g, "") === num ||
          tbl.label.toLowerCase().includes(num.toLowerCase())),
    );
    if (match) handleTableTap(match.id);
    setTableLookup("");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-stone-200">
      <div className="shrink-0 border-b border-stone-300 bg-stone-100 px-2 py-1.5">
        <HospitalityOpsStatusStrip lang={lang} />
      </div>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-stone-400 bg-stone-300 px-2 py-1.5">
        <div className="flex min-w-0 flex-1 gap-0 overflow-x-auto">
          {areas.map((area) => (
            <button
              key={area.id}
              type="button"
              onClick={() => {
                setAreaId(area.id);
                saveFloorViewState({ areaId: area.id, scrollTop: 0, zoom });
              }}
              className={clsx(
                "shrink-0 border border-stone-400 px-4 py-2 text-xs font-black uppercase tracking-wide sm:px-6 sm:text-sm",
                activeAreaId === area.id
                  ? "bg-white text-stone-900 shadow-sm"
                  : "bg-stone-200 text-stone-600 hover:bg-stone-100",
              )}
            >
              {area.name}
            </button>
          ))}
        </div>
        <div className="flex shrink-0 gap-1">
          {actorHasPermission(actor, "settings.shop") ? (
            <button
              type="button"
              onClick={() => navigate("/settings/floor")}
              className="flex min-h-9 min-w-9 items-center justify-center rounded border border-stone-400 bg-white text-stone-700"
              aria-label={t(lang, "floorSetupTitle")}
            >
              <Settings className="h-4 w-4" />
            </button>
          ) : null}
          {actorHasPermission(actor, "hospitality.settle") ? (
            <button
              type="button"
              onClick={() => setManagerToolsOpen(true)}
              className="flex min-h-9 items-center gap-1 rounded border border-stone-400 bg-white px-2 text-xs font-bold text-stone-700"
            >
              <Wrench className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      {floorNotifications.length > 0 ? (
        <ul className="shrink-0 flex flex-wrap gap-2 border-b border-amber-300 bg-amber-100 px-3 py-1.5">
          {floorNotifications.slice(0, 4).map((n) => (
            <li key={n.id} className="text-[10px] font-bold text-amber-950">
              {t(lang, n.messageKey as "fohAlertReservationArriving")} — {n.tableLabel}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-stone-300 bg-white px-2 py-2 lg:hidden">
        {(
          [
            { id: "all" as const, labelKey: "floorFilterAll" },
            { id: "occupied" as const, labelKey: "floorFilterOccupied" },
            { id: "available" as const, labelKey: "floorFilterAvailable" },
            { id: "bill" as const, labelKey: "floorFilterBill" },
          ] as const
        ).map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setViewFilter(f.id)}
            className={clsx(
              "min-h-[44px] shrink-0 rounded-lg px-3 text-xs font-bold",
              viewFilter === f.id ? "bg-sky-700 text-white" : "bg-stone-100 text-stone-700",
            )}
          >
            {t(lang, f.labelKey)}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div ref={scrollRef} className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-stone-100 p-3 sm:p-4">
          <div className={clsx("grid gap-2 sm:gap-3", FLOOR_GRID_CLASS[floorDisplayPrefs.gridDensity])}>
            {tables.map((table) => {
              const session = floor ? activeSessionForTable(floor, table.id) : undefined;
              const sale = session ? sales.find((s) => s.id === session.saleId) : undefined;
              const reservation = floor ? reservationForTable(floor, table.id) : undefined;
              return (
                <RestaurantTableCard
                  key={table.id}
                  lang={lang}
                  table={table}
                  session={session}
                  reservation={reservation}
                  totalUgx={pendingSaleTotal(sale)}
                  display={floorDisplayPrefs}
                  onTap={() => handleTableTap(table.id)}
                />
              );
            })}
          </div>
        </div>

        {floor ? (
          <FloorPlanRightPanel
            lang={lang}
            floor={floor}
            sales={sales}
            tableLookup={tableLookup}
            onTableLookupChange={setTableLookup}
            onTableLookupConfirm={handleTableLookupConfirm}
            viewFilter={viewFilter}
            onViewFilterChange={setViewFilter}
          />
        ) : null}
      </div>

      <FloorPlanBottomBar
        lang={lang}
        active="floor"
        onFloor={() => undefined}
        onReservations={() => navigate("/floor/reservations")}
        onDocuments={() => navigate("/pending-sales")}
        onStats={() => navigate("/owner-dashboard")}
      />

      <div className="flex shrink-0 flex-col gap-2 border-t border-stone-300 bg-white px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-black text-stone-950">{t(lang, "floorNamedTabsTitle")}</h2>
            {pendingTotal > 0 ? (
              <p className="text-xs font-medium text-stone-500">
                {t(lang, "floorOpenTotal").replace("{amount}", formatUgx(pendingTotal))}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {canOrder ? (
              <button
                type="button"
                onClick={() => setReservationFormOpen(true)}
                className="min-h-9 rounded border border-violet-300 bg-violet-50 px-3 text-xs font-bold text-violet-900"
              >
                {t(lang, "floorReservationsLink")}
              </button>
            ) : null}
            {canKitchen ? (
              <button
                type="button"
                onClick={() => navigate("/kitchen")}
                className="min-h-9 rounded border border-stone-300 px-3 text-xs font-bold"
              >
                {t(lang, "floorKitchenLink")}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => navigate("/pos")}
              className="min-h-9 rounded border border-stone-300 px-3 text-xs font-bold"
            >
              {t(lang, "floorTakeaway")}
            </button>
            {canOrder ? (
              <button
                type="button"
                onClick={() => {
                  setGuestCount(1);
                  setTabLabel("");
                  setNewTabOpen(true);
                }}
                className="min-h-9 rounded bg-violet-600 px-3 text-xs font-black text-white"
              >
                {t(lang, "floorNewTab")}
              </button>
            ) : null}
          </div>
        </div>
        {namedTabs.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {namedTabs.map((session) => {
              const sale = sales.find((s) => s.id === session.saleId);
              const total = pendingSaleTotal(sale);
              const label = floor ? sessionDisplayLabel(session, floor) : session.tabLabel ?? "Tab";
              return (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => handleTabTap(session.id)}
                  className="rounded border border-violet-300 bg-violet-50 px-3 py-1.5 text-xs font-black text-violet-950"
                >
                  {label}
                  {total > 0 ? ` · ${formatUgx(total)}` : ""}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      <div className="hidden">
        {(Object.keys(TABLE_STATUS_COLORS) as Array<keyof typeof TABLE_STATUS_COLORS>).map((key) => (
          <span key={key} className="flex items-center gap-2">
            <span className={clsx("h-3 w-3 rounded-full", TABLE_STATUS_COLORS[key].dot)} />
            {t(lang, TABLE_STATUS_COLORS[key].labelKey)}
          </span>
        ))}
      </div>

      {openSheetTable ? (
        <OpenTableDialog
          lang={lang}
          open
          tableLabel={openSheetTable.label}
          areaName={openSheetArea?.name}
          waiterLabel={actor.displayName}
          busy={busy}
          onCancel={() => setOpenSheetTableId(null)}
          onConfirm={(input) => {
            handleOpenTableConfirm({
              ...input,
              reservationId: activeReservation?.preferredTableId === openSheetTableId ? activeReservation.id : undefined,
              waitlistEntryId: seatWaitlistEntry ? seatWaitlistEntry.id : undefined,
            });
            setActiveReservation(null);
            setSeatWaitlistEntry(null);
          }}
        />
      ) : null}

      {activeReservation ? (
        <ReservationDetailDialog
          lang={lang}
          open
          reservation={activeReservation}
          floor={floor!}
          sales={sales}
          onClose={() => setActiveReservation(null)}
          onConfirm={() => {
            confirmTableReservation(activeReservation.id);
            setActiveReservation({ ...activeReservation, status: "confirmed" });
          }}
          onSeat={() => {
            if (activeReservation.preferredTableId) {
              setOpenSheetTableId(activeReservation.preferredTableId);
              setActiveReservation(activeReservation);
            }
          }}
          onCancel={(reason) => {
            cancelTableReservation(activeReservation.id, reason);
            setActiveReservation(null);
          }}
          onNoShow={() => {
            markReservationNoShow(activeReservation.id);
            setActiveReservation(null);
          }}
        />
      ) : null}

      <ReservationFormDialog
        lang={lang}
        open={reservationFormOpen}
        areas={areas}
        tables={floor?.tables ?? []}
        onClose={() => setReservationFormOpen(false)}
        onSubmit={(input) => {
          createTableReservation({
            guestName: input.guestName,
            phone: input.phone,
            email: input.email ?? null,
            guestCount: input.guestCount,
            reservationDate: input.reservationDate,
            reservationTime: input.reservationTime,
            areaId: input.areaId ?? null,
            preferredTableId: input.preferredTableId ?? null,
            notes: input.notes ?? null,
            isVip: input.isVip,
          });
          setReservationFormOpen(false);
        }}
      />

      <WaitlistFormDialog
        lang={lang}
        open={waitlistFormOpen}
        onClose={() => setWaitlistFormOpen(false)}
        onSubmit={(input) => {
          addWaitlistEntry({
            name: input.name,
            guestCount: input.guestCount,
            phone: input.phone ?? null,
            arrivalTime: new Date().toISOString(),
            estimatedWaitMinutes: input.estimatedWaitMinutes ?? null,
            priority: input.priority,
            notes: input.notes ?? null,
            source: input.source,
          });
          setWaitlistFormOpen(false);
        }}
      />

      {seatWaitlistEntry && !openSheetTable ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
            <h2 className="text-lg font-black">{t(lang, "waitlistSeatTitle")}</h2>
            <p className="mt-1 text-sm text-stone-600">{seatWaitlistEntry.name} · {seatWaitlistEntry.guestCount} guests</p>
            <ul className="mt-3 space-y-2">
              {suggestTablesForGuests({ guestCount: seatWaitlistEntry.guestCount, isVip: seatWaitlistEntry.priority === "vip" }).map((s) => (
                <li key={s.tableIds.join("-")}>
                  <button
                    type="button"
                    className="w-full rounded-xl border border-stone-200 px-3 py-2 text-left text-sm font-bold"
                    onClick={() => {
                      setOpenSheetTableId(s.tableIds[0]!);
                    }}
                  >
                    {s.displayLabel} ({s.totalCapacity})
                    {s.requiresCombine ? ` · ${t(lang, "tableSuggestCombine")}` : ""}
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => setSeatWaitlistEntry(null)} className="mt-3 w-full rounded-xl border py-2 font-bold">
              {t(lang, "cancel")}
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
              <button type="button" className="text-sm font-bold text-stone-500" onClick={() => setNewTabOpen(false)}>
                {t(lang, "cancel")}
              </button>
            </div>
            <label className="mb-4 block">
              <span className="mb-1 block text-sm font-bold text-stone-700">{t(lang, "floorTabLabel")}</span>
              <input
                value={tabLabel}
                onChange={(e) => setTabLabel(e.target.value)}
                className="w-full rounded-xl border border-stone-200 px-3 py-3 text-base"
                placeholder={t(lang, "floorTabLabelPh")}
                autoFocus
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

      {floor ? (
        <HospitalityManagerToolsSheet
          lang={lang}
          open={managerToolsOpen}
          floor={floor}
          onClose={() => setManagerToolsOpen(false)}
        />
      ) : null}
    </div>
  );
}
