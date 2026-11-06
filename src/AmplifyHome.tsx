import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

const FIRST_MOVER_OPENS = new Date("2026-11-11T00:00:00+08:00");
const FIRST_MOVER_ENDS = new Date("2026-12-01T00:00:00+08:00");
const CHAPTER_FINDER = "https://growwithbniph.com/";

const ROW_A = ["Accountants", "Architects", "Caterers", "Insurance", "IT services", "Lawyers", "Logistics", "Printing"];
const ROW_B = ["Real estate", "Events", "Dentists", "Interior design", "Photography", "Marketing", "Construction", "Travel"];

const METER_BASE = 222;
const METER_CAP = 146;
const METER_BARS = [
  { x: 783, h: 55, fill: "#FFFFFF", dur: "0.78s", delay: "-0.35s" },
  { x: 796, h: 105, fill: "#FFFFFF", dur: "1.18s", delay: "-0.9s" },
  { x: 809, h: 146, fill: "#FF4D5A", dur: "0.66s", delay: "-0.2s" },
  { x: 822, h: 121, fill: "#FF4D5A", dur: "1.02s", delay: "-1.25s" },
  { x: 835, h: 75, fill: "#FFFFFF", dur: "0.9s", delay: "-0.55s" },
];

const PROBLEM_BARS = Array.from({ length: 42 }, (_, i) => {
  const t = i / 41;
  const amp = 1 - t;
  const wave = 0.55 + 0.45 * Math.abs(Math.sin(i * 1.35));
  const h = Math.max(7, Math.round(amp * amp * 186 * wave));
  const c = t < 0.32 ? "#D0202E" : t < 0.55 ? "#E8828A" : "#C9C4BD";
  return { h, c };
});

const STAKES_BARS = Array.from({ length: 56 }, (_, i) => {
  if (i < 44) return { h: 4, c: "#55555C" };
  const wave = 14 + Math.abs(Math.sin(i * 1.7)) * 36;
  return { h: Math.round(wave), c: "#FF4D5A" };
});

const FAQS: { q: string; a: ReactNode }[] = [
  {
    q: "Do I need to be a BNI member?",
    a: "No. Guests are welcome. IBMC is a great first look at how BNI works.",
  },
  {
    q: "Who will I meet there?",
    a: "Members and guests from across the Philippines, and international delegates — business owners who can send you clients.",
  },
  {
    q: "What happens during business matching?",
    a: "Structured time with owners whose clients overlap with yours — partners, not competitors — and more ways to connect and collaborate.",
  },
  {
    q: "Where and when is IBMC 2027?",
    a: "June 16–17, 2027 at Newport Performing Arts Theater, Pasay City.",
  },
  {
    q: "Can I pay in installments?",
    a: <InstallmentAnswer />,
  },
  {
    q: "I'm joining from outside the Philippines. What do I pay?",
    a: "International delegates pay in full. Early Bird is USD 250 from January through March 2027. Regular is USD 350 from April through May 31, 2027. There is no installment plan.",
  },
  {
    q: "Is the fee refundable?",
    a: <RefundAnswer />,
  },
];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

const FIRST_MOVER_PLAN = [
  ["Upon registration", "₱1,000"],
  ["Dec 15, 2026", "₱2,000"],
  ["Jan 15, 2027", "₱2,000"],
  ["Feb 15, 2027", "₱2,000"],
  ["Mar 15, 2027", "₱2,000"],
  ["Apr 15, 2027", "₱2,000"],
  ["May 15, 2027", "₱2,000"],
];

const EARLY_BIRD_PLAN = [
  ["Upon registration", "₱4,000"],
  ["Feb 15, 2027", "₱3,000"],
  ["Mar 15, 2027", "₱3,000"],
  ["Apr 15, 2027", "₱3,000"],
  ["May 15, 2027", "₱3,000"],
];

function InstallmentPlan({
  total,
  summary,
  rows,
  note,
  tone,
}: {
  total: string;
  summary: string;
  rows: string[][];
  note?: string;
  tone: "red" | "neutral";
}) {
  const [open, setOpen] = useState(false);
  const head = tone === "red" ? "border-[#E7B4B8] bg-[#FBE9EA]" : "border-[#E4E1DC] bg-[#F6F4F1]";
  return (
    <div className="overflow-hidden rounded-xl border border-[#E4E1DC] text-left text-sm text-[#141416]">
      <div className={`flex items-center gap-3 border-l-4 px-3 py-2.5 ${head} ${tone === "red" ? "border-l-[#D0202E]" : "border-l-[#141416]"} ${open ? "border-b" : ""}`}>
        <div className="min-w-0 flex-1">
          <p className="m-0 font-bold">Installment Plan at {total}</p>
        </div>
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? "Hide payment dates" : "Show payment dates"}
          className="mt-0.5 flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-[#D9D5CF] bg-white text-[#141416]"
          onClick={() => setOpen((value) => !value)}
        >
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" className={`transition-transform ${open ? "rotate-180" : ""}`}>
            <path d="M2.5 5.25 7 9.25l4.5-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      {open && (
        <>
          <p className="m-0 border-b border-[#E4E1DC] px-3 py-2.5 text-[13px] font-medium text-[#3A3A40]">{summary}</p>
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-[#141416] text-left text-[13px] text-white">
                <th className="px-3 py-2 font-semibold">Due date</th>
                <th className="px-3 py-2 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([date, amount], i) => (
                <tr key={date} className={i % 2 === 0 ? "bg-white" : "bg-[#F6F4F1]"}>
                  <td className="px-3 py-2">{date}</td>
                  <td className="px-3 py-2 text-right font-semibold">{amount}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {note && <p className="m-0 border-t border-[#E4E1DC] px-3 py-2.5 text-[13px] leading-snug text-[#5C5C63]">{note}</p>}
        </>
      )}
    </div>
  );
}

