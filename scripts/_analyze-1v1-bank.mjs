// Temp analysis: validate the three 1v1 question banks before seeding.
import fs from 'fs';
import crypto from 'crypto';

const dir = 'src/data/flashcards/1v1-questions/';
const OPT_KEYS = ['A', 'B', 'C', 'D'];

const normOptions = (o) => {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return { opts: null, extra: false };
  const out = {};
  for (const k of OPT_KEYS) {
    const v = o[k];
    if (typeof v !== 'string' || !v.trim()) return { opts: null, extra: false };
    out[k] = v.trim();
  }
  const extra = Object.keys(o).some((k) => !OPT_KEYS.includes(k));
  return { opts: out, extra };
};

const toLetter = (raw, opts) => {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (OPT_KEYS.includes(s)) return s;
  const prefix = s.slice(0, 1);
  if (OPT_KEYS.includes(prefix) && (s[1] === ')' || s[1] === '.' || s[1] === ' ')) return prefix;
  if (opts) {
    for (const k of OPT_KEYS) {
      if (opts[k] && opts[k].toLowerCase() === s.toLowerCase()) return k;
    }
  }
  return null;
};

const hashOf = (stem, opts) =>
  crypto
    .createHash('sha256')
    .update(stem.trim().toLowerCase() + '|' + OPT_KEYS.map((k) => opts[k].trim().toLowerCase()).join('|'))
    .digest('hex');

const seen = new Map();
const report = [];

function check({ file, idx, stem, rawOpts, correctRaw, subject, topic, difficulty, sourceId }) {
  const errs = [];
  if (typeof stem !== 'string' || !stem.trim()) errs.push('EMPTY_STEM');
  const { opts, extra } = normOptions(rawOpts);
  if (!opts) errs.push('BAD_OPTIONS');
  if (extra) errs.push('EXTRA_OPTION_KEYS');
  const letter = opts ? toLetter(correctRaw, opts) : null;
  if (!letter) errs.push('BAD_CORRECT_KEY:' + JSON.stringify(correctRaw));
  let key = null;
  if (opts && stem) {
    key = hashOf(stem, opts);
    if (seen.has(key)) errs.push('DUP_OF:' + seen.get(key));
    else seen.set(key, file + '#' + idx);
  }
  if (typeof subject !== 'string' || !subject.trim()) errs.push('NO_SUBJECT');
  if (typeof topic !== 'string' || !topic.trim()) errs.push('NO_TOPIC');
  if (typeof difficulty !== 'string' || !difficulty.trim()) errs.push('NO_DIFFICULTY');
  if (errs.length) report.push({ file, idx, sourceId, errs });
  return errs.length === 0;
}

const stats = {};

{
  const j = JSON.parse(fs.readFileSync(dir + 'Foundation_Tournament_Pool_500.json', 'utf8'));
  let ok = 0;
  j.questions.forEach((q, i) => {
    const good = check({
      file: 'foundation',
      idx: i,
      stem: q.question,
      rawOpts: q.options,
      correctRaw: q.correct,
      subject: q.subject,
      topic: q.topic,
      difficulty: q.difficulty,
      sourceId: 'F' + q.number,
    });
    if (good) ok++;
  });
  stats.foundation = { total: j.questions.length, valid: ok };
}

{
  const j = JSON.parse(fs.readFileSync(dir + 'medsurg_tournament_500.json', 'utf8'));
  let ok = 0;
  j.forEach((q, i) => {
    const good = check({
      file: 'medsurg',
      idx: i,
      stem: q.stem,
      rawOpts: q.options,
      correctRaw: q.correct,
      subject: q.tag,
      topic: q.tag,
      difficulty: 'Hard',
      sourceId: 'M' + q.number,
    });
    if (good) ok++;
  });
  stats.medsurg = { total: j.length, valid: ok };
}

{
  const j = JSON.parse(fs.readFileSync(dir + 'anat_bank_FINAL_1000_all_hard.json', 'utf8'));
  let ok = 0;
  j.forEach((q, i) => {
    const good = check({
      file: 'anatomy',
      idx: i,
      stem: q.question,
      rawOpts: q.options,
      correctRaw: q.correct_answer,
      subject: q.course,
      topic: q.topic,
      difficulty: q.difficulty,
      sourceId: q.id,
    });
    if (good) ok++;
  });
  stats.anatomy = { total: j.length, valid: ok };
}

console.log('stats', JSON.stringify(stats));
console.log('total valid', Object.values(stats).reduce((a, b) => a + b.valid, 0));
console.log('problem count', report.length);
console.log('problems sample', JSON.stringify(report.slice(0, 20), null, 1));
