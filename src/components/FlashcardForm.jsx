import React, { useState, useEffect } from 'react';
import { X, Sparkles, Loader2 } from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { generateFlashcardWithAI } from '../utils/ai';
import MobileFriendlySelect from './MobileFriendlySelect';

const FlashcardForm = ({ isOpen, onClose, onSubmit, initialData = null }) => {
  const [isGenerating, setIsGenerating] = useState(false);
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
    semester: 'Semester 1'
  });

  useEffect(() => {
    if (initialData) {
      setFormData({
        ...formData,
        ...initialData,
        hint: initialData.hint || ''
      });
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
        semester: 'Semester 1'
      });
    }
  }, [initialData, isOpen]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleAiGenerate = async () => {
    if (!formData.topic || !formData.subject) {
      alert('Please enter a Subject and Topic first');
      return;
    }

    setIsGenerating(true);
    try {
      const result = await generateFlashcardWithAI(formData.topic, formData.subject);
      setFormData(prev => ({
        ...prev,
        question: result.question,
        answer: result.answer
      }));
    } catch (error) {
      alert(error.message);
    } finally {
      setIsGenerating(false);
    }
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

        <form onSubmit={handleSubmit} className="p-8 space-y-6 overflow-y-auto no-scrollbar">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <MobileFriendlySelect
              label="Track"
              value={formData.category}
              options={['Academic', 'NCLEX', 'NMCN']}
              onChange={(e) => setFormData(prev => ({ ...prev, category: e.target.value }))}
            />
            <MobileFriendlySelect
              label="Year / Level"
              value={formData.level}
              options={['Year 1', 'Year 2', 'Year 3', 'Preparation', 'Council Exam']}
              onChange={(e) => setFormData(prev => ({ ...prev, level: e.target.value }))}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <label className="block text-xs font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2 ml-1">Clinical Subject</label>
              <input
                type="text"
                name="subject"
                list="subjects-list"
                value={formData.subject}
                onChange={handleChange}
                required
                placeholder="e.g., Anatomy"
                className="w-full px-5 py-3 rounded-2xl bg-white dark:bg-slate-900 border-2 border-slate-50 dark:border-slate-800 focus:border-medical-500 focus:ring-0 outline-none transition-all font-bold dark:text-white"
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
            <MobileFriendlySelect
              label="Difficulty"
              value={formData.difficulty}
              options={['Easy', 'Moderate', 'Hard']}
              onChange={(e) => setFormData(prev => ({ ...prev, difficulty: e.target.value }))}
            />
          </div>

          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="block text-xs font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest ml-1">Specific Topic</label>
              <button
                type="button"
                onClick={handleAiGenerate}
                disabled={isGenerating || !formData.topic || !formData.subject}
                className="flex items-center gap-2 px-3 py-1 bg-medical-50 dark:bg-medical-900/30 text-[10px] font-black uppercase tracking-widest text-medical-600 dark:text-medical-400 rounded-full hover:bg-medical-100 transition-all disabled:opacity-50"
              >
                {isGenerating ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Sparkles size={12} />
                )}
                AI Assist
              </button>
            </div>
            <input
              type="text"
              name="topic"
              value={formData.topic}
              onChange={handleChange}
              required
              placeholder="e.g., Cardiac Cycle"
              className="w-full px-5 py-3 rounded-2xl bg-white dark:bg-slate-900 border-2 border-slate-50 dark:border-slate-800 focus:border-medical-500 outline-none transition-all font-bold dark:text-white"
            />
          </div>

          <div>
            <label className="block text-xs font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2 ml-1">Clinical Question</label>
            <textarea
              name="question"
              value={formData.question}
              onChange={handleChange}
              required
              rows="2"
              className="w-full px-5 py-4 rounded-2xl bg-white dark:bg-slate-900 border-2 border-slate-50 dark:border-slate-800 focus:border-medical-500 outline-none transition-all font-bold dark:text-white resize-none leading-relaxed"
              placeholder="Enter the question for the front of the card..."
            ></textarea>
          </div>

          <div>
            <label className="block text-xs font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2 ml-1">Recall Hint (Optional)</label>
            <input
              type="text"
              name="hint"
              value={formData.hint}
              onChange={handleChange}
              placeholder="A clinical pearl to help recall..."
              className="w-full px-5 py-3 rounded-2xl bg-white dark:bg-slate-900 border-2 border-slate-50 dark:border-slate-800 focus:border-medical-500 outline-none transition-all font-bold dark:text-white"
            />
          </div>

          <div>
            <label className="block text-xs font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2 ml-1">Detailed Answer</label>
            <textarea
              name="answer"
              value={formData.answer}
              onChange={handleChange}
              required
              rows="3"
              className="w-full px-5 py-4 rounded-2xl bg-white dark:bg-slate-900 border-2 border-slate-50 dark:border-slate-800 focus:border-medical-500 outline-none transition-all font-bold dark:text-white resize-none leading-relaxed"
              placeholder="Provide the high-yield answer here..."
            ></textarea>
          </div>

          <div className="flex items-center p-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border-2 border-transparent hover:border-medical-100 transition-all cursor-pointer">
            <input
              type="checkbox"
              id="important"
              name="important"
              checked={formData.important}
              onChange={handleChange}
              className="h-5 w-5 text-medical-600 focus:ring-0 border-slate-300 rounded-lg cursor-pointer"
            />
            <label htmlFor="important" className="ml-3 block text-sm font-bold text-slate-700 dark:text-slate-300 cursor-pointer">
              Mark as High-Yield Exam Topic
            </label>
          </div>

          <button
            type="submit"
            className="w-full py-5 bg-medical-600 hover:bg-medical-700 text-white rounded-2xl font-black shadow-clinical transition-all active:scale-[0.98] uppercase tracking-[0.2em] text-sm"
          >
            {initialData ? 'Update Clinical Card' : 'Save New Card'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default FlashcardForm;
