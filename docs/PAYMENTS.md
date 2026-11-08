# Payment subscriptions

The payment screen starts a monthly recurring Starter or Pro subscription. A signed-in, eligible account may choose its one seven-day trial. The trial begins only after the payment provider confirms mandate authorization; the first recurring charge follows the trial. Razorpay and Cashfree reserve the 30-minute authorization window before their seven-day trial schedule, so approving near the end of checkout never shortens the free access period. Users who already used their trial can subscribe immediately. Customers can cancel future renewals at any time from checkout. Razorpay and Cashfree mandates have a maximum of 100 monthly charges; PayPal plans have an indefinite regular cycle.

Provider credentials stay on the auth service. The client receives only the public Razorpay key, Cashfree subscription session ID, or a validated PayPal approval URL. The backend stores the customer email from the signed-in profile and ignores any client-supplied amount, currency, or email.

## Price and tax

The current INR prices are ₹499 for Starter and ₹999 for Pro before 18% GST:

| Plan | Base | GST | Monthly total |
| --- | ---: | ---: | ---: |
| Starter | ₹499.00 | ₹89.82 | ₹588.82 |
| Pro | ₹999.00 | ₹179.82 | ₹1,178.82 |

GST is displayed in checkout. Razorpay and Cashfree recurring amounts are set to the GST-inclusive total; PayPal plans use the configured base amount and add 18% tax (`inclusive: false`). Payment amounts always come from the shared server-side price configuration.

## Provider setup

Apply database migrations `020` through `024` in order before deploying this auth-service build:

```sh
npm run db:migrate
```

Set `PAYMENTS_ENABLED=true` and `PAYMENT_TERMS_CONFIRMED=true` in the auth-service environment after confirming the displayed price, GST, trial, renewal, cancellation and refund terms. Production must use HTTPS callback URLs. Keep all secret keys out of source files and `VITE_` variables.

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

The integration creates a monthly periodic subscription with UPI and card authorization methods. An eligible trial sets the first charge time to seven days after the checkout authorization window closes; the signed webhook confirms mandate authorization before the account receives trial access. The payment callback is only a navigation signal. Register `https://<auth-host>/api/auth/billing/webhooks/cashfree` for subscription authorization, payment-success, payment-failure and status-change events. Cashfree webhook signatures are checked against the original request body and timestamp; exact event retries are deduplicated so a delayed provider retry can still be processed safely.

The provided merchant account must have Cashfree Subscriptions and the required payment methods enabled. The implementation does not create or simulate a payment during deployment.

### Razorpay Subscriptions

Set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `RAZORPAY_PLAN_STARTER` and `RAZORPAY_PLAN_PRO`. The active monthly plans must match the GST-inclusive shared INR totals. Configure the webhook at `https://<auth-host>/api/auth/billing/webhooks/razorpay` for subscription authorization, charge, cancellation, expiry and failure events. The server verifies the checkout signature and confirms each renewal from Razorpay before applying access.

An eligible trial creates the subscription with its first billing date seven days after the 30-minute authorization window closes. The authorization link expires when that window closes. Razorpay recurring subscriptions allow up to 100 cycles in this implementation. Cancellation stops future cycles; access remains through the stored current period end.

### PayPal Subscriptions

Set `PAYPAL_ENVIRONMENT`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_PLAN_STARTER`, `PAYPAL_PLAN_PRO`, `PAYPAL_PLAN_STARTER_TRIAL`, `PAYPAL_PLAN_PRO_TRIAL`, `PAYPAL_CURRENCY`, `PAYPAL_STARTER_BASE_AMOUNT` and `PAYPAL_PRO_BASE_AMOUNT`.

Each standard plan must have one monthly regular cycle, 18% non-inclusive tax, and no setup fee. Each `*_TRIAL` plan must have one seven-day, zero-value trial cycle followed by the same monthly regular cycle. Configure PayPal's verified webhook endpoint at `https://<auth-host>/api/auth/billing/webhooks/paypal`. A browser redirect does not grant access; the server waits for a verified activation or completed sale webhook. Pending PayPal approvals retain their checkout slot until completion or successful provider cancellation; local timeout does not permit a second subscription while the old approval link remains usable.

## One-trial rule and cancellation

The database records a single trial start per account. Choosing Starter or Pro consumes that same trial only after provider authorization succeeds. A retry, second browser tab, or later sign-in cannot start another trial. If authorization fails, the account remains eligible to try again. On trial expiration, access depends on a verified paid renewal. Cancellation removes future renewals while preserving access through the paid period or active trial end.

## Changing tiers

Direct mid-cycle Starter-to-Pro switching is not implemented. Checkout explains that the current renewal must be cancelled and the remaining Starter period must end before a new Pro subscription can begin, avoiding overlapping charges.

The development fake clock affects entitlement previews only. Hosted payment schedules always use real UTC time; do not use date simulation as evidence of provider billing behavior.

## Deployment note

Internet and intranet editions share the same auth-service billing code. A private intranet installation needs outbound access to the selected provider and an HTTPS webhook endpoint reachable from that provider. A fully offline installation cannot process hosted payment mandates.
