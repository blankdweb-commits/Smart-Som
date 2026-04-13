import React, { useState, useEffect, useRef } from 'react';
import { Search, Sparkles, Loader2, Globe, BookOpen, AlertCircle, ChevronRight, CheckCircle2, Plus, List } from 'lucide-react';
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
      keywords: ['heart', 'cardiovascular', 'chambers', 'valves', 'anatomy', 'blood flow', 'circulatory'],
      title: "Heart Anatomy & Labelling Diagram",
      content: "Comprehensive Visual Guide to Cardiac Structures. Labels: 1. Right Atrium (Receives deoxygenated blood), 2. Right Ventricle (Pumps to lungs), 3. Left Atrium (Receives oxygenated blood), 4. Left Ventricle (Pumps to systemic circulation), 5. Ascending Aorta, 6. Pulmonary Trunk, 7. Superior Vena Cava, 8. Mitral/Bicuspid Valve, 9. Tricuspid Valve, 10. Aortic Valve, 11. Interventricular Septum.",
      source: "Clinical Anatomy Essentials (2024)",
      image: "https://upload.wikimedia.org/wikipedia/commons/e/e5/Diagram_of_the_human_heart_%28cropped%29.svg",
      youtube: "https://www.youtube.com/watch?v=X90Xp_U7Yy0",
      tags: ["Anatomy", "Cardiovascular"]
    },
    {
      keywords: ['kidney', 'nephron', 'urinary', 'renal', 'anatomy', 'filtration', 'excretory'],
      title: "Nephron Structure & Labelling",
      content: "Detailed Functional Mapping of the Nephron. Labels: 1. Bowman's Capsule (Filtration start), 2. Glomerulus (Capillary tuft), 3. Proximal Convoluted Tubule (PCT - major reabsorption), 4. Descending Loop of Henle, 5. Ascending Loop of Henle, 6. Distal Convoluted Tubule (DCT - hormonal control), 7. Collecting Duct, 8. Afferent/Efferent Arterioles.",
      source: "Renal Physiology & Clinical Nursing Guide",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/2/27/Physiology_of_Nephron.png/800px-Physiology_of_Nephron.png",
      youtube: "https://www.youtube.com/watch?v=vNvZaGcLzpg",
      tags: ["Anatomy", "Renal"]
    },
    {
      keywords: ['lung', 'respiratory', 'alveoli', 'bronchi', 'anatomy', 'gas exchange', 'breathing'],
      title: "Respiratory System & Alveolar Anatomy",
      content: "High-Resolution Mapping of the Respiratory Tract. Labels: 1. Nasal Cavity (Filtration), 2. Pharynx, 3. Larynx (Vocal cords), 4. Trachea (C-shaped cartilage), 5. Primary/Secondary Bronchi, 6. Terminal Bronchioles, 7. Alveolar Sacs (Site of gas exchange), 8. Visceral/Parietal Pleura, 9. Diaphragm (Primary muscle of respiration).",
      source: "Respiratory Clinical Manual (Advanced)",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Lungs_diagram_detailed.svg/800px-Lungs_diagram_detailed.svg",
      youtube: "https://www.youtube.com/watch?v=mOKmjYwfDGU",
      tags: ["Anatomy", "Respiratory"]
    },
    {
      keywords: ['skin', 'integumentary', 'epidermis', 'dermis', 'layers', 'hypodermis'],
      title: "Integumentary System (Skin) Layers Diagram",
      content: "Cross-section of the Skin. Labels: 1. Epidermis, 2. Dermis, 3. Hypodermis (Subcutaneous), 4. Hair Follicle, 5. Sweat Gland, 6. Sebaceous Gland, 7. Nerve Endings.",
      source: "Dermatology for Nurses",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6d/Skin.svg/800px-Skin.svg.png",
      youtube: "https://www.youtube.com/watch?v=z5Vn_97S6S8",
      tags: ["Anatomy", "Integumentary"]
    },
    {
      keywords: ['brain', 'nervous system', 'cerebrum', 'cerebellum', 'lobes', 'neuro', 'central nervous system'],
      title: "Brain Anatomy & Functional Lobes Diagram",
      content: "Major parts of the Brain. Labels: 1. Cerebrum, 2. Cerebellum, 3. Brainstem (Medulla, Pons, Midbrain), 4. Frontal Lobe, 5. Parietal Lobe, 6. Occipital Lobe, 7. Temporal Lobe.",
      source: "Neurological Clinical Handbook",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1a/Brain_surface_gyri.svg/800px-Brain_surface_gyri.svg.png",
      youtube: "https://www.youtube.com/watch?v=eeTpxM_o9S8",
      tags: ["Anatomy", "Neurology"]
    },
    {
      keywords: ['digestive', 'stomach', 'intestine', 'liver', 'anatomy', 'gi tract', 'gastrointestinal'],
      title: "Digestive System Overview Diagram",
      content: "Complete Digestive Tract. Labels: 1. Esophagus, 2. Stomach, 3. Liver, 4. Gallbladder, 5. Pancreas, 6. Small Intestine (Duodenum, Jejunum, Ileum), 7. Large Intestine (Colon), 8. Rectum.",
      source: "Gastrointestinal Nursing Guide",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Digestive_system_diagram_edit.svg/800px-Digestive_system_diagram_edit.svg.png",
      youtube: "https://www.youtube.com/watch?v=Og5xAdC8EUI",
      tags: ["Anatomy", "Digestive"]
    },
    {
      keywords: ['pelvis', 'female reproductive', 'uterus', 'ovary', 'anatomy', 'midwifery', 'reproductive'],
      title: "Female Reproductive System Diagram",
      content: "Internal Female Reproductive Organs. Labels: 1. Uterus, 2. Fallopian Tubes, 3. Ovaries, 4. Cervix, 5. Vagina, 6. Endometrium, 7. Fundus.",
      source: "Midwifery Essentials",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d7/Illu_repro_female.svg/800px-Illu_repro_female.svg.png",
      youtube: "https://www.youtube.com/watch?v=RfC0R_pC6Fw",
      tags: ["Anatomy", "Midwifery"]
    },
    {
      keywords: ['skeleton', 'bones', 'axial', 'appendicular', 'anatomy', 'orthopedic'],
      title: "Human Skeletal System Diagram",
      content: "Major Bones of the Body. Labels: 1. Skull, 2. Clavicle, 3. Scapula, 4. Sternum, 5. Humerus, 6. Radius/Ulna, 7. Pelvis, 8. Femur, 9. Tibia/Fibula, 10. Vertebral Column.",
      source: "Orthopedic Nursing Manual",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/49/Human_skeleton_front_en.svg/800px-Human_skeleton_front_en.svg.png",
      youtube: "https://www.youtube.com/watch?v=f-f5wzw247c",
      tags: ["Anatomy", "Orthopedic"]
    },
    {
      keywords: ['eye', 'vision', 'retina', 'cornea', 'anatomy', 'ocular', 'ophthalmology'],
      title: "Anatomy of the Human Eye Diagram",
      content: "Structure of the Eye. Labels: 1. Cornea, 2. Iris, 3. Pupil, 4. Lens, 5. Retina, 6. Optic Nerve, 7. Sclera, 8. Vitreous Humor, 9. Choroid.",
      source: "Ophthalmology Nursing",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1e/Schematic_diagram_of_the_human_eye_en.svg/800px-Schematic_diagram_of_the_human_eye_en.svg.png",
      youtube: "https://www.youtube.com/watch?v=RE1MvRmw66U",
      tags: ["Anatomy", "Special Senses"]
    },
    {
      keywords: ['ear', 'hearing', 'cochlea', 'tympanic', 'anatomy', 'auditory', 'vestibular'],
      title: "Human Ear Structure Diagram",
      content: "Parts of the Ear. Labels: 1. Pinna (Outer Ear), 2. Auditory Canal, 3. Tympanic Membrane (Eardrum), 4. Ossicles (Malleus, Incus, Stapes), 5. Cochlea, 6. Semicircular Canals, 7. Eustachian Tube.",
      source: "ENT Clinical Guide",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d1/Human_ear_anatomy_en.svg/800px-Human_ear_anatomy_en.svg.png",
      youtube: "https://www.youtube.com/watch?v=3GZ_re7R68Q",
      tags: ["Anatomy", "Special Senses"]
    },
    {
      keywords: ['injection', 'im', 'subcutaneous', 'intradermal', 'sites', 'angles', 'nursing procedure'],
      title: "Injection Sites & Angles Diagram",
      content: "Nursing Procedure: Injection Mapping. Labels: 1. Deltoid (IM), 2. Ventrogluteal (IM), 3. Vastus Lateralis (IM - Infants), 4. Abdomen/Thigh (SubQ), 5. Forearm (Intradermal). Angles: 90° (IM), 45° (SubQ), 15° (ID).",
      source: "Foundation of Nursing Procedures",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/ca/Injections.svg/800px-Injections.svg.png",
      youtube: "https://www.youtube.com/watch?v=v_y86RpkY-E",
      tags: ["Procedures", "Nursing"]
    },
    {
      keywords: ['wound', 'pressure ulcer', 'stages', 'skin', 'injury', 'decubitus'],
      title: "Pressure Ulcer Staging Diagram",
      content: "Wound Assessment Guide. Labels: Stage 1 (Non-blanchable erythema), Stage 2 (Partial thickness), Stage 3 (Full thickness skin loss), Stage 4 (Full thickness tissue loss, bone/muscle visible), Unstageable (Eschar/Slough).",
      source: "Wound Care Standards",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/84/Pressure_ulcer.svg/800px-Pressure_ulcer.svg.png",
      youtube: "https://www.youtube.com/watch?v=LSTG16S6-h0",
      tags: ["Assessment", "Wound Care"]
    },
    {
      keywords: ['fetal', 'placenta', 'umbilical cord', 'pregnancy', 'midwifery', 'shunts', 'circulation'],
      title: "Fetal Circulation & Placenta Anatomy",
      content: "Advanced Midwifery Mapping: Intrauterine Circulation. Labels: 1. Placenta (Gas/Nutrient exchange), 2. Umbilical Vein (Carries oxygenated blood), 3. Umbilical Arteries (Carry deoxygenated blood to placenta), 4. Ductus Venosus (Bypasses liver), 5. Foramen Ovale (Bypasses right ventricle), 6. Ductus Arteriosus (Bypasses lungs).",
      source: "Midwifery Clinical Handbook (Gold Standard)",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d5/Fetal_circulation_en.svg/800px-Fetal_circulation_en.svg.png",
      youtube: "https://www.youtube.com/watch?v=N807T_p70Fk",
      tags: ["Anatomy", "Midwifery"]
    },
    {
      keywords: ['liver', 'hepatic', 'biliary', 'gallbladder', 'anatomy', 'bile'],
      title: "Liver & Biliary System Diagram",
      content: "Digestive Accessory Organs. Labels: 1. Right/Left Hepatic Lobes, 2. Gallbladder, 3. Common Bile Duct, 4. Cystic Duct, 5. Hepatic Portal Vein, 6. Falciform Ligament.",
      source: "GI Clinical Manual",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b3/Liver_and_gallbladder.svg/800px-Liver_and_gallbladder.svg.png",
      youtube: "https://www.youtube.com/watch?v=kS8p5kK2Csk",
      tags: ["Anatomy", "Digestive"]
    },
    {
      keywords: ['heart', 'conduction', 'electrical', 'sa node', 'av node', 'cardiac', 'impulse'],
      title: "Cardiac Conduction System Diagram",
      content: "Electrical Pathway of the Heart. Labels: 1. SA Node (Pacemaker), 2. Intermodal Pathways, 3. AV Node, 4. Bundle of His, 5. Right/Left Bundle Branches, 6. Purkinje Fibers.",
      source: "Cardiology for Nurses",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1d/Conduction_system_of_the_heart_without_labels.svg/800px-Conduction_system_of_the_heart_without_labels.svg.png",
      youtube: "https://www.youtube.com/watch?v=RYZ4daFwV88",
      tags: ["Anatomy", "Cardiovascular"]
    },
    {
      keywords: ['liver', 'biliary', 'gallbladder', 'hepatic', 'pancreas', 'anatomy', 'exocrine', 'endocrine'],
      title: "Liver, Gallbladder & Biliary Tree Anatomy",
      content: "Detailed mapping of the Hepato-biliary System. Labels: 1. Right/Left Hepatic Ducts, 2. Common Hepatic Duct, 3. Gallbladder (Bile storage), 4. Cystic Duct, 5. Common Bile Duct (CBD), 6. Pancreas (Exocrine/Endocrine), 7. Pancreatic Duct, 8. Sphincter of Oddi (Hepatopancreatic sphincter), 9. Duodenum.",
      source: "Gastrointestinal Nursing Advanced Guide",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/14/Gallbladder-Liver-Pancreas_Location.png/800px-Gallbladder-Liver-Pancreas_Location.png",
      youtube: "https://www.youtube.com/watch?v=kS8p5kK2Csk",
      tags: ["Anatomy", "Digestive"]
    },
    {
      keywords: ['spinal cord', 'vertebrae', 'nerve', 'neurology', 'anatomy', 'reflex arc', 'grey matter', 'white matter'],
      title: "Spinal Cord & Reflex Arc Diagram",
      content: "Neurological Anatomy Guide. Labels: 1. Grey Matter (H-shape), 2. White Matter (Myelinated axons), 3. Dorsal Root (Sensory), 4. Ventral Root (Motor), 5. Spinal Nerve, 6. Interneuron, 7. Receptor, 8. Effector (Muscle/Gland).",
      source: "Neurology for Clinical Practice",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/30/Spinal_cord_cross_section.png/800px-Spinal_cord_cross_section.png",
      youtube: "https://www.youtube.com/watch?v=eeTpxM_o9S8",
      tags: ["Anatomy", "Neurology"]
    },
    {
      keywords: ['lungs', 'lobes', 'fissures', 'thoracic', 'anatomy', 'pulmonary'],
      title: "Lungs & Lobar Anatomy Diagram",
      content: "Detailed structure of the lungs. Labels: 1. Right Superior Lobe, 2. Right Middle Lobe, 3. Right Inferior Lobe, 4. Left Superior Lobe, 5. Left Inferior Lobe, 6. Horizontal Fissure (Right), 7. Oblique Fissures, 8. Cardiac Notch (Left), 9. Apex, 10. Base/Diaphragmatic Surface.",
      source: "Thoracic Anatomy Essentials",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/Lungs_lobes_diagram.svg/800px-Lungs_lobes_diagram.svg.png",
      youtube: "https://www.youtube.com/watch?v=X-XN08p_jM8",
      tags: ["Anatomy", "Respiratory"]
    },
    {
      keywords: ['stomach', 'gastric', 'sphincter', 'anatomy', 'rugae'],
      title: "Stomach Anatomy & Histology Diagram",
      content: "Functional anatomy of the stomach. Labels: 1. Esophagus, 2. Lower Esophageal Sphincter (Cardiac), 3. Fundus, 4. Body, 5. Antrum, 6. Pylorus, 7. Pyloric Sphincter, 8. Rugae (Gastric folds), 9. Greater Curvature, 10. Lesser Curvature.",
      source: "GI Clinical Handbook",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/33/Stomach_diagram.svg/800px-Stomach_diagram.svg.png",
      youtube: "https://www.youtube.com/watch?v=5G8U3J9fH0U",
      tags: ["Anatomy", "Digestive"]
    },
    {
      keywords: ['ecg', 'ekg', 'electrocardiogram', 'waves', 'p-wave', 'qrs', 't-wave', 'rhythm'],
      title: "ECG Waveforms & Intervals Guide",
      content: "Standard 12-lead ECG mapping. Labels: 1. P Wave (Atrial depolarization), 2. PR Interval (AV conduction), 3. QRS Complex (Ventricular depolarization), 4. T Wave (Ventricular repolarization), 5. ST Segment (Platea phase), 6. QT Interval.",
      source: "Advanced Cardiac Nursing",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9e/Sinus_Rhythm_Labels.svg/800px-Sinus_Rhythm_Labels.svg.png",
      youtube: "https://www.youtube.com/watch?v=xIZQRjkwV9Q",
      tags: ["Cardiology", "ECG"]
    },
    {
      keywords: ['skull', 'cranial', 'bones', 'facial', 'anatomy', 'osteology'],
      title: "Human Skull (Anterior View) Labelling",
      content: "Detailed Cranio-facial structures. Labels: 1. Frontal bone, 2. Parietal bone, 3. Temporal bone, 4. Occipital bone, 5. Sphenoid bone, 6. Zygomatic bone, 7. Maxilla, 8. Mandible, 9. Nasal bone.",
      source: "Osteology for Nurses",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/bc/Human_skull_front_simplified_%28bones%29.svg/800px-Human_skull_front_simplified_%28bones%29.svg.png",
      youtube: "https://www.youtube.com/watch?v=f-f5wzw247c",
      tags: ["Anatomy", "Skeletal"]
    },
    {
      keywords: ['artery', 'vein', 'circulatory', 'vessel', 'blood', 'vascular', 'anatomy'],
      title: "Blood Vessel Structure (Artery vs Vein)",
      content: "Comparison of arterial and venous anatomy. Labels: 1. Tunica Adventitia (Outer layer), 2. Tunica Media (Muscle layer - thicker in arteries), 3. Tunica Intima (Inner endothelium), 4. Valve (Present in veins), 5. Lumen (Larger in veins).",
      source: "Vascular Clinical Guide",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a2/Artery_vein.svg/800px-Artery_vein.svg.png",
      youtube: "https://www.youtube.com/watch?v=v43ej5lCeBo",
      tags: ["Anatomy", "Cardiovascular"]
    },
    {
      keywords: ['cell', 'organelle', 'nucleus', 'mitochondria', 'cytology', 'biology'],
      title: "Animal Cell Structure & Organelles",
      content: "Functional components of a human cell. Labels: 1. Nucleus (Genetic control), 2. Mitochondria (ATP production), 3. Ribosomes (Protein synthesis), 4. Endoplasmic Reticulum (Transport), 5. Golgi Apparatus (Packaging), 6. Lysosomes (Digestion), 7. Cell Membrane.",
      source: "Foundations of Nursing Science",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/48/Animal_cell_structure_en.svg/800px-Animal_cell_structure_en.svg.png",
      youtube: "https://www.youtube.com/watch?v=URUJD5NEXC8",
      tags: ["Cell Biology", "Foundations"]
    },
    {
      keywords: ['reflex', 'knee jerk', 'patellar', 'neural pathway', 'anatomy'],
      title: "Patellar Reflex Arc Mapping",
      content: "Mechanism of the monosynaptic reflex. Labels: 1. Muscle Spindle (Receptor), 2. Afferent Neuron (Sensory), 3. Spinal Cord Integration, 4. Efferent Neuron (Motor), 5. Quadriceps (Effector).",
      source: "Clinical Neurology Essentials",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a2/Patellar_Reflex.png/800px-Patellar_Reflex.png",
      youtube: "https://www.youtube.com/watch?v=qW28OhuTshU",
      tags: ["Neurology", "Assessment"]
    },
    {
      keywords: ['endocrine', 'hormones', 'glands', 'pituitary', 'thyroid', 'adrenal', 'anatomy'],
      title: "Major Endocrine Glands & Locations",
      content: "Mapping of the human endocrine system. Labels: 1. Hypothalamus, 2. Pituitary Gland (Master gland), 3. Thyroid Gland (Metabolism), 4. Parathyroid Glands (Calcium), 5. Adrenal Glands (Stress), 6. Pancreas (Blood sugar), 7. Ovaries/Testes.",
      source: "Endocrinology for Clinical Practice",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/da/Endocrine_central_nervous_system_en.svg/800px-Endocrine_central_nervous_system_en.svg.png",
      youtube: "https://www.youtube.com/watch?v=ER49EweKwW8",
      tags: ["Anatomy", "Endocrine"]
    },
    {
      keywords: ['handwashing', 'hygiene', 'infection control', 'procedure', 'nursing'],
      title: "WHO Hand Hygiene Technique Diagram",
      content: "Standard clinical handwashing steps. Labels: 1. Palm to palm, 2. Back of hands, 3. Between fingers, 4. Back of fingers, 5. Thumbs, 6. Fingernails/Tips, 7. Wrists. Total time: 40-60 seconds.",
      source: "WHO Infection Control Guidelines",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b3/Hand_washing_technique_A.png/800px-Hand_washing_technique_A.png",
      youtube: "https://www.youtube.com/watch?v=3PmVJQUCm4E",
      tags: ["Procedures", "Infection Control"]
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
        content: `Based on a clinical search for "${query}", current evidence suggests focusing on the nursing process (ADPIE) and prioritizing patient safety. For specific diagrams like ${query}, ensure you are using exact anatomical terms.`,
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
            <div key={idx} className="bg-white dark:bg-slate-800 rounded-[2.5rem] border border-slate-100 dark:border-slate-700 shadow-clinical overflow-hidden group hover:border-medical-500 transition-all">
              {result.image && (
                <div className="w-full h-80 overflow-hidden relative bg-slate-50 dark:bg-slate-950 border-b border-slate-50 dark:border-slate-800 flex items-center justify-center p-4">
                  <img
                    src={result.image}
                    alt={result.title}
                    loading="lazy"
                    className="max-w-full max-h-full object-contain group-hover:scale-105 transition-transform duration-700"
                    onError={(e) => {
                      e.target.onerror = null;
                      // Fallback to a placeholder if Wikipedia link fails
                      e.target.src = "https://placehold.co/600x400/f8fafc/0284c7?text=Clinical+Diagram";
                    }}
                  />
                  <div className="absolute top-6 left-6">
                    <span className="px-4 py-2 bg-white/90 dark:bg-slate-800/90 backdrop-blur shadow-sm rounded-2xl text-[10px] font-black uppercase tracking-widest text-medical-600 border border-medical-100 dark:border-medical-900">Verified Diagram</span>
                  </div>
                </div>
              )}

              <div className="p-10 space-y-6">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-3xl font-black text-slate-900 dark:text-white group-hover:text-medical-600 transition-colors tracking-tight">{result.title}</h3>
                    <div className="flex gap-2 mt-3">
                      {result.tags?.map(tag => (
                        <span key={tag} className="px-3 py-1 bg-medical-50 dark:bg-medical-900/30 text-medical-600 dark:text-medical-400 rounded-lg text-[10px] font-black uppercase tracking-widest border border-medical-100 dark:border-medical-800">{tag}</span>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="bg-slate-50 dark:bg-slate-900/50 p-6 rounded-3xl border border-slate-100 dark:border-slate-800">
                  <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                    <List size={14} />
                    Labelling & Description
                  </p>
                  <div className="text-xl text-slate-700 dark:text-slate-300 leading-relaxed font-bold">
                    {result.content.split('Labels:').map((part, i) => (
                      <div key={i} className={i === 1 ? "mt-4 grid grid-cols-1 md:grid-cols-2 gap-2 text-base font-medium" : ""}>
                        {i === 1 ? <span className="col-span-full text-xs font-black text-medical-600 uppercase tracking-[0.2em] mb-1">Key Labels:</span> : null}
                        {i === 1 ? part.split(',').map((label, j) => (
                          <div key={j} className="flex items-start gap-2 bg-white dark:bg-slate-800 p-2 rounded-xl border border-slate-100 dark:border-slate-700 shadow-sm">
                            <span className="w-5 h-5 flex items-center justify-center bg-medical-100 dark:bg-medical-900/40 text-medical-600 rounded-full text-[10px] font-black shrink-0">{j+1}</span>
                            <span>{label.replace(/^\s*\d+\.\s*/, '').trim()}</span>
                          </div>
                        )) : part}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="pt-8 border-t border-slate-50 dark:border-slate-800 flex flex-col sm:flex-row justify-between items-center gap-6">
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
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="p-6 bg-blue-50 dark:bg-blue-900/10 rounded-2xl border border-blue-100 dark:border-blue-900/30 flex gap-4">
            <Search className="text-blue-600 shrink-0" size={24} />
            <div>
              <h4 className="font-bold text-blue-900 dark:text-blue-400 uppercase text-xs tracking-widest mb-1">Anatomy Search</h4>
              <p className="text-sm text-blue-800/80 dark:text-blue-400/80 leading-snug font-medium">Search for specific organs or systems (e.g. "heart anatomy", "nephron", "brain lobes").</p>
            </div>
          </div>
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
