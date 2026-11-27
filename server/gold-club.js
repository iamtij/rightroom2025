import { formatLongDate, manilaParts } from "./time.js";

export const GOLD_FINAL_ON = "2027-01-01";
const RANK = { GOLD_NONE: 0, GOLD_3000: 1, GOLD_50: 2, GOLD_FREE: 3 };
const SHORT = { first_mover: "FM", early_bird: "EB", regular: "RG" };

export function resolveGoldReward(member) {
  const gold = Boolean(Number(member?.gold_club ?? member?.goldClub));
  const year = count(member?.sponsors_2026 ?? member?.sponsors2026);
  const late = count(member?.sponsors_aug_dec_2026 ?? member?.sponsorsAugDec2026);
  if (!gold) return "GOLD_NONE";
  if (late >= 4) return "GOLD_FREE";
  if (late >= 2) return "GOLD_50";
  if (year >= 2) return "GOLD_3000";
  return "GOLD_NONE";
}

export function rewardRank(code) {
  return RANK[code] || 0;
}

export function betterReward(next, current) {
  return rewardRank(next) > rewardRank(current || "GOLD_NONE");
}

export function discountFor(listCents, reward, currency) {
  const list = Math.max(0, Number(listCents) || 0);
  if (reward === "GOLD_FREE") return list;
  if (reward === "GOLD_50") return Math.round(list / 2);
  if (reward === "GOLD_3000" && currency === "PHP") return Math.min(list, 300_000);
  return 0;
}

export function applyDiscount(amounts, discountCents) {
  const next = amounts.map((item) => ({
    ...item,
    listAmountCents: item.listAmountCents ?? item.amountCents,
    amountCents: item.amountCents,
  }));
  let remaining = Math.max(0, Number(discountCents) || 0);
  for (let index = next.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const cut = Math.min(next[index].amountCents, remaining);
    next[index].amountCents -= cut;
    remaining -= cut;
  }
  return next;
}

export function pricePlan(items, reward, currency) {
  const normalized = items.map((item) => ({
    kind: item.kind,
    dueOn: item.due_on || item.dueOn || null,
    sequence: item.sequence,
    daysAfter: item.days_after ?? item.daysAfter ?? null,
    listAmountCents: Number(item.amount_cents ?? item.amountCents) || 0,
    amountCents: Number(item.amount_cents ?? item.amountCents) || 0,
  }));
  const listCents = normalized.reduce((sum, item) => sum + item.listAmountCents, 0);
  const discountCents = reward === "GOLD_NONE" ? 0 : discountFor(listCents, reward, currency);
  const rows = applyDiscount(normalized, discountCents).map((item) => ({
    ...item,
    covered: item.amountCents === 0 && item.listAmountCents > 0,
    label: item.kind === "on_registration" || item.kind === "full" ? "Today" : item.dueOn ? formatLongDate(item.dueOn) : "",
  }));
  return {
    listCents,
    discountCents,
    totalCents: listCents - discountCents,
    rows,
    scheduleNote: scheduleNote(rows),
  };
}

export function rewardCopy(reward, member) {
  const year = count(member?.sponsors_2026 ?? member?.sponsors2026);
  const late = count(member?.sponsors_aug_dec_2026 ?? member?.sponsorsAugDec2026);
  const labels = {
    GOLD_FREE: "Free ticket",
    GOLD_50: "50% off",
    GOLD_3000: "₱3,000 off",
    GOLD_NONE: "",
  };
  const shortLabels = {
    GOLD_FREE: "Free",
    GOLD_50: "50%",
    GOLD_3000: "₱3,000",
    GOLD_NONE: "",
  };
  let reason = "";
  if (reward === "GOLD_FREE" || reward === "GOLD_50") reason = `You sponsored ${late} members from Aug to Dec 2026`;
  else if (reward === "GOLD_3000") reason = `You sponsored ${year} members in 2026`;
  return {
    code: reward,
    label: labels[reward] || "",
    shortLabel: shortLabels[reward] || "",
    reason,
    moreForFree: reward === "GOLD_FREE" || reward === "GOLD_NONE" ? 0 : Math.max(0, 4 - late),
    tiers: [
      { code: "GOLD_3000", label: "2 sponsors in 2026 · ₱3,000 off", met: year >= 2, applied: reward === "GOLD_3000", progress: `${Math.min(year, 2)} of 2` },
      { code: "GOLD_50", label: "2 sponsors Aug–Dec · 50% off", met: late >= 2, applied: reward === "GOLD_50", progress: `${Math.min(late, 2)} of 2` },
      { code: "GOLD_FREE", label: "4 sponsors Aug–Dec · free ticket", met: late >= 4, applied: reward === "GOLD_FREE", progress: `${Math.min(late, 4)} of 4` },
    ],
  };
}

export function memberGoldOffer(db, member) {
  const club = Boolean(Number(member?.gold_club));
  const reward = resolveGoldReward(member);
  const copy = rewardCopy(reward, member);
  if (!club) return { club: false, code: "GOLD_NONE", label: "", shortLabel: "", reason: "", moreForFree: 0, tiers: [], products: {} };
  const products = {};
  for (const code of ["first_mover", "early_bird"]) {
    const product = db.prepare("SELECT * FROM ticket_products WHERE code = ?").get(code);
    if (!product) continue;
    const plan = db.prepare("SELECT * FROM installment_plan_items WHERE product_id = ? ORDER BY sequence").all(product.id);
    products[code] = {
      full: pricePlan([{ kind: "full", amount_cents: product.full_price_cents }], reward, product.currency),
      installment: plan.length ? pricePlan(plan, reward, product.currency) : null,
    };
  }
  return { club: true, ...copy, products };
}

