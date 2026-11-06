import { useEffect } from "react";

const LOCAL_TIERS = [
  ["First Mover", "Nov 11–30, 2026", "₱12,000", "₱13,000"],
  ["Early Bird", "Dec 1, 2026 – Jan 31, 2027", "₱15,000", "₱16,000"],
  ["Regular", "Feb 1 – May 31, 2027", "₱18,000", "Paid once"],
];

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

function Price({ text }: { text: string }) {
  const parts = text.split("₱");
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          {i > 0 && <span className="font-sans">₱</span>}
          {part}
        </span>
      ))}
    </>
  );
}

function Schedule({ title, rows }: { title: string; rows: string[][] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-[#E4E1DC]">
      <p className="m-0 border-b border-[#E4E1DC] bg-[#F6F4F1] px-3 py-2.5 text-sm font-bold">{title}</p>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-[#141416] text-left text-white">
            <th className="px-3 py-2 font-semibold">Due date</th>
            <th className="px-3 py-2 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([date, amount], i) => (
            <tr key={date} className={i % 2 === 0 ? "bg-white" : "bg-[#F6F4F1]"}>
              <td className="px-3 py-2">{date}</td>
              <td className="px-3 py-2 text-right font-semibold"><Price text={amount} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Terms() {
  useEffect(() => {
    if (window.location.hash !== "#refunds") return;
    const target = document.getElementById("refunds");
    const scroller = document.querySelector(".scroll-wrapper");
    if (!target || !(scroller instanceof HTMLElement)) return;
    const top = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 112;
    scroller.scrollTo({ top });
  }, []);

  return (
    <div className="scroll-wrapper scroll-smooth bg-[#F6F4F1] font-sans text-[#141416]">
      <nav aria-label="Main" className="sticky top-0 z-50 flex items-center justify-between gap-4 border-b border-white/10 bg-[#0E0E10]/95 px-4 py-5 backdrop-blur-md sm:px-8 lg:px-14">
        <a href="/" className="flex items-center gap-3 text-[#F6F4F1] no-underline">
          <img src="/assets/bni-philippines-mark.png" alt="BNI Philippines" className="h-12 w-auto sm:h-14" />
          <span className="font-archivo text-lg font-extrabold tracking-[0.04em]">
            IBMC <span className="text-[#FF4D5A]">2027</span>
          </span>
        </a>
        <a href="/register" className="rounded-full bg-[#D0202E] px-[22px] py-3 text-sm font-semibold text-white no-underline">
          Register
        </a>
      </nav>

      <main className="mx-auto flex max-w-[760px] flex-col gap-10 px-4 py-16 sm:px-8">
        <header className="flex flex-col gap-3.5">
          <p className="m-0 text-[13px] font-semibold uppercase tracking-[0.18em] text-[#A8131F]">IBMC 2027</p>
          <h1 className="m-0 font-archivo text-[clamp(36px,5vw,56px)] font-extrabold leading-[1.02]">Terms and conditions</h1>
          <p className="m-0 text-[17px] leading-relaxed text-[#3A3A40]">
            These terms cover registration and payment for IBMC 2027, hosted by BNI Philippines.
          </p>
        </header>

        <section className="flex flex-col gap-3">
          <h2 className="m-0 font-archivo text-[28px] font-extrabold">The event</h2>
          <p className="m-0 text-base leading-relaxed text-[#3A3A40]">
            IBMC 2027 is on June 16–17, 2027 at Newport Performing Arts Theater, Pasay City. Members, guests, and international delegates may register.
          </p>
          <p className="m-0 text-base leading-relaxed text-[#3A3A40]">A seat includes both days, business matching activities, and monthly online networking from December 2026 through May 2027.</p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="m-0 font-archivo text-[28px] font-extrabold">Ticket prices</h2>
          <p className="m-0 text-base leading-relaxed text-[#3A3A40]">Philippine registration, in Philippine pesos. The installment total is ₱1,000 more than the pay-in-full price.</p>
          <div className="overflow-x-auto rounded-xl border border-[#E4E1DC]">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="bg-[#141416] text-white">
                  <th className="px-3 py-2 font-semibold">Tier</th>
                  <th className="px-3 py-2 font-semibold">Window</th>
                  <th className="px-3 py-2 font-semibold">In full</th>
                  <th className="px-3 py-2 font-semibold">Installments</th>
                </tr>
              </thead>
              <tbody>
                {LOCAL_TIERS.map(([tier, window, full, plan], i) => (
                  <tr key={tier} className={i % 2 === 0 ? "bg-white" : "bg-[#F6F4F1]"}>
                    <td className="px-3 py-2.5 font-semibold">{tier}</td>
                    <td className="px-3 py-2.5">{window}</td>
                    <td className="px-3 py-2.5 font-semibold"><Price text={full} /></td>
                    <td className="px-3 py-2.5 font-semibold"><Price text={plan} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="m-0 text-base leading-relaxed text-[#3A3A40]">
            International delegates, joining from outside the Philippines, pay in full in US dollars. Early Bird is USD 250 from January through March 2027. Regular is USD 350 from April through May 31, 2027. There is no installment plan.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="m-0 font-archivo text-[28px] font-extrabold">Installments</h2>
          <p className="m-0 text-base leading-relaxed text-[#3A3A40]">
            First Mover and Early Bird can be paid in installments. Regular is paid once. Each installment is due on or before its date.
          </p>
          <Schedule title="First Mover · ₱13,000" rows={FIRST_MOVER_PLAN} />
          <p className="m-0 text-sm leading-snug text-[#5C5C63]">Early Bird payments begin in February for everyone who registers in that window.</p>
          <Schedule title="Early Bird · ₱16,000" rows={EARLY_BIRD_PLAN} />
        </section>

        <section id="refunds" className="flex scroll-mt-28 flex-col gap-3">
          <h2 className="m-0 font-archivo text-[28px] font-extrabold">Refunds</h2>
          <p className="m-0 text-base leading-relaxed text-[#3A3A40]">
            Payments already made are kept. Installment payments must be made on or before each due date. If an installment remains unpaid 15 days after its due date, the installment plan ends and the registration moves to the Regular rate of <Price text="₱18,000" />. All payments already made are credited toward the Regular rate. The remaining balance must be paid in full on or before May 31, 2027.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="m-0 font-archivo text-[28px] font-extrabold">Registration closes</h2>
          <p className="m-0 text-base leading-relaxed text-[#3A3A40]">Registration closes on May 31, 2027.</p>
        </section>
      </main>

      <footer className="flex flex-wrap items-center justify-between gap-4 bg-[#0E0E10] px-4 py-10 text-sm text-[#A8A8B0] sm:px-8 lg:px-14">
        <span className="font-archivo text-lg font-extrabold text-[#F6F4F1]">
          IBMC <span className="text-[#FF4D5A]">2027</span>
        </span>
        <a href="/" className="text-[#A8A8B0] no-underline">Back to IBMC</a>
      </footer>
    </div>
  );
}
