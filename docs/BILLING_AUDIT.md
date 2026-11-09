# Billing implementation audit

Source audit before the first implementation slice. This repository uses TypeScript, Express, PostgreSQL and React. The pasted Python examples describe the intended model and are not the runtime for this project. Preserve existing Starter/Pro and Cashfree subscriptions while extending billing.

| # | Status | Existing evidence and gap |
| --- | --- | --- |
| 1 | ❌ | `shared/payment-pricing.mjs:3` defines two monthly INR prices in minor units. There is no versioned database catalog or seed for the proposed products. |
| 2 | ⚠️ | `services/auth/src/billing.ts:92`, `:253`, `:265` load and validate configured provider plan IDs. Checkout stores the ID on the subscription. There is no plan sync command or live provider inventory check. |
| 3 | ⚠️ | `db/migrations/020_payment_subscriptions.sql:4` defines tenant-scoped subscriptions, status constraints and one open subscription per user. Status transitions are spread across checkout, cancellation and webhooks. There is no per-charge ledger in the baseline. |
| 4 | ✅ | `services/auth/src/index.ts:102` captures raw bytes. `services/auth/src/billing.ts:340`, `:346`, `:362` verify Razorpay and Cashfree HMACs and send the event parsed from raw bytes with transmission headers to PayPal's verification endpoint. |
| 5 | ⚠️ | `db/migrations/020_payment_subscriptions.sql:39` keys events by provider and event ID. `services/auth/src/billing.ts:389` inserts the event inside the write transaction. Separate event IDs can still represent the same charge in the baseline. |
| 6 | ✅ | `services/auth/src/billing.ts:497` grants paid access after provider verification. The legacy Razorpay order confirmation at `:832` checks a server-bound signature and captured payment with Razorpay. Browser returns only lead to status checks. |
| 7 | ✅ | `shared/entitlements.cjs:25`, `:36`, `:69` centralize feature eligibility and expiry. Auth, meeting and signaling use the shared entitlement contract. |
| 8 | ⚠️ | `services/auth/src/billing.ts:965` requests cycle-end cancellation from Razorpay. PayPal and Cashfree stop future billing immediately and QS-VC preserves the paid-through date. Cancellation scheduling is not separately modeled. |
| 9 | ⚠️ | `services/auth/src/billing.ts:522` maps several failures into `past_due`, including halted and suspended. The shared entitlement check expires at the paid-through date. No grace window or distinct terminal retry state exists. |
| 10 | ⚠️ | `services/auth/src/billing.ts:580` and `:657` expire rows lazily on status/checkout, and `shared/entitlements.cjs:36` checks expiry on access. There is no scheduled sweep. |
| 11 | ❌ | Webhook handlers fetch provider state per event in `services/auth/src/billing.ts:1006`, `:1071`, `:1154`. There is no scheduled reconciliation of missed events or drift. |
| 12 | ❌ | `services/auth/src/billing.ts:782` enables provider email notifications for Cashfree. There is no app-owned billing email pipeline for receipts, reminders, failures, cancellation or expiry. |
| 13 | ⚠️ | `services/auth/src/billing.ts:53`, `:192`, `:204`, `:234`, `:340` read server environment credentials. Provider mode settings exist. Separation of credentials and webhook secrets across deployed environments needs operational verification. |
| 14 | ⚠️ | `services/auth/src/billing.test.ts:109`, `:167`, `:208`, `:316`, `:385` cover mocked checkout, stale PayPal approval, signature rejection, trial confirmation and event replay. Renewal, refund, grace and out-of-order lifecycle coverage is incomplete. |

The first slice adds an append-only ledger for verified charges that activate or extend access. It uses integer minor units and a provider/payment key within the existing transaction. Historical charges and unmatched provider events need reconciliation before this ledger can be used as a complete revenue report. New lifetime, 30-day and annual offers need approved prices and terms before checkout exposes them.

## Provider assumptions to verify before adding offers

- Indian PayPal merchant accounts accept international payments. A USD amount alone does not establish that the buyer is international. Confirm the merchant account and buyer eligibility before exposing the USD offers. [PayPal India](https://www.paypal.com/in/cshelp/article/can-i-use-paypal-to-receive-payments-from-indian-customers-help1049)
- RBI's ₹15,000 threshold concerns subsequent recurring debits without additional authentication. The pasted prepaid annual offer is a product rule for amounts above that threshold. [RBI e-mandate circular](https://www.rbi.org.in/scripts/FS_Notification.aspx?Id=12570&Mode=0&fn=9)
- Cashfree can emit a subscription payment-success notification for a mandate authorization. The capture path excludes these authorization events. [Cashfree subscription events](https://www.cashfree.com/docs/payments/subscription/webhooks)
