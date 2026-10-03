import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  acceptInvite,
  createInviteGoogleHarness,
  invitationState,
  membershipOf,
  phase5MigrationSql,
  seedInviteFixture,
  staffUserId,
  type InviteFixture,
  type SqlExec,
} from "../test/sqlIntegration/staffInviteGooglePgHarness";

/**
 * Phase 5 — Google-first staff invitation acceptance.
 *
 * The first block runs against the PRE-Phase-5 function and shows the gap: an
 * account with no Google identity at all could accept an invitation.
 *
 * The authoritative checks live in shop_accept_staff_invite(). Nothing here
 * tests the React page — the page cannot grant access, so its tests would prove
 * nothing about the security property.
 */

const T = 120_000;

describe("Phase 5 — pre-migration (the gap is real)", () => {
  let exec: SqlExec;
  let f: InviteFixture;

  beforeAll(async () => {
    exec = await createInviteGoogleHarness({ applyPhase5: false });
    // Alice has a password-only account: no Google identity anywhere.
    f = await seedInviteFixture(exec, { alice: "password" });
  }, T);

  afterAll(async () => {
    await exec?.close();
  });

  it("an account with no Google identity could accept the invitation", async () => {
    const res = await acceptInvite(exec, f.alice, f.token);
    expect(res.ok).toBe(true);
    expect(await membershipOf(exec, f.shopId, f.alice.userId)).toBe("waiter");
  }, T);
});

