import { useState, useEffect } from 'react';

// True while an immersive quiz is running. The Quiz page toggles the
// 'quiz-active' class on <body>; AdSenseManager observes it so an ACTIVE QUIZ
// overrides the route rule even if a quiz were ever nested under an allowed
// route. Mirrors the same signal BottomNav uses to hide itself.
export const useQuizActive = () => {
  const [quizActive, setQuizActive] = useState(
    () => typeof document !== 'undefined' && document.body.classList.contains('quiz-active')
  );

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const target = document.body;
    const update = () => setQuizActive(target.classList.contains('quiz-active'));
    update();
    const observer = new MutationObserver(update);
    observer.observe(target, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return quizActive;
};

export default useQuizActive;