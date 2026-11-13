import assert from "node:assert/strict";
import { openDatabase } from "./db.js";
import { hitpayRewardPurpose, memberGoldOffer, resolveGoldReward, syncMemberRewards } from "./gold-club.js";
import { saveMember } from "./members.js";
import { createRegistration, getRegistration, recordPayment } from "./registrations.js";

const db = openDatabase(":memory:");
const today = "2026-11-13";

function member(name, email, mobile, year, late) {
  saveMember(db, {
    fullName: name,
    email,
    mobile,
    chapter: "BNI Eagles",
    category: "Care",
    businessName: "Care Co",
    regStatus: "updated",
    country: "Philippines",
    goldClub: true,
    sponsors2026: year,
    sponsorsAugDec2026: late,
    sponsorDataAsOf: "2026-11-12",
    goldReward: late >= 4 ? "GOLD_FREE" : late >= 2 ? "GOLD_50" : year >= 2 ? "GOLD_3000" : "GOLD_NONE",
  });
  return db.prepare("SELECT * FROM members WHERE email = ?").get(email);
}

assert.equal(resolveGoldReward({ gold_club: 1, sponsors_aug_dec_2026: 4, sponsors_2026: 6 }), "GOLD_FREE");
assert.equal(resolveGoldReward({ gold_club: 1, sponsors_aug_dec_2026: 2, sponsors_2026: 7 }), "GOLD_50");
assert.equal(resolveGoldReward({ gold_club: 1, sponsors_aug_dec_2026: 1, sponsors_2026: 2 }), "GOLD_3000");
assert.equal(resolveGoldReward({ gold_club: 1, sponsors_aug_dec_2026: 0, sponsors_2026: 1 }), "GOLD_NONE");
assert.equal(resolveGoldReward({ gold_club: 0, sponsors_aug_dec_2026: 8, sponsors_2026: 8 }), "GOLD_NONE");

const none = member("Ana None", "none@example.com", "09170000001", 1, 0);
const cut = member("Ben Three", "cut@example.com", "09170000002", 2, 1);
const half = member("Cara Half", "half@example.com", "09170000003", 4, 2);
const free = member("Dee Free", "free@example.com", "09170000004", 6, 6);

const offer = memberGoldOffer(db, half);
assert.equal(offer.products.first_mover.full.totalCents, 600_000);
assert.equal(offer.products.first_mover.full.listCents, 1_200_000);
assert.equal(offer.products.first_mover.installment.totalCents, 650_000);
assert.deepEqual(
  offer.products.first_mover.installment.rows.map((row) => row.amountCents),
  [100_000, 200_000, 200_000, 150_000, 0, 0, 0],
);
assert.match(offer.products.first_mover.installment.scheduleNote, /last payment is Feb 15, 2027/);
assert.match(offer.products.first_mover.installment.scheduleNote, /Nothing due Mar, Apr and May/);
assert.equal(offer.products.early_bird.full.totalCents, 750_000);
assert.equal(offer.products.early_bird.installment.totalCents, 800_000);

const cutOffer = memberGoldOffer(db, cut);
assert.equal(cutOffer.products.first_mover.full.totalCents, 900_000);
assert.equal(cutOffer.products.first_mover.installment.totalCents, 1_000_000);
assert.deepEqual(
  cutOffer.products.first_mover.installment.rows.map((row) => row.amountCents),
  [100_000, 200_000, 200_000, 200_000, 200_000, 100_000, 0],
);
assert.equal(cutOffer.products.early_bird.full.totalCents, 1_200_000);
assert.equal(cutOffer.products.early_bird.installment.totalCents, 1_300_000);

const freeOffer = memberGoldOffer(db, free);
assert.equal(freeOffer.products.first_mover.full.totalCents, 0);
assert.equal(freeOffer.products.first_mover.installment.totalCents, 0);
assert.equal(freeOffer.moreForFree, 0);
assert.equal(memberGoldOffer(db, none).code, "GOLD_NONE");

let seat = 0;
function register(person, plan, product = "first_mover", email = "") {
  seat += 1;
  return createRegistration(db, {
    productCode: product,
    paymentPlan: plan,
    fullName: person.full_name,
    email: email || `seat${seat}-${person.email}`,
    mobile: `0918${String(1000000 + seat)}`,
    registeredOn: today,
    attendeeType: "member",
    business: "Care Co",
    industry: "Care",
    chapter: "BNI Eagles",
    member: person,
  });
}

