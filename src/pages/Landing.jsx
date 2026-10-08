import React from 'react';
import { Link } from 'react-router-dom';
import {
  Stethoscope,
  BookOpen,
  ClipboardCheck,
  Trophy,
  Target,
  Users,
  ShieldCheck,
  GraduationCap,
  ArrowRight,
} from 'lucide-react';

// Public entry page for "/" (unauthenticated visitors only — an active session
// is redirected to /dashboard by App.jsx). This is the crawlable face of
// PolyNurse: real, useful publisher content about the platform — never private
// user data, quiz questions, answer keys, or balances. Ads stay OFF here
// (ADS_POLICY has no "/" entry; resolveAdArea fails closed).

const STUDY_AREAS = [
  {
    icon: Stethoscope,
    title: 'Nursing 200-Level',
    body: 'Fundamentals of Nursing, Pharmacology III, Reproductive Health, Research Methodology, Nutrition & Dietetics, and Politics and Governance in Nursing.',
  },
  {
    icon: GraduationCap,
    title: 'Nursing & Midwifery 300-Level',
    body: 'Advanced nursing and midwifery subjects, including complications of pregnancy and labour, mapped to your course directory.',
  },
  {
    icon: ClipboardCheck,
    title: 'NCLEX-RN & NMCN Banks',
    body: 'Exam-style clinical and quick-challenge rounds drawn from the NCLEX and NMCN frameworks — never mixed outside their exam mode.',
  },
  {
    icon: Target,
    title: 'Weakness Drills',
    body: 'Practice is rebuilt from the questions you actually got wrong, grouped by subject, with the built-in rationale on reveal.',
  },
  {
    icon: Trophy,
    title: 'Global Leaderboard',
    body: 'Ranked by server-verified correct answers — every point is graded on the server, so the ranking cannot be gamed from the client.',
  },
  {
    icon: Users,
    title: 'Community & Study Groups',
    body: 'A single student feed, study groups, party quiz rooms, challenges and squads to keep preparation social and consistent.',
  },
];

const VALUE_POINTS = [
  {
    icon: ShieldCheck,
    title: 'Server-graded rounds',
    body: 'Scores, streaks, Smart Coins and match results are settled on the server — you compete on real answers.',
  },
  {
    icon: BookOpen,
    title: 'Difficulty that earns its way',
    body: 'Easy through Extreme tiers unlock from your genuine accuracy per course, not from a settings toggle.',
  },
  {
    icon: ClipboardCheck,
    title: 'Free study that keeps moving',
    body: 'A fresh 10-question round every 30 minutes on every course, with activation unlocking the full bank.',
  },
];

