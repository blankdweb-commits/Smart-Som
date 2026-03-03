import React, { useState } from 'react';
import { ChevronDown, X, Check } from 'lucide-react';

const MobileFriendlySelect = ({ label, value, options, onChange, placeholder = "Select an option" }) => {
  const [isOpen, setIsOpen] = useState(false);

  const selectedOption = options.find(opt =>
    typeof opt === 'string' ? opt === value : opt.value === value
  );

  const displayValue = selectedOption
    ? (typeof selectedOption === 'string' ? selectedOption : selectedOption.label)
    : placeholder;

  const handleSelect = (option) => {
    const val = typeof option === 'string' ? option : option.value;
    onChange({ target: { value: val, name: label.toLowerCase() } });
    setIsOpen(false);
  };

  return (
    <div className="w-full">
      {label && <label className="block text-xs font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2 ml-1">{label}</label>}

      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="w-full flex items-center justify-between px-5 py-3 bg-white dark:bg-slate-900 border-2 border-slate-50 dark:border-slate-800 rounded-2xl shadow-soft hover:border-medical-500 focus:border-medical-500 transition-all outline-none group"
      >
        <span className={`font-bold ${value ? "text-slate-900 dark:text-white" : "text-slate-400"}`}>
          {displayValue}
        </span>
        <ChevronDown size={20} className="text-slate-400 group-hover:text-medical-500 transition-colors" />
      </button>

      {/* Mobile Drawer / Modal */}
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/40 backdrop-blur-md animate-in fade-in duration-200">
          <div
            className="w-full max-w-md bg-white dark:bg-slate-800 rounded-t-[2.5rem] sm:rounded-[2.5rem] shadow-clinical overflow-hidden animate-in slide-in-from-bottom-full sm:slide-in-from-bottom-4 duration-300"
          >
            <div className="flex justify-between items-center p-8 border-b border-slate-100 dark:border-slate-700">
              <h4 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight">{label || 'Select Option'}</h4>
              <button
                onClick={() => setIsOpen(false)}
                className="p-2 bg-slate-50 dark:bg-slate-700 rounded-xl text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
              >
                <X size={24} />
              </button>
            </div>

            <div className="max-h-[60vh] overflow-y-auto py-2">
              {options.map((option, idx) => {
                const optValue = typeof option === 'string' ? option : option.value;
                const optLabel = typeof option === 'string' ? option : option.label;
                const isSelected = optValue === value;

                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleSelect(option)}
                    className={`w-full flex items-center justify-between px-6 py-4 text-left hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors ${
                      isSelected ? 'text-medical-600 dark:text-medical-400 font-bold' : 'text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <span>{optLabel}</span>
                    {isSelected && <Check size={18} />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Backdrop click to close */}
          <div className="absolute inset-0 -z-10" onClick={() => setIsOpen(false)} />
        </div>
      )}
    </div>
  );
};

export default MobileFriendlySelect;
