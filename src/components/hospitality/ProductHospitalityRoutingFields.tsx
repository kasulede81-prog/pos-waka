import type { HospitalityCourse, KitchenStationType, Language, ProductHospitalityRouting } from "../../types";
import { t } from "../../lib/i18n";
import { WakaSwitch } from "../enterprise/WakaSwitch";
import {
  HOSPITALITY_COURSES,
  KITCHEN_STATION_TYPES,
  hospitalityCourseLabelKey,
  hospitalityRoutingLabelKey,
} from "../../lib/productHospitalityRouting";

type Props = {
  lang: Language;
  value: ProductHospitalityRouting | null;
  onChange: (next: ProductHospitalityRouting | null) => void;
  onSuggestFromCategory?: () => void;
};

const fieldClass =
  "mt-1.5 min-h-[44px] w-full rounded-xl border-2 border-border bg-card px-3 py-2.5 text-base font-semibold outline-none focus:border-waka-400 focus:ring-2 focus:ring-waka-100";

export function ProductHospitalityRoutingFields({ lang, value, onChange, onSuggestFromCategory }: Props) {
  const routing = value ?? {};

  const patch = (p: Partial<ProductHospitalityRouting>) => {
    onChange({
      ...routing,
      ...p,
      routingAutoInferred: p.routingAutoInferred ?? false,
    });
  };

  return (
    <section className="space-y-4 rounded-2xl border border-waka-200 bg-waka-50/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-black text-foreground">{t(lang, "productHospitalityRoutingTitle")}</h3>
          <p className="text-xs font-medium text-muted-foreground">{t(lang, "productHospitalityRoutingSub")}</p>
        </div>
        {onSuggestFromCategory ? (
          <button
            type="button"
            onClick={onSuggestFromCategory}
            className="shrink-0 rounded-lg border border-waka-300 bg-card px-3 py-1.5 text-xs font-black text-waka-800"
          >
            {t(lang, "productHospitalitySuggest")}
          </button>
        ) : null}
      </div>

      <label className="block">
        <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
          {t(lang, "productHospitalityProductionStation")}
        </span>
        <select
          value={routing.productionStation ?? ""}
          onChange={(e) =>
            patch({
              productionStation: (e.target.value || null) as KitchenStationType | null,
              routingAutoInferred: false,
            })
          }
          className={fieldClass}
        >
          <option value="">{t(lang, "productHospitalityAutoRoute")}</option>
          {KITCHEN_STATION_TYPES.map((station) => (
            <option key={station} value={station}>
              {t(lang, hospitalityRoutingLabelKey(station) as "hospitalityStation_kitchen")}
            </option>
          ))}
        </select>
        {routing.routingAutoInferred ? (
          <p className="mt-1 text-[11px] font-semibold text-amber-800">{t(lang, "productHospitalityInferredHint")}</p>
        ) : null}
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            {t(lang, "productHospitalityPrepMinutes")}
          </span>
          <input
            type="number"
            min={1}
            max={240}
            value={routing.prepTimeMinutes ?? ""}
            onChange={(e) =>
              patch({
                prepTimeMinutes: e.target.value ? Math.max(1, Number(e.target.value) || 1) : null,
              })
            }
            placeholder="—"
            className={fieldClass}
          />
        </label>
        <label className="block">
          <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            {t(lang, "productHospitalityDefaultCourse")}
          </span>
          <select
            value={routing.defaultCourse ?? ""}
            onChange={(e) =>
              patch({ defaultCourse: (e.target.value || null) as HospitalityCourse | null })
            }
            className={fieldClass}
          >
            <option value="">{t(lang, "productHospitalityAutoRoute")}</option>
            {HOSPITALITY_COURSES.map((course) => (
              <option key={course} value={course}>
                {t(lang, hospitalityCourseLabelKey(course) as "hospitalityCourse_main")}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block">
        <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
          {t(lang, "productHospitalityPrintStation")}
        </span>
        <select
          value={routing.printableStation ?? ""}
          onChange={(e) =>
            patch({ printableStation: (e.target.value || null) as KitchenStationType | null })
          }
          className={fieldClass}
        >
          <option value="">{t(lang, "productHospitalitySameAsProduction")}</option>
          {KITCHEN_STATION_TYPES.map((station) => (
            <option key={station} value={station}>
              {t(lang, hospitalityRoutingLabelKey(station) as "hospitalityStation_kitchen")}
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-col gap-2">
        <div className="rounded-xl border border-border bg-card px-3 py-3">
          <WakaSwitch
            checked={routing.modifiersAllowed !== false}
            onCheckedChange={(checked) => patch({ modifiersAllowed: checked })}
            label={t(lang, "productHospitalityModifiersAllowed")}
          />
        </div>
        <div className="rounded-xl border border-border bg-card px-3 py-3">
          <WakaSwitch
            checked={routing.cookingPreferencesAllowed === true}
            onCheckedChange={(checked) => patch({ cookingPreferencesAllowed: checked })}
            label={t(lang, "productHospitalityCookingPrefs")}
          />
        </div>
      </div>
    </section>
  );
}
