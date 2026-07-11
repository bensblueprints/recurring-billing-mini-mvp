// Billoop smoke test — boots the real server (deterministic-time test mode) and
// exercises the full billing engine with EXACT integer-cent assertions:
// plans/coupons → initial invoices → trial conversion → mid-cycle proration →
// renewal sweep → dunning sequence with auto-cancel → MRR/churn → webhook →
// recovery → local portal.
// Kills ONLY the spawned server child (never broad-kills node processes).
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert');

const ROOT = path.join(__dirname, '..');
const TEST_PORT = 5388;
const ADMIN_PASSWORD = 'smoke-test-password';
const DB_PATH = path.join(__dirname, 'smoke.db');
const BASE = `http://127.0.0.1:${TEST_PORT}`;

for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) {
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

let serverProc = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, label, tries = 40, delay = 250) {
  for (let i = 0; i < tries; i++) {
    try { const v = await fn(); if (v) return v; } catch { /* retry */ }
    await sleep(delay);
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

let cookie = '';
async function api(pathname, options = {}) {
  const res = await fetch(BASE + pathname, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...options.headers },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

// Deterministic timeline (UTC)
const T0 = Date.UTC(2026, 0, 1);            // Jan 1 — subscriptions start
const JAN15 = Date.UTC(2026, 0, 15);        // trial conversion day
const MID = Date.UTC(2026, 0, 16, 12);      // exactly 50% through Jan 1 → Feb 1 (31d)
const FEB1 = Date.UTC(2026, 1, 1);          // renewal day
const FEB4 = Date.UTC(2026, 1, 4);          // dunning step 2 (3 days after fail)
const FEB8 = Date.UTC(2026, 1, 8);          // dunning step 3 (7 days after fail)
const FEB10 = Date.UTC(2026, 1, 10);

async function main() {
  console.log('1. Booting Billoop on port', TEST_PORT, '(ALLOW_TEST_NOW=1, temp DB)');
  serverProc = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(TEST_PORT), ADMIN_PASSWORD, DB_PATH, ALLOW_TEST_NOW: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  serverProc.stdout.on('data', (d) => process.stdout.write(`   [server] ${d}`));
  serverProc.stderr.on('data', (d) => process.stderr.write(`   [server] ${d}`));
  await waitFor(async () => (await api('/api/health')).data.ok, 'server health');

  console.log('   Auth: wrong password → 401, unauthenticated API → 401, login → 200');
  assert.strictEqual((await api('/api/login', { method: 'POST', body: { password: 'nope' } })).status, 401);
  cookie = '';
  assert.strictEqual((await api('/api/plans')).status, 401, 'admin API must require auth');
  assert.strictEqual((await api('/api/login', { method: 'POST', body: { password: ADMIN_PASSWORD } })).status, 200);

  console.log('2. Plans (integer cents) + 50%-once coupon');
  const basic = (await api('/api/plans', { method: 'POST', body: { name: 'Basic', amount_cents: 3000, interval: 'month' } })).data;
  const pro = (await api('/api/plans', { method: 'POST', body: { name: 'Pro', amount_cents: 6000, interval: 'month' } })).data;
  const annual = (await api('/api/plans', { method: 'POST', body: { name: 'Annual', amount_cents: 12000, interval: 'year' } })).data;
  const starter = (await api('/api/plans', { method: 'POST', body: { name: 'Starter', amount_cents: 3000, interval: 'month', trial_days: 14 } })).data;
  assert.strictEqual(basic.amount_cents, 3000);
  const coupon = (await api('/api/coupons', { method: 'POST', body: { code: 'LAUNCH50', percent_off: 50, duration: 'once' } })).data;
  assert.strictEqual(coupon.percent_off, 50);

  console.log('3. Subscriptions at T0: initial invoices 3000 / 1500 (coupon) / 12000; trial → no invoice');
  const carol = (await api('/api/customers', { method: 'POST', body: { name: 'Carol', email: 'carol@example.com' } })).data;
  const dave = (await api('/api/customers', { method: 'POST', body: { name: 'Dave', email: 'dave@example.com' } })).data;
  const erin = (await api('/api/customers', { method: 'POST', body: { name: 'Erin', email: 'erin@example.com' } })).data;
  const frank = (await api('/api/customers', { method: 'POST', body: { name: 'Frank', email: 'frank@example.com' } })).data;

  const carolSub = (await api('/api/subscriptions', { method: 'POST', body: { customer_id: carol.id, plan_id: basic.id, now: T0 } })).data;
  assert.strictEqual(carolSub.status, 'active');
  assert.strictEqual(carolSub.invoice.amount_cents, 3000, 'Carol initial invoice must be exactly 3000c');
  assert.strictEqual(carolSub.current_period_end, FEB1, 'monthly period Jan 1 → Feb 1 (calendar month)');
  await api(`/api/invoices/${carolSub.invoice.id}/pay`, { method: 'POST', body: { now: T0 } });

  const daveSub = (await api('/api/subscriptions', { method: 'POST', body: { customer_id: dave.id, plan_id: basic.id, coupon_code: 'LAUNCH50', now: T0 } })).data;
  assert.strictEqual(daveSub.invoice.amount_cents, 1500, '50% once coupon → exactly 1500c');
  assert.deepStrictEqual(
    JSON.parse(daveSub.invoice.lines_json).map((l) => l.amount_cents), [3000, -1500],
    'coupon must appear as an explicit -1500 line item'
  );
  await api(`/api/invoices/${daveSub.invoice.id}/pay`, { method: 'POST', body: { now: T0 } });

  const erinSub = (await api('/api/subscriptions', { method: 'POST', body: { customer_id: erin.id, plan_id: annual.id, now: T0 } })).data;
  assert.strictEqual(erinSub.invoice.amount_cents, 12000);
  assert.strictEqual(erinSub.mrr_cents, 1000, 'yearly 12000c must contribute exactly 1000c MRR');
  await api(`/api/invoices/${erinSub.invoice.id}/pay`, { method: 'POST', body: { now: T0 } });

  const frankSub = (await api('/api/subscriptions', { method: 'POST', body: { customer_id: frank.id, plan_id: starter.id, now: T0 } })).data;
  assert.strictEqual(frankSub.status, 'trialing');
  assert.strictEqual(frankSub.invoice, null, 'trials must not invoice up front');
  assert.strictEqual(frankSub.current_period_end, JAN15, '14-day trial ends Jan 15');
  assert.strictEqual(frankSub.mrr_cents, 0, 'trialing subs must NOT count toward MRR');

  console.log('4. Trial conversion sweep at Jan 15 → invoice 3000, kind initial');
  const sweep1 = (await api('/api/sweep', { method: 'POST', body: { now: JAN15 } })).data;
  assert.strictEqual(sweep1.trial_conversions, 1, 'exactly one trial must convert');
  assert.strictEqual(sweep1.renewals, 0);
  let invoices = (await api('/api/invoices')).data;
  const frankInv = invoices.find((i) => i.customer_id === frank.id);
  assert.strictEqual(frankInv.amount_cents, 3000);
  assert.strictEqual(frankInv.kind, 'initial');

  console.log('5. Proration at exactly 50% of the period: credit 1500, charge 3000, due 1500');
  const changed = (await api(`/api/subscriptions/${carolSub.id}/change-plan`, { method: 'POST', body: { plan_id: pro.id, now: MID } })).data;
  assert.strictEqual(changed.proration.credit_cents, 1500, 'unused Basic credit must be exactly 1500c');
  assert.strictEqual(changed.proration.charge_cents, 3000, 'remaining Pro charge must be exactly 3000c');
  assert.strictEqual(changed.proration.due_cents, 1500, 'proration invoice must be exactly 1500c');
  assert.strictEqual(changed.invoice.amount_cents, 1500);
  assert.strictEqual(changed.invoice.kind, 'proration');
  assert.deepStrictEqual(JSON.parse(changed.invoice.lines_json).map((l) => l.amount_cents), [-1500, 3000],
    'proration lines must be [-1500 credit, +3000 charge]');
  assert.strictEqual(changed.current_period_end, FEB1, 'plan change must NOT move the period');
  await api(`/api/invoices/${changed.invoice.id}/pay`, { method: 'POST', body: { now: MID } });

  console.log('6. Renewal sweep at Feb 1: Carol renews at Pro 6000, Dave at full 3000 (once-coupon spent)');
  const sweep2 = (await api('/api/sweep', { method: 'POST', body: { now: FEB1 } })).data;
  assert.strictEqual(sweep2.renewals, 2, 'Carol + Dave must renew (Erin is yearly, Frank renews Feb 15)');
  invoices = (await api('/api/invoices')).data;
  const carolRenewal = invoices.find((i) => i.customer_id === carol.id && i.kind === 'renewal');
  const daveRenewal = invoices.find((i) => i.customer_id === dave.id && i.kind === 'renewal');
  assert.strictEqual(carolRenewal.amount_cents, 6000, 'Carol renewal must bill the NEW plan: exactly 6000c');
  assert.strictEqual(daveRenewal.amount_cents, 3000, "once-coupon must NOT apply to renewals: exactly 3000c");
  const subsNow = (await api('/api/subscriptions')).data;
  assert.strictEqual(subsNow.find((s) => s.id === carolSub.id).current_period_end, Date.UTC(2026, 2, 1), 'Carol period rolls Feb 1 → Mar 1');

  console.log('7. MRR = 6000 (Carol Pro) + 3000 (Dave) + 1000 (Erin yr) + 3000 (Frank) = 13000');
  let dash = (await api('/api/dashboard?now=' + FEB1)).data;
  assert.strictEqual(dash.mrr_cents, 13000, 'MRR must be exactly 13000c');

  console.log('8. Dunning: fail Carol renewal → 3-step sequence at +0/+3/+7 days → auto-cancel');
  await api(`/api/invoices/${carolRenewal.id}/fail`, { method: 'POST', body: { now: FEB1 } });
  let carolNow = (await api('/api/subscriptions')).data.find((s) => s.id === carolSub.id);
  assert.strictEqual(carolNow.status, 'past_due', 'failed invoice must set past_due');

  const s3 = (await api('/api/sweep', { method: 'POST', body: { now: FEB1 } })).data;
  assert.strictEqual(s3.dunning_emails, 1, 'step 1 (0 days after fail) sends on the first sweep');
  assert.strictEqual(s3.canceled, 0, 'must not cancel before the sequence completes');
  const s4 = (await api('/api/sweep', { method: 'POST', body: { now: FEB4 } })).data;
  assert.strictEqual(s4.dunning_emails, 1, 'step 2 exactly at +3 days');
  const s5 = (await api('/api/sweep', { method: 'POST', body: { now: FEB8 } })).data;
  assert.strictEqual(s5.dunning_emails, 1, 'step 3 exactly at +7 days');
  assert.strictEqual(s5.canceled, 1, 'after the full sequence + max attempts the sub must cancel');

  const dunning = (await api('/api/dunning')).data;
  assert.deepStrictEqual(dunning.log.filter((l) => l.invoice_id === carolRenewal.id).map((l) => l.step).sort(), [1, 2, 3],
    'exactly steps 1, 2, 3 must be logged, once each');
  carolNow = (await api('/api/subscriptions')).data.find((s) => s.id === carolSub.id);
  assert.strictEqual(carolNow.status, 'canceled');
  const voided = (await api('/api/invoices')).data.find((i) => i.id === carolRenewal.id);
  assert.strictEqual(voided.status, 'void', 'exhausted invoice must be voided');

  console.log('9. Post-cancel MRR 7000; churn = 1 canceled / 4 alive at Feb start = 25%');
  dash = (await api('/api/dashboard?now=' + FEB8)).data;
  assert.strictEqual(dash.mrr_cents, 7000, 'MRR after cancel must be exactly 7000c');
  assert.strictEqual(dash.canceled_this_month, 1);
  assert.strictEqual(dash.churn_pct, 25, 'churn must be exactly 25%');

  console.log('10. Recovery: Dave fails then pays → past_due → active again');
  await api(`/api/invoices/${daveRenewal.id}/fail`, { method: 'POST', body: { now: FEB10 } });
  assert.strictEqual((await api('/api/subscriptions')).data.find((s) => s.id === daveSub.id).status, 'past_due');
  await api(`/api/invoices/${daveRenewal.id}/pay`, { method: 'POST', body: { now: FEB10 } });
  assert.strictEqual((await api('/api/subscriptions')).data.find((s) => s.id === daveSub.id).status, 'active',
    'paying the failed invoice must recover the subscription');

  console.log('11. Stripe webhook pays an open invoice via metadata');
  const openInv = (await api('/api/invoices')).data.find((i) => i.id === frankInv.id);
  assert.strictEqual(openInv.status, 'open');
  cookie2 = cookie; cookie = ''; // webhooks are unauthenticated by design
  const wh = await api('/api/webhooks/stripe', {
    method: 'POST',
    body: { type: 'invoice.paid', data: { object: { metadata: { billoop_invoice_id: String(frankInv.id) } } } }
  });
  assert.strictEqual(wh.status, 200);
  cookie = cookie2;
  assert.strictEqual((await api('/api/invoices')).data.find((i) => i.id === frankInv.id).status, 'paid',
    'webhook must mark the invoice paid');

  console.log('12. Local customer portal: tokenized, no auth, no leakage of other customers');
  const portalLink = (await api(`/api/customers/${dave.id}/portal`)).data;
  assert.strictEqual(portalLink.mode, 'local');
  cookie2 = cookie; cookie = '';
  const portal = (await api(portalLink.url.replace('/portal/', '/api/portal/'))).data;
  assert.strictEqual(portal.name, 'Dave');
  assert.strictEqual(portal.subscriptions.length, 1);
  assert.ok(portal.invoices.every((i) => [1500, 3000].includes(i.amount_cents)), 'portal must only show Dave invoices');
  assert.strictEqual((await api('/api/portal/nope')).status, 404);
  cookie = cookie2;

  console.log('13. cancel_at_period_end honored by the sweep');
  await api(`/api/subscriptions/${erinSub.id}/cancel`, { method: 'POST', body: { at_period_end: true } });
  const sweepEnd = (await api('/api/sweep', { method: 'POST', body: { now: Date.UTC(2027, 0, 1) } })).data;
  assert.strictEqual(sweepEnd.period_end_cancellations, 1, 'Erin must cancel at her Jan 1 2027 period end, not renew');
  assert.strictEqual((await api('/api/subscriptions')).data.find((s) => s.id === erinSub.id).status, 'canceled');

  console.log('14. Rows really landed in SQLite');
  const Database = require('better-sqlite3');
  const db = new Database(DB_PATH, { readonly: true });
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM dunning_log').get().c, 3);
  assert.strictEqual(db.prepare("SELECT COUNT(*) c FROM invoices WHERE kind = 'proration'").get().c, 1);
  assert.strictEqual(db.prepare("SELECT COUNT(*) c FROM subscriptions WHERE status = 'canceled'").get().c, 2);
  assert.ok(db.prepare("SELECT COUNT(*) c FROM events WHERE type = 'sweep.completed'").get().c >= 5);
  db.close();

  console.log('\n✅ All Billoop smoke tests passed');
}

let cookie2 = '';

async function cleanup(code) {
  if (serverProc && !serverProc.killed) serverProc.kill(); // only our child
  await sleep(300);
  for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* windows lock — harmless */ }
  }
  process.exit(code);
}

main()
  .then(() => cleanup(0))
  .catch(async (err) => {
    console.error('\n❌ Smoke test failed:', err.message);
    await cleanup(1);
  });
