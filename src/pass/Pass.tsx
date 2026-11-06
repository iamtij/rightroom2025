import { useEffect, useState } from "react";

type PassRecord = {
  fullName: string;
  tierName: string;
  reference: string;
  event: string;
};

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

export default function Pass() {
  const token = decodeURIComponent(window.location.pathname.replace(/^\/pass\//, "")).trim();
  const [pass, setPass] = useState<PassRecord | null>(null);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    if (!token) {
      setInvalid(true);
      return undefined;
    }
    let stop = false;
    fetch(`/api/passes/${encodeURIComponent(token)}`)
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (stop) return;
        if (!response.ok || !payload?.fullName || !payload?.reference) {
          setInvalid(true);
          return;
        }
        setPass(payload);
      })
      .catch(() => {
        if (!stop) setInvalid(true);
      });
    return () => {
      stop = true;
    };
  }, [token]);

  return (
    <div className="scroll-wrapper bg-[#F6F4F1] font-sans text-[#141416]">
      <div className="mx-auto flex min-h-full w-full max-w-[480px] flex-col">
        <header className="flex items-center justify-between border-b border-[#E4E1DC] bg-[#FDFCFA] px-5 py-4">
          <Brand />
          <span className="text-[13px] text-[#5C5C63]">Entry pass</span>
        </header>
        <main className="flex flex-1 flex-col gap-4 px-5 py-5">
          {pass ? (
            <>
              <div className="flex flex-col gap-2 rounded-2xl bg-[#D0202E] px-5 py-[22px] text-white">
                <span className="text-xs font-bold tracking-[0.14em] text-[#FFE3E5] uppercase">Fully paid</span>
                <h1 className="m-0 font-archivo text-[30px] leading-[1.05] font-black">{pass.fullName}</h1>
                <p className="m-0 text-[15px] leading-snug text-[#FFE3E5]">{pass.tierName}</p>
              </div>
              <div className="flex flex-col gap-2 rounded-[14px] border border-[#E4E1DC] bg-white p-4">
                <span className="text-sm text-[#5C5C63]">Reference</span>
                <span className="font-archivo text-[22px] font-extrabold">{pass.reference}</span>
                <span className="text-sm leading-snug text-[#5C5C63]">{pass.event}</span>
              </div>
            </>
          ) : invalid ? (
            <>
              <h1 className="m-0 font-archivo text-[30px] leading-[1.05] font-black">This pass isn't valid.</h1>
              <p className="m-0 text-[15px] leading-snug text-[#5C5C63]">An entry pass opens only for a seat that is fully paid.</p>
            </>
          ) : (
            <p className="m-0 text-[15px] text-[#5C5C63]">Checking this pass.</p>
          )}
        </main>
      </div>
    </div>
  );
}
