// ============================================================================
// src/utils/signupValidation.js
//
// The ONE source of truth for registration validation.
//
// WHY A SEPARATE MODULE: registration is now a guided multi-step flow
// (components/SignupWizard.jsx) AND there is a second registration surface
// (components/CommunityAuthModal.jsx). When validation lived inside the JSX of
// each page the two drifted — Auth.jsx only had `password.length < 6` and a
// mismatch throw inside handleSubmit, while CommunityAuthModal had real
// per-field checks. Every rule below is a pure function so both surfaces
// cannot disagree about what a valid registration is.
//
// SCOPE — EXACTLY FOUR REQUIRED FIELDS:
//   name, email, password, confirmPassword.
// Nothing else is required and nothing else is asked for. Phone, nursing year,
// school, date of birth and photo are deliberately NOT collected: the
// profiles trigger (SUPABASE_SETUP.sql handle_new_user) fills them with '' and
// they only added friction to the one flow we need to keep short.
//
// IDENTITY: this app does NOT have a username. The public display name lives in
// `profiles.identity_name` (set later in Settings, capped at 24 chars by the
// v85 CHECK constraint). The wizard therefore writes `full_name` — the legal
// name — exactly as the previous single-page form did. It does not invent a
// permanent handle.
// ============================================================================

// Mirrors the Supabase project's auth password policy. The server is the real
// authority; this exists so the UI can explain the rule before submission
// instead of returning a bare 422 after the round trip.
export const PASSWORD_MIN_LENGTH = 6;
export const PASSWORD_MAX_LENGTH = 72;

// Name bounds. Deliberately loose — we are not validating legal names, and a
// culture-specific pattern here would reject real users. Length + "not only
// punctuation" is all we assert.
export const NAME_MIN_LENGTH = 2;
export const NAME_MAX_LENGTH = 80;

