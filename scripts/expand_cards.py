import json
import os

def expand_file(filepath, subject_name):
    if not os.path.exists(filepath):
        return

    with open(filepath, 'r') as f:
        data = json.load(f)

    # If it's the new nested structure
    if isinstance(data, dict) and 'courses' in data:
        for course in data['courses']:
            for unit in course['units']:
                current_count = len(unit['flashcards'])
                if current_count < 10:
                    # Add dummy/placeholder but relevant questions if needed,
                    # but I'll try to add real ones for major units.
                    pass
        return

    # If it's a flat array (most of mine are)
    current_count = len(data)
    if current_count < 15:
        # I'll manually add some high-yield cards to the most important ones.
        pass

# I'll just manually write a few more comprehensive files for missing subjects.
