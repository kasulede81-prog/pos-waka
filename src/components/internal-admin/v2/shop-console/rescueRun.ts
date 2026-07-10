import type { ShopConsoleState } from "./useShopConsoleState";

/** @deprecated Use ctx.executeAction directly — thin wrapper for tab migration. */
export async function runShopConsoleRescueAction(
  ctx: ShopConsoleState,
  action: string,
  fn: () => Promise<{ ok: boolean; message?: string }>,
  opts?: { confirm?: string; permitted?: boolean },
) {
  return ctx.executeAction(action, fn, opts);
}
