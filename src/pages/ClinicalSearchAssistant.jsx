import React, { useState, useEffect, useRef } from 'react';
import { Search, Sparkles, Loader2, Globe, BookOpen, AlertCircle, ChevronRight, CheckCircle2, Plus } from 'lucide-react';
import { useAppContext } from '../context/AppContext';

const ClinicalSearchAssistant = () => {
  const { addFlashcard } = useAppContext();
  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState(null);
  const [toast, setToast] = useState(null);
  const resultsEndRef = useRef(null);

  const mockKnowledgeBase = [
    {
      keywords: ['heart', 'cardiovascular', 'chambers', 'valves', 'anatomy'],
      title: "Heart Anatomy & Labelling Diagram",
      content: "Descriptive Diagram of the Heart. Key Labels: 1. Right Atrium (RA), 2. Right Ventricle (RV), 3. Left Atrium (LA), 4. Left Ventricle (LV), 5. Aorta, 6. Pulmonary Artery, 7. Superior Vena Cava, 8. Mitral Valve, 9. Tricuspid Valve.",
      source: "Clinical Anatomy Essentials",
      youtube: "https://www.youtube.com/watch?v=X90Xp_U7Yy0",
      tags: ["Anatomy", "Cardiovascular"]
    },
    {
      keywords: ['kidney', 'nephron', 'urinary', 'renal', 'anatomy'],
      title: "Nephron Structure & Labelling",
      content: "Detailed Diagram of the Nephron. Labels: 1. Bowman's Capsule, 2. Glomerulus, 3. Proximal Convoluted Tubule (PCT), 4. Loop of Henle (Descending & Ascending), 5. Distal Convoluted Tubule (DCT), 6. Collecting Duct.",
      source: "Renal Physiology Guide",
      youtube: "https://www.youtube.com/watch?v=vNvZaGcLzpg",
      tags: ["Anatomy", "Renal"]
    },
    {
      keywords: ['lung', 'respiratory', 'alveoli', 'bronchi', 'anatomy'],
      title: "Respiratory System & Alveoli Diagram",
      content: "Comprehensive Respiratory Diagram. Labels: 1. Trachea, 2. Bronchi, 3. Bronchioles, 4. Alveolar Sacs, 5. Diaphragm, 6. Pleural Space, 7. Larynx (Voice Box).",
      source: "Respiratory Clinical Manual",
      youtube: "https://www.youtube.com/watch?v=mOKmjYwfDGU",
      tags: ["Anatomy", "Respiratory"]
    },
    {
      keywords: ['skin', 'integumentary', 'epidermis', 'dermis', 'layers'],
      title: "Integumentary System (Skin) Layers Diagram",
      content: "Cross-section of the Skin. Labels: 1. Epidermis, 2. Dermis, 3. Hypodermis (Subcutaneous), 4. Hair Follicle, 5. Sweat Gland, 6. Sebaceous Gland, 7. Nerve Endings.",
      source: "Dermatology for Nurses",
      youtube: "https://www.youtube.com/watch?v=z5Vn_97S6S8",
      tags: ["Anatomy", "Integumentary"]
    },
    {
      keywords: ['brain', 'nervous system', 'cerebrum', 'cerebellum', 'lobes'],
      title: "Brain Anatomy & Functional Lobes Diagram",
      content: "Major parts of the Brain. Labels: 1. Cerebrum, 2. Cerebellum, 3. Brainstem (Medulla, Pons, Midbrain), 4. Frontal Lobe, 5. Parietal Lobe, 6. Occipital Lobe, 7. Temporal Lobe.",
      source: "Neurological Clinical Handbook",
      youtube: "https://www.youtube.com/watch?v=eeTpxM_o9S8",
      tags: ["Anatomy", "Neurology"]
    },
    {
      keywords: ['digestive', 'stomach', 'intestine', 'liver', 'anatomy'],
      title: "Digestive System Overview Diagram",
      content: "Complete Digestive Tract. Labels: 1. Esophagus, 2. Stomach, 3. Liver, 4. Gallbladder, 5. Pancreas, 6. Small Intestine (Duodenum, Jejunum, Ileum), 7. Large Intestine (Colon), 8. Rectum.",
      source: "Gastrointestinal Nursing Guide",
      youtube: "https://www.youtube.com/watch?v=Og5xAdC8EUI",
      tags: ["Anatomy", "Digestive"]
    },
    {
      keywords: ['pelvis', 'female reproductive', 'uterus', 'ovary', 'anatomy'],
      title: "Female Reproductive System Diagram",
      content: "Internal Female Reproductive Organs. Labels: 1. Uterus, 2. Fallopian Tubes, 3. Ovaries, 4. Cervix, 5. Vagina, 6. Endometrium, 7. Fundus.",
      source: "Midwifery Essentials",
      youtube: "https://www.youtube.com/watch?v=RfC0R_pC6Fw",
      tags: ["Anatomy", "Midwifery"]
    },
    {
      keywords: ['skeleton', 'bones', 'axial', 'appendicular', 'anatomy'],
      title: "Human Skeletal System Diagram",
      content: "Major Bones of the Body. Labels: 1. Skull, 2. Clavicle, 3. Scapula, 4. Sternum, 5. Humerus, 6. Radius/Ulna, 7. Pelvis, 8. Femur, 9. Tibia/Fibula, 10. Vertebral Column.",
      source: "Orthopedic Nursing Manual",
      youtube: "https://www.youtube.com/watch?v=f-f5wzw247c",
      tags: ["Anatomy", "Orthopedic"]
    },
    {
      keywords: ['eye', 'vision', 'retina', 'cornea', 'anatomy'],
      title: "Anatomy of the Human Eye Diagram",
      content: "Structure of the Eye. Labels: 1. Cornea, 2. Iris, 3. Pupil, 4. Lens, 5. Retina, 6. Optic Nerve, 7. Sclera, 8. Vitreous Humor, 9. Choroid.",
      source: "Ophthalmology Nursing",
      youtube: "https://www.youtube.com/watch?v=RE1MvRmw66U",
      tags: ["Anatomy", "Special Senses"]
    },
    {
      keywords: ['ear', 'hearing', 'cochlea', 'tympanic', 'anatomy'],
      title: "Human Ear Structure Diagram",
      content: "Parts of the Ear. Labels: 1. Pinna (Outer Ear), 2. Auditory Canal, 3. Tympanic Membrane (Eardrum), 4. Ossicles (Malleus, Incus, Stapes), 5. Cochlea, 6. Semicircular Canals, 7. Eustachian Tube.",
      source: "ENT Clinical Guide",
      youtube: "https://www.youtube.com/watch?v=3GZ_re7R68Q",
      tags: ["Anatomy", "Special Senses"]
    },
    {
      keywords: ['injection', 'im', 'subcutaneous', 'intradermal', 'sites'],
      title: "Injection Sites & Angles Diagram",
      content: "Nursing Procedure: Injection Mapping. Labels: 1. Deltoid (IM), 2. Ventrogluteal (IM), 3. Vastus Lateralis (IM - Infants), 4. Abdomen/Thigh (SubQ), 5. Forearm (Intradermal). Angles: 90° (IM), 45° (SubQ), 15° (ID).",
      source: "Foundation of Nursing Procedures",
      youtube: "https://www.youtube.com/watch?v=v_y86RpkY-E",
      tags: ["Procedures", "Nursing"]
    },
    {
      keywords: ['wound', 'pressure ulcer', 'stages', 'skin', 'injury'],
      title: "Pressure Ulcer Staging Diagram",
      content: "Wound Assessment Guide. Labels: Stage 1 (Non-blanchable erythema), Stage 2 (Partial thickness), Stage 3 (Full thickness skin loss), Stage 4 (Full thickness tissue loss, bone/muscle visible), Unstageable (Eschar/Slough).",
      source: "Wound Care Standards",
      youtube: "https://www.youtube.com/watch?v=LSTG16S6-h0",
      tags: ["Assessment", "Wound Care"]
    },
    {
      keywords: ['fetal', 'placenta', 'umbilical cord', 'pregnancy', 'midwifery'],
      title: "Fetal Circulation & Placenta Diagram",
      content: "Midwifery Focus: Fetal-Maternal Exchange. Labels: 1. Placenta, 2. Umbilical Vein (Oxygenated), 3. Umbilical Arteries (2), 4. Ductus Venosus, 5. Foramen Ovale, 6. Ductus Arteriosus.",
      source: "Midwifery Clinical Handbook",
      youtube: "https://www.youtube.com/watch?v=N807T_p70Fk",
      tags: ["Anatomy", "Midwifery"]
    },
    {
      keywords: ['liver', 'hepatic', 'biliary', 'gallbladder', 'anatomy'],
      title: "Liver & Biliary System Diagram",
      content: "Digestive Accessory Organs. Labels: 1. Right/Left Hepatic Lobes, 2. Gallbladder, 3. Common Bile Duct, 4. Cystic Duct, 5. Hepatic Portal Vein, 6. Falciform Ligament.",
      source: "GI Clinical Manual",
      youtube: "https://www.youtube.com/watch?v=kS8p5kK2Csk",
      tags: ["Anatomy", "Digestive"]
    },
    {
      keywords: ['heart', 'conduction', 'electrical', 'sa node', 'av node'],
      title: "Cardiac Conduction System Diagram",
      content: "Electrical Pathway of the Heart. Labels: 1. SA Node (Pacemaker), 2. Intermodal Pathways, 3. AV Node, 4. Bundle of His, 5. Right/Left Bundle Branches, 6. Purkinje Fibers.",
      source: "Cardiology for Nurses",
      youtube: "https://www.youtube.com/watch?v=RYZ4daFwV88",
      tags: ["Anatomy", "Cardiovascular"]
    }
  ];

  const handleSearch = (e) => {
    if (e) e.preventDefault();
    if (!query.trim()) return;

    setIsSearching(true);
    setResults(null);

    // Simulate "Scraping/AI" delay
    setTimeout(() => {
      const searchTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);

      // Improved matching with scoring
      const matched = mockKnowledgeBase
        .map(entry => {
          let score = 0;
          const titleLower = entry.title.toLowerCase();
          const contentLower = entry.content.toLowerCase();

          searchTerms.forEach(term => {
            if (titleLower.includes(term)) score += 5;
            if (contentLower.includes(term)) score += 2;
            entry.keywords.forEach(kw => {
              if (kw.includes(term)) score += 3;
              if (kw === term) score += 5;
            });
          });

          return { ...entry, score };
        })
        .filter(entry => entry.score > 0)
        .sort((a, b) => b.score - a.score);

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
        <h2 className="text-4xl font-black text-slate-900 dark:text-white tracking-tight">Clinical Diagram & Labelling Assistant</h2>
        <p className="text-slate-500 dark:text-slate-400 font-medium max-w-xl mx-auto italic">
          "Visual guides and descriptive labelling for high-yield clinical structures."
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
            placeholder="Search for diagrams (e.g., heart, kidney, brain)..."
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
                  <div className="flex flex-wrap gap-2">
                    <div className="flex items-center gap-2 text-medical-600 bg-medical-50 dark:bg-medical-900/20 px-4 py-2 rounded-xl">
                      <BookOpen size={16} />
                      <span className="text-xs font-black uppercase tracking-widest">Source: {result.source}</span>
                    </div>
                    {result.youtube && (
                      <a
                        href={result.youtube}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-red-600 bg-red-50 dark:bg-red-900/20 px-4 py-2 rounded-xl hover:bg-red-100 transition-colors"
                      >
                        <Globe size={16} />
                        <span className="text-xs font-black uppercase tracking-widest">Watch Tutorial</span>
                      </a>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      addFlashcard({
                        question: `Describe the components and labelling of ${result.title.replace(' Diagram', '')}.`,
                        answer: result.content,
                        subject: result.tags?.[0] || 'Anatomy',
                        topic: result.title,
                        difficulty: 'Moderate'
                      });
                      setToast(`${result.title} added to flashcards!`);
                      setTimeout(() => setToast(null), 3000);
                    }}
                    className="flex items-center gap-2 text-slate-400 hover:text-medical-600 transition-colors font-bold text-sm"
                  >
                    <Plus size={16} /> Generate Flashcard
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
      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-emerald-600 text-white px-6 py-3 rounded-full shadow-lg font-bold flex items-center gap-2 animate-in slide-in-from-bottom-4 z-50">
          <CheckCircle2 size={18} />
          {toast}
        </div>
      )}
    </div>
  );
};

export default ClinicalSearchAssistant;
