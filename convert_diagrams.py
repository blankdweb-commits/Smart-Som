import json
import re

# Mocking the library since I have it in context
DIAGRAM_LIBRARY = [
  {
    "id": "diag-001",
    "title": "Anatomical Position and Planes",
    "system": "Anatomy",
    "description": "A human figure standing erect, facing forward, arms at sides with palms forward, feet parallel. Three planes are shown cutting through the body.",
    "labels": [
      { "name": "Sagittal plane", "info": "divides into left and right" },
      { "name": "Coronal (frontal) plane", "info": "divides into front and back" },
      { "name": "Transverse (horizontal) plane", "info": "divides into top and bottom" },
      { "name": "Anterior (ventral) surface", "info": "front of the body" },
      { "name": "Posterior (dorsal) surface", "info": "back of the body" },
      { "name": "Medial", "info": "toward midline" },
      { "name": "Lateral", "info": "away from midline" },
      { "name": "Proximal", "info": "closer to trunk" },
      { "name": "Distal", "info": "farther from trunk" }
    ],
    "clinical_relevance": "Used to describe locations of organs, surgical incisions, and radiologic findings. Essential for clear communication among healthcare providers.",
    "image": "https://images.unsplash.com/photo-1530026405186-ed1f139313f8?auto=format&fit=crop&q=80&w=1000"
  },
  {
    "id": "diag-002",
    "title": "Body Cavities",
    "system": "Anatomy",
    "description": "Cross-sectional view of the torso showing dorsal and ventral cavities and their subdivisions.",
    "labels": [
      { "name": "Dorsal cavity", "info": "includes cranial (brain) and vertebral (spinal cord)" },
      { "name": "Ventral cavity", "info": "includes thoracic, abdominal, and pelvic cavities" },
      { "name": "Diaphragm", "info": "separates thoracic and abdominal cavities" }
    ],
    "clinical_relevance": "Helps in assessing pain location (e.g., RLQ pain suggests appendix), planning surgeries, and interpreting physical exam findings.",
    "image": "https://images.unsplash.com/photo-1559757175-5700dde675bc?auto=format&fit=crop&q=80&w=1000"
  },
  {
    "id": "diag-003",
    "title": "The Cell (Generalized Animal Cell)",
    "system": "Cell Biology",
    "description": "Typical eukaryotic cell showing organelles.",
    "labels": [
      { "name": "Cell membrane", "info": "selectively permeable barrier" },
      { "name": "Nucleus", "info": "contains DNA" },
      { "name": "Mitochondria", "info": "power plant (ATP production)" },
      { "name": "Ribosomes", "info": "protein synthesis" },
      { "name": "Endoplasmic reticulum", "info": "transport system" },
      { "name": "Golgi apparatus", "info": "packaging and secretion" }
    ],
    "clinical_relevance": "Understanding cell structure is key to pharmacology (drug targets), pathophysiology (organelle dysfunction), and genetics.",
    "image": "https://images.unsplash.com/photo-1576086213369-97a306dca664?auto=format&fit=crop&q=80&w=1000"
  },
  {
    "id": "diag-004",
    "title": "Four Basic Tissues",
    "system": "Histology",
    "description": "Microscopic views of epithelial, connective, muscle, and nervous tissues with labeled features.",
    "labels": [
      { "name": "Epithelial", "info": "tightly packed cells, basement membrane" },
      { "name": "Connective", "info": "scattered cells in matrix" },
      { "name": "Muscle", "info": "elongated cells with contractile proteins" },
      { "name": "Nervous", "info": "neurons with dendrites, axon, and glial cells" }
    ],
    "clinical_relevance": "Identifies origin of tumors (carcinomas from epithelium, sarcomas from connective tissue) and guides wound healing expectations.",
    "image": "https://images.unsplash.com/photo-1559757148-5c350d0d3c56?auto=format&fit=crop&q=80&w=1000"
  },
  {
    "id": "diag-005",
    "title": "Heart: External and Internal Anatomy",
    "system": "Cardiovascular",
    "description": "Anterior view of heart showing chambers, valves, and major vessels.",
    "labels": [
      { "name": "Right atrium", "info": "Receives deoxygenated blood" },
      { "name": "Right ventricle", "info": "Pumps blood to lungs" },
      { "name": "Left atrium", "info": "Receives oxygenated blood" },
      { "name": "Left ventricle", "info": "Pumps blood to body" },
      { "name": "Coronary arteries", "info": "Supply blood to heart muscle" }
    ],
    "clinical_relevance": "Essential for understanding heart murmurs (valve problems), myocardial infarction (coronary blockage), and ECG interpretation.",
    "image": "https://images.unsplash.com/photo-1530026405186-ed1f139313f8?auto=format&fit=crop&q=80&w=1000"
  },
  {
    "id": "diag-006",
    "title": "Blood Flow Through the Heart",
    "system": "Cardiovascular",
    "description": "Diagram showing the path of oxygenated and deoxygenated blood using red and blue arrows.",
    "labels": [
      { "name": "Deoxygenated path", "info": "SVC/IVC -> RA -> RV -> pulmonary artery -> lungs" },
      { "name": "Oxygenated path", "info": "pulmonary veins -> LA -> LV -> aorta -> body" }
    ],
    "clinical_relevance": "Key for understanding congenital heart defects, shunts, and hemodynamics in heart failure.",
    "image": "https://images.unsplash.com/photo-1530026405186-ed1f139313f8?auto=format&fit=crop&q=80&w=1000"
  },
  {
    "id": "diag-007",
    "title": "Conducting System of the Heart and ECG",
    "system": "Cardiovascular",
    "description": "Illustration of SA node, AV node, Bundle of His, Purkinje fibers, and corresponding ECG waves.",
    "labels": [
      { "name": "SA node", "info": "pacemaker" },
      { "name": "AV node", "info": "delay" },
      { "name": "P wave", "info": "atrial depolarization" },
      { "name": "QRS complex", "info": "ventricular depolarization" },
      { "name": "T wave", "info": "ventricular repolarization" }
    ],
    "clinical_relevance": "Used to diagnose arrhythmias, heart blocks, and electrolyte imbalances.",
    "image": "https://images.unsplash.com/photo-1559757175-5700dde675bc?auto=format&fit=crop&q=80&w=1000"
  },
  {
    "id": "diag-008",
    "title": "Blood Vessel Layers (Artery and Vein)",
    "system": "Cardiovascular",
    "description": "Cross-section of an artery and a vein showing tunica intima, media, and adventitia.",
    "labels": [
      { "name": "Tunica intima", "info": "endothelium, smooth lining" },
      { "name": "Tunica media", "info": "smooth muscle, thicker in arteries" },
      { "name": "Tunica adventitia", "info": "connective tissue" }
    ],
    "clinical_relevance": "Atherosclerosis affects intima; hypertension causes media hypertrophy; varicose veins result from valve failure.",
    "image": "https://images.unsplash.com/photo-1559757175-5700dde675bc?auto=format&fit=crop&q=80&w=1000"
  },
  {
    "id": "diag-009",
    "title": "Lymphatic System",
    "system": "Immunology",
    "description": "Diagram showing lymph nodes, vessels, and organs.",
    "labels": [
      { "name": "Spleen", "info": "Filters blood and stores RBCs" },
      { "name": "Thymus", "info": "Site of T-cell maturation" },
      { "name": "Tonsils", "info": "First line of defense in throat" }
    ],
    "clinical_relevance": "Lymphadenopathy indicates infection or malignancy; lymph node biopsy is done for cancer staging.",
    "image": "https://images.unsplash.com/photo-1576086213369-97a306dca664?auto=format&fit=crop&q=80&w=1000"
  },
  {
    "id": "diag-010",
    "title": "Respiratory Tract",
    "system": "Respiratory",
    "description": "Anatomical diagram from nose to alveoli.",
    "labels": [
      { "name": "Trachea", "info": "cartilage rings" },
      { "name": "Bronchi", "info": "primary, secondary, and tertiary branches" },
      { "name": "Alveoli", "info": "site of gas exchange" }
    ],
    "clinical_relevance": "Used to explain airway management, endotracheal intubation, and sites of infection (bronchitis vs. pneumonia).",
    "image": "https://images.unsplash.com/photo-1559757175-5700dde675bc?auto=format&fit=crop&q=80&w=1000"
  },
  {
    "id": "diag-011",
    "title": "Alveolus and Gas Exchange",
    "system": "Respiratory",
    "description": "Detailed view of alveoli surrounded by capillaries showing O2 and CO2 exchange.",
    "labels": [
      { "name": "Type II pneumocyte", "info": "produces surfactant" },
      { "name": "O2 diffusion", "info": "moves into blood" },
      { "name": "CO2 diffusion", "info": "moves into alveolus" }
    ],
    "clinical_relevance": "Key to understanding ARDS, pneumonia, COPD, and the effect of surfactant deficiency in premature infants.",
    "image": "https://images.unsplash.com/photo-1559757175-5700dde675bc?auto=format&fit=crop&q=80&w=1000"
  },
  {
    "id": "diag-012",
    "title": "Nephron (Kidney Functional Unit)",
    "system": "Renal",
    "description": "Detailed diagram of a nephron including glomerulus, tubules, and collecting duct.",
    "labels": [
      { "name": "Glomerulus", "info": "filtration" },
      { "name": "Proximal convoluted tubule", "info": "reabsorption" },
      { "name": "Loop of Henle", "info": "concentration of urine" }
    ],
    "clinical_relevance": "Understanding diuretics (site of action), kidney stones (tubule blockage), and acute kidney injury.",
    "image": "https://images.unsplash.com/photo-1576086213369-97a306dca664?auto=format&fit=crop&q=80&w=1000"
  },
  {
    "id": "diag-013",
    "title": "Brain \u2013 Lateral View with Lobes",
    "system": "Neurology",
    "description": "Side view of cerebrum showing frontal, parietal, temporal, occipital lobes, and cerebellum.",
    "labels": [
      { "name": "Frontal lobe", "info": "executive function, motor" },
      { "name": "Occipital lobe", "info": "vision" },
      { "name": "Cerebellum", "info": "coordination" }
    ],
    "clinical_relevance": "Stroke localization: left frontal weakness = right-sided paralysis; temporal lesion = aphasia.",
    "image": "https://images.unsplash.com/photo-1559757148-5c350d0d3c56?auto=format&fit=crop&q=80&w=1000"
  },
  {
    "id": "diag-014",
    "title": "Cranial Nerves (Ventral View of Brain)",
    "system": "Neurology",
    "description": "Base of brain showing all 12 cranial nerves emerging.",
    "labels": [
      { "name": "I Olfactory", "info": "smell" },
      { "name": "II Optic", "info": "vision" },
      { "name": "X Vagus", "info": "autonomic, cough, gag" }
    ],
    "clinical_relevance": "Cranial nerve assessment is part of neurological exam (e.g., pupil light reflex = II & III; gag reflex = IX & X).",
    "image": "https://images.unsplash.com/photo-1559757148-5c350d0d3c56?auto=format&fit=crop&q=80&w=1000"
  },
  {
    "id": "diag-015",
    "title": "Spinal Cord and Reflex Arc",
    "system": "Neurology",
    "description": "Cross-section of spinal cord showing gray matter, white matter, and pathway of a reflex.",
    "labels": [
      { "name": "Sensory neuron", "info": "afferent" },
      { "name": "Motor neuron", "info": "efferent" },
      { "name": "Interneuron", "info": "relay" }
    ],
    "clinical_relevance": "Explains deep tendon reflexes (patellar, biceps) and spinal cord injury levels (paraplegia, quadriplegia).",
    "image": "https://images.unsplash.com/photo-1559757148-5c350d0d3c56?auto=format&fit=crop&q=80&w=1000"
  },
  {
    "id": "diag-016",
    "title": "Female Reproductive System",
    "system": "Reproductive",
    "description": "Sagittal view of pelvis showing ovaries, fallopian tubes, uterus, cervix, vagina.",
    "labels": [
      { "name": "Ovary", "info": "produces ova and hormones" },
      { "name": "Uterus", "info": "site of gestation" },
      { "name": "Fallopian tube", "info": "site of fertilization" }
    ],
    "clinical_relevance": "Essential for understanding menstrual cycle, pregnancy, contraception, and gynecologic cancers.",
    "image": "https://images.unsplash.com/photo-1576086213369-97a306dca664?auto=format&fit=crop&q=80&w=1000"
  },
  {
    "id": "diag-017",
    "title": "Male Reproductive System",
    "system": "Reproductive",
    "description": "Lateral view of male pelvis and external genitalia.",
    "labels": [
      { "name": "Testis", "info": "produces sperm and testosterone" },
      { "name": "Prostate gland", "info": "secretes fluid for semen" }
    ],
    "clinical_relevance": "Key for understanding BPH, prostate cancer, testicular torsion, and male infertility.",
    "image": "https://images.unsplash.com/photo-1576086213369-97a306dca664?auto=format&fit=crop&q=80&w=1000"
  },
  {
    "id": "diag-018",
    "title": "Menstrual Cycle (Hormonal Changes)",
    "system": "Reproductive",
    "description": "Graph showing FSH, LH, estrogen, progesterone levels and corresponding ovarian/endometrial changes.",
    "labels": [
      { "name": "Ovulation", "info": "triggered by LH surge" },
      { "name": "Menstruation", "info": "shedding of endometrium" }
    ],
    "clinical_relevance": "Used to diagnose menstrual disorders, plan fertility treatments, and understand menopause.",
    "image": "https://images.unsplash.com/photo-1576086213369-97a306dca664?auto=format&fit=crop&q=80&w=1000"
  },
  {
    "id": "diag-019",
    "title": "Fetal Skull",
    "system": "Obstetrics",
    "description": "Side view of fetal skull showing fontanelles and sutures.",
    "labels": [
      { "name": "Anterior fontanelle", "info": "closes ~18 months" },
      { "name": "Posterior fontanelle", "info": "closes ~2 months" }
    ],
    "clinical_relevance": "Important for understanding labor mechanisms (molding, engagement) and recognizing abnormal presentations.",
    "image": "https://images.unsplash.com/photo-1576086213369-97a306dca664?auto=format&fit=crop&q=80&w=1000"
  },
  {
    "id": "diag-020",
    "title": "Placenta and Fetal Circulation",
    "system": "Obstetrics",
    "description": "Diagram of uterus with placenta and fetal circulatory shunts.",
    "labels": [
      { "name": "Umbilical vein", "info": "oxygenated blood to fetus" },
      { "name": "Ductus venosus", "info": "bypasses liver" }
    ],
    "clinical_relevance": "Understanding fetal circulation helps manage congenital heart disease and neonatal transition at birth.",
    "image": "https://images.unsplash.com/photo-1576086213369-97a306dca664?auto=format&fit=crop&q=80&w=1000"
  },
  {
    "id": "diag-021",
    "title": "Endocrine Glands",
    "system": "Endocrine",
    "description": "Diagram showing location of major endocrine glands.",
    "labels": [
      { "name": "Pituitary gland", "info": "master gland" },
      { "name": "Adrenal glands", "info": "stress response" }
    ],
    "clinical_relevance": "Essential for understanding hormonal disorders (diabetes, thyroid disease, Cushing's, Addison's).",
    "image": "https://images.unsplash.com/photo-1576086213369-97a306dca664?auto=format&fit=crop&q=80&w=1000"
  },
  {
    "id": "diag-022",
    "title": "Skin Structure (Cross-section)",
    "system": "Integumentary",
    "description": "Layers of epidermis, dermis, and hypodermis with appendages.",
    "labels": [
      { "name": "Epidermis", "info": "outermost layer" },
      { "name": "Dermis", "info": "contains glands and follicles" }
    ],
    "clinical_relevance": "Key for wound healing, pressure ulcer staging, burns, and skin cancer detection.",
    "image": "https://images.unsplash.com/photo-1576086213369-97a306dca664?auto=format&fit=crop&q=80&w=1000"
  },
  {
    "id": "diag-023",
    "title": "Pressure Ulcer Stages",
    "system": "Wound Care",
    "description": "Illustrations of pressure injuries from stage 1 to 4 and unstageable.",
    "labels": [
      { "name": "Stage 1", "info": "non-blanchable erythema" },
      { "name": "Stage 4", "info": "exposed bone, muscle, tendon" }
    ],
    "clinical_relevance": "Used for assessment, documentation, and prevention of hospital-acquired pressure ulcers.",
    "image": "https://images.unsplash.com/photo-1576086213369-97a306dca664?auto=format&fit=crop&q=80&w=1000"
  },
  {
    "id": "diag-024",
    "title": "Hand Hygiene Steps (WHO)",
    "system": "Infection Control",
    "description": "Diagram of hands with numbered steps for handwashing with soap and water or alcohol rub.",
    "labels": [
      { "name": "Palm to palm", "info": "step 1" },
      { "name": "Rotational rubbing of thumbs", "info": "step 5" }
    ],
    "clinical_relevance": "Standard precaution to prevent healthcare-associated infections.",
    "image": "https://images.unsplash.com/photo-1576086213369-97a306dca664?auto=format&fit=crop&q=80&w=1000"
  },
  {
    "id": "diag-025",
    "title": "Intramuscular Injection Sites",
    "system": "Medication Administration",
    "description": "Body outline showing ventrogluteal, dorsogluteal, vastus lateralis, and deltoid sites.",
    "labels": [
      { "name": "Ventrogluteal", "info": "preferred for adults" },
      { "name": "Vastus lateralis", "info": "preferred for infants" }
    ],
    "clinical_relevance": "Prevents nerve injury, ensures proper absorption, and reduces pain.",
    "image": "https://images.unsplash.com/photo-1576086213369-97a306dca664?auto=format&fit=crop&q=80&w=1000"
  },
  {
    "id": "diag-026",
    "title": "Subcutaneous Injection Sites",
    "system": "Medication Administration",
    "description": "Areas suitable for SC injections: abdomen, outer arm, anterior thigh, upper back.",
    "labels": [
      { "name": "Abdomen", "info": "2 inches from umbilicus" },
      { "name": "Outer arm", "info": "common for vaccines" }
    ],
    "clinical_relevance": "Used for insulin, heparin, and vaccines that require slow absorption.",
    "image": "https://images.unsplash.com/photo-1576086213369-97a306dca664?auto=format&fit=crop&q=80&w=1000"
  },
  {
    "id": "diag-027",
    "title": "Intravenous Cannulation Sites",
    "system": "Medication Administration",
    "description": "Arm and hand veins suitable for IV access.",
    "labels": [
      { "name": "Median cubital vein", "info": "preferred for blood draw" },
      { "name": "Cephalic vein", "info": "lateral forearm" }
    ],
    "clinical_relevance": "Choosing appropriate vein for IV therapy, blood transfusion, or blood sampling.",
    "image": "https://images.unsplash.com/photo-1576086213369-97a306dca664?auto=format&fit=crop&q=80&w=1000"
  },
  {
    "id": "diag-028",
    "title": "Nasogastric Tube Insertion",
    "system": "Gastrointestinal",
    "description": "Anatomic landmarks for NG tube placement: nose, earlobe, xiphoid process.",
    "labels": [
      { "name": "NEX Measurement", "info": "Nose to Earlobe to Xiphoid" },
      { "name": "Stomach", "info": "final destination" }
    ],
    "clinical_relevance": "Used for gastric decompression, feeding, or medication administration.",
    "image": "https://images.unsplash.com/photo-1576086213369-97a306dca664?auto=format&fit=crop&q=80&w=1000"
  },
  {
    "id": "diag-029",
    "title": "Urinary Catheterization (Female)",
    "system": "Urinary",
    "description": "Female perineal anatomy showing urethral meatus, vaginal opening, and anus.",
    "labels": [
      { "name": "Urethral meatus", "info": "insertion point" },
      { "name": "Labia minora", "info": "spread for visualization" }
    ],
    "clinical_relevance": "Essential for preventing UTI and trauma during catheterization.",
    "image": "https://images.unsplash.com/photo-1576086213369-97a306dca664?auto=format&fit=crop&q=80&w=1000"
  },
  {
    "id": "diag-030",
    "title": "Urinary Catheterization (Male)",
    "system": "Urinary",
    "description": "Male urethral anatomy with three constrictions.",
    "labels": [
      { "name": "Prostate gland", "info": "potential site of resistance" },
      { "name": "Urethral meatus", "info": "tip of penis" }
    ],
    "clinical_relevance": "Avoids false passage and trauma; important for patients with BPH.",
    "image": "https://images.unsplash.com/photo-1576086213369-97a306dca664?auto=format&fit=crop&q=80&w=1000"
  },
  {
    "id": "diag-031",
    "title": "Tracheostomy Care",
    "system": "Respiratory",
    "description": "Tracheostomy tube parts and surrounding anatomy.",
    "labels": [
      { "name": "Inner cannula", "info": "removable for cleaning" },
      { "name": "Cuff", "info": "inflated to prevent aspiration" }
    ],
    "clinical_relevance": "Prevents tube occlusion, infection, and accidental decannulation.",
    "image": "https://images.unsplash.com/photo-1559757175-5700dde675bc?auto=format&fit=crop&q=80&w=1000"
  },
  {
    "id": "diag-032",
    "title": "Cardiopulmonary Resuscitation (CPR) Hand Placement",
    "system": "Emergency",
    "description": "Adult chest with hands positioned on lower half of sternum.",
    "labels": [
      { "name": "Lower half of sternum", "info": "compression site" },
      { "name": "Depth", "info": "5-6 cm (2-2.4 inches)" }
    ],
    "clinical_relevance": "High-quality CPR increases survival from cardiac arrest.",
    "image": "https://images.unsplash.com/photo-1576086213369-97a306dca664?auto=format&fit=crop&q=80&w=1000"
  },
  {
    "id": "diag-033",
    "title": "Wound Dressing Layers",
    "system": "Wound Care",
    "description": "Cross-section of a wound with different dressing components.",
    "labels": [
      { "name": "Primary dressing", "info": "contact layer" },
      { "name": "Secondary dressing", "info": "absorbent pad" }
    ],
    "clinical_relevance": "Maintains moist wound environment, prevents infection, and absorbs exudate.",
    "image": "https://images.unsplash.com/photo-1576086213369-97a306dca664?auto=format&fit=crop&q=80&w=1000"
  },
  {
    "id": "diag-034",
    "title": "Suture Removal",
    "system": "Wound Care",
    "description": "Technique showing cutting suture close to skin and pulling.",
    "labels": [
      { "name": "Cut close to skin", "info": "prevents dragging external bacteria inward" },
      { "name": "Pull toward wound line", "info": "prevents dehiscence" }
    ],
    "clinical_relevance": "Prevents infection and scarring; timing depends on wound location.",
    "image": "https://images.unsplash.com/photo-1576086213369-97a306dca664?auto=format&fit=crop&q=80&w=1000"
  },
  {
    "id": "diag-035",
    "title": "Oxygen Delivery Devices",
    "system": "Respiratory",
    "description": "Various masks and cannulas with flow rates and FiO2 ranges.",
    "labels": [
      { "name": "Nasal cannula", "info": "1-6 L/min, 24-44% FiO2" },
      { "name": "Non-rebreather mask", "info": "10-15 L/min, 80-95% FiO2" }
    ],
    "clinical_relevance": "Select appropriate device based on patient's oxygen requirement and condition.",
    "image": "https://images.unsplash.com/photo-1559757175-5700dde675bc?auto=format&fit=crop&q=80&w=1000"
  },
  {
    "id": "diag-036",
    "title": "Lumbar Puncture Position",
    "system": "Diagnostic",
    "description": "Patient positioned in lateral recumbent fetal position.",
    "labels": [
      { "name": "Lateral recumbent", "info": "fetal position" },
      { "name": "Insertion site", "info": "between L3-L4 or L4-L5" }
    ],
    "clinical_relevance": "Used to obtain CSF for meningitis diagnosis, measure pressure, or administer spinal anesthesia.",
    "image": "https://images.unsplash.com/photo-1576086213369-97a306dca664?auto=format&fit=crop&q=80&w=1000"
  },
  {
    "id": "diag-037",
    "title": "Glasgow Coma Scale Chart",
    "system": "Neurology",
    "description": "Scoring table for eye, verbal, and motor responses.",
    "labels": [
      { "name": "Eye opening", "info": "1-4 points" },
      { "name": "Verbal response", "info": "1-5 points" },
      { "name": "Motor response", "info": "1-6 points" }
    ],
    "clinical_relevance": "Standard tool for assessing level of consciousness in head injury, stroke, or intoxication.",
    "image": "https://images.unsplash.com/photo-1559757148-5c350d0d3c56?auto=format&fit=crop&q=80&w=1000"
  },
  {
    "id": "diag-038",
    "title": "Last Offices (Care of Deceased)",
    "system": "End-of-Life",
    "description": "Steps for preparing body after death.",
    "labels": [
      { "name": "Close eyes", "info": "gentle pressure" },
      { "name": "Identification tags", "info": "essential for tracking" }
    ],
    "clinical_relevance": "Respects dignity, supports family, and follows legal requirements.",
    "image": "https://images.unsplash.com/photo-1576086213369-97a306dca664?auto=format&fit=crop&q=80&w=1000"
  },
  {
    "id": "diag-039",
    "title": "Breast Self-Examination (BSE)",
    "system": "Prevention",
    "description": "Steps for inspecting and palpating breasts.",
    "labels": [
      { "name": "Visual inspection", "info": "in mirror" },
      { "name": "Circular palpation", "info": "use pads of fingers" }
    ],
    "clinical_relevance": "Monthly self-exam helps detect breast lumps early.",
    "image": "https://images.unsplash.com/photo-1576086213369-97a306dca664?auto=format&fit=crop&q=80&w=1000"
  },
  {
    "id": "diag-040",
    "title": "Fetal Position in Utero (Presentations)",
    "system": "Obstetrics",
    "description": "Diagrams of cephalic, breech, and transverse lie.",
    "labels": [
      { "name": "Cephalic", "info": "head down" },
      { "name": "Breech", "info": "buttocks or feet first" }
    ],
    "clinical_relevance": "Determines mode of delivery and need for external cephalic version or C-section.",
    "image": "https://images.unsplash.com/photo-1576086213369-97a306dca664?auto=format&fit=crop&q=80&w=1000"
  }
]

