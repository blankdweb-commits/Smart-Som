import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence, useScroll, useTransform, useMotionValueEvent, useMotionTemplate } from 'framer-motion';
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

  useMotionValueEvent(scrollYProgress, "change", (latest) => {
    setScrollVal(latest);
  });

  const glowOpacity = useTransform(scrollYProgress, [0.8, 1], [0, 1]);
  const blurValue = useTransform(scrollYProgress, [0, 0.1], [0, 4]);
  const treeBlur = useMotionTemplate`blur(${blurValue}px)`;

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
    { title: "Foundations", desc: "Every great nurse starts from the roots of discipline.", color: "text-slate-500", icon: "🌱", detail: "The Struggle" },
    { title: "Growth", desc: "Daily revision builds the trunk of your career.", color: "text-amber-700", icon: "🪵", detail: "Consistency" },
    { title: "Mastery", desc: "Knowledge expands like branches into clinical skill.", color: "text-emerald-600", icon: "🌿", detail: "Retention" },
    { title: "Apex", desc: "Rise to the Crown of Nursing Excellence.", color: "text-apex-600", icon: "👑", detail: "Success" }
  ];

  const floatingFeatures = [
    { icon: <Zap size={14} />, text: "7,000+ Questions" },
    { icon: <Clock size={14} />, text: "Real-time Exam Alerts" },
    { icon: <BookOpen size={14} />, text: "Smart Flashcards" },
    { icon: <Shield size={14} />, text: "Bursary Payment Hub" },
    { icon: <Users size={14} />, text: "Student Community" }
  ];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 overflow-x-hidden selection:bg-apex-100 selection:text-apex-900">
      {/* 3D Journey Background */}
      <motion.div
        style={{ filter: treeBlur }}
        className="fixed inset-0 z-0 overflow-hidden pointer-events-none"
      >
        <TreeScene scrollProgress={scrollVal} />
        <motion.div
          style={{ opacity: glowOpacity }}
          className="absolute top-0 left-0 w-full h-screen bg-gradient-to-b from-apex-500/10 to-transparent blur-3xl"
        />
      </motion.div>

      <div className="relative z-10">
        {/* Hero Section */}
        <section className="min-h-[100dvh] flex flex-col items-center justify-center p-6 text-center space-y-12">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            whileInView={{ scale: 1, opacity: 1 }}
            viewport={{ once: true }}
            className="w-24 h-24 bg-apex-600 rounded-[2.5rem] shadow-apex-glow flex items-center justify-center text-white font-black text-4xl mb-4"
          >
            A
          </motion.div>

          <div className="space-y-6 max-w-4xl px-4">
            <motion.h1
              initial={{ y: 20, opacity: 0 }}
              whileInView={{ y: 0, opacity: 1 }}
              viewport={{ once: true }}
              className="text-6xl md:text-8xl font-black text-slate-900 dark:text-white tracking-tighter leading-[0.9] text-balance"
            >
              Rise to the <br/><span className="text-apex-600">Apex of Nursing.</span>
            </motion.h1>
            <motion.p
              initial={{ y: 20, opacity: 0 }}
              whileInView={{ y: 0, opacity: 1 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
              className="text-xl md:text-2xl text-slate-500 dark:text-slate-400 font-bold max-w-2xl mx-auto leading-tight"
            >
              Transform your struggle into success with the world's most advanced nursing study system.
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
              className="flex-[2] py-6 bg-apex-600 hover:bg-apex-700 text-white rounded-3xl font-black uppercase tracking-[0.2em] text-[10px] shadow-2xl shadow-apex-600/30 active:scale-95 transition-all flex items-center justify-center gap-3"
            >
              Start My Journey <ArrowRight size={16} />
            </button>
            <button
              onClick={() => setActivationMode(true)}
              className="flex-1 py-6 bg-white/80 dark:bg-slate-800/80 backdrop-blur-md text-slate-900 dark:text-white rounded-3xl font-black uppercase tracking-[0.2em] text-[10px] shadow-soft border border-white/20 active:scale-95 transition-all"
            >
              Activate Key
            </button>
          </motion.div>

          <motion.div
            animate={{ y: [0, 10, 0] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="absolute bottom-10 left-1/2 -translate-x-1/2 text-slate-400"
          >
            <ChevronDown size={32} />
          </motion.div>
        </section>

        {/* Tree Journey Section */}
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
                   <div className="w-48 h-48 bg-white/20 backdrop-blur-3xl dark:bg-slate-800/30 rounded-[4rem] shadow-3d-glass flex items-center justify-center text-7xl border border-white/20 dark:border-slate-700 relative z-10 transition-transform hover:scale-105 duration-500">
                      {step.icon}
                   </div>
                   {/* Floating Feature Tags */}
                   <motion.div
                    animate={{ y: [0, -15, 0] }}
                    transition={{ duration: 4, repeat: Infinity, delay: i * 0.7 }}
                    className={`absolute ${i % 2 === 0 ? '-right-16' : '-left-16'} -top-8 flex flex-col gap-4 z-20`}
                   >
                      <div className="bg-white dark:bg-slate-800 px-6 py-3 rounded-2xl shadow-xl border border-slate-100 dark:border-slate-700 whitespace-nowrap">
                         <p className={`text-[10px] font-black uppercase tracking-[0.3em] ${step.color}`}>{step.detail}</p>
                      </div>
                      {i === 3 && (
                        <div className="bg-apex-600 px-6 py-3 rounded-2xl shadow-2xl shadow-apex-500/40 text-white whitespace-nowrap">
                          <p className="text-[10px] font-black uppercase tracking-[0.3em] flex items-center gap-2"><Sparkles size={14} /> Apex Achieved</p>
                        </div>
                      )}
                   </motion.div>
                </div>

                <div className={`text-center ${i % 2 === 0 ? 'md:text-left' : 'md:text-right'} space-y-6 flex-1`}>
                  <div className="space-y-3">
                    <p className="text-apex-500 font-black text-[10px] uppercase tracking-[0.5em]">Phase 0{i+1}</p>
                    <h3 className={`text-6xl font-black ${step.color} tracking-tighter leading-none`}>{step.title}</h3>
                  </div>
                  <p className="text-2xl text-slate-500 dark:text-slate-400 font-bold leading-tight">{step.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </section>

        {/* Global Features Marquee */}
        <div className="py-24 overflow-hidden relative border-y border-slate-200 dark:border-slate-800 bg-white/40 dark:bg-slate-900/40 backdrop-blur-md">
           <div className="flex gap-10 items-center animate-infinite-scroll">
              {[...floatingFeatures, ...floatingFeatures, ...floatingFeatures].map((f, idx) => (
                <div key={idx} className="flex items-center gap-4 px-8 py-4 bg-white dark:bg-slate-800 rounded-3xl shadow-soft border border-slate-100 dark:border-slate-700 shrink-0">
                   <div className="text-apex-600">{f.icon}</div>
                   <span className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-[0.2em]">{f.text}</span>
                </div>
              ))}
           </div>
        </div>

        {/* Conversion Section */}
        <section className="py-48 bg-slate-900 text-white overflow-hidden relative">
          <div className="absolute inset-0 bg-gradient-to-br from-apex-600/10 to-transparent" />
          <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-2 gap-24 items-center relative z-10">
             <div className="space-y-16">
                <h2 className="text-5xl md:text-7xl font-black tracking-tighter leading-[0.9]">Nursing is hard. <br/><span className="text-red-500">Forgetting is harder.</span></h2>
                <div className="space-y-8">
                   {[
                     "Reading but forgetting concepts by morning",
                     "Anxiety growing as exam date approaches",
                     "Overwhelmed by thousands of medical terms",
                     "Constant fear of carryovers and failing"
                   ].map(text => (
                     <div key={text} className="flex items-center gap-6 text-slate-400 text-lg font-bold">
                        <div className="w-8 h-8 rounded-full border-2 border-red-500/30 flex items-center justify-center text-red-500 shrink-0">×</div>
                        {text}
                     </div>
                   ))}
                </div>
             </div>
             <div className="bg-white/5 backdrop-blur-3xl rounded-[4rem] p-12 border border-white/10 space-y-12 shadow-3d-heavy">
                <h3 className="text-4xl font-black text-apex-400 tracking-tight">The Apex Standard</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                   {[
                     { t: "Logic Flashcards", d: "Scientific recall", i: <Zap /> },
                     { t: "Smart Alerts", d: "Automated schedule", i: <Clock /> },
                     { t: "High-Yield Focus", d: "Zero wasted study", i: <Star /> },
                     { t: "Clinical Power", d: "Real competence", i: <ShieldCheck /> }
                   ].map(item => (
                     <div key={item.t} className="p-8 bg-white/5 rounded-3xl border border-white/5 space-y-4 hover:bg-white/10 transition-all cursor-default group">
                        <div className="text-apex-400 transform group-hover:scale-110 transition-transform">{item.i}</div>
                        <div>
                          <p className="font-black text-lg uppercase tracking-tight leading-none mb-1">{item.t}</p>
                          <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">{item.d}</p>
                        </div>
                     </div>
                   ))}
                </div>
             </div>
          </div>
        </section>

        {/* Pricing Funnel */}
        <section id="pricing" className="py-64 px-6 relative">
           <div className="max-w-md mx-auto bg-white dark:bg-slate-800 rounded-[4rem] shadow-3d-heavy border border-slate-100 dark:border-slate-700 overflow-hidden relative">
              <div className="bg-apex-600 p-10 text-white text-center space-y-2">
                 <p className="text-[10px] font-black uppercase tracking-[0.4em] opacity-80">Premium Access Slot</p>
                 <h3 className="text-5xl font-black tracking-tighter">Apex Scholars</h3>
              </div>

              <div className="p-12 space-y-10 text-center">
                 <div className="space-y-2">
                    <p className="text-slate-400 font-black text-xs line-through tracking-[0.2em] uppercase">Formerly ₦3,000</p>
                    <div className="flex flex-col items-center justify-center gap-1">
                       <span className="text-7xl font-black text-slate-900 dark:text-white tracking-tighter">₦1,999.9</span>
                       <span className="px-5 py-2 bg-amber-100 text-amber-700 text-[10px] font-black rounded-full uppercase tracking-widest mt-2 animate-pulse">Only First 10 Users Today</span>
                    </div>
                 </div>

                 <div className="space-y-4 text-left">
                    {["Full Nursing Curriculum", "AI Document Analysis", "Dynamic Exam Timeline", "SM-2 Recall Algorithm", "Official Fee Payment Hub"].map(f => (
                      <div key={f} className="flex items-center gap-4 text-sm font-black text-slate-600 dark:text-slate-300">
                         <CheckCircle2 size={20} className="text-emerald-500 shrink-0" /> {f}
                      </div>
                    ))}
                 </div>

                 <div className="p-6 bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800 rounded-3xl flex items-center gap-5 text-left">
                    <div className="w-14 h-14 bg-amber-500 rounded-2xl flex items-center justify-center text-white shrink-0 shadow-lg">
                       <Sparkles size={28} />
                    </div>
                    <div>
                       <p className="text-[10px] font-black text-amber-800 dark:text-amber-500 uppercase tracking-[0.3em]">Scarcity Alert</p>
                       <p className="text-xs font-bold text-slate-600 dark:text-slate-400 leading-tight">Only 4 discounted slots remaining for your session.</p>
                    </div>
                 </div>

                 <button className="w-full py-6 bg-apex-600 text-white rounded-[2rem] font-black uppercase tracking-[0.3em] text-xs shadow-2xl shadow-apex-600/30 hover:bg-apex-700 transition-all active:scale-[0.98]">
                    Claim My Slot & Pay
                 </button>

                 <div className="flex items-center justify-center gap-2 opacity-40">
                   <Shield size={12} />
                   <p className="text-[9px] text-slate-900 dark:text-white font-black uppercase tracking-[0.2em]">Bank-Grade Security • Instant Access</p>
                 </div>
              </div>
           </div>
        </section>
      </div>

      {/* Activation Modal */}
      <AnimatePresence>
        {activationMode && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-xl">
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-white dark:bg-slate-800 w-full max-w-md rounded-[3rem] shadow-3d-heavy overflow-hidden"
            >
              <div className="p-10 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center">
                <h3 className="text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tighter">Enter Key</h3>
                <button onClick={() => setActivationMode(false)} className="p-3 text-slate-400 hover:text-slate-600 rounded-2xl bg-slate-50 dark:bg-slate-900"><Lock size={20} /></button>
              </div>

              <form onSubmit={handleActivate} className="p-12 space-y-10">
                 <div className="w-24 h-24 bg-apex-50 dark:bg-apex-900/30 text-apex-600 rounded-[2rem] flex items-center justify-center mx-auto shadow-inner">
                    <Key size={48} />
                 </div>

                 <div className="text-center space-y-3">
                    <h4 className="text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tighter">Unlock the Apex</h4>
                    <p className="text-xs text-slate-500 font-bold uppercase tracking-widest">Verify your payment code to proceed.</p>
                 </div>

                 <div className="space-y-6">
                    <input
                      type="text"
                      value={productKey}
                      onChange={e => {setProductKey(e.target.value); setError('');}}
                      placeholder="XXXX-XXXX-XXXX"
                      className="w-full text-center tracking-[0.3em] text-xl font-black py-6 bg-slate-50 dark:bg-slate-900 border-2 border-transparent focus:border-apex-500 rounded-3xl outline-none transition-all uppercase placeholder:opacity-20"
                    />
                    {error && <p className="text-[10px] text-red-500 font-black text-center uppercase tracking-widest animate-bounce">{error}</p>}

                    <button
                      disabled={isVerifying}
                      type="submit"
                      className="w-full py-6 bg-slate-900 text-white rounded-3xl font-black uppercase tracking-[0.3em] text-[10px] flex items-center justify-center gap-3 hover:bg-slate-800 active:scale-95 transition-all shadow-xl"
                    >
                      {isVerifying ? <Zap size={16} className="animate-spin" /> : 'Begin Transformation'}
                    </button>
                 </div>

                 <button
                  type="button"
                  onClick={() => setActivationMode(false)}
                  className="w-full text-[9px] font-black text-slate-400 uppercase tracking-[0.4em] hover:text-apex-600 transition-colors"
                 >
                   I need a key • Pay ₦1,999.9
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
