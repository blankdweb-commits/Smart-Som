import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';

const FlashcardForm = ({ isOpen, onClose, onSubmit, initialData = null }) => {
  const [formData, setFormData] = useState({
    subject: '',
    topic: '',
    question: '',
    answer: '',
    difficulty: 'Moderate',
    important: false
  });

  useEffect(() => {
    if (initialData) {
      setFormData(initialData);
    } else {
      setFormData({
        subject: '',
        topic: '',
        question: '',
        answer: '',
        difficulty: 'Moderate',
        important: false
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

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
        <div className="flex justify-between items-center p-6 border-b border-slate-200 dark:border-slate-700">
          <h3 className="text-xl font-bold">{initialData ? 'Edit Flashcard' : 'Create New Flashcard'}</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Subject</label>
              <input
                type="text"
                name="subject"
                list="subjects-list"
                value={formData.subject}
                onChange={handleChange}
                required
                placeholder="e.g., Anatomy"
                className="w-full px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 focus:ring-2 focus:ring-medical-500 outline-none"
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
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Difficulty</label>
              <select
                name="difficulty"
                value={formData.difficulty}
                onChange={handleChange}
                className="w-full px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 focus:ring-2 focus:ring-medical-500 outline-none"
              >
                <option value="Easy">Easy</option>
                <option value="Moderate">Moderate</option>
                <option value="Hard">Hard</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Topic</label>
            <input
              type="text"
              name="topic"
              value={formData.topic}
              onChange={handleChange}
              required
              placeholder="e.g., Cardiac Cycle"
              className="w-full px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 focus:ring-2 focus:ring-medical-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Question (Front)</label>
            <textarea
              name="question"
              value={formData.question}
              onChange={handleChange}
              required
              rows="2"
              className="w-full px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 focus:ring-2 focus:ring-medical-500 outline-none resize-none"
            ></textarea>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Answer (Back)</label>
            <textarea
              name="answer"
              value={formData.answer}
              onChange={handleChange}
              required
              rows="3"
              className="w-full px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 focus:ring-2 focus:ring-medical-500 outline-none resize-none"
            ></textarea>
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              id="important"
              name="important"
              checked={formData.important}
              onChange={handleChange}
              className="h-4 w-4 text-medical-600 focus:ring-medical-500 border-slate-300 rounded"
            />
            <label htmlFor="important" className="ml-2 block text-sm text-slate-700 dark:text-slate-300">
              Mark as High-Yield / Important
            </label>
          </div>

          <button
            type="submit"
            className="w-full py-3 bg-medical-600 hover:bg-medical-700 text-white rounded-lg font-bold transition-colors mt-4"
          >
            {initialData ? 'Update Card' : 'Create Card'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default FlashcardForm;
