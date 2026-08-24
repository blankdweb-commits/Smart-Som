import React, { useState, useEffect, useRef } from 'react';
import { Search, Book, Check } from './Icons';
import { motion, AnimatePresence } from 'framer-motion';

const AutocompleteInput = ({
  value,
  onChange,
  suggestions = [],
  placeholder = "Start typing...",
  label = "",
  icon = <Book size={18} />,
  className = "",
  onEnter = null
}) => {
  const [inputValue, setInputValue] = useState(value);
  const [filteredSuggestions, setFilteredSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const wrapperRef = useRef(null);

  useEffect(() => {
    setInputValue(value);
  }, [value]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleInputChange = (e) => {
    const val = e.target.value;
    setInputValue(val);
    onChange(val);

    if (val.length > 0) {
      const filtered = suggestions
        .filter(s => s.toLowerCase().includes(val.toLowerCase()))
        .slice(0, 8);
      setFilteredSuggestions(filtered);
      setShowSuggestions(true);
      setActiveIndex(-1);
    } else {
      setShowSuggestions(false);
    }
  };

  const handleSuggestionClick = (suggestion) => {
    setInputValue(suggestion);
    onChange(suggestion);
    setShowSuggestions(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(prev => (prev < filteredSuggestions.length - 1 ? prev + 1 : prev));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(prev => (prev > 0 ? prev - 1 : prev));
    } else if (e.key === 'Enter') {
      // Prevent implicit <form> submission from inside autocompletes.
      e.preventDefault();
      if (activeIndex >= 0 && filteredSuggestions[activeIndex]) {
        handleSuggestionClick(filteredSuggestions[activeIndex]);
      } else if (onEnter) {
        onEnter(inputValue);
      }
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  };

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      {label && <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">{label}</label>}
      <div className="relative group">
        <div className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-medical-600 transition-colors">
          {icon}
        </div>
        <input
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => inputValue.length > 0 && setShowSuggestions(true)}
          placeholder={placeholder}
          className="w-full pl-14 pr-6 py-4 rounded-2xl bg-slate-50 dark:bg-slate-900 border-2 border-transparent focus:border-medical-500 focus:bg-white dark:focus:bg-slate-800 outline-none transition-all font-bold dark:text-white"
        />
      </div>

      <AnimatePresence>
        {showSuggestions && filteredSuggestions.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="absolute z-[110] left-0 right-0 mt-2 p-2 bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-100 dark:border-slate-700 max-h-64 overflow-y-auto custom-scrollbar"
          >
            {filteredSuggestions.map((suggestion, index) => {
              const matchIndex = suggestion.toLowerCase().indexOf(inputValue.toLowerCase());
              const beforeMatch = suggestion.slice(0, matchIndex);
              const match = suggestion.slice(matchIndex, matchIndex + inputValue.length);
              const afterMatch = suggestion.slice(matchIndex + inputValue.length);

              return (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => handleSuggestionClick(suggestion)}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={`w-full text-left px-4 py-3 rounded-xl flex items-center justify-between transition-all ${index === activeIndex ? 'bg-medical-50 dark:bg-medical-900/30 text-medical-600' : 'text-slate-600 dark:text-slate-300'}`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-900 flex items-center justify-center text-slate-400">
                      <Book size={14} />
                    </div>
                    <span className="font-bold text-sm">
                      {beforeMatch}
                      <span className="text-medical-600 underline decoration-2 underline-offset-4">{match}</span>
                      {afterMatch}
                    </span>
                  </div>
                  {index === activeIndex && <Check size={16} className="text-medical-600" />}
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AutocompleteInput;
