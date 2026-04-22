import React, { useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { Brain, CheckCircle2, XCircle, RefreshCw, ChevronRight, Trophy, AlertCircle } from '../components/Icons';

const Quiz = () => {
  const { flashcards } = useAppContext();
  const [quizStarted, setQuizStarted] = useState(false);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [showResults, setShowResults] = useState(false);
  const [selectedOption, setSelectedOption] = useState(null);
  const [quizQuestions, setQuizQuestions] = useState([]);

  // Generate a quiz from existing flashcards
  const startQuiz = () => {
    if (flashcards.length < 4) return;

    // Shuffle and pick 10 random cards (or all if less than 10)
    const shuffled = [...flashcards].sort(() => 0.5 - Math.random());
    const selected = shuffled.slice(0, 10);

    const questions = selected.map(card => {
      // Create distractors from other cards' answers
      const distractors = flashcards
        .filter(c => c.id !== card.id)
        .sort(() => 0.5 - Math.random())
        .slice(0, 3)
        .map(c => c.answer);

      const options = [card.answer, ...distractors].sort(() => 0.5 - Math.random());

      return {
        ...card,
        options,
        correctAnswer: card.answer
      };
    });

    setQuizQuestions(questions);
    setQuizStarted(true);
    setCurrentQuestionIndex(0);
    setScore(0);
    setShowResults(false);
    setSelectedOption(null);
  };

  const handleOptionClick = (option) => {
    if (selectedOption !== null) return;

    setSelectedOption(option);
    const correct = option === quizQuestions[currentQuestionIndex].correctAnswer;
    if (correct) setScore(score + 1);
  };

  const nextQuestion = () => {
    if (currentQuestionIndex < quizQuestions.length - 1) {
      setCurrentQuestionIndex(currentQuestionIndex + 1);
      setSelectedOption(null);
    } else {
      setShowResults(true);
    }
  };

  if (!quizStarted) {
    return (
      <div className="max-w-2xl mx-auto mt-12 text-center space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="w-24 h-24 bg-medical-100 dark:bg-medical-900/30 rounded-3xl flex items-center justify-center text-medical-600 mx-auto">
          <Brain size={48} />
        </div>
        <div className="space-y-4">
          <h2 className="text-4xl font-bold text-slate-800 dark:text-white">Knowledge Quiz</h2>
          <p className="text-slate-600 dark:text-slate-400 text-lg">
            Test your nursing knowledge with a quick 10-question quiz generated from your flashcards.
          </p>
        </div>

        {flashcards.length < 4 ? (
          <div className="p-6 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/30 rounded-2xl flex items-start gap-4 text-left">
            <AlertCircle className="text-amber-600 shrink-0" />
            <div>
              <p className="font-bold text-amber-800 dark:text-amber-400">Not enough cards</p>
              <p className="text-sm text-amber-700 dark:text-amber-500/80">You need at least 4 flashcards to start a quiz. Add more cards to your library first!</p>
            </div>
          </div>
        ) : (
          <button
            onClick={startQuiz}
            className="px-12 py-4 bg-medical-600 text-white rounded-2xl font-bold text-lg shadow-xl shadow-medical-600/30 hover:bg-medical-700 active:scale-95 transition-all"
          >
            Start Quiz
          </button>
        )}
      </div>
    );
  }

  if (showResults) {
    return (
      <div className="max-w-2xl mx-auto mt-12 text-center space-y-8 animate-in zoom-in duration-500">
        <div className="w-24 h-24 bg-yellow-100 dark:bg-yellow-900/30 rounded-full flex items-center justify-center text-yellow-600 mx-auto border-4 border-yellow-200">
          <Trophy size={48} />
        </div>
        <div className="space-y-2">
          <h2 className="text-4xl font-bold text-slate-800 dark:text-white">Quiz Completed!</h2>
          <p className="text-slate-600 dark:text-slate-400 text-xl">
            You scored <span className="text-medical-600 font-bold">{score}</span> out of <span className="font-bold">{quizQuestions.length}</span>
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 max-w-sm mx-auto">
          <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm">
            <p className="text-slate-500 text-xs font-bold uppercase tracking-wider">Accuracy</p>
            <p className="text-2xl font-black text-slate-800 dark:text-white">{(score / quizQuestions.length * 100).toFixed(0)}%</p>
          </div>
          <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm">
            <p className="text-slate-500 text-xs font-bold uppercase tracking-wider">Cards Tested</p>
            <p className="text-2xl font-black text-slate-800 dark:text-white">{quizQuestions.length}</p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
          <button
            onClick={startQuiz}
            className="px-8 py-3 bg-medical-600 text-white rounded-xl font-bold shadow-lg shadow-medical-600/20 hover:bg-medical-700 active:scale-95 transition-all flex items-center justify-center gap-2"
          >
            <RefreshCw size={20} />
            Try Again
          </button>
          <button
            onClick={() => setQuizStarted(false)}
            className="px-8 py-3 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-all"
          >
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  const currentQ = quizQuestions[currentQuestionIndex];

  return (
    <div className="max-w-3xl mx-auto space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-center">
        <div className="space-y-1">
          <span className="px-3 py-1 bg-medical-100 dark:bg-medical-900/30 text-medical-600 rounded-full text-xs font-bold">
            {currentQ.subject}
          </span>
          <h3 className="text-lg font-bold text-slate-500">Question {currentQuestionIndex + 1} of {quizQuestions.length}</h3>
        </div>
        <div className="text-right">
          <p className="text-sm font-bold text-slate-400">Current Score</p>
          <p className="text-2xl font-black text-medical-600">{score}</p>
        </div>
      </div>

      <div className="w-full bg-slate-200 dark:bg-slate-700 h-2 rounded-full overflow-hidden">
        <div
          className="bg-medical-500 h-full transition-all duration-500"
          style={{ width: `${((currentQuestionIndex + 1) / quizQuestions.length) * 100}%` }}
        />
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-3xl p-8 shadow-sm border border-slate-100 dark:border-slate-700 space-y-8">
        <h2 className="text-2xl sm:text-3xl font-bold text-slate-800 dark:text-white leading-tight">
          {currentQ.question}
        </h2>

        <div className="grid gap-3">
          {currentQ.options.map((option, idx) => {
            let style = "border-slate-200 dark:border-slate-700 hover:border-medical-500 hover:bg-medical-50 dark:hover:bg-medical-900/10";
            if (selectedOption === option) {
              style = option === currentQ.correctAnswer
                ? "border-green-500 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 ring-2 ring-green-500"
                : "border-red-500 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 ring-2 ring-red-500";
            } else if (selectedOption !== null && option === currentQ.correctAnswer) {
              style = "border-green-500 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400";
            }

            return (
              <button
                key={idx}
                disabled={selectedOption !== null}
                onClick={() => handleOptionClick(option)}
                className={`w-full text-left p-5 rounded-2xl border-2 transition-all duration-200 flex items-center justify-between group ${style}`}
              >
                <span className="font-semibold text-sm sm:text-base">{option}</span>
                {selectedOption === option && (
                  option === currentQ.correctAnswer ? <CheckCircle2 size={20} /> : <XCircle size={20} />
                )}
                {selectedOption !== null && option === currentQ.correctAnswer && <CheckCircle2 size={20} />}
              </button>
            );
          })}
        </div>
      </div>

      {selectedOption !== null && (
        <div className="flex justify-end animate-in fade-in slide-in-from-right-4">
          <button
            onClick={nextQuestion}
            className="flex items-center gap-2 px-8 py-4 bg-slate-800 dark:bg-white dark:text-slate-800 text-white rounded-2xl font-bold shadow-xl active:scale-95 transition-all"
          >
            {currentQuestionIndex < quizQuestions.length - 1 ? 'Next Question' : 'View Results'}
            <ChevronRight size={20} />
          </button>
        </div>
      )}
    </div>
  );
};

export default Quiz;
