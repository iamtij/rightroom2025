import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type FormEvent, type ReactNode } from "react";
import { formatFeePercentInput, formatFeePesoInput } from "../../server/convenience-fee.js";
import { previewTemplate, smsCreditCount } from "../../server/templates.js";

const field = "rounded-[10px] border border-[#D9D5CF] bg-white px-3 py-2.5 text-sm font-normal text-[#141416]";
const labelClass = "flex flex-col gap-1 text-[13px] font-semibold text-[#3A3A40]";
const buttonClass = "rounded-full bg-[#D0202E] px-4 py-2.5 text-sm font-bold text-white disabled:bg-[#E4A0A6]";

type Product = { code: string; name: string; allows_installment: number; currency: string };
type Template = { id: number; name: string; channel: "email" | "sms"; subject: string | null; body: string; system_key: string | null };
type Schedule = {
  id: number;
  name: string;
  template_id: number;
  template_name: string;
  channel: string;
  trigger: string;
  days_offset: number;
  start_on: string | null;
  send_time: string;
  frequency: string;
  ends_on: string | null;
  ends_after: number | null;
  audience: string;
  enabled: number;
  system_key: string | null;
};
type Coupon = {
  id: number;
  code: string;
  discount_type: string;
  discount_value: number;
  currency: string | null;
  ticket_code: string | null;
  email: string | null;
  usage_limit: number | null;
  usage_count: number;
  expires_on: string | null;
};
type Member = {
  id: number;
  fullName: string;
  email: string;
  mobile: string;
  chapter: string;
  category: string;
  businessName: string;
  ticketType: string;
  regStatus: "updated" | "delayed" | "cancelled";
  country: string;
  goldClub: boolean;
};
type Payment = { label: string; dueOn: string; amountCents: number; amountPaidCents?: number; status: "paid" | "due" | "upcoming" };
type LedgerTransaction = {
  at: string;
  provider: string;
  channel: string;
  status: string;
  amountCents: number;
  reference: string;
  gateway: string;
  recorded: boolean;
};
type Registration = {
  reference: string;
  status: string;
  registeredOn?: string;
  attendee: { fullName: string; email: string; mobile: string; business?: string; industry?: string; chapter?: string };
  tierName: string;
  plan: string;
  currency: "PHP" | "USD";
  totalCents: number;
  balanceCents: number;
  planStatus: string;
  qrReady: boolean;
  payments: Payment[];
  transactions?: LedgerTransaction[];
};

async function api(path: string, options: RequestInit = {}) {
  const response = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Request failed");
  return payload;
}

const tableClass = "w-full min-w-[760px] border-collapse text-left text-sm";
const thClass = "whitespace-nowrap px-3 py-2.5 text-[12px] font-semibold text-[#5C5C63]";
const tdClass = "border-t border-[#F0EDE8] px-3 py-3 align-middle";
const linkButton = "font-semibold text-[#A8131F]";
const ghostButton = "rounded-full border border-[#D9D5CF] bg-white px-4 py-2.5 text-sm font-semibold text-[#3A3A40]";

function money(cents: number, currency: "PHP" | "USD") {
  const amount = (cents / 100).toLocaleString(currency === "USD" ? "en-US" : "en-PH", { maximumFractionDigits: 0 });
  return currency === "USD" ? `USD ${amount}` : `₱${amount}`;
}

function matches(query: string, parts: Array<string | number | null | undefined>) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return parts.filter((part) => part !== null && part !== undefined && String(part) !== "").join(" ").toLowerCase().includes(needle);
}

function titleCase(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <input className={`${field} w-full`} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />;
}

function DataTable({ columns, children, empty }: { columns: string[]; children: ReactNode; empty: string }) {
  return (
    <div className="overflow-x-auto rounded-[14px] border border-[#E4E1DC] bg-white">
      {empty ? <p className="m-0 px-3 py-4 text-sm text-[#5C5C63]">{empty}</p> : (
        <table className={tableClass}>
          <thead>
            <tr>{columns.map((column) => <th key={column} className={thClass}>{column}</th>)}</tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      )}
    </div>
  );
}

type DashboardData = {
  signups: { total: number; confirmed: number; cancelled: number; firstMovers: number; firstMoversCancelled: number; firstMoverPercent: number | null };
  tickets: { code: string; name: string; currency: "PHP" | "USD"; signups: number; cancelled: number; fullyPaid: number; collectedCents: number; bookedCents: number }[];
  plans: { payInFull: number; installment: number; fullyPaid: number; owing: number };
  money: { currency: "PHP" | "USD"; collectedCents: number; outstandingCents: number }[];
  byDay: { day: string; signups: number }[];
  dueSoon: { through: string; rows: { currency: "PHP" | "USD"; count: number; cents: number }[] };
  roster: { total: number; updated: number; delayed: number; cancelled: number; updatedPercent: number | null; delayedPercent: number | null; cancelledPercent: number | null; goldClub: number };
  firstMoverRoster: { total: number; updated: number; delayed: number; cancelled: number; updatedPercent: number | null; delayedPercent: number | null; cancelledPercent: number | null };
  paymentMethods: {
    channel: string;
    label: string;
    currency: string;
    count: number;
    cents: number;
    methods: { code: string; label: string; count: number; cents: number }[];
  }[];
};

const chartColors = { updated: "#141416", delayed: "#D0202E", cancelled: "#B7B3AD", confirmed: "#D0202E", track: "#F0EDE8", installment: "#FF4D5A" };

function share(value: number | null) {
  return value === null ? "—" : `${value}%`;
}

function shortDate(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)));
}

function Peso({ cents }: { cents: number }) {
  const amount = (cents / 100).toLocaleString("en-PH", { maximumFractionDigits: 0 });
  return (
    <span>
      <span className="font-sans font-semibold" style={{ fontStretch: "100%" }}>₱</span>
      {amount}
    </span>
  );
}

