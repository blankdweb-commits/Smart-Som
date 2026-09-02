// scripts/test-audio-system.mjs
// Validates Parts 20-23: local audio system correctness.
// Run: node scripts/test-audio-system.mjs

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

let pass = 0;
let fail = 0;
const assert = (cond, msg) => { if (cond) { pass++; console.log(`  PASS  ${msg}`); } else { fail++; console.error(`  FAIL  ${msg}`); } };

// ── 1. Audio assets exist with correct structure ──
console.log('\n=== Part 20: Audio Asset Structure ===');
const AUDIO = path.join(ROOT, 'public', 'audio');
assert(fs.existsSync(path.join(AUDIO, 'intro.mp3')), 'public/audio/intro.mp3 exists');
assert(fs.existsSync(path.join(AUDIO, 'exit.mp3')), 'public/audio/exit.mp3 exists');
for (let i = 1; i <= 7; i++) {
  const f = path.join(AUDIO, 'correct', `correct-0${i}.mp3`);
  assert(fs.existsSync(f) && fs.statSync(f).size > 0, `public/audio/correct/correct-0${i}.mp3 exists and non-empty`);
}
for (let i = 1; i <= 14; i++) {
  const f = path.join(AUDIO, 'wrong', `wrong-${String(i).padStart(2, '0')}.mp3`);
  assert(fs.existsSync(f) && fs.statSync(f).size > 0, `public/audio/wrong/wrong-${String(i).padStart(2, '0')}.mp3 exists and non-empty`);
}
const intro = fs.statSync(path.join(AUDIO, 'intro.mp3'));
const exit = fs.statSync(path.join(AUDIO, 'exit.mp3'));
assert(intro.size < 500000, `intro.mp3 < 500kB (${intro.size} bytes)`);
assert(exit.size < 500000, `exit.mp3 < 500kB (${exit.size} bytes)`);
const correctFiles = fs.readdirSync(path.join(AUDIO, 'correct')).filter(f => f.endsWith('.mp3'));
assert(correctFiles.length === 7, `7 correct pool clips (found ${correctFiles.length})`);
const wrongFiles = fs.readdirSync(path.join(AUDIO, 'wrong')).filter(f => f.endsWith('.mp3'));
assert(wrongFiles.length === 14, `14 wrong pool clips (found ${wrongFiles.length})`);

// ── 2. dist includes all audio (build passthrough) ──
console.log('\n=== Part 20: Build Distribution ===');
const DIST_AUDIO = path.join(ROOT, 'dist', 'audio');
assert(fs.existsSync(path.join(DIST_AUDIO, 'intro.mp3')), 'dist/audio/intro.mp3 copied');
assert(fs.existsSync(path.join(DIST_AUDIO, 'exit.mp3')), 'dist/audio/exit.mp3 copied');
assert(fs.existsSync(path.join(DIST_AUDIO, 'correct', 'correct-01.mp3')), 'dist/audio/correct/ copied');
assert(fs.existsSync(path.join(DIST_AUDIO, 'wrong', 'wrong-01.mp3')), 'dist/audio/wrong/ copied');

// ── 3. No remote audio URLs in source ──
console.log('\n=== Part 20: No Remote Audio Hotlinks ===');
const scanFiles = (dir, exts) => {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...scanFiles(fp, exts));
    else if (exts.some(e => entry.name.endsWith(e))) results.push(fp);
  }
  return results;
};
const srcFiles = scanFiles(path.join(ROOT, 'src'), ['.js', '.jsx']);
const SUPABASE_URL_RE = /myinstants\.com\/media\/sounds|storage\/v1\/object\/public\/sounds|SUPABASE_URL.*storage|VITE_SUPABASE_URL.*sounds/g;
let remoteRefs = 0;
for (const f of srcFiles) {
  const content = fs.readFileSync(f, 'utf8');
  if (SUPABASE_URL_RE.test(content)) {
    remoteRefs++;
    console.log(`    WARN remote audio ref in ${path.relative(ROOT, f)}`);
  }
}
assert(remoteRefs === 0, `Zero remote audio URL references in src/ (found ${remoteRefs})`);

// ── 4. AudioManager source has correct structure ──
console.log('\n=== Part 21: AudioManager ===');
const audioSrc = fs.readFileSync(path.join(ROOT, 'src', 'utils', 'audio.js'), 'utf8');
assert(audioSrc.includes('intro:'), 'AudioManager defines intro pool');
assert(audioSrc.includes('exit:'), 'AudioManager defines exit pool');
assert(audioSrc.includes('correct:'), 'AudioManager defines correct pool');
assert(audioSrc.includes('wrong:'), 'AudioManager defines wrong pool');
assert(audioSrc.includes('timeout'), 'AudioManager defines timeout pool');
assert(audioSrc.includes('playIntro()'), 'AudioManager has playIntro method');
assert(audioSrc.includes('playExit()'), 'AudioManager has playExit method');
assert(audioSrc.includes('playCorrect()'), 'AudioManager has playCorrect method');
assert(audioSrc.includes('playWrong()'), 'AudioManager has playWrong method');
assert(audioSrc.includes('playExitForDialog()'), 'AudioManager has playExitForDialog');
assert(audioSrc.includes('scheduleExitStop'), 'AudioManager has scheduleExitStop');
assert(audioSrc.includes('stopAll'), 'AudioManager has stopAll');
assert(audioSrc.includes('unlock'), 'AudioManager has unlock (autoplay)');
assert(audioSrc.includes('preload'), 'AudioManager has preload');
assert(audioSrc.includes('MAX_SOUND_SECONDS'), 'AudioManager has MAX_SOUND_SECONDS guard');
assert(audioSrc.includes('class AudioManager'), 'AudioManager is a class');
assert(audioSrc.includes('singleton') || audioSrc.includes('new AudioManager'), 'AudioManager is instantiated as singleton');

