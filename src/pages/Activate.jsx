import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Key, ShieldCheck, Loader2, ArrowRight } from 'lucide-react';
import { useAppContext } from '../context/AppContext';

export default function Activate() {
  const [key, setKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const { userProfile, activateWithKey } = useAppContext();
  const navigate = useNavigate();

  const handleActivate = async (e) => {
    e.preventDefault();
    if (key.length < 10) return;

    setLoading(true);
    setError(null);

    try {
      const success = await activateWithKey(key);
      if (success) {
        navigate('/');
      } else {
        setError('Invalid or expired product key. Please check and try again.');
      }
    } catch (err) {
      setError('An error occurred during activation. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4">
      <div className="absolute top-0 left-0 w-full h-full opacity-30 pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-medical-500 rounded-full blur-[160px]"></div>
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md z-10"
      >
        <div className="bg-slate-900/80 backdrop-blur-2xl border border-white/10 rounded-[2.5rem] p-10 shadow-2xl">
          <div className="text-center mb-10">
            <div className="w-20 h-20 bg-medical-500/10 rounded-3xl mx-auto mb-6 flex items-center justify-center text-medical-500">
              <Key className="w-10 h-10" />
            </div>
            <h1 className="text-3xl font-bold text-white mb-3">One Step Away</h1>
            <p className="text-slate-400">
              You’re one step away from full access to your personalized nursing curriculum and AI study tools.
            </p>
          </div>

          <form onSubmit={handleActivate} className="space-y-6">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-300 ml-1">Product Key</label>
              <div className="relative">
                <input
                  type="text"
                  placeholder="AX7P-9LM2-QK4T-..."
                  required
                  autoFocus
                  className="w-full bg-slate-800/50 border border-white/10 rounded-2xl py-5 px-6 text-xl font-mono text-center tracking-[0.2em] text-white focus:outline-none focus:border-medical-500 transition-all uppercase"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                />
              </div>
            </div>

            {error && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-red-400 text-sm bg-red-400/10 p-4 rounded-xl border border-red-400/20 text-center"
              >
                {error}
              </motion.p>
            )}

            <button
              type="submit"
              disabled={loading || key.length < 5}
              className="w-full bg-white text-slate-950 font-bold py-5 rounded-2xl shadow-xl hover:bg-medical-50 transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-3"
            >
              {loading ? (
                <Loader2 className="w-6 h-6 animate-spin" />
              ) : (
                <>
                  Activate Now
                  <ArrowRight className="w-5 h-5" />
                </>
              )}
            </button>
          </form>

          <div className="mt-10 pt-10 border-t border-white/5 text-center">
            <p className="text-slate-500 text-sm mb-4">Don't have a product key yet?</p>
            <button
              onClick={() => navigate('/payments')}
              className="w-full py-4 bg-apex-600/10 text-apex-400 border border-apex-600/20 rounded-2xl font-black uppercase tracking-widest text-[10px] hover:bg-apex-600/20 transition-all"
            >
              Get 7-Day Access – ₦1999.9
            </button>
          </div>

          <div className="mt-8 flex items-center justify-center gap-2 text-slate-600 text-xs uppercase tracking-widest font-bold">
            <ShieldCheck className="w-4 h-4" />
            Verified License
          </div>
        </div>
      </motion.div>
    </div>
  );
}
