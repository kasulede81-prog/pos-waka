import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The invariants that stop the multi-shop picker becoming a dead screen.
 *
 * WHAT THIS FILE CAN AND CANNOT DO. This repo has no DOM test project — vitest runs with
 * `environment: "node"` and `include: ["src/**\/*.test.ts"]`, so a component cannot be rendered or
 * clicked here. The behavioural half of these fixes lives where it can actually run:
 * `selectStaffShop`'s timeout is exercised for real in `staffLogin.test.ts`, and the rendered
 * picker is driven for real by `scripts/verify-staff-picker.mjs`. What is left for this file is the
 * wiring those tests cannot see — that the flag is cleared where it must be, that the escape hatch
 * carries no `disabled`, and that an abandoned attempt cannot write state it no longer owns.
 */

const ROOT = process.cwd();
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const LOGIN = read("src/pages/LoginPage.tsx");
const GATE = read("src/components/auth/StaffShopGate.tsx");
const LIB = read("src/lib/staffLogin.ts");

/**
 * THE BUG THAT ACTUALLY BROKE THE PICKER.
 *
 * `if (staffGateActive) { return … }` returns before `const selectShop` / `const signOutStaff` are
 * initialised. `const` is not hoisted, so for that entire render those bindings sit in the temporal
 * dead zone — and the arrow functions the gate passes as `onSelect`/`onSignOut` close over them.
 * Every tap threw `ReferenceError: Cannot access '<minified>' before initialization` from inside
 * the handler, so nothing ran while the screen looked perfectly healthy. Found by driving the real
 * build in a browser; no static test had a chance of seeing it.
 */
