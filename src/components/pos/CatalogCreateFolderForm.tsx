import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";

type ParentOption = { id: string; path: string };

type Props = {
  lang: Language;
  newName: string;
  onNameChange: (value: string) => void;
  parentId: string;
  onParentChange: (value: string) => void;
  parentOptions: readonly ParentOption[];
  insideLabel: string;
  parentLocked: boolean;
  onUnlockParent: () => void;
  error: string | null;
  onCancel: () => void;
  onSubmit: () => void;
  nameClassName?: string;
  selectClassName?: string;
  cancelClassName?: string;
  submitClassName?: string;
};

export function CatalogCreateFolderForm({
  lang,
  newName,
  onNameChange,
  parentId,
  onParentChange,
  parentOptions,
  insideLabel,
  parentLocked,
  onUnlockParent,
  error,
  onCancel,
  onSubmit,
  nameClassName,
  selectClassName,
  cancelClassName,
  submitClassName,
}: Props) {
  return (
    <div className="space-y-3 rounded-2xl border border-border bg-muted/30 p-3">
      <p className="text-sm font-black text-foreground">{t(lang, "catalogFoldersCreateTitle")}</p>
      <p className="text-sm font-medium text-muted-foreground">{t(lang, "catalogFolderCreatedHint")}</p>
      <label className="block space-y-1">
        <span className="text-xs font-bold text-muted-foreground">{t(lang, "catalogFolderName")}</span>
        <input
          value={newName}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder={t(lang, "catalogFoldersNamePh")}
          autoFocus
          autoComplete="off"
          className={nameClassName ?? "min-h-[44px] w-full rounded-xl border-2 border-border px-3 text-sm font-semibold"}
        />
      </label>
      <div className="space-y-1">
        <p className="text-xs font-bold text-muted-foreground">{t(lang, "catalogFolderInside")}</p>
        <p className="break-words text-sm font-black text-foreground">{insideLabel}</p>
        {parentLocked ? (
          <button
            type="button"
            onClick={onUnlockParent}
            className="min-h-[44px] text-left text-sm font-bold text-waka-800 underline"
          >
            {t(lang, "catalogFolderChangeParent")}
          </button>
        ) : (
          <select
            value={parentId}
            onChange={(e) => onParentChange(e.target.value)}
            className={selectClassName ?? "min-h-[44px] w-full rounded-xl border-2 border-border bg-card px-3 text-sm font-semibold"}
          >
            <option value="">{t(lang, "catalogFolderInsideTop")}</option>
            {parentOptions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.path}
              </option>
            ))}
          </select>
        )}
      </div>
      {error ? <p className="text-xs font-bold text-danger">{error}</p> : null}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onCancel} className={clsx(cancelClassName, !cancelClassName && "min-h-[44px] rounded-xl border border-border px-3 text-sm font-black")}>
          {t(lang, "cancel")}
        </button>
        <button type="button" onClick={onSubmit} className={clsx(submitClassName, !submitClassName && "min-h-[44px] rounded-xl bg-waka-600 px-3 text-sm font-black text-white")}>
          {t(lang, "catalogFoldersCreateAction")}
        </button>
      </div>
    </div>
  );
}