const Landing = () => (
  <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
    <header className="border-b border-slate-200 dark:border-slate-800">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src="/polynurse-mark.svg" alt="" width="36" height="36" className="rounded-lg" />
          <span className="font-black uppercase tracking-[0.25em] text-xs sm:text-sm text-apex-600 dark:text-apex-400">
            Polynurse Exam Center
          </span>
        </div>
        <nav className="flex items-center gap-2 sm:gap-3" aria-label="Account">
          <Link
            to="/login"
            className="px-3 sm:px-4 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest text-apex-600 dark:text-apex-400 border border-apex-600/30 hover:bg-apex-600/5 transition-colors"
          >
            Sign in
          </Link>
          <Link
            to="/signup"
            className="px-3 sm:px-4 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest text-white bg-apex-600 hover:bg-apex-700 transition-colors"
          >
            Sign up
          </Link>
        </nav>
      </div>
    </header>

    <main className="max-w-5xl mx-auto px-4 sm:px-6 pb-24">
      <section className="pt-12 sm:pt-20 pb-10 sm:pb-14 text-center max-w-3xl mx-auto">
        <p className="text-[10px] sm:text-[11px] font-black uppercase tracking-[0.35em] text-apex-600 dark:text-apex-400">
          Nursing &amp; Midwifery · Nigeria
        </p>
        <h1 className="mt-4 text-3xl sm:text-5xl font-black tracking-tight leading-[1.08] text-slate-900 dark:text-white">
          Exam preparation that grades you the way the real board will
        </h1>
        <p className="mt-5 text-sm sm:text-base text-slate-600 dark:text-slate-400 font-medium leading-relaxed">
          Polynurse Exam Center helps nursing and midwifery students prepare for the NMCN
          licensing examinations in Nigeria and the NCLEX-RN international exam — with
          server-graded practice rounds, adaptive difficulty, weakness drills and a global
          leaderboard built on verified answers.
        </p>
        <div className="mt-8 flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3">
          <Link
            to="/signup"
            className="group inline-flex items-center justify-center gap-2 px-7 py-4 rounded-2xl bg-apex-600 hover:bg-apex-700 text-white font-black text-sm uppercase tracking-widest shadow-lg shadow-apex-600/25 transition-all active:scale-95"
          >
            Create a free account
            <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
          </Link>
          <Link
            to="/login"
            className="inline-flex items-center justify-center px-7 py-4 rounded-2xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-black text-sm uppercase tracking-widest hover:bg-white dark:hover:bg-slate-900 transition-colors"
          >
            Sign in
          </Link>
        </div>
        <p className="mt-4 text-[11px] font-bold text-slate-500 dark:text-slate-500 uppercase tracking-widest">
          Free study: 10 questions per round · a fresh round every 30 minutes per course
        </p>
      </section>

      <section aria-labelledby="study-areas-heading" className="pt-6">
        <h2
          id="study-areas-heading"
          className="text-[11px] font-black uppercase tracking-[0.3em] text-slate-400 dark:text-slate-500 text-center mb-6"
        >
          Supported study areas
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {STUDY_AREAS.map((area) => (
            <div
              key={area.title}
              className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-3xl p-5 shadow-sm"
            >
              <span className="w-10 h-10 rounded-xl bg-apex-600/10 text-apex-600 dark:text-apex-400 flex items-center justify-center mb-3">
                <area.icon size={18} />
              </span>
              <h3 className="font-black text-sm uppercase tracking-tight text-slate-900 dark:text-white">
                {area.title}
              </h3>
              <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 font-medium leading-relaxed">
                {area.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="value-heading" className="mt-12">
        <h2
          id="value-heading"
          className="text-[11px] font-black uppercase tracking-[0.3em] text-slate-400 dark:text-slate-500 text-center mb-6"
        >
          Why students use it
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {VALUE_POINTS.map((point) => (
            <div
              key={point.title}
              className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-3xl p-5"
            >
              <span className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mb-3">
                <point.icon size={18} />
              </span>
              <h3 className="font-black text-sm uppercase tracking-tight text-slate-900 dark:text-white">
                {point.title}
              </h3>
              <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 font-medium leading-relaxed">
                {point.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-14 text-center bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-[2rem] p-8 sm:p-10">
        <h2 className="text-xl sm:text-2xl font-black tracking-tight text-slate-900 dark:text-white">
          Start with your first round today
        </h2>
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-400 font-medium max-w-xl mx-auto">
          Create an account with your email, pick a course from your level, and let the
          server track your accuracy, streak and rank from the very first question.
        </p>
        <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            to="/signup"
            className="inline-flex items-center justify-center gap-2 px-7 py-4 rounded-2xl bg-apex-600 hover:bg-apex-700 text-white font-black text-sm uppercase tracking-widest transition-all active:scale-95"
          >
            Get started
            <ArrowRight size={16} />
          </Link>
          <Link
            to="/legal/privacy"
            className="text-[11px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
          >
            Privacy &amp; data policy
          </Link>
        </div>
      </section>
    </main>

    <footer className="border-t border-slate-200 dark:border-slate-800">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-3">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
          © {new Date().getFullYear()} Polynurse Exam Center
        </p>
        <nav className="flex items-center gap-4" aria-label="Legal">
          <Link to="/legal/terms" className="text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-apex-600 transition-colors">
            Terms
          </Link>
          <Link to="/legal/privacy" className="text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-apex-600 transition-colors">
            Privacy
          </Link>
          <Link to="/legal/cookies" className="text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-apex-600 transition-colors">
            Cookies
          </Link>
        </nav>
      </div>
    </footer>
  </div>
);

export default Landing;
