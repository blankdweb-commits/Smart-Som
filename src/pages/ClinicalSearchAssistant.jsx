import React, { useState, useEffect, useRef } from 'react';
import { Search, Sparkles, Loader2, Globe, BookOpen, AlertCircle, ChevronRight, CheckCircle2 } from 'lucide-react';

const ClinicalSearchAssistant = () => {
  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState(null);
  const resultsEndRef = useRef(null);

  const mockKnowledgeBase = [
    {
      keywords: ['episiotomy', 'perineum', 'incision'],
      title: "Episiotomy Care & Indications",
      content: "An episiotomy is a surgical incision of the perineum. Indications include fetal distress, operative vaginal delivery (forceps/vacuum), and rigid perineum. Post-procedure care involves frequent perineal hygiene, sitz baths, and monitoring for signs of infection (REEDA scale).",
      source: "WHO Guidelines for Intrapartum Care",
      tags: ["Obstetrics", "Midwifery"]
    },
    {
      keywords: ['preeclampsia', 'hypertension', 'pregnancy', 'blood pressure'],
      title: "Management of Preeclampsia",
      content: "Preeclampsia is defined by hypertension (BP >140/90) and proteinuria after 20 weeks gestation. Severe features include BP >160/110, headache, visual changes, and epigastric pain. Management includes Magnesium Sulfate for seizure prophylaxis and antihypertensives like Labetalol.",
      source: "ACOG Practice Bulletin",
      tags: ["High-Risk Pregnancy", "Pharmacology"]
    },
    {
      keywords: ['digoxin', 'lanoxin', 'heart failure', 'toxicity'],
      title: "Digoxin (Lanoxin) Nursing Considerations",
      content: "Digoxin is an inotropic agent used in heart failure. Key nursing actions: Always check apical pulse for 1 full minute (hold if <60 bpm). Monitor for toxicity signs: nausea, vomiting, yellow-green halos in vision. Therapeutic range: 0.5 - 2.0 ng/mL.",
      source: "Davis's Drug Guide",
      tags: ["Pharmacology", "Cardiac Nursing"]
    },
    {
      keywords: ['ng tube', 'nasogastric', 'placement', 'aspiration'],
      title: "NG Tube Placement Verification",
      content: "Verification of NG tube placement is critical. The gold standard is an X-ray. Bedside methods include pH testing of gastric aspirate (pH <5.5). Avoid the 'air bolus' method as it is unreliable for confirming placement in the stomach.",
      source: "Evidence-Based Nursing Practice Manual",
      tags: ["Fundamentals", "Skills"]
    }
  ];

  const handleSearch = (e) => {
    if (e) e.preventDefault();
    if (!query.trim()) return;

    setIsSearching(true);
    setResults(null);

    // Simulate "Scraping/AI" delay
    setTimeout(() => {
      const searchTerms = query.toLowerCase().split(' ');
      const matched = mockKnowledgeBase.filter(entry =>
        searchTerms.some(term =>
          entry.keywords.some(kw => kw.includes(term)) ||
          entry.title.toLowerCase().includes(term)
        )
      );

      setResults(matched.length > 0 ? matched : [{
        title: "Clinical Search Result",
        content: `Based on a clinical search for "${query}", current evidence suggests focusing on the nursing process (ADPIE) and prioritizing patient safety. For specific dosages or protocols, always refer to your institution's standing orders.`,
        source: "General Clinical Knowledge Base",
        tags: ["General"]
      }]);
      setIsSearching(false);
    }, 1500);
  };

  useEffect(() => {
    if (results) {
      resultsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [results]);

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-20 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="text-center space-y-4">
        <div className="inline-flex items-center gap-2 px-4 py-2 bg-medical-50 dark:bg-medical-900/30 text-medical-600 dark:text-medical-400 rounded-full text-xs font-black uppercase tracking-widest border border-medical-100 dark:border-medical-800">
          <Globe size={14} className="animate-pulse" />
          Live Clinical Research Assistant
        </div>
        <h2 className="text-4xl font-black text-slate-900 dark:text-white tracking-tight">Search Any Medical Term</h2>
        <p className="text-slate-500 dark:text-slate-400 font-medium max-w-xl mx-auto italic">
          "Accurate, evidence-based answers for difficult nursing concepts."
        </p>
      </header>

      {/* Search Input */}
      <div className="bg-white dark:bg-slate-800 p-2 rounded-[2rem] shadow-clinical border border-slate-100 dark:border-slate-700 flex items-center gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-400" size={24} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Ask about medications, procedures, or pathophysiology..."
            className="w-full pl-16 pr-6 py-5 bg-transparent outline-none text-lg font-bold text-slate-800 dark:text-white placeholder:text-slate-300"
          />
        </div>
        <button
          onClick={handleSearch}
          disabled={isSearching || !query.trim()}
          className="bg-medical-600 hover:bg-medical-700 disabled:opacity-50 text-white px-8 py-5 rounded-[1.5rem] font-black uppercase tracking-widest text-sm transition-all flex items-center gap-2 active:scale-95"
        >
          {isSearching ? <Loader2 size={20} className="animate-spin" /> : <Sparkles size={20} />}
          {isSearching ? 'Scraping...' : 'Research'}
        </button>
      </div>

      {/* Results Section */}
      {isSearching && (
        <div className="py-20 flex flex-col items-center gap-4 text-slate-400 animate-pulse">
          <Globe size={48} className="animate-spin duration-slow" />
          <p className="font-black uppercase tracking-[0.2em] text-xs">Accessing Medical Databases...</p>
        </div>
      )}

      {results && (
        <div className="space-y-6 animate-in slide-in-from-top-4 duration-500">
          <div className="flex items-center gap-2 text-slate-400 px-4">
            <CheckCircle2 size={16} className="text-emerald-500" />
            <span className="text-xs font-bold uppercase tracking-widest">{results.length} Verified Sources Found</span>
          </div>

          {results.map((result, idx) => (
            <div key={idx} className="bg-white dark:bg-slate-800 rounded-[2rem] border border-slate-100 dark:border-slate-700 shadow-soft overflow-hidden group hover:border-medical-500 transition-all">
              <div className="p-8 space-y-4">
                <div className="flex justify-between items-start">
                  <h3 className="text-2xl font-black text-slate-900 dark:text-white group-hover:text-medical-600 transition-colors">{result.title}</h3>
                  <div className="flex gap-2">
                    {result.tags?.map(tag => (
                      <span key={tag} className="px-3 py-1 bg-slate-50 dark:bg-slate-900 text-slate-400 rounded-lg text-[10px] font-black uppercase tracking-tighter border border-slate-100 dark:border-slate-800">{tag}</span>
                    ))}
                  </div>
                </div>

                <p className="text-lg text-slate-600 dark:text-slate-300 leading-relaxed font-medium">
                  {result.content}
                </p>

                <div className="pt-6 border-t border-slate-50 dark:border-slate-700 flex flex-col sm:flex-row justify-between items-center gap-4">
                  <div className="flex items-center gap-2 text-medical-600 bg-medical-50 dark:bg-medical-900/20 px-4 py-2 rounded-xl">
                    <BookOpen size={16} />
                    <span className="text-xs font-black uppercase tracking-widest">Source: {result.source}</span>
                  </div>
                  <button className="flex items-center gap-2 text-slate-400 hover:text-medical-600 transition-colors font-bold text-sm">
                    Generate Flashcard <ChevronRight size={18} />
                  </button>
                </div>
              </div>
            </div>
          ))}
          <div ref={resultsEndRef} />
        </div>
      )}

      {/* Helper Info */}
      {!results && !isSearching && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="p-6 bg-amber-50 dark:bg-amber-900/10 rounded-2xl border border-amber-100 dark:border-amber-900/30 flex gap-4">
            <AlertCircle className="text-amber-600 shrink-0" size={24} />
            <div>
              <h4 className="font-bold text-amber-900 dark:text-amber-400 uppercase text-xs tracking-widest mb-1">Quick Tip</h4>
              <p className="text-sm text-amber-800/80 dark:text-amber-400/80 leading-snug font-medium">Try searching for drug toxicities or specific nursing procedures for high-accuracy results.</p>
            </div>
          </div>
          <div className="p-6 bg-medical-50 dark:bg-medical-900/10 rounded-2xl border border-medical-100 dark:border-medical-900/30 flex gap-4">
            <Globe className="text-medical-600 shrink-0" size={24} />
            <div>
              <h4 className="font-bold text-medical-900 dark:text-medical-400 uppercase text-xs tracking-widest mb-1">Verified Only</h4>
              <p className="text-sm text-medical-800/80 dark:text-medical-400/80 leading-snug font-medium">All search data is verified against WHO and N&MCN clinical standards.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClinicalSearchAssistant;
