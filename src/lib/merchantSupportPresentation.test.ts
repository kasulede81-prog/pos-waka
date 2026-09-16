import { describe, expect, it } from "vitest";
import {
  financialCorrectionStatusLabel,
  financialCorrectionSummaryLine,
  formatTicketReference,
  isTicketReplyable,
  mapFinancialCorrectionStatus,
  merchantTicketStatusLabel,
  notificationActionLabel,
  notificationDeepLink,
  supportCategoryLabel,
  toFinancialIssueCard,
} from "./merchantSupportPresentation";
import type { MerchantFinancialCorrectionSummary } from "./merchantSupportApi";

describe("merchantSupportPresentation", () => {
  describe("formatTicketReference", () => {
    it("formats human-friendly WAKA references, never UUIDs", () => {
      expect(formatTicketReference(1048)).toBe("WAKA-1048");
      expect(formatTicketReference(7)).toBe("WAKA-0007");
      expect(formatTicketReference(123456)).toBe("WAKA-123456");
    });
  });

  describe("merchantTicketStatusLabel", () => {
    it("maps every merchant-facing status to a friendly label", () => {
      expect(merchantTicketStatusLabel("open")).toBe("Open");
      expect(merchantTicketStatusLabel("under_review")).toBe("Under Review");
      expect(merchantTicketStatusLabel("waiting_for_merchant")).toBe("Waiting for You");
      expect(merchantTicketStatusLabel("resolved")).toBe("Resolved");
      expect(merchantTicketStatusLabel("closed")).toBe("Closed");
    });
  });

  describe("isTicketReplyable", () => {
    it("is replyable only in open states", () => {
      expect(isTicketReplyable("open")).toBe(true);
      expect(isTicketReplyable("under_review")).toBe(true);
      expect(isTicketReplyable("waiting_for_merchant")).toBe(true);
      expect(isTicketReplyable("resolved")).toBe(false);
      expect(isTicketReplyable("closed")).toBe(false);
    });
  });

  describe("mapFinancialCorrectionStatus (presentation-only relabeling)", () => {
    it("maps internal financial statuses to merchant vocabulary without changing them", () => {
      expect(mapFinancialCorrectionStatus("submitted")).toBe("open");
      expect(mapFinancialCorrectionStatus("under_review")).toBe("under_review");
      expect(mapFinancialCorrectionStatus("approved")).toBe("under_review");
      expect(mapFinancialCorrectionStatus("requires_manual_review")).toBe("under_review");
      expect(mapFinancialCorrectionStatus("correction_applied")).toBe("resolved");
      expect(mapFinancialCorrectionStatus("rejected")).toBe("closed");
    });

    it("labels mapped statuses for display", () => {
      expect(financialCorrectionStatusLabel("submitted")).toBe("Open");
      expect(financialCorrectionStatusLabel("under_review")).toBe("Under Review");
      expect(financialCorrectionStatusLabel("correction_applied")).toBe("Resolved");
      expect(financialCorrectionStatusLabel("rejected")).toBe("Closed");
    });
  });

  describe("financialCorrectionSummaryLine", () => {
    const base = { saleRef: "#4684-002" };

    it("describes each merchant-visible phase", () => {
      expect(financialCorrectionSummaryLine({ ...base, status: "submitted" })).toContain("received your report");
      expect(financialCorrectionSummaryLine({ ...base, status: "under_review" })).toContain("reviewing the financial information");
      expect(financialCorrectionSummaryLine({ ...base, status: "correction_applied" })).toContain("reviewed and resolved");
      expect(financialCorrectionSummaryLine({ ...base, status: "rejected" })).toContain("records show the sale information is correct");
      expect(financialCorrectionSummaryLine({ ...base, status: "under_review" })).toContain("#4684-002");
    });
  });

  describe("notificationDeepLink", () => {
    it("deep-links to the related ticket first", () => {
      expect(
        notificationDeepLink({
          type: "support_resolved",
          relatedTicketId: "t-1",
          relatedRequestId: null,
        }),
      ).toBe("/support-center/tickets/t-1");
    });

    it("deep-links financial notifications to the Financial issues tab", () => {
      expect(
        notificationDeepLink({
          type: "financial_issue_resolved",
          relatedTicketId: null,
          relatedRequestId: "r-1",
        }),
      ).toBe("/support-center/tickets?tab=financial");
    });

    it("falls back to the Support Center home", () => {
      expect(
        notificationDeepLink({ type: "system_announcement", relatedTicketId: null, relatedRequestId: null }),
      ).toBe("/support-center");
    });
  });

  describe("notificationActionLabel", () => {
    it("chooses the right action per relation", () => {
      expect(
        notificationActionLabel({ type: "support_waiting_for_you", relatedTicketId: "t", relatedRequestId: null }),
      ).toBe("View support request");
      expect(
        notificationActionLabel({ type: "financial_issue_resolved", relatedTicketId: null, relatedRequestId: "r" }),
      ).toBe("View financial issue");
      expect(
        notificationActionLabel({ type: "support_resolved", relatedTicketId: null, relatedRequestId: null }),
      ).toBe("Open Support");
      expect(
        notificationActionLabel({ type: "account_security", relatedTicketId: null, relatedRequestId: null }),
      ).toBeNull();
    });
  });

  describe("toFinancialIssueCard", () => {
    const correction: MerchantFinancialCorrectionSummary = {
      id: "req-1",
      status: "under_review",
      saleRef: "#4684-002",
      productName: "Sugar 1kg",
      quantity: 2,
      reason: "cost looks wrong",
      createdAt: "2026-09-15T10:00:00Z",
      updatedAt: "2026-09-16T08:00:00Z",
    };

    it("projects a friendly merchant card", () => {
      const card = toFinancialIssueCard(correction);
      expect(card.headline).toBe("Financial issue");
      expect(card.statusLabel).toBe("Under Review");
      expect(card.relatedLabel).toBe("Sale #4684-002");
      expect(card.message).toContain("reviewing the financial information");
      expect(card).not.toHaveProperty("adminNotes");
    });

    it("says 'Financial issue resolved' once correction was applied", () => {
      const card = toFinancialIssueCard({ ...correction, status: "correction_applied" });
      expect(card.headline).toBe("Financial issue resolved");
      expect(card.statusLabel).toBe("Resolved");
    });
  });

  describe("supportCategoryLabel", () => {
    it("supports all listed categories in English and Luganda", () => {
      expect(supportCategoryLabel("en", "sync_offline")).toBe("Sync / Offline");
      expect(supportCategoryLabel("en", "technical")).toBe("Technical Issue");
      expect(supportCategoryLabel("lg", "payments")).toBe("Okusasula");
      expect(supportCategoryLabel("sw", "account")).toBe("Account");
    });
  });
});
