import { afterEach, describe, expect, it } from "vitest";
import {
  ANDROID_BACK_PRIORITY,
  clearAndroidBackHandlers,
  dispatchAndroidBack,
  registerAndroidBackHandler,
} from "./androidBackStack";

describe("android back stack", () => {
  afterEach(() => {
    clearAndroidBackHandlers();
  });

  it("handles higher-priority overlays first", () => {
    const log: string[] = [];
    registerAndroidBackHandler("sheet", ANDROID_BACK_PRIORITY.productSheet, () => {
      log.push("sheet");
      return true;
    });
    registerAndroidBackHandler("camera", ANDROID_BACK_PRIORITY.camera, () => {
      log.push("camera");
      return true;
    });
    registerAndroidBackHandler("checkout", ANDROID_BACK_PRIORITY.checkout, () => {
      log.push("checkout");
      return true;
    });

    expect(dispatchAndroidBack()).toBe(true);
    expect(log).toEqual(["camera"]);
  });

  it("closes newest modal within same priority tier", () => {
    const log: string[] = [];
    registerAndroidBackHandler("modal-a", ANDROID_BACK_PRIORITY.modal, () => {
      log.push("a");
      return true;
    });
    registerAndroidBackHandler("modal-b", ANDROID_BACK_PRIORITY.modal, () => {
      log.push("b");
      return true;
    });

    expect(dispatchAndroidBack()).toBe(true);
    expect(log).toEqual(["b"]);
  });

  it("returns false when no handler consumes back", () => {
    registerAndroidBackHandler("inactive", ANDROID_BACK_PRIORITY.modal, () => false);
    expect(dispatchAndroidBack()).toBe(false);
  });

  it("skips handlers that return false and tries next", () => {
    let sheetClosed = false;
    registerAndroidBackHandler("camera", ANDROID_BACK_PRIORITY.camera, () => false);
    registerAndroidBackHandler("sheet", ANDROID_BACK_PRIORITY.productSheet, () => {
      sheetClosed = true;
      return true;
    });

    expect(dispatchAndroidBack()).toBe(true);
    expect(sheetClosed).toBe(true);
  });
});
