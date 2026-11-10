# Payment subscriptions

Basic, Starter, Pro and Business support recurring online checkout. Free opens the meeting app and Enterprise goes to sales. Each eligible account can start one 14-day trial after provider-confirmed mandate authorization. Existing trials keep their stored duration.

Monthly plans bill each month. Annual rates bill monthly for up to 12 payments, then end. Customers can cancel future renewals from checkout. Razorpay and Cashfree monthly mandates have up to 100 charges and PayPal monthly mandates continue until cancelled. The introductory Basic and Pro discounts in the pricing brief require a separate provider-backed promotion setup.

Provider credentials stay on the auth service. The client receives only the public Razorpay key, Cashfree subscription session ID, or a validated PayPal approval URL. The backend stores the customer email from the signed-in profile and calculates the amount server-side. A changed quote requires the customer to reconfirm.

## Price and tax

These are the regular INR rates per user and per month:

| Plan | Monthly base | Monthly with GST | Annual base | Annual with GST |
| --- | ---: | ---: | ---: | ---: |
| Basic | ₹114.00 | ₹134.52 | ₹95.00 | ₹112.10 |
| Starter | ₹309.00 | ₹364.62 | ₹257.00 | ₹303.26 |
| Pro | ₹1,199.00 | ₹1,414.82 | ₹999.00 | ₹1,178.82 |
| Business | ₹1,938.00 | ₹2,286.84 | ₹1,615.00 | ₹1,905.70 |

GST is displayed in checkout. Razorpay and Cashfree recurring amounts are set to the GST-inclusive total; PayPal plans use the configured base amount and add 18% tax (`inclusive: false`). Payment amounts always come from the shared server-side price configuration.

## Provider setup

Apply pending migrations through `029_public_paid_plans.sql` with the migration role before deploying this auth-service build. It adds the new tiers and stores billing period and trial duration per subscription.

```sh
npm run db:migrate
```

Set `PAYMENTS_ENABLED=true` and `PAYMENT_TERMS_CONFIRMED=true` in the auth-service environment after confirming the displayed price, GST, trial, renewal, cancellation and refund terms. Production must use HTTPS callback URLs. Keep all secret keys out of source files and `VITE_` variables.

Providers can use different modes: for example, Cashfree production for live BHIM/UPI AutoPay, Razorpay test credentials, and PayPal unavailable while unconfigured. `/billing/options` reports each provider's `mode` (`live`, `test`, or `unknown`) separately from its checkout readiness, without returning credentials. Razorpay mode comes only from the `rzp_live_` or `rzp_test_` key prefix; other keys are `unknown`. Cashfree reports `live` only for `CASHFREE_ENVIRONMENT=production`, and PayPal only for `PAYPAL_ENVIRONMENT=live`; other values use their sandbox APIs and report `test`. Both global flags and each provider's required configuration must still pass before checkout, including the plan for the selected billing period.

For the Cloudflare-gateway deployment, set `AUTH_PUBLIC_URL=https://qsvcmeet.com` and use that public origin for payment return and webhook URLs. The protected `backend.qsvcmeet.com` origin requires the Worker-only origin header; provider callbacks and customer redirects must pass through the public Worker.

### Cashfree Subscriptions (UPI AutoPay, BHIM and cards)

Cashfree provides the recurring gateway. BHIM is selected by the customer as a UPI app inside Cashfree's UPI AutoPay authorization flow; BHIM does not provide a separate merchant API key for this integration.

Set these variables on the auth service:

- `CASHFREE_ENVIRONMENT=production` (or `sandbox` during sandbox validation)
- `CASHFREE_CLIENT_ID`
- `CASHFREE_CLIENT_SECRET`
- `CASHFREE_API_VERSION=2026-01-01`
- `CASHFREE_WEBHOOK_SECRET` only if Cashfree gives you a webhook signing secret distinct from the client secret
- `AUTH_PUBLIC_URL` to the public HTTPS auth-service origin
- `PAYMENT_RETURN_URL` to the public HTTPS web-app origin

