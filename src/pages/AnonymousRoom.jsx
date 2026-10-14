import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  useLayoutEffect,
} from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
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
  Share2,
  Check,
  Copy,
  Compass,
} from '../components/Icons';
import { communityApi, communityPreview } from '../utils/communityApi';
import { clearAnonVisitKey } from '../utils/anonVisit';
import { authHeaders } from '../utils/apiHeaders';
import { useAnonymousRoomRealtime } from '../hooks/useAnonymousRoomRealtime';
import { useAppContext } from '../context/AppContext';
import {
  playMessagePop,
  playJoinChime,
  playChallengeTone,
  playLockTone,
  playRevealTone,
  playActionSfx,
} from '../utils/anonSound';
import { pushSupported, getPushState, enablePush, disablePush, savePreferences } from '../utils/push';

const TYPING_TTL_MS = 3000;
const TYPING_THROTTLE_MS = 2500;
const MUTE_KEY = 'apex:anon_muted_aliases';
// Rightward drag (px) on a touch device that arms a WhatsApp-style reply.
const SWIPE_REPLY_THRESHOLD = 64;
// v54 — action/challenge/fight event cards die at the same 10 minutes as
// messages. Mirrors the server's EVENT_LIFETIME_MS (config.event_lifetime_seconds).
const EVENT_LIFETIME_SECONDS = 600;

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
  MEMBERSHIP_PAYMENT_REQUIRED: 'All free founding member seats are taken. A one-time fee unlocks a member seat.',
  ALREADY_SPECTATOR: 'You have spectator access here, so you cannot also take a member seat. Spectating is enough.',
  OWNER_CANNOT_LEAVE: 'You created this room, so you cannot leave it. Close the room from your group controls instead.',
  SPECTATOR_PAYMENT_REQUIRED: 'All free spectator slots are taken. A one-time pass unlocks spectator access.',
  SPECTATOR_FREE_AVAILABLE: 'A free spectator seat is still open.',
  MEMBERSHIP_FREE_AVAILABLE: 'A free member seat is still open.',
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
  SOCIAL_RATE_LIMITED: 'You have used a lot of actions just now — take a short break.',
  SOCIAL_BLOCKED: 'This member is not accepting that action.',
  SOCIAL_DECLINED: 'This member is declining interactions right now.',
  TARGET_REQUIRED: 'Pick another member for this action.',
  TARGET_NOT_IN_ROOM: 'That member is not in this room.',
  REACTION_NOT_ALLOWED: 'That reaction is not available.',
  INVALID_RESPOND: 'Respond with accept or decline.',
  NOT_AUTHORIZED: 'Only the challenged member may respond.',
  EVENT_RESOLVED: 'This challenge has already been resolved.',
  INVALID_ACTION: 'Unknown encoded-message action.',
  INVALID_MOVE: 'Pick rock, paper or scissors.',
  DUEL_NOT_FOUND: 'That bout is not available.',
  DUEL_RESOLVED: 'This bout is already finished.',
  DUEL_ALREADY_PICKED: 'You already threw.',
  NOT_IN_DUEL: 'You are not in this bout.',
  NOT_ENCODED: 'That message is not encoded.',
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
  // v62 - 'pink' (kiss AND the whole crack/belle gag chain) had no entry, so
  // those actions silently fell back to the neutral slate pill.
  pink: 'bg-pink-500/15 text-pink-300 border-pink-500/40',
  slate: 'bg-slate-800 text-slate-400 border-slate-700',
};

// v62 - EVENT CARD surface per tone. This replaces a 3-branch ternary that
// only knew rose/violet+indigo, so 15 of the 18 possible actions rendered as
// the SAME slate card (waka, hug, highfive, kiss, crack, wave, and the entire
// belle/denied/birth chain were indistinguishable apart from their emoji).
// Every tone the server can emit now has a real treatment, and `indigo` no
// longer collapses onto `violet`.
const EVENT_TONE_CLASS = {
  rose: 'border-rose-500/40 bg-rose-500/10',
  pink: 'border-pink-500/40 bg-pink-500/10',
  amber: 'border-amber-500/40 bg-amber-500/10',
  emerald: 'border-emerald-500/40 bg-emerald-500/10',
  sky: 'border-sky-500/40 bg-sky-500/10',
  violet: 'border-violet-500/40 bg-violet-500/10',
  indigo: 'border-indigo-500/40 bg-indigo-500/10',
  slate: 'border-slate-800 bg-slate-900/80',
};
const eventToneClass = (tone) => EVENT_TONE_CLASS[tone] || EVENT_TONE_CLASS.slate;

// v62 - entrance animation per card KIND. Purely decorative, and it uses CSS
// keyframes (see src/index.css) rather than framer-motion, so it adds nothing
// to the render-blocking bundle. Every one of these is suppressed when the
// reader prefers reduced motion - see `animateEvent` below.
const EVENT_ENTER_CLASS = {
  challenge: 'room-card-enter-challenge',
  fight: 'room-card-enter-fight',
  duel: 'room-card-enter-duel',
  announce: 'room-card-enter-announce',
  action: 'room-card-enter-action',
};

// `reduced` is the component's existing prefersReducedMotion value, so the
// reduced-motion path stays a single source of truth and keeps satisfying the
// verify-deploy-config gate on `prefersReducedMotion`.
const eventEnterClass = (kind, reduced) =>
  reduced ? '' : (EVENT_ENTER_CLASS[kind] || EVENT_ENTER_CLASS.action);

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

// v62 - per-identity colour so the same Anonymous #NN always looks the same
// within a round, without ever touching a real identity.
//
// This used to be `(n * 47) % 360`. That is a linear congruential step with an
// EXACT period of 360, so alias n and alias n+360 were byte-identical colours by
// construction, and aliases 8 apart landed only 16 degrees apart — visually the
// SAME colour. That systematic near-miss is what made two people look
// identically coloured far more often than chance.
//
// It is now an FNV-1a hash (no arithmetic neighbours: n and n+1 land unrelated)
// indexing a curated palette of 24 hues x 3 lightness bands = 72 swatches:
//   - same lightness -> hues are 15 degrees apart (clearly distinct);
//   - same hue       -> lightness steps 12% (clearly distinct);
// so ANY two different swatches are distinguishable, and when two members do
// share a swatch it is an obvious identical match rather than a confusing
// near-miss.
//
// Residual, stated plainly: with a fixed client-side palette, two of the room's
// 20 free member seats can still draw the same swatch (~95% of rooms will
// contain at least one such pair). That is arithmetic, not a bug — eliminating
// it entirely needs a server-assigned per-room colour slot. The #NN is
// therefore never hidden next to the coloured name.
const IDENTITY_HUES = [
  0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165,
  180, 195, 210, 225, 240, 255, 270, 285, 300, 315, 330, 345,
];
const IDENTITY_LIGHT_BANDS = [64, 76, 88];
const IDENTITY_SATURATION = 80;
// Three deep hues cannot clear 4.5:1 at lightness 64 against slate-950, so
// they start one step lighter. Verified: worst swatch in the built palette is
// 4.82:1.
const IDENTITY_HUE_LIGHTNESS_FLOOR = { 240: 68, 255: 66 };
// A deliberately desaturated swatch for an alias we cannot parse. The old code
// fell back to hue 220, so every unparseable alias (e.g. a reply preview whose
// author alias is null) silently painted the SAME blue.
const IDENTITY_UNKNOWN = { hue: 0, saturation: 30, lightness: 54 };

const identitySwatch = (alias) => {
  const n = Number(alias);
  if (!Number.isInteger(n) || n <= 0) return IDENTITY_UNKNOWN;
  let h = 0x811c9dc5;
  const s = String(n);
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const index = h % IDENTITY_HUES.length;
  const hue = IDENTITY_HUES[index];
  const floor = IDENTITY_HUE_LIGHTNESS_FLOOR[hue];
  // Take the lightness band from DIFFERENT hash bits than the hue. Using
  // `h % IDENTITY_LIGHT_BANDS.length` would be perfectly correlated with
  // `h % 24` (since 24 % 3 === 0), collapsing all 72 swatches back down to 24
  // reachable ones. Dividing first takes an independent slice of the hash.
  const band = IDENTITY_LIGHT_BANDS[Math.floor(h / IDENTITY_HUES.length) % IDENTITY_LIGHT_BANDS.length];
  return {
    hue,
    saturation: IDENTITY_SATURATION,
    lightness: floor ? Math.max(band, floor) : band,
  };
};

const identityStyle = (alias) => {
  const { hue, saturation, lightness } = identitySwatch(alias);
  return { color: `hsl(${hue} ${saturation}% ${lightness}%)` };
};

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