export function hitpayRewardPurpose(registration) {
  const reward = String(registration?.gold_reward_current || "");
  if (!reward || reward === "GOLD_NONE") return `IBMC 2027 ${registration.reference}`.slice(0, 255);
  const code = SHORT[registration.product_code] || String(registration.product_code || "TK").slice(0, 6).toUpperCase();
  return `IBMC27-${code}-${reward}`.slice(0, 255);
}

export function scheduleNoteFromInstallments(items) {
  const rows = items.map((item) => ({
    kind: item.kind,
    dueOn: item.due_on || item.dueOn || null,
    amountCents: Number(item.amount_cents ?? item.amountCents) || 0,
    listAmountCents: Number(item.list_amount_cents ?? item.listAmountCents ?? item.amount_cents ?? item.amountCents) || 0,
    covered: item.status === "waived" || ((Number(item.amount_cents ?? item.amountCents) || 0) === 0 && (Number(item.list_amount_cents ?? item.listAmountCents) || 0) > 0),
  }));
  return scheduleNote(rows);
}

export function syncMemberRewards(db, member, today = manilaParts().date) {
  if (!member) return { updated: 0 };
  if (today >= GOLD_FINAL_ON) {
    db.prepare(`
      UPDATE registrations
      SET gold_reward_status = 'final'
      WHERE gold_reward_status = 'provisional' AND status = 'confirmed'
        AND (lower(email) = ? OR (? != '' AND phone_key = ?))
    `).run(emailOf(member), phoneOf(member), phoneOf(member));
    return { updated: 0, finalized: true };
  }
  const next = resolveGoldReward(member);
  const rows = registrationsFor(db, member);
  let updated = 0;
  for (const row of rows) {
    if (row.gold_reward_status === "final") continue;
    const current = row.gold_reward_current || "GOLD_NONE";
    if (!betterReward(next, current)) continue;
    applyUpgrade(db, row.id, next);
    updated += 1;
  }
  return { updated };
}

function applyUpgrade(db, registrationId, nextReward) {
  const registration = db.prepare(`
    SELECT r.*, p.currency, p.code AS product_code
    FROM registrations r
    JOIN ticket_products p ON p.id = r.product_id
    WHERE r.id = ?
  `).get(registrationId);
  const items = db.prepare("SELECT * FROM registration_installments WHERE registration_id = ? ORDER BY sequence").all(registrationId);
  if (!registration || !items.length) return;
  const priced = pricePlan(items.map((item) => ({
    kind: item.kind,
    due_on: item.due_on,
    amount_cents: item.list_amount_cents ?? item.amount_cents,
  })), nextReward, registration.currency);
  const update = db.prepare("UPDATE registration_installments SET amount_cents = ?, status = ? WHERE id = ?");
  priced.rows.forEach((row, index) => {
    const item = items[index];
    if (!item) return;
    let status = "due";
    if (row.amountCents === 0 && item.amount_paid_cents === 0) status = "waived";
    else if (item.amount_paid_cents >= row.amountCents && item.amount_paid_cents > 0) status = "paid";
    else if (row.amountCents === 0) status = "waived";
    update.run(row.amountCents, status, item.id);
  });
  const paid = items.reduce((sum, item) => sum + item.amount_paid_cents, 0);
  const refund = Math.max(0, paid - priced.totalCents);
  db.prepare(`
    UPDATE registrations
    SET amount_due_cents = ?, gold_reward_current = ?, gold_list_cents = ?, gold_discount_cents = ?,
        refund_due = ?, refund_amount_cents = ?
    WHERE id = ?
  `).run(
    priced.totalCents,
    nextReward,
    priced.listCents,
    priced.discountCents,
    refund > 0 ? 1 : 0,
    refund,
    registration.id,
  );
  const balance = db.prepare(`
    SELECT COALESCE(SUM(MAX(0, amount_cents - amount_paid_cents)), 0) AS balance
    FROM registration_installments
    WHERE registration_id = ? AND status != 'waived'
  `).get(registration.id).balance;
  if (balance === 0) {
    db.prepare(`
      UPDATE registrations
      SET qr_token = COALESCE(qr_token, lower(hex(randomblob(16)))),
          fully_paid_at = COALESCE(fully_paid_at, datetime('now')),
          plan_status = 'fully_paid'
      WHERE id = ?
    `).run(registration.id);
  }
}

function registrationsFor(db, member) {
  return db.prepare(`
    SELECT id, gold_reward_current, gold_reward_status
    FROM registrations
    WHERE status = 'confirmed'
      AND (lower(email) = ? OR (? != '' AND phone_key = ?))
  `).all(emailOf(member), phoneOf(member), phoneOf(member));
}

function scheduleNote(rows) {
  const dated = rows.filter((row) => row.kind !== "on_registration" && row.kind !== "full");
  const covered = dated.filter((row) => row.covered || (row.amountCents === 0 && row.listAmountCents > 0));
  const open = dated.filter((row) => row.amountCents > 0);
  if (!covered.length) return "";
  const months = joinList(covered.map((row) => monthShort(row.dueOn)).filter(Boolean));
  if (!open.length) return months ? `Nothing due ${months}.` : "";
  const last = open[open.length - 1];
  return `Your last payment is ${formatLongDate(last.dueOn)}. Nothing due ${months}.`;
}

function joinList(items) {
  if (items.length <= 1) return items[0] || "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function monthShort(iso) {
  if (!iso) return "";
  const [year, month, day] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)));
}

function count(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : 0;
}

function emailOf(member) {
  return String(member.email || "").trim().toLowerCase();
}

function phoneOf(member) {
  return String(member.phone_key || "");
}
