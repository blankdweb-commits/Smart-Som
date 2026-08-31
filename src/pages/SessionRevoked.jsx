import { useAppContext } from '../context/AppContext';
import { AlertTriangle } from '../components/Icons';
import { ShieldOff, LogIn } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

// Shown when the user's account is signed in on another/newer device. Because
// Apex Scholars enforces single-device access, this device's session has been
// revoked and they must sign back in here.
export default function SessionRevoked() {
  const { signOut } = useAppContext();
  const navigate = useNavigate();

  const handleBack = async () => {
    await signOut();
    navigate('/signin');
  };

  return (
    <div className="min-h-screen bg-[#0f172a] flex items-center justify-center px-6">
      <div className="max-w-md w-full text-center">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-amber-500/15 border border-amber-400/30 flex items-center justify-center mb-5">
          <ShieldOff className="w-8 h-8 text-amber-400" />
        </div>
        <h1 className="text-2xl font-bold text-white mb-2">Signed in elsewhere</h1>
        <p className="text-slate-300 text-sm leading-relaxed mb-6">
          Apex Scholars allows one active session per learner. Your account was
          just signed in on{' '}
          <span className="text-white font-medium">another device</span>, so this
          session has been logged out to keep your progress safe.
        </p>

        <div className="bg-slate-800/60 rounded-xl p-4 mb-6 flex items-start gap-3 text-left border border-slate-700">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-slate-300 leading-relaxed">
            If this wasn't you, sign back in and you'll be asked to confirm your
            password. Your questions, coins and progress are unaffected.
          </p>
        </div>

        <button
          onClick={handleBack}
          className="w-full flex items-center justify-center gap-2 bg-teal-600 hover:bg-teal-500 text-white font-semibold py-3.5 rounded-xl transition-colors"
        >
          <LogIn className="w-5 h-5" />
          Sign in again
        </button>
      </div>
    </div>
  );
}
