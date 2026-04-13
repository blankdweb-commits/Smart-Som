import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';

const FlashcardForm = ({ isOpen, onClose, onSubmit, initialData = null }) => {
  const [formData, setFormData] = useState({
    subject: '',
    topic: '',
    question: '',
    answer: '',
    hint: '',
    difficulty: 'Moderate',
    important: false,
    category: 'Academic',
    level: 'Year 1',
    semester: 'Semester 1',
    program: 'nd-nursing'
  });

  useEffect(() => {
    if (!isOpen) return;

    const timeoutId = setTimeout(() => {
      if (initialData) {
        setFormData(prev => ({
          ...prev,
          ...initialData,
          hint: initialData.hint || ''
        }));
      } else {
        setFormData({
          subject: '',
          topic: '',
          question: '',
          answer: '',
          hint: '',
          difficulty: 'Moderate',
          important: false,
          category: 'Academic',
          level: 'Year 1',
          semester: 'Semester 1',
          program: 'nd-nursing'
        });
      }
    }, 0);

    return () => clearTimeout(timeoutId);
  }, [initialData, isOpen]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-md animate-in fade-in duration-300">
      <div className="bg-white dark:bg-slate-800 rounded-t-[2.5rem] sm:rounded-[2.5rem] w-full max-w-lg shadow-clinical overflow-hidden animate-in slide-in-from-bottom-full sm:zoom-in-95 duration-500 max-h-[90vh] flex flex-col">
        <div className="flex justify-between items-center p-8 border-b border-slate-100 dark:border-slate-700">
          <div>
            <h3 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">{initialData ? 'Edit Card' : 'New Flashcard'}</h3>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Curriculum Management</p>
          </div>
          <button onClick={onClose} className="p-2 bg-slate-50 dark:bg-slate-700 rounded-xl text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 sm:p-8 space-y-4 sm:space-y-6 overflow-y-auto no-scrollbar">
          <div className="grid grid-cols-2 gap-4 sm:gap-6">
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1 ml-1">Track</label>
              <select
                name="category"
                value={formData.category}
                onChange={handleChange}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 focus:border-medical-500 outline-none font-bold text-sm"
              >
                <option value="Academic">Academic</option>
                <option value="NCLEX">NCLEX</option>
                <option value="NMCN">NMCN</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1 ml-1">Level</label>
              <select
                name="level"
                value={formData.level}
                onChange={handleChange}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 focus:border-medical-500 outline-none font-bold text-sm"
              >
                <option value="Year 1">Year 1</option>
                <option value="Year 2">Year 2</option>
                <option value="Year 3">Year 3</option>
                <option value="Preparation">Preparation</option>
                <option value="Council Exam">Council Exam</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1 ml-1">Program</label>
            <select
              name="program"
              value={formData.program || 'nd-nursing'}
              onChange={handleChange}
              className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 focus:border-medical-500 outline-none font-bold text-sm"
            >
              <option value="nd-nursing">General Nursing (ND)</option>
              <option value="midwifery">Midwifery</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:gap-6">
            <div>
              <label className="block text-xs font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2 ml-1">Subject</label>
              <input
                type="text"
                name="subject"
                list="subjects-list"
                value={formData.subject}
                onChange={handleChange}
                required
                placeholder="e.g., Anatomy"
                className="w-full px-4 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 focus:border-medical-500 outline-none transition-all font-bold text-sm"
              />
              <datalist id="subjects-list">
                <option value="Anatomy" />
                <option value="Pharmacology" />
                <option value="Medical-Surgical Nursing" />
                <option value="Midwifery" />
                <option value="Fundamentals" />
                <option value="Microbiology" />
                <option value="Primary Health Care" />
                <option value="Reproductive Health" />
                <option value="Community Health Nursing" />
                <option value="Mental Health Nursing" />
              </datalist>
            </div>
            <div>
              <label className="block text-xs font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2 ml-1">Difficulty</label>
              <select
                name="difficulty"
                value={formData.difficulty}
                onChange={handleChange}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 focus:border-medical-500 outline-none font-bold text-sm"
              >
                <option value="Easy">Easy</option>
                <option value="Moderate">Moderate</option>
                <option value="Hard">Hard</option>
              </select>
            </div>
          </div>

          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="block text-xs font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest ml-1">Topic</label>
            </div>
            <input
              type="text"
              name="topic"
              value={formData.topic}
              onChange={handleChange}
              required
              placeholder="e.g., Cardiac Cycle"
              className="w-full px-4 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 focus:border-medical-500 outline-none transition-all font-bold text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1 ml-1">Question</label>
            <textarea
              name="question"
              value={formData.question}
              onChange={handleChange}
              required
              rows="2"
              className="w-full px-4 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 focus:border-medical-500 outline-none transition-all font-bold text-sm resize-none"
              placeholder="Front of card..."
            ></textarea>
          </div>

          <div>
            <label className="block text-xs font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1 ml-1">Hint (Optional)</label>
            <input
              type="text"
              name="hint"
              value={formData.hint}
              onChange={handleChange}
              placeholder="A clue to help recall..."
              className="w-full px-4 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 focus:border-medical-500 outline-none transition-all font-bold text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1 ml-1">Answer</label>
            <textarea
              name="answer"
              value={formData.answer}
              onChange={handleChange}
              required
              rows="3"
              className="w-full px-4 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 focus:border-medical-500 outline-none transition-all font-bold text-sm resize-none"
              placeholder="Back of card..."
            ></textarea>
          </div>

          <div className="flex items-center p-3 bg-slate-50 dark:bg-slate-900/50 rounded-xl">
            <input
              type="checkbox"
              id="important"
              name="important"
              checked={formData.important}
              onChange={handleChange}
              className="h-4 w-4 text-medical-600 focus:ring-0 border-slate-300 rounded"
            />
            <label htmlFor="important" className="ml-2 block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
              High-Yield Exam Topic
            </label>
          </div>

          <button
            type="submit"
            className="w-full py-3 bg-medical-600 hover:bg-medical-700 text-white rounded-xl font-bold transition-all active:scale-[0.98] uppercase tracking-widest text-xs"
          >
            {initialData ? 'Update Card' : 'Save Card'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default FlashcardForm;
