import type { AuditAction, Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { INVESTIGATION_ACTIONS, type AuditSearchFilters } from "../../../lib/auditSearch";
import { auditActionLabel } from "../../../lib/auditCenterDetails";
import { ModalSheet } from "../../../components/layout/ModalSheet";
import { resolveDateFilterBounds, type DateFilterValue } from "../../../lib/dateFilters";

type Props = {
  lang: Language;
  open: boolean;
  onClose: () => void;
  filters: AuditSearchFilters;
  quickDate: DateFilterValue;
  actors: Array<{ userId: string; name: string }>;
  products: Array<{ id: string; name: string }>;
  customers: Array<{ id: string; name: string }>;
  suppliers: Array<{ id: string; name: string }>;
  onApply: (next: {
    dateFrom: string;
    dateTo: string;
    quickDate: DateFilterValue;
    actorUserId: string;
    action: AuditAction | "all";
    productId: string;
    customerId: string;
    supplierId: string;
  }) => void;
};

const PRESETS: DateFilterValue[] = [
  { kind: "preset", preset: "today" },
  { kind: "preset", preset: "yesterday" },
  { kind: "preset", preset: "this_week" },
  { kind: "preset", preset: "this_month" },
];

const inputClass =
  "mt-1 min-h-[44px] w-full rounded-xl border-2 border-stone-200 px-3 text-sm font-semibold outline-none focus:border-waka-500";

export function InvestigationFiltersSheet({
  lang,
  open,
  onClose,
  filters,
  quickDate,
  actors,
  products,
  customers,
  suppliers,
  onApply,
}: Props) {
  const draftFrom = filters.dateFrom ?? "";
  const draftTo = filters.dateTo ?? "";

  const applyPreset = (preset: DateFilterValue) => {
    const bounds = resolveDateFilterBounds(preset);
    onApply({
      dateFrom: bounds.fromKey,
      dateTo: bounds.toKey,
      quickDate: preset,
      actorUserId: filters.actorUserId ?? "all",
      action: filters.action ?? "all",
      productId: filters.productId ?? "",
      customerId: filters.customerId ?? "",
      supplierId: filters.supplierId ?? "",
    });
  };

  const applyPatch = (patch: Partial<Parameters<Props["onApply"]>[0]>) => {
    onApply({
      dateFrom: patch.dateFrom ?? draftFrom,
      dateTo: patch.dateTo ?? draftTo,
      quickDate: patch.quickDate ?? quickDate,
      actorUserId: patch.actorUserId ?? filters.actorUserId ?? "all",
      action: patch.action ?? filters.action ?? "all",
      productId: patch.productId ?? filters.productId ?? "",
      customerId: patch.customerId ?? filters.customerId ?? "",
      supplierId: patch.supplierId ?? filters.supplierId ?? "",
    });
  };

  return (
    <ModalSheet
      open={open}
      onClose={onClose}
      title={t(lang, "icFiltersTitle")}
      footer={
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() =>
              applyPatch({
                dateFrom: resolveDateFilterBounds({ kind: "preset", preset: "this_month" }).fromKey,
                dateTo: resolveDateFilterBounds({ kind: "preset", preset: "this_month" }).toKey,
                quickDate: { kind: "preset", preset: "this_month" },
                actorUserId: "all",
                action: "all",
                productId: "",
                customerId: "",
                supplierId: "",
              })
            }
            className="min-h-[48px] flex-1 rounded-2xl border-2 border-stone-200 text-sm font-black text-stone-700"
          >
            {t(lang, "icResetFilters")}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[48px] flex-[1.4] rounded-2xl bg-waka-600 text-sm font-black text-white"
          >
            {t(lang, "icApplyFilters")}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <p className="text-xs font-black uppercase tracking-widest text-stone-500">{t(lang, "icDateRange")}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {PRESETS.map((preset) => {
              const key =
                preset.kind === "preset"
                  ? preset.preset === "today"
                    ? "dateFilterPresetToday"
                    : preset.preset === "yesterday"
                      ? "dateFilterPresetYesterday"
                      : preset.preset === "this_week"
                        ? "dateFilterPresetThisWeek"
                        : "dateFilterPresetThisMonth"
                  : "dateFilterPresetThisMonth";
              const active =
                quickDate.kind === "preset" && preset.kind === "preset" && quickDate.preset === preset.preset;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => applyPreset(preset)}
                  className={`rounded-full px-3 py-1.5 text-xs font-black ${
                    active ? "bg-waka-600 text-white" : "border border-stone-200 bg-white text-stone-700"
                  }`}
                >
                  {t(lang, key)}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-bold text-stone-800">
            {t(lang, "auditFilterDateFrom")}
            <input type="date" className={inputClass} value={draftFrom} onChange={(e) => applyPatch({ dateFrom: e.target.value, quickDate: { kind: "range", fromKey: e.target.value, toKey: draftTo } })} />
          </label>
          <label className="block text-sm font-bold text-stone-800">
            {t(lang, "auditFilterDateTo")}
            <input type="date" className={inputClass} value={draftTo} onChange={(e) => applyPatch({ dateTo: e.target.value, quickDate: { kind: "range", fromKey: draftFrom, toKey: e.target.value } })} />
          </label>
        </div>

        <label className="block text-sm font-bold text-stone-800">
          {t(lang, "auditFilterStaff")}
          <select className={inputClass} value={filters.actorUserId ?? "all"} onChange={(e) => applyPatch({ actorUserId: e.target.value })}>
            <option value="all">{t(lang, "auditFilterAll")}</option>
            {actors.map((a) => (
              <option key={a.userId} value={a.userId}>
                {a.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm font-bold text-stone-800">
          {t(lang, "auditFilterAction")}
          <select className={inputClass} value={filters.action ?? "all"} onChange={(e) => applyPatch({ action: e.target.value as AuditAction | "all" })}>
            <option value="all">{t(lang, "auditFilterAll")}</option>
            {[...INVESTIGATION_ACTIONS].sort().map((a) => (
              <option key={a} value={a}>
                {auditActionLabel(lang, a)}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm font-bold text-stone-800">
          {t(lang, "auditFilterProduct")}
          <select className={inputClass} value={filters.productId ?? ""} onChange={(e) => applyPatch({ productId: e.target.value })}>
            <option value="">{t(lang, "auditFilterAll")}</option>
            {[...products]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </label>

        <label className="block text-sm font-bold text-stone-800">
          {t(lang, "auditFilterCustomer")}
          <select className={inputClass} value={filters.customerId ?? ""} onChange={(e) => applyPatch({ customerId: e.target.value })}>
            <option value="">{t(lang, "auditFilterAll")}</option>
            {[...customers]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </label>

        <label className="block text-sm font-bold text-stone-800">
          {t(lang, "auditFilterSupplier")}
          <select className={inputClass} value={filters.supplierId ?? ""} onChange={(e) => applyPatch({ supplierId: e.target.value })}>
            <option value="">{t(lang, "auditFilterAll")}</option>
            {[...suppliers]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </label>
      </div>
    </ModalSheet>
  );
}
