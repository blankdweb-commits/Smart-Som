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
  BookOpen
} from '../components/Icons';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';

const Landing = () => {
  const navigate = useNavigate();
  const { session, userProfile, loadingAuth } = useAppContext();
  const [slotsRemaining, setSlotsRemaining] = useState(12);
  const [timeLeft, setTimeLeft] = useState({ hours: 0, minutes: 45, seconds: 0 });

  // Auto-redirect for logged in users
  useEffect(() => {
    if (!loadingAuth && session) {
      if (userProfile.isActivated) {
        navigate('/dashboard');
      } else {
        navigate('/activate');
      }
    }
  }, [session, userProfile.isActivated, loadingAuth, navigate]);

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
    { title: "Structured Curriculum", desc: "Every topic mapped to official nursing exams.", icon: <Target className="text-apex-500" /> },
    { title: "Practice Exams", desc: "Real-time scoring and clinical insights.", icon: <Zap className="text-amber-500" /> },
    { title: "Success Strategies", desc: "Used by top students to master difficult terms.", icon: <Trophy className="text-emerald-500" /> },
    { title: "Progress Tracking", desc: "Visual data on your learning journey.", icon: <Award className="text-apex-500" /> }
  ];

  const testimonials = [
    { name: "Sarah O.", text: "Passed my professional exams with distinction! The flashcards are a lifesaver.", school: "LUTH Nursing" },
    { name: "Daniel K.", text: "The AI parser for past questions is magic. Saved me weeks of study prep.", school: "University of Ibadan" }
  ];

  return (
    <div className="min-h-screen bg-white text-slate-900 font-sans selection:bg-apex-100 selection:text-apex-700">
      {/* Sticky Bottom CTA for Mobile */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 p-4 bg-white/80 backdrop-blur-lg border-t border-slate-100 z-50">
        <button
          onClick={() => navigate('/signup')}
          className="w-full py-4 bg-apex-600 text-white rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-apex-600/20 active:scale-95 transition-all"
        >
          Unlock Full Access – ₦1999.9
        </button>
      </div>

      {/* Nav */}
      <nav className="p-6 flex justify-between items-center max-w-7xl mx-auto">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-apex-600 rounded-lg flex items-center justify-center text-white font-black">A</div>
          <span className="font-black tracking-tight text-xl">Apex Scholars</span>
        </div>
        <button
          onClick={() => navigate('/login')}
          className="px-6 py-2 text-sm font-bold text-slate-600 hover:text-apex-600 transition-colors"
        >
          Login
        </button>
      </nav>

      {/* Hero Section */}
      <section className="px-6 pt-12 pb-24 max-w-7xl mx-auto text-center space-y-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-apex-50 border border-apex-100"
        >
          <span className="text-[10px] font-black uppercase tracking-widest text-apex-600">Limited-time student pricing</span>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="text-4xl md:text-7xl font-black tracking-tighter leading-tight text-balance"
        >
          Pass Your Nursing Exams <br className="hidden md:block" />
          <span className="text-apex-600">Faster — Without Guesswork</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="text-lg md:text-xl text-slate-500 font-medium max-w-2xl mx-auto leading-relaxed"
        >
          Access structured lessons, exam simulations, and real success strategies used by top students.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="flex flex-col sm:flex-row gap-4 justify-center items-center"
        >
          <button
            onClick={() => navigate('/signup')}
            className="px-10 py-5 bg-apex-600 text-white rounded-2xl font-black uppercase tracking-widest text-sm shadow-2xl shadow-apex-600/30 hover:bg-apex-700 transition-all flex items-center gap-3 active:scale-95"
          >
            Start for ₦1999.9 Now <ArrowRight size={18} />
          </button>
          <div className="flex items-center gap-2 text-slate-400">
             <ShieldCheck size={16} />
             <span className="text-[10px] font-bold uppercase tracking-widest">Verified by 1,000+ students</span>
          </div>
        </motion.div>
      </section>

      {/* Value Stacking */}
      <section className="bg-slate-50 py-24 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16 space-y-4">
             <h2 className="text-3xl md:text-5xl font-black tracking-tight">Everything You Need To Excel</h2>
             <p className="text-slate-500 font-medium">Built specifically for the modern nursing curriculum.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            {features.map((f, i) => (
              <motion.div
                key={i}
                whileHover={{ y: -5 }}
                className="p-8 bg-white rounded-3xl border border-slate-100 shadow-soft"
              >
                <div className="w-12 h-12 bg-slate-50 rounded-2xl flex items-center justify-center mb-6">
                  {f.icon}
                </div>
                <h3 className="text-xl font-black mb-3">{f.title}</h3>
                <p className="text-slate-500 text-sm font-medium leading-relaxed">{f.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Price Anchor Section */}
      <section className="py-24 px-6 max-w-5xl mx-auto">
        <div className="bg-slate-900 rounded-[3rem] p-8 md:p-16 text-white text-center space-y-10 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-8 opacity-10">
            <Star size={120} />
          </div>

          <div className="space-y-4 relative z-10">
            <h2 className="text-3xl md:text-6xl font-black tracking-tight">Unlock Full Access</h2>
            <div className="flex items-center justify-center gap-4">
              <span className="text-xl md:text-2xl text-slate-500 line-through font-bold">₦3,000</span>
              <span className="text-5xl md:text-8xl font-black text-apex-400 tracking-tighter">₦1,999.9</span>
            </div>
            <p className="text-apex-400 font-black uppercase tracking-[0.2em] text-sm">Save ₦1,000 Today</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-3xl mx-auto relative z-10">
             <div className="flex items-center gap-3 text-left">
                <CheckCircle2 size={24} className="text-emerald-500 shrink-0" />
                <span className="text-sm font-bold">7,200+ Flashcards</span>
             </div>
             <div className="flex items-center gap-3 text-left">
                <CheckCircle2 size={24} className="text-emerald-500 shrink-0" />
                <span className="text-sm font-bold">AI Past Question Parser</span>
             </div>
             <div className="flex items-center gap-3 text-left">
                <CheckCircle2 size={24} className="text-emerald-500 shrink-0" />
                <span className="text-sm font-bold">Community Access</span>
             </div>
          </div>

          <div className="pt-6 relative z-10">
            <button
              onClick={() => navigate('/signup')}
              className="px-12 py-6 bg-apex-600 text-white rounded-2xl font-black uppercase tracking-widest text-sm shadow-2xl hover:bg-apex-500 transition-all active:scale-95"
            >
              Get Started – ₦1,999.9
            </button>
            <div className="mt-6 flex flex-col items-center gap-2">
               <div className="flex items-center gap-2 text-red-400 animate-pulse">
                  <Clock size={16} />
                  <span className="text-xs font-black uppercase tracking-widest">Price increases back to ₦3,000 soon</span>
               </div>
               <p className="text-[10px] text-slate-500 font-bold uppercase tracking-[0.2em]">Only {slotsRemaining} slots remaining at this price</p>
            </div>
          </div>
        </div>
      </section>

      {/* Social Proof */}
      <section className="py-24 px-6 bg-white overflow-hidden">
        <div className="max-w-7xl mx-auto">
           <div className="flex flex-col md:flex-row justify-between items-end mb-16 gap-8">
              <div className="space-y-4">
                 <div className="flex text-amber-400">
                    {[1,2,3,4,5].map(i => <Star key={i} size={18} fill="currentColor" />)}
                 </div>
                 <h2 className="text-3xl md:text-5xl font-black tracking-tight">Loved by Nursing <br />Students Nationwide</h2>
              </div>
              <div className="flex items-center gap-4 px-8 py-4 bg-slate-50 rounded-2xl border border-slate-100">
                 <Users size={24} className="text-apex-600" />
                 <div className="flex flex-col">
                    <span className="font-black text-xl leading-none">1,000+</span>
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Active Students</span>
                 </div>
              </div>
           </div>

           <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {testimonials.map((t, i) => (
                <div key={i} className="p-8 bg-slate-50 rounded-3xl border border-slate-100 space-y-6">
                   <p className="text-lg font-bold text-slate-700 italic leading-relaxed">"{t.text}"</p>
                   <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-apex-100 rounded-full flex items-center justify-center text-apex-600 font-black">{t.name[0]}</div>
                      <div>
                         <p className="font-black text-sm">{t.name}</p>
                         <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{t.school}</p>
                      </div>
                   </div>
                </div>
              ))}
           </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-32 px-6 text-center space-y-10 border-t border-slate-100">
         <h2 className="text-4xl md:text-6xl font-black tracking-tight leading-tight">Ready to master your <br />clinical future?</h2>
         <div className="flex flex-col items-center gap-6">
            <button
              onClick={() => navigate('/signup')}
              className="px-12 py-6 bg-apex-600 text-white rounded-2xl font-black uppercase tracking-widest text-sm shadow-2xl hover:bg-apex-500 transition-all active:scale-95"
            >
              Unlock Full Access – ₦1999.9
            </button>
          <p className="mt-4 text-[10px] text-slate-400 font-black uppercase tracking-widest">Start your 30-day premium cycle today</p>
         </div>
      </section>

      <footer className="py-12 px-6 border-t border-slate-50 text-center">
         <div className="flex items-center justify-center gap-2 mb-4">
            <div className="w-6 h-6 bg-apex-600 rounded flex items-center justify-center text-white font-black text-xs">A</div>
            <span className="font-black tracking-tight text-sm text-slate-400">Apex Scholars</span>
         </div>
         <p className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">© 2024 Institutional Productivity Hub. All rights reserved.</p>
      </footer>
    </div>
  );
};

export default Landing;
