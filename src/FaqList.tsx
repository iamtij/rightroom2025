import { useState, type ReactNode } from "react";

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
    q: "How long do I have to make the first payment?",
    a: <FirstPaymentAnswer />,
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

function Price({ text }: { text: string }) {
  const parts = text.split("₱");
  return (
    <>
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

function FirstPaymentAnswer() {
  return (
    <p className="m-0 max-w-[62ch]">
      24 hours from the moment checkout opens. That payment locks the ticket: <Price text="₱1,000" /> for First Mover, <Price text="₱4,000" /> for Early Bird, or the full amount. If it is not received in that time, the registration is cancelled and you start again. Later installment dates are not on this 24-hour clock. International delegates pay in full, and IBMC records that payment separately.
    </p>
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

export default function FaqList({ className = "flex min-w-0 flex-[999_1_560px] flex-col" }: { className?: string }) {
  const [open, setOpen] = useState(0);
  return (
    <div className={className}>
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
