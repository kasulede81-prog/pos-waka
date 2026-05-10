import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";

function native(): boolean {
  return Capacitor.isNativePlatform();
}

/** Subtle tap — line added, preset pressed */
export async function hapticTap(): Promise<void> {
  if (!native()) return;
  try {
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch {
    /* no-op: web or unsupported */
  }
}

/** Stronger feedback — sale saved */
export async function hapticSaleComplete(): Promise<void> {
  if (!native()) return;
  try {
    await Haptics.notification({ type: NotificationType.Success });
  } catch {
    try {
      await Haptics.impact({ style: ImpactStyle.Medium });
    } catch {
      /* ignore */
    }
  }
}

let audioCtx: AudioContext | null = null;

/** Very short pleasant “cash” tone — Web Audio, no extra assets */
export function playSaleSuccessTone(): void {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    if (!audioCtx) audioCtx = new AC();
    const ctx = audioCtx;
    if (ctx.state === "suspended") void ctx.resume();

    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    master.connect(ctx.destination);

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(1174, now + 0.08);
    osc.connect(master);
    osc.start(now);
    osc.stop(now + 0.24);
  } catch {
    /* ignore */
  }
}
