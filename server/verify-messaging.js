import assert from "node:assert/strict";
import { openDatabase } from "./db.js";
import {
  createBlast,
  drainBlast,
  getBlastReport,
  listMessageGroups,
  listMessageTags,
  normalizeTagSlug,
  previewAudience,
  saveMessageGroup,
  setMemberTags,
  setRegistrationTags,
  upsertMessageTag,
  syncAudienceTags,
  syncMemberNotRegisteredTag,
  syncRegistrationAudienceTags,
  tagsForMember,
  tagsForRegistration,
  AUDIENCE_TAGS,
  _testHelpers,
} from "./messaging.js";
import { createRegistration, recordPayment } from "./registrations.js";
import { saveMember } from "./members.js";
import { SEMAPHORE_BULK_MAX_NUMBERS, readSemaphoreSend, semaphoreMobile, sendSms, sendSmsBulk } from "./providers.js";
import { outboundEmailSuppressed, outboundSmsSuppressed } from "./staging-safe.js";

delete process.env.RESEND_API_KEY;
delete process.env.SEMAPHORE_API_KEY;
delete process.env.IBMC_STAGING_SAFE_MODE;
process.env.ALLOW_TEST_REGISTRATION = "true";
process.env.IBMC_STAGING_EARLY_PAYMENTS = "true";
process.env.IBMC_DEPLOYMENT_ENV = "staging";

assert.equal(normalizeTagSlug("Gold Club!"), "gold-club");
assert.equal(normalizeTagSlug("  Delayed Pay  "), "delayed-pay");
assert.equal(semaphoreMobile("0917 123 4567"), "639171234567");
assert.equal(semaphoreMobile("9171234567"), "639171234567");
assert.equal(semaphoreMobile("639171234567"), "639171234567");
assert.equal(semaphoreMobile("123"), null);
assert.equal(SEMAPHORE_BULK_MAX_NUMBERS, 1000);

const helpers = _testHelpers();
assert.equal(helpers.bodyHasPlaceholders("Hi {{first_name}}"), true);
assert.equal(helpers.bodyHasPlaceholders("Hello everyone"), false);

const db = openDatabase(":memory:");

assert.ok(listMessageTags(db).some((tag) => tag.slug === AUDIENCE_TAGS.notRegistered.slug));
const tagA = upsertMessageTag(db, { label: "Gold Club", color: "#D0202E" });
assert.ok(tagA.tag?.id);
const tagB = upsertMessageTag(db, { label: "Delayed" });
assert.ok(tagB.tag?.id);
assert.ok(listMessageTags(db).length >= 5);

saveMember(db, {
  fullName: "Amina Cruz",
  email: "amina@example.com",
  mobile: "09171234567",
  chapter: "Makati",
  ticketType: "First Mover",
  regStatus: "updated",
  registeredAt: "2026-11-01",
});
saveMember(db, {
  fullName: "Ben Reyes",
  email: "ben@example.com",
  mobile: "09181234567",
  chapter: "BGC",
  ticketType: "Early Bird",
  regStatus: "delayed",
  registeredAt: "2026-11-02",
});

const amina = db.prepare("SELECT id FROM members WHERE email = ?").get("amina@example.com");
const ben = db.prepare("SELECT id FROM members WHERE email = ?").get("ben@example.com");
setMemberTags(db, amina.id, [tagA.tag.id]);
setMemberTags(db, ben.id, [tagB.tag.id]);

const reg = createRegistration(db, {
  productCode: "first_mover",
  paymentPlan: "full",
  fullName: "Carla Lim",
  email: "carla@example.com",
  mobile: "09191234567",
  registeredOn: "2026-11-12",
});
setRegistrationTags(db, reg.id, [tagA.tag.id]);

const group = saveMessageGroup(db, {
  name: "Gold outreach",
  sources: "both",
  tagIds: [tagA.tag.id],
});
assert.ok(group.group?.id);
assert.equal(listMessageGroups(db).length, 1);

const emailPreview = previewAudience(db, { channel: "email", groupId: group.group.id });
assert.equal(emailPreview.eligible, 2);
assert.ok(emailPreview.sample.some((row) => row.fullName === "Amina Cruz"));
assert.ok(emailPreview.sample.some((row) => row.fullName === "Carla Lim"));

const smsPreview = previewAudience(db, { channel: "sms", sources: "members", tagIds: [tagB.tag.id] });
assert.equal(smsPreview.eligible, 1);
assert.equal(smsPreview.sample[0].fullName, "Ben Reyes");

const adHocAll = previewAudience(db, { channel: "email", sources: "members", tagIds: [] });
assert.equal(adHocAll.eligible, 2);

const blast = createBlast(db, {
  channel: "email",
  groupId: group.group.id,
  subject: "Hello {{first_name}}",
  body: "Hi {{first_name}}, see you at IBMC.",
});
assert.ok(blast.blast?.id);
assert.equal(blast.blast.status, "queued");

await drainBlast(db, blast.blast.id);
const report = getBlastReport(db, blast.blast.id);
assert.equal(report.blast.status, "completed");
assert.equal(report.blast.sent, 0);
assert.equal(report.blast.skipped, 2);
assert.equal(report.deliveries.length, 2);
assert.ok(report.deliveries.every((row) => row.status === "skipped"));
assert.ok(report.deliveries.every((row) => row.error === "provider_not_configured"));

