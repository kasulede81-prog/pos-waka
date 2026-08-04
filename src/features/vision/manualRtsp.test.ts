import { describe, expect, it } from "vitest";
import { buildRtspUrl, parseManualRtspUrl } from "./manualRtsp";

describe("manualRtsp", () => {
  it("parses full rtsp urls", () => {
    const r = parseManualRtspUrl("rtsp://admin:secret@192.168.1.64:554/Streaming/Channels/101");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.host).toBe("192.168.1.64");
    expect(r.port).toBe(554);
    expect(r.username).toBe("admin");
  });

  it("accepts bare IP and adds rtsp scheme", () => {
    const r = parseManualRtspUrl("192.168.1.10");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.host).toBe("192.168.1.10");
    expect(r.rtspUrl.startsWith("rtsp://")).toBe(true);
  });

  it("builds hikvision-style urls", () => {
    expect(buildRtspUrl({ host: "10.0.0.5", username: "admin", password: "x" })).toContain(
      "rtsp://admin:x@10.0.0.5:554/Streaming/Channels/101",
    );
  });
});