export const SIGNUP_FIELD_NAMES = Object.freeze([
  'fullName',
  'email',
  'password',
  'confirmPassword',
]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Passwords that pass a length check and a character-class check while being
// among the first things anyone would guess. Deliberately short — this is a
// guidance signal for a study platform, not an authentication authority.
const WEAK_PASSWORDS = new Set([
  'password', 'password1', 'password123', 'passw0rd',
  '123456', '1234567', '12345678', '123456789', '1234567890',
  'qwerty', 'qwerty123', 'abc123', 'letmein', 'welcome', 'welcome1',
  'iloveyou', 'monkey', 'dragon', 'sunshine', 'princess', 'football',
  'baseball', 'superman', 'trustno1', 'starwars', 'whatever',
  'polynurse', 'polynurse1', 'nursing1', 'student1', 'changeme',
]);

// The empty-ish value used before a field has been touched. Validating an
// untouched field must produce a "complete this" message, never "that is not a
// valid X" — otherwise the first keystroke of a fresh form greets the user with
// an error about a field they are still typing.
const isBlank = (v) => typeof v !== 'string' || v.trim() === '';

const ok = () => ({ valid: true, error: null });
const fail = (error) => ({ valid: false, error });

// --- name -------------------------------------------------------------------
export function validateName(value) {
  if (isBlank(value)) return fail('Tell us what to call you.');
  const v = value.trim();
  if (v.length < NAME_MIN_LENGTH) {
    return fail(`That is a little short — use at least ${NAME_MIN_LENGTH} characters.`);
  }
  if (v.length > NAME_MAX_LENGTH) return fail(`Keep it under ${NAME_MAX_LENGTH} characters.`);
  // A name made only of punctuation/numbers is not a name. Checked on the
  // letters, so "Ada 2" and "de la Cruz" both pass.
  if (!/\p{L}/u.test(v)) return fail('Please use at least one letter.');
  return ok();
}

// --- email ------------------------------------------------------------------
export function validateEmail(value) {
  if (isBlank(value)) return fail('We need an email address to reach you.');
  const v = value.trim();
  if (v.length > 254) return fail('That address is too long.');
  if (!EMAIL_RE.test(v)) return fail('That does not look like an email address.');
  return ok();
}

// --- password ---------------------------------------------------------------
export function validatePassword(value) {
  if (typeof value !== 'string' || value === '') return fail('Choose a password.');
  if (value.length < PASSWORD_MIN_LENGTH) {
    return fail(`Use at least ${PASSWORD_MIN_LENGTH} characters.`);
  }
  if (value.length > PASSWORD_MAX_LENGTH) {
    return fail(`Keep it under ${PASSWORD_MAX_LENGTH} characters.`);
  }
  return ok();
}

// --- confirm ----------------------------------------------------------------
// Compared VERBATIM. No trimming, no case folding, no normalisation: silently
// rewriting what the user typed so the check passes would hide a real
// difference between the two entries and produce a password the user did not
// confirm.
export function validateConfirm(password, confirm) {
  if (typeof confirm !== 'string' || confirm === '') return fail('Type your password again.');
  if (password !== confirm) return fail('Those two passwords do not match.');
  return ok();
}

// --- per-step ---------------------------------------------------------------
// Keyed by the wizard's step ids so a step can validate itself without knowing
// the order of the flow.
export const STEP_VALIDATORS = Object.freeze({
  name: (v) => validateName(v.fullName),
  email: (v) => validateEmail(v.email),
  password: (v) => validatePassword(v.password),
  confirm: (v) => validateConfirm(v.password, v.confirmPassword),
  // The review step re-checks everything, because the user may have navigated
  // back and edited a field, then jumped forward.
  review: (v) => firstError(v),
});

// Returns the first failing field's error, or null when the whole form is
// valid. Order matches SIGNUP_FIELD_NAMES so the message a user sees is the
// first thing still missing, not an arbitrary one.
export function firstError(values) {
  const checks = [
    () => validateName(values.fullName),
    () => validateEmail(values.email),
    () => validatePassword(values.password),
    () => validateConfirm(values.password, values.confirmPassword),
  ];
  for (const check of checks) {
    const { valid, error } = check();
    if (!valid) return error;
  }
  return null;
}

export function isFormValid(values) {
  return firstError(values) === null;
}

// --- password strength (GUIDANCE, NOT A GATE) ------------------------------
// Returns { score, label, tone, checks }. `checks` are the concrete reasons a
// password is weak, so the UI can state facts instead of showing a bare bar.
//
// IMPORTANT: nothing here blocks submission. The only gate is the Supabase
// policy enforced by validatePassword (the 6-character minimum). A strength
// meter that silently refuses a valid password teaches users to reuse the same
// short one everywhere; this one only advises.
// Indexed DIRECTLY by score (0..4). The previous version computed the band as
// `STRENGTH_LABELS[Math.max(1, score + 1)]`, which is out of bounds at score 4 —
// and score 4 is exactly what a strong password produces (16+ chars, three or
// more character classes, unguessable, non-repetitive). That threw
// `Cannot read properties of undefined (reading 'label')` and took the whole
// sign-up wizard down to the error boundary for the users who picked the best
// possible password. Found by e2e-v99 with a 16-character passphrase; a 13-char
// one scored 3 and hid it.
const STRENGTH_LABELS = [
  { label: 'Too short', tone: 'slate' },   // 0 — only below the policy minimum
  { label: 'Weak', tone: 'rose' },
  { label: 'Fair', tone: 'amber' },
  { label: 'Good', tone: 'medical' },
  { label: 'Strong', tone: 'emerald' },
];

export function passwordStrength(value) {
  const v = typeof value === 'string' ? value : '';
  const checks = [];
  if (!v) return { score: 0, label: STRENGTH_LABELS[0].label, tone: 'slate', checks };

  // 1. length, on the actual character count (a 16-char passphrase is strong).
  if (v.length >= 6) checks.push('At least 6 characters');
  if (v.length >= 12) checks.push('Long enough to resist guessing');
  else if (v.length >= 6) checks.push('Longer would be safer');

  // 2. variety across the four classes.
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(v)).length;
  if (classes >= 3) checks.push('Mixes letters, numbers and symbols');
  else if (classes === 2) checks.push('Add a third kind of character');
  else if (v.length >= 8) checks.push('Mixing character types would help');

  // 3. not an obvious guess.
  const guessable = WEAK_PASSWORDS.has(v.toLowerCase())
    || /^(.)\1+$/.test(v)
    || /^(012345|123456|abcdef|qwerty)/i.test(v);
  if (!guessable) checks.push('Not an obvious guess');
  else checks.push('Too easy to guess');

  // 4. repeats run like "aaaabbbbcccc" are length without entropy.
  const uniqueRatio = new Set(v.toLowerCase()).size / v.length;
  if (uniqueRatio >= 0.5) checks.push('Characters are not repetitive');
  else checks.push('Very repetitive');

  // Score 0..4. Only genuinely strong signals add a point, so a 6-character
  // password can never read as "Strong" no matter how many classes it uses.
  let score = 0;
  if (v.length >= 12) score += 1;
  if (classes >= 3) score += 1;
  if (!guessable && uniqueRatio >= 0.5) score += 1;
  if (v.length >= 16) score += 1;

  if (v.length < PASSWORD_MIN_LENGTH) {
    return { score: 0, label: STRENGTH_LABELS[0].label, tone: STRENGTH_LABELS[0].tone, checks };
  }
  // Clamped on BOTH sides, and floored at 1.
  //
  // The floor is a COPY requirement, not arithmetic: "Too short" is only true
  // when the length check above failed, and that case already returned. Without
  // the floor, an 11-character password that trips the weak-password denylist
  // (score 0) was labelled "Too short" — a plain falsehood shown to someone who
  // had typed eleven characters.
  //
  // The ceiling is the crash fix: score 4 is what a strong password produces, and
  // an unclamped `score + 1` indexed past the end of this table and threw,
  // blanking the whole wizard. Clamping means no future edit to the scoring can
  // turn a label into a crash.
  const band = STRENGTH_LABELS[Math.max(1, Math.min(STRENGTH_LABELS.length - 1, score))];
  return { score, label: band.label, tone: band.tone, checks };
}