const smsBlast = createBlast(db, {
  channel: "sms",
  sources: "members",
  tagIds: [tagB.tag.id],
  body: "IBMC reminder for everyone — no placeholders.",
});
assert.ok(smsBlast.blast?.id);
await drainBlast(db, smsBlast.blast.id);
const smsReport = getBlastReport(db, smsBlast.blast.id);
assert.equal(smsReport.blast.status, "completed");
assert.equal(smsReport.deliveries.length, 1);
assert.equal(smsReport.deliveries[0].status, "skipped");
assert.equal(smsReport.deliveries[0].error, "provider_not_configured");

const largePeople = [];
for (let i = 0; i < 50; i += 1) {
  saveMember(db, {
    fullName: `Person ${i}`,
    email: `person${i}@example.com`,
    mobile: `0917${String(1000000 + i).slice(-7)}`,
    chapter: "Test",
    regStatus: "updated",
    registeredAt: "2026-11-01",
  });
  const row = db.prepare("SELECT id FROM members WHERE email = ?").get(`person${i}@example.com`);
  setMemberTags(db, row.id, [tagA.tag.id]);
  largePeople.push(row.id);
}
const needsConfirm = createBlast(db, {
  channel: "email",
  sources: "members",
  tagIds: [tagA.tag.id],
  subject: "Hello",
  body: "Body",
});
assert.equal(needsConfirm.error.includes("SEND"), true);
assert.equal(needsConfirm.requiresConfirm, true);

const confirmed = createBlast(db, {
  channel: "email",
  sources: "members",
  tagIds: [tagA.tag.id],
  subject: "Hello",
  body: "Body",
  confirmText: "SEND",
});
assert.ok(confirmed.blast?.id);
assert.ok(confirmed.blast.total >= 50);

process.env.IBMC_STAGING_SAFE_MODE = "true";
assert.equal(outboundSmsSuppressed(), true);
assert.equal(outboundEmailSuppressed({ deliveryKind: "message_blast" }), true);
const safeSms = await sendSms({ to: "09171234567", message: "hello" });
assert.equal(safeSms.status, "skipped");
assert.equal(safeSms.error, "staging_safe_mode");
const safeBulk = await sendSmsBulk(["09171234567", "09181234567"], "hello bulk");
assert.equal(safeBulk.status, "skipped");
assert.equal(safeBulk.error, "staging_safe_mode");
delete process.env.IBMC_STAGING_SAFE_MODE;

const missingKeyBulk = await sendSmsBulk(["09171234567"], "hello bulk");
assert.equal(missingKeyBulk.status, "skipped");
assert.equal(missingKeyBulk.error, "provider_not_configured");
const rejectedSender = readSemaphoreSend({ ok: true, status: 200 }, { sendername: ["The selected sendername is invalid."] });
assert.equal(rejectedSender.status, "failed");
assert.match(rejectedSender.error, /sendername is invalid/);
const accepted = readSemaphoreSend({ ok: true, status: 200 }, [{ message_id: 42, recipient: "639178430126" }]);
assert.equal(accepted.status, "sent");
assert.equal(accepted.results[0].message_id, 42);

const unpaidMember = saveMember(db, {
  fullName: "Unpaid First",
  email: "first-unpaid@example.com",
  mobile: "09170000111",
  chapter: "Test",
  regStatus: "updated",
  registeredAt: "2026-11-01",
});
syncMemberNotRegisteredTag(db, unpaidMember.id);
assert.ok(tagsForMember(db, unpaidMember.id).some((tag) => tag.slug === AUDIENCE_TAGS.notRegistered.slug));

const installmentReg = createRegistration(db, {
  productCode: "first_mover",
  paymentPlan: "installment",
  fullName: "Installment First",
  email: "first-installment@example.com",
  mobile: "09170000112",
  registeredOn: "2026-11-01",
});
saveMember(db, {
  fullName: "Installment First",
  email: "first-installment@example.com",
  mobile: "09170000112",
  chapter: "Test",
  regStatus: "updated",
  registeredAt: "2026-11-01",
});
syncAudienceTags(db);
assert.equal(tagsForRegistration(db, installmentReg.id).some((tag) => tag.slug === AUDIENCE_TAGS.firstMoverInstallment.slug), false);
recordPayment(db, { registrationId: installmentReg.id, amountCents: 100_000, method: "manual" });
syncRegistrationAudienceTags(db, installmentReg.id);
assert.ok(tagsForRegistration(db, installmentReg.id).some((tag) => tag.slug === AUDIENCE_TAGS.firstMoverInstallment.slug));
const installmentMember = db.prepare("SELECT id FROM members WHERE email = ?").get("first-installment@example.com");
assert.ok(tagsForMember(db, installmentMember.id).some((tag) => tag.slug === AUDIENCE_TAGS.firstMoverInstallment.slug));
assert.equal(tagsForMember(db, installmentMember.id).some((tag) => tag.slug === AUDIENCE_TAGS.notRegistered.slug), false);

const paidReg = createRegistration(db, {
  productCode: "first_mover",
  paymentPlan: "full",
  fullName: "Paid First",
  email: "first-paid@example.com",
  mobile: "09170000113",
  registeredOn: "2026-11-01",
});
saveMember(db, {
  fullName: "Paid First",
  email: "first-paid@example.com",
  mobile: "09170000113",
  chapter: "Test",
  regStatus: "updated",
  registeredAt: "2026-11-01",
});
recordPayment(db, { registrationId: paidReg.id, amountCents: paidReg.amount_due_cents, method: "manual" });
syncRegistrationAudienceTags(db, paidReg.id);
assert.ok(tagsForRegistration(db, paidReg.id).some((tag) => tag.slug === AUDIENCE_TAGS.firstMoverPaid.slug));
assert.equal(tagsForRegistration(db, paidReg.id).some((tag) => tag.slug === AUDIENCE_TAGS.firstMoverInstallment.slug), false);

console.log("verify-messaging: ok");
