import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ArrowRight, CheckCircle2, Users, Handshake, Globe, TrendingUp, Lightbulb, ChevronDown } from "lucide-react";

const EVENT_DATE = new Date("2026-06-17T00:00:00");
const REGISTRATION_URL_VISITOR = "https://events.mygrid.club/ibmcvisitor";
const REGISTRATION_URL_MEMBER = "https://events.mygrid.club/ibmc";
const REGISTRATION_URL_SPONSOR = "https://events.mygrid.club/ibmcsponsor";

function BoldIBMC({ text }: { text: string }) {
  const parts = text.split(/(IBMC)/g);
  return <>{parts.map((part, i) => part === "IBMC" ? <span key={i} className="font-bold">IBMC</span> : part)}</>;
}

const scrollReveal = {
  hidden: { opacity: 0, y: 40 },
  visible: (i = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, delay: i * 0.1, ease: [0.22, 1, 0.36, 1] },
  }),
};
const scrollRevealScale = {
  hidden: { opacity: 0, scale: 0.92 },
  visible: (i = 0) => ({
    opacity: 1,
    scale: 1,
    transition: { duration: 0.6, delay: i * 0.1, ease: [0.22, 1, 0.36, 1] },
  }),
};
const scrollRevealLeft = {
  hidden: { opacity: 0, x: -40 },
  visible: (i = 0) => ({
    opacity: 1,
    x: 0,
    transition: { duration: 0.6, delay: i * 0.1, ease: [0.22, 1, 0.36, 1] },
  }),
};
const scrollRevealRight = {
  hidden: { opacity: 0, x: 40 },
  visible: (i = 0) => ({
    opacity: 1,
    x: 0,
    transition: { duration: 0.6, delay: i * 0.1, ease: [0.22, 1, 0.36, 1] },
  }),
};
const viewport = { once: true, margin: "-80px" };

function CountdownBanner() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const diff = Math.max(0, EVENT_DATE.getTime() - now.getTime());
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);

  return (
    <div className="countdown-banner bg-brand-red text-white py-3 px-4 text-center shrink-0">
      <div className="flex flex-col sm:flex-row flex-wrap items-center justify-center gap-1 sm:gap-2 md:gap-4 text-base sm:text-base md:text-lg font-semibold tracking-wide">
        <span><span className="font-bold">IBMC</span> 2026 — <span className="font-bold">June 17-18, 2026</span> | NPAT (Newport Performing Arts Theater), Pasay City</span>
        <span className="hidden lg:inline opacity-60">|</span>
        <span className="flex items-center justify-center gap-3 sm:gap-2 md:gap-4 flex-wrap shrink-0 text-lg sm:text-base">
          <span><span className="font-display text-xl sm:text-lg md:text-xl tabular-nums">{days}</span> days</span>
          <span><span className="font-display text-xl sm:text-lg md:text-xl tabular-nums">{hours}</span> hrs</span>
          <span><span className="font-display text-xl sm:text-lg md:text-xl tabular-nums">{minutes}</span> min</span>
          <span><span className="font-display text-xl sm:text-lg md:text-xl tabular-nums">{seconds}</span> sec</span>
        </span>
      </div>
    </div>
  );
}

const HERO_QUOTES = [
  "“I was chasing leads. But I found my best client in IBMC.”",
  "“I was hoping for referrals. But I found my dream referral in IBMC.”",
  "“I was switching suppliers every quarter. But I found a reliable partner in IBMC.”",
  "“I was building alone. But I found a community in IBMC.”",
  "““I was guessing my next move. But I found my next product idea in IBMC.”",
  "“I was networking everywhere. But I found the right room in IBMC.”",
  "“I was stuck local. But I found my global client in IBMC.”",
  "“I was surviving. But I found momentum.”"
];

function LogoMarquee() {
  const trackRef = useRef<HTMLDivElement>(null);
  const setWidthRef = useRef(0);
  const rafRef = useRef<number>();
  const offsetRef = useRef(0);
  const speed = 60; // px per second

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const firstSet = el.firstElementChild as HTMLElement;
    if (!firstSet) return;
    setWidthRef.current = firstSet.offsetWidth;
    let last = performance.now();

    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      offsetRef.current += speed * dt;
      const setW = setWidthRef.current;
      if (setW > 0 && offsetRef.current >= setW) offsetRef.current -= setW;
      el.style.transform = `translate3d(-${offsetRef.current}px, 0, 0)`;
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    const ro = new ResizeObserver(() => {
      setWidthRef.current = (el.firstElementChild as HTMLElement)?.offsetWidth ?? setWidthRef.current;
    });
    ro.observe(el);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, []);

  return (
    <div ref={trackRef} className="flex items-center h-full shrink-0" style={{ gap: 0 }}>
      {[...Array(2)].map((_, setIdx) => (
        <div key={setIdx} className="flex items-center gap-0 shrink-0">
          {[...Array(40)].map((_, i) => (
            <img key={`${setIdx}-${i}`} src="/assets/ibmc-logo-white-2.png" alt="IBMC 2026" className="h-full w-auto object-contain shrink-0 scale-[0.45] sm:scale-[0.55] md:scale-[0.65] -mr-[550px] md:-mr-[450px] lg:-mr-[350px]" />
          ))}
        </div>
      ))}
    </div>
  );
}

