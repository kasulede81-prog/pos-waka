import { useMemo, useState } from "react";

export type BusinessNameSuggestion = {
  id: string;
  label: string;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  suggestions: BusinessNameSuggestion[];
  loading?: boolean;
  required?: boolean;
  label: string;
  placeholder?: string;
  hint?: string;
};

function normalizeForMatch(text: string): string {
  return text.trim().toLowerCase();
}

/** Client-side filter for cached shop names; replace with server search later. */
function filterSuggestions(query: string, items: BusinessNameSuggestion[], limit = 8): BusinessNameSuggestion[] {
  const q = normalizeForMatch(query);
  if (!q) return items.slice(0, limit);
  return items
    .filter((item) => normalizeForMatch(item.label).includes(q))
    .slice(0, limit);
}

/**
 * Business name input structured for future autocomplete:
 * - controlled value + onChange
 * - suggestions list (today: local datalist + optional dropdown)
 * - combobox semantics for screen readers
 */
export function StaffBusinessNameField({
  value,
  onChange,
  suggestions,
  loading = false,
  required = true,
  label,
  placeholder,
  hint,
}: Props) {
  const listId = "waka-staff-business-suggestions";
  const [focused, setFocused] = useState(false);

  const visibleSuggestions = useMemo(
    () => filterSuggestions(value, suggestions),
    [value, suggestions],
  );

  const showDropdown = focused && value.trim().length > 0 && visibleSuggestions.length > 0;

  return (
    <div className="relative">
      <label className="block text-sm font-medium">
        {label}
        <input
          type="text"
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls={showDropdown ? `${listId}-dropdown` : undefined}
          aria-autocomplete="list"
          list={listId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => window.setTimeout(() => setFocused(false), 120)}
          required={required}
          autoComplete="organization"
          className="mt-1 w-full rounded-xl border px-3 py-2.5 text-base outline-none ring-waka-200 focus:ring"
          placeholder={placeholder}
        />
      </label>

      <datalist id={listId}>
        {suggestions.map((s) => (
          <option key={s.id} value={s.label} />
        ))}
      </datalist>

      {showDropdown ? (
        <ul
          id={`${listId}-dropdown`}
          role="listbox"
          className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-xl border border-border bg-card py-1 shadow-lg"
        >
          {visibleSuggestions.map((s) => (
            <li key={s.id} role="option">
              <button
                type="button"
                className="w-full px-3 py-2.5 text-left text-sm font-semibold text-foreground hover:bg-waka-50 active:bg-waka-100"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(s.label);
                  setFocused(false);
                }}
              >
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {loading ? <span className="mt-1 block text-xs text-muted-foreground">{hint ?? "Loading saved shops…"}</span> : null}
      {!loading && hint ? <span className="mt-1 block text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}
