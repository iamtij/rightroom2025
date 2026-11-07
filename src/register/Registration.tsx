import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { parseLookupContact } from "../../server/contact.js";
import { LevNote, type LevPose } from "./Lev";
import {
  INDUSTRIES,
  addDays,
  formatLongDate,
  formatMonthDate,
  manilaDate,
  money,
  testInstallmentTier,
  test100PaymentTier,
  testPaymentTier,
  testTier,
  tierFor,
  type Currency,
  type PayPlan,
  type Tier,
} from "./plans";

function humanCheckPayError(message: string) {
  return (
    message.includes("Confirm you are a person")
    || message.includes("human-check")
    || message.includes("Refresh the page")
    || message.includes("security check expired")
  );
}

async function mintFormChallenge() {
  const response = await fetch("/api/challenge");
  if (!response.ok) throw new Error("Refresh the page and try again.");
  const payload = await response.json();
  const token = String(payload.token || "").trim();
  if (!token) throw new Error("Refresh the page and try again.");
  return token;
}

type TurnstileGlobal = {
  render: (node: HTMLElement, options: object) => string;
  remove?: (widgetId: string) => void;
};

function Turnstile({
  siteKey,
  onToken,
  onBlocked,
}: {
  siteKey: string;
  onToken: (token: string) => void;
  onBlocked?: (blocked: boolean) => void;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  const onBlockedRef = useRef(onBlocked);
  onTokenRef.current = onToken;
  onBlockedRef.current = onBlocked;
  const [widgetError, setWidgetError] = useState(false);
  useEffect(() => {
    onBlockedRef.current?.(false);
    setWidgetError(false);
    let cancelled = false;
    const mountWidget = () => {
      const widget = (window as Window & { turnstile?: TurnstileGlobal }).turnstile;
      if (cancelled || !holder.current || !widget) return;
      if (widgetIdRef.current && widget.remove) {
        widget.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
      widgetIdRef.current = widget.render(holder.current, {
        sitekey: siteKey,
        callback: (token: string) => {
          setWidgetError(false);
          onBlockedRef.current?.(false);
          onTokenRef.current(token);
        },
        "error-callback": () => {
          setWidgetError(true);
          onBlockedRef.current?.(true);
        },
        "expired-callback": () => {
          onTokenRef.current("");
          onBlockedRef.current?.(true);
        },
        "timeout-callback": () => {
          onTokenRef.current("");
          onBlockedRef.current?.(true);
        },
      });
    };
    const existing = document.querySelector("script[data-ibmc-turnstile]");
    if ((window as Window & { turnstile?: TurnstileGlobal }).turnstile) {
      mountWidget();
    } else if (existing) {
      existing.addEventListener("load", mountWidget);
    } else {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.dataset.ibmcTurnstile = "1";
      script.onload = mountWidget;
      document.head.appendChild(script);
    }
    return () => {
      cancelled = true;
      const widget = (window as Window & { turnstile?: TurnstileGlobal }).turnstile;
      if (widgetIdRef.current && widget?.remove) {
        widget.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [siteKey]);
  return (
    <div className="flex flex-col gap-2">
      <div ref={holder} />
      {widgetError ? (
        <p className="m-0 rounded-[10px] border border-[#E8B4B8] bg-[#FBE9EA] px-3 py-2 text-[13px] leading-normal text-[#A8131F]">
          The human-check widget did not load on this page. If you see “Invalid sitekey” above, the server’s{" "}
          <span className="font-semibold">TURNSTILE_SITE_KEY</span> may not be allowed for this hostname. For local dev you can leave{" "}
          <span className="font-semibold">TURNSTILE_SITE_KEY</span> and <span className="font-semibold">TURNSTILE_SECRET_KEY</span> empty (no widget), or use Turnstile keys configured for localhost in Cloudflare. Registration cannot continue until the check succeeds or Turnstile is disabled on the server.
        </p>
      ) : null}
    </div>
  );
}

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

type PaynamicsChannel = "paymaya_ph" | "grabpay_ph" | "bpi_online" | "ubp_online" | "br_landbank_ph";

const PAYNAMICS_CHANNELS: { id: PaynamicsChannel; group: string; label: string; detail: string }[] = [
  { id: "paymaya_ph", group: "E-Wallet", label: "Maya", detail: "Pay with Maya." },
  { id: "grabpay_ph", group: "E-Wallet", label: "GrabPay", detail: "Pay with GrabPay." },
  { id: "bpi_online", group: "Online banking", label: "BPI", detail: "Pay from a BPI account." },
  { id: "ubp_online", group: "Online banking", label: "UnionBank Online", detail: "Pay from a UnionBank account." },
  { id: "br_landbank_ph", group: "Online banking", label: "Landbank", detail: "Pay from a Landbank account." },
];

type PayChannelCode = "upay" | "hitpay_qr" | "hitpay_online" | "paynamics";

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

type PaynamicsSession = {
  requestId: string;
  status: "pending" | "paid" | "failed" | "expired" | "cancelled";
  paymentUrl: string;
  gatewayResponseCode: string;
  gatewayMessage: string;
  expiresAt: string;
  settlementDisabled?: boolean;
  checkoutMode?: "sandbox" | "live" | "off";
  liveRealChargeWarning?: boolean;
};

function isPayChannel(value: string): value is PayChannelCode {
  return value === "upay" || value === "hitpay_qr" || value === "hitpay_online" || value === "paynamics";
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

function safePaynamicsUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return "";
    return url.toString();
  } catch {
    return "";
  }
}

function payActionLabel(channel: PayChannelCode | "", amount: string, busy: boolean, paynamicsChannel: PaynamicsChannel = "paymaya_ph") {
  if (busy) return channel === "upay" || !channel ? "Opening UnionBank" : "Opening payment";
  if (channel === "hitpay_qr") return `Pay with QR · ${amount}`;
  if (channel === "hitpay_online") return `Pay with online banking · ${amount}`;
  if (channel === "paynamics") {
    const label = PAYNAMICS_CHANNELS.find((item) => item.id === paynamicsChannel)?.label || "Paynamics";
    return `Pay with ${label} · ${amount}`;
  }
  return `Pay with UnionBank · ${amount}`;
}

type PaynamicsCheckoutPublic = {
  checkoutMode: string;
  apiAdmissionAllowed?: boolean;
  apiAdmissionReason?: string;
  liveRealChargeWarning?: boolean;
};

function usePaymentChannels() {
  const [channels, setChannels] = useState<PayChannel[] | null>(null);
  const [channel, setChannel] = useState<PayChannelCode | "">("");
  const [paynamicsLiveChargeWarning, setPaynamicsLiveChargeWarning] = useState(false);
  const [paynamicsCheckout, setPaynamicsCheckout] = useState<PaynamicsCheckoutPublic>({ checkoutMode: "off" });
  const [paynamicsChannel, setPaynamicsChannel] = useState<PaynamicsChannel>("paymaya_ph");
  useEffect(() => {
    let stop = false;
    fetch("/api/payment-channels")
      .then((response) => response.json())
      .then((payload) => {
        if (stop) return;
        const list = (Array.isArray(payload.channels) ? payload.channels : []).filter((item: PayChannel) => item && isPayChannel(String(item.code)));
        setChannels(list);
        setChannel((current) => (current && list.some((item: PayChannel) => item.code === current) ? current : list[0]?.code || ""));
        const paynamics = payload.paynamics && typeof payload.paynamics === "object" ? payload.paynamics : {};
        setPaynamicsLiveChargeWarning(Boolean(paynamics.liveRealChargeWarning));
        setPaynamicsCheckout({
          checkoutMode: String(paynamics.checkoutMode || "off"),
          apiAdmissionAllowed: Boolean(paynamics.apiAdmissionAllowed),
          apiAdmissionReason: String(paynamics.apiAdmissionReason || ""),
          liveRealChargeWarning: Boolean(paynamics.liveRealChargeWarning),
        });
      })
      .catch(() => {
        if (!stop) setChannels([]);
      });
    return () => {
      stop = true;
    };
  }, []);
  return { channels, channel, setChannel, paynamicsLiveChargeWarning, paynamicsCheckout, paynamicsChannel, setPaynamicsChannel };
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
  email?: string;
  mobile?: string;
  mobileMasked: string;
  registered?: boolean;
  profileReady?: boolean;
  missing?: string[];
  memberToken?: string;
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
  localStorage.removeItem(RESUME_KEY);
}

function resumeHeaders(extra: Record<string, string> = {}, token = "") {
  const headers = { ...extra };
  if (token) headers["X-Resume-Token"] = token;
  return headers;
}

function mergeStored(current: StoredRegistration, next: StoredRegistration): StoredRegistration {
  const previous = current.attendee;
  const incoming = next.attendee;
  return {
    ...next,
    resumeToken: next.resumeToken || current.resumeToken,
    qrToken: next.qrToken || current.qrToken,
    attendee: {
      ...incoming,
      fullName: incoming.fullName || previous.fullName,
      email: incoming.email || previous.email,
      mobile: incoming.mobile || previous.mobile,
      business: incoming.business || previous.business,
      industry: incoming.industry || previous.industry,
      chapter: incoming.chapter || previous.chapter,
    },
  };
}
const CALENDAR_URL =
  "https://calendar.google.com/calendar/render?action=TEMPLATE&text=IBMC%202027&dates=20270616/20270618&location=Newport%20Performing%20Arts%20Theater%2C%20Pasay%20City&details=IBMC%202027%20%C2%B7%20June%2016%E2%80%9317";

const NETWORKING_SESSIONS = [
  "December 2026",
  "January 2027",
  "February 2027",
  "March 2027",
  "April 2027",
  "May 2027",
];

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
        <div className="mt-auto px-5 pt-2 pb-7">
          {footer ? <div className="pb-4">{footer}</div> : null}
          <p className="m-0 text-center text-sm leading-snug text-[#5C5C63]">
            Need help? Email{" "}
            <a href="mailto:helpdesk@bni.ph" className="font-semibold text-[#A8131F]">helpdesk@bni.ph</a>
            {" "}or visit the{" "}
            <a href="https://helpdesk.bni.ph/" className="font-semibold text-[#A8131F]">helpdesk</a>.
          </p>
        </div>
      </div>
    </div>
  );
}

function PageSection({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="overflow-hidden rounded-[14px] border border-[#E4E1DC] bg-white">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left"
      >
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-xs font-bold tracking-[0.16em] text-[#A8131F] uppercase">{title}</span>
          {summary && !open ? <span className="truncate text-sm font-normal text-[#5C5C63]">{summary}</span> : null}
        </span>
        <span aria-hidden="true" className="text-lg leading-none text-[#5C5C63]">{open ? "–" : "+"}</span>
      </button>
      {open ? <div className="flex flex-col gap-3 border-t border-[#F0EDE8] px-4 pt-3 pb-4">{children}</div> : null}
    </section>
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

function ClosedChoice({ title, body }: { title: string; body: string }) {
  return (
    <div aria-disabled="true" className="flex items-center gap-3 rounded-[14px] border border-dashed border-[#D9D5CF] bg-[#EFECE7] p-4 text-[#8E8E96]">
      <span className="flex flex-col gap-1">
        <span className="text-base font-bold">{title}</span>
        <span className="text-sm leading-snug">{body}</span>
      </span>
    </div>
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
    email: member.email || "",
    mobile: member.mobile || "",
    invitedBy: "",
    international: false,
  };
}

const RESEND_WAIT_SECONDS = 60;

function useResendCooldown() {
  const [secondsLeft, setSecondsLeft] = useState(0);
  const endsAt = useRef(0);
  const cooling = secondsLeft > 0;

  useEffect(() => {
    if (!cooling) return undefined;
    const timer = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((endsAt.current - Date.now()) / 1000));
      setSecondsLeft((current) => (current === left ? current : left));
    }, 250);
    return () => window.clearInterval(timer);
  }, [cooling]);

  const start = useCallback(() => {
    endsAt.current = Date.now() + RESEND_WAIT_SECONDS * 1000;
    setSecondsLeft(RESEND_WAIT_SECONDS);
  }, []);

  const reset = useCallback(() => {
    endsAt.current = 0;
    setSecondsLeft(0);
  }, []);

  return { secondsLeft, start, reset };
}

function ResendCodeButton({ secondsLeft, busy = false, onClick }: { secondsLeft: number; busy?: boolean; onClick: () => void }) {
  const waiting = secondsLeft > 0;
  return (
    <button
      type="button"
      disabled={busy || waiting}
      onClick={onClick}
      className="min-w-[7.5rem] rounded-full border border-[#D9D5CF] px-4 py-2.5 text-sm font-semibold tabular-nums disabled:cursor-not-allowed disabled:text-[#9A9590]"
    >
      {waiting ? `Resend ${secondsLeft}s` : "Resend"}
    </button>
  );
}

function membershipHoldNote(member: FoundMember, editing: boolean) {
  if (member.profileReady) return "";
  const person = memberAttendee(member);
  const checks: Array<[string, string]> = [
    [person.fullName, "name"],
    [person.business, "business name"],
    [person.industry, "category"],
    [person.chapter, "chapter"],
    [person.email, "email"],
    [person.mobile, "mobile number"],
  ];
  const missing = member.missing?.length
    ? member.missing
    : checks.filter(([value]) => !value.trim()).map(([, label]) => label);
  if (!missing.length) return "";
  const listed = missing.length === 1 ? `your ${missing[0]}` : `your ${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`;
  const add = missing.length === 1 ? "add it" : "add them";
  const next = editing
    ? `Enter the code, then ${add}.`
    : `Tap Edit my details, enter the code we email you, and ${add}.`;
  return `We can't continue yet. Your membership is missing ${listed}. ${next}`;
}

function RegistrationWizard() {
  const today = manilaDate();
  const [step, setStep] = useState<Step>("start");
  const [attendee, setAttendee] = useState<Attendee | null>(null);
  const [lookup, setLookup] = useState("");
  const [searching, setSearching] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [member, setMember] = useState<FoundMember | null>(null);
  const [otpSentTo, setOtpSentTo] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpError, setOtpError] = useState("");
  const [otpBusy, setOtpBusy] = useState(false);
  const { secondsLeft: resendSeconds, start: startResendCooldown, reset: resetResendCooldown } = useResendCooldown();
  const [editToken, setEditToken] = useState("");
  const [plan, setPlan] = useState<CheckoutPlan>("full");
  const [memberTest, setMemberTest] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [method, setMethod] = useState<UpayMethod>("instapay");
  const { channels, channel, setChannel, paynamicsLiveChargeWarning, paynamicsCheckout, paynamicsChannel, setPaynamicsChannel } = usePaymentChannels();
  const [checkoutReference, setCheckoutReference] = useState("");
  const [upaySession, setUpaySession] = useState<UpaySession | null>(null);
  const [hitpaySession, setHitpaySession] = useState<HitpaySession | null>(null);
  const [paynamicsSession, setPaynamicsSession] = useState<PaynamicsSession | null>(null);
  const [ticketError, setTicketError] = useState("");
  const [guestError, setGuestError] = useState("");
  const [datesOpen, setDatesOpen] = useState(false);
  const [payError, setPayError] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [coupon, setCoupon] = useState<AppliedCoupon | null>(null);
  const [couponError, setCouponError] = useState("");
  const [couponBusy, setCouponBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<StoredRegistration | null>(null);
  const [managedRecord, setManagedRecord] = useState<StoredRegistration | null>(null);
  const [chapters, setChapters] = useState<string[]>([]);
  const [testMode, setTestMode] = useState(false);
  const [installmentTest, setInstallmentTest] = useState(false);
  const [fullPaymentTest, setFullPaymentTest] = useState(false);
  const [memberProof, setMemberProof] = useState("");
  const [challenge, setChallenge] = useState("");
  const [companyWebsite, setCompanyWebsite] = useState("");
  const [testsOpen, setTestsOpen] = useState(false);
  const [testTicketOpen, setTestTicketOpen] = useState(false);
  const [turnstileSiteKey, setTurnstileSiteKey] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileBlocked, setTurnstileBlocked] = useState(false);
  const [turnstileMountKey, setTurnstileMountKey] = useState(0);

  const applyTurnstileToken = useCallback((token: string) => {
    setTurnstileToken(token);
    if (token) {
      setTurnstileBlocked(false);
      setPayError((current) => (current && humanCheckPayError(current) ? "" : current));
    }
  }, []);

  const resetTurnstileAfterSubmit = useCallback(() => {
    setTurnstileToken("");
    setTurnstileMountKey((value) => value + 1);
  }, []);

  useEffect(() => {
    let stop = false;
    fetch("/api/registration-options")
      .then(async (response) => {
        if (!response.ok) return;
        const payload = await response.json();
        if (!stop) {
          setTestsOpen(Boolean(payload.tests));
          setTestTicketOpen(Boolean(payload.testTicket));
          setTurnstileSiteKey(payload.turnstileSiteKey || "");
        }
      })
      .catch(() => undefined);
    return () => {
      stop = true;
    };
  }, []);

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
    localStorage.removeItem(RESUME_KEY);
    if (step !== "pay") return undefined;
    let stop = false;
    fetch("/api/challenge")
      .then(async (response) => {
        if (!response.ok || stop) return;
        const payload = await response.json();
        if (!stop) setChallenge(payload.token || "");
      })
      .catch(() => undefined);
    return () => {
      stop = true;
    };
  }, [step]);

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
    if (fullPaymentTest) return test100PaymentTier();
    if (installmentTest) return testInstallmentTier();
    return testMode ? testTier() : tierFor(today, international);
  }, [today, international, testMode, installmentTest, fullPaymentTest]);

  function clearOtp() {
    setOtpSentTo("");
    setOtpCode("");
    setOtpError("");
    setEditToken("");
    resetResendCooldown();
  }

  async function sendOtp() {
    if (!member || otpBusy || resendSeconds > 0) return;
    const contact = parseLookupContact(lookup.trim());
    if ("error" in contact) {
      setOtpError(contact.error);
      return;
    }
    setOtpBusy(true);
    setOtpError("");
    try {
      const response = await fetch("/api/members/otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: lookup.trim() }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not send the code");
      setOtpSentTo(payload.maskedEmail || "your email");
      setOtpCode("");
      startResendCooldown();
    } catch (error) {
      setOtpError(error instanceof Error ? error.message : "Could not send the code");
    } finally {
      setOtpBusy(false);
    }
  }

  async function confirmOtp() {
    if (otpBusy) return;
    setOtpBusy(true);
    setOtpError("");
    try {
      const response = await fetch("/api/members/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: lookup.trim(), code: otpCode }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.member) throw new Error(payload.error || "That code is wrong.");
      resetResendCooldown();
      const registration = payload.registration as StoredRegistration | undefined;
      if (payload.member.registered && registration?.reference) {
        rememberRegistration(registration);
        setSaved(registration);
        setManagedRecord(registration);
        setMember(payload.member);
        setEditToken(payload.editToken || "");
        setOtpSentTo("");
        setStep("manage");
        return;
      }
      setManagedRecord(null);
      setMember(payload.member);
      setEditToken(payload.editToken || "");
      setAttendee(memberAttendee(payload.member));
      setOtpSentTo("");
    } catch (error) {
      setOtpError(error instanceof Error ? error.message : "That code is wrong.");
    } finally {
      setOtpBusy(false);
    }
  }

  async function searchMember() {
    const query = lookup.trim();
    if (!query || searching || resendSeconds > 0) return;
    const contact = parseLookupContact(query);
    if ("error" in contact) {
      setMember(null);
      clearOtp();
      setLookupError(contact.error);
      return;
    }
    setSearching(true);
    setLookupError("");
    setOtpError("");
    setMember(null);
    try {
      const response = await fetch("/api/members/otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Could not send the code");
      setOtpSentTo("your email");
      setOtpCode("");
      startResendCooldown();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not send the code";
      if (otpSentTo) setOtpError(message);
      else {
        setOtpSentTo("");
        setLookupError(message);
      }
    } finally {
      setSearching(false);
    }
  }

  const guestsOpen = today >= "2027-02-01";
  const liveCopy = !import.meta.env.DEV && !(typeof window !== "undefined" && window.location.hostname.includes("staging"));
  const internationalOpen = !liveCopy || (today >= "2027-01-01" && today <= "2027-05-31");

  function choose(audience: Audience) {
    setTestMode(false);
    setInstallmentTest(false);
    setMemberTest(false);
    setMemberProof("");
    if (audience === "member") {
      setStep("member");
      return;
    }
    if (audience === "guest" && !guestsOpen) return;
    if (audience === "international" && !internationalOpen) return;
    setAttendee(emptyGuest(audience === "international"));
    setStep("guest");
  }

  function startTest() {
    setTestMode(true);
    setInstallmentTest(false);
    setFullPaymentTest(false);
    setMemberTest(false);
    setMemberProof("");
    setAttendee(emptyGuest(false));
    setPlan("full");
    setAgreed(false);
    setStep("guest");
  }

  function startInstallmentTest() {
    setTestMode(false);
    setInstallmentTest(true);
    setFullPaymentTest(false);
    setMemberTest(false);
    setMemberProof("");
    setAttendee(emptyGuest(false));
    setPlan("installment");
    setAgreed(false);
    setStep("guest");
  }

  function startFullPaymentTest() {
    setTestMode(false);
    setInstallmentTest(false);
    setFullPaymentTest(true);
    setMemberTest(false);
    setMemberProof("");
    setAttendee(emptyGuest(false));
    setPlan("full");
    setAgreed(false);
    setStep("guest");
  }

  function startMemberTest() {
    setTestMode(false);
    setInstallmentTest(false);
    setFullPaymentTest(false);
    setMemberTest(true);
    setMemberProof("");
    setMember(null);
    setLookup("");
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
    if (attendee.audience === "guest" && !testMode && !installmentTest && !fullPaymentTest && today < "2027-02-01") {
      setGuestError("Guest registration opens February 1, 2027.");
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
    if (turnstileSiteKey && !turnstileToken) {
      setPayError(
        turnstileBlocked
          ? "Fix the human-check widget below (or disable Turnstile in server env) before paying."
          : "Confirm you are a person below and try again.",
      );
      return;
    }
    const useInstallment = plan === "installment" && Boolean(charging.installmentCents) && charging.rows.length > 0;
    const peso = charging.currency === "PHP";
    if (peso && channel === "paynamics" && paynamicsCheckout.checkoutMode === "off") {
      const reason = paynamicsCheckout.apiAdmissionReason ? ` (${paynamicsCheckout.apiAdmissionReason})` : "";
      setPayError(`Paynamics checkout is not enabled on this server${reason}. See docs/paynamics-staging.md for required env vars.`);
      return;
    }
    if (peso && !channel) return;
    const paynamics = peso && channel === "paynamics";
    const hitpay = peso && channel && channel !== "paynamics" ? hitpayApiChannel(channel) : "";
    setSaving(true);
    setPayError("");
    let needsFormChallenge = false;
    let submittedWithTurnstile = false;
    try {
      needsFormChallenge = !peso || !checkoutReference;
      const challengeToken = needsFormChallenge ? await mintFormChallenge() : challenge;
      if (needsFormChallenge) setChallenge(challengeToken);
      submittedWithTurnstile = Boolean(needsFormChallenge && turnstileSiteKey && turnstileToken);
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
        memberToken: memberProof || undefined,
        challenge: challengeToken,
        companyWebsite,
        turnstileToken,
      };
      const path = !peso
        ? "/api/registrations"
        : paynamics
          ? (checkoutReference ? `/api/registrations/${checkoutReference}/paynamics` : "/api/registrations/paynamics")
          : hitpay
            ? (checkoutReference ? `/api/registrations/${checkoutReference}/hitpay` : "/api/registrations/hitpay")
            : (checkoutReference ? `/api/registrations/${checkoutReference}/upay` : "/api/registrations/upay");
      const paymentBody = paynamics ? { pchannel: paynamicsChannel } : hitpay ? { channel: hitpay } : { paymentMethod: method };
      const captchaToken = turnstileToken;
      const response = await fetch(path, {
        method: "POST",
        headers: resumeHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(
          peso && checkoutReference
            ? paymentBody
            : peso
              ? { ...registrationBody, ...paymentBody, turnstileToken: captchaToken }
              : { ...registrationBody, turnstileToken: captchaToken },
        ),
      });
      let payload: Record<string, unknown> = {};
      try {
        payload = await response.json();
      } catch {
        throw new Error("Payment did not continue. Try again.");
      }
      const record = (payload.registration as { reference?: string } | undefined) || (payload.reference ? payload : null);
      if (response.ok && record?.reference) {
        rememberRegistration(record as StoredRegistration);
        setSaved(record as StoredRegistration);
        setCheckoutReference(String(record.reference));
      }
      if (!response.ok) {
        const serverMessage = String(payload.error || "Registration was not saved");
        const errorCode = String(payload.code || "");
        const challengeRejected = errorCode === "form_challenge_invalid" || serverMessage === "Refresh the page and try again.";
        const turnstileRejected = errorCode === "turnstile_rejected" || serverMessage === "Confirm you are a person and try again.";
        const captchaLikelyConsumed = submittedWithTurnstile && !challengeRejected && !turnstileRejected;
        if ((turnstileRejected || captchaLikelyConsumed) && turnstileSiteKey) {
          resetTurnstileAfterSubmit();
        }
        if (challengeRejected) {
          try {
            await mintFormChallenge();
          } catch {
            /* keep user-facing message */
          }
          setPayError("Your session check expired. Press Pay again after the human check below shows Success.");
        } else if (turnstileRejected) {
          setPayError("Human check was not accepted. Wait for Success below, then press Pay again.");
        } else {
          setPayError(serverMessage);
        }
        return;
      }
      if (payload.upay?.senderRefId) {
        setHitpaySession(null);
        setPaynamicsSession(null);
        setUpaySession(payload.upay);
        setStep("paying");
        return;
      }
      if (payload.hitpay?.sessionId) {
        setUpaySession(null);
        setPaynamicsSession(null);
        setHitpaySession(payload.hitpay);
        setStep("paying");
        const url = payload.hitpay.channel === "online" ? safeHitpayUrl(payload.hitpay.paymentUrl) : "";
        if (url) window.location.assign(url);
        return;
      }
      const paynamicsPayload = payload.paynamics as { requestId?: string; paymentUrl?: string } | undefined;
      if (paynamicsPayload?.requestId) {
        setUpaySession(null);
        setHitpaySession(null);
        setPaynamicsSession(paynamicsPayload as PaynamicsSession);
        setStep("paying");
        const url = safePaynamicsUrl(String(paynamicsPayload.paymentUrl || ""));
        if (url) window.location.assign(url);
        return;
      }
      setStep("done");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Registration was not saved";
      setPayError(message);
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
        {import.meta.env.DEV && testTicketOpen ? <Choice title="Test ticket · ₱10" body="Available now, for a local payment test." emphasis onClick={startTest} /> : null}
        {testsOpen ? <Choice title="Staging test · ₱100 full" body="One ₱100 payment. For staging Paynamics checkout before public ticket windows open." emphasis onClick={startFullPaymentTest} /> : null}
        {testsOpen ? <Choice title="Staging test · ₱200 installment" body="₱100 when you pay, then ₱50 on day 2 and ₱50 on day 3. Or pay ₱200 in full." emphasis onClick={startInstallmentTest} /> : null}
        <Choice title={liveCopy ? "I'm a BNI Philippines Member" : "I'm a BNI member"} body="Quick registration. We'll fill in your details." emphasis onClick={() => choose("member")} />
        {testsOpen ? <Choice title="I'm a BNI Philippines Member (TESTING)" body="Same member registration. Payment is open." emphasis onClick={startMemberTest} /> : null}
        {guestsOpen ? (
          <Choice title={liveCopy ? "I'm a Guest (Non BNI Member)" : "I'm a guest"} body="New to BNI? You're welcome here." onClick={() => choose("guest")} />
        ) : (
          <ClosedChoice title={liveCopy ? "I'm a Guest (Non BNI Member)" : "I'm a guest"} body="Opens February 1, 2027" />
        )}
        {internationalOpen ? (
          <Choice title={liveCopy ? "International Delegate" : "International delegate"} body="Joining from outside the Philippines. Priced in USD." onClick={() => choose("international")} />
        ) : (
          <ClosedChoice title="International Delegate" body="Opens January 1, 2027" />
        )}
        <p className="m-0 mt-auto text-center text-sm text-[#5C5C63]">
          Already registered?{" "}
          <button type="button" className="font-semibold text-[#A8131F]" onClick={() => { setLookup(""); setManagedRecord(null); setStep("manage"); }}>
            Manage my registration
          </button>
        </p>
      </Frame>
    );
  }

  if (step === "member") {
    const holdNote = member && !member.registered ? membershipHoldNote(member, Boolean(otpSentTo)) : "";
    const first = member?.fullName.trim().split(/\s+/)[0];
    const memberLev: { pose: LevPose; label: string; text: string } = member?.registered
      ? { pose: "smile", label: "Lev, already registered", text: `You're already registered, ${first}.` }
      : member
        ? { pose: "smile", label: "Lev smiling, found your membership", text: `Found you, ${first}!` }
        : otpSentTo
          ? { pose: "smile", label: "Lev smiling", text: "If we found your membership, we sent a code to your email." }
          : {
              pose: "smile",
              label: "Lev smiling",
              text: memberTest
                ? "Testing registration. Use the email or mobile on your BNI Connect profile. Payment is open."
                : "Use the email or mobile number saved in your BNI Connect profile.",
            };
    return (
      <Frame
        label="Step 1 of 4"
        step={1}
        footer={member?.registered ? (
          <button type="button" className="block w-full text-center text-base font-bold text-[#A8131F]" onClick={() => setStep("manage")}>
            Manage my registration
          </button>
        ) : member ? (
          <PrimaryButton disabled={!member.profileReady && !detailsReady(memberAttendee(member))} onClick={() => {
            if (!member.profileReady && !detailsReady(memberAttendee(member))) return;
            const typed = lookup.trim();
            setMemberProof(member.memberToken || "");
            setAttendee({
              ...memberAttendee(member),
              email: member.email || (typed.includes("@") ? typed : ""),
              mobile: member.mobile || (typed.includes("@") ? "" : typed),
            });
            setPlan(memberTest ? "test" : "full");
            setStep("ticket");
          }}>Continue</PrimaryButton>
        ) : null}
      >
        <button type="button" className="self-start text-sm text-[#A8131F]" onClick={() => setStep("start")}>← Back</button>
        <h1 className="m-0 font-archivo text-[26px] leading-[1.1] font-extrabold">Find your membership</h1>
        <LevNote pose={memberLev.pose} label={memberLev.label}>{memberLev.text}</LevNote>
        <div className="flex gap-2">
          <input
            id="member-lookup"
            aria-label="BNI member email or mobile"
            className={`${inputClass} min-w-0 flex-1 rounded-xl py-3.5`}
            value={lookup}
            placeholder="name@business.com or 0917…"
            onChange={(event) => {
              setLookup(event.target.value);
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
            disabled={!lookup.trim() || searching || resendSeconds > 0}
            onClick={searchMember}
            className="shrink-0 rounded-full bg-[#D0202E] px-5 text-base font-bold text-white disabled:bg-[#E4A0A6]"
          >
            {searching ? "Finding" : "Find"}
          </button>
        </div>
        {member ? (
          <div className="flex flex-col gap-3 rounded-[14px] border border-[#E4E1DC] bg-white p-4">
            <span className="self-start rounded-full bg-[#141416] px-2.5 py-1 text-xs font-bold tracking-[0.1em] text-white uppercase">We found you</span>
            <p className="m-0 font-archivo text-[22px] font-extrabold">{member.fullName}</p>
            <Detail label="Business" value={member.business} />
            <Detail label="Category" value={member.industry} />
            <Detail label="Chapter" value={member.chapter} />
            <Detail label="Mobile" value={member.mobileMasked || "Not on file"} muted={!member.mobileMasked} />
            {member.registered ? <p className="m-0 text-sm text-[#5C5C63]">You're already registered.</p> : null}
            {holdNote ? <p className="m-0 text-sm leading-normal text-[#3A3A40]">{holdNote}</p> : null}
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
                  <ResendCodeButton secondsLeft={resendSeconds} busy={otpBusy} onClick={sendOtp} />
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
        {otpSentTo && !member ? (
          <div className="flex flex-col gap-2 rounded-[14px] border border-[#E4E1DC] bg-white p-4">
            <p className="m-0 text-sm text-[#5C5C63]">Enter the 6-digit code if it arrived.</p>
            <input
              className={inputClass}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="6-digit code"
              value={otpCode}
              onChange={(event) => setOtpCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              onKeyDown={(event) => {
                if (event.key === "Enter") confirmOtp();
              }}
            />
            {otpError ? <p className="m-0 text-sm text-[#A8131F]">{otpError}</p> : null}
            <div className="flex gap-2">
              <button type="button" disabled={otpCode.length !== 6 || otpBusy} onClick={confirmOtp} className="rounded-full bg-[#D0202E] px-4 py-2.5 text-sm font-bold text-white disabled:bg-[#E4A0A6]">Confirm code</button>
              <ResendCodeButton secondsLeft={resendSeconds} busy={otpBusy || searching} onClick={searchMember} />
            </div>
          </div>
        ) : null}
        {lookupError ? <p className="m-0 text-sm text-[#A8131F]">{lookupError}</p> : null}
        {member ? null : (
          <p className="m-0 text-sm text-[#5C5C63]">
            {guestsOpen ? (
              <>
                Not a member?{" "}
                <button type="button" className="font-semibold text-[#A8131F]" onClick={() => choose("guest")}>
                  Register as a guest
                </button>
              </>
            ) : (
              "Not a member? Guest registration opens February 1, 2027."
            )}
          </p>
        )}
      </Frame>
    );
  }

  if (step === "guest" && attendee) {
    const memberPath = attendee.audience === "member";
    const guestLine = memberPath
      ? "Check the details from your BNI membership."
      : installmentTest
        ? "Test installment · ₱200. Dates start the day you pay."
        : testMode
          ? "Test ticket · ₱10. This does not open the real sale."
          : attendee.international
            ? "Joining from outside the Philippines. Your ticket is priced in USD."
            : "New to BNI? You're welcome here.";
    return (
      <Frame label="Step 1 of 4" step={1} footer={<PrimaryButton disabled={!detailsReady(attendee)} onClick={continueGuest}>Continue</PrimaryButton>}>
        <button type="button" className="self-start text-sm text-[#A8131F]" onClick={() => { if (!memberPath) { setTestMode(false); setInstallmentTest(false); } setStep(memberPath ? "member" : "start"); }}>← Back</button>
        <h1 className="m-0 font-archivo text-[26px] leading-[1.1] font-extrabold">Your details</h1>
        <LevNote pose="smile" label="Lev smiling">{guestLine}</LevNote>
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
        {memberPath || testMode || installmentTest || fullPaymentTest ? null : (
          <>
            <Field label="Who invited you?" hint="(optional)">
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
    const premium = tier.installmentCents && tier.installmentCents > tier.fullCents ? tier.installmentCents - tier.fullCents : 0;
    const realTier = tier.code !== "test" && tier.code !== "test_50" && tier.code !== "test_100" && tier.code !== "test_200";
    return (
      <Frame
        label="Step 2 of 4"
        step={2}
        footer={<PrimaryButton onClick={continueTicket}>Continue to payment · {money(dueToday, charging?.currency || tier.currency)} today</PrimaryButton>}
      >
        <button type="button" className="self-start text-sm text-[#A8131F]" onClick={() => setStep(attendee.audience === "member" ? "member" : "guest")}>← Back</button>
        <h1 className="m-0 font-archivo text-[26px] leading-[1.1] font-extrabold">Your ticket</h1>
        <LevNote pose="wink" label="Lev with a tip">
          {premium > 0 ? (
            <>Pay in full and save <MoneyText text={money(premium, tier.currency)} />.</>
          ) : plan === "installment" ? (
            <>Tip: <MoneyText text={money(dueToday, charging?.currency || tier.currency)} /> today locks your slot.</>
          ) : (
            <>One payment of <MoneyText text={money(dueToday, charging?.currency || tier.currency)} /> covers your seat.</>
          )}
        </LevNote>
        <div className="flex flex-col gap-1.5 rounded-[14px] bg-[#141416] p-4 text-[#F6F4F1]">
          <div className="flex items-center justify-between gap-3">
            <span className="font-archivo text-xl font-extrabold">{charging?.name}</span>
            <span className="rounded-full bg-[#D0202E] px-2.5 py-1 text-[11px] font-bold tracking-[0.1em] text-white uppercase">{charging?.code === "test_50" || charging?.code === "test_100" || charging?.code === "test_200" ? "Test" : charging?.onSale ? "Best price" : "Opens soon"}</span>
          </div>
          <span className="text-sm text-[#C9C7C2]">{charging?.code === "test_50" || charging?.code === "test_100" || charging?.code === "test_200" ? "Payment is open" : charging?.onSale ? `Register by ${charging.windowLabel.replace("until ", "")}` : `Registration opens ${charging?.opensLabel}`}</span>
        </div>
        <h2 className="m-0 mt-1 text-[17px] font-bold">How would you like to pay?</h2>
        <PayChoice
          selected={plan === "full"}
          onSelect={() => { setPlan("full"); clearCoupon(); }}
          title="Pay in full"
          amount={money(tier.fullCents, tier.currency)}
          body={realTier ? "One payment today." : tier.saveLabel || "One payment today."}
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
            <button
              type="button"
              className="self-start text-[13px] font-semibold text-[#A8131F]"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setDatesOpen((open) => !open);
              }}
            >
              {datesOpen ? "Hide payment dates" : "See payment dates"}
            </button>
            {datesOpen ? (
              <div className="flex flex-col text-[13px]">
                {tier.rows.map((row) => (
                  <span key={row.label} className="flex justify-between border-t border-[#F0EDE8] py-1.5 first:border-t-0">
                    <span className={row.kind === "on_registration" ? "font-bold text-[#A8131F]" : "text-[#3A3A40]"}>{row.label}</span>
                    <span className={row.kind === "on_registration" ? "font-bold text-[#A8131F]" : ""}>{money(row.amountCents, tier.currency)}</span>
                  </span>
                ))}
              </div>
            ) : null}
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
              I understand: if a payment is 15+ days late, my ticket moves to the Regular rate (₱18,000). What I've paid is kept.{" "}
              <a href="/terms#refunds" target="_blank" rel="noreferrer" className="font-semibold text-[#A8131F]">Terms</a>
            </span>
          </label>
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
          <div className="flex flex-col gap-3">
            <PrimaryButton
              disabled={
                !charging.onSale
                || saving
                || (charging.currency === "PHP" && !channel)
                || Boolean(turnstileSiteKey && !turnstileToken)
              }
              onClick={pay}
            >
              {charging.onSale
                ? charging.currency === "PHP"
                  ? payActionLabel(channel, money(dueToday, charging.currency), saving, paynamicsChannel)
                  : `Submit registration · ${money(dueToday, charging.currency)} due`
                : `Opens ${charging.opensLabel}`}
            </PrimaryButton>
            {turnstileSiteKey ? (
              <div className="pt-1">
                <Turnstile
                  key={turnstileMountKey}
                  siteKey={turnstileSiteKey}
                  onToken={applyTurnstileToken}
                  onBlocked={setTurnstileBlocked}
                />
              </div>
            ) : null}
            {payError ? <p className="m-0 text-center text-sm leading-normal text-[#A8131F]">{payError}</p> : null}
          </div>
        }
      >
        <button type="button" className="self-start text-sm text-[#A8131F]" onClick={() => setStep("ticket")}>← Back</button>
        <input className="absolute -left-[9999px] h-0 w-0" tabIndex={-1} autoComplete="off" aria-hidden="true" value={companyWebsite} onChange={(event) => setCompanyWebsite(event.target.value)} />
        <h1 className="m-0 font-archivo text-[26px] leading-[1.1] font-extrabold">Payment</h1>
        <LevNote pose="focus" label="Lev holding a card">Secure payment. I've got this.</LevNote>
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
            <PaymentChoices
              channels={channels}
              channel={channel}
              onChannel={setChannel}
              method={method}
              onMethod={setMethod}
              paynamicsChannel={paynamicsChannel}
              onPaynamicsChannel={setPaynamicsChannel}
              paynamicsLiveChargeWarning={paynamicsLiveChargeWarning}
              paynamicsCheckout={paynamicsCheckout}
            />
            <p className="m-0 text-[13px] leading-normal text-[#5C5C63]">
              Receipt · {attendee.email} · {attendee.mobile}
            </p>
          </>
        ) : (
          <p className="m-0 text-[13px] leading-normal text-[#5C5C63]">
            UnionBank UPay collects peso payments. This ticket is in US dollars, so the seat is held and IBMC records the payment separately. Receipt goes to {attendee.email} and {attendee.mobile}.
          </p>
        )}
      </Frame>
    );
  }

  if (step === "paying" && saved && paynamicsSession) {
    return (
      <PaynamicsPending
        record={saved}
        session={paynamicsSession}
        onUpdate={(registration, session) => {
          setSaved(registration);
          setPaynamicsSession(session);
          if (session.status === "paid") setStep("done");
        }}
        onLater={() => {
          setPaynamicsSession(null);
          setStep("form");
        }}
        onBack={() => {
          setPaynamicsSession(null);
          setStep("form");
        }}
      />
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
  if (step === "manage") {
    return (
      <Manage
        initialQuery={lookup}
        initialRecord={managedRecord}
        onStart={() => {
          setManagedRecord(null);
          setStep("start");
        }}
      />
    );
  }
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

function Detail({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex justify-between gap-3 border-t border-[#F0EDE8] py-2 text-sm">
      <span className="text-[#5C5C63]">{label}</span>
      <span className={`text-right ${muted ? "font-medium text-[#A8131F]" : "font-semibold"}`}>{value}</span>
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
  paynamicsChannel,
  onPaynamicsChannel,
  paynamicsLiveChargeWarning,
  paynamicsCheckout,
}: {
  channels: PayChannel[] | null;
  channel: PayChannelCode | "";
  onChannel: (channel: PayChannelCode) => void;
  method: UpayMethod;
  onMethod: (method: UpayMethod) => void;
  paynamicsChannel: PaynamicsChannel;
  onPaynamicsChannel: (channel: PaynamicsChannel) => void;
  paynamicsLiveChargeWarning?: boolean;
  paynamicsCheckout?: PaynamicsCheckoutPublic;
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
      {channel === "paynamics" ? (
        <>
          <PaynamicsMethods channel={paynamicsChannel} onChange={onPaynamicsChannel} />
          {paynamicsCheckout?.checkoutMode === "off" ? (
            <p className="m-0 rounded-[10px] border border-[#E8B4B8] bg-[#FBE9EA] px-3 py-2 text-[13px] leading-normal text-[#A8131F]">
              Paynamics checkout is not enabled on this server
              {paynamicsCheckout.apiAdmissionReason ? ` (${paynamicsCheckout.apiAdmissionReason})` : ""}
              . See <code className="text-[12px]">docs/paynamics-staging.md</code>.
            </p>
          ) : (
            <p className="m-0 text-[13px] leading-normal text-[#5C5C63]">You'll continue to Paynamics to finish this payment.</p>
          )}
          {paynamicsLiveChargeWarning ? (
            <p className="m-0 rounded-[10px] border border-[#E8B4B8] bg-[#FBE9EA] px-3 py-2 text-[13px] font-semibold leading-normal text-[#A8131F]">
              Staging live Paynamics: successful payments are real charges. Use only test cards/amounts you intend to pay.
            </p>
          ) : null}
        </>
      ) : null}
    </>
  );
}

function PaynamicsMethods({ channel, onChange }: { channel: PaynamicsChannel; onChange: (channel: PaynamicsChannel) => void }) {
  let group = "";
  return (
    <div className="overflow-hidden rounded-[14px] border border-[#D9D5CF] bg-white">
      {PAYNAMICS_CHANNELS.map((item) => {
        const heading = item.group !== group;
        group = item.group;
        return (
          <div key={item.id}>
            {heading ? <p className="m-0 border-t border-[#E4E1DC] px-4 pt-3 text-xs font-bold tracking-[0.12em] text-[#A8131F] uppercase first:border-t-0">{item.group}</p> : null}
            <label className={`flex items-start gap-3 px-4 py-3 ${channel === item.id ? "bg-[#FBE9EA]" : ""}`}>
              <input type="radio" name="paynamics-channel" className="mt-1 h-5 w-5 accent-[#D0202E]" checked={channel === item.id} onChange={() => onChange(item.id)} />
              <span className="flex flex-col gap-0.5">
                <span className="text-[15px] font-semibold">{item.label}</span>
                <span className="text-[13px] font-normal leading-snug text-[#5C5C63]">{item.detail}</span>
              </span>
            </label>
          </div>
        );
      })}
    </div>
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
      const response = await fetch(`/api/payments/upay/${current.senderRefId}`, { headers: resumeHeaders() });
      const payload = await response.json();
      if (payload.registration && payload.upay) onUpdate(mergeStored(record, payload.registration), payload.upay);
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
        This page updates when UnionBank confirms the payment.{record.attendee.email ? ` The receipt goes to ${record.attendee.email}.` : ""}
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
      const response = await fetch(`/api/payments/hitpay/${current.sessionId}`, { headers: resumeHeaders() });
      const payload = await response.json();
      if (payload.registration && payload.hitpay) onUpdate(mergeStored(record, payload.registration), payload.hitpay);
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
      const response = await fetch(`/api/payments/hitpay/${session.sessionId}/refresh-qr`, { method: "POST", headers: resumeHeaders() });
      const payload = await response.json();
      if (payload.registration && payload.hitpay) onUpdate(mergeStored(record, payload.registration), payload.hitpay);
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
        {record.attendee.email ? `The receipt goes to ${record.attendee.email}. ` : ""}Coming back to this page does not by itself confirm the payment.
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

function PaynamicsPending({
  record,
  session,
  onUpdate,
  onLater,
  onBack,
}: {
  record: StoredRegistration;
  session: PaynamicsSession;
  onUpdate: (registration: StoredRegistration, session: PaynamicsSession) => void;
  onLater: () => void;
  onBack: () => void;
}) {
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [current, setCurrent] = useState(session);

  useEffect(() => {
    setCurrent(session);
  }, [session]);

  useEffect(() => {
    if (current.status === "paid" || current.status === "failed" || current.status === "expired") return;
    const timer = window.setInterval(() => {
      fetch(`/api/payments/paynamics/${current.requestId}`, { headers: resumeHeaders() })
        .then((response) => response.json())
        .then((payload) => {
          if (payload.registration && payload.paynamics) onUpdate(mergeStored(record, payload.registration), payload.paynamics);
        })
        .catch(() => {});
    }, 5000);
    return () => window.clearInterval(timer);
  }, [current.requestId, current.status, onUpdate, record]);

  async function checkStatus() {
    setChecking(true);
    setError("");
    try {
      const response = await fetch(`/api/payments/paynamics/${current.requestId}`, { headers: resumeHeaders() });
      const payload = await response.json();
      if (payload.registration && payload.paynamics) onUpdate(mergeStored(record, payload.registration), payload.paynamics);
      if (payload.paynamics?.status === "failed") setError("This payment can't continue. Nothing was charged.");
      else if (payload.error && payload.paynamics?.status === "pending") setError(payload.error);
    } catch {
      setError("Paynamics has not confirmed the payment yet.");
    } finally {
      setChecking(false);
    }
  }

  if (current.status === "paid") {
    return <Confirmed record={record} onManage={onBack} />;
  }

  return (
    <Frame label="Payment">
      <h1 className="m-0 font-archivo text-[26px] leading-[1.1] font-extrabold">Pay with Paynamics</h1>
      {current.liveRealChargeWarning ? (
        <p className="m-0 rounded-[10px] border border-[#E8B4B8] bg-[#FBE9EA] px-3 py-2 text-[13px] font-semibold leading-normal text-[#A8131F]">
          Staging live Paynamics: this checkout can post a real charge if payment succeeds.
        </p>
      ) : null}
      <p className="m-0 text-[15px] leading-snug text-[#5C5C63]">
        {current.settlementDisabled
          ? "Finish payment on Paynamics. This page does not confirm payment from a return link alone; settlement waits for a verified provider notification contract."
          : "Finish payment on Paynamics. This page checks with Paynamics every few seconds and when you tap check again — your return from Paynamics alone does not confirm payment."}
      </p>
      <div className="rounded-[14px] border border-[#E4E1DC] bg-white p-4 text-sm leading-normal text-[#3A3A40]">
        {current.status === "expired"
          ? "The Paynamics checkout window expired. Nothing was charged unless Paynamics confirms otherwise."
          : "Waiting for Paynamics. Stay on this page if you already paid."}
      </div>
      {current.status === "failed" ? (
        <p className="m-0 text-sm text-[#A8131F]">This payment can&apos;t continue. Nothing was charged.</p>
      ) : null}
      <button
        type="button"
        disabled={checking || current.status === "paid"}
        className="self-start text-sm font-semibold text-[#A8131F] disabled:text-[#C8C4BE]"
        onClick={checkStatus}
      >
        {checking ? "Checking payment status" : "I've paid — check again"}
      </button>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="text-sm font-semibold text-[#3A3A40]" onClick={onLater}>
          Pay later
        </button>
        {current.status === "pending" && safePaynamicsUrl(current.paymentUrl) ? (
          <a className="text-sm font-semibold text-[#A8131F] no-underline" href={safePaynamicsUrl(current.paymentUrl)}>
            Open Paynamics again
          </a>
        ) : null}
      </div>
      {error ? <p className="m-0 text-sm text-[#A8131F]">{error}</p> : null}
    </Frame>
  );
}

function PaynamicsReturn({ requestId }: { requestId: string }) {
  const [record, setRecord] = useState<StoredRegistration | null>(null);
  const [session, setSession] = useState<PaynamicsSession | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let stop = false;
    async function load() {
      try {
        const response = await fetch(`/api/payments/paynamics/${requestId}`, { headers: resumeHeaders() });
        const payload = await response.json();
        if (stop) return;
        if (payload.registration) setRecord(payload.registration);
        if (payload.paynamics) setSession(payload.paynamics);
        if (!response.ok && !payload.paynamics) setError(payload.error || "Payment not found");
      } catch {
        if (!stop) setError("Checking payment status failed.");
      }
    }
    load();
    return () => {
      stop = true;
    };
  }, [requestId]);

  if (record && session?.status === "paid") {
    return <Confirmed record={record} onManage={() => { window.location.href = "/register"; }} />;
  }
  if (record && session) {
    return (
      <PaynamicsPending
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
      <p className="m-0 text-[15px] leading-snug text-[#5C5C63]">Your return from Paynamics does not confirm payment. This page waits for Paynamics&apos; signed server notification.</p>
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
        const response = await fetch(`/api/payments/hitpay/${sessionId}`, { headers: resumeHeaders() });
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
            : "June 16–17, 2027 · Newport Performing Arts Theater"}
        </p>
      </div>
      <LevNote pose={savedOnly ? "smile" : "thumb"} bars={savedOnly ? 2 : Math.min(5, Math.max(paidCount, 1))} label={savedOnly ? "Lev smiling" : "Lev giving a thumbs up"}>
        {savedOnly
          ? "Your seat is held. Payment is still open."
          : record.planStatus === "fully_paid"
            ? "You're all paid up."
            : paidCount <= 1
              ? "That's bar one. More with each payment."
              : `That's payment ${paidCount}. More with each payment.`}
      </LevNote>
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
            : "Reminders come by email and SMS. Your QR ticket unlocks when you're fully paid."}
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
  initialRecord = null,
  payReference = "",
  openPayOnLoad = false,
}: {
  onStart: () => void;
  initialQuery?: string;
  initialRecord?: StoredRegistration | null;
  payReference?: string;
  openPayOnLoad?: boolean;
}) {
  const [record, setRecord] = useState<StoredRegistration | null>(initialRecord);
  const [query, setQuery] = useState(payReference || initialQuery);
  const [found, setFound] = useState<{ fullName: string; tierName: string; maskedEmail: string } | null>(null);
  const [lookedUp, setLookedUp] = useState(false);
  const [maskedEmail, setMaskedEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { secondsLeft: resendSeconds, start: startResendCooldown, reset: resetResendCooldown } = useResendCooldown();
  const [method, setMethod] = useState<UpayMethod>("instapay");
  const { channels, channel, setChannel, paynamicsLiveChargeWarning, paynamicsCheckout, paynamicsChannel, setPaynamicsChannel } = usePaymentChannels();
  const [payingInstallment, setPayingInstallment] = useState(false);
  const [upaySession, setUpaySession] = useState<UpaySession | null>(null);
  const [hitpaySession, setHitpaySession] = useState<HitpaySession | null>(null);
  const [paynamicsSession, setPaynamicsSession] = useState<PaynamicsSession | null>(null);
  const [badgeName, setBadgeName] = useState(initialRecord?.attendee.fullName || "");
  const [badgeCompany, setBadgeCompany] = useState(initialRecord?.attendee.business || "");
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
        const sent = await fetch("/api/registrations/otp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: payReference }),
        });
        if (stop) return;
        if (!sent.ok) throw new Error("Could not send the code");
        setMaskedEmail("your email");
        startResendCooldown();
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
    resetResendCooldown();
  }

  async function findRegistration() {
    const contact = query.trim();
    if (!contact || busy || resendSeconds > 0) return;
    const parsed = parseLookupContact(contact, { reference: true });
    if ("error" in parsed) {
      setFound(null);
      setLookedUp(false);
      setMaskedEmail("");
      setCode("");
      setError(parsed.error);
      return;
    }
    setBusy(true);
    setError("");
    setFound(null);
    setLookedUp(false);
    setMaskedEmail("");
    setCode("");
    try {
      const response = await fetch("/api/registrations/otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: contact }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Could not send the code");
      setMaskedEmail("your email");
      startResendCooldown();
    } catch (lookupError) {
      setError(lookupError instanceof Error ? lookupError.message : "Search failed");
    } finally {
      setBusy(false);
    }
  }

  async function sendCode() {
    const contact = query.trim();
    if (!contact || busy || resendSeconds > 0) return;
    const parsed = parseLookupContact(contact, { reference: true });
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
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
      setMaskedEmail("your email");
      setCode("");
      startResendCooldown();
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
        <h1 className="m-0 font-archivo text-[26px] leading-[1.1] font-extrabold">{payIntent ? "Pay your installment" : "My registration"}</h1>
        <LevNote pose="smile" label="Lev smiling">
          {payIntent
            ? "Confirm it's you to pay. I'll send a code to the email on your registration."
            : "Use the email or mobile on your registration."}
        </LevNote>
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
              disabled={!query.trim() || busy || resendSeconds > 0}
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
              <ResendCodeButton secondsLeft={resendSeconds} busy={busy} onClick={sendCode} />
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
    if (!record || busy) return;
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
    } catch (saveError) {
      setBadgeError(saveError instanceof Error ? saveError.message : "Badge was not saved");
    } finally {
      setBusy(false);
    }
  }

  async function startPayment() {
    if (!record || busy || record.currency !== "PHP" || !channel) return;
    if (channel === "paynamics" && paynamicsCheckout.checkoutMode === "off") {
      const reason = paynamicsCheckout.apiAdmissionReason ? ` (${paynamicsCheckout.apiAdmissionReason})` : "";
      setError(`Paynamics checkout is not enabled on this server${reason}.`);
      return;
    }
    const paynamics = channel === "paynamics";
    const hitpay = paynamics ? "" : hitpayApiChannel(channel);
    setBusy(true);
    setError("");
    try {
      const path = paynamics
        ? `/api/registrations/${record.reference}/paynamics`
        : hitpay
          ? `/api/registrations/${record.reference}/hitpay`
          : `/api/registrations/${record.reference}/upay`;
      const response = await fetch(path, {
        method: "POST",
        headers: resumeHeaders({ "Content-Type": "application/json" }, record.resumeToken),
        body: JSON.stringify(paynamics ? { pchannel: paynamicsChannel } : hitpay ? { channel: hitpay } : { paymentMethod: method }),
      });
      const payload = await response.json();
      if (payload.registration) setRecord(payload.registration);
      if (!response.ok) throw new Error(payload.error || "The payment could not be started.");
      if (payload.upay?.senderRefId) {
        setHitpaySession(null);
        setPaynamicsSession(null);
        setUpaySession(payload.upay);
        setPayingInstallment(false);
      }
      if (payload.hitpay?.sessionId) {
        setUpaySession(null);
        setPaynamicsSession(null);
        setHitpaySession(payload.hitpay);
        setPayingInstallment(false);
        const url = payload.hitpay.channel === "online" ? safeHitpayUrl(payload.hitpay.paymentUrl) : "";
        if (url) window.location.assign(url);
      }
      if (payload.paynamics?.requestId) {
        setUpaySession(null);
        setHitpaySession(null);
        setPaynamicsSession(payload.paynamics);
        setPayingInstallment(false);
        const url = safePaynamicsUrl(payload.paynamics.paymentUrl);
        if (url) window.location.assign(url);
      }
    } catch (payError) {
      setError(payError instanceof Error ? payError.message : "The payment could not be started.");
    } finally {
      setBusy(false);
    }
  }

  if (paynamicsSession) {
    return (
      <PaynamicsPending
        record={record}
        session={paynamicsSession}
        onUpdate={(registration, session) => {
          setRecord(registration);
          setPaynamicsSession(session);
          if (session.status === "paid") {
            setPaynamicsSession(null);
            setPayingInstallment(false);
          }
        }}
        onLater={() => setPaynamicsSession(null)}
        onBack={() => setPaynamicsSession(null)}
      />
    );
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
  const shownBadgeName = badgeName.trim() || "Your name";
  const shownBadgeCompany = badgeCompany.trim() || "Your company";
  return (
    <Frame label="My registration">
      <div className="flex flex-col gap-1">
        <h1 className="m-0 font-archivo text-[26px] leading-[1.1] font-extrabold">Hi {first}</h1>
        <p className="m-0 text-[15px] text-[#5C5C63]">{record.tierName} · {record.plan === "installment" ? "installment plan" : "paid in full"}</p>
      </div>
      <PageSection
        title="Payment"
        summary={due ? `${money(due.amountCents, record.currency)} due` : `${money(paidCents, record.currency)} paid`}
        defaultOpen={Boolean(due)}
      >
      <LevNote
        pose={record.planStatus === "fully_paid" ? "thumb" : due ? "alert" : "smile"}
        bars={record.planStatus === "fully_paid" ? 5 : due ? 2 : Math.min(5, Math.max(paid.length, 1))}
        label={due ? "Lev with a payment reminder" : "Lev"}
      >
        {record.planStatus === "fully_paid"
          ? "You're all paid up. Your QR ticket is ready."
          : due && keepUntil && record.currency === "PHP" && record.plan === "installment"
            ? `Pay by ${formatLongDate(keepUntil)} to keep your ${money(record.totalCents, record.currency)} rate.`
            : due
              ? `Payment ${record.payments.indexOf(due) + 1} is due ${due.dueOn === "on-registration" ? "today" : formatLongDate(due.dueOn)}.`
              : "Nothing is due right now."}
      </LevNote>
      <div className="flex flex-col gap-2.5 rounded-[14px] border border-[#E4E1DC] bg-white p-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[15px]"><b className="font-archivo text-[22px]">{money(paidCents, record.currency)}</b> paid</span>
          <span className="text-sm text-[#5C5C63]">of {money(record.totalCents, record.currency)}</span>
        </div>
        <Progress payments={record.payments} label={`${paid.length} of ${record.payments.length} payments made${due ? `, payment ${record.payments.indexOf(due) + 1} due` : ""}`} />
        <span className="text-[13px] text-[#5C5C63]">{paid.length} of {record.payments.length} payments made · {money(remaining, record.currency)} remaining</span>
      </div>
      {due ? (
        <div className="flex flex-col gap-3 rounded-[14px] border-2 border-[#D0202E] bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-bold tracking-[0.12em] text-[#A8131F] uppercase">
                Due {/^\d{4}-\d{2}-\d{2}$/.test(due.dueOn) ? formatMonthDate(due.dueOn) : "today"}
              </span>
              <span className="text-sm font-normal text-[#5C5C63]">Payment {record.payments.indexOf(due) + 1} of {record.payments.length}</span>
            </div>
            <span className="font-archivo text-[26px] font-extrabold">{money(due.amountCents, record.currency)}</span>
          </div>
          {record.currency === "PHP" && record.planStatus !== "fully_paid" ? (
            payingInstallment ? (
              <>
                <h2 className="m-0 text-[17px] font-bold">Choose how to pay</h2>
                <PaymentChoices
                  channels={channels}
                  channel={channel}
                  onChannel={setChannel}
                  method={method}
                  onMethod={setMethod}
                  paynamicsChannel={paynamicsChannel}
                  onPaynamicsChannel={setPaynamicsChannel}
                  paynamicsLiveChargeWarning={paynamicsLiveChargeWarning}
                  paynamicsCheckout={paynamicsCheckout}
                />
                <button
                  type="button"
                  disabled={busy || !channel}
                  onClick={startPayment}
                  className="rounded-full bg-[#D0202E] px-4 py-3.5 text-base font-bold text-white disabled:bg-[#E4A0A6]"
                >
                  {payActionLabel(channel, money(due.amountCents, record.currency), busy, paynamicsChannel)}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setPayingInstallment(false);
                    setError("");
                  }}
                  className="text-sm font-semibold text-[#5C5C63]"
                >
                  Cancel
                </button>
                {error ? <p className="m-0 text-sm text-[#A8131F]">{error}</p> : null}
              </>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setError("");
                  setPayingInstallment(true);
                }}
                className="rounded-full bg-[#D0202E] px-4 py-3.5 text-base font-bold text-white disabled:bg-[#E4A0A6]"
              >
                Pay {money(due.amountCents, record.currency)} now
              </button>
            )
          ) : (
            <p className="m-0 text-[13px] leading-snug text-[#5C5C63]">UnionBank UPay collects peso payments. IBMC records this dollar payment separately.</p>
          )}
          {keepUntil && record.currency === "PHP" ? (
            <p className="m-0 text-[13px] leading-snug text-[#5C5C63]">
              After {formatLongDate(keepUntil)}, your ticket moves to the Regular rate (₱18,000).
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-col rounded-[14px] border border-[#E4E1DC] bg-white px-4 py-1 text-sm">
        {record.payments.map((item) => {
          const dated = /^\d{4}-\d{2}-\d{2}$/.test(item.dueOn);
          const slot = item.dueOn === "on-registration" || item.label.includes("secure your seat");
          const when = slot
            ? `${dated ? formatLongDate(item.dueOn).split(",")[0] : "Today"} · slot fee`
            : item.label;
          const status = item.status === "paid" ? "Paid" : item.status === "due" ? "Due" : "Upcoming";
          return (
            <div
              key={`${item.dueOn}-${item.label}`}
              className={`flex justify-between gap-2 border-t border-[#F0EDE8] py-2.5 first:border-t-0 ${item.status === "due" ? "font-bold text-[#A8131F]" : item.status === "upcoming" ? "text-[#5C5C63]" : ""}`}
            >
              <span>{when}</span>
              <span>
                {item.status === "due" ? `Due · ${money(item.amountCents, record.currency)}` : (
                  <>
                    <span className="text-[#5C5C63]">{status} · </span>
                    {money(item.amountCents, record.currency)}
                  </>
                )}
              </span>
            </div>
          );
        })}
      </div>
      </PageSection>
      <PageSection title="Event" summary="June 16–17, 2027" defaultOpen={!due}>
        <div className="flex flex-col gap-2 rounded-[14px] border border-[#E4E1DC] bg-white p-4">
          <p className="m-0 text-base font-bold">June 16–17, 2027</p>
          <p className="m-0 text-sm leading-snug text-[#5C5C63]">Newport Performing Arts Theater, Pasay City</p>
          <a href={CALENDAR_URL} target="_blank" rel="noreferrer" className="self-start text-sm font-semibold text-[#A8131F]">Add to calendar</a>
        </div>
        <div className="flex flex-col gap-3 rounded-[14px] border border-[#E4E1DC] bg-white p-4">
          <div className="flex flex-col items-center gap-1 rounded-[14px] border border-[#E4E1DC] bg-white px-5 py-6 text-center text-[#141416]">
            <span className="text-[11px] font-bold tracking-[0.16em] text-[#D0202E] uppercase">IBMC 2027</span>
            <span className="font-archivo text-[26px] leading-tight font-extrabold">{shownBadgeName}</span>
            <span className="text-sm text-[#5C5C63]">{shownBadgeCompany}</span>
          </div>
          <p className="m-0 text-[13px] leading-snug text-[#5C5C63]">This name and company appear on your badge.</p>
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
      </PageSection>
      <PageSection title="Upcoming activities" summary="December 2026 – May 2027">
        <p className="m-0 text-sm leading-snug text-[#5C5C63]">Monthly networking on Zoom, December 2026 through May 2027. Each session link will show here when it is ready.</p>
        <ul className="m-0 flex list-none flex-col rounded-[14px] border border-[#E4E1DC] bg-white px-4 py-1">
          {NETWORKING_SESSIONS.map((month) => (
            <li key={month} className="flex items-center justify-between gap-3 border-t border-[#F0EDE8] py-2.5 first:border-t-0">
              <span className="text-sm font-semibold">{month}</span>
              <span className="text-[13px] text-[#5C5C63]">Zoom · link coming</span>
            </li>
          ))}
        </ul>
      </PageSection>
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
  const paynamicsRequest = new URLSearchParams(window.location.search).get("paynamicsRequest") || "";
  if (paynamicsRequest) return <PaynamicsReturn requestId={paynamicsRequest} />;
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
