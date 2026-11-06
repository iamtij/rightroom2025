import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  INDUSTRIES,
  addDays,
  formatLongDate,
  formatMonthDate,
  manilaDate,
  money,
  testInstallmentTier,
  testPaymentTier,
  testTier,
  tierFor,
  type Currency,
  type PayPlan,
  type Tier,
} from "./plans";

type Audience = "member" | "guest" | "international";
type CheckoutPlan = PayPlan | "test";
type Step = "start" | "member" | "guest" | "confirm" | "ticket" | "pay" | "paying" | "done" | "manage";
type UpayMethod = "instapay" | "paygate" | "UB Online";

type UpaySession = {
  senderRefId: string;
  paymentMethod: UpayMethod;
  status: "pending" | "paid" | "failed";
  state: string;
  qrDataUrl: string;
  paymentUrl: string;
  billerName: string;
};

const UPAY_METHODS: { id: UpayMethod; label: string; detail: string }[] = [
  { id: "instapay", label: "InstaPay", detail: "Bank or e-wallet. You get a QR to scan." },
  { id: "UB Online", label: "UnionBank Online", detail: "Pay from a UnionBank account." },
  { id: "paygate", label: "Other banks", detail: "Pay through PCHC Paygate." },
];

type PayChannelCode = "upay" | "hitpay_qr" | "hitpay_online";

type PayChannel = {
  code: PayChannelCode;
  label: string;
  detail: string;
};

type HitpaySession = {
  sessionId: string;
  channel: "qr" | "online";
  status: "pending" | "paid" | "failed" | "expired";
  qrDataUrl: string;
  paymentUrl: string;
  expiresAt: string;
  refreshesLeft: number;
  canRefresh: boolean;
};

function isPayChannel(value: string): value is PayChannelCode {
  return value === "upay" || value === "hitpay_qr" || value === "hitpay_online";
}

function safeHitpayUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return "";
    const host = url.hostname.toLowerCase();
    if (host !== "hit-pay.com" && !host.endsWith(".hit-pay.com")) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function hitpayApiChannel(code: PayChannelCode) {
  if (code === "hitpay_qr") return "qr";
  if (code === "hitpay_online") return "online";
  return "";
}

function payActionLabel(channel: PayChannelCode | "", amount: string, busy: boolean) {
  if (busy) return channel === "upay" || !channel ? "Opening UnionBank" : "Opening payment";
  if (channel === "hitpay_qr") return `Pay with QR · ${amount}`;
  if (channel === "hitpay_online") return `Pay with online banking · ${amount}`;
  return `Pay with UnionBank · ${amount}`;
}

function usePaymentChannels() {
  const [channels, setChannels] = useState<PayChannel[] | null>(null);
  const [channel, setChannel] = useState<PayChannelCode | "">("");
  useEffect(() => {
    let stop = false;
    fetch("/api/payment-channels")
      .then((response) => response.json())
      .then((payload) => {
        if (stop) return;
        const list = (Array.isArray(payload.channels) ? payload.channels : []).filter((item: PayChannel) => item && isPayChannel(String(item.code)));
        setChannels(list);
        setChannel((current) => (current && list.some((item: PayChannel) => item.code === current) ? current : list[0]?.code || ""));
      })
      .catch(() => {
        if (!stop) setChannels([]);
      });
    return () => {
      stop = true;
    };
  }, []);
  return { channels, channel, setChannel };
}

type Attendee = {
  audience: Audience;
  fullName: string;
  business: string;
  industry: string;
  chapter: string;
  email: string;
  mobile: string;
  invitedBy: string;
  international: boolean;
};

type FoundMember = {
  fullName: string;
  business: string;
  industry: string;
  chapter: string;
  email: string;
  mobile: string;
  mobileMasked: string;
  registered?: boolean;
};

type StoredPayment = {
  label: string;
  dueOn: string;
  amountCents: number;
  status: "paid" | "due" | "upcoming";
};

type AppliedCoupon = {
  code: string;
  label: string;
  discountCents: number;
  currency: Currency;
  listCents: number;
  totalCents: number;
  dueTodayCents: number;
  laterCount: number;
  laterEachCents: number | null;
  laterCents: number;
};

type StoredRegistration = {
  reference: string;
  resumeToken?: string;
  attendee: Attendee;
  tierName: string;
  plan: PayPlan;
  currency: Currency;
  totalCents: number;
  payments: StoredPayment[];
  planStatus: "active" | "fully_paid";
  qrToken?: string;
};

const STORAGE_KEY = "ibmc2027-registration";
const RESUME_KEY = "ibmc2027-resume";

function rememberRegistration(record: { reference?: string; resumeToken?: string } | null) {
  if (!record?.reference || record.reference.startsWith("{")) return;
  localStorage.setItem(STORAGE_KEY, record.reference);
  if (record.resumeToken) localStorage.setItem(RESUME_KEY, record.resumeToken);
}

function resumeHeaders(extra: Record<string, string> = {}, token = "") {
  const headers = { ...extra };
  const resume = token || localStorage.getItem(RESUME_KEY) || "";
  if (resume) headers["X-Resume-Token"] = resume;
  return headers;
}
const CALENDAR_URL =
  "https://calendar.google.com/calendar/render?action=TEMPLATE&text=IBMC%202027&dates=20270616/20270618&location=Newport%20Performing%20Arts%20Theater%2C%20Pasay%20City&details=IBMC%202027%20%C2%B7%20June%2016%E2%80%9317";

const inputClass =
  "w-full rounded-[10px] border border-[#D9D5CF] bg-white px-3.5 py-3 text-base font-normal text-[#141416] outline-none focus:border-[#D0202E]";

