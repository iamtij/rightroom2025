import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { fileURLToPath } from "url";
import { seedPaymentChannels } from "./payment-channels.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ticket_products (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  audience TEXT NOT NULL CHECK (audience IN ('local', 'international')),
  currency TEXT NOT NULL CHECK (currency IN ('PHP', 'USD')),
  full_price_cents INTEGER NOT NULL,
  installment_total_cents INTEGER,
  sales_start TEXT NOT NULL,
  sales_end TEXT NOT NULL,
  allows_installment INTEGER NOT NULL DEFAULT 0 CHECK (allows_installment IN (0, 1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE TABLE IF NOT EXISTS installment_plan_items (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES ticket_products(id),
  sequence INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('on_registration', 'fixed_date', 'days_after')),
  due_on TEXT,
  days_after INTEGER,
  amount_cents INTEGER NOT NULL,
  UNIQUE (product_id, sequence)
);

CREATE TABLE IF NOT EXISTS registrations (
  id INTEGER PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  product_id INTEGER NOT NULL REFERENCES ticket_products(id),
  payment_plan TEXT NOT NULL CHECK (payment_plan IN ('full', 'installment')),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  mobile TEXT NOT NULL,
  phone_key TEXT,
  amount_due_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending', 'confirmed', 'cancelled')),
  registered_on TEXT NOT NULL,
  attendee_type TEXT NOT NULL DEFAULT 'guest',
  business TEXT,
  industry TEXT,
  chapter TEXT,
  invited_by TEXT,
  coupon_code TEXT,
  plan_status TEXT NOT NULL DEFAULT 'active',
  resume_token TEXT,
  qr_token TEXT UNIQUE,
  fully_paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  totp_secret TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0 CHECK (totp_enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id TEXT PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES admin_users(id),
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS registration_installments (
  id INTEGER PRIMARY KEY,
  registration_id INTEGER NOT NULL REFERENCES registrations(id),
  sequence INTEGER NOT NULL,
  kind TEXT NOT NULL,
  due_on TEXT NOT NULL,
  days_after INTEGER,
  amount_cents INTEGER NOT NULL,
  amount_paid_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'due' CHECK (status IN ('due', 'paid', 'waived')),
  paid_at TEXT,
  UNIQUE (registration_id, sequence)
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  registration_id INTEGER NOT NULL REFERENCES registrations(id),
  installment_id INTEGER REFERENCES registration_installments(id),
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  method TEXT,
  external_reference TEXT,
  admin_user_id INTEGER,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS upay_payments (
  id INTEGER PRIMARY KEY,
  registration_id INTEGER NOT NULL REFERENCES registrations(id),
  installment_id INTEGER NOT NULL REFERENCES registration_installments(id),
  sender_ref_id TEXT NOT NULL UNIQUE,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  payment_method TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'failed')),
  unionbank_code TEXT,
  unionbank_state TEXT,
  transaction_id TEXT,
  transaction_uuid TEXT,
  qr TEXT,
  payment_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reminder_rules (
  id INTEGER PRIMARY KEY,
  trigger TEXT NOT NULL CHECK (trigger IN ('before_due', 'fully_paid')),
  channel TEXT NOT NULL CHECK (channel IN ('email', 'sms')),
  days_before INTEGER,
  send_time TEXT NOT NULL DEFAULT '09:00',
  template_key TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  UNIQUE (trigger, channel, days_before)
);

CREATE TABLE IF NOT EXISTS reminder_dispatches (
  id INTEGER PRIMARY KEY,
  dispatch_key TEXT NOT NULL UNIQUE,
  registration_id INTEGER NOT NULL REFERENCES registrations(id),
  installment_id INTEGER REFERENCES registration_installments(id),
  rule_id INTEGER NOT NULL REFERENCES reminder_rules(id),
  channel TEXT NOT NULL,
  template_key TEXT NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT,
  body TEXT NOT NULL,
  html TEXT,
  includes_qr INTEGER NOT NULL DEFAULT 0 CHECK (includes_qr IN (0, 1)),
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  provider_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_installments_due ON registration_installments(status, due_on);
CREATE INDEX IF NOT EXISTS idx_dispatches_registration ON reminder_dispatches(registration_id);

CREATE TABLE IF NOT EXISTS coupons (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  discount_type TEXT NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
  discount_value INTEGER NOT NULL,
  currency TEXT,
  ticket_code TEXT,
  email TEXT,
  usage_limit INTEGER,
  usage_count INTEGER NOT NULL DEFAULT 0,
  expires_on TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS message_templates (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'sms')),
  subject TEXT,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS message_schedules (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  template_id INTEGER NOT NULL REFERENCES message_templates(id),
  trigger TEXT NOT NULL CHECK (trigger IN ('before_due', 'on_date', 'after_registration')),
  days_offset INTEGER NOT NULL DEFAULT 0,
  start_on TEXT,
  send_time TEXT NOT NULL DEFAULT '09:00',
  frequency TEXT NOT NULL CHECK (frequency IN ('once', 'daily', 'weekly')),
  ends_on TEXT,
  ends_after INTEGER,
  audience TEXT NOT NULL DEFAULT 'unpaid' CHECK (audience IN ('unpaid', 'all', 'fully_paid')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS schedule_sends (
  id INTEGER PRIMARY KEY,
  send_key TEXT NOT NULL UNIQUE,
  schedule_id INTEGER NOT NULL REFERENCES message_schedules(id),
  registration_id INTEGER NOT NULL REFERENCES registrations(id),
  sent_on TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  mobile TEXT NOT NULL,
  phone_key TEXT,
  chapter TEXT,
  category TEXT,
  business_name TEXT,
  ticket_type TEXT,
  reg_status TEXT NOT NULL DEFAULT 'updated' CHECK (reg_status IN ('updated', 'delayed', 'cancelled')),
  country TEXT,
  gold_club INTEGER NOT NULL DEFAULT 0 CHECK (gold_club IN (0, 1)),
  registered_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS member_otps (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_member_otps_email ON member_otps(email);

CREATE TABLE IF NOT EXISTS registration_otps (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_registration_otps_email ON registration_otps(email);

CREATE TABLE IF NOT EXISTS chapters (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chapters_name ON chapters(lower(name));

CREATE TABLE IF NOT EXISTS payment_channels (
  code TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1))
);

CREATE TABLE IF NOT EXISTS hitpay_payments (
  id INTEGER PRIMARY KEY,
  registration_id INTEGER NOT NULL REFERENCES registrations(id),
  installment_id INTEGER NOT NULL REFERENCES registration_installments(id),
  session_id TEXT NOT NULL UNIQUE,
  gateway_ref TEXT,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('qr', 'online')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'failed', 'expired')),
  gateway_status TEXT,
  qr_code TEXT,
  payment_url TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hitpay_gateway ON hitpay_payments(gateway_ref) WHERE gateway_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hitpay_installment ON hitpay_payments(installment_id, channel, status);

CREATE TABLE IF NOT EXISTS admin_audit (
  id INTEGER PRIMARY KEY,
  admin_id INTEGER,
  action TEXT NOT NULL,
  target TEXT,
  amount_cents INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pass_scans (
  id INTEGER PRIMARY KEY,
  registration_id INTEGER NOT NULL REFERENCES registrations(id),
  result TEXT NOT NULL CHECK (result IN ('admitted', 'override')),
  admin_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pass_scans_registration ON pass_scans(registration_id, result);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_external ON payments(external_reference) WHERE external_reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS rate_hits (
  id INTEGER PRIMARY KEY,
  bucket TEXT NOT NULL,
  ip TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_hits ON rate_hits(bucket, ip, at);

CREATE TABLE IF NOT EXISTS form_challenges (
  token TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS security_events (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_security_events ON security_events(kind, created_at);
`;

const PRODUCTS = [
  {
    code: "first_mover",
    name: "First Mover",
    audience: "local",
    currency: "PHP",
    fullPrice: 1_200_000,
    installmentTotal: 1_300_000,
    salesStart: "2026-11-11",
    salesEnd: "2026-11-30",
    allowsInstallment: 1,
    plan: [
      ["on_registration", null, 100_000],
      ["fixed_date", "2026-12-15", 200_000],
      ["fixed_date", "2027-01-15", 200_000],
      ["fixed_date", "2027-02-15", 200_000],
      ["fixed_date", "2027-03-15", 200_000],
      ["fixed_date", "2027-04-15", 200_000],
      ["fixed_date", "2027-05-15", 200_000],
    ],
  },
  {
    code: "early_bird",
    name: "Early Bird",
    audience: "local",
    currency: "PHP",
    fullPrice: 1_500_000,
    installmentTotal: 1_600_000,
    salesStart: "2026-12-01",
    salesEnd: "2027-01-31",
    allowsInstallment: 1,
    plan: [
      ["on_registration", null, 400_000],
      ["fixed_date", "2027-02-15", 300_000],
      ["fixed_date", "2027-03-15", 300_000],
      ["fixed_date", "2027-04-15", 300_000],
      ["fixed_date", "2027-05-15", 300_000],
    ],
  },
  {
    code: "regular",
    name: "Regular",
    audience: "local",
    currency: "PHP",
    fullPrice: 1_800_000,
    installmentTotal: null,
    salesStart: "2027-02-01",
    salesEnd: "2027-05-31",
    allowsInstallment: 0,
    plan: [],
  },
  {
    code: "intl_early_bird",
    name: "International Early Bird",
    audience: "international",
    currency: "USD",
    fullPrice: 25_000,
    installmentTotal: null,
    salesStart: "2027-01-01",
    salesEnd: "2027-03-31",
    allowsInstallment: 0,
    plan: [],
  },
  {
    code: "intl_regular",
    name: "International Regular",
    audience: "international",
    currency: "USD",
    fullPrice: 35_000,
    installmentTotal: null,
    salesStart: "2027-04-01",
    salesEnd: "2027-06-16",
    allowsInstallment: 0,
    plan: [],
  },
];

const EMAIL_BEFORE = [7, 3, 1, 0];
const SMS_BEFORE = [3, 1, 0];

export function openDatabase(file = process.env.IBMC_DB_PATH) {
  const volume = process.env.RAILWAY_VOLUME_MOUNT_PATH;
  const dbPath = file || (volume ? path.join(volume, "ibmc.sqlite") : path.join(root, "data", "ibmc.sqlite"));
  if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  if (dbPath !== ":memory:") db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  migrate(db);
  seed(db);
  if (testRegistrationEnabled()) {
    ensureTestPayment(db);
    ensureTestInstallment(db);
  }
  return db;
}

export function testTicketEnabled() {
  return String(process.env.ALLOW_TEST_TICKET || "").trim().toLowerCase() === "true";
}

export function testRegistrationEnabled() {
  return String(process.env.ALLOW_TEST_REGISTRATION || "").trim().toLowerCase() === "true";
}

function phoneKey(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
}

function backfillPhoneKeys(db) {
  const members = db.prepare("SELECT id, mobile FROM members WHERE phone_key IS NULL").all();
  const updateMember = db.prepare("UPDATE members SET phone_key = ? WHERE id = ?");
  for (const row of members) updateMember.run(phoneKey(row.mobile), row.id);
  const registrations = db.prepare("SELECT id, mobile FROM registrations WHERE phone_key IS NULL").all();
  const updateRegistration = db.prepare("UPDATE registrations SET phone_key = ? WHERE id = ?");
  for (const row of registrations) updateRegistration.run(phoneKey(row.mobile), row.id);
}

function migrate(db) {
  migrateInstallmentDays(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_audit (
      id INTEGER PRIMARY KEY,
      admin_id INTEGER,
      action TEXT NOT NULL,
      target TEXT,
      amount_cents INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  const paymentColumns = new Set(db.prepare("PRAGMA table_info(payments)").all().map((column) => column.name));
  if (!paymentColumns.has("admin_user_id")) {
    db.exec("ALTER TABLE payments ADD COLUMN admin_user_id INTEGER");
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_sessions (
      id TEXT PRIMARY KEY,
      admin_id INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS pass_scans (
      id INTEGER PRIMARY KEY,
      registration_id INTEGER NOT NULL REFERENCES registrations(id),
      result TEXT NOT NULL CHECK (result IN ('admitted', 'override')),
      admin_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_pass_scans_registration ON pass_scans(registration_id, result);
  `);
  const adminColumns = new Set(db.prepare("PRAGMA table_info(admin_users)").all().map((column) => column.name));
  if (!adminColumns.has("totp_secret")) db.exec("ALTER TABLE admin_users ADD COLUMN totp_secret TEXT");
  if (!adminColumns.has("totp_enabled")) db.exec("ALTER TABLE admin_users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0");
  const registrationColumns = new Set(db.prepare("PRAGMA table_info(registrations)").all().map((column) => column.name));
  if (!registrationColumns.has("phone_key")) db.exec("ALTER TABLE registrations ADD COLUMN phone_key TEXT");
  const memberColumns = new Set(db.prepare("PRAGMA table_info(members)").all().map((column) => column.name));
  if (!memberColumns.has("phone_key")) db.exec("ALTER TABLE members ADD COLUMN phone_key TEXT");
  backfillPhoneKeys(db);
  db.exec("CREATE INDEX IF NOT EXISTS idx_members_phone ON members(phone_key)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_registrations_phone ON registrations(phone_key)");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_external ON payments(external_reference) WHERE external_reference IS NOT NULL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS rate_hits (
      id INTEGER PRIMARY KEY,
      bucket TEXT NOT NULL,
      ip TEXT NOT NULL,
      at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rate_hits ON rate_hits(bucket, ip, at);
    CREATE TABLE IF NOT EXISTS form_challenges (
      token TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS security_events (
      id INTEGER PRIMARY KEY,
      kind TEXT NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_security_events ON security_events(kind, created_at);
  `);
  if (testTicketEnabled()) ensureTestTicket(db);
  const names = new Set(db.prepare("PRAGMA table_info(registrations)").all().map((column) => column.name));
  const columns = [
    ["attendee_type", "TEXT NOT NULL DEFAULT 'guest'"],
    ["business", "TEXT"],
    ["industry", "TEXT"],
    ["chapter", "TEXT"],
    ["invited_by", "TEXT"],
    ["coupon_code", "TEXT"],
    ["plan_status", "TEXT NOT NULL DEFAULT 'active'"],
    ["resume_token", "TEXT"],
  ];
  for (const [name, type] of columns) {
    if (!names.has(name)) db.exec(`ALTER TABLE registrations ADD COLUMN ${name} ${type}`);
  }
  seedPaymentChannels(db);
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_registrations_resume ON registrations(resume_token) WHERE resume_token IS NOT NULL");
}

function ensureTestTicket(db) {
  const existing = db.prepare("SELECT id FROM ticket_products WHERE code = 'test'").get();
  if (existing) return;
  db.prepare(`
    INSERT INTO ticket_products (
      code, name, audience, currency, full_price_cents, installment_total_cents,
      sales_start, sales_end, allows_installment
    ) VALUES ('test', 'Test', 'local', 'PHP', 1000, NULL, '2026-01-01', '2027-05-31', 0)
  `).run();
}

function migrateInstallmentDays(db) {
  const planSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'installment_plan_items'").get()?.sql || "";
  if (!planSql.includes("days_after")) {
    db.pragma("foreign_keys = OFF");
    try {
    db.exec(`
      CREATE TABLE installment_plan_items_next (
        id INTEGER PRIMARY KEY,
        product_id INTEGER NOT NULL REFERENCES ticket_products(id),
        sequence INTEGER NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('on_registration', 'fixed_date', 'days_after')),
        due_on TEXT,
        days_after INTEGER,
        amount_cents INTEGER NOT NULL,
        UNIQUE (product_id, sequence)
      );
      INSERT INTO installment_plan_items_next (id, product_id, sequence, kind, due_on, amount_cents)
        SELECT id, product_id, sequence, kind, due_on, amount_cents FROM installment_plan_items;
      DROP TABLE installment_plan_items;
      ALTER TABLE installment_plan_items_next RENAME TO installment_plan_items;
    `);
    } finally {
      db.pragma("foreign_keys = ON");
    }
  }
  const installmentColumns = new Set(db.prepare("PRAGMA table_info(registration_installments)").all().map((column) => column.name));
  if (!installmentColumns.has("days_after")) {
    db.exec("ALTER TABLE registration_installments ADD COLUMN days_after INTEGER");
  }
}

function ensureTestInstallment(db) {
  let product = db.prepare("SELECT id FROM ticket_products WHERE code = 'test_200'").get();
  if (!product) {
    const result = db.prepare(`
      INSERT INTO ticket_products (
        code, name, audience, currency, full_price_cents, installment_total_cents,
        sales_start, sales_end, allows_installment
      ) VALUES ('test_200', 'Test Installment', 'local', 'PHP', 20000, 20000, '2026-01-01', '2027-05-31', 1)
    `).run();
    product = { id: result.lastInsertRowid };
  } else {
    db.prepare(`
      UPDATE ticket_products
      SET name = 'Test Installment',
          full_price_cents = 20000,
          installment_total_cents = 20000,
          allows_installment = 1,
          active = 1,
          sales_start = '2026-01-01',
          sales_end = '2027-05-31'
      WHERE id = ?
    `).run(product.id);
  }
  const count = db.prepare("SELECT COUNT(*) AS count FROM installment_plan_items WHERE product_id = ?").get(product.id).count;
  if (count === 3) return;
  const replace = db.transaction(() => {
    db.prepare("DELETE FROM installment_plan_items WHERE product_id = ?").run(product.id);
    const insert = db.prepare(`
      INSERT INTO installment_plan_items (product_id, sequence, kind, due_on, days_after, amount_cents)
      VALUES (?, ?, ?, NULL, ?, ?)
    `);
    insert.run(product.id, 1, "on_registration", null, 10_000);
    insert.run(product.id, 2, "days_after", 2, 5_000);
    insert.run(product.id, 3, "days_after", 3, 5_000);
  });
  replace();
}

function ensureTestPayment(db) {
  const existing = db.prepare("SELECT id FROM ticket_products WHERE code = 'test_50'").get();
  if (existing) return;
  db.prepare(`
    INSERT INTO ticket_products (
      code, name, audience, currency, full_price_cents, installment_total_cents,
      sales_start, sales_end, allows_installment
    ) VALUES ('test_50', 'Test Payment', 'local', 'PHP', 5000, NULL, '2026-01-01', '2027-05-31', 0)
  `).run();
}

function seed(db) {
  const count = db.prepare("SELECT COUNT(*) AS count FROM ticket_products").get().count;
  if (count > 0) return;

  const insertProduct = db.prepare(`
    INSERT INTO ticket_products (
      code, name, audience, currency, full_price_cents, installment_total_cents,
      sales_start, sales_end, allows_installment
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertItem = db.prepare(`
    INSERT INTO installment_plan_items (product_id, sequence, kind, due_on, amount_cents)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertRule = db.prepare(`
    INSERT INTO reminder_rules (trigger, channel, days_before, send_time, template_key, enabled)
    VALUES (?, ?, ?, '09:00', ?, 1)
  `);

  const seedAll = db.transaction(() => {
    for (const product of PRODUCTS) {
      const result = insertProduct.run(
        product.code,
        product.name,
        product.audience,
        product.currency,
        product.fullPrice,
        product.installmentTotal,
        product.salesStart,
        product.salesEnd,
        product.allowsInstallment,
      );
      product.plan.forEach(([kind, dueOn, amount], index) => {
        insertItem.run(result.lastInsertRowid, index + 1, kind, dueOn, amount);
      });
    }
    for (const days of EMAIL_BEFORE) {
      insertRule.run("before_due", "email", days, "installment_reminder");
    }
    for (const days of SMS_BEFORE) {
      insertRule.run("before_due", "sms", days, "installment_reminder");
    }
    insertRule.run("fully_paid", "email", null, "entry_pass");
    insertRule.run("fully_paid", "sms", null, "entry_pass");
  });
  seedAll();
}

export function registrationBalance(db, registrationId) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(amount_cents - amount_paid_cents), 0) AS balance
    FROM registration_installments
    WHERE registration_id = ? AND status != 'waived'
  `).get(registrationId);
  return row.balance;
}
