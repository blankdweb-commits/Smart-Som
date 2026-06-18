with open('src/components/Layout.jsx', 'r') as f:
    content = f.read()

# Immersive Mode: Ensure FeeBanner is also hidden during Quiz
content = content.replace("<FeeBanner />", "{!isQuizActive && <FeeBanner />}")

with open('src/components/Layout.jsx', 'w') as f:
    f.write(content)