const FAQ_ITEMS = [
  { q: "What is IBMC?", a: "IBMC stands for International Business Matching Conference. It's a 2-day business matching experience designed for serious business owners who want intentional and sustainable growth through structured one-to-one meetings and curated rooms." },
  { q: "When and where is IBMC 2026?", a: "IBMC 2026 takes place on June 17–18, 2026 in NPAT (Newport Performing Arts Theater), Pasay City." },
  { q: "Who should attend?", a: "Business owners, decision-makers, and professionals who are ready to grow through strategic partnerships, direct access to buyers and sellers, and meaningful connections. If you're tired of random networking and want purposeful growth, IBMC is for you." },
  { q: "How does the business matching work?", a: "Through structured one-to-one matching and curated rooms, you connect directly with decision-makers and strategic partners. No random introductions—every interaction is designed to move your business forward." },
  { q: "How do I register?", a: "Click 'Secure your slot' anywhere on this page. You'll see three options: Visitors, BNI Members, or Sponsors. Choose the one that applies to you to complete registration. You'll receive a confirmation email with next steps and how to prepare your business profile for matching." },
];

function RegistrationModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed left-1/2 top-1/2 z-[101] -translate-x-1/2 -translate-y-1/2 w-full max-w-md mx-4"
          >
            <div className="bg-zinc-900 border border-white/10 rounded-2xl p-6 sm:p-8 shadow-2xl">
              <h3 className="font-sans text-xl uppercase tracking-wider text-white mb-6 text-center font-semibold">
                Choose your registration
              </h3>
              <div className="flex flex-col gap-4">
                <a
                  href={REGISTRATION_URL_VISITOR}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full py-3.5 px-6 bg-brand-red text-white font-sans rounded-xl hover:bg-brand-red-light transition-colors text-center font-semibold"
                >
                  <span className="block text-base uppercase tracking-wider">VISITORS</span>
                  <span className="block mt-0.5 text-xs sm:text-sm font-normal font-sans normal-case tracking-normal text-white/85">
                    (Non-BNI Members)
                  </span>
                </a>
                <a
                  href={REGISTRATION_URL_MEMBER}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full py-4 px-6 bg-brand-red text-white font-sans text-base uppercase tracking-wider rounded-xl hover:bg-brand-red-light transition-colors text-center font-semibold"
                >
                  BNI Members
                </a>
                <a
                  href={REGISTRATION_URL_SPONSOR}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full py-4 px-6 bg-brand-red text-white font-sans text-base uppercase tracking-wider rounded-xl hover:bg-brand-red-light transition-colors text-center font-semibold"
                >
                  Sponsors
                </a>
              </div>
              <button
                onClick={onClose}
                className="mt-6 w-full py-2 text-white/60 hover:text-white text-sm transition-colors"
              >
                Cancel
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function RegistrationCTA({ className = "", showArrow = true }: { className?: string; showArrow?: boolean }) {
  const [showModal, setShowModal] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setShowModal(true)}
        className={`relative ${className}`}
      >
        <span className="relative z-10 flex items-center gap-3">
          Secure your slot {showArrow && <ArrowRight className="group-hover:translate-x-1 transition-transform" />}
        </span>
        <div className="absolute inset-0 bg-white/10 translate-y-full opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-300 pointer-events-none" />
      </button>
      <RegistrationModal isOpen={showModal} onClose={() => setShowModal(false)} />
    </>
  );
}

