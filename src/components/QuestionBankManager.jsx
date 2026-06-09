import React, { useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { Upload, FileText, X, CheckCircle2, AlertCircle, Loader2 } from './Icons';
import { motion } from 'framer-motion';

const QuestionBankManager = () => {
  const { addRichardsQuestions } = useAppContext();
  const [jsonInput, setJsonInput] = useState('');
  const [status, setStatus] = useState({ type: null, message: '' });
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  const handleImport = async () => {
    setIsProcessing(true);
    setStatus({ type: null, message: '' });
    setProgress(0);

    try {
      const data = JSON.parse(jsonInput);
      const rawCards = data.flashcards || data.questions;

      if (!rawCards || !Array.isArray(rawCards)) {
        throw new Error('Invalid format: Missing flashcards or questions array');
      }

      const total = rawCards.length;
      const batchSize = 500;
      const batches = Math.ceil(total / batchSize);

      for (let i = 0; i < batches; i++) {
        const start = i * batchSize;
        const end = Math.min(start + batchSize, total);
        const batch = rawCards.slice(start, end).map((q, idx) => ({
          id: `rich_${q.id || Math.random().toString(36).substr(2, 9)}_${Date.now()}_${start + idx}`,
          question: q.question || "Untitled Question",
          correctAnswer: q.answer_text || q.correct_answer || q.answer || "N/A",
          options: Array.isArray(q.options) ? q.options : [],
          rationale: q.explanation || q.rationale || "Rationale provided by Apex Scholars.",
          hint: q.hint || q.tip || "Focus on clinical reasoning.",
          subject: q.subject || data.metadata?.title || 'General Nursing',
          source: q.source || data.metadata?.source || 'Richard Question Bank',
          important: true,
          isImported: true
        }));

        addRichardsQuestions(batch);
        setProgress(Math.round(((i + 1) / batches) * 100));

        await new Promise(resolve => setTimeout(resolve, 50));
      }

      setStatus({ type: 'success', message: `Successfully imported ${total} questions.` });
      setJsonInput('');
    } catch (err) {
      setStatus({ type: 'error', message: `Import Failed: ${err.message}` });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 p-8 rounded-[2.5rem] shadow-clinical border border-slate-100 dark:border-slate-700">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h3 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight">Apex Question Bank Manager</h3>
          <p className="text-xs text-slate-500 mt-1">Bulk import nursing questions with metadata validation.</p>
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
            disabled={isProcessing}
            placeholder='Paste JSON here...'
            className="w-full h-64 p-6 bg-slate-50 dark:bg-slate-900/50 rounded-3xl border border-slate-100 dark:border-slate-800 font-mono text-xs focus:ring-2 focus:ring-medical-500 outline-none resize-none"
          />
          {jsonInput && !isProcessing && (
            <button onClick={() => setJsonInput('')} className="absolute top-4 right-4 p-2 bg-white dark:bg-slate-800 rounded-full shadow-md text-slate-400 hover:text-red-500">
              <X size={16} />
            </button>
          )}
          {isProcessing && (
            <div className="absolute inset-0 bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm rounded-3xl flex flex-col items-center justify-center space-y-4">
              <Loader2 size={40} className="animate-spin text-medical-600" />
              <div className="text-center">
                <p className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-widest">Processing Batch...</p>
                <p className="text-xs font-bold text-medical-600 mt-1">{progress}% Complete</p>
              </div>
            </div>
          )}
        </div>

        {status.type && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={`p-4 rounded-2xl flex items-center gap-3 ${status.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-red-50 text-red-700 border border-red-100'}`}>
            {status.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
            <p className="text-xs font-bold">{status.message}</p>
          </motion.div>
        )}

        <button onClick={handleImport} disabled={!jsonInput || isProcessing} className="w-full py-5 bg-slate-900 text-white rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50">
           {isProcessing ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
           {isProcessing ? 'Processing...' : 'Process Bulk Import'}
        </button>
      </div>
    </div>
  );
};

export default QuestionBankManager;
