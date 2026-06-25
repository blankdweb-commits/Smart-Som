import re

with open('src/pages/Quiz.jsx', 'r') as f:
    content = f.read()

# Update option rendering to collapse eliminated choices
new_map_logic = """            {currentQ.options.map((option, idx) => {
              const isEliminated = eliminatedOptions.includes(option);
              return (
                <AnimatePresence key={idx}>
                  {!isEliminated && (
                    <motion.div
                      initial={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      transition={{ duration: 0.2 }}
                      className="h-full"
                    >
                      <OptionButton
                        label={option}
                        index={idx}
                        state={showRationale ? (option === currentQ.correctAnswer ? 'correct' : (selectedOption === option ? 'wrong' : 'normal')) : (selectedOption === option ? 'selected' : 'normal')}
                        onClick={() => handleOptionClick(option)}
                        disabled={showRationale}
                        dark={true}
                        isSpeed={true}
                        pollValue={classPoll ? classPoll[option] : undefined}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              );
            })}"""

# Replace the current options map
content = re.sub(r"\{currentQ\.options\.map\(\(option, idx\) => \(.*?\)\)\}", new_map_logic, content, flags=re.DOTALL)

with open('src/pages/Quiz.jsx', 'w') as f:
    f.write(content)
