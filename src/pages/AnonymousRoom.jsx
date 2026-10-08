import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Loader2,
  RefreshCw,
  Send,
  X,
  Flag,
  Trash2,
  Edit2,
  Users,
  Eye,
  Lock,
  Info,
  MessageCircle,
  MoreHorizontal
} from '../components/Icons';
import { supabase } from '../utils/supabase';
import { communityApi } from '../utils/communityApi';
import { authHeaders } from '../utils/apiHeaders';
import { useAppContext } from '../context/AppContext';

const COLD_AFTER_MS = 110 * 1000;
const LIFE_MS = 60 * 60 * 1000;
const TYPING_TTL_MS = 3000;
const TYPING_THROTTLE_MS = 2500;
const MAX_RECONNECT_ATTEMPTS = 5;

const SEND_ERRORS = {
  SPECTATOR_READ_ONLY: 'Spectators can watch and react, but cannot send messages.',
  ANONYMOUS_MEMBERS_ONLY: 'Only members can speak in the Anonymous room.',
  GROUP_WIPED: 'This round has been wiped. Nothing persists.',
  BANNED: 'Your community access is currently restricted.',
  INVALID_MENTION: 'That @Anonymous #NN does not exist in this room.'
};

const timeOf = (iso) => {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
};

const displayState = (msg, now) => {
  const lives = Date.parse(msg.lives_until || '') || 0;
  if (lives && now > lives) return 'expired';
  const activity = lives ? lives - LIFE_MS : Date.parse(msg.created_at || '');
  return now - activity >= COLD_AFTER_MS ? 'cold' : 'active';
};

const mentionNodes = (text) => {
  const out = [];
  const re = /@Anonymous\s*#(\d{1,4})/gi;
  let last = 0;
  let m;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <span key={key++} className="text-apex-300 font-black">
        {m[0]}
      </span>
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
};

const StatusPill = ({ conn }) => {
  if (conn === 'live') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[9px] font-black uppercase tracking-widest bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Live
      </span>
    );
  }
  if (conn === 'offline') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[9px] font-black uppercase tracking-widest bg-red-500/15 text-red-400 border border-red-500/30">
        <span className="w-1.5 h-1.5 rounded-full bg-red-400" /> Offline
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[9px] font-black uppercase tracking-widest bg-amber-500/15 text-amber-400 border border-amber-500/30">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" /> Connecting
    </span>
  );
};

const GateCard = ({ children }) => (
  <div className="max-w-lg mx-auto px-5 pt-16 pb-10 text-center">
    <div className="bg-slate-900 border border-slate-700/70 rounded-[2rem] p-8 shadow-2xl">{children}</div>
  </div>
);

