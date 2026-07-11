async function req(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...options,
    body: options.body != null ? JSON.stringify(options.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  me: () => req('/api/me'),
  login: (password) => req('/api/login', { method: 'POST', body: { password } }),
  logout: () => req('/api/logout', { method: 'POST' }),
  dashboard: () => req('/api/dashboard'),
  plans: () => req('/api/plans'),
  createPlan: (b) => req('/api/plans', { method: 'POST', body: b }),
  deletePlan: (id) => req(`/api/plans/${id}`, { method: 'DELETE' }),
  coupons: () => req('/api/coupons'),
  createCoupon: (b) => req('/api/coupons', { method: 'POST', body: b }),
  deleteCoupon: (id) => req(`/api/coupons/${id}`, { method: 'DELETE' }),
  customers: () => req('/api/customers'),
  createCustomer: (b) => req('/api/customers', { method: 'POST', body: b }),
  portalLink: (id) => req(`/api/customers/${id}/portal`),
  subscriptions: () => req('/api/subscriptions'),
  subscribe: (b) => req('/api/subscriptions', { method: 'POST', body: b }),
  changePlan: (id, plan_id) => req(`/api/subscriptions/${id}/change-plan`, { method: 'POST', body: { plan_id } }),
  cancelSub: (id, atPeriodEnd) => req(`/api/subscriptions/${id}/cancel`, { method: 'POST', body: { at_period_end: atPeriodEnd } }),
  resumeSub: (id) => req(`/api/subscriptions/${id}/resume`, { method: 'POST' }),
  invoices: () => req('/api/invoices'),
  payInvoice: (id) => req(`/api/invoices/${id}/pay`, { method: 'POST' }),
  failInvoice: (id) => req(`/api/invoices/${id}/fail`, { method: 'POST' }),
  sweep: () => req('/api/sweep', { method: 'POST' }),
  dunning: () => req('/api/dunning'),
  saveDunningTemplate: (step, b) => req(`/api/dunning/templates/${step}`, { method: 'PUT', body: b }),
  events: () => req('/api/events'),
  portal: (token) => req(`/api/portal/${token}`),
  settings: () => req('/api/settings'),
  saveSettings: (b) => req('/api/settings', { method: 'PUT', body: b })
};

export function fmtMoney(cents, currency = 'usd') {
  const sym = currency === 'usd' ? '$' : currency.toUpperCase() + ' ';
  const neg = cents < 0 ? '-' : '';
  return neg + sym + (Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
