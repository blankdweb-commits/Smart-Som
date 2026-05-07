import React from 'react';
import { format, differenceInDays, isSameDay, isBefore, parseISO } from 'date-fns';
import { Calendar, Clock, AlertTriangle, CheckCircle2, TrendingUp, Sparkles } from './Icons';
import { motion } from 'framer-motion';

const ExamDashboard = ({ exams }) => {
  const today = new Date();

  const stats = React.useMemo(() => {
    const todayExams = exams.filter(e => isSameDay(parseISO(e.date), today));
    const upcomingExams = exams.filter(e => {
        const d = parseISO(e.date);
        return !isSameDay(d, today) && !isBefore(d, today);
    });
    const missedExams = exams.filter(e => {
        const d = parseISO(e.date);
        return isBefore(d, today) && !isSameDay(d, today) && e.readiness < 100;
    });

    const avgReadiness = exams.length > 0
      ? Math.round(exams.reduce((acc, curr) => acc + (curr.readiness || 0), 0) / exams.length)
      : 0;

    return {
      today: todayExams.length,
      upcoming: upcomingExams.length,
      missed: missedExams.length,
      avgReadiness,
      total: exams.length
    };
  }, [exams]);

  const nextExam = [...exams]
    .filter(e => !isBefore(parseISO(e.date), today) || isSameDay(parseISO(e.date), today))
    .sort((a, b) => parseISO(a.date) - parseISO(b.date))[0];

  return (
    <div className="space-y-6">
      {/* Motivational / Alert Banner */}
      {stats.today > 0 ? (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-red-600 text-white p-6 rounded-[2.5rem] shadow-xl shadow-red-600/20 flex flex-col sm:flex-row items-center justify-between gap-6"
        >
          <div className="flex items-center gap-4 text-center sm:text-left">
            <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center animate-pulse">
              <AlertTriangle size={32} />
            </div>
            <div>
              <h3 className="text-2xl font-black tracking-tight">Exam Day is Here!</h3>
              <p className="text-white/80 font-bold uppercase text-xs tracking-widest mt-1">You have {stats.today} assessment(s) scheduled for today.</p>
            </div>
          </div>
          <button className="px-8 py-4 bg-white text-red-600 rounded-2xl font-black uppercase tracking-widest text-sm shadow-lg active:scale-95 transition-all">
            View Schedule
          </button>
        </motion.div>
      ) : nextExam ? (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-medical-600 text-white p-6 rounded-[2.5rem] shadow-xl shadow-medical-600/20 flex flex-col sm:flex-row items-center justify-between gap-6"
        >
          <div className="flex items-center gap-4 text-center sm:text-left">
            <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center">
              <Sparkles size={32} />
            </div>
            <div>
              <h3 className="text-2xl font-black tracking-tight">Next Challenge Awaits</h3>
              <p className="text-white/80 font-bold uppercase text-xs tracking-widest mt-1">
                {nextExam.title} in {differenceInDays(parseISO(nextExam.date), today)} days
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 px-6 py-3 bg-white/10 rounded-2xl border border-white/20">
            <TrendingUp size={18} />
            <span className="font-black text-sm uppercase tracking-widest">{nextExam.readiness}% Ready</span>
          </div>
        </motion.div>
      ) : null}

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatItem
          label="Today"
          value={stats.today}
          icon={<Clock className="text-red-500" />}
          sub="Assessments"
          color="bg-red-50 dark:bg-red-900/10"
        />
        <StatItem
          label="Upcoming"
          value={stats.upcoming}
          icon={<Calendar className="text-medical-500" />}
          sub="This Semester"
          color="bg-medical-50 dark:bg-medical-900/10"
        />
        <StatItem
          label="Readiness"
          value={`${stats.avgReadiness}%`}
          icon={<TrendingUp className="text-indigo-500" />}
          sub="Average Score"
          color="bg-indigo-50 dark:bg-indigo-900/10"
        />
        <StatItem
          label="Missed"
          value={stats.missed}
          icon={<AlertTriangle className="text-orange-500" />}
          sub="Action Required"
          color="bg-orange-50 dark:bg-orange-900/10"
        />
      </div>
    </div>
  );
};

const StatItem = ({ label, value, icon, sub, color }) => (
  <div className={`${color} p-5 rounded-3xl border border-white/10 shadow-sm flex flex-col justify-between h-32`}>
    <div className="flex justify-between items-start">
      <div className="p-2 bg-white dark:bg-slate-800 rounded-xl shadow-sm">
        {icon}
      </div>
      <span className="text-2xl font-black text-slate-800 dark:text-white leading-none">{value}</span>
    </div>
    <div>
      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{label}</p>
      <p className="text-[10px] font-bold text-slate-400/60 uppercase truncate">{sub}</p>
    </div>
  </div>
);

export default ExamDashboard;