// ── 5. Hook wired to context ──
console.log('\n=== Part 21: useQuizAudio Hook ===');
const hookSrc = fs.readFileSync(path.join(ROOT, 'src', 'hooks', 'useQuizAudio.js'), 'utf8');
assert(hookSrc.includes('useAppContext'), 'Hook uses AppContext for soundEnabled');
assert(hookSrc.includes('soundEnabled'), 'Hook reads soundEnabled');
assert(hookSrc.includes('toggleSound'), 'Hook exposes toggleSound');
assert(hookSrc.includes('setEnabled'), 'Hook syncs manager enabled flag');

// ── 6. Quiz.jsx uses the new system ──
console.log('\n=== Part 20/21/22: Quiz.jsx Wiring ===');
const quizSrc = fs.readFileSync(path.join(ROOT, 'src', 'pages', 'Quiz.jsx'), 'utf8');
assert(!quizSrc.includes('SOUND_BASE'), 'Quiz.jsx no longer defines SOUND_BASE (Supabase)');
assert(!quizSrc.includes('soundAt('), 'Quiz.jsx no longer uses soundAt() helper');
assert(quizSrc.includes('audioManager'), 'Quiz.jsx imports audioManager');
assert(quizSrc.includes('useQuizAudio'), 'Quiz.jsx uses useQuizAudio hook');
assert(quizSrc.includes('unlockAudio'), 'Quiz.jsx calls unlockAudio');
assert(quizSrc.includes('preloadAudio'), 'Quiz.jsx calls preloadAudio');
assert(quizSrc.includes('playIntro'), 'Quiz.jsx calls playIntro in launchPlayer');
assert(quizSrc.includes('scheduleExitStop'), 'Quiz.jsx schedules exit stop in quitPlayer');
assert(quizSrc.includes('introHandledRef'), 'Quiz.jsx guards intro with ref (no double-play)');

// ── 7. QuizPlayer.jsx exit dialog wiring ──
console.log('\n=== Part 20: QuizPlayer Exit Sound ===');
const qpSrc = fs.readFileSync(path.join(ROOT, 'src', 'components', 'QuizPlayer.jsx'), 'utf8');
assert(qpSrc.includes('onExitSoundStart'), 'QuizPlayer accepts onExitSoundStart prop');
assert(qpSrc.includes('onExitSoundStop'), 'QuizPlayer accepts onExitSoundStop prop');
assert(qpSrc.includes('setShowQuitModal(true); onExitSoundStart'), 'Exit sound starts when Quit modal opens');
assert(qpSrc.includes('setShowQuitModal(false); onExitSoundStop'), 'Exit sound stops when "Stay and Master" clicked');

// ── 8. Part 22: Error handling (audio never crashes quiz) ──
console.log('\n=== Part 22: Error Handling ===');
assert(audioSrc.includes('catch'), 'AudioManager catches errors');
assert(audioSrc.includes('import.meta.env.DEV'), 'AudioManager logs in DEV mode only');
assert(audioSrc.includes('_log'), 'AudioManager has _log dedup (prevents console spam)');
assert(audioSrc.includes('typeof Audio'), 'AudioManager guards against missing Audio API');

// ── 9. Part 23: mobile test prerequisites ──
console.log('\n=== Part 23: Mobile/Browser Test Prerequisites ===');
assert(quizSrc.includes('handlePlayerComplete'), 'Quiz has handlePlayerComplete (natural finish path)');
assert(quizSrc.includes('introHandledRef.current = false'), 'introHandledRef resets on completion (next start replays intro)');
assert(quizSrc.includes('quitPlayer'), 'Quiz has quitPlayer (intentional exit path)');
assert(!quizSrc.includes('VITE_SUPABASE_URL') || !quizSrc.includes('/storage/v1/object/public/sounds'), 'No Supabase storage audio URL in Quiz.jsx sound system');

// ── 10. Validate the download script maps to the correct counts ──
console.log('\n=== Part 20: Download Script Sources ===');
const dlSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'download-audio.mjs'), 'utf8');
const introCount = (dlSrc.match(/intro\.mp3/g) || []).length;
const exitCount = (dlSrc.match(/exit\.mp3/g) || []).length;
const correctCount = (dlSrc.match(/correct\/correct-/g) || []).length;
const wrongCount = (dlSrc.match(/wrong\/wrong-/g) || []).length;
assert(introCount >= 1, `Download script includes intro (${introCount} refs)`);
assert(exitCount >= 1, `Download script includes exit (${exitCount} refs)`);
assert(correctCount === 7, `Download script includes 7 correct clips (found ${correctCount})`);
assert(wrongCount === 14, `Download script includes 14 wrong clips (found ${wrongCount})`);

console.log(`\n==============================`);
console.log(`Results: ${pass} passed, ${fail} failed`);
console.log(`==============================\n`);
process.exit(fail ? 1 : 0);