// Parse "Anonymous #NN" back into the room number (identity colour, targeting).
const labelAliasNum = (label) => {
  if (label == null) return null;
  const m = String(label).match(/#(\d+)/);
  return m ? Number(m[1]) : null;
};

// v54 — full human-readable sentences for event cards (no truncation, wraps to
// a second line): "Anonymous #235 kicked Anonymous #344". `EVENT_AFTER` holds a
// suffix inserted after the target ("… told Anonymous #344 to fuck off").
const EVENT_VERB = {
  punch: 'punched',
  kick: 'kicked',
  fuckoff: 'told',
  waka: 'waka’d at',
  hug: 'hugged',
  highfive: 'high-fived',
  kiss: 'kissed',
  danceoff: 'started a dance-off with',
  wave: 'waved at',
  challenge: 'challenged',
  fight: 'fought',
  // v62 — the consent-gated gag. The invite reads as a move, not an attack.
  crack: 'toasted',
};
const EVENT_AFTER = {
  fuckoff: 'to fuck off',
};

// v62 — opt-in rock-paper-scissors on a FIGHT card. Nothing is forced: the
// fighter taps to open the panel, throws once, and sees the opponent's throw
// only after both are in. Moves are hidden server-side until the bout settles.
const RPS_MOVES_UI = [
  { key: 'rock', emoji: '✊', label: 'Rock' },
  { key: 'paper', emoji: '✋', label: 'Paper' },
  { key: 'scissors', emoji: '✌️', label: 'Scissors' },
];

const RpsPanel = ({ ev, duel, duelBusy, onOpen, onPick }) => {
  const [open, setOpen] = useState(false);
  // The bout is only playable by the two fighters; the server refuses anyone
  // else, so we simply do not offer the button to other viewers.
  const eligible = duel != null;
  if (!open && !eligible) {
    return (
      <button
        onClick={() => {
          setOpen(true);
          onOpen?.(ev);
        }}
        className="mt-2 w-full rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-white hover:border-slate-700 transition"
      >
        🥊 Fight! Rock-Paper-Scissors
      </button>
    );
  }

  const done = duel?.status === 'done';
  return (
    <div className="mt-2 rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2.5">
      {!duel ? (
        <p className="text-[10px] font-bold text-slate-500">
          {duelBusy ? 'Opening the bout…' : 'Waiting for the bout to open…'}
        </p>
      ) : done ? (
        <div className="text-[11px] font-bold text-slate-300">
          <span className="block text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1">
            Rock-Paper-Scissors
          </span>
          <span className="flex items-center gap-2 flex-wrap">
            <span>You: {RPS_MOVES_UI.find((m) => m.key === duel.your_throw)?.emoji ?? '?'}</span>
            <span className="text-slate-500">vs</span>
            <span>{duel.them}: {RPS_MOVES_UI.find((m) => m.key === duel.their_throw)?.emoji ?? '?'}</span>
            <span
              className={`ml-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest border ${
                duel.you_won
                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                  : duel.result === 'lost'
                    ? 'bg-rose-500/15 text-rose-300 border-rose-500/40'
                    : 'bg-slate-800 text-slate-400 border-slate-700'
              }`}
            >
              {duel.you_won ? 'You won' : duel.result === 'lost' ? 'You lost' : 'Draw'}
            </span>
          </span>
        </div>
      ) : (
        <div>
          <span className="block text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1.5">
            Rock-Paper-Scissors
          </span>
          {duel.your_move ? (
            <p className="text-[11px] font-bold text-slate-400">
              You threw {RPS_MOVES_UI.find((m) => m.key === duel.your_move)?.emoji}{' '}
              {duel.opponent_locked
                ? `${duel.them} locked in — settling…`
                : `waiting for ${duel.them} to throw…`}
            </p>
          ) : (
            <>
              <p className="text-[11px] font-bold text-slate-400 mb-2">
                Pick one against {duel.them}. One throw each — it settles when both are in.
              </p>
              <div className="flex items-center gap-2">
                {RPS_MOVES_UI.map((m) => (
                  <button
                    key={m.key}
                    onClick={() => onPick?.(duel.id, m.key)}
                    disabled={duelBusy}
                    className="flex-1 rounded-lg border border-slate-800 bg-slate-900 px-2 py-2 text-lg hover:border-apex-500/60 hover:bg-slate-800 disabled:opacity-40 transition"
                    aria-label={m.label}
                  >
                    {m.emoji}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

// v53 — an EVENT CARD sits inline in the timeline (an action aimed at another
// member, a pending CHALLENGE invite, or a FIGHT). Members and spectators can
// react to it; a challenged member can Accept (starts the fight) or Decline.
const RoomEventCard = ({ ev, canReact, canDuel, busy, onReact, onRespond, onMention, reactionPalette, duel, duelBusy, onDuelOpen, onDuelPick, reducedMotion }) => {
  const palette = Array.isArray(reactionPalette) && reactionPalette.length ? reactionPalette : ['👍', '😂', '❤️', '🔥', '🤔'];
  const isPendingChallenge = ev.kind === 'challenge' && ev.status === 'pending';
  const actorN = labelAliasNum(ev.actor);
  const targetN = labelAliasNum(ev.target);
  const busyId = busy && busy.id === ev.id;
  // v62 - real per-tone surface (was a 3-branch ternary) plus a per-kind
  // entrance animation that is dropped entirely for reduced-motion readers.
  const borderClass = eventToneClass(ev.tone);
  const enterClass = eventEnterClass(ev.kind, reducedMotion);
  return (
    <div className={`mx-auto my-2 w-[92%] max-w-[min(100%,560px)] ${enterClass}`}>
      <div className={`rounded-2xl border px-3.5 py-2.5 ${borderClass}`}>
        <div className="flex items-center gap-2.5">
          <span className="w-9 h-9 shrink-0 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-center text-lg">
            {ev.glyph}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] font-black text-slate-200 uppercase tracking-widest">{ev.label}</span>
              {ev.kind === 'challenge' && (
                <span
                  className={`px-1.5 py-0.5 rounded-full border text-[8px] font-black uppercase tracking-widest ${
                    ev.status === 'accepted'
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                      : ev.status === 'declined'
                        ? 'bg-slate-800 text-slate-500 border-slate-700'
                        : 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                  }`}
                >
                  {ev.status === 'accepted' ? 'Accepted — it is on!' : ev.status === 'declined' ? 'Declined' : 'Challenge'}
                </span>
              )}
              {ev.kind === 'fight' && (
                <span className="px-1.5 py-0.5 rounded-full border border-rose-500/40 bg-rose-500/15 text-rose-300 text-[8px] font-black uppercase tracking-widest inline-flex items-center gap-1">
                  <Swords size={8} /> Fight
                </span>
              )}
              {ev.kind === 'announce' && (
                <span className="px-1.5 py-0.5 rounded-full border border-slate-700 bg-slate-900 text-slate-400 text-[8px] font-black uppercase tracking-widest">
                  Announcement
                </span>
              )}
              <span className="text-[9px] font-bold text-slate-600">{timeOf(ev.created_at)}</span>
            </div>
            {ev.text ? (
              // v62 — system/gag lines bring their own sentence from the server
              // (alias-only). The generic actor/verb/target shape cannot render
              // "don get belle" or "gave birth to quadruplets".
              <p className="text-[12px] font-bold text-slate-300 mt-0.5 leading-relaxed">{ev.text}</p>
            ) : (
              <p className="text-[12px] font-medium text-slate-400 mt-0.5 flex items-center flex-wrap gap-x-1 leading-relaxed">
                <button
                  type="button"
                  disabled={!onMention || actorN == null}
                  onClick={() => actorN != null && onMention?.(actorN)}
                  className={`${onMention && actorN != null ? 'hover:underline' : 'cursor-default'} font-bold`}
                  style={identityStyle(actorN)}
                >
                  {ev.actor}
                </button>
                <span className="text-slate-300">{EVENT_VERB[ev.action] || ev.label?.toLowerCase() || 'interacted with'}</span>
                {ev.target ? (
                  <button
                    type="button"
                    disabled={!onMention || targetN == null}
                    onClick={() => targetN != null && onMention?.(targetN)}
                    className={`${onMention && targetN != null ? 'hover:underline' : 'cursor-default'} font-bold`}
                    style={identityStyle(targetN)}
                  >
                    {ev.target}
                  </button>
                ) : (
                  <span className="text-slate-500">the room</span>
                )}
                {EVENT_AFTER[ev.action] ? <span className="text-slate-300">{EVENT_AFTER[ev.action]}</span> : null}
              </p>
            )}
          </div>
          {isPendingChallenge && ev.can_respond && (
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => onRespond?.(ev, 'accept')}
                disabled={busyId}
                className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-[9px] font-black uppercase tracking-widest hover:bg-emerald-700 disabled:opacity-40"
              >
                Accept
              </button>
              <button
                onClick={() => onRespond?.(ev, 'decline')}
                disabled={busyId}
                className="px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 text-[9px] font-black uppercase tracking-widest hover:text-white disabled:opacity-40"
              >
                Decline
              </button>
            </div>
          )}
        </div>

        {ev.kind === 'fight' && canDuel && (
          <RpsPanel ev={ev} duel={duel} duelBusy={duelBusy} onOpen={onDuelOpen} onPick={onDuelPick} />
        )}

        {canReact && (
          <div className="flex items-center gap-1.5 flex-wrap mt-2">
            {palette.map((emoji) => {
              const existing = (ev.reactions || []).find((r) => r.emoji === emoji);
              return (
                <button
                  key={emoji}
                  onClick={() => onReact?.(ev, emoji, !existing?.mine)}
                  disabled={busyId}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-black border transition disabled:opacity-60 ${
                    existing?.mine
                      ? 'bg-apex-500/20 border-apex-500/50 text-apex-300'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <span>{emoji}</span>
                  {existing?.count > 0 ? <span>{existing.count}</span> : null}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
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

// WS4 — logged-out preview of a deep-linked Anonymous room (/anonymous/:id).
// Rendered ONLY while there is no session: the room's public metadata + a
// sign-in CTA. Nothing private is shown (no messages, aliases, or roster). The
// seat counts come from the server's public preview endpoint which runs with
// the service role, so even these numbers are not exposed to the anon DB role.
const RoomPreview = ({ preview, error, locationPath }) => {
  const navigate = useNavigate();
  const group = preview?.room;
  const seats = preview?.capacity;
  const showSeats = typeof seats?.total_capacity === 'number';
  const ended = group?.group_state === 'wiped';
  const stateLabel = ended ? 'This round has ended'
    : group?.group_state === 'active'
      ? 'Open now'
      : 'Opens soon · waiting';
  const signIn = () => navigate('/login', { state: { from: locationPath || '/anonymous' } });

  return (
    <div className="h-[100dvh] bg-slate-950 text-slate-200">
      <GateCard>
        <MessageCircle size={38} className="mx-auto mb-3 text-apex-400" />
        <h1 className="text-xl font-black text-white">{group?.name || 'Anonymous Room'}</h1>

        {!error && group && (
          <>
            <span
              className={`inline-block mt-3 px-3 py-1 rounded-full text-[11px] font-black uppercase tracking-widest ${
                ended ? 'bg-red-500/15 text-red-300' : 'bg-apex-500/15 text-apex-300'
              }`}
            >
              {stateLabel}
            </span>
            <div className="text-sm text-slate-400 font-medium mt-4 space-y-1.5">
              <p>
                {showSeats
                  ? `${seats.member_count ?? 0}/${seats.total_capacity} spots taken · ${seats.spectator_count ?? 0} watching`
                  : `${seats?.member_count ?? 0} spots taken`}
              </p>
              {seats?.member_paid_required && typeof seats.member_price === 'number' && (
                <p>Member seat ₦{seats.member_price}</p>
              )}
              {typeof seats?.spectator_price === 'number' && !ended && (
                <p>Spectator pass ₦{seats.spectator_price}</p>
              )}
              <p className="italic text-slate-500">Everyone stays Anonymous in here.</p>
            </div>
          </>
        )}

        {error && !group && (
          <>
            <p className="text-sm text-red-300 font-medium mt-4">{error}</p>
            <div className="flex items-center justify-center gap-3 mt-6">
              <button
                onClick={() => navigate(0)}
                className="px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 font-black text-xs uppercase tracking-widest"
              >
                Retry
              </button>
            </div>
          </>
        )}

        <div className="flex items-center justify-center gap-3 mt-6">
          <button
            onClick={() => navigate('/study-groups')}
            className="px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 font-black text-xs uppercase tracking-widest"
          >
            Browse groups
          </button>
          <button
            onClick={signIn}
            className="px-5 py-2.5 rounded-xl bg-apex-600 text-white font-black text-xs uppercase tracking-widest"
          >
            {ended ? 'Start a new round' : 'Sign in to join'}
          </button>
        </div>
      </GateCard>
    </div>
  );
};

const AnonymousRoom = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { session } = useAppContext();

  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState('');
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState('');
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
  // Count of timeline rows (messages AND event cards) that arrived since the
  // reader was last at the bottom. The pill is driven by this REAL set
  // difference — not by "the messages array identity changed" — so reacting,
  // voting, editing or expiring an old row can never raise a phantom prompt.
  const [newRowsCount, setNewRowsCount] = useState(0);
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
  const [confirmMembership, setConfirmMembership] = useState(false);
  const [buyingMembership, setBuyingMembership] = useState(false);
  // P3 — multi-slot purchases + single-slot gifting.
  const [bundleCount, setBundleCount] = useState(1);
  const [bundleForMe, setBundleForMe] = useState(true);
  const [giftPanelOpen, setGiftPanelOpen] = useState(false);
  const [giftClaimOpen, setGiftClaimOpen] = useState(false);
  const [giftCodeInput, setGiftCodeInput] = useState('');
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimResult, setClaimResult] = useState(null);
  const [giftCopied, setGiftCopied] = useState(null);
  const [resolvedGiftParam, setResolvedGiftParam] = useState(false);
  const [spectating, setSpectating] = useState(false);
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [browseRooms, setBrowseRooms] = useState(null);
  const [browseBusy, setBrowseBusy] = useState(false);
  const [browseError, setBrowseError] = useState('');

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

  // v53 — interleaved event cards + the Actions bottom sheet (aim an action at
  // another member) + the viewer's anti-slam opt-out.
  const [events, setEvents] = useState([]);
  const [actionSheetOpen, setActionSheetOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const [actionTarget, setActionTarget] = useState(null);
  const [actionMessage, setActionMessage] = useState(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionCooldownUntil, setActionCooldownUntil] = useState(0);
  const [eventBusyFor, setEventBusyFor] = useState(null);
  // v62 — opt-in rock-paper-scissors state, keyed by the fight card's event id.
  const [duels, setDuels] = useState({});
  const [duelBusy, setDuelBusy] = useState(false);
  // Mirrors `duels` for the realtime handler (which must not resubscribe on
  // every throw just to read the current map).
  const duelsRef = useRef({});
  const [declining, setDeclining] = useState(false);
  const [decliningBusy, setDecliningBusy] = useState(false);
  // Server roster: every current member's Anonymous #NN + live online flag, so
  // an action can be aimed at anyone present — not only recent posters.
  const [roster, setRoster] = useState([]);
  const [rosterQuery, setRosterQuery] = useState('');

  const scrollRef = useRef(null);
  const atBottomRef = useRef(true);
  const firstLoadRef = useRef(true);
  const justSentRef = useRef(false);
  const prependKeepRef = useRef(null);
  // Every timeline row (message + event card) the reader has actually seen —
  // i.e. that was rendered while they were at (or auto-scrolled to) the bottom.
  // The "new messages" pill is `current - seen`, so it only ever counts rows
  // that genuinely arrived after they scrolled away.
  const seenRowsRef = useRef(new Set());
  const draftRef = useRef(null);
  const lastTypingSentRef = useRef(0);
  const lastActivityRef = useRef(Date.now());
  const presenceKeyRef = useRef(`s:${Math.random().toString(36).slice(2, 10)}`);
  const bootstrapInFlightRef = useRef(null);
  const lastAccessRef = useRef(null);
  // True only between a CONFIRMED voluntary leave and the next successful
  // join. Keeps detectRelease from mis-reading a deliberate exit as an
  // inactivity release (which raised a blocking modal over a re-joined room).
  const leftDeliberatelyRef = useRef(false);
  const seenSoundIdsRef = useRef(new Set());
  const soundRef = useRef(soundOn);
  const olderCursorRef = useRef(null);
  const celebrationTimerRef = useRef(null);
  const fightTimerRef = useRef(null);
  const giftCopiedTimerRef = useRef(null);
  // alias -> last-celebrated timestamp. Join broadcasts can be delivered again
  // on a reconnect/reconcile; this keeps one celebration per member per TTL.
  const celebratedRef = useRef(new Map());
  // WhatsApp-style swipe-to-reply: { id, dx } for the row being dragged, plus
  // the raw pointer start used by the pointermove/up handlers.
  const [swipeReply, setSwipeReply] = useState(null);
  const swipeStartRef = useRef(null);
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
  // P2 — capacity + monetization. `capacity` is the server-computed breakdown;
  // the group fallbacks keep the UI sane if an old room lacks the field.
  const capacity = room?.capacity || {};
  const foundingCap = capacity.founding_member_cap ?? room?.group?.founding_member_cap ?? null;
  const freeSpecCap = capacity.free_spectator_cap ?? room?.group?.free_spectator_cap ?? null;
  const memberPrice = capacity.member_price ?? room?.group?.member_price ?? null;
  const seatMemberCount = capacity.member_count ?? memberCount ?? null;
  const spectatorCount = capacity.spectator_count ?? null;
  const totalCapacity = capacity.total_capacity ?? memberLimit ?? null;
  const freeMemberSeatsLeft =
    typeof seatMemberCount === 'number' && typeof foundingCap === 'number'
      ? Math.max(foundingCap - seatMemberCount, 0)
      : null;
  const freeSpectatorSeatsLeft =
    typeof spectatorCount === 'number' && typeof freeSpecCap === 'number'
      ? Math.max(freeSpecCap - spectatorCount, 0)
      : null;
  const noticeAccepted = !isMember || room?.notice?.accepted === true;
  const myAliasNum = room?.my_alias ?? null;
  // P3 — gift seats I bought for THIS room (from handleAnonRoom). Unclaimed ones
  // are shareable; claimed ones show the recipient's claim state.
  const myGifts = Array.isArray(room?.gifts) ? room.gifts : [];
  const unclaimedGifts = myGifts.filter((g) => g.status === 'unclaimed');
  const bundleUnit = Number(memberPrice) || null;
  const bundleTotal =
    bundleUnit != null ? bundleUnit * Math.max(1, Math.round(Number(bundleCount) || 1)) : null;
  const roomActions = room?.config?.actions || room?.config?.tags || room?.config?.social_actions || [];
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

  // The room roster (all current members + online status). Non-fatal: the
  // action sheet falls back to aliases seen in the feed if this fails.
  const loadRoster = useCallback(async () => {
    if (!groupId) return;
    try {
      const data = await communityApi(session, '/anonymous/members', { group_id: groupId });
      setRoster(Array.isArray(data?.members) ? data.members : []);
    } catch {
      /* best-effort */
    }
  }, [session, groupId]);

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

  // ------------------------------------------------------------------
  // v53 — event cards: upsert/fetch one, React, and Accept/Decline a
  // CHALLENGE. Cards are standalone rows in the same timeline as messages.
  // ------------------------------------------------------------------
  // v54 — one-shot per-action sound for genuinely new incoming event cards
  // (never for my own actions, never for history backfills, never twice).
  const seenEventSoundIdsRef = useRef(new Set());
  const upsertEvent = useCallback((ev) => {
    if (!ev || !ev.id) return;
    const isNew = !seenEventSoundIdsRef.current.has(ev.id);
    seenEventSoundIdsRef.current.add(ev.id);
    const recent = Number.isFinite(ev.created_at ? Date.parse(ev.created_at) : NaN) && Date.now() - Date.parse(ev.created_at) < 30000;
    if (isNew && !ev.is_actor && soundRef.current && recent) playActionSfx(ev.action);
    setEvents((prev) => {
      const idx = prev.findIndex((e) => e.id === ev.id);
      const next = idx >= 0 ? prev.map((e) => (e.id === ev.id ? ev : e)) : [...prev, ev];
      return next.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    });
  }, []);

  const fetchOneEvent = useCallback(
    async (eventId) => {
      if (!groupId) return null;
      try {
        const data = await communityApi(session, '/anonymous/event', { event_id: eventId, group_id: groupId });
        if (data.event) upsertEvent(data.event);
        return data.event || null;
      } catch (err) {
        if (err.status === 404) setEvents((prev) => prev.filter((e) => e.id !== eventId));
        return null;
      }
    },
    [session, groupId, upsertEvent],
  );

  const toggleEventReaction = async (ev, emoji, active) => {
    if (eventBusyFor) return;
    setEventBusyFor({ kind: 'react', id: ev.id });
    setComposerError('');
    try {
      const data = await communityApi(session, '/anonymous/event-react', {
        event_id: ev.id,
        emoji,
        active,
        group_id: groupId,
      });
      if (data.event) upsertEvent(data.event);
      markActivity();
    } catch (err) {
      setComposerError(SEND_ERRORS[err.code] || err.message || 'Reaction could not be saved.');
    } finally {
      setEventBusyFor(null);
    }
  };

  const respondEvent = async (ev, respond) => {
    if (eventBusyFor) return;
    setEventBusyFor({ kind: 'respond', id: ev.id });
    setComposerError('');
    try {
      const data = await communityApi(session, '/anonymous/event-respond', {
        event_id: ev.id,
        respond,
        group_id: groupId,
      });
      if (data.event) upsertEvent(data.event);
      if (soundRef.current) {
        if (respond === 'accept') playChallengeTone();
        else playLockTone();
      }
      markActivity();
    } catch (err) {
      if (['EVENT_RESOLVED', 'NOT_AUTHORIZED'].includes(err.code)) fetchOneEvent(ev.id);
      setComposerError(SEND_ERRORS[err.code] || err.message || 'Could not respond to this challenge.');
    } finally {
      setEventBusyFor(null);
    }
  };

  // v62 — fetch the RPS bout hanging off a fight card (null when the fighter
  // is not a participant, which is also how the server answers).
  const fetchDuel = useCallback(async (eventId) => {
    if (!groupId || eventId == null) return null;
    try {
      const data = await communityApi(session, '/anonymous/duel', { event_id: eventId, group_id: groupId });
      if (data.duel) {
        setDuels((prev) => {
          duelsRef.current = { ...prev, [eventId]: data.duel };
          return duelsRef.current;
        });
      }
      return data.duel || null;
    } catch {
      return null;
    }
  }, [session, groupId]);

  // Opening the panel is the opt-in: only now do we ask the server for state.
  const openDuelPanel = useCallback(
    async (ev) => {
      await fetchDuel(ev.id);
    },
    [fetchDuel],
  );

  const pickDuel = useCallback(
    async (duelId, move) => {
      if (duelBusy) return;
      setDuelBusy(true);
      setComposerError('');
      try {
        const data = await communityApi(session, '/anonymous/duel-pick', {
          duel_id: duelId,
          move,
          group_id: groupId,
        });
        if (data.duel) {
          setDuels((prev) => {
            duelsRef.current = { ...prev, [data.duel.event_id]: data.duel };
            return duelsRef.current;
          });
        }
        if (soundRef.current) playChallengeTone();
        markActivity();
      } catch (err) {
        setComposerError(SEND_ERRORS[err.code] || err.message || 'Could not throw.');
      } finally {
        setDuelBusy(false);
      }
    },
    [session, groupId, duelBusy],
  );

  // When a member seat is released (inactivity reconciliation) the room stays
  // open but the member loses access: detect the member→closed transition so a
  // viewer currently in the room is told why and sent home instead of being
  // silently dumped onto the rejoin screen. Wipe/banned are handled elsewhere.
  // A DELIBERATE leave is not a release: `leftDeliberatelyRef` suppresses the
  // member→closed edge so pressing "Leave" never raises the "your seat was
  // released" modal over a room the user then successfully re-joined.
  const detectRelease = useCallback((data) => {
    const prev = lastAccessRef.current;
    lastAccessRef.current = data?.access;
    if (leftDeliberatelyRef.current) return;
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
            // Keep a row whose lives_until is missing/unparseable — we cannot
            // prove it expired, so pruning it here would silently destroy
            // messages. The strict server lifetime still removes them.
            .filter((m) => {
              const lives = Date.parse(m.lives_until || '');
              return !Number.isFinite(lives) || lives > Date.now();
            })
            .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
        });
        setEvents((prev) => {
          const map = new Map(prev.map((e) => [e.id, e]));
          for (const ev of feed.events || []) map.set(ev.id, ev);
          return [...map.values()].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
        });
        setHasMore(!!feed.has_more);
        // Only INITIALISE the backwards cursor here. reconcile() runs on every
        // realtime event and every heartbeat; rewinding it to the newest page
        // each time stranded a reader who had already paged back (their next
        // "load earlier" refetched a seen page and killed the control).
        if (!olderCursorRef.current) {
          olderCursorRef.current = feed.next_before || (fetched[0]?.created_at ?? null);
        }
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
          setEvents(feed.events || []);
          setHasMore(!!feed.has_more);
          olderCursorRef.current = feed.next_before || (feed.messages?.[0]?.created_at ?? null);
          firstLoadRef.current = true;
          if (data.access === 'member') void loadRoster();
        } else {
          setMessages([]);
          setEvents([]);
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
  }, [loadRoom, loadFeed, loadRoster, detectRelease]);

  useEffect(() => {
    bootstrap(false);
  }, [bootstrap]);

  // WS4 — logged-out preview: fetch the room's public metadata once. Only runs
  // without a session; the moment the user signs in the bootstrap effect takes
  // over and loads the real room.
  useEffect(() => {
    if (session) return undefined;
    let cancelled = false;
    setPreview(null);
    setPreviewError('');
    const roomId = typeof id === 'string' && Number.isFinite(Number(id)) ? Number(id) : null;
    communityPreview(roomId)
      .then((data) => {
        if (!cancelled) setPreview(data && data.room ? data : null);
      })
      .catch((err) => {
        if (!cancelled) setPreviewError(err?.message || 'Could not load this room.');
      });
    return () => {
      cancelled = true;
    };
  }, [session, id]);

  // P3 — a shared gift deep link (/anonymous/{id}?gift=CODE) prefills the claim
  // box. Only opens the claim UI for a visitor who is NOT already seated.
  useEffect(() => {
    if (resolvedGiftParam) return;
    const code = new URLSearchParams(window.location.search).get('gift');
    if (!code || typeof code !== 'string') {
      setResolvedGiftParam(true);
      return;
    }
    setResolvedGiftParam(true);
    setGiftCodeInput(code.trim());
    const cleanUrl = window.location.pathname + window.location.search.replace(/[?&]gift=[^&]*/, '').replace(/^\?&/, '?');
    window.history.replaceState(null, '', cleanUrl.replace(/\?$/, ''));
    if (room?.access === 'member') {
      setClaimResult({ ok: false, message: 'Your gift is safe, but you already have a seat here.' });
      setGiftClaimOpen(true);
    } else if (room?.access === 'join' || room?.access === 'closed') {
      setGiftClaimOpen(true);
      setClaimResult(null);
    }
  }, [resolvedGiftParam, room?.access]);

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
    if (type === 'room_event') {
      if (payload?.id) fetchOneEvent(payload.id);
      if (payload?.action === 'fight') {
        // A FIGHT event carries both names for the banner.
        setFightAlert({ attacker: payload?.attacker ?? null, defender: payload?.defender ?? null });
        if (fightTimerRef.current) clearTimeout(fightTimerRef.current);
        fightTimerRef.current = setTimeout(() => setFightAlert(null), 5000);
      }
      if (payload?.action === 'announcement' || payload?.action === 'crack_accepted') {
        // v62 - a scheduled gag line is due (or the chain just started). The
        // 'crack_accepted' broadcast used to fall through to the bare return
        // below, so nobody refetched and the t+0 card only appeared on the
        // next poll. reconcile() re-reads the feed, where the server applies
        // the visible_at gate.
        reconcile();
      }
      return;
    }
if (type === 'fight') {
      // S1 - reciprocal attack actions started a fight. Transient banner only.
      setFightAlert({ attacker: payload?.attacker ?? null, defender: payload?.defender ?? null });
      if (fightTimerRef.current) clearTimeout(fightTimerRef.current);
      fightTimerRef.current = setTimeout(() => setFightAlert(null), 5000);
      return;
    }
    if (type === 'duel') {
      // v62 — an RPS bout opened, or one side locked a throw in. Refresh only
      // bouts already on screen (never auto-open one the fighter did not ask
      // for). duelsRef mirrors `duels` so this handler stays in sync without
      // re-subscribing on every throw.
      if (payload?.eventId != null && duelsRef.current?.[payload.eventId]) {
        fetchDuel(payload.eventId);
      }
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
  }, [myLabel, myAliasNum, fetchOneMessage, fetchOneEvent, removeMessage, pushSystemEvent, reconcile, celebrate]);

  const presence = useMemo(
    () =>
      isMember && room?.my_alias != null
        ? { key: `m:${room.my_alias}`, track: { alias: room.my_alias } }
        : { key: presenceKeyRef.current, track: { spectator: true } },
    [isMember, room?.my_alias],
  );

  const realtimeEnabled =
    !!room && !!room.channel && room.access !== 'banned' && room.access !== 'wiped';
  // Presence is only meaningful for seated members and spectators. A visitor on
  // the join/closed screen must NOT heartbeat — the server correctly rejects
  // non-members with 403, which would otherwise spam the console.
  const canPresence = isMember || isSpectator;

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
    if (!canPresence || !groupId) return undefined;
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
  }, [canPresence, groupId, session]);

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
      // The server enforces lifetime strictly: a message past its lives_until is
      // already gone. Drop it locally instead of re-fetching (which only 404s
      // and spams the console) — the realtime delete event covers the rest.
      if (Number.isFinite(lives) && lives <= now) removeMessage(m.id);
    }
  }, [messages, tick, removeMessage]);

  // v54 — action/challenge/fight event cards expire at the same 10 minutes as
  // messages. Swept locally on the same clock the server enforces.
  useEffect(() => {
    if (!events.length) return;
    const cutoff = Date.now() - (room?.config?.event_lifetime_seconds || EVENT_LIFETIME_SECONDS) * 1000;
    setEvents((prev) => {
      const next = prev.filter((e) => {
        // v62 - prefer the server-computed expiry. A delayed gag line was
        // created minutes before it was shown, so created_at + lifetime is
        // already past and the card would be dropped the instant it arrived.
        const expires = Date.parse(e.expires_at || '');
        if (Number.isFinite(expires)) return expires > Date.now();
        const at = Date.parse(e.created_at || '');
        return Number.isFinite(at) && at > cutoff;
      });
      return next.length === prev.length ? prev : next;
    });
  }, [events, tick, room?.config?.event_lifetime_seconds]);

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
  // Timeline rows are keyed as `m:<uuid>` / `e:<id>` so a message and an event
  // card can never collide.
  const rowKeys = useCallback(
    () => [
      ...messages.map((m) => `m:${m.id}`),
      ...events.map((e) => `e:${e.id}`),
    ],
    [messages, events],
  );

  // The reader is "caught up": every current row has now been rendered at the
  // bottom, so the unseen set (and therefore the pill) resets to empty.
  const markCaughtUp = useCallback(() => {
    seenRowsRef.current = new Set(rowKeys());
    setNewRowsCount(0);
  }, [rowKeys]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const keys = rowKeys();
    if (prependKeepRef.current != null) {
      // Older history was prepended. Those rows are HISTORY, not new arrivals —
      // record them as seen (loadOlder already did) and leave the unseen count
      // untouched, then release justSentRef so it cannot leak into the next run.
      el.scrollTop = el.scrollHeight - prependKeepRef.current;
      prependKeepRef.current = null;
      justSentRef.current = false;
      setNewRowsCount(keys.filter((k) => !seenRowsRef.current.has(k)).length);
      return;
    }
    if (firstLoadRef.current) {
      firstLoadRef.current = false;
      el.scrollTop = el.scrollHeight;
      atBottomRef.current = true;
      markCaughtUp();
      return;
    }
    if (atBottomRef.current || justSentRef.current) {
      el.scrollTop = el.scrollHeight;
      atBottomRef.current = true;
      markCaughtUp();
    } else {
      // Genuinely unseen rows only — reacting, voting, editing or expiring an
      // existing row leaves the id set unchanged, so it cannot raise the pill.
      setNewRowsCount(keys.filter((k) => !seenRowsRef.current.has(k)).length);
    }
    justSentRef.current = false;
  }, [messages, events, rowKeys, markCaughtUp]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    atBottomRef.current = atBottom;
    // Reaching the bottom (even by scrolling, not just the pill) clears it.
    if (atBottom) {
      if (seenRowsRef.current.size) markCaughtUp();
      else setNewRowsCount(0);
    }
  };

  const jumpToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    atBottomRef.current = true;
    markCaughtUp();
  }, [markCaughtUp]);

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
      // Backfilled history is "seen" the instant it is prepended — it must
      // never be counted as a new arrival by the pill.
      for (const m of older) seenRowsRef.current.add(`m:${m.id}`);
      setMessages((prev) => {
        const map = new Map(prev.map((m) => [m.id, m]));
        for (const m of older) map.set(m.id, m);
        return [...map.values()].sort(
          (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at),
        );
      });
      // Always advance the cursor to the server's next page so an
      // all-expired page cannot strand the reader on the same window forever.
      const nextCursor = feed.next_before || before;
      olderCursorRef.current = nextCursor;
      // Keep the control while EITHER new rows appeared OR the page moved on.
      // (The old `&& older.length > 0` permanently deleted the control after a
      // single empty page even though older history still existed.)
      setHasMore(!!feed.has_more && (older.length > 0 || nextCursor !== before));
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

  // Open the Actions bottom sheet, optionally pre-aimed at a message (its
  // author becomes the default target). An actor always targets ANOTHER member.
  const openActionSheet = (msg = null) => {
    const preset = msg ? aliasNum(msg) : null;
    setActionMessage(msg || null);
    setActionTarget(preset != null && preset !== Number(room?.my_alias) ? preset : null);
    setPendingAction(null);
    setRosterQuery('');
    setComposerError('');
    setActionSheetOpen(true);
    void loadRoster();
  };

  const actionLocked = actionCooldownUntil > tick;

  const sendSheetAction = async () => {
    const action = pendingAction;
    const target = actionTarget;
    if (!action || target == null || actionBusy || actionLocked || !groupId) return;
    if (soundRef.current) playActionSfx(action);
    setActionBusy(true);
    setComposerError('');
    try {
      const data = await communityApi(session, '/anonymous/social', {
        ...(actionMessage?.id ? { message_id: actionMessage.id } : {}),
        target_alias: target,
        action,
        group_id: groupId,
      });
      if (data.event) upsertEvent(data.event);
      setActionSheetOpen(false);
      setPendingAction(null);
      setActionTarget(null);
      setActionMessage(null);
      markActivity();
    } catch (err) {
      if (['SOCIAL_COOLDOWN', 'SOCIAL_RATE_LIMITED'].includes(err.code)) {
        const wait = Number(err.retry_after_ms) || 0;
        setActionCooldownUntil(Date.now() + wait);
      }
      setComposerError(SEND_ERRORS[err.code] || err.message || 'Action could not be sent.');
    } finally {
      setActionBusy(false);
    }
  };

  // Anti-slam opt-out — "declining interactions"; the server refuses actions
  // aimed at members who have switched this on.
  const fetchDecliningPref = useCallback(async () => {
    if (!groupId) return;
    try {
      const data = await communityApi(session, '/anonymous/prefs', { group_id: groupId });
      setDeclining(!!data.declining_interactions);
    } catch {
      /* best-effort — the feature is optional */
    }
  }, [session, groupId]);

  const toggleDeclining = async () => {
    if (decliningBusy) return;
    setDecliningBusy(true);
    try {
      const data = await communityApi(session, '/anonymous/prefs', {
        group_id: groupId,
        declining_interactions: !declining,
      });
      setDeclining(!!data.declining_interactions);
    } catch (err) {
      setComposerError(err.message || 'Could not update your preferences.');
    } finally {
      setDecliningBusy(false);
    }
  };

  useEffect(() => {
    if (isMember) fetchDecliningPref();
  }, [isMember, fetchDecliningPref]);
  // Encoded Messages (v53): unlock (decode, private), reveal to the whole room,
  // or take it private again. The recipient alone may reveal; the author or the
  // revealer may undo it.
  const setEncodedAction = async (msg, action) => {
    if (!msg?.id) return;
    setComposerError('');
    try {
      const data = await communityApi(session, '/anonymous/encoded', {
        message_id: msg.id,
        action,
        group_id: groupId,
      });
      if (action === 'reveal') {
        if (soundRef.current) playRevealTone();
        setRevealedEncoded((prev) => ({ ...prev, [msg.id]: data.content || '' }));
        fetchOneMessage(msg.id);
      } else if (action === 'unreveal') {
        if (soundRef.current) playLockTone();
        setRevealedEncoded((prev) => {
          const next = { ...prev };
          delete next[msg.id];
          return next;
        });
        fetchOneMessage(msg.id);
      } else {
        setRevealedEncoded((prev) => ({ ...prev, [msg.id]: data.content || '' }));
      }
    } catch (err) {
      setComposerError(SEND_ERRORS[err.code] || err.message || 'Could not unlock this message.');
      if (err.code === 'ENCODED_PRIVATE' || err.code === 'NOT_ENCODED') fetchOneMessage(msg.id);
    }
  };

  const revealEncoded = (msg) => setEncodedAction(msg, 'decode');
  const revealToRoom = (msg) => setEncodedAction(msg, 'reveal');
  const privateAgain = (msg) => setEncodedAction(msg, 'unreveal');

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

  const jumpToReply = useCallback(
    async (reply) => {
      if (!reply?.id || reply.deleted) return;
      let target = messages.find((m) => m.id === reply.id);
      if (!target) {
        target = await fetchOneMessage(reply.id);
      }
      if (!target) return;
      setHighlightId(target.id);
      const el = document.getElementById(`anon-msg-${target.id}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => setHighlightId(null), 2000);
    },
    [messages, fetchOneMessage]
  );

  // ---------------------------------------------------------------
  // Swipe-to-reply (touch). Only members can reply, so spectators and any
  // drag that starts on an interactive control are ignored. Vertical drags
  // fall through to the list scroller (the row is `touch-pan-y`).
  // ---------------------------------------------------------------
  const beginSwipe = useCallback((e, msg) => {
    if (!canSpeak || e.pointerType === 'mouse') return;
    if (e.target?.closest?.('button, a, textarea, input, [role="button"]')) return;
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      // pointer capture is best-effort
    }
    swipeStartRef.current = { id: msg.id, x: e.clientX, y: e.clientY, horizontal: null };
  }, [canSpeak]);

  const moveSwipe = useCallback((e, msg) => {
    const s = swipeStartRef.current;
    if (!s || s.id !== msg.id) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (s.horizontal === null) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      s.horizontal = Math.abs(dx) > Math.abs(dy);
    }
    if (!s.horizontal) return;
    if (dx <= 0) {
      setSwipeReply(null);
      return;
    }
    setSwipeReply({ id: msg.id, dx: Math.min(dx, SWIPE_REPLY_THRESHOLD + 24) });
  }, []);

  const endSwipe = useCallback((e, msg) => {
    const s = swipeStartRef.current;
    swipeStartRef.current = null;
    const dx = s && s.id === msg.id ? e.clientX - s.x : 0;
    const armed = !!(s && s.horizontal && dx >= SWIPE_REPLY_THRESHOLD);
    setSwipeReply(null);
    if (!armed) return;
    setReplyTo(msg);
    setOpenActions(null);
    if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(10);
    requestAnimationFrame(() => draftRef.current?.focus());
  }, []);

  const cancelSwipe = useCallback(() => {
    swipeStartRef.current = null;
    setSwipeReply(null);
  }, []);

  const joinRoom = async () => {
    if (!groupId || joining) return;
    setJoining(true);
    setComposerError('');
    try {
      await communityApi(session, '/groups/join', { group_id: groupId });
      // A confirmed join clears the voluntary-leave suppression and any stale
      // release modal, so a member who leaves and returns never gets blocked by
      // a "your seat was released" overlay.
      leftDeliberatelyRef.current = false;
      setReleasedNotice(false);
      await bootstrap(true);
    } catch (err) {
      if (err.code === 'MEMBERSHIP_PAYMENT_REQUIRED') {
        setConfirmMembership(true);
        setComposerError(SEND_ERRORS[err.code]);
      } else if (['MEMBERSHIP_LOCKED', 'GROUP_FULL', 'ALREADY_SPECTATOR'].includes(err.code)) {
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
      // The seat is gone on purpose — stop detectRelease from reporting it as
      // an inactivity release, and drop the visit key so re-entering mints a
      // FRESH Anonymous #NN instead of reusing this tab's pseudonym.
      leftDeliberatelyRef.current = true;
      clearAnonVisitKey();
      setMessages([]);
      setEvents([]);
      seenRowsRef.current = new Set();
      setNewRowsCount(0);
      setReleasedNotice(false);
      lastAccessRef.current = 'closed';
      setExitOpen(false);
      setShowRules(false);
      setServerOnline(null);
      setExitDone(true);
    } catch (err) {
      setComposerError(SEND_ERRORS[err.code] || err.message || 'Could not leave right now.');
    } finally {
      setLeaving(false);
    }
  };

  // P2 — spectating tries a FREE seat first; the server refuses with
  // SPECTATOR_PAYMENT_REQUIRED once the free slots are gone, which is the only
  // time we offer the paid pass. No charge happens without an explicit confirm.
  const startSpectate = async () => {
    if (!groupId || spectating) return;
    setSpectating(true);
    setComposerError('');
    try {
      await communityApi(session, '/anonymous/spectate-free', { group_id: groupId });
      await bootstrap(true);
    } catch (err) {
      if (err.code === 'SPECTATOR_PAYMENT_REQUIRED') {
        setConfirmSpectate(true);
      } else if (err.code === 'ALREADY_MEMBER') {
        await bootstrap(true);
      } else {
        setComposerError(SEND_ERRORS[err.code] || err.message || 'Could not start spectating.');
      }
    } finally {
      setSpectating(false);
    }
  };

  // Paid spectator pass: two-step (confirm → checkout) so a charge is never
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

  // P3 — paid member seats. ONE Paystack charge for `count` seats at
  // count × member_price: `forMe` seats become my own membership
  // (existing single-seat path), the rest become GIFT seats — one shareable
  // code per slot, usable whenever the room has a free seat. Amount is resolved
  // SERVER-SIDE from study_groups.member_price.
  const buyMembership = async () => {
    if (!groupId || buyingMembership) return;
    const count = Math.max(1, Math.min(Math.round(Number(bundleCount) || 1), 50));
    setBuyingMembership(true);
    try {
      const res = await fetch('/api/initiate-payment', {
        method: 'POST',
        headers: { ...authHeaders(session, { json: true }) },
        body: JSON.stringify({
          product: 'anonymous_memberships',
          group_id: groupId,
          count,
          for_me: bundleForMe ? 1 : 0,
        }),
      });
      const body = await res.json();
      if (res.ok && body.authorization_url) {
        window.location.assign(body.authorization_url);
        return;
      }
      setComposerError(
        body.error === 'ALREADY_MEMBER'
          ? 'You already hold a seat. Clear "include me" to buy gift seats only.'
          : (body.error || body.message || 'Payment could not be started.'),
      );
    } catch {
      setComposerError('Could not start payment. Check your connection and try again.');
    } finally {
      setBuyingMembership(false);
      setConfirmMembership(false);
    }
  };

  // P3 — claim ONE gift seat for this room. The server validates the code,
  // keeps the gift usable until a seat frees, and refuses once claimed.
  const claimGift = async () => {
    if (!groupId || claimBusy) return;
    const code = (giftCodeInput || '').trim();
    if (!code) return;
    setClaimBusy(true);
    setClaimResult(null);
    try {
      const data = await communityApi(session, '/anonymous/gift-claim', {
        group_id: groupId,
        code,
      });
      setClaimResult({ ok: true, member_count: data.member_count });
      setGiftCodeInput('');
      await bootstrap(true);
    } catch (err) {
      const messages = {
        INVALID_GIFT: 'That gift code is not valid for this room.',
        GIFT_ALREADY_CLAIMED: 'This gift has already been claimed.',
        GIFT_EXPIRED: 'This gift expired when the room was wiped.',
        ALREADY_MEMBER: 'You already have a seat in this room.',
        GROUP_FULL: 'This room is at capacity right now — your gift will work as soon as a seat frees.',
        BANNED: 'You are not allowed to join this room.',
      };
      setClaimResult({ ok: false, message: messages[err.code] || err.message || 'Could not claim this gift.' });
    } finally {
      setClaimBusy(false);
    }
  };

  // P3 — open the buyer's gift-seat share panel (live from the server so a
  // claim elsewhere is visible immediately).
  const openGiftPanel = async () => {
    setGiftPanelOpen(true);
    try {
      const data = await communityApi(session, '/anonymous/gifts', { group_id: groupId });
      if (Array.isArray(data?.gifts)) {
        setRoom((prev) => (prev ? { ...prev, gifts: data.gifts } : prev));
      }
    } catch {
      /* panel falls back to room.gifts */
    }
  };

  const shareGift = async (gift) => {
    const url = `${window.location.origin}${gift.room_link}`;
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ title: 'Gift seat — Anonymous room', text: 'Claim a member seat with this code.', url });
        return;
      }
    } catch {
      /* share aborted -> fall through to copy */
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(url);
    } else {
      const tx = document.createElement('textarea');
      tx.value = url;
      document.body.appendChild(tx);
      tx.select();
      document.execCommand('copy');
      tx.remove();
    }
    setGiftCopied(gift.code);
    if (giftCopiedTimerRef.current) clearTimeout(giftCopiedTimerRef.current);
    giftCopiedTimerRef.current = setTimeout(() => setGiftCopied(null), 2500);
  };

  // P2 — browse live Anonymous rooms BEFORE creating a new one, so visitors
  // join an existing active room instead of fragmenting into empty ones.
  const openRoomBrowser = async () => {
    setBrowseOpen(true);
    setBrowseBusy(true);
    setBrowseError('');
    setBrowseRooms(null);
    try {
      const data = await communityApi(session, '/anonymous/rooms', {});
      setBrowseRooms(Array.isArray(data?.rooms) ? data.rooms : []);
    } catch (err) {
      setBrowseError(err.message || 'Could not load rooms.');
    } finally {
      setBrowseBusy(false);
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

  // v54 — Share an anonymous deep link (navigator.share with a clipboard
  // fallback). The link routes through the normal join flow, so membership
  // locks / spectator checks still apply.
  const [shareBusy, setShareBusy] = useState(false);
  const [copiedShare, setCopiedShare] = useState(false);
  const copyTimerRef = useRef(null);
  const shareRoom = async () => {
    if (shareBusy || !groupId) return;
    setShareBusy(true);
    const url = `${window.location.origin}/anonymous/${groupId}`;
    const text = 'Join me in an Apex Anonymous room — masked identities, messages that vanish in 10 minutes, free founding member seats, and spectator passes.';
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Apex Anonymous Room', text, url });
      } else {
        await navigator.clipboard.writeText(url);
        setCopiedShare(true);
        if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
        copyTimerRef.current = setTimeout(() => setCopiedShare(false), 1500);
      }
    } catch {
      if (navigator.share && navigator.clipboard) {
        try {
          await navigator.clipboard.writeText(url);
          setCopiedShare(true);
          if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
          copyTimerRef.current = setTimeout(() => setCopiedShare(false), 1500);
        } catch {
          /* not shareable or copyable — silent */
        }
      }
    } finally {
      setShareBusy(false);
    }
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
    for (const ev of events) {
      for (const label of [ev.actor, ev.target]) {
        const n = labelAliasNum(label);
        if (n != null && String(n) !== String(room?.my_alias) && !Number.isNaN(n)) set.set(n, label);
      }
    }
    return [...set.entries()].sort((a, b) => a[0] - b[0]);
  }, [messages, events, room?.my_alias]);

  // The action-sheet target list. Prefer the SERVER ROSTER (every current
  // member, online status included) so anyone present is aimable — falling
  // back to aliases seen in the feed if the roster has not loaded. Online
  // members sort first; the search filters by Anonymous #NN.
  const actionTargets = useMemo(() => {
    const list = roster
      .filter((m) => !m.is_self && Number.isFinite(Number(m.alias)))
      .map((m) => ({ n: Number(m.alias), online: !!m.online }));
    const q = rosterQuery.trim().replace(/[^0-9]/g, '');
    const filtered = q === ''
      ? list
      : list.filter((t) => String(t.n).padStart(2, '0').includes(q) || String(t.n).includes(q));
    filtered.sort((a, b) => (a.online === b.online ? a.n - b.n : a.online ? -1 : 1));
    return filtered;
  }, [roster, rosterQuery]);

  const rosterOnline = useMemo(
    () => roster.filter((m) => !m.is_self && m.online).length,
    [roster],
  );

  const rosterLoaded = roster.length > 0;

  // v53 — MESSAGES + EVENT CARDS share ONE timeline, sorted by created_at.
  // Deterministic tie-break (kind + id) so React keys stay stable.
  const mergedTimeline = useMemo(() => {
    const rows = [];
    for (const m of messages) rows.push({ kind: 'message', item: m, at: Date.parse(m.created_at) || 0 });
    for (const ev of events) rows.push({ kind: 'event', item: ev, at: Date.parse(ev.created_at) || 0 });
    return rows.sort(
      (a, b) => a.at - b.at || (a.kind === b.kind ? String(a.item.id).localeCompare(String(b.item.id)) : a.kind.localeCompare(b.kind)),
    );
  }, [messages, events]);

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
  if (!session) {
    return (
      <RoomPreview
        preview={preview}
        error={previewError}
        locationPath={location.pathname + location.search}
      />
    );
  }

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

  // Deliberate exit takes precedence over the join/closed/wiped gates: after
  // leaving, the next reconcile reports access 'closed', which used to replace
  // this screen with the join gate within seconds.
  if (exitDone) {
    return (
      <div className="h-[100dvh] bg-slate-950 text-slate-200 overflow-y-auto">
        <GateCard>
          <div className="text-4xl mb-3">👋</div>
          <h1 className="text-xl font-black text-white">You've left the room.</h1>
          <p className="text-sm text-slate-400 font-medium mt-2">
            Your seat has been released and the room no longer counts you. Any messages you sent stay
            anonymous and expire on their own 10-minute timer. Walk back in any time — you will get a
            fresh Anonymous #.
          </p>
          <div className="flex flex-col items-stretch gap-2.5 mt-6">
            <button
              onClick={async () => {
                // Actually REJOIN (not just re-read state) while a seat is free.
                // Re-entering presents a fresh visit key, so the server mints a
                // NEW Anonymous #NN for this visit.
                setExitDone(false);
                await joinRoom();
              }}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-apex-600 text-white font-black text-xs uppercase tracking-widest hover:bg-apex-700 transition"
            >
              <RefreshCw size={14} /> Rejoin this room
            </button>
            <button
              onClick={() => navigate('/study-groups')}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 font-black text-xs uppercase tracking-widest hover:bg-slate-700 transition"
            >
              <Users size={14} /> Find another room
            </button>
          </div>
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
            Messages open at <span className="text-amber-400 font-black">{target} members</span>. The first{' '}
            <span className="text-white font-black">{foundingCap ?? '…'}</span> member seats are free; after that
            a member seat is <span className="text-white font-black">₦{memberPrice ?? '…'}</span>. Total capacity
            is {memberLimit ?? '—'}, so join now to guarantee your spot.
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
              {typeof freeMemberSeatsLeft === 'number' && freeMemberSeatsLeft > 0
                ? `Join · Free (${freeMemberSeatsLeft} left)`
                : `Join · ₦${memberPrice ?? '…'}`}
            </button>
          </div>
        </GateCard>
      </div>
    );
  }

  if (room && room.access === 'closed') {
    const totalSeats = typeof totalCapacity === 'number' ? totalCapacity : memberLimit;
    const usedSeats =
      (typeof seatMemberCount === 'number' ? seatMemberCount : 0) +
      (typeof spectatorCount === 'number' ? spectatorCount : 0);
    const capacityFull = typeof totalSeats === 'number' && usedSeats >= totalSeats;
    const canJoin = !membershipLocked && !capacityFull;
    const memberFree = typeof freeMemberSeatsLeft === 'number' && freeMemberSeatsLeft > 0;
    const spectateFree = typeof freeSpectatorSeatsLeft === 'number' && freeSpectatorSeatsLeft > 0;
    const joinLabel = memberFree
      ? `Join as member · Free${freeMemberSeatsLeft ? ` (${freeMemberSeatsLeft} left)` : ''}`
      : `Join as member · ₦${memberPrice ?? '…'}`;
    const spectateLabel = spectateFree
      ? `Watch as spectator · Free${freeSpectatorSeatsLeft ? ` (${freeSpectatorSeatsLeft} left)` : ''}`
      : `Watch as spectator · ₦${price ?? '…'}`;
    const reason = membershipLocked
      ? 'The host has closed membership for this round.'
      : capacityFull
        ? 'This room is at capacity.'
        : 'This room is live.';
    return (
      <div className="h-[100dvh] bg-slate-950 text-slate-200 overflow-y-auto">
        <GateCard>
          {membershipLocked ? (
            <Lock size={38} className="mx-auto mb-3 text-apex-400" />
          ) : (
            <Users size={38} className="mx-auto mb-3 text-emerald-400" />
          )}
          <h1 className="text-xl font-black text-white">
            {membershipLocked ? 'Membership closed' : capacityFull ? 'Room is full' : 'Join the room'}
          </h1>
          <p className="text-sm text-slate-400 font-medium mt-2">
            {reason}{' '}
            {canJoin ? (
              <>
                Founding member seats are free while they last (then{' '}
                <span className="text-white font-black">₦{memberPrice ?? '…'}</span>); spectator slots are free
                for the first {freeSpecCap ?? '…'} (then <span className="text-white font-black">₦{price ?? '…'}</span>).
              </>
            ) : (
              <>
                You can watch it anonymously with a one-time{' '}
                <span className="text-white font-black">₦{price ?? '…'}</span> spectator pass — read and react,
                never post.
              </>
            )}{' '}
            Or open your own room.
          </p>
          {composerError && <p className="text-[11px] font-bold text-red-400 mt-3">{composerError}</p>}
          <div className="flex flex-col items-stretch gap-2.5 mt-6">
            {canJoin && (
              <button
                onClick={joinRoom}
                disabled={joining}
                className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-emerald-600 text-white font-black text-xs uppercase tracking-widest hover:bg-emerald-700 disabled:opacity-50 transition"
              >
                {joining ? <Loader2 size={14} className="animate-spin" /> : <Users size={14} />}
                {joinLabel}
              </button>
            )}
            <button
              onClick={startSpectate}
              disabled={spectating || capacityFull}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-apex-600 text-white font-black text-xs uppercase tracking-widest hover:bg-apex-700 disabled:opacity-50 transition"
            >
              {spectating ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
              {spectateLabel}
            </button>
            <button
              onClick={() => {
                setClaimResult(null);
                setGiftClaimOpen(true);
              }}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 font-black text-xs uppercase tracking-widest hover:bg-slate-700 transition"
            >
              <Crown size={14} />
              Have a gift code?
            </button>
            {unclaimedGifts.length > 0 && (
              <button
                onClick={openGiftPanel}
                className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-apex-500/10 border border-apex-500/30 text-apex-300 font-black text-xs uppercase tracking-widest hover:bg-apex-500/20 transition"
              >
                <Crown size={14} />
                Share your gift seats ({unclaimedGifts.length})
              </button>
            )}
            <button
              onClick={openRoomBrowser}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 font-black text-xs uppercase tracking-widest hover:bg-slate-700 transition"
            >
              <Compass size={14} />
              Browse active Anonymous rooms
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
      <header className="shrink-0 border-b border-slate-800/80 bg-slate-950/95 backdrop-blur px-4 py-2.5 flex items-center gap-2.5">
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
          <p className="text-[10px] font-bold text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap min-h-[14px]">
            {isMember && myLabel && <span style={{ ...identityStyle(room?.my_alias) }} className="font-black">{myLabel}</span>}
            {isSpectator && (
              <span className="inline-flex items-center gap-1 text-amber-300">
                <Eye size={10} /> Spectator
              </span>
            )}
            <span
              className="inline-flex items-center gap-1.5 whitespace-nowrap"
              title={`Founding members ${seatMemberCount ?? memberCount ?? '—'}/${foundingCap ?? '—'} · free spectators ${spectatorCount ?? '—'}/${freeSpecCap ?? '—'} · total ${(seatMemberCount ?? 0) + (spectatorCount ?? 0)}/${totalCapacity ?? memberLimit ?? '—'}`}
            >
              <span className="inline-flex items-center gap-1">
                <Users size={10} />
                {typeof seatMemberCount === 'number' || typeof memberCount === 'number'
                  ? `${seatMemberCount ?? memberCount}${typeof foundingCap === 'number' ? `/${foundingCap}` : ''}`
                  : '—'}
              </span>
              <span className="text-slate-600">·</span>
              <span className="inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> {liveOnline ?? 0} online
              </span>
            </span>
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
          onClick={shareRoom}
          disabled={shareBusy}
          className="w-9 h-9 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-400 hover:text-white transition shrink-0 disabled:opacity-50"
          aria-label="Share anonymous link"
          title={copiedShare ? 'Link copied' : 'Share link'}
        >
          {copiedShare ? <Check size={15} className="text-emerald-400" /> : <Share2 size={15} />}
        </button>
        {(myGifts.length > 0 || unclaimedGifts.length > 0) && (
          <button
            onClick={openGiftPanel}
            className="w-9 h-9 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-apex-400 hover:text-apex-300 transition shrink-0"
            aria-label="My gift seats"
            title="My gift seats"
          >
            <Crown size={15} />
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
          {!membershipLocked && (
            <button
              onClick={joinRoom}
              disabled={joining}
              className="ml-auto shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-200 font-black uppercase tracking-widest text-[9px] hover:bg-amber-500/30 disabled:opacity-50"
            >
              {joining ? <Loader2 size={11} className="animate-spin" /> : <Crown size={11} />}
              {typeof freeMemberSeatsLeft === 'number' && freeMemberSeatsLeft > 0
                ? 'Become a member · Free'
                : `Become a member · ₦${memberPrice ?? '…'}`}
            </button>
          )}
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

        {mergedTimeline.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <MessageCircle size={34} className="text-slate-700 mb-3" />
            <p className="text-slate-500 font-black text-sm">
              {isSpectator
                ? 'The room is quiet right now — messages here are ephemeral.'
                : 'No messages yet. Say the first thing.'}
            </p>
          </div>
        )}

        {mergedTimeline.map((row) => {
          if (row.kind === 'event') {
            const ev = row.item;
            return (
              <RoomEventCard
                key={`ev-${ev.id}`}
                ev={ev}
                canReact={canReact}
                canDuel={isMember}
                busy={eventBusyFor}
                reactionPalette={room?.config?.reactions}
                onReact={toggleEventReaction}
                onRespond={respondEvent}
                onMention={isMember ? jumpToAlias : null}
                duel={duels[ev.id] || null}
                duelBusy={duelBusy}
                onDuelOpen={openDuelPanel}
                onDuelPick={pickDuel}
                reducedMotion={prefersReducedMotion}
              />
            );
          }
          const msg = row.item;
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
              onPointerDown={(e) => beginSwipe(e, msg)}
              onPointerMove={(e) => moveSwipe(e, msg)}
              onPointerUp={(e) => endSwipe(e, msg)}
              onPointerCancel={cancelSwipe}
              className={`group relative px-1 py-1.5 rounded-2xl overflow-hidden touch-pan-y transition ${
                isOpen ? 'bg-slate-900/70' : ''
              } ${highlightId === msg.id ? 'bg-apex-500/15 ring-1 ring-apex-500/40' : ''}`}
            >
              {canSpeak && swipeReply?.id === msg.id && (
                <div
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-apex-400 pointer-events-none"
                  style={{ opacity: Math.min(1, swipeReply.dx / SWIPE_REPLY_THRESHOLD) }}
                >
                  <CornerUpLeft size={16} />
                </div>
              )}
              <div
                className={`flex items-start gap-2.5 ${prefersReducedMotion ? '' : 'transition-transform'}`}
                style={swipeReply?.id === msg.id ? { transform: `translateX(${swipeReply.dx}px)` } : undefined}
              >
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
                          onClick={() => msg.reply.id && jumpToReply(msg.reply)}
                          className="mt-1 pl-2.5 border-l-2 border-slate-700 text-left text-[11px] font-medium text-slate-500 hover:text-slate-300 truncate w-full"
                        >
                          <CornerUpLeft size={10} className="inline mr-1" />
                          {msg.reply.deleted ? (
                            <span className="italic text-slate-600">Original message unavailable</span>
                          ) : (
                            <>
                              <span className="font-black" style={identityStyle(msg.reply.alias)}>{msg.reply.author}</span>{' '}
                              {msg.reply.encoded ? (
                                <span className="italic text-violet-400">🔒 Encoded message</span>
                              ) : (
                                msg.reply.excerpt
                              )}
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
                          {msg.encoded && msg.revealed ? (
                            // PUBLICLY REVEALED — the whole room sees it now. The
                            // author (or whoever revealed it) can take it private.
                            <div className="mt-1">
                              <p className="text-sm font-medium text-slate-300 whitespace-pre-wrap break-words leading-relaxed">
                                {mentionNodes(msg.content || '', jumpToAlias)}
                              </p>
                              <div className="inline-flex items-center gap-2 mt-1">
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-[8px] font-black uppercase tracking-widest">
                                  <Eye size={9} /> Revealed to the room
                                </span>
                                {msg.can_unreveal && (
                                  <button
                                    onClick={() => privateAgain(msg)}
                                    className="text-[10px] font-black uppercase tracking-widest text-violet-300 hover:text-white underline"
                                  >
                                    Make private again
                                  </button>
                                )}
                              </div>
                            </div>
                          ) : msg.encoded && revealedEncoded[msg.id] !== undefined ? (
                            // DECODED LOCALLY — visible only to me while the
                            // room copy stays private. "Re-lock" is local only.
                            <div className="mt-1">
                              <p className="text-sm font-medium text-slate-300 whitespace-pre-wrap break-words leading-relaxed">
                                {mentionNodes(revealedEncoded[msg.id], jumpToAlias)}
                              </p>
                              <div className="inline-flex items-center gap-3 mt-1 flex-wrap">
                                <button
                                  onClick={() => revealToRoom(msg)}
                                  className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-emerald-300 hover:text-white"
                                >
                                  <Eye size={10} /> Reveal to room
                                </button>
                                <button
                                  onClick={() =>
                                    setRevealedEncoded((prev) => {
                                      const next = { ...prev };
                                      delete next[msg.id];
                                      return next;
                                    })
                                  }
                                  className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-violet-300 hover:text-white"
                                >
                                  <Lock size={10} /> Re-lock
                                </button>
                              </div>
                            </div>
                          ) : msg.encoded && msg.locked ? (
                            <div className="mt-1 inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-violet-500/10 border border-violet-500/30 flex-wrap">
                              <Lock size={13} className="text-violet-300" />
                              <span className="text-[11px] font-bold text-violet-200">
                                {msg.encoded_for_me ? 'Encoded message' : 'Encoded · private'}
                              </span>
                              {msg.encoded_for_me ? (
                                <>
                                  <button
                                    onClick={() => revealEncoded(msg)}
                                    className="px-2.5 py-1 rounded-lg bg-violet-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-violet-700"
                                  >
                                    Unlock
                                  </button>
                                  <button
                                    onClick={() => revealToRoom(msg)}
                                    className="text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-emerald-300"
                                  >
                                    Reveal to room
                                  </button>
                                </>
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
                      {canSpeak && roomSocial.length > 0 && (
                        <button
                          onClick={() => {
                            openActionSheet(msg);
                            setOpenActions(null);
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-white"
                        >
                          <Swords size={11} /> Actions
                        </button>
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
                  className="opacity-70 group-hover:opacity-100 focus:opacity-100 text-slate-500 hover:text-slate-200 transition shrink-0 mt-1"
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

      {newRowsCount > 0 && (
        <button
          onClick={jumpToBottom}
          className="absolute left-1/2 -translate-x-1/2 bottom-32 z-10 px-4 py-2 rounded-full bg-apex-600 text-white text-[10px] font-black uppercase tracking-widest shadow-lg"
        >
          {newRowsCount > 1 ? `${newRowsCount} new messages ↓` : 'New message ↓'}
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
            onClick={() => {
              setPickerOpen(null);
              openActionSheet(null);
            }}
            disabled={!canSpeak}
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border text-[10px] font-black uppercase tracking-widest transition disabled:opacity-40 ${
              actionSheetOpen
                ? 'bg-apex-500/20 border-apex-500/50 text-apex-300'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
            }`}
            title="Aim an action at another member"
          >
            <Swords size={12} /> Actions
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
              Actions are opt-in. Some moves — like a toast or a crack — need the other person to
              ACCEPT first, and declining ends it there. Nothing happens without a yes.
            </li>
            <li className="flex gap-2">
              <span className="text-apex-400 font-black">05</span>
              Turn on “declining interactions” any time to refuse every incoming action at once.
            </li>
            <li className="flex gap-2">
              <span className="text-apex-400 font-black">06</span>
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
              {thresholds.survive ?? '—'}. Total capacity is {memberLimit ?? '—'}: the first{' '}
              {foundingCap ?? '—'} member seats and first {freeSpecCap ?? '—'} spectator slots are free,
              after which member seats cost ₦{memberPrice ?? '—'} and spectator passes ₦{price ?? '—'}.
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
            <h2 className="font-black text-white text-lg">Can't join right now</h2>
          </div>
          <p className="text-sm font-medium text-slate-400 mt-1">
            This room isn't taking new members. You can watch it instead, or open your own room:
          </p>
          <div className="flex flex-col items-stretch gap-2.5 mt-5">
            <button
              onClick={() => {
                setLockedOptionsOpen(false);
                startSpectate();
              }}
              disabled={spectating || creatingRoom}
              className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-apex-600 text-white font-black text-xs uppercase tracking-widest hover:bg-apex-700 disabled:opacity-50 transition"
            >
              {spectating ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
              {typeof freeSpectatorSeatsLeft === 'number' && freeSpectatorSeatsLeft > 0
                ? `Watch as spectator · Free (${freeSpectatorSeatsLeft} left)`
                : `Watch as spectator · ₦${price ?? '…'}`}
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
            All free spectator slots are taken. You'll be charged a one-time{' '}
            <span className="text-white font-black">₦{price ?? '…'}</span> to watch this room — read and react,
            never post. The pass is non-refundable and ends with the room round.
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

      {confirmMembership && (
        <Modal onClose={() => setConfirmMembership(false)}>
          <div className="flex items-center gap-2 mb-3">
            <Crown size={18} className="text-apex-400" />
            <h2 className="font-black text-white text-lg">Buy member seats</h2>
          </div>
          <p className="text-sm font-medium text-slate-400 mt-1">
            All {foundingCap ?? '…'} free founding member seats are taken. One seat is{' '}
            <span className="text-white font-black">₦{memberPrice ?? '…'}</span>. Buy for yourself, buy extras
            as <span className="text-white font-black">gift seats</span> (one shareable code per slot that anyone
            can redeem whenever the room has room), or both — one charge.
          </p>

          <div className="mt-4 rounded-xl bg-slate-800/70 border border-slate-700 p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Seats</span>
              <div className="inline-flex items-center gap-1 rounded-lg bg-slate-900 border border-slate-700 p-0.5">
                <button
                  onClick={() => setBundleCount((c) => Math.max(1, Number(c) - 1))}
                  disabled={buyingMembership}
                  className="w-8 h-8 rounded-md text-slate-300 hover:text-white hover:bg-slate-700 disabled:opacity-40 font-black"
                  aria-label="Fewer seats"
                >
                  –
                </button>
                <span className="w-9 text-center font-black text-white">{Math.max(1, Math.min(Math.round(Number(bundleCount) || 1), 50))}</span>
                <button
                  onClick={() => setBundleCount((c) => Math.min(50, Number(c) + 1))}
                  disabled={buyingMembership}
                  className="w-8 h-8 rounded-md text-slate-300 hover:text-white hover:bg-slate-700 disabled:opacity-40 font-black"
                  aria-label="More seats"
                >
                  +
                </button>
              </div>
            </div>
            <label className="flex items-center justify-between gap-2 py-2 border-t border-slate-700/60 cursor-pointer">
              <span className="text-xs font-bold text-slate-300">
                Include me <span className="text-slate-500 font-medium">(my own member seat)</span>
              </span>
              <input
                type="checkbox"
                checked={bundleForMe}
                onChange={(e) => setBundleForMe(e.target.checked)}
                disabled={buyingMembership}
                className="accent-apex-500 w-4 h-4"
              />
            </label>
            {bundleTotal != null && Number(bundleTotal) > (bundleUnit || 0) && !bundleForMe && (
              <p className="text-[10px] font-bold text-slate-400 mt-1">
                Gift-only purchase — no seat for you. You'll get {Math.max(1, Math.min(Math.round(Number(bundleCount) || 1), 50))} gift{' '}
                {Number(bundleCount) === 1 ? 'code' : 'codes'} to share.
              </p>
            )}
            <div className="flex items-center justify-between pt-3 border-t border-slate-700/60 mt-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Total</span>
              <span className="font-black text-white text-lg">
                ₦{bundleTotal != null ? bundleTotal : (memberPrice ?? '…')}
              </span>
            </div>
          </div>

          <div className="flex gap-2 mt-5">
            <button
              onClick={() => setConfirmMembership(false)}
              disabled={buyingMembership}
              className="flex-1 px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 font-black text-xs uppercase tracking-widest"
            >
              Cancel
            </button>
            <button
              onClick={buyMembership}
              disabled={buyingMembership || bundleTotal == null}
              className="flex-1 px-4 py-2.5 rounded-xl bg-apex-600 text-white font-black text-xs uppercase tracking-widest hover:bg-apex-700 disabled:opacity-50 inline-flex items-center justify-center gap-2"
            >
              {buyingMembership ? <Loader2 size={14} className="animate-spin" /> : <Crown size={14} />}
              Pay ₦{bundleTotal != null ? bundleTotal : (memberPrice ?? '…')}
            </button>
          </div>
        </Modal>
      )}

      {giftPanelOpen && (
        <Modal onClose={() => setGiftPanelOpen(false)}>
          <div className="flex items-center gap-2 mb-3">
            <Crown size={18} className="text-apex-400" />
            <h2 className="font-black text-white text-lg">Your gift seats</h2>
          </div>
          <p className="text-sm font-medium text-slate-400 mt-1">
            Each code unlocks <span className="text-white font-black">one member seat</span> in this room for the
            person who redeems it. It only works while a seat is free — a full room waits, it never oversells above{' '}
            {totalCapacity ?? memberLimit ?? '…'}.
          </p>
          <div className="mt-4 space-y-2 max-h-[45vh] overflow-y-auto pr-1">
            {myGifts.length === 0 ? (
              <p className="text-[11px] font-bold text-slate-500 mt-1">No gift seats for this room yet.</p>
            ) : (
              myGifts.map((g) => (
                <div
                  key={g.id}
                  className={`rounded-xl border p-3 ${g.status === 'unclaimed' ? 'bg-slate-800/70 border-slate-700' : 'bg-slate-900/60 border-slate-800'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <span className="font-black text-white tracking-[0.15em] text-sm">{g.code}</span>
                      <span
                        className={`ml-2 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest ${
                          g.status === 'unclaimed'
                            ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                            : g.status === 'claimed'
                              ? 'bg-slate-500/15 text-slate-400 border border-slate-600/40'
                              : 'bg-red-500/15 text-red-300 border border-red-500/30'
                        }`}
                      >
                        {g.status}
                      </span>
                    </div>
                    <span className="text-[10px] font-bold text-slate-500">₦{g.amount}</span>
                  </div>
                  {g.status === 'unclaimed' ? (
                    <div className="flex items-center gap-2 mt-2.5">
                      <button
                        onClick={() => shareGift(g)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-apex-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-apex-700 transition"
                      >
                        {giftCopied === g.code ? <Check size={12} className="text-emerald-300" /> : <Share2 size={12} />}
                        {giftCopied === g.code ? 'Copied' : 'Share link'}
                      </button>
                      <button
                        onClick={() => {
                          if (typeof navigator !== 'undefined' && navigator.clipboard) navigator.clipboard.writeText(g.code);
                          setGiftCopied(g.code);
                          if (giftCopiedTimerRef.current) clearTimeout(giftCopiedTimerRef.current);
                          giftCopiedTimerRef.current = setTimeout(() => setGiftCopied(null), 2500);
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700/70 text-slate-200 text-[10px] font-black uppercase tracking-widest hover:bg-slate-600 transition"
                      >
                        {giftCopied === g.code ? <Check size={12} className="text-emerald-300" /> : <Copy size={12} />}
                        Copy code
                      </button>
                    </div>
                  ) : (
                    <p className="text-[10px] font-bold text-slate-500 mt-2">
                      {g.status === 'claimed'
                        ? 'This seat was claimed — the code is spent.'
                        : 'This seat expired when the room was wiped.'}
                    </p>
                  )}
                </div>
              ))
            )}
          </div>
        </Modal>
      )}

      {giftClaimOpen && (
        <Modal onClose={() => { setGiftClaimOpen(false); setClaimResult(null); }}>
          <div className="flex items-center gap-2 mb-3">
            <Crown size={18} className="text-apex-400" />
            <h2 className="font-black text-white text-lg">Claim a gift seat</h2>
          </div>
          <p className="text-sm font-medium text-slate-400 mt-1">
            A member seat paid for you. It's worth{' '}
            <span className="text-white font-black">₦{memberPrice ?? '…'}</span> — and only counts if the room has
            a free slot.
          </p>
          {claimResult && (
            <p
              className={`mt-3 px-3 py-2 rounded-lg text-xs font-bold ${
                claimResult.ok
                  ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30'
                  : 'bg-red-500/10 text-red-300 border border-red-500/30'
              }`}
            >
              {claimResult.ok
                ? `Claimed! You're in — a member of this Anonymous room.`
                : (claimResult.message || 'Could not claim this gift.')}
            </p>
          )}
          <div className="mt-3 flex items-center gap-2">
            <input
              value={giftCodeInput}
              onChange={(e) => setGiftCodeInput(e.target.value.toUpperCase())}
              placeholder="XXXX-XXXX gift code"
              maxLength={32}
              disabled={claimBusy}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && giftCodeInput.trim()) claimGift();
              }}
              className="flex-1 min-w-0 px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm font-bold tracking-widest placeholder:text-slate-600 focus:outline-none focus:border-apex-500 disabled:opacity-50"
            />
            <button
              onClick={claimGift}
              disabled={claimBusy || !giftCodeInput.trim()}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-apex-600 text-white font-black text-xs uppercase tracking-widest hover:bg-apex-700 disabled:opacity-50"
            >
              {claimBusy ? <Loader2 size={14} className="animate-spin" /> : <Crown size={14} />}
              Claim
            </button>
          </div>
        </Modal>
      )}

      {browseOpen && (
        <Modal onClose={() => setBrowseOpen(false)}>
          <div className="flex items-center gap-2 mb-3">
            <Compass size={18} className="text-apex-400" />
            <h2 className="font-black text-white text-lg">Join an active room</h2>
          </div>
          <p className="text-sm font-medium text-slate-400 mt-1">
            Rooms stay open while they have seats. Founding member seats are free until{' '}
            {foundingCap ?? '…'} members, then ₦{memberPrice ?? '…'}; the first {freeSpecCap ?? '…'} spectators
            are free, then ₦{price ?? '…'}.
          </p>
          {browseBusy ? (
            <div className="flex justify-center py-8">
              <Loader2 size={22} className="animate-spin text-apex-400" />
            </div>
          ) : browseError ? (
            <p className="text-[11px] font-bold text-red-400 mt-3">{browseError}</p>
          ) : (browseRooms || []).length === 0 ? (
            <p className="text-[11px] font-bold text-slate-500 mt-3">No other Anonymous rooms are open right now.</p>
          ) : (
            <div className="mt-4 space-y-2 max-h-[45vh] overflow-y-auto pr-1">
              {browseRooms.map((r) => {
                const seatsLeft = r.seats_left;
                const joinFree = typeof r.member_paid_required === 'boolean' && !r.member_paid_required;
                return (
                  <button
                    key={r.id}
                    onClick={() => {
                      setBrowseOpen(false);
                      navigate(`/anonymous/${r.id}`);
                    }}
                    className="w-full text-left flex items-center gap-3 px-4 py-3 rounded-xl bg-slate-800/70 border border-slate-700 hover:border-apex-500/40 transition"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-black text-white truncate">{r.name}</p>
                      <p className="text-[10px] font-bold text-slate-400 mt-0.5">
                        {r.group_state === 'active' ? '🔥 Active' : '⏳ Waiting'} ·{' '}
                        {r.member_count ?? 0}/{r.founding_member_cap ?? '—'} members ·{' '}
                        {r.spectator_count ?? 0}/{r.free_spectator_cap ?? '—'} spectators
                        {r.total_capacity != null ? ` · ${r.total_capacity} total` : ''}
                      </p>
                    </div>
                    {seatsLeft != null && seatsLeft > 0 && !r.membership_locked && (
                      <span
                        className={`shrink-0 px-2 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${
                          joinFree
                            ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                            : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                        }`}
                      >
                        {joinFree ? 'Join free' : `₦${r.member_price ?? '…'}`}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          <div className="flex flex-col items-stretch gap-2.5 mt-5">
            <button
              onClick={() => {
                setBrowseOpen(false);
                createAnonRoom();
              }}
              disabled={creatingRoom}
              className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 font-black text-xs uppercase tracking-widest hover:bg-slate-700 disabled:opacity-50 transition"
            >
              {creatingRoom ? <Loader2 size={14} className="animate-spin" /> : <Users size={14} />}
              Create my own Anonymous room
            </button>
            <button
              onClick={() => setBrowseOpen(false)}
              className="px-4 py-2.5 rounded-xl bg-transparent border border-slate-800 text-slate-400 font-black text-xs uppercase tracking-widest hover:text-white transition"
            >
              Cancel
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

      {actionSheetOpen && isMember && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setActionSheetOpen(false)} />
          <div className="relative w-full max-w-md mx-auto bg-slate-950 border-t border-x border-slate-800 rounded-t-3xl p-4 pb-8 max-h-[80vh] overflow-y-auto flex flex-col gap-4">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h3 className="font-black text-white text-sm flex items-center gap-1.5">
                  <Swords size={14} className="text-apex-400" /> Aim an action
                </h3>
                <p className="text-[11px] font-semibold text-slate-500 mt-0.5 truncate">
                  {actionMessage ? (
                    <>
                      On a message from <span style={identityStyle(aliasNum(actionMessage))}>{actionMessage.author}</span>
                    </>
                  ) : (
                    'To another member in this room'
                  )}
                </p>
              </div>
              <button onClick={() => setActionSheetOpen(false)} className="text-slate-500 hover:text-white transition shrink-0">
                <X size={18} />
              </button>
            </div>

            <div className="grid grid-cols-4 gap-2">
              {roomSocial.map((a) => (
                <button
                  key={a.key}
                  onClick={() => setPendingAction(pendingAction === a.key ? null : a.key)}
                  disabled={actionBusy}
                  className={`flex flex-col items-center gap-1 py-2.5 rounded-xl border transition disabled:opacity-40 ${
                    pendingAction === a.key
                      ? 'bg-apex-500/20 border-apex-500/60 text-apex-200'
                      : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-600'
                  }`}
                >
                  <span className="text-lg leading-none">{a.glyph}</span>
                  <span className="text-[8px] font-black uppercase tracking-widest text-center leading-tight">{a.label}</span>
                </button>
              ))}
              {roomSocial.length === 0 && (
                <span className="text-[11px] font-bold text-slate-500 col-span-4 text-center py-2">
                  No actions are available in this room.
                </span>
              )}
            </div>

            {pendingAction && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Target</p>
                  <span className="text-[10px] font-bold text-slate-500">
                    {rosterLoaded ? `${rosterOnline} online` : 'loading…'}
                  </span>
                </div>
                {rosterLoaded ? (
                  <>
                    <input
                      value={rosterQuery}
                      onChange={(e) => setRosterQuery(e.target.value)}
                      placeholder="Search Anonymous #NN…"
                      inputMode="numeric"
                      className="w-full mb-2 px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs font-bold text-slate-200 placeholder-slate-600 focus:border-apex-500 outline-none"
                    />
                    <div className="flex items-center gap-1.5 flex-wrap max-h-32 overflow-y-auto">
                      {actionTargets.length === 0 && (
                        <span className="text-[11px] font-bold text-slate-500">No members match that search.</span>
                      )}
                      {actionTargets.map(({ n, online }) => (
                        <button
                          key={n}
                          onClick={() => setActionTarget(actionTarget === n ? null : n)}
                          disabled={!online}
                          title={online ? 'Online' : 'Offline — not selectable'}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-black transition ${
                            actionTarget === n
                              ? 'bg-apex-500/20 border-apex-500/60 text-apex-200'
                              : online
                                ? 'bg-slate-900 border-slate-800 hover:border-slate-600'
                                : 'bg-slate-900/50 border-slate-800/60 opacity-40 cursor-not-allowed'
                          }`}
                          style={identityStyle(n)}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${online ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                          Anonymous #{String(n).padStart(2, '0')}
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {knownAliases.length === 0 && (
                      <span className="text-[11px] font-bold text-slate-500">No other members have spoken yet.</span>
                    )}
                    {knownAliases.map(([n]) => (
                      <button
                        key={n}
                        onClick={() => setActionTarget(actionTarget === n ? null : n)}
                        className={`px-2.5 py-1 rounded-full border text-[11px] font-black transition ${
                          actionTarget === n
                            ? 'bg-apex-500/20 border-apex-500/60 text-apex-200'
                            : 'bg-slate-900 border-slate-800 hover:border-slate-600'
                        }`}
                        style={identityStyle(n)}
                      >
                        Anonymous #{String(n).padStart(2, '0')}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {actionLocked && (
              <p className="text-[11px] font-bold text-slate-500 flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin" /> The actions are cooling down ({fmtMSS(actionCooldownUntil - tick)}).
              </p>
            )}

            <div className="border-t border-slate-800 pt-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-black text-slate-300">Declining interactions</p>
                <p className="text-[10px] font-semibold text-slate-500">Block others from aiming actions at you.</p>
              </div>
              <button
                onClick={toggleDeclining}
                disabled={decliningBusy}
                aria-pressed={declining}
                className={`relative w-11 h-6 rounded-full transition shrink-0 ${declining ? 'bg-rose-500' : 'bg-slate-700'} disabled:opacity-50`}
              >
                <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${declining ? 'left-[1.4rem]' : 'left-0.5'}`} />
              </button>
            </div>

            {composerError && <p className="text-[11px] font-bold text-red-400">{composerError}</p>}

            <button
              onClick={sendSheetAction}
              disabled={!pendingAction || actionTarget == null || actionBusy || actionLocked}
              className="w-full px-4 py-3 rounded-xl bg-apex-600 text-white font-black text-xs uppercase tracking-widest hover:bg-apex-700 disabled:opacity-40 inline-flex items-center justify-center gap-2"
            >
              {actionBusy ? <Loader2 size={14} className="animate-spin" /> : <Swords size={14} />}
              {!pendingAction
                ? 'Pick an action'
                : actionTarget == null
                  ? 'Pick a target'
                  : `${roomSocial.find((a) => a.key === pendingAction)?.label ?? 'Send'} → Anonymous #${String(actionTarget).padStart(2, '0')}`}
            </button>
          </div>
        </div>
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
