import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence, useScroll, useTransform } from 'framer-motion';
import { ShieldCheck, Zap, Star, ArrowRight, Lock, Key, CreditCard, Sparkles, CheckCircle2, ChevronDown, Clock, TrendingUp, BookOpen, Calendar, Users, Shield, AlertCircle } from '../components/Icons';
import { useAppContext } from '../context/AppContext';
import TreeScene from '../components/TreeScene';

const Landing = () => {
  const { updateProfile } = useAppContext();
  const [activationMode, setActivationMode] = useState(false);
  const [productKey, setProductKey] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState('');

  const { scrollYProgress } = useScroll();
  const [scrollVal, setScrollVal] = useState(0);

  useEffect(() => {
    return scrollYProgress.onChange(v => setScrollVal(v));
  }, [scrollYProgress]);

  const glowOpacity = useTransform(scrollYProgress, [0.8, 1], [0, 1]);

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
    { title: "Foundations", desc: "Every great nurse starts from the roots.", color: "text-slate-500", icon: "🌱", detail: "Exam Fear" },
    { title: "Growth", desc: "Daily revision builds strength.", color: "text-amber-700", icon: "🪵", detail: "Consistency" },
    { title: "Mastery", desc: "Knowledge expands with every session.", color: "text-emerald-600", icon: "🌿", detail: "Retention" },
    { title: "Apex", desc: "Rise to the Apex.", color: "text-apex-600", icon: "👑", detail: "Success" }
  ];

  const floatingFeatures = [
    { icon: <Zap size={14} />, text: "5,000+ Questions" },
    { icon: <Clock size={14} />, text: "Exam Alerts" },
    { icon: <BookOpen size={14} />, text: "Flashcards" },
    { icon: <Shield size={14} />, text: "Clinical Revision" },
    { icon: <Users size={14} />, text: "Trusted by Students" }
  ];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 overflow-x-hidden selection:bg-apex-100 selection:text-apex-900">
      {/* 3D Journey Background */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <TreeScene scrollProgress={scrollVal} />
        <motion.div
          style={{ opacity: glowOpacity }}
          className="absolute top-0 left-0 w-full h-screen bg-gradient-to-b from-apex-500/20 to-transparent blur-3xl"
        />
      </div>

      <div className="relative z-10">
        {/* Hero Section */}
        <section className="min-h-screen flex flex-col items-center justify-center p-6 text-center space-y-8">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="w-20 h-20 bg-apex-600 rounded-[2rem] shadow-apex-glow flex items-center justify-center text-white font-black text-3xl mb-4"
          >
            A
          </motion.div>

          <div className="space-y-4 max-w-3xl">
            <motion.h1
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              className="text-5xl md:text-7xl font-black text-slate-900 dark:text-white tracking-tighter leading-tight"
            >
              Pass Nursing Exams Faster. <span className="text-apex-600">Build Real Clinical Confidence.</span>
            </motion.h1>
            <motion.p
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.1 }}
              className="text-lg md:text-xl text-slate-500 dark:text-slate-400 font-medium max-w-2xl mx-auto"
            >
              Apex Scholars helps nursing students revise smarter with flashcards, exam alerts, question banks, and focused study systems.
            </motion.p>
          </div>

          <motion.div
             initial={{ y: 20, opacity: 0 }}
             animate={{ y: 0, opacity: 1 }}
             transition={{ delay: 0.2 }}
             className="flex flex-col sm:flex-row gap-4 w-full max-w-md"
          >
            <button
              onClick={() => document.getElementById('pricing').scrollIntoView({ behavior: 'smooth' })}
              className="flex-[2] py-5 bg-apex-600 hover:bg-apex-700 text-white rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-apex-600/20 active:scale-95 transition-all flex items-center justify-center gap-2"
            >
              Join Apex Scholars Today <ArrowRight size={16} />
            </button>
            <button
              onClick={() => setActivationMode(true)}
              className="flex-1 py-5 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-2xl font-black uppercase tracking-widest text-xs shadow-soft border border-slate-100 dark:border-slate-700 active:scale-95 transition-all"
            >
              Activate Key
            </button>
          </motion.div>

          <motion.div
            animate={{ y: [0, 10, 0] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="absolute bottom-10 left-1/2 -translate-x-1/2 text-slate-300"
          >
            <ChevronDown size={32} />
          </motion.div>
        </section>

        {/* Tree Journey Section */}
        <section className="py-32 px-6">
          <div className="max-w-4xl mx-auto space-y-96">
            {steps.map((step, i) => (
              <motion.div
                key={i}
                initial={{ x: i % 2 === 0 ? -50 : 50, opacity: 0 }}
                whileInView={{ x: 0, opacity: 1 }}
                viewport={{ margin: "-200px" }}
                className={`flex flex-col ${i % 2 === 0 ? 'md:flex-row' : 'md:flex-row-reverse'} items-center gap-16`}
              >
                <div className="relative">
                   <div className="w-40 h-40 bg-white/10 backdrop-blur-3xl dark:bg-slate-800/30 rounded-[3rem] shadow-3d-glass flex items-center justify-center text-6xl border border-white/20 dark:border-slate-700 relative z-10">
                      {step.icon}
                   </div>
                   {/* Floating Feature Tags */}
                   <motion.div
                    animate={{ y: [0, -10, 0] }}
                    transition={{ duration: 3, repeat: Infinity, delay: i * 0.5 }}
                    className={`absolute ${i % 2 === 0 ? '-right-20' : '-left-20'} top-0 flex flex-col gap-3`}
                   >
                      <div className="bg-white dark:bg-slate-800 px-4 py-2 rounded-xl shadow-lg border border-slate-100 dark:border-slate-700 whitespace-nowrap">
                         <p className={`text-[10px] font-black uppercase tracking-widest ${step.color}`}>{step.detail}</p>
                      </div>
                      {i === 3 && (
                        <div className="bg-apex-600 px-4 py-2 rounded-xl shadow-lg shadow-apex-500/30 text-white whitespace-nowrap">
                          <p className="text-[10px] font-black uppercase tracking-widest flex items-center gap-1"><Sparkles size={12} /> Apex Level</p>
                        </div>
                      )}
                   </motion.div>
                </div>

                <div className={`text-center ${i % 2 === 0 ? 'md:text-left' : 'md:text-right'} space-y-6 flex-1`}>
                  <div className="space-y-2">
                    <p className="text-apex-500 font-black text-xs uppercase tracking-[0.4em]">Section {i+1}</p>
                    <h3 className={`text-5xl font-black ${step.color} tracking-tighter leading-tight`}>{step.title}</h3>
                  </div>
                  <p className="text-2xl text-slate-500 dark:text-slate-400 font-medium leading-relaxed">{step.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </section>

        {/* Global Features Marquee-like section */}
        <div className="py-20 overflow-hidden relative border-y border-slate-100 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 backdrop-blur-sm">
           <div className="flex gap-8 items-center animate-infinite-scroll">
              {[...floatingFeatures, ...floatingFeatures, ...floatingFeatures].map((f, idx) => (
                <div key={idx} className="flex items-center gap-3 px-6 py-3 bg-white dark:bg-slate-800 rounded-2xl shadow-soft border border-slate-100 dark:border-slate-700 shrink-0">
                   <div className="text-apex-600">{f.icon}</div>
                   <span className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-widest">{f.text}</span>
                </div>
              ))}
           </div>
        </div>

        {/* Pain to Success Conversion */}
        <section className="py-32 bg-slate-900 text-white overflow-hidden relative">
          <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-2 gap-20 items-center">
             <div className="space-y-12">
                <h2 className="text-4xl md:text-6xl font-black tracking-tight leading-tight">Stop reading just to <span className="text-red-500">forget.</span></h2>
                <div className="space-y-6">
                   {[
                     "Reading but forgetting quickly",
                     "Exam date getting close",
                     "Too many courses to revise",
                     "Fear of carryover"
                   ].map(text => (
                     <div key={text} className="flex items-center gap-4 text-slate-400 font-bold">
                        <div className="w-6 h-6 rounded-full border-2 border-red-500/30 flex items-center justify-center text-red-500">×</div>
                        {text}
                     </div>
                   ))}
                </div>
             </div>
             <div className="bg-white/5 backdrop-blur-2xl rounded-[3rem] p-10 border border-white/10 space-y-10">
                <h3 className="text-3xl font-black text-apex-400">The Apex Solution</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                   {[
                     { t: "Structured Flashcards", d: "Logic-based recall", i: <Zap /> },
                     { t: "Timed Reminders", d: "Never miss a test", i: <Clock /> },
                     { t: "Smarter Revision", d: "High-yield focus", i: <Star /> },
                     { t: "Total Confidence", d: "Enter exam Hall ready", i: <ShieldCheck /> }
                   ].map(item => (
                     <div key={item.t} className="p-6 bg-white/5 rounded-2xl border border-white/5 space-y-3">
                        <div className="text-apex-400">{item.i}</div>
                        <p className="font-black text-sm">{item.t}</p>
                        <p className="text-[10px] text-slate-400 font-medium">{item.d}</p>
                     </div>
                   ))}
                </div>
             </div>
          </div>
        </section>

        {/* Pricing Funnel */}
        <section id="pricing" className="py-32 px-6">
           <div className="max-w-md mx-auto bg-white dark:bg-slate-800 rounded-[3rem] shadow-3d-glass border border-slate-100 dark:border-slate-700 overflow-hidden relative">
              <div className="bg-apex-600 p-8 text-white text-center">
                 <p className="text-xs font-black uppercase tracking-widest opacity-80 mb-2">Weekly Premium Access</p>
                 <h3 className="text-4xl font-black">Unlimited Learning</h3>
              </div>

              <div className="p-10 space-y-8 text-center">
                 <div className="space-y-1">
                    <p className="text-slate-400 font-bold line-through">Formerly ₦3,000</p>
                    <div className="flex items-center justify-center gap-3">
                       <span className="text-5xl font-black text-slate-900 dark:text-white tracking-tighter">₦1,999.9</span>
                       <span className="px-3 py-1 bg-amber-100 text-amber-700 text-[10px] font-black rounded-full uppercase">Today Only</span>
                    </div>
                 </div>

                 <div className="space-y-3 text-left">
                    {["Full Nursing Curriculum", "AI Paper Training", "Smart Exam Alerts", "Spaced Repetition Algorithm", "Official Payment Hub"].map(f => (
                      <div key={f} className="flex items-center gap-3 text-sm font-bold text-slate-600 dark:text-slate-300">
                         <CheckCircle2 size={18} className="text-emerald-500" /> {f}
                      </div>
                    ))}
                 </div>

                 <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800 rounded-2xl flex items-center gap-4 text-left">
                    <div className="w-10 h-10 bg-amber-500 rounded-xl flex items-center justify-center text-white shrink-0">
                       <Sparkles size={20} />
                    </div>
                    <div>
                       <p className="text-[10px] font-black text-amber-800 dark:text-amber-400 uppercase tracking-widest">Limited Offer</p>
                       <p className="text-xs font-bold text-amber-700 dark:text-amber-500">Only 4 slots remaining for today's discount.</p>
                    </div>
                 </div>

                 <button className="w-full py-5 bg-apex-600 text-white rounded-2xl font-black uppercase tracking-widest text-sm shadow-xl shadow-apex-600/20 hover:bg-apex-700 transition-all active:scale-95">
                    Claim My Slot & Pay
                 </button>

                 <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Secure Bank-Grade Payment • Instant Activation</p>
              </div>
           </div>
        </section>
      </div>

      {/* Activation Modal */}
      <AnimatePresence>
        {activationMode && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white dark:bg-slate-800 w-full max-w-md rounded-[2.5rem] shadow-2xl overflow-hidden"
            >
              <div className="p-8 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center">
                <h3 className="text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight">Activate Apex</h3>
                <button onClick={() => setActivationMode(false)} className="p-2 text-slate-400 hover:text-slate-600"><Lock size={24} /></button>
              </div>

              <form onSubmit={handleActivate} className="p-10 space-y-8">
                 <div className="w-20 h-20 bg-apex-50 dark:bg-apex-900/30 text-apex-600 rounded-3xl flex items-center justify-center mx-auto shadow-inner">
                    <Key size={40} />
                 </div>

                 <div className="text-center space-y-2">
                    <h4 className="text-xl font-black text-slate-900 dark:text-white uppercase">Enter Product Key</h4>
                    <p className="text-xs text-slate-500 font-medium">Verify your payment to unlock your dashboard.</p>
                 </div>

                 <div className="space-y-4">
                    <input
                      type="text"
                      value={productKey}
                      onChange={e => {setProductKey(e.target.value); setError('');}}
                      placeholder="XXXX-XXXX-XXXX"
                      className="w-full text-center tracking-[0.2em] text-lg font-black py-5 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-slate-100 dark:border-slate-800 outline-none focus:ring-2 focus:ring-apex-500 uppercase"
                    />
                    {error && <p className="text-[10px] text-red-500 font-black text-center uppercase tracking-widest">{error}</p>}

                    <button
                      disabled={isVerifying}
                      type="submit"
                      className="w-full py-5 bg-slate-900 text-white rounded-2xl font-black uppercase tracking-widest text-xs flex items-center justify-center gap-2 hover:bg-slate-800 active:scale-95 transition-all shadow-lg"
                    >
                      {isVerifying ? <Zap size={16} className="animate-spin" /> : 'Unlock Success Dashboard'}
                    </button>
                 </div>

                 <button
                  type="button"
                  onClick={() => setActivationMode(false)}
                  className="w-full text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-apex-600 transition-colors"
                 >
                   Don't have a key? Pay ₦1,999.9
                 </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Landing;
