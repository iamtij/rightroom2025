import "dotenv/config";
import express from "express";
import { randomBytes } from "crypto";
import { openDatabase, testTicketEnabled } from "./db.js";
import {
  assessStagingEarlyPayments,
  stagingTestRegistrationAllowed,
} from "./staging-early-payments.js";
import { beginMfaSetup, clearSessionCookie, cookieValue, readMfaSetup, readSession, revokeSession, seedAdmin, sessionCookie, signSession, verifyPassword, verifyTotp } from "./auth.js";
import { admitPass, cancelRegistration, compRegistration, createRegistration, discardUnopenedRegistration, ensureResumeToken, entryPassEligible, findRegistrationByContact, getEntryPass, getRegistration, recordPayment, resumeTokenMatches, updateBadge, updateRegistration } from "./registrations.js";
import { sendEntryPassForRegistration } from "./reminders.js";
import { dashboardStats } from "./dashboard.js";
import { importChapters, listChapters, parseChapterCsv, saveChapter } from "./chapters.js";
import { listMembers, lookupMember, memberContactClash, memberFromProof, memberPreview, parseMemberCsv, saveMember, toPublicMember, updateMemberProfile, updateMemberRecord } from "./members.js";
import { presentCoupon, priceCoupon } from "./coupons.js";
import { parseLookupContact } from "./contact.js";
import { maskEmail, readMemberEditToken, sendMemberOtp, sendRegistrationOtp, verifyMemberOtp, verifyRegistrationOtp } from "./otp.js";
import { rateLimit } from "./limits.js";
import { formatLongDate, manilaParts } from "./time.js";
import { handleUpayCallback, refreshUpayPayment, startUpayPayment } from "./upay.js";
import { handleHitpayWebhook, refreshHitpayPayment, refreshHitpayQr, startHitpayPayment } from "./hitpay.js";
import { handlePaynamicsNotification, paynamicsCheckoutChannel, paynamicsPublicCheckoutInfo, refreshPaynamicsPayment, startPaynamicsPayment } from "./paynamics.js";
import { buyerPaymentChannels, hitpayConfigured, listPaymentChannels, paynamicsConfigured, savePaymentChannels } from "./payment-channels.js";
import { entryQrPng } from "./templates.js";
import { recordSecurityEvent } from "./alerts.js";

let database;

function db() {
  if (!database) {
    database = openDatabase();
    seedAdmin(database);
  }
  return database;
}

function channelLabel(value) {
  const labels = {
    paymaya_ph: "Maya",
    grabpay_ph: "GrabPay",
    bpi_online: "BPI",
    ubp_online: "UnionBank Online",
    br_landbank_ph: "Landbank",
    gc: "GCash",
    qr: "QR Ph",
    online: "Online banking",
    instapay: "InstaPay",
    paygate: "Other banks",
    "UB Online": "UnionBank Online",
  };
  const key = String(value || "").trim();
  return labels[key] || key.replaceAll("_", " ");
}

function registrationTransactions(database, registrationId) {
  const ledger = database.prepare(`
    SELECT amount_cents, method, external_reference, recorded_at
    FROM payments WHERE registration_id = ? ORDER BY id
  `).all(registrationId);
  const recorded = new Set(ledger.map((item) => item.external_reference).filter(Boolean));
  const rows = [];
  for (const item of database.prepare(`
    SELECT request_id, amount_cents, status, gateway_response_code, gateway_message, payment_channel, created_at, updated_at
    FROM paynamics_payments WHERE registration_id = ? ORDER BY id
  `).all(registrationId)) {
    rows.push({
      at: item.updated_at || item.created_at,
      provider: "Paynamics",
      channel: channelLabel(item.payment_channel),
      status: item.status,
      amountCents: item.amount_cents,
      reference: item.request_id,
      gateway: [item.gateway_response_code, item.gateway_message].filter(Boolean).join(" · "),
      recorded: recorded.has(item.request_id),
    });
  }
  for (const item of database.prepare(`
    SELECT session_id, gateway_ref, amount_cents, channel, status, gateway_status, created_at, updated_at
    FROM hitpay_payments WHERE registration_id = ? ORDER BY id
  `).all(registrationId)) {
    rows.push({
      at: item.updated_at || item.created_at,
      provider: "HitPay",
      channel: channelLabel(item.channel),
      status: item.status,
      amountCents: item.amount_cents,
      reference: item.gateway_ref || item.session_id,
      gateway: item.gateway_status || "",
      recorded: recorded.has(item.session_id),
    });
  }
  for (const item of database.prepare(`
    SELECT sender_ref_id, amount_cents, payment_method, status, unionbank_code, unionbank_state, transaction_id, created_at, updated_at
    FROM upay_payments WHERE registration_id = ? ORDER BY id
  `).all(registrationId)) {
    rows.push({
      at: item.updated_at || item.created_at,
      provider: "U Pay",
      channel: channelLabel(item.payment_method),
      status: item.status,
      amountCents: item.amount_cents,
      reference: item.transaction_id || item.sender_ref_id,
      gateway: [item.unionbank_code, item.unionbank_state].filter(Boolean).join(" · "),
      recorded: recorded.has(item.sender_ref_id),
    });
  }
  for (const item of ledger) {
    if (item.external_reference && rows.some((row) => row.reference === item.external_reference)) continue;
    rows.push({
      at: item.recorded_at,
      provider: "Recorded",
      channel: channelLabel(item.method),
      status: "paid",
      amountCents: item.amount_cents,
      reference: item.external_reference || "",
      gateway: "",
      recorded: true,
    });
  }
  return rows;
}

