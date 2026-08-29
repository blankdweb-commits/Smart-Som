import React, { useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { User, Shield, ArrowRight, CheckCircle2, AlertCircle } from './Icons';
  // eslint-disable-next-line no-unused-vars
import { motion, AnimatePresence } from 'framer-motion';

const StudentVerification = ({ onVerified }) => {
  const { userProfile, updateProfile } = useAppContext();
  const [formData, setFormData] = useState({
    fullName: userProfile.fullName || '',
    matricNumber: userProfile.matricNumber || '',
    department: userProfile.department || '',
    level: userProfile.level || '',
    session: userProfile.session || '2024/2025',
    email: userProfile.email || '',
    phone: userProfile.phone || ''
  });
  const [step, setStep] = useState(1);
  const [errors, setErrors] = useState({});

  const validate = () => {
    const newErrors = {};
    if (!formData.fullName) newErrors.fullName = 'Full Name is required';
    if (!formData.matricNumber) newErrors.matricNumber = 'Matric Number is required';
    if (!formData.department) newErrors.department = 'Department is required';
    if (!formData.level) newErrors.level = 'Academic Level is required';
    if (!formData.email) newErrors.email = 'Email is required';
    else if (!/\S+@\S+\.\S+/.test(formData.email)) newErrors.email = 'Invalid email address';

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (validate()) {
      updateProfile(formData);
      if (onVerified) onVerified();
    }
  };

  const departments = [
    'Nursing Science',
    'Midwifery',
    'Public Health Nursing',
    'Mental Health Nursing',
    'Perioperative Nursing'
  ];

  const levels = ['Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5'];

  return (
    <div className="bg-white dark:bg-slate-800 rounded-[2.5rem] p-8 shadow-clinical border border-slate-100 dark:border-slate-700 max-w-2xl mx-auto overflow-hidden relative">
      <div className="absolute top-0 left-0 w-full h-2 bg-slate-100 dark:bg-slate-700">
        <motion.div
          className="h-full bg-medical-500"
          initial={{ width: '0%' }}
          animate={{ width: `${(step / 2) * 100}%` }}
        />
      </div>

      <div className="flex flex-col items-center text-center mb-10">
        <div className="w-20 h-20 bg-medical-50 dark:bg-medical-900/30 text-medical-600 rounded-3xl flex items-center justify-center mb-6">
          <Shield size={40} />
        </div>
        <h2 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">Student Verification</h2>
        <p className="text-slate-500 dark:text-slate-400 font-medium mt-2">Verify your academic records before proceeding to payments.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <AnimatePresence mode="wait">
          {step === 1 ? (
            <motion.div
              key="step1"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-4"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-2">Full Name</label>
                  <input
                    type="text"
                    value={formData.fullName}
                    onChange={e => setFormData({...formData, fullName: e.target.value})}
                    placeholder="Enter full legal name"
                    className={`w-full px-5 py-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border ${errors.fullName ? 'border-red-500' : 'border-slate-100 dark:border-slate-800'} focus:ring-2 focus:ring-medical-500 outline-none transition-all font-bold`}
                  />
                  {errors.fullName && <p className="text-[10px] text-red-500 font-bold ml-2 uppercase">{errors.fullName}</p>}
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-2">Matric Number</label>
                  <input
                    type="text"
                    value={formData.matricNumber}
                    onChange={e => setFormData({...formData, matricNumber: e.target.value})}
                    placeholder="E.g. NS/2021/001"
                    className={`w-full px-5 py-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border ${errors.matricNumber ? 'border-red-500' : 'border-slate-100 dark:border-slate-800'} focus:ring-2 focus:ring-medical-500 outline-none transition-all font-bold uppercase`}
                  />
                  {errors.matricNumber && <p className="text-[10px] text-red-500 font-bold ml-2 uppercase">{errors.matricNumber}</p>}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-2">Department</label>
                  <select
                    value={formData.department}
                    onChange={e => setFormData({...formData, department: e.target.value})}
                    className={`w-full px-5 py-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border ${errors.department ? 'border-red-500' : 'border-slate-100 dark:border-slate-800'} focus:ring-2 focus:ring-medical-500 outline-none transition-all font-bold`}
                  >
                    <option value="">Select Department</option>
                    {departments.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                  {errors.department && <p className="text-[10px] text-red-500 font-bold ml-2 uppercase">{errors.department}</p>}
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-2">Academic Level</label>
                  <select
                    value={formData.level}
                    onChange={e => setFormData({...formData, level: e.target.value})}
                    className={`w-full px-5 py-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border ${errors.level ? 'border-red-500' : 'border-slate-100 dark:border-slate-800'} focus:ring-2 focus:ring-medical-500 outline-none transition-all font-bold`}
                  >
                    <option value="">Select Level</option>
                    {levels.map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                  {errors.level && <p className="text-[10px] text-red-500 font-bold ml-2 uppercase">{errors.level}</p>}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setStep(2)}
                className="w-full py-5 bg-slate-900 dark:bg-slate-700 text-white rounded-2xl font-black uppercase tracking-widest text-xs flex items-center justify-center gap-2 hover:bg-slate-800 transition-all active:scale-95"
              >
                Next Step <ArrowRight size={16} />
              </button>
            </motion.div>
          ) : (
            <motion.div
              key="step2"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-2">Email Address</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={e => setFormData({...formData, email: e.target.value})}
                    placeholder="student@university.edu"
                    className={`w-full px-5 py-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border ${errors.email ? 'border-red-500' : 'border-slate-100 dark:border-slate-800'} focus:ring-2 focus:ring-medical-500 outline-none transition-all font-bold`}
                  />
                  {errors.email && <p className="text-[10px] text-red-500 font-bold ml-2 uppercase">{errors.email}</p>}
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-2">Phone Number</label>
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={e => setFormData({...formData, phone: e.target.value})}
                    placeholder="+234 ..."
                    className="w-full px-5 py-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-slate-100 dark:border-slate-800 focus:ring-2 focus:ring-medical-500 outline-none transition-all font-bold"
                  />
                </div>
              </div>

              <div className="p-5 bg-blue-50 dark:bg-blue-900/20 rounded-2xl border border-blue-100 dark:border-blue-800/50 flex gap-4">
                <AlertCircle className="text-blue-500 shrink-0" size={24} />
                <p className="text-xs text-blue-700 dark:text-blue-300 font-medium leading-relaxed">
                  Please ensure your details match your official school records. Any discrepancies might lead to payment verification delays.
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="flex-1 py-5 bg-slate-100 dark:bg-slate-900/50 text-slate-600 dark:text-slate-400 rounded-2xl font-black uppercase tracking-widest text-xs transition-all active:scale-95"
                >
                  Back
                </button>
                <button
                  type="submit"
                  className="flex-[2] py-5 bg-medical-600 text-white rounded-2xl font-black uppercase tracking-widest text-xs flex items-center justify-center gap-2 shadow-xl shadow-medical-600/20 hover:bg-medical-700 transition-all active:scale-95"
                >
                  Confirm & Verify <CheckCircle2 size={16} />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </form>
    </div>
  );
};

export default StudentVerification;