const cases = [
  [cut, "full", "first_mover", 900_000, 1_200_000],
  [cut, "installment", "first_mover", 1_000_000, 1_300_000],
  [half, "full", "first_mover", 600_000, 1_200_000],
  [half, "installment", "first_mover", 650_000, 1_300_000],
  [free, "full", "first_mover", 0, 1_200_000],
  [free, "installment", "first_mover", 0, 1_300_000],
  [none, "full", "first_mover", 1_200_000, 0],
  [none, "installment", "first_mover", 1_300_000, 0],
  [half, "full", "early_bird", 750_000, 1_500_000],
  [half, "installment", "early_bird", 800_000, 1_600_000],
  [cut, "full", "early_bird", 1_200_000, 1_500_000],
  [cut, "installment", "early_bird", 1_300_000, 1_600_000],
];

for (const [person, plan, product, total, list] of cases) {
  const registration = register(person, plan, product);
  assert.equal(registration.amount_due_cents, total, `${person.email} ${product} ${plan}`);
  assert.equal(registration.balance_cents, total, `${person.email} ${product} ${plan} balance`);
  if (list) assert.equal(registration.gold_list_cents, list);
  const owed = registration.installments
    .filter((item) => item.status !== "waived")
    .reduce((sum, item) => sum + item.amount_cents, 0);
  assert.equal(owed, total, `${person.email} ${product} ${plan} schedule`);
}

const freeSeat = register(free, "full");
assert.equal(freeSeat.plan_status, "fully_paid");
assert.ok(freeSeat.qr_token);
assert.equal(freeSeat.installments.every((item) => item.status === "waived"), true);
assert.equal(hitpayRewardPurpose(freeSeat), "IBMC27-FM-GOLD_FREE");

const halfSeat = register(half, "installment");
assert.equal(hitpayRewardPurpose(halfSeat), "IBMC27-FM-GOLD_50");
const covered = halfSeat.installments.filter((item) => item.status === "waived");
assert.equal(covered.length, 3);
const dueReminder = db.prepare(`
  SELECT i.id FROM registration_installments i
  WHERE i.registration_id = ? AND i.status = 'due' AND i.amount_paid_cents < i.amount_cents
`).all(halfSeat.id);
assert.equal(dueReminder.some((row) => covered.some((item) => item.id === row.id)), false);

const paidFull = register(cut, "full", "first_mover", cut.email);
recordPayment(db, { registrationId: paidFull.id, amountCents: 900_000, method: "test" });
db.prepare("UPDATE members SET sponsors_aug_dec_2026 = 4, sponsors_2026 = 6, gold_reward = 'GOLD_FREE' WHERE id = ?").run(cut.id);
syncMemberRewards(db, db.prepare("SELECT * FROM members WHERE id = ?").get(cut.id), "2026-12-01");
const upgraded = getRegistration(db, paidFull.id);
assert.equal(upgraded.gold_reward_at, "GOLD_3000");
assert.equal(upgraded.gold_reward_current, "GOLD_FREE");
assert.equal(upgraded.refund_due, 1);
assert.equal(upgraded.refund_amount_cents, 900_000);
assert.equal(upgraded.balance_cents, 0);

db.prepare("UPDATE members SET sponsors_aug_dec_2026 = 0, sponsors_2026 = 2, gold_reward = 'GOLD_3000' WHERE id = ?").run(cut.id);
syncMemberRewards(db, db.prepare("SELECT * FROM members WHERE id = ?").get(cut.id), "2026-12-02");
assert.equal(getRegistration(db, paidFull.id).gold_reward_current, "GOLD_FREE");

const openHalf = register(half, "installment", "first_mover", half.email);
recordPayment(db, { registrationId: openHalf.id, amountCents: 100_000, method: "test" });
db.prepare("UPDATE members SET sponsors_aug_dec_2026 = 6, gold_reward = 'GOLD_FREE' WHERE id = ?").run(half.id);
syncMemberRewards(db, db.prepare("SELECT * FROM members WHERE id = ?").get(half.id), "2026-12-15");
const freed = getRegistration(db, openHalf.id);
assert.equal(freed.gold_reward_current, "GOLD_FREE");
assert.equal(freed.balance_cents, 0);
assert.equal(freed.refund_amount_cents, 100_000);
assert.ok(freed.qr_token);

console.log("gold club rewards ok");