describe("TDZ — anything the gate can call is declared ABOVE the early return", () => {
  const gateIdx = LOGIN.indexOf("if (staffGateActive) {");
  const authIdx = LOGIN.indexOf("if (isAuthenticated) {");

  it("the gate's early return and the authenticated return are both present, in that order", () => {
    expect(gateIdx).toBeGreaterThan(-1);
    expect(authIdx).toBeGreaterThan(gateIdx);
  });

  it("selectShop and signOutStaff are declared before the gate returns", () => {
    expect(LOGIN.indexOf("const selectShop = async")).toBeGreaterThan(-1);
    expect(LOGIN.indexOf("const signOutStaff = async")).toBeGreaterThan(-1);
    expect(LOGIN.indexOf("const selectShop = async")).toBeLessThan(gateIdx);
    expect(LOGIN.indexOf("const signOutStaff = async")).toBeLessThan(gateIdx);
  });

  it("every handler the gate passes is initialised on the render that uses it", () => {
    // Everything named in the gate's JSX must be declared earlier in the component body.
    const gateBody = LOGIN.slice(gateIdx, authIdx);
    const called = new Set(
      [...gateBody.matchAll(/(?:onSelect|onSignOut)=\{[^}]*?\b([a-zA-Z_$][\w$]*)\s*\(/g)].map((m) => m[1]),
    );
    expect(called.size).toBeGreaterThan(0);
    for (const name of called) {
      const decl = LOGIN.indexOf(`const ${name} = `);
      expect(decl, `${name} must be declared for the gate's render path`).toBeGreaterThan(-1);
      expect(decl, `${name} is declared after the early return — that is a TDZ crash`).toBeLessThan(gateIdx);
    }
  });

  it("the earlier crash signature cannot return silently", () => {
    // The gate must not reference a binding that only exists past its own return.
    const gateBody = LOGIN.slice(gateIdx, authIdx);
    for (const bad of ["canOwnerSignIn", "submit", "googleSubmit", "staffGoogleSubmit"]) {
      expect(gateBody, `the gate must not call ${bad} (declared after the return)`).not.toMatch(
        new RegExp(`\\b${bad}\\b`),
      );
    }
  });
});

describe("A — the picker can never render disabled", () => {
  it("clears staffBusy in the SAME batch as advancing the phase to choose", () => {
    // The advance site must clear the flag immediately above the phase change, so the picker's
    // first render already has it false. Relying on the Google promise to resolve is what failed.
    const effect = LOGIN.slice(LOGIN.indexOf('staffPhase !== "resolving"'), LOGIN.indexOf("}, [staffPhase, isAuthenticated, staffInviteNext])"));
    const clearIdx = effect.indexOf("setStaffBusy(false)");
    const chooseIdx = effect.indexOf('setStaffPhase("choose")');
    const noneIdx = effect.indexOf('setStaffPhase("none")');
    const enterIdx = effect.indexOf('setStaffPhase("enter")');

    expect(clearIdx, "staffBusy must be cleared when the gate takes ownership").toBeGreaterThan(-1);
    expect(chooseIdx).toBeGreaterThan(-1);
    expect(clearIdx).toBeLessThan(chooseIdx);
    expect(clearIdx).toBeLessThan(noneIdx);
    expect(clearIdx).toBeLessThan(enterIdx);
  });

  it("sign-out is gated by its own latch, never by staffBusy", () => {
    const fn = LOGIN.slice(LOGIN.indexOf("const signOutStaff = async"));
    const body = fn.slice(0, fn.indexOf("};"));
    expect(body).not.toMatch(/if \(staffBusy\) return;/);
    expect(body).toMatch(/signOutRunningRef\.current/);
  });

  it("an abandoned attempt cannot corrupt a newer one", () => {
    // Every attempt takes a number; only the current owner may write the flag.
    expect(LOGIN).toMatch(/const attempt = \+\+staffAttemptRef\.current;/);
    expect(LOGIN).toMatch(/if \(staffAttemptRef\.current === attempt\) setStaffBusy\(false\);/);
    expect(LOGIN).toMatch(/if \(staffAttemptRef\.current !== attempt\) return;/);
  });
});

describe("C — sign out is the escape hatch and is never disabled", () => {
  it("StaffShopGate renders no disabled sign-out control, in any state", () => {
    // Every sign-out button in the component must be free of a disabled attribute.
    const signOutButtons = GATE.match(/<button[^>]*data-testid="staff-gate-signout"[^>]*>/gs) ?? [];
    expect(signOutButtons.length).toBe(2); // the picker state and the no-access state
    for (const btn of signOutButtons) {
      expect(btn, "the only way off the screen must stay clickable").not.toMatch(/disabled/);
    }
  });

  it("no sign-out control is styled away when busy", () => {
    expect(GATE).not.toMatch(/loginStaffSignOut[\s\S]{0,200}disabled:opacity/);
  });

  it("shows an explicit working state instead of silently going inert", () => {
    expect(GATE).toMatch(/loginStaffChooseShopWorking/);
    expect(GATE).toMatch(/role="status"/);
  });
});

describe("D — shop selection is bounded end to end", () => {
  it("LoginPage wraps the selection in the shared timeout helper", () => {
    expect(LOGIN).toMatch(/withTimeout\(\s*selectStaffShop\(shopId\)/);
    expect(LOGIN).toMatch(/SELECT_SHOP_TIMEOUT_MS/);
  });

  it("the library bounds the switch itself", () => {
    expect(LIB).toMatch(/withTimeout<ActiveShopSwitchResult \| typeof SWITCH_TIMED_OUT>/);
    expect(LIB).toMatch(/STAFF_SHOP_SWITCH_TIMEOUT_MS/);
  });

  it("a timeout is a distinguishable sentinel, never mistaken for a result", () => {
    expect(LIB).toMatch(/const SWITCH_TIMED_OUT = \{ ok: false, error: "timeout" \} as const/);
    expect(LIB).toMatch(/if \(switched === SWITCH_TIMED_OUT\) return \{ ok: false, error: "timeout" \}/);
  });
});

describe("5 / E — failure keeps the picker, and success is the only thing that navigates", () => {
  it("a failed selection shows a retryable error and does NOT advance the phase", () => {
    const fn = LOGIN.slice(LOGIN.indexOf("const selectShop = async"));
    const body = fn.slice(0, fn.indexOf("const signOutStaff"));
    // error is surfaced…
    expect(body).toMatch(/setStaffError\(/);
    expect(body).toMatch(/staffShopSelectTimeout/);
    // …and the phase only advances on success.
    const advance = body.indexOf('setStaffPhase("enter")');
    const failReturn = body.indexOf("return; // The picker stays put");
    expect(failReturn).toBeGreaterThan(-1);
    expect(advance).toBeGreaterThan(failReturn);
  });

  it("no error path navigates away or clears the shop list", () => {
    const fn = LOGIN.slice(LOGIN.indexOf("const selectShop = async"));
    const body = fn.slice(0, fn.indexOf("const signOutStaff"));
    // Asserted on CODE, not prose: `<Navigate` as JSX, and an emptied shop list.
    expect(body).not.toMatch(/<Navigate/);
    expect(body).not.toMatch(/setStaffShops\(\[\]\)/);
    expect(body).not.toMatch(/window\.location/);
  });
});

describe("H — authorization semantics are untouched by the fixes", () => {
  it("the server checks are still the authority", () => {
    // The bound WRAPS the switch; it does not replace it or reorder its membership check.
    expect(LIB).toMatch(/switchActiveShop\(id, \{ updatePrimary: true \}\)/);
    expect(LIB).toMatch(/listUserShops/);
    // `setUserPrimaryShop` (which re-verifies the shop_members row server-side) is still reached —
    // through `switchActiveShop`, which is why this asserts on the module that owns it.
    const switchLib = read("src/lib/activeShopSwitch.ts");
    expect(switchLib).toMatch(/const shops = await listUserShops\(\)/);
    expect(switchLib).toMatch(/if \(!shops\.some\(\(s\) => s\.shop_id === nextShopId\)\)/);
    expect(switchLib).toMatch(/await setUserPrimaryShop\(nextShopId\)/);
    // Nothing here invents a role, and nothing accepts one from the caller.
    expect(LIB).not.toMatch(/role\s*[:=]\s*["']owner["']/);
  });

  it("these fixes add no API for supplying a shop or role from the client", () => {
    for (const src of [LOGIN, GATE, LIB]) {
      expect(src).not.toMatch(/p_role|p_membership_role|roleOverride/);
    }
  });
});
