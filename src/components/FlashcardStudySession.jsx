import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { SwipeableCards } from '@daformat/react-swipeable-cards';
import FlashcardCard from './FlashcardCard';
import { ArrowLeft, CheckCircle2 } from './Icons';

const QUALITY = { again: 1, hard: 3, good: 4, easy: 5 };

const SRSButton = ({ label, sublabel, color, onClick }) => (
  <button
    onClick={(e) => { e.stopPropagation(); onClick(); }}
    className={`${color} text-white p-3 rounded-2xl shadow-clinical hover:opacity-90 transition-all flex flex-col items-center justify-center min-h-[64px] active:scale-95`}
  >
    <span className="text-base font-bold">{label}</span>
    <span className="text-[10px] opacity-80 font-medium tracking-wide">{sublabel}</span>
  </button>
);

const SessionControls = ({ onRate }) => {
  const stack = SwipeableCards.useSwipeableCardsStack();
  return (
    <div className="grid grid-cols-4 gap-2 w-full max-w-md mx-auto">
      <SRSButton label="Again" sublabel="<1m" color="bg-red-500" onClick={() => onRate(QUALITY.again)} />
      <SRSButton label="Hard" sublabel="1d" color="bg-orange-500" onClick={() => onRate(QUALITY.hard)} />
      <SRSButton label="Good" sublabel="4d" color="bg-emerald-500" onClick={() => onRate(QUALITY.good)} />
      <SRSButton label="Easy" sublabel="7d+" color="bg-blue-500" onClick={() => onRate(QUALITY.easy)} />
    </div>
  );
};

const FlashcardStudySession = ({ cards, updateCardProgress, incrementCardsStudied, onComplete, onExit }) => {
  const total = cards.length;
  const [stats, setStats] = useState({ rated: 0, mastered: 0, needsReview: 0, accuracySum: 0 });
  const [flippedId, setFlippedId] = useState(null);
  const [startedAt] = useState(Date.now());

  useEffect(() => {
    document.body.classList.add('quiz-active');
    return () => document.body.classList.remove('quiz-active');
  }, []);

  const rateTopCard = (quality) => {
    setStats(prev => ({
      rated: prev.rated + 1,
      mastered: prev.mastered + (quality >= 4 ? 1 : 0),
      needsReview: prev.needsReview + (quality < 3 ? 1 : 0),
      accuracySum: prev.accuracySum + (quality / 5) * 100
    }));
    if (incrementCardsStudied) incrementCardsStudied();
  };

  const handleSwipe = (direction, cardId) => {
    const card = cards.find(c => String(c.id) === String(cardId));
    if (!card) return;
    const quality = direction === 'right' ? QUALITY.easy : QUALITY.again;
    if (updateCardProgress) updateCardProgress(card.id, quality);
    rateTopCard(quality);
    setFlippedId(null);
  };

  const handleRate = (quality) => {
    // Top card is derived from rated count; progress is persisted per card
    const idx = Math.min(stats.rated, total - 1);
    const card = cards[idx];
    if (card && updateCardProgress) updateCardProgress(card.id, quality);
    rateTopCard(quality);
    setFlippedId(null);
  };

  const done = stats.rated >= total;

  return (
    <div className="fixed inset-0 z-[90] bg-slate-50 dark:bg-slate-900 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700">
        <button
          onClick={onExit}
          className="p-2 bg-slate-100 dark:bg-slate-700 rounded-xl text-slate-600 dark:text-slate-300 active:scale-95 transition-transform"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1">
          <div className="flex justify-between items-center mb-1">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
              Card {Math.min(stats.rated + 1, total)} of {total}
            </span>
          </div>
          <div className="h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
            <div className="h-full bg-teal-500 transition-all duration-300" style={{ width: `${(stats.rated / total) * 100}%` }} />
          </div>
        </div>
      </div>

      {!done ? (
        <>
          <div className="flex-1 flex items-center justify-center px-6 min-h-0 py-4">
            <SwipeableCards.Root
              key={`session-${total}-${startedAt}`}
              className="swipe-cards-root"
              cards={cards.map(card => ({ id: String(card.id), card: null }))}
              swipeDirections="horizontal"
              onSwipe={handleSwipe}
              emptyView={<></>}
            >
              <SwipeableCards.Cards visibleStackLength={3} style={{ aspectRatio: '3 / 4', width: 'min(100%, 22rem)' }}>
                {(stack) => stack.map(entry => {
                  const card = cards.find(c => String(c.id) === entry.id);
                  if (!card) return null;
                  return (
                    <SwipeableCards.CardWrapper key={entry.id} card={entry}>
                      <FlashcardCard
                        card={card}
                        isFullscreen={true}
                        isFlipped={flippedId === entry.id}
                        onFlip={() => setFlippedId(flippedId === entry.id ? null : entry.id)}
                      />
                    </SwipeableCards.CardWrapper>
                  );
                })}
              </SwipeableCards.Cards>

              {/* Swipe action buttons */}
              <div className="mt-8 grid grid-cols-2 gap-3 w-full max-w-xs mx-auto">
                <SwipeableCards.SwipeLeftButton className="p-4 rounded-2xl bg-red-500 text-white shadow-clinical hover:opacity-90 active:scale-95 transition-all min-h-[56px] font-black uppercase tracking-widest text-xs">
                  Review Later
                </SwipeableCards.SwipeLeftButton>
                <SwipeableCards.SwipeRightButton className="p-4 rounded-2xl bg-emerald-500 text-white shadow-clinical hover:opacity-90 active:scale-95 transition-all min-h-[56px] font-black uppercase tracking-widest text-xs">
                  Mastered
                </SwipeableCards.SwipeRightButton>
              </div>
            </SwipeableCards.Root>
          </div>

          {/* SRS rating bar */}
          <div className="bg-white dark:bg-slate-800 p-4 border-t border-slate-100 dark:border-slate-700 pb-safe">
            <SessionControls onRate={handleRate} />
          </div>
        </>
      ) : (
        <SessionSummary stats={stats} total={total} startedAt={startedAt} onComplete={onComplete} onExit={onExit} />
      )}
    </div>
  );
};