function present(registration, options = {}) {
  const contact = options.contact !== false;
  let opened = false;
  const payments = registration.installments.map((item) => {
    let status = "upcoming";
    if (item.status === "paid") status = "paid";
    else if (!opened) {
      status = "due";
      opened = true;
    }
    const slot = item.kind === "on_registration" || item.kind === "full";
    const dayLabel = item.kind === "days_after" && item.days_after
      ? `${formatLongDate(item.due_on)} · day ${item.days_after}`
      : "";
    return {
      id: item.id,
      label: dayLabel || (slot ? "Today · secure your seat" : formatLongDate(item.due_on)),
      dueOn: item.due_on,
      amountCents: item.amount_cents,
      amountPaidCents: item.amount_paid_cents,
      status,
    };
  });
  return {
    reference: registration.reference,
    attendee: {
      fullName: contact ? registration.full_name : "",
      email: contact ? registration.email : "",
      mobile: contact ? registration.mobile : "",
      business: contact ? registration.business || "" : "",
      industry: contact ? registration.industry || "" : "",
      chapter: contact ? registration.chapter || "" : "",
      type: registration.attendee_type,
    },
    tierName: registration.product_name,
    plan: registration.payment_plan,
    currency: registration.currency,
    totalCents: registration.amount_due_cents,
    balanceCents: registration.balance_cents,
    status: registration.status,
    planStatus: registration.status === "cancelled" ? "cancelled" : registration.balance_cents === 0 ? "fully_paid" : registration.plan_status || "active",
    qrReady: entryPassEligible(registration),
    registeredOn: registration.registered_on,
    payments,
    ...(options.transactions ? { transactions: options.transactions } : {}),
    ...(options.resume && registration.resume_token ? { resumeToken: registration.resume_token } : {}),
    ...(options.resume && entryPassEligible(registration) ? { qrToken: registration.qr_token } : {}),
  };
}

function readCoupon(body) {
  const code = String(body.code || "").trim().toUpperCase();
  const discountType = body.discountType === "fixed" ? "fixed" : "percent";
  const discountValue = Number(body.discountValue);
  if (!code || !Number.isFinite(discountValue) || discountValue <= 0) return { error: "Add a code and a discount" };
  if (discountType === "percent" && discountValue > 100) return { error: "Percent discount cannot pass 100" };
  return {
    code,
    discountType,
    discountValue: Math.round(discountValue),
    currency: body.currency || null,
    ticketCode: body.ticketCode || null,
    email: body.email ? String(body.email).trim().toLowerCase() : null,
    usageLimit: body.usageLimit ? Number(body.usageLimit) : null,
    expiresOn: body.expiresOn || null,
  };
}

function readTemplate(body) {
  const channel = body.channel === "sms" ? "sms" : "email";
  const name = String(body.name || "").trim();
  const message = String(body.body || "").trim();
  const subject = String(body.subject || "").trim();
  if (!name || !message) return { error: "Add a name and a message" };
  if (channel === "email" && !subject) return { error: "Email templates need a subject" };
  return { name, channel, subject: channel === "email" ? subject : null, body: message };
}

function readSchedule(database, body) {
  const template = database.prepare("SELECT id FROM message_templates WHERE id = ?").get(Number(body.templateId));
  if (!template) return { error: "Choose a template" };
  const name = String(body.name || "").trim();
  if (!name) return { error: "Add a schedule name" };
  return {
    name,
    templateId: template.id,
    trigger: ["before_due", "on_date", "after_registration"].includes(body.trigger) ? body.trigger : "before_due",
    frequency: ["once", "daily", "weekly"].includes(body.frequency) ? body.frequency : "once",
    audience: ["unpaid", "all", "fully_paid"].includes(body.audience) ? body.audience : "unpaid",
    daysOffset: Number(body.daysOffset) || 0,
    startOn: body.startOn || null,
    sendTime: body.sendTime || "09:00",
    endsOn: body.endsOn || null,
    endsAfter: body.endsAfter ? Number(body.endsAfter) : null,
    enabled: body.enabled === false ? 0 : 1,
  };
}

const scheduleQuery = `
  SELECT s.*, t.name AS template_name, t.channel
  FROM message_schedules s
  JOIN message_templates t ON t.id = s.template_id
`;

function clientError(error, fallback) {
  const message = String(error?.message || "");
  console.error(message);
  if (message.includes("UNIQUE")) return "That already exists";
  const safe = [
    "Unknown ticket",
    "is not on sale",
    "This ticket is paid in full",
    "This ticket has no installment schedule",
    "Add a code",
    "Percent discount",
    "Add a name",
    "Email templates",
    "Choose a template",
    "Add a schedule",
    "Registration is not payable",
    "No installment is due",
    "Payment does not match",
    "Nothing is due",
    "That coupon",
    "That email is already",
    "That mobile number is already",
    "for your badge",
    "Add your name, business",
  ];
  return safe.find((item) => message.includes(item)) ? message : fallback;
}

function requireAdmin(req, res, next) {
  const token = cookieValue(req.headers.cookie, "ibmc_admin");
  const session = readSession(db(), token);
  const admin = session && db().prepare("SELECT id, email FROM admin_users WHERE id = ?").get(session.id);
  if (!admin) {
    res.status(401).json({ error: "Sign in required" });
    return;
  }
  req.admin = admin;
  next();
}

function writeAudit(database, adminId, action, target, amountCents = null) {
  database.prepare(`
    INSERT INTO admin_audit (admin_id, action, target, amount_cents)
    VALUES (?, ?, ?, ?)
  `).run(adminId, action, target, amountCents);
}

function resumeCredential(req) {
  return req.get("x-resume-token") || cookieValue(req.headers.cookie, "ibmc_resume");
}

function resumeCookie(token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `ibmc_resume=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secure}`;
}

function attachResume(res, registration) {
  if (registration?.resume_token) res.append("Set-Cookie", resumeCookie(registration.resume_token));
}

