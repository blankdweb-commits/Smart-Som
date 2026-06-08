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
  Settings,
  X,
  AlertCircle,
  ShieldCheck,
  MoreVertical,
  Clock,
  ArrowRight
} from '../components/Icons';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { generateReceipt } from '../components/ReceiptSystem';
import QuestionBankManager from '../components/QuestionBankManager';

const AdminFinance = () => {
  const {
    transactions,
    feeDetails,
    userProfile,
    paymentPurposes,
    subscriptionPlans,
    addPaymentPurpose,
    updatePaymentPurpose,
    deletePaymentPurpose,
    updateSubscriptionPlan,
    addSubscriptionPlan,
    deleteSubscriptionPlan,
    updateTransaction,
    refundTransaction,
    auditLogs = [],
    addAuditLog = () => {},
    loadingAuth
  } = useAppContext();

  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('overview'); // overview, ledger, purposes, disputes, plans
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [editingPurpose, setEditingPurpose] = useState(null);
  const [editingPlan, setEditingPlan] = useState(null);
  const [selectedTxn, setSelectedTxn] = useState(null);
  const DEV_MODE = import.meta.env.VITE_DASHBOARD_DEV_MODE === 'true' || import.meta.env.VITE_DEV_DASHBOARD_MODE === 'true';

  if (loadingAuth) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-12 h-12 border-4 border-medical-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  const initialPurposeState = {
    title: '',
    description: '',
    amount: '',
    currency: 'NGN',
    targetDept: 'All',
    targetLevel: 'All',
    targetProgram: 'All',
    targetMatric: '', // For individual assignment
    session: '2024/2025',
    dueDate: '',
    latePenalty: 0,
    installmentEnabled: false,
    active: true
  };

  const [newPurpose, setNewPurpose] = useState(initialPurposeState);

  // Calculate Granular Stats
  const stats = {
    todayRevenue: transactions
      .filter(t => new Date(t.created_at).toDateString() === new Date().toDateString() && t.status === 'success')
      .reduce((acc, t) => acc + Number(t.amount), 0),
    pendingVerification: transactions.filter(t => t.status === 'pending').length,
    fundsHeld: transactions
      .filter(t => t.status === 'success')
      .reduce((acc, t) => acc + Number(t.amount), 0),
    totalRevenue: transactions
      .filter(t => t.status === 'success')
      .reduce((acc, t) => acc + Number(t.amount), 0),
    activeDisputes: transactions.filter(t => t.disputeStatus && t.disputeStatus !== 'None' && t.disputeStatus !== 'Resolved').length
  };

  const handleReleaseFunds = (txn) => {
    if (window.confirm(`Release ${txn.currency} ${txn.amount.toLocaleString()} to institutional ledger? This action will be logged.`)) {
      updateTransaction(txn.id, {
        releaseStatus: 'Released',
        releaseDate: new Date().toISOString(),
        releasedBy: userProfile.fullName
      });
      addAuditLog('Funds Release', `Released ${txn.amount} for ${txn.id} (${txn.type})`);
      setSelectedTxn(null);
    }
  };

  const handleHoldFunds = (txn) => {
    updateTransaction(txn.id, { releaseStatus: 'Held' });
    addAuditLog('Funds Hold', `Placed hold on ${txn.id} (${txn.type})`);
    setSelectedTxn(null);
  };

  const handleVerifyPayment = (txn) => {
    updateTransaction(txn.id, { verified: true, status: 'Success' });
    addAuditLog('Payment Verification', `Verified transaction ${txn.id}`);
  };

  const handleEditPurpose = (p) => {
    setEditingPurpose(p);
    setNewPurpose(p);
    setShowAddModal(true);
  };

  const handleRefund = (txn) => {
    if (window.confirm(`Initiate full refund of ${txn.currency} ${txn.amount.toLocaleString()}? This action is irreversible.`)) {
      refundTransaction(txn.id);
      addAuditLog('Refund', `Refunded ${txn.amount} for ${txn.id}`);
      setSelectedTxn(null);
    }
  };

  const handleDisputeAction = (txn, status) => {
    updateTransaction(txn.id, { disputeStatus: status });
    addAuditLog('Dispute Update', `Set dispute status of ${txn.id} to ${status}`);
  };

  if (!userProfile.isAdmin && !DEV_MODE) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-center p-8 space-y-6">
        <div className="w-24 h-24 bg-red-50 text-red-500 rounded-full flex items-center justify-center">
          <Shield size={48} />
        </div>
        <div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tight">Access Denied</h2>
          <p className="text-slate-500 max-w-md mx-auto mt-2">You do not have the required administrative permissions to view institutional financial data.</p>
        </div>
        <button onClick={() => navigate('/')} className="px-8 py-3 bg-slate-900 text-white rounded-2xl font-black uppercase tracking-widest text-xs active:scale-95 transition-all">
          Return to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="pb-32 space-y-8 animate-in fade-in duration-700 max-w-[1600px] mx-auto">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/')} className="p-3 bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 hover:text-medical-600 transition-all">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h2 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
              <ShieldCheck className="text-medical-600" /> Apex Command Center
            </h2>
            <p className="text-slate-500 dark:text-slate-400 font-medium text-sm">Institutional Intelligence & Question Management.</p>
          </div>
        </div>
        <div className="flex gap-3 w-full md:w-auto">
           <button className="flex-1 md:flex-none px-6 py-3 bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-slate-50 transition-all flex items-center justify-center gap-2">
            <FileText size={18} /> Audit Logs
          </button>
          <button className="flex-1 md:flex-none px-6 py-3 bg-medical-600 text-white rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-medical-600/20 hover:bg-medical-700 transition-all flex items-center justify-center gap-2">
            <Download size={18} /> Financial Report
          </button>
        </div>
      </header>

      <div className="flex p-1 bg-slate-100 dark:bg-slate-800 rounded-2xl w-full xl:w-fit overflow-x-auto no-scrollbar">
        {[
          { id: 'overview', label: 'Overview', icon: <TrendingUp size={16} /> },
          { id: 'ledger', label: 'Student Ledger', icon: <Users size={16} /> },
          { id: 'purposes', label: 'Payment Items', icon: <Plus size={16} /> },
          { id: 'disputes', label: 'Dispute Center', icon: <AlertCircle size={16} /> },
          { id: 'questions', label: 'Question Bank', icon: <FileText size={16} /> },
          { id: 'plans', label: 'Subscription Plans', icon: <Settings size={16} />, superOnly: true },
        ].filter(tab => !tab.superOnly || userProfile.role === 'super_admin').map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 whitespace-nowrap px-6 py-3 rounded-xl font-bold text-sm transition-all ${activeTab === tab.id ? 'bg-white dark:bg-slate-700 text-medical-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {activeTab === 'overview' && (
          <motion.div
            key="overview"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-8"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              <AdminStatCard title="Active Learners" value={`NGN ${stats.todayRevenue.toLocaleString()}`} icon={<TrendingUp />} color="bg-emerald-50 text-emerald-600" />
              <AdminStatCard title="Pending Verify" value={stats.pendingVerification} icon={<Clock />} color="bg-amber-50 text-amber-600" />
              <AdminStatCard title="Funds Held" value={`NGN ${stats.fundsHeld.toLocaleString()}`} icon={<Shield />} color="bg-indigo-50 text-indigo-600" />
              <AdminStatCard title="Active Disputes" value={stats.activeDisputes} icon={<AlertCircle />} color="bg-red-50 text-red-600" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2 bg-white dark:bg-slate-800 p-8 rounded-[2.5rem] shadow-clinical border border-slate-100 dark:border-slate-700">
                <div className="flex justify-between items-center mb-8">
                  <h3 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight">Recent Activity</h3>
                  <button onClick={() => setActiveTab('ledger')} className="text-xs font-black text-medical-600 uppercase tracking-widest flex items-center gap-1">View All <ChevronRight size={14} /></button>
                </div>
                <div className="space-y-4">
                  {transactions.slice(0, 5).map(txn => (
                    <div key={txn.id} className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-900/40 rounded-2xl hover:bg-white dark:hover:bg-slate-800 border border-transparent hover:border-slate-100 transition-all group">
                       <div className="flex items-center gap-4">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${txn.status === 'Success' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                            <CreditCard size={18} />
                          </div>
                          <div>
                            <p className="text-sm font-black text-slate-900 dark:text-white">{txn.type}</p>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{new Date(txn.date).toLocaleDateString()} • {txn.id}</p>
                          </div>
                       </div>
                       <div className="text-right">
                          <p className="text-sm font-black text-slate-900 dark:text-white">NGN {txn.amount.toLocaleString()}</p>
                          <span className={`text-[9px] font-black uppercase tracking-widest ${txn.releaseStatus === 'Released' ? 'text-emerald-500' : 'text-amber-500'}`}>
                            {txn.releaseStatus}
                          </span>
                       </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-slate-900 rounded-[2.5rem] p-8 text-white relative overflow-hidden">
                <div className="absolute top-0 right-0 p-8 opacity-10">
                  <Shield size={120} />
                </div>
                <div className="relative z-10 space-y-6">
                  <h3 className="text-xl font-black uppercase tracking-tight">Security Audit</h3>
                  <div className="space-y-4">
                    {auditLogs.slice(0, 3).map(log => (
                      <div key={log.id} className="pb-4 border-b border-white/10 last:border-0">
                        <p className="text-xs font-black text-medical-400 uppercase tracking-widest mb-1">{log.action}</p>
                        <p className="text-[10px] opacity-70 leading-relaxed line-clamp-2">{log.details}</p>
                        <p className="text-[9px] opacity-40 mt-2">{new Date(log.timestamp).toLocaleString()}</p>
                      </div>
                    ))}
                  </div>
                  <button className="w-full py-4 bg-white/10 hover:bg-white/20 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all">
                    Open Full Audit Trail
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === 'ledger' && (
          <motion.div
            key="ledger"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="space-y-6"
          >
            <div className="bg-white dark:bg-slate-800 rounded-[2.5rem] p-8 shadow-clinical border border-slate-100 dark:border-slate-700">
               <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
                  <h3 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight">Transaction Ledger</h3>
                  <div className="flex gap-3 w-full md:w-auto">
                    <div className="relative flex-1 md:w-64">
                      <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        placeholder="Search student or ref..."
                        className="w-full pl-12 pr-4 py-3 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-100 dark:border-slate-800 text-sm font-bold outline-none focus:ring-2 focus:ring-medical-500"
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                      />
                    </div>
                    <button className="p-3 bg-slate-50 dark:bg-slate-900 rounded-xl text-slate-400 hover:text-medical-600 transition-all border border-slate-100 dark:border-slate-800">
                      <Filter size={20} />
                    </button>
                  </div>
               </div>

               <div>
                  {/* Desktop Table View */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-left border-separate border-spacing-y-3">
                      <thead>
                        <tr className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-4">
                          <th className="pb-4 pl-4">Transaction Details</th>
                          <th className="pb-4">Amount</th>
                          <th className="pb-4">Status</th>
                          <th className="pb-4">Release</th>
                          <th className="pb-4"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {transactions.filter(t =>
                          t.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          t.type.toLowerCase().includes(searchTerm.toLowerCase())
                        ).map(txn => (
                          <tr key={txn.id} className="bg-slate-50 dark:bg-slate-900/40 hover:bg-white dark:hover:bg-slate-800 transition-all rounded-2xl group shadow-sm">
                            <td className="py-4 pl-4 rounded-l-2xl">
                               <div className="flex items-center gap-4">
                                  <div className="w-10 h-10 bg-white dark:bg-slate-800 rounded-xl flex items-center justify-center font-black text-medical-600 shadow-sm border border-slate-100 dark:border-slate-700">
                                    {txn.receiptNo?.slice(-2)}
                                  </div>
                                  <div>
                                    <p className="text-sm font-black text-slate-900 dark:text-white">{txn.type}</p>
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{txn.receiptNo} • {new Date(txn.date).toLocaleDateString()}</p>
                                  </div>
                               </div>
                            </td>
                            <td className="py-4 font-black text-slate-900 dark:text-white">NGN {txn.amount.toLocaleString()}</td>
                            <td className="py-4">
                              <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${
                                txn.status === 'Success' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                              }`}>
                                {txn.status}
                              </span>
                            </td>
                            <td className="py-4">
                               <div className="flex items-center gap-2">
                                  <div className={`w-2 h-2 rounded-full ${txn.releaseStatus === 'Released' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                                  <span className="text-[10px] font-bold text-slate-500 uppercase">{txn.releaseStatus}</span>
                               </div>
                            </td>
                            <td className="py-4 pr-4 rounded-r-2xl text-right">
                               <div className="flex justify-end gap-2">
                                  {!txn.verified && (
                                    <button
                                      onClick={() => handleVerifyPayment(txn)}
                                      className="p-2 text-amber-500 hover:bg-amber-50 rounded-lg transition-all"
                                      title="Verify Payment"
                                    >
                                      <ShieldCheck size={18} />
                                    </button>
                                  )}
                                  <button
                                    onClick={() => setSelectedTxn(txn)}
                                    className="p-2 text-slate-400 hover:text-medical-600 transition-all"
                                  >
                                    <MoreVertical size={18} />
                                  </button>
                               </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile Card View */}
                  <div className="md:hidden space-y-4">
                    {transactions.filter(t =>
                      t.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
                      t.type.toLowerCase().includes(searchTerm.toLowerCase())
                    ).map(txn => (
                      <div key={txn.id} className="bg-slate-50 dark:bg-slate-900/40 p-5 rounded-2xl space-y-4 border border-slate-100 dark:border-slate-800 shadow-sm relative overflow-hidden">
                        <div className="flex justify-between items-start">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-white dark:bg-slate-800 rounded-xl flex items-center justify-center font-black text-medical-600 border border-slate-100 dark:border-slate-700">
                              {txn.receiptNo?.slice(-2)}
                            </div>
                            <div>
                              <p className="text-sm font-black text-slate-900 dark:text-white">{txn.type}</p>
                              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-[0.1em]">{new Date(txn.date).toLocaleDateString()}</p>
                            </div>
                          </div>
                          <button
                            onClick={() => setSelectedTxn(txn)}
                            className="p-2 text-slate-400 hover:text-medical-600"
                          >
                            <MoreVertical size={18} />
                          </button>
                        </div>

                        <div className="flex justify-between items-center pt-2">
                          <div>
                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Amount</p>
                            <p className="text-base font-black text-slate-900 dark:text-white">NGN {txn.amount.toLocaleString()}</p>
                          </div>
                          <div className="text-right">
                             <span className={`px-2 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest ${
                                txn.status === 'Success' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                             }`}>
                                {txn.status}
                             </span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-3 border-t border-slate-200/50 dark:border-slate-700/50">
                           <div className="flex items-center gap-2">
                              <div className={`w-2 h-2 rounded-full ${txn.releaseStatus === 'Released' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                              <span className="text-[9px] font-bold text-slate-500 uppercase">{txn.releaseStatus}</span>
                           </div>
                           <p className="text-[8px] font-bold text-slate-400">{txn.id}</p>
                        </div>
                      </div>
                    ))}
                  </div>
               </div>
            </div>
          </motion.div>
        )}

        {activeTab === 'purposes' && (
          <motion.div
            key="purposes"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-6"
          >
            <div className="flex justify-between items-center">
              <h3 className="text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight">Institutional Charges</h3>
              <button
                onClick={() => setShowAddModal(true)}
                className="px-6 py-3 bg-medical-600 text-white rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-medical-600/20 hover:bg-medical-700 transition-all flex items-center gap-2"
              >
                <Plus size={18} /> New Payment Item
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {paymentPurposes.map(p => (
                <div key={p.id} className="bg-white dark:bg-slate-800 p-6 rounded-[2rem] shadow-clinical border border-slate-100 dark:border-slate-700 space-y-4 relative group">
                  <div className="flex justify-between items-start">
                    <div className="p-3 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 rounded-2xl">
                      <CreditCard size={24} />
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleEditPurpose(p)}
                        className="p-2 bg-slate-50 text-slate-400 hover:text-medical-600 rounded-xl transition-all"
                      >
                        <Settings size={18} />
                      </button>
                      <button
                        onClick={() => updatePaymentPurpose(p.id, { active: !p.active })}
                        className={`p-2 rounded-xl transition-all ${p.active ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-50 text-slate-400'}`}
                        title={p.active ? 'Hide Charge' : 'Activate Charge'}
                      >
                        <CheckCircle2 size={18} />
                      </button>
                      <button
                        onClick={() => {
                          if(window.confirm('Delete this charge? Unpaid charges will disappear for students.')) {
                            deletePaymentPurpose(p.id);
                            addAuditLog('Item Deletion', `Deleted charge: ${p.title}`);
                          }
                        }}
                        className="p-2 bg-red-50 text-red-600 rounded-xl opacity-0 group-hover:opacity-100 transition-all"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>
                  <div>
                    <h4 className="font-black text-slate-900 dark:text-white text-lg">{p.title}</h4>
                    <p className="text-xs text-slate-500 font-medium line-clamp-2">{p.description}</p>
                  </div>
                  <div className="pt-4 border-t border-slate-100 dark:border-slate-700 flex justify-between items-end">
                    <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Target Scope</p>
                      <p className="text-xs font-bold text-slate-700 dark:text-slate-300">{p.targetLevel} • {p.targetDept}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xl font-black text-medical-600">{p.currency} {p.amount.toLocaleString()}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {activeTab === 'plans' && (
          <motion.div
            key="plans"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-6"
          >
            <div className="flex justify-between items-center">
              <h3 className="text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight">Subscription Plans</h3>
              <button
                onClick={() => {
                  setEditingPlan(null);
                  setShowPlanModal(true);
                }}
                className="px-6 py-3 bg-apex-600 text-white rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-apex-600/20 hover:bg-apex-700 transition-all flex items-center gap-2"
              >
                <Plus size={18} /> New Plan
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {subscriptionPlans.map(plan => (
                <div key={plan.id} className="bg-white dark:bg-slate-800 p-8 rounded-[2.5rem] border border-slate-100 dark:border-slate-700 shadow-clinical space-y-6 relative group">
                  <div className="flex justify-between items-center">
                    <div className="w-12 h-12 bg-apex-50 dark:bg-apex-900/30 text-apex-600 rounded-2xl flex items-center justify-center">
                       <Settings size={24} />
                    </div>
                    <div className="flex gap-2">
                       <button
                         onClick={() => {
                           setEditingPlan(plan);
                           setShowPlanModal(true);
                         }}
                         className="p-2 bg-slate-50 text-slate-400 hover:text-apex-600 rounded-xl transition-all"
                       >
                         <Settings size={18} />
                       </button>
                       <button
                         onClick={() => {
                            if (window.confirm('Delete this plan?')) deleteSubscriptionPlan(plan.id);
                         }}
                         className="p-2 bg-red-50 text-red-600 rounded-xl opacity-0 group-hover:opacity-100 transition-all"
                       >
                         <Trash2 size={18} />
                       </button>
                    </div>
                  </div>
                  <div>
                    <h4 className="text-xl font-black text-slate-900 dark:text-white">{plan.name}</h4>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">{plan.duration_days} Days Access</p>
                  </div>
                  <div className="pt-6 border-t border-slate-50 dark:border-slate-700 flex justify-between items-center">
                     <p className="text-2xl font-black text-apex-600">NGN {plan.price.toLocaleString()}</p>
                     <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${plan.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                        {plan.is_active ? 'Active' : 'Inactive'}
                     </span>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {activeTab === 'questions' && (
          <motion.div
            key="questions"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <QuestionBankManager />
          </motion.div>
        )}

        {activeTab === 'disputes' && (
          <motion.div
            key="disputes"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-6"
          >
            {transactions.filter(t => t.disputeStatus !== 'None').length > 0 ? (
              <div className="grid grid-cols-1 gap-4">
                {transactions.filter(t => t.disputeStatus !== 'None').map(txn => (
                  <div key={txn.id} className="bg-white dark:bg-slate-800 p-6 rounded-3xl border-2 border-red-100 dark:border-red-900/30 flex justify-between items-center">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center">
                        <AlertCircle size={24} />
                      </div>
                      <div>
                        <p className="font-black text-slate-900 dark:text-white">{txn.type} Dispute</p>
                        <p className="text-xs text-slate-500">Transaction Ref: {txn.id} • Status: <span className="font-bold text-red-500 uppercase">{txn.disputeStatus}</span></p>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <button
                        onClick={() => handleDisputeAction(txn, 'Resolved')}
                        className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all"
                      >
                        Resolve
                      </button>
                      <button
                        onClick={() => setSelectedTxn(txn)}
                        className="px-4 py-2 bg-slate-100 text-slate-600 rounded-xl text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all"
                      >
                        Details
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-white dark:bg-slate-800 rounded-[2.5rem] p-12 shadow-clinical border border-slate-100 dark:border-slate-700 text-center space-y-4">
                <div className="w-20 h-20 bg-slate-50 dark:bg-slate-900 text-slate-300 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle2 size={40} className="text-emerald-500" />
                </div>
                <h3 className="text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight">No Active Disputes</h3>
                <p className="text-slate-500 max-w-md mx-auto font-medium">All financial claims are currently resolved. The ledger is balanced and secure.</p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Transaction Details Modal */}
      {selectedTxn && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white dark:bg-slate-800 w-full max-w-md rounded-[2.5rem] shadow-2xl overflow-hidden"
          >
            <div className="p-8 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50/50">
              <div>
                <h3 className="text-xl font-black text-slate-900 tracking-tight">Transaction Info</h3>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{selectedTxn.id}</p>
              </div>
              <button onClick={() => setSelectedTxn(null)} className="p-2 text-slate-400 hover:text-slate-600"><X size={24} /></button>
            </div>

            <div className="p-8 space-y-8">
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-black text-slate-400 uppercase tracking-widest">Receipt No</span>
                  <span className="font-bold text-slate-900 dark:text-white">{selectedTxn.receiptNo}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs font-black text-slate-400 uppercase tracking-widest">Amount</span>
                  <span className="text-lg font-black text-medical-600">NGN {selectedTxn.amount.toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs font-black text-slate-400 uppercase tracking-widest">Verification</span>
                  <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${selectedTxn.verified ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                    {selectedTxn.verified ? 'Verified' : 'Pending'}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs font-black text-slate-400 uppercase tracking-widest">Release Status</span>
                  <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${selectedTxn.releaseStatus === 'Released' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>
                    {selectedTxn.releaseStatus}
                  </span>
                </div>
              </div>

              <div className="pt-6 space-y-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  onClick={() => generateReceipt(selectedTxn, userProfile, feeDetails)}
                  className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] flex items-center justify-center gap-2 active:scale-95 transition-all shadow-lg"
                >
                  <Download size={16} /> Download Copy
                </button>

                {selectedTxn.releaseStatus === 'Held' ? (
                  <button
                    onClick={() => handleReleaseFunds(selectedTxn)}
                    className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] flex items-center justify-center gap-2 active:scale-95 transition-all shadow-lg shadow-emerald-600/20"
                  >
                    <CheckCircle2 size={16} /> Confirm & Release Funds
                  </button>
                ) : (
                  <button
                    onClick={() => handleHoldFunds(selectedTxn)}
                    className="w-full py-4 bg-amber-600 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] flex items-center justify-center gap-2 active:scale-95 transition-all shadow-lg shadow-amber-600/20"
                  >
                    <AlertTriangle size={16} /> Revoke & Hold Funds
                  </button>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => handleDisputeAction(selectedTxn, 'Investigating')}
                    className="py-4 border-2 border-red-100 text-red-500 rounded-2xl font-black uppercase tracking-widest text-[10px] flex items-center justify-center gap-2 active:scale-95 transition-all"
                  >
                    <AlertTriangle size={16} /> Dispute
                  </button>
                  <button
                    onClick={() => handleRefund(selectedTxn)}
                    className="py-4 border-2 border-orange-100 text-orange-500 rounded-2xl font-black uppercase tracking-widest text-[10px] flex items-center justify-center gap-2 active:scale-95 transition-all"
                  >
                    <Trash2 size={16} /> Refund
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Plan Modal */}
      {showPlanModal && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
           <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white dark:bg-slate-800 w-full max-w-md rounded-[2.5rem] shadow-2xl overflow-hidden"
           >
              <div className="p-8 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center">
                 <h3 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight">
                    {editingPlan ? 'Edit Plan' : 'New Plan'}
                 </h3>
                 <button onClick={() => setShowPlanModal(false)} className="text-slate-400"><X size={24} /></button>
              </div>
              <form
                className="p-8 space-y-6"
                onSubmit={(e) => {
                  e.preventDefault();
                  const formData = new FormData(e.target);
                  const data = {
                    name: formData.get('name'),
                    price: parseFloat(formData.get('price')),
                    duration_days: parseInt(formData.get('duration_days')),
                    is_active: formData.get('is_active') === 'on'
                  };

                  if (editingPlan) updateSubscriptionPlan(editingPlan.id, data);
                  else addSubscriptionPlan(data);
                  setShowPlanModal(false);
                }}
              >
                 <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Plan Name</label>
                    <input name="name" defaultValue={editingPlan?.name} required className="w-full p-4 bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl font-bold" />
                 </div>
                 <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Price (NGN)</label>
                    <input name="price" type="number" defaultValue={editingPlan?.price} required className="w-full p-4 bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl font-bold" />
                 </div>
                 <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Duration (Days)</label>
                    <input name="duration_days" type="number" defaultValue={editingPlan?.duration_days} required className="w-full p-4 bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl font-bold" />
                 </div>
                 <div className="flex items-center gap-3">
                    <input name="is_active" type="checkbox" defaultChecked={editingPlan ? editingPlan.is_active : true} className="w-5 h-5 accent-apex-600" />
                    <label className="text-sm font-bold text-slate-700 dark:text-slate-300">Active and Visible to Students</label>
                 </div>
                 <button type="submit" className="w-full py-5 bg-apex-600 text-white rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-apex-600/20 active:scale-95 transition-all">
                    {editingPlan ? 'Save Plan' : 'Create Plan'}
                 </button>
              </form>
           </motion.div>
        </div>
      )}

      {/* Add Purpose Modal (Same as before but with minor UI polish) */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white dark:bg-slate-800 w-full max-w-2xl rounded-[2.5rem] shadow-2xl overflow-hidden"
          >
            <div className="p-8 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center">
              <h3 className="text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight">
                {editingPurpose ? 'Edit Charge' : 'Create Payment Item'}
              </h3>
              <button onClick={() => { setShowAddModal(false); setEditingPurpose(null); setNewPurpose(initialPurposeState); }} className="p-2 text-slate-400 hover:text-slate-600 transition-colors">
                <X size={24} />
              </button>
            </div>

            <div className="p-8 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-2">Item Title</label>
                  <input
                    type="text"
                    value={newPurpose.title}
                    onChange={e => setNewPurpose({...newPurpose, title: e.target.value})}
                    placeholder="e.g. Clinical Posting Fee"
                    className="w-full px-5 py-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-slate-100 dark:border-slate-800 focus:ring-2 focus:ring-medical-500 outline-none font-bold"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-2">Amount (NGN)</label>
                  <input
                    type="number"
                    value={newPurpose.amount}
                    onChange={e => setNewPurpose({...newPurpose, amount: parseFloat(e.target.value)})}
                    placeholder="0.00"
                    className="w-full px-5 py-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-slate-100 dark:border-slate-800 focus:ring-2 focus:ring-medical-500 outline-none font-bold"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-2">Description</label>
                <textarea
                  value={newPurpose.description}
                  onChange={e => setNewPurpose({...newPurpose, description: e.target.value})}
                  rows={3}
                  className="w-full px-5 py-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-slate-100 dark:border-slate-800 focus:ring-2 focus:ring-medical-500 outline-none font-bold resize-none"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-2">Target Department</label>
                  <select
                    value={newPurpose.targetDept}
                    onChange={e => setNewPurpose({...newPurpose, targetDept: e.target.value})}
                    className="w-full px-5 py-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-slate-100 dark:border-slate-800 outline-none font-bold"
                  >
                    <option value="All">All Departments</option>
                    <option value="Nursing Science">Nursing Science</option>
                    <option value="Midwifery">Midwifery</option>
                    <option value="Public Health Nursing">Public Health Nursing</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-2">Academic Level</label>
                  <select
                    value={newPurpose.targetLevel}
                    onChange={e => setNewPurpose({...newPurpose, targetLevel: e.target.value})}
                    className="w-full px-5 py-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-slate-100 dark:border-slate-800 outline-none font-bold"
                  >
                    <option value="All">All Levels</option>
                    <option value="Year 1">Year 1</option>
                    <option value="Year 2">Year 2</option>
                    <option value="Year 3">Year 3</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-2">Program Type</label>
                  <select
                    value={newPurpose.targetProgram}
                    onChange={e => setNewPurpose({...newPurpose, targetProgram: e.target.value})}
                    className="w-full px-5 py-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-slate-100 dark:border-slate-800 outline-none font-bold"
                  >
                    <option value="All">All Programs</option>
                    <option value="Full-Time">Full-Time</option>
                    <option value="Part-Time">Part-Time</option>
                    <option value="Direct Entry">Direct Entry</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-2">Target Specific Student (Optional Matric No)</label>
                <input
                  type="text"
                  value={newPurpose.targetMatric}
                  onChange={e => setNewPurpose({...newPurpose, targetMatric: e.target.value})}
                  placeholder="e.g. NS/2021/042"
                  className="w-full px-5 py-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-slate-100 dark:border-slate-800 focus:ring-2 focus:ring-indigo-500 outline-none font-bold uppercase"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                 <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-2">Late Penalty (NGN)</label>
                  <input
                    type="number"
                    value={newPurpose.latePenalty}
                    onChange={e => setNewPurpose({...newPurpose, latePenalty: parseFloat(e.target.value)})}
                    placeholder="0.00"
                    className="w-full px-5 py-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-slate-100 dark:border-slate-800 focus:ring-2 focus:ring-medical-500 outline-none font-bold"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-2">Installment Payment</label>
                  <div className="flex gap-2">
                    {['Enabled', 'Disabled'].map(opt => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => setNewPurpose({...newPurpose, installmentEnabled: opt === 'Enabled'})}
                        className={`flex-1 py-4 rounded-2xl font-bold transition-all border-2 ${ (newPurpose.installmentEnabled && opt === 'Enabled') || (!newPurpose.installmentEnabled && opt === 'Disabled') ? 'border-medical-500 bg-medical-50 text-medical-700' : 'border-slate-100 dark:border-slate-800 text-slate-400'}`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <button
                onClick={() => {
                  if (editingPurpose) {
                    updatePaymentPurpose(editingPurpose.id, newPurpose);
                    addAuditLog('Item Edit', `Updated charge: ${newPurpose.title}`);
                  } else {
                    addPaymentPurpose(newPurpose);
                    addAuditLog('Item Creation', `Created new payment item: ${newPurpose.title}`);
                  }
                  setShowAddModal(false);
                  setEditingPurpose(null);
                  setNewPurpose(initialPurposeState);
                }}
                className="w-full py-5 bg-medical-600 text-white rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-medical-600/20 active:scale-95 transition-all"
              >
                {editingPurpose ? 'Save Changes' : 'Publish Payment Charge'}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};

const AdminStatCard = ({ title, value, icon, color }) => (
  <div className="bg-white dark:bg-slate-800 p-6 rounded-[2rem] shadow-clinical border border-slate-100 dark:border-slate-700">
    <div className={`w-10 h-10 ${color} rounded-xl flex items-center justify-center mb-4`}>
      {React.cloneElement(icon, { size: 20 })}
    </div>
    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{title}</p>
    <p className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">{value}</p>
  </div>
);

export default AdminFinance;
