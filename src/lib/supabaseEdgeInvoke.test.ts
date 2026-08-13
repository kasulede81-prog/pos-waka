import { describe, expect, it } from "vitest";
import { classifyInvokeMessage } from "./ai/aiErrors";
import { isApplicationNotFoundError, isGatewayFunctionMissing, isNetworkTransportFailure } from "./supabaseEdgeInvoke";
import {
  classifyOwnerDeletionFailure,
  looksLikeInternalDeletionLeak,
  ownerFacingDeletionMessage,
  sanitizeOwnerDeletionMessage,
} from "./ownerDeletionErrors";

describe("edge invoke function-missing classifier (Phase 39.3)", () => {
  it("does not treat shop_not_found as a missing Edge Function", () => {
    expect(isApplicationNotFoundError({ error: "shop_not_found" })).toBe(true);
    expect(isGatewayFunctionMissing({ error: "shop_not_found", message: "shop_not_found" }, "404")).toBe(false);
    expect(classifyInvokeMessage("shop_not_found")).not.toBe("function_not_deployed");
  });

  it("does not treat Failed to send as function_not_deployed", () => {
    expect(isNetworkTransportFailure("Failed to send a request to the Edge Function")).toBe(true);
    expect(
      isGatewayFunctionMissing({}, "Failed to send a request to the Edge Function"),
    ).toBe(false);
    expect(classifyInvokeMessage("Failed to send a request to the Edge Function")).not.toBe(
      "function_not_deployed",
    );
  });

  it("does not treat application 404 bodies as a missing function", () => {
    expect(
      isGatewayFunctionMissing({ error: "shop_not_found", message: "Not Found" }, "Edge Function returned a non-2xx status code"),
    ).toBe(false);
  });

  it("classifies a genuine unavailable function", () => {
    expect(
      isGatewayFunctionMissing({ message: "Requested function was not found" }, null),
    ).toBe(true);
    expect(classifyInvokeMessage("Requested function was not found")).toBe("function_not_deployed");
  });
});

describe("owner deletion error sanitization", () => {
  it("never returns the deploy command to owners", () => {
    const leaked =
      'Deploy Supabase edge function "owner-permanently-delete-account" (run: npm run supabase:deploy:admin), then retry.';
    expect(looksLikeInternalDeletionLeak(leaked)).toBe(true);
    expect(sanitizeOwnerDeletionMessage(leaked, "FUNCTION_UNAVAILABLE")).not.toContain("npm run");
    expect(sanitizeOwnerDeletionMessage(leaked, "FUNCTION_UNAVAILABLE")).toContain("has not been deleted");
  });

  it("maps shop_not_found to delete failed, not function unavailable", () => {
    expect(
      classifyOwnerDeletionFailure({ error: "shop_not_found", message: "shop_not_found" }),
    ).toBe("DELETE_FAILED");
    expect(ownerFacingDeletionMessage("DELETE_FAILED")).toContain("has not been deleted");
  });

  it("maps network transport to a safe unavailable message", () => {
    expect(
      classifyOwnerDeletionFailure({
        message: "Failed to send a request to the Edge Function",
        transportCode: "network",
      }),
    ).toBe("NETWORK_ERROR");
  });
});
