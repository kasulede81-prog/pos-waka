import { useState } from "react";
import type { Language, MenuSectionDef } from "../../types";
import { t } from "../../lib/i18n";
import {
  addMenuSection,
  isMenuSectionActive,
  normalizeMenuSectionLabel,
  restoreDefaultMenuSections,
  setMenuSectionActive,
  sortMenuSections,
  validateMenuSectionNames,
} from "../../lib/menuSections";

type Props = {
  lang: Language;
  sections: MenuSectionDef[];
  onSave: (sections: MenuSectionDef[]) => void;
};

/**
 * Owner/settings-only section manager. Edits are held in a draft and applied
 * with Save; deactivation keeps the section record (and every product ID that
 * points at it) intact.
 */
export function MenuSectionsManager({ lang, sections, onSave }: Props) {
  const [draft, setDraft] = useState<MenuSectionDef[]>(() => sortMenuSections(sections));
  const [newLabel, setNewLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  const updateLabel = (id: string, label: string) => {
    setDraft((rows) => rows.map((row) => (row.id === id ? { ...row, label } : row)));
    setError(null);
  };

  const toggleActive = (id: string) => {
    setDraft((rows) => {
      const current = rows.find((row) => row.id === id);
      if (!current) return rows;
      return setMenuSectionActive(rows, id, !isMenuSectionActive(current));
    });
    setError(null);
  };

  const add = () => {
    const result = addMenuSection(draft, newLabel);
    if (!result.ok) {
      setError(t(lang, result.errorKey ?? "invalid"));
      return;
    }
    setDraft(sortMenuSections(result.sections));
    setNewLabel("");
    setError(null);
  };

  const save = () => {
    const invalid = validateMenuSectionNames(draft);
    if (invalid) {
      setError(t(lang, invalid));
      return;
    }
    const next = sortMenuSections(
      draft.map((section) => ({ ...section, label: normalizeMenuSectionLabel(section.label) })),
    );
    setDraft(next);
    setError(null);
    onSave(next);
  };

  const restoreDefaults = () => {
    const next = restoreDefaultMenuSections(draft);
    setDraft(next);
    setError(null);
    onSave(next);
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <p className="text-sm font-black text-foreground">{t(lang, "menuSectionsManageTitle")}</p>
      <p className="mt-1 text-xs font-medium text-muted-foreground">
        {t(lang, "menuSectionsManageSub")}
      </p>

      <ul className="mt-3 space-y-2">
        {sortMenuSections(draft).map((section) => {
          const active = isMenuSectionActive(section);
          return (
            <li
              key={section.id}
              className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 rounded-xl bg-muted p-2"
            >
              <input
                value={section.label}
                onChange={(e) => updateLabel(section.id, e.target.value)}
                aria-label={`${t(lang, "menuSection")}: ${section.label}`}
                className="min-h-[40px] w-full rounded-lg border border-border bg-card px-2 text-sm font-bold"
              />
              <span
                className={`text-[10px] font-black uppercase ${
                  active ? "text-waka-700" : "text-muted-foreground"
                }`}
              >
                {t(lang, active ? "menuSectionActive" : "menuSectionInactive")}
              </span>
              <button
                type="button"
                onClick={() => toggleActive(section.id)}
                className="min-h-[36px] rounded-lg border border-border bg-card px-2 text-[11px] font-black text-foreground"
              >
                {t(lang, active ? "menuSectionsDeactivate" : "menuSectionsActivate")}
              </button>
            </li>
          );
        })}
      </ul>

      <p className="mt-2 text-[11px] font-medium text-muted-foreground">
        {t(lang, "menuSectionsDeactivateHint")}
      </p>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          value={newLabel}
          onChange={(e) => {
            setNewLabel(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={t(lang, "menuSectionsAddPlaceholder")}
          aria-label={t(lang, "menuSectionsAddPlaceholder")}
          className="min-h-[40px] min-w-0 flex-1 rounded-lg border border-border px-2 text-sm font-bold"
        />
        <button
          type="button"
          onClick={add}
          className="min-h-[40px] rounded-xl border border-waka-200 bg-waka-50 px-3 text-xs font-black text-waka-950"
        >
          {t(lang, "menuSectionsAdd")}
        </button>
      </div>

      {error ? <p className="mt-2 text-xs font-bold text-red-600">{error}</p> : null}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={restoreDefaults}
          className="min-h-[40px] rounded-xl border border-border text-xs font-black text-muted-foreground"
        >
          {t(lang, "menuResetSections")}
        </button>
        <button
          type="button"
          onClick={save}
          className="min-h-[40px] rounded-xl bg-waka-600 text-xs font-black text-white"
        >
          {t(lang, "menuSectionsSave")}
        </button>
      </div>
    </section>
  );
}