const SessionSummary = ({ stats, total, startedAt, onComplete, onExit }) => (
  <div className="absolute inset-0 z-[60] bg-white/95 dark:bg-slate-900/95 backdrop-blur-md flex items-center justify-center p-6">
    <motion.div
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className="w-full max-w-sm bg-white dark:bg-slate-800 rounded-[2.5rem] shadow-clinical border border-slate-100 dark:border-slate-700 p-8 text-center space-y-5"
    >
      <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto">
        <CheckCircle2 size={32} />
      </div>
      <h3 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight">Session Complete!</h3>
      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{total} cards</p>
      <div className="grid grid-cols-2 gap-3 text-left">
        <StatBox label="Mastered" value={stats.mastered} cls="text-emerald-500" />
        <StatBox label="Need Review" value={stats.needsReview} cls="text-red-500" />
        <StatBox label="Accuracy" value={`${Math.round(stats.accuracySum / Math.max(stats.rated, 1))}%`} cls="text-teal-600" />
        <StatBox label="Time" value={`${Math.max(1, Math.round((Date.now() - startedAt) / 1000))}s`} cls="text-indigo-500" />
      </div>
      <button
        onClick={onComplete}
        className="w-full py-4 bg-teal-600 hover:bg-teal-700 text-white rounded-xl font-black uppercase tracking-widest text-[10px] active:scale-95 transition-all"
      >
        Continue to Quiz →
      </button>
      <button
        onClick={onExit}
        className="w-full py-2 text-slate-400 hover:text-teal-600 font-bold text-xs transition-colors"
      >
        Back to Library
      </button>
    </motion.div>
  </div>
);

const StatBox = ({ label, value, cls }) => (
  <div className="p-3 bg-slate-50 dark:bg-slate-900/50 rounded-xl">
    <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">{label}</p>
    <p className={`text-lg font-black ${cls}`}>{value}</p>
  </div>
);

export default React.memo(FlashcardStudySession);
