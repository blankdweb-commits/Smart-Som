import React, { useState } from 'react';
import { useAppContext } from '../context/AppContext';
import {
  CreditCard,
  ArrowRight,
  CheckCircle2,
  XCircle,
  Loader2,
  ShieldCheck,
  Download,
  Share2,
  Clock,
  ChevronRight,
  TrendingUp,
  FileText
} from '../components/Icons';
import { motion, AnimatePresence } from 'framer-motion';
import StudentVerification from '../components/StudentVerification';
import Toast from '../components/Toast';
import { generateReceipt } from '../components/ReceiptSystem';

const Payments = () => {
  const { userProfile, feeDetails, transactions, addTransaction } = useAppContext();
  const [showVerification, setShowVerification] = useState(!userProfile.isVerified);
  const [paymentStep, setPaymentStep] = useState('overview'); // overview, plan, simulate, success
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [customAmount, setCustomAmount] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [toast, setToast] = useState(null);
  const [otp, setOtp] = useState('');
  const [lastTxn, setLastTxn] = useState(null);

  const presetPlans = [
    { name: 'Full Payment', desc: 'Pay total outstanding balance', percent: 100 },
    { name: 'Installment A', desc: '50% now, 50% later', percent: 50 },
    { name: 'Installment B', desc: '60% now, 40% later', percent: 60 },
    { name: 'Micro-Payment', desc: 'Pay 25% of total', percent: 25 },
  ];

  const handleStartPayment = (plan) => {
    setSelectedPlan(plan);
    setPaymentStep('simulate');
  };

  const simulatePayment = async () => {
    setIsProcessing(true);
    // Simulate network delay
    await new Promise(r => setTimeout(r, 2000));
    setPaymentStep('otp');
    setIsProcessing(false);
  };

  const verifyOtp = async () => {
    if (otp.length < 4) {
      setToast({ message: 'Please enter a valid OTP', type: 'error' });
      return;
    }

    setIsProcessing(true);
    await new Promise(r => setTimeout(r, 2000));

    const amount = selectedPlan
      ? (feeDetails.totalFee * (selectedPlan.percent / 100))
      : parseFloat(customAmount);

    const txn = addTransaction({
      amount,
      type: selectedPlan ? selectedPlan.name : 'Custom Payment',
      status: 'Success',
      method: 'Simulated Card'
    });

    setLastTxn(txn);
    setPaymentStep('success');
    setIsProcessing(false);
    setToast({ message: 'Payment Successful!', type: 'success' });
  };

  if (showVerification) {
    return (
      <div className="py-10 animate-in fade-in duration-700">
        <StudentVerification onVerified={() => setShowVerification(false)} />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto pb-32 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
          <h2 className="text-4xl font-black text-slate-900 dark:text-white tracking-tight">Finance Portal</h2>
          <p className="text-slate-500 dark:text-slate-400 font-medium mt-1">Manage your tuition and institutional payments.</p>
        </div>
        <div className="flex bg-slate-100 dark:bg-slate-800 p-1.5 rounded-2xl w-full md:w-auto">
          <button
            onClick={() => setPaymentStep('overview')}
            className={`flex-1 md:flex-none px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${paymentStep === 'overview' ? 'bg-white dark:bg-slate-700 shadow-sm text-medical-600' : 'text-slate-500'}`}
          >
            Overview
          </button>
          <button
            onClick={() => setPaymentStep('history')}
            className={`flex-1 md:flex-none px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${paymentStep === 'history' ? 'bg-white dark:bg-slate-700 shadow-sm text-medical-600' : 'text-slate-500'}`}
          >
            History
          </button>
        </div>
      </header>

      <AnimatePresence mode="wait">
        {paymentStep === 'overview' && (
          <motion.div
            key="overview"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-8"
          >
            {/* Balance Card */}
            <div className="bg-medical-600 rounded-[2.5rem] p-10 text-white shadow-2xl relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -mr-32 -mt-32 blur-3xl" />
              <div className="relative z-10 flex flex-col md:flex-row justify-between items-center gap-8">
                <div className="text-center md:text-left">
                  <p className="text-xs font-black uppercase tracking-[0.3em] opacity-80 mb-2">Total Outstanding</p>
                  <h3 className="text-5xl font-black tracking-tighter">
                    {feeDetails.currency} {(feeDetails.totalFee - feeDetails.amountPaid).toLocaleString()}
                  </h3>
                  <div className="flex items-center gap-3 mt-4 opacity-80">
                    <span className="text-[10px] font-black uppercase tracking-widest bg-white/20 px-3 py-1 rounded-full">
                      Session: {userProfile.session}
                    </span>
                    <span className="text-[10px] font-black uppercase tracking-widest bg-white/20 px-3 py-1 rounded-full">
                      Due: {new Date(feeDetails.dueDate).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                <div className="flex flex-col items-center gap-2">
                  <div className="w-24 h-24 rounded-full border-8 border-white/20 flex items-center justify-center relative">
                    <svg className="w-full h-full transform -rotate-90 absolute">
                      <circle
                        cx="48" cy="48" r="40"
                        stroke="currentColor" strokeWidth="8" fill="transparent"
                        className="text-white/10"
                      />
                      <motion.circle
                        cx="48" cy="48" r="40"
                        stroke="currentColor" strokeWidth="8" fill="transparent"
                        strokeDasharray={251.2}
                        initial={{ strokeDashoffset: 251.2 }}
                        animate={{ strokeDashoffset: 251.2 - (251.2 * (feeDetails.amountPaid / feeDetails.totalFee)) }}
                        transition={{ duration: 1.5, ease: "easeOut" }}
                        className="text-white"
                      />
                    </svg>
                    <span className="text-lg font-black">{Math.round((feeDetails.amountPaid / feeDetails.totalFee) * 100)}%</span>
                  </div>
                  <p className="text-[10px] font-black uppercase tracking-widest opacity-60">Paid</p>
                </div>
              </div>
            </div>

            {/* Payment Options Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-white dark:bg-slate-800 p-8 rounded-[2rem] shadow-clinical border border-slate-100 dark:border-slate-700 space-y-6">
                <h4 className="text-lg font-black text-slate-900 dark:text-white uppercase tracking-tight flex items-center gap-2">
                  <TrendingUp size={20} className="text-medical-600" /> Installment Plans
                </h4>
                <div className="space-y-3">
                  {presetPlans.map((plan) => (
                    <button
                      key={plan.name}
                      onClick={() => handleStartPayment(plan)}
                      className="w-full p-5 bg-slate-50 dark:bg-slate-900/40 rounded-2xl border border-slate-100 dark:border-slate-800 hover:border-medical-500 hover:bg-white dark:hover:bg-slate-800 transition-all group flex items-center justify-between text-left"
                    >
                      <div>
                        <p className="font-black text-slate-900 dark:text-white">{plan.name}</p>
                        <p className="text-xs text-slate-500 font-medium">{plan.desc}</p>
                      </div>
                      <ChevronRight size={20} className="text-slate-300 group-hover:text-medical-600 transform group-hover:translate-x-1 transition-all" />
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-white dark:bg-slate-800 p-8 rounded-[2rem] shadow-clinical border border-slate-100 dark:border-slate-700 space-y-6">
                <h4 className="text-lg font-black text-slate-900 dark:text-white uppercase tracking-tight flex items-center gap-2">
                  <CreditCard size={20} className="text-indigo-500" /> Custom Amount
                </h4>
                <div className="space-y-4">
                  <div className="relative">
                    <span className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400 font-black">{feeDetails.currency}</span>
                    <input
                      type="number"
                      value={customAmount}
                      onChange={e => setCustomAmount(e.target.value)}
                      placeholder="Enter amount"
                      className="w-full pl-16 pr-5 py-5 bg-slate-50 dark:bg-slate-900/40 rounded-2xl border border-slate-100 dark:border-slate-800 focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-black text-lg"
                    />
                  </div>
                  <button
                    disabled={!customAmount || parseFloat(customAmount) <= 0}
                    onClick={() => setPaymentStep('simulate')}
                    className="w-full py-5 bg-indigo-600 text-white rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-indigo-600/20 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95 flex items-center justify-center gap-2"
                  >
                    Pay Custom Amount <ArrowRight size={16} />
                  </button>
                </div>

                <div className="pt-4 border-t border-slate-100 dark:border-slate-700">
                  <div className="flex items-center gap-3 text-slate-400">
                    <ShieldCheck size={24} />
                    <p className="text-[10px] font-medium leading-tight">
                      All payments are securely processed. We use bank-grade encryption to protect your financial data.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {(paymentStep === 'simulate' || paymentStep === 'otp') && (
          <motion.div
            key="simulate"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md"
          >
            <div className="bg-white dark:bg-slate-800 w-full max-w-md rounded-[2.5rem] shadow-2xl overflow-hidden">
              <div className="bg-slate-50 dark:bg-slate-900/50 p-6 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-medical-600 rounded-lg flex items-center justify-center text-white font-bold">N</div>
                  <span className="font-black text-slate-900 dark:text-white uppercase tracking-widest text-xs">Payment Gateway</span>
                </div>
                <button onClick={() => setPaymentStep('overview')} className="text-slate-400 hover:text-slate-600"><XCircle size={24} /></button>
              </div>

              <div className="p-10 space-y-8 text-center">
                {paymentStep === 'simulate' ? (
                  <>
                    <div className="w-20 h-20 bg-medical-50 dark:bg-medical-900/30 text-medical-600 rounded-3xl flex items-center justify-center mx-auto relative">
                      {isProcessing ? <Loader2 size={40} className="animate-spin" /> : <CreditCard size={40} />}
                    </div>
                    <div>
                      <h3 className="text-2xl font-black text-slate-900 dark:text-white">Secure Checkout</h3>
                      <p className="text-slate-500 font-medium mt-1">
                        Amount to Pay: <span className="text-slate-900 dark:text-white font-black">{feeDetails.currency} {(selectedPlan ? (feeDetails.totalFee * selectedPlan.percent / 100) : parseFloat(customAmount)).toLocaleString()}</span>
                      </p>
                    </div>
                    {!isProcessing ? (
                      <button
                        onClick={simulatePayment}
                        className="w-full py-5 bg-medical-600 text-white rounded-2xl font-black uppercase tracking-widest text-xs shadow-lg active:scale-95 transition-all"
                      >
                        Confirm Transaction
                      </button>
                    ) : (
                      <p className="text-xs font-black text-medical-600 uppercase tracking-widest animate-pulse">Contacting Bank...</p>
                    )}
                  </>
                ) : (
                  <>
                    <div className="w-20 h-20 bg-amber-50 dark:bg-amber-900/30 text-amber-500 rounded-3xl flex items-center justify-center mx-auto">
                      <ShieldCheck size={40} />
                    </div>
                    <div>
                      <h3 className="text-2xl font-black text-slate-900 dark:text-white">Enter OTP</h3>
                      <p className="text-slate-500 font-medium mt-1">A verification code has been sent to your registered phone number.</p>
                    </div>
                    <div className="space-y-4">
                      <input
                        type="text"
                        maxLength={6}
                        value={otp}
                        onChange={e => setOtp(e.target.value)}
                        placeholder="0 0 0 0"
                        className="w-full text-center tracking-[1em] text-3xl font-black py-5 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-slate-100 dark:border-slate-800 outline-none focus:ring-2 focus:ring-amber-500"
                      />
                      <button
                        disabled={isProcessing}
                        onClick={verifyOtp}
                        className="w-full py-5 bg-slate-900 text-white rounded-2xl font-black uppercase tracking-widest text-xs flex items-center justify-center gap-2 hover:bg-slate-800 active:scale-95 transition-all"
                      >
                        {isProcessing ? <Loader2 size={16} className="animate-spin" /> : 'Complete Payment'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        )}

        {paymentStep === 'success' && (
          <motion.div
            key="success"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white dark:bg-slate-800 rounded-[3rem] p-12 shadow-clinical border border-slate-100 dark:border-slate-700 text-center space-y-8"
          >
            <div className="w-24 h-24 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-500 rounded-full flex items-center justify-center mx-auto relative">
               <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.2, type: "spring" }}
               >
                 <CheckCircle2 size={64} />
               </motion.div>
               <motion.div
                className="absolute inset-0 rounded-full border-4 border-emerald-500"
                initial={{ scale: 1, opacity: 1 }}
                animate={{ scale: 1.5, opacity: 0 }}
                transition={{ duration: 1, repeat: Infinity }}
               />
            </div>

            <div>
              <h3 className="text-4xl font-black text-slate-900 dark:text-white tracking-tight">Payment Received!</h3>
              <p className="text-slate-500 font-medium mt-2">Your school fee record has been updated successfully.</p>
            </div>

            <div className="max-w-md mx-auto p-6 bg-slate-50 dark:bg-slate-900/50 rounded-3xl border border-dashed border-slate-300 dark:border-slate-700 space-y-4">
              <div className="flex justify-between text-xs font-bold text-slate-400 uppercase tracking-widest">
                <span>Transaction ID</span>
                <span className="text-slate-900 dark:text-white">{lastTxn?.id}</span>
              </div>
              <div className="flex justify-between text-xs font-bold text-slate-400 uppercase tracking-widest">
                <span>Amount Paid</span>
                <span className="text-emerald-600">{feeDetails.currency} {lastTxn?.amount.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-xs font-bold text-slate-400 uppercase tracking-widest">
                <span>Status</span>
                <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-md text-[10px]">Verified</span>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <button
                onClick={() => setPaymentStep('overview')}
                className="px-8 py-4 bg-slate-900 dark:bg-slate-700 text-white rounded-2xl font-black uppercase tracking-widest text-xs transition-all active:scale-95"
              >
                Back to Dashboard
              </button>
              <button
                onClick={() => generateReceipt(lastTxn, userProfile, feeDetails)}
                className="px-8 py-4 bg-white dark:bg-slate-800 text-medical-600 border-2 border-medical-500 rounded-2xl font-black uppercase tracking-widest text-xs flex items-center justify-center gap-2 hover:bg-medical-50 transition-all active:scale-95"
              >
                <Download size={18} /> Download Receipt
              </button>
            </div>
          </motion.div>
        )}

        {paymentStep === 'history' && (
          <motion.div
            key="history"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-4"
          >
            {transactions.length > 0 ? transactions.map((txn) => (
              <div key={txn.id} className="bg-white dark:bg-slate-800 p-6 rounded-3xl shadow-sm border border-slate-100 dark:border-slate-700 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 hover:shadow-md transition-all group">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-slate-50 dark:bg-slate-900 rounded-2xl flex items-center justify-center text-slate-400 group-hover:text-medical-600 group-hover:bg-medical-50 transition-all">
                    <FileText size={24} />
                  </div>
                  <div>
                    <p className="font-black text-slate-900 dark:text-white">{txn.type}</p>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{new Date(txn.date).toLocaleDateString()} • {txn.id}</p>
                  </div>
                </div>
                <div className="flex flex-row sm:flex-col items-center sm:items-end justify-between w-full sm:w-auto gap-2">
                  <p className="text-lg font-black text-slate-900 dark:text-white">{feeDetails.currency} {txn.amount.toLocaleString()}</p>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => generateReceipt(txn, userProfile, feeDetails)}
                      className="text-slate-400 hover:text-medical-600 transition-colors"
                      title="Download Receipt"
                    >
                      <Download size={18} />
                    </button>
                    <button className="text-slate-400 hover:text-indigo-500 transition-colors"><Share2 size={18} /></button>
                    <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-md text-[10px] font-black uppercase tracking-widest">Success</span>
                  </div>
                </div>
              </div>
            )) : (
              <div className="text-center py-20 bg-white dark:bg-slate-800 rounded-[2rem] border border-dashed border-slate-300 dark:border-slate-700">
                <div className="w-16 h-16 bg-slate-50 dark:bg-slate-900 text-slate-300 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CreditCard size={32} />
                </div>
                <h4 className="text-lg font-black text-slate-400 uppercase tracking-widest">No Transactions Found</h4>
                <p className="text-slate-400 text-sm mt-1">Your payment history will appear here once processed.</p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
};

export default Payments;
