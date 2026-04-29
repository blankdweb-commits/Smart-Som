import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence, useScroll, useTransform, useMotionValueEvent, useMotionTemplate } from 'framer-motion';
import {
  ShieldCheck,
  Zap,
  Star,
  ArrowRight,
  Lock,
  Key,
  CreditCard,
  Sparkles,
  CheckCircle2,
  ChevronDown,
  Clock,
  TrendingUp,
  BookOpen,
  Calendar,
  Users,
  Shield,
  AlertCircle,
  Timer,
  Trophy,
  Target,
  Award
} from '../components/Icons';
import { useAppContext } from '../context/AppContext';
import MoonScene from '../components/MoonScene';

const Landing = () => {
  const { updateProfile } = useAppContext();
  const [activationMode, setActivationMode] = useState(false);
  const [productKey, setProductKey] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState('');
  const [slotsRemaining, setSlotsRemaining] = useState(10);

  const { scrollYProgress } = useScroll();
  const [scrollVal, setScrollVal] = useState(0);

  useMotionValueEvent(scrollYProgress, "change", (latest) => {
    setScrollVal(latest);
  });

  // Simulated urgency
  useEffect(() => {
    const timer = setInterval(() => {
      setSlotsRemaining(prev => prev > 3 ? prev - (Math.random() > 0.8 ? 1 : 0) : prev);
    }, 15000);
    return () => clearInterval(timer);
  }, []);

  const glowOpacity = useTransform(scrollYProgress, [0.8, 1], [0, 1]);
  const blurValue = useTransform(scrollYProgress, [0, 0.1], [0, 4]);
  const moonBlur = useMotionTemplate`blur(${blurValue}px)`;

  const handleActivate = async (e) => {
    e.preventDefault();
    if (productKey.length < 8) {
      setError('Invalid Product Key format.');
      return;
    }
    setIsVerifying(true);
    await new Promise(r => setTimeout(r, 2000));
    updateProfile({ isActivated: true });
    setIsVerifying(false);
  };

  const steps = [
    {
      title: "Clarity",
      desc: "Stop memorizing and start understanding with visual clinical breakdowns.",
      color: "text-slate-400",
      icon: <Target />,
      phase: "Phase 1",
      detail: "Ending Confusion"
    },
    {
      title: "Precision",
      desc: "100% curriculum aligned. We only teach what you actually need for exams.",
      color: "text-indigo-400",
      icon: <Zap />,
      phase: "Phase 2",
      detail: "Smart Focus"
    },
    {
      title: "Mastery",
      desc: "Our AI algorithm identifies weak spots and fixes them in real-time.",
      color: "text-emerald-400",
      icon: <Award />,
      phase: "Phase 3",
      detail: "Confidence"
    },
    {
      title: "Success",
      desc: "Join 10,000+ nursing students who passed with absolute distinction.",
      color: "text-white",
      icon: <Trophy />,
      phase: "Phase 4",
      detail: "The Apex"
    }
  ];

  const floatingFeatures = [
    { icon: <Zap size={14} />, text: "7,000+ Flashcards" },
    { icon: <Clock size={14} />, text: "Real-time Exam Alerts" },
    { icon: <BookOpen size={14} />, text: "AI Past Question Parser" },
    { icon: <Shield size={14} />, text: "Official Payment Hub" },
    { icon: <Users size={14} />, text: "Clinical Community" }
  ];

  return (
    <div className="min-h-screen bg-[#020617] overflow-x-hidden selection:bg-medical-500 selection:text-white">
      {/* 3D Journey Background */}
      <motion.div
        style={{ filter: moonBlur }}
        className="fixed inset-0 z-0 overflow-hidden pointer-events-none"
      >
        <MoonScene scrollProgress={scrollVal} />
        <motion.div
          style={{ opacity: glowOpacity }}
          className="absolute top-0 left-0 w-full h-screen bg-gradient-to-b from-medical-500/10 to-transparent blur-3xl"
        />
      </motion.div>

      <div className="relative z-10">
        {/* Hero Section */}
        <section className="min-h-[100dvh] flex flex-col items-center justify-center p-6 text-center space-y-12">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            whileInView={{ scale: 1, opacity: 1 }}
            viewport={{ once: true }}
            className="w-20 h-20 bg-white rounded-3xl shadow-2xl flex items-center justify-center text-slate-950 font-black text-3xl mb-4"
          >
            A
          </motion.div>

          <div className="space-y-6 max-w-4xl px-4">
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              whileInView={{ y: 0, opacity: 1 }}
              viewport={{ once: true }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 backdrop-blur-md border border-white/10"
            >
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/80">From Doubt to Distinction</span>
            </motion.div>

            <motion.h1
              initial={{ y: 20, opacity: 0 }}
              whileInView={{ y: 0, opacity: 1 }}
              viewport={{ once: true }}
              className="text-6xl md:text-8xl lg:text-9xl font-black text-white tracking-tighter leading-[0.85] text-balance"
            >
              Pass <span className="text-medical-500">with</span> <br/>
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-white via-slate-300 to-white/50">Confidence.</span>
            </motion.h1>

            <motion.p
              initial={{ y: 20, opacity: 0 }}
              whileInView={{ y: 0, opacity: 1 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
              className="text-xl md:text-2xl text-slate-400 font-bold max-w-2xl mx-auto leading-tight"
            >
              Move from stress and confusion to clarity, mastery, and professional nursing success.
            </motion.p>
          </div>

          <motion.div
             initial={{ y: 20, opacity: 0 }}
             whileInView={{ y: 0, opacity: 1 }}
             viewport={{ once: true }}
             transition={{ delay: 0.2 }}
             className="flex flex-col sm:flex-row gap-5 w-full max-w-md px-4"
          >
            <button
              onClick={() => document.getElementById('pricing').scrollIntoView({ behavior: 'smooth' })}
              className="flex-[2] py-6 bg-white text-slate-950 rounded-3xl font-black uppercase tracking-[0.2em] text-[10px] shadow-2xl active:scale-95 transition-all flex items-center justify-center gap-3"
            >
              Get Started Now <ArrowRight size={16} />
            </button>
            <button
              onClick={() => setActivationMode(true)}
              className="flex-1 py-6 bg-white/5 backdrop-blur-md text-white rounded-3xl font-black uppercase tracking-[0.2em] text-[10px] shadow-soft border border-white/10 active:scale-95 transition-all"
            >
              Enter Key
            </button>
          </motion.div>

          <motion.div
            animate={{ y: [0, 10, 0] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="absolute bottom-10 left-1/2 -translate-x-1/2 text-white/30"
          >
            <ChevronDown size={32} />
          </motion.div>
        </section>

        {/* Eclipse Journey Section */}
        <section className="py-64 px-6">
          <div className="max-w-4xl mx-auto space-y-[60vh]">
            {steps.map((step, i) => (
              <motion.div
                key={i}
                initial={{ y: 100, opacity: 0 }}
                whileInView={{ y: 0, opacity: 1 }}
                viewport={{ margin: "-100px" }}
                className={`flex flex-col ${i % 2 === 0 ? 'md:flex-row' : 'md:flex-row-reverse'} items-center gap-20`}
              >
                <div className="relative">
                   <div className="w-48 h-48 bg-white/5 backdrop-blur-3xl rounded-[4rem] shadow-2xl flex items-center justify-center text-5xl text-white border border-white/10 relative z-10 transition-transform hover:scale-105 duration-500">
                      {step.icon}
                   </div>
                   <motion.div
                    animate={{ y: [0, -15, 0] }}
                    transition={{ duration: 4, repeat: Infinity, delay: i * 0.7 }}
                    className={`absolute ${i % 2 === 0 ? '-right-16' : '-left-16'} -top-8 flex flex-col gap-4 z-20`}
                   >
                      <div className="bg-white/10 backdrop-blur-xl px-6 py-3 rounded-2xl shadow-xl border border-white/10 whitespace-nowrap">
                         <p className={`text-[10px] font-black uppercase tracking-[0.3em] ${step.color}`}>{step.detail}</p>
                      </div>
                   </motion.div>
                </div>

                <div className={`text-center ${i % 2 === 0 ? 'md:text-left' : 'md:text-right'} space-y-6 flex-1`}>
                  <div className="space-y-3">
                    <p className="text-medical-500 font-black text-[10px] uppercase tracking-[0.5em]">{step.phase}</p>
                    <h3 className={`text-6xl font-black ${step.color} tracking-tighter leading-none`}>{step.title}</h3>
                  </div>
                  <p className="text-2xl text-slate-400 font-bold leading-tight">{step.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </section>

        {/* Global Features Marquee */}
        <div className="py-24 overflow-hidden relative border-y border-white/5 bg-white/5 backdrop-blur-md">
           <div className="flex gap-10 items-center animate-infinite-scroll">
              {[...floatingFeatures, ...floatingFeatures, ...floatingFeatures].map((f, idx) => (
                <div key={idx} className="flex items-center gap-4 px-8 py-4 bg-white/5 rounded-3xl shadow-soft border border-white/10 shrink-0">
                   <div className="text-medical-500">{f.icon}</div>
                   <span className="text-xs font-black text-white uppercase tracking-[0.2em]">{f.text}</span>
                </div>
              ))}
           </div>
        </div>

        {/* Pricing Funnel */}
        <section id="pricing" className="py-64 px-6 relative">
           <div className="max-w-md mx-auto bg-white rounded-[4rem] shadow-2xl overflow-hidden relative">
              <div className="bg-slate-950 p-10 text-white text-center space-y-4">
                 <div className="flex flex-col items-center gap-2">
                    <span className="px-4 py-2 bg-amber-100 text-amber-700 rounded-full text-[10px] font-black uppercase tracking-widest flex items-center gap-2">
                      <Timer size={12} /> Ends in 7 Days
                    </span>
                    <span className="text-[10px] font-bold text-red-500 uppercase tracking-widest animate-pulse">
                      {slotsRemaining} slots remaining
                    </span>
                 </div>
                 <h3 className="text-5xl font-black tracking-tighter">Claim Your Future</h3>
              </div>

              <div className="p-12 space-y-10 text-center">
                 <div className="space-y-2">
                    <p className="text-slate-400 font-black text-xs line-through tracking-[0.2em] uppercase">Formerly ₦3,000</p>
                    <div className="flex flex-col items-center justify-center gap-1">
                       <span className="text-7xl font-black text-slate-900 tracking-tighter">₦1,999.9</span>
                       <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mt-2">7 Days Premium Access</span>
                    </div>
                 </div>

                 <div className="space-y-4 text-left">
                    {["Complete 7,200+ Flashcard Library", "AI Past Question Parser & Trainer", "Exam Readiness Prediction", "Clinical Success Roadmap", "Official School Fee Hub"].map(f => (
                      <div key={f} className="flex items-center gap-4 text-sm font-black text-slate-600">
                         <CheckCircle2 size={20} className="text-emerald-500 shrink-0" /> {f}
                      </div>
                    ))}
                 </div>

                 <div className="p-6 bg-slate-50 border border-slate-100 rounded-3xl flex flex-col gap-3 text-left">
                    <div className="flex items-center gap-3">
                       <AlertCircle size={20} className="text-amber-500 shrink-0" />
                       <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest">Subscription Rule</p>
                    </div>
                    <p className="text-xs font-bold text-slate-500 leading-tight">
                      Valid for 7 days. Weekly renewal required for continuous AI access and library sync.
                    </p>
                 </div>

                 <button
                  onClick={() => document.getElementById('activation-section')?.scrollIntoView({ behavior: 'smooth' })}
                  className="w-full py-6 bg-medical-600 text-white rounded-[2rem] font-black uppercase tracking-[0.3em] text-xs shadow-2xl shadow-medical-600/30 hover:bg-medical-700 transition-all active:scale-[0.98]"
                 >
                    Pay ₦1,999.9 & Unlock Access
                 </button>

                 <div className="flex items-center justify-center gap-2 opacity-40">
                   <ShieldCheck size={12} />
                   <p className="text-[9px] text-slate-900 font-black uppercase tracking-[0.2em]">Verified Payment • Instant Activation</p>
                 </div>
              </div>
           </div>
        </section>
      </div>

      {/* Activation Modal / Section */}
      <div id="activation-section" className="py-32 px-6">
        <div className="max-w-md mx-auto bg-white/5 backdrop-blur-3xl rounded-[3rem] border border-white/10 overflow-hidden">
          <div className="p-10 border-b border-white/10 flex justify-between items-center">
            <h3 className="text-2xl font-black text-white uppercase tracking-tighter">Enter Product Key</h3>
            <div className="p-3 text-white/40 rounded-2xl bg-white/5"><Lock size={20} /></div>
          </div>

          <form onSubmit={handleActivate} className="p-12 space-y-10">
              <div className="w-24 h-24 bg-white/5 text-white rounded-[2rem] flex items-center justify-center mx-auto border border-white/10">
                <Key size={48} />
              </div>

              <div className="text-center space-y-3">
                <h4 className="text-2xl font-black text-white uppercase tracking-tighter">Unlock The Apex</h4>
                <p className="text-xs text-white/40 font-bold uppercase tracking-widest">Verify your payment code to begin.</p>
              </div>

              <div className="space-y-6">
                <input
                  type="text"
                  value={productKey}
                  onChange={e => {setProductKey(e.target.value); setError('');}}
                  placeholder="XXXX-XXXX-XXXX"
                  className="w-full text-center tracking-[0.3em] text-xl font-black py-6 bg-white/5 border-2 border-transparent focus:border-medical-500 text-white rounded-3xl outline-none transition-all uppercase placeholder:text-white/10"
                />
                {error && <p className="text-[10px] text-red-500 font-black text-center uppercase tracking-widest animate-bounce">{error}</p>}

                <button
                  disabled={isVerifying}
                  type="submit"
                  className="w-full py-6 bg-white text-slate-950 rounded-3xl font-black uppercase tracking-[0.3em] text-[10px] flex items-center justify-center gap-3 hover:bg-slate-200 active:scale-95 transition-all shadow-xl"
                >
                  {isVerifying ? <Zap size={16} className="animate-spin" /> : 'Begin Transformation'}
                </button>
              </div>

              <button
                type="button"
                onClick={() => document.getElementById('pricing').scrollIntoView({ behavior: 'smooth' })}
                className="w-full text-[9px] font-black text-white/40 uppercase tracking-[0.4em] hover:text-white transition-colors"
              >
                I need a key • Pay ₦1,999.9
              </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Landing;
