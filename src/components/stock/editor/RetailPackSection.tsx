import clsx from "clsx";
import type { Language } from "../../../types";
import { t, tTemplate } from "../../../lib/i18n";
import { PACK_TYPE_OPTIONS, packKindLabel, type PackKind } from "../../../lib/simpleProductWizard";
import { WIZARD_INPUT_TEXT, wizardChoiceButtonClass } from "../wizard/wizardTokens";
import { WakaSwitch } from "../../../components/enterprise/WakaSwitch";

type Props = {
  lang: Language;
  hasPack: boolean;
  packKind: PackKind;
  packCustom: string;
  piecesPerPack: string;
  unitLabel: string;
  onHasPackChange: (value: boolean) => void;
  onPackKindChange: (kind: PackKind) => void;
  onPackCustomChange: (value: string) => void;
  onPiecesPerPackChange: (value: string) => void;
};

export function RetailPackSection({
  lang,
  hasPack,
  packKind,
  packCustom,
  piecesPerPack,
  unitLabel,
  onHasPackChange,
  onPackKindChange,
  onPackCustomChange,
  onPiecesPerPackChange,
}: Props) {
  const packLabel = packKindLabel(packKind, packCustom, lang);

  return (
    <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
      <WakaSwitch
        checked={hasPack}
        onCheckedChange={onHasPackChange}
        label={<span className="text-sm font-black text-foreground">{t(lang, "simpleAddPackToggle")}</span>}
      />
      {hasPack ? (
        <div className="mt-3 space-y-3">
          <p className="text-xs font-semibold text-muted-foreground">{t(lang, "simpleAddPackTypeLabel")}</p>
          <div className="grid grid-cols-2 gap-2.5">
            {PACK_TYPE_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => onPackKindChange(opt.id)}
                className={clsx(wizardChoiceButtonClass(packKind === opt.id), "min-h-[44px] text-xs")}
              >
                {t(lang, opt.labelKey as "packKind_crate")}
              </button>
            ))}
          </div>
          {packKind === "custom" ? (
            <input
              value={packCustom}
              onChange={(e) => onPackCustomChange(e.target.value)}
              placeholder={t(lang, "simpleAddPackCustomPh")}
              className={WIZARD_INPUT_TEXT}
            />
          ) : null}
          <label className="block text-sm font-bold text-foreground">
            {tTemplate(lang, "simpleAddStep5Title", { unit: unitLabel, pack: packLabel })}
            <input
              value={piecesPerPack}
              onChange={(e) => onPiecesPerPackChange(e.target.value.replace(/[^\d.]/g, "").slice(0, 6))}
              inputMode="numeric"
              placeholder="24"
              className={clsx(WIZARD_INPUT_TEXT, "mt-2")}
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}
