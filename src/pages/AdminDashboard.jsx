import React, { useState, useMemo } from 'react';
import { useAppContext } from '../context/AppContext';
import {
  FileUp,
  CheckCircle2,
  AlertCircle,
  Trash2,
  Eye,
  ChevronRight,
  Shield,
  Brain,
  Target,
  Zap,
  Info,
  Database,
  Search,
  BookOpen,
  Edit2,
  Clock,
  ExternalLink
} from '../components/Icons';
import { motion, AnimatePresence } from 'framer-motion';
import Toast from '../components/Toast';

const AdminDashboard = () => {
  const { flashcards, setFlashcards } = useAppContext();
  const [activeTab, setActiveTab] = useState('upload');
  const [jsonInput, setJsonInput] = useState('');
  const [previewData, setPreviewData] = useState(null);
  const [validationErrors, setValidationErrors] = useState([]);
  const [toast, setToast] = useState(null);

  const validateJSON = (data) => {
    const errors = [];
    if (!Array.isArray(data)) {
      errors.push("Input must be a JSON array of question objects.");
      return errors;
    }

    data.forEach((item, index) => {
      if (!item.question) errors.push("Item " + (index + 1) + ": Missing 'question'");
      if (!item.options || !Array.isArray(item.options) || item.options.length < 2)
        errors.push("Item " + (index + 1) + ": Missing or invalid 'options' (must be an array)");
      if (!item.correct_answer) errors.push("Item " + (index + 1) + ": Missing 'correct_answer'");
    });

    return errors;
  };

  const handlePreview = () => {
    try {
      const parsed = JSON.parse(jsonInput);
      const errors = validateJSON(parsed);
      setValidationErrors(errors);

      if (errors.length === 0) {
        setPreviewData(parsed);
        setToast({ message: 'JSON Validated. Review preview below.', type: 'success' });
      } else {
        setPreviewData(null);
      }
    } catch (e) {
      setValidationErrors(["Invalid JSON format: " + e.message]);
      setPreviewData(null);
    }
  };

  const handleImport = () => {
    if (!previewData) return;
    const newCards = previewData.map(item => ({
      ...item,
      id: item.id || "manual-" + Date.now() + "-" + Math.random(),
      source: item.source || "Manual Admin Import",
      category: item.category || "Academic"
    }));

    setFlashcards(prev => [...newCards, ...prev]);
    setToast({ message: "Successfully imported " + newCards.length + " questions!", type: 'success' });
    setJsonInput('');
    setPreviewData(null);
  };

  return (
    <div className="space-y-10 pb-32 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
          <h2 className="text-4xl font-black text-slate-900 dark:text-white tracking-tight">Admin Portal</h2>
          <p className="text-slate-500 dark:text-slate-400 font-medium mt-1">Management hub for question banks and moderation.</p>
        </div>
        <div className="flex bg-slate-100 dark:bg-slate-800 p-1.5 rounded-[2rem] w-full md:w-auto">
          {['upload', 'inventory', 'moderation', 'inspector'].map(tab => (
             <button
               key={tab}
               onClick={() => setActiveTab(tab)}
               className={"px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all " + (activeTab === tab ? 'bg-white dark:bg-slate-700 shadow-md text-medical-600' : 'text-slate-500 hover:text-slate-700')}
             >
               {tab}
             </button>
          ))}
        </div>
      </header>

      {activeTab === 'upload' && (
         <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
            <div className="space-y-8">
               <div className="bg-white dark:bg-slate-800 rounded-[3rem] p-8 shadow-clinical border border-slate-100 dark:border-slate-700">
                  <div className="flex items-center gap-4 mb-8">
                     <div className="w-12 h-12 bg-medical-50 dark:bg-medical-900/30 text-medical-600 rounded-2xl flex items-center justify-center">
                        <FileUp size={24} />
                     </div>
                     <div>
                        <h3 className="text-xl font-black">JSON Import Center</h3>
                        <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest">Bulk content ingestion</p>
                     </div>
                  </div>

                  <textarea
                    value={jsonInput}
                    onChange={(e) => setJsonInput(e.target.value)}
                    placeholder='Paste JSON question bank here...'
                    className="w-full h-80 bg-slate-50 dark:bg-slate-900/50 rounded-[2rem] p-6 text-sm font-mono border border-slate-100 dark:border-slate-800 focus:ring-2 focus:ring-medical-500 outline-none transition-all resize-none mb-6"
                  />

                  <button
                    onClick={handlePreview}
                    className="w-full py-5 bg-medical-600 hover:bg-medical-700 text-white rounded-[2rem] font-black uppercase tracking-[0.2em] text-xs shadow-xl shadow-medical-600/20 active:scale-95 transition-all flex items-center justify-center gap-3"
                  >
                    Validate & Preview Bank <ChevronRight size={18} />
                  </button>
               </div>

               <div className="grid grid-cols-2 gap-4">
                  <div className="p-6 bg-medical-50 dark:bg-medical-900/20 rounded-[2rem] border border-medical-100 dark:border-medical-800/50">
                     <p className="text-[10px] font-black uppercase text-medical-600 tracking-widest mb-2">Import Tool</p>
                     <h4 className="font-black text-slate-900 dark:text-white mb-4">Richard Banks</h4>
                     <button className="w-full py-3 bg-white dark:bg-slate-800 text-medical-600 rounded-xl font-black text-[10px] uppercase tracking-widest border border-medical-200 dark:border-medical-800 shadow-sm hover:shadow-md transition-all">Bulk Upload</button>
                  </div>
                  <div className="p-6 bg-indigo-50 dark:bg-indigo-900/20 rounded-[2rem] border border-indigo-100 dark:border-indigo-800/50">
                     <p className="text-[10px] font-black uppercase text-indigo-600 tracking-widest mb-2">Import Tool</p>
                     <h4 className="font-black text-slate-900 dark:text-white mb-4">NMCN / NCLEX</h4>
                     <button className="w-full py-3 bg-white dark:bg-slate-800 text-indigo-600 rounded-xl font-black text-[10px] uppercase tracking-widest border border-indigo-200 dark:border-indigo-800 shadow-sm hover:shadow-md transition-all">Bulk Upload</button>
                  </div>
               </div>

               {validationErrors.length > 0 && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="p-6 bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30 rounded-3xl space-y-2">
                     <p className="font-black text-red-600 text-[10px] uppercase tracking-widest flex items-center gap-2"><AlertCircle size={14}/> Validation Errors</p>
                     <ul className="text-xs text-red-500 space-y-1 font-medium italic">
                        {validationErrors.map((err, i) => <li key={i}>• {err}</li>)}
                     </ul>
                  </motion.div>
               )}
            </div>

            <div className="space-y-6">
               <AnimatePresence mode="wait">
                  {previewData ? (
                     <motion.div key="preview" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white dark:bg-slate-800 rounded-[2.5rem] p-8 shadow-clinical border border-slate-100 dark:border-slate-700">
                        <div className="flex justify-between items-center mb-8">
                           <h3 className="text-xl font-black flex items-center gap-2"><Eye className="text-medical-600" /> Preview ({previewData.length} items)</h3>
                           <button onClick={handleImport} className="px-6 py-2 bg-emerald-500 text-white rounded-xl font-black text-[10px] uppercase tracking-widest animate-pulse">Confirm Import</button>
                        </div>
                        <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                           {previewData.slice(0, 5).map((item, i) => (
                              <div key={i} className="p-5 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-slate-100 dark:border-slate-800 space-y-3 text-left">
                                 <div className="flex justify-between">
                                    <span className="text-[10px] font-black uppercase text-medical-600">{item.subject || 'General'}</span>
                                    <span className="text-[10px] font-black uppercase text-slate-400">Correct: {item.correct_answer}</span>
                                 </div>
                                 <p className="font-bold text-sm text-slate-900 dark:text-white">{item.question}</p>
                                 <div className="grid grid-cols-2 gap-2">
                                    {item.options?.map((opt, idx) => (
                                       <div key={idx} className="text-[10px] p-2 bg-white dark:bg-white/5 rounded-lg border border-slate-100 dark:border-white/5 truncate">{opt}</div>
                                    ))}
                                 </div>
                              </div>
                           ))}
                           {previewData.length > 5 && <p className="text-center text-xs text-slate-400 italic">Showing first 5 items...</p>}
                        </div>
                     </motion.div>
                  ) : (
                     <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-full flex flex-col items-center justify-center p-12 text-center text-slate-400 bg-slate-50 dark:bg-slate-900/30 rounded-[3rem] border-2 border-dashed border-slate-200 dark:border-slate-800">
                        <div className="w-20 h-20 bg-slate-100 dark:bg-white/5 rounded-[2rem] flex items-center justify-center mb-6"><FileUp size={40} /></div>
                        <p className="font-black uppercase tracking-widest text-[10px]">No Data Ready</p>
                        <p className="text-xs mt-2 max-w-[200px]">Paste your JSON question bank and click preview to validate before importing.</p>
                     </motion.div>
                  )}
               </AnimatePresence>
            </div>
         </div>
      )}

      {activeTab === 'inventory' && (
         <div className="bg-white dark:bg-slate-800 rounded-[2.5rem] p-8 shadow-clinical border border-slate-100 dark:border-slate-700">
            <div className="flex justify-between items-center mb-8">
               <h3 className="text-xl font-black">Live Question Bank ({flashcards.length})</h3>
               <div className="flex gap-2">
                  <button className="px-4 py-2 bg-slate-50 dark:bg-white/5 text-slate-600 dark:text-slate-400 rounded-xl font-black text-[10px] uppercase tracking-widest border border-slate-100 dark:border-white/10">Filter Source</button>
               </div>
            </div>
            <div className="overflow-x-auto">
               <table className="w-full text-left">
                  <thead>
                     <tr className="text-[10px] font-black uppercase text-slate-400 tracking-widest border-b border-slate-50 dark:border-slate-900">
                        <th className="pb-4 px-2">Question</th>
                        <th className="pb-4 px-2">Subject</th>
                        <th className="pb-4 px-2">Source</th>
                        <th className="pb-4 px-2">Actions</th>
                     </tr>
                  </thead>
                  <tbody className="text-sm">
                     {flashcards.slice(0, 10).map((card, i) => (
                        <tr key={card.id} className="border-b border-slate-50 dark:border-slate-900/50 group">
                           <td className="py-4 px-2 max-w-md truncate font-medium text-slate-700 dark:text-slate-300">{card.question}</td>
                           <td className="py-4 px-2"><span className="px-2 py-1 bg-medical-50 dark:bg-medical-900/30 text-medical-600 text-[10px] font-black rounded-lg">{card.subject}</span></td>
                           <td className="py-4 px-2 text-[10px] font-bold text-slate-400 uppercase">{card.source || 'Core'}</td>
                           <td className="py-4 px-2 flex gap-2">
                              <button className="p-2 text-slate-400 hover:text-medical-600 transition-colors"><Edit2 size={16}/></button>
                              <button className="p-2 text-slate-400 hover:text-red-500 transition-colors"><Trash2 size={16}/></button>
                           </td>
                        </tr>
                     ))}
                  </tbody>
               </table>
            </div>
            <p className="mt-8 text-center text-xs text-slate-400 font-medium italic">Displaying latest 10 entries of your clinical inventory.</p>
         </div>
      )}

      {activeTab === 'moderation' && (
         <div className="bg-white dark:bg-slate-800 rounded-[2.5rem] p-8 shadow-clinical border border-slate-100 dark:border-slate-700 text-center py-20">
            <div className="w-20 h-20 bg-slate-50 dark:bg-white/5 rounded-full flex items-center justify-center mx-auto mb-6 text-slate-400"><Target size={40}/></div>
            <h3 className="text-xl font-black">Moderation Queue Empty</h3>
            <p className="text-slate-500 mt-2">All student contributions have been reviewed and validated.</p>
         </div>
      )}

      {activeTab === 'inspector' && (
         <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {['RICHARD BANK', 'NMCN', 'NCLEX', 'APEX CORE', 'FACULTY BANK'].map(source => (
               <div key={source} className="p-8 bg-white dark:bg-slate-800 rounded-[2.5rem] border border-slate-100 dark:border-slate-700 shadow-sm hover:shadow-md transition-all text-left group">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Vault</p>
                  <h4 className="text-lg font-black text-slate-900 dark:text-white group-hover:text-medical-600 transition-colors">{source}</h4>
                  <div className="mt-8 flex items-center justify-between">
                     <div>
                        <span className="text-xs font-black text-medical-600 block">{flashcards.filter(c => c.source?.toUpperCase().includes(source.split(' ')[0])).length}</span>
                        <span className="text-[10px] font-bold text-slate-400 uppercase">Items Verified</span>
                     </div>
                     <button className="p-3 bg-slate-50 dark:bg-white/5 rounded-xl text-slate-400 hover:text-medical-600 transition-colors"><ExternalLink size={18}/></button>
                  </div>
               </div>
            ))}
         </div>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
};

export default AdminDashboard;
