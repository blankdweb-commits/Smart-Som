import React, { useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { Save, Upload, FileText, X, CheckCircle2, AlertCircle } from './Icons';
import { motion } from 'framer-motion';

const QuestionBankManager = () => {
  const { addRichardsQuestions } = useAppContext();
  const [jsonInput, setJsonInput] = useState('');
  const [status, setStatus] = useState({ type: null, message: '' });
  const [isProcessing, setIsCompleted] = useState(false);

  const handleImport = () => {
    try {
      const data = JSON.parse(jsonInput);
      if (!data.flashcards || !Array.isArray(data.flashcards)) {
        throw new Error('Invalid format: Missing flashcards array');
      }

      // Map to internal format
      const formatted = data.flashcards.map(q => ({
        id: q.id || `richards-${Math.random().toString(36).substr(2, 9)}`,
        question: q.question,
        correctAnswer: q.answer_text || q.correct_answer,
        options: q.options || (q.question.match(/\((a|b|c|d)\)\s+([^,)]+)/g)?.map(m => m.replace(/\((a|b|c|d)\)\s+/, '').trim()) || []),
        rationale: q.explanation || q.rationale,
        subject: data.metadata?.title || 'Cardiovascular Richards',
        source: data.metadata?.source || 'Richards Question Bank',
        important: true
      }));

      addRichardsQuestions(formatted);
      setStatus({ type: 'success', message: `Successfully imported ${formatted.length} questions from ${data.metadata?.source || 'Richards Bank'}` });
      setJsonInput('');
      setIsCompleted(true);
      setTimeout(() => setIsCompleted(false), 5000);
    } catch (err) {
      setStatus({ type: 'error', message: `Import Failed: ${err.message}` });
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 p-8 rounded-[2.5rem] shadow-clinical border border-slate-100 dark:border-slate-700">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h3 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight">Richard's Question Bank Manager</h3>
          <p className="text-xs text-slate-500 mt-1">Bulk import nursing questions in JSON format.</p>
        </div>
        <div className="p-3 bg-medical-50 text-medical-600 rounded-2xl">
          <FileText size={24} />
        </div>
      </div>

      <div className="space-y-6">
        <div className="relative">
          <textarea
            value={jsonInput}
            onChange={(e) => setJsonInput(e.target.value)}
            placeholder='Paste JSON here... { "metadata": { ... }, "flashcards": [ ... ] }'
            className="w-full h-64 p-6 bg-slate-50 dark:bg-slate-900/50 rounded-3xl border border-slate-100 dark:border-slate-800 font-mono text-xs focus:ring-2 focus:ring-medical-500 outline-none resize-none"
          />
          {jsonInput && (
            <button
              onClick={() => setJsonInput('')}
              className="absolute top-4 right-4 p-2 bg-white dark:bg-slate-800 rounded-full shadow-md text-slate-400 hover:text-red-500"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {status.type && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`p-4 rounded-2xl flex items-center gap-3 ${status.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-red-50 text-red-700 border border-red-100'}`}
          >
            {status.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
            <p className="text-xs font-bold">{status.message}</p>
          </motion.div>
        )}

        <div className="flex gap-4">
          <button
            onClick={handleImport}
            disabled={!jsonInput || isProcessing}
            className="flex-1 py-5 bg-slate-900 text-white rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Upload size={18} /> Process Bulk Import
          </button>
          <button
            className="px-8 py-5 bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 text-slate-400 rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-slate-50 transition-all"
          >
            CSV Format
          </button>
        </div>
      </div>
    </div>
  );
};

export default QuestionBankManager;
