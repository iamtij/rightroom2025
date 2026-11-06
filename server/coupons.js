export function priceCoupon(db, input) {
  const code = String(input.code || "").trim().toUpperCase();
  const product = db.prepare("SELECT * FROM ticket_products WHERE code = ? AND active = 1").get(input.productCode);
  if (!product) return { error: "Unknown ticket", status: 400 };
  const installment = input.paymentPlan === "installment";
  const schedule = installment
    ? db.prepare("SELECT sequence, kind, due_on, days_after, amount_cents FROM installment_plan_items WHERE product_id = ? ORDER BY sequence").all(product.id)
    : [{ sequence: 1, kind: "full", due_on: input.registeredOn || null, amount_cents: product.full_price_cents }];
  if (installment && (!product.allows_installment || schedule.length === 0)) {
    return { error: "This ticket is paid in full", status: 400 };
  }
  const listCents = schedule.reduce((sum, item) => sum + item.amount_cents, 0);
  const base = {
    code: "",
    couponId: null,
    label: "",
    discountCents: 0,
    currency: product.currency,
    listCents,
    totalCents: listCents,
    dueTodayCents: schedule[0].amount_cents,
    amounts: schedule,
  };
  if (!code) return base;
  if (installment) return { error: "Coupons apply to full payment only.", status: 400 };

  const coupon = db.prepare("SELECT * FROM coupons WHERE code = ?").get(code);
  if (!coupon || !coupon.active) return { error: "That coupon code isn't valid.", status: 400 };
  if (coupon.expires_on && input.today > coupon.expires_on) return { error: "That coupon has expired.", status: 400 };
  if (coupon.usage_limit != null && coupon.usage_count >= coupon.usage_limit) return { error: "That coupon has been used up.", status: 400 };
  if (coupon.ticket_code && coupon.ticket_code !== product.code) return { error: "That coupon isn't for this ticket.", status: 400 };
  const email = String(input.email || "").trim().toLowerCase();
  if (coupon.email && coupon.email !== email) return { error: "That coupon isn't for this email.", status: 400 };
  if (coupon.discount_type === "fixed" && coupon.currency && coupon.currency !== product.currency) {
    return { error: "That coupon isn't for this currency.", status: 400 };
  }

  const raw = coupon.discount_type === "percent"
    ? Math.round((listCents * coupon.discount_value) / 100)
    : coupon.discount_value * 100;
  const discountCents = Math.min(listCents, Math.max(0, raw));
  const amounts = schedule.map((item) => ({ ...item }));
  let remaining = discountCents;
  for (let index = amounts.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const cut = Math.min(amounts[index].amount_cents, remaining);
    amounts[index].amount_cents -= cut;
    remaining -= cut;
  }
  const later = amounts.slice(1).filter((item) => item.amount_cents > 0);
  const laterEach = later.length > 0 && later.every((item) => item.amount_cents === later[0].amount_cents) ? later[0].amount_cents : null;
  return {
    code: coupon.code,
    couponId: coupon.id,
    label: coupon.discount_type === "percent" ? `${coupon.discount_value}% off` : "Amount off",
    discountCents,
    currency: product.currency,
    listCents,
    totalCents: listCents - discountCents,
    dueTodayCents: amounts[0].amount_cents,
    laterCount: later.length,
    laterEachCents: laterEach,
    laterCents: later.reduce((sum, item) => sum + item.amount_cents, 0),
    amounts,
  };
}

export function claimCoupon(db, input) {
  const priced = priceCoupon(db, input);
  if (priced.error || !priced.couponId) return priced;
  const updated = db.prepare(`
    UPDATE coupons
    SET usage_count = usage_count + 1
    WHERE id = ? AND active = 1 AND (usage_limit IS NULL OR usage_count < usage_limit)
  `).run(priced.couponId);
  if (updated.changes !== 1) return { error: "That coupon has been used up.", status: 400 };
  return priced;
}

export function presentCoupon(priced) {
  return {
    code: priced.code,
    label: priced.label,
    discountCents: priced.discountCents,
    currency: priced.currency,
    listCents: priced.listCents,
    totalCents: priced.totalCents,
    dueTodayCents: priced.dueTodayCents,
    laterCount: priced.laterCount || 0,
    laterEachCents: priced.laterEachCents ?? null,
    laterCents: priced.laterCents || 0,
  };
}
