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
      {label && <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{label}</label>}

      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="w-full flex items-center justify-between px-4 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-medical-500 transition-all outline-none"
      >
        <span className={value ? "text-slate-900 dark:text-white" : "text-slate-400"}>
          {displayValue}
        </span>
        <ChevronDown size={18} className="text-slate-400" />
      </button>

      {/* Mobile Drawer / Modal */}
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div
            className="w-full max-w-md bg-white dark:bg-slate-800 rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom-full sm:slide-in-from-bottom-4 duration-300"
          >
            <div className="flex justify-between items-center p-4 border-b border-slate-200 dark:border-slate-700">
              <h4 className="font-bold text-slate-800 dark:text-white">{label || 'Select Option'}</h4>
              <button
                onClick={() => setIsOpen(false)}
                className="p-2 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
              >
                <X size={20} />
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
