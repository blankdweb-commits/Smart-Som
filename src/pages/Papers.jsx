import React, { useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { FileUp, Search, Play, BookOpen, AlertCircle, Loader2, CheckCircle2, ArrowRight } from '../components/Icons';
import { extractTextFromFile, parseQuestionsAndAnswers } from '../utils/fileParser';
import Toast from '../components/Toast';

const Papers = () => {
  const { importFlashcards } = useAppContext();
  const [isUploading, setIsUploading] = useState(false);
  const [toast, setToast] = useState(null);
  const [activeTab, setActiveTab] = useState('upload'); // 'upload' or 'browse'

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setIsUploading(true);
    setToast({ message: "Starting AI Analysis...", type: 'info' });

    try {
      const text = await extractTextFromFile(file);
      setToast({ message: "Analyzing medical concepts...", type: 'info' });

      // Artificial delay for better UX and to ensure heavy processing doesn't freeze UI
      await new Promise(resolve => setTimeout(resolve, 1500));

      const parsedCards = parseQuestionsAndAnswers(text);

      if (parsedCards.length > 0) {
        const enhancedCards = parsedCards.map(card => ({
          ...card,
          category: 'Past Question',
          source: file.name,
          level: 'Year 1', // Default
          semester: 'Semester 1' // Default
        }));

        const count = importFlashcards(enhancedCards);
        setToast({ message: `Success! Generated ${count} cards from ${file.name}.`, type: 'success' });
      } else {
        setToast({ message: "No clear questions detected in this document.", type: 'error' });
      }
    } catch (error) {
      setToast({ message: "Error parsing file: " + error.message, type: 'error' });
    } finally {
      setIsUploading(false);
      e.target.value = null;
    }
  };

  return (
    <div className="space-y-6 pb-20 animate-in fade-in duration-500">
      <header className="space-y-2">
        <h2 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">Past Questions</h2>
        <p className="text-slate-500 dark:text-slate-400 font-medium">Train your AI with past examination papers to generate high-yield flashcards.</p>
      </header>

      <div className="flex p-1 bg-slate-100 dark:bg-slate-800 rounded-2xl w-full sm:w-fit sticky top-20 z-30 shadow-sm">
        <button
          onClick={() => setActiveTab('upload')}
          className={`flex-1 sm:flex-none px-4 sm:px-6 py-2.5 rounded-xl font-black text-[10px] sm:text-sm uppercase tracking-widest transition-all ${activeTab === 'upload' ? 'bg-white dark:bg-slate-700 text-medical-600 shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
        >
          Upload & Train
        </button>
        <button
          onClick={() => setActiveTab('browse')}
          className={`flex-1 sm:flex-none px-4 sm:px-6 py-2.5 rounded-xl font-black text-[10px] sm:text-sm uppercase tracking-widest transition-all ${activeTab === 'browse' ? 'bg-white dark:bg-slate-700 text-medical-600 shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
        >
          Browse Library
        </button>
      </div>

      {activeTab === 'upload' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white dark:bg-slate-800 p-6 sm:p-8 rounded-[2.5rem] shadow-soft border border-slate-100 dark:border-slate-700 flex flex-col items-center justify-center text-center space-y-6 min-h-[300px] sm:min-h-[400px]">
            <div className="w-20 h-20 bg-medical-50 dark:bg-medical-900/30 text-medical-600 rounded-3xl flex items-center justify-center">
              {isUploading ? <Loader2 size={40} className="animate-spin" /> : <FileUp size={40} />}
            </div>
            <div className="space-y-2">
              <h3 className="text-2xl font-bold text-slate-900 dark:text-white">Upload Documents</h3>
              <p className="text-slate-500 dark:text-slate-400 max-w-xs mx-auto">Upload PDF, DOCX, or images of past questions to begin AI extraction.</p>
            </div>
            <label className={`cursor-pointer px-8 py-4 bg-medical-600 hover:bg-medical-700 text-white rounded-2xl font-bold shadow-lg shadow-medical-600/20 transition-all active:scale-95 flex items-center gap-2 ${isUploading ? 'opacity-50 pointer-events-none' : ''}`}>
              {isUploading ? 'Processing...' : 'Select File'}
              <input type="file" className="hidden" onChange={handleFileUpload} accept=".pdf,.docx,.txt,image/*" disabled={isUploading} />
            </label>
          </div>

          <div className="space-y-4">
            <div className="bg-indigo-50 dark:bg-indigo-900/20 p-6 rounded-3xl border border-indigo-100 dark:border-indigo-800/50">
              <h4 className="text-indigo-900 dark:text-indigo-300 font-bold flex items-center gap-2 mb-2">
                <AlertCircle size={18} />
                How it works
              </h4>
              <ul className="space-y-3">
                {[
                  "Upload a past question paper or lecture note.",
                  "AI identifies question patterns and key answers.",
                  "High-yield flashcards are automatically generated.",
                  "New cards are added to your personal library."
                ].map((text, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm text-indigo-700 dark:text-indigo-400">
                    <div className="mt-1 w-5 h-5 rounded-full bg-white dark:bg-slate-800 flex items-center justify-center text-[10px] font-black shrink-0">{i+1}</div>
                    {text}
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-slate-100 dark:border-slate-700">
              <h4 className="text-slate-900 dark:text-white font-bold mb-4">Supported Formats</h4>
              <div className="grid grid-cols-2 gap-3">
                {['PDF Documents', 'Word Files', 'Images/Photos', 'Text Files'].map(format => (
                  <div key={format} className="flex items-center gap-2 text-xs font-bold text-slate-500">
                    <CheckCircle2 size={14} className="text-emerald-500" />
                    {format}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 overflow-hidden">
          <div className="p-12 text-center space-y-4">
            <div className="w-16 h-16 bg-slate-50 dark:bg-slate-900 text-slate-400 rounded-full flex items-center justify-center mx-auto">
              <BookOpen size={32} />
            </div>
            <h3 className="text-xl font-bold text-slate-900 dark:text-white">No papers found</h3>
            <p className="text-slate-500 max-w-xs mx-auto">Your uploaded papers and study materials will appear here once processed.</p>
            <button onClick={() => setActiveTab('upload')} className="text-medical-600 font-bold text-sm flex items-center justify-center gap-1 mx-auto">
              Upload your first paper <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
};

export default Papers;
