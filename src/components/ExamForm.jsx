import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';

const ExamForm = ({ isOpen, onClose, onSubmit, initialData = null }) => {
  const [formData, setFormData] = useState({
    title: '',
    date: '',
    time: '',
    venue: ''
  });

  useEffect(() => {
    if (initialData) {
      const timer = setTimeout(() => setFormData(initialData), 0);
      return () => clearTimeout(timer);
    } else {
      const timer = setTimeout(() => setFormData({
        title: '',
        date: '',
        time: '',
        venue: ''
      }), 0);
      return () => clearTimeout(timer);
    }
  }, [initialData, isOpen]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-md animate-in fade-in duration-300">
      <div className="bg-white dark:bg-slate-800 rounded-t-[2.5rem] sm:rounded-[2.5rem] w-full max-w-lg shadow-clinical overflow-hidden animate-in slide-in-from-bottom-full sm:zoom-in-95 duration-500">
        <div className="flex justify-between items-center p-8 border-b border-slate-100 dark:border-slate-700">
          <div>
            <h3 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">{initialData ? 'Edit Assessment' : 'New Assessment'}</h3>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Clinical Timetable</p>
          </div>
          <button onClick={onClose} className="p-2 bg-slate-50 dark:bg-slate-700 rounded-xl text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-8 space-y-6">
          <div>
            <label className="block text-xs font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2 ml-1">Assessment Course Title</label>
            <input
              type="text"
              name="title"
              value={formData.title}
              onChange={handleChange}
              required
              placeholder="e.g., Fundamentals of Nursing"
              className="w-full px-5 py-4 rounded-2xl bg-white dark:bg-slate-900 border-2 border-slate-50 dark:border-slate-800 focus:border-medical-500 focus:ring-0 outline-none transition-all font-bold dark:text-white"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <label className="block text-xs font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2 ml-1">Date</label>
              <input
                type="date"
                name="date"
                value={formData.date}
                onChange={handleChange}
                required
                className="w-full px-5 py-3 rounded-2xl bg-white dark:bg-slate-900 border-2 border-slate-50 dark:border-slate-800 focus:border-medical-500 outline-none transition-all font-bold dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2 ml-1">Time</label>
              <input
                type="time"
                name="time"
                value={formData.time}
                onChange={handleChange}
                required
                className="w-full px-5 py-3 rounded-2xl bg-white dark:bg-slate-900 border-2 border-slate-50 dark:border-slate-800 focus:border-medical-500 outline-none transition-all font-bold dark:text-white"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2 ml-1">Venue / Clinical Lab</label>
            <input
              type="text"
              name="venue"
              value={formData.venue}
              onChange={handleChange}
              required
              placeholder="e.g., Main Clinical Lab"
              className="w-full px-5 py-4 rounded-2xl bg-white dark:bg-slate-900 border-2 border-slate-50 dark:border-slate-800 focus:border-medical-500 outline-none transition-all font-bold dark:text-white"
            />
          </div>

          <button
            type="submit"
            className="w-full py-5 bg-medical-600 hover:bg-medical-700 text-white rounded-2xl font-black shadow-clinical transition-all active:scale-[0.98] uppercase tracking-[0.2em] text-sm mt-4"
          >
            {initialData ? 'Update Assessment' : 'Save to Timetable'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default ExamForm;
