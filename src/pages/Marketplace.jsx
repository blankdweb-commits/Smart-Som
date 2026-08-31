// eslint-disable-next-line no-unused-vars
import { motion } from 'framer-motion';
import { BookOpen, Star, Lock } from '../components/Icons';
import { ShoppingBag, Tag, Bell } from 'lucide-react';

// MARKETPLACE (placeholder landing page).
// Per product decision: NOT yet a real buy/sell store. This is a landing page
// that telegraphs the coming marketplace. Admin-only listings/content arrive in
// a future phase; no full sell/purchase flow is wired up here.
export default function Marketplace() {
  const categories = [
    { icon: BookOpen, name: 'Revision Notes', desc: 'Structured notes & cheat sheets', color: 'bg-teal-500' },
    { icon: Tag, name: 'Past Questions', desc: 'Curated NMC/NBTE question packs', color: 'bg-blue-500' },
    { icon: Star, name: 'Study Tools', desc: 'Templates, planners & trackers', color: 'bg-amber-500' }
  ];

  const roadmap = [
    { step: 'Launch', desc: 'Verified tutors list quality materials for nurse & midwifery students.' },
    { step: 'Quality review', desc: 'Our team reviews every upload before it can be listed — no spam.' },
    { step: 'Seamless access', desc: 'Materials delivered straight to your library, secure and instant.' }
  ];

  return (
    <div className="max-w-md mx-auto px-4 pt-6 pb-28">
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-teal-600 to-emerald-700 text-white p-6 mb-6 shadow-lg">
          <div className="absolute -right-6 -top-10 w-40 h-40 rounded-full bg-white/10" />
          <div className="absolute right-12 -bottom-12 w-32 h-32 rounded-full bg-white/10" />
          <div className="relative">
            <div className="w-11 h-11 rounded-2xl bg-white/15 flex items-center justify-center mb-4">
              <ShoppingBag className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-bold mb-1">Apex Marketplace</h1>
            <p className="text-white/85 text-sm leading-relaxed">
              Quality revision materials from verified tutors — coming soon.
            </p>
          </div>
        </div>

        {/* Coming soon lock */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 mb-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-teal-100 dark:bg-teal-900/40 flex items-center justify-center">
              <Lock className="w-5 h-5 text-teal-600 dark:text-teal-400" />
            </div>
            <div>
              <h2 className="font-semibold text-slate-800 dark:text-slate-100">Not open yet</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">Sellers & storefront coming soon</p>
            </div>
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            We're building the marketplace to be a{" "}
            <span className="font-medium text-slate-800 dark:text-slate-100">trusted, quality-first</span>{" "}
            place for nursing & midwifery students to find exactly what they need. When it opens, verified
            sellers will list revision notes, past questions and study tools — all screened before going live.
          </p>
          <button
            className="mt-4 w-full flex items-center justify-center gap-2 bg-teal-600 hover:bg-teal-500 text-white font-semibold py-3 rounded-xl transition-colors"
            onClick={() => {}}
          >
            <Bell className="w-4 h-4" />
            Notify me when it opens
          </button>
        </div>

        {/* Categories preview */}
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100 mb-3 uppercase tracking-wide">
          What you'll find
        </h3>
        <div className="space-y-3 mb-6">
          {categories.map((c, i) => (
            <motion.div
              key={c.name}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08 }}
              className="flex items-center gap-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4"
            >
              <div className={`w-11 h-11 rounded-xl ${c.color} flex items-center justify-center text-white shrink-0`}>
                <c.icon className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h3 className="font-semibold text-slate-800 dark:text-slate-100">{c.name}</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{c.desc}</p>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Roadmap */}
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100 mb-3 uppercase tracking-wide">
          How we're rolling it out
        </h3>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 space-y-4">
          {roadmap.map((r, i) => (
            <div key={r.step} className="flex gap-3">
              <div className="flex flex-col items-center">
                <div className="w-7 h-7 rounded-full bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 flex items-center justify-center text-xs font-bold">
                  {i + 1}
                </div>
                {i < roadmap.length - 1 && <div className="w-px flex-1 bg-slate-200 dark:bg-slate-700 mt-1" />}
              </div>
              <div className="pb-4">
                <h4 className="font-semibold text-slate-800 dark:text-slate-100 text-sm">{r.step}</h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{r.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
