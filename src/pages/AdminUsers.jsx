import React, { useEffect, useMemo, useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { supabase } from '../utils/supabase';
import {
  Shield,
  Users,
  Search,
  Loader2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  ArrowLeft,
  Lock,
  Mail
} from '../components/Icons';
import { motion } from 'framer-motion'; // eslint-disable-line no-unused-vars
import { useNavigate } from 'react-router-dom';
import Toast from '../components/Toast';

const ROLE_OPTIONS = ['student', 'admin', 'super_admin'];

const AdminUsers = () => {
  const { userProfile, loadingAuth, session } = useAppContext();
  const navigate = useNavigate();

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [busy, setBusy] = useState(null);
  const [toast, setToast] = useState(null);

  const currentUserId = session?.user?.id;
  const amSuperAdmin = userProfile.isAdmin && userProfile.role === 'super_admin';

  const fetchUsers = async () => {
    if (!supabase) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email, phone, department, level, role, is_activated, created_at')
        .order('created_at', { ascending: false })
        .limit(300);
      if (error) throw error;
      setUsers(data || []);
    } catch (err) {
      setToast({ message: `Failed to load users: ${err.message}`, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const filteredUsers = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return users;
    return users.filter(u =>
      (u.full_name || '').toLowerCase().includes(term) ||
      (u.email || '').toLowerCase().includes(term) ||
      (u.department || '').toLowerCase().includes(term) ||
      (u.role || '').toLowerCase().includes(term)
    );
  }, [users, searchTerm]);

  const handleToggleActivation = async (user) => {
    if (!user || user.role === 'super_admin' || user.id === currentUserId) return;
    const key = `activation:${user.id}`;
    setBusy(key);
    try {
      const { error } = await supabase.rpc('admin_set_activation', {
        p_user_id: user.id,
        p_activated: !user.is_activated
      });
      if (error) throw error;
      setUsers(prev => prev.map(u => u.id === user.id ? { ...u, is_activated: !u.is_activated } : u));
      setToast({ message: user.is_activated ? 'Account deactivated' : 'Account activated', type: 'success' });
    } catch (err) {
      setToast({ message: `Failed to update activation: ${err.message}`, type: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const handleRoleChange = async (user, newRole) => {
    if (!user || user.role === 'super_admin' || user.id === currentUserId || newRole === user.role) return;
    if (newRole === 'super_admin' && !amSuperAdmin) {
      setToast({ message: 'Only a super admin can grant the super admin role', type: 'error' });
      return;
    }
    const key = `role:${user.id}`;
    setBusy(key);
    try {
      const { error } = await supabase.rpc('admin_set_role', {
        p_user_id: user.id,
        p_new_role: newRole
      });
      if (error) throw error;
      setUsers(prev => prev.map(u => {
        if (u.id !== user.id) return u;
        const promoted = newRole === 'admin' || newRole === 'super_admin';
        return { ...u, role: newRole, is_activated: promoted ? true : u.is_activated };
      }));
      setToast({ message: `Role updated to ${newRole}`, type: 'success' });
    } catch (err) {
      setToast({ message: `Failed to update role: ${err.message}`, type: 'error' });
    } finally {
      setBusy(null);
    }
  };

  if (loadingAuth || !userProfile.email) {
    return <div className="p-20 text-center font-black animate-pulse">Initializing User Directory...</div>;
  }

  if (!userProfile.isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center space-y-6">
        <div className="w-20 h-20 bg-red-50 dark:bg-red-900/20 text-red-500 rounded-[2rem] flex items-center justify-center"><Lock size={40} /></div>
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight">Access Restricted</h1>
          <p className="text-slate-500 max-w-sm mx-auto mt-2">This terminal requires an administrator account.</p>
        </div>
        <button onClick={() => navigate('/dashboard')} className="px-6 py-3 bg-slate-100 dark:bg-slate-800 rounded-2xl font-bold text-sm">Back to Dashboard</button>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-32 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
          <div className="flex items-center gap-3 text-indigo-600 mb-2">
            <Users size={24} />
            <span className="text-[10px] font-black uppercase tracking-[0.3em]">Account Administration</span>
          </div>
          <h1 className="text-4xl font-black text-slate-900 dark:text-white tracking-tight">User Management</h1>
          <p className="text-slate-500 dark:text-slate-400 font-medium mt-1">Activate, deactivate and manage account roles across the platform.</p>
        </div>
        <div className="flex gap-3">
          <button onClick={fetchUsers} className="flex items-center gap-2 px-6 py-3 bg-white dark:bg-slate-800 rounded-2xl font-bold text-sm shadow-soft hover:bg-slate-50 transition-all border border-slate-100 dark:border-slate-700">
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <button onClick={() => navigate('/dashboard')} className="flex items-center gap-2 px-6 py-3 bg-white dark:bg-slate-800 rounded-2xl font-bold text-sm shadow-soft hover:bg-slate-50 transition-all border border-slate-100 dark:border-slate-700">
            <ArrowLeft size={18} /> Exit
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        <StatCard title="Total Accounts" value={users.length} icon={<Users />} color="bg-indigo-50 text-indigo-600" />
        <StatCard title="Activated" value={users.filter(u => u.is_activated).length} icon={<CheckCircle2 />} color="bg-emerald-50 text-emerald-600" />
        <StatCard title="Admins" value={users.filter(u => u.role === 'admin' || u.role === 'super_admin').length} icon={<Shield />} color="bg-amber-50 text-amber-600" />
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-[2.5rem] p-6 sm:p-8 shadow-clinical border border-slate-100 dark:border-slate-700">
        <div className="relative mb-6">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            type="text"
            placeholder="Search by name, email, department or role..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-12 pr-4 py-3.5 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 outline-none font-bold text-sm"
          />
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 text-slate-400 space-y-4">
            <Loader2 size={32} className="animate-spin" />
            <p className="text-sm font-bold uppercase tracking-widest">Loading accounts…</p>
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center text-slate-400 space-y-4">
            <Users size={40} />
            <p className="text-sm font-bold uppercase tracking-widest">{searchTerm ? 'No accounts match your search' : 'No accounts found'}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredUsers.map((user) => {
              const isSelf = user.id === currentUserId;
              const isSuper = user.role === 'super_admin';
              const locked = isSuper || isSelf;
              const busyAct = busy === `activation:${user.id}`;
              const busyRole = busy === `role:${user.id}`;
              return (
                <motion.div
                  key={user.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 p-4 sm:p-5 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-slate-100 dark:border-slate-800"
                >
                  <div className="flex items-center gap-4 min-w-0">
                    <div className={`w-11 h-11 rounded-xl flex items-center justify-center font-black text-sm shrink-0 ${isSuper ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600' : user.is_activated ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600' : 'bg-slate-200 dark:bg-slate-800 text-slate-400'}`}>
                      {(user.full_name || 'A').split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase() || 'A'}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-black text-sm text-slate-900 dark:text-white truncate">{user.full_name || 'Unnamed Student'}</p>
                        {isSelf && <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 bg-slate-200 dark:bg-slate-700 rounded-full text-slate-500">You</span>}
                        <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${isSuper ? 'bg-amber-500/10 text-amber-600' : user.role === 'admin' ? 'bg-indigo-500/10 text-indigo-600' : 'bg-slate-200 dark:bg-slate-700 text-slate-500'}`}>
                          {user.role === 'super_admin' ? 'Super Admin' : user.role}
                        </span>
                        <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${user.is_activated ? 'bg-emerald-500/10 text-emerald-600' : 'bg-red-500/10 text-red-500'}`}>
                          {user.is_activated ? 'Activated' : 'Inactive'}
                        </span>
                      </div>
                      <p className="text-xs font-semibold text-slate-500 truncate flex items-center gap-1.5">
                        <Mail size={12} /> {user.email || 'no email'}
                        {(user.department || user.level) && <span className="text-slate-400">· {[user.department, user.level].filter(Boolean).join(' · ')}</span>}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 flex-wrap lg:justify-end">
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Role</span>
                      <select
                        value={user.role}
                        disabled={locked || busyRole}
                        onChange={(e) => handleRoleChange(user, e.target.value)}
                        className="px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-bold text-xs outline-none disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {ROLE_OPTIONS.map((r) => (
                          <option key={r} value={r} disabled={r === 'super_admin' && !amSuperAdmin}>
                            {r === 'super_admin' ? 'Super Admin' : r === 'admin' ? 'Admin' : 'Student'}
                          </option>
                        ))}
                      </select>
                      {busyRole && <Loader2 size={16} className="animate-spin text-slate-400" />}
                    </div>

                    <button
                      onClick={() => handleToggleActivation(user)}
                      disabled={locked || busyAct}
                      className={`relative w-12 h-7 rounded-full transition-colors duration-200 ${user.is_activated && !locked ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700'} disabled:opacity-40 disabled:cursor-not-allowed`}
                      aria-label={user.is_activated ? 'Deactivate account' : 'Activate account'}
                    >
                      <span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all duration-200 ${user.is_activated ? 'left-6' : 'left-1'}`}>
                        {busyAct && <Loader2 size={12} className="animate-spin text-slate-400 absolute inset-0 m-auto" />}
                      </span>
                    </button>
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 w-16">
                      {user.is_activated ? 'Active' : 'Off'}
                    </span>

                    {locked && (
                      <span className="text-[9px] font-black uppercase tracking-widest text-amber-500 flex items-center gap-1">
                        <Lock size={11} /> {isSuper ? (isSelf ? '' : 'Protected') : 'Yourself'}
                      </span>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex items-start gap-3 p-4 bg-indigo-50 dark:bg-indigo-900/20 rounded-2xl border border-indigo-100 dark:border-indigo-900">
        <ShieldCheck className="shrink-0 text-indigo-500 mt-0.5" size={18} />
        <p className="text-xs font-semibold text-indigo-700 dark:text-indigo-300 leading-relaxed">
          Super admin accounts are protected from modification. You cannot deactivate or change the role of your own account from this screen.
        </p>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
};

const StatCard = ({ title, value, icon, color }) => (
  <div className="bg-white dark:bg-slate-800 p-6 rounded-[2rem] shadow-clinical border border-slate-100 dark:border-slate-700">
    <div className={`w-10 h-10 ${color} rounded-xl flex items-center justify-center mb-4`}>{React.cloneElement(icon, { size: 20 })}</div>
    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{title}</p>
    <p className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">{value}</p>
  </div>
);

export default React.memo(AdminUsers);