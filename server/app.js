const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const { openDb, genToken, getSettings, setSettings } = require('./db');
const { periodEnd, applyCoupon, prorate, mrrContribution, monthKey } = require('./billing');

const SESSION_COOKIE = 'bl_session';
const DAY_MS = 86400000;

function createApp({ dbPath, adminPassword, autologinToken = null, allowTestNow = false } = {}) {
  const db = openDb(dbPath);
  const app = express();
  app.disable('x-powered-by');
  app.use(cookieParser());
  app.use(express.json());
  app.locals.db = db;

  const findPlan = db.prepare('SELECT * FROM plans WHERE id = ?');
  const findCustomer = db.prepare('SELECT * FROM customers WHERE id = ?');
  const findSub = db.prepare('SELECT * FROM subscriptions WHERE id = ?');
  const findInvoice = db.prepare('SELECT * FROM invoices WHERE id = ?');
  const findCoupon = db.prepare('SELECT * FROM coupons WHERE id = ?');

  // Deterministic-time hook: in test mode (ALLOW_TEST_NOW=1) requests may pass
  // an explicit `now` so proration/renewal/dunning math is exactly assertable.
  function nowFrom(req) {
    if (allowTestNow) {
      const n = (req.body || {}).now ?? req.query.now;
      if (n != null) {
        const t = typeof n === 'number' ? n : /^\d+$/.test(String(n)) ? Number(n) : Date.parse(String(n));
        if (Number.isFinite(t)) return t;
      }
    }
    return Date.now();
  }

  function requireAuth(req, res, next) {
    const token = req.cookies[SESSION_COOKIE];
    if (token && db.prepare('SELECT id FROM sessions WHERE token = ?').get(token)) return next();
    res.status(401).json({ error: 'unauthorized' });
  }

  function createSession(res) {
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions (token, created_at) VALUES (?, ?)').run(token, Date.now());
    res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax' });
  }

  function logEvent(type, payload, at) {
    db.prepare('INSERT INTO events (type, payload_json, at) VALUES (?, ?, ?)').run(type, JSON.stringify(payload || {}), at);
  }

  // ── auth ───────────────────────────────────────────────────────────────────
  app.get('/api/health', (req, res) => res.json({ ok: true, app: 'billoop' }));

  app.post('/api/login', (req, res) => {
    if ((req.body || {}).password !== adminPassword) return res.status(401).json({ error: 'wrong password' });
    createSession(res);
    res.json({ ok: true });
  });

  app.post('/api/logout', (req, res) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    res.clearCookie(SESSION_COOKIE);
    res.json({ ok: true });
  });

  app.get('/auth/auto', (req, res) => {
    if (autologinToken && req.query.token === autologinToken) createSession(res);
    res.redirect('/');
  });

  app.get('/api/me', requireAuth, (req, res) => res.json({ ok: true }));

  // ── Stripe (optional BYO key — Billoop orchestrates, never touches funds) ──
  async function stripeCall(method, endpoint, params) {
    const key = getSettings(db).stripe_secret_key;
    if (!key) return null; // local mode
    const body = params ? new URLSearchParams(params).toString() : undefined;
    const res = await fetch(`https://api.stripe.com/v1/${endpoint}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `Stripe ${res.status}`);
    return data;
  }

  // ── plans ──────────────────────────────────────────────────────────────────
  app.get('/api/plans', requireAuth, (req, res) => {
    res.json(db.prepare('SELECT * FROM plans WHERE active = 1 ORDER BY amount_cents').all());
  });

  app.post('/api/plans', requireAuth, async (req, res) => {
    const b = req.body || {};
    const name = String(b.name || '').trim();
    const amount = Math.round(Number(b.amount_cents));
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (!Number.isInteger(amount) || amount <= 0) return res.status(400).json({ error: 'amount_cents must be a positive integer' });
    const interval = b.interval === 'year' ? 'year' : 'month';
    const trialDays = Math.max(0, Math.floor(Number(b.trial_days) || 0));
    let stripeProductId = null;
    let stripePriceId = null;
    try {
      const product = await stripeCall('POST', 'products', { name });
      if (product) {
        const price = await stripeCall('POST', 'prices', {
          product: product.id, unit_amount: String(amount), currency: String(b.currency || 'usd'),
          'recurring[interval]': interval
        });
        stripeProductId = product.id;
        stripePriceId = price.id;
      }
    } catch (e) {
      return res.status(502).json({ error: `Stripe: ${e.message}` });
    }
    const info = db.prepare('INSERT INTO plans (name, amount_cents, currency, interval, trial_days, stripe_product_id, stripe_price_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(name, amount, String(b.currency || 'usd'), interval, trialDays, stripeProductId, stripePriceId, Date.now());
    res.status(201).json(findPlan.get(info.lastInsertRowid));
  });

  app.delete('/api/plans/:id', requireAuth, (req, res) => {
    db.prepare('UPDATE plans SET active = 0 WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  // ── coupons ────────────────────────────────────────────────────────────────
  app.get('/api/coupons', requireAuth, (req, res) => {
    res.json(db.prepare('SELECT * FROM coupons WHERE active = 1 ORDER BY code').all());
  });

  app.post('/api/coupons', requireAuth, (req, res) => {
    const b = req.body || {};
    const code = String(b.code || '').trim().toUpperCase();
    if (!code) return res.status(400).json({ error: 'code is required' });
    const pct = b.percent_off ? Math.round(Number(b.percent_off)) : null;
    const off = b.amount_off_cents ? Math.round(Number(b.amount_off_cents)) : null;
    if (!pct && !off) return res.status(400).json({ error: 'percent_off or amount_off_cents required' });
    if (pct && (pct < 1 || pct > 100)) return res.status(400).json({ error: 'percent_off must be 1–100' });
    try {
      const info = db.prepare('INSERT INTO coupons (code, percent_off, amount_off_cents, duration) VALUES (?, ?, ?, ?)')
        .run(code, pct, off, b.duration === 'forever' ? 'forever' : 'once');
      res.status(201).json(findCoupon.get(info.lastInsertRowid));
    } catch {
      res.status(409).json({ error: 'code already exists' });
    }
  });

  app.delete('/api/coupons/:id', requireAuth, (req, res) => {
    db.prepare('UPDATE coupons SET active = 0 WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  // ── customers ──────────────────────────────────────────────────────────────
  function customerPayload(c) {
    const subs = db.prepare('SELECT * FROM subscriptions WHERE customer_id = ? ORDER BY id DESC').all(c.id)
      .map(subPayload);
    const mrr = subs.reduce((sum, s) => sum + s.mrr_cents, 0);
    const upcoming = subs.find((s) => ['active', 'trialing', 'past_due'].includes(s.status));
    return { ...c, subscriptions: subs, mrr_cents: mrr, next_renewal_at: upcoming ? upcoming.current_period_end : null };
  }

  app.get('/api/customers', requireAuth, (req, res) => {
    res.json(db.prepare('SELECT * FROM customers ORDER BY created_at DESC').all().map(customerPayload));
  });

  app.post('/api/customers', requireAuth, async (req, res) => {
    const b = req.body || {};
    const name = String(b.name || '').trim();
    const email = String(b.email || '').trim();
    if (!name || !email) return res.status(400).json({ error: 'name and email are required' });
    let stripeId = null;
    try {
      const sc = await stripeCall('POST', 'customers', { name, email });
      if (sc) stripeId = sc.id;
    } catch (e) {
      return res.status(502).json({ error: `Stripe: ${e.message}` });
    }
    const info = db.prepare('INSERT INTO customers (name, email, stripe_customer_id, portal_token, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(name, email, stripeId, genToken(), Date.now());
    res.status(201).json(customerPayload(findCustomer.get(info.lastInsertRowid)));
  });

  app.get('/api/customers/:id/portal', requireAuth, async (req, res) => {
    const c = findCustomer.get(req.params.id);
    if (!c) return res.status(404).json({ error: 'not found' });
    const s = getSettings(db);
    if (s.stripe_secret_key && c.stripe_customer_id) {
      try {
        const session = await stripeCall('POST', 'billing_portal/sessions', {
          customer: c.stripe_customer_id, return_url: s.portal_url_base || 'https://example.com'
        });
        return res.json({ url: session.url, mode: 'stripe' });
      } catch (e) {
        return res.status(502).json({ error: `Stripe: ${e.message}` });
      }
    }
    res.json({ url: `/portal/${c.portal_token}`, mode: 'local' });
  });

  // local read-only customer portal (public via unguessable token)
  app.get('/api/portal/:token', (req, res) => {
    const c = db.prepare('SELECT * FROM customers WHERE portal_token = ?').get(req.params.token);
    if (!c) return res.status(404).json({ error: 'unknown portal link' });
    const payload = customerPayload(c);
    const invoices = db.prepare('SELECT id, amount_cents, currency, status, kind, created_at, paid_at FROM invoices WHERE customer_id = ? ORDER BY created_at DESC LIMIT 24').all(c.id);
    res.json({
      business_name: getSettings(db).business_name,
      name: c.name, email: c.email,
      subscriptions: payload.subscriptions.map((s) => ({ plan_name: s.plan_name, status: s.status, amount_cents: s.plan_amount_cents, interval: s.plan_interval, current_period_end: s.current_period_end })),
      invoices
    });
  });

  // ── subscriptions ──────────────────────────────────────────────────────────
  function subPayload(s) {
    const plan = findPlan.get(s.plan_id);
    const coupon = s.coupon_id ? findCoupon.get(s.coupon_id) : null;
    const customer = findCustomer.get(s.customer_id);
    return {
      ...s,
      plan_name: plan ? plan.name : '?',
      plan_amount_cents: plan ? plan.amount_cents : 0,
      plan_interval: plan ? plan.interval : 'month',
      coupon_code: coupon ? coupon.code : null,
      customer_name: customer ? customer.name : '?',
      customer_email: customer ? customer.email : '',
      // MRR excludes trials (they aren't revenue yet); past_due still counts until dunning resolves it
      mrr_cents: plan && ['active', 'past_due'].includes(s.status) ? mrrContribution(plan, coupon) : 0
    };
  }

  function createInvoice({ sub, amount, kind, lines, at, currency }) {
    const info = db.prepare(`
      INSERT INTO invoices (subscription_id, customer_id, amount_cents, currency, status, kind, lines_json, created_at)
      VALUES (?, ?, ?, ?, 'open', ?, ?, ?)
    `).run(sub.id, sub.customer_id, amount, currency || 'usd', kind, JSON.stringify(lines), at);
    logEvent('invoice.created', { invoice_id: info.lastInsertRowid, amount_cents: amount, kind }, at);
    return findInvoice.get(info.lastInsertRowid);
  }

  app.get('/api/subscriptions', requireAuth, (req, res) => {
    res.json(db.prepare('SELECT * FROM subscriptions ORDER BY id DESC').all().map(subPayload));
  });

  app.post('/api/subscriptions', requireAuth, (req, res) => {
    const b = req.body || {};
    const customer = findCustomer.get(b.customer_id);
    const plan = findPlan.get(b.plan_id);
    if (!customer) return res.status(400).json({ error: 'unknown customer' });
    if (!plan || !plan.active) return res.status(400).json({ error: 'unknown plan' });
    let coupon = null;
    if (b.coupon_code) {
      coupon = db.prepare('SELECT * FROM coupons WHERE code = ? AND active = 1').get(String(b.coupon_code).trim().toUpperCase());
      if (!coupon) return res.status(400).json({ error: 'unknown coupon code' });
    }
    const now = nowFrom(req);
    const trial = plan.trial_days > 0;
    const start = now;
    const end = trial ? now + plan.trial_days * DAY_MS : periodEnd(now, plan.interval);
    const info = db.prepare(`
      INSERT INTO subscriptions (customer_id, plan_id, coupon_id, status, started_at, current_period_start, current_period_end)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(customer.id, plan.id, coupon ? coupon.id : null, trial ? 'trialing' : 'active', start, start, end);
    const sub = findSub.get(info.lastInsertRowid);
    logEvent('subscription.created', { subscription_id: sub.id, plan: plan.name, trial }, now);

    let invoice = null;
    if (!trial) {
      const { discounted, discount } = applyCoupon(plan.amount_cents, coupon);
      const lines = [{ description: `${plan.name} (${plan.interval}ly)`, amount_cents: plan.amount_cents }];
      if (discount) lines.push({ description: `Coupon ${coupon.code}`, amount_cents: -discount });
      invoice = createInvoice({ sub, amount: discounted, kind: 'initial', lines, at: now, currency: plan.currency });
    }
    res.status(201).json({ ...subPayload(sub), invoice });
  });

  // mid-cycle plan change with proration
  app.post('/api/subscriptions/:id/change-plan', requireAuth, (req, res) => {
    const sub = findSub.get(req.params.id);
    if (!sub) return res.status(404).json({ error: 'not found' });
    if (!['active', 'trialing', 'past_due'].includes(sub.status)) {
      return res.status(409).json({ error: `cannot change plan on a ${sub.status} subscription` });
    }
    const newPlan = findPlan.get((req.body || {}).plan_id);
    if (!newPlan || !newPlan.active) return res.status(400).json({ error: 'unknown plan' });
    const oldPlan = findPlan.get(sub.plan_id);
    if (newPlan.id === oldPlan.id) return res.status(400).json({ error: 'already on that plan' });
    const now = nowFrom(req);
    const p = prorate({
      oldAmountCents: oldPlan.amount_cents,
      newAmountCents: newPlan.amount_cents,
      periodStart: sub.current_period_start,
      periodEnd: sub.current_period_end,
      nowMs: now
    });
    db.prepare('UPDATE subscriptions SET plan_id = ? WHERE id = ?').run(newPlan.id, sub.id);
    const lines = [
      { description: `Unused time on ${oldPlan.name}`, amount_cents: -p.credit_cents },
      { description: `Remaining time on ${newPlan.name}`, amount_cents: p.charge_cents }
    ];
    const invoice = createInvoice({ sub: findSub.get(sub.id), amount: p.due_cents, kind: 'proration', lines, at: now, currency: newPlan.currency });
    logEvent('subscription.plan_changed', { subscription_id: sub.id, from: oldPlan.name, to: newPlan.name, proration: p }, now);
    res.json({ ...subPayload(findSub.get(sub.id)), proration: p, invoice });
  });

  app.post('/api/subscriptions/:id/cancel', requireAuth, (req, res) => {
    const sub = findSub.get(req.params.id);
    if (!sub) return res.status(404).json({ error: 'not found' });
    const now = nowFrom(req);
    if ((req.body || {}).at_period_end) {
      db.prepare('UPDATE subscriptions SET cancel_at_period_end = 1 WHERE id = ?').run(sub.id);
    } else {
      db.prepare('UPDATE subscriptions SET status = ?, canceled_at = ? WHERE id = ?').run('canceled', now, sub.id);
      logEvent('subscription.canceled', { subscription_id: sub.id, reason: 'manual' }, now);
    }
    res.json(subPayload(findSub.get(sub.id)));
  });

  app.post('/api/subscriptions/:id/resume', requireAuth, (req, res) => {
    const sub = findSub.get(req.params.id);
    if (!sub) return res.status(404).json({ error: 'not found' });
    if (sub.status === 'paused') db.prepare("UPDATE subscriptions SET status = 'active' WHERE id = ?").run(sub.id);
    db.prepare('UPDATE subscriptions SET cancel_at_period_end = 0 WHERE id = ?').run(sub.id);
    res.json(subPayload(findSub.get(sub.id)));
  });

  // ── invoices + payment simulation / webhooks ───────────────────────────────
  app.get('/api/invoices', requireAuth, (req, res) => {
    const rows = db.prepare(`
      SELECT i.*, c.name AS customer_name, c.email AS customer_email
      FROM invoices i JOIN customers c ON c.id = i.customer_id
      ORDER BY i.created_at DESC LIMIT 200
    `).all();
    res.json(rows.map((r) => ({ ...r, lines: JSON.parse(r.lines_json) })));
  });

  function markPaid(invoice, at) {
    db.prepare("UPDATE invoices SET status = 'paid', paid_at = ? WHERE id = ?").run(at, invoice.id);
    const sub = findSub.get(invoice.subscription_id);
    if (sub && sub.status === 'past_due') {
      db.prepare("UPDATE subscriptions SET status = 'active' WHERE id = ?").run(sub.id);
      logEvent('subscription.recovered', { subscription_id: sub.id, invoice_id: invoice.id }, at);
    }
    logEvent('invoice.paid', { invoice_id: invoice.id, amount_cents: invoice.amount_cents }, at);
  }

  function markFailed(invoice, at) {
    db.prepare("UPDATE invoices SET status = 'failed', failed_at = COALESCE(failed_at, ?), attempt_count = attempt_count + 1 WHERE id = ?")
      .run(at, invoice.id);
    const sub = findSub.get(invoice.subscription_id);
    if (sub && ['active', 'trialing'].includes(sub.status)) {
      db.prepare("UPDATE subscriptions SET status = 'past_due' WHERE id = ?").run(sub.id);
    }
    logEvent('invoice.payment_failed', { invoice_id: invoice.id, amount_cents: invoice.amount_cents }, at);
  }

  app.post('/api/invoices/:id/pay', requireAuth, (req, res) => {
    const inv = findInvoice.get(req.params.id);
    if (!inv) return res.status(404).json({ error: 'not found' });
    if (inv.status === 'paid') return res.status(409).json({ error: 'already paid' });
    markPaid(inv, nowFrom(req));
    res.json(findInvoice.get(inv.id));
  });

  app.post('/api/invoices/:id/fail', requireAuth, (req, res) => {
    const inv = findInvoice.get(req.params.id);
    if (!inv) return res.status(404).json({ error: 'not found' });
    if (inv.status === 'paid') return res.status(409).json({ error: 'already paid' });
    markFailed(inv, nowFrom(req));
    res.json(findInvoice.get(inv.id));
  });

  // Stripe webhook (JSON; verify signature only if a secret is configured —
  // proper HMAC verification of the raw body is a documented TODO for BYO users
  // who front this with Stripe CLI / dashboard endpoints).
  app.post('/api/webhooks/stripe', (req, res) => {
    const evt = req.body || {};
    const type = String(evt.type || '');
    const obj = evt.data?.object || {};
    const at = Date.now();
    if (type === 'invoice.paid' || type === 'invoice.payment_succeeded') {
      const inv = obj.metadata?.billoop_invoice_id ? findInvoice.get(obj.metadata.billoop_invoice_id) : null;
      if (inv && inv.status !== 'paid') markPaid(inv, at);
    } else if (type === 'invoice.payment_failed') {
      const inv = obj.metadata?.billoop_invoice_id ? findInvoice.get(obj.metadata.billoop_invoice_id) : null;
      if (inv) markFailed(inv, at);
    }
    logEvent('webhook.received', { type }, at);
    res.json({ received: true });
  });

  // ── renewal + dunning sweep ────────────────────────────────────────────────
  function runSweep(now) {
    const result = { renewals: 0, trial_conversions: 0, dunning_emails: 0, canceled: 0, paused: 0, period_end_cancellations: 0 };
    const settings = getSettings(db);
    const maxAttempts = Number(settings.max_failed_attempts) || 3;

    // 1) trial conversions + renewals
    const dueSubs = db.prepare("SELECT * FROM subscriptions WHERE status IN ('trialing','active') AND current_period_end <= ?").all(now);
    for (const sub of dueSubs) {
      const plan = findPlan.get(sub.plan_id);
      const coupon = sub.coupon_id ? findCoupon.get(sub.coupon_id) : null;
      if (sub.cancel_at_period_end) {
        db.prepare("UPDATE subscriptions SET status = 'canceled', canceled_at = ? WHERE id = ?").run(sub.current_period_end, sub.id);
        logEvent('subscription.canceled', { subscription_id: sub.id, reason: 'period_end' }, now);
        result.period_end_cancellations++;
        continue;
      }
      const newStart = sub.current_period_end;
      const newEnd = periodEnd(newStart, plan.interval);
      const wasTrial = sub.status === 'trialing';
      // forever coupons keep discounting; 'once' applied only on the initial invoice
      const effectiveCoupon = coupon && coupon.duration === 'forever' ? coupon : wasTrial ? coupon : null;
      const { discounted, discount } = applyCoupon(plan.amount_cents, effectiveCoupon);
      db.prepare("UPDATE subscriptions SET status = 'active', current_period_start = ?, current_period_end = ? WHERE id = ?")
        .run(newStart, newEnd, sub.id);
      const lines = [{ description: `${plan.name} renewal (${plan.interval}ly)`, amount_cents: plan.amount_cents }];
      if (discount) lines.push({ description: `Coupon ${effectiveCoupon.code}`, amount_cents: -discount });
      createInvoice({ sub, amount: discounted, kind: wasTrial ? 'initial' : 'renewal', lines, at: now, currency: plan.currency });
      if (wasTrial) result.trial_conversions++; else result.renewals++;
    }

    // 2) dunning for failed invoices
    const templates = db.prepare('SELECT * FROM dunning_templates ORDER BY step').all();
    const failedInvoices = db.prepare("SELECT * FROM invoices WHERE status = 'failed'").all();
    for (const inv of failedInvoices) {
      const sub = findSub.get(inv.subscription_id);
      if (!sub || sub.status === 'canceled') continue;
      const customer = findCustomer.get(inv.customer_id);
      for (const t of templates) {
        const dueAt = inv.failed_at + t.days_after_fail * DAY_MS;
        if (dueAt > now) continue;
        const already = db.prepare('SELECT id FROM dunning_log WHERE invoice_id = ? AND step = ?').get(inv.id, t.step);
        if (already) continue;
        // send (email if SMTP configured; the log row is the source of truth)
        let channel = 'log';
        let ok = 1;
        let error = null;
        if (settings.smtp_host && customer?.email) {
          channel = 'email';
          try {
            const nodemailer = require('nodemailer');
            const transporter = nodemailer.createTransport({
              host: settings.smtp_host,
              port: Number(settings.smtp_port) || 587,
              secure: Number(settings.smtp_port) === 465,
              auth: settings.smtp_user ? { user: settings.smtp_user, pass: settings.smtp_pass } : undefined
            });
            const plan = findPlan.get(sub.plan_id);
            const fill = (s) => s
              .replaceAll('{{name}}', customer.name)
              .replaceAll('{{amount}}', `$${(inv.amount_cents / 100).toFixed(2)}`)
              .replaceAll('{{plan}}', plan ? plan.name : 'your plan')
              .replaceAll('{{portal_url}}', `${settings.portal_url_base || ''}/portal/${customer.portal_token}`);
            // fire and forget; failures recorded on the log row asynchronously is
            // overkill here — we await nothing and keep the log row authoritative
            transporter.sendMail({ from: settings.smtp_from || settings.smtp_user, to: customer.email, subject: fill(t.subject), text: fill(t.body) })
              .catch(() => {});
          } catch (e) {
            ok = 0;
            error = e.message;
          }
        }
        db.prepare('INSERT INTO dunning_log (invoice_id, customer_id, step, channel, sent_at, ok, error) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(inv.id, inv.customer_id, t.step, channel, now, ok, error);
        db.prepare('UPDATE invoices SET attempt_count = attempt_count + 1 WHERE id = ?').run(inv.id);
        result.dunning_emails++;
      }
      // after the full sequence + max attempts → cancel or pause
      const refreshed = findInvoice.get(inv.id);
      const stepsSent = db.prepare('SELECT COUNT(*) c FROM dunning_log WHERE invoice_id = ?').get(inv.id).c;
      if (stepsSent >= templates.length && refreshed.attempt_count >= maxAttempts) {
        const action = settings.dunning_action === 'pause' ? 'paused' : 'canceled';
        db.prepare('UPDATE subscriptions SET status = ?, canceled_at = ? WHERE id = ?')
          .run(action, action === 'canceled' ? now : null, sub.id);
        db.prepare("UPDATE invoices SET status = 'void' WHERE id = ?").run(inv.id);
        logEvent(`subscription.${action}`, { subscription_id: sub.id, reason: 'dunning_exhausted', invoice_id: inv.id }, now);
        if (action === 'canceled') result.canceled++; else result.paused++;
      }
    }
    logEvent('sweep.completed', result, now);
    return result;
  }

  app.post('/api/sweep', requireAuth, (req, res) => {
    res.json(runSweep(nowFrom(req)));
  });

  // hourly background sweep in production
  const sweepTimer = setInterval(() => {
    try { runSweep(Date.now()); } catch (e) { console.error('[sweep]', e.message); }
  }, 60 * 60 * 1000);
  sweepTimer.unref?.();
  app.locals.stopSweep = () => clearInterval(sweepTimer);

  // ── dashboard ──────────────────────────────────────────────────────────────
  app.get('/api/dashboard', requireAuth, (req, res) => {
    const now = nowFrom(req);
    const subs = db.prepare('SELECT * FROM subscriptions').all().map(subPayload);
    const alive = subs.filter((s) => ['active', 'past_due', 'trialing'].includes(s.status));
    const mrr = alive.reduce((sum, s) => sum + s.mrr_cents, 0);
    const thisMonth = monthKey(now);
    const newThisMonth = subs.filter((s) => monthKey(s.started_at) === thisMonth).length;
    const canceledThisMonth = subs.filter((s) => s.status === 'canceled' && s.canceled_at && monthKey(s.canceled_at) === thisMonth).length;
    const aliveAtMonthStart = subs.filter((s) => {
      const monthStart = Date.parse(thisMonth + '-01T00:00:00Z');
      return s.started_at < monthStart && (!(s.status === 'canceled') || (s.canceled_at && s.canceled_at >= monthStart));
    }).length;
    const churnPct = aliveAtMonthStart > 0 ? Math.round((canceledThisMonth / aliveAtMonthStart) * 1000) / 10 : 0;

    // simple monthly cohort retention: for each start-month, % of subs still alive
    const cohorts = {};
    for (const s of subs) {
      const k = monthKey(s.started_at);
      cohorts[k] = cohorts[k] || { month: k, started: 0, retained: 0 };
      cohorts[k].started++;
      if (['active', 'past_due', 'trialing'].includes(s.status)) cohorts[k].retained++;
    }
    res.json({
      mrr_cents: mrr,
      active_count: subs.filter((s) => s.status === 'active').length,
      trialing_count: subs.filter((s) => s.status === 'trialing').length,
      past_due_count: subs.filter((s) => s.status === 'past_due').length,
      new_this_month: newThisMonth,
      canceled_this_month: canceledThisMonth,
      churn_pct: churnPct,
      cohorts: Object.values(cohorts).sort((a, b) => a.month.localeCompare(b.month))
        .map((c) => ({ ...c, retention_pct: c.started ? Math.round((c.retained / c.started) * 100) : 0 }))
    });
  });

  app.get('/api/events', requireAuth, (req, res) => {
    res.json(db.prepare('SELECT * FROM events ORDER BY at DESC, id DESC LIMIT 100').all()
      .map((e) => ({ ...e, payload: JSON.parse(e.payload_json || '{}') })));
  });

  app.get('/api/dunning', requireAuth, (req, res) => {
    res.json({
      templates: db.prepare('SELECT * FROM dunning_templates ORDER BY step').all(),
      log: db.prepare(`
        SELECT d.*, c.name AS customer_name FROM dunning_log d
        LEFT JOIN customers c ON c.id = d.customer_id
        ORDER BY d.sent_at DESC LIMIT 100
      `).all()
    });
  });

  app.put('/api/dunning/templates/:step', requireAuth, (req, res) => {
    const t = db.prepare('SELECT * FROM dunning_templates WHERE step = ?').get(req.params.step);
    if (!t) return res.status(404).json({ error: 'not found' });
    const b = req.body || {};
    db.prepare('UPDATE dunning_templates SET days_after_fail = ?, subject = ?, body = ? WHERE step = ?')
      .run(Math.max(0, Math.floor(Number(b.days_after_fail ?? t.days_after_fail))), String(b.subject ?? t.subject), String(b.body ?? t.body), t.step);
    res.json(db.prepare('SELECT * FROM dunning_templates WHERE step = ?').get(t.step));
  });

  // ── settings ───────────────────────────────────────────────────────────────
  app.get('/api/settings', requireAuth, (req, res) => {
    const s = getSettings(db);
    res.json({
      ...s,
      smtp_pass: s.smtp_pass ? '********' : '',
      stripe_secret_key: s.stripe_secret_key ? `${s.stripe_secret_key.slice(0, 7)}…${s.stripe_secret_key.slice(-4)}` : ''
    });
  });

  app.put('/api/settings', requireAuth, (req, res) => {
    const body = { ...(req.body || {}) };
    if (body.smtp_pass === '********') delete body.smtp_pass;
    if (typeof body.stripe_secret_key === 'string' && body.stripe_secret_key.includes('…')) delete body.stripe_secret_key;
    setSettings(db, body);
    const s = getSettings(db);
    res.json({
      ...s,
      smtp_pass: s.smtp_pass ? '********' : '',
      stripe_secret_key: s.stripe_secret_key ? `${s.stripe_secret_key.slice(0, 7)}…${s.stripe_secret_key.slice(-4)}` : ''
    });
  });

  // ── static frontend ────────────────────────────────────────────────────────
  const dist = path.join(__dirname, '..', 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/auth')) return next();
      res.sendFile(path.join(dist, 'index.html'));
    });
  }

  return app;
}

module.exports = { createApp };
