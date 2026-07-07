import re

content = open('src/pages/AdminFinance.jsx').read()

# Add Wallet Management tab
new_tabs = r'''  const tabs = [
    { id: 'overview', label: 'Overview', icon: <TrendingUp size={16} /> },
    { id: 'wallets', label: 'Wallet Management', icon: <Zap size={16} /> },
    { id: 'ledger', label: 'Transaction Ledger', icon: <FileText size={16} /> },
    { id: 'purposes', label: 'Payment Items', icon: <CreditCard size={16} /> },
    { id: 'plans', label: 'Subscription Plans', icon: <SettingsIcon size={16} />, superOnly: true },
    { id: 'disputes', label: 'Disputes', icon: <AlertTriangle size={16} /> },
  ].filter(tab => !tab.superOnly || userProfile.role === 'super_admin');'''

content = re.sub(r'const tabs = \[.*?\]\.filter\(tab => !tab\.superOnly \|\| userProfile\.role === \'super_admin\'\);', new_tabs, content, flags=re.DOTALL)

# Add the Wallets Tab content
wallets_tab_content = r'''        {activeTab === 'wallets' && (
           <div className="space-y-8 animate-in fade-in duration-500">
              <div className="flex justify-between items-center">
                 <h3 className="text-xl font-black uppercase tracking-tight">Wallet Administration</h3>
                 <div className="flex gap-2">
                    <span className="px-3 py-1 bg-emerald-500/10 text-emerald-500 rounded-lg text-[10px] font-black uppercase">Active Audit</span>
                 </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                 <div className="p-8 bg-slate-50 dark:bg-slate-900/50 rounded-[2rem] border border-slate-100 dark:border-slate-800 space-y-6">
                    <div>
                       <h4 className="font-black uppercase text-sm mb-2">Fund Account</h4>
                       <p className="text-xs text-slate-500">Crediting Administrator or Student wallets for rewards/scholarships.</p>
                    </div>
                    <div className="space-y-4">
                       <input type="text" placeholder="Recipient Email or Matric Number" className="w-full p-4 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 font-bold text-sm" />
                       <input type="number" placeholder="Amount (NGN)" className="w-full p-4 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 font-bold text-sm" />
                       <select className="w-full p-4 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 font-bold text-sm appearance-none">
                          <option>Select Reason</option>
                          <option>Apex Treasure Hunt Reward</option>
                          <option>Academic Scholarship</option>
                          <option>Promotion / Bonus</option>
                          <option>Administrator Operational Credit</option>
                       </select>
                       <button onClick={() => alert('Transaction Logged & Processed: Audit Entry Created.')} className="w-full py-4 bg-medical-600 text-white rounded-xl font-black uppercase tracking-widest text-xs shadow-lg active:scale-95 transition-all">Authorize Credit</button>
                    </div>
                 </div>

                 <div className="space-y-4">
                    <h4 className="font-black uppercase text-sm px-2">Audit trail</h4>
                    {[1, 2].map(i => (
                       <div key={i} className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 flex justify-between items-center">
                          <div className="flex items-center gap-3">
                             <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center"><Plus size={18} /></div>
                             <div>
                                <p className="font-bold text-xs">Wallet Funded</p>
                                <p className="text-[10px] text-slate-400">Admin Transaction #{1024 + i}</p>
                             </div>
                          </div>
                          <p className="font-black text-sm text-emerald-600">+₦{(i * 5000).toLocaleString()}</p>
                       </div>
                    ))}
                 </div>
              </div>
           </div>
        )}'''

# Inject wallets_tab_content and update subsequent conditions
content = content.replace("{activeTab !== 'overview' && (", wallets_tab_content + "\n\n        {activeTab !== 'overview' && activeTab !== 'wallets' && (")

with open('src/pages/AdminFinance.jsx', 'w') as f:
    f.write(content)
