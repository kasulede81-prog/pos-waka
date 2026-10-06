import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { t } from "../i18n";
import { activityRangeBounds } from "./memberDates";
import { MemberDashboardView, type MemberActivityFilters } from "../../pages/member/MemberHomePage";
import type { MemberActivityItem, MemberDashboard, MemberLinkedAccount } from "../memberDashboard";

/**
 * Customer Loyalty Phase C — the Activity Center (audit §9/§23).
 * Source-scan + SSR assertions per this repository's test conventions.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const DEFAULT_FILTERS: MemberActivityFilters = {
  range: "all",
  from: "",
  to: "",
  shopId: "",
  kind: "",
};

function account(over: Partial<MemberLinkedAccount> = {}): MemberLinkedAccount {
  return {
    linkId: "link-1",
    shopId: "shop-1",
    shopName: "Kampala Kiosk",
    shopBusinessType: "kiosk_duka",
    shopDistrict: "Kampala",
    accountStatus: "active",
    balancePoints: 180,
    lifetimeEarnedPoints: 380,
    lifetimeRedeemedPoints: 200,
    membershipExpiresAt: "2026-10-30T00:00:00.000Z",
    enrolledAt: "2026-01-10T00:00:00.000Z",
    hasPublicCard: true,
    memberNumber: "26D4 33F0 2BED 4ABE",
    memberCvc: "251",
    qrToken: "opaque",
    ...over,
  };
}

function dashboard(accounts: MemberLinkedAccount[]): MemberDashboard {
  return {
    member: {
      id: "member-1",
      displayName: "Denis Kasule",
      phoneMasked: "+2567** *** 020",
      email: "denis@example.test",
      status: "active",
      memberSince: "2026-01-10T00:00:00.000Z",
      phoneVerified: true,
    },
    accounts,
    counts: {
      linkedAccounts: accounts.length,
      activeAccounts: accounts.length,
      suspendedAccounts: 0,
    },
  };
}

function item(over: Partial<MemberActivityItem> = {}): MemberActivityItem {
  return {
    id: crypto.randomUUID(),
    kind: "earned",
    cause: "sale",
    points: 90,
    balanceAfter: 180,
    createdAt: new Date().toISOString(),
    shopId: "shop-1",
    shopName: "Kampala Kiosk",
    saleTotalUgx: 10_000,
    rewardName: null,
    rewardPointsRequired: null,
    ...over,
  };
}

function renderView(
  d: MemberDashboard,
  opts: {
    activity?: MemberActivityItem[];
    activityState?: "loading" | "ready" | "error";
    filters?: MemberActivityFilters;
    onChange?: (patch: Partial<MemberActivityFilters>) => void;
  } = {},
): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(MemberDashboardView, {
        dashboard: d,
        lang: "en",
        activity: opts.activity ?? [],
        activityState: opts.activityState ?? "ready",
        activityFilters: opts.filters ?? DEFAULT_FILTERS,
        onActivityFiltersChange: opts.onChange,
      }),
    ),
  );
}

describe("Activity Center filter controls (audit §9/§23)", () => {
  it("renders the segmented date filters with pressed state when a handler is given", () => {
    const html = renderView(dashboard([account()]), {
      onChange: () => undefined,
      filters: { ...DEFAULT_FILTERS, range: "today" },
    });
    expect(html).toContain('data-testid="member-activity-filters"');
    expect(html).toContain("Today");
    expect(html).toContain("This week");
    expect(html).toContain("aria-pressed=\"true\"");
    expect(html).toContain('aria-label="Activity filters"');
  });

  it("hides filter controls when no handler is provided (Phase A render contract)", () => {
    const html = renderView(dashboard([account()]));
    expect(html).not.toContain('data-testid="member-activity-filters"');
  });

  it("shows date inputs only for the custom range", () => {
    const custom = renderView(dashboard([account()]), {
      onChange: () => undefined,
      filters: { ...DEFAULT_FILTERS, range: "custom" },
    });
    expect(custom).toContain('type="date"');

    const month = renderView(dashboard([account()]), {
      onChange: () => undefined,
      filters: { ...DEFAULT_FILTERS, range: "month" },
    });
    expect(month).not.toContain('type="date"');
  });

  it("shows a merchant filter only for multi-merchant members, plus the type filter", () => {
    const single = renderView(dashboard([account()]), { onChange: () => undefined });
    expect(single).not.toContain('data-testid="member-activity-merchant"');
    expect(single).toContain('data-testid="member-activity-kind"');

    const multi = renderView(
      dashboard([account(), account({ linkId: "l2", shopId: "shop-2", shopName: "Shop B" })]),
      { onChange: () => undefined },
    );
    expect(multi).toContain('data-testid="member-activity-merchant"');
    expect(multi).toContain("Shop B");
    expect(multi).toContain("All merchants");
  });
});

describe("activity rows (audit §10/§23)", () => {
  it("shows the resulting balance alongside each movement", () => {
    const html = renderView(dashboard([account()]), {
      activity: [item({ balanceAfter: 1_234 })],
    });
    expect(html).toContain("Points balance: 1,234");
    expect(html).toContain("+90");
  });

  it("groups rows under local day headings (Today / Yesterday / the date)", () => {
    const now = new Date();
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 15, 0, 0);
    const html = renderView(dashboard([account()]), {
      activity: [
        item({ id: "a", createdAt: now.toISOString() }),
        item({ id: "b", createdAt: yesterday.toISOString() }),
      ],
    });
    expect(html).toContain(">Today<");
    expect(html).toContain(">Yesterday<");
    expect(html).toContain('data-testid="member-activity-list"');
    expect(html).toContain('data-testid="member-activity-row"');
  });

  it("uses a distinct empty message when a filter is active", () => {
    const unfiltered = renderView(dashboard([account()]), { activity: [] });
    expect(unfiltered).toContain(t("en", "activityEmpty"));

    const filtered = renderView(dashboard([account()]), {
      activity: [],
      onChange: () => undefined,
      filters: { ...DEFAULT_FILTERS, range: "today" },
    });
    expect(filtered).toContain(t("en", "activityEmptyFiltered"));
    expect(filtered).toContain('data-testid="member-activity-empty"');
  });
});

describe("data layer and page wiring", () => {
  it("fetchMemberActivity passes every filter as its named parameter", () => {
    const data = read("src/lib/memberDashboard.ts");
    for (const param of ["p_from", "p_to", "p_shop_id", "p_kind"]) {
      expect(data, `missing ${param}`).toContain(param);
    }
    expect(data).toContain("export type MemberActivityFilter");
  });

  it("the page derives the server filter, flips to loading in the handler and pages with it", () => {
    const page = read("src/pages/member/MemberHomePage.tsx");
    expect(page).toContain("activityRangeBounds(");
    expect(page).toContain('setActivityState("loading")');
    expect(page).toContain("fetchMemberActivity(undefined, 20, activityFilter)");
    expect(page).toContain("fetchMemberActivity(activityCursor, 20, activityFilter)");
    expect(page).toContain("onActivityFiltersChange={changeActivityFilters}");
  });

  it("the migration supersedes the 3-argument shape and keeps auth.uid scoping", () => {
    const sql = read("supabase/migrations/20261005210000_loyalty_member_activity_filters.sql");
    expect(sql).toContain("drop function if exists public.loyalty_member_activity (integer, timestamptz, uuid)");
    expect(sql).toContain("auth.uid ()");
    expect(sql).toContain("l.status = 'active'");
    expect(sql).toContain("p_shop_id is null or t.shop_id = p_shop_id");
    expect(sql).toContain("'projection_version', 2");
  });
});

describe("activityRangeBounds (Phase C date presets)", () => {
  const iso = (d: Date) => d.toISOString();

  it("all returns no bounds", () => {
    expect(activityRangeBounds("all")).toEqual({});
  });

  it("today is the local day, half-open", () => {
    const b = activityRangeBounds("today");
    const from = new Date(b.from!);
    const to = new Date(b.to!);
    expect(from.getHours()).toBe(0);
    expect(to.getTime() - from.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("week spans seven local days ending tomorrow", () => {
    const b = activityRangeBounds("week");
    const from = new Date(b.from!);
    const to = new Date(b.to!);
    expect(Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000))).toBe(7);
  });

  it("month spans the calendar month", () => {
    const b = activityRangeBounds("month");
    const from = new Date(b.from!);
    const to = new Date(b.to!);
    expect(from.getDate()).toBe(1);
    expect(to.getDate()).toBe(1);
    expect(to.getMonth()).toBe((from.getMonth() + 1) % 12);
  });

  it("custom includes the chosen end day and tolerates reversed input", () => {
    const straight = activityRangeBounds("custom", "2026-10-01", "2026-10-05");
    const reversed = activityRangeBounds("custom", "2026-10-05", "2026-10-01");
    expect(straight.from).toBeDefined();
    expect(straight.to).toBeDefined();
    expect(new Date(straight.to!).getTime() - new Date(straight.from!).getTime()).toBe(
      5 * 24 * 60 * 60 * 1000,
    );
    expect(reversed.from).toBe(straight.from);
    expect(reversed.to).toBe(straight.to);
    expect(activityRangeBounds("custom", "", "").from).toBeUndefined();
    expect(iso(new Date(straight.from!))).toBe(straight.from);
  });

  it("invalid custom dates do not throw", () => {
    expect(() => activityRangeBounds("custom", "not-a-date", "2026-13-99")).not.toThrow();
  });
});

describe("Phase C translations", () => {
  const keys = [
    "activityAll",
    "activityToday",
    "activityYesterday",
    "activityWeek",
    "activityMonth",
    "activityCustom",
    "activityFrom",
    "activityTo",
    "activityFiltersLabel",
    "activityMerchantLabel",
    "activityAllMerchants",
    "activityTypeLabel",
    "activityTypeAll",
    "activityKindEarned",
    "activityKindRedeemed",
    "activityKindReversed",
    "activityKindExpired",
    "activityKindAdjusted",
    "activityKindPromotional",
    "activityEmptyFiltered",
  ];
  it("resolve in en, lg and sw without raw keys", () => {
    for (const key of keys) {
      for (const lang of ["en", "lg", "sw"] as const) {
        const value = t(lang, key);
        expect(value, `${lang}.${key}`).toBeTruthy();
        expect(value, `${lang}.${key}`).not.toBe(key);
      }
    }
  });

  it("are actually translated", () => {
    for (const key of keys) {
      expect(t("lg", key), `lg.${key}`).not.toBe(t("en", key));
      expect(t("sw", key), `sw.${key}`).not.toBe(t("en", key));
    }
  });
});
