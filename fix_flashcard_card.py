import re

with open('src/components/FlashcardCard.jsx', 'r') as f:
    content = f.read()

# Replace the legacy source badge logic
legacy_badge_pattern = r'\{isRichard && <span className="px-3 py-1 bg-indigo-500 text-white rounded-full text-\[8px\] font-black uppercase tracking-widest shadow-\[0_0_15px_rgba\(99,102,241,0.6\)\] animate-pulse">Verified Source: Richard.s Bank</span>\}'
new_badge = '<SourceBadge source={card.source} />'

content = re.sub(legacy_badge_pattern, new_badge, content)

# Remove isRichard check if not used elsewhere
content = content.replace("const isRichard = card.source?.toLowerCase().includes('richard');", "")

# Remove legacy source text
legacy_source_text_pattern = r'SOURCE: \{card\.source \|\| "Apex Scholars Core Bank"\}'
content = re.sub(legacy_source_text_pattern, 'NURSING EDUCATION SUITE', content)

with open('src/components/FlashcardCard.jsx', 'w') as f:
    f.write(content)
