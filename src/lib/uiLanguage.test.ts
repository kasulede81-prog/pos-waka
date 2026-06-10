import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isUiLanguage,
  loadPersistedUiLanguage,
  persistUiLanguage,
  readUiLanguageCacheSync,
  UI_LANGUAGE_STORAGE_KEY,
} from "./uiLanguage";

const prefsStore = new Map<string, string>();
const storage = new Map<string, string>();

function installLocalStorageMock(): void {
  const mock = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
    clear: () => {
      storage.clear();
    },
  };
  vi.stubGlobal("localStorage", mock);
}

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => false },
}));

vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({ value: prefsStore.get(key) ?? null }),
    set: async ({ key, value }: { key: string; value: string }) => {
      prefsStore.set(key, value);
    },
  },
}));

describe("uiLanguage persistence", () => {
  beforeEach(() => {
    installLocalStorageMock();
    prefsStore.clear();
    storage.clear();
  });

  afterEach(() => {
    storage.clear();
    vi.unstubAllGlobals();
  });

  it("validates language codes", () => {
    expect(isUiLanguage("lg")).toBe(true);
    expect(isUiLanguage("fr")).toBe(false);
  });

  it("reads synchronous cache from localStorage", () => {
    localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, "lg");
    expect(readUiLanguageCacheSync()).toBe("lg");
  });

  it("restores persisted language on load", async () => {
    await persistUiLanguage("lg");
    const loaded = await loadPersistedUiLanguage();
    expect(loaded).toBe("lg");
    expect(readUiLanguageCacheSync()).toBe("lg");
  });

  it("defaults to English when nothing stored", async () => {
    expect(await loadPersistedUiLanguage()).toBe("en");
  });
});
