import { useEffect, useState } from "react";
import clsx from "clsx";
import type { KitchenStationType, Language } from "../types";
import { t } from "../lib/i18n";
import { PageBackBar } from "../components/layout/PageBackBar";
import { WakaSwitch } from "../components/enterprise/WakaSwitch";
import { usePosStore } from "../store/usePosStore";
import { useShallow } from "zustand/react/shallow";
import { isHospitalityMode } from "../lib/hospitality";
import { KITCHEN_STATION_TYPES, hospitalityRoutingLabelKey } from "../lib/productHospitalityRouting";
import { resolveFloorDisplayPrefs } from "../lib/floorDisplayPrefs";
import type { HospitalityFloorGridDensity, HospitalityTableShape, HospitalityTableSize } from "../types";

export function SettingsFloorPage({ lang }: { lang: Language }) {
  const ensureHospitalityFloor = usePosStore((s) => s.ensureHospitalityFloor);
  const addDiningArea = usePosStore((s) => s.addDiningArea);
  const renameDiningArea = usePosStore((s) => s.renameDiningArea);
  const removeDiningArea = usePosStore((s) => s.removeDiningArea);
  const addDiningTable = usePosStore((s) => s.addDiningTable);
  const updateDiningTable = usePosStore((s) => s.updateDiningTable);
  const removeDiningTable = usePosStore((s) => s.removeDiningTable);
  const addKitchenStation = usePosStore((s) => s.addKitchenStation);
  const updateKitchenStation = usePosStore((s) => s.updateKitchenStation);
  const removeKitchenStation = usePosStore((s) => s.removeKitchenStation);
  const upsertWaiterSection = usePosStore((s) => s.upsertWaiterSection);
  const setPreferences = usePosStore((s) => s.setPreferences);
  const setHospitalityManualKitchenFire = usePosStore((s) => s.setHospitalityManualKitchenFire);
  const floorDisplay = usePosStore((s) => resolveFloorDisplayPrefs(s.preferences));

  const { floor, businessType, hospitalityModeEnabled, manualKitchenFire } = usePosStore(
    useShallow((s) => ({
      floor: s.preferences.hospitalityFloor,
      businessType: s.preferences.businessType,
      hospitalityModeEnabled: s.preferences.hospitalityModeEnabled,
      manualKitchenFire: s.preferences.hospitalityManualKitchenFire === true,
    })),
  );

  const [newAreaName, setNewAreaName] = useState("");
  const [newTableLabel, setNewTableLabel] = useState("");
  const [newTableAreaId, setNewTableAreaId] = useState<string>("");
  const [newStationName, setNewStationName] = useState("");
  const [newStationType, setNewStationType] = useState<KitchenStationType>("kitchen");
  const [newSectionName, setNewSectionName] = useState("");
  const [newSectionWaiter, setNewSectionWaiter] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    ensureHospitalityFloor();
  }, [ensureHospitalityFloor]);

  useEffect(() => {
    if (!newTableAreaId && floor?.areas[0]?.id) setNewTableAreaId(floor.areas[0].id);
  }, [floor?.areas, newTableAreaId]);

  const hospitality = isHospitalityMode(businessType, hospitalityModeEnabled);
  const areas = floor?.areas ?? [];
  const tables = floor?.tables ?? [];
  const stations = floor?.stations ?? [];
  const waiterSections = floor?.waiterSections ?? [];

  if (!hospitality) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-center">
        <p className="text-sm font-medium text-muted-foreground">{t(lang, "hospitalityNotEnabled")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-8">
      <PageBackBar lang={lang} fallbackTo="/settings" label={t(lang, "settingsHubTitle")} />
      <div>
        <h1 className="text-2xl font-black text-foreground">{t(lang, "floorSetupTitle")}</h1>
        <p className="mt-1 text-sm font-medium text-muted-foreground">{t(lang, "floorSetupSub")}</p>
      </div>

      {err ? <p className="text-sm font-bold text-rose-700">{err}</p> : null}

      <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <p className="text-base font-black text-foreground">{t(lang, "floorDisplayTitle")}</p>
        <p className="mt-1 text-sm font-medium text-muted-foreground">{t(lang, "floorDisplaySub")}</p>
        <div className="mt-4 space-y-4">
          <div>
            <p className="mb-2 text-sm font-bold text-foreground">{t(lang, "floorDisplayShape")}</p>
            <div className="flex flex-wrap gap-2">
              {(["classic", "round", "square"] as HospitalityTableShape[]).map((shape) => (
                <button
                  key={shape}
                  type="button"
                  onClick={() =>
                    setPreferences({
                      hospitalityFloorDisplay: { ...floorDisplay, tableShape: shape },
                    })
                  }
                  className={clsx(
                    "rounded-xl border-2 px-4 py-2 text-sm font-black capitalize",
                    floorDisplay.tableShape === shape
                      ? "border-waka-500 bg-waka-50 text-waka-900"
                      : "border-border bg-card text-muted-foreground",
                  )}
                >
                  {t(lang, `floorDisplayShape_${shape}` as "floorDisplayShape_classic")}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-sm font-bold text-foreground">{t(lang, "floorDisplaySize")}</p>
            <div className="flex flex-wrap gap-2">
              {(["sm", "md", "lg", "xl"] as HospitalityTableSize[]).map((size) => (
                <button
                  key={size}
                  type="button"
                  onClick={() =>
                    setPreferences({
                      hospitalityFloorDisplay: { ...floorDisplay, tableSize: size },
                    })
                  }
                  className={clsx(
                    "rounded-xl border-2 px-4 py-2 text-sm font-black uppercase",
                    floorDisplay.tableSize === size
                      ? "border-waka-500 bg-waka-50 text-waka-900"
                      : "border-border bg-card text-muted-foreground",
                  )}
                >
                  {t(lang, `floorDisplaySize_${size}` as "floorDisplaySize_md")}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-sm font-bold text-foreground">{t(lang, "floorDisplayDensity")}</p>
            <div className="flex flex-wrap gap-2">
              {(["compact", "normal", "spacious"] as HospitalityFloorGridDensity[]).map((density) => (
                <button
                  key={density}
                  type="button"
                  onClick={() =>
                    setPreferences({
                      hospitalityFloorDisplay: { ...floorDisplay, gridDensity: density },
                    })
                  }
                  className={clsx(
                    "rounded-xl border-2 px-4 py-2 text-sm font-black capitalize",
                    floorDisplay.gridDensity === density
                      ? "border-waka-500 bg-waka-50 text-waka-900"
                      : "border-border bg-card text-muted-foreground",
                  )}
                >
                  {t(lang, `floorDisplayDensity_${density}` as "floorDisplayDensity_normal")}
                </button>
              ))}
            </div>
          </div>
        </div>
      </article>

      <WakaSwitch
        checked={manualKitchenFire}
        onCheckedChange={setHospitalityManualKitchenFire}
        label={t(lang, "floorManualKitchenFire")}
        className="rounded-2xl border border-border bg-card p-4"
      />

      <div className="rounded-2xl border border-border bg-card p-4">
        <h2 className="text-lg font-black text-foreground">{t(lang, "floorEditorAreas")}</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            value={newAreaName}
            onChange={(e) => setNewAreaName(e.target.value)}
            placeholder={t(lang, "floorEditorAreaPh")}
            className="min-h-11 flex-1 rounded-xl border border-border px-3 text-sm"
          />
          <button
            type="button"
            className="min-h-11 rounded-xl bg-waka-600 px-4 text-sm font-black text-white"
            onClick={() => {
              if (!newAreaName.trim()) return;
              addDiningArea(newAreaName);
              setNewAreaName("");
            }}
          >
            {t(lang, "floorEditorAddArea")}
          </button>
        </div>
        <ul className="mt-4 space-y-2">
          {areas.map((area) => (
            <li key={area.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-muted p-3">
              <input
                defaultValue={area.name}
                onBlur={(e) => renameDiningArea(area.id, e.target.value)}
                className="min-h-10 flex-1 rounded-lg border border-border px-3 text-sm font-bold"
              />
              <button
                type="button"
                className="text-xs font-bold text-rose-700"
                onClick={() => {
                  const res = removeDiningArea(area.id);
                  if (!res.ok) setErr(t(lang, "floorEditorAreaBusy"));
                  else setErr(null);
                }}
              >
                {t(lang, "remove")}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4">
        <h2 className="text-lg font-black text-foreground">{t(lang, "floorEditorTables")}</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <select
            value={newTableAreaId}
            onChange={(e) => setNewTableAreaId(e.target.value)}
            className="min-h-11 rounded-xl border border-border px-3 text-sm font-bold"
          >
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <input
            value={newTableLabel}
            onChange={(e) => setNewTableLabel(e.target.value)}
            placeholder={t(lang, "floorEditorTablePh")}
            className="min-h-11 rounded-xl border border-border px-3 text-sm"
          />
          <button
            type="button"
            className="min-h-11 rounded-xl bg-waka-600 px-4 text-sm font-black text-white"
            onClick={() => {
              if (!newTableLabel.trim() || !newTableAreaId) return;
              addDiningTable({ areaId: newTableAreaId, label: newTableLabel });
              setNewTableLabel("");
            }}
          >
            {t(lang, "floorEditorAddTable")}
          </button>
        </div>
        {areas.map((area) => {
          const areaTables = tables.filter((tbl) => tbl.areaId === area.id);
          return (
            <div key={area.id} className="mt-4">
              <h3 className="text-sm font-black text-waka-900">{area.name}</h3>
              <ul className="mt-2 space-y-2">
                {areaTables.map((tbl) => (
                  <li key={tbl.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-border p-2">
                    <input
                      defaultValue={tbl.label}
                      onBlur={(e) => updateDiningTable(tbl.id, { label: e.target.value })}
                      className="min-h-10 w-28 rounded-lg border border-border px-2 text-sm font-bold"
                    />
                    <input
                      type="number"
                      defaultValue={tbl.capacity ?? 4}
                      onBlur={(e) =>
                        updateDiningTable(tbl.id, { capacity: Math.max(1, Number(e.target.value) || 4) })
                      }
                      className="min-h-10 w-16 rounded-lg border border-border px-2 text-sm"
                      aria-label={t(lang, "openTableGuests")}
                    />
                    <button
                      type="button"
                      className="text-xs font-bold text-rose-700"
                      onClick={() => {
                        const res = removeDiningTable(tbl.id);
                        if (!res.ok) setErr(t(lang, "tableOccupied"));
                        else setErr(null);
                      }}
                    >
                      {t(lang, "remove")}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <div className="rounded-2xl border border-border bg-card p-4">
        <h2 className="text-lg font-black text-foreground">{t(lang, "floorSetupStations")}</h2>
        <p className="mt-1 text-xs font-medium text-muted-foreground">{t(lang, "floorSetupStationsSub")}</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <input
            value={newStationName}
            onChange={(e) => setNewStationName(e.target.value)}
            placeholder={t(lang, "floorEditorStationPh")}
            className="min-h-11 rounded-xl border border-border px-3 text-sm"
          />
          <select
            value={newStationType}
            onChange={(e) => setNewStationType(e.target.value as KitchenStationType)}
            className="min-h-11 rounded-xl border border-border px-3 text-sm font-bold"
          >
            {KITCHEN_STATION_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(lang, hospitalityRoutingLabelKey(type) as "hospitalityStation_kitchen")}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="min-h-11 rounded-xl bg-waka-600 px-4 text-sm font-black text-white"
            onClick={() => {
              if (!newStationName.trim()) return;
              addKitchenStation({ name: newStationName, stationType: newStationType });
              setNewStationName("");
            }}
          >
            {t(lang, "floorEditorAddStation")}
          </button>
        </div>
        <ul className="mt-4 space-y-2">
          {stations.map((st) => (
            <li key={st.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-muted p-3">
              <input
                defaultValue={st.name}
                onBlur={(e) => updateKitchenStation(st.id, { name: e.target.value })}
                className="min-h-10 flex-1 rounded-lg border border-border px-3 text-sm font-bold"
              />
              <select
                defaultValue={st.stationType}
                onChange={(e) => updateKitchenStation(st.id, { stationType: e.target.value as KitchenStationType })}
                className="min-h-10 rounded-lg border border-border px-2 text-sm font-bold"
              >
                {KITCHEN_STATION_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(lang, hospitalityRoutingLabelKey(type) as "hospitalityStation_kitchen")}
                  </option>
                ))}
              </select>
              <WakaSwitch
                checked={st.isActive}
                onCheckedChange={(checked) => updateKitchenStation(st.id, { isActive: checked })}
                label={t(lang, "staffActive")}
                row={false}
                className="gap-1"
              />
              <button
                type="button"
                className="text-xs font-bold text-rose-700"
                onClick={() => {
                  const res = removeKitchenStation(st.id);
                  if (!res.ok) setErr(t(lang, "kitchenStationBusy"));
                  else setErr(null);
                }}
              >
                {t(lang, "remove")}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4">
        <h2 className="text-lg font-black text-foreground">{t(lang, "waiterSectionsTitle")}</h2>
        <p className="mt-1 text-xs font-medium text-muted-foreground">{t(lang, "waiterSectionsSub")}</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <input
            value={newSectionName}
            onChange={(e) => setNewSectionName(e.target.value)}
            placeholder={t(lang, "waiterSectionNamePh")}
            className="min-h-11 rounded-xl border border-border px-3 text-sm"
          />
          <input
            value={newSectionWaiter}
            onChange={(e) => setNewSectionWaiter(e.target.value)}
            placeholder={t(lang, "waiterSectionWaiterPh")}
            className="min-h-11 rounded-xl border border-border px-3 text-sm"
          />
          <button
            type="button"
            className="min-h-11 rounded-xl bg-waka-600 px-4 text-sm font-black text-white"
            onClick={() => {
              if (!newSectionName.trim() || !newSectionWaiter.trim()) return;
              const tableIds = tables.map((tble) => tble.id);
              upsertWaiterSection({
                name: newSectionName.trim(),
                waiterLabel: newSectionWaiter.trim(),
                tableIds,
                sortOrder: waiterSections.length,
                isActive: true,
              });
              setNewSectionName("");
              setNewSectionWaiter("");
            }}
          >
            {t(lang, "waiterSectionAdd")}
          </button>
        </div>
        <ul className="mt-4 space-y-2">
          {waiterSections.map((sec) => (
            <li key={sec.id} className="rounded-xl bg-muted px-3 py-2 text-sm font-semibold text-muted-foreground">
              {sec.name} · {sec.waiterLabel} · {sec.tableIds.length} tables
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