function MoneyText({ text, className = "" }: { text: string; className?: string }) {
  const parts = text.split(/(₱)/);
  return (
    <span className={className}>
      {parts.map((part, index) =>
        part === "₱" ? (
          <span key={index} className="font-sans" style={{ fontStretch: "100%" }}>
            ₱
          </span>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </span>
  );
}

function Brand() {
  return (
    <a href="/" className="flex items-center gap-2 text-[#141416] no-underline">
      <img src="/assets/bni-philippines-mark.png" alt="BNI Philippines" className="h-8 w-auto brightness-0" />
      <span className="font-archivo text-base font-extrabold tracking-[0.04em]">
        IBMC <span className="text-[#D0202E]">2027</span>
      </span>
    </a>
  );
}

function Steps({ step }: { step: number }) {
  return (
    <div aria-hidden="true" className="flex gap-1 px-5 pt-3">
      {[1, 2, 3, 4].map((item) => (
        <span key={item} className={`h-1 flex-1 rounded-sm ${item <= step ? "bg-[#D0202E]" : "bg-[#E4E1DC]"}`} />
      ))}
    </div>
  );
}

function Frame({
  label,
  step,
  children,
  footer,
}: {
  label: string;
  step?: number;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="scroll-wrapper bg-[#F6F4F1] font-sans text-[#141416]">
      <div className="mx-auto flex min-h-full w-full max-w-[480px] flex-col">
        <header className="flex items-center justify-between border-b border-[#E4E1DC] bg-[#FDFCFA] px-5 py-4">
          <Brand />
          <span className="text-[13px] text-[#5C5C63]">{label}</span>
        </header>
        {step ? <Steps step={step} /> : null}
        <main className="flex flex-1 flex-col gap-4 px-5 py-5">{children}</main>
        {footer ? <div className="px-5 pt-2 pb-7">{footer}</div> : null}
      </div>
    </div>
  );
}

function PrimaryButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="block w-full rounded-full bg-[#D0202E] px-4 py-4 text-center text-base font-bold text-white disabled:cursor-not-allowed disabled:bg-[#E4A0A6]"
    >
      {children}
    </button>
  );
}

function Choice({
  title,
  body,
  emphasis,
  disabled,
  onClick,
}: {
  title: string;
  body: string;
  emphasis?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex items-center justify-between gap-3 rounded-[14px] bg-white p-4 text-left disabled:cursor-not-allowed ${disabled ? "border border-[#E4E1DC]" : emphasis ? "border-2 border-[#D0202E]" : "border border-[#D9D5CF]"}`}
    >
      <span className="flex flex-col gap-1">
        <span className={`text-base font-bold ${disabled ? "text-[#8E8E96]" : ""}`}>{title}</span>
        <span className="text-sm leading-snug text-[#5C5C63]">{body}</span>
      </span>
      <span aria-hidden="true" className={`text-xl font-bold ${disabled ? "text-[#C8C4BE]" : emphasis ? "text-[#D0202E]" : "text-[#5C5C63]"}`}>
        →
      </span>
    </button>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-[#3A3A40]">
      <span>
        {label} {hint ? <span className="font-normal text-[#5C5C63]">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

function emptyGuest(international: boolean): Attendee {
  return {
    audience: international ? "international" : "guest",
    fullName: "",
    business: "",
    industry: "",
    chapter: "",
    email: "",
    mobile: "",
    invitedBy: "",
    international,
  };
}

function memberAttendee(member: FoundMember, audience: Audience = "member"): Attendee {
  return {
    audience,
    fullName: member.fullName,
    business: member.business,
    industry: member.industry,
    chapter: member.chapter,
    email: member.email,
    mobile: member.mobile,
    invitedBy: "",
    international: false,
  };
}

function RegistrationWizard() {
  const today = manilaDate();
  const [step, setStep] = useState<Step>("start");
  const [attendee, setAttendee] = useState<Attendee | null>(null);
  const [lookup, setLookup] = useState("");
  const [lookedUp, setLookedUp] = useState(false);
  const [searching, setSearching] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [member, setMember] = useState<FoundMember | null>(null);
  const [otpSentTo, setOtpSentTo] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpError, setOtpError] = useState("");
  const [otpBusy, setOtpBusy] = useState(false);
  const [editToken, setEditToken] = useState("");
  const [plan, setPlan] = useState<CheckoutPlan>("full");
  const [memberTest, setMemberTest] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [method, setMethod] = useState<UpayMethod>("instapay");
  const { channels, channel, setChannel } = usePaymentChannels();
  const [checkoutReference, setCheckoutReference] = useState("");
  const [upaySession, setUpaySession] = useState<UpaySession | null>(null);
  const [hitpaySession, setHitpaySession] = useState<HitpaySession | null>(null);
  const [ticketError, setTicketError] = useState("");
  const [guestError, setGuestError] = useState("");
  const [showTerms, setShowTerms] = useState(false);
  const [payError, setPayError] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [coupon, setCoupon] = useState<AppliedCoupon | null>(null);
  const [couponError, setCouponError] = useState("");
  const [couponBusy, setCouponBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<StoredRegistration | null>(null);
  const [chapters, setChapters] = useState<string[]>([]);
  const [testMode, setTestMode] = useState(false);
  const [installmentTest, setInstallmentTest] = useState(false);

  useEffect(() => {
    fetch("/api/chapters")
      .then(async (response) => {
        if (response.ok) {
          const rows = await response.json();
          setChapters(rows.map((chapter: { name: string }) => chapter.name));
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const reference = localStorage.getItem(STORAGE_KEY);
    if (!reference || reference.startsWith("{")) return;
    fetch(`/api/registrations/${reference}`, { headers: resumeHeaders() })
      .then(async (response) => {
        if (response.ok) setSaved(await response.json());
      })
      .catch(() => undefined);
  }, []);

  const international = attendee?.international ?? false;
  const tier = useMemo(() => {
    if (installmentTest) return testInstallmentTier();
    return testMode ? testTier() : tierFor(today, international);
  }, [today, international, testMode, installmentTest]);

  function clearOtp() {
    setOtpSentTo("");
    setOtpCode("");
    setOtpError("");
    setEditToken("");
  }

  async function sendOtp() {
    if (!member || otpBusy) return;
    setOtpBusy(true);
    setOtpError("");
    try {
      const response = await fetch("/api/members/otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: member.email }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not send the code");
      setOtpSentTo(payload.maskedEmail || member.email);
      setOtpCode("");
    } catch (error) {
      setOtpError(error instanceof Error ? error.message : "Could not send the code");
    } finally {
      setOtpBusy(false);
    }
  }

  async function confirmOtp() {
    if (!member || otpBusy) return;
    setOtpBusy(true);
    setOtpError("");
    try {
      const response = await fetch("/api/members/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: member.email, code: otpCode }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "That code is wrong.");
      setEditToken(payload.editToken || "");
      setAttendee(memberAttendee(member));
      setStep("guest");
    } catch (error) {
      setOtpError(error instanceof Error ? error.message : "That code is wrong.");
    } finally {
      setOtpBusy(false);
    }
  }

  async function searchMember() {
    const query = lookup.trim();
    if (!query || searching) return;
    setSearching(true);
    setLookedUp(false);
    setLookupError("");
    setMember(null);
    try {
      const response = await fetch(`/api/members/lookup?q=${encodeURIComponent(query)}`);
      if (response.status === 404) {
        setLookedUp(true);
        return;
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Search failed");
      setMember(payload);
      setLookedUp(true);
    } catch (error) {
      setLookupError(error instanceof Error ? error.message : "Search failed");
    } finally {
      setSearching(false);
    }
  }

  const othersOpen = today >= "2027-02-01";

  function choose(audience: Audience) {
    setTestMode(false);
    setInstallmentTest(false);
    setMemberTest(false);
    if (audience === "member") {
      setStep("member");
      return;
    }
    if (!othersOpen) return;
    setAttendee(emptyGuest(audience === "international"));
    setStep("guest");
  }

  function startTest() {
    setTestMode(true);
    setInstallmentTest(false);
    setMemberTest(false);
    setAttendee(emptyGuest(false));
    setPlan("full");
    setAgreed(false);
    setStep("guest");
  }

  function startInstallmentTest() {
    setTestMode(false);
    setInstallmentTest(true);
    setMemberTest(false);
    setAttendee(emptyGuest(false));
    setPlan("installment");
    setAgreed(false);
    setStep("guest");
  }

  function startMemberTest() {
    setTestMode(false);
    setInstallmentTest(false);
    setMemberTest(true);
    setMember(null);
    setLookup("");
    setLookedUp(false);
    setLookupError("");
    clearOtp();
    setStep("member");
  }

  function checkoutTier() {
    return plan === "test" ? testPaymentTier() : tier;
  }

  function detailsReady(person: Attendee) {
    const fields = [person.fullName, person.business, person.industry, person.email, person.mobile];
    if (person.audience === "member") fields.push(person.chapter);
    return fields.every((value) => value.trim());
  }

  function continueGuest() {
    if (!attendee) return;
    if (!detailsReady(attendee)) {
      setGuestError(attendee.audience === "member"
        ? "Add your name, business, industry, chapter, email, and mobile number."
        : "Add your name, business, industry, email, and mobile number.");
      return;
    }
    setGuestError("");
    if (attendee.audience === "member") {
      setStep("confirm");
      return;
    }
    setPlan(installmentTest ? "installment" : "full");
    setStep("ticket");
  }

  async function saveConfirmedDetails() {
    if (!attendee || saving) return;
    setSaving(true);
    setGuestError("");
    try {
      const response = await fetch("/api/members/details", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          editToken,
          fullName: attendee.fullName,
          business: attendee.business,
          industry: attendee.industry,
          chapter: attendee.chapter,
          email: attendee.email,
          mobile: attendee.mobile,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Details were not saved");
      setMember(payload);
      setAttendee(memberAttendee(payload));
      setPlan("full");
      setStep("ticket");
    } catch (error) {
      setGuestError(error instanceof Error ? error.message : "Details were not saved");
    } finally {
      setSaving(false);
    }
  }

  function continueTicket() {
    if (!checkoutTier()) return;
    if (plan === "installment" && !installmentTest && !agreed) {
      setTicketError("Tick the 15-day agreement to pay in installments.");
      return;
    }
    setTicketError("");
    setStep("pay");
  }

  async function pay() {
    const charging = checkoutTier();
    if (!attendee || !charging || saving || !charging.onSale) return;
    const useInstallment = plan === "installment" && Boolean(charging.installmentCents) && charging.rows.length > 0;
    const peso = charging.currency === "PHP";
    if (peso && !channel) return;
    const hitpay = peso && channel ? hitpayApiChannel(channel) : "";
    setSaving(true);
    setPayError("");
    try {
      const registrationBody = {
        productCode: charging.code,
        paymentPlan: useInstallment ? "installment" : "full",
        fullName: attendee.fullName,
        email: attendee.email,
        mobile: attendee.mobile,
        business: attendee.business,
        industry: attendee.industry,
        chapter: attendee.chapter,
        invitedBy: attendee.invitedBy,
        attendeeType: attendee.audience,
        couponCode: plan === "full" ? coupon?.code || "" : "",
      };
      const path = !peso
        ? "/api/registrations"
        : hitpay
          ? (checkoutReference ? `/api/registrations/${checkoutReference}/hitpay` : "/api/registrations/hitpay")
          : (checkoutReference ? `/api/registrations/${checkoutReference}/upay` : "/api/registrations/upay");
      const paymentBody = hitpay ? { channel: hitpay } : { paymentMethod: method };
      const response = await fetch(path, {
        method: "POST",
        headers: resumeHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(peso && checkoutReference ? paymentBody : peso ? { ...registrationBody, ...paymentBody } : registrationBody),
      });
      const payload = await response.json();
      const record = payload.registration || (payload.reference ? payload : null);
      if (record?.reference) {
        rememberRegistration(record);
        setSaved(record);
        setCheckoutReference(record.reference);
      }
      if (!response.ok) throw new Error(payload.error || "Registration was not saved");
      if (payload.upay?.senderRefId) {
        setHitpaySession(null);
        setUpaySession(payload.upay);
        setStep("paying");
        return;
      }
      if (payload.hitpay?.sessionId) {
        setUpaySession(null);
        setHitpaySession(payload.hitpay);
        setStep("paying");
        const url = payload.hitpay.channel === "online" ? safeHitpayUrl(payload.hitpay.paymentUrl) : "";
        if (url) window.location.assign(url);
        return;
      }
      setStep("done");
    } catch (error) {
      setPayError(error instanceof Error ? error.message : "Registration was not saved");
    } finally {
      setSaving(false);
    }
  }

  if (step === "start") {
    const localTier = tierFor(today, false);
    return (
      <Frame label="Registration">
        <div className="flex flex-col gap-2">
          <p className="m-0 text-xs font-bold tracking-[0.16em] text-[#A8131F] uppercase">IBMC 2027 · AMPLIFY</p>
          <h1 className="m-0 font-archivo text-[32px] leading-[1.08] font-extrabold">Get your seat</h1>
          <p className="m-0 text-[15px] leading-normal text-[#5C5C63]">June 16–17, 2027 · Newport Performing Arts Theater, Pasay City</p>
        </div>
        {localTier ? <PriceStrip tier={localTier} /> : <p className="m-0 text-[15px]">Registration closed on May 31, 2027.</p>}
        <h2 className="m-0 mt-1.5 text-[17px] font-bold">Who's registering?</h2>
        {import.meta.env.DEV ? <Choice title="Test ticket · ₱10" body="Available now, for a local payment test." emphasis onClick={startTest} /> : null}
        <Choice title="Test installment · ₱200" body="₱100 when you pay, then ₱50 on day 2 and ₱50 on day 3. Or pay ₱200 in full." emphasis onClick={startInstallmentTest} />
        <Choice title="I'm a BNI Philippines Member" body="Quick registration. We'll fill in your details." emphasis onClick={() => choose("member")} />
        <Choice title="I'm a BNI Philippines Member (TESTING)" body="Same member registration. Payment is open." emphasis onClick={startMemberTest} />
        <Choice title="Non-BNI Philippines member" body={othersOpen ? "New to BNI? You're welcome here." : "Available February 1, 2027"} disabled={!othersOpen} onClick={() => choose("guest")} />
        <Choice title="International delegate" body={othersOpen ? "Joining from outside the Philippines. Priced in USD." : "Available February 1, 2027"} disabled={!othersOpen} onClick={() => choose("international")} />
        <p className="m-0 mt-auto text-center text-sm text-[#5C5C63]">
          Already registered?{" "}
          <button type="button" className="font-semibold text-[#A8131F]" onClick={() => { setLookup(""); setStep("manage"); }}>
            Manage my registration
          </button>
        </p>
      </Frame>
    );
  }

  if (step === "member") {
    return (
      <Frame
        label="Step 1 of 4"
        step={1}
        footer={member?.registered ? (
          <button type="button" className="block w-full text-center text-base font-bold text-[#A8131F]" onClick={() => setStep("manage")}>
            Manage my registration
          </button>
        ) : (
          <PrimaryButton disabled={!member || !detailsReady(memberAttendee(member))} onClick={() => { if (!member || !detailsReady(memberAttendee(member))) return; setAttendee(memberAttendee(member)); setPlan(memberTest ? "test" : "full"); setStep("ticket"); }}>Continue</PrimaryButton>
        )}
      >
        <button type="button" className="self-start text-sm text-[#A8131F]" onClick={() => setStep("start")}>← Back</button>
        <div className="flex flex-col gap-1.5">
          <h1 className="m-0 font-archivo text-[26px] leading-[1.1] font-extrabold">Find your membership</h1>
          <p className="m-0 text-[15px] leading-normal text-[#5C5C63]">{memberTest ? "Testing registration. Use the email or mobile number registered with BNI Philippines. Payment is open." : "Use the email or mobile number registered with BNI Philippines."}</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-[13px] font-semibold text-[#3A3A40]" htmlFor="member-lookup">BNI member email or mobile</label>
          <div className="flex gap-2">
            <input
              id="member-lookup"
              className={`${inputClass} min-w-0 flex-1`}
              value={lookup}
              placeholder="Email or mobile"
              onChange={(event) => {
                setLookup(event.target.value);
                setLookedUp(false);
                setLookupError("");
                setMember(null);
                clearOtp();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") searchMember();
              }}
            />
            <button
              type="button"
              disabled={!lookup.trim() || searching}
              onClick={searchMember}
              className="shrink-0 rounded-full bg-[#141416] px-4 text-sm font-bold text-white disabled:bg-[#C8C4BE]"
            >
              {searching ? "Finding" : "Find"}
            </button>
          </div>
        </div>
        {member ? (
          <div className="flex flex-col gap-3 rounded-[14px] border border-[#E4E1DC] bg-white p-4">
            <span className="self-start rounded-full bg-[#141416] px-2.5 py-1 text-xs font-bold tracking-[0.1em] text-white uppercase">We found you</span>
            <p className="m-0 font-archivo text-[22px] font-extrabold">{member.fullName}</p>
            <Detail label="Business" value={member.business} />
            <Detail label="Category" value={member.industry} />
            <Detail label="Chapter" value={member.chapter} />
            <Detail label="Mobile" value={member.mobileMasked} />
            {member.registered ? <p className="m-0 text-sm text-[#5C5C63]">You're already registered.</p> : null}
            {otpSentTo ? (
              <div className="flex flex-col gap-2 border-t border-[#F0EDE8] pt-3">
                <p className="m-0 text-sm text-[#5C5C63]">We sent a code to {otpSentTo}. Enter it to edit your details.</p>
                <input
                  className={inputClass}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="6-digit code"
                  value={otpCode}
                  onChange={(event) => setOtpCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                />
                {otpError ? <p className="m-0 text-sm text-[#A8131F]">{otpError}</p> : null}
                <div className="flex gap-2">
                  <button type="button" disabled={otpCode.length !== 6 || otpBusy} onClick={confirmOtp} className="rounded-full bg-[#D0202E] px-4 py-2.5 text-sm font-bold text-white disabled:bg-[#E4A0A6]">Confirm code</button>
                  <button type="button" disabled={otpBusy} onClick={sendOtp} className="rounded-full border border-[#D9D5CF] px-4 py-2.5 text-sm font-semibold">Resend</button>
                </div>
              </div>
            ) : (
              <p className="m-0 text-[13px] text-[#5C5C63]">
                Something wrong?{" "}
                <button type="button" className="font-semibold text-[#A8131F]" disabled={otpBusy} onClick={sendOtp}>
                  {otpBusy ? "Sending a code…" : "Edit my details"}
                </button>
              </p>
            )}
            {otpError && !otpSentTo ? <p className="m-0 text-sm text-[#A8131F]">{otpError}</p> : null}
          </div>
        ) : null}
        {lookupError ? <p className="m-0 text-sm text-[#A8131F]">{lookupError}</p> : null}
        {lookedUp && lookup.trim() && !member ? (
          <div className="rounded-[14px] border border-[#E4E1DC] bg-white p-4">
            <p className="m-0 text-base font-bold">We couldn't find that membership</p>
            <p className="mt-1.5 mb-0 text-sm leading-normal text-[#5C5C63]">Check the email or mobile on your BNI profile. Non-BNI registration opens February 1, 2027.</p>
          </div>
        ) : null}
        {member ? null : (
          <p className="m-0 text-sm text-[#5C5C63]">
            {othersOpen ? (
              <>
                Not a member?{" "}
                <button type="button" className="font-semibold text-[#A8131F]" onClick={() => choose("guest")}>
                  Register as a non-BNI member
                </button>
              </>
            ) : (
              "Non-BNI registration opens February 1, 2027."
            )}
          </p>
        )}
      </Frame>
    );
  }

  if (step === "guest" && attendee) {
    const memberPath = attendee.audience === "member";
    return (
      <Frame label="Step 1 of 4" step={1} footer={<PrimaryButton disabled={!detailsReady(attendee)} onClick={continueGuest}>Continue</PrimaryButton>}>
        <button type="button" className="self-start text-sm text-[#A8131F]" onClick={() => { if (!memberPath) { setTestMode(false); setInstallmentTest(false); } setStep(memberPath ? "member" : "start"); }}>← Back</button>
        <div className="flex flex-col gap-1.5">
          <h1 className="m-0 font-archivo text-[26px] leading-[1.1] font-extrabold">Your details</h1>
          <p className="m-0 text-[15px] leading-normal text-[#5C5C63]">{memberPath ? "Check the details from your BNI membership." : installmentTest ? "Test installment · ₱200. Dates start the day you pay." : testMode ? "Test ticket · ₱10. This does not open the real sale." : "About 3 minutes. Guests are welcome."}</p>
        </div>
        <Field label="Full name">
          <input required className={inputClass} placeholder="As it should appear on your badge" value={attendee.fullName} onChange={(event) => setAttendee({ ...attendee, fullName: event.target.value })} />
        </Field>
        <Field label="Business name">
          <input required className={inputClass} placeholder="Your company or brand" value={attendee.business} onChange={(event) => setAttendee({ ...attendee, business: event.target.value })} />
        </Field>
        {memberPath ? (
          <Field label="Chapter">
            <select required className={inputClass} value={attendee.chapter} onChange={(event) => setAttendee({ ...attendee, chapter: event.target.value })}>
              <option value="">Select a chapter</option>
              {attendee.chapter && !chapters.some((chapter) => chapter.toLowerCase() === attendee.chapter.toLowerCase()) ? <option value={attendee.chapter}>{attendee.chapter}</option> : null}
              {chapters.map((chapter) => <option key={chapter} value={chapter}>{chapter}</option>)}
            </select>
          </Field>
        ) : null}
        <Field label="Industry" hint="Type your own, or pick a suggestion">
          <input required className={inputClass} list="industries" placeholder="Printing, cafés, clinics…" value={attendee.industry} onChange={(event) => setAttendee({ ...attendee, industry: event.target.value })} />
          <datalist id="industries">
            {INDUSTRIES.map((industry) => (
              <option key={industry} value={industry} />
            ))}
          </datalist>
        </Field>
        <Field label="Email">
          <input required type="email" className={inputClass} placeholder="you@business.com" value={attendee.email} onChange={(event) => setAttendee({ ...attendee, email: event.target.value })} />
        </Field>
        <Field label="Mobile number">
          <span className="flex gap-2">
            <span className="rounded-[10px] border border-[#D9D5CF] bg-white px-3 py-3 text-base font-normal">+63</span>
            <input required className={inputClass} placeholder="917 123 4567" value={attendee.mobile} onChange={(event) => setAttendee({ ...attendee, mobile: event.target.value })} />
          </span>
        </Field>
        {memberPath || testMode || installmentTest ? null : (
          <>
            <Field label="Who invited you?" hint="Optional, so the member gets credit">
              <input className={inputClass} placeholder="Member name or chapter" value={attendee.invitedBy} onChange={(event) => setAttendee({ ...attendee, invitedBy: event.target.value })} />
            </Field>
            <label className="flex items-start gap-2.5 text-sm leading-snug text-[#2A2A2E]">
              <input
                type="checkbox"
                className="mt-0.5 h-5 w-5 accent-[#D0202E]"
                checked={attendee.international}
                onChange={(event) => setAttendee({ ...attendee, international: event.target.checked, audience: event.target.checked ? "international" : "guest" })}
              />
              I'm joining from outside the Philippines (international delegate, priced in USD)
            </label>
          </>
        )}
        {guestError ? <p className="m-0 text-sm text-[#A8131F]">{guestError}</p> : null}
      </Frame>
    );
  }

  if (step === "confirm" && attendee) {
    return (
      <Frame
        label="Step 1 of 4"
        step={1}
        footer={<PrimaryButton disabled={saving} onClick={saveConfirmedDetails}>{saving ? "Saving" : "Save and continue"}</PrimaryButton>}
      >
        <button type="button" className="self-start text-sm text-[#A8131F]" onClick={() => { setGuestError(""); setStep("guest"); }}>← Back</button>
        <div className="flex flex-col gap-1.5">
          <h1 className="m-0 font-archivo text-[26px] leading-[1.1] font-extrabold">Confirm your details</h1>
          <p className="m-0 text-[15px] leading-normal text-[#5C5C63]">We'll save these to your membership, then continue to your ticket.</p>
        </div>
        <div className="rounded-[14px] border border-[#E4E1DC] bg-white px-4 py-1 [&>div:first-child]:border-t-0">
          <Detail label="Full name" value={attendee.fullName} />
          <Detail label="Business" value={attendee.business} />
          <Detail label="Industry" value={attendee.industry} />
          <Detail label="Chapter" value={attendee.chapter} />
          <Detail label="Email" value={attendee.email} />
          <Detail label="Mobile" value={attendee.mobile.startsWith("+") ? attendee.mobile : `+63 ${attendee.mobile}`} />
        </div>
        {guestError ? <p className="m-0 text-sm text-[#A8131F]">{guestError}</p> : null}
      </Frame>
    );
  }

  if (step === "ticket" && attendee && tier) {
    const charging = checkoutTier();
    const dueToday = plan === "installment" && tier.rows[0] ? tier.rows[0].amountCents : charging ? charging.fullCents : tier.fullCents;
    return (
      <Frame
        label="Step 2 of 4"
        step={2}
        footer={<PrimaryButton onClick={continueTicket}>Continue to payment · {money(dueToday, charging?.currency || tier.currency)} today</PrimaryButton>}
      >
        <button type="button" className="self-start text-sm text-[#A8131F]" onClick={() => setStep(attendee.audience === "member" ? "member" : "guest")}>← Back</button>
        <h1 className="m-0 font-archivo text-[26px] leading-[1.1] font-extrabold">Your ticket</h1>
        <div className="flex flex-col gap-1.5 rounded-[14px] bg-[#141416] p-4 text-[#F6F4F1]">
          <div className="flex items-center justify-between gap-3">
            <span className="font-archivo text-xl font-extrabold">{charging?.name}</span>
            <span className="rounded-full bg-[#D0202E] px-2.5 py-1 text-[11px] font-bold tracking-[0.1em] text-white uppercase">{charging?.code === "test_50" || charging?.code === "test_200" ? "Test" : charging?.onSale ? "Best price" : "Opens soon"}</span>
          </div>
          <span className="text-sm text-[#C9C7C2]">{charging?.code === "test_50" || charging?.code === "test_200" ? "Payment is open" : charging?.onSale ? `Register by ${charging.windowLabel.replace("until ", "")}` : `Registration opens ${charging?.opensLabel}`}</span>
          <span className="text-[13px] text-[#8E8E96]">{charging?.nextLabel}</span>
        </div>
        <h2 className="m-0 mt-1 text-[17px] font-bold">How would you like to pay?</h2>
        <PayChoice
          selected={plan === "full"}
          onSelect={() => { setPlan("full"); clearCoupon(); }}
          title="Pay in full"
          amount={money(tier.fullCents, tier.currency)}
          body={tier.saveLabel || "One payment today."}
        />
        {memberTest ? (
          <PayChoice
            selected={plan === "test"}
            onSelect={() => { setPlan("test"); clearCoupon(); }}
            title="Test Payment"
            amount={money(testPaymentTier().fullCents, "PHP")}
            body="One payment of ₱50. Payment is open."
          />
        ) : null}
        {tier.installmentCents && tier.rows.length > 0 ? (
          <PayChoice
            selected={plan === "installment"}
            onSelect={() => { setPlan("installment"); clearCoupon(); }}
            title="Installment"
            amount={money(tier.installmentCents, tier.currency)}
            body={tier.installmentSummary || ""}
          >
            <div className="flex flex-col text-[13px]">
              {tier.rows.map((row) => (
                <span key={row.label} className="flex justify-between border-t border-[#F0EDE8] py-1.5 first:border-t-0">
                  <span className={row.kind === "on_registration" ? "font-bold text-[#A8131F]" : "text-[#3A3A40]"}>{row.label}</span>
                  <span className={row.kind === "on_registration" ? "font-bold text-[#A8131F]" : ""}>{money(row.amountCents, tier.currency)}</span>
                </span>
              ))}
            </div>
            {tier.note ? <p className="m-0 text-[13px] leading-snug text-[#5C5C63]">{tier.note}</p> : null}
          </PayChoice>
        ) : null}
        {plan === "installment" && installmentTest ? (
          <p className="m-0 rounded-xl bg-[#F6F4F1] p-3.5 text-[13px] leading-normal text-[#2A2A2E]">
            Day 0 is ₱100, due when you pay. Day 2 and day 3 are ₱50 each, counted from that payment. We'll email you one day before each of those due dates, at 9:00am Manila time.
          </p>
        ) : null}
        {plan === "installment" && !installmentTest ? (
          <label className="flex items-start gap-2.5 rounded-xl bg-[#FBE9EA] p-3.5 text-[13px] leading-normal text-[#2A2A2E]">
            <input type="checkbox" className="mt-0.5 h-5 w-5 accent-[#D0202E]" checked={agreed} onChange={(event) => { setAgreed(event.target.checked); setTicketError(""); }} />
            <span>
              I understand that if a payment is 15 or more days late, my installment plan ends and my ticket moves to the Regular rate of ₱18,000. Everything I've paid is credited, and the balance is due by May 31, 2027.{" "}
              <button type="button" className="font-semibold text-[#A8131F]" onClick={() => setShowTerms((open) => !open)}>Terms</button>
            </span>
          </label>
        ) : null}
        {showTerms ? (
          <p className="m-0 text-[13px] leading-normal text-[#3A3A40]">
            Installment payments must be made on or before each due date. If an installment remains unpaid 15 days after its due date, the installment plan is automatically voided and the registration reverts to the Regular rate of ₱18,000. All payments already made will be credited toward the Regular rate, and the remaining balance must be paid in full on or before May 31, 2027.
          </p>
        ) : null}
        {ticketError ? <p className="m-0 text-sm text-[#A8131F]">{ticketError}</p> : null}
        {plan !== "test" && tier.opensLabel ? <p className="m-0 text-[13px] text-[#5C5C63]">Sales open {tier.opensLabel}. This screen shows the price. No card is charged.</p> : null}
      </Frame>
    );
  }

  async function applyCoupon() {
    if (!attendee || !tier || couponBusy || plan !== "full") return;
    const code = couponCode.trim();
    if (!code) return;
    setCouponBusy(true);
    setCouponError("");
    try {
      const response = await fetch("/api/coupons/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          productCode: tier.code,
          paymentPlan: plan,
          email: attendee.email,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "That coupon code isn't valid.");
      setCoupon(payload);
      setCouponCode(payload.code);
    } catch (error) {
      setCoupon(null);
      setCouponError(error instanceof Error ? error.message : "That coupon code isn't valid.");
    } finally {
      setCouponBusy(false);
    }
  }

  function clearCoupon() {
    setCoupon(null);
    setCouponCode("");
    setCouponError("");
  }

  if (step === "pay" && attendee && tier) {
    const charging = checkoutTier() || tier;
    const applied = plan === "full" ? coupon : null;
    const listTotal = plan === "installment" && tier.installmentCents ? tier.installmentCents : charging.fullCents;
    const dueToday = applied ? applied.dueTodayCents : plan === "installment" && tier.rows[0] ? tier.rows[0].amountCents : charging.fullCents;
    const later = plan === "installment" ? tier.rows.slice(1) : [];
    const laterCount = applied ? applied.laterCount : later.length;
    const laterEach = applied ? applied.laterEachCents : later[0]?.amountCents ?? null;
    const laterCents = applied ? applied.laterCents : later.reduce((sum, row) => sum + row.amountCents, 0);
    return (
      <Frame
        label="Step 3 of 4"
        step={3}
        footer={
          <div className="flex flex-col gap-2.5">
            <PrimaryButton disabled={!charging.onSale || saving || (charging.currency === "PHP" && !channel)} onClick={pay}>
              {charging.onSale
                ? charging.currency === "PHP"
                  ? payActionLabel(channel, money(dueToday, charging.currency), saving)
                  : `Submit registration · ${money(dueToday, charging.currency)} due`
                : `Opens ${charging.opensLabel}`}
            </PrimaryButton>
            <span className="text-center text-xs text-[#5C5C63]">
              {charging.currency === "PHP" ? (channel && channel !== "upay" ? "HitPay · secure payment" : "UnionBank UPay · secure payment") : "Secure payment"}
            </span>
          </div>
        }
      >
        <button type="button" className="self-start text-sm text-[#A8131F]" onClick={() => setStep("ticket")}>← Back</button>
        <h1 className="m-0 font-archivo text-[26px] leading-[1.1] font-extrabold">Payment</h1>
        <div className="flex flex-col rounded-[14px] border border-[#E4E1DC] bg-white px-4 py-2">
          <Row label="Attendee" value={attendee.fullName} />
          <Row label={`${charging.name} · ${plan === "installment" ? "installment" : "paid in full"}`} value={`${money(listTotal, charging.currency)} total`} />
          {laterCount > 0 ? <Row label={`Then, ${laterCount} payments`} value={laterEach ? `${laterCount} × ${money(laterEach, tier.currency)}` : money(laterCents, tier.currency)} /> : null}
          {applied ? <Row label={`Coupon ${applied.code}`} value={`${applied.label} · −${money(applied.discountCents, charging.currency)}`} /> : null}
          <div className="flex items-center justify-between gap-3 border-t-2 border-[#141416] py-3">
            <span className="text-[15px] font-bold">{plan === "installment" ? "Due today · secure your seat" : "Due today"}</span>
            <MoneyText text={money(dueToday, charging.currency)} className="font-archivo text-2xl font-extrabold text-[#A8131F]" />
          </div>
        </div>
        {plan === "full" ? (
          <div className="flex flex-col gap-1.5">
            <label className="text-[13px] font-semibold text-[#3A3A40]" htmlFor="coupon-code">Coupon code</label>
            <div className="flex gap-2">
              <input
                id="coupon-code"
                className={`${inputClass} min-w-0 flex-1 uppercase`}
                placeholder="Enter code"
                value={couponCode}
                onChange={(event) => {
                  setCouponCode(event.target.value.toUpperCase());
                  setCoupon(null);
                  setCouponError("");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") applyCoupon();
                }}
              />
              <button
                type="button"
                disabled={!couponCode.trim() || couponBusy}
                onClick={applyCoupon}
                className="shrink-0 rounded-full bg-[#141416] px-4 text-sm font-bold text-white disabled:bg-[#C8C4BE]"
              >
                {couponBusy ? "Checking" : "Apply"}
              </button>
            </div>
            {applied ? (
              <p className="m-0 text-sm text-[#3A3A40]">
                {applied.code} applied.{" "}
                <button type="button" className="font-semibold text-[#A8131F]" onClick={clearCoupon}>Remove</button>
              </p>
            ) : null}
            {couponError ? <p className="m-0 text-sm text-[#A8131F]">{couponError}</p> : null}
          </div>
        ) : null}
        <h2 className="m-0 mt-1 text-[17px] font-bold">Pay with</h2>
        {charging.currency === "PHP" ? (
          <>
            <PaymentChoices channels={channels} channel={channel} onChannel={setChannel} method={method} onMethod={setMethod} />
            <p className="m-0 text-[13px] leading-normal text-[#5C5C63]">
              Your receipt goes to {attendee.email} and {attendee.mobile}.
            </p>
          </>
        ) : (
          <p className="m-0 text-[13px] leading-normal text-[#5C5C63]">
            UnionBank UPay collects peso payments. This ticket is in US dollars, so the seat is held and IBMC records the payment separately. Your receipt goes to {attendee.email} and {attendee.mobile}.
          </p>
        )}
        {payError ? <p className="m-0 text-sm text-[#A8131F]">{payError}</p> : null}
      </Frame>
    );
  }

  if (step === "paying" && saved && hitpaySession) {
    return (
      <HitpayPending
        record={saved}
        session={hitpaySession}
        onUpdate={(registration, session) => {
          setSaved(registration);
          setHitpaySession(session);
          if (session.status === "paid") setStep("done");
        }}
        onLater={() => setStep("done")}
        onBack={() => setStep("pay")}
      />
    );
  }

  if (step === "paying" && saved && upaySession) {
    return (
      <UpayPending
        record={saved}
        session={upaySession}
        onUpdate={(registration, session) => {
          setSaved(registration);
          setUpaySession(session);
          if (session.status === "paid") setStep("done");
        }}
        onLater={() => setStep("done")}
        onBack={() => setStep("pay")}
      />
    );
  }
  if (step === "done" && saved) return <Confirmed record={saved} onManage={() => setStep("manage")} />;
  if (step === "manage") return <Manage initialQuery={lookup} onStart={() => setStep("start")} />;
  return null;
}

function PriceStrip({ tier }: { tier: Tier }) {
  const from = tier.installmentCents ? money(tier.rows[0]?.amountCents || tier.installmentCents, tier.currency) : null;
  return (
    <div className="flex items-center justify-between gap-3 rounded-[14px] bg-[#141416] px-4 py-3.5 text-[#F6F4F1]">
      <div className="flex flex-col gap-0.5">
        <span className="text-xs font-bold tracking-[0.12em] text-[#FF4D5A] uppercase">{tier.name} · {tier.windowLabel}</span>
        <MoneyText text={money(tier.fullCents, tier.currency)} className="font-archivo text-2xl font-extrabold" />
      </div>
      {from ? (
        <span className="text-right text-[13px] leading-snug text-[#C9C7C2]">
          or {money(tier.installmentCents || 0, tier.currency)} in installments,<br />from {from} today
        </span>
      ) : (
        <span className="text-right text-[13px] leading-snug text-[#C9C7C2]">One payment</span>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-t border-[#F0EDE8] py-2 text-sm">
      <span className="text-[#5C5C63]">{label}</span>
      <span className="text-right font-semibold">{value}</span>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-t border-[#F0EDE8] py-2.5 text-sm first:border-t-0">
      <span className="text-[#5C5C63]">{label}</span>
      <span className="text-right font-semibold">{value}</span>
    </div>
  );
}

function PaymentChoices({
  channels,
  channel,
  onChannel,
  method,
  onMethod,
}: {
  channels: PayChannel[] | null;
  channel: PayChannelCode | "";
  onChannel: (channel: PayChannelCode) => void;
  method: UpayMethod;
  onMethod: (method: UpayMethod) => void;
}) {
  if (channels === null) return <p className="m-0 text-sm text-[#5C5C63]">Loading payment options.</p>;
  if (channels.length === 0) return <p className="m-0 text-sm text-[#5C5C63]">Payment isn't open right now.</p>;
  return (
    <>
      {channels.length > 1 ? (
        <div className="overflow-hidden rounded-[14px] border border-[#D9D5CF] bg-white">
          {channels.map((item) => (
            <label key={item.code} className={`flex items-start gap-3 border-t border-[#E4E1DC] px-4 py-4 first:border-t-0 ${channel === item.code ? "bg-[#FBE9EA]" : ""}`}>
              <input type="radio" name="channel" className="mt-1 h-5 w-5 accent-[#D0202E]" checked={channel === item.code} onChange={() => onChannel(item.code)} />
              <span className="flex flex-col gap-0.5">
                <span className="text-[15px] font-semibold">{item.label}</span>
                <span className="text-[13px] font-normal leading-snug text-[#5C5C63]">{item.detail}</span>
              </span>
            </label>
          ))}
        </div>
      ) : (
        <p className="m-0 text-[15px] font-semibold">{channels[0].label}</p>
      )}
      {channel === "upay" ? <UpayMethods method={method} onChange={onMethod} /> : null}
      {channel === "upay" ? (
        <p className="m-0 text-[13px] leading-normal text-[#5C5C63]">UnionBank collects this for GLOBAL REFERRAL MARKETING INC.</p>
      ) : null}
      {channel === "hitpay_qr" ? (
        <p className="m-0 text-[13px] leading-normal text-[#5C5C63]">You'll get a QR Ph code on the next screen. Stay on that page if you already paid.</p>
      ) : null}
      {channel === "hitpay_online" ? (
        <p className="m-0 text-[13px] leading-normal text-[#5C5C63]">You'll continue to HitPay to pay with UnionBank Online. That page closes after 5 minutes. Coming back here does not by itself mean the payment went through.</p>
      ) : null}
    </>
  );
}

