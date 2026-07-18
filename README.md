# 🔁 Billoop — recurring billing on your own Stripe, owned forever

## Demo



https://github.com/user-attachments/assets/b4034133-8d67-4f9d-b2a4-b5ec8fe97330



[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

**Pay once. Own it forever. No subscription (to manage your subscriptions).**

Billoop is a self-hosted subscription-management layer for your own Stripe account: plans and coupons, customer subscriptions with real proration, a 3-step dunning email sequence with auto-cancel, renewal sweeps, and an MRR/churn dashboard. Chargebee charges you again — on top of Stripe's fees — to manage the subscriptions Stripe already tracks. Billoop is $49, once.

![Billoop screenshot](docs/screenshot.png)

## Features

- **BYO Stripe (optional)** — drop in your own API key: plans become Stripe products/prices, customers sync, the customer portal wraps Stripe's own billing portal, and webhooks (`/api/webhooks/stripe`) keep invoices in sync. Billoop never touches funds. Without a key it runs the full engine in local mode.
- **Plans, trials, coupons** — monthly/yearly plans, trial periods, percent/amount coupons (`once` or `forever`), all amounts integer cents — never floats.
- **Real proration** — mid-cycle plan changes credit the unused fraction of the old plan and charge the same fraction of the new one, as explicit invoice line items. Covered by exact-figure tests (50% through the period → exactly half).
- **Dunning that actually finishes** — failed payment → templated email sequence at +0/+3/+7 days (editable, `{{name}} {{amount}} {{plan}} {{portal_url}}` placeholders), then auto-cancel or auto-pause after N attempts. Every send is logged.
- **Renewal sweep** — hourly (or on demand): trial conversions, renewals with correct coupon semantics, cancel-at-period-end honored.
- **Dashboard** — MRR (trials excluded, yearly normalized /12), active/trialing/past-due counts, new & canceled this month, churn %, cohort retention table.
- **Customer portal** — Stripe's hosted portal when connected, or a clean local read-only portal per customer via unguessable link.

## Quick start

```bash
npm i
npm run build   # build the React frontend
npm start       # → http://localhost:5358  (password: admin — change it!)
```

Copy `.env.example` to `.env` to set `PORT`, `ADMIN_PASSWORD`, `DB_PATH`, optional SMTP + Stripe key.

**Run it as a desktop app, or deploy to a $5 VPS when you need it public.**

```bash
npm run desktop   # Electron window, local data dir, auto-logged-in
```

Docker:

```bash
docker compose up -d
```

## Tech stack

Node 20+ · Express · better-sqlite3 · React (Vite) · Tailwind CSS · Framer Motion · Lucide · Stripe REST API (no SDK dependency)

## Billoop vs Chargebee

| | **Billoop** | Chargebee | Recurly |
|---|---|---|---|
| Price | **$49 once** | $599+/mo past starter caps | $249+/mo |
| Fee on YOUR revenue | ❌ never | 0.75%+ overage | 0.9%+ |
| Plans / trials / coupons | ✅ | ✅ | ✅ |
| Proration on plan change | ✅ | ✅ | ✅ |
| Dunning emails + auto-cancel | ✅ | ✅ | ✅ |
| MRR / churn / cohorts | ✅ | ✅ | ✅ |
| Self-hosted, data stays yours | ✅ | ❌ | ❌ |
| Works without a processor (local mode) | ✅ | ❌ | ❌ |

## ☕ Skip the setup — get the 1-click installer

Want the packaged Windows installer + updates without touching a terminal?
**[Get Billoop on Whop → https://whop.com/benjisaiempire/billoop](https://whop.com/benjisaiempire/billoop)**

## License

MIT © 2026 Ben (bensblueprints)

## macOS build

See [MAC-BUILD.md](MAC-BUILD.md). Quickest path: GitHub **Actions** tab -> run the **Mac Build** (`mac-build.yml`) workflow to get a downloadable `.dmg` (unsigned - right-click -> Open on first launch).