flashcards = []

for diag in DIAGRAM_LIBRARY:
    # 1. Identification
    flashcards.append({
        "id": f"fc-{diag['id']}-ident",
        "question": f"Describe the main components and purpose of the '{diag['title']}' diagram.",
        "answer": f"{diag['description']} The key components include: {', '.join([l['name'] for l in diag['labels']])}.",
        "difficulty": "Moderate",
        "subject": diag['system'],
        "topic": "Diagram Analysis"
    })

    # 2. Clinical Relevance
    flashcards.append({
        "id": f"fc-{diag['id']}-clin",
        "question": f"What is the clinical relevance of understanding the '{diag['title']}' in nursing practice?",
        "answer": diag['clinical_relevance'],
        "difficulty": "Advanced",
        "subject": diag['system'],
        "topic": "Clinical Practice"
    })

    # 3. Label specific
    for l in diag['labels']:
        flashcards.append({
            "id": f"fc-{diag['id']}-{re.sub(r'[^a-z]', '', l['name'].lower())}",
            "question": f"In the context of the '{diag['title']}', what is the function or definition of the '{l['name']}'?",
            "answer": l['info'],
            "difficulty": "Moderate",
            "subject": diag['system'],
            "topic": diag['title']
        })

with open('src/data/flashcards/diagram_cards.json', 'w') as f:
    json.dump(flashcards, f, indent=2)

print(f"Generated {len(flashcards)} flashcards from diagrams.")
