export type Currency = "PHP" | "USD";
export type PayPlan = "full" | "installment";

export type ScheduleRow = {
  label: string;
  dueOn: string;
  amountCents: number;
  kind: "on_registration" | "fixed_date" | "days_after";
};

export type Tier = {
  code: string;
  name: string;
  currency: Currency;
  fullCents: number;
  installmentCents: number | null;
  windowLabel: string;
  nextLabel: string;
  onSale: boolean;
  opensLabel: string | null;
  rows: ScheduleRow[];
  saveLabel: string | null;
  installmentSummary: string | null;
  note: string | null;
};

const FIRST_MOVER_ROWS: ScheduleRow[] = [
  { label: "Today · secure your seat", dueOn: "on-registration", amountCents: 100_000, kind: "on_registration" },
  { label: "Dec 15, 2026", dueOn: "2026-12-15", amountCents: 200_000, kind: "fixed_date" },
  { label: "Jan 15, 2027", dueOn: "2027-01-15", amountCents: 200_000, kind: "fixed_date" },
  { label: "Feb 15, 2027", dueOn: "2027-02-15", amountCents: 200_000, kind: "fixed_date" },
  { label: "Mar 15, 2027", dueOn: "2027-03-15", amountCents: 200_000, kind: "fixed_date" },
  { label: "Apr 15, 2027", dueOn: "2027-04-15", amountCents: 200_000, kind: "fixed_date" },
  { label: "May 15, 2027", dueOn: "2027-05-15", amountCents: 200_000, kind: "fixed_date" },
];

const EARLY_BIRD_ROWS: ScheduleRow[] = [
  { label: "Today · secure your seat", dueOn: "on-registration", amountCents: 400_000, kind: "on_registration" },
  { label: "Feb 15, 2027", dueOn: "2027-02-15", amountCents: 300_000, kind: "fixed_date" },
  { label: "Mar 15, 2027", dueOn: "2027-03-15", amountCents: 300_000, kind: "fixed_date" },
  { label: "Apr 15, 2027", dueOn: "2027-04-15", amountCents: 300_000, kind: "fixed_date" },
  { label: "May 15, 2027", dueOn: "2027-05-15", amountCents: 300_000, kind: "fixed_date" },
];

export function manilaDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function addDays(isoDate: string, days: number) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function formatLongDate(isoDate: string) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function formatMonthDate(isoDate: string) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function money(cents: number, currency: Currency) {
  const amount = (cents / 100).toLocaleString(currency === "USD" ? "en-US" : "en-PH", { maximumFractionDigits: 0 });
  return currency === "USD" ? `USD ${amount}` : `₱${amount}`;
}

export function testTier(): Tier {
  return {
    code: "test",
    name: "Test",
    currency: "PHP",
    fullCents: 1_000,
    installmentCents: null,
    windowLabel: "available now",
    nextLabel: "₱10, paid once",
    onSale: true,
    opensLabel: null,
    rows: [],
    saveLabel: "One payment of ₱10.",
    installmentSummary: null,
    note: null,
  };
}

export function testInstallmentTier(): Tier {
  return {
    code: "test_200",
    name: "Test Installment",
    currency: "PHP",
    fullCents: 20_000,
    installmentCents: 20_000,
    windowLabel: "available now",
    nextLabel: "₱200 in full, or ₱100 when you pay, then ₱50 twice.",
    onSale: true,
    opensLabel: null,
    rows: [
      { label: "Day 0 · when you pay", dueOn: "on-registration", amountCents: 10_000, kind: "on_registration" },
      { label: "Day 2 · after you pay", dueOn: "+2", amountCents: 5_000, kind: "days_after" },
      { label: "Day 3 · after you pay", dueOn: "+3", amountCents: 5_000, kind: "days_after" },
    ],
    saveLabel: "One payment of ₱200.",
    installmentSummary: "₱100 when you pay, then ₱50 on day 2 and ₱50 on day 3.",
    note: "Dates start the day your first payment is received.",
  };
}

export function test100PaymentTier(): Tier {
  return {
    code: "test_100",
    name: "Staging test · ₱100",
    currency: "PHP",
    fullCents: 10_000,
    installmentCents: null,
    windowLabel: "staging only",
    nextLabel: "₱100 full payment. For Paynamics staging checkout.",
    onSale: true,
    opensLabel: null,
    rows: [],
    saveLabel: "One payment of ₱100.",
    installmentSummary: null,
    note: null,
  };
}

