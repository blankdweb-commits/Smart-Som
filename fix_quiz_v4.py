import re

with open('src/pages/Quiz.jsx', 'r') as f:
    content = f.read()

# 1. Update Lifeline Restoration: restore ALL lifelines every 5 correct answers
restoration_logic = """      const newCombo = consecutiveCorrect + 1;
      if (newCombo % 5 === 0 && newCombo > 0) {
        setLifelinesUsed({ hint: false, fiftyFifty: false, askClass: false });
        setRestoredThisTurn(true);
      }
      setConsecutiveCorrect(newCombo);"""

content = re.sub(r"const newCombo = consecutiveCorrect \+ 1;.*?setConsecutiveCorrect\(newCombo\);", restoration_logic, content, flags=re.DOTALL)

# Remove the old cyclic restoration logic if it exists
old_cyclic_logic = r"if \(newCombo % 5 === 0\) \{.*?\}\s+updateQuizStats"
replacement_stats = "updateQuizStats"
content = re.sub(old_cyclic_logic, replacement_stats, content, flags=re.DOTALL)

# 2. Final Answer Modal Styling (Ensure it matches requirements)
# Note: modal already exists, will just double check the confirm logic.

with open('src/pages/Quiz.jsx', 'w') as f:
    f.write(content)
