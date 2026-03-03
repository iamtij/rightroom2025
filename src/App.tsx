import { useState, FormEvent, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ArrowRight, CheckCircle2, Users, Handshake, Globe, TrendingUp, X, CreditCard, Mail, Phone, User } from "lucide-react";

type ViewState = "landing" | "register" | "thanks";

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

export default function App() {
  const [view, setView] = useState<ViewState>("landing");
  const [quoteIndex, setQuoteIndex] = useState(0);

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
      <AnimatePresence mode="wait">
        {view === "landing" && (
          <motion.div
            key="landing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="relative"
          >
            {/* Navigation */}
            <nav className="fixed top-0 w-full z-50 px-6 py-6 flex justify-between items-center bg-gradient-to-b from-black/80 to-transparent backdrop-blur-sm">
              <div className="flex items-center gap-2">
                <span className="font-display text-2xl tracking-tighter text-brand-red">IBMC</span>
                <span className="text-xs font-bold tracking-[0.2em] opacity-50 uppercase">2026</span>
              </div>
              <button 
                onClick={() => setView("register")}
                className="px-6 py-2 border border-white/20 rounded-full text-sm font-semibold hover:bg-white hover:text-black transition-all duration-300 cursor-pointer"
              >
                Secure Your Seat
              </button>
            </nav>

            {/* Hero Section */}
            <section className="relative min-h-screen flex flex-col items-center justify-center px-6 pt-20 overflow-hidden">
              <div className="absolute inset-0 z-0 opacity-20">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-brand-red/20 rounded-full blur-[120px]" />
              </div>

              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8 }}
                className="relative z-10 text-center max-w-5xl mx-auto"
              >
                <h1 className="font-display text-[15vw] md:text-[12vw] leading-[0.85] uppercase tracking-tighter animate-slam">
                  Be in the <br />
                  <span className="text-brand-red">Right Room.</span>
                </h1>
                
                <div className="mt-12 space-y-8">
                  <div className="space-y-4">
                    <p className="text-2xl md:text-4xl font-light tracking-tight text-white/90">
                      You don’t need more tactics. <br />
                      <span className="font-semibold">You need the right environment.</span>
                    </p>
                    <p className="text-lg md:text-xl text-white/50 max-w-2xl mx-auto">
                      A 2-day business matching experience designed for serious business owners ready to grow.
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
                        <p className="text-xl md:text-3xl font-semibold leading-tight tracking-tight text-white italic">
                          {HERO_QUOTES[quoteIndex]}
                        </p>
                      </motion.div>
                    </AnimatePresence>
                  </div>
                  
                  <div className="flex flex-col md:flex-row items-center justify-center gap-4 md:gap-8 text-lg md:text-xl text-white/60 font-medium pt-4">
                    <span className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-brand-red" /> The right conversations</span>
                    <span className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-brand-red" /> The right connections</span>
                    <span className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-brand-red" /> The right opportunities</span>
                  </div>

                  <div className="pt-8">
                    <button 
                      onClick={() => setView("register")}
                      className="group relative px-12 py-5 bg-brand-red text-white font-display text-2xl uppercase tracking-wider rounded-full overflow-hidden transition-transform hover:scale-105 active:scale-95 cursor-pointer"
                    >
                      <span className="relative z-10 flex items-center gap-3">
                        Secure Your Seat <ArrowRight className="group-hover:translate-x-1 transition-transform" />
                      </span>
                      <div className="absolute inset-0 bg-white/10 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
                    </button>
                    <p className="mt-4 text-xs uppercase tracking-[0.3em] opacity-40">All in one room.</p>
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

            {/* Section: What is IBMC? */}
            <section className="py-32 px-6 bg-black border-y border-white/5 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-1/3 h-full bg-brand-red/5 blur-[120px] -z-10" />
              <div className="max-w-4xl mx-auto text-center">
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                >
                  <h2 className="text-xs uppercase tracking-[0.4em] text-brand-red font-bold mb-8">Why We Exist</h2>
                  <h3 className="font-display text-5xl md:text-7xl uppercase tracking-tighter mb-12">
                    What is <span className="text-brand-red">IBMC?</span>
                  </h3>
                  <div className="space-y-10 text-xl md:text-2xl font-light leading-relaxed text-white/80">
                    <p>
                      <span className="font-bold text-white">IBMC</span> stands for the <span className="italic">International Business Matching Conference.</span>
                    </p>
                    
                    <div className="relative h-64 md:h-96 w-full rounded-3xl overflow-hidden my-12">
                      <img 
                        src="https://images.unsplash.com/photo-1515187029135-18ee286d815b?auto=format&fit=crop&q=80&w=1200" 
                        alt="Professionals collaborating" 
                        className="w-full h-full object-cover grayscale opacity-60 hover:grayscale-0 hover:opacity-100 transition-all duration-700"
                        referrerPolicy="no-referrer"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent" />
                    </div>

                    <p className="text-white/90">
                      It is a <span className="font-bold">2-day business matching experience</span> designed for serious business owners who want intentional and sustainable growth.
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
                      IBMC was built to <span className="text-brand-red font-bold">remove that randomness.</span>
                    </p>

                    <p>
                      Through structured one-to-one matching and curated rooms, you connect directly with decision-makers, strategic partners, and global opportunities.
                    </p>

                    <div className="py-8">
                      <p className="text-white/40 mb-2 italic">You don’t just exchange business cards.</p>
                      <p className="font-display text-6xl md:text-8xl text-brand-red uppercase tracking-tighter">You build strategic matches.</p>
                    </div>

                    <div className="space-y-2 pt-8">
                      <p className="text-3xl font-bold uppercase tracking-tighter">Stop looking. Start finding.</p>
                      <p className="text-brand-red font-display text-4xl uppercase tracking-tighter">Be in the right room.</p>
                    </div>

                    <div className="pt-12">
                      <button 
                        onClick={() => setView("register")}
                        className="group relative px-12 py-5 bg-brand-red text-white font-display text-2xl uppercase tracking-wider rounded-full overflow-hidden transition-transform hover:scale-105 active:scale-95 cursor-pointer"
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
            <section className="py-32 px-6 bg-zinc-950">
              <div className="max-w-7xl mx-auto grid md:grid-cols-2 gap-16 items-center">
                <div>
                  <h2 className="font-display text-6xl md:text-8xl leading-none uppercase tracking-tighter">
                    Maybe you’re <br />
                    not missing <br />
                    <span className="text-stroke">effort.</span>
                  </h2>
                  <h3 className="mt-6 text-3xl md:text-4xl font-light text-brand-red">
                    Maybe you’re missing the room.
                  </h3>
                </div>
                
                <div className="space-y-8">
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
                      <div className="mt-1.5 w-2 h-2 rounded-full bg-brand-red group-hover:scale-150 transition-transform" />
                      <p className="text-xl md:text-2xl font-medium text-white/80">{text}</p>
                    </motion.div>
                  ))}
                  <div className="pt-8">
                    <button 
                      onClick={() => setView("register")}
                      className="group relative px-12 py-5 bg-brand-red text-white font-display text-2xl uppercase tracking-wider rounded-full overflow-hidden transition-transform hover:scale-105 active:scale-95 cursor-pointer"
                    >
                      <span className="relative z-10 flex items-center gap-3">
                        Secure Your Seat <ArrowRight className="group-hover:translate-x-1 transition-transform" />
                      </span>
                      <div className="absolute inset-0 bg-white/10 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
                    </button>
                  </div>
                </div>
              </div>
            </section>

            {/* Section 3 – THE SHIFT */}
            <section className="py-32 px-6 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
                <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white to-transparent" />
                <div className="absolute bottom-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white to-transparent" />
              </div>

              <div className="max-w-7xl mx-auto">
                <div className="text-center mb-24">
                  <h2 className="font-display text-7xl md:text-9xl uppercase tracking-tighter mb-8">
                    Rooms shape <span className="text-brand-red">results.</span>
                  </h2>
                  <p className="text-xl md:text-2xl text-white/60 max-w-2xl mx-auto">
                    The room you sit in determines everything about your trajectory.
                  </p>
                </div>

                <div className="grid md:grid-cols-2 gap-12 mb-32 items-center">
                  <div className="relative h-[500px] rounded-3xl overflow-hidden order-2 md:order-1">
                    <img 
                      src="https://images.unsplash.com/photo-1543269865-cbf427effbad?auto=format&fit=crop&q=80&w=800" 
                      alt="Business handshake" 
                      className="w-full h-full object-cover grayscale opacity-50"
                      referrerPolicy="no-referrer"
                    />
                    <div className="absolute inset-0 bg-brand-red/10 mix-blend-overlay" />
                    <div className="absolute bottom-8 left-8 right-8">
                      <p className="text-sm uppercase tracking-widest font-bold text-brand-red mb-2">The Result</p>
                      <p className="text-2xl font-display uppercase tracking-tighter">Strategic Alignment</p>
                    </div>
                  </div>

                  <div className="glass-card p-12 rounded-3xl order-1 md:order-2">
                    <h4 className="text-xs uppercase tracking-[0.3em] text-brand-red mb-8 font-bold">The Environment Effect</h4>
                    <ul className="space-y-6">
                      {[
                        "The level of conversations you have",
                        "The quality of referrals you receive",
                        "The partnerships you form",
                        "The ideas you discover"
                      ].map((item, i) => (
                        <li key={i} className="flex items-center gap-4 text-xl font-medium">
                          <CheckCircle2 className="text-brand-red w-6 h-6 shrink-0" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="flex flex-col justify-center gap-8">
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
                    className="group relative px-12 py-5 bg-brand-red text-white font-display text-2xl uppercase tracking-wider rounded-full overflow-hidden transition-transform hover:scale-105 active:scale-95 cursor-pointer"
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
            <section className="py-32 px-6 bg-white text-black">
              <div className="max-w-7xl mx-auto">
                <div className="grid lg:grid-cols-2 gap-20 items-end mb-20">
                  <div>
                    <h2 className="font-display text-6xl md:text-8xl uppercase tracking-tighter leading-[0.9]">
                      This is not <br />
                      just an <span className="text-brand-red">event.</span>
                    </h2>
                  </div>
                  <div className="pb-4">
                    <p className="text-2xl md:text-3xl font-light leading-tight">
                      This is a room <span className="font-bold">designed for business.</span> No fluff. No jargon. Just outcomes.
                    </p>
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
                  <div className="relative h-full min-h-[300px] rounded-3xl overflow-hidden hidden lg:block">
                    <img 
                      src="https://images.unsplash.com/photo-1556761175-4b46a572b786?auto=format&fit=crop&q=80&w=800" 
                      alt="Business meeting" 
                      className="w-full h-full object-cover grayscale opacity-40"
                      referrerPolicy="no-referrer"
                    />
                    <div className="absolute inset-0 bg-gradient-to-br from-brand-red/20 to-transparent" />
                  </div>
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
                    className="group relative px-12 py-5 bg-brand-red text-white font-display text-2xl uppercase tracking-wider rounded-full overflow-hidden transition-transform hover:scale-105 active:scale-95 cursor-pointer"
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
            <section className="py-32 px-6 bg-zinc-900 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-full opacity-5 pointer-events-none">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full bg-[radial-gradient(circle,rgba(227,30,36,0.2)_0%,transparent_70%)]" />
              </div>
              
              <div className="max-w-5xl mx-auto text-center">
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                >
                  <h2 className="text-xs uppercase tracking-[0.4em] text-brand-red font-bold mb-8">The Consequence</h2>
                  <h3 className="font-display text-5xl md:text-7xl uppercase tracking-tighter mb-12">
                    What happens if you <br /><span className="text-stroke">miss the room?</span>
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
                        className="group relative px-12 py-5 bg-brand-red text-white font-display text-2xl uppercase tracking-wider rounded-full overflow-hidden transition-transform hover:scale-105 active:scale-95 cursor-pointer shrink-0"
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
            <section className="py-40 px-6 text-center relative overflow-hidden">
              <div className="absolute inset-0 z-0 opacity-30">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1000px] h-[1000px] bg-brand-red/10 rounded-full blur-[150px]" />
              </div>

              <div className="relative z-10 max-w-4xl mx-auto">
                <h2 className="font-display text-7xl md:text-9xl uppercase tracking-tighter mb-4">
                  Still looking?
                </h2>
                
                <div className="my-12">
                  <p className="text-2xl md:text-3xl font-light opacity-50 mb-4 italic">Pause.</p>
                  <h3 className="text-3xl md:text-5xl font-semibold tracking-tight">
                    Or ready to be in the <span className="text-brand-red">right room?</span>
                  </h3>
                </div>

                <div className="pt-8">
                  <button 
                    onClick={() => setView("register")}
                    className="group relative px-16 py-6 bg-brand-red text-white font-display text-3xl uppercase tracking-wider rounded-full overflow-hidden transition-all hover:scale-110 hover:shadow-[0_0_50px_rgba(227,30,36,0.4)] active:scale-95 cursor-pointer"
                  >
                    <span className="relative z-10 flex items-center gap-4">
                      Be in the Right Room <ArrowRight className="w-8 h-8 group-hover:translate-x-2 transition-transform" />
                    </span>
                    <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
                  </button>
                  <div className="mt-8 space-y-2">
                    <p className="text-lg font-medium text-white/80">Stop looking. Start finding.</p>
                    <p className="text-xs uppercase tracking-[0.4em] opacity-30">IBMC 2026 • June 17-18 • NPAT, Pasay City</p>
                  </div>
                </div>
              </div>
            </section>

            {/* Footer */}
            <footer className="py-12 px-6 border-t border-white/10 text-center text-white/40 text-sm">
              <p>© 2026 International Business Matching Conference. All rights reserved.</p>
            </footer>
          </motion.div>
        )}

        {view === "register" && (
          <motion.div
            key="register"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.05 }}
            className="min-h-screen flex items-center justify-center p-6 bg-zinc-950"
          >
            <div className="w-full max-w-xl">
              <div className="flex justify-between items-center mb-12">
                <div className="flex items-center gap-2">
                  <span className="font-display text-2xl tracking-tighter text-brand-red">IBMC</span>
                  <span className="text-xs font-bold tracking-[0.2em] opacity-50 uppercase">2026</span>
                </div>
                <button 
                  onClick={() => setView("landing")}
                  className="p-2 hover:bg-white/10 rounded-full transition-colors cursor-pointer"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="mb-10">
                <h2 className="font-display text-5xl uppercase tracking-tighter mb-2">Secure Your Seat</h2>
                <p className="text-white/60">Fill in your details to join the room.</p>
              </div>

              <form onSubmit={handleRegister} className="space-y-6">
                <div className="space-y-4">
                  <div className="relative">
                    <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/30" />
                    <input 
                      required
                      type="text" 
                      placeholder="Full Name" 
                      className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 pl-12 pr-4 focus:outline-none focus:border-brand-red focus:ring-1 focus:ring-brand-red transition-all"
                    />
                  </div>
                  <div className="relative">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/30" />
                    <input 
                      required
                      type="email" 
                      placeholder="Email Address" 
                      className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 pl-12 pr-4 focus:outline-none focus:border-brand-red focus:ring-1 focus:ring-brand-red transition-all"
                    />
                  </div>
                  <div className="relative">
                    <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/30" />
                    <input 
                      required
                      type="tel" 
                      placeholder="Mobile Number" 
                      className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 pl-12 pr-4 focus:outline-none focus:border-brand-red focus:ring-1 focus:ring-brand-red transition-all"
                    />
                  </div>
                </div>

                <div className="pt-4">
                  <label className="block text-xs uppercase tracking-widest text-white/40 mb-4 font-bold">Payment Method (Mockup)</label>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 rounded-2xl border-2 border-brand-red bg-brand-red/5 flex flex-col items-center gap-2 cursor-pointer transition-all">
                      <CreditCard className="w-6 h-6 text-brand-red" />
                      <span className="text-sm font-semibold">Credit Card</span>
                    </div>
                    <div className="p-4 rounded-2xl border border-white/10 bg-white/5 flex flex-col items-center gap-2 opacity-50 cursor-not-allowed">
                      <Handshake className="w-6 h-6" />
                      <span className="text-sm font-semibold">Bank Transfer</span>
                    </div>
                  </div>
                </div>

                <button 
                  type="submit"
                  className="w-full py-5 bg-brand-red text-white font-display text-xl uppercase tracking-wider rounded-2xl hover:bg-red-600 transition-all active:scale-[0.98] cursor-pointer mt-8"
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
            className="min-h-screen flex items-center justify-center p-6 bg-black"
          >
            <div className="max-w-xl text-center">
              <div className="w-24 h-24 bg-brand-red/20 rounded-full flex items-center justify-center mx-auto mb-8">
                <CheckCircle2 className="w-12 h-12 text-brand-red" />
              </div>
              <h2 className="font-display text-6xl uppercase tracking-tighter mb-6">See you in <br /><span className="text-brand-red">the room.</span></h2>
              <p className="text-xl text-white/60 mb-12">Your registration is complete. We've sent a confirmation to your email with the next steps.</p>
              
              <div className="glass-card p-8 rounded-3xl text-left mb-12">
                <h4 className="text-xs uppercase tracking-widest text-brand-red font-bold mb-6">Next Steps</h4>
                <ul className="space-y-4">
                  <li className="flex items-start gap-3">
                    <div className="w-5 h-5 rounded-full bg-brand-red/20 flex items-center justify-center text-[10px] font-bold text-brand-red shrink-0 mt-0.5">1</div>
                    <p className="text-white/80">Check your inbox for the welcome kit.</p>
                  </li>
                  <li className="flex items-start gap-3">
                    <div className="w-5 h-5 rounded-full bg-brand-red/20 flex items-center justify-center text-[10px] font-bold text-brand-red shrink-0 mt-0.5">2</div>
                    <p className="text-white/80">Add the event to your calendar (June 17-18, 2026).</p>
                  </li>
                  <li className="flex items-start gap-3">
                    <div className="w-5 h-5 rounded-full bg-brand-red/20 flex items-center justify-center text-[10px] font-bold text-brand-red shrink-0 mt-0.5">3</div>
                    <p className="text-white/80">Prepare your business profile for matching.</p>
                  </li>
                </ul>
              </div>

              <button 
                onClick={() => setView("landing")}
                className="text-white/40 hover:text-white transition-colors text-sm uppercase tracking-widest font-bold cursor-pointer"
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
