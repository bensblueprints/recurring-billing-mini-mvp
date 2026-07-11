import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, Package, Users, FileText, MailWarning, Settings as SettingsIcon, LogOut,
  Plus, Trash2, Check, X, RefreshCw, ExternalLink, AlertTriangle, Repeat, Ticket
} from 'lucide-react';
import { api, fmtMoney } from './api';

function Btn({ children, onClick, kind = 'primary', className = '', ...rest }) {
  const styles = {
    primary: 'bg-emerald-600 hover:bg-emerald-500 text-white',
    ghost: 'bg-zinc-800/60 hover:bg-zinc-700 text-zinc-200',
    danger: 'bg-red-600/80 hover:bg-red-500 text-white'
  };
  return (
    <button onClick={onClick} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${styles[kind]} ${className}`} {...rest}>
      {children}
    </button>
  );
}

function Input(props) {
  return <input {...props} className={`rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-1.5 text-sm outline-none focus:border-emerald-600 ${props.className || ''}`} />;
}

const STATUS_STYLE = {
  active: 'bg-emerald-500/15 text-emerald-400',
  trialing: 'bg-sky-500/15 text-sky-400',
  past_due: 'bg-amber-500/15 text-amber-400',
  paused: 'bg-zinc-600/30 text-zinc-400',
  canceled: 'bg-red-500/15 text-red-400',
  open: 'bg-sky-500/15 text-sky-400',
  paid: 'bg-emerald-500/15 text-emerald-400',
  failed: 'bg-red-500/15 text-red-400',
  void: 'bg-zinc-600/30 text-zinc-500'
};

function Pill({ s }) {
  return <span className={`text-xs rounded-full px-2 py-0.5 ${STATUS_STYLE[s] || 'bg-zinc-700 text-zinc-300'}`}>{s.replace('_', ' ')}</span>;
}

function Login({ onDone }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  return (
    <div className="min-h-screen grid place-items-center">
      <motion.form initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        className="w-80 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8 space-y-4"
        onSubmit={async (e) => { e.preventDefault(); try { await api.login(pw); onDone(); } catch { setErr('Wrong password'); } }}>
        <div className="text-center space-y-1">
          <div className="text-3xl">🔁</div>
          <h1 className="text-xl font-semibold">Billoop</h1>
          <p className="text-xs text-zinc-500">Recurring billing on your own Stripe</p>
        </div>
        <Input type="password" autoFocus placeholder="Admin password" value={pw} onChange={(e) => setPw(e.target.value)} className="w-full" />
        {err && <p className="text-xs text-red-400">{err}</p>}
        <Btn className="w-full justify-center" type="submit">Sign in</Btn>
      </motion.form>
    </div>
  );
}

/* ─────────── Public local customer portal ─────────── */
function Portal({ token }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api.portal(token).then(setData).catch((e) => setErr(e.message)); }, [token]);
  if (err) return <div className="min-h-screen grid place-items-center text-zinc-400">This billing portal link is invalid.</div>;
  if (!data) return null;
  return (
    <div className="min-h-screen">
      <header className="border-b border-zinc-800/70 px-6 h-14 flex items-center font-semibold">{data.business_name} — billing</header>
      <main className="mx-auto max-w-2xl px-4 py-8 space-y-6">
        <div>
          <h1 className="text-lg font-semibold">{data.name}</h1>
          <p className="text-sm text-zinc-500">{data.email}</p>
        </div>
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-zinc-400">Subscriptions</h2>
          {data.subscriptions.map((s, i) => (
            <div key={i} className="rounded-xl border border-zinc-800 px-4 py-3 flex items-center gap-3">
              <div className="flex-1">
                <div className="font-medium">{s.plan_name}</div>
                <div className="text-xs text-zinc-500">{fmtMoney(s.amount_cents)}/{s.interval} · renews {new Date(s.current_period_end).toLocaleDateString()}</div>
              </div>
              <Pill s={s.status} />
            </div>
          ))}
        </section>
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-zinc-400">Invoices</h2>
          <div className="rounded-xl border border-zinc-800 divide-y divide-zinc-800/60">
            {data.invoices.map((i) => (
              <div key={i.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                <span className="flex-1">{new Date(i.created_at).toLocaleDateString()} · {i.kind}</span>
                <span>{fmtMoney(i.amount_cents)}</span>
                <Pill s={i.status} />
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

/* ─────────── Dashboard ─────────── */
function Dashboard() {
  const [d, setD] = useState(null);
  const [sweeping, setSweeping] = useState(false);
  const load = () => api.dashboard().then(setD);
  useEffect(load, []);
  if (!d) return null;
  return (
    <div className="space-y-6">
      <div className="grid sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          ['MRR', fmtMoney(d.mrr_cents), 'text-emerald-400'],
          ['Active', d.active_count, ''],
          ['Trialing', d.trialing_count, 'text-sky-400'],
          ['Past due', d.past_due_count, d.past_due_count ? 'text-amber-400' : ''],
          ['New this month', d.new_this_month, ''],
          ['Churn', `${d.churn_pct}%`, d.churn_pct > 5 ? 'text-red-400' : '']
        ].map(([label, val, cls]) => (
          <div key={label} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
            <div className="text-xs text-zinc-500">{label}</div>
            <div className={`text-xl font-semibold ${cls}`}>{val}</div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <Btn kind="ghost" onClick={async () => { setSweeping(true); await api.sweep(); await load(); setSweeping(false); }}>
          <RefreshCw size={14} className={sweeping ? 'animate-spin' : ''} /> Run renewal & dunning sweep
        </Btn>
        <span className="text-xs text-zinc-600">runs hourly on its own; button forces it now</span>
      </div>
      <section>
        <h2 className="text-sm font-medium text-zinc-400 mb-2">Cohort retention (by start month)</h2>
        <div className="rounded-xl border border-zinc-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900/60 text-zinc-500 text-xs">
              <tr><th className="text-left px-4 py-2">Cohort</th><th className="text-right px-4 py-2">Started</th><th className="text-right px-4 py-2">Still active</th><th className="text-right px-4 py-2">Retention</th></tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {d.cohorts.map((c) => (
                <tr key={c.month}>
                  <td className="px-4 py-2">{c.month}</td>
                  <td className="px-4 py-2 text-right">{c.started}</td>
                  <td className="px-4 py-2 text-right">{c.retained}</td>
                  <td className="px-4 py-2 text-right">
                    <div className="inline-flex items-center gap-2">
                      <div className="w-24 h-1.5 rounded-full bg-zinc-800 overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${c.retention_pct}%` }} /></div>
                      {c.retention_pct}%
                    </div>
                  </td>
                </tr>
              ))}
              {d.cohorts.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-zinc-500">No subscriptions yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/* ─────────── Plans & coupons ─────────── */
function Plans() {
  const [plans, setPlans] = useState([]);
  const [coupons, setCoupons] = useState([]);
  const [pf, setPf] = useState({ name: '', amount: '', interval: 'month', trial_days: 0 });
  const [cf, setCf] = useState({ code: '', percent_off: '', duration: 'once' });
  const load = () => { api.plans().then(setPlans); api.coupons().then(setCoupons); };
  useEffect(load, []);
  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <section className="space-y-3">
        <h2 className="font-semibold flex items-center gap-2"><Package size={16} /> Plans</h2>
        <div className="rounded-xl border border-zinc-800 divide-y divide-zinc-800/60">
          {plans.map((p) => (
            <div key={p.id} className="flex items-center gap-3 px-4 py-2.5">
              <div className="flex-1">
                <div className="text-sm font-medium">{p.name}</div>
                <div className="text-xs text-zinc-500">{p.trial_days > 0 && `${p.trial_days}-day trial · `}{p.stripe_price_id ? `Stripe ${p.stripe_price_id}` : 'local plan'}</div>
              </div>
              <div className="text-sm">{fmtMoney(p.amount_cents)}/{p.interval}</div>
              <button className="text-zinc-600 hover:text-red-400" onClick={async () => { await api.deletePlan(p.id); load(); }}><Trash2 size={14} /></button>
            </div>
          ))}
          {plans.length === 0 && <div className="px-4 py-6 text-sm text-zinc-500">No plans yet.</div>}
        </div>
        <form className="flex flex-wrap gap-2" onSubmit={async (e) => {
          e.preventDefault();
          if (!pf.name || !pf.amount) return;
          try {
            await api.createPlan({ name: pf.name, amount_cents: Math.round(parseFloat(pf.amount) * 100), interval: pf.interval, trial_days: Number(pf.trial_days) || 0 });
            setPf({ name: '', amount: '', interval: 'month', trial_days: 0 });
            load();
          } catch (err) { alert(err.message); }
        }}>
          <Input placeholder="Plan name" value={pf.name} onChange={(e) => setPf({ ...pf, name: e.target.value })} />
          <Input placeholder="$" type="number" step="0.01" value={pf.amount} onChange={(e) => setPf({ ...pf, amount: e.target.value })} className="w-24" />
          <select className="rounded-lg bg-zinc-900 border border-zinc-800 px-2 py-1.5 text-sm" value={pf.interval} onChange={(e) => setPf({ ...pf, interval: e.target.value })}>
            <option value="month">monthly</option>
            <option value="year">yearly</option>
          </select>
          <Input placeholder="Trial days" type="number" value={pf.trial_days} onChange={(e) => setPf({ ...pf, trial_days: e.target.value })} className="w-24" />
          <Btn type="submit"><Plus size={14} /> Add plan</Btn>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold flex items-center gap-2"><Ticket size={16} /> Coupons</h2>
        <div className="rounded-xl border border-zinc-800 divide-y divide-zinc-800/60">
          {coupons.map((c) => (
            <div key={c.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <code className="text-emerald-400">{c.code}</code>
              <span className="flex-1 text-zinc-400">{c.percent_off ? `${c.percent_off}% off` : `${fmtMoney(c.amount_off_cents)} off`} · {c.duration}</span>
              <button className="text-zinc-600 hover:text-red-400" onClick={async () => { await api.deleteCoupon(c.id); load(); }}><Trash2 size={14} /></button>
            </div>
          ))}
          {coupons.length === 0 && <div className="px-4 py-6 text-sm text-zinc-500">No coupons.</div>}
        </div>
        <form className="flex flex-wrap gap-2" onSubmit={async (e) => {
          e.preventDefault();
          if (!cf.code || !cf.percent_off) return;
          try {
            await api.createCoupon({ code: cf.code, percent_off: Number(cf.percent_off), duration: cf.duration });
            setCf({ code: '', percent_off: '', duration: 'once' });
            load();
          } catch (err) { alert(err.message); }
        }}>
          <Input placeholder="CODE" value={cf.code} onChange={(e) => setCf({ ...cf, code: e.target.value.toUpperCase() })} className="w-32" />
          <Input placeholder="% off" type="number" value={cf.percent_off} onChange={(e) => setCf({ ...cf, percent_off: e.target.value })} className="w-20" />
          <select className="rounded-lg bg-zinc-900 border border-zinc-800 px-2 py-1.5 text-sm" value={cf.duration} onChange={(e) => setCf({ ...cf, duration: e.target.value })}>
            <option value="once">first invoice only</option>
            <option value="forever">forever</option>
          </select>
          <Btn type="submit"><Plus size={14} /> Add coupon</Btn>
        </form>
      </section>
    </div>
  );
}

/* ─────────── Customers & subscriptions ─────────── */
function Customers() {
  const [customers, setCustomers] = useState([]);
  const [plans, setPlans] = useState([]);
  const [cf, setCf] = useState({ name: '', email: '' });
  const [subForm, setSubForm] = useState({});
  const load = () => { api.customers().then(setCustomers); api.plans().then(setPlans); };
  useEffect(load, []);
  return (
    <div className="space-y-4">
      <form className="flex flex-wrap gap-2" onSubmit={async (e) => {
        e.preventDefault();
        if (!cf.name || !cf.email) return;
        try { await api.createCustomer(cf); setCf({ name: '', email: '' }); load(); } catch (err) { alert(err.message); }
      }}>
        <Input placeholder="Customer name" value={cf.name} onChange={(e) => setCf({ ...cf, name: e.target.value })} />
        <Input placeholder="Email" value={cf.email} onChange={(e) => setCf({ ...cf, email: e.target.value })} className="w-64" />
        <Btn type="submit"><Plus size={14} /> Add customer</Btn>
      </form>
      <div className="space-y-3">
        {customers.map((c) => (
          <div key={c.id} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex-1">
                <div className="font-medium">{c.name}</div>
                <div className="text-xs text-zinc-500">{c.email}{c.stripe_customer_id && ` · ${c.stripe_customer_id}`}</div>
              </div>
              <div className="text-sm text-zinc-400">MRR {fmtMoney(c.mrr_cents)}</div>
              {c.next_renewal_at && <div className="text-xs text-zinc-500">renews {new Date(c.next_renewal_at).toLocaleDateString()}</div>}
              <Btn kind="ghost" onClick={async () => {
                const r = await api.portalLink(c.id);
                if (r.mode === 'stripe') window.open(r.url, '_blank');
                else { await navigator.clipboard.writeText(window.location.origin + r.url); alert('Local portal link copied:\n' + window.location.origin + r.url); }
              }}><ExternalLink size={13} /> Portal</Btn>
            </div>
            {c.subscriptions.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-zinc-950/50 px-3 py-2 text-sm">
                <span className="font-medium">{s.plan_name}</span>
                <span className="text-zinc-500">{fmtMoney(s.plan_amount_cents)}/{s.plan_interval}</span>
                {s.coupon_code && <code className="text-xs text-emerald-500">{s.coupon_code}</code>}
                <Pill s={s.status} />
                {s.cancel_at_period_end === 1 && <span className="text-xs text-amber-400">cancels at period end</span>}
                <span className="ml-auto text-xs text-zinc-500">period ends {new Date(s.current_period_end).toLocaleDateString()}</span>
                {['active', 'past_due', 'trialing'].includes(s.status) && (<>
                  <select className="rounded bg-zinc-900 border border-zinc-800 px-1.5 py-0.5 text-xs" defaultValue="" onChange={async (e) => {
                    if (e.target.value) { try { await api.changePlan(s.id, Number(e.target.value)); load(); } catch (err) { alert(err.message); } }
                  }}>
                    <option value="">change plan (prorated)…</option>
                    {plans.filter((p) => p.id !== s.plan_id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <button className="text-xs text-zinc-500 hover:text-red-400" onClick={async () => { await api.cancelSub(s.id, true); load(); }}>cancel at period end</button>
                  <button className="text-xs text-zinc-600 hover:text-red-400" onClick={async () => { if (confirm('Cancel immediately?')) { await api.cancelSub(s.id, false); load(); } }}>cancel now</button>
                </>)}
                {s.status === 'paused' && <Btn kind="ghost" onClick={async () => { await api.resumeSub(s.id); load(); }}>Resume</Btn>}
              </div>
            ))}
            <form className="flex flex-wrap gap-2" onSubmit={async (e) => {
              e.preventDefault();
              const f = subForm[c.id] || {};
              if (!f.plan_id) return;
              try { await api.subscribe({ customer_id: c.id, plan_id: Number(f.plan_id), coupon_code: f.coupon || undefined }); load(); }
              catch (err) { alert(err.message); }
            }}>
              <select className="rounded-lg bg-zinc-900 border border-zinc-800 px-2 py-1 text-xs" value={(subForm[c.id] || {}).plan_id || ''} onChange={(e) => setSubForm({ ...subForm, [c.id]: { ...(subForm[c.id] || {}), plan_id: e.target.value } })}>
                <option value="">subscribe to…</option>
                {plans.map((p) => <option key={p.id} value={p.id}>{p.name} — {fmtMoney(p.amount_cents)}/{p.interval}</option>)}
              </select>
              <Input placeholder="coupon" value={(subForm[c.id] || {}).coupon || ''} onChange={(e) => setSubForm({ ...subForm, [c.id]: { ...(subForm[c.id] || {}), coupon: e.target.value.toUpperCase() } })} className="w-28 text-xs" />
              <Btn type="submit" className="text-xs px-2 py-1"><Repeat size={12} /> Subscribe</Btn>
            </form>
          </div>
        ))}
        {customers.length === 0 && <div className="text-sm text-zinc-500 p-6 text-center">No customers yet.</div>}
      </div>
    </div>
  );
}

/* ─────────── Invoices ─────────── */
function Invoices() {
  const [rows, setRows] = useState([]);
  const load = () => api.invoices().then(setRows);
  useEffect(load, []);
  return (
    <div className="rounded-xl border border-zinc-800 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-zinc-900/60 text-zinc-500 text-xs">
          <tr>
            <th className="text-left px-4 py-2">Customer</th><th className="text-left px-4 py-2">Kind</th>
            <th className="text-left px-4 py-2">Lines</th><th className="text-right px-4 py-2">Amount</th>
            <th className="px-4 py-2">Status</th><th className="text-right px-4 py-2">Created</th><th className="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/60">
          {rows.map((i) => (
            <tr key={i.id}>
              <td className="px-4 py-2">{i.customer_name}</td>
              <td className="px-4 py-2 text-zinc-400">{i.kind}</td>
              <td className="px-4 py-2 text-xs text-zinc-500">
                {i.lines.map((l, idx) => <div key={idx}>{l.description} <span className={l.amount_cents < 0 ? 'text-emerald-500' : ''}>{fmtMoney(l.amount_cents)}</span></div>)}
              </td>
              <td className="px-4 py-2 text-right font-medium">{fmtMoney(i.amount_cents)}</td>
              <td className="px-4 py-2 text-center"><Pill s={i.status} /></td>
              <td className="px-4 py-2 text-right text-xs text-zinc-500">{new Date(i.created_at).toLocaleDateString()}</td>
              <td className="px-4 py-2 text-right">
                {i.status === 'open' || i.status === 'failed' ? (
                  <div className="flex gap-1 justify-end">
                    <Btn className="text-xs px-2 py-0.5" onClick={async () => { await api.payInvoice(i.id); load(); }}>mark paid</Btn>
                    {i.status === 'open' && <Btn kind="danger" className="text-xs px-2 py-0.5" onClick={async () => { await api.failInvoice(i.id); load(); }}>mark failed</Btn>}
                  </div>
                ) : null}
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-zinc-500">No invoices yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/* ─────────── Dunning ─────────── */
function Dunning() {
  const [data, setData] = useState(null);
  const [edit, setEdit] = useState({});
  const load = () => api.dunning().then(setData);
  useEffect(load, []);
  if (!data) return null;
  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <section className="space-y-3">
        <h2 className="font-semibold flex items-center gap-2"><MailWarning size={16} /> Dunning sequence</h2>
        <p className="text-xs text-zinc-500">When a payment fails, these emails go out N days after the failure. After the full sequence, the subscription is auto-{'{'}canceled/paused{'}'} per Settings.</p>
        {data.templates.map((t) => {
          const e = edit[t.step] || t;
          return (
            <div key={t.step} className="rounded-xl border border-zinc-800 p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium">Step {t.step}</span>
                <span className="text-zinc-500">·</span>
                <Input type="number" min="0" value={e.days_after_fail} onChange={(ev) => setEdit({ ...edit, [t.step]: { ...e, days_after_fail: ev.target.value } })} className="w-16" />
                <span className="text-xs text-zinc-500">days after failure</span>
                <Btn className="ml-auto text-xs px-2 py-1" onClick={async () => { await api.saveDunningTemplate(t.step, e); load(); }}>Save</Btn>
              </div>
              <Input value={e.subject} onChange={(ev) => setEdit({ ...edit, [t.step]: { ...e, subject: ev.target.value } })} className="w-full" />
              <textarea value={e.body} onChange={(ev) => setEdit({ ...edit, [t.step]: { ...e, body: ev.target.value } })}
                className="w-full h-28 rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-xs font-mono outline-none focus:border-emerald-600" />
              <p className="text-[10px] text-zinc-600">Placeholders: {'{{name}} {{amount}} {{plan}} {{portal_url}}'}</p>
            </div>
          );
        })}
      </section>
      <section className="space-y-3">
        <h2 className="font-semibold">Dunning log</h2>
        <div className="rounded-xl border border-zinc-800 divide-y divide-zinc-800/60">
          {data.log.map((l) => (
            <div key={l.id} className="flex items-center gap-3 px-4 py-2 text-sm">
              <span className="text-xs rounded-full px-2 py-0.5 bg-amber-500/15 text-amber-400">step {l.step}</span>
              <span className="flex-1">{l.customer_name}</span>
              <span className="text-xs text-zinc-500">{l.channel} · {new Date(l.sent_at).toLocaleString()}</span>
              {l.ok ? <Check size={13} className="text-emerald-500" /> : <X size={13} className="text-red-400" />}
            </div>
          ))}
          {data.log.length === 0 && <div className="px-4 py-8 text-sm text-zinc-500 text-center">No dunning activity — nice.</div>}
        </div>
      </section>
    </div>
  );
}

/* ─────────── Settings ─────────── */
function SettingsTab() {
  const [s, setS] = useState(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => { api.settings().then(setS); }, []);
  if (!s) return null;
  const set = (k) => (e) => setS({ ...s, [k]: e.target.value });
  return (
    <div className="max-w-xl space-y-4">
      <label className="block text-sm text-zinc-400">Business name<Input value={s.business_name} onChange={set('business_name')} className="w-full mt-1" /></label>
      <fieldset className="rounded-xl border border-zinc-800 p-4 space-y-3">
        <legend className="text-xs text-zinc-500 px-1">Stripe (optional — BYO key; Billoop orchestrates, never touches funds)</legend>
        <Input placeholder="sk_live_… (stored locally, never leaves this server)" value={s.stripe_secret_key} onChange={set('stripe_secret_key')} className="w-full" />
        <Input placeholder="Webhook signing secret whsec_…" value={s.stripe_webhook_secret} onChange={set('stripe_webhook_secret')} className="w-full" />
        <p className="text-[11px] text-zinc-600">Point a Stripe webhook at <code>/api/webhooks/stripe</code>. Without a key, Billoop runs in local mode — full engine, no card processing.</p>
      </fieldset>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm text-zinc-400">Max failed attempts
          <Input type="number" min="1" value={s.max_failed_attempts} onChange={set('max_failed_attempts')} className="w-full mt-1" />
        </label>
        <label className="block text-sm text-zinc-400">After dunning exhausted
          <select className="w-full mt-1 rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-1.5 text-sm" value={s.dunning_action} onChange={set('dunning_action')}>
            <option value="cancel">cancel subscription</option>
            <option value="pause">pause subscription</option>
          </select>
        </label>
      </div>
      <fieldset className="rounded-xl border border-zinc-800 p-4 space-y-3">
        <legend className="text-xs text-zinc-500 px-1">SMTP (for dunning emails)</legend>
        <div className="grid grid-cols-2 gap-2">
          <Input placeholder="Host" value={s.smtp_host} onChange={set('smtp_host')} />
          <Input placeholder="Port" value={s.smtp_port} onChange={set('smtp_port')} />
          <Input placeholder="User" value={s.smtp_user} onChange={set('smtp_user')} />
          <Input placeholder="Password" type="password" value={s.smtp_pass} onChange={set('smtp_pass')} />
          <Input placeholder="From address" value={s.smtp_from} onChange={set('smtp_from')} />
          <Input placeholder="Public base URL (for portal links)" value={s.portal_url_base} onChange={set('portal_url_base')} />
        </div>
      </fieldset>
      <Btn onClick={async () => { await api.saveSettings(s); setSaved(true); setTimeout(() => setSaved(false), 1500); }}>{saved ? <><Check size={14} /> Saved</> : 'Save settings'}</Btn>
    </div>
  );
}

export default function App() {
  const portalMatch = window.location.pathname.match(/^\/portal\/([a-f0-9]+)$/);
  if (portalMatch) return <Portal token={portalMatch[1]} />;

  const [authed, setAuthed] = useState(null);
  const [tab, setTab] = useState('dashboard');
  useEffect(() => { api.me().then(() => setAuthed(true)).catch(() => setAuthed(false)); }, []);

  if (authed === null) return null;
  if (!authed) return <Login onDone={() => setAuthed(true)} />;

  const tabs = [
    ['dashboard', 'Dashboard', LayoutDashboard],
    ['plans', 'Plans', Package],
    ['customers', 'Customers', Users],
    ['invoices', 'Invoices', FileText],
    ['dunning', 'Dunning', MailWarning],
    ['settings', 'Settings', SettingsIcon]
  ];

  return (
    <div className="min-h-screen">
      <header className="border-b border-zinc-800/70 bg-zinc-950/80 backdrop-blur sticky top-0 z-40">
        <div className="mx-auto max-w-7xl px-4 h-14 flex items-center gap-6">
          <div className="flex items-center gap-2 font-semibold">🔁 Billoop</div>
          <nav className="flex gap-1 text-sm">
            {tabs.map(([id, label, Icon]) => (
              <button key={id} onClick={() => setTab(id)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition ${tab === id ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-white'}`}>
                <Icon size={14} /> {label}
              </button>
            ))}
          </nav>
          <button className="ml-auto text-zinc-500 hover:text-white" title="Log out" onClick={async () => { await api.logout(); setAuthed(false); }}><LogOut size={16} /></button>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">
        {tab === 'dashboard' && <Dashboard />}
        {tab === 'plans' && <Plans />}
        {tab === 'customers' && <Customers />}
        {tab === 'invoices' && <Invoices />}
        {tab === 'dunning' && <Dunning />}
        {tab === 'settings' && <SettingsTab />}
      </main>
    </div>
  );
}
