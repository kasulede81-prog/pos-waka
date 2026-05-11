/** Cash drawer kick (printer-driven or GPIO on supported terminals). */
export async function pulseDrawer(): Promise<{ ok: boolean; error?: string }> {
  return { ok: false, error: "Cash drawer not connected." };
}
