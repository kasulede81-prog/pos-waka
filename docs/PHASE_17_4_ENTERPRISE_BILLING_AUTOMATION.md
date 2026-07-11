# Phase 17.4 — Enterprise Billing & Subscription Automation

**Status:** Complete (architecture only — no payment provider integration)  
**Engine version:** `17.4`  
**Date:** July 2026

## Objective

Complete Waka POS’s provider-independent billing platform so future payment integrations (Flutterwave, Stripe, MTN MoMo, Airtel Money) only need to call `subscriptionEngine.onPaymentSuccess(...)` after verification.

## Architecture

```
Platform Settings (subscription_settings)
        │
        ▼
subscriptionEngine (canonical mutations + automation)
        │
        ├── resolveEffectiveSubscription (reads)
        ├── internal_ops_admin_audit (subscriptionAudit payload)
        ├── subscriptionAutomation (expiry / grace / reminders)
        ├── subscriptionNotifications (in-app toasts)
        └── paymentProviders/* (stubs only)
```

### Core modules

| Module | Role |
|--------|------|
| `src/lib/platformSubscriptionSettings.ts` | Trial/duration/grace/reminder configuration |
| `src/lib/subscriptionEngine.ts` | All subscription mutations + automation entry points |
| `src/lib/subscriptionAutomation.ts` | Pure evaluation for expiry, grace, reminders |
| `src/lib/subscriptionHistory.ts` | Parse audit → history rows + timeline events |
| `src/lib/subscriptionNotifications.ts` | In-app notification events (no SMS/email/push) |
| `src/lib/paymentProviders/index.ts` | Stub provider adapters + documented interface |

## Platform subscription settings

**Route:** `/internal/waka/subscription-settings` (super admin / operations admin)

Stored in `platform_settings` key `subscription_settings` (migration `135_platform_subscription_settings.sql`):

- Automatic trial ON/OFF
- Default trial plan & duration
- Monthly / yearly duration
- Grace period (default **0** — no behavior change until configured)
- Allow promotional grants / multiple trials
- Require verified email before trial
- Subscription reminder days (default `[7, 3, 1]`)

Local fallback when RPC is unavailable (same defaults as today: 14-day trial, 30-day monthly).

## Subscription lifecycle automation

Callable engine methods (no cron scheduling in this phase):

| Method | Behavior |
|--------|----------|
| `processExpiry()` | Finds expired trials/periods → `subscription.expire` via RPC |
| `processGracePeriod()` | Marks `past_due` when grace window active (only if `gracePeriodDays > 0`) |
| `processRenewalReminder()` | Emits in-app reminders on configured days-before-expiry |

## Account subscription center

**Route:** `/office/account`

`AccountSubscriptionCenter` displays:

- Current plan, subscription type, billing status
- Trial/subscription end, renewal date, days remaining
- Device limits, promotional overlay
- Billing timeline + history table (from audit only)

No payment buttons or checkout.

## Internal admin subscription center

**Route:** Shop Console → Subscriptions tab

`EnterpriseSubscriptionCard` replaces fragmented plan controls with:

- Overview (plan, effective plan, type, status, cycle, limits)
- Actions via `subscriptionEngine` only: grant trial/monthly/yearly, extend, renew, pause, resume, cancel, reset to free, promotional access
- Unified billing timeline + history

## Billing history & timeline

- **History:** `SubscriptionHistoryPanel` — before → action → after → reason → source → operator → timestamp
- **Timeline:** `BillingTimeline` — human-readable lifecycle events from the same audit payload
- Source: `internal_ops_admin_audit.metadata.subscriptionAudit` only (no duplicate history store)

## Payment provider abstraction (stubs)

Interface: `PaymentProvider` with `initPayment`, `verifyPayment`, `refund`.

Stub implementations:

- `FlutterwaveProvider`
- `StripeProvider`
- `MtnMoMoProvider`
- `AirtelMoneyProvider`

All return “not implemented” — no SDKs, API calls, or secrets.

## Webhook extension points

| Method | Status |
|--------|--------|
| `subscriptionEngine.onPaymentSuccess()` | Stub — returns `{ ok: false }` |
| `subscriptionEngine.onPaymentFailure()` | Stub |
| `subscriptionEngine.onRefund()` | Stub |

Future Payment Integration Phase implements provider verification, then calls these methods.

## Notification lifecycle

In-app only via `waka:subscription-notification` → `ToastProvider`:

- Trial ending
- Subscription expired
- Grace period
- Renewal reminder
- Subscription activated / cancelled / plan changed

## Explicitly out of scope

- Flutterwave, Stripe, MTN MoMo, Airtel Money live integration
- Checkout pages, payment SDKs, merchant onboarding
- Payment webhooks, live verification, production secrets
- Scheduled cron jobs

## Verification results

| Check | Result |
|-------|--------|
| `tsc -b` | Pass |
| `npm run build` | Pass (internal-admin excluded from SW precache — online-only bundle) |
| `npm test` | **1545 passed**, 4 skipped |

## Billing readiness audit

- Platform settings replace scattered duration defaults for admin grants (defaults unchanged: 14d trial, 30d monthly, 365d yearly, 0d grace)
- Unified Enterprise Subscription card in shop console
- Account page subscription center production-ready
- All admin actions route through `subscriptionEngine`
- No payment-provider-specific live code
- Payment stubs and webhook extension points documented

## Next phase (Payment Integration)

1. Implement `PaymentProvider` adapters with real SDK/API
2. Wire webhooks → `onPaymentSuccess` / `onPaymentFailure` / `onRefund`
3. Add cron/edge scheduler calling `processExpiry`, `processGracePeriod`, `processRenewalReminder`