function UpayMethods({ method, onChange }: { method: UpayMethod; onChange: (method: UpayMethod) => void }) {
  return (
    <div className="overflow-hidden rounded-[14px] border border-[#D9D5CF] bg-white">
      {UPAY_METHODS.map((item) => (
        <label key={item.id} className={`flex items-start gap-3 border-t border-[#E4E1DC] px-4 py-4 first:border-t-0 ${method === item.id ? "bg-[#FBE9EA]" : ""}`}>
          <input type="radio" name="method" className="mt-1 h-5 w-5 accent-[#D0202E]" checked={method === item.id} onChange={() => onChange(item.id)} />
          <span className="flex flex-col gap-0.5">
            <span className="text-[15px] font-semibold">{item.label}</span>
            <span className="text-[13px] font-normal leading-snug text-[#5C5C63]">{item.detail}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

function UpayPending({
  record,
  session,
  onUpdate,
  onLater,
  onBack,
}: {
  record: StoredRegistration;
  session: UpaySession;
  onUpdate: (registration: StoredRegistration, session: UpaySession) => void;
  onLater: () => void;
  onBack: () => void;
}) {
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  async function checkStatus() {
    const current = sessionRef.current;
    if (!current.senderRefId || current.status === "paid") return;
    setChecking(true);
    try {
      const response = await fetch(`/api/payments/upay/${current.senderRefId}`);
      const payload = await response.json();
      if (payload.registration && payload.upay) onUpdate(payload.registration, payload.upay);
      if (!response.ok) throw new Error(payload.error || "UnionBank has not confirmed the payment yet.");
      if (payload.error && payload.upay?.status === "pending") setError(payload.error);
      else if (payload.upay?.status === "failed") setError(payload.upay.state || "UnionBank declined the payment.");
      else setError("");
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "UnionBank has not confirmed the payment yet.");
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    if (session.status !== "pending") return undefined;
    checkStatus();
    const timer = window.setInterval(() => {
      checkStatus();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [session.senderRefId, session.status]);

  const due = record.payments.find((item) => item.status === "due");
  const channel = UPAY_METHODS.find((item) => item.id === session.paymentMethod)?.label || "UnionBank";
  return (
    <Frame
      label="Step 3 of 4"
      step={3}
      footer={
        <div className="flex flex-col gap-2.5">
          {session.paymentUrl ? (
            <a href={session.paymentUrl} target="_blank" rel="noreferrer" className="block w-full rounded-full bg-[#D0202E] px-4 py-4 text-center text-base font-bold text-white no-underline">
              Continue to UnionBank
            </a>
          ) : null}
          <button type="button" className="text-center text-sm font-semibold text-[#A8131F]" onClick={onLater}>I'll finish this later</button>
        </div>
      }
    >
      <button type="button" className="self-start text-sm text-[#A8131F]" onClick={onBack}>← Back</button>
      <h1 className="m-0 font-archivo text-[26px] leading-[1.1] font-extrabold">Pay {channel}</h1>
      <p className="m-0 text-[15px] leading-snug text-[#5C5C63]">
        {due ? `${money(due.amountCents, record.currency)} to ${session.billerName}. ` : ""}
        This page updates when UnionBank confirms the payment. The receipt goes to {record.attendee.email}.
      </p>
      {session.qrDataUrl ? (
        <div className="flex flex-col items-center gap-3 rounded-[14px] border border-[#E4E1DC] bg-white p-4">
          <img src={session.qrDataUrl} alt="InstaPay QR" className="h-[220px] w-[220px]" />
          <span className="text-center text-[13px] leading-snug text-[#5C5C63]">Scan with your bank or e-wallet app.</span>
        </div>
      ) : (
        <div className="rounded-[14px] border border-[#E4E1DC] bg-white p-4 text-sm leading-normal text-[#3A3A40]">
          Finish the payment in UnionBank. Reference {session.senderRefId}.
        </div>
      )}
      <button type="button" disabled={checking} className="self-start text-sm font-semibold text-[#A8131F] disabled:text-[#C8C4BE]" onClick={checkStatus}>
        {checking ? "Checking with UnionBank" : "I've paid — check again"}
      </button>
      {error ? <p className="m-0 text-sm text-[#A8131F]">{error}</p> : null}
    </Frame>
  );
}

function useCountdown(expiresAt: string) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);
  const end = Date.parse(expiresAt);
  const remaining = Number.isFinite(end) ? Math.max(0, end - now) : 0;
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  return {
    label: `${minutes}:${String(seconds).padStart(2, "0")}`,
    lastMinute: remaining > 0 && remaining < 60_000,
    expired: Number.isFinite(end) && remaining === 0,
    pastWindow: Number.isFinite(end) && now > end + 2 * 60 * 1000,
  };
}

function HitpayPending({
  record,
  session,
  onUpdate,
  onLater,
  onBack,
}: {
  record: StoredRegistration;
  session: HitpaySession;
  onUpdate: (registration: StoredRegistration, session: HitpaySession) => void;
  onLater: () => void;
  onBack: () => void;
}) {
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const clock = useCountdown(session.expiresAt);
  const checkoutUrl = safeHitpayUrl(session.paymentUrl);
  const showRefresh = session.channel === "qr" && session.status !== "paid" && session.status !== "failed" && session.refreshesLeft > 0 && !clock.pastWindow && (clock.expired || session.canRefresh);

  async function checkStatus() {
    const current = sessionRef.current;
    if (!current.sessionId || current.status === "paid" || current.status === "failed") return;
    setChecking(true);
    try {
      const response = await fetch(`/api/payments/hitpay/${current.sessionId}`);
      const payload = await response.json();
      if (payload.registration && payload.hitpay) onUpdate(payload.registration, payload.hitpay);
      if (!response.ok && !payload.hitpay) throw new Error(payload.error || "HitPay has not confirmed the payment yet.");
      if (payload.hitpay?.status === "failed") setError("This payment can't continue. Nothing was charged.");
      else if (payload.error && payload.hitpay?.status === "pending") setError(payload.error);
      else setError("");
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "HitPay has not confirmed the payment yet.");
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    if (session.status === "paid" || session.status === "failed") return undefined;
    checkStatus();
    const timer = window.setInterval(checkStatus, 3000);
    return () => window.clearInterval(timer);
  }, [session.sessionId, session.status]);

  async function refreshQr() {
    if (refreshing) return;
    setRefreshing(true);
    setError("");
    try {
      const response = await fetch(`/api/payments/hitpay/${session.sessionId}/refresh-qr`, { method: "POST" });
      const payload = await response.json();
      if (payload.registration && payload.hitpay) onUpdate(payload.registration, payload.hitpay);
      if (!response.ok) throw new Error(payload.error || "A new QR could not be created.");
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "A new QR could not be created.");
    } finally {
      setRefreshing(false);
    }
  }

  const due = record.payments.find((item) => item.status === "due");
  const title = session.channel === "qr" ? "Pay with QR Ph" : "Pay with online banking";
  const qrClosed = session.channel === "qr" && clock.expired && !showRefresh && session.status !== "paid";
  return (
    <Frame
      label="Step 3 of 4"
      step={3}
      footer={
        <div className="flex flex-col gap-2.5">
          {session.channel === "online" && checkoutUrl && !clock.expired ? (
            <a href={checkoutUrl} className="block w-full rounded-full bg-[#D0202E] px-4 py-4 text-center text-base font-bold text-white no-underline">
              Continue to online banking
            </a>
          ) : null}
          <button type="button" className="text-center text-sm font-semibold text-[#A8131F]" onClick={onLater}>I'll finish this later</button>
        </div>
      }
    >
      <button type="button" className="self-start text-sm text-[#A8131F]" onClick={onBack}>← Back</button>
      <h1 className="m-0 font-archivo text-[26px] leading-[1.1] font-extrabold">{title}</h1>
      <p className="m-0 text-[15px] leading-snug text-[#5C5C63]">
        {session.channel === "online" ? "Checking payment status. " : ""}
        {due ? `${money(due.amountCents, record.currency)} for IBMC 2027. ` : ""}
        The receipt goes to {record.attendee.email}. Coming back to this page does not by itself confirm the payment.
      </p>
      {session.channel === "qr" && session.qrDataUrl ? (
        <div className="flex flex-col items-center gap-3 rounded-[14px] border border-[#E4E1DC] bg-white p-4">
          <img src={session.qrDataUrl} alt="QR Ph" className={`h-[280px] w-[280px] ${clock.expired ? "opacity-40" : ""}`} />
          <span className={`text-center text-sm font-semibold tabular-nums ${clock.lastMinute || clock.expired ? "text-[#A8131F]" : "text-[#3A3A40]"}`}>
            {clock.expired ? "QR expired" : `Expires in ${clock.label}`}
          </span>
          <span className="text-center text-[13px] leading-snug text-[#5C5C63]">Scan with any QR Ph bank or e-wallet.</span>
          {showRefresh ? (
            <>
              <button type="button" disabled={refreshing} onClick={refreshQr} className="rounded-full bg-[#141416] px-4 py-2.5 text-sm font-bold text-white disabled:bg-[#C8C4BE]">
                {refreshing ? "Generating" : "Generate new QR"}
              </button>
              <span className="text-center text-[13px] leading-snug text-[#5C5C63]">Stay on this page if you already paid.</span>
            </>
          ) : null}
        </div>
      ) : null}
      {session.channel === "online" ? (
        <div className="rounded-[14px] border border-[#E4E1DC] bg-white p-4 text-sm leading-normal text-[#3A3A40]">
          {clock.expired
            ? "The payment was not completed. Nothing was charged. Stay on this page if you already paid."
            : "Finish the payment on HitPay. This page checks every few seconds."}
        </div>
      ) : null}
      {session.status === "failed" ? (
        <p className="m-0 text-sm text-[#A8131F]">This payment can't continue. Nothing was charged.</p>
      ) : null}
      {qrClosed && session.status !== "failed" ? (
        <p className="m-0 text-sm text-[#A8131F]">
          {session.refreshesLeft > 0
            ? "This QR expired. Go back and start the payment again. Stay here if you already paid."
            : "This payment wasn't completed. Nothing was charged."}
        </p>
      ) : null}
      <button type="button" disabled={checking || session.status === "paid"} className="self-start text-sm font-semibold text-[#A8131F] disabled:text-[#C8C4BE]" onClick={checkStatus}>
        {checking ? "Checking payment status" : "I've paid — check again"}
      </button>
      {error ? <p className="m-0 text-sm text-[#A8131F]">{error}</p> : null}
    </Frame>
  );
}

function HitpayReturn({ sessionId }: { sessionId: string }) {
  const [record, setRecord] = useState<StoredRegistration | null>(null);
  const [session, setSession] = useState<HitpaySession | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let stop = false;
    async function load() {
      try {
        const response = await fetch(`/api/payments/hitpay/${sessionId}`);
        const payload = await response.json();
        if (stop) return;
        if (payload.registration) setRecord(payload.registration);
        if (payload.hitpay) setSession(payload.hitpay);
        if (!response.ok && !payload.hitpay) setError(payload.error || "Payment not found");
      } catch {
        if (!stop) setError("Checking payment status failed.");
      }
    }
    load();
    return () => {
      stop = true;
    };
  }, [sessionId]);

  if (record && session?.status === "paid") {
    return <Confirmed record={record} onManage={() => { window.location.href = "/register"; }} />;
  }
  if (record && session) {
    return (
      <HitpayPending
        record={record}
        session={session}
        onUpdate={(registration, next) => {
          setRecord(registration);
          setSession(next);
        }}
        onLater={() => { window.location.href = "/register"; }}
        onBack={() => { window.location.href = "/register"; }}
      />
    );
  }
  return (
    <Frame label="Payment">
      <h1 className="m-0 font-archivo text-[26px] leading-[1.1] font-extrabold">Checking payment status</h1>
      <p className="m-0 text-[15px] leading-snug text-[#5C5C63]">This page checks with HitPay. Opening the return link does not confirm the payment.</p>
      {error ? <p className="m-0 text-sm text-[#A8131F]">{error}</p> : null}
    </Frame>
  );
}

function PayChoice({
  selected,
  onSelect,
  title,
  amount,
  body,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  amount: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <label className={`flex cursor-pointer items-start gap-3 rounded-[14px] bg-white p-4 ${selected ? "border-2 border-[#D0202E]" : "border border-[#D9D5CF]"}`}>
      <input type="radio" name="plan" className="mt-0.5 h-5 w-5 accent-[#D0202E]" checked={selected} onChange={onSelect} />
      <span className="flex flex-1 flex-col gap-2.5">
        <span className="flex flex-col gap-1">
          <span className="flex justify-between gap-2">
            <span className="text-base font-bold">{title}</span>
            <MoneyText text={amount} className="font-archivo text-lg font-extrabold" />
          </span>
          <span className="text-sm leading-snug text-[#5C5C63]">{body}</span>
        </span>
        {selected ? children : null}
      </span>
    </label>
  );
}

function Confirmed({ record, onManage }: { record: StoredRegistration; onManage: () => void }) {
  const paid = record.payments.filter((item) => item.status === "paid").reduce((sum, item) => sum + item.amountCents, 0);
  const paidCount = record.payments.filter((item) => item.status === "paid").length;
  const next = record.payments.find((item) => item.status === "due");
  const first = record.attendee.fullName.trim().split(/\s+/)[0];
  const savedOnly = record.planStatus !== "fully_paid";
  return (
    <Frame label="Step 4 of 4" step={4}>
      <div className="flex flex-col gap-2 rounded-2xl bg-[#D0202E] px-5 py-[22px] text-white">
        <span className="text-xs font-bold tracking-[0.14em] text-[#FFE3E5] uppercase">{savedOnly ? "Registration saved" : "Payment received"}</span>
        <h1 className="m-0 font-archivo text-[30px] leading-[1.05] font-black">{savedOnly ? `You're registered, ${first}.` : `You're in, ${first}.`}</h1>
        <p className="m-0 text-[15px] leading-snug text-[#FFE3E5]">
          {savedOnly
            ? `Your ${record.tierName} seat is held. The amount due stays open until IBMC records the payment.`
            : `Your ${record.tierName} slot for IBMC 2027 is secured. June 16–17, 2027 · Newport Performing Arts Theater.`}
        </p>
      </div>
      <div className="flex flex-col gap-3 rounded-[14px] border border-[#E4E1DC] bg-white p-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm text-[#5C5C63]">Paid so far</span>
          <span className="text-[15px]">
            <b className="font-archivo text-xl">{money(paid, record.currency)}</b> of {money(record.totalCents, record.currency)}
          </span>
        </div>
        <Progress payments={record.payments} label={`${paidCount} of ${record.payments.length} payments made`} />
        {next ? (
          <div className="flex justify-between gap-3 border-t border-[#F0EDE8] pt-2.5">
            <span className="text-sm text-[#5C5C63]">Next payment</span>
            <span className="text-sm font-bold">{money(next.amountCents, record.currency)} · {formatLongDate(next.dueOn)}</span>
          </div>
        ) : null}
        <p className="m-0 text-[13px] leading-normal text-[#5C5C63]">
          {record.planStatus === "fully_paid"
            ? "Your QR ticket is on its way by email and SMS. Bring it on both days."
            : "We'll remind you by email and SMS before each unpaid payment. Your QR ticket arrives once you're fully paid."}
        </p>
      </div>
      <div className="flex justify-center gap-6 text-sm">
        <a href={CALENDAR_URL} target="_blank" rel="noreferrer">Add to calendar</a>
        <button type="button" className="font-semibold text-[#A8131F]" onClick={onManage}>Manage my registration</button>
      </div>
    </Frame>
  );
}

function Manage({
  onStart,
  initialQuery = "",
  payReference = "",
  openPayOnLoad = false,
}: {
  onStart: () => void;
  initialQuery?: string;
  payReference?: string;
  openPayOnLoad?: boolean;
}) {
  const [record, setRecord] = useState<StoredRegistration | null>(null);
  const [query, setQuery] = useState(payReference || initialQuery);
  const [found, setFound] = useState<{ fullName: string; tierName: string; maskedEmail: string } | null>(null);
  const [lookedUp, setLookedUp] = useState(false);
  const [maskedEmail, setMaskedEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [method, setMethod] = useState<UpayMethod>("instapay");
  const { channels, channel, setChannel } = usePaymentChannels();
  const [payingInstallment, setPayingInstallment] = useState(false);
  const [upaySession, setUpaySession] = useState<UpaySession | null>(null);
  const [hitpaySession, setHitpaySession] = useState<HitpaySession | null>(null);
  const [badgeName, setBadgeName] = useState("");
  const [badgeCompany, setBadgeCompany] = useState("");
  const [badgeNote, setBadgeNote] = useState("");
  const [badgeError, setBadgeError] = useState("");
  const payIntent = Boolean(payReference || openPayOnLoad);

  function openRecord(payload: StoredRegistration, options: { openPay?: boolean } = {}) {
    rememberRegistration(payload);
    setRecord(payload);
    setBadgeName(payload.attendee?.fullName || "");
    setBadgeCompany(payload.attendee?.business || "");
    setBadgeNote("");
    setBadgeError("");
    const shouldOpenPay =
      options.openPay &&
      payload.currency === "PHP" &&
      payload.planStatus !== "fully_paid" &&
      payload.payments.some((item) => item.status === "due");
    setPayingInstallment(shouldOpenPay);
  }

  useEffect(() => {
    if (!payReference || record) return;
    let stop = false;
    (async () => {
      setQuery(payReference);
      setBusy(true);
      setError("");
      try {
        const response = await fetch(`/api/registrations/${encodeURIComponent(payReference)}`, { headers: resumeHeaders() });
        if (response.ok) {
          const payload = (await response.json()) as StoredRegistration;
          if (!stop && payload.resumeToken) {
            openRecord(payload, { openPay: payIntent });
            return;
          }
        }
        const lookup = await fetch(`/api/registrations/lookup?q=${encodeURIComponent(payReference)}`);
        const payload = await lookup.json().catch(() => ({}));
        if (stop) return;
        if (lookup.status === 404) {
          setLookedUp(true);
          setFound(null);
          return;
        }
        if (!lookup.ok) throw new Error(payload.error || "Search failed");
        setFound(payload);
        setLookedUp(true);
      } catch (lookupError) {
        if (!stop) setError(lookupError instanceof Error ? lookupError.message : "Search failed");
      } finally {
        if (!stop) setBusy(false);
      }
    })();
    return () => {
      stop = true;
    };
  }, [payReference, payIntent, record]);

  function resetLookup() {
    setFound(null);
    setLookedUp(false);
    setMaskedEmail("");
    setCode("");
    setError("");
  }

  async function findRegistration() {
    const contact = query.trim();
    if (!contact || busy) return;
    setBusy(true);
    setError("");
    setFound(null);
    setLookedUp(false);
    setMaskedEmail("");
    setCode("");
    try {
      const response = await fetch(`/api/registrations/lookup?q=${encodeURIComponent(contact)}`);
      const payload = await response.json().catch(() => ({}));
      if (response.status === 404) {
        setLookedUp(true);
        return;
      }
      if (!response.ok) throw new Error(payload.error || "Search failed");
      setFound(payload);
      setLookedUp(true);
    } catch (lookupError) {
      setError(lookupError instanceof Error ? lookupError.message : "Search failed");
    } finally {
      setBusy(false);
    }
  }

  async function sendCode() {
    const contact = query.trim();
    if (!contact || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/registrations/otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: contact }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not send the code");
      setMaskedEmail(payload.maskedEmail || "");
      setCode("");
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Could not send the code");
    } finally {
      setBusy(false);
    }
  }

  async function confirmCode() {
    if (busy || code.length !== 6) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/registrations/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim(), code }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "That code is wrong.");
      openRecord(payload, { openPay: payIntent });
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : "That code is wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (!record) {
    return (
      <Frame label={payIntent ? "Pay installment" : "My registration"}>
        <button type="button" className="self-start text-sm text-[#A8131F]" onClick={onStart}>← Back</button>
        <div className="flex flex-col gap-1.5">
          <h1 className="m-0 font-archivo text-[26px] leading-[1.1] font-extrabold">{payIntent ? "Pay your installment" : "My registration"}</h1>
          <p className="m-0 text-[15px] leading-normal text-[#5C5C63]">
            {payIntent
              ? "Confirm it's you to pay. We'll send a code to the email on your registration."
              : "Use the email or mobile number on your registration."}
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-[13px] font-semibold text-[#3A3A40]" htmlFor="registration-lookup">Email or mobile</label>
          <div className="flex gap-2">
            <input
              id="registration-lookup"
              className={`${inputClass} min-w-0 flex-1`}
              value={query}
              placeholder="Email or mobile"
              onChange={(event) => {
                setQuery(event.target.value);
                resetLookup();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") findRegistration();
              }}
            />
            <button
              type="button"
              disabled={!query.trim() || busy}
              onClick={findRegistration}
              className="shrink-0 rounded-full bg-[#141416] px-4 text-sm font-bold text-white disabled:bg-[#C8C4BE]"
            >
              {busy && !found && !maskedEmail ? "Finding" : "Find"}
            </button>
          </div>
        </div>
        {found && !maskedEmail ? (
          <div className="flex flex-col gap-2 rounded-[14px] border border-[#E4E1DC] bg-white p-4">
            <span className="self-start rounded-full bg-[#141416] px-2.5 py-1 text-xs font-bold tracking-[0.1em] text-white uppercase">Registration found</span>
            <p className="m-0 font-archivo text-[22px] font-extrabold">{found.fullName}</p>
            <p className="m-0 text-sm text-[#5C5C63]">{found.tierName}</p>
            <p className="m-0 text-sm text-[#5C5C63]">
              {payIntent ? "Send a code to continue to payment. We'll email " : "We'll send a code to "}
              {found.maskedEmail}.{payIntent ? "" : " Check your email."}
            </p>
            <button type="button" disabled={busy} onClick={sendCode} className="self-start rounded-full bg-[#D0202E] px-4 py-2.5 text-sm font-bold text-white disabled:bg-[#E4A0A6]">
              {busy ? "Sending" : "Send code"}
            </button>
          </div>
        ) : null}
        {maskedEmail ? (
          <div className="flex flex-col gap-2 rounded-[14px] border border-[#E4E1DC] bg-white p-4">
            <p className="m-0 text-sm text-[#5C5C63]">Check your email. We sent a code to {maskedEmail}.</p>
            <input
              className={inputClass}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="6-digit code"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            />
            {error ? <p className="m-0 text-sm text-[#A8131F]">{error}</p> : null}
            <div className="flex gap-2">
              <button type="button" disabled={code.length !== 6 || busy} onClick={confirmCode} className="rounded-full bg-[#D0202E] px-4 py-2.5 text-sm font-bold text-white disabled:bg-[#E4A0A6]">Confirm code</button>
              <button type="button" disabled={busy} onClick={sendCode} className="rounded-full border border-[#D9D5CF] px-4 py-2.5 text-sm font-semibold">Resend</button>
            </div>
          </div>
        ) : null}
        {lookedUp && query.trim() && !found ? (
          <div className="rounded-[14px] border border-[#E4E1DC] bg-white p-4">
            <p className="m-0 text-base font-bold">We couldn't find a registration</p>
            <p className="mt-1.5 mb-0 text-sm leading-normal text-[#5C5C63]">Check the email or mobile you registered with. No code is sent until we find it.</p>
          </div>
        ) : null}
        {error && !maskedEmail ? <p className="m-0 text-sm text-[#A8131F]">{error}</p> : null}
      </Frame>
    );
  }

  async function saveBadge() {
    if (!record?.resumeToken || busy) return;
    const fullName = badgeName.trim();
    const business = badgeCompany.trim();
    if (!fullName || !business) {
      setBadgeNote("");
      setBadgeError("Add the name and company name for your badge.");
      return;
    }
    setBusy(true);
    setBadgeError("");
    setBadgeNote("");
    try {
      const response = await fetch(`/api/registrations/${record.reference}/badge`, {
        method: "PATCH",
        headers: resumeHeaders({ "Content-Type": "application/json" }, record.resumeToken),
        body: JSON.stringify({ fullName, business }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Badge was not saved");
      openRecord({ ...payload, resumeToken: payload.resumeToken || record.resumeToken });
      setBadgeNote("Saved. Your badge will use this name and company.");
    } catch (badgeError) {
      setBadgeError(badgeError instanceof Error ? badgeError.message : "Badge was not saved");
    } finally {
      setBusy(false);
    }
  }

  async function startPayment() {
    if (!record || busy || record.currency !== "PHP" || !channel) return;
    const hitpay = hitpayApiChannel(channel);
    setBusy(true);
    setError("");
    try {
      const response = await fetch(hitpay ? `/api/registrations/${record.reference}/hitpay` : `/api/registrations/${record.reference}/upay`, {
        method: "POST",
        headers: resumeHeaders({ "Content-Type": "application/json" }, record.resumeToken),
        body: JSON.stringify(hitpay ? { channel: hitpay } : { paymentMethod: method }),
      });
      const payload = await response.json();
      if (payload.registration) setRecord(payload.registration);
      if (!response.ok) throw new Error(payload.error || "The payment could not be started.");
      if (payload.upay?.senderRefId) {
        setHitpaySession(null);
        setUpaySession(payload.upay);
        setPayingInstallment(false);
      }
      if (payload.hitpay?.sessionId) {
        setUpaySession(null);
        setHitpaySession(payload.hitpay);
        setPayingInstallment(false);
        const url = payload.hitpay.channel === "online" ? safeHitpayUrl(payload.hitpay.paymentUrl) : "";
        if (url) window.location.assign(url);
      }
    } catch (payError) {
      setError(payError instanceof Error ? payError.message : "The payment could not be started.");
    } finally {
      setBusy(false);
    }
  }

  if (hitpaySession) {
    return (
      <HitpayPending
        record={record}
        session={hitpaySession}
        onUpdate={(registration, session) => {
          setRecord(registration);
          setHitpaySession(session);
          if (session.status === "paid") {
            setHitpaySession(null);
            setPayingInstallment(false);
          }
        }}
        onLater={() => setHitpaySession(null)}
        onBack={() => setHitpaySession(null)}
      />
    );
  }

  if (upaySession) {
    return (
      <UpayPending
        record={record}
        session={upaySession}
        onUpdate={(registration, session) => {
          setRecord(registration);
          setUpaySession(session);
          if (session.status === "paid") {
            setUpaySession(null);
            setPayingInstallment(false);
          }
        }}
        onLater={() => setUpaySession(null)}
        onBack={() => setUpaySession(null)}
      />
    );
  }

  const paid = record.payments.filter((item) => item.status === "paid");
  const paidCents = paid.reduce((sum, item) => sum + item.amountCents, 0);
  const due = record.payments.find((item) => item.status === "due");
  const remaining = record.totalCents - paidCents;
  const first = record.attendee.fullName.trim().split(/\s+/)[0];
  const keepUntil = due && due.dueOn !== "on-registration" ? addDays(due.dueOn, 15) : null;
  return (
    <Frame label="My registration">
      <div className="flex flex-col gap-1">
        <h1 className="m-0 font-archivo text-[26px] leading-[1.1] font-extrabold">Hi {first}</h1>
        <p className="m-0 text-[15px] text-[#5C5C63]">{record.tierName} · {record.plan === "installment" ? "installment plan" : "paid in full"}</p>
      </div>
      {record.planStatus === "fully_paid" && record.qrToken ? (
        <div className="flex flex-col items-center gap-3 rounded-[14px] border border-[#E4E1DC] bg-white p-5">
          <span className="self-start text-[15px] font-bold">QR ticket</span>
          <img src={`/api/passes/${encodeURIComponent(record.qrToken)}/qr`} alt="QR ticket" className="h-56 w-56" />
          <span className="font-archivo text-lg font-extrabold">{record.reference}</span>
          <span className="text-center text-[13px] leading-snug text-[#5C5C63]">Show this at the door on both days.</span>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 rounded-[14px] bg-[#E4E1DC] px-4 py-3.5">
          <span className="flex flex-col gap-0.5">
            <span className="text-[15px] font-bold">QR ticket</span>
            <span className="text-[13px] text-[#3A3A40]">Unlocks when you're fully paid</span>
          </span>
          <span className="text-xs font-bold tracking-[0.1em] text-[#3A3A40] uppercase">Locked</span>
        </div>
      )}
      <div className="flex flex-col gap-3 rounded-[14px] border border-[#E4E1DC] bg-white p-4">
        <div className="flex flex-col gap-1">
          <h2 className="m-0 text-[17px] font-bold">Conference badge</h2>
          <p className="m-0 text-[13px] leading-snug text-[#5C5C63]">This name and company name appear on your badge.</p>
        </div>
        <Field label="Name">
          <input className={inputClass} value={badgeName} onChange={(event) => { setBadgeName(event.target.value); setBadgeNote(""); setBadgeError(""); }} />
        </Field>
        <Field label="Company name">
          <input className={inputClass} value={badgeCompany} onChange={(event) => { setBadgeCompany(event.target.value); setBadgeNote(""); setBadgeError(""); }} />
        </Field>
        {badgeNote ? <p className="m-0 text-sm text-[#3A3A40]">{badgeNote}</p> : null}
        {badgeError ? <p className="m-0 text-sm text-[#A8131F]">{badgeError}</p> : null}
        <button type="button" disabled={busy} onClick={saveBadge} className="self-start rounded-full bg-[#141416] px-4 py-2.5 text-sm font-bold text-white disabled:bg-[#C8C4BE]">
          {busy ? "Saving" : "Save badge"}
        </button>
      </div>
      <div className="flex flex-col gap-2.5 rounded-[14px] border border-[#E4E1DC] bg-white p-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[15px]"><b className="font-archivo text-[22px]">{money(paidCents, record.currency)}</b> paid</span>
          <span className="text-sm text-[#5C5C63]">of {money(record.totalCents, record.currency)}</span>
        </div>
        <Progress payments={record.payments} label={`${paid.length} of ${record.payments.length} payments made${due ? `, payment ${record.payments.indexOf(due) + 1} due` : ""}`} />
        <span className="text-[13px] text-[#5C5C63]">{paid.length} of {record.payments.length} payments made · {money(remaining, record.currency)} remaining</span>
      </div>
      <div className="flex flex-col rounded-[14px] border border-[#E4E1DC] bg-white px-4 py-1 text-sm">
        {record.payments.map((item) => (
          <div
            key={`${item.dueOn}-${item.label}`}
            className={`flex flex-wrap items-center justify-between gap-2 border-t border-[#F0EDE8] py-2.5 first:border-t-0 ${item.status === "due" ? "font-bold text-[#A8131F]" : item.status === "upcoming" ? "text-[#5C5C63]" : ""}`}
          >
            <span className="min-w-0 flex-1">
              {item.status === "paid" && item.label.includes("secure your seat")
                ? formatLongDate(item.dueOn).replace(",", "") + " · secure your seat"
                : item.label}
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <span className={item.status === "due" ? "" : "text-[#5C5C63]"}>
                {item.status === "paid" ? "Paid" : item.status === "due" ? "Due" : "Upcoming"} · {money(item.amountCents, record.currency)}
              </span>
              {item.status === "due" && record.currency === "PHP" && record.planStatus !== "fully_paid" ? (
                payingInstallment ? null : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setError("");
                      setPayingInstallment(true);
                    }}
                    className="rounded-full bg-[#D0202E] px-3 py-1.5 text-xs font-bold text-white disabled:bg-[#E4A0A6]"
                  >
                    Pay
                  </button>
                )
              ) : null}
              {item.status === "upcoming" ? (
                <span className="rounded-full border border-[#D9D5CF] px-2 py-0.5 text-[11px] font-semibold tracking-wide text-[#5C5C63] uppercase">Locked</span>
              ) : null}
            </span>
          </div>
        ))}
      </div>
      {due && payingInstallment ? (
        <div className="flex flex-col gap-3 rounded-[14px] border-2 border-[#D0202E] bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-bold tracking-[0.12em] text-[#A8131F] uppercase">Payment {record.payments.indexOf(due) + 1} of {record.payments.length}</span>
              <span className="text-sm font-normal text-[#5C5C63]">Due {formatMonthDate(due.dueOn)}</span>
            </div>
            <span className="font-archivo text-[26px] font-extrabold">{money(due.amountCents, record.currency)}</span>
          </div>
          <h2 className="m-0 text-[17px] font-bold">Choose how to pay</h2>
          <PaymentChoices channels={channels} channel={channel} onChannel={setChannel} method={method} onMethod={setMethod} />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || !channel}
              onClick={startPayment}
              className="rounded-full bg-[#D0202E] px-4 py-3 text-sm font-bold text-white disabled:bg-[#E4A0A6]"
            >
              {payActionLabel(channel, money(due.amountCents, record.currency), busy)}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setPayingInstallment(false);
                setError("");
              }}
              className="rounded-full border border-[#D9D5CF] px-4 py-3 text-sm font-semibold"
            >
              Cancel
            </button>
          </div>
          {error ? <p className="m-0 text-sm text-[#A8131F]">{error}</p> : null}
          {keepUntil ? (
            <p className="m-0 text-[13px] leading-snug text-[#5C5C63]">
              Pay by {formatMonthDate(keepUntil)} to keep your {money(record.totalCents, record.currency)} rate. After that, your ticket moves to the Regular rate of ₱18,000.
            </p>
          ) : null}
        </div>
      ) : null}
      {due && record.currency !== "PHP" ? (
        <p className="m-0 text-[13px] leading-snug text-[#5C5C63]">UnionBank UPay collects peso payments. IBMC records this dollar payment separately.</p>
      ) : null}
    </Frame>
  );
}

function payReferenceFromPath(pathname: string) {
  const match = pathname.match(/^\/pay\/([^/]+)/);
  if (!match) return "";
  try {
    return decodeURIComponent(match[1]).trim();
  } catch {
    return match[1].trim();
  }
}

export default function Registration() {
  const paySession = new URLSearchParams(window.location.search).get("paySession") || "";
  if (paySession) return <HitpayReturn sessionId={paySession} />;
  const payReference = payReferenceFromPath(window.location.pathname);
  if (payReference) {
    return (
      <Manage
        payReference={payReference}
        openPayOnLoad
        onStart={() => {
          window.location.assign("/register");
        }}
      />
    );
  }
  return <RegistrationWizard />;
}

function Progress({ payments, label }: { payments: StoredPayment[]; label: string }) {
  return (
    <div aria-label={label} className="flex gap-1">
      {payments.map((item, index) => (
        <span
          key={index}
          className={`h-2.5 flex-1 rounded-sm ${item.status === "paid" ? "bg-[#D0202E]" : item.status === "due" ? "border-2 border-[#D0202E] bg-white" : "bg-[#E4E1DC]"}`}
        />
      ))}
    </div>
  );
}
