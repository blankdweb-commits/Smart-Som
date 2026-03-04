import React, { useState, useEffect } from 'react';
import { medicalTerms } from '../data/initialData';
import { Search, Volume2, Info, ChevronRight, PlayCircle } from 'lucide-react';

const PronunciationHelper = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTerm, setSelectedTerm] = useState(null);
  const [autoPlay, setAutoPlay] = useState(false);

  const filteredTerms = medicalTerms.filter(t =>
    t.term.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const speak = (text) => {
    if ('speechSynthesis' in window) {
      // Cancel any ongoing speech
      window.speechSynthesis.cancel();

      // Some browsers need a resume if it was interrupted
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.8; // Slightly slower for clarity
      utterance.pitch = 1;

      // Handle cases where the voice might not be loaded or needs a specific lang
      utterance.lang = 'en-US';

      // On some browsers, we need to re-bind the speak call to a user action directly
      // but here we are in a click handler already.

      // Error handling
      utterance.onerror = (event) => {
        console.error('SpeechSynthesisUtterance error', event);
      };

      window.speechSynthesis.speak(utterance);
    } else {
      alert("Sorry, your browser doesn't support text to speech.");
    }
  };

  // Fix for Chrome where speech might stop after ~15 seconds or on some events
  useEffect(() => {
    const keepAlive = setInterval(() => {
      if (window.speechSynthesis.speaking) {
        window.speechSynthesis.pause();
        window.speechSynthesis.resume();
      }
    }, 10000);
    return () => clearInterval(keepAlive);
  }, []);

  const handleTermClick = (term) => {
    setSelectedTerm(term);
    if (autoPlay) {
      speak(term.term);
    }
  };

  return (
    <div className="space-y-6 pb-20">
      <header>
        <h2 className="text-3xl font-bold text-slate-800 dark:text-white">Pronunciation Helper</h2>
        <p className="text-slate-600 dark:text-slate-400">Master difficult medical terminology with audio guidance.</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Sidebar: Search and List */}
        <div className="lg:col-span-1 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              type="text"
              placeholder="Search terms..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-medical-500 shadow-sm"
            />
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="p-4 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center">
              <span className="text-sm font-bold text-slate-500 uppercase">Lexicon</span>
              <label className="flex items-center cursor-pointer">
                <span className="mr-2 text-xs font-medium text-slate-400 uppercase">Auto-Play</span>
                <div className="relative">
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={autoPlay}
                    onChange={() => setAutoPlay(!autoPlay)}
                  />
                  <div className={`block w-8 h-5 rounded-full transition-colors ${autoPlay ? 'bg-medical-500' : 'bg-slate-300 dark:bg-slate-600'}`}></div>
                  <div className={`absolute left-1 top-1 bg-white w-3 h-3 rounded-full transition-transform ${autoPlay ? 'translate-x-3' : ''}`}></div>
                </div>
              </label>
            </div>
            <div className="max-h-[500px] overflow-y-auto">
              {filteredTerms.map((t) => (
                <button
                  key={t.term}
                  onClick={() => handleTermClick(t)}
                  className={`w-full text-left px-4 py-3 flex justify-between items-center hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors border-b border-slate-50 dark:border-slate-700/50 last:border-0 ${selectedTerm?.term === t.term ? 'bg-medical-50 dark:bg-medical-900/20 text-medical-700 dark:text-medical-400' : ''}`}
                >
                  <span className="font-medium">{t.term}</span>
                  <ChevronRight size={16} className="text-slate-300" />
                </button>
              ))}
              {filteredTerms.length === 0 && (
                <div className="p-8 text-center text-slate-500">
                  No terms found.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Content: Details */}
        <div className="lg:col-span-2">
          {selectedTerm ? (
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 sm:p-10 sticky top-24 animate-bounce-in">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
                <div>
                  <h3 className="text-4xl font-bold text-slate-800 dark:text-white">{selectedTerm.term}</h3>
                  <p className="text-xl text-medical-600 dark:text-medical-400 font-serif mt-2 italic">{selectedTerm.phonetic}</p>
                </div>
                <button
                  onClick={() => speak(selectedTerm.term)}
                  className="flex items-center justify-center gap-2 px-8 py-3 bg-medical-600 hover:bg-medical-700 text-white rounded-xl font-bold text-lg shadow-lg shadow-medical-500/30 transition-all active:scale-95"
                >
                  <Volume2 size={24} /> Listen
                </button>
              </div>

              <div className="space-y-8">
                <div>
                  <h4 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center">
                    <Info size={16} className="mr-2" /> Syllable Breakdown
                  </h4>
                  <p className="text-2xl font-medium text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-slate-700/50 p-4 rounded-xl inline-block border border-slate-100 dark:border-slate-600">
                    {selectedTerm.syllables}
                  </p>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-bold text-slate-400 uppercase tracking-widest">Definition</h4>
                    <button
                      onClick={() => speak(selectedTerm.definition)}
                      className="text-medical-600 hover:text-medical-700 flex items-center text-xs font-bold gap-1"
                    >
                      <Volume2 size={14} /> Listen to Definition
                    </button>
                  </div>
                  <p className="text-lg text-slate-600 dark:text-slate-400 leading-relaxed">
                    {selectedTerm.definition}
                  </p>
                </div>

                <div className="pt-8 border-t border-slate-100 dark:border-slate-700">
                  <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-xl flex items-start">
                    <PlayCircle className="text-blue-600 mr-3 shrink-0" size={24} />
                    <p className="text-sm text-blue-800 dark:text-blue-300">
                      <strong>Pro Tip:</strong> Practice saying the word aloud with the audio. Break it down by syllables to master the pronunciation.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center p-12 bg-white dark:bg-slate-800 rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-700">
              <div className="p-6 bg-medical-50 dark:bg-medical-900/20 rounded-full mb-6">
                <Volume2 size={48} className="text-medical-600" />
              </div>
              <h3 className="text-2xl font-bold text-slate-800 dark:text-white mb-2">Select a Term</h3>
              <p className="text-slate-500 dark:text-slate-400 max-w-sm">
                Choose a medical term from the list to see its phonetic spelling, syllables, and hear how it's pronounced.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PronunciationHelper;
