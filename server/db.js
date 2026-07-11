const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

function nativeBindingPath() {
  if (!process.versions.electron) return null;
  const p = path.join(__dirname, '..', 'vendor', 'better_sqlite3-electron.node');
  return fs.existsSync(p) ? p : null;
}

function genToken(len = 24) {
  return crypto.randomBytes(len).toString('hex');
}

function openDb(dbPath) {
  fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const nativeBinding = nativeBindingPath();
  const db = new Database(dbPath, nativeBinding ? { nativeBinding } : {});
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,            -- integer cents, never floats
      currency TEXT NOT NULL DEFAULT 'usd',
      interval TEXT NOT NULL DEFAULT 'month',   -- month|year
      trial_days INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      stripe_product_id TEXT,
      stripe_price_id TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS coupons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      percent_off INTEGER,                      -- integer percent (50 = 50%)
      amount_off_cents INTEGER,
      duration TEXT NOT NULL DEFAULT 'once',    -- once|forever
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      stripe_customer_id TEXT,
      portal_token TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      plan_id INTEGER NOT NULL,
      coupon_id INTEGER,
      status TEXT NOT NULL,                     -- trialing|active|past_due|paused|canceled
      started_at INTEGER NOT NULL,
      current_period_start INTEGER NOT NULL,
      current_period_end INTEGER NOT NULL,
      cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
      canceled_at INTEGER,
      stripe_subscription_id TEXT
    );
    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subscription_id INTEGER NOT NULL,
      customer_id INTEGER NOT NULL,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'usd',
      status TEXT NOT NULL DEFAULT 'open',      -- open|paid|failed|void
      kind TEXT NOT NULL DEFAULT 'renewal',     -- initial|renewal|proration
      lines_json TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      paid_at INTEGER,
      failed_at INTEGER,
      attempt_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS dunning_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      step INTEGER NOT NULL UNIQUE,
      days_after_fail INTEGER NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS dunning_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL,
      customer_id INTEGER NOT NULL,
      step INTEGER NOT NULL,
      channel TEXT NOT NULL DEFAULT 'log',      -- log|email
      sent_at INTEGER NOT NULL,
      ok INTEGER NOT NULL DEFAULT 1,
      error TEXT
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      payload_json TEXT,
      at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_subs_customer ON subscriptions(customer_id);
    CREATE INDEX IF NOT EXISTS idx_invoices_sub ON invoices(subscription_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_dunning_invoice ON dunning_log(invoice_id, step);
  `);

  // Seed the default 3-step dunning sequence once.
  if (db.prepare('SELECT COUNT(*) c FROM dunning_templates').get().c === 0) {
    const ins = db.prepare('INSERT INTO dunning_templates (step, days_after_fail, subject, body) VALUES (?, ?, ?, ?)');
    ins.run(1, 0, 'Your payment failed — let’s fix it',
      'Hi {{name}},\n\nYour payment of {{amount}} for {{plan}} didn’t go through. This usually just means an expired card.\n\nUpdate your payment method here: {{portal_url}}\n\nThanks!');
    ins.run(2, 3, 'Reminder: payment still failing',
      'Hi {{name}},\n\nQuick reminder — we still couldn’t collect {{amount}} for {{plan}}. Please update your card to keep your subscription active: {{portal_url}}');
    ins.run(3, 7, 'Final notice before your subscription is canceled',
      'Hi {{name}},\n\nThis is the final notice: your subscription to {{plan}} will be canceled if we can’t collect {{amount}}. Update your payment method now: {{portal_url}}');
  }

  return db;
}

const DEFAULT_SETTINGS = {
  business_name: 'My Business',
  stripe_secret_key: '',
  stripe_webhook_secret: '',
  max_failed_attempts: '3',
  dunning_action: 'cancel',     // cancel|pause after max failures
  portal_url_base: '',
  smtp_host: '',
  smtp_port: '587',
  smtp_user: '',
  smtp_pass: '',
  smtp_from: ''
};

function getSettings(db) {
  const out = { ...DEFAULT_SETTINGS };
  if (process.env.STRIPE_SECRET_KEY) out.stripe_secret_key = process.env.STRIPE_SECRET_KEY;
  if (process.env.SMTP_HOST) out.smtp_host = process.env.SMTP_HOST;
  if (process.env.SMTP_PORT) out.smtp_port = process.env.SMTP_PORT;
  if (process.env.SMTP_USER) out.smtp_user = process.env.SMTP_USER;
  if (process.env.SMTP_PASS) out.smtp_pass = process.env.SMTP_PASS;
  if (process.env.SMTP_FROM) out.smtp_from = process.env.SMTP_FROM;
  for (const r of db.prepare('SELECT key, value FROM settings').all()) {
    if (r.value !== '' && r.value != null) out[r.key] = r.value;
  }
  return out;
}

function setSettings(db, obj) {
  const stmt = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  const tx = db.transaction((entries) => {
    for (const [k, v] of entries) {
      if (k in DEFAULT_SETTINGS) stmt.run(k, String(v ?? ''));
    }
  });
  tx(Object.entries(obj));
}

module.exports = { openDb, genToken, getSettings, setSettings, DEFAULT_SETTINGS };
