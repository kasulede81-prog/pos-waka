import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import type { Language } from "../types";

export const UI_LANGUAGE_STORAGE_KEY = "waka.ui.language";

const VALID: Language[] = ["en", "lg", "sw"];

export function isUiLanguage(value: string | null | undefined): value is Language {
  return value === "en" || value === "lg" || value === "sw";
}

/** Synchronous read from localStorage mirror (instant boot on repeat visits). */
export function readUiLanguageCacheSync(): Language | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(UI_LANGUAGE_STORAGE_KEY);
    return isUiLanguage(raw) ? raw : null;
  } catch {
    return null;
  }
}

function writeUiLanguageCache(lang: Language): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, lang);
  } catch {
    /* private mode / quota */
  }
}

/** Load persisted language — Preferences on native, localStorage on web. */
export async function loadPersistedUiLanguage(): Promise<Language> {
  if (Capacitor.isNativePlatform()) {
    try {
      const { value } = await Preferences.get({ key: UI_LANGUAGE_STORAGE_KEY });
      if (isUiLanguage(value)) {
        writeUiLanguageCache(value);
        return value;
      }
    } catch {
      /* fall through */
    }
  } else {
    try {
      const { value } = await Preferences.get({ key: UI_LANGUAGE_STORAGE_KEY });
      if (isUiLanguage(value)) {
        writeUiLanguageCache(value);
        return value;
      }
    } catch {
      /* web without plugin */
    }
  }

  const cached = readUiLanguageCacheSync();
  if (cached) return cached;
  return "en";
}

/** Persist language to Capacitor Preferences and localStorage mirror. */
export async function persistUiLanguage(lang: Language): Promise<void> {
  if (!VALID.includes(lang)) return;
  writeUiLanguageCache(lang);
  try {
    await Preferences.set({ key: UI_LANGUAGE_STORAGE_KEY, value: lang });
  } catch {
    /* web fallback already in localStorage */
  }
}
