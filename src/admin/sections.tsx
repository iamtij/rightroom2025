import { useEffect, useState, type FormEvent, type ReactNode } from "react";

const field = "rounded-[10px] border border-[#D9D5CF] bg-white px-3 py-2.5 text-sm font-normal text-[#141416]";
const labelClass = "flex flex-col gap-1 text-[13px] font-semibold text-[#3A3A40]";
const buttonClass = "rounded-full bg-[#D0202E] px-4 py-2.5 text-sm font-bold text-white disabled:bg-[#E4A0A6]";

type Product = { code: string; name: string; allows_installment: number; currency: string };
type Template = { id: number; name: string; channel: "email" | "sms"; subject: string | null; body: string };
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
type Payment = { label: string; dueOn: string; amountCents: number; status: "paid" | "due" | "upcoming" };
type Registration = {
  reference: string;
  status: string;
  attendee: { fullName: string; email: string; mobile: string; business?: string; industry?: string; chapter?: string };
  tierName: string;
  plan: string;
  currency: "PHP" | "USD";
  totalCents: number;
  balanceCents: number;
  planStatus: string;
  qrReady: boolean;
  payments: Payment[];
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
  return <input className={field} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />;
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
        <StackedBars rows={data.tickets.map((ticket) => ({
          label: ticket.name,
          detail: `${ticket.signups} confirmed · ${ticket.cancelled} cancelled`,
          parts: [
            { value: ticket.signups, color: chartColors.confirmed, name: "confirmed" },
            { value: ticket.cancelled, color: chartColors.cancelled, name: "cancelled" },
          ],
        }))} />
        <p className="m-0 flex flex-wrap gap-4 text-[13px] text-[#5C5C63]">
          <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-[#D0202E]" />Confirmed</span>
          <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-[#B7B3AD]" />Cancelled</span>
        </p>
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

export function AdminSections() {
  const [section, setSection] = useState("Dashboard");
  const [error, setError] = useState("");
  return (
    <div className="flex flex-col gap-5">
      <nav className="flex flex-wrap gap-2">
        {["Dashboard", "Registrations", "Check-in", "Coupons", "Schedule", "Templates", "Members", "Chapters", "Settings"].map((item) => (
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
      {section === "Settings" ? <PaymentSettings onError={setError} /> : null}
    </div>
  );
}

const emptyRegistration = { fullName: "", email: "", mobile: "", business: "", industry: "", chapter: "", productCode: "first_mover", paymentPlan: "full" };

function Registrations({ onError }: { onError: (message: string) => void }) {
  const [rows, setRows] = useState<Registration[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<null | "add" | Registration>(null);
  const [draft, setDraft] = useState(emptyRegistration);

  async function load() {
    const [registrations, ticketProducts] = await Promise.all([
      api("/api/admin/registrations"),
      api("/api/admin/products"),
    ]);
    setRows(registrations);
    setProducts(ticketProducts);
  }
  useEffect(() => { load().catch((error) => onError(error.message)); }, []);

  function edit(row: Registration) {
    setEditor(row);
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

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editor || editor === "add") return;
    try {
      await api(`/api/admin/registrations/${editor.reference}`, { method: "PATCH", body: JSON.stringify(draft) });
      setEditor(null);
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not save");
    }
  }

  async function comp(reference: string) {
    if (!window.confirm("Mark the remaining balance as a complimentary ticket?")) return;
    try {
      const payload = await api(`/api/admin/registrations/${reference}/comp`, { method: "POST" });
      if (payload.pending) {
        onError("Waiting for another admin to approve this complimentary ticket.");
        return;
      }
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not comp this ticket");
    }
  }

  async function cancel(reference: string) {
    if (!window.confirm("Cancel this registration?")) return;
    try {
      await api(`/api/admin/registrations/${reference}/cancel`, { method: "POST" });
      if (editor !== "add" && editor?.reference === reference) setEditor(null);
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not cancel");
    }
  }

  const visible = rows.filter((row) => matches(query, [row.attendee.fullName, row.attendee.email, row.attendee.mobile, row.reference, row.tierName, row.attendee.business, row.attendee.chapter, row.status]));
  const empty = rows.length === 0 ? "No registrations yet." : visible.length === 0 ? "No registrations match that search." : "";

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 font-archivo text-[28px] font-extrabold">Registrations</h1>
        <button type="button" className={buttonClass} onClick={() => { setEditor("add"); setDraft(emptyRegistration); }}>Add manual</button>
      </div>
      <SearchBox value={query} onChange={setQuery} placeholder="Search name, email, mobile, or reference" />
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
      {editor && editor !== "add" ? (
        <form className="grid gap-3 rounded-[14px] border border-[#E4E1DC] bg-white p-4 sm:grid-cols-2" onSubmit={save}>
          <Field label="Name"><input className={field} required value={draft.fullName} onChange={(event) => setDraft({ ...draft, fullName: event.target.value })} /></Field>
          <Field label="Email"><input className={field} type="email" required value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} /></Field>
          <Field label="Mobile"><input className={field} required value={draft.mobile} onChange={(event) => setDraft({ ...draft, mobile: event.target.value })} /></Field>
          <Field label="Business"><input className={field} value={draft.business} onChange={(event) => setDraft({ ...draft, business: event.target.value })} /></Field>
          <Field label="Category"><input className={field} value={draft.industry} onChange={(event) => setDraft({ ...draft, industry: event.target.value })} /></Field>
          <Field label="Chapter"><input className={field} value={draft.chapter} onChange={(event) => setDraft({ ...draft, chapter: event.target.value })} /></Field>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <button type="submit" className={buttonClass}>Save edits</button>
            <button type="button" className={ghostButton} onClick={() => setEditor(null)}>Back</button>
            {editor.status !== "cancelled" ? <button type="button" className="rounded-full border border-[#D0202E] px-4 py-2.5 text-sm font-bold text-[#A8131F]" onClick={() => cancel(editor.reference)}>Cancel registration</button> : null}
          </div>
        </form>
      ) : null}
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
            <td className={tdClass}>{row.status === "cancelled" ? "Cancelled" : row.balanceCents === 0 ? "Fully paid" : "Active"}</td>
            <td className={`${tdClass} whitespace-nowrap text-right`}>
              <button type="button" className={linkButton} onClick={() => edit(row)}>Edit</button>
              {row.status !== "cancelled" && row.balanceCents > 0 ? <button type="button" className={`${linkButton} ml-3`} onClick={() => comp(row.reference)}>Comp</button> : null}
              {row.status !== "cancelled" ? <button type="button" className={`${linkButton} ml-3`} onClick={() => cancel(row.reference)}>Cancel</button> : null}
            </td>
          </tr>
        ))}
      </DataTable>
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

function Templates({ onError }: { onError: (message: string) => void }) {
  const [rows, setRows] = useState<Template[]>([]);
  const [form, setForm] = useState(emptyTemplate);
  const [editor, setEditor] = useState<null | "add" | number>(null);
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
        <form className="flex flex-col gap-3 rounded-[14px] border border-[#E4E1DC] bg-white p-4" onSubmit={save}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name"><input className={field} required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
            <Field label="Channel">
              <select className={field} value={form.channel} onChange={(event) => setForm({ ...form, channel: event.target.value })}>
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
          <p className="m-0 text-[13px] text-[#5C5C63]">Placeholders: {"{{first_name}}"} {"{{amount}}"} {"{{due_date}}"} {"{{pay_url}}"} {"{{reference}}"} {"{{pass_url}}"} {"{{installment}}"}</p>
          <p className="m-0 text-[13px] text-[#5C5C63]">Sample subject, installment: IBMC 2027 · ₱2,000 due in 3 days · 2 of 7. {"{{installment}}"} is the payment number, and only installment plans get it. A paid-in-full subject stays IBMC 2027 · ₱18,000 due today.</p>
          <div className="flex gap-2">
            <button type="submit" className={buttonClass}>{editor === "add" ? "Create template" : "Save template"}</button>
            <button type="button" className={ghostButton} onClick={() => setEditor(null)}>Back</button>
          </div>
        </form>
      ) : null}
      <DataTable columns={["Name", "Channel", "Subject", "Message", ""]} empty={rows.length === 0 ? "No templates yet." : ""}>
        {rows.map((row) => (
          <tr key={row.id}>
            <td className={`${tdClass} font-semibold`}>{row.name}</td>
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
  if (row.trigger === "on_date") return row.start_on || "On a date";
  const days = `${row.days_offset} day${row.days_offset === 1 ? "" : "s"}`;
  return row.trigger === "after_registration" ? `${days} after registration` : `${days} before due`;
}

function Schedules({ onError }: { onError: (message: string) => void }) {
  const [rows, setRows] = useState<Schedule[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [form, setForm] = useState(emptySchedule);
  const [editor, setEditor] = useState<null | "add" | number>(null);
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
        <button type="button" className={buttonClass} onClick={() => { setEditor("add"); setForm({ ...emptySchedule, templateId: templates[0] ? String(templates[0].id) : "" }); }}>Add</button>
      </div>
      {editor !== null ? (
        <form className="grid gap-3 rounded-[14px] border border-[#E4E1DC] bg-white p-4 sm:grid-cols-2" onSubmit={save}>
          <Field label="Name"><input className={field} required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
          <Field label="Template">
            <select className={field} required value={form.templateId} onChange={(event) => setForm({ ...form, templateId: event.target.value })}>
              <option value="">Choose a template</option>
              {templates.map((template) => <option key={template.id} value={template.id}>{template.name} · {template.channel}</option>)}
            </select>
          </Field>
          <Field label="When to send">
            <select className={field} value={form.trigger} onChange={(event) => setForm({ ...form, trigger: event.target.value })}>
              <option value="before_due">Before a due date</option>
              <option value="after_registration">After registration</option>
              <option value="on_date">On a date</option>
            </select>
          </Field>
          {form.trigger === "on_date"
            ? <Field label="Date"><input className={field} type="date" required value={form.startOn} onChange={(event) => setForm({ ...form, startOn: event.target.value })} /></Field>
            : <Field label="Days"><input className={field} type="number" min="0" value={form.daysOffset} onChange={(event) => setForm({ ...form, daysOffset: event.target.value })} /></Field>}
          <Field label="Send time"><input className={field} type="time" value={form.sendTime} onChange={(event) => setForm({ ...form, sendTime: event.target.value })} /></Field>
          <Field label="Frequency">
            <select className={field} value={form.frequency} onChange={(event) => setForm({ ...form, frequency: event.target.value })}>
              <option value="once">Once</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
          </Field>
          <Field label="Who">
            <select className={field} value={form.audience} onChange={(event) => setForm({ ...form, audience: event.target.value })}>
              <option value="unpaid">Unpaid balances</option>
              <option value="fully_paid">Fully paid</option>
              <option value="all">Everyone confirmed</option>
            </select>
          </Field>
          <Field label="End date"><input className={field} type="date" value={form.endsOn} onChange={(event) => setForm({ ...form, endsOn: event.target.value })} /></Field>
          <Field label="Stop after"><input className={field} type="number" min="1" placeholder="Number of sends" value={form.endsAfter} onChange={(event) => setForm({ ...form, endsAfter: event.target.value })} /></Field>
          <div className="flex gap-2 sm:col-span-2">
            <button type="submit" className={buttonClass}>{editor === "add" ? "Create schedule" : "Save schedule"}</button>
            <button type="button" className={ghostButton} onClick={() => setEditor(null)}>Back</button>
          </div>
        </form>
      ) : null}
      <DataTable columns={["Name", "Template", "When", "Frequency", "Who", "Ends", ""]} empty={rows.length === 0 ? "No schedules yet." : ""}>
        {rows.map((row) => (
          <tr key={row.id}>
            <td className={`${tdClass} font-semibold`}>{row.name}</td>
            <td className={tdClass}>{row.template_name} · {row.channel === "email" ? "Email" : "SMS"}</td>
            <td className={tdClass}>{whenLabel(row)} · {String(row.send_time).slice(0, 5)}</td>
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
  detail: string;
  enabled: boolean;
};

function PaymentSettings({ onError }: { onError: (message: string) => void }) {
  const [channels, setChannels] = useState<PaymentChannelSetting[]>([]);
  const [hitpayConfigured, setHitpayConfigured] = useState(true);
  const [paynamicsConfigured, setPaynamicsConfigured] = useState(true);
  const [saving, setSaving] = useState("");

  async function load() {
    const payload = await api("/api/admin/payment-channels");
    setChannels(payload.channels || []);
    setHitpayConfigured(Boolean(payload.hitpayConfigured));
    setPaynamicsConfigured(Boolean(payload.paynamicsConfigured));
  }

  useEffect(() => {
    load().catch((error) => onError(error.message));
  }, []);

  async function toggle(code: string, enabled: boolean) {
    setSaving(code);
    setChannels((current) => current.map((item) => (item.code === code ? { ...item, enabled } : item)));
    try {
      const payload = await api("/api/admin/payment-channels", {
        method: "PATCH",
        body: JSON.stringify({ [code]: enabled }),
      });
      setChannels(payload.channels || []);
      setHitpayConfigured(Boolean(payload.hitpayConfigured));
      setPaynamicsConfigured(Boolean(payload.paynamicsConfigured));
    } catch (error) {
      onError(error instanceof Error ? error.message : "Payment channels were not saved");
      await load().catch(() => {});
    } finally {
      setSaving("");
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <h1 className="m-0 font-archivo text-[28px] font-extrabold">Settings</h1>
      <div className="flex max-w-[640px] flex-col gap-4 rounded-[14px] border border-[#E4E1DC] bg-white p-4">
        <div className="flex flex-col gap-1">
          <h2 className="m-0 text-[17px] font-bold">Payment channels</h2>
          <p className="m-0 text-[13px] leading-normal text-[#5C5C63]">Checked channels are the ones a buyer can use when paying.</p>
        </div>
        <div className="overflow-hidden rounded-[14px] border border-[#D9D5CF]">
          {channels.map((channel) => (
            <label key={channel.code} className={`flex items-start gap-3 border-t border-[#E4E1DC] px-4 py-4 first:border-t-0 ${channel.enabled ? "bg-[#FBE9EA]" : ""}`}>
              <input
                type="checkbox"
                className="mt-1 h-5 w-5 accent-[#D0202E]"
                checked={channel.enabled}
                disabled={saving === channel.code}
                onChange={(event) => toggle(channel.code, event.target.checked)}
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-[15px] font-semibold">{channel.label}</span>
                <span className="text-[13px] font-normal leading-snug text-[#5C5C63]">{channel.detail}</span>
              </span>
            </label>
          ))}
        </div>
        {hitpayConfigured ? null : (
          <p className="m-0 text-[13px] leading-normal text-[#5C5C63]">
            HitPay QR and HitPay online banking need HITPAY_API_KEY and HITPAY_SALT on the server before a buyer can be charged.
          </p>
        )}
        {paynamicsConfigured ? null : (
          <p className="m-0 text-[13px] leading-normal text-[#5C5C63]">
            Paynamics Workflow needs confirmed PAYNAMICS_API_BASE_URL, PAYNAMICS_API_ACCOUNT_CONFIRMED, Basic auth, and merchant ID/key before checkout can start.
          </p>
        )}
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className={labelClass}>{label}{children}</label>;
}
