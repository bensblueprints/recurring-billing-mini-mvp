# Launch strategy — Billoop

## Target communities

- **r/SaaS** — discussion post: "what does Chargebee actually give you over raw Stripe?" with an honest breakdown; Billoop mentioned as the self-hosted middle path.
- **r/indiehackers + Indie Hackers forum** — the exact audience: Stripe users pre-Chargebee scale. Build-in-public post on the dunning engine and the deterministic-clock test suite.
- **r/selfhosted** — "self-hosted subscription management on your own Stripe (MIT)"; emphasize local mode working with no processor at all.
- **r/stripe** — answer recurring "how do I do dunning/proration" questions genuinely; tool mention only when directly relevant (subreddit is strict).
- **Hacker News** — Show HN below; billing-math posts historically do well when the math is shown.

## Show HN draft

**Title:** Show HN: Billoop – self-hosted subscription management on your own Stripe (pay once)

**Body:** Chargebee/Recurly charge a monthly fee plus a percentage of revenue to manage subscriptions Stripe already tracks. Billoop is that layer self-hosted: plans/trials/coupons, mid-cycle plan changes with real proration (credit unused fraction, charge new fraction, explicit line items), a 3-step dunning email sequence (+0/+3/+7 days, editable templates) with auto-cancel/pause after N attempts, hourly renewal sweeps, and an MRR/churn/cohort dashboard. All money is integer cents; the smoke suite drives the whole engine with an injected clock and asserts exact figures (a plan change at exactly 50% of the period produces exactly a 1500¢ credit and 3000¢ charge). BYO Stripe key for real payments — or run the full engine in local mode with no processor. Node + Express + SQLite + React, MIT. Interested in what proration policies people actually want (credit-forward vs invoice-now).

## SEO keywords (10)

1. chargebee alternative
2. recurring billing dashboard stripe
3. subscription management tool self hosted
4. mrr dashboard stripe
5. dunning emails stripe
6. stripe proration tool
7. recurly alternative self hosted
8. failed payment recovery saas
9. subscription billing software one time purchase
10. open source subscription management

## AppSumo / PitchGround pitch

Billoop is a lifetime-license subscription-management layer that sits on the buyer's own Stripe account — so they keep 100% of their revenue instead of paying Chargebee a monthly platform fee plus overage percentages. Buyers get plan/trial/coupon management, genuinely correct proration on plan changes, an automated 3-step dunning sequence with auto-cancel, renewal sweeps, MRR/churn/cohort analytics, and a customer portal — self-hosted via Docker or desktop app, MIT-licensed, one SQLite file. It's the perfect LTD: your buyers are indie SaaS founders who viscerally hate revenue-share pricing. Exclusive: packaged installer + priority support.

## Pricing math

**$49 one-time.** Chargebee Performance = $599/mo → **pays for itself in 3 days.** Even against Chargebee's free-tier overage (0.75% of billing over $250k lifetime), a $10k-MRR business pays ~$75/mo — Billoop pays for itself in under 3 weeks and saves ~$900/yr, forever.
