import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => false),
  chooseFromGallery: vi.fn(),
  takePhoto: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: mocks.isNativePlatform },
}));

vi.mock("@capacitor/camera", () => ({
  Camera: {
    chooseFromGallery: mocks.chooseFromGallery,
    takePhoto: mocks.takePhoto,
  },
  MediaTypeSelection: { Photo: 0, Video: 1, All: 2 },
  CameraErrorCode: {
    ChooseMediaCancelled: "OS-PLUG-CAMR-0020",
    TakePhotoCancelled: "OS-PLUG-CAMR-0006",
    EditPhotoCancelled: "OS-PLUG-CAMR-0013",
  },
}));

import { pickImageFromGallery } from "./nativeImagePicker";

describe("nativeImagePicker", () => {
  beforeEach(() => {
    mocks.isNativePlatform.mockReturnValue(false);
    mocks.chooseFromGallery.mockReset();
    mocks.takePhoto.mockReset();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("returns null on web without opening native APIs", async () => {
    const result = await pickImageFromGallery();
    expect(result).toBeNull();
    expect(mocks.chooseFromGallery).not.toHaveBeenCalled();
  });

  it("uses Photo Picker on native without requesting storage permissions", async () => {
    mocks.isNativePlatform.mockReturnValue(true);
    mocks.chooseFromGallery.mockResolvedValue({
      results: [{ webPath: "https://localhost/_capacitor_file_/tmp/photo.jpg", uri: "file:///tmp/photo.jpg", format: "jpeg", saved: false }],
    });
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      blob: async () => new Blob(["x"], { type: "image/jpeg" }),
    } as Response);

    const picked = await pickImageFromGallery();
    expect(picked?.file.name).toMatch(/waka-image-/);
    expect(mocks.chooseFromGallery).toHaveBeenCalledWith(
      expect.objectContaining({
        allowMultipleSelection: false,
        editable: "no",
      }),
    );
  });
});
