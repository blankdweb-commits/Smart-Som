import React, { useState, useMemo } from 'react';
import { Search, ImageIcon, ChevronRight, Info, BookOpen, Brain, Star, Filter, Sparkles, AlertCircle, List, X } from '../components/Icons';
import { motion, AnimatePresence } from 'framer-motion';
import { DIAGRAM_LIBRARY } from '../data/diagramLibrary';

const MedicalDiagrams = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedDiagram, setSelectedDiagram] = useState(null);
  const [activeLabel, setActiveLabel] = useState(null);

  const categories = ['All', 'Anatomy', 'Respiratory', 'Cardiovascular', 'Neurology', 'Reproductive', 'Medication Administration', 'Wound Care'];

  const filteredDiagrams = useMemo(() => {
    return DIAGRAM_LIBRARY.filter(d => {
      const searchStr = `${d.title} ${d.system} ${d.description}`.toLowerCase();
      const matchesSearch = searchStr.includes(searchTerm.toLowerCase());
      const matchesCategory = selectedCategory === 'All' || d.system === selectedCategory;
      return matchesSearch && matchesCategory;
    }).sort((a, b) => {
      // Simulate AI Ranking: If title matches search term exactly, move to top
      const aTitleMatch = a.title.toLowerCase().includes(searchTerm.toLowerCase());
      const bTitleMatch = b.title.toLowerCase().includes(searchTerm.toLowerCase());
      if (aTitleMatch && !bTitleMatch) return -1;
      if (!aTitleMatch && bTitleMatch) return 1;
      return 0;
    });
  }, [searchTerm, selectedCategory]);

  return (
    <div className="space-y-8 pb-32 animate-in fade-in slide-in-from-bottom-4 duration-700">
      {/* Header */}
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
          <h2 className="text-4xl font-black text-slate-900 dark:text-white tracking-tight">Medical Diagrams</h2>
          <p className="text-slate-500 dark:text-slate-400 font-medium mt-1">Interactive visual aids for clinical mastery.</p>
        </div>
        <div className="bg-medical-100 dark:bg-medical-900/30 px-4 py-2 rounded-2xl flex items-center gap-3 border border-medical-200/50">
          <Brain size={24} className="text-medical-600" />
          <span className="text-sm font-black text-medical-700 dark:text-medical-400 uppercase tracking-widest">Visual Learning Mode</span>
        </div>
      </header>

      {/* Search & Filter */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="md:col-span-3 relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
          <input
            type="text"
            placeholder="Search for diagrams, systems, or structures..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-12 pr-6 py-4 rounded-2xl bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 outline-none focus:ring-4 focus:ring-medical-500/10 transition-all font-bold shadow-soft"
          />
        </div>
        <div className="relative">
          <Filter className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="w-full pl-12 pr-6 py-4 rounded-2xl bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 outline-none appearance-none font-bold shadow-soft"
          >
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      {/* Content Area */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* List of Diagrams */}
        <div className="lg:col-span-1 space-y-4 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
          {filteredDiagrams.map(diagram => (
            <button
              key={diagram.id}
              onClick={() => { setSelectedDiagram(diagram); setActiveLabel(null); }}
              className={`w-full p-4 rounded-3xl border text-left transition-all group ${selectedDiagram?.id === diagram.id ? 'bg-medical-600 border-medical-600 text-white shadow-xl shadow-medical-600/20' : 'bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700 hover:border-medical-500'}`}
            >
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${selectedDiagram?.id === diagram.id ? 'bg-white/20' : 'bg-slate-50 dark:bg-slate-900 text-medical-600'}`}>
                  <ImageIcon size={24} />
                </div>
                <div>
                  <h4 className="font-black text-sm uppercase tracking-wider">{diagram.title}</h4>
                  <p className={`text-[10px] font-bold ${selectedDiagram?.id === diagram.id ? 'text-white/70' : 'text-slate-400'}`}>{diagram.system} • {diagram.category}</p>
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* Viewer */}
        <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-[3rem] shadow-clinical border border-slate-50 dark:border-slate-700 p-8 min-h-[500px] flex flex-col">
          <AnimatePresence mode="wait">
            {selectedDiagram ? (
              <motion.div
                key={selectedDiagram.id}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="flex flex-col h-full"
              >
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <h3 className="text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight">{selectedDiagram.title}</h3>
                    <p className="text-slate-500 text-sm font-medium mt-1">{selectedDiagram.description}</p>
                  </div>
                  <button className="p-3 bg-slate-50 dark:bg-slate-900 rounded-2xl text-slate-400 hover:text-yellow-500 transition-colors">
                    <Star size={20} />
                  </button>
                </div>

                <div className="flex flex-col lg:flex-row gap-6 flex-1 min-h-0">
                  <div className="relative flex-1 rounded-3xl overflow-hidden bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 h-[300px] lg:h-auto">
                    <img
                      src={selectedDiagram.image}
                      alt={selectedDiagram.title}
                      className="w-full h-full object-contain mix-blend-multiply dark:mix-blend-normal opacity-90"
                    />

                    {/* Interactive Hotspots (Only if available) */}
                    {selectedDiagram.labels.filter(l => l.pos).map((label, idx) => (
                      <button
                        key={idx}
                        className={`absolute w-8 h-8 rounded-full border-4 border-white shadow-lg transition-all transform hover:scale-125 flex items-center justify-center font-black text-xs ${activeLabel?.name === label.name ? 'bg-medical-600 text-white scale-110' : 'bg-medical-100 text-medical-600'}`}
                        style={{ top: label.pos.top, left: label.pos.left }}
                        onClick={() => setActiveLabel(label)}
                      >
                        !
                      </button>
                    ))}
                  </div>

                  <div className="lg:w-80 flex flex-col gap-4">
                    <div className="bg-slate-50 dark:bg-slate-900/50 p-4 rounded-2xl border border-slate-100 dark:border-slate-700">
                      <h4 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-3 flex items-center gap-2">
                        <List size={14} /> Structure Labels
                      </h4>
                      <div className="space-y-2 max-h-[200px] overflow-y-auto custom-scrollbar pr-2">
                        {selectedDiagram.labels.map((label, idx) => (
                          <button
                            key={idx}
                            onClick={() => setActiveLabel(label)}
                            className={`w-full p-3 rounded-xl text-left text-xs font-bold transition-all ${activeLabel?.name === label.name ? 'bg-medical-600 text-white' : 'bg-white dark:bg-slate-800 hover:bg-medical-50'}`}
                          >
                            {label.name}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="bg-medical-50 dark:bg-medical-900/20 p-4 rounded-2xl border border-medical-100 dark:border-medical-800">
                      <h4 className="text-xs font-black uppercase tracking-widest text-medical-600 mb-2 flex items-center gap-2">
                        <AlertCircle size={14} /> Clinical Relevance
                      </h4>
                      <p className="text-[11px] font-medium text-slate-600 dark:text-slate-400 leading-relaxed">
                        {selectedDiagram.clinical_relevance}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Label Info Overlay */}
                <AnimatePresence>
                  {activeLabel && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 10 }}
                      className="mt-6 p-6 bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-medical-500/30 flex items-start gap-4"
                    >
                      <div className="w-10 h-10 bg-medical-100 dark:bg-medical-900/30 rounded-xl flex items-center justify-center text-medical-600 shrink-0">
                        <Info size={20} />
                      </div>
                      <div>
                        <h5 className="font-black text-slate-900 dark:text-white uppercase tracking-wider">{activeLabel.name}</h5>
                        <p className="text-slate-500 dark:text-slate-400 text-xs font-medium mt-1 leading-relaxed">{activeLabel.info}</p>
                      </div>
                      <button onClick={() => setActiveLabel(null)} className="ml-auto text-slate-400 hover:text-slate-600">
                        <X size={20} />
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-300 gap-4">
                <div className="p-8 bg-slate-50 dark:bg-slate-900/50 rounded-full">
                  <BookOpen size={64} className="opacity-20" />
                </div>
                <p className="font-black uppercase tracking-widest text-sm">Select a diagram to start visual review</p>
              </div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};

export default MedicalDiagrams;
