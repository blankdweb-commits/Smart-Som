import json
import os

base_path = 'src/data/flashcards/curriculum/general-nursing/'
all_ids = set()
duplicates = []
total_cards = 0

for year_dir in os.listdir(base_path):
    y_path = os.path.join(base_path, year_dir)
    if not os.path.isdir(y_path): continue
    for sem_dir in os.listdir(y_path):
        s_path = os.path.join(y_path, sem_dir)
        norm_path = os.path.join(s_path, 'normalized.json')
        if os.path.exists(norm_path):
            with open(norm_path, 'r') as f:
                data = json.load(f)
                for course in data['courses']:
                    for unit in course['units']:
                        unit_qs = set()
                        for card in unit['flashcards']:
                            total_cards += 1
                            if 'id' not in card:
                                duplicates.append(f"Missing ID in {course['title']} {unit['unit_number']}")
                                continue
                            if card['id'] in all_ids:
                                duplicates.append(f"Duplicate ID: {card['id']}")
                            all_ids.add(card['id'])

                            q_lower = card['question'].lower()
                            if q_lower in unit_qs:
                                duplicates.append(f"Duplicate Question in {course['title']} {unit['unit_number']}: {card['question']}")
                            unit_qs.add(q_lower)

if duplicates:
    print(f"Validation failed with {len(duplicates)} errors.")
    for d in duplicates[:20]:
        print(d)
else:
    print(f"Validation passed: {total_cards} cards verified. No duplicate IDs or questions within units.")
