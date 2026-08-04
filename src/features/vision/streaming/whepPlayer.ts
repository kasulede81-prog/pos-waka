/** Minimal WHEP (WebRTC-HTTP Egress Protocol) player for MediaMTX. */

function waitIceGatheringComplete(pc: RTCPeerConnection, timeoutMs = 2500): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(), timeoutMs);
    const onState = () => {
      if (pc.iceGatheringState === "complete") {
        window.clearTimeout(timer);
        pc.removeEventListener("icegatheringstatechange", onState);
        resolve();
      }
    };
    pc.addEventListener("icegatheringstatechange", onState);
  });
}

export type WhepHandle = {
  pc: RTCPeerConnection;
  stop: () => void;
};

export async function startWhepPlayback(
  whepUrl: string,
  video: HTMLVideoElement,
  opts?: { muted?: boolean },
): Promise<WhepHandle> {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });

  pc.addTransceiver("video", { direction: "recvonly" });
  pc.addTransceiver("audio", { direction: "recvonly" });

  pc.ontrack = (ev) => {
    if (ev.streams[0]) {
      video.srcObject = ev.streams[0];
      video.muted = opts?.muted ?? true;
      void video.play().catch(() => {
        /* autoplay policies */
      });
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitIceGatheringComplete(pc);

  const res = await fetch(whepUrl, {
    method: "POST",
    headers: { "Content-Type": "application/sdp" },
    body: pc.localDescription?.sdp ?? offer.sdp ?? "",
  });
  if (!res.ok) {
    pc.close();
    throw new Error(`WHEP ${res.status}`);
  }
  const answer = await res.text();
  await pc.setRemoteDescription({ type: "answer", sdp: answer });

  return {
    pc,
    stop: () => {
      try {
        pc.getReceivers().forEach((r) => r.track?.stop());
        pc.close();
      } catch {
        /* ignore */
      }
      if (video.srcObject) {
        video.srcObject = null;
      }
    },
  };
}
