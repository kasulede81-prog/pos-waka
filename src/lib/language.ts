import type { Language } from "../types";

export const LANGUAGES: Language[] = ["en", "lg", "sw"];

export function nextLanguage(current: Language): Language {
  const i = LANGUAGES.indexOf(current);
  return LANGUAGES[(i + 1) % LANGUAGES.length] ?? "en";
}

/** Short label on the language toggle button. */
export function languageToggleLabel(lang: Language): string {
  if (lang === "en") return "English";
  if (lang === "lg") return "Luganda";
  return "Kiswahili";
}
