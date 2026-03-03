import React, { useEffect } from 'react';
import { CheckCircle, XCircle, Info } from 'lucide-react';

const Toast = ({ message, type = 'info', onClose }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const bgColor = type === 'success' ? 'bg-green-500' : type === 'error' ? 'bg-red-500' : 'bg-blue-500';
  const Icon = type === 'success' ? CheckCircle : type === 'error' ? XCircle : Info;

  return (
    <div className={`fixed bottom-24 left-4 right-4 sm:bottom-12 sm:left-auto sm:right-12 ${bgColor} text-white px-6 py-4 rounded-[1.5rem] shadow-clinical flex items-center justify-between z-[100] animate-bounce-in border border-white/20`}>
      <div className="flex items-center">
        <div className="p-2 bg-white/20 rounded-xl mr-4">
          <Icon size={22} className="text-white" />
        </div>
        <span className="font-black text-sm uppercase tracking-widest">{message}</span>
      </div>
      <button onClick={onClose} className="ml-4 p-1 hover:bg-white/10 rounded-lg transition-colors">
        <XCircle size={18} />
      </button>
    </div>
  );
};

export default Toast;
