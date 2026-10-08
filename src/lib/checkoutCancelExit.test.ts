import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The payer's guaranteed way out of "Payment pending".
 *
 * A STRUCTURAL SUITE, deliberately, and the only kind available here: this repo
 * has no DOM test project (vitest runs `environment: "node"`, and no renderer is
 * installed), so `CheckoutFlow` cannot be mounted. What it pins is the shape of
 * the exit — that the action exists, that it confirms before acting, that it
 * goes through the server and never claims a cancellation the server refused,
 * and that the second exit ("Back to plans") can never be disabled. The state-
 * machine half of the same guarantee is behavioural, in
 * `paymentCheckout.test.ts` ("G3 — cancel a pending payment").
 *
 * The dialog's own accessibility contract (focus trap, Escape → cancel, focus
 * return, `role="dialog"` + `aria-modal`) lives in `ConfirmationDialog`, which
 * is reused unchanged.
 */

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../components/subscription/CheckoutFlow.tsx"),
  "utf8",
);

/** Comments stripped, so an assertion about CODE is neither satisfied nor defeated by prose. */
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * The cancel handler's own body.
 *
 * Scoped deliberately: a sibling handler (the status check) also branches on
 * `result.ok === true`, so an unscoped search would silently assert against the
 * wrong callback.
 */
const cancelHandler = (() => {
  const start = code.indexOf("const onCancelPayment");
  if (start === -1) return "";
  const end = code.indexOf("\n  const ", start + 1);
  return code.slice(start, end === -1 ? undefined : end);
})();

/** The JSX branch that renders the pending screen — anchored on the JSX, not the `const pending =` helper. */
const pendingBlock = (() => {
  const start = code.indexOf('{state.phase === "pending_provider" && state.intent');
  const end = code.indexOf('state.phase === "provider_not_configured"', start);
  return start === -1 || end === -1 ? "" : code.slice(start, end);
})();

describe("G3 — a pending checkout can always be exited", () => {
  it("the pending screen offers a cancel action", () => {
    expect(pendingBlock).not.toBe("");
    expect(pendingBlock).toContain("checkoutCancelPayment");
    expect(pendingBlock).toContain("setCancelOpen(true)");
  });

  it("cancelling asks for confirmation first", () => {
    expect(pendingBlock).toContain("ConfirmationDialog");
    expect(pendingBlock).toContain("checkoutCancelConfirmTitle");
    expect(pendingBlock).toContain("checkoutCancelConfirmBody");
    // The dialog's own two answers: keep it, or cancel it.
    expect(pendingBlock).toContain('confirmLabelKey="checkoutCancelPayment"');
    expect(pendingBlock).toContain('cancelLabelKey="checkoutCancelKeep"');
    // Escape / backdrop close the dialog without confirming — "Keep payment".
    expect(pendingBlock).toContain("onClose={() => setCancelOpen(false)}");
  });

  it("does not cancel on the first click", () => {
    // The trigger only opens the dialog; it never calls the backend itself.
    const triggerToDialog = pendingBlock.slice(
      pendingBlock.indexOf("setCancelOpen(true)"),
      pendingBlock.indexOf("ConfirmationDialog"),
    );
    expect(triggerToDialog).not.toContain("backend.cancel");
    expect(pendingBlock).toContain("onConfirm={() => void onCancelPayment()}");
  });

  it("cancels through the server, never by writing the ledger locally", () => {
    expect(code).toContain("backend.cancel(paymentId)");
    // No direct table mutation anywhere in the flow.
    expect(code).not.toContain('.from("subscription_payments")');
    expect(code).not.toContain(".update(");
    expect(code).not.toContain(".delete(");
  });

  it("a refusal is reported as a failure and never as a cancellation", () => {
    expect(code).toContain('dispatch({ type: "CANCEL_FAILED", errorKey: "checkoutCancelFailed" })');
    // The error surfaces on the pending screen, so the payer sees it without leaving.
    expect(pendingBlock).toContain("state.cancelErrorKey");
    // The success branch returns early; everything AFTER that return is the
    // failure path, and it must not close the checkout — otherwise a refusal
    // would look identical to "we left because it worked".
    expect(cancelHandler).not.toBe("");
    const successStart = cancelHandler.indexOf("result.ok === true");
    const successReturn = cancelHandler.indexOf("return;", successStart);
    expect(successReturn).toBeGreaterThan(successStart);
    expect(cancelHandler.slice(successStart, successReturn)).toContain("closeFlow()");

    const failureBranch = cancelHandler.slice(
      successReturn,
      cancelHandler.indexOf("} finally {", successReturn),
    );
    expect(failureBranch).toContain("CANCEL_FAILED");
    expect(failureBranch).not.toContain("closeFlow");
  });

  it("successful cancellation returns the payer to plans", () => {
    const successBranch = cancelHandler.slice(
      cancelHandler.indexOf("result.ok === true"),
      cancelHandler.indexOf("CANCEL_FAILED"),
    );
    expect(successBranch).toContain("closeFlow()");
    // closeFlow resets local state and unmounts the flow, which stops the poller.
    expect(code).toContain("dispatch({ type: \"RESET\" });");
  });

  it("'Back to plans' is always available — it is never disabled or phase-gated", () => {
    // It lives in the panel header, rendered once for every phase.
    const headerStart = code.indexOf("items-start justify-between");
    const header = code.slice(headerStart, code.indexOf("</div>", headerStart));
    expect(headerStart).toBeGreaterThan(-1);
    expect(header).toContain("onClick={closeFlow}");
    expect(header).toContain("checkoutClose");
    expect(header).not.toContain("disabled");

    // …and it is NOT re-rendered inside the pending branch, so no phase can
    // hide it or swap it for a dead control.
    expect(pendingBlock).not.toContain("closeFlow");
  });

  it("the exit uses the design system, not bespoke styling", () => {
    // Design-system button + tokens: dark mode and typography come for free.
    expect(pendingBlock).toContain("<WakaButton");
    expect(pendingBlock).toContain('variant="secondary"');
    expect(pendingBlock).toContain("border-border");
    expect(pendingBlock).toContain("text-destructive");
    // Full-width so it stays usable at mobile widths.
    expect(pendingBlock).toContain("w-full");
  });

  it("the confirmation reuses the shared accessible dialog", () => {
    expect(code).toContain('from "../layout/ConfirmationDialog"');
    // Reused, not reimplemented: no local dialog markup in the flow.
    expect(code).not.toContain('role="dialog"');
    expect(code).not.toContain("aria-modal");
  });
});
