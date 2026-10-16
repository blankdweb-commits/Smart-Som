import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Info, X, ArrowRight } from './Icons';
import { tutorialByKey, readTipDismissed, dismissTip } from '../data/tutorials';

// A small, dismissible first-use pointer. Deliberately NON-BLOCKING: it sits in
// the page's normal flow, never covers a control, and never traps the user. It
// links straight into the matching tutorial.
const TutorialTip = ({ tutorialKey, children }) => {
  const navigate = useNavigate();
  // Read once per mount so a dismiss actually takes effect without a reload.
  const [hidden, setHidden] = React.useState(() => readTipDismissed(tutorialKey));

  if (hidden) return null;
  const tour = tutorialByKey(tutorialKey);
  if (!tour) return null;

  const close = (e) => {
    e.stopPropagation();
    dismissTip(tutorialKey);
    setHidden(true);
  };

  return (
    <div className="mb-4 flex items-start gap-2.5 rounded-2xl border border-apex-500/30 bg-apex-500/[0.07] px-3.5 py-3">
      <Info size={16} className="mt-0.5 shrink-0 text-apex-400" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold text-slate-300 leading-snug">{children}</p>
        <button
          onClick={() => navigate('/tutorials?t=' + tutorialKey)}
          className="mt-1.5 inline-flex items-center gap-1 min-h-[32px] text-[10px] font-black uppercase tracking-widest text-apex-300 hover:text-apex-200 transition"
        >
          Take the {tour.title} tour <ArrowRight size={12} aria-hidden="true" />
        </button>
      </div>
      <button
        onClick={close}
        aria-label="Dismiss tip"
        className="shrink-0 min-h-[32px] min-w-[32px] flex items-center justify-center text-slate-500 hover:text-slate-300 rounded-lg transition"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
};

export default TutorialTip;