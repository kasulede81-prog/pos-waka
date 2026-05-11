import type { User } from "@supabase/supabase-js";
import type { BusinessType } from "../types";
import { reportAuthIssue } from "./monitoring";
import { supabase } from "./supabase";

type BootstrapArgs = {
  businessName: string;
  businessType: BusinessType;
  fullName?: string;
};

/**
 * Idempotent owner-workspace bootstrap.
 * Safe to call multiple times on the same user/session.
 */
export async function bootstrapOwnerWorkspace(user: User, args: BootstrapArgs): Promise<void> {
  if (!supabase) return;
  const businessName = args.businessName.trim();
  if (!businessName) {
    throw new Error("Could not finish creating your shop. Please try again.");
  }

  const fullName = (args.fullName ?? "").trim() || null;
  const email = user.email?.trim().toLowerCase() ?? null;

  if (import.meta.env.DEV) {
    console.info("[waka-auth] bootstrap_owner_workspace:start", {
      userId: user.id,
      businessType: args.businessType,
      hasEmail: Boolean(email),
    });
  }

  const { error } = await supabase.rpc("bootstrap_owner_workspace", {
    p_org_name: businessName,
    p_business_type: args.businessType,
    p_full_name: fullName,
    p_email: email,
  });

  if (error) {
    reportAuthIssue("workspace_bootstrap_failed", {
      status: error.code ?? "unknown",
    });
    if (import.meta.env.DEV) {
      console.error("[waka-auth] bootstrap_owner_workspace:error", {
        userId: user.id,
        code: error.code,
        message: error.message,
      });
    }
    throw new Error("Could not finish creating your shop. Please try again.");
  }

  if (import.meta.env.DEV) {
    console.info("[waka-auth] bootstrap_owner_workspace:ok", { userId: user.id });
  }
}

