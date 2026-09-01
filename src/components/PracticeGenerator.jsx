import { useNavigate } from 'react-router-dom';
import { ArrowRight } from './Icons';

// Deep-links into the Quiz page with the learner's weakest subject preselected
// so the Setup Flow opens with the subject already chosen — only a Start press
// is needed. The Quiz page handles the ?practiceSubject= query param.
const PracticeGenerator = ({ subject, label = 'Start Practice', tone = 'bg-medical-600 hover:bg-medical-500 shadow-medical-500/20', variant = 'primary' }) => {
  const navigate = useNavigate();

  const handle = () => {
    const qs = new URLSearchParams();
    if (subject) qs.set('practiceSubject', subject);
    navigate(`/quiz${subject ? `?${qs.toString()}` : ''}`);
  };

  if (variant === 'ghost') {
    return (
      <button
        onClick={handle}
        className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-medical-600 dark:text-medical-400 hover:text-medical-500 transition-colors"
      >
        {label} <ArrowRight size={12} />
      </button>
    );
  }

  return (
    <button
      onClick={handle}
      className={`flex items-center justify-center gap-2 px-4 py-2.5 text-white rounded-xl font-black uppercase tracking-widest text-[9px] shadow-lg transition-all active:scale-95 ${tone}`}
    >
      {label} <ArrowRight size={14} />
    </button>
  );
};

export default PracticeGenerator;