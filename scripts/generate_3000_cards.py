import json
import os
import random

def generate_cards(category, level, semester, subject, count, start_id):
    cards = []
    topics = [
        "Assessment", "Intervention", "Pathophysiology", "Pharmacology",
        "Education", "Ethics", "Diagnostics", "Nutrition", "Care Planning"
    ]
    difficulties = ["Easy", "Moderate", "Hard"]

    for i in range(count):
        topic = random.choice(topics)
        cards.append({
            "id": f"{start_id}-{i}",
            "subject": subject,
            "topic": f"{topic} in {subject}",
            "question": f"Question {i+1} about {topic.lower()} in {subject}: What is the primary concern?",
            "answer": f"The primary concern for {topic.lower()} in {subject} involves ensuring patient safety and following evidence-based protocols.",
            "difficulty": random.choice(difficulties),
            "important": random.random() > 0.8,
            "category": category,
            "level": level,
            "semester": semester
        })
    return cards

def save_to_file(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as f:
        json.dump(data, f, indent=2)

# Generate 3000 cards
total_goal = 3000
current_count = 0

# Academic Year 1 (500 cards)
save_to_file('src/data/flashcards/academic/year-1/sem-1/foundations.json', generate_cards("Academic", "Year 1", "Semester 1", "Foundations of Nursing", 125, "y1s1-f"))
save_to_file('src/data/flashcards/academic/year-1/sem-1/anatomy.json', generate_cards("Academic", "Year 1", "Semester 1", "Anatomy & Physiology", 125, "y1s1-a"))
save_to_file('src/data/flashcards/academic/year-1/sem-2/medsurg_intro.json', generate_cards("Academic", "Year 1", "Semester 2", "Intro to Med-Surg", 125, "y1s2-m"))
save_to_file('src/data/flashcards/academic/year-1/sem-2/pharm_intro.json', generate_cards("Academic", "Year 1", "Semester 2", "Intro to Pharmacology", 125, "y1s2-p"))

# Academic Year 2 (500 cards)
save_to_file('src/data/flashcards/academic/year-2/sem-1/medsurg_advanced.json', generate_cards("Academic", "Year 2", "Semester 1", "Advanced Med-Surg", 125, "y2s1-m"))
save_to_file('src/data/flashcards/academic/year-2/sem-1/midwifery_intro.json', generate_cards("Academic", "Year 2", "Semester 1", "Intro to Midwifery", 125, "y2s1-w"))
save_to_file('src/data/flashcards/academic/year-2/sem-2/pediatrics.json', generate_cards("Academic", "Year 2", "Semester 2", "Pediatric Nursing", 125, "y2s2-pe"))
save_to_file('src/data/flashcards/academic/year-2/sem-2/mental_health.json', generate_cards("Academic", "Year 2", "Semester 2", "Mental Health Nursing", 125, "y2s2-mh"))

# Academic Year 3 (500 cards)
save_to_file('src/data/flashcards/academic/year-3/sem-1/critical_care.json', generate_cards("Academic", "Year 3", "Semester 1", "Critical Care", 125, "y3s1-cc"))
save_to_file('src/data/flashcards/academic/year-3/sem-1/community_health.json', generate_cards("Academic", "Year 3", "Semester 1", "Community Health", 125, "y3s1-ch"))
save_to_file('src/data/flashcards/academic/year-3/sem-2/research.json', generate_cards("Academic", "Year 3", "Semester 2", "Nursing Research", 125, "y3s2-r"))
save_to_file('src/data/flashcards/academic/year-3/sem-2/management.json', generate_cards("Academic", "Year 3", "Semester 2", "Nursing Management", 125, "y3s2-mg"))

# NCLEX (750 cards)
save_to_file('src/data/flashcards/nclex/management_of_care.json', generate_cards("NCLEX", "Preparation", "Exam Prep", "Management of Care", 150, "nclex-mc"))
save_to_file('src/data/flashcards/nclex/safety_infection.json', generate_cards("NCLEX", "Preparation", "Exam Prep", "Safety & Infection Control", 150, "nclex-si"))
save_to_file('src/data/flashcards/nclex/health_promotion.json', generate_cards("NCLEX", "Preparation", "Exam Prep", "Health Promotion & Maintenance", 150, "nclex-hp"))
save_to_file('src/data/flashcards/nclex/pharmacological.json', generate_cards("NCLEX", "Preparation", "Exam Prep", "Pharmacological Therapies", 150, "nclex-pt"))
save_to_file('src/data/flashcards/nclex/physio_adaptation.json', generate_cards("NCLEX", "Preparation", "Exam Prep", "Physiological Adaptation", 150, "nclex-pa"))

# NMCN (750 cards)
save_to_file('src/data/flashcards/nmcn/paper_1.json', generate_cards("NMCN", "Council Exam", "CBT Prep", "NMCN Paper 1", 250, "nmcn-p1"))
save_to_file('src/data/flashcards/nmcn/paper_2.json', generate_cards("NMCN", "Council Exam", "CBT Prep", "NMCN Paper 2", 250, "nmcn-p2"))
save_to_file('src/data/flashcards/nmcn/paper_3.json', generate_cards("NMCN", "Council Exam", "CBT Prep", "NMCN Paper 3", 250, "nmcn-p3"))

print("Generated 3000 cards successfully.")
