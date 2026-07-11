# Product Hunt launch — Billoop

**Name:** Billoop

**Tagline (60 chars):** Subscription management for your Stripe — pay once, not 0.75%

**Description (260 chars):**
Billoop is a self-hosted billing layer on your own Stripe: plans, coupons, real proration, 3-step dunning emails with auto-cancel, renewal sweeps, MRR/churn/cohorts. $49 once — instead of Chargebee taking a monthly fee AND a cut of your revenue. MIT source.

**Full description:**
You already pay Stripe 2.9% + 30¢. Chargebee then charges you again — hundreds per month plus overage percentages — to manage the subscriptions Stripe already tracks.

Billoop is that management layer, self-hosted and yours:

- BYO Stripe key (optional): plans → Stripe products/prices, webhook sync, Stripe-hosted customer portal. Billoop never touches funds. No key? Full engine runs in local mode.
- Plans, trials, coupons (once/forever) — every amount is integer cents
- Real proration on mid-cycle plan changes: credit unused time, charge the remaining fraction, explicit line items. The test suite asserts exact figures (50% through a period → exactly half)
- Dunning: templated emails at +0/+3/+7 days after a failed payment, then auto-cancel/pause after N attempts, every send logged
- Renewal sweep hourly or on demand: trial conversions, renewals, cancel-at-period-end
- Dashboard: MRR (yearly normalized, trials excluded), churn %, cohort retention

$49 once. MIT source on GitHub — the paid product is the 1-click installer.

**Maker first comment:**
Hi PH 👋 Billing tools have the strangest pricing in SaaS: they charge you a percentage of your revenue to run cron jobs and send three emails. I built Billoop after doing exactly that by hand for my own products. The parts I'm proudest of: the proration math is pure integer-cent functions with exact-value tests, and the dunning sweep is fully deterministic (the test suite drives it with an injected clock through fail → +3d → +7d → auto-cancel). Ask me anything about the engine.

**Gallery shots (5):**
1. Dashboard: MRR, churn, past-due counts, cohort retention table.
2. Customer card with a subscription mid plan-change showing the proration invoice lines (-credit / +charge).
3. Dunning sequence editor with the three templates and placeholder chips.
4. Invoice table with paid/failed/void states and line items.
5. Comparison card: "$49 once vs $599/mo + 0.75% of YOUR revenue".
