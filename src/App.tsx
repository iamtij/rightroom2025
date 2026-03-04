import { useState, FormEvent, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ArrowRight, CheckCircle2, Users, Handshake, Globe, TrendingUp, X, CreditCard, Mail, Phone, User, ChevronDown } from "lucide-react";

type ViewState = "landing" | "register" | "thanks";

const EVENT_DATE = new Date("2026-06-17T00:00:00");

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
      <div className="flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-4 md:gap-8 text-base sm:text-base md:text-lg font-semibold tracking-wide">
        <span><span className="font-bold">IBMC</span> 2026 — <span className="font-bold">June 17-18, 2026</span> | NPAT, Pasay City</span>
        <span className="hidden sm:inline opacity-60">|</span>
        <span className="flex items-center justify-center gap-3 sm:gap-2 md:gap-4 flex-wrap text-lg sm:text-base">
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
            <img key={`${setIdx}-${i}`} src="/assets/ibmc-logo-white.png" alt="IBMC 2026" className="h-full w-auto object-contain shrink-0 scale-[0.4] sm:scale-[0.5] md:scale-[0.6] -mr-[650px] md:-mr-[350px]" />
          ))}
        </div>
      ))}
    </div>
  );
}

const FAQ_ITEMS = [
  { q: "What is IBMC?", a: "IBMC stands for International Business Matching Conference. It's a 2-day business matching experience designed for serious business owners who want intentional and sustainable growth through structured one-to-one meetings and curated rooms." },
  { q: "When and where is IBMC 2026?", a: "IBMC 2026 takes place on June 17–18, 2026 in NPAT, Pasay City." },
  { q: "Who should attend?", a: "Business owners, decision-makers, and professionals who are ready to grow through strategic partnerships, direct access to buyers and sellers, and meaningful connections. If you're tired of random networking and want purposeful growth, IBMC is for you." },
  { q: "How does the business matching work?", a: "Through structured one-to-one matching and curated rooms, you connect directly with decision-makers and strategic partners. No random introductions—every interaction is designed to move your business forward." },
  { q: "How do I register?", a: "Click 'Secure Your Seat' anywhere on this page to complete your registration. You'll receive a confirmation email with next steps and how to prepare your business profile for matching." },
];

