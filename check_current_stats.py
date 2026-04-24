import json
import os
import re

base_path = 'src/data/flashcards/curriculum/general-nursing/'
stats = []

for year_dir in ['year-1', 'year-2', 'year-3']:
    y_path = os.path.join(base_path, year_dir)
    if not os.path.exists(y_path): continue
    for sem_dir in ['semester-1', 'semester-2']:
        s_path = os.path.join(y_path, sem_dir)
        norm_path = os.path.join(s_path, 'normalized.json')
        if os.path.exists(norm_path):
            with open(norm_path, 'r') as f:
                data = json.load(f)
                for course in data['courses']:
                    for unit in course['units']:
                        stats.append({
                            'year': data['metadata']['level'],
                            'semester': data['metadata']['semester'],
                            'course': course['title'],
                            'unit': unit['unit_number'],
                            'count': len(unit['flashcards'])
                        })

print(json.dumps(stats, indent=2))