describe("Phase 5 — after the Google-first migration", () => {
  const fresh = async (
    providers: Parameters<typeof seedInviteFixture>[1],
  ): Promise<{ exec: SqlExec; f: InviteFixture }> => {
    const exec = await createInviteGoogleHarness({ applyPhase5: true });
    const f = await seedInviteFixture(exec, providers);
    return { exec, f };
  };

  // ---------- Google identity ----------
  it("5/6. only case is normalised — no alias rewriting, no other coercion", async () => {
    const { exec, f } = await fresh({ alice: "google" });
    try {
      // shop_invite_staff lowercases on insert, so a stored invitation is always
      // lowercase and the accept path's lowercasing of the auth email lines up.
      // Storing a mixed-case address proves nothing beyond case is normalised:
      // the comparison does not fold it, and it must not.
      await exec.query(`UPDATE public.shop_staff_invitations SET email = $1 WHERE id = $2`, [
        "Staff.Name@Gmail.com",
        f.invitationId,
      ]);
      const res = await acceptInvite(exec, { ...f.alice, email: "staff.name@gmail.com" }, f.token);
      expect(res.ok).toBe(false);
      expect(res.error).toBe("email_mismatch");
      expect(await membershipOf(exec, f.shopId, f.alice.userId)).toBeNull();
    } finally {
      await exec.close();
    }
  }, T);

  it("6b. a Gmail plus-alias is NOT silently treated as the invited address", async () => {
    const { exec, f } = await fresh({ alice: "google" });
    try {
      // alice@example.com is invited; alice+other@example.com signs in.
      const res = await acceptInvite(exec, { ...f.alice, email: "alice+other@example.com" }, f.token);
      expect(res.ok).toBe(false);
      expect(res.error).toBe("email_mismatch");
      expect(await staffUserId(exec, f.staffId)).toBeNull();
    } finally {
      await exec.close();
    }
  }, T);

  it("1b. a matching Google identity accepts successfully", async () => {
    const { exec, f } = await fresh({ alice: "google" });
    try {
      const res = await acceptInvite(exec, f.alice, f.token);
      expect(res.ok).toBe(true);
      expect(res.membership_role).toBe("waiter");
      expect(res.pos_role).toBe("waiter");
      expect(await membershipOf(exec, f.shopId, f.alice.userId)).toBe("waiter");
      expect(await staffUserId(exec, f.staffId)).toBe(f.alice.userId);
    } finally {
      await exec.close();
    }
  }, T);

  it("2. a different Google account cannot accept someone else's invitation", async () => {
    const { exec, f } = await fresh({ alice: "google", bob: "google" });
    try {
      const before = await invitationState(exec, f.invitationId);
      const res = await acceptInvite(exec, f.bob, f.token);

      expect(res.ok).toBe(false);
      expect(res.error).toBe("email_mismatch");
      // No membership, no staff link, invitation untouched.
      expect(await membershipOf(exec, f.shopId, f.bob.userId)).toBeNull();
      expect(await staffUserId(exec, f.staffId)).toBeNull();
      expect(await invitationState(exec, f.invitationId)).toEqual(before);
    } finally {
      await exec.close();
    }
  }, T);

  it("3. an unverified Google identity is refused", async () => {
    const { exec, f } = await fresh({ alice: "unverified" });
    try {
      const res = await acceptInvite(exec, f.alice, f.token);
      expect(res.ok).toBe(false);
      expect(res.error).toBe("google_identity_required");
      expect(await membershipOf(exec, f.shopId, f.alice.userId)).toBeNull();
    } finally {
      await exec.close();
    }
  }, T);

  it("4. a non-Google authenticated identity is refused where Google is required", async () => {
    const { exec, f } = await fresh({ alice: "password" });
    try {
      const res = await acceptInvite(exec, f.alice, f.token);
      expect(res.ok).toBe(false);
      expect(res.error).toBe("google_identity_required");
      expect(await staffUserId(exec, f.staffId)).toBeNull();
    } finally {
      await exec.close();
    }
  }, T);

  it("6. a Google identity pointing at a different email is refused", async () => {
    const { exec, f } = await fresh({ alice: "google-wrong" });
    try {
      const res = await acceptInvite(exec, f.alice, f.token);
      expect(res.ok).toBe(false);
      expect(res.error).toBe("email_mismatch");
      expect(await membershipOf(exec, f.shopId, f.alice.userId)).toBeNull();
    } finally {
      await exec.close();
    }
  }, T);

  // ---------- invitation lifecycle ----------
  it("8/9/10. expired, revoked and already-accepted invitations are refused", async () => {
    const cases: [string, string][] = [
      [`UPDATE public.shop_staff_invitations SET expires_at = now() - interval '1 day' WHERE id = $1`, "expired"],
      [`UPDATE public.shop_staff_invitations SET revoked_at = now() WHERE id = $1`, "revoked"],
      [`UPDATE public.shop_staff_invitations SET accepted_at = now() WHERE id = $1`, "already_accepted"],
    ];
    for (const [sql, expected] of cases) {
      const { exec, f } = await fresh({ alice: "google" });
      try {
        await exec.query(sql, [f.invitationId]);
        const res = await acceptInvite(exec, f.alice, f.token);
        expect(res.ok, `${expected} was accepted`).toBe(false);
        expect(res.error).toBe(expected);
        expect(await membershipOf(exec, f.shopId, f.alice.userId)).toBeNull();
        expect(await staffUserId(exec, f.staffId)).toBeNull();
      } finally {
        await exec.close();
      }
    }
  }, T);

  it("11/12. a bad token fails and leaves both invitation and staff untouched", async () => {
    const { exec, f } = await fresh({ alice: "google" });
    try {
      const before = await invitationState(exec, f.invitationId);
      const res = await acceptInvite(exec, f.alice, "not-a-real-token");
      expect(res.ok).toBe(false);
      expect(res.error).toBe("invalid_token");
      expect(await invitationState(exec, f.invitationId)).toEqual(before);
      expect(await staffUserId(exec, f.staffId)).toBeNull();
    } finally {
      await exec.close();
    }
  }, T);

  // ---------- linking ----------
  it("13/14. an unlinked staff record is linked, and re-acceptance is not silently repeated", async () => {
    const { exec, f } = await fresh({ alice: "google" });
    try {
      const first = await acceptInvite(exec, f.alice, f.token);
      expect(first.ok).toBe(true);
      expect(first.linked_existing).toBe(true);
      expect(await staffUserId(exec, f.staffId)).toBe(f.alice.userId);

      const second = await acceptInvite(exec, f.alice, f.token);
      expect(second.ok).toBe(false);
      expect(second.error).toBe("already_accepted");
    } finally {
      await exec.close();
    }
  }, T);

  it("15. a staff record already linked to a DIFFERENT user is refused, atomically", async () => {
    const { exec, f } = await fresh({ alice: "google", bob: "google" });
    try {
      await exec.query(`UPDATE public.shop_pos_staff SET user_id = $1 WHERE id = $2`, [
        f.bob.userId,
        f.staffId,
      ]);
      // The link guard rejects, which raises and rolls the whole acceptance back.
      await expect(acceptInvite(exec, f.alice, f.token)).rejects.toThrow(/staff_link_failed/);

      expect(await staffUserId(exec, f.staffId)).toBe(f.bob.userId);
      expect(await membershipOf(exec, f.shopId, f.alice.userId)).toBeNull();
      const state = await invitationState(exec, f.invitationId);
      expect(state?.accepted_at).toBeNull();
    } finally {
      await exec.close();
    }
  }, T);

  it("16. a staff record belonging to another shop is refused, atomically", async () => {
    const { exec, f } = await fresh({ alice: "google" });
    try {
      await exec.query(`UPDATE public.shop_pos_staff SET shop_id = $1 WHERE id = $2`, [
        f.otherShopId,
        f.staffId,
      ]);
      await expect(acceptInvite(exec, f.alice, f.token)).rejects.toThrow(/staff_link_failed/);

      expect(await membershipOf(exec, f.shopId, f.alice.userId)).toBeNull();
      expect(await staffUserId(exec, f.staffId)).toBeNull();
      const state = await invitationState(exec, f.invitationId);
      expect(state?.accepted_at).toBeNull();
    } finally {
      await exec.close();
    }
  }, T);

  it("17. a user from another shop cannot hijack the invitation", async () => {
    const { exec, f } = await fresh({ alice: "google", bob: "google" });
    try {
      // Bob is already a member of a different shop, with a matching Google account.
      await exec.query(`INSERT INTO public.shop_members (shop_id, user_id, role) VALUES ($1,$2,'manager')`, [
        f.otherShopId,
        f.bob.userId,
      ]);
      const res = await acceptInvite(exec, f.bob, f.token);
      expect(res.ok).toBe(false);
      expect(res.error).toBe("email_mismatch");
      expect(await membershipOf(exec, f.shopId, f.bob.userId)).toBeNull();
      expect(await staffUserId(exec, f.staffId)).toBeNull();
    } finally {
      await exec.close();
    }
  }, T);

  // ---------- authority comes from the invitation ----------
  it("18/19/20/21/22. the invitation is authoritative for shop, staff and roles", async () => {
    const { exec, f } = await fresh({ alice: "google" });
    try {
      await exec.query(
        `UPDATE public.shop_staff_invitations SET membership_role = 'stock_keeper', pos_role = 'stock_keeper'
          WHERE id = $1`,
        [f.invitationId],
      );
      const res = await acceptInvite(exec, f.alice, f.token);
      expect(res.ok).toBe(true);
      expect(res.shop_id).toBe(f.shopId);
      expect(res.staff_id).toBe(f.staffId);
      expect(res.membership_role).toBe("stock_keeper");
      expect(res.pos_role).toBe("stock_keeper");
      expect(await membershipOf(exec, f.shopId, f.alice.userId)).toBe("stock_keeper");

      // The RPC accepts exactly one argument. There is no parameter through which
      // a caller could supply a shop, staff id, role or email, so none of those
      // can be overridden — the signature is the proof.
      const { rows: args } = await exec.query<{ a: string }>(
        `SELECT pg_get_function_arguments('public.shop_accept_staff_invite(text)'::regprocedure) AS a`,
      );
      expect(args[0]?.a).toBe("p_token text");
    } finally {
      await exec.close();
    }
  }, T);

  // ---------- atomicity / single use ----------
  it("23/24/25. acceptance is single-use and fully atomic", async () => {
    const { exec, f } = await fresh({ alice: "google" });
    try {
      const results = await Promise.all([
        acceptInvite(exec, f.alice, f.token),
        acceptInvite(exec, f.alice, f.token),
      ]);
      const okCount = results.filter((r) => r.ok === true).length;
      // PGlite is a single connection, so the true race cannot be executed; what
      // is asserted is that a second attempt never succeeds and never duplicates.
      expect(okCount).toBe(1);

      const { rows: members } = await exec.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM public.shop_members WHERE shop_id = $1 AND user_id = $2`,
        [f.shopId, f.alice.userId],
      );
      expect(members[0]?.n).toBe("1");

      const { rows: invites } = await exec.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM public.shop_staff_invitations WHERE id = $1 AND accepted_at IS NOT NULL`,
        [f.invitationId],
      );
      expect(invites[0]?.n).toBe("1");
    } finally {
      await exec.close();
    }
  }, T);

  it("19b. an accepted invitation is audited without recording the token", async () => {
    const { exec, f } = await fresh({ alice: "google" });
    try {
      await acceptInvite(exec, f.alice, f.token);
      const { rows } = await exec.query<{ action: string; payload: Record<string, unknown> }>(
        `SELECT action, payload FROM public.audit_logs WHERE shop_id = $1 AND action = 'staff_invite_accepted'`,
        [f.shopId],
      );
      expect(rows.length).toBe(1);
      const payload = JSON.stringify(rows[0]?.payload ?? {});
      expect(payload).toContain(f.invitationId);
      expect(payload).toContain(f.staffId);
      // Never the token, in any form.
      expect(payload).not.toContain(f.token);
      expect(payload.toLowerCase()).not.toContain("token");
    } finally {
      await exec.close();
    }
  }, T);

  it("the migration is safe to re-apply", async () => {
    const { exec, f } = await fresh({ alice: "password" });
    try {
      await exec.exec(phase5MigrationSql());
      const res = await acceptInvite(exec, f.alice, f.token);
      expect(res.ok).toBe(false);
      expect(res.error).toBe("google_identity_required");
    } finally {
      await exec.close();
    }
  }, T);
});
