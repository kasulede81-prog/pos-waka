import { useEffect, useState } from "react";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { PageBackBar } from "../components/layout/PageBackBar";
import { usePosStore } from "../store/usePosStore";
import { useShallow } from "zustand/react/shallow";
import { isHospitalityMode } from "../lib/hospitality";

export function SettingsFloorPage({ lang }: { lang: Language }) {
  const ensureHospitalityFloor = usePosStore((s) => s.ensureHospitalityFloor);
  const addDiningArea = usePosStore((s) => s.addDiningArea);
  const renameDiningArea = usePosStore((s) => s.renameDiningArea);
  const removeDiningArea = usePosStore((s) => s.removeDiningArea);
  const addDiningTable = usePosStore((s) => s.addDiningTable);
  const updateDiningTable = usePosStore((s) => s.updateDiningTable);
  const removeDiningTable = usePosStore((s) => s.removeDiningTable);
  const setHospitalityManualKitchenFire = usePosStore((s) => s.setHospitalityManualKitchenFire);

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

  if (!hospitality) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center">
        <p className="text-sm font-medium text-slate-600">{t(lang, "hospitalityNotEnabled")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-8">
      <PageBackBar lang={lang} fallbackTo="/settings" label={t(lang, "settingsHubTitle")} />
      <div>
        <h1 className="text-2xl font-black text-stone-950">{t(lang, "floorSetupTitle")}</h1>
        <p className="mt-1 text-sm font-medium text-stone-500">{t(lang, "floorSetupSub")}</p>
      </div>

      {err ? <p className="text-sm font-bold text-rose-700">{err}</p> : null}

      <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4">
        <input
          type="checkbox"
          checked={manualKitchenFire}
          onChange={(e) => setHospitalityManualKitchenFire(e.target.checked)}
          className="h-5 w-5"
        />
        <span className="text-sm font-bold text-slate-800">{t(lang, "floorManualKitchenFire")}</span>
      </label>

      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-black text-stone-950">{t(lang, "floorEditorAreas")}</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            value={newAreaName}
            onChange={(e) => setNewAreaName(e.target.value)}
            placeholder={t(lang, "floorEditorAreaPh")}
            className="min-h-11 flex-1 rounded-xl border border-slate-200 px-3 text-sm"
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
            <li key={area.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 p-3">
              <input
                defaultValue={area.name}
                onBlur={(e) => renameDiningArea(area.id, e.target.value)}
                className="min-h-10 flex-1 rounded-lg border border-slate-200 px-3 text-sm font-bold"
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

      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-black text-stone-950">{t(lang, "floorEditorTables")}</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <select
            value={newTableAreaId}
            onChange={(e) => setNewTableAreaId(e.target.value)}
            className="min-h-11 rounded-xl border border-slate-200 px-3 text-sm font-bold"
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
            className="min-h-11 rounded-xl border border-slate-200 px-3 text-sm"
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
                  <li key={tbl.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-100 p-2">
                    <input
                      defaultValue={tbl.label}
                      onBlur={(e) => updateDiningTable(tbl.id, { label: e.target.value })}
                      className="min-h-10 w-28 rounded-lg border border-slate-200 px-2 text-sm font-bold"
                    />
                    <input
                      type="number"
                      defaultValue={tbl.capacity ?? 4}
                      onBlur={(e) =>
                        updateDiningTable(tbl.id, { capacity: Math.max(1, Number(e.target.value) || 4) })
                      }
                      className="min-h-10 w-16 rounded-lg border border-slate-200 px-2 text-sm"
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

      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-black text-stone-950">{t(lang, "floorSetupStations")}</h2>
        <ul className="mt-3 space-y-2">
          {stations.map((st) => (
            <li key={st.id} className="flex justify-between text-sm font-medium text-slate-700">
              <span>{st.name}</span>
              <span className="font-bold capitalize text-slate-500">{st.stationType}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