export function testPaymentTier(): Tier {
  return {
    code: "test_50",
    name: "Test Payment",
    currency: "PHP",
    fullCents: 5_000,
    installmentCents: null,
    windowLabel: "today",
    nextLabel: "₱50 test charge. Payment is open.",
    onSale: true,
    opensLabel: null,
    rows: [],
    saveLabel: "One payment of ₱50.",
    installmentSummary: null,
    note: null,
  };
}

export function tierFor(today: string, international: boolean): Tier | null {
  if (today > "2027-05-31") return null;
  if (international) {
    if (today < "2027-01-01") {
      return {
        code: "intl_early_bird",
        name: "International Early Bird",
        currency: "USD",
        fullCents: 25_000,
        installmentCents: null,
        windowLabel: "Opens January 2027",
        nextLabel: "Then Regular USD 350 from April",
        onSale: false,
        opensLabel: "January 2027",
        rows: [],
        saveLabel: null,
        installmentSummary: null,
        note: null,
      };
    }
    if (today <= "2027-03-31") {
      return {
        code: "intl_early_bird",
        name: "International Early Bird",
        currency: "USD",
        fullCents: 25_000,
        installmentCents: null,
        windowLabel: "January–March 2027",
        nextLabel: "Then Regular USD 350 from April",
        onSale: true,
        opensLabel: null,
        rows: [],
        saveLabel: "Save USD 100 against Regular.",
        installmentSummary: null,
        note: null,
      };
    }
    return {
      code: "intl_regular",
      name: "International Regular",
      currency: "USD",
      fullCents: 35_000,
      installmentCents: null,
      windowLabel: "April–May 31, 2027",
      nextLabel: "Registration closes May 31, 2027",
      onSale: true,
      opensLabel: null,
      rows: [],
      saveLabel: null,
      installmentSummary: null,
      note: null,
    };
  }
  if (today < "2026-11-11") {
    return firstMover("Opens Nov 11", false, "November 11");
  }
  if (today <= "2026-11-30") return firstMover("until Nov 30", true, null);
  if (today <= "2027-01-31") {
    return {
      code: "early_bird",
      name: "Early Bird",
      currency: "PHP",
      fullCents: 1_500_000,
      installmentCents: 1_600_000,
      windowLabel: "until Jan 31",
      nextLabel: "Then Regular ₱18,000 from Feb 1",
      onSale: true,
      opensLabel: null,
      rows: EARLY_BIRD_ROWS,
      saveLabel: "One payment today. Save ₱3,000 against Regular.",
      installmentSummary: "₱4,000 today, then ₱3,000 a month, Feb to May.",
      note: "Phase 2 payments begin in February for all Early Bird registrants.",
    };
  }
  return {
    code: "regular",
    name: "Regular",
    currency: "PHP",
    fullCents: 1_800_000,
    installmentCents: null,
    windowLabel: "until May 31",
    nextLabel: "Registration closes May 31, 2027",
    onSale: true,
    opensLabel: null,
    rows: [],
    saveLabel: "One payment. Regular has no installment plan.",
    installmentSummary: null,
    note: null,
  };
}

function firstMover(windowLabel: string, onSale: boolean, opensLabel: string | null): Tier {
  return {
    code: "first_mover",
    name: "First Mover",
    currency: "PHP",
    fullCents: 1_200_000,
    installmentCents: 1_300_000,
    windowLabel,
    nextLabel: "Then Early Bird ₱15,000 from Dec 1 · Regular ₱18,000 from Feb 1",
    onSale,
    opensLabel,
    rows: FIRST_MOVER_ROWS,
    saveLabel: "One payment today. Save ₱6,000 against Regular.",
    installmentSummary: "₱1,000 today, then ₱2,000 a month, Dec to May.",
    note: null,
  };
}

export const INDUSTRIES = [
  "Accounting & Finance",
  "Construction",
  "Education & Training",
  "Food & Beverage",
  "Health & Wellness",
  "IT & Software",
  "Legal",
  "Marketing & Media",
  "Printing & Signage",
  "Real Estate",
  "Retail",
];

export const SAMPLE_MEMBER = {
  fullName: "Juan Dela Cruz",
  business: "Dela Cruz Printing",
  industry: "Printing & Signage",
  chapter: "[Chapter name]",
  email: "juan@delacruzprinting.ph",
  mobileMasked: "+63 917 ••• 4821",
};

export function findMember(query: string) {
  const value = query.trim().toLowerCase();
  const digits = value.replace(/\D/g, "");
  if (value === SAMPLE_MEMBER.email || (digits.length >= 4 && digits.endsWith("4821"))) return SAMPLE_MEMBER;
  return null;
}
