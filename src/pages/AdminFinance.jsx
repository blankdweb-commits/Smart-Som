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
  AlertCircle
} from '../components/Icons';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';

const AdminFinance = () => {
  const {
    transactions,
    feeDetails,
    userProfile,
    paymentPurposes,
    addPaymentPurpose,
    updatePaymentPurpose,
    deletePaymentPurpose
  } = useAppContext();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('ledger'); // ledger, purposes, transactions
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
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

  // Mock data for other students to demonstrate admin capabilities
  const mockStudents = [
    { id: '1', name: 'Amara Okafor', matric: 'NS/2021/042', dept: 'Nursing Science', balance: 0, status: 'Paid' },
    { id: '2', name: 'John Doe', matric: 'NS/2021/001', dept: 'Midwifery', balance: 225000, status: 'Partial' },
    { id: '3', name: 'Sarah Smith', matric: 'NS/2022/115', dept: 'Nursing Science', balance: 450000, status: 'Unpaid' },
    { id: '4', name: 'Blessing Udoh', matric: 'NS/2021/088', dept: 'Public Health', balance: 0, status: 'Paid' },
  ];

  const totalRevenue = transactions.reduce((acc, curr) => acc + curr.amount, 0) + 12450000; // Mock historical revenue
  const pendingFees = 8450000;

  return (
    <div className="pb-32 space-y-8 animate-in fade-in duration-700">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/')} className="p-3 bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 hover:text-medical-600 transition-all">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h2 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
              <Shield className="text-medical-600" /> Finance Control
            </h2>
            <p className="text-slate-500 dark:text-slate-400 font-medium text-sm">Institutional payment monitoring and reconciliation.</p>
          </div>
        </div>
        <button className="px-6 py-3 bg-medical-600 text-white rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-medical-600/20 hover:bg-medical-700 transition-all flex items-center gap-2">
          <Download size={18} /> Export Records
        </button>
      </header>

      <div className="flex p-1 bg-slate-100 dark:bg-slate-800 rounded-2xl w-full sm:w-fit">
        <button
          onClick={() => setActiveTab('ledger')}
          className={`flex-1 sm:flex-none px-6 py-2.5 rounded-xl font-bold text-sm transition-all ${activeTab === 'ledger' ? 'bg-white dark:bg-slate-700 text-medical-600 shadow-sm' : 'text-slate-500'}`}
        >
          Student Ledger
        </button>
        <button
          onClick={() => setActiveTab('purposes')}
          className={`flex-1 sm:flex-none px-6 py-2.5 rounded-xl font-bold text-sm transition-all ${activeTab === 'purposes' ? 'bg-white dark:bg-slate-700 text-medical-600 shadow-sm' : 'text-slate-500'}`}
        >
          Payment Hub Management
        </button>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <AdminStatCard title="Total Revenue" value={`NGN ${(totalRevenue/1000000).toFixed(1)}M`} icon={<TrendingUp />} color="bg-emerald-50 text-emerald-600" />
        <AdminStatCard title="Outstanding" value={`NGN ${(pendingFees/1000000).toFixed(1)}M`} icon={<AlertTriangle />} color="bg-amber-50 text-amber-600" />
        <AdminStatCard title="Students Paid" value="842" icon={<Users />} color="bg-blue-50 text-blue-600" />
        <AdminStatCard title="Transactions" value="1.2k" icon={<CreditCard />} color="bg-indigo-50 text-indigo-600" />
      </div>

      {activeTab === 'ledger' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Student Ledger */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white dark:bg-slate-800 rounded-[2.5rem] p-8 shadow-clinical border border-slate-100 dark:border-slate-700">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
                <h3 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight">Student Ledger</h3>
                <div className="relative w-full sm:w-64">
                  <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search matric or name..."
                    className="w-full pl-12 pr-4 py-3 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-100 dark:border-slate-800 text-sm font-bold outline-none focus:ring-2 focus:ring-medical-500"
                  />
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-separate border-spacing-y-3">
                  <thead>
                    <tr className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-4">
                      <th className="pb-4 pl-4">Student</th>
                      <th className="pb-4">Department</th>
                      <th className="pb-4">Balance</th>
                      <th className="pb-4">Status</th>
                      <th className="pb-4"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {mockStudents.map((s) => (
                      <tr key={s.id} className="bg-slate-50 dark:bg-slate-900/40 hover:bg-white dark:hover:bg-slate-800 transition-all rounded-2xl group shadow-sm">
                        <td className="py-4 pl-4 rounded-l-2xl">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-white dark:bg-slate-800 rounded-xl flex items-center justify-center font-black text-medical-600 shadow-sm border border-slate-100 dark:border-slate-700">
                              {s.name.charAt(0)}
                            </div>
                            <div>
                              <p className="text-sm font-black text-slate-900 dark:text-white">{s.name}</p>
                              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{s.matric}</p>
                            </div>
                          </div>
                        </td>
                        <td className="py-4 text-xs font-bold text-slate-600 dark:text-slate-400">{s.dept}</td>
                        <td className="py-4 text-sm font-black text-slate-900 dark:text-white">NGN {s.balance.toLocaleString()}</td>
                        <td className="py-4">
                          <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${
                            s.status === 'Paid' ? 'bg-emerald-100 text-emerald-700' :
                            s.status === 'Partial' ? 'bg-amber-100 text-amber-700' :
                            'bg-red-100 text-red-700'
                          }`}>
                            {s.status}
                          </span>
                        </td>
                        <td className="py-4 pr-4 rounded-r-2xl text-right">
                          <button className="p-2 text-slate-300 hover:text-medical-600 transition-colors">
                            <ChevronRight size={20} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Recent Global Transactions */}
          <div className="space-y-6">
            <div className="bg-white dark:bg-slate-800 rounded-[2.5rem] p-8 shadow-clinical border border-slate-100 dark:border-slate-700">
              <h3 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight mb-8">Live Feed</h3>
              <div className="space-y-6">
                  {[
                    { user: 'Amara Okafor', amt: 450000, time: '2 mins ago' },
                    { user: 'Blessing Udoh', amt: 225000, time: '15 mins ago' },
                    { user: 'John Doe', amt: 50000, time: '1 hour ago' },
                  ].map((t, i) => (
                    <div key={i} className="flex items-center gap-4 group">
                      <div className="w-1.5 h-10 bg-emerald-500 rounded-full group-hover:scale-y-125 transition-transform" />
                      <div className="flex-1">
                        <p className="text-sm font-black text-slate-900 dark:text-white">{t.user}</p>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Paid NGN {t.amt.toLocaleString()}</p>
                      </div>
                      <span className="text-[10px] font-bold text-slate-300 uppercase">{t.time}</span>
                    </div>
                  ))}
              </div>

              <button className="w-full mt-10 py-4 bg-slate-50 dark:bg-slate-900 text-slate-500 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] hover:bg-slate-100 transition-all">
                  View Full Audit Log
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <h3 className="text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight">Active Payment Items</h3>
            <button
              onClick={() => setShowAddModal(true)}
              className="px-6 py-3 bg-medical-600 text-white rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-medical-600/20 hover:bg-medical-700 transition-all flex items-center gap-2"
            >
              <Plus size={18} /> Create New Purpose
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
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Target</p>
                    <p className="text-xs font-bold text-slate-700 dark:text-slate-300">{p.targetLevel} • {p.targetDept}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xl font-black text-medical-600">{p.currency} {p.amount.toLocaleString()}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add Purpose Modal */}
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

      {activeTab === 'ledger' && (
        <>
          <div className="bg-white dark:bg-slate-800 rounded-[2.5rem] p-8 shadow-clinical border border-slate-100 dark:border-slate-700">
             <h3 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight mb-8">Live Feed</h3>
             <div className="space-y-6">
                {[
                  { user: 'Amara Okafor', amt: 450000, time: '2 mins ago' },
                  { user: 'Blessing Udoh', amt: 225000, time: '15 mins ago' },
                  { user: 'John Doe', amt: 50000, time: '1 hour ago' },
                ].map((t, i) => (
                  <div key={i} className="flex items-center gap-4 group">
                    <div className="w-1.5 h-10 bg-emerald-500 rounded-full group-hover:scale-y-125 transition-transform" />
                    <div className="flex-1">
                      <p className="text-sm font-black text-slate-900 dark:text-white">{t.user}</p>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Paid NGN {t.amt.toLocaleString()}</p>
                    </div>
                    <span className="text-[10px] font-bold text-slate-300 uppercase">{t.time}</span>
                  </div>
                ))}
             </div>

             <button className="w-full mt-10 py-4 bg-slate-50 dark:bg-slate-900 text-slate-500 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] hover:bg-slate-100 transition-all">
                View Full Audit Log
             </button>
          </div>

        <div className="bg-indigo-600 rounded-[2.5rem] p-8 text-white shadow-xl relative overflow-hidden mt-8">
          <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-white/10 rounded-full blur-2xl" />
          <h4 className="text-lg font-black uppercase tracking-tight mb-2">Reconciliation</h4>
          <p className="text-xs opacity-80 mb-6 font-medium leading-relaxed">Ensure all manual bank transfers are manually approved in the ledger.</p>
          <button className="px-6 py-3 bg-white text-indigo-600 rounded-xl font-black uppercase tracking-widest text-[10px] shadow-lg shadow-indigo-900/20 active:scale-95 transition-all">
            Launch Tool
          </button>
        </div>
        </>
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
