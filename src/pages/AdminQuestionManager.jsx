import React, { useState, useMemo } from 'react';
import { useAppContext } from '../context/AppContext';
import {
  FileUp,
  Search,
  Trash2,
  CheckCircle2,
  XCircle,
  Edit2,
  Plus,
  AlertTriangle,
  Loader2,
  Database,
  Filter,
  ArrowRight,
  Shield,
  Zap,
  HelpCircle,
  BookOpen
} from '../components/Icons';
import { motion, AnimatePresence } from 'framer-motion';
import Toast from '../components/Toast';
import FlashcardForm from '../components/FlashcardForm';

const AdminQuestionManager = () => {
  const { flashcards, addFlashcard, updateFlashcard, deleteFlashcard, importFlashcards } = useAppContext();
  const [toast, setToast] = useState(null);
  const [isImporting, setIsUploading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterSource, setFilterSource] = useState('All');
  const [filterStatus, setFilterStatus] = useState('All');
  const [editingCard, setEditingCard] = useState(null);
  const [isFormOpen, setIsFormOpen] = useState(false);

  const sources = useMemo(() => ['All', ...new Set(flashcards.map(c => c.source || 'Apex Core'))], [flashcards]);

  const filteredCards = useMemo(() => {
    return flashcards.filter(c => {
      const matchesSearch = c.question.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           c.subject.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesSource = filterSource === 'All' || c.source === filterSource;
      const matchesStatus = filterStatus === 'All' || (filterStatus === 'Approved' ? !c.isPending : c.isPending);
      return matchesSearch && matchesSource && matchesStatus;
    });
  }, [flashcards, searchTerm, filterSource, filterStatus]);

  const handleJsonImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setIsUploading(true);
    try {
      const text = await file.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (err) {
        throw new Error("Invalid JSON format. Please check the file structure.");
      }

      if (!Array.isArray(data)) {
        if (data.questions) data = data.questions;
        else if (data.flashcards) data = data.flashcards;
        else data = [data];
      }

      const validated = data.map(item => {
        const answer = item.correctAnswer || item.answer || item.a || "No answer provided.";
        return {
          question: item.question || item.q || "Untitled Question",
          answer: answer,
          correctAnswer: answer,
          options: Array.isArray(item.options) && item.options.length > 0 ? item.options : null,
          subject: item.subject || item.course || "General",
          topic: item.topic || "Clinical practice",
          source: item.source || "Imported Faculty Bank",
          category: item.category || "NCLEX",
          hint: item.hint || "Focus on clinical priority.",
          rationale: item.rationale || "Rationale pending faculty review.",
          difficulty: item.difficulty || "Moderate",
          level: item.level || "Year 1",
          semester: item.semester || "Semester 1",
          isPending: true
        };
      });

      const uniqueItems = validated.filter(newItem =>
        !flashcards.some(existing =>
          existing.question.toLowerCase().trim() === newItem.question.toLowerCase().trim()
        )
      );

      const duplicatesCount = validated.length - uniqueItems.length;

      if (uniqueItems.length > 0) {
        importFlashcards(uniqueItems);
        setToast({
          message: `Imported ${uniqueItems.length} items. ${duplicatesCount} duplicates skipped.`,
          type: 'success'
        });
      } else {
        setToast({ message: "No new items found. All items in file are duplicates.", type: 'info' });
      }
    } catch (error) {
      setToast({ message: error.message, type: 'error' });
    } finally {
      setIsUploading(false);
      e.target.value = null;
    }
  };

  const handleApprove = (id) => {
    updateFlashcard(id, { isPending: false });
    setToast({ message: "Question Approved", type: 'success' });
  };

  const handleEdit = (card) => {
    setEditingCard(card);
    setIsFormOpen(true);
  };

  const handleFormSubmit = (data) => {
    if (editingCard) {
      updateFlashcard(editingCard.id, data);
      setToast({ message: "Question Updated", type: 'success' });
    } else {
      addFlashcard(data);
      setToast({ message: "Question Added", type: 'success' });
    }
    setIsFormOpen(false);
    setEditingCard(null);
  };

  return (
    <div className="space-y-8 pb-32 max-w-7xl mx-auto px-4">
      <header className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-6">
        <div>
          <h1 className="text-4xl font-black text-slate-900 dark:text-white tracking-tight uppercase">Question Bank Manager</h1>
          <p className="text-slate-500 dark:text-slate-400 font-medium mt-1 uppercase tracking-widest text-[10px]">Content Governance & AI Training</p>
        </div>
        <div className="flex gap-3 w-full sm:w-auto">
           <button
             onClick={() => setIsFormOpen(true)}
             className="flex-1 sm:flex-none cursor-pointer px-6 py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-lg shadow-emerald-500/20 transition-all flex items-center justify-center gap-2"
           >
              <Plus size={16} />
              New Question
           </button>
           <label className="flex-1 sm:flex-none cursor-pointer px-6 py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-lg shadow-indigo-500/20 transition-all flex items-center justify-center gap-2">
              {isImporting ? <Loader2 size={16} className="animate-spin" /> : <Database size={16} />}
              Import JSON Bank
              <input type="file" className="hidden" onChange={handleJsonImport} accept=".json" disabled={isImporting} />
           </label>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
         <div className="md:col-span-2 relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
               type="text"
               placeholder="Search questions or subjects..."
               value={searchTerm}
               onChange={e => setSearchTerm(e.target.value)}
               className="w-full pl-12 pr-4 py-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 font-bold text-sm outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
            />
         </div>
         <select
            value={filterSource}
            onChange={e => setFilterSource(e.target.value)}
            className="px-4 py-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 font-bold text-sm outline-none shadow-sm"
         >
            {sources.map(s => <option key={s} value={s}>{s}</option>)}
         </select>
         <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className="px-4 py-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 font-bold text-sm outline-none shadow-sm"
         >
            <option value="All">All Status</option>
            <option value="Approved">Approved Only</option>
            <option value="Pending">Pending Review</option>
         </select>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-[2.5rem] shadow-clinical border border-slate-100 dark:border-slate-700 overflow-hidden">
         <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
               <thead>
                  <tr className="bg-slate-50 dark:bg-slate-900/50">
                     <th className="px-6 py-5 text-[10px] font-black uppercase tracking-widest text-slate-400">Content</th>
                     <th className="px-6 py-5 text-[10px] font-black uppercase tracking-widest text-slate-400">Meta</th>
                     <th className="px-6 py-5 text-[10px] font-black uppercase tracking-widest text-slate-400">Status</th>
                     <th className="px-6 py-5 text-[10px] font-black uppercase tracking-widest text-slate-400 text-right">Actions</th>
                  </tr>
               </thead>
               <tbody className="divide-y divide-slate-50 dark:divide-slate-700/50">
                  {filteredCards.slice(0, 50).map(card => (
                     <tr key={card.id} className="group hover:bg-slate-50/50 dark:hover:bg-slate-900/20 transition-colors">
                        <td className="px-6 py-6 max-w-md">
                           <p className="font-bold text-slate-900 dark:text-white leading-snug line-clamp-2 mb-1">{card.question}</p>
                           <p className="text-[10px] text-slate-400 font-medium truncate italic">"Ans: {card.answer}"</p>
                        </td>
                        <td className="px-6 py-6">
                           <div className="flex flex-col gap-1">
                              <span className="text-[9px] font-black text-indigo-600 bg-indigo-50 dark:bg-indigo-900/30 px-2 py-0.5 rounded-md w-fit">{card.subject}</span>
                              <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tighter">Source: {card.source || 'Apex Core'}</span>
                           </div>
                        </td>
                        <td className="px-6 py-6">
                           {card.isPending ? (
                              <span className="px-2 py-1 bg-amber-100 text-amber-700 rounded-md text-[9px] font-black uppercase tracking-widest">Pending</span>
                           ) : (
                              <span className="px-2 py-1 bg-emerald-100 text-emerald-700 rounded-md text-[9px] font-black uppercase tracking-widest">Active</span>
                           )}
                        </td>
                        <td className="px-6 py-6 text-right">
                           <div className="flex justify-end gap-2">
                              {card.isPending && (
                                 <button
                                    onClick={() => handleApprove(card.id)}
                                    className="p-2 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-lg transition-all"
                                    title="Approve Question"
                                 >
                                    <CheckCircle2 size={18} />
                                 </button>
                              )}
                              <button
                                 onClick={() => handleEdit(card)}
                                 className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-lg transition-all"
                              >
                                 <Edit2 size={18} />
                              </button>
                              <button
                                 onClick={() => deleteFlashcard(card.id)}
                                 className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all"
                              >
                                 <Trash2 size={18} />
                              </button>
                           </div>
                        </td>
                     </tr>
                  ))}
               </tbody>
            </table>
         </div>
         {filteredCards.length > 50 && (
            <div className="p-6 bg-slate-50 dark:bg-slate-900/30 text-center border-t border-slate-50 dark:border-slate-700">
               <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Showing 50 of {filteredCards.length} items</p>
            </div>
         )}
         {filteredCards.length === 0 && (
            <div className="p-20 text-center space-y-4">
               <Database className="mx-auto text-slate-200" size={64} />
               <p className="text-slate-400 font-bold uppercase tracking-widest text-xs">No matching clinical items found</p>
            </div>
         )}
      </div>

      <FlashcardForm isOpen={isFormOpen} onClose={() => { setIsFormOpen(false); setEditingCard(null); }} onSubmit={handleFormSubmit} initialData={editingCard} />
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
};

export default React.memo(AdminQuestionManager);