The integration creates a monthly periodic subscription with UPI and card authorization methods. An eligible trial sets the first charge time to fourteen days after the checkout authorization window closes; the signed webhook confirms mandate authorization before the account receives trial access. The payment callback is only a navigation signal. Register `https://<auth-host>/api/auth/billing/webhooks/cashfree` for subscription authorization, payment-success, payment-failure and status-change events. Cashfree webhook signatures are checked against the original request body and timestamp; exact event retries are deduplicated so a delayed provider retry can still be processed safely.

The provided merchant account must have Cashfree Subscriptions and the required payment methods enabled. The implementation does not create or simulate a payment during deployment.

### Razorpay Subscriptions

Set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET`. Create a monthly-frequency plan at each GST-inclusive INR rate above. Set `RAZORPAY_PLAN_<TIER>` for monthly pricing and `RAZORPAY_PLAN_<TIER>_ANNUAL` for annual pricing, where `<TIER>` is `BASIC`, `STARTER`, `PRO` or `BUSINESS`. The app sets the total count to 12 for annual pricing. Configure the webhook at `https://<auth-host>/api/auth/billing/webhooks/razorpay` for subscription authorization, charge, cancellation, expiry and failure events. The server verifies the checkout signature and confirms each renewal from Razorpay before applying access.

An eligible trial creates the subscription with its first billing date fourteen days after the 30-minute authorization window closes. The authorization link expires when that window closes. Monthly subscriptions allow up to 100 cycles. Cancellation stops future cycles; access remains through the stored current period end.

### PayPal Subscriptions

Set `PAYPAL_ENVIRONMENT`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID` and `PAYPAL_CURRENCY`. For each tier set `PAYPAL_PLAN_<TIER>` and `PAYPAL_<TIER>_BASE_AMOUNT`, with an `_ANNUAL` suffix on the tier for annual rates. For trials use `PAYPAL_PLAN_<TIER>_TRIAL_14` or `PAYPAL_PLAN_<TIER>_ANNUAL_TRIAL_14`.

Create a monthly regular cycle with 18% non-inclusive tax and no setup fee. Use 0 regular cycles for monthly pricing (indefinite) or 12 for annual pricing. A trial plan adds a single 14-day, zero-value cycle before the regular cycle. Set the base amount in the merchant currency and confirm that currency in checkout. INR plans must match the INR catalog. Configure PayPal's verified webhook endpoint at `https://<auth-host>/api/auth/billing/webhooks/paypal`. A browser redirect does not grant access; the server waits for a verified activation or completed sale webhook. Pending PayPal approvals retain their checkout slot until completion or successful provider cancellation; local timeout does not permit a second subscription while the old approval link remains usable.

## One-trial rule and cancellation

Migration `025` records verified charges used to activate or extend access in `payment_captures`. Amounts are stored as integer minor units, keyed by provider and payment ID. The capture, webhook result and access update commit together. Mandate authorizations and trials do not create capture records. A late verified charge preserves a cancelled subscription's renewal status. The ledger starts with this release and does not backfill historical payments.

The database records a single trial start per account. Choosing any paid tier consumes that same trial only after provider authorization succeeds. A retry, second browser tab, or later sign-in cannot start another trial. If authorization fails, the account remains eligible to try again. On trial expiration, access depends on a verified paid renewal. Cancellation removes future renewals while preserving access through the paid period or active trial end.

## Changing tiers

To switch tiers, cancel the current renewal and wait for the existing access period to end. Checkout blocks overlapping subscriptions.

The development fake clock affects entitlement previews only. Hosted payment schedules always use real UTC time; do not use date simulation as evidence of provider billing behavior.

## Deployment note

Internet and intranet editions share the same auth-service billing code. A private intranet installation needs outbound access to the selected provider and an HTTPS webhook endpoint reachable from that provider. A fully offline installation cannot process hosted payment mandates.
