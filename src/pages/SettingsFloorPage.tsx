import { useEffect } from "react";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { PageBackBar } from "../components/layout/PageBackBar";
import { usePosStore } from "../store/usePosStore";
import { useShallow } from "zustand/react/shallow";

export function SettingsFloorPage({ lang }: { lang: Language }) {
  const ensureHospitalityFloor = usePosStore((s) => s.ensureHospitalityFloor);
  const { floor, businessType } = usePosStore(
    useShallow((s) => ({
      floor: s.preferences.hospitalityFloor,
      businessType: s.preferences.businessType,
    })),
  );

  useEffect(() => {
    ensureHospitalityFloor();
  }, [ensureHospitalityFloor]);

  const areas = floor?.areas ?? [];
  const tables = floor?.tables ?? [];
  const stations = floor?.stations ?? [];

  return (
    <div className="space-y-6 pb-8">
      <PageBackBar lang={lang} fallbackTo="/settings" label={t(lang, "settingsHubTitle")} />
      <div>
        <h1 className="text-2xl font-black text-stone-950">{t(lang, "floorSetupTitle")}</h1>
        <p className="mt-1 text-sm font-medium text-stone-500">{t(lang, "floorSetupSub")}</p>
      </div>

      <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
        <p className="text-sm font-bold text-slate-700">{t(lang, "floorSetupBusinessType")}</p>
        <p className="text-base font-black text-stone-950">{t(lang, `businessType_${businessType}`)}</p>
      </div>

      {areas.map((area) => {
        const areaTables = tables.filter((tbl) => tbl.areaId === area.id);
        return (
          <div key={area.id} className="rounded-2xl border border-slate-200 bg-white p-4">
            <h2 className="text-lg font-black text-stone-950">{area.name}</h2>
            <p className="mt-1 text-sm text-slate-600">
              {t(lang, "floorSetupTableCount").replace("{count}", String(areaTables.length))}
            </p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {areaTables.map((tbl) => (
                <li key={tbl.id} className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-bold text-slate-800">
                  {tbl.label}
                </li>
              ))}
            </ul>
          </div>
        );
      })}

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

      <p className="text-sm font-medium text-slate-500">{t(lang, "floorSetupEditHint")}</p>
    </div>
  );
}
