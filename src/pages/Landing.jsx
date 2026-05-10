import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ShieldCheck,
  Zap,
  ArrowRight,
  CheckCircle2,
  Clock,
  Trophy,
  Target,
  Award,
  Star,
  Users,
  Lock,
  CreditCard,
  ChevronRight
} from '../components/Icons';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';

const Landing = () => {
  const navigate = useNavigate();
  const { session, userProfile, loadingAuth } = useAppContext();
  const [slotsRemaining, setSlotsRemaining] = useState(12);
  const [timeLeft, setTimeLeft] = useState({ hours: 0, minutes: 45, seconds: 0 });
  const [dynamicTestimonials, setDynamicTestimonials] = useState([]);
  const [isHovered, setIsHovered] = useState(null);

  // Fetch Testimonials from Supabase
  useEffect(() => {
    const fetchTestimonials = async () => {
      const { supabase } = await import('../utils/supabase');
      if (!supabase) return;

      let query = supabase.from('testimonials').select('*');

      if (session && !userProfile?.isActivated) {
        query = query.order('category', { ascending: false });
      } else if (!session) {
        query = query.order('category', { ascending: true });
      }

      const { data } = await query.limit(10);
      if (data) {
        setDynamicTestimonials(data.sort(() => Math.random() - 0.5));
      }
    };
    fetchTestimonials();
  }, [session, userProfile?.isActivated]);

  // Auto-redirect for logged in users
  useEffect(() => {
    if (!loadingAuth && session) {
      if (userProfile?.isActivated) {
        navigate('/dashboard/home');
      } else {
        navigate('/dashboard/activate');
      }
    }
  }, [session, userProfile?.isActivated, loadingAuth, navigate]);

  // Urgency logic
  useEffect(() => {
    const timer = setInterval(() => {
      setSlotsRemaining(prev => prev > 3 ? prev - (Math.random() > 0.8 ? 1 : 0) : prev);
    }, 15000);

    const countdown = setInterval(() => {
      setTimeLeft(prev => {
        if (prev.seconds > 0) return { ...prev, seconds: prev.seconds - 1 };
        if (prev.minutes > 0) return { ...prev, minutes: prev.minutes - 1, seconds: 59 };
        return prev;
      });
    }, 10000);

    return () => {
      clearInterval(timer);
      clearInterval(countdown);
    };
  }, []);

  const features = [
    { title: "Structured Curriculum", desc: "Every topic mapped to official nursing exams.", icon: <Target className="text-apex-400" /> },
    { title: "AI Paper Parser", desc: "Turn your past questions into flashcards instantly.", icon: <Zap className="text-amber-400" /> },
    { title: "Success Strategies", desc: "Clinical mnemonics used by top-tier students.", icon: <Trophy className="text-teal-400" /> },
    { title: "Study Reminders", desc: "Never miss a revision cycle with smart alerts.", icon: <Clock className="text-apex-400" /> }
  ];

  const defaultTestimonials = [
    { name: "Sarah O.", quote: "Passed my professional exams with distinction! The flashcards are a lifesaver.", level: "LUTH Nursing", category: "Success" },
    { name: "Daniel K.", quote: "The AI parser for past questions is magic. Saved me weeks of study prep.", level: "University of Ibadan", category: "Efficiency" }
  ];

  const activeTestimonials = dynamicTestimonials.length > 0 ? dynamicTestimonials : defaultTestimonials;

  return (
    <div className="min-h-screen bg-[#020617] text-white font-sans selection:bg-apex-500/30 overflow-x-hidden">
      {/* Premium Background Effects */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[10%] -left-[10%] w-[40%] h-[40%] bg-apex-600/20 rounded-full blur-[120px] animate-pulse-slow" />
        <div className="absolute top-[20%] -right-[5%] w-[30%] h-[30%] bg-teal-500/10 rounded-full blur-[100px]" />
      </div>

      {/* Sticky Bottom CTA for Mobile */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 p-4 bg-slate-900/80 backdrop-blur-xl border-t border-white/10 z-50">
        <button
          onClick={() => navigate('/signup')}
          className="w-full py-4 bg-apex-600 text-white rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-apex-600/40 active:scale-95 transition-all"
        >
          Unlock Full Access – ₦1999.9
        </button>
      </div>

      {/* Nav */}
      <nav className="relative z-10 p-6 flex justify-between items-center max-w-7xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-apex-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-apex-600/20">
            <span className="font-black text-xl">A</span>
          </div>
          <span className="font-black tracking-tight text-xl bg-clip-text text-transparent bg-gradient-to-r from-white to-white/60">Apex Scholars</span>
        </div>
        <div className="flex items-center gap-6">
          <button
            onClick={() => navigate('/login')}
            className="hidden md:block text-sm font-bold text-white/60 hover:text-white transition-colors"
          >
            Sign In
          </button>
          <button
            onClick={() => navigate('/signup')}
            className="px-6 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-sm font-bold transition-all"
          >
            Get Started
          </button>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative z-10 px-6 pt-20 pb-32 max-w-7xl mx-auto text-center">
        {/* Lunar Eclipse Visual */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] pointer-events-none opacity-20">
           <div className="absolute inset-0 bg-apex-500 rounded-full blur-[100px]" />
           <div className="absolute inset-10 bg-[#020617] rounded-full" />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 mb-8"
        >
          <div className="w-2 h-2 rounded-full bg-apex-500 animate-pulse" />
          <span className="text-[10px] font-black uppercase tracking-widest text-apex-400">Limited student discount active</span>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="text-5xl md:text-8xl font-black tracking-tighter leading-[0.9] mb-8"
        >
          Pass Your Nursing <br className="hidden md:block" />
          Exams <span className="bg-clip-text text-transparent bg-gradient-to-r from-apex-400 to-teal-400">Faster</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="text-lg md:text-2xl text-white/50 font-medium max-w-3xl mx-auto leading-relaxed mb-12"
        >
          Flashcards, exam reminders, and focused study tools built <br className="hidden md:block" /> exclusively for Nigerian nursing students.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="flex flex-col sm:flex-row gap-6 justify-center items-center"
        >
          <button
            onClick={() => navigate('/signup')}
            className="group px-10 py-6 bg-apex-600 text-white rounded-2xl font-black uppercase tracking-widest text-sm shadow-2xl shadow-apex-600/40 hover:bg-apex-500 transition-all flex items-center gap-4 active:scale-95"
          >
            Claim Your Access – ₦1999.9 <ChevronRight size={20} className="group-hover:translate-x-1 transition-transform" />
          </button>
          <div className="flex -space-x-3">
             {[1,2,3,4].map(i => (
               <div key={i} className="w-10 h-10 rounded-full border-2 border-[#020617] bg-slate-800 flex items-center justify-center text-[10px] font-bold">
                 {String.fromCharCode(64 + i)}
               </div>
             ))}
             <div className="w-10 h-10 rounded-full border-2 border-[#020617] bg-apex-600 flex items-center justify-center text-[8px] font-black">
               1K+
             </div>
          </div>
        </motion.div>
      </section>

      {/* Dashboard Preview / Glassmorphism Demo */}
      <section className="px-6 pb-32">
        <div className="max-w-6xl mx-auto relative group">
          <div className="absolute inset-0 bg-apex-500/20 blur-[100px] group-hover:bg-apex-500/30 transition-all duration-700" />
          <div className="relative rounded-[2.5rem] bg-white/5 border border-white/10 backdrop-blur-2xl overflow-hidden shadow-2xl">
             <div className="p-4 border-b border-white/10 flex items-center gap-2">
                <div className="flex gap-1.5">
                   <div className="w-3 h-3 rounded-full bg-red-500/50" />
                   <div className="w-3 h-3 rounded-full bg-amber-500/50" />
                   <div className="w-3 h-3 rounded-full bg-emerald-500/50" />
                </div>
                <div className="mx-auto bg-white/5 px-4 py-1.5 rounded-lg text-[10px] font-bold text-white/40 uppercase tracking-widest">
                  app.apexscholars.ng/dashboard
                </div>
             </div>
             <div className="p-8 md:p-16 aspect-video flex items-center justify-center overflow-hidden">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-6 w-full opacity-60">
                   {[1,2,3,4,5,6].map(i => (
                     <div key={i} className="h-40 bg-white/5 rounded-3xl border border-white/10 animate-pulse" style={{ animationDelay: `${i * 100}ms` }} />
                   ))}
                </div>
                <div className="absolute inset-0 flex items-center justify-center">
                   <div className="text-center space-y-6">
                      <div className="w-20 h-20 bg-apex-600 rounded-[2rem] mx-auto flex items-center justify-center shadow-2xl shadow-apex-600/50">
                         <Zap size={40} />
                      </div>
                      <p className="text-xl font-black tracking-tight">Your Clinical Edge Awaits</p>
                   </div>
                </div>
             </div>
          </div>
        </div>
      </section>

      {/* Flashcard Demo / Carousel */}
      <section className="py-24 px-6 bg-slate-950/50 relative">
        <div className="max-w-7xl mx-auto grid md:grid-cols-2 gap-16 items-center">
           <div className="space-y-8">
              <h2 className="text-4xl md:text-6xl font-black tracking-tight">Master 7,200+ <br />Medical Cards</h2>
              <p className="text-white/50 text-lg md:text-xl leading-relaxed">
                Our database covers every semester from Year 1 to Year 3.
                Smart spaced-repetition ensures you remember the hardest terms
                long after the exam is over.
              </p>
              <div className="grid grid-cols-2 gap-4">
                 <div className="p-6 rounded-3xl bg-white/5 border border-white/10">
                    <p className="text-3xl font-black text-apex-400">98%</p>
                    <p className="text-xs font-bold text-white/30 uppercase tracking-widest">Pass Rate</p>
                 </div>
                 <div className="p-6 rounded-3xl bg-white/5 border border-white/10">
                    <p className="text-3xl font-black text-teal-400">24/7</p>
                    <p className="text-xs font-bold text-white/30 uppercase tracking-widest">AI Support</p>
                 </div>
              </div>
           </div>

           <div className="relative group cursor-pointer" onClick={() => navigate('/signup')}>
              <div className="absolute inset-0 bg-gradient-to-br from-apex-600/20 to-teal-500/20 blur-[60px] opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative p-10 bg-white rounded-[3rem] text-slate-900 space-y-8 shadow-2xl transform group-hover:-rotate-2 transition-transform">
                 <div className="flex justify-between items-center">
                    <span className="px-3 py-1 bg-slate-100 rounded-full text-[10px] font-black uppercase tracking-widest text-slate-400">Flashcard #204</span>
                    <span className="text-[10px] font-black text-apex-600 uppercase tracking-widest">Anatomy & Phys</span>
                 </div>
                 <h3 className="text-2xl font-black leading-tight min-h-[100px]">
                   Identify the 3 primary branches of the Celiac Trunk?
                 </h3>
                 <div className="pt-6 border-t border-slate-100 flex justify-between items-center text-[10px] font-black uppercase tracking-widest text-slate-400">
                    <span>Tap to reveal answer</span>
                    <ArrowRight size={14} />
                 </div>
              </div>
           </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-32 px-6 max-w-7xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((f, i) => (
            <div
              key={i}
              onMouseEnter={() => setIsHovered(i)}
              onMouseLeave={() => setIsHovered(null)}
              className="group p-8 rounded-[2.5rem] bg-white/5 border border-white/10 hover:bg-white/[0.08] hover:border-white/20 transition-all duration-300 relative overflow-hidden"
            >
              <div className="absolute -right-4 -bottom-4 opacity-5 group-hover:scale-110 transition-transform text-white">
                {f.icon}
              </div>
              <div className="w-14 h-14 bg-white/5 rounded-2xl flex items-center justify-center mb-8 group-hover:scale-110 transition-transform">
                {f.icon}
              </div>
              <h3 className="text-xl font-black mb-4">{f.title}</h3>
              <p className="text-white/40 text-sm font-medium leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing Section (High Conversion) */}
      <section className="py-24 px-6 max-w-4xl mx-auto text-center">
        <div className="relative p-12 md:p-24 rounded-[4rem] bg-gradient-to-b from-white/10 to-white/5 border border-white/20 overflow-hidden shadow-2xl">
           <div className="absolute -top-32 -left-32 w-64 h-64 bg-apex-500/20 blur-[80px]" />
           <div className="absolute -bottom-32 -right-32 w-64 h-64 bg-teal-500/20 blur-[80px]" />

           <div className="relative z-10 space-y-12">
              <div className="space-y-4">
                 <h2 className="text-4xl md:text-7xl font-black tracking-tighter">Become a Scholar</h2>
                 <p className="text-white/40 font-bold uppercase tracking-widest text-xs italic">Premium access includes everything</p>
              </div>

              <div className="flex flex-col md:flex-row items-center justify-center gap-8 md:gap-16 py-8">
                 <div className="text-left space-y-4">
                    {[
                      "7,200+ Curated Flashcards",
                      "Unlimited Past Question Uploads",
                      "AI-Powered Answer Explainer",
                      "Course-Specific Exam Timetables",
                      "Community Study Groups"
                    ].map((item, idx) => (
                      <div key={idx} className="flex items-center gap-3 text-sm font-bold text-white/80">
                        <CheckCircle2 size={18} className="text-teal-400" />
                        {item}
                      </div>
                    ))}
                 </div>

                 <div className="p-10 rounded-[3rem] bg-white text-slate-900 shadow-2xl transform rotate-2">
                    <div className="space-y-2 mb-6 text-center">
                       <span className="text-sm font-black text-slate-300 line-through">₦3,000</span>
                       <div className="text-6xl font-black tracking-tighter text-apex-600 leading-none">₦1999.9</div>
                       <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Per 30-Day Cycle</p>
                    </div>
                    <button
                      onClick={() => navigate('/signup')}
                      className="w-full py-4 bg-apex-600 text-white rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-apex-700 transition-all active:scale-95 shadow-xl shadow-apex-600/30"
                    >
                      Start Studying
                    </button>
                 </div>
              </div>

              <div className="pt-8 border-t border-white/10 flex flex-col items-center gap-6">
                 <div className="flex items-center gap-8 opacity-40">
                    <div className="flex items-center gap-2">
                       <Lock size={14} />
                       <span className="text-[10px] font-black uppercase tracking-widest">SSL Secured</span>
                    </div>
                    <div className="flex items-center gap-2">
                       <CreditCard size={14} />
                       <span className="text-[10px] font-black uppercase tracking-widest">Paystack Verified</span>
                    </div>
                 </div>
                 <div className="space-y-2">
                   <div className="flex items-center justify-center gap-2 text-red-400 font-black uppercase tracking-[0.2em] text-[10px] animate-pulse">
                      <Clock size={14} />
                      Only {slotsRemaining} spots remaining at this price
                   </div>
                   <p className="text-white/20 text-[10px] font-bold">Renewal reminders sent 3 days before expiry</p>
                 </div>
              </div>
           </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-32 px-6">
        <div className="max-w-7xl mx-auto space-y-16 text-center">
           <div className="space-y-4">
              <h2 className="text-4xl md:text-6xl font-black tracking-tight">Student Success Stories</h2>
              <div className="flex items-center justify-center gap-4 text-apex-400 font-black uppercase tracking-widest text-xs">
                 <Star size={16} fill="currentColor" />
                 4.9/5 RATING FROM NURSES
                 <Star size={16} fill="currentColor" />
              </div>
           </div>

           <div className="flex overflow-x-auto gap-6 pb-8 no-scrollbar snap-x">
              {activeTestimonials.map((t, i) => (
                <div
                  key={i}
                  className="min-w-[300px] md:min-w-[400px] p-8 rounded-[3rem] bg-white/5 border border-white/10 backdrop-blur-xl snap-center space-y-6 text-left"
                >
                   <div className="flex gap-1 text-amber-400">
                      {[1,2,3,4,5].map(s => <Star key={s} size={12} fill="currentColor" />)}
                   </div>
                   <p className="text-lg font-bold text-white/80 leading-relaxed italic">"{t.quote}"</p>
                   <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-apex-600 rounded-2xl flex items-center justify-center font-black text-xl shadow-lg">
                        {t.name.charAt(0)}
                      </div>
                      <div>
                         <p className="font-black text-sm flex items-center gap-2">
                           {t.name}
                           <ShieldCheck size={14} className="text-teal-400" />
                         </p>
                         <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest">{t.level}</p>
                      </div>
                   </div>
                </div>
              ))}
           </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-20 px-6 border-t border-white/5 relative z-10">
         <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-12">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-apex-600 rounded-lg flex items-center justify-center text-white">
                <span className="font-black text-sm">A</span>
              </div>
              <span className="font-black tracking-tight text-lg">Apex Scholars</span>
            </div>

            <div className="flex gap-8 text-[10px] font-black uppercase tracking-widest text-white/30">
               <a href="#" className="hover:text-white transition-colors">Privacy Policy</a>
               <a href="#" className="hover:text-white transition-colors">Terms of Service</a>
               <a href="#" className="hover:text-white transition-colors">Support</a>
            </div>

            <p className="text-[10px] font-bold text-white/10 uppercase tracking-widest">
              © 2024 Institutional Productivity Hub
            </p>
         </div>
      </footer>
    </div>
  );
};

export default Landing;
