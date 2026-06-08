import json

raw_data = [
  {
    "id": 1,
    "question": "How long does the LH surge typically last?",
    "options": ["1-2 hours", "12-24 hours", "2-3 days", "1-2 weeks"],
    "answer": "b",
    "hint": "The LH surge is brief and triggers ovulation; it usually lasts less than a day."
  },
  {
    "id": 2,
    "question": "In addition to regulating the menstrual cycle, LH also plays a role in which process in the female body?",
    "options": ["Breast development", "Bone growth", "Muscle building", "Menopause"],
    "answer": "d",
    "hint": "LH levels change significantly during menopause."
  },
  {
    "id": 3,
    "question": "LH levels can be measured in a woman's urine using which type of test?",
    "options": ["Ovulation predictor kit", "Pap smear", "Ultrasound", "Blood test"],
    "answer": "a",
    "hint": "Ovulation predictor kits detect the LH surge in urine to predict ovulation."
  },
  {
    "id": 4,
    "question": "What is the function of LH in the male body?",
    "options": ["To stimulate testicular development", "To regulate sperm production", "To trigger the release of testosterone", "All of the above"],
    "answer": "d",
    "hint": "LH acts on Leydig cells in the testes to produce testosterone, which supports sperm production and development."
  },
  {
    "id": 5,
    "question": "LH is sometimes used in assisted reproductive technologies such as in vitro fertilization (IVF) to stimulate which process?",
    "options": ["Follicle development", "Ovulation", "Corpus luteum formation", "Endometrial growth"],
    "answer": "a",
    "hint": "LH works with FSH to promote follicle growth and maturation."
  },
  {
    "id": 6,
    "question": "In what form is LH released from the pituitary gland?",
    "options": ["As a peptide hormone", "As a steroid hormone", "As a neurotransmitter", "As a growth factor"],
    "answer": "a",
    "hint": "LH is a glycoprotein hormone composed of amino acids."
  },
  {
    "id": 7,
    "question": "Which phase of the menstrual cycle is characterized by a surge in LH levels?",
    "options": ["Follicular phase", "Luteal phase", "Menstrual phase", "Ovulatory phase"],
    "answer": "d",
    "hint": "The LH surge triggers ovulation, marking the ovulatory phase."
  },
  {
    "id": 8,
    "question": "LH is responsible for stimulating which process in the female body?",
    "options": ["Follicle development", "Ovulation", "Corpus luteum formation", "Endometrial growth"],
    "answer": "b",
    "hint": "The primary role of LH in females is to trigger ovulation."
  },
  {
    "id": 9,
    "question": "Where is luteinizing hormone (LH) produced in the female body?",
    "options": ["Ovaries", "Pituitary gland", "Hypothalamus", "Uterus"],
    "answer": "b",
    "hint": "LH is secreted by the anterior pituitary gland."
  },
  {
    "id": 10,
    "question": "What triggers the release of LH in the female body?",
    "options": ["High levels of estrogen", "High levels of progesterone", "Low levels of estrogen", "Low levels of progesterone"],
    "answer": "a",
    "hint": "Rising estrogen from the dominant follicle triggers a positive feedback loop, causing the LH surge."
  },
  {
    "id": 11,
    "question": "How does the surge in LH levels trigger ovulation?",
    "options": ["By causing the release of an egg from the ovary", "By thickening the endometrial lining of the uterus", "By suppressing FSH production", "By stimulating progesterone production"],
    "answer": "a",
    "hint": "LH surge causes the follicle to rupture and release the mature egg."
  },
  {
    "id": 12,
    "question": "What is the function of the corpus luteum in the menstrual cycle?",
    "options": ["To produce estrogen", "To produce progesterone", "To produce LH", "To produce FSH"],
    "answer": "b",
    "hint": "The corpus luteum secretes progesterone to prepare and maintain the uterine lining for pregnancy."
  },
  {
    "id": 13,
    "question": "What happens to LH levels during menopause?",
    "options": ["They decrease", "They increase", "They remain the same", "It depends on the individual"],
    "answer": "a",
    "hint": "Ovarian function declines, leading to reduced estrogen and progesterone, which causes FSH and LH levels to rise, not decrease."
  },
  {
    "id": 14,
    "question": "LH levels are highest during which part of the menstrual cycle?",
    "options": ["Follicular phase", "Luteal phase", "Menstrual phase", "Ovulatory phase"],
    "answer": "d",
    "hint": "The LH surge occurs just before ovulation, during the ovulatory phase."
  },
  {
    "id": 15,
    "question": "What is the feedback mechanism that regulates LH production in the female body?",
    "options": ["Positive feedback loop", "Negative feedback loop", "Neutral feedback loop", "None of the above"],
    "answer": "b",
    "hint": "Generally, estrogen exerts negative feedback on LH, except at high levels just before ovulation."
  },
  {
    "id": 16,
    "question": "What is the normal range of LH levels in the female body during the menstrual cycle?",
    "options": ["2-10 mIU/mL", "10-20 mIU/mL", "20-50 mIU/mL", "50-100 mIU/mL"],
    "answer": "c",
    "hint": "LH peaks around 20-50 mIU/mL during the surge."
  },
  {
    "id": 17,
    "question": "The release of LH is triggered by a positive feedback loop involving which hormone?",
    "options": ["Estrogen", "Progesterone", "Follicle-stimulating hormone (FSH)", "Gonadotropin-releasing hormone (GnRH)"],
    "answer": "a",
    "hint": "High estrogen levels stimulate the release of GnRH, which then triggers LH surge."
  },
  {
    "id": 18,
    "question": "LH plays a key role in which stage of the menstrual cycle?",
    "options": ["Follicular phase", "Luteal phase", "Menstrual phase", "Proliferative phase"],
    "answer": "b",
    "hint": "LH supports the corpus luteum during the luteal phase."
  },
  {
    "id": 19,
    "question": "LH production is regulated by which part of the brain?",
    "options": ["Thalamus", "Hypothalamus", "Cerebellum", "Amygdala"],
    "answer": "b",
    "hint": "The hypothalamus secretes GnRH, which controls pituitary LH release."
  },
  {
    "id": 20,
    "question": "What is the main target of LH in the female body?",
    "options": ["Ovaries", "Uterus", "Mammary glands", "Hypothalamus"],
    "answer": "a",
    "hint": "LH acts directly on the ovaries (follicles and corpus luteum)."
  },
  {
    "id": 21,
    "question": "Which hormone is responsible for the onset of puberty in females?",
    "options": ["Luteinizing Hormone (LH)", "Follicle-Stimulating Hormone (FSH)", "Estrogen", "Progesterone"],
    "answer": "c",
    "hint": "Estrogen drives the development of secondary sexual characteristics and the growth spurt at puberty."
  },
  {
    "id": 22,
    "question": "Which hormone is responsible for maintaining pregnancy?",
    "options": ["Luteinizing Hormone (LH)", "Follicle-Stimulating Hormone (FSH)", "Estrogen", "Progesterone"],
    "answer": "d",
    "hint": "Progesterone maintains the uterine lining and prevents contractions."
  },
  {
    "id": 23,
    "question": "Which hormone is responsible for the production of milk in breastfeeding mothers?",
    "options": ["Luteinizing Hormone (LH)", "Follicle-Stimulating Hormone (FSH)", "Estrogen", "Prolactin"],
    "answer": "d",
    "hint": "Prolactin stimulates milk synthesis in the mammary glands."
  },
  {
    "id": 24,
    "question": "Which hormone is responsible for the regulation of the menstrual cycle?",
    "options": ["Luteinizing Hormone (LH)", "Follicle-Stimulating Hormone (FSH)", "Estrogen", "Progesterone"],
    "answer": "a",
    "hint": "LH and FSH together regulate the cycle; LH specifically triggers ovulation."
  },
  {
    "id": 25,
    "question": "Which hormone is responsible for the development of breast tissue?",
    "options": ["Luteinizing Hormone (LH)", "Follicle-Stimulating Hormone (FSH)", "Estrogen", "Progesterone"],
    "answer": "c",
    "hint": "Estrogen promotes ductal growth and breast development."
  },
  {
    "id": 26,
    "question": "Which hormone is responsible for ovulation?",
    "options": ["Luteinizing Hormone (LH)", "Follicle-Stimulating Hormone (FSH)", "Estrogen", "Progesterone"],
    "answer": "a",
    "hint": "The LH surge causes the release of the egg."
  },
  {
    "id": 27,
    "question": "Which hormone is responsible for the thickening of the uterine lining during the menstrual cycle?",
    "options": ["Luteinizing Hormone (LH)", "Follicle-Stimulating Hormone (FSH)", "Estrogen", "Progesterone"],
    "answer": "d",
    "hint": "Progesterone thickens the endometrium after ovulation for implantation."
  },
  {
    "id": 28,
    "question": "Which hormone is responsible for the growth and development of ovarian follicles?",
    "options": ["Luteinizing Hormone (LH)", "Estrogen", "Follicle-Stimulating Hormone (FSH)", "Progesterone"],
    "answer": "c",
    "hint": "FSH stimulates follicular growth."
  },
  {
    "id": 29,
    "question": "Which hormone is responsible for maintaining the pregnancy?",
    "options": ["Luteinizing Hormone (LH)", "Estrogen", "Follicle-Stimulating Hormone (FSH)", "Progesterone"],
    "answer": "d",
    "hint": "Progesterone prevents uterine contractions and supports the endometrium."
  },
  {
    "id": 30,
    "question": "Which hormone is responsible for regulating sebum production in the skin?",
    "options": ["Estrogen", "Progesterone", "Luteinizing hormone (LH)", "Testosterone"],
    "answer": "d",
    "hint": "Testosterone increases sebum production, which can lead to acne."
  },
  {
    "id": 31,
    "question": "Which hormone is responsible for increasing the risk of acne in females with androgen excess?",
    "options": ["Estrogen", "Progesterone", "Luteinizing hormone (LH)", "Testosterone"],
    "answer": "d",
    "hint": "Excess testosterone stimulates sebaceous glands, causing acne."
  },
  {
    "id": 32,
    "question": "Which hormone is responsible for regulating the growth of body hair in females with androgen excess?",
    "options": ["Estrogen", "Progesterone", "Luteinizing hormone (LH)", "Testosterone"],
    "answer": "d",
    "hint": "Androgens like testosterone promote hirsutism (excess body hair)."
  },
  {
    "id": 33,
    "question": "Which hormone is responsible for causing menstrual irregularities in females with androgen excess?",
    "options": ["Estrogen", "Progesterone", "Luteinizing hormone (LH)", "Testosterone"],
    "answer": "d",
    "hint": "High testosterone disrupts normal ovulation and menstrual cycles."
  },
  {
    "id": 34,
    "question": "Which hormone is responsible for promoting the growth of ovarian follicles in females?",
    "options": ["Estrogen", "Progesterone", "Luteinizing hormone (LH)", "Testosterone"],
    "answer": "c",
    "hint": "LH acts on theca cells to produce androgens that are converted to estrogen, supporting follicle growth."
  },
  {
    "id": 35,
    "question": "Which hormone is responsible for the development of male secondary sexual characteristics in females with androgen excess?",
    "options": ["Estrogen", "Progesterone", "Luteinizing hormone (LH)", "Testosterone"],
    "answer": "d",
    "hint": "Testosterone causes virilization in females, such as deepening voice and male pattern hair."
  },
  {
    "id": 36,
    "question": "Which hormone is responsible for the growth and development of pubic and underarm hair in females?",
    "options": ["Estrogen", "Progesterone", "Luteinizing hormone (LH)", "Testosterone"],
    "answer": "d",
    "hint": "Androgens (testosterone) drive pubic and axillary hair growth in both sexes."
  },
  {
    "id": 37,
    "question": "Which hormone is responsible for maintaining bone density in females?",
    "options": ["Estrogen", "Progesterone", "Luteinizing hormone (LH)", "Testosterone"],
    "answer": "a",
    "hint": "Estrogen inhibits bone resorption and maintains bone density."
  },
  {
    "id": 38,
    "question": "Which hormone is responsible for increasing muscle mass and strength in females?",
    "options": ["Estrogen", "Progesterone", "Luteinizing hormone (LH)", "Testosterone"],
    "answer": "d",
    "hint": "Testosterone has anabolic effects on muscle tissue."
  },
  {
    "id": 39,
    "question": "Which hormone is responsible for regulating the sex drive in females?",
    "options": ["Estrogen", "Progesterone", "Luteinizing hormone (LH)", "Testosterone"],
    "answer": "d",
    "hint": "Testosterone plays a key role in female libido."
  },
  {
    "id": 40,
    "question": "What is the role of the fibrous connective tissue in the breasts?",
    "options": ["To produce milk during lactation", "To give the breast its shape and size", "To transport blood and nutrients to the breast tissue", "To regulate hormone levels in the breast tissue"],
    "answer": "b",
    "hint": "Fibrous connective tissue (Cooper's ligaments) supports breast structure."
  },
  {
    "id": 41,
    "question": "What is the name of the circular pigmented area surrounding the nipple?",
    "options": ["Mammary gland", "Areola", "Duct", "Lobule"],
    "answer": "b",
    "hint": "The areola contains Montgomery glands and pigmentation."
  },
  {
    "id": 42,
    "question": "Which lymphatic vessel drains the lymph fluid from the breast tissue into the lymph nodes?",
    "options": ["Thoracoacromial lymphatic vessel", "Internal mammary lymphatic vessel", "Lateral thoracic lymphatic vessel", "Subclavian lymphatic vessel"],
    "answer": "c",
    "hint": "Most breast lymph drains via the lateral thoracic vessels to axillary nodes."
  },
  {
    "id": 43,
    "question": "What can affect the lymphatic drainage of the breast tissue?",
    "options": ["Regular breast exams", "Pregnancy and lactation", "Breast cancer", "Adipose tissue growth"],
    "answer": "c",
    "hint": "Tumors can obstruct lymphatics, causing edema or peau d'orange."
  },
  {
    "id": 44,
    "question": "Which veins eventually carry the deoxygenated blood from the breasts back to the heart?",
    "options": ["Axillary veins and internal mammary veins", "Lateral thoracic veins and subclavian veins", "Jugular veins and brachiocephalic veins", "Inferior and superior vena cava"],
    "answer": "d",
    "hint": "Venous return from the breast ultimately enters the superior vena cava."
  },
  {
    "id": 45,
    "question": "What are the primary glands responsible for producing milk in the breasts?",
    "options": ["Adipose glands", "Sebaceous glands", "Mammary glands", "Sweat glands"],
    "answer": "c",
    "hint": "Mammary glands are modified sweat glands that produce milk."
  },
  {
    "id": 46,
    "question": "What is the primary function of the lymphatic system in the breasts?",
    "options": ["To transport oxygen and nutrients to the breast tissue", "To remove waste products from the breast tissue", "To regulate hormone levels in the breast tissue", "To produce milk during lactation"],
    "answer": "b",
    "hint": "Lymphatics remove interstitial fluid and waste products."
  },
  {
    "id": 47,
    "question": "Which artery is responsible for supplying blood to the medial aspect of the breast?",
    "options": ["Lateral thoracic artery", "Thoracoacromial artery", "Internal mammary artery", "Subclavian artery"],
    "answer": "c",
    "hint": "The internal mammary (thoracic) artery supplies the medial breast."
  },
  {
    "id": 48,
    "question": "Which vein drains blood from the lateral and anterior aspects of the breast?",
    "options": ["Axillary vein", "Internal mammary vein", "Subclavian vein", "Brachiocephalic vein"],
    "answer": "a",
    "hint": "Lateral breast drains into axillary vein via lateral thoracic vein."
  },
  {
    "id": 49,
    "question": "What is the primary lymph node location for the lymphatic drainage of the breast tissue?",
    "options": ["Inguinal lymph nodes", "Mesenteric lymph nodes", "Axillary lymph nodes", "Cervical lymph nodes"],
    "answer": "c",
    "hint": "About 75% of breast lymph drains to axillary nodes."
  },
  {
    "id": 50,
    "question": "Which of the following arteries supplies blood to the pectoralis major muscle?",
    "options": ["Lateral thoracic artery", "Thoracoacromial artery", "Internal mammary artery", "Subclavian artery"],
    "answer": "b",
    "hint": "The thoracoacromial artery supplies the pectoralis major."
  }
]

def map_answer(q):
    letter = q["answer"].lower()
    idx = ord(letter) - ord('a')
    return q["options"][idx]

formatted = []
for i, q in enumerate(raw_data):
    # Year distribution
    if i < 20:
        level = "Year 1"
        subject = "Physiology & Anatomy"
    elif i < 39:
        level = "Year 2"
        subject = "Medical-Surgical Nursing"
    else:
        level = "Year 3"
        subject = "Advanced Anatomy"

    formatted.append({
        "id": f"nmcn_hormones_{q['id']}",
        "question": q["question"],
        "options": q["options"],
        "answer": map_answer(q),
        "hint": q["hint"],
        "rationale": q["hint"], # Using hint as rationale if none provided
        "subject": subject,
        "level": level,
        "category": "NMCN",
        "source": "NMCN Council Prep"
    })

with open('src/data/flashcards/nmcn/nmcn-physiology-anatomy.json', 'w') as f:
    json.dump(formatted, f, indent=2)
