import re

with open('src/pages/Quiz.jsx', 'r') as f:
    content = f.read()

# Remove the placeholder I left
content = content.replace("// [Icons and helper components omitted for re-injection]", "")

# Remove any duplicated "export default Quiz;"
content = re.sub(r"export default Quiz;\s+export default Quiz;", "export default Quiz;", content)

# Check for double declarations of helper components
content = re.sub(r"const ModeCard = .*?const ModeCard =", "const ModeCard =", content, flags=re.DOTALL)
content = re.sub(r"const LifelineButton = .*?const LifelineButton =", "const LifelineButton =", content, flags=re.DOTALL)
content = re.sub(r"const OptionButton = .*?const OptionButton =", "const OptionButton =", content, flags=re.DOTALL)

with open('src/pages/Quiz.jsx', 'w') as f:
    f.write(content)
