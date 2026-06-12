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

describe("language persistence", () => {
  beforeEach(() => {
    installLocalStorageMock();
    prefsStore.clear();
    storage.clear();
  });

  afterEach(() => {
    storage.clear();
    vi.unstubAllGlobals();
  });

  it("validates supported language codes", () => {
    expect(isUiLanguage("en")).toBe(true);
    expect(isUiLanguage("lg")).toBe(true);
    expect(isUiLanguage("sw")).toBe(true);
    expect(isUiLanguage("fr")).toBe(false);
  });

  it("reads synchronous cache from localStorage for instant boot", () => {
    localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, "lg");
    expect(readUiLanguageCacheSync()).toBe("lg");
  });

  it("survives persist and reload via Preferences + mirror", async () => {
    await persistUiLanguage("sw");
    expect(await loadPersistedUiLanguage()).toBe("sw");
    expect(readUiLanguageCacheSync()).toBe("sw");
    expect(prefsStore.get(UI_LANGUAGE_STORAGE_KEY)).toBe("sw");
  });

  it("defaults to English when nothing stored", async () => {
    expect(await loadPersistedUiLanguage()).toBe("en");
  });

  it("does not clear language when unrelated storage is cleared", async () => {
    await persistUiLanguage("lg");
    localStorage.removeItem("other-key");
    expect(readUiLanguageCacheSync()).toBe("lg");
    expect(await loadPersistedUiLanguage()).toBe("lg");
  });
});
