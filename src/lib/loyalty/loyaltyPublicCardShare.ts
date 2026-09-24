/**
 * Merchant helpers for sharing the customer loyalty *page* link (Phase 3).
 *
 * This is NOT the Google Wallet Save URL.
 * URL shape: https://loyalty.waka.ug/c/<public_card_token>
 */

import { buildCustomerLoyaltyCardUrl } from "./loyaltyPublicCard";
import {
  copyWalletLink,
  isWebShareAvailable,
  shareWalletLinkViaWebShare,
  type CopyLinkResult,
  type WebShareResult,
} from "./loyaltyWalletShare";

export const CUSTOMER_PAGE_SHARE_INTRO =
  "Here is your WAKA loyalty card. Open this link to see your points and QR.";

export function buildCustomerPageShareText(pageUrl: string): string {
  return `${CUSTOMER_PAGE_SHARE_INTRO}\n\n${pageUrl.trim()}`;
}

export function buildCustomerPageWhatsAppHref(pageUrl: string): string {
  return `https://wa.me/?text=${encodeURIComponent(buildCustomerPageShareText(pageUrl))}`;
}

export function copyCustomerPageLink(pageUrl: string): Promise<CopyLinkResult> {
  return copyWalletLink(pageUrl);
}

export function shareCustomerPageViaWebShare(pageUrl: string): Promise<WebShareResult> {
  return shareWalletLinkViaWebShare(pageUrl);
}

export { isWebShareAvailable, buildCustomerLoyaltyCardUrl };