function Price({ text, className = "" }: { text: string; className?: string }) {
  const parts = text.split("₱");
  return (
    <span className={className}>
      {parts.map((part, i) => (
        <span key={i}>
          {i > 0 && (
            <span className="font-sans" style={{ fontStretch: "100%" }}>
              ₱
            </span>
          )}
          {part}
        </span>
      ))}
    </span>
  );
}

function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function remaining(target: Date, now: Date) {
  const diff = Math.max(0, target.getTime() - now.getTime());
  return {
    days: Math.floor(diff / 86400000),
    hours: Math.floor((diff % 86400000) / 3600000),
    minutes: Math.floor((diff % 3600000) / 60000),
    seconds: Math.floor((diff % 60000) / 1000),
  };
}

function firstMoverPhase(now: Date) {
  if (now < FIRST_MOVER_OPENS) return "before" as const;
  if (now < FIRST_MOVER_ENDS) return "live" as const;
  return "ended" as const;
}

function FirstMoverTimer({ now }: { now: Date }) {
  const phase = firstMoverPhase(now);
  const left = remaining(phase === "before" ? FIRST_MOVER_OPENS : FIRST_MOVER_ENDS, now);
  if (phase === "ended") {
    return <p className="m-0 text-sm font-semibold text-[#5C5C63]">Ended at midnight</p>;
  }
  const units = [
    ["Days", left.days],
    ["Hrs", left.hours],
    ["Min", left.minutes],
    ["Sec", left.seconds],
  ];
  return (
    <div aria-live="polite">
      <p className="m-0 text-[11px] font-bold uppercase tracking-[0.14em] text-[#A8131F]">
        {phase === "before" ? "Opens in" : "Ends at midnight in"}
      </p>
      <div className="mt-2 grid grid-cols-4 gap-2">
        {units.map(([label, value]) => (
          <div key={label} className="flex flex-col items-center rounded-xl bg-[#FBE9EA] py-2.5">
            <span className="font-archivo text-[22px] font-extrabold leading-none tabular-nums text-[#141416]">{pad(Number(value))}</span>
            <span className="mt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#A8131F]">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Marquee({ items, reverse = false, className = "" }: { items: string[]; reverse?: boolean; className?: string }) {
  const line = [...items, ...items];
  return (
    <div className={`mq flex w-max ${reverse ? "mq-right" : ""} ${className}`}>
      {line.map((item, i) => (
        <span key={`${item}-${i}`} className="whitespace-nowrap pr-11">
          {item}
        </span>
      ))}
    </div>
  );
}

function Waveform({
  bars,
  height,
  className = "",
  live = false,
}: {
  bars: { h: number; c: string }[];
  height: number;
  className?: string;
  live?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [play, setPlay] = useState(false);
  const [reduce] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const animate = live && !reduce;

  useEffect(() => {
    if (!animate) return;
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setPlay(true);
        observer.disconnect();
      },
      { threshold: 0.5 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [animate]);

  return (
    <div ref={ref} aria-hidden="true" className={`flex items-center gap-[5px] overflow-hidden ${className}`} style={{ height }}>
      {bars.map((bar, i) => (
        <span
          key={i}
          className={`w-[6px] shrink-0 rounded-[3px] ${animate ? `quiet-bar${play ? " is-playing" : ""}` : ""}`}
          style={
            {
              height: animate ? undefined : bar.h,
              background: animate ? undefined : bar.c,
              animationDelay: play ? `${i * 16}ms` : undefined,
              "--bar-h": `${bar.h}px`,
              "--bar-c": bar.c,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

function Photo({
  src,
  alt,
  caption,
  className = "",
  captionClassName = "text-[15px] font-semibold leading-snug",
  position = "center",
}: {
  src: string;
  alt: string;
  caption: string;
  className?: string;
  captionClassName?: string;
  position?: string;
}) {
  return (
    <figure className={`group relative overflow-hidden ${className}`}>
      <img
        src={src}
        alt={alt}
        className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.03]"
        style={{ objectPosition: position }}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/15 to-black/25" />
      <figcaption className={`absolute inset-x-0 bottom-0 p-4 text-white ${captionClassName}`}>{caption}</figcaption>
    </figure>
  );
}

function BeforeAfter() {
  const ref = useRef<HTMLDivElement>(null);
  const [pct, setPct] = useState(50);
  const [width, setWidth] = useState(0);
  const dragging = useRef(false);
  const nudge = useRef<number[]>([]);

  const clearNudge = () => {
    nudge.current.forEach((id) => window.clearTimeout(id));
    nudge.current = [];
  };

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(el.offsetWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (media.matches) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setPct(42);
        nudge.current = [
          window.setTimeout(() => {
            if (!dragging.current) setPct(58);
          }, 420),
          window.setTimeout(() => {
            if (!dragging.current) setPct(50);
          }, 860),
        ];
        observer.disconnect();
      },
      { threshold: 0.5 },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      clearNudge();
    };
  }, []);

  const move = (clientX: number) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const next = ((clientX - rect.left) / rect.width) * 100;
    setPct(Math.min(82, Math.max(18, next)));
  };

  return (
    <>
      <div
        ref={ref}
        role="slider"
        tabIndex={0}
        aria-label="Drag to compare before and after"
        aria-valuemin={18}
        aria-valuemax={82}
        aria-valuenow={Math.round(pct)}
        className="relative hidden min-h-[400px] cursor-ew-resize touch-none select-none overflow-hidden rounded-[20px] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#141416] md:block"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          clearNudge();
          dragging.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          move(event.clientX);
        }}
        onPointerMove={(event) => {
          if (dragging.current) move(event.clientX);
        }}
        onPointerUp={(event) => {
          dragging.current = false;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onPointerCancel={() => {
          dragging.current = false;
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          clearNudge();
          const step = event.key === "ArrowLeft" ? -6 : 6;
          setPct((value) => Math.min(82, Math.max(18, value + step)));
        }}
      >
        <div className="pointer-events-none absolute inset-0 bg-[#D0202E] text-white">
          <div className="ml-auto flex h-full w-1/2 flex-col justify-center gap-[18px] py-11 pl-14 pr-11">
            <span className="text-[13px] font-semibold uppercase tracking-[0.18em]">After</span>
            <p className="m-0 text-[26px] font-semibold leading-snug">Clients that keep coming.</p>
            <p className="m-0 text-[26px] font-semibold leading-snug">A network across industries.</p>
            <p className="m-0 text-[26px] font-semibold leading-snug">People who refer you every week.</p>
          </div>
        </div>
        <div className="pointer-events-none absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${pct}%` }}>
          <div className="h-full bg-[#E4E1DC] text-[#3A3A40]" style={{ width: width || "100%" }}>
            <div className="flex h-full w-1/2 flex-col justify-center gap-[18px] py-11 pl-11 pr-14 text-right">
              <span className="text-[13px] font-semibold uppercase tracking-[0.18em] text-[#5C5C63]">Before</span>
              <p className="m-0 text-[26px] leading-snug">One good month, then quiet.</p>
              <p className="m-0 text-[26px] leading-snug">Same friends, same circle.</p>
              <p className="m-0 text-[26px] leading-snug">No plan for the next client.</p>
            </div>
          </div>
        </div>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 z-10 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-[3px] border-white bg-[#141416] text-lg font-bold text-white"
          style={{ left: `${pct}%` }}
        >
          ⇆
        </div>
      </div>
      <div className="flex flex-col overflow-hidden rounded-[20px] md:hidden">
        <div className="flex flex-col gap-[18px] bg-[#E4E1DC] p-8 text-[#3A3A40]">
          <span className="text-[13px] font-semibold uppercase tracking-[0.18em] text-[#5C5C63]">Before</span>
          <p className="m-0 text-[22px] leading-snug">One good month, then quiet.</p>
          <p className="m-0 text-[22px] leading-snug">Same friends, same circle.</p>
          <p className="m-0 text-[22px] leading-snug">No plan for the next client.</p>
        </div>
        <div className="flex flex-col gap-[18px] bg-[#D0202E] p-8 text-white">
          <span className="text-[13px] font-semibold uppercase tracking-[0.18em]">After</span>
          <p className="m-0 text-[22px] font-semibold leading-snug">Clients that keep coming.</p>
          <p className="m-0 text-[22px] font-semibold leading-snug">A network across industries.</p>
          <p className="m-0 text-[22px] font-semibold leading-snug">People who refer you every week.</p>
        </div>
      </div>
    </>
  );
}

function InstallmentAnswer() {
  const rows = [
    ["First Mover", "₱12,000", "₱13,000. ₱1,000 when you register, then ₱2,000 on the 15th each month from December 2026 through May 2027"],
    ["Early Bird", "₱15,000", "₱16,000. ₱4,000 when you register, then ₱3,000 on the 15th from February through May 2027"],
    ["Regular", "₱18,000", "Paid once"],
  ];
  return (
    <div className="flex flex-col gap-3">
      <p className="m-0">Yes on First Mover and Early Bird. Regular is paid once.</p>
      <div className="overflow-x-auto rounded-xl border border-[#E4E1DC]">
        <table className="w-full border-collapse text-left text-sm text-[#141416]">
          <thead>
            <tr className="bg-[#141416] text-white">
              <th className="px-3 py-2 font-semibold">Tier</th>
              <th className="px-3 py-2 font-semibold">In full</th>
              <th className="px-3 py-2 font-semibold">Installments</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([tier, full, plan], i) => (
              <tr key={tier} className={i % 2 === 0 ? "bg-white" : "bg-[#F6F4F1]"}>
                <td className="whitespace-nowrap px-3 py-2.5 align-top font-semibold">{tier}</td>
                <td className="whitespace-nowrap px-3 py-2.5 align-top font-semibold"><Price text={full} /></td>
                <td className="px-3 py-2.5 align-top leading-snug"><Price text={plan} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RefundAnswer() {
  return (
    <>
      <p className="m-0 max-w-[62ch]">
        Payments already made are kept. If an installment is 15 days late, the plan ends and the ticket moves to the Regular rate of <Price text="₱18,000" />. What you've paid is credited toward that rate, and the balance is due by May 31, 2027.
      </p>
      <a href="/terms#refunds" className="mt-2 inline-block font-semibold text-[#A8131F] underline">Read the terms</a>
    </>
  );
}

function FaqList() {
  const [open, setOpen] = useState(0);
  return (
    <div className="flex min-w-0 flex-[999_1_560px] flex-col">
      {FAQS.map((item, i) => {
        const expanded = open === i;
        const text = typeof item.a === "string";
        return (
          <div key={item.q} className={`border-t border-[#D9D5CF] py-[22px] ${i === FAQS.length - 1 ? "border-b" : ""}`}>
            <button
              type="button"
              aria-expanded={expanded}
              className="flex w-full cursor-pointer items-start justify-between gap-4 text-left text-[19px] font-semibold"
              onClick={() => setOpen(expanded ? -1 : i)}
            >
              <span>{item.q}</span>
              <span aria-hidden="true" className="text-[#A8131F]">
                {expanded ? "−" : "+"}
              </span>
            </button>
            {expanded && (
              text ? (
                <p className="m-0 mt-2.5 max-w-[62ch] text-base leading-relaxed text-[#3A3A40]">{item.a}</p>
              ) : (
                <div className="mt-2.5 text-base leading-relaxed text-[#3A3A40]">{item.a}</div>
              )
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function AmplifyHome() {
  const now = useNow();
  const phase = firstMoverPhase(now);
  const countdown = remaining(phase === "before" ? FIRST_MOVER_OPENS : FIRST_MOVER_ENDS, now);

  return (
    <div className="scroll-wrapper scroll-smooth bg-[#0E0E10] font-sans text-[#F6F4F1]">
      <nav aria-label="Main" className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-4 border-b border-white/10 bg-[#0E0E10]/95 px-4 py-5 backdrop-blur-md sm:px-8 lg:px-14">
          <a href="#top" className="flex items-center gap-3 text-[#F6F4F1] no-underline">
            <img src="/assets/bni-philippines-mark.png" alt="BNI Philippines" className="h-12 w-auto sm:h-14" />
            <span className="font-archivo text-lg font-extrabold tracking-[0.04em]">
              IBMC <span className="text-[#FF4D5A]">2027</span>
            </span>
          </a>
          <div className="nav-links flex flex-wrap items-center gap-7 text-sm">
            <a href="#why" className="hidden text-[#D9D7D2] no-underline min-[761px]:inline">Why IBMC</a>
            <a href="#new" className="hidden text-[#D9D7D2] no-underline min-[761px]:inline">New to BNI?</a>
            <a href="#how" className="hidden text-[#D9D7D2] no-underline min-[761px]:inline">How it works</a>
            <a href="#pricing" className="hidden text-[#D9D7D2] no-underline min-[761px]:inline">Tickets</a>
            <a href="#faq" className="hidden text-[#D9D7D2] no-underline min-[761px]:inline">FAQ</a>
            <a href="/register" className="nav-cta rounded-full bg-[#D0202E] px-[22px] py-3 font-semibold text-white no-underline">
              Register
            </a>
          </div>
      </nav>
      <section id="top" className="relative flex min-h-[calc(100svh-5.5rem)] flex-col overflow-hidden bg-[#0E0E10] sm:min-h-[calc(100svh-6rem)] md:min-h-[840px]">
        <div className="absolute inset-0 bg-[#1C1C20]" />

        <div className="relative flex flex-1 flex-col items-center justify-center gap-[22px] px-4 py-10 text-center sm:px-8 lg:px-14">
          <p className="m-0 text-[13px] uppercase tracking-[0.18em] text-[#C9C7C2]">
            IBMC 2027 · International Business Matching Conference · BNI Philippines
          </p>
          <h1 aria-label="AMPLIFY" className="wordmark m-0 w-full max-w-[1100px]">
            <svg aria-hidden="true" viewBox="0 0 1200 260" className="block h-auto w-full">
              <text x="10" y="222" textLength="755" lengthAdjust="spacingAndGlyphs" fill="#FFFFFF" fontSize="210" fontWeight="900" style={{ fontFamily: "Archivo, sans-serif", fontStretch: "125%" }}>
                AMPL
              </text>
              {METER_BARS.map((bar) => (
                <g key={bar.x}>
                  <rect x={bar.x} y={METER_BASE - METER_CAP} width="8" height={METER_CAP} fill="#2B2B30" />
                  <rect
                    className="meter-bar"
                    x={bar.x}
                    y={METER_BASE - bar.h}
                    width="8"
                    height={bar.h}
                    fill={bar.fill}
                    style={{ ["--meter-dur" as string]: bar.dur, ["--meter-delay" as string]: bar.delay }}
                  />
                </g>
              ))}
              <text x="862" y="222" textLength="328" lengthAdjust="spacingAndGlyphs" fill="#FFFFFF" fontSize="210" fontWeight="900" style={{ fontFamily: "Archivo, sans-serif", fontStretch: "125%" }}>
                FY
              </text>
            </svg>
          </h1>
          <p className="m-0 font-archivo text-[clamp(16px,1.8vw,22px)] font-bold uppercase tracking-[0.12em] text-[#FF4D5A]">
            Amplify others. Get amplified.
          </p>
          <p className="m-0 font-archivo text-[clamp(28px,3.4vw,44px)] font-extrabold leading-none text-white">June 16–17, 2027</p>
          <p className="m-0 text-[clamp(16px,1.6vw,20px)] text-[#C9C7C2]">Newport Performing Arts Theater, Pasay City</p>
          <div className="mt-1.5 flex flex-wrap justify-center gap-3.5">
            <a href="/register" className="rounded-full bg-[#D0202E] px-[30px] py-4 text-base font-semibold text-white no-underline">
              Register
            </a>
            <a href="#new" className="rounded-full border border-[#F6F4F1] px-7 py-[15px] text-base font-semibold text-[#F6F4F1] no-underline">
              New to BNI?
            </a>
          </div>
          <p className="m-0 text-[13px] text-[#C9C7C2]">
            From ₱12,000 ·{" "}
            {phase === "ended" ? (
              <strong className="text-white">First Mover has ended</strong>
            ) : (
              <>
                First Mover {phase === "before" ? "opens" : "ends"} in{" "}
                <strong className="text-white">
                  {pad(countdown.days)}d {pad(countdown.hours)}h {pad(countdown.minutes)}m {pad(countdown.seconds)}s
                </strong>
              </>
            )}
          </p>
        </div>

        <div aria-label="Businesses in the room" className="relative flex flex-col gap-3.5 overflow-hidden border-t border-[#34343A] py-5 font-archivo text-[15px] font-semibold uppercase tracking-[0.08em]">
          <Marquee items={ROW_A} className="text-[#8E8E96]" />
          <Marquee items={ROW_B} reverse className="text-[#C9C7C2]" />
        </div>
      </section>

      <section id="why" className="flex flex-col items-center gap-12 bg-[#F6F4F1] px-4 py-20 text-center text-[#141416] sm:px-8 lg:px-24 lg:py-[110px]">
        <div className="flex max-w-[820px] flex-col items-center gap-5">
          <p className="m-0 text-[13px] font-semibold uppercase tracking-[0.18em] text-[#A8131F]">Sound familiar?</p>
          <h2 className="m-0 font-archivo text-[clamp(36px,4.4vw,60px)] font-extrabold leading-[1.02]">
            Why your best month is always followed by a quiet one.
          </h2>
        </div>
        <div className="flex w-max max-w-full flex-col gap-4">
          <Waveform bars={PROBLEM_BARS} height={220} live />
          <div className="flex justify-between text-[13px] uppercase tracking-[0.12em] text-[#5C5C63]">
            <span>Inquiries · good month</span>
            <span>Quiet month</span>
          </div>
        </div>
        <div className="flex max-w-[680px] flex-col items-center gap-4">
          <p className="m-0 font-archivo text-[clamp(28px,3.2vw,44px)] font-extrabold leading-[1.08]">
            It's not your product. It's your network.
          </p>
          <p className="m-0 text-[19px] leading-relaxed text-[#3A3A40]">That network already meets every week.</p>
          <a href="#new" className="text-[15px] font-semibold text-[#A8131F] no-underline">
            See who's in the room →
          </a>
        </div>
      </section>

      <section id="new" className="flex flex-col gap-10 bg-[#0E0E10] px-4 py-20 text-[#F6F4F1] sm:px-8 lg:px-24 lg:py-[100px]">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div className="flex max-w-[760px] flex-col gap-3.5">
            <p className="m-0 text-[13px] font-semibold uppercase tracking-[0.18em] text-[#FF4D5A]">New to BNI?</p>
            <h2 className="m-0 font-archivo text-[clamp(36px,4.4vw,60px)] font-extrabold leading-[1.02]">
              The system 355,000 business owners use to refer each other — since 1985.
            </h2>
            <p className="m-0 text-[19px] leading-relaxed text-[#C9C7C2]">
              BNI members refer clients to each other every week. IBMC puts business owners in one room.
            </p>
          </div>
          <a href="#pricing" className="rounded-full border border-[#F6F4F1] px-[22px] py-[13px] text-[15px] font-semibold text-[#F6F4F1] no-underline">
            I'm already a member — skip to tickets
          </a>
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          <article className="flex flex-col gap-4 rounded-2xl bg-[#1C1C20] p-6">
            <Photo
              src="/assets/ibmc-strategic-alignment.png"
              alt="IBMC members comparing notes and referrals"
              caption="Every week, members bring each other new clients."
              className="h-[180px] rounded-[10px]"
            />
            <span className="font-archivo text-sm font-bold text-[#FF4D5A]">01</span>
            <h3 className="m-0 font-archivo text-[32px] font-extrabold font-wide">BNI</h3>
            <p className="-mt-2 mb-0 text-[15px] font-semibold text-[#FF4D5A]">Business Network International</p>
            <p className="m-0 text-base leading-relaxed text-[#C9C7C2]">
              A global network of business owners who meet every week and refer clients to each other. Not cold leads — real introductions from people who know you.
            </p>
          </article>
          <article className="flex flex-col gap-4 rounded-2xl bg-[#1C1C20] p-6">
            <Photo
              src="/assets/ibmc-2.png"
              alt="Two members filling out a referral slip at IBMC"
              caption="Give a referral today. Get one back tomorrow."
              className="h-[180px] rounded-[10px]"
              position="center 30%"
            />
            <span className="font-archivo text-sm font-bold text-[#FF4D5A]">02</span>
            <h3 className="m-0 font-archivo text-[32px] font-extrabold font-wide">Givers Gain®</h3>
            <p className="-mt-2 mb-0 text-[15px] font-semibold text-[#FF4D5A]">The idea behind it all</p>
            <p className="m-0 text-base leading-relaxed text-[#C9C7C2]">
              When you amplify others, they amplify you. You send them clients; they send you clients.
            </p>
          </article>
          <article className="flex flex-col gap-4 rounded-2xl bg-[#D0202E] p-6 text-white">
            <Photo
              src="/assets/ibmc-5.png"
              alt="The IBMC hall filled with business owners"
              caption="Hundreds of business owners. One room. Two days."
              className="h-[180px] rounded-[10px]"
            />
            <span className="font-archivo text-sm font-bold">03</span>
            <h3 className="m-0 font-archivo text-[32px] font-extrabold font-wide">IBMC</h3>
            <p className="-mt-2 mb-0 text-[15px] font-semibold">International Business Matching Conference</p>
            <p className="m-0 text-base leading-relaxed">
              BNI Philippines' two-day conference. Members and guests meet, match and refer each other in one room.
            </p>
          </article>
        </div>
      </section>

      <section id="how" className="flex flex-col gap-14 bg-[#F6F4F1] px-4 py-20 text-[#141416] sm:px-8 lg:px-24 lg:py-[100px]">
        <div className="flex max-w-[640px] flex-col gap-3.5">
          <p className="m-0 text-[13px] font-semibold uppercase tracking-[0.18em] text-[#A8131F]">How it works</p>
          <h2 className="m-0 font-archivo text-[clamp(36px,4.4vw,60px)] font-extrabold leading-[1.02]">
            Here's exactly what happens in 2 days.
          </h2>
        </div>
        <div className="relative grid grid-cols-1 gap-10 md:grid-cols-3">
          <div className="plan-line absolute left-0 right-0 top-16 hidden h-[3px] bg-[#D0202E] min-[761px]:block" aria-hidden="true" />
          {[
            ["01", "Get your seat", "Members and guests are both welcome. Pay in full or in installments."],
            ["02", "Meet owners who can refer you", "Two days with owners from other industries who can send you clients."],
            ["03", "Leave with referrals", "Go home with introductions, new partners and a plan for your next client."],
          ].map(([num, title, body]) => (
            <div key={num} className="relative flex flex-col gap-3.5">
              <span className="self-start bg-[#F6F4F1] pr-4 font-archivo text-[112px] font-black leading-none font-expanded text-[#D0202E]">
                {num}
              </span>
              <h3 className="m-0 text-2xl font-bold">{title}</h3>
              <p className="m-0 text-[17px] leading-relaxed text-[#5C5C63]">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-10 bg-[#0E0E10] px-4 py-20 text-[#F6F4F1] sm:px-8 lg:px-24 lg:py-[100px]">
        <div className="flex max-w-[820px] flex-col gap-3.5">
          <p className="m-0 text-[13px] font-semibold uppercase tracking-[0.18em] text-[#FF4D5A]">Inside the room</p>
          <h2 className="m-0 font-archivo text-[clamp(36px,4.4vw,60px)] font-extrabold leading-[1.02]">
            Imagine walking out with new connections who can introduce you.
          </h2>
        </div>
        <div className="room-grid grid grid-cols-1 gap-4 min-[761px]:grid-cols-4">
          <Photo
            src="/assets/ibmc-5.png"
            alt="A full house at IBMC inside Newport Performing Arts Theater"
            caption="Business owners. One hall. Every one a possible referral."
            captionClassName="text-xl font-bold leading-snug"
            className="min-h-[280px] rounded-[14px] min-[761px]:col-span-2 min-[761px]:row-span-2 min-[761px]:min-h-[400px]"
            position="center 40%"
          />
          <Photo
            src="/assets/ibmc-3.png"
            alt="Members in a one-on-one matching conversation"
            caption="Every table is a potential referral partner."
            className="min-h-[200px] rounded-[14px]"
          />
          <Photo
            src="/assets/ibmc-4.png"
            alt="Two business owners meeting at IBMC"
            caption="A handshake today. A client next month."
            className="min-h-[200px] rounded-[14px]"
            position="center 20%"
          />
          <Photo
            src="/assets/ibmc-2.png"
            alt="Members exchanging referral details"
            caption="Introductions made at IBMC 2026."
            className="min-h-[200px] rounded-[14px]"
            position="center 35%"
          />
          <Photo
            src="/assets/ibmc-strategic-alignment.png"
            alt="Members smiling over a referral at IBMC"
            caption="Members celebrating referrals that closed."
            className="min-h-[200px] rounded-[14px]"
            position="center 40%"
          />
        </div>
      </section>

      <section className="flex flex-col gap-10 bg-white px-4 py-20 text-[#141416] sm:px-8 lg:px-24 lg:py-[100px]">
        <div className="flex max-w-[640px] flex-col gap-3.5">
          <p className="m-0 text-[13px] font-semibold uppercase tracking-[0.18em] text-[#A8131F]">What changes after</p>
          <h2 className="m-0 font-archivo text-[clamp(36px,4.4vw,60px)] font-extrabold leading-[1.02]">
            Next month doesn't have to be quiet.
          </h2>
        </div>
        <BeforeAfter />
      </section>

      <section className="flex flex-col items-center justify-center gap-[26px] bg-[#0E0E10] px-4 py-20 text-center text-[#F6F4F1] sm:px-8 lg:px-24 lg:py-[90px]">
        <Waveform bars={STAKES_BARS} height={64} className="w-full max-w-[720px] justify-center" />
        <h2 className="m-0 max-w-[900px] font-archivo text-[clamp(32px,4vw,54px)] font-extrabold leading-[1.08]">
          First Mover pricing ends November 30. After that, the price only goes up.
        </h2>
        <p className="m-0 max-w-[600px] text-lg leading-relaxed text-[#C9C7C2]">
          The future isn't waiting — and neither is First Mover pricing. Your competitors will be in the room. Make sure you are too.
        </p>
        <a href="/register" className="rounded-full bg-[#D0202E] px-[30px] py-4 text-base font-semibold text-white no-underline">
          Lock in ₱12,000
        </a>
      </section>

      <section id="pricing" className="flex flex-col gap-9 bg-white px-4 py-20 text-[#141416] sm:px-8 lg:px-24 lg:py-[100px]">
        <div className="flex max-w-[640px] flex-col gap-3.5">
          <p className="m-0 text-[13px] font-semibold uppercase tracking-[0.18em] text-[#A8131F]">Tickets</p>
          <h2 className="m-0 font-archivo text-[clamp(36px,4.4vw,60px)] font-extrabold leading-[1.02]">What's included.</h2>
        </div>
        <div className="flex flex-wrap gap-10 rounded-[20px] bg-[#141416] p-6 text-[#F6F4F1] sm:p-12">
          <ul className="m-0 flex min-w-0 flex-[999_1_520px] list-none flex-col p-0">
            {[
              "Both days of IBMC 2027 — June 16–17, Newport Performing Arts Theater",
              "Business matching activities",
              "Monthly online networking, December to May",
            ].map((item, i, arr) => (
              <li key={item} className={`flex items-baseline gap-4 py-[18px] text-lg leading-snug ${i < arr.length - 1 ? "border-b border-[#34343A]" : ""}`}>
                <span aria-hidden="true" className="h-2 w-2 shrink-0 bg-[#FF4D5A]" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-[1_1_280px] flex-col justify-center gap-2.5">
            <p className="m-0 font-archivo text-[26px] font-extrabold leading-tight text-white">One good referral can pay for your seat.</p>
            <span className="mt-3.5 text-[13px] font-bold uppercase tracking-[0.14em] text-[#FF4D5A]">First Mover</span>
            <Price text="₱12,000" className="font-archivo text-[60px] font-black leading-none font-wide text-white" />
            <span className="text-[15px] text-[#C9C7C2]">or ₱13,000 in installments, from ₱1,000 to secure your slot</span>
          </div>
        </div>

        <h3 className="m-0 mt-3 font-archivo text-[28px] font-extrabold">The earlier you join, the less you pay.</h3>
        <div className="flex flex-col gap-2.5">
          <div aria-hidden="true" className="flex h-2.5 overflow-hidden rounded-full bg-[#E4E1DC]">
            <span className="w-[12%] bg-[#D0202E]" />
          </div>
          <div className="flex flex-wrap justify-between gap-x-4 gap-y-1.5 text-[13px] text-[#5C5C63]">
            <span>Nov 11 · ₱12,000</span>
            <span>Dec 1 · ₱15,000</span>
            <span>Feb 1 · ₱18,000</span>
            <span>Jun 16 · Event</span>
          </div>
        </div>

        <div className="grid grid-cols-1 items-start gap-5 sm:grid-cols-2 xl:grid-cols-3">
          <article className="flex flex-col overflow-hidden rounded-[18px] border-2 border-[#D0202E]">
            <div className="flex flex-col gap-1 bg-[#D0202E] px-5 py-4 sm:px-6 sm:py-5 xl:px-7">
              <h3 className="m-0 font-archivo text-[22px] font-extrabold uppercase tracking-[0.04em] text-white">First Mover</h3>
              <p className="m-0 text-sm font-bold uppercase tracking-[0.06em] text-[#F6F4F1]">
                {phase === "before" ? "Best price · opens Nov 11" : phase === "live" ? "Best price · ends midnight Nov 30" : "Best price · ended"}
              </p>
            </div>
            <div className="flex flex-col gap-3.5 p-5 sm:p-6 xl:p-7">
            <p className="m-0 text-sm text-[#5C5C63]">Nov 11–30, 2026</p>
            <FirstMoverTimer now={now} />
            <Price text="₱12,000" className="m-0 block font-archivo text-5xl font-extrabold leading-none font-wide" />
            <p className="m-0 text-sm font-semibold text-[#A8131F]">Save ₱6,000 vs Regular</p>
            <InstallmentPlan
              key="first-mover"
              total="₱13,000"
              summary="₱1,000 upon registration + six payments of ₱2,000"
              rows={FIRST_MOVER_PLAN}
              tone="red"
            />
            <a href="/register" className="mt-auto rounded-full bg-[#D0202E] px-5 py-[15px] text-center text-base font-semibold text-white no-underline">
              Register
            </a>
            </div>
          </article>
          <article className="flex flex-col overflow-hidden rounded-[18px] border border-[#D9D5CF]">
            <div className="flex flex-col gap-1 bg-[#E4E1DC] px-5 py-4 sm:px-6 sm:py-5 xl:px-7">
              <h3 className="m-0 font-archivo text-[22px] font-extrabold uppercase tracking-[0.04em] text-[#5C5C63]">Early Bird</h3>
              <p className="m-0 text-sm font-bold uppercase tracking-[0.06em] text-[#6E6E74]">Most popular · opens Dec 1</p>
            </div>
            <div className="flex flex-col gap-3.5 p-5 sm:p-6 xl:p-7">
            <p className="m-0 text-sm text-[#5C5C63]">Dec 1, 2026 – Jan 31, 2027</p>
            <Price text="₱15,000" className="m-0 block font-archivo text-5xl font-extrabold leading-none font-wide text-[#5C5C63]" />
            <p className="m-0 text-sm font-semibold text-[#5C5C63]">Save ₱3,000 vs Regular</p>
            <InstallmentPlan
              key="early-bird"
              total="₱16,000"
              summary="₱4,000 upon registration + four payments of ₱3,000"
              rows={EARLY_BIRD_PLAN}
              note="Phase 2 payments begin in February for all Early Bird registrants."
              tone="neutral"
            />
            <span className="mt-auto rounded-full border border-[#D9D5CF] px-5 py-[15px] text-center text-base font-semibold text-[#5C5C63]">
              Opens later
            </span>
            </div>
            </article>
          <article className="flex flex-col overflow-hidden rounded-[18px] border border-[#D9D5CF]">
            <div className="flex flex-col gap-1 bg-[#E4E1DC] px-5 py-4 sm:px-6 sm:py-5 xl:px-7">
              <h3 className="m-0 font-archivo text-[22px] font-extrabold uppercase tracking-[0.04em] text-[#5C5C63]">Regular</h3>
              <p className="m-0 text-sm font-bold uppercase tracking-[0.06em] text-[#6E6E74]">Opens Feb 1</p>
            </div>
            <div className="flex flex-col gap-3.5 p-5 sm:p-6 xl:p-7">
            <p className="m-0 text-sm text-[#5C5C63]">Feb 1 – May 31, 2027</p>
            <Price text="₱18,000" className="m-0 block font-archivo text-5xl font-extrabold leading-none font-wide text-[#5C5C63]" />
            <p className="m-0 text-[15px] text-[#5C5C63]">One-time · no installment</p>
            <p className="m-0 text-sm text-[#5C5C63]">&nbsp;</p>
            <span className="mt-auto rounded-full border border-[#D9D5CF] px-5 py-[15px] text-center text-base font-semibold text-[#5C5C63]">
              Opens later
            </span>
            </div>
          </article>
        </div>

        <div className="flex flex-wrap items-center gap-x-10 gap-y-5 rounded-[18px] bg-[#141416] px-7 py-6 text-[#F6F4F1]">
          <div className="flex flex-[1_1_220px] flex-col gap-1">
            <span className="text-xs font-bold uppercase tracking-[0.14em] text-[#FF4D5A]">International delegates</span>
            <span className="text-[15px] text-[#C9C7C2]">Joining from outside the Philippines</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-sm text-[#C9C7C2]">Early Bird · January–March 2027</span>
            <span className="font-archivo text-[32px] font-extrabold text-white">USD 250</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-sm text-[#C9C7C2]">Regular · April onward</span>
            <span className="font-archivo text-[32px] font-extrabold text-white">USD 350</span>
          </div>
        </div>
      </section>

      <section id="faq" className="flex flex-wrap gap-12 bg-[#F6F4F1] px-4 py-20 text-[#141416] sm:px-8 lg:px-24 lg:py-[100px]">
        <div className="flex flex-[1_1_300px] flex-col gap-3.5">
          <p className="m-0 text-[13px] font-semibold uppercase tracking-[0.18em] text-[#A8131F]">FAQ</p>
          <h2 className="m-0 font-archivo text-[clamp(36px,4vw,52px)] font-extrabold leading-[1.02]">Answers before you register.</h2>
        </div>
        <FaqList />
      </section>

      <section className="flex flex-col items-center justify-center gap-6 bg-[#D0202E] px-4 py-20 text-center text-white sm:px-8 lg:px-24 lg:py-[100px]">
        <h2 className="m-0 max-w-[900px] font-archivo text-[clamp(40px,5.4vw,76px)] font-black leading-none font-expanded">
          One voice is quiet. A room is loud.
        </h2>
        <p className="m-0 text-[17px]">June 16–17, 2027 · Newport Performing Arts Theater · Members and guests welcome</p>
        <div className="flex flex-wrap justify-center gap-3.5">
          <a href="/register" className="rounded-full bg-white px-[30px] py-4 text-base font-bold text-[#A8131F] no-underline">
            Get my seat
          </a>
          <a
            href={CHAPTER_FINDER}
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-white px-7 py-[15px] text-base font-semibold text-white no-underline"
          >
            Visit a BNI chapter first
          </a>
        </div>
      </section>

      <footer className="flex flex-col gap-10 bg-[#0E0E10] px-4 py-14 text-sm text-[#A8A8B0] sm:px-8 lg:px-24">
        <div className="flex flex-wrap justify-between gap-10">
          <div className="flex max-w-[320px] flex-col gap-2.5">
            <span className="font-archivo text-lg font-extrabold text-[#F6F4F1]">
              IBMC <span className="text-[#FF4D5A]">2027</span> · AMPLIFY
            </span>
            <span>Amplify others. Get amplified.</span>
            <span>Hosted by BNI Philippines. Event photos from ibmcph.com.</span>
          </div>
          <div className="flex flex-col gap-2.5">
            <span className="font-semibold text-[#F6F4F1]">Explore</span>
            <a href="#why" className="text-[#A8A8B0] no-underline">Why IBMC</a>
            <a href="#new" className="text-[#A8A8B0] no-underline">New to BNI?</a>
            <a href="#pricing" className="text-[#A8A8B0] no-underline">Tickets</a>
          </div>
          <div className="flex flex-col gap-2.5">
            <span className="font-semibold text-[#F6F4F1]">Event</span>
            <a href="#faq" className="text-[#A8A8B0] no-underline">FAQ</a>
            <a href="/terms" className="text-[#A8A8B0] no-underline">Terms</a>
            <span>BNI Philippines</span>
            <span>ibmcph.com</span>
          </div>
        </div>
        <a href="http://eventixph.com/" target="_blank" rel="noreferrer" className="w-fit text-[#F6F4F1] underline">
          Powered by EventixPH
        </a>
      </footer>
    </div>
  );
}
