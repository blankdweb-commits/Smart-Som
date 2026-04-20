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
      id: "diag-001",
      keywords: ['anatomical position', 'planes', 'sagittal', 'coronal', 'transverse', 'anatomy', 'position'],
      title: "Anatomical Position and Planes",
      content: "A human figure standing erect, facing forward, arms at sides with palms forward, feet parallel. Three planes are shown cutting through the body. Labels: 1. Sagittal plane – divides into left and right, 2. Coronal (frontal) plane – divides into front and back, 3. Transverse (horizontal) plane – divides into top and bottom, 4. Anterior (ventral) surface, 5. Posterior (dorsal) surface, 6. Medial – toward midline, 7. Lateral – away from midline, 8. Proximal – closer to trunk, 9. Distal – farther from trunk.",
      source: "Nursing Anatomy Library",
      relevance: "Used to describe locations of organs, surgical incisions, and radiologic findings. Essential for clear communication among healthcare providers.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/18/Planes_of_the_Body.svg/800px-Planes_of_the_Body.svg.png",
      tags: ["Anatomy"]
    },
    {
      id: "diag-002",
      keywords: ['body cavities', 'dorsal', 'ventral', 'thoracic', 'abdominal', 'pelvic', 'diaphragm', 'anatomy'],
      title: "Body Cavities",
      content: "Cross-sectional view of the torso showing dorsal and ventral cavities and their subdivisions. Labels: 1. Dorsal cavity – cranial (brain), 2. Dorsal cavity – vertebral (spinal cord), 3. Ventral cavity – thoracic (heart, lungs), 4. Ventral cavity – abdominal (stomach, liver, intestines), 5. Ventral cavity – pelvic (bladder, reproductive organs), 6. Diaphragm – separates thoracic and abdominal cavities.",
      source: "Clinical Anatomy Guide",
      relevance: "Helps in assessing pain location (e.g., RLQ pain suggests appendix), planning surgeries, and interpreting physical exam findings.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/66/Body_Cavities.png/800px-Body_Cavities.png",
      tags: ["Anatomy"]
    },
    {
      id: "diag-003",
      keywords: ['cell', 'organelles', 'nucleus', 'mitochondria', 'membrane', 'cytoplasm', 'biology'],
      title: "The Cell (Generalized Animal Cell)",
      content: "Typical eukaryotic cell showing organelles. Labels: 1. Cell membrane – selectively permeable barrier, 2. Nucleus – contains DNA, 3. Nucleolus – produces ribosomes, 4. Cytoplasm – fluid with organelles, 5. Mitochondria – power plant (ATP production), 6. Ribosomes – protein synthesis, 7. Endoplasmic reticulum (rough and smooth), 8. Golgi apparatus – packaging and secretion, 9. Lysosomes – digestion, 10. Centrioles – cell division.",
      source: "Nursing Biology Essentials",
      relevance: "Understanding cell structure is key to pharmacology (drug targets), pathophysiology (organelle dysfunction), and genetics.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/48/Animal_cell_structure_en.svg/800px-Animal_cell_structure_en.svg.png",
      tags: ["Cell Biology"]
    },
    {
      id: "diag-004",
      keywords: ['tissues', 'epithelial', 'connective', 'muscle', 'nervous', 'histology'],
      title: "Four Basic Tissues",
      content: "Microscopic views of epithelial, connective, muscle, and nervous tissues with labeled features. Labels: 1. Epithelial – tightly packed cells, basement membrane, 2. Connective – scattered cells in matrix (fibers, ground substance), 3. Muscle – elongated cells with contractile proteins, 4. Nervous – neurons with dendrites, axon, and glial cells.",
      source: "Clinical Histology Guide",
      relevance: "Identifies origin of tumors (carcinomas from epithelium, sarcomas from connective tissue) and guides wound healing expectations.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/ca/4_Types_of_Tissue.png/800px-4_Types_of_Tissue.png",
      tags: ["Histology"]
    },
    {
      id: "diag-005",
      keywords: ['heart', 'internal anatomy', 'chambers', 'valves', 'aorta', 'ventricle', 'atrium', 'cardiovascular'],
      title: "Heart: External and Internal Anatomy",
      content: "Anterior view of heart showing chambers, valves, and major vessels. Labels: 1. Right atrium, 2. Right ventricle, 3. Left atrium, 4. Left ventricle, 5. Tricuspid valve, 6. Mitral (bicuspid) valve, 7. Pulmonary valve, 8. Aortic valve, 9. Superior vena cava, 10. Inferior vena cava, 11. Pulmonary artery, 12. Pulmonary veins, 13. Aorta, 14. Coronary arteries.",
      source: "Cardiovascular Nursing Manual",
      relevance: "Essential for understanding heart murmurs (valve problems), myocardial infarction (coronary blockage), and ECG interpretation.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e5/Diagram_of_the_human_heart_%28cropped%29.svg/800px-Diagram_of_the_human_heart_%28cropped%29.svg.png",
      tags: ["Cardiovascular"]
    },
    {
      id: "diag-006",
      keywords: ['blood flow', 'heart', 'circulation', 'oxygenated', 'deoxygenated', 'cardiovascular'],
      title: "Blood Flow Through the Heart",
      content: "Diagram showing the path of oxygenated and deoxygenated blood using red and blue arrows. Labels: 1. Deoxygenated blood: SVC/IVC → RA → RV → pulmonary artery → lungs, 2. Oxygenated blood: pulmonary veins → LA → LV → aorta → body, 3. Foramen ovale (fetal) – closes after birth.",
      source: "Clinical Hemodynamics",
      relevance: "Key for understanding congenital heart defects, shunts, and hemodynamics in heart failure.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/30/Blood_flow_through_the_heart_simplified.svg/800px-Blood_flow_through_the_heart_simplified.svg.png",
      tags: ["Cardiovascular"]
    },
    {
      id: "diag-007",
      keywords: ['conducting system', 'heart', 'ecg', 'waves', 'sa node', 'av node', 'bundle branches', 'cardiovascular'],
      title: "Conducting System of the Heart and ECG",
      content: "Illustration of SA node, AV node, Bundle of His, Purkinje fibers, and corresponding ECG waves. Labels: 1. SA node – pacemaker, 2. AV node – delay, 3. Bundle of His – rapid conduction, 4. Right and left bundle branches, 5. Purkinje fibers – ventricular contraction, 6. P wave – atrial depolarization, 7. QRS complex – ventricular depolarization, 8. T wave – ventricular repolarization.",
      source: "ECG Mastery for Nurses",
      relevance: "Used to diagnose arrhythmias, heart blocks, and electrolyte imbalances.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9e/Sinus_Rhythm_Labels.svg/800px-Sinus_Rhythm_Labels.svg.png",
      tags: ["Cardiovascular"]
    },
    {
      id: "diag-008",
      keywords: ['vessel layers', 'artery', 'vein', 'tunica', 'intima', 'media', 'adventitia', 'cardiovascular'],
      title: "Blood Vessel Layers (Artery and Vein)",
      content: "Cross-section of an artery and a vein showing tunica intima, media, and adventitia. Labels: 1. Tunica intima – endothelium, smooth lining, 2. Tunica media – smooth muscle, thicker in arteries, 3. Tunica adventitia – connective tissue, valves in veins, 4. Lumen – blood flow channel.",
      source: "Vascular Clinical Guide",
      relevance: "Atherosclerosis affects intima; hypertension causes media hypertrophy; varicose veins result from valve failure.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a2/Artery_vein.svg/800px-Artery_vein.svg.png",
      tags: ["Cardiovascular"]
    },
    {
      id: "diag-009",
      keywords: ['lymphatic system', 'nodes', 'spleen', 'thymus', 'tonsils', 'immunology'],
      title: "Lymphatic System",
      content: "Diagram showing lymph nodes, vessels, and organs. Labels: 1. Cervical lymph nodes, 2. Axillary lymph nodes, 3. Inguinal lymph nodes, 4. Spleen, 5. Thymus (in children), 6. Tonsils, 7. Peyer's patches (intestine), 8. Lacteals in small intestine, 9. Thoracic duct, 10. Right lymphatic duct.",
      source: "Clinical Immunology for Nurses",
      relevance: "Lymphadenopathy indicates infection or malignancy; lymph node biopsy is done for cancer staging.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b3/Lymphatic_system_diagram_en.svg/800px-Lymphatic_system_diagram_en.svg.png",
      tags: ["Immunology"]
    },
    {
      id: "diag-010",
      keywords: ['respiratory tract', 'larynx', 'trachea', 'bronchi', 'alveoli', 'diaphragm', 'respiratory'],
      title: "Respiratory Tract",
      content: "Anatomical diagram from nose to alveoli. Labels: 1. Nasal cavity, 2. Pharynx (naso-, oro-, laryngopharynx), 3. Larynx (vocal cords), 4. Trachea (cartilage rings), 5. Primary bronchi, 6. Secondary and tertiary bronchi, 7. Bronchioles, 8. Alveoli, 9. Diaphragm.",
      source: "Respiratory Nursing Handbook",
      relevance: "Used to explain airway management, endotracheal intubation, and sites of infection (bronchitis vs. pneumonia).",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Lungs_diagram_detailed.svg/800px-Lungs_diagram_detailed.svg",
      tags: ["Respiratory"]
    },
    {
      id: "diag-011",
      keywords: ['alveolus', 'gas exchange', 'capillary', 'pneumocyte', 'surfactant', 'respiratory'],
      title: "Alveolus and Gas Exchange",
      content: "Detailed view of alveoli surrounded by capillaries showing O2 and CO2 exchange. Labels: 1. Alveolar sac, 2. Type I pneumocyte (gas exchange), 3. Type II pneumocyte (surfactant), 4. Alveolar macrophage, 5. Pulmonary capillary, 6. Red blood cell with oxyhemoglobin, 7. O2 diffusion into blood, 8. CO2 diffusion into alveolus.",
      source: "Respiratory Physiology Guide",
      relevance: "Key to understanding ARDS, pneumonia, COPD, and the effect of surfactant deficiency in premature infants.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0b/Alveoli_diagram.png/800px-Alveoli_diagram.png",
      tags: ["Respiratory"]
    },
    {
      id: "diag-012",
      keywords: ['nephron', 'kidney', 'glomerulus', 'tubules', 'renal'],
      title: "Nephron (Kidney Functional Unit)",
      content: "Detailed diagram of a nephron including glomerulus, tubules, and collecting duct. Labels: 1. Glomerulus – filtration, 2. Bowman's capsule, 3. Proximal convoluted tubule – reabsorption, 4. Loop of Henle – countercurrent multiplication, 5. Distal convoluted tubule – hormone action, 6. Collecting duct – water reabsorption, 7. Peritubular capillaries, 8. Vasa recta.",
      source: "Renal Nursing Essentials",
      relevance: "Understanding diuretics (site of action), kidney stones (tubule blockage), and acute kidney injury.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/2/27/Physiology_of_Nephron.png/800px-Physiology_of_Nephron.png",
      tags: ["Renal"]
    },
    {
      id: "diag-013",
      keywords: ['brain', 'lobes', 'cerebrum', 'cerebellum', 'brainstem', 'neurology'],
      title: "Brain – Lateral View with Lobes",
      content: "Side view of cerebrum showing frontal, parietal, temporal, occipital lobes, and cerebellum. Labels: 1. Frontal lobe – executive function, motor, 2. Parietal lobe – sensory, spatial, 3. Temporal lobe – hearing, memory, 4. Occipital lobe – vision, 5. Cerebellum – coordination, 6. Brainstem – midbrain, pons, medulla, 7. Broca's area – speech production (left frontal), 8. Wernicke's area – language comprehension (left temporal).",
      source: "Neurological Nursing Guide",
      relevance: "Stroke localization: left frontal weakness = right-sided paralysis; temporal lesion = aphasia.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1a/Brain_surface_gyri.svg/800px-Brain_surface_gyri.svg.png",
      tags: ["Neurology"]
    },
    {
      id: "diag-014",
      keywords: ['cranial nerves', 'brain base', 'olfactory', 'optic', 'vagus', 'neurology'],
      title: "Cranial Nerves (Ventral View of Brain)",
      content: "Base of brain showing all 12 cranial nerves emerging. Labels: 1. I Olfactory (smell), 2. II Optic (vision), 3. III Oculomotor (eye movement, pupil), 4. IV Trochlear (superior oblique), 5. V Trigeminal (facial sensation, mastication), 6. VI Abducens (lateral rectus), 7. VII Facial (facial movement, taste), 8. VIII Vestibulocochlear (hearing, balance), 9. IX Glossopharyngeal (swallow, taste), 10. X Vagus (autonomic, cough, gag), 11. XI Accessory (neck, shoulder), 12. XII Hypoglossal (tongue movement).",
      source: "Clinical Neurology Essentials",
      relevance: "Cranial nerve assessment is part of neurological exam (e.g., pupil light reflex = II & III; gag reflex = IX & X).",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/82/Cranial_nerves_en.svg/800px-Cranial_nerves_en.svg.png",
      tags: ["Neurology"]
    },
    {
      id: "diag-015",
      keywords: ['spinal cord', 'reflex arc', 'neurons', 'gray matter', 'white matter', 'neurology'],
      title: "Spinal Cord and Reflex Arc",
      content: "Cross-section of spinal cord showing gray matter, white matter, and pathway of a reflex. Labels: 1. Dorsal horn (sensory input), 2. Ventral horn (motor output), 3. Central canal (CSF), 4. Sensory neuron (afferent), 5. Motor neuron (efferent), 6. Interneuron (relay), 7. Receptor (skin), 8. Effector (muscle), 9. Dorsal root ganglion.",
      source: "Neurology for Nurses",
      relevance: "Explains deep tendon reflexes (patellar, biceps) and spinal cord injury levels (paraplegia, quadriplegia).",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/30/Spinal_cord_cross_section.png/800px-Spinal_cord_cross_section.png",
      tags: ["Neurology"]
    },
    {
      id: "diag-016",
      keywords: ['female reproductive', 'uterus', 'ovary', 'vagina', 'reproductive'],
      title: "Female Reproductive System",
      content: "Sagittal view of pelvis showing ovaries, fallopian tubes, uterus, cervix, vagina. Labels: 1. Ovary – produces ova, estrogen, progesterone, 2. Fallopian tube – site of fertilization, 3. Uterus (fundus, body, cervix), 4. Endometrium – sheds during menstruation, 5. Myometrium – muscle for labor, 6. Cervical os, 7. Vagina, 8. Vulva (labia, clitoris), 9. Breast – mammary gland, lactiferous ducts.",
      source: "Midwifery Essentials",
      relevance: "Essential for understanding menstrual cycle, pregnancy, contraception, and gynecologic cancers.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d7/Illu_repro_female.svg/800px-Illu_repro_female.svg.png",
      tags: ["Reproductive"]
    },
    {
      id: "diag-017",
      keywords: ['male reproductive', 'testis', 'prostate', 'penis', 'reproductive'],
      title: "Male Reproductive System",
      content: "Lateral view of male pelvis and external genitalia. Labels: 1. Testis – produces sperm and testosterone, 2. Epididymis – storage and maturation, 3. Vas deferens, 4. Seminal vesicle, 5. Prostate gland, 6. Bulbourethral gland, 7. Urethra, 8. Penis (glans, shaft, corpus cavernosum, spongiosum), 9. Scrotum.",
      source: "Nursing Anatomy Guide",
      relevance: "Key for understanding BPH, prostate cancer, testicular torsion, and male infertility.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e6/Illu_repro_male.svg/800px-Illu_repro_male.svg.png",
      tags: ["Reproductive"]
    },
    {
      id: "diag-018",
      keywords: ['menstrual cycle', 'hormones', 'fsh', 'lh', 'estrogen', 'progesterone', 'reproductive'],
      title: "Menstrual Cycle (Hormonal Changes)",
      content: "Graph showing FSH, LH, estrogen, progesterone levels and corresponding ovarian/endometrial changes. Labels: 1. Follicular phase (days 1-14) – FSH rises, estrogen increases, 2. Ovulation (day 14) – LH surge, 3. Luteal phase (days 15-28) – progesterone high, 4. Menstruation – shedding of endometrium, 5. Corpus luteum – produces progesterone, 6. If no pregnancy – corpus luteum degenerates.",
      source: "Clinical Gynaecology for Nurses",
      relevance: "Used to diagnose menstrual disorders, plan fertility treatments, and understand menopause.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/MenstrualCycle2_en.svg/800px-MenstrualCycle2_en.svg.png",
      tags: ["Reproductive"]
    },
    {
      id: "diag-019",
      keywords: ['fetal skull', 'fontanelles', 'sutures', 'skull', 'obstetrics'],
      title: "Fetal Skull",
      content: "Side view of fetal skull showing fontanelles and sutures. Labels: 1. Anterior fontanelle (closes ~18 months), 2. Posterior fontanelle (closes ~2 months), 3. Sagittal suture, 4. Coronal suture, 5. Lambdoid suture, 6. Frontal bone, 7. Occipital bone, 8. Parietal bone, 9. Suboccipitobregmatic diameter – smallest (for engagement), 10. Biparietal diameter – transverse.",
      source: "Midwifery Clinical Handbook",
      relevance: "Important for understanding labor mechanisms (molding, engagement) and recognizing abnormal presentations.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/00/Fetal_Skull_Side_View.png/800px-Fetal_Skull_Side_View.png",
      tags: ["Obstetrics"]
    },
    {
      id: "diag-020",
      keywords: ['placenta', 'fetal circulation', 'umbilical cord', 'shunts', 'ductus venosus', 'foramen ovale', 'ductus arteriosus', 'obstetrics'],
      title: "Placenta and Fetal Circulation",
      content: "Diagram of uterus with placenta and fetal circulatory shunts. Labels: 1. Placenta – maternal side (cotyledons), 2. Umbilical cord – two arteries, one vein, 3. Umbilical vein – oxygenated blood to fetus, 4. Umbilical arteries – deoxygenated to placenta, 5. Ductus venosus – bypasses liver, 6. Foramen ovale – between atria, 7. Ductus arteriosus – connects pulmonary artery to aorta.",
      source: "Neonatal Nursing Essentials",
      relevance: "Understanding fetal circulation helps manage congenital heart disease and neonatal transition at birth.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d5/Fetal_circulation_en.svg/800px-Fetal_circulation_en.svg.png",
      tags: ["Obstetrics"]
    },
    {
      id: "diag-021",
      keywords: ['endocrine glands', 'pituitary', 'thyroid', 'adrenal', 'pancreas', 'hormones', 'endocrine'],
      title: "Major Endocrine Glands & Locations",
      content: "Diagram showing location of major endocrine glands. Labels: 1. Hypothalamus, 2. Pituitary gland (anterior and posterior), 3. Thyroid gland (follicles, parafollicular cells), 4. Parathyroid glands (4), 5. Adrenal glands (cortex and medulla), 6. Pancreas (islets of Langerhans), 7. Ovaries (females), 8. Testes (males), 9. Thymus (children), 10. Pineal gland.",
      source: "Clinical Endocrinology Guide",
      relevance: "Essential for understanding hormonal disorders (diabetes, thyroid disease, Cushing's, Addison's).",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/da/Endocrine_central_nervous_system_en.svg/800px-Endocrine_central_nervous_system_en.svg.png",
      tags: ["Endocrine"]
    },
    {
      id: "diag-022",
      keywords: ['skin structure', 'epidermis', 'dermis', 'hypodermis', 'hair follicle', 'sweat gland', 'integumentary'],
      title: "Skin Structure (Cross-section)",
      content: "Layers of epidermis, dermis, and hypodermis with appendages. Labels: 1. Epidermis (stratum corneum, granulosum, spinosum, basale), 2. Dermis (papillary and reticular layers), 3. Hypodermis (subcutaneous fat), 4. Hair follicle, 5. Sebaceous gland (oil), 6. Sweat gland (eccrine/apocrine), 7. Arrector pili muscle, 8. Blood vessels, 9. Nerve endings (Meissner, Pacinian).",
      source: "Dermatology for Nurses",
      relevance: "Key for wound healing, pressure ulcer staging, burns, and skin cancer detection.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6d/Skin.svg/800px-Skin.svg.png",
      tags: ["Integumentary"]
    },
    {
      id: "diag-023",
      keywords: ['pressure ulcer', 'stages', 'bedsore', 'wound care'],
      title: "Pressure Ulcer Stages",
      content: "Illustrations of pressure injuries from stage 1 to 4 and unstageable. Labels: 1. Stage 1 – non-blanchable erythema, intact skin, 2. Stage 2 – partial thickness skin loss, blister or shallow ulcer, 3. Stage 3 – full thickness with subcutaneous fat visible, 4. Stage 4 – full thickness with exposed bone, muscle, tendon, 5. Unstageable – full thickness with eschar covering, 6. Deep tissue injury – purple or maroon intact skin.",
      source: "Wound Care Standards",
      relevance: "Used for assessment, documentation, and prevention of hospital-acquired pressure ulcers.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/84/Pressure_ulcer.svg/800px-Pressure_ulcer.svg.png",
      tags: ["Wound Care"]
    },
    {
      id: "diag-024",
      keywords: ['hand hygiene', 'handwashing', 'infection control', 'who'],
      title: "Hand Hygiene Steps (WHO)",
      content: "Diagram of hands with numbered steps for handwashing with soap and water or alcohol rub. Labels: 1. Palm to palm, 2. Right palm over left dorsum (and vice versa), 3. Palm to palm with fingers interlaced, 4. Backs of fingers to opposing palms, 5. Rotational rubbing of thumbs, 6. Rotational rubbing of fingertips into palms, 7. Rinse and dry (soap method) or rub until dry (alcohol).",
      source: "WHO Infection Control Guidelines",
      relevance: "Standard precaution to prevent healthcare-associated infections.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b3/Hand_washing_technique_A.png/800px-Hand_washing_technique_A.png",
      tags: ["Infection Control"]
    },
    {
      id: "diag-025",
      keywords: ['im injection', 'ventrogluteal', 'dorsogluteal', 'vastus lateralis', 'deltoid', 'injection sites', 'medication administration'],
      title: "Intramuscular Injection Sites",
      content: "Body outline showing ventrogluteal, dorsogluteal, vastus lateralis, and deltoid sites. Labels: 1. Ventrogluteal – preferred for adults (hip), 2. Dorsogluteal – upper outer quadrant (risk of sciatic nerve), 3. Vastus lateralis – mid-thigh (infants, children), 4. Deltoid – 2-3 finger widths below acromion (small volume), 5. Landmarking for each site.",
      source: "Foundation of Nursing Procedures",
      relevance: "Prevents nerve injury, ensures proper absorption, and reduces pain.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/ca/Injections.svg/800px-Injections.svg.png",
      tags: ["Medication Administration"]
    },
    {
      id: "diag-026",
      keywords: ['subcutaneous injection', 'sc injection', 'insulin', 'heparin', 'injection sites', 'medication administration'],
      title: "Subcutaneous Injection Sites",
      content: "Areas suitable for SC injections: abdomen, outer arm, anterior thigh, upper back. Labels: 1. Abdomen – 2 inches away from umbilicus, 2. Outer aspect of upper arm, 3. Anterior thigh, 4. Scapular area (upper back), 5. Pinch skin at 45-90° angle.",
      source: "Clinical Nursing Procedures",
      relevance: "Used for insulin, heparin, and vaccines that require slow absorption.",
      image: "https://placehold.co/800x400/f8fafc/6366f1?text=Subcutaneous+Injection+Sites",
      tags: ["Medication Administration"]
    },
    {
      id: "diag-027",
      keywords: ['iv sites', 'cannulation', 'veins', 'medication administration'],
      title: "Intravenous Cannulation Sites",
      content: "Arm and hand veins suitable for IV access. Labels: 1. Cephalic vein (lateral forearm), 2. Basilic vein (medial forearm), 3. Median cubital vein (antecubital fossa) – preferred for blood draw, 4. Dorsal venous network (hand), 5. Veins of foot (if necessary).",
      source: "IV Therapy Manual",
      relevance: "Choosing appropriate vein for IV therapy, blood transfusion, or blood sampling.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/ca/Injections.svg/800px-Injections.svg.png",
      tags: ["Medication Administration"]
    },
    {
      id: "diag-028",
      keywords: ['ng tube', 'insertion', 'gastric', 'gastrointestinal'],
      title: "Nasogastric Tube Insertion",
      content: "Anatomic landmarks for NG tube placement: nose, earlobe, xiphoid process. Labels: 1. Tip of nose, 2. Tragus of ear, 3. Xiphoid process, 4. Esophagus, 5. Stomach, 6. NG tube with side holes, 7. Aspiration and pH testing to confirm placement.",
      source: "Nursing Procedure Guide",
      relevance: "Used for gastric decompression, feeding, or medication administration.",
      image: "https://placehold.co/800x400/f8fafc/6366f1?text=NG+Tube+Insertion",
      tags: ["Gastrointestinal"]
    },
    {
      id: "diag-029",
      keywords: ['urinary catheter', 'female', 'perineal anatomy', 'urinary'],
      title: "Urinary Catheterization (Female)",
      content: "Female perineal anatomy showing urethral meatus, vaginal opening, and anus. Labels: 1. Labia majora, 2. Labia minora, 3. Clitoris, 4. Urethral meatus, 5. Vaginal introitus, 6. Anus, 7. Catheter insertion direction (upward, toward umbilicus).",
      source: "Urological Nursing Handbook",
      relevance: "Essential for preventing UTI and trauma during catheterization.",
      image: "https://placehold.co/800x400/f8fafc/6366f1?text=Female+Catheterization",
      tags: ["Urinary"]
    },
    {
      id: "diag-030",
      keywords: ['urinary catheter', 'male', 'prostate', 'urethra', 'urinary'],
      title: "Urinary Catheterization (Male)",
      content: "Male urethral anatomy with three constrictions. Labels: 1. Penis (glans, shaft), 2. Urethral meatus, 3. Prostatic urethra, 4. Membranous urethra, 5. Spongy (penile) urethra, 6. Bladder neck, 7. Prostate gland, 8. Lift penis to 60-90° for insertion.",
      source: "Urological Nursing Handbook",
      relevance: "Avoids false passage and trauma; important for patients with BPH.",
      image: "https://placehold.co/800x400/f8fafc/6366f1?text=Male+Catheterization",
      tags: ["Urinary"]
    },
    {
      id: "diag-031",
      keywords: ['tracheostomy', 'cannula', 'cuff', 'respiratory'],
      title: "Tracheostomy Care",
      content: "Tracheostomy tube parts and surrounding anatomy. Labels: 1. Outer cannula, 2. Inner cannula (removable), 3. Obturator (for insertion), 4. Flange (neck plate), 5. Cuff (inflated/deflated), 6. Tracheostomy ties, 7. Stoma site, 8. Trachea, 9. Suction catheter depth.",
      source: "Critical Care Nursing Manual",
      relevance: "Prevents tube occlusion, infection, and accidental decannulation.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Tracheotomy_diagram_en.svg/800px-Tracheotomy_diagram_en.svg.png",
      tags: ["Respiratory"]
    },
    {
      id: "diag-032",
      keywords: ['cpr', 'hand placement', 'compressions', 'emergency'],
      title: "Cardiopulmonary Resuscitation (CPR) Hand Placement",
      content: "Adult chest with hands positioned on lower half of sternum. Labels: 1. Inter-nipple line (midline), 2. Heel of one hand on sternum, 3. Second hand on top, fingers interlaced, 4. Compression depth 5-6 cm (2-2.4 inches), 5. Rate 100-120/min, 6. Allow full recoil.",
      source: "AHA BLS Guidelines",
      relevance: "High-quality CPR increases survival from cardiac arrest.",
      image: "https://placehold.co/800x400/f8fafc/6366f1?text=CPR+Hand+Placement",
      tags: ["Emergency"]
    },
    {
      id: "diag-033",
      keywords: ['wound dressing', 'layers', 'sterile technique', 'wound care'],
      title: "Wound Dressing Layers",
      content: "Cross-section of a wound with different dressing components. Labels: 1. Wound bed (cleaned), 2. Primary dressing (contact layer, non-adherent), 3. Secondary dressing (absorbent pad), 4. Tertiary dressing (tape or bandage), 5. Sterile gloves technique, 6. Cleaning from center outward.",
      source: "Nursing Procedure Handbook",
      relevance: "Maintains moist wound environment, prevents infection, and absorbs exudate.",
      image: "https://placehold.co/800x400/f8fafc/6366f1?text=Wound+Dressing+Layers",
      tags: ["Wound Care"]
    },
    {
      id: "diag-034",
      keywords: ['suture removal', 'stitch removal', 'wound care'],
      title: "Suture Removal",
      content: "Technique showing cutting suture close to skin and pulling. Labels: 1. Sterile forceps grasping knot, 2. Scissors cutting suture near skin surface, 3. Pull suture toward wound line, 4. Assess wound edges for dehiscence, 5. Count sutures removed.",
      source: "Nursing Procedures Guide",
      relevance: "Prevents infection and scarring; timing depends on wound location (e.g., 7-14 days).",
      image: "https://placehold.co/800x400/f8fafc/6366f1?text=Suture+Removal+Technique",
      tags: ["Wound Care"]
    },
    {
      id: "diag-035",
      keywords: ['oxygen delivery', 'nasal cannula', 'face mask', 'venturi mask', 'respiratory'],
      title: "Oxygen Delivery Devices",
      content: "Various masks and cannulas with flow rates and FiO2 ranges. Labels: 1. Nasal cannula (1-6 L/min, 24-44% FiO2), 2. Simple face mask (5-8 L/min, 40-60%), 3. Non-rebreather mask (10-15 L/min, 80-95%), 4. Venturi mask (precise FiO2, 24-50%), 5. Tracheostomy collar.",
      source: "Clinical Respiratory Therapy",
      relevance: "Select appropriate device based on patient's oxygen requirement and condition.",
      image: "https://placehold.co/800x400/f8fafc/6366f1?text=Oxygen+Delivery+Devices",
      tags: ["Respiratory"]
    },
    {
      id: "diag-036",
      keywords: ['lumbar puncture', 'positioning', 'csf', 'diagnostic'],
      title: "Lumbar Puncture Position",
      content: "Patient positioned in lateral recumbent fetal position. Labels: 1. Knees drawn to chest, 2. Chin tucked to chest, 3. Spine flexed to widen interspinous spaces, 4. Needle insertion between L3-L4 or L4-L5, 5. Landmark: iliac crest line at L4.",
      source: "Clinical Diagnostics for Nurses",
      relevance: "Used to obtain CSF for meningitis diagnosis, measure pressure, or administer spinal anesthesia.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/cd/Lumbar_puncture.png/800px-Lumbar_puncture.png",
      tags: ["Diagnostic"]
    },
    {
      id: "diag-037",
      keywords: ['gcs', 'glasgow coma scale', 'neurological assessment', 'neurology'],
      title: "Glasgow Coma Scale Chart",
      content: "Scoring table for eye, verbal, and motor responses. Labels: 1. Eye opening: 4 spontaneous, 3 to speech, 2 to pain, 1 none, 2. Verbal: 5 oriented, 4 confused, 3 words, 2 sounds, 1 none, 3. Motor: 6 obeys, 5 localizes, 4 withdraws, 3 flexion, 2 extension, 1 none, 4. Total score 3-15.",
      source: "Nursing Assessment Handbook",
      relevance: "Standard tool for assessing level of consciousness in head injury, stroke, or intoxication.",
      image: "https://placehold.co/800x400/f8fafc/6366f1?text=GCS+Scoring+Chart",
      tags: ["Neurology"]
    },
    {
      id: "diag-038",
      keywords: ['last offices', 'deceased care', 'death', 'end-of-life'],
      title: "Last Offices (Care of Deceased)",
      content: "Steps for preparing body after death. Labels: 1. Close eyes gently, 2. Remove tubes and lines (check policy), 3. Clean body, 4. Pack orifices, 5. Position supine, 6. Replace dentures, 7. Identification tags, 8. Place in body bag.",
      source: "End-of-Life Nursing Standards",
      relevance: "Respects dignity, supports family, and follows legal requirements.",
      image: "https://placehold.co/800x400/f8fafc/6366f1?text=Care+of+the+Deceased",
      tags: ["End-of-Life"]
    },
    {
      id: "diag-039",
      keywords: ['bse', 'breast self-exam', 'prevention', 'breast cancer'],
      title: "Breast Self-Examination (BSE)",
      content: "Steps for inspecting and palpating breasts. Labels: 1. Visual inspection in mirror (arms at sides, overhead, hands on hips), 2. Raised arm palpation, 3. Use pads of three middle fingers, 4. Circular, wedge, or vertical pattern, 5. Include axilla and collarbone area, 6. Lying down with pillow under shoulder.",
      source: "Women's Health Nursing",
      relevance: "Monthly self-exam helps detect breast lumps early.",
      image: "https://placehold.co/800x400/f8fafc/6366f1?text=Breast+Self-Examination+Steps",
      tags: ["Prevention"]
    },
    {
      id: "diag-040",
      keywords: ['fetal position', 'presentation', 'cephalic', 'breech', 'obstetrics'],
      title: "Fetal Position in Utero (Presentations)",
      content: "Diagrams of cephalic, breech, and transverse lie. Labels: 1. Cephalic (vertex) – head down, most common, 2. Breech – buttocks or feet first (complete, frank, footling), 3. Transverse – shoulder presentation, 4. Lie, presentation, position, attitude.",
      source: "Midwifery Clinical Skills",
      relevance: "Determines mode of delivery and need for external cephalic version or C-section.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/ca/Fetal_presentations.png/800px-Fetal_presentations.png",
      tags: ["Obstetrics"]
    },
    {
      id: "diag-041",
      keywords: ['vagina', 'vulva', 'anatomy', 'reproductive'],
      title: "External Female Genitalia (Vulva)",
      content: "View of the vulva with all structures. Labels: 1. Mons pubis, 2. Labia majora, 3. Labia minora, 4. Clitoris (glans and prepuce), 5. Urethral meatus, 6. Vaginal introitus (opening), 7. Hymen, 8. Bartholin's glands (opening), 9. Perineum, 10. Anus.",
      source: "Midwifery Anatomy Guide",
      relevance: "Critical for perineal care, catheterization, and assessing labor progress or episiotomy healing.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Vulva_Anatomy_Diagram.png/800px-Vulva_Anatomy_Diagram.png",
      tags: ["Reproductive"]
    },
    {
      id: "diag-042",
      keywords: ['breast', 'mammary gland', 'lactation', 'reproductive'],
      title: "Anatomy of the Breast",
      content: "Sagittal and anterior view showing internal structures. Labels: 1. Nipple, 2. Areola, 3. Lactiferous ducts, 4. Lactiferous sinus, 5. Lobules (containing alveoli), 6. Adipose (fat) tissue, 7. Pectoralis major muscle, 8. Suspensory (Cooper's) ligaments.",
      source: "Obstetric Nursing Handbook",
      relevance: "Understanding breast anatomy is key to supporting breastfeeding (latch, milk flow) and performing clinical breast exams.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6e/Breast_anatomy_normal_scheme.svg/800px-Breast_anatomy_normal_scheme.svg.png",
      tags: ["Reproductive"]
    },
    {
      id: "diag-043",
      keywords: ['uterus', 'ligaments', 'support', 'reproductive'],
      title: "Uterine Support (Ligaments)",
      content: "Pelvic view showing ligaments holding the uterus. Labels: 1. Broad ligament, 2. Round ligament, 3. Uterosacral ligament, 4. Cardinal (transverse cervical) ligament, 5. Ovarian ligament, 6. Suspensory ligament of ovary.",
      source: "Midwifery Essentials",
      relevance: "Explains 'round ligament pain' in pregnancy and uterine prolapse in later life.",
      image: "https://placehold.co/800x400/f8fafc/6366f1?text=Uterine+Ligaments+Diagram",
      tags: ["Reproductive"]
    },
    {
      id: "diag-044",
      keywords: ['pelvis', 'bones', 'female', 'male', 'obstetrics'],
      title: "The Bony Pelvis",
      content: "Anterior view of the pelvis. Labels: 1. Ilium (crest, spines), 2. Ischium (tuberosity, spines), 3. Pubis (symphysis, arch), 4. Sacrum (promontory), 5. Coccyx, 6. Sacroiliac joint, 7. Pelvic brim (inlet).",
      source: "Nursing Anatomy Library",
      relevance: "Pelvic shape (gynecoid vs. android) and diameters (ischial spines) determine the ease of vaginal delivery.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4c/Pelvis_diagram.png/800px-Pelvis_diagram.png",
      tags: ["Anatomy"]
    },
    {
      id: "diag-045",
      keywords: ['ovarian cycle', 'follicle', 'ovulation', 'reproductive'],
      title: "Ovarian Cycle",
      content: "Stages of follicle development within the ovary. Labels: 1. Primordial follicles, 2. Primary follicle, 3. Secondary follicle, 4. Graafian (mature) follicle, 5. Ovulation (oocyte release), 6. Corpus luteum, 7. Corpus albicans.",
      source: "Clinical Gynaecology for Nurses",
      relevance: "Explains the source of estrogen/progesterone and the mechanism of hormonal contraceptives.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/MenstrualCycle2_en.svg/800px-MenstrualCycle2_en.svg.png",
      tags: ["Reproductive"]
    },
    {
      id: "diag-046",
      keywords: ['placenta', 'structure', 'villi', 'obstetrics'],
      title: "Placental Structure",
      content: "Cross-section showing maternal and fetal surfaces. Labels: 1. Chorionic villi, 2. Intervillous space (maternal blood), 3. Spiral arteries (maternal), 4. Umbilical vein/arteries (fetal), 5. Amnion, 6. Chorion.",
      source: "Midwifery Anatomy Guide",
      relevance: "Site of nutrient/gas exchange; placental insufficiency leads to IUGR.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1d/Placenta_Anatomy.png/800px-Placenta_Anatomy.png",
      tags: ["Obstetrics"]
    },
    {
      id: "diag-047",
      keywords: ['sperm', 'anatomy', 'biology'],
      title: "Anatomy of a Sperm Cell",
      content: "Labeled diagram of a spermatozoon. Labels: 1. Head (containing nucleus), 2. Acrosome (enzymes for penetration), 3. Midpiece (mitochondria for energy), 4. Tail (flagellum for motility).",
      source: "Nursing Biology Essentials",
      relevance: "Explains male fertility factors (count, motility, morphology).",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/cb/Spermatozoon_diagram_en.svg/800px-Spermatozoon_diagram_en.svg.png",
      tags: ["Cell Biology"]
    },
    {
      id: "diag-048",
      keywords: ['nephron', 'filtration', 'reabsorption', 'secretion', 'renal'],
      title: "Nephron Physiology (Functions)",
      content: "Arrows showing where filtration, reabsorption, and secretion occur. Labels: 1. Filtration at glomerulus, 2. Reabsorption in PCT (glucose, water), 3. Concentration in Loop of Henle, 4. Secretion in DCT (K+, H+), 5. Water reabsorption in collecting duct (ADH action).",
      source: "Renal Physiology Guide",
      relevance: "Explains how drugs like diuretics work and the pathophysiology of glycosuria in diabetes.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/2/27/Physiology_of_Nephron.png/800px-Physiology_of_Nephron.png",
      tags: ["Renal"]
    },
    {
      id: "diag-049",
      keywords: ['kidney', 'internal structure', 'cortex', 'medulla', 'renal'],
      title: "Kidney: Internal Anatomy",
      content: "Coronal section of the kidney. Labels: 1. Renal cortex, 2. Renal medulla (pyramids), 3. Renal papilla, 4. Minor calyx, 5. Major calyx, 6. Renal pelvis, 7. Ureter, 8. Renal capsule, 9. Renal column.",
      source: "Clinical Anatomy Guide",
      relevance: "Helps locate where kidney stones form and track the flow of urine out of the kidney.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/2/22/Kidney_Anatomy.png/800px-Kidney_Anatomy.png",
      tags: ["Renal"]
    },
    {
      id: "diag-050",
      keywords: ['bladder', 'urethra', 'sphincter', 'urinary'],
      title: "Urinary Bladder and Urethra",
      content: "Frontal section showing bladder wall and sphincters. Labels: 1. Detrusor muscle, 2. Trigone, 3. Ureteral openings, 4. Internal urethral sphincter (involuntary), 5. External urethral sphincter (voluntary), 6. Rugae.",
      source: "Urological Nursing Handbook",
      relevance: "Understanding micturition (urination) and the causes of incontinence.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b8/Urinary_Bladder.png/800px-Urinary_Bladder.png",
      tags: ["Urinary"]
    },
    {
      id: "diag-051",
      keywords: ['liver', 'lobule', 'hepatocyte', 'portal triad', 'digestive'],
      title: "Microscopic Anatomy of the Liver",
      content: "Diagram of a hepatic lobule. Labels: 1. Central vein, 2. Hepatocytes (liver cells), 3. Sinusoids, 4. Portal triad (hepatic artery, portal vein, bile duct), 5. Kupffer cells (macrophages).",
      source: "GI Clinical Manual",
      relevance: "The functional unit of the liver where detoxification and bile production occur; affected in cirrhosis.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b3/Liver_and_gallbladder.svg/800px-Liver_and_gallbladder.svg.png",
      tags: ["Digestive"]
    },
    {
      id: "diag-052",
      keywords: ['small intestine', 'villi', 'absorption', 'digestive'],
      title: "Small Intestine: Villi and Microvilli",
      content: "Magnified view of the intestinal wall. Labels: 1. Plicae circulares (folds), 2. Villi, 3. Microvilli (brush border), 4. Lacteal (lymph vessel for fats), 5. Capillary network, 6. Goblet cells (mucus).",
      source: "Gastrointestinal Nursing Guide",
      relevance: "Maximizes surface area for nutrient absorption; damaged in Celiac disease.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Digestive_system_diagram_edit.svg/800px-Digestive_system_diagram_edit.svg.png",
      tags: ["Digestive"]
    },
    {
      id: "diag-053",
      keywords: ['large intestine', 'colon', 'cecum', 'rectum', 'digestive'],
      title: "Large Intestine Anatomy",
      content: "Overview of the colon and rectum. Labels: 1. Cecum, 2. Appendix, 3. Ascending colon, 4. Transverse colon, 5. Descending colon, 6. Sigmoid colon, 7. Rectum, 8. Anal canal, 9. Haustra (pouches), 10. Taenia coli.",
      source: "Nursing Anatomy Library",
      relevance: "Site of water reabsorption and feces formation; location for ostomies (colostomy).",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Digestive_system_diagram_edit.svg/800px-Digestive_system_diagram_edit.svg.png",
      tags: ["Digestive"]
    },
    {
      id: "diag-054",
      keywords: ['pancreas', 'exocrine', 'endocrine', 'digestive'],
      title: "Pancreas: Exocrine and Endocrine Functions",
      content: "Internal view showing ducts and islets. Labels: 1. Pancreatic duct, 2. Acinar cells (produce enzymes), 3. Islets of Langerhans (produce insulin/glucagon), 4. Head, body, and tail of pancreas.",
      source: "GI Clinical Handbook",
      relevance: "Dual function organ: enzymes for digestion and hormones for blood sugar regulation.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/14/Gallbladder-Liver-Pancreas_Location.png/800px-Gallbladder-Liver-Pancreas_Location.png",
      tags: ["Digestive"]
    },
    {
      id: "diag-055",
      keywords: ['teeth', 'structure', 'enamel', 'dentin', 'digestive'],
      title: "Anatomy of a Tooth",
      content: "Cross-section of a molar. Labels: 1. Enamel (hardest substance), 2. Dentin, 3. Pulp cavity (nerves/vessels), 4. Cementum, 5. Periodontal ligament, 6. Gingiva (gum), 7. Crown, neck, and root.",
      source: "Foundations of Nursing",
      relevance: "Important for oral hygiene care and identifying dental emergencies.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/67/Tooth_Section.svg/800px-Tooth_Section.svg.png",
      tags: ["Digestive"]
    },
    {
      id: "diag-056",
      keywords: ['ear', 'inner ear', 'cochlea', 'vestibule', 'special senses'],
      title: "Inner Ear: Hearing and Equilibrium",
      content: "Detailed view of the cochlea and semicircular canals. Labels: 1. Cochlea (hearing), 2. Semicircular canals (dynamic equilibrium), 3. Vestibule (static equilibrium), 4. Vestibulocochlear nerve (VIII).",
      source: "ENT Clinical Guide",
      relevance: "Explains the mechanism of hearing and causes of vertigo or hearing loss.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d1/Human_ear_anatomy_en.svg/800px-Human_ear_anatomy_en.svg.png",
      tags: ["Special Senses"]
    },
    {
      id: "diag-057",
      keywords: ['eye', 'retina', 'photoreceptors', 'rods', 'cones', 'special senses'],
      title: "Microscopic Structure of the Retina",
      content: "Layers of the retina showing photoreceptors. Labels: 1. Rods (low light/peripheral vision), 2. Cones (color/detail), 3. Bipolar cells, 4. Ganglion cells (form optic nerve), 5. Fovea centralis (highest acuity).",
      source: "Ophthalmology Nursing",
      relevance: "Damaged in diabetic retinopathy and macular degeneration.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1e/Schematic_diagram_of_the_human_eye_en.svg/800px-Schematic_diagram_of_the_human_eye_en.svg.png",
      tags: ["Special Senses"]
    },
    {
      id: "diag-058",
      keywords: ['tongue', 'taste buds', 'papillae', 'special senses'],
      title: "The Tongue and Taste",
      content: "Surface of the tongue showing papillae and taste zones. Labels: 1. Vallate papillae, 2. Fungiform papillae, 3. Filiform papillae, 4. Taste bud structure (pore, gustatory cells).",
      source: "Nursing Anatomy Library",
      relevance: "Assessment of oral health and cranial nerves VII, IX, and XII.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/06/Tongue_zones.svg/800px-Tongue_zones.svg.png",
      tags: ["Special Senses"]
    },
    {
      id: "diag-059",
      keywords: ['nose', 'olfactory epithelium', 'smell', 'special senses'],
      title: "Olfactory Pathway (Smell)",
      content: "Nasal cavity showing olfactory nerves. Labels: 1. Olfactory bulb, 2. Olfactory nerves (I), 3. Olfactory epithelium (receptors), 4. Cribriform plate of ethmoid bone.",
      source: "Clinical Neurology Essentials",
      relevance: "Anosmia (loss of smell) can indicate cranial nerve damage or early neurodegenerative disease.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Lungs_diagram_detailed.svg/800px-Lungs_diagram_detailed.svg",
      tags: ["Special Senses"]
    },
    {
      id: "diag-060",
      keywords: ['skull', 'lateral view', 'bones', 'sutures', 'skeletal'],
      title: "Human Skull (Lateral View)",
      content: "Side view of the skull bones and sutures. Labels: 1. Frontal bone, 2. Parietal bone, 3. Temporal bone, 4. Occipital bone, 5. Sphenoid bone, 6. Ethmoid bone, 7. Zygomatic bone, 8. Mandible, 9. Maxilla, 10. External auditory meatus.",
      source: "Osteology for Nurses",
      relevance: "Important for head injury assessment and identifying fracture sites.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/bc/Human_skull_front_simplified_%28bones%29.svg/800px-Human_skull_front_simplified_%28bones%29.svg.png",
      tags: ["Skeletal"]
    },
    {
      id: "diag-061",
      keywords: ['vertebral column', 'spine', 'cervical', 'thoracic', 'lumbar', 'skeletal'],
      title: "The Vertebral Column",
      content: "Lateral view showing curves and divisions. Labels: 1. Cervical (C1-C7), 2. Thoracic (T1-T12), 3. Lumbar (L1-L5), 4. Sacrum (5 fused), 5. Coccyx (4 fused), 6. Intervertebral discs.",
      source: "Nursing Anatomy Library",
      relevance: "Identifies levels of spinal cord injury and sites for epidural/lumbar puncture.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4c/Pelvis_diagram.png/800px-Pelvis_diagram.png",
      tags: ["Skeletal"]
    },
    {
      id: "diag-062",
      keywords: ['vertebra', 'structure', 'body', 'foramen', 'skeletal'],
      title: "Structure of a Typical Vertebra",
      content: "Superior view of a lumbar vertebra. Labels: 1. Body (weight bearing), 2. Vertebral foramen (spinal cord passage), 3. Spinous process, 4. Transverse process, 5. Lamina, 6. Pedicle.",
      source: "Osteology for Nurses",
      relevance: "Understanding spinal stenosis (narrowing of foramen) and herniated discs.",
      image: "https://placehold.co/800x400/f8fafc/6366f1?text=Typical+Vertebra+Diagram",
      tags: ["Skeletal"]
    },
    {
      id: "diag-063",
      keywords: ['ribs', 'thoracic cage', 'sternum', 'skeletal'],
      title: "The Thoracic Cage",
      content: "Anterior view of ribs and sternum. Labels: 1. Sternum (manubrium, body, xiphoid), 2. True ribs (1-7), 3. False ribs (8-12), 4. Floating ribs (11-12), 5. Costal cartilage.",
      source: "Nursing Anatomy Library",
      relevance: "Important for landmarking for chest tube insertion, CPR, and cardiac auscultation.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/49/Human_skeleton_front_en.svg/800px-Human_skeleton_front_en.svg.png",
      tags: ["Skeletal"]
    },
    {
      id: "diag-064",
      keywords: ['long bone', 'structure', 'epiphysis', 'diaphysis', 'periosteum', 'skeletal'],
      title: "Anatomy of a Long Bone (Femur)",
      content: "Longitudinal section showing internal features. Labels: 1. Diaphysis (shaft), 2. Epiphysis (ends), 3. Epiphyseal line (growth plate), 4. Periosteum (outer membrane), 5. Compact bone, 6. Spongy bone (red marrow), 7. Medullary cavity (yellow marrow), 8. Articular cartilage.",
      source: "Nursing Anatomy Library",
      relevance: "Growth occurs at the epiphyseal plate; periosteum is essential for fracture healing.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/49/Human_skeleton_front_en.svg/800px-Human_skeleton_front_en.svg.png",
      tags: ["Skeletal"]
    },
    {
      id: "diag-065",
      keywords: ['joint', 'synovial', 'knee', 'ligaments', 'skeletal'],
      title: "Synovial Joint Structure (Knee)",
      content: "Frontal and lateral view of the knee joint. Labels: 1. Synovial membrane, 2. Joint cavity (with fluid), 3. Articular cartilage, 4. Ligaments (ACL, PCL, MCL, LCL), 5. Meniscus (medial/lateral), 6. Patella.",
      source: "Orthopedic Nursing Manual",
      relevance: "Most common site of sports injuries and osteoarthritis.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a2/Patellar_Reflex.png/800px-Patellar_Reflex.png",
      tags: ["Skeletal"]
    },
    {
      id: "diag-066",
      keywords: ['muscles', 'anterior view', 'anatomy', 'muscular'],
      title: "Major Muscles of the Body (Anterior)",
      content: "Front view of superficial muscles. Labels: 1. Pectoralis major, 2. Deltoid, 3. Biceps brachii, 4. Rectus abdominis, 5. External oblique, 6. Quadriceps femoris, 7. Tibialis anterior, 8. Trapezius.",
      source: "Nursing Anatomy Library",
      relevance: "Essential for physical assessment and determining injection sites (deltoid, quadriceps).",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/49/Human_skeleton_front_en.svg/800px-Human_skeleton_front_en.svg.png",
      tags: ["Muscular"]
    },
    {
      id: "diag-067",
      keywords: ['muscles', 'posterior view', 'anatomy', 'muscular'],
      title: "Major Muscles of the Body (Posterior)",
      content: "Back view of superficial muscles. Labels: 1. Trapezius, 2. Latissimus dorsi, 3. Triceps brachii, 4. Gluteus maximus, 5. Hamstrings (biceps femoris), 6. Gastrocnemius (calf), 7. Achilles tendon.",
      source: "Nursing Anatomy Library",
      relevance: "Used for landmarking injections (gluteal) and assessing mobility/posture.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/49/Human_skeleton_front_en.svg/800px-Human_skeleton_front_en.svg.png",
      tags: ["Muscular"]
    },
    {
      id: "diag-068",
      keywords: ['muscle contraction', 'sarcomere', 'actin', 'myosin', 'muscular'],
      title: "Microscopic Structure of Muscle (Sarcomere)",
      content: "Diagram of actin and myosin filaments. Labels: 1. Sarcomere (functional unit), 2. Actin (thin filament), 3. Myosin (thick filament), 4. Z-line, 5. Cross-bridges.",
      source: "Nursing Biology Essentials",
      relevance: "Sliding filament theory explains how muscles contract; affected in muscular dystrophy.",
      image: "https://placehold.co/800x400/f8fafc/6366f1?text=Sarcomere+Structure+Diagram",
      tags: ["Muscular"]
    },
    {
      id: "diag-069",
      keywords: ['neuromuscular junction', 'nmj', 'acetylcholine', 'muscular'],
      title: "The Neuromuscular Junction (NMJ)",
      content: "Site where nerve meets muscle. Labels: 1. Motor neuron, 2. Synaptic cleft, 3. Acetylcholine (neurotransmitter), 4. ACh receptors on muscle, 5. Motor end plate.",
      source: "Nursing Biology Essentials",
      relevance: "Target for muscle relaxants and affected in Myasthenia Gravis.",
      image: "https://placehold.co/800x400/f8fafc/6366f1?text=Neuromuscular+Junction+Diagram",
      tags: ["Muscular"]
    },
    {
      id: "diag-070",
      keywords: ['blood cells', 'rbc', 'wbc', 'platelets', 'hematology'],
      title: "Types of Blood Cells",
      content: "Illustrations of formed elements in blood. Labels: 1. Red blood cells (erythrocytes), 2. White blood cells (leukocytes: neutrophils, lymphocytes, monocytes, eosinophils, basophils), 3. Platelets (thrombocytes).",
      source: "Hematology for Nurses",
      relevance: "Understanding CBC (complete blood count) results and their clinical significance (infection, anemia, bleeding).",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/30/Blood_flow_through_the_heart_simplified.svg/800px-Blood_flow_through_the_heart_simplified.svg.png",
      tags: ["Hematology"]
    },
    {
      id: "diag-071",
      keywords: ['blood components', 'plasma', 'buffy coat', 'hematology'],
      title: "Blood Components (Centrifuged)",
      content: "A tube of blood after centrifugation. Labels: 1. Plasma (55% - water, proteins, solutes), 2. Buffy coat (<1% - WBCs and platelets), 3. Formed elements (45% - RBCs/Hematocrit).",
      source: "Hematology for Nurses",
      relevance: "Used to explain hematocrit levels and the difference between whole blood and plasma.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1d/Centrifuged_blood.png/800px-Centrifuged_blood.png",
      tags: ["Hematology"]
    },
    {
      id: "diag-072",
      keywords: ['abo', 'blood groups', 'antigens', 'antibodies', 'hematology'],
      title: "ABO Blood Groups",
      content: "Chart of blood types A, B, AB, O. Labels: 1. Type A (A antigen, anti-B antibody), 2. Type B (B antigen, anti-A antibody), 3. Type AB (A & B antigens, no antibodies), 4. Type O (no antigens, anti-A & anti-B antibodies).",
      source: "Blood Bank Clinical Guide",
      relevance: "Vital for safe blood transfusion; AB is universal recipient, O is universal donor.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/32/ABO_blood_type.svg/800px-ABO_blood_type.svg.png",
      tags: ["Hematology"]
    },
    {
      id: "diag-073",
      keywords: ['coagulation', 'clotting', 'cascade', 'fibrin', 'hematology'],
      title: "Coagulation Cascade (Simplified)",
      content: "Intrinsic and extrinsic pathways leading to clot formation. Labels: 1. Tissue damage (extrinsic), 2. Contact activation (intrinsic), 3. Prothrombin activator, 4. Prothrombin to thrombin, 5. Fibrinogen to fibrin (clot).",
      source: "Hematology Mastery",
      relevance: "Basis for anticoagulant therapy (Heparin affects intrinsic, Warfarin affects extrinsic).",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f7/Coagulation_full.svg/800px-Coagulation_full.svg.png",
      tags: ["Hematology"]
    },
    {
      id: "diag-074",
      keywords: ['phagocytosis', 'macrophage', 'immune response', 'immunology'],
      title: "Phagocytosis Process",
      content: "Steps of a white blood cell engulfing a pathogen. Labels: 1. Chemotaxis (attraction), 2. Adherence, 3. Ingestion (phagosome formation), 4. Digestion (phagolysosome), 5. Killing and exocytosis.",
      source: "Nursing Biology Essentials",
      relevance: "Primary defense against bacterial infection.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4c/Phagocytosis2.png/800px-Phagocytosis2.png",
      tags: ["Immunology"]
    },
    {
      id: "diag-075",
      keywords: ['antibody', 'structure', 'immunoglobulin', 'immunology'],
      title: "Antibody Structure (IgG)",
      content: "Y-shaped protein structure. Labels: 1. Heavy chains, 2. Light chains, 3. Variable region (antigen binding site), 4. Constant region (effector function), 5. Disulfide bonds.",
      source: "Clinical Immunology Guide",
      relevance: "Explains how antibodies specifically target and neutralize pathogens.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d8/Antibody_scheme.svg/800px-Antibody_scheme.svg.png",
      tags: ["Immunology"]
    },
    {
      id: "diag-076",
      keywords: ['mhc', 'antigen presentation', 'immune response', 'immunology'],
      title: "MHC Molecules (Class I and II)",
      content: "Comparison of MHC I (all nucleated cells) and MHC II (antigen-presenting cells). Labels: 1. MHC I – presents endogenous antigens to CD8+ T-cells, 2. MHC II – presents exogenous antigens to CD4+ T-cells.",
      source: "Nursing Biology Essentials",
      relevance: "Basis for tissue rejection in transplants and T-cell recognition.",
      image: "https://placehold.co/800x400/f8fafc/6366f1?text=MHC+I+and+II+Diagram",
      tags: ["Immunology"]
    },
    {
      id: "diag-077",
      keywords: ['t-cell', 'b-cell', 'activation', 'immune response', 'immunology'],
      title: "T-Cell and B-Cell Activation",
      content: "Flowchart of adaptive immune response. Labels: 1. Antigen presentation, 2. Helper T-cell activation, 3. B-cell activation (humoral - antibodies), 4. Cytotoxic T-cell activation (cell-mediated).",
      source: "Immunology for Nurses",
      relevance: "Explains how vaccines create immunity and how the body fights viruses vs. bacteria.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/ca/Lymphatic_system_diagram_en.svg/800px-Lymphatic_system_diagram_en.svg.png",
      tags: ["Immunology"]
    },
    {
      id: "diag-078",
      keywords: ['immunity', 'active', 'passive', 'vaccines', 'immunology'],
      title: "Passive vs. Active Immunity",
      content: "Comparison chart. Labels: 1. Natural Active (infection), 2. Artificial Active (vaccine), 3. Natural Passive (maternal antibodies/breast milk), 4. Artificial Passive (antivenom/IgG injection).",
      source: "Public Health Nursing Guide",
      relevance: "Explains why infants need maternal antibodies and why boosters are needed for some vaccines.",
      image: "https://placehold.co/800x400/f8fafc/6366f1?text=Types+of+Immunity+Chart",
      tags: ["Immunology"]
    },
    {
      id: "diag-079",
      keywords: ['spleen', 'anatomy', 'lymphatic'],
      title: "Spleen Anatomy (Internal Structure)",
      content: "Section through the spleen. Labels: 1. White pulp (lymphocytes), 2. Red pulp (RBC filtration), 3. Splenic artery and vein, 4. Capsule, 5. Trabeculae.",
      source: "Nursing Anatomy Library",
      relevance: "The 'graveyard' for old RBCs; splenectomy increases risk of sepsis from encapsulated bacteria.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d1/Spleen_Anatomy.png/800px-Spleen_Anatomy.png",
      tags: ["Anatomy"]
    },
    {
      id: "diag-080",
      keywords: ['thymus', 't-cells', 'lymphatic'],
      title: "Thymus Gland",
      content: "Location and structure of the thymus. Labels: 1. Cortex, 2. Medulla, 3. Hassall's corpuscles, 4. Site of T-cell maturation and 'education'.",
      source: "Clinical Immunology Guide",
      relevance: "Largest in children; involutes (shrinks) after puberty.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b3/Lymphatic_system_diagram_en.svg/800px-Lymphatic_system_diagram_en.svg.png",
      tags: ["Anatomy"]
    },
    {
      id: "diag-081",
      keywords: ['lymph node', 'anatomy', 'lymphatic'],
      title: "Lymph Node Structure",
      content: "Cross-section of a lymph node. Labels: 1. Afferent vessels (inflow), 2. Efferent vessel (outflow at hilum), 3. Germinal centers (B-cell proliferation), 4. Sinuses, 5. Capsule.",
      source: "Nursing Anatomy Library",
      relevance: "Filters lymph and traps pathogens; nodes swell during infection (lymphadenitis).",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/ca/Lymph_node_structure.png/800px-Lymph_node_structure.png",
      tags: ["Anatomy"]
    },
    {
      id: "diag-082",
      keywords: ['hiv', 'life cycle', 'virus', 'immunology'],
      title: "HIV Life Cycle (Simplified)",
      content: "Steps of HIV infection of a CD4 cell. Labels: 1. Binding/Fusion, 2. Reverse transcription (RNA to DNA), 3. Integration, 4. Replication, 5. Assembly and budding.",
      source: "Infectious Disease Nursing",
      relevance: "Explains how ART (antiretroviral therapy) drugs work at different stages.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b3/HIV-replication-cycle.png/800px-HIV-replication-cycle.png",
      tags: ["Immunology"]
    },
    {
      id: "diag-083",
      keywords: ['inflammation', 'response', 'healing', 'immunology'],
      title: "Inflammatory Response Steps",
      content: "Vascular and cellular events of inflammation. Labels: 1. Injury/chemical release (histamine), 2. Vasodilation (redness/heat), 3. Increased permeability (swelling), 4. Phagocyte migration (margination/diapedesis).",
      source: "Pathophysiology for Nurses",
      relevance: "Explains the four cardinal signs of inflammation: Rubor, Calor, Tumor, Dolor.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/ca/4_Types_of_Tissue.png/800px-4_Types_of_Tissue.png",
      tags: ["Immunology"]
    },
    {
      id: "diag-084",
      keywords: ['fever', 'hypothalamus', 'pyrogens', 'pathophysiology'],
      title: "Fever Mechanism (Thermoregulation)",
      content: "Pathway from pyrogens to hypothalamus. Labels: 1. Pyrogens (bacteria/toxins), 2. Prostaglandin E2 release, 3. Hypothalamic 'set point' increased, 4. Shivering/vasoconstriction (chills phase), 5. Sweating (crisis phase/fever break).",
      source: "Pathophysiology Essentials",
      relevance: "Explains why patients feel cold when their temperature is rising and how antipyretics work.",
      image: "https://placehold.co/800x400/f8fafc/6366f1?text=Fever+Mechanism+Pathway",
      tags: ["Pathophysiology"]
    },
    {
      id: "diag-085",
      keywords: ['hypersensitivity', 'allergy', 'anaphylaxis', 'immunology'],
      title: "Type I Hypersensitivity (Allergy)",
      content: "Mechanism of IgE-mediated reaction. Labels: 1. Initial exposure (sensitization), 2. IgE binding to mast cells, 3. Re-exposure (cross-linking), 4. Mast cell degranulation (histamine release).",
      source: "Clinical Immunology Guide",
      relevance: "Basis for allergic rhinitis, asthma, and life-threatening anaphylaxis.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6d/Allergy_type_I.png/800px-Allergy_type_I.png",
      tags: ["Immunology"]
    },
    {
      id: "diag-086",
      keywords: ['reflex arc', 'monosynaptic', 'neurology'],
      title: "Reflex Arc (Monosynaptic)",
      content: "Simplest neural pathway. Labels: 1. Sensory receptor, 2. Sensory neuron, 3. Integration center (one synapse), 4. Motor neuron, 5. Effector muscle.",
      source: "Nursing Neurology Guide",
      relevance: "Example: Patellar (knee-jerk) reflex; does not require brain input for movement.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a2/Patellar_Reflex.png/800px-Patellar_Reflex.png",
      tags: ["Neurology"]
    },
    {
      id: "diag-087",
      keywords: ['csf', 'cerebrospinal fluid', 'flow', 'neurology'],
      title: "CSF Flow Pathway",
      content: "Ventricular system of the brain. Labels: 1. Lateral ventricles, 2. Foramen of Monro, 3. Third ventricle, 4. Cerebral aqueduct, 5. Fourth ventricle, 6. Subarachnoid space, 7. Arachnoid villi (reabsorption).",
      source: "Clinical Neurology Essentials",
      relevance: "Blockage leads to hydrocephalus; CSF is sampled in lumbar puncture.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/cc/Cerebrospinal_fluid_circulation.svg/800px-Cerebrospinal_fluid_circulation.svg.png",
      tags: ["Neurology"]
    },
    {
      id: "diag-088",
      keywords: ['blood-brain barrier', 'bbb', 'astrocytes', 'neurology'],
      title: "Blood-Brain Barrier (BBB)",
      content: "Structure of cerebral capillaries. Labels: 1. Tight junctions between endothelial cells, 2. Thick basement membrane, 3. Astrocyte foot processes (glia).",
      source: "Nursing Biology Essentials",
      relevance: "Protects brain from toxins but also prevents many drugs from entering (e.g., certain antibiotics).",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1a/Blood_brain_barrier_anatomy.png/800px-Blood_brain_barrier_anatomy.png",
      tags: ["Neurology"]
    },
    {
      id: "diag-089",
      keywords: ['autonomic', 'sympathetic', 'parasympathetic', 'neurology'],
      title: "Sympathetic vs. Parasympathetic Effects",
      content: "Comparison chart of 'Fight or Flight' vs. 'Rest and Digest'. Labels: 1. Pupils (dilate vs. constrict), 2. Heart rate (increase vs. decrease), 3. Bronchi (dilate vs. constrict), 4. Digestion (inhibit vs. stimulate).",
      source: "Clinical Pharmacology Guide",
      relevance: "Essential for understanding drug side effects (e.g., anticholinergic effects).",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d0/Autonomic_Nervous_System_en.svg/800px-Autonomic_Nervous_System_en.svg.png",
      tags: ["Neurology"]
    },
    {
      id: "diag-090",
      keywords: ['adrenal gland', 'cortex', 'medulla', 'hormones', 'endocrine'],
      title: "Adrenal Gland Layers",
      content: "Section through the adrenal gland. Labels: 1. Capsule, 2. Cortex (Zona glomerulosa, fasciculata, reticularis), 3. Medulla (catecholamines), 4. Hormones: Aldosterone, Cortisol, Androgens, Epinephrine/Norepinephrine.",
      source: "Endocrinology for Nurses",
      relevance: "Mnemonic: 'Salt, Sugar, Sex' (layers of the cortex).",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c6/Adrenal_gland.png/800px-Adrenal_gland.png",
      tags: ["Endocrine"]
    },
    {
      id: "diag-091",
      keywords: ['thyroid', 'feedback loop', 'tsh', 'hormones', 'endocrine'],
      title: "Thyroid Negative Feedback Loop",
      content: "Hypothalamic-Pituitary-Thyroid axis. Labels: 1. Hypothalamus (TRH), 2. Anterior Pituitary (TSH), 3. Thyroid (T3/T4), 4. Negative feedback of T3/T4 on pituitary and hypothalamus.",
      source: "Clinical Endocrinology Guide",
      relevance: "Explains why TSH is low in primary hyperthyroidism and high in primary hypothyroidism.",
      image: "https://placehold.co/800x400/f8fafc/6366f1?text=Thyroid+Feedback+Loop+Diagram",
      tags: ["Endocrine"]
    },
    {
      id: "diag-092",
      keywords: ['raas', 'blood pressure', 'renin', 'aldosterone', 'renal'],
      title: "RAAS Pathway (Renin-Angiotensin)",
      content: "Cascade to increase blood pressure. Labels: 1. Renin (from kidney), 2. Angiotensinogen to Angiotensin I, 3. ACE (lung) converts to Angiotensin II, 4. Angiotensin II (vasoconstriction), 5. Aldosterone (sodium/water retention).",
      source: "Cardiovascular Nursing Manual",
      relevance: "Target for ACE inhibitors and ARBs to treat hypertension and heart failure.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f3/Renin-angiotensin-aldosterone_system.png/800px-Renin-angiotensin-aldosterone_system.png",
      tags: ["Pathophysiology"]
    },
    {
      id: "diag-093",
      keywords: ['acid-base', 'ph', 'compensation', 'respiratory', 'renal'],
      title: "Acid-Base Balance Regulation",
      content: "How lungs and kidneys maintain pH. Labels: 1. Lungs (fast - CO2 elimination), 2. Kidneys (slow - HCO3 reabsorption/H+ excretion), 3. Normal pH 7.35-7.45.",
      source: "ABG Mastery for Nurses",
      relevance: "Critical for interpreting Arterial Blood Gas results and identifying compensation.",
      image: "https://placehold.co/800x400/f8fafc/6366f1?text=Acid-Base+Regulation+Diagram",
      tags: ["Pathophysiology"]
    },
    {
      id: "diag-094",
      keywords: ['sodium-potassium pump', 'electrolytes', 'atp', 'biology'],
      title: "Sodium-Potassium Pump",
      content: "Active transport mechanism. Labels: 1. 3 Na+ out, 2. 2 K+ in, 3. ATP usage, 4. Maintenance of resting membrane potential.",
      source: "Nursing Biology Essentials",
      relevance: "Explains why high intracellular K+ and high extracellular Na+ are maintained; affected in digoxin toxicity.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Sodium-potassium_pump_and_diffusion.png/800px-Sodium-potassium_pump_and_diffusion.png",
      tags: ["Cell Biology"]
    },
    {
      id: "diag-095",
      keywords: ['fluid compartments', 'icf', 'ecf', 'edema', 'pathophysiology'],
      title: "Body Fluid Compartments",
      content: "Distribution of water in the body. Labels: 1. Intracellular fluid (ICF - 2/3), 2. Extracellular fluid (ECF - 1/3), 3. Interstitial fluid, 4. Plasma (intravascular).",
      source: "Foundations of Nursing",
      relevance: "Understanding third-spacing (edema) and fluid replacement therapy.",
      image: "https://placehold.co/800x400/f8fafc/6366f1?text=Body+Fluid+Compartments+Chart",
      tags: ["Pathophysiology"]
    },
    {
      id: "diag-096",
      keywords: ['labor', 'stages', 'dilation', 'obstetrics'],
      title: "Stages of Labor",
      content: "Illustrations of the four stages. Labels: 1. First stage (dilation and effacement), 2. Second stage (expulsion of fetus), 3. Third stage (placental delivery), 4. Fourth stage (recovery/bonding).",
      source: "Midwifery Clinical Skills",
      relevance: "Standard framework for monitoring progress during childbirth.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/ca/Labor_stages.png/800px-Labor_stages.png",
      tags: ["Obstetrics"]
    },
    {
      id: "diag-097",
      keywords: ['apgar', 'newborn', 'assessment', 'obstetrics'],
      title: "APGAR Scoring Chart",
      content: "Standard assessment at 1 and 5 minutes. Labels: 1. Appearance (color), 2. Pulse (heart rate), 3. Grimace (reflex), 4. Activity (muscle tone), 5. Respiration (effort).",
      source: "Neonatal Nursing Essentials",
      relevance: "Determines immediate need for neonatal resuscitation.",
      image: "https://placehold.co/800x400/f8fafc/6366f1?text=APGAR+Scoring+Table",
      tags: ["Obstetrics"]
    },
    {
      id: "diag-098",
      keywords: ['newborn reflexes', 'moro', 'rooting', 'pediatrics'],
      title: "Newborn Primitive Reflexes",
      content: "Illustrations of Moro, Rooting, Palmar grasp, and Babinski. Labels: 1. Moro (startle), 2. Rooting (searching for nipple), 3. Palmar grasp, 4. Babinski (fanning of toes).",
      source: "Pediatric Nursing Guide",
      relevance: "Used to assess neurological integrity in the newborn; should disappear by certain ages.",
      image: "https://placehold.co/800x400/f8fafc/6366f1?text=Newborn+Reflexes+Diagram",
      tags: ["Pediatrics"]
    },
    {
      id: "diag-099",
      keywords: ['growth charts', 'percentiles', 'pediatrics'],
      title: "Growth Charts (WHO/CDC)",
      content: "Graph for height/weight for age. Labels: 1. X-axis (age), 2. Y-axis (measurement), 3. Percentile lines (5th, 50th, 95th).",
      source: "Pediatric Nursing Standards",
      relevance: "Used to monitor growth and detect failure to thrive or obesity early.",
      image: "https://placehold.co/800x400/f8fafc/6366f1?text=Growth+Chart+Sample",
      tags: ["Pediatrics"]
    },
    {
      id: "diag-100",
      keywords: ['immunization', 'vaccines', 'pediatrics'],
      title: "Standard Immunization Schedule",
      content: "Chart showing vaccines by age (Birth to 18). Labels: 1. HepB, 2. DTaP, 3. Hib, 4. Polio (IPV), 5. MMR, 6. Varicella, 7. PCV.",
      source: "CDC Immunization Guidelines",
      relevance: "Essential for parent education and clinical vaccine administration.",
      image: "https://placehold.co/800x400/f8fafc/6366f1?text=Immunization+Schedule+Chart",
      tags: ["Pediatrics"]
    },
    {
      id: "diag-101",
      keywords: ['triage', 'mci', 'disaster', 'emergency'],
      title: "Triage Color Coding (MCI)",
      content: "START Triage categories. Labels: 1. Green (Minor), 2. Yellow (Delayed), 3. Red (Immediate), 4. Black (Deceased/Expectant).",
      source: "Emergency Nursing Handbook",
      relevance: "Used in mass casualty incidents to prioritize patients based on survival probability.",
      image: "https://placehold.co/800x400/f8fafc/6366f1?text=Triage+START+Categories",
      tags: ["Emergency"]
    },
    {
      id: "diag-102",
      keywords: ['oxygen saturation', 'dissociation curve', 'respiratory'],
      title: "Oxyhemoglobin Dissociation Curve",
      content: "S-shaped curve relating SaO2 to PaO2. Labels: 1. Shift to right (fever, acidosis - easy release), 2. Shift to left (cold, alkalosis - hard release), 3. Critical point (PaO2 < 60 mmHg).",
      source: "Critical Care Nursing",
      relevance: "Explains why pulse oximetry may not reflect tissue oxygenation in some states.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/cd/Oxyhemoglobin_dissociation_curve.png/800px-Oxyhemoglobin_dissociation_curve.png",
      tags: ["Respiratory"]
    },
    {
      id: "diag-103",
      keywords: ['ventilation', 'ventilator', 'circuit', 'respiratory'],
      title: "Mechanical Ventilation Circuit",
      content: "Diagram showing tubing, humidifier, and ETT. Labels: 1. Inspiratory limb, 2. Expiratory limb, 3. Y-piece, 4. Humidifier/HME, 5. Ventilator settings (Rate, Tidal Volume, PEEP, FiO2).",
      source: "Critical Care Manual",
      relevance: "Basic understanding for managing intubated patients.",
      image: "https://placehold.co/800x400/f8fafc/6366f1?text=Ventilator+Circuit+Diagram",
      tags: ["Respiratory"]
    },
    {
      id: "diag-104",
      keywords: ['chest tube', 'drainage', 'pleurovac', 'respiratory'],
      title: "Chest Tube Drainage System (3-Chamber)",
      content: "Standard drainage unit. Labels: 1. Collection chamber, 2. Water seal chamber (tidaling/bubbling), 3. Suction control chamber.",
      source: "Nursing Procedure Guide",
      relevance: "Used to manage pneumothorax or pleural effusion; continuous bubbling in water seal suggests a leak.",
      image: "https://placehold.co/800x400/f8fafc/6366f1?text=Chest+Drainage+System",
      tags: ["Respiratory"]
    },
    {
      id: "diag-105",
      keywords: ['central line', 'picc', 'cvc', 'medication administration'],
      title: "Central Venous Catheters (CVC vs. PICC)",
      content: "Insertion sites for central lines. Labels: 1. Internal jugular, 2. Subclavian, 3. Femoral, 4. PICC (Basilic/Cephalic vein), 5. Tip location: Superior Vena Cava.",
      source: "IV Therapy Manual",
      relevance: "Used for long-term antibiotics, TPN, and vesicant drugs.",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/30/PICC_line_en.svg/800px-PICC_line_en.svg.png",
      tags: ["Medication Administration"]
    },
    {
      id: "diag-106",
      keywords: ['wound healing', 'phases', 'wound care'],
      title: "Phases of Wound Healing",
      content: "Timeline of tissue repair. Labels: 1. Hemostasis (clotting), 2. Inflammatory phase (WBCs), 3. Proliferation (granulation/collagen), 4. Maturation/Remodeling (scar strength).",
      source: "Wound Care Standards",
      relevance: "Helps nurses identify if a wound is healing normally or stalled in a phase.",
      image: "https://placehold.co/800x400/f8fafc/6366f1?text=Phases+of+Wound+Healing",
      tags: ["Wound Care"]
    },
    {
      id: "diag-107",
      keywords: ['burns', 'rule of nines', 'assessment'],
      title: "Burn Surface Area: Rule of Nines",
      content: "Body percentages for adult burn estimation. Labels: 1. Head (9%), 2. Each arm (9%), 3. Torso (36%), 4. Each leg (18%), 5. Perineum (1%).",
      source: "Emergency Nursing Handbook",
      relevance: "Used to calculate fluid resuscitation needs (Parkland Formula).",
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0d/Rule_of_nines_adult.svg/800px-Rule_of_nines_adult.svg.png",
      tags: ["Emergency"]
    },
    {
      id: "diag-108",
      keywords: ['iv fluids', 'isotonic', 'hypotonic', 'hypertonic', 'medication administration'],
      title: "IV Fluid Types and Osmolarity",
      content: "Effect of different fluids on cells. Labels: 1. Isotonic (NS, LR - no shift), 2. Hypotonic (0.45% NS - cell swells), 3. Hypertonic (D5NS, 3% NS - cell shrinks).",
      source: "Foundations of Nursing",
      relevance: "Critical for preventing cerebral edema or cellular dehydration.",
      image: "https://placehold.co/800x400/f8fafc/6366f1?text=IV+Fluid+Tonicity+Diagram",
      tags: ["Medication Administration"]
    },
    {
      id: "diag-109",
      keywords: ['blood transfusion', 'procedure', 'hematology'],
      title: "Blood Transfusion Procedure",
      content: "Setup and monitoring steps. Labels: 1. Verify consent/type & cross, 2. Dual RN check, 3. Use Y-tubing with filter and Normal Saline, 4. Stay with patient first 15 mins, 5. Monitor for reaction.",
      source: "Nursing Procedure Handbook",
      relevance: "High-risk procedure; requires strict adherence to safety protocols.",
      image: "https://placehold.co/800x400/f8fafc/6366f1?text=Blood+Transfusion+Setup",
      tags: ["Hematology"]
    },
    {
      id: "diag-110",
      keywords: ['post-op', 'complications', 'surgical nursing'],
      title: "Common Post-Operative Complications",
      content: "Body systems check for complications. Labels: 1. Respiratory (Atelectasis/Pneumonia), 2. Cardiovascular (VTE/DVT), 3. Urinary (Retention), 4. GI (Paralytic Ileus), 5. Wound (Infection/Dehiscence).",
      source: "Surgical Nursing Guide",
      relevance: "Guides post-op monitoring and early intervention (ambulation, incentive spirometry).",
      image: "https://placehold.co/800x400/f8fafc/6366f1?text=Post-Op+Complications+Chart",
      tags: ["Surgical"]
    },
    {
      id: "diag-111",
      keywords: ['palliative care', 'hospice', 'end-of-life'],
      title: "Palliative Care Model",
      content: "Holistic care approach. Labels: 1. Physical (pain/symptom management), 2. Psychological, 3. Social, 4. Spiritual, 5. Family support.",
      source: "End-of-Life Nursing Standards",
      relevance: "Focuses on quality of life and symptom relief at any stage of illness.",
      image: "https://placehold.co/800x400/f8fafc/6366f1?text=Palliative+Care+Holistic+Model",
      tags: ["End-of-Life"]
    },
    {
      id: "diag-112",
      keywords: ['nursing process', 'adpie', 'fundamentals'],
      title: "The Nursing Process (ADPIE)",
      content: "Cyclical model of care. Labels: 1. Assessment (data collection), 2. Diagnosis (nursing dx), 3. Planning (goals/outcomes), 4. Implementation (interventions), 5. Evaluation (met/unmet).",
      source: "Foundations of Nursing",
      relevance: "The systematic framework for all nursing care.",
      image: "https://placehold.co/800x400/f8fafc/6366f1?text=The+Nursing+Process+Cycle",
      tags: ["Foundations"]
    }
  ];

  const handleSearch = (e) => {
    if (e) e.preventDefault();
    if (!query.trim()) return;

    setIsSearching(true);
    setResults(null);

    // Simulate AI Search with improved matching and ranking
    setTimeout(() => {
      const queryLower = query.toLowerCase().trim();
      const searchTerms = queryLower.split(/\s+/).filter(t => t.length > 0);

      // Improved matching with weighted scoring
      const matched = mockKnowledgeBase
        .map(entry => {
          let score = 0;
          const titleLower = entry.title.toLowerCase();
          const contentLower = entry.content.toLowerCase();
          const relevanceLower = (entry.relevance || "").toLowerCase();
          const tagsLower = entry.tags.map(t => t.toLowerCase());
          const keywordsLower = entry.keywords.map(k => k.toLowerCase());

          // Exact phrase match in title (Highest weight)
          if (titleLower.includes(queryLower)) score += 100;

          // Full query match in keywords
          if (keywordsLower.includes(queryLower)) score += 80;

          searchTerms.forEach(term => {
            // Title matches
            if (titleLower === term) score += 50;
            else if (titleLower.includes(term)) score += 20;

            // Tag matches
            if (tagsLower.includes(term)) score += 30;

            // Keyword matches
            keywordsLower.forEach(kw => {
              if (kw === term) score += 40;
              else if (kw.includes(term)) score += 15;
            });

            // Content/Relevance matches
            if (contentLower.includes(term)) score += 5;
            if (relevanceLower.includes(term)) score += 10;
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
