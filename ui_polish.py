with open('src/pages/Quiz.jsx', 'r') as f:
    content = f.read()

# Refine Answer Card touch targets and typography
old_option = '<OptionButton label={option} index={idx} state={state} onClick={() => handleOptionSelect(option)} disabled={isReview || quizStatus === QUIZ_STATES.CONFIRMING} pollValue={classPoll ? classPoll[option] : undefined} isLowPowerMode={isLowPowerMode} />'
new_option = '<OptionButton label={option} index={idx} state={state} onClick={() => handleOptionSelect(option)} disabled={isReview || quizStatus === QUIZ_STATES.CONFIRMING || isLoadingQuestion} pollValue={classPoll ? classPoll[option] : undefined} isLowPowerMode={isLowPowerMode} />'

if old_option in content:
    content = content.replace(old_option, new_option)
    with open('src/pages/Quiz.jsx', 'w') as f:
        f.write(content)
    print('Polished OptionButton usage.')

# Ensure layout expansion on 50/50
# Actually the physical removal is already done in currentQ.options.map logic with eliminatedOptions.includes check.
# I just need to ensure the grid/flex grows.
# Looking at the code: className={eliminatedOptions.length > 0 ? "flex-1 min-h-[120px]" : ""}
# This is good.

# Final check for glow efficiency
with open('src/components/SourceBadge.jsx', 'r') as f:
    badge = f.read()
if 'shadow-[0_0_15px_rgba(251,191,36,0.5)]' in badge:
    # Reduce glow size for low RAM
    new_badge = badge.replace('shadow-[0_0_15px_rgba(251,191,36,0.5)]', 'shadow-[0_0_10px_rgba(251,191,36,0.3)]')
    new_badge = new_badge.replace('shadow-[0_0_15px_rgba(37,99,235,0.4)]', 'shadow-[0_0_10px_rgba(37,99,235,0.2)]')
    with open('src/components/SourceBadge.jsx', 'w') as f:
        f.write(new_badge)
    print('Optimized SourceBadge glow.')
