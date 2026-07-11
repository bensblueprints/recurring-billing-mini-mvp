// Pure billing math — ALL money is integer cents, rounded exactly once per figure.

// Calendar-aware month arithmetic (Jan 31 + 1mo clamps to Feb 28/29).
function addMonths(ms, n) {
  const d = new Date(ms);
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1,
    d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()));
  const daysInTarget = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, daysInTarget));
  return target.getTime();
}

function periodEnd(startMs, interval) {
  return interval === 'year' ? addMonths(startMs, 12) : addMonths(startMs, 1);
}

// Coupon: percent_off wins if set; amount_off is clamped to the invoice amount.
function applyCoupon(amountCents, coupon) {
  if (!coupon) return { discounted: amountCents, discount: 0 };
  let discount = 0;
  if (coupon.percent_off) discount = Math.round((amountCents * coupon.percent_off) / 100);
  else if (coupon.amount_off_cents) discount = Math.min(amountCents, coupon.amount_off_cents);
  return { discounted: amountCents - discount, discount };
}

// Mid-cycle plan change: credit the unused fraction of the old plan, charge the
// same fraction of the new plan. Fraction is time-based over the real period.
function prorate({ oldAmountCents, newAmountCents, periodStart, periodEnd, nowMs }) {
  const total = periodEnd - periodStart;
  const remaining = Math.max(0, Math.min(total, periodEnd - nowMs));
  const credit = Math.round((oldAmountCents * remaining) / total);
  const charge = Math.round((newAmountCents * remaining) / total);
  return {
    credit_cents: credit,
    charge_cents: charge,
    due_cents: Math.max(0, charge - credit),
    remaining_ms: remaining,
    fraction: remaining / total
  };
}

// Monthly-normalized MRR contribution for one subscription's plan (post-coupon
// when the coupon is 'forever').
function mrrContribution(plan, coupon) {
  let amount = plan.amount_cents;
  if (coupon && coupon.duration === 'forever') amount = applyCoupon(amount, coupon).discounted;
  return plan.interval === 'year' ? Math.round(amount / 12) : amount;
}

function monthKey(ms) {
  return new Date(ms).toISOString().slice(0, 7); // 'YYYY-MM'
}

module.exports = { addMonths, periodEnd, applyCoupon, prorate, mrrContribution, monthKey };