function Kpi({ label, value, note, accent }: { label: string; value: ReactNode; note: string; accent?: boolean }) {
  return (
    <article className="rounded-[14px] border border-[#E4E1DC] bg-white p-4">
      <p className="m-0 text-[12px] font-semibold uppercase tracking-[0.04em] text-[#5C5C63]">{label}</p>
      <p className={`m-0 mt-2 font-archivo text-[34px] font-extrabold leading-none ${accent ? "text-[#D0202E]" : ""}`}>{value}</p>
      <p className="m-0 mt-2 min-h-5 text-[13px] text-[#5C5C63]">{note}</p>
    </article>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-[14px] border border-[#E4E1DC] bg-white p-4">
      <h2 className="m-0 text-[15px] font-bold">{title}</h2>
      {children}
    </section>
  );
}

function Donut({ slices, center, caption }: { slices: { label: string; value: number; color: string }[]; center: string; caption: string }) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  let cursor = 0;
  const arcs = total === 0 ? [] : slices.filter((slice) => slice.value > 0).map((slice) => {
    const length = (slice.value / total) * circumference;
    const arc = { ...slice, length, offset: cursor };
    cursor += length;
    return arc;
  });
  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg viewBox="0 0 120 120" className="h-36 w-36 shrink-0" role="img" aria-label={caption}>
        <circle cx="60" cy="60" r={radius} fill="none" stroke={chartColors.track} strokeWidth="14" />
        {arcs.length === 1 ? <circle cx="60" cy="60" r={radius} fill="none" stroke={arcs[0].color} strokeWidth="14" /> : arcs.map((arc) => (
          <circle
            key={arc.label}
            cx="60"
            cy="60"
            r={radius}
            fill="none"
            stroke={arc.color}
            strokeWidth="14"
            strokeDasharray={`${arc.length} ${circumference - arc.length}`}
            strokeDashoffset={-arc.offset}
            transform="rotate(-90 60 60)"
          />
        ))}
        <text x="60" y="58" textAnchor="middle" fill="#141416" fontSize="22" fontWeight="800">{center}</text>
        <text x="60" y="74" textAnchor="middle" fill="#5C5C63" fontSize="10">{caption}</text>
      </svg>
      <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
        {slices.map((slice) => (
          <li key={slice.label} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: slice.color }} />{slice.label}</span>
            <span className="font-semibold">{slice.value}{total ? ` · ${Math.round((slice.value / total) * 100)}%` : ""}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function statusSlices(group: DashboardData["firstMoverRoster"]) {
  return [
    { label: "Updated", value: group.updated, color: chartColors.updated },
    { label: "Delayed", value: group.delayed, color: chartColors.delayed },
    { label: "Cancelled", value: group.cancelled, color: chartColors.cancelled },
  ];
}

function StackedBars({ rows }: { rows: { label: string; detail: string; parts: { value: number; color: string; name: string }[] }[] }) {
  const max = Math.max(...rows.map((row) => row.parts.reduce((sum, part) => sum + part.value, 0)), 1);
  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => (
        <div key={row.label}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span>{row.label}</span>
            <span className="text-right text-[#5C5C63]">{row.detail}</span>
          </div>
          <div className="flex h-3 overflow-hidden rounded-full bg-[#F0EDE8]" role="img" aria-label={`${row.label}: ${row.detail}`}>
            {row.parts.map((part) => (
              <span key={part.name} className="h-3" style={{ width: `${(part.value / max) * 100}%`, background: part.color }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function paymentCount(count: number) {
  if (!count) return "No payments";
  return count === 1 ? "1 payment" : `${count} payments`;
}

function currencyName(currency: string) {
  if (currency === "PHP") return "Pesos";
  if (currency === "USD") return "US dollars";
  return currency;
}

function MethodAmount({ cents, currency }: { cents: number; currency: string }) {
  if (currency === "PHP") return <Peso cents={cents} />;
  if (currency === "USD") return <>{money(cents, "USD")}</>;
  const amount = (cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 });
  return <>{currency} {amount}</>;
}

function MethodRow({ label, detail, summary, cents, max, nested }: { label: string; detail: ReactNode; summary: string; cents: number; max: number; nested?: boolean }) {
  const width = max > 0 ? Math.max(cents > 0 ? 2 : 0, Math.round((cents / max) * 100)) : 0;
  return (
    <div className={nested ? "pl-4" : ""}>
      <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
        <span className={`min-w-0 ${nested ? "" : "font-semibold"}`}>{label}</span>
        <span className="shrink-0 text-right text-[#5C5C63]">{detail}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[#F0EDE8]" role="img" aria-label={summary}>
        <div className={`h-2 rounded-full ${nested ? "bg-[#FF4D5A]" : "bg-[#D0202E]"}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function Columns({ rows }: { rows: { label: string; value: number }[] }) {
  const max = Math.max(...rows.map((row) => row.value), 1);
  return (
    <div className="flex h-44 items-end gap-2">
      {rows.map((row) => (
        <div key={row.label} className="flex min-w-0 flex-1 flex-col items-center gap-2">
          <span className="text-xs font-semibold">{row.value}</span>
          <div className="flex h-28 w-full items-end rounded-t-[6px] bg-[#F6F4F1]">
            <div className="w-full rounded-t-[6px] bg-[#D0202E]" style={{ height: `${Math.max(8, Math.round((row.value / max) * 100))}%` }} />
          </div>
          <span className="truncate text-[11px] text-[#5C5C63]">{row.label}</span>
        </div>
      ))}
    </div>
  );
}

function Dashboard({ onError }: { onError: (message: string) => void }) {
  const [data, setData] = useState<DashboardData | null>(null);
  useEffect(() => { api("/api/admin/dashboard").then(setData).catch((error) => onError(error.message)); }, []);
  if (!data) return <p className="m-0 text-sm text-[#5C5C63]">Loading dashboard…</p>;
  const pesos = data.money.find((row) => row.currency === "PHP");
  const firstMoverNote = data.signups.firstMoverPercent === null
    ? (data.signups.firstMoversCancelled ? `${data.signups.firstMoversCancelled} cancelled` : "No confirmed signups yet")
    : `${share(data.signups.firstMoverPercent)} of confirmed${data.signups.firstMoversCancelled ? ` · ${data.signups.firstMoversCancelled} cancelled` : ""}`;
  return (
    <section className="flex flex-col gap-4">
      <h1 className="m-0 font-archivo text-[28px] font-extrabold">Dashboard</h1>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Kpi label="Total signups" value={data.signups.total} note={`${data.signups.confirmed} confirmed · ${data.signups.cancelled} cancelled`} />
        <Kpi label="Fully paid" value={data.plans.fullyPaid} note={data.signups.confirmed ? `${Math.round((data.plans.fullyPaid / data.signups.confirmed) * 100)}% of confirmed` : "No confirmed signups yet"} />
        <Kpi label="First movers" value={data.signups.firstMovers} note={firstMoverNote} />
        <Kpi label="Updated" value={share(data.roster.updatedPercent)} note={`${data.roster.updated} of ${data.roster.total} on the roster`} />
        <Kpi label="Delayed" value={share(data.roster.delayedPercent)} note={`${data.roster.delayed} of ${data.roster.total} on the roster`} accent />
        <Kpi label="Collected" value={<Peso cents={pesos?.collectedCents ?? 0} />} note="Confirmed registrations, pesos" />
        <Kpi label="Still due" value={<Peso cents={pesos?.outstandingCents ?? 0} />} note={data.dueSoon.rows.length === 0 ? `Nothing due through ${shortDate(data.dueSoon.through)}` : data.dueSoon.rows.map((row) => `${money(row.cents, row.currency)} by ${shortDate(data.dueSoon.through)}`).join(" · ")} accent />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Roster status">
          <Donut slices={statusSlices(data.roster)} center={String(data.roster.total)} caption="Roster" />
          <p className="m-0 text-[13px] text-[#5C5C63]">{data.roster.goldClub} gold club {data.roster.goldClub === 1 ? "member" : "members"}</p>
        </Panel>
        <Panel title="First movers on the roster">
          <Donut slices={statusSlices(data.firstMoverRoster)} center={String(data.firstMoverRoster.total)} caption="On roster" />
        </Panel>
      </div>
      <Panel title="Signups by ticket">
        <StackedBars rows={data.tickets.map((ticket) => {
          const stillOwing = Math.max(0, ticket.signups - ticket.fullyPaid);
          return {
            label: ticket.name,
            detail: `${ticket.signups} confirmed · ${ticket.fullyPaid} fully paid · ${ticket.cancelled} cancelled`,
            parts: [
              { value: ticket.fullyPaid, color: chartColors.updated, name: "fully paid" },
              { value: stillOwing, color: chartColors.confirmed, name: "still owing" },
              { value: ticket.cancelled, color: chartColors.cancelled, name: "cancelled" },
            ],
          };
        })} />
        <p className="m-0 flex flex-wrap gap-4 text-[13px] text-[#5C5C63]">
          <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-[#141416]" />Fully paid</span>
          <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-[#D0202E]" />Still owing</span>
          <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-[#B7B3AD]" />Cancelled</span>
        </p>
      </Panel>
      <Panel title="Payments by method">
        <p className="m-0 text-[13px] leading-normal text-[#5C5C63]">Recorded payments on confirmed registrations. A channel line is the sum of its methods. Bar lengths compare amounts in the same currency.</p>
        <div className="flex flex-col gap-4">
          {[...(data.paymentMethods ?? [])].sort((left, right) => {
            if (left.currency === right.currency) return 0;
            if (left.currency === "PHP") return -1;
            if (right.currency === "PHP") return 1;
            return left.currency.localeCompare(right.currency);
          }).map((channel, index, rows) => {
            const max = Math.max(...rows.filter((row) => row.currency === channel.currency).map((row) => row.cents), 1);
            const showCurrency = new Set(rows.map((row) => row.currency)).size > 1 && rows[index - 1]?.currency !== channel.currency;
            return (
              <div key={`${channel.channel}-${channel.currency}`} className="flex flex-col gap-2">
                {showCurrency ? <h3 className="m-0 text-[12px] font-semibold uppercase tracking-[0.04em] text-[#5C5C63]">{currencyName(channel.currency)}</h3> : null}
                <MethodRow
                  label={channel.label}
                  cents={channel.cents}
                  max={max}
                  summary={`${channel.label}, ${channel.currency} ${channel.cents / 100}, ${paymentCount(channel.count)}`}
                  detail={<><MethodAmount cents={channel.cents} currency={channel.currency} /> · {paymentCount(channel.count)}</>}
                />
                {channel.methods.map((method) => (
                  <MethodRow
                    key={method.code}
                    nested
                    label={method.label}
                    cents={method.cents}
                    max={max}
                    summary={`${method.label}, ${channel.currency} ${method.cents / 100}, ${paymentCount(method.count)}`}
                    detail={<><MethodAmount cents={method.cents} currency={channel.currency} /> · {paymentCount(method.count)}</>}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </Panel>
      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Payments">
          <Donut
            slices={[
              { label: "Fully paid", value: data.plans.fullyPaid, color: chartColors.updated },
              { label: "Still owing", value: data.plans.owing, color: chartColors.delayed },
            ]}
            center={String(data.signups.confirmed)}
            caption="Confirmed"
          />
          <StackedBars rows={[
            ...data.money.map((row) => ({
              label: row.currency === "USD" ? "US dollars" : "Pesos",
              detail: `${money(row.collectedCents, row.currency)} collected · ${money(row.outstandingCents, row.currency)} still due`,
              parts: [
                { value: row.collectedCents, color: chartColors.confirmed, name: "collected" },
                { value: row.outstandingCents, color: chartColors.cancelled, name: "still due" },
              ],
            })),
            {
              label: "Plan",
              detail: `${data.plans.payInFull} pay in full · ${data.plans.installment} installment`,
              parts: [
                { value: data.plans.payInFull, color: chartColors.updated, name: "pay in full" },
                { value: data.plans.installment, color: chartColors.installment, name: "installment" },
              ],
            },
          ]} />
        </Panel>
        <Panel title="Signups by date">
          {data.byDay.length === 0 ? <p className="m-0 text-sm text-[#5C5C63]">Confirmed signups will show here by date.</p> : <Columns rows={data.byDay.map((day) => ({ label: shortDate(day.day), value: day.signups }))} />}
        </Panel>
      </div>
    </section>
  );
}

function CheckIn({ onError }: { onError: (message: string) => void }) {
  const [token, setToken] = useState("");
  const [result, setResult] = useState("");
  const [duplicate, setDuplicate] = useState(false);
  const [busy, setBusy] = useState(false);

  async function scan(override = false) {
    setBusy(true);
    setResult("");
    if (!override) setDuplicate(false);
    try {
      const response = await fetch("/api/admin/passes/check-in", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, override }),
      });
      const payload = await response.json();
      if (response.status === 409) {
        setDuplicate(true);
        setResult(payload.pass ? `${payload.pass.fullName} · ${payload.pass.reference} was already scanned.` : "This ticket was already scanned.");
        return;
      }
      if (!response.ok) throw new Error(payload.error || "This QR ticket isn't valid.");
      setDuplicate(false);
      setResult(`${payload.result === "override" ? "Override admitted" : "Admitted"} ${payload.pass.fullName} · ${payload.pass.reference}`);
      setToken("");
    } catch (error) {
      onError(error instanceof Error ? error.message : "Check-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex max-w-[520px] flex-col gap-3">
      <h1 className="m-0 font-archivo text-[28px] font-extrabold">Check-in</h1>
      <p className="m-0 text-sm text-[#5C5C63]">Paste the pass link or token. A second scan needs an override.</p>
      <form className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); scan(false); }}>
        <input className={field} value={token} placeholder="Pass link or token" onChange={(event) => setToken(event.target.value)} />
        <div className="flex gap-2">
          <button type="submit" className={buttonClass} disabled={busy || !token.trim()}>Admit</button>
          {duplicate ? <button type="button" className={ghostButton} disabled={busy} onClick={() => scan(true)}>Override</button> : null}
        </div>
      </form>
      {result ? <p className="m-0 text-sm font-semibold">{result}</p> : null}
    </section>
  );
}

type AdminAccount = {
  id: number;
  email: string;
  role: "super" | "admin";
  authenticator: boolean;
  createdAt: string;
};

function Admins({ onError }: { onError: (message: string) => void }) {
  const [rows, setRows] = useState<AdminAccount[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [adding, setAdding] = useState(false);
  async function load() { setRows(await api("/api/admin/admins")); }
  useEffect(() => { load().catch((error) => onError(error.message)); }, []);
  async function save(event: FormEvent) {
    event.preventDefault();
    onError("");
    setAdding(true);
    try {
      await api("/api/admin/admins", { method: "POST", body: JSON.stringify({ email, password }) });
      setEmail("");
      setPassword("");
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not add the admin");
    } finally {
      setAdding(false);
    }
  }
  return (
    <section className="flex flex-col gap-3">
      <h1 className="m-0 font-archivo text-[28px] font-extrabold">Admins</h1>
      <p className="m-0 max-w-[640px] text-sm leading-normal text-[#5C5C63]">People you add can use every section except this one. They set up an authenticator code the first time they sign in.</p>
      <form className="flex flex-wrap items-end gap-3 rounded-[14px] border border-[#E4E1DC] bg-white p-4" onSubmit={save}>
        <Field label="Email"><input className={field} type="email" required autoComplete="off" value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
        <Field label="Password"><input className={field} type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></Field>
        <button type="submit" className={buttonClass} disabled={adding}>{adding ? "Adding" : "Add admin"}</button>
        <p className="m-0 w-full text-[13px] text-[#5C5C63]">Use at least 8 characters. This person is an admin, not a super admin.</p>
      </form>
      <DataTable columns={["Email", "Access", "Authenticator", "Added"]} empty={rows.length === 0 ? "No admins yet." : ""}>
        {rows.map((row) => (
          <tr key={row.id}>
            <td className={`${tdClass} font-semibold`}>{row.email}</td>
            <td className={tdClass}>{row.role === "super" ? "Super admin" : "Admin"}</td>
            <td className={tdClass}>{row.authenticator ? "Ready" : "Waiting for first sign-in"}</td>
            <td className={tdClass}>{row.createdAt?.slice(0, 10) || ""}</td>
          </tr>
        ))}
      </DataTable>
    </section>
  );
}

export function AdminSections() {
  const [section, setSection] = useState("Dashboard");
  const [error, setError] = useState("");
  const [role, setRole] = useState<"super" | "admin" | "">("");
  useEffect(() => {
    api("/api/admin/me").then((me) => setRole(me.role === "super" ? "super" : "admin")).catch(() => setRole("admin"));
  }, []);
  const sections = ["Dashboard", "Registrations", "Check-in", "Coupons", "Schedule", "Templates", "Members", "Chapters", "Settings", ...(role === "super" ? ["Admins"] : [])];
  return (
    <div className="flex flex-col gap-5">
      <nav className="flex flex-wrap gap-2">
        {sections.map((item) => (
          <button
            key={item}
            type="button"
            className={`rounded-full px-4 py-2 text-sm font-semibold ${section === item ? "bg-[#141416] text-white" : "bg-white text-[#3A3A40]"}`}
            onClick={() => { setSection(item); setError(""); }}
          >
            {item}
          </button>
        ))}
      </nav>
      {error ? <p className="m-0 text-sm text-[#A8131F]">{error}</p> : null}
      {section === "Dashboard" ? <Dashboard onError={setError} /> : null}
      {section === "Registrations" ? <Registrations onError={setError} /> : null}
      {section === "Check-in" ? <CheckIn onError={setError} /> : null}
      {section === "Coupons" ? <Coupons onError={setError} /> : null}
      {section === "Schedule" ? <Schedules onError={setError} /> : null}
      {section === "Templates" ? <Templates onError={setError} /> : null}
      {section === "Members" ? <Members onError={setError} /> : null}
      {section === "Chapters" ? <Chapters onError={setError} /> : null}
      {section === "Settings" ? <PaymentSettingsScreen role={role} onError={setError} /> : null}
      {section === "Admins" && role === "super" ? <Admins onError={setError} /> : null}
    </div>
  );
}

const emptyRegistration = { fullName: "", email: "", mobile: "", business: "", industry: "", chapter: "", productCode: "first_mover", paymentPlan: "full" };

function registrationListStatus(row: Registration) {
  if (row.status === "cancelled") return "cancelled";
  if (row.balanceCents === 0) return "fully_paid";
  return "active";
}

function registrationStatusLabel(row: Registration) {
  const status = registrationListStatus(row);
  if (status === "fully_paid") return "Fully paid";
  if (status === "cancelled") return "Cancelled";
  return "Active";
}

function planPlace(row: Registration) {
  if (row.status === "cancelled") return "This registration is cancelled.";
  const total = row.payments.length;
  const paidCount = row.payments.filter((item) => item.status === "paid").length;
  const due = row.payments.find((item) => item.status === "due");
  if (!due && row.balanceCents === 0) return `Paid in full. ${paidCount} of ${total} payments are complete.`;
  if (due) return `Payment ${paidCount + 1} of ${total} is due. ${money(row.balanceCents, row.currency)} is still left.`;
  return `${paidCount} of ${total} payments are recorded. ${money(row.balanceCents, row.currency)} is still left.`;
}

function RegistrationView({
  row,
  editing,
  draft,
  setDraft,
  chapters,
  onSave,
  onEdit,
  onCloseEdit,
  onClose,
  onCancel,
}: {
  row: Registration;
  editing: boolean;
  draft: typeof emptyRegistration;
  setDraft: (value: typeof emptyRegistration) => void;
  chapters: Chapter[];
  onSave: () => void;
  onEdit: () => void;
  onCloseEdit: () => void;
  onClose: () => void;
  onCancel: () => void;
}) {
  const details = [
    ["Name", row.attendee.fullName],
    ["Email", row.attendee.email],
    ["Mobile", row.attendee.mobile],
    ["Business", row.attendee.business || ""],
    ["Category", row.attendee.industry || ""],
    ["Chapter", row.attendee.chapter || ""],
    ["Ticket", row.tierName],
    ["Reference", row.reference],
    ["Registered", row.registeredOn || ""],
    ["Status", registrationStatusLabel(row)],
  ];
  return (
    <section className="flex flex-col gap-4 rounded-[14px] border border-[#E4E1DC] bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="m-0 text-xs font-bold tracking-[0.16em] text-[#A8131F] uppercase">Registration</p>
          <h2 className="m-0 mt-1 font-archivo text-[24px] leading-tight font-extrabold">{row.attendee.fullName}</h2>
          <p className="m-0 mt-1 text-sm text-[#5C5C63]">{row.reference} · {row.tierName}</p>
        </div>
        <button type="button" className={ghostButton} onClick={onClose}>Close</button>
      </div>
      <p className="m-0 rounded-[10px] bg-[#F6F4F1] px-3 py-2 text-sm font-semibold">{planPlace(row)}</p>
      {editing ? (
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); onSave(); }}>
          <Field label="Name"><input className={field} required value={draft.fullName} onChange={(event) => setDraft({ ...draft, fullName: event.target.value })} /></Field>
          <Field label="Email"><input className={field} type="email" required value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} /></Field>
          <Field label="Mobile"><input className={field} required value={draft.mobile} onChange={(event) => setDraft({ ...draft, mobile: event.target.value })} /></Field>
          <Field label="Business"><input className={field} value={draft.business} onChange={(event) => setDraft({ ...draft, business: event.target.value })} /></Field>
          <Field label="Category"><input className={field} value={draft.industry} onChange={(event) => setDraft({ ...draft, industry: event.target.value })} /></Field>
          <Field label="Chapter">
            <select className={field} value={draft.chapter} onChange={(event) => setDraft({ ...draft, chapter: event.target.value })}>
              <option value="">Select a chapter</option>
              {draft.chapter && !chapters.some((chapter) => chapter.name.toLowerCase() === draft.chapter.toLowerCase()) ? <option value={draft.chapter}>{draft.chapter}</option> : null}
              {chapters.map((chapter) => <option key={chapter.id} value={chapter.name}>{chapter.name}</option>)}
            </select>
          </Field>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <button type="submit" className={buttonClass}>Save edits</button>
            <button type="button" className={ghostButton} onClick={onCloseEdit}>Done</button>
          </div>
        </form>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {details.map(([label, value]) => (
            <div key={label} className="flex flex-col gap-0.5">
              <span className="text-[12px] font-semibold text-[#5C5C63]">{label}</span>
              <span className="text-sm">{value || "—"}</span>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-col gap-2">
        <h3 className="m-0 text-[15px] font-bold">Payment plan</h3>
        <p className="m-0 text-sm text-[#5C5C63]">{row.plan === "installment" ? "Installment" : "Paid in full"} · {money(row.totalCents, row.currency)} total · {money(row.totalCents - row.balanceCents, row.currency)} paid</p>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr>{["Step", "Due", "Amount", "Paid", "Place"].map((column) => <th key={column} className={thClass}>{column}</th>)}</tr>
            </thead>
            <tbody>
              {row.payments.map((item, index) => (
                <tr key={`${item.dueOn}-${index}`}>
                  <td className={tdClass}>{index + 1}</td>
                  <td className={tdClass}>{item.label}</td>
                  <td className={tdClass}>{money(item.amountCents, row.currency)}</td>
                  <td className={tdClass}>{money(item.amountPaidCents || 0, row.currency)}</td>
                  <td className={tdClass}>{item.status === "due" ? "Due now" : item.status === "paid" ? "Paid" : "Upcoming"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="m-0 text-[15px] font-bold">Transactions</h3>
        {(row.transactions || []).length === 0 ? <p className="m-0 text-sm text-[#5C5C63]">No payment attempts yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <thead>
                <tr>{["When", "Provider", "Channel", "Status", "Amount", "Reference", "Gateway", "On the record"].map((column) => <th key={column} className={thClass}>{column}</th>)}</tr>
              </thead>
              <tbody>
                {(row.transactions || []).map((item) => (
                  <tr key={`${item.provider}-${item.reference}-${item.at}`}>
                    <td className={tdClass}>{item.at ? String(item.at).slice(0, 16).replace("T", " ") : "—"}</td>
                    <td className={tdClass}>{item.provider}</td>
                    <td className={tdClass}>{item.channel || "—"}</td>
                    <td className={tdClass}>{titleCase(item.status || "")}</td>
                    <td className={tdClass}>{money(item.amountCents, row.currency)}</td>
                    <td className={`${tdClass} font-mono text-[12px]`}>{item.reference || "—"}</td>
                    <td className={tdClass}>{item.gateway || "—"}</td>
                    <td className={tdClass}>{item.recorded ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {editing ? null : <button type="button" className={buttonClass} onClick={onEdit}>Edit</button>}
        {row.status !== "cancelled" ? <button type="button" className="rounded-full border border-[#D0202E] px-4 py-2.5 text-sm font-bold text-[#A8131F]" onClick={onCancel}>Cancel registration</button> : null}
      </div>
    </section>
  );
}

function Registrations({ onError }: { onError: (message: string) => void }) {
  const [rows, setRows] = useState<Registration[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [editor, setEditor] = useState<null | "add" | Registration>(null);
  const [viewing, setViewing] = useState<Registration | null>(null);
  const [editingDetails, setEditingDetails] = useState(false);
  const [draft, setDraft] = useState(emptyRegistration);
  const [cancelTarget, setCancelTarget] = useState<null | { reference: string; name: string }>(null);

  async function load() {
    const [registrations, ticketProducts, chapterRows] = await Promise.all([
      api("/api/admin/registrations"),
      api("/api/admin/products"),
      api("/api/admin/chapters"),
    ]);
    setRows(registrations);
    setProducts(ticketProducts);
    setChapters(chapterRows);
    setViewing((current) => current ? registrations.find((row: Registration) => row.reference === current.reference) || null : null);
  }

  function openView(row: Registration) {
    setViewing(row);
    setEditingDetails(false);
    setDraft({
      fullName: row.attendee.fullName,
      email: row.attendee.email,
      mobile: row.attendee.mobile,
      business: row.attendee.business || "",
      industry: row.attendee.industry || "",
      chapter: row.attendee.chapter || "",
      productCode: "first_mover",
      paymentPlan: row.plan,
    });
  }
  useEffect(() => { load().catch((error) => onError(error.message)); }, []);

  async function addManual(event: FormEvent) {
    event.preventDefault();
    try {
      await api("/api/admin/registrations", { method: "POST", body: JSON.stringify(draft) });
      setEditor(null);
      setDraft(emptyRegistration);
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not add the registration");
    }
  }

  async function save(event?: FormEvent) {
    event?.preventDefault();
    if (!viewing) return;
    try {
      await api(`/api/admin/registrations/${viewing.reference}`, { method: "PATCH", body: JSON.stringify(draft) });
      setEditingDetails(false);
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not save");
    }
  }

  async function confirmCancel() {
    if (!cancelTarget) return;
    const reference = cancelTarget.reference;
    setCancelTarget(null);
    try {
      await api(`/api/admin/registrations/${reference}/cancel`, { method: "POST" });
      if (viewing?.reference === reference) setViewing(null);
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not cancel");
    }
  }

  const visible = rows.filter((row) => {
    if (statusFilter && registrationListStatus(row) !== statusFilter) return false;
    return matches(query, [row.attendee.fullName, row.attendee.email, row.attendee.mobile, row.reference, row.tierName, row.attendee.business, row.attendee.chapter, row.status]);
  });
  const empty = rows.length === 0 ? "No registrations yet." : visible.length === 0 ? "No registrations match those filters." : "";

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 font-archivo text-[28px] font-extrabold">Registrations</h1>
        <button type="button" className={buttonClass} onClick={() => { setEditor("add"); setDraft(emptyRegistration); }}>Add manual</button>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[240px] flex-1">
          <SearchBox value={query} onChange={setQuery} placeholder="Search name, email, mobile, or reference" />
        </div>
        <Field label="Status">
          <select className={`${field} min-w-[160px]`} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="fully_paid">Fully paid</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </Field>
      </div>
      {editor === "add" ? (
        <form className="grid gap-3 rounded-[14px] border border-[#E4E1DC] bg-white p-4 sm:grid-cols-2" onSubmit={addManual}>
          <Field label="Name"><input className={field} required value={draft.fullName} onChange={(event) => setDraft({ ...draft, fullName: event.target.value })} /></Field>
          <Field label="Email"><input className={field} type="email" required value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} /></Field>
          <Field label="Mobile"><input className={field} required value={draft.mobile} onChange={(event) => setDraft({ ...draft, mobile: event.target.value })} /></Field>
          <Field label="Business"><input className={field} value={draft.business} onChange={(event) => setDraft({ ...draft, business: event.target.value })} /></Field>
          <Field label="Ticket">
            <select className={field} value={draft.productCode} onChange={(event) => setDraft({ ...draft, productCode: event.target.value })}>
              {products.map((product) => <option key={product.code} value={product.code}>{product.name}</option>)}
            </select>
          </Field>
          <Field label="Plan">
            <select className={field} value={draft.paymentPlan} onChange={(event) => setDraft({ ...draft, paymentPlan: event.target.value })}>
              <option value="full">Pay in full</option>
              <option value="installment">Installment</option>
            </select>
          </Field>
          <div className="flex gap-2 sm:col-span-2">
            <button type="submit" className={buttonClass}>Save registration</button>
            <button type="button" className={ghostButton} onClick={() => setEditor(null)}>Back</button>
          </div>
        </form>
      ) : null}
      {viewing ? <RegistrationView row={viewing} editing={editingDetails} draft={draft} setDraft={setDraft} chapters={chapters} onSave={save} onEdit={() => setEditingDetails(true)} onCloseEdit={() => setEditingDetails(false)} onClose={() => { setViewing(null); setEditingDetails(false); }} onCancel={() => setCancelTarget({ reference: viewing.reference, name: viewing.attendee.fullName })} /> : null}
      <DataTable columns={["Name", "Email", "Mobile", "Reference", "Ticket", "Paid", "Left", "Status", ""]} empty={empty}>
        {visible.map((row) => (
          <tr key={row.reference}>
            <td className={`${tdClass} font-semibold`}>{row.attendee.fullName}</td>
            <td className={tdClass}>{row.attendee.email}</td>
            <td className={tdClass}>{row.attendee.mobile}</td>
            <td className={tdClass}>{row.reference}</td>
            <td className={tdClass}>{row.tierName}</td>
            <td className={tdClass}>{money(row.totalCents - row.balanceCents, row.currency)}</td>
            <td className={tdClass}>{money(row.balanceCents, row.currency)}</td>
            <td className={tdClass}>{registrationStatusLabel(row)}</td>
            <td className={`${tdClass} whitespace-nowrap text-right`}>
              <button type="button" className={linkButton} onClick={() => openView(row)}>View</button>
            </td>
          </tr>
        ))}
      </DataTable>
      {cancelTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#141416]/45 px-4" role="dialog" aria-modal="true" aria-labelledby="cancel-registration-title">
          <div className="w-full max-w-[420px] rounded-[16px] border border-[#E4E1DC] bg-[#FDFCFA] p-5 shadow-[0_18px_50px_rgba(20,20,22,0.18)]">
            <p className="m-0 text-xs font-bold tracking-[0.16em] text-[#A8131F] uppercase">IBMC 2027 · AMPLIFY</p>
            <h2 id="cancel-registration-title" className="m-0 mt-2 font-archivo text-[26px] leading-tight font-extrabold">Cancel this registration?</h2>
            <p className="m-0 mt-2 text-sm leading-normal text-[#5C5C63]">
              {cancelTarget.name} · {cancelTarget.reference}. The seat is released. This does not refund a payment that already went through.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <button type="button" className={buttonClass} onClick={confirmCancel}>Cancel registration</button>
              <button type="button" className={ghostButton} onClick={() => setCancelTarget(null)}>Keep it</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

const emptyCoupon = { code: "", discountType: "percent", discountValue: "", ticketCode: "", email: "", usageLimit: "", expiresOn: "" };

function couponDraft(row: Coupon) {
  return {
    code: row.code,
    discountType: row.discount_type,
    discountValue: String(row.discount_value),
    ticketCode: row.ticket_code || "",
    email: row.email || "",
    usageLimit: row.usage_limit ? String(row.usage_limit) : "",
    expiresOn: row.expires_on || "",
  };
}

function couponPayload(form: typeof emptyCoupon) {
  return { ...form, discountValue: Number(form.discountValue), usageLimit: form.usageLimit ? Number(form.usageLimit) : null, ticketCode: form.ticketCode || null, email: form.email || null, expiresOn: form.expiresOn || null };
}

function Coupons({ onError }: { onError: (message: string) => void }) {
  const [rows, setRows] = useState<Coupon[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [form, setForm] = useState(emptyCoupon);
  const [editor, setEditor] = useState<null | "add" | number>(null);
  async function load() {
    const [coupons, ticketProducts] = await Promise.all([api("/api/admin/coupons"), api("/api/admin/products")]);
    setRows(coupons);
    setProducts(ticketProducts);
  }
  useEffect(() => { load().catch((error) => onError(error.message)); }, []);
  async function save(event: FormEvent) {
    event.preventDefault();
    try {
      const path = editor === "add" ? "/api/admin/coupons" : `/api/admin/coupons/${editor}`;
      await api(path, { method: editor === "add" ? "POST" : "PATCH", body: JSON.stringify(couponPayload(form)) });
      setForm(emptyCoupon);
      setEditor(null);
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not save the coupon");
    }
  }
  function ticketName(code: string | null) {
    if (!code) return "Any ticket";
    return products.find((product) => product.code === code)?.name || code;
  }
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 font-archivo text-[28px] font-extrabold">Coupons</h1>
        <button type="button" className={buttonClass} onClick={() => { setEditor("add"); setForm(emptyCoupon); }}>Add</button>
      </div>
      {editor !== null ? (
        <form className="grid gap-3 rounded-[14px] border border-[#E4E1DC] bg-white p-4 sm:grid-cols-2" onSubmit={save}>
          <Field label="Code"><input className={field} required value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} /></Field>
          <Field label="Rule">
            <select className={field} value={form.discountType} onChange={(event) => setForm({ ...form, discountType: event.target.value })}>
              <option value="percent">Percent off</option>
              <option value="fixed">Fixed amount off</option>
            </select>
          </Field>
          <Field label={form.discountType === "percent" ? "Percent" : "Amount"}><input className={field} required type="number" min="1" value={form.discountValue} onChange={(event) => setForm({ ...form, discountValue: event.target.value })} /></Field>
          <Field label="Ticket">
            <select className={field} value={form.ticketCode} onChange={(event) => setForm({ ...form, ticketCode: event.target.value })}>
              <option value="">Any ticket</option>
              {products.map((product) => <option key={product.code} value={product.code}>{product.name}</option>)}
            </select>
          </Field>
          <Field label="Email limit"><input className={field} type="email" placeholder="Blank means any email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></Field>
          <Field label="Usage limit"><input className={field} type="number" min="1" placeholder="Blank means unlimited" value={form.usageLimit} onChange={(event) => setForm({ ...form, usageLimit: event.target.value })} /></Field>
          <Field label="Expiry"><input className={field} type="date" value={form.expiresOn} onChange={(event) => setForm({ ...form, expiresOn: event.target.value })} /></Field>
          <div className="flex gap-2 sm:col-span-2">
            <button type="submit" className={buttonClass}>{editor === "add" ? "Create coupon" : "Save coupon"}</button>
            <button type="button" className={ghostButton} onClick={() => setEditor(null)}>Back</button>
          </div>
        </form>
      ) : null}
      <DataTable columns={["Code", "Rule", "Ticket", "Email", "Usage", "Expiry", ""]} empty={rows.length === 0 ? "No coupons yet." : ""}>
        {rows.map((row) => (
          <tr key={row.id}>
            <td className={`${tdClass} font-semibold`}>{row.code}</td>
            <td className={tdClass}>{row.discount_type === "percent" ? `${row.discount_value}% off` : `${row.currency === "USD" ? "USD " : "₱"}${Number(row.discount_value).toLocaleString()} off`}</td>
            <td className={tdClass}>{ticketName(row.ticket_code)}</td>
            <td className={tdClass}>{row.email || "Any email"}</td>
            <td className={tdClass}>{`${row.usage_count}${row.usage_limit ? ` of ${row.usage_limit}` : ""}`}</td>
            <td className={tdClass}>{row.expires_on || "No expiry"}</td>
            <td className={`${tdClass} text-right`}><button type="button" className={linkButton} onClick={() => { setEditor(row.id); setForm(couponDraft(row)); }}>Edit</button></td>
          </tr>
        ))}
      </DataTable>
    </section>
  );
}

const emptyTemplate = { name: "", channel: "email", subject: "", body: "" };

function TemplatePreview({ channel, subject, body, systemKey }: { channel: string; subject: string; body: string; systemKey: string }) {
  const preview = previewTemplate({ channel, subject, body, systemKey });
  const email = channel === "email";
  const sms = email ? null : smsCreditCount(preview.body);
  const creditLabel = sms && sms.credits === 1 ? "credit" : "credits";
  return (
    <div className="flex flex-col gap-3 rounded-[14px] border border-[#E4E1DC] bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="m-0 text-sm font-bold">Preview</h2>
        <p className="m-0 text-[13px] text-[#5C5C63]">Maria Santos · First Mover · payment 2 of 7</p>
      </div>
      {email ? <p className="m-0 text-sm"><span className="font-semibold">Subject </span>{preview.subject || "—"}</p> : null}
      {email ? (
        <iframe title="Email preview" sandbox="" srcDoc={preview.html} className="h-[640px] w-full rounded-[10px] border border-[#E4E1DC] bg-[#F6F4F1]" />
      ) : (
        <div className="rounded-[18px] bg-[#F6F4F1] px-4 py-6">
          <p className="m-0 max-w-[320px] whitespace-pre-wrap rounded-[18px] bg-white px-4 py-3 text-sm leading-relaxed">{preview.body || "The message shows here."}</p>
          <p className="m-0 mt-3 text-[13px] font-semibold text-[#141416]">{sms?.characters.toLocaleString()} characters · {sms?.credits} {creditLabel}</p>
          <p className="m-0 text-[13px] text-[#5C5C63]">Semaphore charges 161 characters per credit.</p>
        </div>
      )}
    </div>
  );
}

function Templates({ onError }: { onError: (message: string) => void }) {
  const [rows, setRows] = useState<Template[]>([]);
  const [form, setForm] = useState(emptyTemplate);
  const [editor, setEditor] = useState<null | "add" | number>(null);
  const editing = typeof editor === "number" ? rows.find((row) => row.id === editor) : null;
  async function load() { setRows(await api("/api/admin/templates")); }
  useEffect(() => { load().catch((error) => onError(error.message)); }, []);
  async function save(event: FormEvent) {
    event.preventDefault();
    try {
      const path = editor === "add" ? "/api/admin/templates" : `/api/admin/templates/${editor}`;
      await api(path, { method: editor === "add" ? "POST" : "PATCH", body: JSON.stringify(form) });
      setForm(emptyTemplate);
      setEditor(null);
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not save the template");
    }
  }
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 font-archivo text-[28px] font-extrabold">Templates</h1>
        <button type="button" className={buttonClass} onClick={() => { setEditor("add"); setForm(emptyTemplate); }}>Add</button>
      </div>
      {editor !== null ? (
        <div className="grid items-start gap-3 lg:grid-cols-2">
        <form className="flex flex-col gap-3 rounded-[14px] border border-[#E4E1DC] bg-white p-4" onSubmit={save}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name"><input className={field} required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
            <Field label="Channel">
              <select className={field} value={form.channel} disabled={Boolean(editing?.system_key)} onChange={(event) => setForm({ ...form, channel: event.target.value })}>
                <option value="email">Email</option>
                <option value="sms">SMS</option>
              </select>
            </Field>
          </div>
          {form.channel === "email" ? (
            <Field label="Subject">
              <input className={field} required placeholder="IBMC 2027 · ₱2,000 due in 3 days · {{installment}}" value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })} />
            </Field>
          ) : null}
          <Field label="Message">
            <textarea className={`${field} min-h-28`} required value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} />
          </Field>
          <p className="m-0 text-[13px] text-[#5C5C63]">Placeholders: {"{{first_name}}"} {"{{amount}}"} {"{{due_date}}"} {"{{when}}"} {"{{pay_url}}"} {"{{reference}}"} {"{{pass_url}}"} {"{{installment}}"} {"{{product}}"} {"{{plan_note}}"}</p>
          <p className="m-0 text-[13px] text-[#5C5C63]">{"{{when}}"} is due today, due tomorrow, or due in 7 days. {"{{installment}}"} is the payment number, such as 2 of 7. {"{{pass_url}}"} fills in after the seat is fully paid.</p>
          <p className="m-0 text-[13px] text-[#5C5C63]">{"{{plan_note}}"} is the ₱200 test schedule. The preview includes it. Other tickets leave it blank.</p>
          {editing?.system_key ? (
            <p className="m-0 text-[13px] text-[#5C5C63]">
              {editing.system_key.startsWith("entry_pass")
                ? "Built-in QR ticket. The next send uses this message. The email still includes the QR code."
                : "Built-in payment reminder. The next send uses this message. The email still includes the amount and the pay button."}
            </p>
          ) : null}
          <div className="flex gap-2">
            <button type="submit" className={buttonClass}>{editor === "add" ? "Create template" : "Save template"}</button>
            <button type="button" className={ghostButton} onClick={() => setEditor(null)}>Back</button>
          </div>
        </form>
        <TemplatePreview channel={form.channel} subject={form.subject} body={form.body} systemKey={editing?.system_key || ""} />
        </div>
      ) : null}
      <DataTable columns={["Name", "Channel", "Subject", "Message", ""]} empty={rows.length === 0 ? "No templates yet." : ""}>
        {rows.map((row) => (
          <tr key={row.id}>
            <td className={`${tdClass} font-semibold`}>{row.name}{row.system_key ? <span className="ml-2 text-[12px] font-bold uppercase tracking-wide text-[#A8131F]">Built-in</span> : null}</td>
            <td className={tdClass}>{row.channel === "email" ? "Email" : "SMS"}</td>
            <td className={tdClass}>{row.subject || "—"}</td>
            <td className={`${tdClass} max-w-[360px] truncate`}>{row.body}</td>
            <td className={`${tdClass} text-right`}>
              <button type="button" className={linkButton} onClick={() => { setEditor(row.id); setForm({ name: row.name, channel: row.channel, subject: row.subject || "", body: row.body }); }}>Edit</button>
            </td>
          </tr>
        ))}
      </DataTable>
    </section>
  );
}

const emptySchedule = { name: "", templateId: "", trigger: "before_due", daysOffset: "7", startOn: "", sendTime: "09:00", frequency: "once", endsOn: "", endsAfter: "", audience: "unpaid" };

function scheduleDraft(row: Schedule): typeof emptySchedule {
  return {
    name: row.name,
    templateId: String(row.template_id),
    trigger: row.trigger,
    daysOffset: String(row.days_offset),
    startOn: row.start_on || "",
    sendTime: String(row.send_time).slice(0, 5),
    frequency: row.frequency,
    endsOn: row.ends_on || "",
    endsAfter: row.ends_after ? String(row.ends_after) : "",
    audience: row.audience,
  };
}

function schedulePayload(form: typeof emptySchedule) {
  return { ...form, templateId: Number(form.templateId), daysOffset: Number(form.daysOffset), endsAfter: form.endsAfter ? Number(form.endsAfter) : null, endsOn: form.endsOn || null, startOn: form.startOn || null };
}

function whenLabel(row: Schedule) {
  if (row.trigger === "fully_paid") return "When fully paid";
  if (row.trigger === "on_date") return row.start_on || "On a date";
  if (row.trigger === "before_due" && row.days_offset === 0) return "Due today";
  const days = `${row.days_offset} day${row.days_offset === 1 ? "" : "s"}`;
  return row.trigger === "after_registration" ? `${days} after registration` : `${days} before due`;
}

function Schedules({ onError }: { onError: (message: string) => void }) {
  const [rows, setRows] = useState<Schedule[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [form, setForm] = useState(emptySchedule);
  const [editor, setEditor] = useState<null | "add" | number>(null);
  const editing = typeof editor === "number" ? rows.find((row) => row.id === editor) : null;
  const systemSchedule = editing?.system_key ? editing : null;
  const templateChoices = systemSchedule ? templates.filter((template) => template.channel === systemSchedule.channel) : templates;
  async function load() {
    const [schedules, messageTemplates] = await Promise.all([api("/api/admin/schedules"), api("/api/admin/templates")]);
    setRows(schedules);
    setTemplates(messageTemplates);
  }
  useEffect(() => { load().catch((error) => onError(error.message)); }, []);
  async function save(event: FormEvent) {
    event.preventDefault();
    try {
      const path = editor === "add" ? "/api/admin/schedules" : `/api/admin/schedules/${editor}`;
      await api(path, { method: editor === "add" ? "POST" : "PATCH", body: JSON.stringify(schedulePayload(form)) });
      setForm(emptySchedule);
      setEditor(null);
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not save the schedule");
    }
  }
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 font-archivo text-[28px] font-extrabold">Schedule</h1>
        <button type="button" className={buttonClass} onClick={() => { const first = templates.find((template) => !template.system_key) || templates[0]; setEditor("add"); setForm({ ...emptySchedule, templateId: first ? String(first.id) : "" }); }}>Add</button>
      </div>
      {editor !== null ? (
        <form className="grid gap-3 rounded-[14px] border border-[#E4E1DC] bg-white p-4 sm:grid-cols-2" onSubmit={save}>
          <Field label="Name"><input className={field} required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
          <Field label="Template">
            <select className={field} required value={form.templateId} onChange={(event) => setForm({ ...form, templateId: event.target.value })}>
              <option value="">Choose a template</option>
              {templateChoices.map((template) => <option key={template.id} value={template.id}>{template.name} · {template.channel}</option>)}
            </select>
          </Field>
          <Field label="When to send">
            <select className={field} value={form.trigger} disabled={Boolean(systemSchedule)} onChange={(event) => setForm({ ...form, trigger: event.target.value })}>
              {form.trigger === "fully_paid" ? <option value="fully_paid">When fully paid</option> : null}
              <option value="before_due">Before a due date</option>
              <option value="after_registration">After registration</option>
              <option value="on_date">On a date</option>
            </select>
          </Field>
          {form.trigger === "fully_paid" ? (
            <p className="m-0 self-end pb-3 text-[13px] text-[#5C5C63]">Sends when the seat is fully paid.</p>
          ) : form.trigger === "on_date" ? (
            <Field label="Date"><input className={field} type="date" required value={form.startOn} onChange={(event) => setForm({ ...form, startOn: event.target.value })} /></Field>
          ) : (
            <Field label="Days"><input className={field} type="number" min="0" value={form.daysOffset} onChange={(event) => setForm({ ...form, daysOffset: event.target.value })} /></Field>
          )}
          {form.trigger === "fully_paid" ? null : <Field label="Send time"><input className={field} type="time" value={form.sendTime} onChange={(event) => setForm({ ...form, sendTime: event.target.value })} /></Field>}
          <Field label="Frequency">
            <select className={field} value={form.frequency} disabled={Boolean(systemSchedule)} onChange={(event) => setForm({ ...form, frequency: event.target.value })}>
              <option value="once">Once</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
          </Field>
          <Field label="Who">
            <select className={field} value={form.audience} disabled={Boolean(systemSchedule)} onChange={(event) => setForm({ ...form, audience: event.target.value })}>
              <option value="unpaid">Unpaid balances</option>
              <option value="fully_paid">Fully paid</option>
              <option value="all">Everyone confirmed</option>
            </select>
          </Field>
          <Field label="End date"><input className={field} type="date" disabled={Boolean(systemSchedule)} value={form.endsOn} onChange={(event) => setForm({ ...form, endsOn: event.target.value })} /></Field>
          <Field label="Stop after"><input className={field} type="number" min="1" disabled={Boolean(systemSchedule)} placeholder="Number of sends" value={form.endsAfter} onChange={(event) => setForm({ ...form, endsAfter: event.target.value })} /></Field>
          {systemSchedule ? (
            <p className="m-0 text-[13px] text-[#5C5C63] sm:col-span-2">
              {systemSchedule.trigger === "fully_paid"
                ? "Built-in QR ticket. You can change the message. It sends when the seat is fully paid."
                : "Built-in payment reminder. You can change the message, how many days before the due date it sends, and the send time."}
            </p>
          ) : null}
          <div className="flex gap-2 sm:col-span-2">
            <button type="submit" className={buttonClass}>{editor === "add" ? "Create schedule" : "Save schedule"}</button>
            <button type="button" className={ghostButton} onClick={() => setEditor(null)}>Back</button>
          </div>
        </form>
      ) : null}
      <DataTable columns={["Name", "Template", "When", "Frequency", "Who", "Ends", ""]} empty={rows.length === 0 ? "No schedules yet." : ""}>
        {rows.map((row) => (
          <tr key={row.id}>
            <td className={`${tdClass} font-semibold`}>{row.name}{row.system_key ? <span className="ml-2 text-[12px] font-bold uppercase tracking-wide text-[#A8131F]">Built-in</span> : null}</td>
            <td className={tdClass}>{row.template_name} · {row.channel === "email" ? "Email" : "SMS"}</td>
            <td className={tdClass}>{row.trigger === "fully_paid" ? whenLabel(row) : `${whenLabel(row)} · ${String(row.send_time).slice(0, 5)}`}</td>
            <td className={tdClass}>{titleCase(row.frequency)}</td>
            <td className={tdClass}>{titleCase(row.audience)}</td>
            <td className={tdClass}>{[row.ends_on, row.ends_after ? `after ${row.ends_after}` : ""].filter(Boolean).join(" · ") || "—"}</td>
            <td className={`${tdClass} text-right`}><button type="button" className={linkButton} onClick={() => { setEditor(row.id); setForm(scheduleDraft(row)); }}>Edit</button></td>
          </tr>
        ))}
      </DataTable>
    </section>
  );
}

const emptyMember = { fullName: "", email: "", mobile: "", chapter: "", category: "", businessName: "", ticketType: "", regStatus: "updated" as Member["regStatus"], country: "", goldClub: false };

type Chapter = { id: number; name: string };

function Chapters({ onError }: { onError: (message: string) => void }) {
  const [rows, setRows] = useState<Chapter[]>([]);
  const [name, setName] = useState("");
  const [editor, setEditor] = useState<null | "add" | number>(null);
  const [query, setQuery] = useState("");
  async function load() { setRows(await api("/api/admin/chapters")); }
  useEffect(() => { load().catch((error) => onError(error.message)); }, []);
  async function save(event: FormEvent) {
    event.preventDefault();
    try {
      const path = editor === "add" ? "/api/admin/chapters" : `/api/admin/chapters/${editor}`;
      await api(path, { method: editor === "add" ? "POST" : "PATCH", body: JSON.stringify({ name }) });
      setName("");
      setEditor(null);
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not save the chapter");
    }
  }
  async function upload(file: File) {
    const csv = await file.text();
    try {
      const payload = await api("/api/admin/chapters/upload", { method: "POST", body: JSON.stringify({ csv }) });
      setRows(payload.chapters);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Upload failed");
    }
  }
  const visible = rows.filter((row) => matches(query, [row.name]));
  const empty = rows.length === 0 ? "No chapters yet." : visible.length === 0 ? "No chapters match that search." : "";
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 font-archivo text-[28px] font-extrabold">Chapters</h1>
        <div className="flex flex-wrap gap-2">
          <label className={ghostButton}>
            Upload chapters
            <input className="sr-only" type="file" accept=".csv,text/csv,.txt,text/plain" onChange={(event) => { const file = event.target.files?.[0]; if (file) upload(file); event.target.value = ""; }} />
          </label>
          <button type="button" className={buttonClass} onClick={() => { setEditor("add"); setName(""); }}>Add</button>
        </div>
      </div>
      <SearchBox value={query} onChange={setQuery} placeholder="Search chapters" />
      {editor !== null ? (
        <form className="flex flex-wrap items-end gap-3 rounded-[14px] border border-[#E4E1DC] bg-white p-4" onSubmit={save}>
          <Field label="Chapter name"><input className={field} required value={name} onChange={(event) => setName(event.target.value)} /></Field>
          <button type="submit" className={buttonClass}>{editor === "add" ? "Add chapter" : "Save chapter"}</button>
          <button type="button" className={ghostButton} onClick={() => setEditor(null)}>Back</button>
          <p className="m-0 w-full text-[13px] text-[#5C5C63]">Upload one chapter name per line. A header named chapter or name is optional.</p>
        </form>
      ) : null}
      <DataTable columns={["Chapter", ""]} empty={empty}>
        {visible.map((row) => (
          <tr key={row.id}>
            <td className={`${tdClass} font-semibold`}>{row.name}</td>
            <td className={`${tdClass} text-right`}><button type="button" className={linkButton} onClick={() => { setEditor(row.id); setName(row.name); }}>Edit</button></td>
          </tr>
        ))}
      </DataTable>
    </section>
  );
}

const memberPageSize = 20;

function Members({ onError }: { onError: (message: string) => void }) {
  const [rows, setRows] = useState<Member[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [form, setForm] = useState(emptyMember);
  const [editor, setEditor] = useState<null | "add" | number>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  async function load() {
    const [members, chapterRows] = await Promise.all([api("/api/admin/members"), api("/api/admin/chapters")]);
    setRows(members);
    setChapters(chapterRows);
  }
  useEffect(() => { load().catch((error) => onError(error.message)); }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    try {
      if (editor && editor !== "add") await api(`/api/admin/members/${editor}`, { method: "PATCH", body: JSON.stringify(form) });
      else await api("/api/admin/members", { method: "POST", body: JSON.stringify(form) });
      setForm(emptyMember);
      setEditor(null);
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not save the member");
    }
  }

  async function upload(file: File) {
    const csv = await file.text();
    try {
      const payload = await api("/api/admin/members/upload", { method: "POST", body: JSON.stringify({ csv }) });
      setRows(payload.members);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Upload failed");
    }
  }

  const visible = rows.filter((row) => matches(query, [row.fullName, row.email, row.mobile, row.chapter, row.category, row.businessName, row.ticketType, row.regStatus, row.country]));
  const pageCount = Math.max(1, Math.ceil(visible.length / memberPageSize));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * memberPageSize;
  const pageRows = visible.slice(pageStart, pageStart + memberPageSize);
  const empty = rows.length === 0 ? "No members yet." : visible.length === 0 ? "No members match that search." : "";

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 font-archivo text-[28px] font-extrabold">Members</h1>
        <div className="flex flex-wrap gap-2">
          <label className={ghostButton}>
            Upload roster
            <input className="sr-only" type="file" accept=".csv,text/csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) upload(file); event.target.value = ""; }} />
          </label>
          <button type="button" className={buttonClass} onClick={() => { setEditor("add"); setForm(emptyMember); }}>Add</button>
        </div>
      </div>
      <SearchBox value={query} onChange={(value) => { setQuery(value); setPage(1); }} placeholder="Search name, email, mobile, chapter, or business" />
      {visible.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="m-0 text-sm text-[#5C5C63]">{pageStart + 1}–{pageStart + pageRows.length} of {visible.length}</p>
          <div className="flex items-center gap-2">
            <button type="button" className={`${ghostButton} px-3 py-2 disabled:opacity-40`} disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Previous</button>
            <span className="text-sm text-[#5C5C63]">Page {currentPage} of {pageCount}</span>
            <button type="button" className={`${ghostButton} px-3 py-2 disabled:opacity-40`} disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>Next</button>
          </div>
        </div>
      ) : null}
      {editor !== null ? (
        <form className="grid gap-3 rounded-[14px] border border-[#E4E1DC] bg-white p-4 sm:grid-cols-2" onSubmit={save}>
          <Field label="Name"><input className={field} required value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} /></Field>
          <Field label="Email"><input className={field} type="email" required value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></Field>
          <Field label="Mobile"><input className={field} required value={form.mobile} onChange={(event) => setForm({ ...form, mobile: event.target.value })} /></Field>
          <Field label="Chapter">
            <select className={field} value={form.chapter} onChange={(event) => setForm({ ...form, chapter: event.target.value })}>
              <option value="">Select a chapter</option>
              {form.chapter && !chapters.some((chapter) => chapter.name.toLowerCase() === form.chapter.toLowerCase()) ? <option value={form.chapter}>{form.chapter}</option> : null}
              {chapters.map((chapter) => <option key={chapter.id} value={chapter.name}>{chapter.name}</option>)}
            </select>
          </Field>
          <Field label="Category"><input className={field} value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} /></Field>
          <Field label="Business name"><input className={field} value={form.businessName} onChange={(event) => setForm({ ...form, businessName: event.target.value })} /></Field>
          <Field label="Ticket type"><input className={field} value={form.ticketType} onChange={(event) => setForm({ ...form, ticketType: event.target.value })} /></Field>
          <Field label="Reg status">
            <select className={field} value={form.regStatus} onChange={(event) => setForm({ ...form, regStatus: event.target.value as Member["regStatus"] })}>
              <option value="updated">Updated</option>
              <option value="delayed">Delayed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </Field>
          <Field label="Country"><input className={field} value={form.country} onChange={(event) => setForm({ ...form, country: event.target.value })} /></Field>
          <label className="flex items-center gap-2 text-sm font-semibold sm:col-span-2">
            <input type="checkbox" className="h-5 w-5 accent-[#D0202E]" checked={form.goldClub} onChange={(event) => setForm({ ...form, goldClub: event.target.checked })} />
            Gold club member
          </label>
          <p className="m-0 text-[13px] text-[#5C5C63] sm:col-span-2">CSV columns: name, email, mobile, chapter, category, business name, ticket type, reg status, country, gold club member.</p>
          <div className="flex gap-2 sm:col-span-2">
            <button type="submit" className={buttonClass}>{editor === "add" ? "Add member" : "Save member"}</button>
            <button type="button" className={ghostButton} onClick={() => setEditor(null)}>Back</button>
          </div>
        </form>
      ) : null}
      <DataTable columns={["Name", "Email", "Mobile", "Chapter", "Category", "Business", "Ticket", "Status", "Country", "Gold club", ""]} empty={empty}>
        {pageRows.map((row) => (
          <tr key={row.id}>
            <td className={`${tdClass} font-semibold`}>{row.fullName}</td>
            <td className={tdClass}>{row.email}</td>
            <td className={tdClass}>{row.mobile}</td>
            <td className={tdClass}>{row.chapter}</td>
            <td className={tdClass}>{row.category}</td>
            <td className={tdClass}>{row.businessName}</td>
            <td className={tdClass}>{row.ticketType}</td>
            <td className={tdClass}>{titleCase(row.regStatus)}</td>
            <td className={tdClass}>{row.country}</td>
            <td className={tdClass}>{row.goldClub ? "Yes" : ""}</td>
            <td className={`${tdClass} text-right`}><button type="button" className={linkButton} onClick={() => { setEditor(row.id); setForm(row); }}>Edit</button></td>
          </tr>
        ))}
      </DataTable>
    </section>
  );
}

type PaymentChannelSetting = {
  code: string;
  label: string;
  customLabel?: string;
  detail: string;
  note: string;
  customNote?: string;
  enabled: boolean;
  feePercentBps?: number | null;
  feeFixedCents?: number | null;
};

type PaynamicsMethodSetting = {
  code: string;
  label: string;
  group: string;
  detail: string;
  preset: "available" | "other" | string;
  enabled: boolean;
  feePercentBps?: number | null;
  feeFixedCents?: number | null;
};

type PaymentChannelPayload = {
  channels?: PaymentChannelSetting[];
  paynamicsMethods?: PaynamicsMethodSetting[];
  hitpayConfigured?: boolean;
  paynamicsConfigured?: boolean;
  paynamics?: { liveRealChargeWarning?: boolean; checkoutMode?: string };
};

function FeePair({
  percent,
  pesos,
  disabled,
  percentLabel,
  pesosLabel,
  onPercent,
  onPesos,
}: {
  percent: string;
  pesos: string;
  disabled?: boolean;
  percentLabel: string;
  pesosLabel: string;
  onPercent: (value: string) => void;
  onPesos: (value: string) => void;
}) {
  return (
    <div className="ml-8 flex flex-wrap items-end gap-2">
      <label className="flex w-28 flex-col gap-1 text-[12px] font-semibold text-[#5C5C63]">
        %
        <input
          className={`${field} w-full text-right tabular-nums disabled:bg-[#F6F4F1]`}
          inputMode="decimal"
          aria-label={percentLabel}
          value={percent}
          disabled={disabled}
          onChange={(event) => onPercent(event.target.value)}
        />
      </label>
      <span className="pb-2 text-[13px] text-[#5C5C63]">or</span>
      <label className="flex w-28 flex-col gap-1 text-[12px] font-semibold text-[#5C5C63]">
        Pesos
        <input
          className={`${field} w-full text-right tabular-nums disabled:bg-[#F6F4F1]`}
          inputMode="decimal"
          aria-label={pesosLabel}
          value={pesos}
          disabled={disabled}
          onChange={(event) => onPesos(event.target.value)}
        />
      </label>
    </div>
  );
}

function PaynamicsMethodChecks({
  methods,
  locked = false,
  grouped = false,
  feePercents,
  feePesos,
  onToggle,
  onPercent,
  onPesos,
}: {
  methods: PaynamicsMethodSetting[];
  locked?: boolean;
  grouped?: boolean;
  feePercents: Record<string, string>;
  feePesos: Record<string, string>;
  onToggle: (code: string, enabled: boolean) => void;
  onPercent: (code: string, value: string) => void;
  onPesos: (code: string, value: string) => void;
}) {
  if (!methods.length) return null;
  let group = "";
  return (
    <div className="overflow-hidden rounded-[14px] border border-[#D9D5CF]">
      {methods.map((method) => {
        const showGroup = grouped && method.group !== group;
        if (grouped) group = method.group;
        return (
          <div key={method.code} className={`flex flex-col gap-3 border-t border-[#E4E1DC] px-4 py-3 first:border-t-0 ${method.enabled ? "bg-[#FBE9EA]" : ""}`}>
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-1 h-5 w-5 accent-[#D0202E]"
                checked={method.enabled}
                disabled={locked}
                onChange={(event) => onToggle(method.code, event.target.checked)}
              />
              <span className="flex flex-col gap-0.5">
                {showGroup ? <span className="text-xs font-bold tracking-[0.12em] text-[#A8131F] uppercase">{method.group}</span> : null}
                <span className="text-[15px] font-semibold">{method.label}</span>
                <span className="text-[13px] font-normal leading-snug text-[#5C5C63]">{method.detail}</span>
              </span>
            </label>
            <FeePair
              percent={feePercents[method.code] ?? ""}
              pesos={feePesos[method.code] ?? ""}
              disabled={locked}
              percentLabel={`${method.label} convenience fee percent`}
              pesosLabel={`${method.label} convenience fee in pesos`}
              onPercent={(value) => onPercent(method.code, value)}
              onPesos={(value) => onPesos(method.code, value)}
            />
          </div>
        );
      })}
    </div>
  );
}

type TicketGate = {
  code: string;
  name: string;
  currency: "PHP" | "USD";
  fullPriceCents: number;
  salesStart: string;
  salesEnd: string;
  paymentsOpen: boolean;
  feeBearer: "pass" | "shoulder";
};

function saleDate(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)));
}

type SettingsHandle = {
  changes: () => string[];
  save: () => Promise<void>;
  reset: () => void;
};

const TicketPaymentSettings = forwardRef<SettingsHandle, { onError: (message: string) => void; editing: boolean }>(function TicketPaymentSettings({ onError, editing }, ref) {
  const [tickets, setTickets] = useState<TicketGate[]>([]);
  const savedRef = useRef<TicketGate[]>([]);

  async function load() {
    const next = await api("/api/admin/tickets") as TicketGate[];
    savedRef.current = next;
    setTickets(next);
  }

  useEffect(() => {
    load().catch((error) => onError(error.message));
  }, []);

  useImperativeHandle(ref, () => ({
    changes() {
      return tickets.flatMap((ticket) => {
        const saved = savedRef.current.find((item) => item.code === ticket.code);
        if (!saved) return [];
        const lines = [];
        if (saved.paymentsOpen !== ticket.paymentsOpen) lines.push(`${ticket.name}: ${ticket.paymentsOpen ? "open for payment" : "locked"}`);
        if ((saved.feeBearer === "pass") !== (ticket.feeBearer === "pass")) {
          lines.push(`${ticket.name}: convenience fee ${ticket.feeBearer === "pass" ? "passed on" : "shouldered"}`);
        }
        return lines;
      });
    },
    async save() {
      for (const ticket of tickets) {
        const saved = savedRef.current.find((item) => item.code === ticket.code);
        if (!saved) continue;
        const body: { code: string; paymentsOpen?: boolean; feeBearer?: TicketGate["feeBearer"] } = { code: ticket.code };
        if (saved.paymentsOpen !== ticket.paymentsOpen) body.paymentsOpen = ticket.paymentsOpen;
        if ((saved.feeBearer === "pass") !== (ticket.feeBearer === "pass")) body.feeBearer = ticket.feeBearer === "pass" ? "pass" : "shoulder";
        if (body.paymentsOpen === undefined && body.feeBearer === undefined) continue;
        await api("/api/admin/tickets", { method: "PATCH", body: JSON.stringify(body) });
      }
      await load();
    },
    reset() {
      setTickets(savedRef.current.map((ticket) => ({ ...ticket })));
    },
  }), [tickets]);

  return (
    <div className="flex max-w-[640px] flex-col gap-4 rounded-[14px] border border-[#E4E1DC] bg-white p-4">
      <div className="flex flex-col gap-1">
        <h2 className="m-0 text-[17px] font-bold">Tickets</h2>
        <p className="m-0 text-[13px] leading-normal text-[#5C5C63]">Open means buyers can pay for that ticket now. Locked means payment stays closed. Sale dates stay as a label. Pass on adds the channel’s convenience fee to the amount due. Shouldered means IBMC absorbs that fee.</p>
      </div>
      <div className="overflow-hidden rounded-[14px] border border-[#D9D5CF]">
        {tickets.map((ticket) => (
          <div key={ticket.code} className={`flex flex-col gap-3 border-t border-[#E4E1DC] px-4 py-4 first:border-t-0 ${ticket.paymentsOpen ? "bg-[#FBE9EA]" : ""}`}>
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-1 h-5 w-5 accent-[#D0202E]"
                checked={ticket.paymentsOpen}
                disabled={!editing}
                onChange={(event) => setTickets((current) => current.map((item) => item.code === ticket.code ? { ...item, paymentsOpen: event.target.checked } : item))}
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-[15px] font-semibold">{ticket.name}</span>
                <span className="text-[13px] font-normal leading-snug text-[#5C5C63]">
                  {money(ticket.fullPriceCents, ticket.currency)} · {saleDate(ticket.salesStart)} – {saleDate(ticket.salesEnd)}
                </span>
                <span className="text-[13px] font-semibold leading-snug text-[#3A3A40]">{ticket.paymentsOpen ? "Open for payment" : "Locked"}</span>
              </span>
            </label>
            <fieldset className="ml-8 border-0 p-0">
              <legend className="mb-1 text-[12px] font-semibold text-[#5C5C63]">Convenience fee</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                <label className="flex items-center gap-2 text-sm font-semibold">
                  <input type="radio" className="h-5 w-5 accent-[#D0202E]" name={`fee-${ticket.code}`} checked={ticket.feeBearer === "pass"} disabled={!editing} onChange={() => setTickets((current) => current.map((item) => item.code === ticket.code ? { ...item, feeBearer: "pass" } : item))} />
                  Pass on
                </label>
                <label className="flex items-center gap-2 text-sm font-semibold">
                  <input type="radio" className="h-5 w-5 accent-[#D0202E]" name={`fee-${ticket.code}`} checked={ticket.feeBearer !== "pass"} disabled={!editing} onChange={() => setTickets((current) => current.map((item) => item.code === ticket.code ? { ...item, feeBearer: "shoulder" } : item))} />
                  Shouldered
                </label>
              </div>
            </fieldset>
          </div>
        ))}
      </div>
    </div>
  );
});

function tidy(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function feePhrase(percent: string, pesos: string) {
  const parts = [];
  if (percent.trim()) parts.push(`${percent.trim()}%`);
  if (pesos.trim()) parts.push(`₱${pesos.trim()}`);
  return parts.length ? parts.join(" or ") : "none";
}

const PaymentSettings = forwardRef<SettingsHandle, { onError: (message: string) => void; editing: boolean }>(function PaymentSettings({ onError, editing }, ref) {
  const [channels, setChannels] = useState<PaymentChannelSetting[]>([]);
  const [paynamicsMethods, setPaynamicsMethods] = useState<PaynamicsMethodSetting[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [feePercents, setFeePercents] = useState<Record<string, string>>({});
  const [feePesos, setFeePesos] = useState<Record<string, string>>({});
  const [hitpayConfigured, setHitpayConfigured] = useState(true);
  const [paynamicsConfigured, setPaynamicsConfigured] = useState(true);
  const [paynamicsLiveWarning, setPaynamicsLiveWarning] = useState(false);
  const [paynamicsCheckoutMode, setPaynamicsCheckoutMode] = useState<"sandbox" | "live" | "off">("off");
  const draftsRef = useRef<Record<string, string>>({});
  const noteDraftsRef = useRef<Record<string, string>>({});
  const feePercentsRef = useRef<Record<string, string>>({});
  const feePesosRef = useRef<Record<string, string>>({});
  const channelsRef = useRef<PaymentChannelSetting[]>([]);
  const methodsRef = useRef<PaynamicsMethodSetting[]>([]);
  const availableAllRef = useRef<HTMLInputElement>(null);

  function fillDrafts(nextChannels: PaymentChannelSetting[], nextMethods: PaynamicsMethodSetting[]) {
    const labels: Record<string, string> = {};
    const notes: Record<string, string> = {};
    const percents: Record<string, string> = {};
    const pesos: Record<string, string> = {};
    for (const item of [...nextChannels, ...nextMethods]) {
      percents[item.code] = formatFeePercentInput(item.feePercentBps);
      pesos[item.code] = formatFeePesoInput(item.feeFixedCents);
    }
    for (const item of nextChannels) {
      labels[item.code] = item.customLabel || "";
      notes[item.code] = item.customNote || "";
    }
    draftsRef.current = labels;
    noteDraftsRef.current = notes;
    feePercentsRef.current = percents;
    feePesosRef.current = pesos;
    setDrafts(labels);
    setNoteDrafts(notes);
    setFeePercents(percents);
    setFeePesos(pesos);
  }

  function applyPayload(payload: PaymentChannelPayload) {
    const next = payload.channels || [];
    const nextMethods = Array.isArray(payload.paynamicsMethods) ? payload.paynamicsMethods : [];
    channelsRef.current = next;
    methodsRef.current = nextMethods;
    setChannels(next);
    setPaynamicsMethods(nextMethods);
    fillDrafts(next, nextMethods);
    setHitpayConfigured(Boolean(payload.hitpayConfigured));
    setPaynamicsConfigured(Boolean(payload.paynamicsConfigured));
    setPaynamicsLiveWarning(Boolean(payload.paynamics?.liveRealChargeWarning));
    setPaynamicsCheckoutMode(payload.paynamics?.checkoutMode === "live" || payload.paynamics?.checkoutMode === "sandbox" ? payload.paynamics.checkoutMode : "off");
  }

  async function load() {
    applyPayload(await api("/api/admin/payment-channels"));
  }

  useEffect(() => {
    load().catch((error) => onError(error.message));
  }, []);

  const availableMethods = paynamicsMethods.filter((item) => item.preset === "available");
  const otherMethods = paynamicsMethods.filter((item) => item.preset !== "available");
  const availableAllOn = availableMethods.length > 0 && availableMethods.every((item) => item.enabled);
  const availableSomeOn = availableMethods.some((item) => item.enabled);
  useEffect(() => {
    if (availableAllRef.current) availableAllRef.current.indeterminate = availableSomeOn && !availableAllOn;
  }, [availableSomeOn, availableAllOn]);

  function toggle(code: string, enabled: boolean) {
    setChannels((current) => current.map((item) => (item.code === code ? { ...item, enabled } : item)));
  }

  function setMethodEnabled(patch: Record<string, boolean>) {
    setPaynamicsMethods((current) => current.map((item) => (
      Object.prototype.hasOwnProperty.call(patch, item.code) ? { ...item, enabled: patch[item.code] } : item
    )));
  }

  function togglePaynamicsMethod(code: string, enabled: boolean) {
    setMethodEnabled({ [code]: enabled });
  }

  function toggleAvailablePaynamics(enabled: boolean) {
    setMethodEnabled(Object.fromEntries(availableMethods.map((item) => [item.code, enabled])));
  }

  function channelChanges() {
    return channels.flatMap((channel) => {
      const saved = channelsRef.current.find((item) => item.code === channel.code);
      if (!saved) return [];
      const lines = [];
      if (saved.enabled !== channel.enabled) lines.push(`${channel.label}: ${channel.enabled ? "turned on" : "turned off"}`);
      const label = tidy(drafts[channel.code] ?? "");
      if (label !== (saved.customLabel || "")) lines.push(`${channel.label}: buyer label ${label ? `“${label}”` : "cleared"}`);
      const note = tidy(noteDrafts[channel.code] ?? "");
      if (note !== (saved.customNote || "")) lines.push(`${channel.label}: checkout note updated`);
      if (channel.code !== "paynamics") {
        const percent = (feePercents[channel.code] ?? "").trim();
        const pesos = (feePesos[channel.code] ?? "").trim();
        if (percent !== formatFeePercentInput(saved.feePercentBps) || pesos !== formatFeePesoInput(saved.feeFixedCents)) {
          lines.push(`${channel.label}: convenience fee ${feePhrase(percent, pesos)}`);
        }
      }
      return lines;
    });
  }

  function methodChanges() {
    return paynamicsMethods.flatMap((method) => {
      const saved = methodsRef.current.find((item) => item.code === method.code);
      if (!saved) return [];
      const lines = [];
      if (saved.enabled !== method.enabled) lines.push(`${method.label}: ${method.enabled ? "turned on" : "turned off"}`);
      const percent = (feePercents[method.code] ?? "").trim();
      const pesos = (feePesos[method.code] ?? "").trim();
      if (percent !== formatFeePercentInput(saved.feePercentBps) || pesos !== formatFeePesoInput(saved.feeFixedCents)) {
        lines.push(`${method.label}: convenience fee ${feePhrase(percent, pesos)}`);
      }
      return lines;
    });
  }

  useImperativeHandle(ref, () => ({
    changes: () => [...channelChanges(), ...methodChanges()],
    async save() {
      const body: Record<string, unknown> = {};
      for (const channel of channels) {
        const saved = channelsRef.current.find((item) => item.code === channel.code);
        if (!saved) continue;
        const patch: Record<string, unknown> = {};
        if (saved.enabled !== channel.enabled) patch.enabled = channel.enabled;
        const label = tidy(drafts[channel.code] ?? "");
        if (label !== (saved.customLabel || "")) patch.label = label;
        const note = tidy(noteDrafts[channel.code] ?? "");
        if (note !== (saved.customNote || "")) patch.note = note;
        if (channel.code !== "paynamics") {
          const percent = (feePercents[channel.code] ?? "").trim();
          const pesos = (feePesos[channel.code] ?? "").trim();
          if (percent !== formatFeePercentInput(saved.feePercentBps) || pesos !== formatFeePesoInput(saved.feeFixedCents)) {
            patch.feePercent = percent;
            patch.feeFixed = pesos;
          }
        }
        if (Object.keys(patch).length) body[channel.code] = patch;
      }
      const methods: Record<string, unknown> = {};
      for (const method of paynamicsMethods) {
        const saved = methodsRef.current.find((item) => item.code === method.code);
        if (!saved) continue;
        const patch: Record<string, unknown> = {};
        if (saved.enabled !== method.enabled) patch.enabled = method.enabled;
        const percent = (feePercents[method.code] ?? "").trim();
        const pesos = (feePesos[method.code] ?? "").trim();
        if (percent !== formatFeePercentInput(saved.feePercentBps) || pesos !== formatFeePesoInput(saved.feeFixedCents)) {
          patch.feePercent = percent;
          patch.feeFixed = pesos;
        }
        if (Object.keys(patch).length) methods[method.code] = patch;
      }
      if (Object.keys(methods).length) body.paynamicsMethods = methods;
      if (Object.keys(body).length) {
        applyPayload(await api("/api/admin/payment-channels", { method: "PATCH", body: JSON.stringify(body) }));
      }
    },
    reset() {
      setChannels(channelsRef.current.map((item) => ({ ...item })));
      setPaynamicsMethods(methodsRef.current.map((item) => ({ ...item })));
      fillDrafts(channelsRef.current, methodsRef.current);
    },
  }), [channels, paynamicsMethods, drafts, noteDrafts, feePercents, feePesos]);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex max-w-[640px] flex-col gap-4 rounded-[14px] border border-[#E4E1DC] bg-white p-4">
        <div className="flex flex-col gap-1">
          <h2 className="m-0 text-[17px] font-bold">Payment channels</h2>
          <p className="m-0 text-[13px] leading-normal text-[#5C5C63]">Checked channels are the ones a buyer can use when paying. Convenience fee can be a percent, a peso amount, or both. HitPay can be 1% or ₱20. When both are filled in, the buyer pays the higher amount. Buyer label is the name on checkout. Leave it blank to keep the name above. Checkout note is the line shown after a buyer selects that channel. Leave it blank to keep the original note. Under Paynamics, set the fee on each option.</p>
        </div>
        <div className="overflow-hidden rounded-[14px] border border-[#D9D5CF]">
          {channels.map((channel) => (
            <div key={channel.code} className={`flex flex-col gap-3 border-t border-[#E4E1DC] px-4 py-4 first:border-t-0 ${channel.enabled ? "bg-[#FBE9EA]" : ""}`}>
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 h-5 w-5 accent-[#D0202E]"
                  checked={channel.enabled}
                  disabled={!editing}
                  onChange={(event) => toggle(channel.code, event.target.checked)}
                />
                <span className="flex flex-col gap-0.5">
                  <span className="text-[15px] font-semibold">{channel.label}</span>
                  <span className="text-[13px] font-normal leading-snug text-[#5C5C63]">{channel.detail}</span>
                </span>
              </label>
              {channel.code === "paynamics" ? (
                <p className="m-0 ml-8 text-[13px] leading-snug text-[#5C5C63]">Set the convenience fee on each Paynamics option below.</p>
              ) : (
                <FeePair
                  percent={feePercents[channel.code] ?? ""}
                  pesos={feePesos[channel.code] ?? ""}
                  disabled={!editing}
                  percentLabel={`${channel.label} convenience fee percent`}
                  pesosLabel={`${channel.label} convenience fee in pesos`}
                  onPercent={(value) => {
                    feePercentsRef.current = { ...feePercentsRef.current, [channel.code]: value };
                    setFeePercents(feePercentsRef.current);
                  }}
                  onPesos={(value) => {
                    feePesosRef.current = { ...feePesosRef.current, [channel.code]: value };
                    setFeePesos(feePesosRef.current);
                  }}
                />
              )}
              <label className="ml-8 flex flex-col gap-1 text-[12px] font-semibold text-[#5C5C63]">
                Buyer label
                <input
                  className={`${field} w-full`}
                  value={drafts[channel.code] ?? ""}
                  placeholder={channel.label}
                  maxLength={80}
                  autoComplete="off"
                  disabled={!editing}
                  onChange={(event) => {
                    draftsRef.current = { ...draftsRef.current, [channel.code]: event.target.value };
                    setDrafts(draftsRef.current);
                  }}
                />
              </label>
              <label className="ml-8 flex flex-col gap-1 text-[12px] font-semibold text-[#5C5C63]">
                Checkout note
                <textarea
                  className={`${field} min-h-20 w-full resize-y`}
                  value={noteDrafts[channel.code] ?? ""}
                  placeholder={channel.note}
                  maxLength={400}
                  rows={3}
                  disabled={!editing}
                  onChange={(event) => {
                    noteDraftsRef.current = { ...noteDraftsRef.current, [channel.code]: event.target.value };
                    setNoteDrafts(noteDraftsRef.current);
                  }}
                />
                <span className="font-normal leading-snug">Buyers see: {(noteDrafts[channel.code] || "").replace(/\s+/g, " ").trim() || channel.note}</span>
              </label>
              {channel.code === "paynamics" ? (
                <div className="ml-8 flex flex-col gap-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-[12px] font-semibold text-[#5C5C63]">Paynamics options</span>
                    <span className="text-[12px] font-normal leading-snug text-[#5C5C63]">Buyers only see checked options after they choose Paynamics. Turn on another channel only if Paynamics has activated it for this merchant.</span>
                  </div>
                  <label className={`flex items-start gap-3 rounded-[14px] border border-[#D9D5CF] px-4 py-3 ${availableAllOn ? "bg-[#FBE9EA]" : ""}`}>
                    <input
                      ref={availableAllRef}
                      type="checkbox"
                      className="mt-1 h-5 w-5 accent-[#D0202E]"
                      checked={availableAllOn}
                      disabled={!editing || availableMethods.length === 0}
                      onChange={(event) => toggleAvailablePaynamics(event.target.checked)}
                    />
                    <span className="flex flex-col gap-0.5">
                      <span className="text-[15px] font-semibold">All available channels</span>
                      <span className="text-[13px] font-normal leading-snug text-[#5C5C63]">Turns Maya, GrabPay, BPI, UnionBank Online, and Landbank on or off together.</span>
                    </span>
                  </label>
                  <PaynamicsMethodChecks
                    methods={availableMethods}
                    locked={!editing}
                    feePercents={feePercents}
                    feePesos={feePesos}
                    onToggle={togglePaynamicsMethod}
                    onPercent={(code, value) => {
                      feePercentsRef.current = { ...feePercentsRef.current, [code]: value };
                      setFeePercents(feePercentsRef.current);
                    }}
                    onPesos={(code, value) => {
                      feePesosRef.current = { ...feePesosRef.current, [code]: value };
                      setFeePesos(feePesosRef.current);
                    }}
                  />
                  <span className="text-[12px] font-semibold text-[#5C5C63]">Other channels</span>
                  <PaynamicsMethodChecks
                    methods={otherMethods}
                    locked={!editing}
                    grouped
                    feePercents={feePercents}
                    feePesos={feePesos}
                    onToggle={togglePaynamicsMethod}
                    onPercent={(code, value) => {
                      feePercentsRef.current = { ...feePercentsRef.current, [code]: value };
                      setFeePercents(feePercentsRef.current);
                    }}
                    onPesos={(code, value) => {
                      feePesosRef.current = { ...feePesosRef.current, [code]: value };
                      setFeePesos(feePesosRef.current);
                    }}
                  />
                </div>
              ) : null}
            </div>
          ))}
        </div>
        {hitpayConfigured ? null : (
          <p className="m-0 text-[13px] leading-normal text-[#5C5C63]">
            HitPay QR and HitPay online banking need HITPAY_API_KEY and HITPAY_SALT on the server before a buyer can be charged.
          </p>
        )}
        {paynamicsLiveWarning ? (
          <p className="m-0 rounded-[10px] border border-[#E8B4B8] bg-[#FBE9EA] px-3 py-2 text-[13px] font-semibold leading-normal text-[#A8131F]">
            Staging live Paynamics is armed ({paynamicsCheckoutMode}): successful buyer checkouts are real charges. Registration marks paid only after a signed Paynamics GR001 (webhook or query).
          </p>
        ) : null}
        {paynamicsConfigured ? null : (
          <p className="m-0 text-[13px] leading-normal text-[#5C5C63]">
            Paynamics Workflow needs confirmed PAYNAMICS_API_BASE_URL, PAYNAMICS_API_ACCOUNT_CONFIRMED, Basic auth, and merchant ID/key before checkout can start.
          </p>
        )}
      </div>
    </section>
  );
});

function PaymentSettingsScreen({ role, onError }: { role: "super" | "admin" | ""; onError: (message: string) => void }) {
  const ticketsRef = useRef<SettingsHandle>(null);
  const channelsRef = useRef<SettingsHandle>(null);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const canEdit = role === "super";
  const locked = !editing || Boolean(confirming) || saving;

  function askSave() {
    setSaveError("");
    const changes = [...(ticketsRef.current?.changes() || []), ...(channelsRef.current?.changes() || [])];
    if (!changes.length) {
      setEditing(false);
      return;
    }
    setConfirming(changes);
  }

  async function confirmSave() {
    setSaving(true);
    setSaveError("");
    try {
      await ticketsRef.current?.save();
      await channelsRef.current?.save();
      setConfirming(null);
      setEditing(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Settings were not saved";
      setSaveError(message);
      onError(message);
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    ticketsRef.current?.reset();
    channelsRef.current?.reset();
    setConfirming(null);
    setEditing(false);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex max-w-[640px] flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 font-archivo text-[28px] font-extrabold">Settings</h1>
        {canEdit && !editing ? <button type="button" className={buttonClass} onClick={() => setEditing(true)}>Edit settings</button> : null}
        {canEdit && editing && !confirming ? (
          <div className="flex gap-2">
            <button type="button" className={buttonClass} onClick={askSave}>Save</button>
            <button type="button" className={ghostButton} onClick={cancel}>Cancel</button>
          </div>
        ) : null}
      </div>
      {canEdit ? null : <p className="m-0 max-w-[640px] text-sm text-[#5C5C63]">Only a super admin can change payment settings.</p>}
      {confirming ? (
        <div className="flex max-w-[640px] flex-col gap-3 rounded-[14px] border border-[#E8B4B8] bg-[#FBE9EA] p-4">
          <h2 className="m-0 text-[17px] font-bold">Save these changes?</h2>
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-sm">
            {confirming.map((line) => <li key={line}>{line}</li>)}
          </ul>
          <div className="flex gap-2">
            <button type="button" className={buttonClass} disabled={saving} onClick={confirmSave}>{saving ? "Saving" : "Confirm save"}</button>
            <button type="button" className={ghostButton} disabled={saving} onClick={() => { setConfirming(null); setSaveError(""); }}>Back</button>
          </div>
          {saveError ? <p className="m-0 text-sm text-[#A8131F]">{saveError}</p> : null}
        </div>
      ) : null}
      <TicketPaymentSettings ref={ticketsRef} onError={onError} editing={!locked} />
      <PaymentSettings ref={channelsRef} onError={onError} editing={!locked} />
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className={labelClass}>{label}{children}</label>;
}