const AnonymousRoom = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { session } = useAppContext();

  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState('');
  const [room, setRoom] = useState(null);
  const [messages, setMessages] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [sending, setSending] = useState(false);
  const [composerError, setComposerError] = useState('');

  const [conn, setConn] = useState('connecting');
  const [online, setOnline] = useState(null);
  const [typers, setTypers] = useState({});
  const [tick, setTick] = useState(Date.now());
  const [showNewPill, setShowNewPill] = useState(false);
  const [openActions, setOpenActions] = useState(null);
  const [reactFor, setReactFor] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState('');
  const [showRules, setShowRules] = useState(false);
  const [joining, setJoining] = useState(false);
  const [buying, setBuying] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const scrollRef = useRef(null);
  const atBottomRef = useRef(true);
  const channelRef = useRef(null);
  const draftRef = useRef(null);
  const lastTypingSentRef = useRef(0);
  const reconnectFailsRef = useRef(0);
  const [reconnectNonce, setReconnectNonce] = useState(0);
  const firstLoadRef = useRef(true);

  const groupId = room?.group?.id ?? (id ? Number(id) : null);
  const myLabel = room?.my_alias ? `Anonymous #${String(room.my_alias).padStart(2, '0')}` : null;
  const isMember = room?.access === 'member';
  const isSpectator = room?.access === 'spectator';
  const canSpeak = isMember;

  const loadRoom = useCallback(async () => {
    const data = await communityApi(session, '/anonymous/room', id ? { group_id: Number(id) } : {});
    setRoom(data);
    return data;
  }, [session, id]);

  const loadFeed = useCallback(async (targetGroup, before = null) => {
    const data = await communityApi(session, '/anonymous/feed', {
      group_id: targetGroup,
      ...(before ? { before } : {})
    });
    return data;
  }, [session]);

  const bootstrap = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setBooting(true);
    setBootError('');
    try {
      const data = await loadRoom();
      if (data.access === 'member' || data.access === 'spectator') {
        const feed = await loadFeed(data.group.id);
        setMessages(feed.messages || []);
        setHasMore(!!feed.has_more);
        firstLoadRef.current = true;
      } else {
        setMessages([]);
        setHasMore(false);
      }
    } catch (err) {
      setBootError(err.message || 'Could not open the Anonymous room.');
    } finally {
      setBooting(false);
      setRefreshing(false);
    }
  }, [loadRoom, loadFeed]);

  useEffect(() => {
    bootstrap(false);
  }, [bootstrap]);

  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const upsertMessage = useCallback((msg) => {
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === msg.id);
      let next;
      if (idx >= 0) {
        next = [...prev];
        next[idx] = msg;
      } else {
        next = [...prev, msg];
      }
      return next.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    });
  }, []);

  const fetchOneMessage = useCallback(async (messageId) => {
    if (!groupId) return null;
    try {
      const data = await communityApi(session, '/anonymous/message', {
        message_id: messageId,
        group_id: groupId
      });
      return data.message || null;
    } catch (err) {
      if (err.status === 404) {
        await new Promise((r) => setTimeout(r, 400));
        try {
          const retry = await communityApi(session, '/anonymous/message', {
            message_id: messageId,
            group_id: groupId
          });
          return retry.message || null;
        } catch (e2) {
          if (e2.status === 404) {
            setMessages((prev) => prev.filter((m) => m.id !== messageId));
          }
          return null;
        }
      }
      return null;
    }
  }, [session, groupId]);

  const handleBroadcast = useCallback((payload) => {
    if (!payload || !payload.id) return;
    if (payload.t === 'removed') {
      setMessages((prev) => prev.filter((m) => m.id !== payload.id));
      return;
    }
    if (payload.t === 'message' || payload.t === 'edited' || payload.t === 'react') {
      fetchOneMessage(payload.id);
    }
  }, [fetchOneMessage]);

  useEffect(() => {
    if (!supabase || !room?.channel || !groupId) {
      if (!supabase) setConn('offline');
      return undefined;
    }
    const presenceKey =
      isMember && room.my_alias != null
        ? `m:${room.my_alias}`
        : `s:${Math.random().toString(36).slice(2, 10)}`;
    const channel = supabase.channel(room.channel, { config: { presence: { key: presenceKey } } });
    channelRef.current = channel;
    reconnectFailsRef.current = 0;

    channel
      .on('broadcast', { event: 'upsert' }, ({ payload }) => handleBroadcast(payload))
      .on('broadcast', { event: 'gone' }, ({ payload }) => {
        if (payload?.id) setMessages((prev) => prev.filter((m) => m.id !== payload.id));
      })
      .on('broadcast', { event: 'reaction' }, ({ payload }) => handleBroadcast(payload))
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (!payload?.alias || payload.alias === myLabel) return;
        setTypers((prev) => ({ ...prev, [payload.alias]: Date.now() + TYPING_TTL_MS }));
      })
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        const memberKeys = Object.keys(state || {}).filter((k) => k.startsWith('m:'));
        setOnline(memberKeys.length);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          reconnectFailsRef.current = 0;
          setConn('live');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          reconnectFailsRef.current += 1;
          if (reconnectFailsRef.current >= MAX_RECONNECT_ATTEMPTS) {
            supabase.removeChannel(channel);
            channelRef.current = null;
            setConn('offline');
          } else {
            setConn('connecting');
          }
        } else {
          setConn('connecting');
        }
      });

    if (isMember && room.my_alias != null) channel.track({ alias: room.my_alias });
    else channel.track({ spectator: true });

    return () => {
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [room?.channel, room?.my_alias, groupId, isMember, myLabel, handleBroadcast, reconnectNonce]);

  const broadcast = useCallback((event, payload) => {
    try {
      channelRef.current?.send({ type: 'broadcast', event, payload });
    } catch {
      /* realtime unavailable — the next refresh reconciles */
    }
  }, []);

  useEffect(() => {
    if (conn !== 'live') return undefined;
    const el = scrollRef.current;
    if (!el) return undefined;
    if (firstLoadRef.current) {
      firstLoadRef.current = false;
      el.scrollTop = el.scrollHeight;
      atBottomRef.current = true;
      return undefined;
    }
    if (atBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    } else {
      setShowNewPill(true);
    }
    return undefined;
  }, [messages, conn]);

  useEffect(() => {
    if (!messages.length) return undefined;
    const due = messages.filter((m) => {
      const lives = Date.parse(m.lives_until || '');
      return Number.isFinite(lives) && lives <= Date.now();
    });
    if (due.length) {
      due.forEach((m) => fetchOneMessage(m.id));
      return undefined;
    }
    const nextIn = Math.min(
      ...messages
        .map((m) => Date.parse(m.lives_until || '') - Date.now())
        .filter((v) => Number.isFinite(v) && v > 0)
    );
    if (!Number.isFinite(nextIn)) return undefined;
    const t = setTimeout(() => {
      messages.forEach((m) => {
        const lives = Date.parse(m.lives_until || '');
        if (Number.isFinite(lives) && lives <= Date.now()) fetchOneMessage(m.id);
      });
    }, Math.min(nextIn + 300, 60_000));
    return () => clearTimeout(t);
  }, [messages, fetchOneMessage]);

  useEffect(() => {
    const t = setInterval(() => {
      setTypers((prev) => {
        const now = Date.now();
        const next = {};
        let changed = false;
        for (const [alias, until] of Object.entries(prev)) {
          if (until > now) next[alias] = until;
          else changed = true;
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    atBottomRef.current = atBottom;
    if (atBottom) setShowNewPill(false);
  };

  const jumpToBottom = () => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    atBottomRef.current = true;
    setShowNewPill(false);
  };

  const loadOlder = async () => {
    if (!hasMore || loadingOlder || !messages.length || !groupId) return;
    setLoadingOlder(true);
    try {
      const feed = await loadFeed(groupId, messages[0].created_at);
      const el = scrollRef.current;
      const keep = el ? el.scrollHeight - el.scrollTop : 0;
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        const older = (feed.messages || []).filter((m) => !seen.has(m.id));
        return [...older, ...prev];
      });
      setHasMore(!!feed.has_more);
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - keep;
      });
    } catch (err) {
      console.error('anonymous room older load', err);
    } finally {
      setLoadingOlder(false);
    }
  };

  const notifyTyping = () => {
    const now = Date.now();
    if (now - lastTypingSentRef.current < TYPING_THROTTLE_MS) return;
    lastTypingSentRef.current = now;
    broadcast('typing', { alias: myLabel });
  };

  const sendMessage = async () => {
    const content = draft.trim();
    if (!content || sending || !groupId) return;
    setSending(true);
    setComposerError('');
    try {
      const data = await communityApi(session, '/anonymous/send', {
        content,
        group_id: groupId,
        ...(replyTo ? { reply_to_post_id: replyTo.id } : {})
      });
      upsertMessage(data.message);
      setDraft('');
      if (draftRef.current) draftRef.current.style.height = 'auto';
      setReplyTo(null);
      jumpToBottom();
      broadcast('upsert', { t: 'message', id: data.message.id });
    } catch (err) {
      const mapped = SEND_ERRORS[err.code];
      setComposerError(mapped || err.message || 'Message could not be sent.');
      if (err.code === 'GROUP_WIPED' || err.code === 'BANNED' || err.code === 'ANONYMOUS_MEMBERS_ONLY') {
        bootstrap(true);
      }
    } finally {
      setSending(false);
    }
  };

  const toggleReaction = async (msg, emoji, active) => {
    try {
      const data = await communityApi(session, '/anonymous/react', {
        message_id: msg.id,
        emoji,
        active,
        group_id: groupId
      });
      setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, reactions: data.reactions } : m)));
      broadcast('reaction', { t: 'react', id: msg.id });
    } catch (err) {
      alert(SEND_ERRORS[err.code] || err.message || 'Reaction could not be saved.');
    } finally {
      setReactFor(null);
      setOpenActions(null);
    }
  };

  const deleteMessage = async (msg) => {
    if (!window.confirm('Delete this message? It disappears for everyone.')) return;
    try {
      await communityApi(session, '/posts/delete', { post_id: msg.id });
      setMessages((prev) => prev.filter((m) => m.id !== msg.id));
      broadcast('gone', { t: 'removed', id: msg.id });
    } catch (err) {
      alert(err.message || 'Could not delete this message.');
    } finally {
      setOpenActions(null);
    }
  };

  const saveEdit = async (msg) => {
    const content = editDraft.trim();
    if (!content) return;
    try {
      await communityApi(session, '/posts/edit', { post_id: msg.id, content });
      setMessages((prev) =>
        prev.map((m) => (m.id === msg.id ? { ...m, content, edited: true } : m))
      );
      setEditingId(null);
      setEditDraft('');
      broadcast('upsert', { t: 'edited', id: msg.id });
    } catch (err) {
      alert(SEND_ERRORS[err.code] || err.message || 'Could not save the edit.');
    }
  };

  const reportMessage = async (msg) => {
    setOpenActions(null);
    const reason = window.prompt('Why are you reporting this message?');
    if (!reason || !reason.trim()) return;
    try {
      await communityApi(session, '/posts/report', {
        post_id: msg.id,
        reason: reason.trim().slice(0, 200)
      });
      alert('Reported. Thank you.');
    } catch (err) {
      alert(err.message || 'Could not submit the report.');
    }
  };

  const joinRoom = async () => {
    if (!groupId || joining) return;
    setJoining(true);
    try {
      await communityApi(session, '/groups/join', { group_id: groupId });
      await bootstrap(true);
    } catch (err) {
      alert(err.message || 'Could not join right now.');
    } finally {
      setJoining(false);
    }
  };

  const leaveRoom = async () => {
    if (!groupId || leaving) return;
    if (!window.confirm('Leave the Anonymous room? Your messages stay posted anonymously.')) return;
    setLeaving(true);
    try {
      await communityApi(session, '/groups/leave', { group_id: groupId });
      setShowRules(false);
      await bootstrap(true);
    } catch (err) {
      alert(err.message || 'Could not leave right now.');
    } finally {
      setLeaving(false);
    }
  };

  const buySpectator = async () => {
    if (!groupId || buying) return;
    setBuying(true);
    try {
      const res = await fetch('/api/initiate-payment', {
        method: 'POST',
        headers: { ...authHeaders(session, { json: true }) },
        body: JSON.stringify({ product: 'anonymous_spectate', group_id: groupId })
      });
      const body = await res.json();
      if (res.ok && body.authorization_url) {
        window.location.assign(body.authorization_url);
        return;
      }
      alert(body.error || body.message || 'Payment could not be started.');
    } catch {
      alert('Could not start payment. Check your connection and try again.');
    } finally {
      setBuying(false);
    }
  };

  const refresh = () => bootstrap(true);

  const retryConnection = () => {
    setReconnectNonce((n) => n + 1);
    setConn('connecting');
  };

  const typerList = useMemo(
    () => Object.keys(typers).filter((a) => typers[a] > tick && a !== myLabel),
    [typers, tick, myLabel]
  );

  const onDraftChange = (e) => {
    setDraft(e.target.value);
    setComposerError('');
    notifyTyping();
    const el = draftRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    }
  };

  if (booting) {
    return (
      <div className="h-[100dvh] bg-slate-950 flex items-center justify-center">
        <Loader2 className="animate-spin text-apex-500" size={34} />
      </div>
    );
  }

  if (bootError && !room) {
    return (
      <div className="h-[100dvh] bg-slate-950 text-slate-200">
        <GateCard>
          <MessageCircle size={38} className="mx-auto mb-3 text-red-400" />
          <h1 className="text-xl font-black text-white">The room didn't load</h1>
          <p className="text-sm text-slate-400 font-medium mt-2">{bootError}</p>
          <div className="flex items-center justify-center gap-3 mt-6">
            <button
              onClick={() => navigate('/study-groups')}
              className="px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 font-black text-xs uppercase tracking-widest"
            >
              Back to groups
            </button>
            <button
              onClick={refresh}
              className="px-4 py-2.5 rounded-xl bg-apex-600 text-white font-black text-xs uppercase tracking-widest"
            >
              Retry
            </button>
          </div>
        </GateCard>
      </div>
    );
  }

  const thresholds = room?.thresholds || {};
  const price = room?.group?.spectator_price;
  const memberCount = room?.member_count;

  if (room && room.access === 'banned') {
    return (
      <div className="h-[100dvh] bg-slate-950 text-slate-200">
        <GateCard>
          <Lock size={38} className="mx-auto mb-3 text-red-400" />
          <h1 className="text-xl font-black text-white">Access restricted</h1>
          <p className="text-sm text-slate-400 font-medium mt-2">
            Your community access is currently restricted.
          </p>
          <button
            onClick={() => navigate('/community')}
            className="mt-6 px-5 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 font-black text-xs uppercase tracking-widest"
          >
            Back to Community
          </button>
        </GateCard>
      </div>
    );
  }

  if (room && room.access === 'wiped') {
    return (
      <div className="h-[100dvh] bg-slate-950 text-slate-200">
        <GateCard>
          <div className="text-4xl mb-3">💀</div>
          <h1 className="text-xl font-black text-white">This round was wiped.</h1>
          <p className="text-sm text-slate-400 font-medium mt-2">
            Membership fell below {thresholds.survive ?? 'the minimum'} and the Anonymous round
            closed. Every message has been hidden — nothing persisted.
          </p>
          <button
            onClick={() => navigate('/study-groups')}
            className="mt-6 px-5 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 font-black text-xs uppercase tracking-widest"
          >
            Back to groups
          </button>
        </GateCard>
      </div>
    );
  }

  if (room && room.access === 'join') {
    const target = thresholds.activate ?? 10;
    const pct = Math.min(100, Math.round(((memberCount || 0) / target) * 100));
    return (
      <div className="h-[100dvh] bg-slate-950 text-slate-200">
        <GateCard>
          <div className="text-4xl mb-3">⏳</div>
          <h1 className="text-xl font-black text-white">The room is filling up.</h1>
          <p className="text-sm text-slate-400 font-medium mt-2">
            Messages open at{' '}
            <span className="text-amber-400 font-black">{target} members</span> — then the room
            closes to new joiners. Anyone joining now gets a spot.
          </p>
          <div className="mt-5">
            <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">
              <span>Joined</span>
              <span className="text-amber-400">
                {memberCount ?? '…'} / {target}
              </span>
            </div>
            <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-amber-500 to-apex-500 transition-all duration-700"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
          <div className="flex items-center justify-center gap-3 mt-6">
            <button
              onClick={() => navigate('/study-groups')}
              className="px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 font-black text-xs uppercase tracking-widest"
            >
              Back
            </button>
            <button
              onClick={joinRoom}
              disabled={joining}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-apex-600 text-white font-black text-xs uppercase tracking-widest hover:bg-apex-700 disabled:opacity-50 transition"
            >
              {joining ? <Loader2 size={14} className="animate-spin" /> : <Users size={14} />}
              Join as Anonymous
            </button>
          </div>
        </GateCard>
      </div>
    );
  }

  if (room && room.access === 'closed') {
    return (
      <div className="h-[100dvh] bg-slate-950 text-slate-200">
        <GateCard>
          <Lock size={38} className="mx-auto mb-3 text-emerald-400" />
          <h1 className="text-xl font-black text-white">Membership is closed.</h1>
          <p className="text-sm text-slate-400 font-medium mt-2">
            This room is now {memberCount ?? '…'} members strong. Watch it anonymously with a
            one-time <span className="text-white font-black">₦{price ?? '…'}</span> spectator
            pass — read and react, never post.
          </p>
          <div className="flex items-center justify-center gap-3 mt-6">
            <button
              onClick={() => navigate('/study-groups')}
              className="px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 font-black text-xs uppercase tracking-widest"
            >
              Back
            </button>
            <button
              onClick={buySpectator}
              disabled={buying}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-apex-600 text-white font-black text-xs uppercase tracking-widest hover:bg-apex-700 disabled:opacity-50 transition"
            >
              {buying ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
              Watch as Spectator — ₦{price ?? '…'}
            </button>
          </div>
        </GateCard>
      </div>
    );
  }

  const typerLabel =
    typerList.length === 1
      ? `${typerList[0]} is typing…`
      : typerList.length > 1
        ? `${typerList.length} people are typing…`
        : '';

  return (
    <div className="relative h-[100dvh] bg-slate-950 text-slate-200 flex flex-col overflow-hidden">
      <header className="shrink-0 border-b border-slate-800/80 bg-slate-950/95 backdrop-blur px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => navigate('/study-groups')}
          className="w-9 h-9 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-400 hover:text-white transition shrink-0"
          aria-label="Back"
        >
          <ArrowLeft size={16} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-sm font-black text-white truncate">
              {room?.group?.name || 'Anonymous'}
            </h1>
            <StatusPill conn={conn === 'live' ? 'live' : conn} />
            {conn === 'offline' && (
              <button
                onClick={retryConnection}
                className="text-[9px] font-black uppercase tracking-widest text-apex-400 hover:text-apex-300"
              >
                Reconnect
              </button>
            )}
          </div>
          <p className="text-[10px] font-bold text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
            {isMember && myLabel && <span className="text-apex-400 font-black">{myLabel}</span>}
            {online !== null && (
              <span className="inline-flex items-center gap-1">
                <Users size={10} /> {online} online
              </span>
            )}
            {typeof memberCount === 'number' && (
              <span className="inline-flex items-center gap-1">
                <MessageCircle size={10} /> {memberCount} members
              </span>
            )}
            {room?.group?.group_state === 'waiting' && (
              <span className="text-amber-400">
                opens at {thresholds.activate ?? 10}
              </span>
            )}
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={refreshing}
          className="w-9 h-9 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-400 hover:text-white transition shrink-0 disabled:opacity-50"
          aria-label="Refresh"
        >
          <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
        </button>
        <button
          onClick={() => setShowRules(true)}
          className="w-9 h-9 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-400 hover:text-white transition shrink-0"
          aria-label="Room rules"
        >
          <Info size={15} />
        </button>
      </header>

      {isSpectator && (
        <div className="shrink-0 px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 text-[11px] font-bold text-amber-300 flex items-center gap-2">
          <Eye size={13} className="shrink-0" />
          You're watching as a spectator — read and react only.
        </div>
      )}

      <main
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-1"
      >
        {hasMore && (
          <div className="flex justify-center pb-3">
            <button
              onClick={loadOlder}
              disabled={loadingOlder}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-slate-900 border border-slate-800 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-white disabled:opacity-50"
            >
              {loadingOlder && <Loader2 size={12} className="animate-spin" />}
              Load earlier messages
            </button>
          </div>
        )}

        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <MessageCircle size={34} className="text-slate-700 mb-3" />
            <p className="text-slate-500 font-black text-sm">
              {isSpectator
                ? 'The room is quiet right now — messages here are ephemeral.'
                : 'No messages yet. Say the first thing.'}
            </p>
          </div>
        )}

        {messages.map((msg) => {
          const state = displayState(msg, tick);
          const isOpen = openActions === msg.id;
          const isEditing = editingId === msg.id;
          return (
            <div
              key={msg.id}
              className={`group px-1 py-1.5 ${isOpen ? 'bg-slate-900/70 rounded-2xl' : ''}`}
            >
              <div className="flex items-start gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center text-[10px] font-black text-slate-500 shrink-0 mt-0.5">
                  {String(msg.alias ?? '?').padStart(2, '0')}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-black text-apex-300">{msg.author}</span>
                    {msg.is_mine && (
                      <span className="px-1.5 py-0.5 rounded-full bg-apex-500/15 text-apex-400 text-[8px] font-black uppercase tracking-widest">
                        You
                      </span>
                    )}
                    <span className="text-[10px] font-bold text-slate-600">{timeOf(msg.created_at)}</span>
                    {msg.edited && (
                      <span className="text-[10px] font-bold text-slate-600 italic">edited</span>
                    )}
                    {state === 'cold' && (
                      <span className="px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-500 text-[8px] font-black uppercase tracking-widest">
                        Expiring soon
                      </span>
                    )}
                  </div>

                  {msg.reply && (
                    <div className="mt-1 pl-2.5 border-l-2 border-slate-800 text-[11px] font-medium text-slate-500 truncate">
                      ↩{' '}
                      {msg.reply.deleted ? (
                        <span className="italic text-slate-600">deleted message</span>
                      ) : (
                        <>
                          <span className="text-slate-400 font-black">{msg.reply.author}</span>{' '}
                          {msg.reply.excerpt}
                        </>
                      )}
                    </div>
                  )}

                  {isEditing ? (
                    <div className="mt-1.5">
                      <textarea
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                        rows={2}
                        autoFocus
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl p-2.5 text-sm font-medium text-slate-200 outline-none focus:border-apex-500 resize-none"
                      />
                      <div className="flex justify-end gap-2 mt-1.5">
                        <button
                          onClick={() => {
                            setEditingId(null);
                            setEditDraft('');
                          }}
                          className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-400 text-[10px] font-black uppercase tracking-widest"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => saveEdit(msg)}
                          disabled={!editDraft.trim()}
                          className="px-3 py-1.5 rounded-lg bg-apex-600 text-white text-[10px] font-black uppercase tracking-widest disabled:opacity-40"
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm font-medium text-slate-300 mt-0.5 whitespace-pre-wrap break-words leading-relaxed">
                      {mentionNodes(msg.content)}
                    </p>
                  )}

                  {msg.reactions?.length > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                      {msg.reactions.map((r) => (
                        <button
                          key={r.emoji}
                          onClick={() => toggleReaction(msg, r.emoji, !r.mine)}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-black border transition ${
                            r.mine
                              ? 'bg-apex-500/20 border-apex-500/50 text-apex-300'
                              : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                          }`}
                        >
                          <span>{r.emoji}</span>
                          <span>{r.count}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {reactFor === msg.id && (
                    <div className="flex items-center gap-1 mt-2 flex-wrap">
                      {(room?.config?.reactions || []).map((emoji) => {
                        const existing = (msg.reactions || []).find((r) => r.emoji === emoji);
                        return (
                          <button
                            key={emoji}
                            onClick={() => toggleReaction(msg, emoji, !existing?.mine)}
                            className="w-9 h-9 rounded-xl bg-slate-900 border border-slate-800 text-base hover:border-apex-500/60 transition"
                          >
                            {emoji}
                          </button>
                        );
                      })}
                      <button
                        onClick={() => setReactFor(null)}
                        className="w-9 h-9 rounded-xl bg-slate-900 border border-slate-800 text-slate-500 hover:text-white transition"
                      >
                        <X size={14} className="mx-auto" />
                      </button>
                    </div>
                  )}

                  {isOpen && !isEditing && (
                    <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                      {canSpeak && (
                        <button
                          onClick={() => {
                            setReplyTo(msg);
                            setOpenActions(null);
                            draftRef.current?.focus();
                          }}
                          className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-white"
                        >
                          ↩ Reply
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setReactFor(reactFor === msg.id ? null : msg.id);
                          setOpenActions(null);
                        }}
                        className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-white"
                        disabled={!(room?.config?.reactions || []).length}
                      >
                        React
                      </button>
                      {msg.is_mine && (
                        <>
                          <button
                            onClick={() => {
                              setEditingId(msg.id);
                              setEditDraft(msg.content);
                              setOpenActions(null);
                            }}
                            className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-white"
                          >
                            <Edit2 size={11} className="inline mr-1" />
                            Edit
                          </button>
                          <button
                            onClick={() => deleteMessage(msg)}
                            className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-[10px] font-black uppercase tracking-widest text-red-400 hover:text-red-300"
                          >
                            <Trash2 size={11} className="inline mr-1" />
                            Delete
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => reportMessage(msg)}
                        className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-white"
                      >
                        <Flag size={11} className="inline mr-1" />
                        Report
                      </button>
                    </div>
                  )}

                  {isOpen && (
                    <button
                      onClick={() => setOpenActions(null)}
                      className="mt-1 text-[10px] font-black uppercase tracking-widest text-slate-600 hover:text-slate-400"
                    >
                      Close
                    </button>
                  )}
                </div>
                <button
                  onClick={() => {
                    setOpenActions(isOpen ? null : msg.id);
                    setReactFor(null);
                  }}
                  className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-slate-600 hover:text-slate-300 transition shrink-0 mt-1"
                  aria-label="Message actions"
                >
                  <MoreHorizontal size={16} />
                </button>
              </div>
            </div>
          );
        })}
      </main>

      {showNewPill && (
        <button
          onClick={jumpToBottom}
          className="absolute left-1/2 -translate-x-1/2 bottom-32 z-10 px-4 py-2 rounded-full bg-apex-600 text-white text-[10px] font-black uppercase tracking-widest shadow-lg"
        >
          New messages ↓
        </button>
      )}

      <footer className="shrink-0 border-t border-slate-800/80 bg-slate-950/95 backdrop-blur px-4 pt-2.5 pb-safe">
        <div className="h-4 text-[11px] font-bold text-slate-500 px-1">
          {typerLabel && (
            <span className="inline-flex items-center gap-1.5">
              <span className="flex gap-0.5">
                <span className="w-1 h-1 rounded-full bg-slate-600 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1 h-1 rounded-full bg-slate-600 animate-bounce" style={{ animationDelay: '120ms' }} />
                <span className="w-1 h-1 rounded-full bg-slate-600 animate-bounce" style={{ animationDelay: '240ms' }} />
              </span>
              {typerLabel}
            </span>
          )}
        </div>

        {replyTo && (
          <div className="flex items-center justify-between gap-2 px-3 py-2 mb-2 rounded-xl bg-slate-900 border border-slate-800">
            <div className="min-w-0 text-[11px] font-medium text-slate-500">
              ↩ Replying to <span className="text-apex-300 font-black">{replyTo.author}</span>{' '}
              <span className="truncate">{replyTo.content}</span>
            </div>
            <button
              onClick={() => setReplyTo(null)}
              className="text-slate-500 hover:text-white shrink-0"
              aria-label="Cancel reply"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {composerError && (
          <p className="text-[11px] font-bold text-red-400 px-1 mb-2">{composerError}</p>
        )}

        <div className="flex items-end gap-2 pb-2">
          <textarea
            ref={draftRef}
            value={draft}
            onChange={onDraftChange}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            rows={1}
            maxLength={room?.config?.max_content || 1000}
            disabled={!canSpeak}
            placeholder={
              canSpeak
                ? `Message as ${myLabel || 'Anonymous'}…`
                : isSpectator
                  ? 'Spectators cannot send messages.'
                  : 'Members only.'
            }
            className="flex-1 bg-slate-900 border border-slate-800 rounded-2xl px-4 py-3 text-sm font-medium text-slate-200 placeholder:text-slate-600 outline-none focus:border-apex-500/70 resize-none disabled:opacity-60 max-h-[120px]"
          />
          <button
            onClick={sendMessage}
            disabled={!canSpeak || sending || !draft.trim()}
            className="w-11 h-11 rounded-2xl bg-apex-600 text-white flex items-center justify-center shrink-0 disabled:opacity-40 hover:bg-apex-700 transition"
            aria-label="Send"
          >
            {sending ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />}
          </button>
        </div>
      </footer>

      {showRules && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-5">
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-3xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-black text-white text-lg">Room rules</h2>
              <button onClick={() => setShowRules(false)} className="text-slate-500 hover:text-white">
                <X size={18} />
              </button>
            </div>
            <ul className="space-y-3 text-sm font-medium text-slate-400">
              <li className="flex gap-2">
                <span className="text-apex-400 font-black">01</span>
                Your identity here is a temporary server-issued number (Anonymous #NN). Never share
                real names, handles or phone numbers.
              </li>
              <li className="flex gap-2">
                <span className="text-apex-400 font-black">02</span>
                Members speak; spectators watch and react only.
              </li>
              <li className="flex gap-2">
                <span className="text-apex-400 font-black">03</span>
                Every message is ephemeral — it dies an hour after the room stops touching it, and
                a wiped round erases everything.
              </li>
              <li className="flex gap-2">
                <span className="text-apex-400 font-black">04</span>
                The room opens at {thresholds.activate ?? '—'} members and is wiped if it drops
                below {thresholds.survive ?? '—'}.
              </li>
            </ul>
            {isMember && (
              <button
                onClick={leaveRoom}
                disabled={leaving}
                className="mt-5 w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-400 font-black text-xs uppercase tracking-widest hover:text-white disabled:opacity-50"
              >
                {leaving ? 'Leaving…' : 'Leave the room'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default AnonymousRoom;
