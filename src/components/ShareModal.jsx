import React from 'react';
import { X, Copy, Download, Share2, Check } from './Icons';
import { useState } from 'react';

const ShareModal = ({ isOpen, onClose, card }) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleCopyJSON = () => {
    navigator.clipboard.writeText(JSON.stringify(card, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyLink = () => {
    // In a real app, this would be a deep link
    const link = `${window.location.origin}/flashcards?import=${btoa(JSON.stringify(card))}`;
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-md animate-in fade-in duration-300">
      <div className="bg-white dark:bg-slate-800 rounded-t-[2.5rem] sm:rounded-[2.5rem] w-full max-w-md shadow-clinical overflow-hidden animate-in slide-in-from-bottom-full sm:zoom-in-95 duration-500">
        <div className="p-8 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-medical-50/50 dark:bg-medical-900/10">
          <div>
            <h3 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">Clinical Collaboration</h3>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Share High-Yield Topics</p>
          </div>
          <button onClick={onClose} className="p-2 bg-white dark:bg-slate-700 rounded-xl text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-10 space-y-8">
          <div className="flex flex-col items-center justify-center space-y-6">
            <div className="w-32 h-32 bg-medical-50 dark:bg-medical-900/30 rounded-[2rem] flex items-center justify-center border-2 border-dashed border-medical-200 dark:border-medical-800 relative group overflow-hidden">
              <div className="absolute inset-0 bg-medical-500/10 scale-0 group-hover:scale-100 transition-transform duration-500 rounded-full" />
              <Share2 size={56} className="text-medical-600 relative z-10" />
            </div>
            <p className="text-center text-lg font-medium text-slate-600 dark:text-slate-400 px-2 leading-relaxed">
              Export "<span className="text-medical-600 font-bold">{card.topic}</span>" to your clinical peer group for collaborative review.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4">
            <button
              onClick={handleCopyJSON}
              className="flex items-center justify-between w-full p-5 bg-white dark:bg-slate-900 hover:bg-medical-50 dark:hover:bg-medical-900/30 rounded-2xl border-2 border-slate-50 dark:border-slate-800 transition-all group shadow-soft"
            >
              <div className="flex items-center">
                <div className="p-2 bg-slate-50 dark:bg-slate-800 rounded-xl mr-4 text-medical-600">
                  <Copy size={20} />
                </div>
                <span className="font-bold text-slate-800 dark:text-slate-200">Copy Card Schema</span>
              </div>
              {copied ? <Check size={20} className="text-green-500" /> : <ChevronRight size={20} className="text-slate-400 group-hover:translate-x-1 transition-transform" />}
            </button>

            <button
              onClick={handleCopyLink}
              className="flex items-center justify-between w-full p-5 bg-white dark:bg-slate-900 hover:bg-medical-50 dark:hover:bg-medical-900/30 rounded-2xl border-2 border-slate-50 dark:border-slate-800 transition-all group shadow-soft"
            >
              <div className="flex items-center">
                <div className="p-2 bg-slate-50 dark:bg-slate-800 rounded-xl mr-4 text-indigo-600">
                  <Share2 size={20} />
                </div>
                <span className="font-bold text-slate-800 dark:text-slate-200">Copy Secure Link</span>
              </div>
              {copied ? <Check size={20} className="text-green-500" /> : <ChevronRight size={20} className="text-slate-400 group-hover:translate-x-1 transition-transform" />}
            </button>
          </div>

          <p className="text-[10px] text-center text-slate-400 uppercase tracking-[0.2em] font-black">
            Clinical Peer-to-Peer Protocol
          </p>
        </div>
      </div>
    </div>
  );
};

const ChevronRight = ({ size, className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="m9 18 6-6-6-6"/>
  </svg>
);

export default ShareModal;