export default function App() {
  const [quoteIndex, setQuoteIndex] = useState(0);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      setQuoteIndex((prev) => (prev + 1) % HERO_QUOTES.length);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="h-full min-h-screen bg-black text-white selection:bg-brand-red selection:text-white font-sans">
      <header className="fixed top-0 left-0 right-0 z-[60] flex flex-col overflow-visible pt-[env(safe-area-inset-top,0px)]">
        <CountdownBanner />
        <nav className="w-full px-4 sm:px-6 py-3 sm:py-4 flex justify-between items-center bg-black shrink-0 overflow-visible">
              <div className="flex items-center h-10 sm:h-12 overflow-visible">
                <img src="/assets/ibmc-logo-white-2.png" alt="IBMC 2026" className="h-full w-auto object-contain object-left origin-left scale-[2] sm:scale-[2.25]" />
              </div>
              <RegistrationCTA showArrow={false} className="animate-pulse-slow min-h-[48px] min-w-[44px] px-6 py-3.5 bg-brand-red text-white border border-brand-red rounded-full font-display text-base uppercase tracking-wider hover:bg-brand-red-light hover:shadow-[0_0_24px_rgba(227,30,36,0.6)] transition-all duration-300 cursor-pointer inline-flex items-center justify-center" />
            </nav>
      </header>

      <div className="scroll-wrapper">
      <AnimatePresence mode="wait">
        <motion.div
            key="landing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="relative"
          >
            {/* Hero Section */}
            <section className="relative min-h-0 sm:min-h-screen flex flex-col items-center justify-center px-4 sm:px-6 pt-[220px] sm:pt-[160px] md:pt-[150px] lg:pt-[140px] pb-12 sm:pb-0 overflow-visible">
              <div className="absolute inset-0 z-0 opacity-20 overflow-hidden pointer-events-none">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-brand-red/20 rounded-full blur-[120px]" />
              </div>

              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8 }}
                className="relative z-10 text-center max-w-5xl mx-auto w-full"
              >
                <h1 className="font-display text-[clamp(3rem,16vw,8rem)] sm:text-[12vw] leading-[1.1] sm:leading-[0.9] md:leading-[0.85] uppercase tracking-tight animate-slam pt-2">
                  Be in the <br />
                  <span className="text-brand-red">Right Room.</span>
                </h1>
                
                <div className="mt-8 sm:mt-10 space-y-6 sm:space-y-8">
                  <div className="space-y-4">
                    <p className="text-2xl sm:text-2xl md:text-4xl font-light tracking-tight text-white/90">
                      You don’t need more tactics. <br />
                      <span className="font-semibold">You need </span>
                      <span className="relative inline-block font-semibold">
                        <span className="absolute bottom-0.5 left-0 right-0 h-0.5 bg-brand-red origin-left animate-marker-underline z-0" />
                        <span className="relative z-10">direct access</span>
                      </span>
                      <span className="font-semibold"> to the </span>
                      <span className="relative inline-block font-semibold">
                        <span className="absolute bottom-1 -left-1 -right-1 h-6 sm:h-7 bg-brand-red origin-left animate-marker-underline z-0" />
                        <span className="relative z-10">right people</span>
                      </span>
                      <span className="font-semibold">.</span>
                    </p>
                  </div>

                  {/* Cycling Quote Animation */}
                  <div className="h-24 md:h-32 flex items-center justify-center overflow-hidden">
                    <AnimatePresence mode="wait">
                      <motion.div
                        key={quoteIndex}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        transition={{ duration: 0.6, ease: "easeInOut" }}
                        className="max-w-3xl"
                      >
                        <p className="text-lg sm:text-xl md:text-3xl font-semibold leading-tight tracking-tight text-white italic">
                          <BoldIBMC text={HERO_QUOTES[quoteIndex]} />
                        </p>
                      </motion.div>
                    </AnimatePresence>
                  </div>
                  
                  <div className="flex flex-col items-center pt-6 sm:pt-8">
                    <RegistrationCTA className="group relative min-h-[52px] px-8 py-5 sm:px-12 sm:py-5 bg-brand-red text-white font-display text-xl sm:text-2xl uppercase tracking-wider rounded-full overflow-hidden transition-transform hover:scale-105 active:scale-95 cursor-pointer inline-flex items-center justify-center" />
                    {/* Scroll Indicator */}
                    <motion.div 
                      animate={{ y: [0, 10, 0] }}
                      transition={{ duration: 2, repeat: Infinity }}
                      className="mt-8 opacity-30"
                    >
                      <div className="w-px h-12 bg-gradient-to-b from-white to-transparent mx-auto" />
                    </motion.div>
                  </div>
                </div>
              </motion.div>
            </section>

            {/* Section: All in One Room */}
            <section className="pt-10 pb-16 sm:pt-20 sm:pb-24 md:py-28 px-4 sm:px-6 bg-zinc-950 border-y border-white/5 overflow-hidden">
              <div className="max-w-5xl mx-auto text-center">
                <motion.h3
                  initial="hidden"
                  whileInView="visible"
                  viewport={viewport}
                  variants={scrollReveal}
                  className="font-display text-3xl sm:text-4xl md:text-5xl uppercase tracking-wide text-white mb-12 sm:mb-16"
                >
                  All in one room.
                </motion.h3>
                <div className="flex flex-col sm:flex-row items-stretch justify-center gap-4 md:gap-6">
                  {[
                    { icon: Users, text: "The right conversations" },
                    { icon: Handshake, text: "The right connections" },
                    { icon: TrendingUp, text: "The right opportunities" },
                  ].map((item, i) => (
                    <motion.div
                      key={i}
                      initial="hidden"
                      whileInView="visible"
                      viewport={viewport}
                      variants={scrollRevealScale}
                      custom={i}
                      className="border-2 border-brand-red/60 bg-white/5 rounded-2xl p-6 sm:p-8 flex flex-col items-center justify-center min-h-[120px] sm:min-h-[140px] gap-4"
                    >
                      <item.icon className="w-10 h-10 sm:w-12 sm:h-12 text-brand-red shrink-0" />
                      <p className="text-xl sm:text-2xl md:text-3xl font-bold text-white text-center uppercase tracking-tight">{item.text}</p>
                    </motion.div>
                  ))}
                </div>
              </div>
            </section>

            {/* Section: THE REAL PROBLEM */}
            <section className="py-12 sm:py-16 md:py-20 px-4 sm:px-6 bg-zinc-950 overflow-hidden">
              <div className="max-w-7xl mx-auto">
                <motion.div
                  initial="hidden"
                  whileInView="visible"
                  viewport={viewport}
                  variants={scrollRevealScale}
                  className="border-2 border-brand-red/40 rounded-3xl p-8 sm:p-12 md:p-16 bg-black/50"
                >
                  <div className="grid md:grid-cols-2 gap-12 md:gap-20 items-center">
                    <motion.div
                      initial="hidden"
                      whileInView="visible"
                      viewport={viewport}
                      variants={scrollRevealLeft}
                    >
                      <h2 className="section-eyebrow mb-6">The Problem</h2>
                      <h3 className="font-display text-[clamp(2.5rem,10vw,6rem)] sm:text-5xl md:text-6xl lg:text-7xl leading-[0.95] uppercase tracking-wide">
                        Maybe you’re <br />
                        not missing <br />
                        <span className="text-brand-red font-bold">effort.</span>
                      </h3>
                      <p className="mt-6 text-xl sm:text-2xl md:text-3xl font-light text-brand-red">
                        Maybe you’re not in a room that accelerates growth.
                      </p>
                    </motion.div>
                    
                    <motion.div
                      initial="hidden"
                      whileInView="visible"
                      viewport={viewport}
                      variants={scrollRevealRight}
                      className="space-y-4 sm:space-y-6"
                    >
                      {[
                        "You’re working hard but growth feels random",
                        "You’re networking but not progressing",
                        "You’re meeting people but not decision-makers",
                        "You’re active but not advancing"
                        ].map((text, i) => (
                        <motion.div 
                          key={i}
                          initial={{ opacity: 0, x: 20 }}
                          whileInView={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.1 }}
                          viewport={{ once: true }}
                          className="flex items-start gap-4 group"
                        >
                          <div className="mt-1.5 w-2 h-2 rounded-full bg-brand-red group-hover:scale-150 transition-transform shrink-0" />
                          <p className="text-lg sm:text-xl md:text-2xl font-medium text-white/80">{text}</p>
                        </motion.div>
                      ))}
                      <div className="flex justify-center pt-6 sm:pt-8">
                        <RegistrationCTA className="group relative min-h-[52px] px-8 py-5 sm:px-12 sm:py-5 bg-brand-red text-white font-display text-xl sm:text-2xl uppercase tracking-wider rounded-full overflow-hidden transition-transform hover:scale-105 active:scale-95 cursor-pointer inline-flex items-center justify-center" />
                      </div>
                    </motion.div>
                  </div>
                </motion.div>
              </div>
            </section>

            {/* Section 3 – THE SHIFT */}
            <section className="py-16 sm:py-24 md:py-32 px-4 sm:px-6 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
                <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white to-transparent" />
                <div className="absolute bottom-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white to-transparent" />
              </div>

              <div className="max-w-7xl mx-auto">
                <motion.div
                  initial="hidden"
                  whileInView="visible"
                  viewport={viewport}
                  variants={scrollReveal}
                  className="text-center mb-24"
                >
                  <h2 className="section-eyebrow mb-6">The Shift</h2>
                  <h3 className="section-title-lg mb-8">
                    Rooms shape <span className="text-brand-red">results.</span>
                  </h3>
                  <p className="text-xl md:text-2xl text-white/60 max-w-2xl mx-auto">
                    The room you sit in determines everything about your trajectory.
                  </p>
                </motion.div>

                <div className="grid md:grid-cols-2 gap-12 mb-32 items-stretch">
                  <motion.div
                    initial="hidden"
                    whileInView="visible"
                    viewport={viewport}
                    variants={scrollRevealLeft}
                    className="relative min-h-[400px] md:min-h-[500px] rounded-3xl overflow-hidden order-2 md:order-1"
                  >
                    <img
                      src="/assets/ibmc-strategic-alignment.png"
                      alt="Strategic alignment at IBMC"
                      className="w-full h-full object-cover grayscale opacity-50"
                    />
                    <div className="absolute inset-0 bg-brand-red/10 mix-blend-overlay" />
                    <div className="absolute bottom-8 left-8 right-8">
                      <p className="section-eyebrow mb-2">The Result</p>
                      <p className="section-title text-xl sm:text-2xl">Strategic Alignment</p>
                    </div>
                  </motion.div>

                  <motion.div
                    initial="hidden"
                    whileInView="visible"
                    viewport={viewport}
                    variants={scrollRevealRight}
                    className="glass-card p-10 sm:p-14 md:p-16 rounded-3xl order-1 md:order-2 flex flex-col justify-center items-center text-center min-h-[400px] md:min-h-[500px] w-full"
                  >
                    <h4 className="section-eyebrow mb-6">The Environment Effect</h4>
                    <p className="section-title text-white mb-10 md:mb-14 leading-tight max-w-xl">
                      Rooms Decide <span className="text-brand-red">Results.</span>
                    </p>
                    <ul className="grid sm:grid-cols-2 gap-x-12 sm:gap-x-16 md:gap-x-20 gap-y-8 md:gap-y-10 w-full max-w-2xl mx-auto">
                      {[
                        "The level of conversations you have.",
                        "The quality of referrals you receive.",
                        "The partnerships you form.",
                        "The ideas you discover."
                      ].map((item, i) => (
                        <li key={i} className="flex items-start gap-4 text-lg sm:text-xl font-medium text-left">
                          <CheckCircle2 className="text-brand-red w-6 h-6 shrink-0 mt-0.5" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </motion.div>

                  <div className="flex flex-col justify-center gap-8 md:col-span-2 max-w-2xl md:mx-auto">
                    {[
                      { from: "I was chasing leads.", to: "I chose to be in the right room. I found my best client." },
                      { from: "I was begging for attention.", to: "I stepped into the right room. I found my next partner." },
                      { from: "I was working in isolation.", to: "I entered the right room. I found my global expansion." }
                    ].map((quote, i) => (
                      <motion.div 
                        key={i}
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.2 }}
                        viewport={{ once: true }}
                        className="border-l-2 border-brand-red/30 pl-8"
                      >
                        <p className="text-white/40 italic text-lg mb-2">“{quote.from}”</p>
                        <p className="text-2xl font-semibold leading-tight">“{quote.to}”</p>
                      </motion.div>
                    ))}
                  </div>
                </div>

                <div className="flex justify-center pt-12">
                  <RegistrationCTA className="group relative min-h-[52px] px-8 py-5 sm:px-12 sm:py-5 bg-brand-red text-white font-display text-xl sm:text-2xl uppercase tracking-wider rounded-full overflow-hidden transition-transform hover:scale-105 active:scale-95 cursor-pointer inline-flex items-center justify-center" />
                </div>
              </div>
            </section>

            {/* Section: What is IBMC? */}
            <section className="py-16 sm:py-24 md:py-32 px-4 sm:px-6 bg-black border-y border-white/5 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-1/3 h-full bg-brand-red/5 blur-[120px] -z-10" />
              <div className="max-w-4xl mx-auto text-center">
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                >
                  <div className="mb-12 md:mb-16 max-w-3xl mx-auto">
                    <div className="relative overflow-hidden rounded-2xl border-2 border-brand-red/55 bg-gradient-to-br from-brand-red/[0.14] via-black/90 to-black px-6 py-10 sm:px-10 sm:py-12 shadow-[0_0_52px_-8px_rgba(227,30,36,0.45)] ring-1 ring-inset ring-white/10">
                      <div
                        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-20%,rgba(227,30,36,0.22),transparent_60%)]"
                        aria-hidden
                      />
                      <p className="relative z-10 text-center">
                        <span className="block font-display text-xl sm:text-2xl md:text-3xl lg:text-[2.5rem] uppercase tracking-wide text-white leading-[1.18]">
                          What if your next dream referral is in this{" "}
                          <span className="text-brand-red drop-shadow-[0_0_24px_rgba(227,30,36,0.55)]">room</span>?
                        </span>
                        <span className="mt-3 block font-sans text-lg sm:text-xl md:text-2xl font-semibold text-white tracking-normal normal-case not-italic">
                          <BoldIBMC text="And this is why IBMC exists." />
                        </span>
                      </p>
                    </div>
                  </div>
                  <h2 className="section-eyebrow mb-4">Why We Exist</h2>
                    <h3 className="section-title-lg mb-12">
                    What is <span className="text-brand-red font-bold">IBMC?</span>
                  </h3>
                  <div className="space-y-10 text-xl md:text-2xl font-light leading-relaxed text-white/80">
                    <p>
                      <span className="font-bold text-white">IBMC</span> stands for the <span className="italic">International Business Matching Conference.</span>
                    </p>
                    
                    <div className="relative h-64 md:h-96 w-full rounded-3xl overflow-hidden my-12">
                      <img
                        src="/assets/ibmc-5.png"
                        alt="IBMC event venue"
                        className="w-full h-full object-cover grayscale opacity-60 hover:grayscale-0 hover:opacity-100 transition-all duration-700"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent" />
                    </div>

                    <p className="text-white/90 text-xl md:text-2xl">
                      <BoldIBMC text="IBMC is a 2-day business matching experience for serious business owners who want intentional and sustainable growth, taking place on " /> <span className="font-bold">June 17–18, 2026 in NPAT (Newport Performing Arts Theater), Pasay City</span>.
                    </p>

                    <div className="space-y-4">
                      <p>Most businesses don’t struggle because they lack talent.</p>
                      <p className="font-semibold text-white text-2xl md:text-3xl">They struggle because growth feels random.</p>
                    </div>

                    <div className="flex flex-col md:flex-row justify-center gap-4 md:gap-12 text-white font-sans font-bold uppercase tracking-widest text-lg">
                      <span>Random introductions.</span>
                      <span>Random opportunities.</span>
                      <span>Random results.</span>
                    </div>

                    <p className="text-white/90">
                      <BoldIBMC text="IBMC was built to " /><span className="text-brand-red font-bold">remove that randomness.</span>
                    </p>

                    <p>
                      Through structured one-to-one matching and curated rooms, you connect directly with decision-makers, strategic partners, and global opportunities.
                    </p>

                    <div className="py-8">
                      <p className="text-white/40 mb-2 italic">You don’t just exchange business cards.</p>
                      <p className="font-display text-6xl md:text-8xl text-brand-red uppercase tracking-tight">You build strategic matches.</p>
                    </div>

                    <div className="space-y-2 pt-8">
                      <p className="text-3xl font-bold uppercase tracking-tight">Stop looking. Start finding.</p>
                      <p className="text-brand-red font-display text-4xl uppercase tracking-tight">Be in the right room.</p>
                    </div>

                    <div className="flex justify-center pt-12">
                      <RegistrationCTA className="group relative min-h-[52px] px-8 py-5 sm:px-12 sm:py-5 bg-brand-red text-white font-display text-xl sm:text-2xl uppercase tracking-wider rounded-full overflow-hidden transition-transform hover:scale-105 active:scale-95 cursor-pointer inline-flex items-center justify-center" />
                    </div>
                  </div>
                </motion.div>
              </div>
            </section>

            {/* Keynote speaker — directly after What is IBMC */}
            <section className="py-16 sm:py-24 md:py-28 px-4 sm:px-6 bg-zinc-950 border-y border-white/5">
              <div className="max-w-7xl mx-auto">
                <motion.div
                  initial="hidden"
                  whileInView="visible"
                  viewport={viewport}
                  variants={scrollReveal}
                  className="text-center mb-12 md:mb-16"
                >
                  <h2 className="section-eyebrow mb-4">Keynote</h2>
                  <h3 className="section-title-lg">
                    IBMC <span className="text-brand-red font-bold">Key Speaker</span>
                  </h3>
                </motion.div>

                <div className="grid md:grid-cols-2 gap-10 md:gap-14 lg:gap-20 items-center">
                  <motion.div
                    initial="hidden"
                    whileInView="visible"
                    viewport={viewport}
                    variants={scrollRevealLeft}
                    className="text-left space-y-6 md:space-y-8"
                  >
                    <div>
                      <p className="font-display text-4xl sm:text-5xl md:text-6xl font-bold text-white tracking-tight">
                        Neeraj Shah
                      </p>
                      <p className="mt-2 text-xl md:text-2xl text-white/70 italic">
                        Founder, Titan Masterminds
                      </p>
                    </div>

                    <div className="space-y-4 text-lg md:text-xl font-light text-white/80 leading-relaxed">
                      <p>
                        Founder of Titan Masterminds, a top 20 mentor and LinkedIn faculty on GeniusU—reaching 1.7 million entrepreneurs.
                      </p>
                      <p>
                        Recognized as a Top 200 Global Thought Leader by PeopleHum (2021). He scaled BNI India to 10,000 entrepreneurs across 28 cities and $450 million in revenue—and is a best-selling author.
                      </p>
                    </div>

                    <div className="pt-2 border-t border-white/10">
                      <p className="section-eyebrow mb-2 text-left">IBMC topic</p>
                      <p className="text-xl md:text-2xl font-semibold text-white leading-snug">
                        &ldquo;<span className="italic">Master AI to Save 20+ Hours Per Week &amp; Grow Profits</span>&rdquo;
                      </p>
                    </div>
                  </motion.div>

                  <motion.div
                    initial="hidden"
                    whileInView="visible"
                    viewport={viewport}
                    variants={scrollRevealRight}
                    className="relative w-full aspect-[4/5] sm:aspect-[3/4] md:aspect-[5/6] max-h-[520px] md:max-h-none overflow-hidden rounded-3xl bg-black border border-white/10"
                  >
                    <img
                      src="/assets/keynote-neeraj-shah.png"
                      alt="Neeraj Shah, IBMC keynote speaker"
                      className="absolute inset-0 h-full w-full object-cover object-center"
                    />
                  </motion.div>
                </div>
              </div>
            </section>

            {/* Section 4 – WHAT THIS ROOM IS */}
            <section className="py-16 sm:py-24 md:py-32 px-4 sm:px-6 bg-white text-black">
              <div className="max-w-7xl mx-auto">
                <motion.div
                  initial="hidden"
                  whileInView="visible"
                  viewport={viewport}
                  variants={scrollReveal}
                  className="grid lg:grid-cols-2 gap-20 items-end mb-20"
                >
                  <div>
                    <h2 className="section-eyebrow mb-6">What This Room Is</h2>
                    <h3 className="section-title-lg leading-[0.95]">
                      This is not <br />
                      just an <span className="text-brand-red">event.</span>
                    </h3>
                  </div>
                  <div className="pb-4">
                    <p className="text-2xl md:text-3xl font-light leading-tight">
                      This is a room <span className="font-bold">designed for business.</span> No fluff. No jargon. Just outcomes.
                    </p>
                  </div>
                </motion.div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 mb-12">
                  {[
                    { src: "/assets/ibmc-2.png", alt: "IBMC networking" },
                    { src: "/assets/ibmc-3.png", alt: "IBMC conference discussion" },
                    { src: "/assets/ibmc-4.png", alt: "IBMC business matching" },
                  ].map((img, i) => (
                    <motion.div
                      key={i}
                      initial="hidden"
                      whileInView="visible"
                      viewport={viewport}
                      variants={scrollRevealScale}
                      custom={i}
                      className="relative aspect-[4/3] rounded-2xl overflow-hidden"
                    >
                      <img src={img.src} alt={img.alt} className="w-full h-full object-cover grayscale hover:grayscale-0 transition-all duration-500" />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" />
                    </motion.div>
                  ))}
                </div>

                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
                  {[
                    { icon: Users, title: "Business owners ready to collaborate", desc: "Connect with peers who are at your level or higher." },
                    { icon: Handshake, title: "Structured one-to-one business meetings", desc: "No random networking. Purposeful, timed interactions." },
                    { icon: TrendingUp, title: "Buyers and sellers in the same space", desc: "Direct access to the decision-makers you've been looking for." },
                    { icon: Globe, title: "Local and international connections", desc: "Expand your reach beyond your current borders." },
                    { icon: CheckCircle2, title: "Two days focused on growth", desc: "Dedicated time to work ON your business, not just in it." },
                    { icon: Lightbulb, title: "Learn and be inspired from the best", desc: "Sharing proven and effective ways to grow your business." }
                  ].map((item, i) => (
                    <div key={i} className="p-8 border border-black/10 rounded-3xl hover:bg-zinc-50 transition-colors">
                      <item.icon className="w-10 h-10 text-brand-red mb-6" />
                      <h4 className="text-xl font-bold mb-4 leading-tight">{item.title}</h4>
                      <p className="text-black/60">{item.desc}</p>
                    </div>
                  ))}
                </div>

                <div className="flex justify-center pt-16">
                  <RegistrationCTA className="group relative min-h-[52px] px-8 py-5 sm:px-12 sm:py-5 bg-brand-red text-white font-display text-xl sm:text-2xl uppercase tracking-wider rounded-full overflow-hidden transition-transform hover:scale-105 active:scale-95 cursor-pointer inline-flex items-center justify-center" />
                </div>
              </div>
            </section>

            {/* Section: The Cost of Missing Out (StoryBrand Consequence) */}
            <section className="py-16 sm:py-24 md:py-32 px-4 sm:px-6 bg-zinc-900 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-full opacity-5 pointer-events-none">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full bg-[radial-gradient(circle,rgba(227,30,36,0.2)_0%,transparent_70%)]" />
              </div>
              
              <div className="max-w-5xl mx-auto text-center">
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                >
                  <h2 className="section-eyebrow mb-8">The Consequence</h2>
                  <h3 className="section-title-lg mb-12">
                    What happens if you <br /><span className="text-brand-red">miss the room?</span>
                  </h3>
                  
                  <div className="grid md:grid-cols-2 gap-12 text-left">
                    <div className="glass-card p-10 rounded-3xl border-white/5">
                      <h4 className="text-2xl font-bold mb-6 text-white">The "Random" Cycle Continues</h4>
                      <p className="text-white/60 text-lg leading-relaxed">
                        Without the right room, you're left with random networking and random referrals. Another year goes by where growth feels like a roll of the dice rather than a strategic certainty.
                      </p>
                    </div>
                    
                    <div className="glass-card p-10 rounded-3xl border-white/5">
                      <h4 className="text-2xl font-bold mb-6 text-white">The Gap Widens</h4>
                      <p className="text-white/60 text-lg leading-relaxed">
                        While you're working harder, your competitors are in the rooms you missed. They are forming the partnerships, securing the buyers, and discovering the ideas that should have been yours.
                      </p>
                    </div>
                  </div>

                  <div className="mt-20 p-12 border border-brand-red/20 rounded-3xl bg-brand-red/5">
                    <p className="text-2xl md:text-3xl font-light italic text-white/90">
                      "The most expensive room is the one you weren't in."
                    </p>
                    <div className="mt-8 flex flex-col md:flex-row items-center justify-center gap-6">
                      <p className="text-lg font-medium">Don't let 2026 be another year of "almost."</p>
                      <RegistrationCTA className="group relative min-h-[52px] px-8 py-5 sm:px-12 sm:py-5 bg-brand-red text-white font-display text-xl sm:text-2xl uppercase tracking-wider rounded-full overflow-hidden transition-transform hover:scale-105 active:scale-95 cursor-pointer shrink-0 inline-flex items-center justify-center" />
                    </div>
                  </div>
                </motion.div>
              </div>
            </section>

            {/* Section 5 – DECISION */}
            <section className="py-12 sm:py-16 lg:py-20 px-6 sm:px-8 text-center relative overflow-hidden">
              <div className="absolute inset-0 z-0 opacity-30">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1000px] h-[1000px] bg-brand-red/10 rounded-full blur-[150px]" />
              </div>

              <div className="relative z-10 max-w-2xl mx-auto text-lg sm:text-xl">
                <h2 className="section-eyebrow mb-4">Your Decision</h2>
                <h3 className="section-title-lg mb-4">
                  Still looking?
                </h3>
                
                <div className="my-5 sm:my-6 space-y-6 sm:space-y-8">
                  <p className="font-light opacity-50 italic">Pause.</p>
                  <h3 className="section-title-lg">
                    Or ready to be in the <span className="text-brand-red">right room?</span>
                  </h3>
                  <p className="text-xl sm:text-2xl md:text-3xl text-white/90 font-light leading-relaxed">
                    <span className="font-semibold text-white">Growth</span> isn&apos;t <span className="text-brand-red font-semibold">random.</span>
                  </p>
                  <p className="text-xl sm:text-2xl md:text-3xl text-white/90 font-light leading-relaxed">
                    <span className="text-brand-red font-semibold">Rooms</span> decide <span className="font-semibold text-white">results.</span>
                  </p>
                  <p className="text-xl sm:text-2xl md:text-3xl text-white/80 font-light pt-2">
                    If you&apos;re <span className="font-semibold text-white/90">serious</span> about <span className="font-semibold text-white/90">building</span>,
                  </p>
                  <p className="text-2xl sm:text-3xl md:text-4xl font-semibold text-white tracking-tight pt-1">
                    be in the <span className="text-brand-red">room</span> where it happens.
                  </p>
                  <p className="text-lg sm:text-xl text-brand-red font-semibold pt-6 sm:pt-8">
                    Slots are limited. This is only for serious business owners.
                  </p>
                </div>

                <div className="flex flex-col items-center pt-4 sm:pt-5">
                  <RegistrationCTA className="group relative min-h-[52px] px-6 py-4 sm:px-10 sm:py-5 lg:px-12 lg:py-5 bg-brand-red text-white font-display uppercase tracking-wider rounded-full overflow-hidden transition-all hover:scale-105 hover:shadow-[0_0_40px_rgba(227,30,36,0.3)] active:scale-95 cursor-pointer inline-flex items-center justify-center" />
                  <div className="mt-[50px]">
                    <p className="font-medium text-white/80 mb-0">Stop looking. Start finding.</p>
                    <div className="mt-4 h-[160px] sm:h-[200px] md:h-[240px] overflow-hidden w-screen relative left-1/2 -translate-x-1/2">
                      <LogoMarquee />
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* FAQ Section */}
            <section className="py-20 sm:py-32 px-4 sm:px-6 bg-zinc-950 border-t border-white/5">
              <div className="max-w-3xl mx-auto">
                <h2 className="section-eyebrow mb-8">FAQ</h2>
                <h3 className="section-title-lg mb-16">
                  Frequently asked <span className="text-brand-red">questions</span>
                </h3>
                <div className="space-y-4">
                  {FAQ_ITEMS.map((item, i) => (
                    <div
                      key={i}
                      className="border border-white/10 rounded-2xl overflow-hidden"
                    >
                      <button
                        onClick={() => setOpenFaq(openFaq === i ? null : i)}
                        className="w-full flex items-start sm:items-center justify-between gap-4 p-6 sm:p-8 text-left hover:bg-white/5 transition-colors"
                      >
                        <span className="font-semibold text-lg sm:text-xl text-white flex-1 min-w-0"><BoldIBMC text={item.q} /></span>
                        <ChevronDown className={`w-6 h-6 shrink-0 text-brand-red transition-transform duration-300 flex-shrink-0 ${openFaq === i ? "rotate-180" : ""}`} />
                      </button>
                      <AnimatePresence>
                        {openFaq === i && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.3 }}
                            className="overflow-hidden"
                          >
                            <p className="px-6 sm:px-8 pt-4 sm:pt-2 pb-6 sm:pb-8 text-white/70 text-base sm:text-lg leading-relaxed">
                              <BoldIBMC text={item.a} />
                            </p>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* Footer */}
            <footer className="py-12 px-6 border-t border-white/10 text-center text-white/40 text-sm">
              <div className="flex flex-col items-center gap-6">
                <div className="flex flex-col items-center gap-2">
                  <p className="text-white text-xs uppercase tracking-widest">Powered by</p>
                  <a href="https://bniphilippines.com/" target="_blank" rel="noopener noreferrer" className="inline-block hover:opacity-90 transition-opacity">
                    <img src="/assets/bni-philippines-logo.png" alt="BNI Philippines" className="w-auto object-contain bni-logo" />
                  </a>
                </div>
                <p>© 2026 International Business Matching Conference. All rights reserved.</p>
              </div>
            </footer>
          </motion.div>
      </AnimatePresence>
      </div>
    </div>
  );
}
