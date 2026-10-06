import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { ArrowLeft, Users, Plus, RefreshCw, Loader2, LogOut, Copy, XCircle, Sparkles, Zap } from '../components/Icons';
import BrandLogo from '../components/BrandLogo';

const Rooms = () => {
  const navigate = useNavigate();
  const { createRoom, joinRoom, leaveRoom, getActiveRooms, getMyRoom } = useAppContext();

  const [myRoom, setMyRoom] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [name, setName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [toast, setToast] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [myRes, listRes] = await Promise.all([getMyRoom(), getActiveRooms()]);
      setMyRoom(myRes);
      setRooms(Array.isArray(listRes) ? listRes : []);
    } finally {
      setLoading(false);
    }
  }, [getMyRoom, getActiveRooms]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setRoomState = (roomInfo) => {
    if (!roomInfo || !roomInfo.roomId) {
      setMyRoom(null);
    } else {
      setMyRoom({ roomId: roomInfo.roomId, code: roomInfo.code, name: roomInfo.name, hostId: roomInfo.hostId, memberCount: roomInfo.memberCount });
    }
  };

  const onCreate = async () => {
    setBusy('create');
    setToast(null);
    try {
      const res = await createRoom(name.trim() || null);
      if (res?.ok) {
        setToast({ type: 'success', text: `Room created — share code ${res.code}` });
        setRoomState(res);
      } else {
        setToast({ type: 'error', text: ROOM_ERR[res?.error] || 'Could not create a room.' });
      }
    } finally {
      setBusy(null);
    }
  };

  const onJoin = async (code) => {
    const c = (code || joinCode).trim().toUpperCase();
    if (!c) { setToast({ type: 'error', text: 'Enter a room code.' }); return; }
    setBusy('join');
    setToast(null);
    try {
      const res = await joinRoom(c);
      if (res?.ok) {
        setRoomState({ roomId: res.roomId, code: res.code, name: res.name, hostId: res.hostId });
        setJoinCode('');
        setToast({ type: 'success', text: `Joined ${res.name || 'Study Room'}!` });
      } else {
        setToast({ type: 'error', text: ROOM_ERR[res?.error] || 'Could not join.' });
      }
    } finally {
      setBusy(null);
    }
  };

  const onLeave = async () => {
    setBusy('leave');
    setToast(null);
    try {
      await leaveRoom();
      setMyRoom(null);
      await refresh();
      setToast({ type: 'success', text: 'You left the room.' });
    } finally {
      setBusy(null);
    }
  };

  const copyCode = async (code) => {
    try {
      await navigator.clipboard.writeText(code || '');
      setToast({ type: 'success', text: 'Code copied!' });
    } catch {
      setToast({ type: 'error', text: 'Could not copy.' });
    }
  };

  const ttl = (secs) => {
    const m = Math.max(0, Math.floor((Number(secs) || 0) / 60));
    const s = Math.max(0, (Number(secs) || 0) % 60);
    return `${m}m ${s}s`;
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={() => navigate('/dashboard')}
          className="flex items-center gap-2 text-slate-500 dark:text-slate-400 hover:text-polynurse-700 dark:hover:text-polynurse-300 font-bold text-sm transition"
        >
          <ArrowLeft size={18} /> Back
        </button>
        <button onClick={refresh} disabled={loading} className="flex items-center gap-2 text-polynurse-700 dark:text-polynurse-300 font-black text-xs uppercase tracking-widest disabled:opacity-40 transition">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <div className="bg-polynurse-700 rounded-[2.5rem] p-8 text-white shadow-xl relative overflow-hidden mb-6">
        <div className="absolute top-0 right-0 p-8 opacity-10">
          <Sparkles size={120} />
        </div>
        <h1 className="text-2xl font-black uppercase tracking-tight relative z-10">Party Rooms</h1>
        <p className="text-[10px] uppercase font-black text-white/70 tracking-widest relative z-10 mt-1">
          Shareable 2-hour study rooms · bring a friend
        </p>
      </div>

      {toast && (
        <div className={`mb-4 flex items-center justify-between gap-3 text-sm font-bold rounded-2xl px-4 py-3 ${
          toast.type === 'success' ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400'
            : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'}`}>
          <span>{toast.text}</span>
          <button onClick={() => setToast(null)} aria-label="Dismiss"><XCircle size={16} /></button>
        </div>
      )}

      {myRoom && (
        <div className="mb-4 bg-white dark:bg-slate-800 rounded-[2rem] shadow-clinical border-2 border-polynurse-400 p-6">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <p className="text-xl font-black text-slate-900 dark:text-white">{myRoom.name || 'Study Room'}</p>
              <button onClick={() => copyCode(myRoom.code)} className="mt-1 inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-polynurse-600 dark:text-polynurse-300 hover:underline">
                <Copy size={12} /> {myRoom.code} — tap to copy
              </button>
              <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400 mt-1">You're in this room</p>
            </div>
            <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-slate-400">
              <Users size={12} /> {myRoom.memberCount || 1}
            </span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => copyCode(myRoom.code)}
              className="flex-1 flex items-center justify-center gap-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl py-2.5 font-black text-xs uppercase tracking-widest text-polynurse-700 dark:text-polynurse-300 hover:border-polynurse-300 transition"
            >
              <Copy size={14} /> Copy Code
            </button>
            <button
              onClick={onLeave}
              disabled={busy === 'leave'}
              className="flex items-center gap-2 bg-red-50 dark:bg-red-900/20 text-red-500 border border-red-200 dark:border-red-900/40 rounded-xl px-4 py-2.5 font-black text-xs uppercase tracking-widest disabled:opacity-50 hover:bg-red-100 dark:hover:bg-red-900/30 transition"
            >
              {busy === 'leave' ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />} Leave
            </button>
          </div>
        </div>
      )}

      {!myRoom && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-800 rounded-[2rem] shadow-clinical border border-slate-100 dark:border-slate-700 p-5">
            <p className="font-black text-slate-900 dark:text-white mb-3">Create a room</p>
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                placeholder="Room name (optional)"
                maxLength={60}
                value={name}
                onChange={e => setName(e.target.value)}
                className="flex-1 bg-slate-100 dark:bg-slate-900 border border-white/10 rounded-xl py-2.5 px-4 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-polynurse-400"
              />
              <button
                onClick={onCreate}
                disabled={busy === 'create'}
                className="flex items-center gap-2 bg-polynurse-600 hover:bg-polynurse-700 text-white rounded-xl px-5 py-2.5 font-black text-xs uppercase tracking-widest disabled:opacity-50 transition"
              >
                {busy === 'create' ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Create
              </button>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="JOIN CODE"
                maxLength={6}
                value={joinCode}
                onChange={e => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                className="flex-1 bg-slate-100 dark:bg-slate-900 border border-white/10 rounded-xl py-2.5 px-4 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-polynurse-400 uppercase tracking-widest"
              />
              <button
                onClick={() => onJoin(null)}
                disabled={busy === 'join'}
                className="flex items-center gap-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-5 py-2.5 font-black text-xs uppercase tracking-widest text-polynurse-700 dark:text-polynurse-300 hover:border-polynurse-300 disabled:opacity-50 transition"
              >
                {busy === 'join' ? <Loader2 size={14} className="animate-spin" /> : 'Join'}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-polynurse-600" /></div>
      ) : !myRoom && rooms.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-[2rem] shadow-clinical border border-slate-100 dark:border-slate-700 p-10 text-center">
          <Zap className="mx-auto text-slate-300 dark:text-slate-600 mb-3" size={40} />
          <p className="text-slate-500 dark:text-slate-400 font-bold">No live rooms right now. Create one and invite a friend!</p>
        </div>
      ) : rooms.length > 0 ? (
        <div className="mt-2">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Live rooms</p>
          <ul className="space-y-2">
            {rooms.filter(r => !myRoom || r.id !== myRoom.roomId).map(r => (
              <li key={r.id} className="flex items-center gap-3 bg-white dark:bg-slate-800 rounded-2xl shadow-clinical border border-slate-100 dark:border-slate-700 px-4 py-3">
                <span className="w-9 h-9 flex items-center justify-center rounded-xl bg-polynurse-50 dark:bg-polynurse-900/20 text-xs">
                  <Users size={16} className="text-polynurse-600 dark:text-polynurse-300" />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-black text-slate-900 dark:text-white truncate">{r.name || 'Study Room'}</p>
                  <p className="text-[10px] font-bold text-slate-400">
                    {r.memberCount} {r.memberCount === 1 ? 'member' : 'members'} · expires in {ttl(r.expiresInSeconds)}
                  </p>
                </div>
                <button
                  onClick={() => onJoin(r.code)}
                  disabled={busy === 'join'}
                  className="text-[10px] font-black uppercase tracking-widest text-polynurse-700 dark:text-polynurse-300 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-polynurse-300 disabled:opacity-50 transition"
                >
                  Join
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-8 flex justify-center">
        <BrandLogo variant="mark" size="md" />
      </div>
    </div>
  );
};

const ROOM_ERR = {
  ALREADY_IN_ROOM: 'You are already in a room. Leave it first.',
  ROOM_GONE: 'That room has expired or closed.',
  UNKNOWN_ROOM_CODE: 'No room found for that code.',
  NOT_IN_ROOM: 'You are not in a room.',
  default: 'Could not do that right now.'
};

export default Rooms;