export function createApi() {
  const app = express();
  const router = express.Router();
  app.set("trust proxy", 1);
  app.use((_req, res, next) => {
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
    next();
  });
  app.use((req, res, next) => {
    const url = req.originalUrl || req.url || "";
    if (url.includes("/payments/upay/callback") || url.includes("/webhooks/hitpay") || url.includes("/webhooks/paynamics")) return next();
    express.json({ limit: "2mb" })(req, res, next);
  });
  const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 8, bucket: "login", db });
  const registerLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, bucket: "register", db });
  const lookupLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, bucket: "lookup", db });
  const memberLookupLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, bucket: "member-lookup", db });
  const otpLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 8, bucket: "otp", db });
  const passLimit = rateLimit({ windowMs: 60 * 1000, max: 120, bucket: "pass", db });

  router.get("/chapters", (_req, res) => {
    res.json(listChapters(db()));
  });

  router.get("/payment-channels", (_req, res) => {
    res.json({
      channels: buyerPaymentChannels(db()),
      paynamics: paynamicsPublicCheckoutInfo(),
    });
  });

  router.get("/registration-options", (_req, res) => {
    const siteKey = String(process.env.TURNSTILE_SITE_KEY || "").trim();
    const secret = String(process.env.TURNSTILE_SECRET_KEY || "").trim();
    const stagingEarly = assessStagingEarlyPayments();
    res.json({
      tests: stagingTestRegistrationAllowed(),
      testTicket: testTicketEnabled(),
      stagingEarlyPayments: { enabled: stagingEarly.allowed, reason: stagingEarly.reason },
      turnstileConfigured: Boolean(siteKey && secret),
      turnstileSiteKey: siteKey && secret ? siteKey : "",
    });
  });

  router.get("/challenge", (_req, res) => {
    const token = randomBytes(24).toString("base64url");
    db().prepare("INSERT INTO form_challenges (token, expires_at) VALUES (?, ?)").run(token, Date.now() + 15 * 60 * 1000);
    res.json({ token });
  });

  async function rejectBot(req, res) {
    if (String(req.body?.companyWebsite || "").trim()) {
      res.status(400).json({ error: "Registration was not saved" });
      return true;
    }
    const token = String(req.body?.challenge || "");
    const row = token ? db().prepare("SELECT expires_at FROM form_challenges WHERE token = ?").get(token) : null;
    if (!row || row.expires_at < Date.now()) {
      res.status(400).json({ error: "Refresh the page and try again.", code: "form_challenge_invalid" });
      return true;
    }
    db().prepare("DELETE FROM form_challenges WHERE token = ?").run(token);
    const secret = String(process.env.TURNSTILE_SECRET_KEY || "").trim();
    if (secret) {
      const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret, response: String(req.body?.turnstileToken || ""), remoteip: req.ip }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!payload.success) {
        res.status(400).json({ error: "Confirm you are a person and try again.", code: "turnstile_rejected" });
        return true;
      }
    }
    return false;
  }

  router.get("/members/lookup", memberLookupLimit, (_req, res) => {
    res.json({ ok: true });
  });

  router.post("/members/preview", memberLookupLimit, (req, res) => {
    const contact = parseLookupContact(req.body?.query || req.body?.email);
    if (contact.error) {
      res.status(contact.status || 400).json({ error: contact.error });
      return;
    }
    const preview = memberPreview(db(), contact.value);
    if (!preview) {
      res.json({ ok: true, found: false });
      return;
    }
    res.json({
      ok: true,
      found: true,
      firstName: preview.firstName,
      chapter: preview.chapter,
      maskedEmail: maskEmail(preview.email),
    });
  });

  router.post("/members/otp", otpLimit, async (req, res) => {
    const result = await sendMemberOtp(db(), req.body?.query || req.body?.email);
    if (result.error) {
      if (result.status !== 404 && result.status !== 400) console.error("Member code was not sent");
      res.status(result.status || 400).json({ error: result.error });
      return;
    }
    if (result.waited) {
      res.json({ ok: true, maskedEmail: result.maskedEmail, waited: true });
      return;
    }
    res.json({ ok: true, maskedEmail: result.maskedEmail });
  });

  router.post("/members/otp/verify", otpLimit, (req, res) => {
    const result = verifyMemberOtp(db(), req.body?.query || req.body?.email, req.body?.code);
    if (result.error) {
      res.status(400).json({ error: "That code is wrong." });
      return;
    }
    const member = lookupMember(db(), result.email);
    if (!member) {
      res.status(400).json({ error: "That code is wrong." });
      return;
    }
    const email = String(member.email || "").trim().toLowerCase();
    const byEmail = email ? findRegistrationByContact(db(), email) : null;
    const emailOwned = byEmail
      && byEmail.status === "confirmed"
      && String(byEmail.email || "").trim().toLowerCase() === email
      ? byEmail
      : null;
    const byMobile = member.mobile ? findRegistrationByContact(db(), member.mobile) : null;
    const mobileOwned = byMobile && byMobile.status === "confirmed" ? byMobile : null;
    const owned = emailOwned || mobileOwned;
    const registered = Boolean(owned);
    const { id, ...visible } = member;
    const body = {
      ok: true,
      editToken: result.editToken,
      member: { ...visible, registered, memberToken: toPublicMember(member, registered).memberToken },
    };
    if (owned) {
      const registration = ensureResumeToken(db(), owned);
      attachResume(res, registration);
      body.registration = present(registration, { resume: true });
    }
    res.json(body);
  });

  router.post("/members/details", otpLimit, (req, res) => {
    const email = readMemberEditToken(req.body?.editToken);
    if (!email) {
      res.status(401).json({ error: "Confirm your code again before saving." });
      return;
    }
    const result = updateMemberProfile(db(), email, req.body || {});
    if (result.error) {
      res.status(result.status || 400).json({ error: result.error });
      return;
    }
    res.json(result.member);
  });

  router.post("/coupons/quote", lookupLimit, (req, res) => {
    const body = req.body || {};
    const priced = priceCoupon(db(), {
      code: body.code,
      productCode: body.productCode,
      paymentPlan: body.paymentPlan,
      email: body.email,
      today: manilaParts().date,
    });
    if (priced.error) {
      res.status(priced.status || 400).json({ error: priced.error });
      return;
    }
    if (!priced.code) {
      res.status(400).json({ error: "That coupon code isn't valid." });
      return;
    }
    if (priced.totalCents === 0) {
      res.status(400).json({ error: "That coupon can't cover the full ticket." });
      return;
    }
    res.json(presentCoupon(priced));
  });

  function createPublicRegistration(body) {
    const today = manilaParts().date;
    const testProduct = body.productCode === "test" || body.productCode === "test_50" || body.productCode === "test_100" || body.productCode === "test_200";
    if (testProduct && !(body.productCode === "test" ? testTicketEnabled() : stagingTestRegistrationAllowed())) {
      const error = new Error("Unknown ticket");
      error.status = 400;
      throw error;
    }
    const product = db().prepare("SELECT * FROM ticket_products WHERE code = ? AND active = 1").get(body.productCode);
    if (!product) {
      const error = new Error("Unknown ticket");
      error.status = 400;
      throw error;
    }
    if (today < product.sales_start || today > product.sales_end) {
      const error = new Error(`${product.name} is not on sale today`);
      error.status = 400;
      throw error;
    }
    if (
      body.productCode !== "test"
      && body.productCode !== "test_50"
      && body.productCode !== "test_100"
      && body.productCode !== "test_200"
      && body.attendeeType === "guest"
      && today < "2027-02-01"
    ) {
      const error = new Error("Guest registration opens February 1, 2027");
      error.status = 400;
      throw error;
    }
    const proved = memberFromProof(db(), body.memberToken);
    if (proved) {
      const ready = lookupMember(db(), proved.email);
      if (!ready?.profileReady) {
        const error = new Error("Add your name, business, industry, chapter, email, and mobile number.");
        error.status = 400;
        throw error;
      }
    }
    return createRegistration(db(), {
      productCode: body.productCode,
      paymentPlan: body.paymentPlan,
      fullName: body.fullName || proved?.full_name || "",
      email: proved?.email || body.email || "",
      mobile: proved?.mobile || body.mobile || "",
      registeredOn: today,
      attendeeType: body.attendeeType,
      business: body.business || proved?.business_name,
      industry: body.industry || proved?.category,
      chapter: body.chapter || proved?.chapter,
      invitedBy: body.invitedBy,
      couponCode: body.couponCode,
    });
  }

  function sendHitpay(res, result, created) {
    if (result.resume) attachResume(res, result.registration);
    const body = {
      error: result.error,
      registration: result.registration ? present(result.registration, { contact: result.contact !== false, resume: result.resume === true }) : undefined,
      hitpay: result.hitpay || undefined,
    };
    if (result.error) {
      res.status(result.status || 502).json(body);
      return;
    }
    res.status(created ? 201 : 200).json(body);
  }

  function sendPaynamics(res, result, created) {
    if (result.resume) attachResume(res, result.registration);
    const body = {
      error: result.error,
      registration: result.registration ? present(result.registration, { contact: result.contact !== false, resume: result.resume === true }) : undefined,
      paynamics: result.paynamics || undefined,
    };
    if (result.error) {
      res.status(result.status || 502).json(body);
      return;
    }
    res.status(created ? 201 : 200).json(body);
  }

  function sendUpay(res, result, created) {
    if (result.error) {
      res.status(result.status || 502).json({
        error: result.error,
        registration: result.registration ? present(result.registration, { contact: result.contact !== false, resume: result.resume === true }) : undefined,
        upay: result.upay || undefined,
      });
      return;
    }
    if (result.resume) attachResume(res, result.registration);
    res.status(created ? 201 : 200).json({
      registration: present(result.registration, { contact: result.contact !== false, resume: result.resume === true }),
      upay: result.upay,
    });
  }

  function hostedCheckoutStarted(result) {
    if (!result || result.error) return false;
    if (result.paynamics) return Boolean(result.paynamics.paymentUrl);
    if (result.hitpay) return Boolean(result.hitpay.sessionId);
    if (result.upay) return Boolean(result.upay.senderRefId);
    return false;
  }

  function finishNewCheckout(res, send, registration, result) {
    if (hostedCheckoutStarted(result)) {
      send(res, { ...result, resume: true }, true);
      return;
    }
    discardUnopenedRegistration(db(), registration.id);
    send(res, { ...result, registration: undefined, resume: false, error: result.error || "Payment did not start. Nothing was saved." }, true);
  }

  function ownerAccess(registration, token) {
    const allowed = resumeTokenMatches(registration, token);
    return { contact: allowed, resume: allowed };
  }

  router.post("/registrations", registerLimit, async (req, res) => {
    if (await rejectBot(req, res)) return;
    try {
      const registration = createPublicRegistration(req.body || {});
      attachResume(res, registration);
      res.status(201).json(present(registration, { resume: true }));
    } catch (error) {
      res.status(error.status || 400).json({ error: clientError(error, "Registration was not saved") });
    }
  });

  router.post("/registrations/upay", registerLimit, async (req, res) => {
    if (await rejectBot(req, res)) return;
    let registration;
    try {
      registration = createPublicRegistration(req.body || {});
      const result = await startUpayPayment(db(), registration, req.body?.paymentMethod);
      finishNewCheckout(res, sendUpay, registration, result);
    } catch (error) {
      if (registration) discardUnopenedRegistration(db(), registration.id);
      res.status(error.status || 400).json({ error: clientError(error, "Registration was not saved") });
    }
  });

  router.post("/registrations/hitpay", registerLimit, async (req, res) => {
    if (await rejectBot(req, res)) return;
    const channel = req.body?.channel === "online" ? "online" : req.body?.channel === "qr" ? "qr" : "";
    if (!channel) {
      res.status(400).json({ error: "Choose a payment option." });
      return;
    }
    let registration;
    try {
      registration = createPublicRegistration(req.body || {});
      const result = await startHitpayPayment(db(), registration, channel);
      finishNewCheckout(res, sendHitpay, registration, result);
    } catch (error) {
      if (registration) discardUnopenedRegistration(db(), registration.id);
      res.status(error.status || 400).json({ error: clientError(error, "Registration was not saved") });
    }
  });

  router.post("/registrations/:reference/hitpay", registerLimit, async (req, res) => {
    const channel = req.body?.channel === "online" ? "online" : req.body?.channel === "qr" ? "qr" : "";
    if (!channel) {
      res.status(400).json({ error: "Choose a payment option." });
      return;
    }
    const row = db().prepare("SELECT id FROM registrations WHERE reference = ?").get(req.params.reference);
    if (!row) {
      res.status(404).json({ error: "Registration not found" });
      return;
    }
    const registration = getRegistration(db(), row.id);
    if (!registration || registration.status !== "confirmed") {
      res.status(400).json({ error: "Registration is not payable" });
      return;
    }
    const result = await startHitpayPayment(db(), registration, channel);
    sendHitpay(res, { ...result, ...ownerAccess(registration, resumeCredential(req)) }, false);
  });

  router.post("/registrations/:reference/upay", registerLimit, async (req, res) => {
    const row = db().prepare("SELECT id FROM registrations WHERE reference = ?").get(req.params.reference);
    if (!row) {
      res.status(404).json({ error: "Registration not found" });
      return;
    }
    const registration = getRegistration(db(), row.id);
    if (!registration || registration.status !== "confirmed") {
      res.status(400).json({ error: "Registration is not payable" });
      return;
    }
    const result = await startUpayPayment(db(), registration, req.body?.paymentMethod);
    sendUpay(res, { ...result, ...ownerAccess(registration, resumeCredential(req)) }, false);
  });

  router.post("/registrations/paynamics", registerLimit, async (req, res) => {
    if (await rejectBot(req, res)) return;
    const selection = paynamicsCheckoutChannel(req.body?.pchannel);
    if (!selection) {
      res.status(400).json({ error: "Choose a Paynamics option." });
      return;
    }
    let registration;
    try {
      registration = createPublicRegistration(req.body || {});
      const result = await startPaynamicsPayment(db(), registration, selection.pchannel);
      finishNewCheckout(res, sendPaynamics, registration, result);
    } catch (error) {
      if (registration) discardUnopenedRegistration(db(), registration.id);
      res.status(error.status || 400).json({ error: clientError(error, "Registration was not saved") });
    }
  });

  router.post("/registrations/:reference/paynamics", registerLimit, async (req, res) => {
    const selection = paynamicsCheckoutChannel(req.body?.pchannel);
    if (!selection) {
      res.status(400).json({ error: "Choose a Paynamics option." });
      return;
    }
    const row = db().prepare("SELECT id FROM registrations WHERE reference = ?").get(req.params.reference);
    if (!row) {
      res.status(404).json({ error: "Registration not found" });
      return;
    }
    const registration = getRegistration(db(), row.id);
    if (!registration || registration.status !== "confirmed") {
      res.status(400).json({ error: "Registration is not payable" });
      return;
    }
    const result = await startPaynamicsPayment(db(), registration, selection.pchannel);
    sendPaynamics(res, { ...result, ...ownerAccess(registration, resumeCredential(req)) }, false);
  });

  const upayPollLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 240, bucket: "upay-poll", db });

  router.get("/payments/upay/:senderRefId", upayPollLimit, async (req, res) => {
    const result = await refreshUpayPayment(db(), req.params.senderRefId);
    if (!result.registration) {
      res.status(result.status || 404).json({ error: result.error || "Payment not found" });
      return;
    }
    res.status(result.status && result.status !== 200 ? result.status : 200).json({
      registration: present(result.registration, ownerAccess(result.registration, resumeCredential(req))),
      upay: result.upay,
      error: result.error,
    });
  });

  const hitpayPollLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 240, bucket: "hitpay-poll", db });
  const hitpayRefreshLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 12, bucket: "hitpay-refresh", db });

  router.get("/payments/hitpay/:sessionId", hitpayPollLimit, async (req, res) => {
    const result = await refreshHitpayPayment(db(), req.params.sessionId);
    if (!result.registration) {
      res.status(result.status || 404).json({ error: result.error || "Payment not found" });
      return;
    }
    res.status(result.status && result.status !== 200 ? result.status : 200).json({
      registration: present(result.registration, ownerAccess(result.registration, resumeCredential(req))),
      hitpay: result.hitpay,
      error: result.error,
    });
  });

  router.post("/payments/hitpay/:sessionId/refresh-qr", hitpayRefreshLimit, async (req, res) => {
    const result = await refreshHitpayQr(db(), req.params.sessionId);
    if (!result.registration) {
      res.status(result.status || 404).json({ error: result.error || "Payment not found" });
      return;
    }
    sendHitpay(res, { ...result, ...ownerAccess(result.registration, resumeCredential(req)) }, false);
  });

  const paynamicsPollLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 240, bucket: "paynamics-poll", db });

  router.get("/payments/paynamics/:requestId", paynamicsPollLimit, async (req, res) => {
    const result = await refreshPaynamicsPayment(db(), req.params.requestId);
    if (!result.registration) {
      res.status(result.status || 404).json({ error: result.error || "Payment not found" });
      return;
    }
    res.status(result.status && result.status !== 200 ? result.status : 200).json({
      registration: present(result.registration, ownerAccess(result.registration, resumeCredential(req))),
      paynamics: result.paynamics,
      error: result.error,
    });
  });

  router.post("/webhooks/hitpay", express.text({ type: "*/*", limit: "1mb" }), async (req, res) => {
    const result = await handleHitpayWebhook(db(), String(req.body || ""), req.get("hitpay-signature"), {
      eventType: req.get("hitpay-event-type"),
      eventObject: req.get("hitpay-event-object"),
    });
    res.status(result.status).json(result.body);
  });

  const paynamicsNotifyLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 120, bucket: "paynamics-notify", db });

  router.post(
    "/webhooks/paynamics",
    paynamicsNotifyLimit,
    express.json({ limit: "1mb" }),
    express.urlencoded({ extended: false, limit: "1mb" }),
    express.text({ type: "*/*", limit: "1mb" }),
    async (req, res) => {
      const payload = req.body && typeof req.body === "object" ? req.body : String(req.body || "");
      const result = await handlePaynamicsNotification(db(), payload);
      recordSecurityEvent(db(), "paynamics.notify", result.status === 200 ? "accepted" : "rejected");
      res.status(result.status).type("text/plain").send(result.body);
    },
  );

  const upayCallbackLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, bucket: "upay-callback", db });

  router.post("/payments/upay/callback", upayCallbackLimit, express.text({ type: "*/*", limit: "2mb" }), async (req, res) => {
    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        body = { payload: body };
      }
    }
    const result = await handleUpayCallback(db(), body);
    recordSecurityEvent(db(), "upay.callback", result.ok ? "accepted" : "rejected");
    res.status(result.status || 200).json({ ok: result.ok });
  });

  router.get("/registrations/lookup", lookupLimit, (_req, res) => {
    res.json({ ok: true });
  });

  router.post("/registrations/otp", otpLimit, async (req, res) => {
    const query = String(req.body?.query || "").trim();
    if (!query) {
      res.status(400).json({ error: "Add your email or mobile number." });
      return;
    }
    const result = await sendRegistrationOtp(db(), query);
    if (result.error) {
      if (result.status !== 404 && result.status !== 400) console.error("Registration code was not sent");
      res.status(result.status || 400).json({ error: result.error });
      return;
    }
    if (result.waited) {
      res.json({ ok: true, maskedEmail: result.maskedEmail, waited: true });
      return;
    }
    res.json({ ok: true, maskedEmail: result.maskedEmail });
  });

  router.post("/registrations/otp/verify", otpLimit, (req, res) => {
    const query = String(req.body?.query || "").trim();
    const result = verifyRegistrationOtp(db(), query, req.body?.code);
    if (result.error) {
      const status = result.status || 400;
      const message = status === 400 ? "That code is wrong." : result.error;
      res.status(status).json({ error: message });
      return;
    }
    const registration = ensureResumeToken(db(), result.registration);
    attachResume(res, registration);
    res.json(present(registration, { resume: true }));
  });

  router.get("/passes/:token/qr", passLimit, async (req, res) => {
    const token = String(req.params.token || "").trim();
    const pass = getEntryPass(db(), token);
    if (!pass) {
      res.status(404).json({ error: "This QR ticket isn't valid." });
      return;
    }
    const site = (process.env.SITE_URL || "https://ibmcph.com").replace(/\/$/, "");
    const png = await entryQrPng(`${site}/pass/${encodeURIComponent(token)}`);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "private, no-store");
    res.send(png);
  });

  router.get("/passes/:token", passLimit, (req, res) => {
    const pass = getEntryPass(db(), req.params.token);
    if (!pass) {
      res.status(404).json({ error: "This QR ticket isn't valid." });
      return;
    }
    res.json(pass);
  });

  router.patch("/registrations/:reference/badge", lookupLimit, (req, res) => {
    const row = db().prepare("SELECT id FROM registrations WHERE reference = ?").get(req.params.reference);
    if (!row) {
      res.status(404).json({ error: "Registration not found" });
      return;
    }
    const registration = getRegistration(db(), row.id);
    if (!resumeTokenMatches(registration, resumeCredential(req))) {
      res.status(401).json({ error: "Sign in again to edit your badge." });
      return;
    }
    if (registration.status !== "confirmed") {
      res.status(400).json({ error: "This registration can't be edited." });
      return;
    }
    try {
      const updated = updateBadge(db(), registration.id, req.body || {});
      attachResume(res, updated);
      res.json(present(updated, { resume: true }));
    } catch (error) {
      res.status(error.status || 400).json({ error: clientError(error, "Badge was not saved") });
    }
  });

  router.get("/registrations/:reference", lookupLimit, (req, res) => {
    const row = db().prepare("SELECT id FROM registrations WHERE reference = ?").get(req.params.reference);
    if (!row) {
      res.status(404).json({ error: "Registration not found" });
      return;
    }
    const registration = getRegistration(db(), row.id);
    const access = ownerAccess(registration, resumeCredential(req));
    if (access.resume) attachResume(res, registration);
    res.json(present(registration, access));
  });

  router.post("/admin/login", loginLimit, (req, res) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const admin = db().prepare("SELECT * FROM admin_users WHERE email = ?").get(email);
    if (!admin || !verifyPassword(password, admin.password_hash)) {
      recordSecurityEvent(db(), "admin.login.fail", "admin login failed");
      res.status(401).json({ error: "Email or password is wrong" });
      return;
    }
    if (!admin.totp_enabled) {
      res.json(beginMfaSetup(db(), admin));
      return;
    }
    if (!verifyTotp(admin.totp_secret, req.body?.code)) {
      res.status(401).json({ mfaRequired: true, error: req.body?.code ? "That code is wrong." : "Enter the code from your authenticator." });
      return;
    }
    res.setHeader("Set-Cookie", sessionCookie(signSession(db(), admin.id)));
    res.json({ email: admin.email });
  });

  router.post("/admin/mfa/confirm", loginLimit, (req, res) => {
    const setup = readMfaSetup(req.body?.setupToken);
    const admin = setup && db().prepare("SELECT * FROM admin_users WHERE id = ?").get(setup.id);
    if (!admin?.totp_secret || !verifyTotp(admin.totp_secret, req.body?.code)) {
      res.status(401).json({ error: "That code is wrong." });
      return;
    }
    db().prepare("UPDATE admin_users SET totp_enabled = 1 WHERE id = ?").run(admin.id);
    res.setHeader("Set-Cookie", sessionCookie(signSession(db(), admin.id)));
    res.json({ email: admin.email });
  });

  router.post("/admin/logout", (req, res) => {
    revokeSession(db(), cookieValue(req.headers.cookie, "ibmc_admin"));
    res.setHeader("Set-Cookie", clearSessionCookie());
    res.json({ ok: true });
  });

  router.get("/admin/me", requireAdmin, (req, res) => {
    res.json({ email: req.admin.email });
  });

  router.get("/admin/payment-channels", requireAdmin, (_req, res) => {
    res.json({
      channels: listPaymentChannels(db()),
      hitpayConfigured: hitpayConfigured(),
      paynamicsConfigured: paynamicsConfigured(),
      paynamics: paynamicsPublicCheckoutInfo(),
    });
  });

  router.patch("/admin/payment-channels", requireAdmin, (req, res) => {
    let channels;
    try {
      channels = savePaymentChannels(db(), req.body || {});
    } catch (error) {
      const status = error.status === 400 ? 400 : 500;
      res.status(status).json({ error: status === 400 ? error.message : "Payment channels were not saved." });
      return;
    }
    writeAudit(db(), req.admin.id, "payment_channel.update", "payment_channels");
    res.json({
      channels,
      hitpayConfigured: hitpayConfigured(),
      paynamicsConfigured: paynamicsConfigured(),
      paynamics: paynamicsPublicCheckoutInfo(),
    });
  });

  router.get("/admin/dashboard", requireAdmin, (_req, res) => {
    res.json(dashboardStats(db()));
  });

  router.get("/admin/registrations", requireAdmin, (req, res) => {
    const rows = db().prepare(`
      SELECT r.id
      FROM registrations r
      ORDER BY r.created_at DESC, r.id DESC
    `).all();
    writeAudit(db(), req.admin.id, "registration.list", "registrations");
    recordSecurityEvent(db(), "registration.list", "registration list");
    res.json(rows.map((row) => {
      const registration = getRegistration(db(), row.id);
      return present(registration, { transactions: registrationTransactions(db(), registration.id) });
    }));
  });

  router.post("/admin/registrations/:reference/payments", requireAdmin, (req, res) => {
    const row = db().prepare("SELECT id FROM registrations WHERE reference = ?").get(req.params.reference);
    if (!row) {
      res.status(404).json({ error: "Registration not found" });
      return;
    }
    const registration = getRegistration(db(), row.id);
    const due = registration.installments.find((item) => item.status === "due");
    if (!due) {
      res.status(400).json({ error: "Nothing is due" });
      return;
    }
    const updated = recordPayment(db(), {
      registrationId: registration.id,
      installmentId: due.id,
      amountCents: due.amount_cents - due.amount_paid_cents,
      method: "admin",
      adminUserId: req.admin.id,
    });
    res.json(present(updated));
  });

  router.post("/admin/registrations/:reference/comp", requireAdmin, (req, res) => {
    const row = db().prepare("SELECT id FROM registrations WHERE reference = ?").get(req.params.reference);
    if (!row) {
      res.status(404).json({ error: "Registration not found" });
      return;
    }
    const admins = db().prepare("SELECT COUNT(*) AS n FROM admin_users").get().n;
    if (admins >= 2) {
      const pending = db().prepare("SELECT id, requested_by FROM comp_requests WHERE reference = ? AND status = 'pending'").get(req.params.reference);
      if (!pending) {
        db().prepare("INSERT INTO comp_requests (reference, requested_by) VALUES (?, ?)").run(req.params.reference, req.admin.id);
        recordSecurityEvent(db(), "registration.comp", `${req.params.reference} requested`);
        res.json({ pending: true, reference: req.params.reference });
        return;
      }
      if (pending.requested_by === req.admin.id) {
        res.status(409).json({ error: "Another admin has to approve this complimentary ticket.", pending: true });
        return;
      }
      db().prepare("UPDATE comp_requests SET status = 'approved' WHERE id = ?").run(pending.id);
    }
    try {
      const updated = compRegistration(db(), row.id, req.admin.id);
      recordSecurityEvent(db(), "registration.comp", req.params.reference);
      res.json(present(updated));
    } catch (error) {
      res.status(error.status || 400).json({ error: clientError(error, "The complimentary ticket was not saved") });
    }
  });

  router.post("/admin/registrations/:reference/resend-entry-pass", requireAdmin, async (req, res) => {
    const row = db().prepare("SELECT id FROM registrations WHERE reference = ?").get(req.params.reference);
    if (!row) {
      res.status(404).json({ error: "Registration not found" });
      return;
    }
    const result = await sendEntryPassForRegistration(db(), row.id, { force: true });
    if (!result.ok) {
      res.status(result.error === "not_fully_paid" ? 400 : 502).json({ error: result.error || "QR ticket email was not sent", ...result });
      return;
    }
    writeAudit(db(), req.admin.id, "registration.entry_pass_resend", req.params.reference);
    res.json({ sent: true, reference: req.params.reference });
  });

  router.post("/admin/passes/check-in", requireAdmin, (req, res) => {
    const raw = String(req.body?.token || "").trim();
    const token = raw.includes("/pass/") ? decodeURIComponent(raw.split("/pass/").pop().split(/[?#]/)[0]) : raw;
    const result = admitPass(db(), token, req.admin.id, req.body?.override === true);
    if (result.error) {
      if (result.status === 409) recordSecurityEvent(db(), "pass.duplicate", result.pass?.reference || "");
      res.status(result.status || 400).json(result);
      return;
    }
    writeAudit(db(), req.admin.id, result.result === "override" ? "pass.override" : "pass.admit", result.reference);
    if (result.result === "override") recordSecurityEvent(db(), "pass.override", result.reference);
    res.json(result);
  });

  router.post("/admin/registrations", requireAdmin, (req, res) => {
    try {
      const body = req.body || {};
      const registration = createRegistration(db(), {
        productCode: body.productCode,
        paymentPlan: body.paymentPlan === "installment" ? "installment" : "full",
        fullName: body.fullName || "",
        email: body.email || "",
        mobile: body.mobile || "",
        registeredOn: manilaParts().date,
        attendeeType: body.attendeeType || "guest",
        business: body.business,
        industry: body.industry,
        chapter: body.chapter,
      });
      res.status(201).json(present(registration));
    } catch (error) {
      res.status(400).json({ error: clientError(error, "Registration was not saved") });
    }
  });

  router.patch("/admin/registrations/:reference", requireAdmin, (req, res) => {
    const row = db().prepare("SELECT id FROM registrations WHERE reference = ?").get(req.params.reference);
    if (!row) {
      res.status(404).json({ error: "Registration not found" });
      return;
    }
    try {
      const updated = updateRegistration(db(), row.id, req.body || {});
      writeAudit(db(), req.admin.id, "registration.update", req.params.reference);
      res.json(present(updated));
    } catch (error) {
      res.status(400).json({ error: clientError(error, "Registration was not saved") });
    }
  });

  router.post("/admin/registrations/:reference/cancel", requireAdmin, (req, res) => {
    const row = db().prepare("SELECT id FROM registrations WHERE reference = ?").get(req.params.reference);
    if (!row) {
      res.status(404).json({ error: "Registration not found" });
      return;
    }
    const updated = cancelRegistration(db(), row.id);
    writeAudit(db(), req.admin.id, "registration.cancel", req.params.reference);
    res.json(present(updated));
  });

  router.get("/admin/products", requireAdmin, (_req, res) => {
    res.json(db().prepare("SELECT code, name, allows_installment, currency FROM ticket_products WHERE active = 1 ORDER BY sales_start").all());
  });

  router.get("/admin/coupons", requireAdmin, (_req, res) => {
    res.json(db().prepare("SELECT * FROM coupons ORDER BY id DESC").all());
  });

  router.post("/admin/coupons", requireAdmin, (req, res) => {
    const coupon = readCoupon(req.body || {});
    if (coupon.error) {
      res.status(400).json({ error: coupon.error });
      return;
    }
    try {
      const result = db().prepare(`
        INSERT INTO coupons (code, discount_type, discount_value, currency, ticket_code, email, usage_limit, expires_on)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(coupon.code, coupon.discountType, coupon.discountValue, coupon.currency, coupon.ticketCode, coupon.email, coupon.usageLimit, coupon.expiresOn);
      writeAudit(db(), req.admin.id, "coupon.create", coupon.code);
      res.status(201).json(db().prepare("SELECT * FROM coupons WHERE id = ?").get(result.lastInsertRowid));
    } catch (error) {
      res.status(400).json({ error: clientError(error, "Coupon was not saved") });
    }
  });

  router.patch("/admin/coupons/:id", requireAdmin, (req, res) => {
    const existing = db().prepare("SELECT id FROM coupons WHERE id = ?").get(req.params.id);
    if (!existing) {
      res.status(404).json({ error: "Coupon not found" });
      return;
    }
    const coupon = readCoupon(req.body || {});
    if (coupon.error) {
      res.status(400).json({ error: coupon.error });
      return;
    }
    try {
      db().prepare(`
        UPDATE coupons
        SET code = ?, discount_type = ?, discount_value = ?, currency = ?, ticket_code = ?, email = ?, usage_limit = ?, expires_on = ?
        WHERE id = ?
      `).run(coupon.code, coupon.discountType, coupon.discountValue, coupon.currency, coupon.ticketCode, coupon.email, coupon.usageLimit, coupon.expiresOn, existing.id);
      writeAudit(db(), req.admin.id, "coupon.update", coupon.code);
      res.json(db().prepare("SELECT * FROM coupons WHERE id = ?").get(existing.id));
    } catch (error) {
      res.status(400).json({ error: clientError(error, "Coupon was not saved") });
    }
  });

  router.get("/admin/templates", requireAdmin, (_req, res) => {
    res.json(db().prepare("SELECT * FROM message_templates ORDER BY id DESC").all());
  });

  router.post("/admin/templates", requireAdmin, (req, res) => {
    const template = readTemplate(req.body || {});
    if (template.error) {
      res.status(400).json({ error: template.error });
      return;
    }
    const result = db().prepare(`
      INSERT INTO message_templates (name, channel, subject, body) VALUES (?, ?, ?, ?)
    `).run(template.name, template.channel, template.subject, template.body);
    res.status(201).json(db().prepare("SELECT * FROM message_templates WHERE id = ?").get(result.lastInsertRowid));
  });

  router.patch("/admin/templates/:id", requireAdmin, (req, res) => {
    const existing = db().prepare("SELECT id FROM message_templates WHERE id = ?").get(req.params.id);
    if (!existing) {
      res.status(404).json({ error: "Template not found" });
      return;
    }
    const template = readTemplate(req.body || {});
    if (template.error) {
      res.status(400).json({ error: template.error });
      return;
    }
    db().prepare(`
      UPDATE message_templates SET name = ?, channel = ?, subject = ?, body = ? WHERE id = ?
    `).run(template.name, template.channel, template.subject, template.body, existing.id);
    res.json(db().prepare("SELECT * FROM message_templates WHERE id = ?").get(existing.id));
  });

  router.get("/admin/schedules", requireAdmin, (_req, res) => {
    res.json(db().prepare(`${scheduleQuery} ORDER BY s.id DESC`).all());
  });

  router.post("/admin/schedules", requireAdmin, (req, res) => {
    const schedule = readSchedule(db(), req.body || {});
    if (schedule.error) {
      res.status(400).json({ error: schedule.error });
      return;
    }
    const result = db().prepare(`
      INSERT INTO message_schedules (
        name, template_id, trigger, days_offset, start_on, send_time, frequency, ends_on, ends_after, audience, enabled
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(schedule.name, schedule.templateId, schedule.trigger, schedule.daysOffset, schedule.startOn, schedule.sendTime, schedule.frequency, schedule.endsOn, schedule.endsAfter, schedule.audience, schedule.enabled);
    res.status(201).json(db().prepare(`${scheduleQuery} WHERE s.id = ?`).get(result.lastInsertRowid));
  });

  router.patch("/admin/schedules/:id", requireAdmin, (req, res) => {
    const existing = db().prepare("SELECT id FROM message_schedules WHERE id = ?").get(req.params.id);
    if (!existing) {
      res.status(404).json({ error: "Schedule not found" });
      return;
    }
    const schedule = readSchedule(db(), req.body || {});
    if (schedule.error) {
      res.status(400).json({ error: schedule.error });
      return;
    }
    db().prepare(`
      UPDATE message_schedules
      SET name = ?, template_id = ?, trigger = ?, days_offset = ?, start_on = ?, send_time = ?, frequency = ?, ends_on = ?, ends_after = ?, audience = ?, enabled = ?
      WHERE id = ?
    `).run(schedule.name, schedule.templateId, schedule.trigger, schedule.daysOffset, schedule.startOn, schedule.sendTime, schedule.frequency, schedule.endsOn, schedule.endsAfter, schedule.audience, schedule.enabled, existing.id);
    res.json(db().prepare(`${scheduleQuery} WHERE s.id = ?`).get(existing.id));
  });

  router.get("/admin/chapters", requireAdmin, (_req, res) => {
    res.json(listChapters(db()));
  });

  router.post("/admin/chapters", requireAdmin, (req, res) => {
    const result = saveChapter(db(), req.body || {});
    if (result.error) {
      res.status(result.status || 400).json({ error: result.error });
      return;
    }
    res.status(201).json(result.chapter);
  });

  router.patch("/admin/chapters/:id", requireAdmin, (req, res) => {
    const result = saveChapter(db(), { ...req.body, id: req.params.id });
    if (result.error) {
      res.status(result.status || 400).json({ error: result.error });
      return;
    }
    res.json(result.chapter);
  });

  router.post("/admin/chapters/upload", requireAdmin, (req, res) => {
    const names = parseChapterCsv(req.body?.csv || "");
    if (names.length === 0) {
      res.status(400).json({ error: "No chapters found. Use one chapter name per line." });
      return;
    }
    const saved = importChapters(db(), names);
    writeAudit(db(), req.admin.id, "chapter.import", String(saved));
    res.json({ saved, chapters: listChapters(db()) });
  });

  router.get("/admin/members", requireAdmin, (req, res) => {
    writeAudit(db(), req.admin.id, "member.list", "members");
    recordSecurityEvent(db(), "member.list", "member list");
    res.json(listMembers(db()));
  });

  router.post("/admin/members", requireAdmin, (req, res) => {
    const body = req.body || {};
    if (!body.fullName || !body.email || !body.mobile) {
      res.status(400).json({ error: "Name, email, and mobile are required" });
      return;
    }
    const clash = memberContactClash(db(), { email: body.email, mobile: body.mobile });
    if (clash) {
      res.status(400).json({ error: clash });
      return;
    }
    saveMember(db(), body);
    res.status(201).json(listMembers(db()).find((member) => member.email === String(body.email).trim().toLowerCase()));
  });

  router.post("/admin/members/upload", requireAdmin, (req, res) => {
    const members = parseMemberCsv(req.body?.csv || "");
    if (members.length === 0) {
      res.status(400).json({ error: "No member rows found. Include name, email, and mobile." });
      return;
    }
    const saveAll = db().transaction((rows) => {
      for (const member of rows) saveMember(db(), member);
    });
    saveAll(members);
    writeAudit(db(), req.admin.id, "member.import", String(members.length));
    res.json({ saved: members.length, members: listMembers(db()) });
  });

  router.patch("/admin/members/:id", requireAdmin, (req, res) => {
    const result = updateMemberRecord(db(), req.params.id, req.body || {});
    if (result.error) {
      res.status(result.status || 400).json({ error: result.error });
      return;
    }
    res.json(result.member);
  });

  app.use("/api", router);
  app.use((error, _req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    console.error(error);
    res.status(500).json({ error: "Something went wrong" });
  });
  return app;
}