export default function App() {
  const [view, setView] = useState<ViewState>("landing");
  const [quoteIndex, setQuoteIndex] = useState(0);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  useEffect(() => {
    if (view !== "landing") return;
    const interval = setInterval(() => {
      setQuoteIndex((prev) => (prev + 1) % HERO_QUOTES.length);
    }, 4000);
    return () => clearInterval(interval);
  }, [view]);

  const handleRegister = (e: FormEvent) => {
    e.preventDefault();
    setView("thanks");
  };

  return (
    <div className="min-h-screen bg-black text-white selection:bg-brand-red selection:text-white overflow-x-hidden font-sans">
      <header className="fixed top-0 left-0 right-0 z-[60] flex flex-col">
        <CountdownBanner />
        <nav className="w-full px-4 sm:px-6 py-3 sm:py-4 flex justify-between items-center bg-black shrink-0">
              <div className="flex items-center gap-2">
                <span className="font-display text-2xl font-bold tracking-tight text-brand-red">IBMC</span>
                <span className="text-xs font-bold tracking-[0.2em] opacity-50 uppercase">2026</span>
              </div>
              <button 
                onClick={() => setView("register")}
                className="animate-pulse-slow min-h-[48px] min-w-[44px] px-6 py-3.5 bg-brand-red text-white border border-brand-red rounded-full text-base font-semibold hover:bg-brand-red-light hover:shadow-[0_0_24px_rgba(227,30,36,0.6)] transition-all duration-300 cursor-pointer"
              >
                Secure Your Seat
              </button>
            </nav>
      </header>

      <AnimatePresence mode="wait">
        {view === "landing" && (
          <motion.div
            key="landing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="relative"
          >
            {/* Hero Section */}
            <section className="relative min-h-screen flex flex-col items-center justify-center px-4 sm:px-6 pt-40 sm:pt-36 overflow-visible">
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
                
                <div className="mt-12 space-y-8">
                  <div className="space-y-4">
                    <p className="text-xl sm:text-2xl md:text-4xl font-light tracking-tight text-white/90">
                      You don’t need more tactics. <br />
                      <span className="font-semibold">You need direct access to the right people.</span>
                    </p>
                    <p className="text-base sm:text-lg md:text-xl text-white/50 max-w-2xl mx-auto">
                      <BoldIBMC text="IBMC is a 2-day business matching experience for serious business owners who want intentional and sustainable growth, taking place on June 17–18, 2026 in NPAT, Pasay City." />
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
                  
                  <div className="flex flex-col items-center pt-8">
                    <button
                      onClick={() => setView("register")}
                      className="group relative min-h-[52px] px-8 py-5 sm:px-12 sm:py-5 bg-brand-red text-white font-display text-xl sm:text-2xl uppercase tracking-wider rounded-full overflow-hidden transition-transform hover:scale-105 active:scale-95 cursor-pointer"
                    >
                      <span className="relative z-10 flex items-center gap-3">
                        Secure Your Seat <ArrowRight className="group-hover:translate-x-1 transition-transform" />
                      </span>
                      <div className="absolute inset-0 bg-white/10 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
                    </button>
                  </div>
                </div>
              </motion.div>

              {/* Scroll Indicator */}
              <motion.div 
                animate={{ y: [0, 10, 0] }}
                transition={{ duration: 2, repeat: Infinity }}
                className="absolute bottom-10 left-1/2 -translate-x-1/2 opacity-30"
              >
                <div className="w-px h-12 bg-gradient-to-b from-white to-transparent" />
              </motion.div>
            </section>

            {/* Section: All in One Room */}
            <section className="py-20 sm:py-28 px-4 sm:px-6 bg-zinc-950 border-y border-white/5 overflow-hidden">
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

            {/* Section: What is IBMC? */}
            <section className="py-20 sm:py-32 px-4 sm:px-6 bg-black border-y border-white/5 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-1/3 h-full bg-brand-red/5 blur-[120px] -z-10" />
              <div className="max-w-4xl mx-auto text-center">
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                >
                  <h2 className="section-eyebrow mb-8">Why We Exist</h2>
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
                      <BoldIBMC text="IBMC is a 2-day business matching experience for serious business owners who want intentional and sustainable growth, taking place on " /> <span className="font-bold">June 17–18, 2026 in NPAT, Pasay City</span>.
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
                      <button 
                        onClick={() => setView("register")}
                        className="group relative min-h-[52px] px-8 py-5 sm:px-12 sm:py-5 bg-brand-red text-white font-display text-xl sm:text-2xl uppercase tracking-wider rounded-full overflow-hidden transition-transform hover:scale-105 active:scale-95 cursor-pointer"
                      >
                        <span className="relative z-10 flex items-center gap-3">
                          Secure Your Seat <ArrowRight className="group-hover:translate-x-1 transition-transform" />
                        </span>
                        <div className="absolute inset-0 bg-white/10 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              </div>
            </section>

            {/* Section 2 – THE REAL PROBLEM */}
            <section className="py-12 sm:py-20 px-4 sm:px-6 bg-zinc-950 overflow-hidden">
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
                        <button 
                          onClick={() => setView("register")}
                          className="group relative min-h-[52px] px-8 py-5 sm:px-12 sm:py-5 bg-brand-red text-white font-display text-xl sm:text-2xl uppercase tracking-wider rounded-full overflow-hidden transition-transform hover:scale-105 active:scale-95 cursor-pointer"
                        >
                          <span className="relative z-10 flex items-center gap-3">
                            Secure Your Seat <ArrowRight className="group-hover:translate-x-1 transition-transform" />
                          </span>
                          <div className="absolute inset-0 bg-white/10 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
                        </button>
                      </div>
                    </motion.div>
                  </div>
                </motion.div>
              </div>
            </section>

            {/* Section 3 – THE SHIFT */}
            <section className="py-20 sm:py-32 px-4 sm:px-6 relative overflow-hidden">
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
                  <button 
                    onClick={() => setView("register")}
                    className="group relative min-h-[52px] px-8 py-5 sm:px-12 sm:py-5 bg-brand-red text-white font-display text-xl sm:text-2xl uppercase tracking-wider rounded-full overflow-hidden transition-transform hover:scale-105 active:scale-95 cursor-pointer"
                  >
                    <span className="relative z-10 flex items-center gap-3">
                      Secure Your Seat <ArrowRight className="group-hover:translate-x-1 transition-transform" />
                    </span>
                    <div className="absolute inset-0 bg-white/10 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
                  </button>
                </div>
              </div>
            </section>

            {/* Section 4 – WHAT THIS ROOM IS */}
            <section className="py-20 sm:py-32 px-4 sm:px-6 bg-white text-black">
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
                    { icon: CheckCircle2, title: "Two days focused on growth", desc: "Dedicated time to work ON your business, not just in it." }
                  ].map((item, i) => (
                    <div key={i} className="p-8 border border-black/10 rounded-3xl hover:bg-zinc-50 transition-colors">
                      <item.icon className="w-10 h-10 text-brand-red mb-6" />
                      <h4 className="text-xl font-bold mb-4 leading-tight">{item.title}</h4>
                      <p className="text-black/60">{item.desc}</p>
                    </div>
                  ))}
                </div>

                <div className="flex justify-center pt-16">
                  <button 
                    onClick={() => setView("register")}
                    className="group relative min-h-[52px] px-8 py-5 sm:px-12 sm:py-5 bg-brand-red text-white font-display text-xl sm:text-2xl uppercase tracking-wider rounded-full overflow-hidden transition-transform hover:scale-105 active:scale-95 cursor-pointer"
                  >
                    <span className="relative z-10 flex items-center gap-3">
                      Secure Your Seat <ArrowRight className="group-hover:translate-x-1 transition-transform" />
                    </span>
                    <div className="absolute inset-0 bg-white/10 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
                  </button>
                </div>
              </div>
            </section>

            {/* Section: The Cost of Missing Out (StoryBrand Consequence) */}
            <section className="py-20 sm:py-32 px-4 sm:px-6 bg-zinc-900 relative overflow-hidden">
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
                      <button 
                        onClick={() => setView("register")}
                        className="group relative min-h-[52px] px-8 py-5 sm:px-12 sm:py-5 bg-brand-red text-white font-display text-xl sm:text-2xl uppercase tracking-wider rounded-full overflow-hidden transition-transform hover:scale-105 active:scale-95 cursor-pointer shrink-0"
                      >
                        <span className="relative z-10 flex items-center gap-3">
                          Secure Your Seat <ArrowRight className="group-hover:translate-x-1 transition-transform" />
                        </span>
                        <div className="absolute inset-0 bg-white/10 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
                      </button>
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
                </div>

                <div className="flex flex-col items-center pt-4 sm:pt-5">
                  <button 
                    onClick={() => setView("register")}
                    className="group relative min-h-[52px] px-6 py-4 sm:px-10 sm:py-5 lg:px-12 lg:py-5 bg-brand-red text-white font-display uppercase tracking-wider rounded-full overflow-hidden transition-all hover:scale-105 hover:shadow-[0_0_40px_rgba(227,30,36,0.3)] active:scale-95 cursor-pointer"
                  >
                    <span className="relative z-10 flex items-center gap-3">
                      Secure Your Seat <ArrowRight className="w-6 h-6 sm:w-7 sm:h-7 group-hover:translate-x-2 transition-transform" />
                    </span>
                    <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
                  </button>
                  <div className="mt-[50px]">
                    <p className="font-medium text-white/80 mb-0">Stop looking. Start finding.</p>
                    <div className="mt-0 h-[200px] sm:h-[260px] md:h-[320px] overflow-hidden w-screen relative left-1/2 -translate-x-1/2">
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
                        className="w-full flex items-center justify-between gap-4 p-6 sm:p-8 text-left hover:bg-white/5 transition-colors"
                      >
                        <span className="font-semibold text-lg sm:text-xl text-white"><BoldIBMC text={item.q} /></span>
                        <ChevronDown className={`w-6 h-6 shrink-0 text-brand-red transition-transform duration-300 ${openFaq === i ? "rotate-180" : ""}`} />
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
                            <p className="px-6 sm:px-8 pb-6 sm:pb-8 text-white/70 text-base sm:text-lg leading-relaxed -mt-2">
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
        )}

        {view === "register" && (
          <motion.div
            key="register"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.05 }}
            className="min-h-screen flex items-center justify-center p-6 pt-20 bg-zinc-950"
          >
            <div className="w-full max-w-xl">
              <div className="flex justify-between items-center mb-12">
                <div className="flex items-center gap-2">
                  <span className="font-display text-2xl font-bold tracking-tight text-brand-red">IBMC</span>
                  <span className="text-xs font-bold tracking-[0.2em] opacity-50 uppercase">2026</span>
                </div>
                <button 
                  onClick={() => setView("landing")}
                  className="min-h-[48px] min-w-[48px] p-3 flex items-center justify-center hover:bg-white/10 rounded-full transition-colors cursor-pointer"
                >
                  <X className="w-7 h-7" />
                </button>
              </div>

              <div className="mb-10">
                <h2 className="font-display text-4xl sm:text-5xl uppercase tracking-tight mb-2">Secure Your Seat</h2>
                <p className="text-base text-white/60">Fill in your details to join the room.</p>
              </div>

              <form onSubmit={handleRegister} className="space-y-6">
                <div className="space-y-4">
                  <div className="relative">
                    <User className="absolute left-4 top-1/2 -translate-y-1/2 w-6 h-6 text-white/30" />
                    <input 
                      required
                      type="text" 
                      placeholder="Full Name" 
                      className="w-full bg-white/5 border border-white/10 rounded-2xl py-5 pl-14 pr-4 text-base focus:outline-none focus:border-brand-red focus:ring-1 focus:ring-brand-red transition-all min-h-[52px]"
                    />
                  </div>
                  <div className="relative">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-6 h-6 text-white/30" />
                    <input 
                      required
                      type="email" 
                      placeholder="Email Address" 
                      className="w-full bg-white/5 border border-white/10 rounded-2xl py-5 pl-14 pr-4 text-base focus:outline-none focus:border-brand-red focus:ring-1 focus:ring-brand-red transition-all min-h-[52px]"
                    />
                  </div>
                  <div className="relative">
                    <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-6 h-6 text-white/30" />
                    <input 
                      required
                      type="tel" 
                      placeholder="Mobile Number" 
                      className="w-full bg-white/5 border border-white/10 rounded-2xl py-5 pl-14 pr-4 text-base focus:outline-none focus:border-brand-red focus:ring-1 focus:ring-brand-red transition-all min-h-[52px]"
                    />
                  </div>
                </div>

                <div className="pt-4">
                  <label className="block text-sm uppercase tracking-widest text-white/40 mb-4 font-bold">Payment Method (Mockup)</label>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="min-h-[80px] p-5 rounded-2xl border-2 border-brand-red bg-brand-red/5 flex flex-col items-center justify-center gap-2 cursor-pointer transition-all">
                      <CreditCard className="w-8 h-8 text-brand-red" />
                      <span className="text-base font-semibold">Credit Card</span>
                    </div>
                    <div className="min-h-[80px] p-5 rounded-2xl border border-white/10 bg-white/5 flex flex-col items-center justify-center gap-2 opacity-50 cursor-not-allowed">
                      <Handshake className="w-8 h-8" />
                      <span className="text-base font-semibold">Bank Transfer</span>
                    </div>
                  </div>
                </div>

                <button 
                  type="submit"
                  className="w-full min-h-[56px] py-6 bg-brand-red text-white font-display text-xl uppercase tracking-wider rounded-2xl hover:bg-red-600 transition-all active:scale-[0.98] cursor-pointer mt-8"
                >
                  Complete Registration
                </button>
              </form>
            </div>
          </motion.div>
        )}

        {view === "thanks" && (
          <motion.div
            key="thanks"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="min-h-screen flex items-center justify-center p-6 pt-20 bg-black"
          >
            <div className="max-w-xl text-center">
              <div className="w-24 h-24 bg-brand-red/20 rounded-full flex items-center justify-center mx-auto mb-8">
                <CheckCircle2 className="w-12 h-12 text-brand-red" />
              </div>
              <h2 className="font-display text-4xl sm:text-6xl uppercase tracking-tight mb-6">See you in <br /><span className="text-brand-red">the room.</span></h2>
              <p className="text-lg sm:text-xl text-white/60 mb-12">Your registration is complete. We've sent a confirmation to your email with the next steps.</p>
              
              <div className="glass-card p-8 rounded-3xl text-left mb-12">
                <h4 className="text-xs uppercase tracking-widest text-brand-red font-bold mb-6">Next Steps</h4>
                <ul className="space-y-4">
                  <li className="flex items-start gap-3">
                    <div className="w-5 h-5 rounded-full bg-brand-red/20 flex items-center justify-center text-[10px] font-bold text-brand-red shrink-0 mt-0.5">1</div>
                    <p className="text-white/80">Check your inbox for the welcome kit.</p>
                  </li>
                  <li className="flex items-start gap-3">
                    <div className="w-5 h-5 rounded-full bg-brand-red/20 flex items-center justify-center text-[10px] font-bold text-brand-red shrink-0 mt-0.5">2</div>
                    <p className="text-white/80">Add the event to your calendar (<span className="font-bold">June 17-18, 2026</span>).</p>
                  </li>
                  <li className="flex items-start gap-3">
                    <div className="w-5 h-5 rounded-full bg-brand-red/20 flex items-center justify-center text-[10px] font-bold text-brand-red shrink-0 mt-0.5">3</div>
                    <p className="text-white/80">Prepare your business profile for matching.</p>
                  </li>
                </ul>
              </div>

              <button 
                onClick={() => setView("landing")}
                className="min-h-[48px] px-6 py-3 text-white/40 hover:text-white transition-colors text-base uppercase tracking-widest font-bold cursor-pointer"
              >
                Back to Home
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
