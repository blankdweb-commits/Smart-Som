import React, { useState } from 'react';
import { useAppContext } from '../context/AppContext';
import {
  Shield,
  Users,
  TrendingUp,
  Download,
  Filter,
  Search,
  ArrowLeft,
  CreditCard,
  AlertTriangle,
  CheckCircle2,
  FileText,
  ChevronRight,
  Plus,
  Trash2,
  Settings as SettingsIcon,
  X,
  AlertCircle,
  ShieldCheck,
  MoreVertical,
  Clock,
  ArrowRight,
  Zap
} from '../components/Icons';
import { useNavigate } from 'react-router-dom';

const AdminFinance =  () => {
  const {
    transactions,
    userProfile,
    auditLogs = [],
    loadingAuth
  } = useAppContext();

  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('overview');

  if (loadingAuth) return <div className="p-20 text-center font-black animate-pulse">Initializing Financial Core...</div>;

  const stats = {
    todayRevenue: transactions.filter(t => t.status === 'success' && new Date(t.date).toDateString() === new Date().toDateString()).reduce((sum, t) => sum + t.amount, 0),
    pendingVerification: transactions.filter(t => t.status === 'pending').length,
    fundsHeld: transactions.filter(t => t.releaseStatus === 'Held').reduce((sum, t) => sum + t.amount, 0),
    activeDisputes: 0
  };

  const tabs = [
    { id: 'overview', label: 'Overview', icon: <TrendingUp size={16} /> },
    { id: 'ledger', label: 'Transaction Ledger', icon: <FileText size={16} /> },
    { id: 'purposes', label: 'Payment Items', icon: <CreditCard size={16} /> },
    { id: 'plans', label: 'Subscription Plans', icon: <SettingsIcon size={16} />, superOnly: true },
    { id: 'disputes', label: 'Disputes', icon: <AlertTriangle size={16} /> },
  ].filter(tab => !tab.superOnly || userProfile.role === 'super_admin');

  return (
    <div className="space-y-8 pb-32 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
          <div className="flex items-center gap-3 text-medical-600 mb-2">
            <Shield size={24} />
            <span className="text-[10px] font-black uppercase tracking-[0.3em]">Financial Administration</span>
          </div>
          <h1 className="text-4xl font-black text-slate-900 dark:text-white tracking-tight">Admin Terminal</h1>
        </div>
        <button onClick={() => navigate('/dashboard')} className="flex items-center gap-2 px-6 py-3 bg-white dark:bg-slate-800 rounded-2xl font-bold text-sm shadow-soft hover:bg-slate-50 transition-all border border-slate-100 dark:border-slate-700"><ArrowLeft size={18} /> Exit Terminal</button>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <AdminStatCard title="Revenue Today" value={`NGN ${stats.todayRevenue.toLocaleString()}`} icon={<TrendingUp />} color="bg-emerald-50 text-emerald-600" />
        <AdminStatCard title="Pending Verify" value={stats.pendingVerification} icon={<Clock />} color="bg-amber-50 text-amber-600" />
        <AdminStatCard title="Funds Held" value={`NGN ${stats.fundsHeld.toLocaleString()}`} icon={<Shield />} color="bg-indigo-50 text-indigo-600" />
        <AdminStatCard title="Active Disputes" value={stats.activeDisputes} icon={<AlertCircle />} color="bg-red-50 text-red-600" />
      </div>

      <div className="bg-slate-100 dark:bg-slate-800/50 p-1.5 rounded-2xl flex flex-wrap gap-1">
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex items-center gap-2 whitespace-nowrap px-6 py-3 rounded-xl font-bold text-sm transition-all ${activeTab === tab.id ? 'bg-white dark:bg-slate-700 text-medical-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-[2.5rem] p-8 shadow-clinical border border-slate-100 dark:border-slate-700 min-h-[400px]">
        {activeTab === 'overview' && (
           <div className="space-y-8 animate-in fade-in duration-500">
              <div className="flex justify-between items-center">
                 <h3 className="text-xl font-black uppercase tracking-tight">Recent Activity</h3>
                 <button className="text-medical-600 font-bold text-sm hover:underline">View All Logs</button>
              </div>
              <div className="space-y-4">
                 {auditLogs.length > 0 ? auditLogs.map((log, i) => (
                    <div key={i} className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-slate-100 dark:border-slate-800">
                       <div className="flex items-center gap-4">
                          <div className="w-10 h-10 bg-white dark:bg-slate-800 rounded-xl flex items-center justify-center text-slate-400"><Clock size={18} /></div>
                          <div><p className="font-bold text-sm">{log.action}</p><p className="text-[10px] text-slate-400 uppercase tracking-widest">{new Date(log.created_at).toLocaleString()}</p></div>
                       </div>
                       <p className="text-xs font-medium text-slate-500">{log.details}</p>
                    </div>
                 )) : <div className="text-center py-20 text-slate-400 font-medium italic">No recent financial events logged.</div>}
              </div>
           </div>
        )}

        {activeTab !== 'overview' && (
           <div className="flex flex-col items-center justify-center py-20 text-center space-y-6 animate-in zoom-in duration-500">
              <div className="w-20 h-20 bg-slate-50 dark:bg-slate-900 text-slate-300 rounded-[2rem] flex items-center justify-center"><Zap size={40} /></div>
              <div>
                 <h4 className="text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight">Advanced Ledger Restricted</h4>
                 <p className="text-slate-500 max-w-sm mx-auto mt-2">The full {activeTab} terminal is currently in maintenance mode for database optimization.</p>
              </div>
           </div>
        )}
      </div>
    </div>
  );
};

const AdminStatCard = ({ title, value, icon, color }) => (
  <div className="bg-white dark:bg-slate-800 p-6 rounded-[2rem] shadow-clinical border border-slate-100 dark:border-slate-700">
    <div className={`w-10 h-10 ${color} rounded-xl flex items-center justify-center mb-4`}>{React.cloneElement(icon, { size: 20 })}</div>
    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{title}</p>
    <p className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">{value}</p>
  </div>
);

export default React.memo(AdminFinance);
