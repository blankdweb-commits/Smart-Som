import React, { useState } from 'react';
import { format, differenceInDays, isSameDay, parseISO } from 'date-fns';
import { MapPin, Clock, Edit2, Trash2, ChevronRight, CheckCircle2, AlertCircle, Calendar, User, BookOpen, ExternalLink, MoreVertical } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const ExamCard = ({ exam, onEdit, onDelete, onUpdateReadiness, onToggleTopic }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showActions, setShowActions] = useState(false);

  const examDate = parseISO(exam.date);
  const today = new Date();
  const diff = differenceInDays(examDate, today);

  const getUrgencyColor = () => {
    if (isSameDay(examDate, today)) return 'border-red-500 bg-red-50/30 dark:bg-red-900/10';
    if (diff > 0 && diff <= 7) return 'border-orange-500 bg-orange-50/30 dark:bg-orange-900/10';
    if (diff < 0) return 'border-slate-300 bg-slate-50 dark:bg-slate-900/50 opacity-75';
    return 'border-green-500 bg-green-50/30 dark:bg-green-900/10';
  };

  const getUrgencyBadge = () => {
    if (isSameDay(examDate, today)) return { label: 'Today', color: 'bg-red-500' };
    if (diff > 0 && diff <= 7) return { label: `In ${diff} Days`, color: 'bg-orange-500' };
    if (diff < 0) return { label: 'Passed', color: 'bg-slate-400' };
    return { label: 'Upcoming', color: 'bg-green-500' };
  };

  const badge = getUrgencyBadge();

  return (
    <motion.div
      layout
      className={`relative group rounded-[2rem] border-2 ${getUrgencyColor()} transition-all overflow-hidden shadow-soft hover:shadow-clinical`}
    >
      {/* Top Section / Compact View */}
      <div className="p-6 cursor-pointer" onClick={() => setIsExpanded(!isExpanded)}>
        <div className="flex justify-between items-start mb-4">
          <div className="flex items-center gap-2">
            <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest text-white ${badge.color}`}>
              {badge.label}
            </span>
            <span className="px-3 py-1 rounded-full bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 text-[10px] font-black uppercase tracking-widest text-slate-500">
              {exam.type}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={(e) => { e.stopPropagation(); setShowActions(!showActions); }}
              className="p-2 hover:bg-white dark:hover:bg-slate-700 rounded-full transition-colors text-slate-400"
            >
              <MoreVertical size={18} />
            </button>
          </div>
        </div>

        <AnimatePresence>
          {showActions && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: -10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: -10 }}
              className="absolute top-14 right-6 z-20 bg-white dark:bg-slate-800 shadow-xl border border-slate-100 dark:border-slate-700 rounded-2xl p-2 flex flex-col gap-1 min-w-[120px]"
            >
              <button onClick={(e) => { e.stopPropagation(); onEdit(exam); setShowActions(false); }} className="flex items-center gap-2 w-full px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-xl text-sm font-bold text-slate-600 dark:text-slate-300">
                <Edit2 size={14} /> Edit
              </button>
              <button onClick={(e) => { e.stopPropagation(); onDelete(exam.id); setShowActions(false); }} className="flex items-center gap-2 w-full px-4 py-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl text-sm font-bold text-red-500">
                <Trash2 size={14} /> Delete
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <h3 className="text-2xl font-black text-slate-900 dark:text-white leading-tight mb-4 group-hover:text-medical-600 transition-colors">
          {exam.title}
        </h3>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-tight">
            <Calendar size={14} className="text-medical-500" />
            {format(examDate, 'EEE, MMM dd')}
          </div>
          <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-tight">
            <Clock size={14} className="text-medical-500" />
            {exam.time}
          </div>
          <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-tight col-span-2">
            <MapPin size={14} className="text-medical-500" />
            {exam.venue}
          </div>
        </div>

        {/* Readiness Bar */}
        <div className="mt-6 space-y-2">
          <div className="flex justify-between items-end">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Readiness Score</span>
            <span className="text-xs font-black text-medical-600">{exam.readiness}%</span>
          </div>
          <div className="h-2 w-full bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${exam.readiness}%` }}
              className={`h-full rounded-full ${exam.readiness > 70 ? 'bg-emerald-500' : exam.readiness > 30 ? 'bg-medical-500' : 'bg-red-500'}`}
            />
          </div>
        </div>
      </div>

      {/* Expanded View */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-slate-100 dark:border-slate-800"
          >
            <div className="p-8 space-y-8 bg-white/50 dark:bg-slate-900/20">
              {/* Detailed Info */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                {exam.lecturer && (
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 rounded-lg">
                      <User size={16} />
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Lecturer</p>
                      <p className="text-sm font-bold text-slate-700 dark:text-slate-200">{exam.lecturer}</p>
                    </div>
                  </div>
                )}
                {exam.priority && (
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-amber-50 dark:bg-amber-900/30 text-amber-600 rounded-lg">
                      <AlertCircle size={16} />
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Priority</p>
                      <p className={`text-sm font-bold ${exam.priority === 'High' ? 'text-red-500' : 'text-slate-700 dark:text-slate-200'}`}>{exam.priority}</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Topics Checklist */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2">
                    <CheckCircle2 size={14} className="text-medical-500" />
                    Preparation Progress
                  </h4>
                  <span className="text-[10px] font-bold text-slate-400">{exam.topics.filter(t => t.completed).length}/{exam.topics.length} Topics</span>
                </div>

                <div className="grid grid-cols-1 gap-2">
                  {exam.topics.map((topic, idx) => (
                    <button
                      key={idx}
                      onClick={() => onToggleTopic(exam.id, idx)}
                      className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${topic.completed ? 'bg-emerald-50 border-emerald-100 dark:bg-emerald-900/10 dark:border-emerald-900/30 text-emerald-700 dark:text-emerald-400' : 'bg-slate-50 border-slate-100 dark:bg-slate-800/50 dark:border-slate-700 text-slate-600 dark:text-slate-400'}`}
                    >
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${topic.completed ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-300 dark:border-slate-600'}`}>
                        {topic.completed && <CheckCircle2 size={12} />}
                      </div>
                      <span className="text-xs font-bold truncate">{topic.name}</span>
                    </button>
                  ))}
                  {exam.topics.length === 0 && (
                    <p className="text-xs text-slate-400 italic text-center py-4">No topics added to this assessment.</p>
                  )}
                </div>
              </div>

              {/* Slider for Readiness */}
              <div className="space-y-4">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Readiness Adjustment</p>
                <input
                  type="range" min="0" max="100"
                  value={exam.readiness}
                  onChange={(e) => onUpdateReadiness(exam.id, parseInt(e.target.value))}
                  className="w-full h-2 bg-slate-100 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-medical-600"
                />
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
                {exam.studyMaterials && (
                  <a
                    href={exam.studyMaterials}
                    target="_blank" rel="noopener noreferrer"
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-100 transition-all"
                  >
                    <BookOpen size={14} /> Study Materials <ExternalLink size={10} />
                  </a>
                )}
                <button
                  onClick={() => onEdit(exam)}
                  className="flex-1 px-4 py-3 bg-medical-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-medical-600/20 active:scale-95"
                >
                  Edit Details
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default ExamCard;
