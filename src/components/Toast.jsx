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
    <div className={`fixed bottom-8 right-8 ${bgColor} text-white px-6 py-3 rounded-xl shadow-2xl flex items-center z-[100] animate-bounce-in`}>
      <Icon size={20} className="mr-3" />
      <span className="font-bold">{message}</span>
    </div>
  );
};

export default Toast;