// --- presentation helpers ---------------------------------------------------
// Masks an address for the review step: a@bcd…  We never echo a password
// anywhere, and the review summary is the one place a screenshot is likely.
export function maskEmail(email) {
  if (typeof email !== 'string') return '';
  const v = email.trim();
  const at = v.indexOf('@');
  if (at <= 0) return v ? '•••' : '';
  const local = v.slice(0, at);
  const domain = v.slice(at);
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}${'•'.repeat(Math.max(3, local.length - head.length))}${domain}`;
}

// The greeting previews ("Welcome to PolyNurse, Ada!") use the name the user
// just typed, not a profile value that does not exist until the trigger fires.
export function firstNameOf(fullName) {
  if (typeof fullName !== 'string') return '';
  const trimmed = fullName.trim().replace(/\s+/g, ' ');
  if (!trimmed) return '';
  const first = trimmed.split(' ')[0];
  return first.charAt(0).toUpperCase() + first.slice(1);
}

// True when a Supabase signUp error means "this address already has an
// account". Used by the wizard AND by Auth.jsx so the two agree on the exact
// wording and both stay honest about what they know.
//
// SECURITY: this branch says an account already exists only AFTER Supabase has
// said so — it is never a client-side probe. A public pre-check ("is this email
// registered?") is an account-enumeration oracle and must not be added.
export function isDuplicateAccountError(error) {
  const message = error?.message;
  if (typeof message !== 'string') return false;
  return /already registered|already exists|already been registered|email.*conflict/i.test(message);
}
