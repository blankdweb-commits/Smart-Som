// scripts/download-sounds.mjs
// Downloads the quiz sound-effect MP3s from myinstants.com into ./quiz-sounds/
// named {event}-{index}.mp3, preserving the SOUND_POOL order in Quiz.jsx so the
// public URLs can be mapped 1:1 back onto the pool later.
// Usage: node scripts/download-sounds.mjs

import fs from 'fs';
import path from 'path';

const SOUND_POOL = {
  start: [
    'https://www.myinstants.com/media/sounds/show-me-what-you-got.mp3',
    'https://www.myinstants.com/media/sounds/are-you-ready-kids.mp3'
  ],
  correct: [
    'https://www.myinstants.com/media/sounds/im-ready.mp3',
    'https://www.myinstants.com/media/sounds/f-is-for-friends.mp3',
    'https://www.myinstants.com/media/sounds/krusty-krab-pizza.mp3',
    'https://www.myinstants.com/media/sounds/is-mayonnaise-an-instrument.mp3',
    'https://www.myinstants.com/media/sounds/its-a-giraffe.mp3',
    'https://www.myinstants.com/media/sounds/giggity.mp3',
    'https://www.myinstants.com/media/sounds/freaking-sweet.mp3',
    'https://www.myinstants.com/media/sounds/oh-my-god.mp3',
    'https://www.myinstants.com/media/sounds/awesome.mp3',
    'https://www.myinstants.com/media/sounds/think-mark.mp3',
    'https://www.myinstants.com/media/sounds/i-can-do-whatever-i-want.mp3',
    'https://www.myinstants.com/media/sounds/you-dont-seem-to-understand.mp3',
    'https://www.myinstants.com/media/sounds/i-am-the-strongest.mp3'
  ],
  wrong: [
    'https://www.myinstants.com/media/sounds/im-ugly-and-im-proud.mp3',
    'https://www.myinstants.com/media/sounds/ravioli-ravioli-give-me-the-formuoli.mp3',
    'https://www.myinstants.com/media/sounds/squidward.mp3',
    'https://www.myinstants.com/media/sounds/patrick.mp3',
    'https://www.myinstants.com/media/sounds/family-guy-thats-not-a-joke.mp3',
    'https://www.myinstants.com/media/sounds/wheres-my-money.mp3',
    'https://www.myinstants.com/media/sounds/family-guy-youre-a-moron.mp3',
    'https://www.myinstants.com/media/sounds/family-guy-what-the-deuce.mp3',
    'https://www.myinstants.com/media/sounds/family-guy-bird-is-the-word.mp3',
    'https://www.myinstants.com/media/sounds/im-so-sorry-mark.mp3',
    'https://www.myinstants.com/media/sounds/you-pathetic-excuse.mp3',
    'https://www.myinstants.com/media/sounds/why-did-you-make-me-do-this.mp3'
  ],
  timeout: [
    'https://www.myinstants.com/media/sounds/family-guy-time-out.mp3',
    'https://www.myinstants.com/media/sounds/the-krusty-krab-is-closed.mp3'
  ]
};

const dir = path.join(process.cwd(), 'quiz-sounds');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

let ok = 0, fail = 0, skip = 0;
for (const event of Object.keys(SOUND_POOL)) {
  const urls = SOUND_POOL[event];
  for (let i = 0; i < urls.length; i++) {
    const outName = `${event}-${i}.mp3`;
    const outPath = path.join(dir, outName);
    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
      skip++;
      continue;
    }
    const res = await fetch(urls[i], { headers: { 'user-agent': UA } });
    if (!res.ok) {
      fail++;
      console.error(`FAIL ${outName} : HTTP ${res.status}`);
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(outPath, buf);
    ok++;
    console.log(`OK   ${outName} : ${buf.length} bytes :: ${urls[i]}`);
  }
}
console.log(`\nDownloaded ${ok}, skipped ${skip}, failed ${fail} -> ${dir}`);
process.exit(fail ? 1 : 0);
