import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Calendar,
  Clock,
  MapPin,
  Users,
  Plus,
  ChevronRight,
  CheckCircle2,
  Target,
  ArrowLeft
} from '../components/Icons';
import { useNavigate } from 'react-router-dom';

const Institution = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('clinical');

  const clinicalRotations = [
    { unit: 'Internal Medicine', hospital: 'General Hospital', start: '2024-05-01', end: '2024-05-28', status: 'In Progress', supervisor: 'Dr. Nwosu' },
    { unit: 'Pediatrics', hospital: 'Childrens Clinic', start: '2024-06-03', end: '2024-06-30', status: 'Pending', supervisor: 'Matron Ade' },
  ];

  const assignments = [
    { title: 'Community Health Project', due: '2024-05-15', priority: 'High', status: 'Drafting' },
    { title: 'Case Study: Diabetes Management', due: '2024-05-20', priority: 'Medium', status: 'Not Started' },
  ];

  return (
    <div className="max-w-6xl mx-auto pb-20 animate-in fade-in duration-500">
      <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-10">
        <div>
          <h2 className="text-4xl font-black text-slate-900 dark:text-white tracking-tight uppercase">Institutional Hub</h2>
          <p className="text-slate-500 font-bold text-xs uppercase tracking-widest mt-1">Productivity tools for nursing professionals</p>
        </div>
        <button className="px-6 py-3 bg-medical-600 text-white rounded-2xl font-black shadow-lg shadow-medical-600/20 active:scale-95 transition-all flex items-center gap-2">
          <Plus size={20} /> Create Planner
        </button>
      </header>

      <div className="flex p-1 bg-slate-100 dark:bg-slate-800 rounded-2xl w-full sm:w-fit mb-8 shadow-sm">
        {['clinical', 'academic', 'tracker'].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-6 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest transition-all ${activeTab === tab ? 'bg-white dark:bg-slate-700 text-medical-600 shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
          >
            {tab === 'clinical' ? 'Clinical Rotations' : tab === 'academic' ? 'Academic Calendar' : 'Task Tracker'}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {activeTab === 'clinical' && (
          <motion.div
            key="clinical"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="grid grid-cols-1 md:grid-cols-2 gap-6"
          >
            {clinicalRotations.map((rotation, i) => (
              <div key={i} className="bg-white dark:bg-slate-800 p-8 rounded-[2.5rem] shadow-clinical border border-slate-100 dark:border-slate-700 relative overflow-hidden group">
                <div className={`absolute top-0 right-0 p-8 opacity-5 group-hover:scale-110 transition-transform ${rotation.status === 'In Progress' ? 'text-emerald-500' : 'text-slate-400'}`}>
                  <MapPin size={120} />
                </div>
                <div className="relative z-10">
                  <div className="flex justify-between items-start mb-6">
                    <div>
                      <span className={`text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full ${rotation.status === 'In Progress' ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
                        {rotation.status}
                      </span>
                      <h3 className="text-2xl font-black text-slate-900 dark:text-white mt-3">{rotation.unit}</h3>
                      <p className="text-slate-500 font-bold flex items-center gap-2 mt-1">
                        <MapPin size={14} /> {rotation.hospital}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 mt-8">
                    <div className="p-4 bg-slate-50 dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Supervisor</p>
                      <p className="text-sm font-black text-slate-800 dark:text-slate-200">{rotation.supervisor}</p>
                    </div>
                    <div className="p-4 bg-slate-50 dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Duration</p>
                      <p className="text-sm font-black text-slate-800 dark:text-slate-200">4 Weeks</p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Institution;
