import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  useLayoutEffect,
} from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowUp,
  ArrowDown,
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
  Unlock,
  Info,
  MessageCircle,
  MoreHorizontal,
  CornerUpLeft,
  Smile,
  Crown,
  BellOff,
  Shield,
  Bell,
  Volume2,
  VolumeX,
  Sparkles,
  Swords,
  Plus,
} from '../components/Icons';
import { communityApi } from '../utils/communityApi';
import { authHeaders } from '../utils/apiHeaders';
import { useAnonymousRoomRealtime } from '../hooks/useAnonymousRoomRealtime';
import { useAppContext } from '../context/AppContext';
import { playMessagePop, playJoinChime, playSocialTone } from '../utils/anonSound';
import { pushSupported, getPushState, enablePush, disablePush, savePreferences } from '../utils/push';

const TYPING_TTL_MS = 3000;
const TYPING_THROTTLE_MS = 2500;
const MUTE_KEY = 'apex:anon_muted_aliases';

const REPORT_CATEGORIES = [
  { value: 'harassment', label: 'Harassment or bullying' },
  { value: 'hate', label: 'Hate speech' },
  { value: 'self_harm', label: 'Self-harm or crisis' },
  { value: 'sexual', label: 'Sexual content' },
  { value: 'personal_info', label: 'Sharing personal info' },
  { value: 'spam', label: 'Spam or scams' },
  { value: 'other', label: 'Something else' },
];

const SEND_ERRORS = {
  SPECTATOR_READ_ONLY: 'Spectators can watch and react, but cannot send messages.',
  ANONYMOUS_MEMBERS_ONLY: 'Only members can speak in the Anonymous room.',
  GROUP_WIPED: 'This round has been wiped. Nothing persists.',
  BANNED: 'Your community access is currently restricted.',
  INVALID_MENTION: 'That @Anonymous #NN does not exist in this room.',
  NOTICE_REQUIRED: 'Accept the room safety notice before you speak.',
  GROUP_FULL: 'The room is at capacity. A spectator pass is available instead.',
  MEMBERSHIP_LOCKED: 'The host has closed membership. A spectator pass is available instead.',
  REPORT_RATE_LIMITED: 'You have sent too many reports. Please wait a while.',
  CONTENT_REQUIRED: 'Write something first.',
  CONTENT_TOO_LONG: 'That message is too long.',
  PREMIUM_REQUIRED: 'Encoded Messages are a premium feature.',
  RECIPIENT_REQUIRED: 'Choose who can read this Encoded Message.',
  INVALID_RECIPIENT: 'Pick another member of this room to encode to.',
  ENCODED_PRIVATE: 'This is a private Encoded Message.',
  TAG_NOT_ALLOWED: 'That tag is not available.',
  SOCIAL_NOT_ALLOWED: 'That action is not available.',
  SOCIAL_COOLDOWN: 'Give it a moment before the next action.',
  SOCIAL_BLOCKED: 'This member is not accepting that action.',
  SCHEMA_NOT_READY: 'That feature is not available just yet.',
};

// Server allowlist tones → explicit classes (Tailwind must see full strings).
const TAG_TONE_CLASS = {
  sky: 'bg-sky-500/15 text-sky-300 border-sky-500/40',
  emerald: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  rose: 'bg-rose-500/15 text-rose-300 border-rose-500/40',
  violet: 'bg-violet-500/15 text-violet-300 border-violet-500/40',
  amber: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  indigo: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/40',
};

const SOUND_KEY = 'soundEnabled';

const loadSound = () => {
  try {
    const raw = localStorage.getItem(SOUND_KEY);
    return raw === null ? true : raw === 'true';
  } catch {
    return true;
  }
};

const timeOf = (iso) => {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
};

const loadMuted = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(MUTE_KEY) || '[]');
    return new Set(Array.isArray(raw) ? raw : []);
  } catch {
    return new Set();
  }
};

