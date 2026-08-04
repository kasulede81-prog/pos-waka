import { describe, expect, it } from "vitest";
import { buildDemoNvrChannels, buildNvrChannelRtsp, nvrChannelsToCandidates } from "./nvrImport";

describe("nvrImport", () => {
  it("builds brand-specific RTSP templates", () => {
    expect(buildNvrChannelRtsp("hikvision", "10.0.0.1", 2)).toContain("/Streaming/Channels/201");
    expect(buildNvrChannelRtsp("dahua", "10.0.0.1", 2)).toContain("channel=2");
    expect(buildNvrChannelRtsp("reolink", "10.0.0.1", 1)).toContain("h264Preview_01_main");
    expect(buildNvrChannelRtsp("uniview", "10.0.0.1", 3)).toContain("/c3/");
  });

  it("maps demo channels to discovery candidates", () => {
    const channels = buildDemoNvrChannels("tplink_vigi", "192.168.1.40");
    const candidates = nvrChannelsToCandidates(channels, "tplink_vigi", "192.168.1.40");
    expect(candidates).toHaveLength(4);
    expect(candidates[0]?.source).toBe("nvr_import");
    expect(candidates[0]?.brand).toBe("TP-Link VIGI");
  });
});
