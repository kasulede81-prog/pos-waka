export type HlsHandle = {
  stop: () => void;
};

/** HLS fallback via hls.js (or native Safari HLS). */
export async function startHlsPlayback(
  hlsUrl: string,
  video: HTMLVideoElement,
  opts?: { muted?: boolean },
): Promise<HlsHandle> {
  video.muted = opts?.muted ?? true;

  const canNative = video.canPlayType("application/vnd.apple.mpegurl");
  if (canNative) {
    video.src = hlsUrl;
    await video.play().catch(() => undefined);
    return {
      stop: () => {
        video.removeAttribute("src");
        video.load();
      },
    };
  }

  const HlsMod = await import("hls.js");
  const Hls = HlsMod.default;
  if (!Hls.isSupported()) {
    throw new Error("HLS not supported");
  }
  const hls = new Hls({
    enableWorker: true,
    lowLatencyMode: true,
    backBufferLength: 30,
  });
  hls.loadSource(hlsUrl);
  hls.attachMedia(video);
  await new Promise<void>((resolve, reject) => {
    const onError = (_: unknown, data: { fatal?: boolean }) => {
      if (data.fatal) reject(new Error("HLS fatal error"));
    };
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      hls.off(Hls.Events.ERROR, onError);
      resolve();
    });
    hls.on(Hls.Events.ERROR, onError);
  });
  await video.play().catch(() => undefined);

  return {
    stop: () => {
      hls.destroy();
      video.removeAttribute("src");
      video.load();
    },
  };
}