const aliasNum = (msg) => {
  const fromAlias = Number(msg?.alias);
  if (Number.isFinite(fromAlias)) return fromAlias;
  const m = String(msg?.author || '').match(/#(\d+)/);
  return m ? Number(m[1]) : null;
};

// Deterministic per-identity colour so the same Anonymous #NN always looks the
// same within a round without ever touching a real identity.
const identityHue = (alias) => {
  const n = Number(alias);
  if (!Number.isFinite(n)) return 220;
  return (n * 47) % 360;
};

const identityStyle = (alias) => ({ color: `hsl(${identityHue(alias)} 78% 72%)` });

const mentionNodes = (text, onMention) => {
  const out = [];
  const re = /@Anonymous\s*#(\d{1,4})/gi;
  let last = 0;
  let m;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const label = m[0];
    out.push(
      <button
        key={`m${key++}`}
        type="button"
        onClick={() => onMention?.(Number(m[1]))}
        className="font-black underline decoration-dotted"
        style={identityStyle(Number(m[1]))}
      >
        {label}
      </button>
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
};

// Compact m:ss used by the subtle "Expires in …" hint.
const fmtMSS = (ms) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
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
  if (conn === 'reconnecting') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[9px] font-black uppercase tracking-widest bg-orange-500/15 text-orange-400 border border-orange-500/30">
        <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" /> Reconnecting
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
  const [systemEvents, setSystemEvents] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [sending, setSending] = useState(false);
  const [composerError, setComposerError] = useState('');

  const [typers, setTypers] = useState({});
  const [tick, setTick] = useState(Date.now());
  const [showNewPill, setShowNewPill] = useState(false);
  const [openActions, setOpenActions] = useState(null);
  const [reactFor, setReactFor] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState('');
  const [highlightId, setHighlightId] = useState(null);
  const [muted, setMuted] = useState(loadMuted);
  const [revealedMuted, setRevealedMuted] = useState(() => new Set());

  const [showRules, setShowRules] = useState(false);
  const [showNotice, setShowNotice] = useState(false);
  const [noticeBusy, setNoticeBusy] = useState(false);
  const [joining, setJoining] = useState(false);
  const [buying, setBuying] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const [lockBusy, setLockBusy] = useState(false);
  const [lockedOptionsOpen, setLockedOptionsOpen] = useState(false);
  const [confirmSpectate, setConfirmSpectate] = useState(false);
  const [creatingRoom, setCreatingRoom] = useState(false);

  const [reportFor, setReportFor] = useState(null);
  const [reportCategory, setReportCategory] = useState('harassment');
  const [reportDetails, setReportDetails] = useState('');
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState('');

  const [soundOn, setSoundOn] = useState(loadSound);
  const [pendingTag, setPendingTag] = useState(null);
  const [encodedOn, setEncodedOn] = useState(false);
  const [encodedRecipient, setEncodedRecipient] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(null);
  const [celebration, setCelebration] = useState(null);
  const [fightAlert, setFightAlert] = useState(null);
  const [memberWarning, setMemberWarning] = useState(false);
  const [releasedNotice, setReleasedNotice] = useState(false);
  const [serverOnline, setServerOnline] = useState(null);
  const [exitDone, setExitDone] = useState(false);
  const [revealedEncoded, setRevealedEncoded] = useState({});
  const [pushOpen, setPushOpen] = useState(false);
  const [pushState, setPushState] = useState({ supported: false, subscribed: false, permission: 'default' });
  const [pushBusy, setPushBusy] = useState(false);
  const [pushPrefs, setPushPrefs] = useState({ room_messages: true, member_joins: true, social: true });
  const [pushPrefsReady, setPushPrefsReady] = useState(false);
  const [prefsBusy, setPrefsBusy] = useState(false);

  const scrollRef = useRef(null);
  const atBottomRef = useRef(true);
  const firstLoadRef = useRef(true);
  const justSentRef = useRef(false);
  const prependKeepRef = useRef(null);
  const draftRef = useRef(null);
  const lastTypingSentRef = useRef(0);
  const lastActivityRef = useRef(Date.now());
  const presenceKeyRef = useRef(`s:${Math.random().toString(36).slice(2, 10)}`);
  const expiringRef = useRef(new Set());
  const bootstrapInFlightRef = useRef(null);
  const lastAccessRef = useRef(null);
  const seenSoundIdsRef = useRef(new Set());
  const soundRef = useRef(soundOn);
  const olderCursorRef = useRef(null);
  const celebrationTimerRef = useRef(null);
  const fightTimerRef = useRef(null);
  // alias -> last-celebrated timestamp. Join broadcasts can be delivered again
  // on a reconnect/reconcile; this keeps one celebration per member per TTL.
  const celebratedRef = useRef(new Map());
  const [olderError, setOlderError] = useState(false);
  const prefersReducedMotion = useMemo(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  useEffect(() => {
    soundRef.current = soundOn;
  }, [soundOn]);

  const groupId = room?.group?.id ?? (id ? Number(id) : null);
  const myLabel = room?.my_alias ? `Anonymous #${String(room.my_alias).padStart(2, '0')}` : null;
  const isMember = room?.access === 'member';
  const isSpectator = room?.access === 'spectator';
  const canSpeak = isMember;
  const canReact = isMember || isSpectator;
  const isHost = !!room?.is_host;
  const memberCount = room?.member_count;
  const memberLimit = room?.config?.membership?.capacity ?? room?.group?.member_limit;
  const membershipLocked = !!room?.group?.membership_locked;
  const thresholds = room?.thresholds || {};
  const price = room?.group?.spectator_price;
  const noticeAccepted = !isMember || room?.notice?.accepted === true;
  const myAliasNum = room?.my_alias ?? null;
  const roomActions = room?.config?.actions || room?.config?.tags || room?.config?.social_actions || [];
  const roomTags = roomActions;
  const roomSocial = roomActions;
  const isPremiumRoom = room?.is_premium === true;
  const tagMap = useMemo(() => {
    const map = new Map();
    for (const t of room?.config?.actions || room?.config?.tags || []) map.set(t.key, t);
    return map;
  }, [room?.config?.actions, room?.config?.tags]);

  // ---------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------
  const loadRoom = useCallback(async () => {
    const data = await communityApi(session, '/anonymous/room', id ? { group_id: Number(id) } : {});
    setRoom(data);
    return data;
  }, [session, id]);

  const loadFeed = useCallback(async (targetGroup, before = null) => {
    return communityApi(session, '/anonymous/feed', {
      group_id: targetGroup,
      ...(before ? { before } : {}),
    });
  }, [session]);

  const upsertMessage = useCallback((msg) => {
    if (!msg) return;
    // Audible cue for genuinely new incoming messages only (not our own send,
    // not a re-fetch of a message we've already seen, not history).
    const isNew = !seenSoundIdsRef.current.has(msg.id);
    seenSoundIdsRef.current.add(msg.id);
    if (
      isNew &&
      !msg.is_mine &&
      soundRef.current &&
      Date.now() - (Date.parse(msg.created_at) || 0) < 30000
    ) {
      playMessagePop();
    }
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === msg.id);
      const next = idx >= 0 ? prev.map((m) => (m.id === msg.id ? msg : m)) : [...prev, msg];
      return next.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    });
  }, []);

  const removeMessage = useCallback((messageId) => {
    setMessages((prev) => prev.filter((m) => m.id !== messageId));
  }, []);

  const fetchOneMessage = useCallback(async (messageId) => {
    if (!groupId) return null;
    try {
      const data = await communityApi(session, '/anonymous/message', { message_id: messageId, group_id: groupId });
      if (data.message) upsertMessage(data.message);
      return data.message || null;
    } catch (err) {
      if (err.status === 404) removeMessage(messageId);
      return null;
    }
  }, [session, groupId, upsertMessage, removeMessage]);

  // When a member seat is released (inactivity reconciliation) the room stays
  // open but the member loses access: detect the member→closed transition so a
  // viewer currently in the room is told why and sent home instead of being
  // silently dumped onto the rejoin screen. Wipe/banned are handled elsewhere.
  const detectRelease = useCallback((data) => {
    const prev = lastAccessRef.current;
    lastAccessRef.current = data?.access;
    const wasMember = prev === 'member';
    const gone = !data || !['member', 'spectator'].includes(data.access);
    if (wasMember && gone && data && data.access !== 'wiped' && data.access !== 'banned') {
      setReleasedNotice(true);
    }
  }, []);

  // Re-fetch the room state + latest page. Merges so older loaded pages survive
  // and disappeared recent messages are pruned (deletes/expiry stay consistent).
  const reconcile = useCallback(async () => {
    try {
      const data = await loadRoom();
      detectRelease(data);
      if (data.access === 'member' || data.access === 'spectator') {
        const feed = await loadFeed(data.group.id);
        const fetched = feed.messages || [];
        const oldest = fetched.length ? Date.parse(fetched[0].created_at) : Infinity;
        setMessages((prev) => {
          const olderKept = prev.filter((m) => Date.parse(m.created_at) < oldest);
          const map = new Map();
          for (const m of [...olderKept, ...fetched]) map.set(m.id, m);
          return [...map.values()]
            .filter((m) => Date.parse(m.lives_until || '') > Date.now())
            .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
        });
        setHasMore(!!feed.has_more);
        olderCursorRef.current = feed.next_before || (fetched[0]?.created_at ?? null);
      }
    } catch {
      /* transient — realtime retry / polling will reconcile again */
    }
  }, [loadRoom, loadFeed, detectRelease]);

  const bootstrap = useCallback(async (isRefresh = false) => {
    // Dedupe concurrent bootstraps (StrictMode double-mount, refresh + realtime
    // reconcile racing, a re-join bouncing off a locked room): overlapping runs
    // share ONE in-flight promise instead of fanning out duplicate room+feed
    // fetches against the server.
    if (bootstrapInFlightRef.current) return bootstrapInFlightRef.current;
    const run = (async () => {
      if (isRefresh) setRefreshing(true);
      else setBooting(true);
      setBootError('');
      try {
        const data = await loadRoom();
        detectRelease(data);
        if (data.access === 'member' || data.access === 'spectator') {
          const feed = await loadFeed(data.group.id);
          setMessages(feed.messages || []);
          setHasMore(!!feed.has_more);
          olderCursorRef.current = feed.next_before || (feed.messages?.[0]?.created_at ?? null);
          firstLoadRef.current = true;
        } else {
          setMessages([]);
          setHasMore(false);
        }
      } catch (err) {
        setBootError(
          err?.code === 'AUTH_NOT_READY'
            ? 'Sign in to join the Anonymous room.'
            : (err?.message || 'Could not open the Anonymous room.')
        );
      } finally {
        setBooting(false);
        setRefreshing(false);
      }
    })();
    bootstrapInFlightRef.current = run;
    try {
      return await run;
    } finally {
      bootstrapInFlightRef.current = null;
    }
  }, [loadRoom, loadFeed, detectRelease]);

  useEffect(() => {
    bootstrap(false);
  }, [bootstrap]);

  const pushSystemEvent = useCallback((type, extra = {}) => {
    setSystemEvents((prev) => [
      ...prev.slice(-8),
      { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, type, at: Date.now(), ...extra },
    ]);
  }, []);

  // Celebrate a new member joining (transient overlay + optional chime).
  // Deduplicates per member so a reconnect/reconcile does not replay it.
  const celebrate = useCallback((alias) => {
    const key = alias != null ? String(alias) : '__anon__';
    const now = Date.now();
    if (now - (celebratedRef.current.get(key) || 0) < 60_000) return;
    celebratedRef.current.set(key, now);
    setCelebration({ id: now, alias: alias ?? null, reduced: prefersReducedMotion });
    if (soundRef.current) playJoinChime();
    if (celebrationTimerRef.current) clearTimeout(celebrationTimerRef.current);
    celebrationTimerRef.current = setTimeout(() => setCelebration(null), 3500);
  }, [prefersReducedMotion]);

  useEffect(
    () => () => {
      if (celebrationTimerRef.current) clearTimeout(celebrationTimerRef.current);
    },
    [],
  );

  // ---------------------------------------------------------------
  // Realtime events (notification-only — always re-fetch before trusting)
  // ---------------------------------------------------------------
  const onEvent = useCallback((type, payload) => {
    if (type === 'typing') {
      const alias = payload?.alias;
      if (!alias || alias === myLabel) return;
      setTypers((prev) => ({ ...prev, [alias]: Date.now() + TYPING_TTL_MS }));
      return;
    }
    if (type === 'message' || type === 'edit' || type === 'react' || type === 'social') {
      if (payload?.id) fetchOneMessage(payload.id);
      return;
    }
    if (type === 'fight') {
      // S1 — a reciprocal slap/kick started a fight. Transient banner only.
      setFightAlert({ attacker: payload?.attacker ?? null, defender: payload?.defender ?? null });
      if (fightTimerRef.current) clearTimeout(fightTimerRef.current);
      fightTimerRef.current = setTimeout(() => setFightAlert(null), 5000);
      return;
    }
    if (type === 'delete') {
      if (payload?.id) removeMessage(payload.id);
      return;
    }
    if (type === 'join') {
      pushSystemEvent('join', { alias: payload?.alias ?? null });
      if (payload?.alias == null || Number(payload.alias) !== Number(myAliasNum)) {
        celebrate(payload?.alias ?? null);
      }
    } else if (type === 'departure') pushSystemEvent('departure', { alias: payload?.alias ?? null });
    else if (type === 'state') pushSystemEvent('state');
    else if (type === 'wipe') pushSystemEvent('wipe');
    reconcile();
  }, [myLabel, myAliasNum, fetchOneMessage, removeMessage, pushSystemEvent, reconcile, celebrate]);

  const presence = useMemo(
    () =>
      isMember && room?.my_alias != null
        ? { key: `m:${room.my_alias}`, track: { alias: room.my_alias } }
        : { key: presenceKeyRef.current, track: { spectator: true } },
    [isMember, room?.my_alias],
  );

  const realtimeEnabled =
    !!room && !!room.channel && room.access !== 'banned' && room.access !== 'wiped';

  const { conn, online, retry, sendTyping } = useAnonymousRoomRealtime({
    topic: room?.channel,
    enabled: realtimeEnabled,
    sessionId: session?.access_token || null,
    presence,
    onEvent,
    onReconcile: reconcile,
  });

  // ---------------------------------------------------------------
  // Presence heartbeat (server-authoritative; best-effort before v44)
  // ---------------------------------------------------------------
  useEffect(() => {
    if (!realtimeEnabled || !groupId) return undefined;
    let alive = true;
    const beat = async () => {
      try {
        const data = await communityApi(session, '/anonymous/presence', {
          group_id: groupId,
          session_id: presenceKeyRef.current,
        });
        if (alive && typeof data?.online === 'number') setServerOnline(data.online);
      } catch {
        /* presence is best-effort; the room still works without it */
      }
    };
    beat();
    const t = setInterval(beat, 25000);
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        communityApi(session, '/anonymous/presence-leave', { group_id: groupId }).catch(() => {});
      } else {
        beat();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      alive = false;
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
      communityApi(session, '/anonymous/presence-leave', { group_id: groupId }).catch(() => {});
    };
  }, [realtimeEnabled, groupId, session]);

  useEffect(() => {
    setServerOnline(null);
  }, [groupId]);

  // S4 — in-app nudge before the server releases an inactive seat. The server
  // remains authoritative; this only warns the user to interact before the
  // activity deadline so they are not silently removed from the room.
  const membershipWarningSeconds = room?.config?.membership?.warning_seconds ?? 600;
  const markActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
    setMemberWarning(false);
  }, []);

  useEffect(() => {
    if (!isMember) {
      setMemberWarning(false);
      return undefined;
    }
    lastActivityRef.current = Date.now();
    const warnAt = Math.max(0, Number(membershipWarningSeconds) || 0) * 1000;
    const check = () => setMemberWarning(Date.now() - lastActivityRef.current >= warnAt);
    check();
    const t = setInterval(check, 15000);
    return () => clearInterval(t);
  }, [isMember, membershipWarningSeconds, room?.my_alias]);

  // ---------------------------------------------------------------
  // Timers: clock tick, expiry sweep, typing TTL, system-event fade
  // ---------------------------------------------------------------
  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!messages.length) return;
    const now = Date.now();
    for (const m of messages) {
      const lives = Date.parse(m.lives_until || '');
      if (Number.isFinite(lives) && lives <= now && !expiringRef.current.has(m.id)) {
        expiringRef.current.add(m.id);
        fetchOneMessage(m.id).finally(() => expiringRef.current.delete(m.id));
      }
    }
  }, [messages, tick, fetchOneMessage]);

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

  useEffect(() => {
    if (!systemEvents.length) return undefined;
    const t = setTimeout(() => {
      setSystemEvents((prev) => prev.slice(1));
    }, 12000);
    return () => clearTimeout(t);
  }, [systemEvents]);

  // ---------------------------------------------------------------
  // Scroll preservation — anchored prepends, bottom-follow appends
  // ---------------------------------------------------------------
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (prependKeepRef.current != null) {
      el.scrollTop = el.scrollHeight - prependKeepRef.current;
      prependKeepRef.current = null;
      return;
    }
    if (firstLoadRef.current) {
      firstLoadRef.current = false;
      el.scrollTop = el.scrollHeight;
      atBottomRef.current = true;
      return;
    }
    if (atBottomRef.current || justSentRef.current) {
      el.scrollTop = el.scrollHeight;
      atBottomRef.current = true;
      setShowNewPill(false);
    } else {
      setShowNewPill(true);
    }
    justSentRef.current = false;
  }, [messages]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    atBottomRef.current = atBottom;
    if (atBottom) setShowNewPill(false);
  };

  const jumpToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    atBottomRef.current = true;
    setShowNewPill(false);
  }, []);

  const loadOlder = async () => {
    if (!hasMore || loadingOlder || !groupId) return;
    // Use the server's raw page cursor so an all-expired page can still advance
    // (and so the "Load earlier messages" control is never a dead end).
    const before = olderCursorRef.current || messages[0]?.created_at || null;
    if (!before) return;
    setLoadingOlder(true);
    setOlderError(false);
    const el = scrollRef.current;
    try {
      const feed = await loadFeed(groupId, before);
      const seen = new Set(messages.map((m) => m.id));
      const older = (feed.messages || []).filter((m) => !seen.has(m.id));
      if (el) prependKeepRef.current = el.scrollHeight - el.scrollTop;
      setMessages((prev) => {
        const map = new Map(prev.map((m) => [m.id, m]));
        for (const m of older) map.set(m.id, m);
        return [...map.values()].sort(
          (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at),
        );
      });
      olderCursorRef.current = feed.next_before || before;
      // Only keep the control when BOTH the server says there is more AND we
      // actually found something new — no more phantom "load earlier".
      setHasMore(!!feed.has_more && older.length > 0);
    } catch (err) {
      console.error('anonymous room older load', err);
      // Keep the control in place so the user can retry the same page.
      setHasMore(true);
      setOlderError(true);
    } finally {
      setLoadingOlder(false);
    }
  };

  // ---------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------
  const notifyTyping = () => {
    const now = Date.now();
    if (now - lastTypingSentRef.current < TYPING_THROTTLE_MS) return;
    lastTypingSentRef.current = now;
    sendTyping({ alias: myLabel });
  };

  const sendMessage = async () => {
    const content = draft.trim();
    const tag = pendingTag;
    const encoded = encodedOn && isPremiumRoom;
    if (!content || sending || !groupId) return;
    if (encoded && encodedRecipient == null) {
      setComposerError(SEND_ERRORS.RECIPIENT_REQUIRED);
      setPickerOpen('recipient');
      return;
    }
    setSending(true);
    setComposerError('');
    try {
      const data = await communityApi(session, '/anonymous/send', {
        content: content || '',
        group_id: groupId,
        ...(replyTo ? { reply_to_post_id: replyTo.id } : {}),
        ...(tag ? { tag } : {}),
        ...(encoded ? { encoded: true, recipient_alias: encodedRecipient } : {}),
      });
      justSentRef.current = true;
      upsertMessage(data.message);
      setDraft('');
      setPendingTag(null);
      setEncodedRecipient(null);
      setPickerOpen(null);
      if (draftRef.current) draftRef.current.style.height = 'auto';
      setReplyTo(null);
      jumpToBottom();
      markActivity();
    } catch (err) {
      if (err.code === 'NOTICE_REQUIRED') {
        setShowNotice(true);
        setComposerError(SEND_ERRORS.NOTICE_REQUIRED);
      } else {
        setComposerError(SEND_ERRORS[err.code] || err.message || 'Message could not be sent.');
      }
      if (err.code === 'PREMIUM_REQUIRED') {
        setEncodedOn(false);
        setEncodedRecipient(null);
      }
      if (err.code === 'RECIPIENT_REQUIRED' || err.code === 'INVALID_RECIPIENT') {
        setEncodedRecipient(null);
        setPickerOpen('recipient');
      }
      if (['GROUP_WIPED', 'BANNED', 'ANONYMOUS_MEMBERS_ONLY', 'GROUP_FULL', 'MEMBERSHIP_LOCKED'].includes(err.code)) {
        bootstrap(true);
      }
    } finally {
      setSending(false);
    }
  };

  const sendSocial = async (msg, action) => {
    if (!canReact || !msg?.id) return;
    if (soundRef.current) playSocialTone();
    try {
      const data = await communityApi(session, '/anonymous/social', {
        message_id: msg.id,
        action,
        group_id: groupId,
      });
      setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, social: data.social } : m)));
      markActivity();
    } catch (err) {
      setComposerError(SEND_ERRORS[err.code] || err.message || 'Action could not be saved.');
    } finally {
      setOpenActions(null);
    }
  };

  const revealEncoded = async (msg) => {
    if (!msg?.id) return;
    setComposerError('');
    try {
      const data = await communityApi(session, '/anonymous/encoded', {
        message_id: msg.id,
        group_id: groupId,
      });
      setRevealedEncoded((prev) => ({ ...prev, [msg.id]: data.content || '' }));
    } catch (err) {
      setComposerError(SEND_ERRORS[err.code] || err.message || 'Could not unlock this message.');
    }
  };

  const toggleSound = () => {
    setSoundOn((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SOUND_KEY, String(next));
      } catch {
        /* best effort */
      }
      return next;
    });
  };

  const openPush = async () => {
    setPushOpen(true);
    setPushState(await getPushState());
    try {
      const data = await communityApi(session, '/notifications/preferences', {});
      if (data?.preferences) {
        setPushPrefs({
          room_messages: data.preferences.room_messages !== false,
          member_joins: data.preferences.member_joins !== false,
          social: data.preferences.social !== false,
        });
        setPushPrefsReady(!!data.ready);
      }
    } catch {
      setPushPrefsReady(false);
    }
  };

  const togglePref = async (key) => {
    if (prefsBusy) return;
    const next = { ...pushPrefs, [key]: !pushPrefs[key] };
    setPushPrefs(next);
    setPrefsBusy(true);
    try {
      const data = await savePreferences(session, { [key]: next[key] });
      if (data?.preferences) setPushPrefsReady(!!data.ready);
    } catch {
      setPushPrefs((prev) => ({ ...prev, [key]: !next[key] }));
    } finally {
      setPrefsBusy(false);
    }
  };

  const togglePush = async () => {
    if (pushBusy) return;
    setPushBusy(true);
    setComposerError('');
    try {
      const res = pushState.subscribed ? await disablePush(session) : await enablePush(session);
      if (!res.ok) {
        if (res.reason === 'not_configured') setComposerError('Push notifications are not configured on this server yet.');
        else if (res.reason === 'denied') setComposerError('Notifications are blocked in your browser settings.');
        else if (res.reason === 'unsupported') setComposerError('This browser does not support push notifications.');
      }
      setPushState(await getPushState());
    } finally {
      setPushBusy(false);
    }
  };

  const acknowledgeNotice = async () => {
    if (noticeBusy) return;
    setNoticeBusy(true);
    try {
      await communityApi(session, '/anonymous/ack', {
        group_id: groupId,
        key: room?.notice?.key,
      });
      setRoom((prev) => (prev ? { ...prev, notice: { accepted: true } } : prev));
      setShowNotice(false);
      setComposerError('');
    } catch (err) {
      setComposerError(err.message || 'Could not save your acknowledgement.');
    } finally {
      setNoticeBusy(false);
    }
  };

  const toggleReaction = async (msg, emoji, active) => {
    try {
      const data = await communityApi(session, '/anonymous/react', {
        message_id: msg.id,
        emoji,
        active,
        group_id: groupId,
      });
      setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, reactions: data.reactions } : m)));
      markActivity();
    } catch (err) {
      setComposerError(SEND_ERRORS[err.code] || err.message || 'Reaction could not be saved.');
    } finally {
      setReactFor(null);
      setOpenActions(null);
    }
  };

  // Up/down vote with optimistic UI. Same-direction toggle clears the vote
  // (server translates that to "delete the row"); the server's computed score
  // is authoritative and always overwrites the optimistic value.
  const voteMessage = async (msg, dir) => {
    if (!canReact || !msg?.id) return;
    const prev = msg.my_vote || 0;
    const next = prev === dir ? 0 : dir;
    const patch = (m, score, mine) => ({ ...m, score, my_vote: mine });
    setMessages((prevList) =>
      prevList.map((m) => (m.id === msg.id ? patch(m, (m.score || 0) + next - prev, next) : m))
    );
    try {
      const data = await communityApi(session, '/posts/vote', { post_id: msg.id, value: next, group_id: groupId });
      setMessages((prevList) =>
        prevList.map((m) => (m.id === msg.id ? patch(m, data.score, data.my_vote) : m))
      );
      markActivity();
      return data;
    } catch (err) {
      setMessages((prevList) =>
        prevList.map((m) => (m.id === msg.id ? patch(m, (m.score || 0) - next + prev, prev) : m))
      );
      setComposerError(SEND_ERRORS[err.code] || err.message || 'Vote could not be saved.');
      return null;
    }
  };

  const deleteMessage = async (msg) => {
    if (!window.confirm('Delete this message? It disappears for everyone.')) return;
    try {
      await communityApi(session, '/posts/delete', { post_id: msg.id });
      removeMessage(msg.id);
    } catch (err) {
      setComposerError(err.message || 'Could not delete this message.');
    } finally {
      setOpenActions(null);
    }
  };

  const saveEdit = async (msg) => {
    const content = editDraft.trim();
    if (!content) return;
    try {
      await communityApi(session, '/posts/edit', { post_id: msg.id, content });
      setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, content, edited: true } : m)));
      setEditingId(null);
      setEditDraft('');
    } catch (err) {
      setComposerError(SEND_ERRORS[err.code] || err.message || 'Could not save the edit.');
    }
  };

  const openReport = (msg) => {
    setOpenActions(null);
    setReportFor(msg);
    setReportCategory('harassment');
    setReportDetails('');
    setReportError('');
  };

  const submitReport = async () => {
    if (!reportFor || reportBusy) return;
    setReportBusy(true);
    setReportError('');
    const opt = REPORT_CATEGORIES.find((c) => c.value === reportCategory) || REPORT_CATEGORIES.at(-1);
    try {
      await communityApi(session, '/posts/report', {
        post_id: reportFor.id,
        category: reportCategory,
        reason: opt.label.slice(0, 200),
        ...(reportDetails.trim() ? { details: reportDetails.trim().slice(0, 200) } : {}),
      });
      setReportFor(null);
    } catch (err) {
      setReportError(SEND_ERRORS[err.code] || err.message || 'Could not submit the report.');
    } finally {
      setReportBusy(false);
    }
  };

  const toggleMute = (alias) => {
    if (!Number.isFinite(Number(alias))) return;
    setMuted((prev) => {
      const next = new Set(prev);
      const n = Number(alias);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      try {
        localStorage.setItem(MUTE_KEY, JSON.stringify([...next]));
      } catch {
        /* best effort */
      }
      return next;
    });
    setOpenActions(null);
  };

  const jumpToAlias = useCallback((alias) => {
    const n = Number(alias);
    const target = [...messages].reverse().find((m) => aliasNum(m) === n);
    if (!target) return;
    setHighlightId(target.id);
    const el = document.getElementById(`anon-msg-${target.id}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => setHighlightId(null), 2000);
  }, [messages]);

  const joinRoom = async () => {
    if (!groupId || joining) return;
    setJoining(true);
    setComposerError('');
    try {
      await communityApi(session, '/groups/join', { group_id: groupId });
      await bootstrap(true);
    } catch (err) {
      if (['MEMBERSHIP_LOCKED', 'GROUP_FULL'].includes(err.code)) {
        setLockedOptionsOpen(true);
        setComposerError(SEND_ERRORS[err.code]);
      } else {
        setComposerError(SEND_ERRORS[err.code] || err.message || 'Could not join right now.');
      }
      await bootstrap(true);
    } finally {
      setJoining(false);
    }
  };

  const leaveRoom = async () => {
    if (!groupId || leaving) return;
    setLeaving(true);
    try {
      await communityApi(session, '/groups/leave', { group_id: groupId });
      await communityApi(session, '/anonymous/presence-leave', { group_id: groupId }).catch(() => {});
      setExitOpen(false);
      setShowRules(false);
      setServerOnline(null);
      setExitDone(true);
    } catch (err) {
      setComposerError(err.message || 'Could not leave right now.');
    } finally {
      setLeaving(false);
    }
  };

  // Spectator purchase: two-step (confirm → checkout) so a charge is never
// accidental. The amount is resolved SERVER-SIDE in initiate-payment.js.
const buySpectator = async () => {
    if (!groupId || buying) return;
    setBuying(true);
    try {
      const res = await fetch('/api/initiate-payment', {
        method: 'POST',
        headers: { ...authHeaders(session, { json: true }) },
        body: JSON.stringify({ product: 'anonymous_spectate', group_id: groupId }),
      });
      const body = await res.json();
      if (res.ok && body.authorization_url) {
        window.location.assign(body.authorization_url);
        return;
      }
      setComposerError(body.error || body.message || 'Payment could not be started.');
    } catch {
      setComposerError('Could not start payment. Check your connection and try again.');
    } finally {
      setBuying(false);
      setConfirmSpectate(false);
    }
  };

  // Open a brand-new Anonymous room (server-created, owner = you, member #1)
  // and jump straight into it.
  const createAnonRoom = async () => {
    if (creatingRoom) return;
    setCreatingRoom(true);
    try {
      const data = await communityApi(session, '/anonymous/room-create', {});
      navigate(`/anonymous/${data.room.id}`);
    } catch (err) {
      setComposerError(
        err?.code === 'AUTH_NOT_READY'
          ? 'Sign in to create an Anonymous room.'
          : (err.message || 'Could not create a new Anonymous room.')
      );
    } finally {
      setCreatingRoom(false);
    }
  };

  const toggleLock = async () => {
    if (!groupId || lockBusy) return;
    setLockBusy(true);
    try {
      const data = await communityApi(session, '/anonymous/lock', {
        group_id: groupId,
        locked: !membershipLocked,
      });
      setRoom((prev) =>
        prev
          ? {
            ...prev,
            group: { ...prev.group, membership_locked: !!data.membership_locked },
            member_count: data.member_count ?? prev.member_count,
          }
          : prev,
      );
    } catch (err) {
      setComposerError(err.message || 'Could not change membership access.');
    } finally {
      setLockBusy(false);
    }
  };

  const refresh = () => {
    bootstrap(true);
  };

  // ---------------------------------------------------------------
  // Draft + mention autocomplete
  // ---------------------------------------------------------------
  const knownAliases = useMemo(() => {
    const set = new Map();
    for (const m of messages) {
      const n = aliasNum(m);
      if (Number.isFinite(n) && n !== Number(room?.my_alias)) set.set(n, `Anonymous #${String(n).padStart(2, '0')}`);
    }
    return [...set.entries()].sort((a, b) => a[0] - b[0]);
  }, [messages, room?.my_alias]);

  const mentionMatch = draft.match(/@(?:Anonymous\s*#?)?(\d{0,4})$/i);
  const mentionSuggestions = useMemo(() => {
    if (!mentionMatch || !isMember) return [];
    const q = mentionMatch[1] || '';
    return knownAliases.filter(([n]) => String(n).startsWith(q)).slice(0, 5);
  }, [mentionMatch, knownAliases, isMember]);

  const insertMention = (n) => {
    const start = draft.length - mentionMatch[0].length;
    const next = `${draft.slice(0, start)}@Anonymous #${String(n).padStart(2, '0')} `;
    setDraft(next);
    draftRef.current?.focus();
  };

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

  const typerList = useMemo(
    () => Object.keys(typers).filter((a) => typers[a] > tick && a !== myLabel),
    [typers, tick, myLabel],
  );

  const typerLabel =
    typerList.length === 1
      ? `${typerList[0]} is typing…`
      : typerList.length > 1
        ? `${typerList.length} people are typing…`
        : '';

  // ---------------------------------------------------------------
  // Early screens
  // ---------------------------------------------------------------
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
            Membership fell below {thresholds.survive ?? 'the minimum'} and the Anonymous round closed.
            Every message has been hidden — nothing persisted.
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
    const target = thresholds.activate ?? memberLimit ?? 0;
    const pct = Math.min(100, Math.round(((memberCount || 0) / target) * 100));
    return (
      <div className="h-[100dvh] bg-slate-950 text-slate-200 overflow-y-auto">
        <GateCard>
          <div className="text-4xl mb-3">⏳</div>
          <h1 className="text-xl font-black text-white">The room is filling up.</h1>
          <p className="text-sm text-slate-400 font-medium mt-2">
            Messages open at <span className="text-amber-400 font-black">{target} members</span>. The room
            keeps accepting members after that until it reaches capacity ({memberLimit ?? '—'}), so join now
            to guarantee your spot.
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
          {composerError && <p className="text-[11px] font-bold text-red-400 mt-3">{composerError}</p>}
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
    const full = typeof memberCount === 'number' && typeof memberLimit === 'number' && memberCount >= memberLimit;
    const reason = membershipLocked
      ? 'The host has closed membership for this round.'
      : full
        ? 'This room is at capacity.'
        : 'Membership for this room is closed.';
    return (
      <div className="h-[100dvh] bg-slate-950 text-slate-200 overflow-y-auto">
        <GateCard>
          {membershipLocked ? (
            <Lock size={38} className="mx-auto mb-3 text-apex-400" />
          ) : (
            <Users size={38} className="mx-auto mb-3 text-emerald-400" />
          )}
          <h1 className="text-xl font-black text-white">{membershipLocked ? 'Membership closed' : 'Room is full'}</h1>
          <p className="text-sm text-slate-400 font-medium mt-2">
            {reason} This room is {memberCount ?? '…'} of {memberLimit ?? '…'} members strong. You can watch
            it anonymously with a one-time <span className="text-white font-black">₦{price ?? '…'}</span>{' '}
            spectator pass — read and react, never post — or open your own room.
          </p>
          {composerError && <p className="text-[11px] font-bold text-red-400 mt-3">{composerError}</p>}
          <div className="flex flex-col items-stretch gap-2.5 mt-6">
            <button
              onClick={() => setConfirmSpectate(true)}
              disabled={buying}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-apex-600 text-white font-black text-xs uppercase tracking-widest hover:bg-apex-700 disabled:opacity-50 transition"
            >
              {buying ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
              Watch as Spectator — ₦{price ?? '…'}
            </button>
            <button
              onClick={createAnonRoom}
              disabled={creatingRoom}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 font-black text-xs uppercase tracking-widest hover:bg-slate-700 disabled:opacity-50 transition"
            >
              {creatingRoom ? <Loader2 size={14} className="animate-spin" /> : <Users size={14} />}
              Create a new Anonymous room
            </button>
            <button
              onClick={() => navigate('/study-groups')}
              className="px-4 py-2.5 rounded-xl bg-transparent border border-slate-800 text-slate-400 font-black text-xs uppercase tracking-widest hover:text-white transition"
            >
              Return to groups
            </button>
          </div>
        </GateCard>
      </div>
    );
  }

  if (exitDone) {
    return (
      <div className="h-[100dvh] bg-slate-950 text-slate-200 overflow-y-auto">
        <GateCard>
          <div className="text-4xl mb-3">👋</div>
          <h1 className="text-xl font-black text-white">You've left the room.</h1>
          <p className="text-sm text-slate-400 font-medium mt-2">
            Your seat has been released and the room no longer counts you. Any messages you sent stay
            anonymous and expire on their own 5-minute timer.
          </p>
          <div className="flex flex-col items-stretch gap-2.5 mt-6">
            <button
              onClick={() => navigate('/study-groups')}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-apex-600 text-white font-black text-xs uppercase tracking-widest hover:bg-apex-700 transition"
            >
              <Users size={14} /> Find another room
            </button>
            <button
              onClick={() => {
                setExitDone(false);
                bootstrap(true);
              }}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 font-black text-xs uppercase tracking-widest hover:bg-slate-700 transition"
            >
              <RefreshCw size={14} /> Rejoin this room
            </button>
          </div>
        </GateCard>
      </div>
    );
  }

  const mutedCount = muted.size;
  const liveOnline = serverOnline ?? online;

  return (
    <div className="relative h-[100dvh] bg-slate-950 text-slate-200 flex flex-col overflow-hidden">
      {celebration && (
        <div className="pointer-events-none absolute inset-x-0 top-16 z-20 flex justify-center">
          <div className={`flex items-center gap-2 px-4 py-2 rounded-full bg-apex-600/90 text-white text-xs font-black uppercase tracking-widest shadow-2xl border border-apex-400/40 ${celebration.reduced ? '' : 'animate-bounce'}`}>
            <Sparkles size={13} />
            {celebration.alias != null
              ? `Anonymous #${String(celebration.alias).padStart(2, '0')} joined 🎉`
              : 'A new member joined 🎉'}
          </div>
        </div>
      )}
      {fightAlert && (
        <div className="pointer-events-none absolute inset-x-0 top-16 z-20 flex justify-center">
          <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-rose-600/90 text-white text-xs font-black uppercase tracking-widest shadow-2xl border border-rose-400/40 animate-bounce">
            <Swords size={13} />
            {fightAlert.attacker != null && fightAlert.defender != null
              ? `Fight! Anonymous #${String(fightAlert.attacker).padStart(2, '0')} vs #${String(fightAlert.defender).padStart(2, '0')}`
              : 'A fight broke out 🥊'}
          </div>
        </div>
      )}
      {memberWarning && isMember && (
        <div className="pointer-events-none absolute inset-x-0 bottom-24 z-20 flex justify-center px-4">
          <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-amber-500/95 text-slate-950 text-[11px] font-black uppercase tracking-widest shadow-2xl border border-amber-300/50">
            <Info size={13} />
            Still there? Interact to keep your seat
          </div>
        </div>
      )}
      <header className="shrink-0 border-b border-slate-800/80 bg-slate-950/95 backdrop-blur px-4 py-3 flex items-center gap-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-sm font-black text-white truncate flex items-center gap-1.5">
              <Shield size={13} className="text-apex-400" />
              {room?.group?.name || 'Anonymous'}
            </h1>
            <StatusPill conn={conn} />
            {isHost && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30 text-[8px] font-black uppercase tracking-widest">
                <Crown size={9} /> Host
              </span>
            )}
            {membershipLocked && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-400 text-[8px] font-black uppercase tracking-widest">
                <Lock size={9} /> Closed
              </span>
            )}
          </div>
          <p className="text-[10px] font-bold text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
            {isMember && myLabel && <span style={{ ...identityStyle(room?.my_alias) }} className="font-black">{myLabel}</span>}
            {isSpectator && (
              <span className="inline-flex items-center gap-1 text-amber-300">
                <Eye size={10} /> Spectator
              </span>
            )}
            {(typeof memberCount === 'number' || (liveOnline !== null && liveOnline !== undefined)) && (
              <span className="inline-flex items-center gap-1.5">
                {typeof memberCount === 'number' && (
                  <span className="inline-flex items-center gap-1" title="Members / capacity">
                    <Users size={10} /> {memberCount}
                    {typeof memberLimit === 'number' ? `/${memberLimit}` : ''} members
                  </span>
                )}
                {typeof memberCount === 'number' &&
                  liveOnline !== null &&
                  liveOnline !== undefined && <span className="text-slate-600">·</span>}
                {liveOnline !== null && liveOnline !== undefined && (
                  <span className="inline-flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> {liveOnline} online
                  </span>
                )}
              </span>
            )}
            {room?.group?.group_state === 'waiting' && (
              <span className="text-amber-400">opens at {thresholds.activate ?? '—'}</span>
            )}
            {mutedCount > 0 && (
              <button
                onClick={() => {
                  setMuted(new Set());
                  try {
                    localStorage.setItem(MUTE_KEY, '[]');
                  } catch {
                    /* ignore */
                  }
                }}
                className="inline-flex items-center gap-1 text-slate-400 hover:text-white"
              >
                <BellOff size={10} /> {mutedCount} muted
              </button>
            )}
          </p>
        </div>
        {isHost && (
          <button
            onClick={toggleLock}
            disabled={lockBusy}
            className="h-9 px-3 rounded-xl bg-slate-900 border border-slate-800 flex items-center gap-1.5 text-slate-400 hover:text-white transition shrink-0 disabled:opacity-50"
            title={membershipLocked ? 'Reopen membership' : 'Close membership'}
          >
            {membershipLocked ? <Unlock size={14} /> : <Lock size={14} />}
            <span className="hidden sm:inline text-[10px] font-black uppercase tracking-widest">
              {membershipLocked ? 'Reopen' : 'Close'}
            </span>
          </button>
        )}
        <button
          onClick={toggleSound}
          className="w-9 h-9 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-400 hover:text-white transition shrink-0"
          aria-label={soundOn ? 'Mute sounds' : 'Enable sounds'}
          title={soundOn ? 'Sounds on' : 'Sounds off'}
        >
          {soundOn ? <Volume2 size={15} /> : <VolumeX size={15} />}
        </button>
        {pushSupported() && (
          <button
            onClick={openPush}
            className="w-9 h-9 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-400 hover:text-white transition shrink-0 relative"
            aria-label="Notification settings"
            title="Notifications"
          >
            <Bell size={15} />
            {pushState.subscribed && (
              <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-emerald-400" />
            )}
          </button>
        )}
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
          aria-label="Room safety"
        >
          <Info size={15} />
        </button>
      </header>

      {conn !== 'live' && (
        <div className="shrink-0 px-4 py-1.5 bg-amber-500/10 border-b border-amber-500/20 text-[10px] font-bold text-amber-300 flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5">
            <RefreshCw size={11} className="animate-spin" />
            {conn === 'reconnecting' ? 'Reconnecting — messages keep arriving.' : 'Connecting to live updates…'}
          </span>
          <button onClick={retry} className="font-black uppercase tracking-widest hover:text-white">
            Retry
          </button>
        </div>
      )}

      {isSpectator && (
        <div className="shrink-0 px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 text-[11px] font-bold text-amber-300 flex items-center gap-2">
          <Eye size={13} className="shrink-0" />
          You're watching as a spectator — read and react only.
        </div>
      )}

      {isMember && !noticeAccepted && (
        <button
          onClick={() => setShowNotice(true)}
          className="shrink-0 px-4 py-2 bg-apex-500/10 border-b border-apex-500/25 text-[11px] font-bold text-apex-300 flex items-center gap-2 text-left"
        >
          <Shield size={13} className="shrink-0" />
          Accept the room safety notice to speak.
          <span className="ml-auto font-black uppercase tracking-widest">Review</span>
        </button>
      )}

      <main ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
        {hasMore && (
          <div className="flex flex-col items-center gap-1.5 pb-3">
            <button
              onClick={loadOlder}
              disabled={loadingOlder}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-slate-900 border border-slate-800 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-white disabled:opacity-50"
            >
              {loadingOlder && <Loader2 size={12} className="animate-spin" />}
              {olderError ? 'Retry earlier messages' : 'Load earlier messages'}
            </button>
            {olderError && (
              <span className="text-[10px] font-bold text-red-400">
                Couldn't load earlier messages. Tap to retry.
              </span>
            )}
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
          const lives = Date.parse(msg.lives_until || '') || 0;
          const remaining = lives ? lives - tick : Infinity;
          const isOpen = openActions === msg.id;
          const isEditing = editingId === msg.id;
          const ali = aliasNum(msg);
          const isMuted = Number.isFinite(ali) && muted.has(ali);
          const isHiddenMuted = isMuted && !revealedMuted.has(msg.id);
          return (
            <div
              id={`anon-msg-${msg.id}`}
              key={msg.id}
              className={`group px-1 py-1.5 rounded-2xl transition ${
                isOpen ? 'bg-slate-900/70' : ''
              } ${highlightId === msg.id ? 'bg-apex-500/15 ring-1 ring-apex-500/40' : ''}`}
            >
              <div className="flex items-start gap-2.5">
                <div
                  className="w-8 h-8 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center text-[10px] font-black shrink-0 mt-0.5"
                  style={identityStyle(ali)}
                >
                  {String(msg.alias ?? '?').padStart(2, '0')}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-black" style={identityStyle(ali)}>{msg.author}</span>
                    {msg.is_mine && (
                      <span className="px-1.5 py-0.5 rounded-full bg-apex-500/15 text-apex-400 text-[8px] font-black uppercase tracking-widest">
                        You
                      </span>
                    )}
                    <span className="text-[10px] font-bold text-slate-600">{timeOf(msg.created_at)}</span>
                    {msg.edited && <span className="text-[10px] font-bold text-slate-600 italic">edited</span>}
                    {msg.tag && tagMap.get(msg.tag) && (
                      <span
                        className={`px-1.5 py-0.5 rounded-full border text-[8px] font-black uppercase tracking-widest ${
                          TAG_TONE_CLASS[tagMap.get(msg.tag).tone] || 'bg-slate-800 text-slate-400 border-slate-700'
                        }`}
                      >
                        {tagMap.get(msg.tag).label}
                      </span>
                    )}
                    {msg.encoded && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-300 border border-violet-500/30 text-[8px] font-black uppercase tracking-widest">
                        <Lock size={8} /> Encoded
                      </span>
                    )}
                    {Number.isFinite(remaining) && remaining > 0 && (
                      <span className="text-[10px] font-semibold text-slate-600 tabular-nums">
                        Expires in {fmtMSS(remaining)}
                      </span>
                    )}
                    {isMuted && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-500 text-[8px] font-black uppercase tracking-widest">
                        <BellOff size={9} /> Muted
                      </span>
                    )}
                  </div>

                  {isHiddenMuted ? (
                    <button
                      onClick={() => setRevealedMuted((prev) => new Set(prev).add(msg.id))}
                      className="mt-1 text-[11px] font-bold text-slate-500 italic hover:text-slate-300"
                    >
                      Muted message — tap to reveal
                    </button>
                  ) : (
                    <>
                      {msg.reply && (
                        <button
                          type="button"
                          onClick={() => msg.reply.id && jumpToAlias(msg.reply.alias)}
                          className="mt-1 pl-2.5 border-l-2 border-slate-700 text-left text-[11px] font-medium text-slate-500 truncate w-full"
                        >
                          <CornerUpLeft size={10} className="inline mr-1" />
                          {msg.reply.deleted ? (
                            <span className="italic text-slate-600">Original message unavailable</span>
                          ) : (
                            <>
                              <span className="font-black" style={identityStyle(msg.reply.alias)}>{msg.reply.author}</span>{' '}
                              {msg.reply.excerpt}
                            </>
                          )}
                        </button>
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
                        <>
                          {revealedEncoded[msg.id] !== undefined ? (
                            <p className="text-sm font-medium text-slate-300 mt-0.5 whitespace-pre-wrap break-words leading-relaxed">
                              {mentionNodes(revealedEncoded[msg.id], jumpToAlias)}
                            </p>
                          ) : msg.locked ? (
                            <div className="mt-1 inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-violet-500/10 border border-violet-500/30">
                              <Lock size={13} className="text-violet-300" />
                              <span className="text-[11px] font-bold text-violet-200">
                                {msg.encoded_for_me ? 'Encoded message' : 'Encoded · private'}
                              </span>
                              {msg.encoded_for_me ? (
                                <button
                                  onClick={() => revealEncoded(msg)}
                                  className="text-[10px] font-black uppercase tracking-widest text-violet-300 hover:text-white"
                                >
                                  Unlock
                                </button>
                              ) : (
                                <span className="text-[10px] font-bold text-violet-300/70">Only the recipient can read this</span>
                              )}
                            </div>
                          ) : msg.content ? (
                            <p className="text-sm font-medium text-slate-300 mt-0.5 whitespace-pre-wrap break-words leading-relaxed">
                              {mentionNodes(msg.content, jumpToAlias)}
                            </p>
                          ) : null}
                        </>
                      )}

                      {canReact && (
                        <div className="inline-flex items-stretch rounded-xl border border-slate-800 bg-slate-900/60 mt-1.5 overflow-hidden">
                          <button
                            onClick={() => voteMessage(msg, 1)}
                            disabled={!canReact}
                            aria-label="Upvote"
                            className={`flex items-center gap-0.5 px-2 py-1 text-slate-400 transition disabled:opacity-50 ${
                              msg.my_vote === 1 ? 'bg-apex-500/20 text-apex-300' : 'hover:text-white'
                            }`}
                          >
                            <ArrowUp size={12} />
                          </button>
                          <span
                            className={`flex items-center px-1.5 text-[11px] font-black tabular-nums ${
                              (msg.score || 0) > 0
                                ? 'text-apex-300'
                                : (msg.score || 0) < 0
                                  ? 'text-red-400'
                                  : 'text-slate-500'
                            }`}
                          >
                            {msg.score || 0}
                          </span>
                          <button
                            onClick={() => voteMessage(msg, -1)}
                            disabled={!canReact}
                            aria-label="Downvote"
                            className={`flex items-center gap-0.5 px-2 py-1 text-slate-400 transition disabled:opacity-50 ${
                              msg.my_vote === -1 ? 'bg-red-500/20 text-red-400' : 'hover:text-white'
                            }`}
                          >
                            <ArrowDown size={12} />
                          </button>
                        </div>
                      )}

                      {msg.reactions?.length > 0 && (
                        <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                          {msg.reactions.map((r) => (
                            <button
                              key={r.emoji}
                              onClick={() => toggleReaction(msg, r.emoji, !r.mine)}
                              disabled={!canReact}
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-black border transition disabled:opacity-60 ${
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

                      {msg.social?.length > 0 && (
                        <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                          {msg.social.map((s) => (
                            <span
                              key={s.action}
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-black border ${
                                s.mine
                                  ? 'bg-apex-500/20 border-apex-500/50 text-apex-300'
                                  : 'bg-slate-900 border-slate-800 text-slate-400'
                              }`}
                              title={s.label}
                            >
                              <span>{s.glyph}</span>
                              <span>{s.count}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </>
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
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-white"
                        >
                          <CornerUpLeft size={11} /> Reply
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setReactFor(reactFor === msg.id ? null : msg.id);
                          setOpenActions(null);
                        }}
                        disabled={!canReact}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-white disabled:opacity-50"
                      >
                        <Smile size={11} /> React
                      </button>
                      {canReact && roomSocial.length > 0 && (
                        <div className="inline-flex items-center gap-1">
                          {roomSocial.map((a) => (
                            <button
                              key={a.key}
                              onClick={() => sendSocial(msg, a.key)}
                              title={a.label}
                              className="w-7 h-7 rounded-lg bg-slate-900 border border-slate-800 text-sm hover:border-apex-500/60 transition"
                            >
                              {a.glyph}
                            </button>
                          ))}
                        </div>
                      )}
                      {msg.is_mine && (
                        <>
                          <button
                            onClick={() => {
                              setEditingId(msg.id);
                              setEditDraft(msg.content);
                              setOpenActions(null);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-white"
                          >
                            <Edit2 size={11} /> Edit
                          </button>
                          <button
                            onClick={() => deleteMessage(msg)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-[10px] font-black uppercase tracking-widest text-red-400 hover:text-red-300"
                          >
                            <Trash2 size={11} /> Delete
                          </button>
                        </>
                      )}
                      {!msg.is_mine && Number.isFinite(ali) && (
                        <button
                          onClick={() => toggleMute(ali)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-white"
                        >
                          <BellOff size={11} /> {isMuted ? 'Unmute' : 'Mute'}
                        </button>
                      )}
                      {!msg.is_mine && (
                        <button
                          onClick={() => openReport(msg)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-white"
                        >
                          <Flag size={11} /> Report
                        </button>
                      )}
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

        {systemEvents.map((ev) => (
          <div key={ev.id} className="flex items-center justify-center py-1">
            <span className="px-3 py-1 rounded-full bg-slate-900/80 border border-slate-800 text-[10px] font-bold text-slate-500 inline-flex items-center gap-1.5">
              {ev.type === 'join' && <Users size={10} />}
              {ev.type === 'departure' && <ArrowLeft size={10} />}
              {ev.type === 'state' && <RefreshCw size={10} />}
              {ev.type === 'wipe' && <Lock size={10} />}
              {ev.type === 'join' && (ev.alias ? `${`Anonymous #${String(ev.alias).padStart(2, '0')}`} joined` : 'A member joined')}
              {ev.type === 'departure' && (ev.alias ? `${`Anonymous #${String(ev.alias).padStart(2, '0')}`} left` : 'A member left')}
              {ev.type === 'state' && 'Room updated'}
              {ev.type === 'wipe' && 'This round was wiped'}
            </span>
          </div>
        ))}
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
            <div className="min-w-0 text-[11px] font-medium text-slate-500 truncate">
              <CornerUpLeft size={10} className="inline mr-1" />
              Replying to <span className="font-black" style={identityStyle(aliasNum(replyTo))}>{replyTo.author}</span>{' '}
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

        {(pendingTag || (encodedOn && isPremiumRoom)) && (
          <div className="flex items-center gap-1.5 flex-wrap px-1 pb-2">
            {pendingTag && tagMap.get(pendingTag) && (
              <span
                className={`inline-flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-full border text-[10px] font-black uppercase tracking-widest ${
                  TAG_TONE_CLASS[tagMap.get(pendingTag).tone] || 'bg-slate-800 text-slate-400 border-slate-700'
                }`}
              >
                {tagMap.get(pendingTag).label}
                <button onClick={() => setPendingTag(null)} className="hover:text-white">
                  <X size={11} />
                </button>
              </span>
            )}
            {encodedOn && isPremiumRoom && (
              <span className="inline-flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-full bg-violet-500/15 border border-violet-500/30 text-[10px] font-black uppercase tracking-widest text-violet-300">
                <Lock size={10} /> Encoded
                <span className="text-violet-100 normal-case font-bold tracking-normal">
                  {encodedRecipient != null
                    ? `to Anonymous #${String(encodedRecipient).padStart(2, '0')}`
                    : '· choose recipient'}
                </span>
                <button
                  onClick={() => {
                    setEncodedOn(false);
                    setEncodedRecipient(null);
                  }}
                  className="hover:text-white"
                >
                  <X size={11} />
                </button>
              </span>
            )}
          </div>
        )}

        {pickerOpen === 'tag' && canSpeak && (
          <div className="flex items-center gap-1.5 flex-wrap px-1 pb-2">
            {roomTags.map((t) => (
              <button
                key={t.key}
                onClick={() => {
                  setPendingTag(pendingTag === t.key ? null : t.key);
                  setPickerOpen(null);
                }}
                className={`px-2.5 py-1 rounded-full border text-[10px] font-black uppercase tracking-widest transition ${
                  TAG_TONE_CLASS[t.tone] || 'bg-slate-800 text-slate-400 border-slate-700'
                } ${pendingTag === t.key ? 'ring-1 ring-white/40' : ''}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        {mentionSuggestions.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap px-1 pb-2">
            {mentionSuggestions.map(([n]) => (
              <button
                key={n}
                onClick={() => insertMention(n)}
                className="px-2.5 py-1 rounded-full bg-slate-900 border border-slate-800 text-[11px] font-black"
                style={identityStyle(n)}
              >
                @Anonymous #{String(n).padStart(2, '0')}
              </button>
            ))}
          </div>
        )}

        {pickerOpen === 'recipient' && encodedOn && isPremiumRoom && canSpeak && (
          <div className="flex items-center gap-1.5 flex-wrap px-1 pb-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-violet-300 px-1">
              Encoded to
            </span>
            {knownAliases.length === 0 && (
              <span className="text-[11px] font-bold text-slate-500">No other members have spoken yet.</span>
            )}
            {knownAliases.map(([n]) => (
              <button
                key={n}
                onClick={() => {
                  setEncodedRecipient(n);
                  setPickerOpen(null);
                  setComposerError('');
                }}
                className={`px-2.5 py-1 rounded-full border text-[11px] font-black transition ${
                  encodedRecipient === n
                    ? 'bg-violet-500/20 border-violet-500/50 text-violet-200'
                    : 'bg-slate-900 border-slate-800 hover:border-violet-500/40'
                }`}
                style={identityStyle(n)}
              >
                @Anonymous #{String(n).padStart(2, '0')}
              </button>
            ))}
          </div>
        )}

        {composerError && <p className="text-[11px] font-bold text-red-400 px-1 mb-2">{composerError}</p>}

        <div className="flex items-center gap-1.5 px-1 pb-2">
          <button
            onClick={() => setPickerOpen(pickerOpen === 'tag' ? null : 'tag')}
            disabled={!canSpeak}
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border text-[10px] font-black uppercase tracking-widest transition disabled:opacity-40 ${
              pickerOpen === 'tag'
                ? 'bg-apex-500/20 border-apex-500/50 text-apex-300'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            <Plus size={12} /> Tag
          </button>
          <button
            onClick={() => {
              if (isPremiumRoom) {
                setEncodedOn((v) => {
                  if (v) setEncodedRecipient(null);
                  return !v;
                });
              } else setComposerError('Encoded Messages are a premium feature.');
            }}
            disabled={!canSpeak}
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border text-[10px] font-black uppercase tracking-widest transition disabled:opacity-40 ${
              encodedOn && isPremiumRoom
                ? 'bg-violet-500/20 border-violet-500/50 text-violet-300'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
            }`}
            title={isPremiumRoom ? 'Encoded Message' : 'Encoded Messages are premium'}
          >
            <Lock size={12} /> Encode
          </button>
          {encodedOn && isPremiumRoom && (
            <button
              onClick={() => setPickerOpen(pickerOpen === 'recipient' ? null : 'recipient')}
              disabled={!canSpeak}
              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border text-[10px] font-black uppercase tracking-widest transition disabled:opacity-40 ${
                pickerOpen === 'recipient' || encodedRecipient != null
                  ? 'bg-violet-500/20 border-violet-500/50 text-violet-300'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
              }`}
              title="Choose who can read the Encoded Message"
            >
              <Users size={12} /> To
              {encodedRecipient != null && <span className="text-violet-100">#{String(encodedRecipient).padStart(2, '0')}</span>}
            </button>
          )}
        </div>

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

      {showNotice && isMember && (
        <Modal onClose={() => setShowNotice(false)}>
          <div className="flex items-center gap-2 mb-3">
            <Shield size={20} className="text-apex-400" />
            <h2 className="font-black text-white text-lg">Room safety notice</h2>
            <span className="ml-auto text-[9px] font-black uppercase tracking-widest text-slate-500">
              v{room?.notice?.version ?? room?.config?.notice_version ?? 1}
            </span>
          </div>
          <ul className="space-y-3 text-sm font-medium text-slate-400">
            <li className="flex gap-2">
              <span className="text-apex-400 font-black">01</span>
              Be kind. No harassment, hate speech, threats or discrimination — the room is for nursing
              studies, not attacks.
            </li>
            <li className="flex gap-2">
              <span className="text-apex-400 font-black">02</span>
              Never share personal details about yourself or anyone else (names, phone numbers, addresses,
              handles).
            </li>
            <li className="flex gap-2">
              <span className="text-apex-400 font-black">03</span>
              Messages are ephemeral. Every message disappears exactly 10 minutes after it is sent, and a
              wiped round erases everything.
            </li>
            <li className="flex gap-2">
              <span className="text-apex-400 font-black">04</span>
              If you see something harmful, report it. The team can hide messages and restrict accounts.
            </li>
          </ul>
          <button
            onClick={acknowledgeNotice}
            disabled={noticeBusy}
            className="mt-5 w-full px-4 py-3 rounded-xl bg-apex-600 text-white font-black text-xs uppercase tracking-widest hover:bg-apex-700 disabled:opacity-50 inline-flex items-center justify-center gap-2"
          >
            {noticeBusy ? <Loader2 size={14} className="animate-spin" /> : <Shield size={14} />}
            I understand and agree
          </button>
        </Modal>
      )}

      {showRules && (
        <Modal onClose={() => setShowRules(false)}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-black text-white text-lg">Room safety & rules</h2>
            <button onClick={() => setShowRules(false)} className="text-slate-500 hover:text-white">
              <X size={18} />
            </button>
          </div>
          <ul className="space-y-3 text-sm font-medium text-slate-400">
            <li className="flex gap-2">
              <span className="text-apex-400 font-black">01</span>
              Your identity here is a temporary server-issued number (Anonymous #NN). Never share real names,
              handles or phone numbers.
            </li>
            <li className="flex gap-2">
              <span className="text-apex-400 font-black">02</span>
              Members speak; spectators watch and react only.
            </li>
            <li className="flex gap-2">
              <span className="text-apex-400 font-black">03</span>
              Every message is ephemeral — it disappears exactly 10 minutes after it is sent. A wiped round
              erases everything.
            </li>
            <li className="flex gap-2">
              <span className="text-apex-400 font-black">04</span>
              The room opens at {thresholds.activate ?? '—'} members and is wiped if it drops below{' '}
              {thresholds.survive ?? '—'}. Capacity is {memberLimit ?? '—'}.
            </li>
            <li className="flex gap-2">
              <span className="text-apex-400 font-black">05</span>
              Report harmful messages. You can also mute any Anonymous member locally.
            </li>
            <li className="flex gap-2">
              <span className="text-apex-400 font-black">06</span>
              Seats are live. Interact (send, reply, react, vote or use an action) at least once every{' '}
              {Math.round((room?.config?.membership?.activity_seconds ?? 900) / 60)} minutes or your seat is
              released so someone else can join. A heartbeat or open tab does not count — being present is not
              the same as participating.
            </li>
          </ul>
          {isMember && (
            <button
              onClick={() => {
                setShowRules(false);
                setExitOpen(true);
              }}
              disabled={leaving}
              className="mt-5 w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-400 font-black text-xs uppercase tracking-widest hover:text-white disabled:opacity-50"
            >
              Leave the room
            </button>
          )}
        </Modal>
      )}

      {releasedNotice && (
        <div className="fixed inset-0 z-50 bg-slate-950/95 backdrop-blur flex items-center justify-center p-5">
          <div className="w-full max-w-sm text-center">
            <div className="text-5xl mb-4">⏳</div>
            <h2 className="text-xl font-black text-white">Your seat was released</h2>
            <p className="text-sm font-medium text-slate-400 mt-2">
              You went {Math.round((room?.config?.membership?.activity_seconds ?? 900) / 60)} minutes without
              interacting, so your seat in this Anonymous room was released for someone else. You can rejoin
              whenever a spot is open.
            </p>
            <div className="flex flex-col gap-2.5 mt-6">
              <button
                onClick={() => navigate('/dashboard')}
                className="w-full px-4 py-3 rounded-xl bg-apex-600 text-white font-black text-xs uppercase tracking-widest hover:bg-apex-700 inline-flex items-center justify-center gap-2"
              >
                <ArrowLeft size={14} />
                Return to Home
              </button>
              <button
                onClick={() => setReleasedNotice(false)}
                className="w-full px-4 py-3 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 font-black text-xs uppercase tracking-widest hover:text-white"
              >
                Stay here
              </button>
            </div>
          </div>
        </div>
      )}

      {exitOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/95 backdrop-blur flex items-center justify-center p-5">
          <div className="w-full max-w-sm text-center">
            {leaving ? (
              <>
                <Loader2 size={40} className="mx-auto text-apex-400 animate-spin mb-4" />
                <h2 className="text-xl font-black text-white">Leaving Anonymous Room…</h2>
                <p className="text-sm font-medium text-slate-400 mt-2">
                  Releasing your seat. Hold on a moment.
                </p>
              </>
            ) : (
              <>
                <div className={`text-5xl mb-4 ${prefersReducedMotion ? '' : 'animate-bounce'}`}>👋</div>
                <h2 className="text-xl font-black text-white">Leave the Anonymous room?</h2>
                <p className="text-sm font-medium text-slate-400 mt-2">
                  Your messages stay posted anonymously, but your seat is released. If membership falls below{' '}
                  {thresholds.survive ?? 'the minimum'}, the whole round is wiped.
                </p>
                <div className="flex flex-col gap-2.5 mt-6">
                  <button
                    onClick={leaveRoom}
                    disabled={leaving}
                    className="w-full px-4 py-3 rounded-xl bg-red-600 text-white font-black text-xs uppercase tracking-widest hover:bg-red-700 disabled:opacity-50 inline-flex items-center justify-center gap-2"
                  >
                    <ArrowLeft size={14} />
                    Confirm Exit
                  </button>
                  <button
                    onClick={() => setExitOpen(false)}
                    className="w-full px-4 py-3 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 font-black text-xs uppercase tracking-widest hover:text-white"
                  >
                    Stay in Room
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {reportFor && (
        <Modal onClose={() => setReportFor(null)}>
          <div className="flex items-center gap-2 mb-3">
            <Flag size={18} className="text-red-400" />
            <h2 className="font-black text-white text-lg">Report a message</h2>
          </div>
          <p className="text-[11px] font-medium text-slate-500 mb-3 truncate">
            <span className="font-black" style={identityStyle(aliasNum(reportFor))}>{reportFor.author}</span>{' '}
            {reportFor.content}
          </p>
          <div className="space-y-2">
            {REPORT_CATEGORIES.map((c) => (
              <label
                key={c.value}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl border cursor-pointer text-sm font-bold ${
                  reportCategory === c.value
                    ? 'bg-apex-500/15 border-apex-500/40 text-white'
                    : 'bg-slate-950 border-slate-800 text-slate-400'
                }`}
              >
                <input
                  type="radio"
                  name="report-category"
                  className="accent-apex-500"
                  checked={reportCategory === c.value}
                  onChange={() => setReportCategory(c.value)}
                />
                {c.label}
              </label>
            ))}
          </div>
          <textarea
            value={reportDetails}
            onChange={(e) => setReportDetails(e.target.value)}
            rows={2}
            maxLength={200}
            placeholder="Add any details (optional)"
            className="mt-3 w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-sm font-medium text-slate-200 outline-none focus:border-apex-500 resize-none"
          />
          {reportError && <p className="text-[11px] font-bold text-red-400 mt-2">{reportError}</p>}
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => setReportFor(null)}
              className="flex-1 px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 font-black text-xs uppercase tracking-widest"
            >
              Cancel
            </button>
            <button
              onClick={submitReport}
              disabled={reportBusy}
              className="flex-1 px-4 py-2.5 rounded-xl bg-red-600 text-white font-black text-xs uppercase tracking-widest hover:bg-red-700 disabled:opacity-50 inline-flex items-center justify-center gap-2"
            >
              {reportBusy ? <Loader2 size={14} className="animate-spin" /> : <Flag size={14} />}
              Submit report
            </button>
          </div>
        </Modal>
      )}

      {lockedOptionsOpen && (
        <Modal onClose={() => setLockedOptionsOpen(false)}>
          <div className="flex items-center gap-2 mb-3">
            <Lock size={18} className="text-apex-400" />
            <h2 className="font-black text-white text-lg">Membership is closed</h2>
          </div>
          <p className="text-sm font-medium text-slate-400 mt-1">
            This room isn't taking new members right now. You have three options:
          </p>
          <div className="flex flex-col items-stretch gap-2.5 mt-5">
            <button
              onClick={() => {
                setLockedOptionsOpen(false);
                setConfirmSpectate(true);
              }}
              disabled={buying || creatingRoom}
              className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-apex-600 text-white font-black text-xs uppercase tracking-widest hover:bg-apex-700 disabled:opacity-50 transition"
            >
              {buying ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
              Watch as Spectator — ₦{price ?? '…'}
            </button>
            <button
              onClick={() => {
                setLockedOptionsOpen(false);
                createAnonRoom();
              }}
              disabled={buying || creatingRoom}
              className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 font-black text-xs uppercase tracking-widest hover:bg-slate-700 disabled:opacity-50 transition"
            >
              {creatingRoom ? <Loader2 size={14} className="animate-spin" /> : <Users size={14} />}
              Create a new Anonymous room
            </button>
            <button
              onClick={() => {
                setLockedOptionsOpen(false);
                navigate('/study-groups');
              }}
              className="px-4 py-2.5 rounded-xl bg-transparent border border-slate-800 text-slate-400 font-black text-xs uppercase tracking-widest hover:text-white transition"
            >
              Return to groups
            </button>
          </div>
        </Modal>
      )}

      {confirmSpectate && (
        <Modal onClose={() => setConfirmSpectate(false)}>
          <div className="flex items-center gap-2 mb-3">
            <Eye size={18} className="text-apex-400" />
            <h2 className="font-black text-white text-lg">Buy a spectator pass?</h2>
          </div>
          <p className="text-sm font-medium text-slate-400 mt-1">
            You'll be charged a one-time <span className="text-white font-black">₦{price ?? '…'}</span> to
            watch this room — read and react, never post. The pass is non-refundable and ends with the room
            round.
          </p>
          <div className="flex gap-2 mt-5">
            <button
              onClick={() => setConfirmSpectate(false)}
              disabled={buying}
              className="flex-1 px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 font-black text-xs uppercase tracking-widest"
            >
              Cancel
            </button>
            <button
              onClick={buySpectator}
              disabled={buying}
              className="flex-1 px-4 py-2.5 rounded-xl bg-apex-600 text-white font-black text-xs uppercase tracking-widest hover:bg-apex-700 disabled:opacity-50 inline-flex items-center justify-center gap-2"
            >
              {buying ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
              Pay ₦{price ?? '…'}
            </button>
          </div>
        </Modal>
      )}

      {pushOpen && (
        <Modal onClose={() => setPushOpen(false)}>
          <div className="flex items-center gap-2 mb-3">
            <Bell size={18} className="text-apex-400" />
            <h2 className="font-black text-white text-lg">Notifications</h2>
            <button onClick={() => setPushOpen(false)} className="ml-auto text-slate-500 hover:text-white">
              <X size={16} />
            </button>
          </div>
          {pushState.supported ? (
            <>
              <p className="text-sm font-medium text-slate-400">
                Get a quiet alert when a new message or a new member arrives in this room. Message
                content is never included in a notification.
              </p>
              {pushState.permission === 'denied' && (
                <p className="text-[11px] font-bold text-amber-400 mt-3">
                  Notifications are blocked in your browser settings. Enable them for this site to turn
                  this on.
                </p>
              )}
              {composerError && <p className="text-[11px] font-bold text-red-400 mt-2">{composerError}</p>}
              <button
                onClick={togglePush}
                disabled={pushBusy}
                className={`mt-4 w-full px-4 py-3 rounded-xl font-black text-xs uppercase tracking-widest inline-flex items-center justify-center gap-2 disabled:opacity-50 transition ${
                  pushState.subscribed
                    ? 'bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700'
                    : 'bg-apex-600 text-white hover:bg-apex-700'
                }`}
              >
                {pushBusy ? <Loader2 size={14} className="animate-spin" /> : pushState.subscribed ? <VolumeX size={14} /> : <Bell size={14} />}
                {pushState.subscribed ? 'Turn off notifications' : 'Turn on notifications'}
              </button>

              <div className="mt-4 border-t border-slate-800 pt-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">
                  Notify me about
                </p>
                {[
                  { key: 'room_messages', label: 'Messages that mention or reply to me' },
                  { key: 'member_joins', label: 'New members joining' },
                  { key: 'social', label: 'Social actions aimed at me' },
                ].map((row) => (
                  <button
                    key={row.key}
                    onClick={() => togglePref(row.key)}
                    disabled={prefsBusy || !pushPrefsReady}
                    aria-pressed={!!pushPrefs[row.key]}
                    className="w-full flex items-center justify-between gap-3 px-2 py-2 rounded-xl hover:bg-slate-800/60 transition disabled:opacity-60"
                  >
                    <span className="text-left text-[12px] font-bold text-slate-300">{row.label}</span>
                    <span
                      className={`relative w-9 h-5 rounded-full transition shrink-0 ${
                        pushPrefs[row.key] ? 'bg-apex-600' : 'bg-slate-700'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${
                          pushPrefs[row.key] ? 'left-[1.15rem]' : 'left-0.5'
                        }`}
                      />
                    </span>
                  </button>
                ))}
                <p className="text-[10px] font-bold text-slate-600 px-2 mt-1">
                  Preferences are saved to your account and apply once notifications are on.
                </p>
              </div>
            </>
          ) : (
            <p className="text-sm font-medium text-slate-400">
              This browser does not support push notifications.
            </p>
          )}
        </Modal>
      )}
    </div>
  );
};

const Modal = ({ children, onClose }) => (
  <div
    className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-5"
    onClick={(e) => {
      if (e.target === e.currentTarget) onClose?.();
    }}
  >
    <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-3xl p-6 max-h-[90vh] overflow-y-auto">
      {children}
    </div>
  </div>
);

export default AnonymousRoom;
