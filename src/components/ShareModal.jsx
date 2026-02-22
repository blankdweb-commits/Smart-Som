import React from 'react';
import { X, Copy, Download, Share2, Check } from 'lucide-react';
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
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 rounded-3xl w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in duration-300">
        <div className="p-6 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-medical-50 dark:bg-medical-900/20">
          <div>
            <h3 className="text-xl font-bold text-slate-800 dark:text-white">Share Flashcard</h3>
            <p className="text-sm text-slate-500">Collaborate with fellow students</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/50 dark:hover:bg-slate-700 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-8 space-y-6">
          <div className="flex flex-col items-center justify-center space-y-4">
            <div className="w-32 h-32 bg-slate-100 dark:bg-slate-900 rounded-2xl flex items-center justify-center border-2 border-dashed border-slate-200 dark:border-slate-700">
              <Share2 size={48} className="text-medical-400" />
            </div>
            <p className="text-center text-sm text-slate-600 dark:text-slate-400 px-4">
              Share "{card.topic}" with your study group. They can import it directly into their NursingHub.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3">
            <button
              onClick={handleCopyJSON}
              className="flex items-center justify-between w-full p-4 bg-slate-50 dark:bg-slate-900 hover:bg-medical-50 dark:hover:bg-medical-900/30 rounded-2xl border border-slate-200 dark:border-slate-700 transition-all group"
            >
              <div className="flex items-center">
                <div className="p-2 bg-white dark:bg-slate-800 rounded-lg mr-3 shadow-sm">
                  <Copy size={18} className="text-medical-600" />
                </div>
                <span className="font-semibold text-slate-700 dark:text-slate-200">Copy Card Data</span>
              </div>
              {copied ? <Check size={18} className="text-green-500" /> : <ChevronRight size={18} className="text-slate-400 group-hover:translate-x-1 transition-transform" />}
            </button>

            <button
              onClick={handleCopyLink}
              className="flex items-center justify-between w-full p-4 bg-slate-50 dark:bg-slate-900 hover:bg-medical-50 dark:hover:bg-medical-900/30 rounded-2xl border border-slate-200 dark:border-slate-700 transition-all group"
            >
              <div className="flex items-center">
                <div className="p-2 bg-white dark:bg-slate-800 rounded-lg mr-3 shadow-sm">
                  <Share2 size={18} className="text-indigo-600" />
                </div>
                <span className="font-semibold text-slate-700 dark:text-slate-200">Share Study Link</span>
              </div>
              {copied ? <Check size={18} className="text-green-500" /> : <ChevronRight size={18} className="text-slate-400 group-hover:translate-x-1 transition-transform" />}
            </button>
          </div>

          <p className="text-[10px] text-center text-slate-400 uppercase tracking-widest font-bold">
            Encrypted with Medical Standards
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
