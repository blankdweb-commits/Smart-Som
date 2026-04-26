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

const AdminFinance = () => {
  const {
    transactions,
    feeDetails,
    userProfile,
    paymentPurposes,
    addPaymentPurpose,
    updatePaymentPurpose,
    deletePaymentPurpose,
    updateTransaction,
    auditLogs,
    addAuditLog
  } = useAppContext();

  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('overview'); // overview, ledger, purposes, disputes
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedTxn, setSelectedTxn] = useState(null);

  const [newPurpose, setNewPurpose] = useState({
    title: '',
    description: '',
    amount: '',
    currency: 'NGN',
    targetDept: 'All',
    targetLevel: 'All',
    dueDate: '',
    active: true
  });

  // Calculate Granular Stats
  const stats = {
    todayRevenue: transactions
      .filter(t => new Date(t.date).toDateString() === new Date().toDateString() && t.status === 'Success')
      .reduce((acc, t) => acc + t.amount, 0),
    pendingVerification: transactions.filter(t => t.status === 'Pending' || !t.verified).length,
    fundsHeld: transactions
      .filter(t => t.releaseStatus === 'Held' && t.status === 'Success')
      .reduce((acc, t) => acc + t.amount, 0),
    totalRevenue: transactions
      .filter(t => t.status === 'Success')
      .reduce((acc, t) => acc + t.amount, 0) + 12450000,
    activeDisputes: transactions.filter(t => t.disputeStatus !== 'None' && t.disputeStatus !== 'Resolved').length
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

  const handleDisputeAction = (txn, status) => {
    updateTransaction(txn.id, { disputeStatus: status });
    addAuditLog('Dispute Update', `Set dispute status of ${txn.id} to ${status}`);
  };

  if (!userProfile.isAdmin) {
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
              <ShieldCheck className="text-medical-600" /> Bursary Control
            </h2>
            <p className="text-slate-500 dark:text-slate-400 font-medium text-sm">Institutional Treasury & Student Ledger Management.</p>
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
        ].map(tab => (
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
              <AdminStatCard title="Revenue Today" value={`NGN ${stats.todayRevenue.toLocaleString()}`} icon={<TrendingUp />} color="bg-emerald-50 text-emerald-600" />
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

               <div className="overflow-x-auto">
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
                        onClick={() => updatePaymentPurpose(p.id, { active: !p.active })}
                        className={`p-2 rounded-xl transition-all ${p.active ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-50 text-slate-400'}`}
                      >
                        <CheckCircle2 size={18} />
                      </button>
                      <button
                        onClick={() => deletePaymentPurpose(p.id)}
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

                <button
                  onClick={() => handleDisputeAction(selectedTxn, 'Investigating')}
                  className="w-full py-4 border-2 border-red-100 text-red-500 rounded-2xl font-black uppercase tracking-widest text-[10px] flex items-center justify-center gap-2 active:scale-95 transition-all"
                >
                  <AlertTriangle size={16} /> Flag for Dispute
                </button>
              </div>
            </div>
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
              <h3 className="text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight">Create Payment Item</h3>
              <button onClick={() => setShowAddModal(false)} className="p-2 text-slate-400 hover:text-slate-600 transition-colors">
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

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
              </div>

              <button
                onClick={() => {
                  addPaymentPurpose(newPurpose);
                  addAuditLog('Item Creation', `Created new payment item: ${newPurpose.title}`);
                  setShowAddModal(false);
                  setNewPurpose({
                    title: '', description: '', amount: '', currency: 'NGN',
                    targetDept: 'All', targetLevel: 'All', dueDate: '', active: true
                  });
                }}
                className="w-full py-5 bg-medical-600 text-white rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-medical-600/20 active:scale-95 transition-all"
              >
                Publish Payment Charge
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
