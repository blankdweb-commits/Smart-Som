import React, { useState, useEffect, useMemo } from 'react';
import { X, Plus, Trash2, Bell, Shield, Info, LinkIcon, CheckCircle2, Book } from './Icons';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppContext } from '../context/AppContext';
import AutocompleteInput from './AutocompleteInput';

const ExamForm = ({ isOpen, onClose, onSubmit, initialData = null }) => {
  const { curriculumSubjects, exams } = useAppContext();
  const [formData, setFormData] = useState({
    title: '',
    date: '',
    time: '',
    venue: '',
    lecturer: '',
    type: 'Written',
    priority: 'Medium',
    notes: '',
    studyMaterials: '',
    topics: [],
    reminders: ['1 day before']
  });

  const [newTopic, setNewTopic] = useState('');

  const recentSubjects = useMemo(() => {
    const subjects = new Set();
    exams.forEach(e => {
      if (e.title) subjects.add(e.title);
    });
    return Array.from(subjects).slice(0, 5);
  }, [exams]);

  useEffect(() => {
    if (initialData) {
      setFormData({
        ...formData,
        ...initialData,
        topics: initialData.topics || [],
        reminders: initialData.reminders || ['1 day before']
      });
    } else {
      setFormData({
        title: '',
        date: '',
        time: '',
        venue: '',
        lecturer: '',
        type: 'Written',
        priority: 'Medium',
        notes: '',
        studyMaterials: '',
        topics: [],
        reminders: ['1 day before']
      });
    }
  }, [initialData, isOpen]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const addTopic = () => {
    if (newTopic.trim()) {
      setFormData(prev => ({
        ...prev,
        topics: [...prev.topics, { name: newTopic.trim(), completed: false }]
      }));
      setNewTopic('');
    }
  };

  const removeTopic = (index) => {
    setFormData(prev => ({
      ...prev,
      topics: prev.topics.filter((_, i) => i !== index)
    }));
  };

  const toggleReminder = (r) => {
    setFormData(prev => ({
      ...prev,
      reminders: prev.reminders.includes(r)
        ? prev.reminders.filter(x => x !== r)
        : [...prev.reminders, r]
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    // Auto-populate related fields if title matches an existing exam
    let finalData = { ...formData };
    if (!initialData) {
      const match = exams.find(e => e.title.toLowerCase() === formData.title.toLowerCase());
      if (match) {
        finalData = {
          ...finalData,
          venue: formData.venue || match.venue,
          lecturer: formData.lecturer || match.lecturer,
          type: formData.type === 'Written' ? match.type : formData.type
        };
      }
    }

    onSubmit(finalData);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-md animate-in fade-in duration-300">
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        className="bg-white dark:bg-slate-800 rounded-t-[3rem] sm:rounded-[3rem] w-full max-w-2xl h-[90vh] sm:h-auto sm:max-h-[85vh] shadow-2xl overflow-hidden flex flex-col transition-all"
      >
        {/* Header */}
        <div className="p-8 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50/50 dark:bg-slate-900/20 shrink-0">
          <div>
            <h3 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">{initialData ? 'Update Exam' : 'Schedule Exam'}</h3>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mt-1">Academic & Clinical Assessment</p>
          </div>
          <button onClick={onClose} className="p-3 bg-white dark:bg-slate-700 rounded-2xl text-slate-400 hover:text-slate-600 shadow-sm active:scale-90 transition-all">
            <X size={24} />
          </button>
        </div>

        {/* Scrollable Body */}
        <form id="exam-form" onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-8 space-y-10 custom-scrollbar pb-32">

          {/* Basic Information Section */}
          <section className="space-y-6">
            <h4 className="text-xs font-black text-medical-600 uppercase tracking-[0.2em] flex items-center gap-2">
              <Info size={14} /> Basic Details
            </h4>
            <div className="space-y-4">
              <div className="group">
                <AutocompleteInput
                  label="Assessment Title"
                  value={formData.title}
                  onChange={(val) => setFormData(prev => ({ ...prev, title: val }))}
                  suggestions={curriculumSubjects}
                  placeholder="e.g., Medical Surgical Nursing I"
                />

                {recentSubjects.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-3 ml-1">
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest w-full mb-1">Recent</p>
                    {recentSubjects.map(s => (
                      <button
                        key={s} type="button"
                        onClick={() => setFormData(prev => ({ ...prev, title: s }))}
                        className="px-3 py-1.5 bg-slate-100 dark:bg-slate-900 text-[10px] font-bold text-slate-500 dark:text-slate-400 rounded-lg hover:bg-medical-50 hover:text-medical-600 transition-all border border-transparent hover:border-medical-200"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Date</label>
                  <input
                    type="date" name="date" value={formData.date} onChange={handleChange} required
                    className="w-full px-6 py-4 rounded-2xl bg-slate-50 dark:bg-slate-900 border-2 border-transparent focus:border-medical-500 outline-none transition-all font-bold dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Time</label>
                  <input
                    type="time" name="time" value={formData.time} onChange={handleChange} required
                    className="w-full px-6 py-4 rounded-2xl bg-slate-50 dark:bg-slate-900 border-2 border-transparent focus:border-medical-500 outline-none transition-all font-bold dark:text-white"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Venue</label>
                  <input
                    type="text" name="venue" value={formData.venue} onChange={handleChange} required
                    placeholder="e.g., Clinical Lab 2"
                    className="w-full px-6 py-4 rounded-2xl bg-slate-50 dark:bg-slate-900 border-2 border-transparent focus:border-medical-500 outline-none transition-all font-bold dark:text-white"
                  />
                </div>
                <div>
                  <AutocompleteInput
                    label="Lecturer"
                    value={formData.lecturer}
                    onChange={(val) => setFormData(prev => ({ ...prev, lecturer: val }))}
                    suggestions={Array.from(new Set(exams.map(e => e.lecturer).filter(Boolean)))}
                    placeholder="e.g., Dr. Smith"
                    icon={<Shield size={18} />}
                  />
                </div>
              </div>
            </div>
          </section>

          {/* Configuration Section */}
          <section className="space-y-6">
            <h4 className="text-xs font-black text-indigo-600 uppercase tracking-[0.2em] flex items-center gap-2">
              <Shield size={14} /> Exam Settings
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 ml-1">Exam Type</label>
                <div className="grid grid-cols-2 gap-2">
                  {['Written', 'CBT', 'Practical', 'Oral'].map(type => (
                    <button
                      key={type} type="button"
                      onClick={() => setFormData(prev => ({ ...prev, type }))}
                      className={`py-3 rounded-xl text-xs font-black uppercase tracking-widest border-2 transition-all ${formData.type === type ? 'bg-indigo-600 border-indigo-600 text-white shadow-lg shadow-indigo-600/20' : 'bg-slate-50 border-transparent text-slate-400 dark:bg-slate-900'}`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 ml-1">Priority Level</label>
                <div className="grid grid-cols-3 gap-2">
                  {['Low', 'Medium', 'High'].map(p => (
                    <button
                      key={p} type="button"
                      onClick={() => setFormData(prev => ({ ...prev, priority: p }))}
                      className={`py-3 rounded-xl text-xs font-black uppercase tracking-widest border-2 transition-all ${formData.priority === p ? (p === 'High' ? 'bg-red-600 border-red-600 text-white' : 'bg-medical-600 border-medical-600 text-white') : 'bg-slate-50 border-transparent text-slate-400 dark:bg-slate-900'}`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* Topics Checklist Section */}
          <section className="space-y-6">
            <h4 className="text-xs font-black text-emerald-600 uppercase tracking-[0.2em] flex items-center gap-2">
              <CheckCircle2 size={14} /> Study Topics
            </h4>
            <div className="space-y-4">
              <div className="flex gap-2">
                <input
                  type="text" value={newTopic} onChange={(e) => setNewTopic(e.target.value)}
                  placeholder="Add a topic to study..."
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTopic())}
                  className="flex-1 px-6 py-4 rounded-2xl bg-slate-50 dark:bg-slate-900 border-2 border-transparent focus:border-emerald-500 outline-none transition-all font-bold dark:text-white"
                />
                <button
                  type="button" onClick={addTopic}
                  className="p-4 bg-emerald-600 text-white rounded-2xl hover:bg-emerald-700 transition-all active:scale-95 shadow-lg shadow-emerald-600/20"
                >
                  <Plus size={24} />
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {formData.topics.map((t, i) => (
                  <div key={i} className="flex items-center gap-2 pl-4 pr-2 py-2 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 rounded-xl border border-emerald-100 dark:border-emerald-900/30 font-bold text-xs">
                    {t.name}
                    <button type="button" onClick={() => removeTopic(i)} className="p-1 hover:bg-emerald-100 dark:hover:bg-emerald-800 rounded-lg transition-colors">
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Smart Reminders Section */}
          <section className="space-y-6">
            <h4 className="text-xs font-black text-orange-600 uppercase tracking-[0.2em] flex items-center gap-2">
              <Bell size={14} /> Smart Reminders
            </h4>
            <div className="flex flex-wrap gap-2">
              {['1 week before', '3 days before', '1 day before', '1 hour before'].map(r => (
                <button
                  key={r} type="button"
                  onClick={() => toggleReminder(r)}
                  className={`px-4 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest border-2 transition-all ${formData.reminders.includes(r) ? 'bg-orange-500 border-orange-500 text-white shadow-lg shadow-orange-500/20' : 'bg-slate-50 border-transparent text-slate-400 dark:bg-slate-900'}`}
                >
                  {r}
                </button>
              ))}
            </div>
          </section>

          {/* Study Materials & Notes Section */}
          <section className="space-y-6">
             <h4 className="text-xs font-black text-blue-600 uppercase tracking-[0.2em] flex items-center gap-2">
              <LinkIcon size={14} /> Resources & Notes
            </h4>
            <div className="space-y-4">
              <input
                type="url" name="studyMaterials" value={formData.studyMaterials} onChange={handleChange}
                placeholder="Study Material Link (Google Drive, PDF, etc.)"
                className="w-full px-6 py-4 rounded-2xl bg-slate-50 dark:bg-slate-900 border-2 border-transparent focus:border-blue-500 outline-none transition-all font-bold dark:text-white"
              />
              <textarea
                name="notes" value={formData.notes} onChange={handleChange}
                placeholder="Additional notes for this exam..."
                rows={4}
                className="w-full px-6 py-4 rounded-2xl bg-slate-50 dark:bg-slate-900 border-2 border-transparent focus:border-blue-500 outline-none transition-all font-bold dark:text-white resize-none"
              />
            </div>
          </section>
        </form>

        {/* Sticky Footer Actions */}
        <div className="p-8 bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700 shrink-0">
          <button
            type="submit" form="exam-form"
            className="w-full py-5 bg-medical-600 hover:bg-medical-700 text-white rounded-2xl font-black shadow-xl shadow-medical-600/20 transition-all active:scale-[0.98] uppercase tracking-[0.2em] text-sm"
          >
            {initialData ? 'Sync Updates' : 'Confirm & Schedule'}
          </button>
        </div>
      </motion.div>
    </div>
  );
};

export default ExamForm;
