# LOOP Pro billing setup

## Billing model

- Card checkout creates a recurring Stripe subscription: monthly plans renew monthly and annual plans renew yearly.
- Users can cancel or update a card subscription in the Stripe Billing Portal, opened through the authenticated /api/premium/portal route.
- Loop Coin access remains a separate prepaid pass; it does not auto-renew.
- Premium status is derived from active or trialing Stripe subscriptions, or a separately active prepaid/admin grant. Cancelling a Stripe subscription does not erase a separate active grant.

## Supabase migration

Run scripts/premium-subscriptions-migration.sql against the Supabase project before enabling recurring checkout. It creates or extends the subscription ledger and adds Premium grant-source fields to profiles.

## Stripe configuration

Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET in the server environment. Enable the Stripe Billing Portal in the Stripe dashboard. Configure the webhook endpoint as /api/payments/webhook and subscribe to:

- checkout.session.completed
- customer.subscription.created
- customer.subscription.updated
- customer.subscription.deleted
- payment_intent.payment_failed

The subscription metadata contains the LOOP profile ID and plan ID. The webhook verifies Stripe's signature before syncing it. The receipt endpoint independently checks that the Checkout Session belongs to the signed-in user before showing its receipt.

## Checkout confirmation

The success redirect carries the Stripe Checkout Session ID to /premium. LOOP retrieves that session server-side, checks its owner and subscription state, synchronises the subscription ledger, then displays the receipt. A client-side success URL alone never grants Premium.


## Fresh-schema compatibility

The Premium billing migration also creates `profiles.premium_expires_at` when the base profile schema did not include it, and explicitly revokes direct browser access to the subscription ledger. Authenticated billing status/receipt APIs read the ledger through the server service role. The setup runner treats the subscription migration as strict.


## Feature availability

The Premium comparison labels any feature without a live server-side entitlement check as “In development · Not available yet”; these are not included in current Pro benefits. A paid algorithmic reach boost is not part of LOOP's product direction because public discovery should remain relevance-based and transparent.

Custom Profile CSS is a Pro feature. The profile editor and update API both check the active subscription (including its expiry), and the public profile API only returns a validated, profile-scoped stylesheet while the profile owner has an active Pro entitlement. The database column is added by `scripts/profile-custom-css-schema.sql`, which is included in the pending-schema runner.
