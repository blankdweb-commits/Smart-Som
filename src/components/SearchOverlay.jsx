import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X, BookOpen, Calendar, Star, ArrowRight } from './Icons';
import { useAppContext } from '../context/AppContext';

const RECENT_KEY = 'apex:recentSearches';

const loadRecent = () => {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
};
const saveRecent = (terms) => {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(terms.slice(0, 6))); } catch { /* ignore */ }
};

// Global search overlay. Searches flashcards, exams, and curriculum subjects,
// remembers recent searches, and debounces input for snappy results.
const SearchOverlay = ({ open, onClose }) => {
  const navigate = useNavigate();
  const { flashcards, exams, curriculumSubjects } = useAppContext();
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState(loadRecent);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setTimeout(() => inputRef.current?.focus(), 60);
    }
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return { flashcards: [], exams: [], subjects: [] };
    const match = (s) => String(s || '').toLowerCase().includes(q);
    return {
      flashcards: flashcards.filter(c => match(c.question) || match(c.subject) || match(c.category)).slice(0, 8),
      exams: exams.filter(e => match(e.title) || match(e.subject)).slice(0, 5),
      subjects: (curriculumSubjects || []).filter(s => match(s)).slice(0, 5)
    };
  }, [query, flashcards, exams, curriculumSubjects]);

  if (!open) return null;

  const commitSearch = (term) => {
    const next = [term, ...loadRecent().filter(t => t.toLowerCase() !== term.toLowerCase())];
    setRecent(next);
    saveRecent(next);
  };

  const goFlashcards = (subject) => {
    commitSearch(subject || query);
    onClose();
    navigate(subject ? `/flashcards?subject=${encodeURIComponent(subject)}` : '/flashcards');
  };

  const goExam = () => {
    commitSearch(query);
    onClose();
    navigate('/exam-timetable');
  };

  const hasAny = results.flashcards.length || results.exams.length || results.subjects.length;

  return (
    <div className="fixed inset-0 z-[85] bg-slate-950/60 backdrop-blur-sm flex items-start justify-center px-4 pt-20" role="dialog" aria-modal="true" aria-label="Search">
      <div className="w-full max-w-xl bg-white dark:bg-slate-800 rounded-3xl shadow-2xl overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100 dark:border-slate-700">
          <Search size={20} className="text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search flashcards, exams, subjects…"
            className="flex-1 bg-transparent outline-none text-slate-900 dark:text-white font-medium placeholder-slate-400"
          />
          <button onClick={onClose} aria-label="Close search" className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700">
            <X size={18} />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-4 space-y-5">
          {!query.trim() ? (
            recent.length > 0 ? (
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Recent searches</p>
                <div className="flex flex-wrap gap-2">
                  {recent.map((t, i) => (
                    <button key={i} onClick={() => setQuery(t)} className="px-3 py-1.5 rounded-full bg-slate-100 dark:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600">
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-center text-sm text-slate-400 font-medium py-8">Search across your vault, exams, and subjects.</p>
            )
          ) : !hasAny ? (
            <div className="text-center py-10">
              <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center mx-auto mb-3">
                <Search size={22} className="text-slate-400" />
              </div>
              <p className="text-slate-500 dark:text-slate-400 font-bold text-sm">No matches for "{query}"</p>
              <p className="text-xs text-slate-400 font-medium mt-1">Try a different keyword or topic.</p>
            </div>
          ) : (
            <>
              {results.flashcards.length > 0 && (
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-1.5"><BookOpen size={12} /> Flashcards</p>
                  <div className="space-y-1">
                    {results.flashcards.map((c) => (
                      <button key={c.id} onClick={() => goFlashcards(c.subject)}
                        className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700/50 text-left">
                        <span className="text-slate-500 dark:text-slate-300 text-sm font-bold flex-1 truncate">
                          {typeof c.question === 'object' ? JSON.stringify(c.question) : c.question}
                        </span>
                        <ArrowRight size={15} className="text-slate-300 shrink-0" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {results.subjects.length > 0 && (
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-1.5"><Star size={12} /> Subjects</p>
                  <div className="space-y-1">
                    {results.subjects.map((s, i) => (
                      <button key={i} onClick={() => goFlashcards(s)}
                        className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700/50 text-left">
                        <span className="text-slate-500 dark:text-slate-300 text-sm font-bold flex-1 truncate">{s}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {results.exams.length > 0 && (
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-1.5"><Calendar size={12} /> Exams</p>
                  <div className="space-y-1">
                    {results.exams.map((e) => (
                      <button key={e.id} onClick={goExam}
                        className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700/50 text-left">
                        <span className="text-slate-500 dark:text-slate-300 text-sm font-bold flex-1 truncate">{e.title}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default SearchOverlay;
