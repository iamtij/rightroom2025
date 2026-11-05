import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  INDUSTRIES,
  addDays,
  formatLongDate,
  formatMonthDate,
  manilaDate,
  money,
  tierFor,
  type Currency,
  type PayPlan,
  type Tier,
} from "./plans";

type Audience = "member" | "guest" | "international";
type Step = "start" | "member" | "guest" | "confirm" | "ticket" | "pay" | "done" | "manage";

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
  attendee: Attendee;
  tierName: string;
  plan: PayPlan;
  currency: Currency;
  totalCents: number;
  payments: StoredPayment[];
  planStatus: "active" | "fully_paid";
};

const STORAGE_KEY = "ibmc2027-registration";
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

export default function Registration() {
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
  const [plan, setPlan] = useState<PayPlan>("full");
  const [agreed, setAgreed] = useState(false);
  const [method, setMethod] = useState("Credit or debit card");
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
    fetch(`/api/registrations/${reference}`)
      .then(async (response) => {
        if (response.ok) setSaved(await response.json());
      })
      .catch(() => undefined);
  }, []);

  const international = attendee?.international ?? false;
  const tier = useMemo(() => tierFor(today, international), [today, international]);

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
    if (audience === "member") {
      setStep("member");
      return;
    }
    if (!othersOpen) return;
    setAttendee(emptyGuest(audience === "international"));
    setStep("guest");
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
    setPlan("full");
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
    if (!tier) return;
    if (plan === "installment" && !agreed) {
      setTicketError("Tick the 15-day agreement to pay in installments.");
      return;
    }
    setTicketError("");
    setStep("pay");
  }

  async function pay() {
    if (!attendee || !tier || saving || !tier.onSale) return;
    const useInstallment = plan === "installment" && Boolean(tier.installmentCents) && tier.rows.length > 0;
    setSaving(true);
    setPayError("");
    try {
      const response = await fetch("/api/registrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productCode: tier.code,
          paymentPlan: useInstallment ? "installment" : "full",
          fullName: attendee.fullName,
          email: attendee.email,
          mobile: attendee.mobile,
          business: attendee.business,
          industry: attendee.industry,
          chapter: attendee.chapter,
          invitedBy: attendee.invitedBy,
          attendeeType: attendee.audience,
          couponCode: useInstallment ? "" : coupon?.code || "",
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Registration was not saved");
      localStorage.setItem(STORAGE_KEY, payload.reference);
      setSaved(payload);
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
        <Choice title="I'm a BNI Philippines Member" body="Quick registration. We'll fill in your details." emphasis onClick={() => choose("member")} />
        <Choice title="Non-BNI Philippines member" body={othersOpen ? "New to BNI? You're welcome here." : "Available February 1, 2027"} disabled={!othersOpen} onClick={() => choose("guest")} />
        <Choice title="International delegate" body={othersOpen ? "Joining from outside the Philippines. Priced in USD." : "Available February 1, 2027"} disabled={!othersOpen} onClick={() => choose("international")} />
        <p className="m-0 mt-auto text-center text-sm text-[#5C5C63]">
          Already registered?{" "}
          <button type="button" className="font-semibold text-[#A8131F]" onClick={() => setStep("manage")}>
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
        footer={<PrimaryButton disabled={!member || !detailsReady(memberAttendee(member))} onClick={() => { if (!member || !detailsReady(memberAttendee(member))) return; setAttendee(memberAttendee(member)); setPlan("full"); setStep("ticket"); }}>Continue</PrimaryButton>}
      >
        <button type="button" className="self-start text-sm text-[#A8131F]" onClick={() => setStep("start")}>← Back</button>
        <div className="flex flex-col gap-1.5">
          <h1 className="m-0 font-archivo text-[26px] leading-[1.1] font-extrabold">Find your membership</h1>
          <p className="m-0 text-[15px] leading-normal text-[#5C5C63]">Use the email or mobile number registered with BNI Philippines.</p>
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
        <button type="button" className="self-start text-sm text-[#A8131F]" onClick={() => setStep(memberPath ? "member" : "start")}>← Back</button>
        <div className="flex flex-col gap-1.5">
          <h1 className="m-0 font-archivo text-[26px] leading-[1.1] font-extrabold">Your details</h1>
          <p className="m-0 text-[15px] leading-normal text-[#5C5C63]">{memberPath ? "Check the details from your BNI membership." : "About 3 minutes. Guests are welcome."}</p>
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
        {memberPath ? null : (
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
    const dueToday = plan === "installment" && tier.rows[0] ? tier.rows[0].amountCents : tier.fullCents;
    return (
      <Frame
        label="Step 2 of 4"
        step={2}
        footer={<PrimaryButton onClick={continueTicket}>Continue to payment · {money(dueToday, tier.currency)} today</PrimaryButton>}
      >
        <button type="button" className="self-start text-sm text-[#A8131F]" onClick={() => setStep(attendee.audience === "member" ? "member" : "guest")}>← Back</button>
        <h1 className="m-0 font-archivo text-[26px] leading-[1.1] font-extrabold">Your ticket</h1>
        <div className="flex flex-col gap-1.5 rounded-[14px] bg-[#141416] p-4 text-[#F6F4F1]">
          <div className="flex items-center justify-between gap-3">
            <span className="font-archivo text-xl font-extrabold">{tier.name}</span>
            <span className="rounded-full bg-[#D0202E] px-2.5 py-1 text-[11px] font-bold tracking-[0.1em] text-white uppercase">{tier.onSale ? "Best price" : "Opens soon"}</span>
          </div>
          <span className="text-sm text-[#C9C7C2]">{tier.onSale ? `Register by ${tier.windowLabel.replace("until ", "")}` : `Registration opens ${tier.opensLabel}`}</span>
          <span className="text-[13px] text-[#8E8E96]">{tier.nextLabel}</span>
        </div>
        <h2 className="m-0 mt-1 text-[17px] font-bold">How would you like to pay?</h2>
        <PayChoice
          selected={plan === "full"}
          onSelect={() => { setPlan("full"); clearCoupon(); }}
          title="Pay in full"
          amount={money(tier.fullCents, tier.currency)}
          body={tier.saveLabel || "One payment today."}
        />
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
        {plan === "installment" ? (
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
        {tier.opensLabel ? <p className="m-0 text-[13px] text-[#5C5C63]">Sales open {tier.opensLabel}. This screen shows the price. No card is charged.</p> : null}
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
    const applied = plan === "full" ? coupon : null;
    const listTotal = plan === "installment" && tier.installmentCents ? tier.installmentCents : tier.fullCents;
    const dueToday = applied ? applied.dueTodayCents : plan === "installment" && tier.rows[0] ? tier.rows[0].amountCents : tier.fullCents;
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
            <PrimaryButton disabled={!tier.onSale || saving} onClick={pay}>
              {tier.onSale ? `Submit registration · ${money(dueToday, tier.currency)} due` : `Opens ${tier.opensLabel}`}
            </PrimaryButton>
            <span className="text-center text-xs text-[#5C5C63]">Secure payment</span>
          </div>
        }
      >
        <button type="button" className="self-start text-sm text-[#A8131F]" onClick={() => setStep("ticket")}>← Back</button>
        <h1 className="m-0 font-archivo text-[26px] leading-[1.1] font-extrabold">Payment</h1>
        <div className="flex flex-col rounded-[14px] border border-[#E4E1DC] bg-white px-4 py-2">
          <Row label="Attendee" value={attendee.fullName} />
          <Row label={`${tier.name} · ${plan === "installment" ? "installment" : "paid in full"}`} value={`${money(listTotal, tier.currency)} total`} />
          {laterCount > 0 ? <Row label={`Then, ${laterCount} payments`} value={laterEach ? `${laterCount} × ${money(laterEach, tier.currency)}` : money(laterCents, tier.currency)} /> : null}
          {applied ? <Row label={`Coupon ${applied.code}`} value={`${applied.label} · −${money(applied.discountCents, tier.currency)}`} /> : null}
          <div className="flex items-center justify-between gap-3 border-t-2 border-[#141416] py-3">
            <span className="text-[15px] font-bold">{plan === "installment" ? "Due today · secure your seat" : "Due today"}</span>
            <MoneyText text={money(dueToday, tier.currency)} className="font-archivo text-2xl font-extrabold text-[#A8131F]" />
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
        <div className="overflow-hidden rounded-[14px] border border-[#D9D5CF] bg-white">
          {["Credit or debit card", "E-wallet", "Online banking"].map((item) => (
            <label key={item} className={`flex items-center gap-3 border-t border-[#E4E1DC] px-4 py-4 text-[15px] font-semibold first:border-t-0 ${method === item ? "bg-[#FBE9EA]" : ""}`}>
              <input type="radio" name="method" className="h-5 w-5 accent-[#D0202E]" checked={method === item} onChange={() => setMethod(item)} />
              {item}
            </label>
          ))}
        </div>
        <p className="m-0 text-[13px] leading-normal text-[#5C5C63]">
          [Payment methods depend on the gateway — to confirm.] Your receipt goes to {attendee.email} and {attendee.mobile}.
        </p>
        {payError ? <p className="m-0 text-sm text-[#A8131F]">{payError}</p> : null}
      </Frame>
    );
  }

  if (step === "done" && saved) return <Confirmed record={saved} onManage={() => setStep("manage")} />;
  if (step === "manage") return <Manage onStart={() => setStep("start")} />;
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

function Manage({ onStart }: { onStart: () => void }) {
  const [record, setRecord] = useState<StoredRegistration | null>(null);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ fullName: string; tierName: string; maskedEmail: string } | null>(null);
  const [lookedUp, setLookedUp] = useState(false);
  const [maskedEmail, setMaskedEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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
      setRecord(payload);
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : "That code is wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (!record) {
    return (
      <Frame label="My registration">
        <button type="button" className="self-start text-sm text-[#A8131F]" onClick={onStart}>← Back</button>
        <div className="flex flex-col gap-1.5">
          <h1 className="m-0 font-archivo text-[26px] leading-[1.1] font-extrabold">My registration</h1>
          <p className="m-0 text-[15px] leading-normal text-[#5C5C63]">Use the email or mobile number on your registration.</p>
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
            <p className="m-0 text-sm text-[#5C5C63]">We'll send a code to {found.maskedEmail}. Check your email.</p>
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
              <span className="text-xs font-bold tracking-[0.12em] text-[#A8131F] uppercase">Due {formatMonthDate(due.dueOn)}</span>
              <span className="text-sm text-[#5C5C63]">Payment {record.payments.indexOf(due) + 1} of {record.payments.length}</span>
            </div>
            <span className="font-archivo text-[26px] font-extrabold">{money(due.amountCents, record.currency)}</span>
          </div>
          <p className="m-0 text-[13px] leading-snug text-[#5C5C63]">IBMC records this payment. Nothing is charged on this page.</p>
          {keepUntil ? (
            <p className="m-0 text-[13px] leading-snug text-[#5C5C63]">
              Pay by {formatMonthDate(keepUntil)} to keep your {money(record.totalCents, record.currency)} rate. After that, your ticket moves to the Regular rate of ₱18,000.
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-col rounded-[14px] border border-[#E4E1DC] bg-white px-4 py-1 text-sm">
        {record.payments.map((item) => (
          <div key={`${item.dueOn}-${item.label}`} className={`flex justify-between gap-2 border-t border-[#F0EDE8] py-2.5 first:border-t-0 ${item.status === "due" ? "font-bold text-[#A8131F]" : item.status === "upcoming" ? "text-[#5C5C63]" : ""}`}>
            <span>{item.status === "paid" && item.label.includes("secure your seat") ? formatLongDate(item.dueOn).replace(",", "") + " · secure your seat" : item.label}</span>
            <span>
              <span className={item.status === "due" ? "" : "text-[#5C5C63]"}>{item.status === "paid" ? "Paid" : item.status === "due" ? "Due" : "Upcoming"} · </span>
              {money(item.amountCents, record.currency)}
            </span>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between gap-3 rounded-[14px] bg-[#E4E1DC] px-4 py-3.5">
        <span className="flex flex-col gap-0.5">
          <span className="text-[15px] font-bold">QR ticket</span>
          <span className="text-[13px] text-[#3A3A40]">{record.planStatus === "fully_paid" ? "Sent to your email and SMS" : "Unlocks when you're fully paid"}</span>
        </span>
        <span className="text-xs font-bold tracking-[0.1em] text-[#3A3A40] uppercase">{record.planStatus === "fully_paid" ? "Sent" : "Locked"}</span>
      </div>
    </Frame>
  );
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
