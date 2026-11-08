import { useEffect } from "react";
import FaqList from "./FaqList.tsx";

export default function Faq() {
  useEffect(() => {
    const previous = document.title;
    document.title = "FAQ · IBMC 2027";
    return () => {
      document.title = previous;
    };
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

      <main className="mx-auto flex w-full max-w-[760px] flex-col gap-8 px-4 py-16 sm:px-8">
        <header className="flex flex-col gap-3.5">
          <p className="m-0 text-[13px] font-semibold uppercase tracking-[0.18em] text-[#A8131F]">IBMC 2027</p>
          <h1 className="m-0 font-archivo text-[clamp(36px,5vw,56px)] font-extrabold leading-[1.02]">Answers before you register.</h1>
          <p className="m-0 text-[17px] leading-relaxed text-[#3A3A40]">
            June 16–17, 2027 · Newport Performing Arts Theater, Pasay City
          </p>
        </header>
        <FaqList className="flex w-full min-w-0 flex-col" />
      </main>

      <footer className="flex flex-wrap items-center justify-between gap-4 bg-[#0E0E10] px-4 py-10 text-sm text-[#A8A8B0] sm:px-8 lg:px-14">
        <span className="font-archivo text-lg font-extrabold text-[#F6F4F1]">
          IBMC <span className="text-[#FF4D5A]">2027</span>
        </span>
        <div className="flex flex-wrap gap-6">
          <a href="/terms" className="text-[#A8A8B0] no-underline">Terms</a>
          <a href="/privacy" className="text-[#A8A8B0] no-underline">Data Privacy</a>
          <a href="/" className="text-[#A8A8B0] no-underline">Back to IBMC</a>
        </div>
      </footer>
    </div>
  );
}
