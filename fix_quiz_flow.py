import re

with open('src/pages/Quiz.jsx', 'r') as f:
    content = f.read()

# Update confirmAnswer to set showRationale(true)
content = content.replace("setShowReview(true);", "setShowReview(true); setShowRationale(true);")

with open('src/pages/Quiz.jsx', 'w') as f:
    f.write(content)
