// scripts/download-audio.mjs
// Downloads the quiz sound-effect MP3s referenced in the Apex Scholars spec
// (Part 20) from myinstants.com into public/audio/ using stable local names.
//
// Each myinstants instant page exposes the audio in an <meta property="og:audio">
// tag (e.g. https://www.myinstants.com/media/sounds/{slug}.mp3). We fetch the
// page, extract that URL, then download and store the file locally.
//
// Usage: node scripts/download-audio.mjs

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'public', 'audio');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// [outputPath (relative to OUT), instantPageUrl]
const SOURCES = [
  // Intro
  ['intro.mp3', 'https://www.myinstants.com/en/instant/show-me-what-youve-got-r-m-15/'],

  // Exit
  ['exit.mp3', 'https://www.myinstants.com/en/instant/why-are-you-running-15312/'],

  // Correct pool (7)
  ['correct/correct-01.mp3', 'https://www.myinstants.com/en/instant/ive-got-this-75817/'],
  ['correct/correct-02.mp3', 'https://www.myinstants.com/en/instant/anime-ahh-73606/'],
  ['correct/correct-03.mp3', 'https://www.myinstants.com/en/instant/michael-jackson-hee-hee-40277/'],
  ['correct/correct-04.mp3', 'https://www.myinstants.com/en/instant/m-e-o-w-82698/'],
  ['correct/correct-05.mp3', 'https://www.myinstants.com/en/instant/oh-great-heavens-67045/'],
  ['correct/correct-06.mp3', 'https://www.myinstants.com/en/instant/winning-sound-effect-button-9998/'],
  ['correct/correct-07.mp3', 'https://www.myinstants.com/en/instant/celebration-win-32655/'],

  // Wrong pool (14)
  ['wrong/wrong-01.mp3', 'https://www.myinstants.com/en/instant/oh-my-god-bro-oh-hell-nah-man-42939/'],
  ['wrong/wrong-02.mp3', 'https://www.myinstants.com/en/instant/fahhhhhhhhhhhhhh-3525/'],
  ['wrong/wrong-03.mp3', 'https://www.myinstants.com/en/instant/spongebob-fail-11236/'],
  ['wrong/wrong-04.mp3', 'https://www.myinstants.com/en/instant/tuco-get-out-30566/'],
  ['wrong/wrong-05.mp3', 'https://www.myinstants.com/en/instant/buzzer-89244/'],
  ['wrong/wrong-06.mp3', 'https://www.myinstants.com/en/instant/womp-womp-womp-55094/'],
  ['wrong/wrong-07.mp3', 'https://www.myinstants.com/en/instant/bruh-sound-effect-26614/'],
  ['wrong/wrong-08.mp3', 'https://www.myinstants.com/en/instant/mi-bombo-8264/'],
  ['wrong/wrong-09.mp3', 'https://www.myinstants.com/en/instant/auughhh-79002/'],
  ['wrong/wrong-10.mp3', 'https://www.myinstants.com/en/instant/what-the-hell-speed-up-14372/'],
  ['wrong/wrong-11.mp3', 'https://www.myinstants.com/en/instant/flashbang-gah-dayum-64535/'],
  ['wrong/wrong-12.mp3', 'https://www.myinstants.com/en/instant/ive-got-this-faaaaaaaaahhhhh-66795/'],
  ['wrong/wrong-13.mp3', 'https://www.myinstants.com/en/instant/the-saxophones-getting-louder-61232/'],
  ['wrong/wrong-14.mp3', 'https://www.myinstants.com/en/instant/cat-laugh-meme-1-15761/']
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const extractMediaUrl = (html) => {
  const m = html.match(/property="og:audio"\s+content="([^"]+)"/);
  return m ? m[1] : null;
};

fs.mkdirSync(path.join(OUT, 'correct'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'wrong'), { recursive: true });

let ok = 0, skip = 0, fail = 0;

for (const [rel, pageUrl] of SOURCES) {
  const outPath = path.join(OUT, rel);
  if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
    skip++;
    console.log(`SKIP ${rel} (exists, ${fs.statSync(outPath).size} bytes)`);
    continue;
  }

  try {
    const pageRes = await fetch(pageUrl, { headers: { 'user-agent': UA } });
    if (!pageRes.ok) {
      fail++;
      console.error(`FAIL page ${rel} : HTTP ${pageRes.status} :: ${pageUrl}`);
      continue;
    }
    const html = await pageRes.text();
    const mediaUrl = extractMediaUrl(html);
    if (!mediaUrl) {
      fail++;
      console.error(`FAIL ${rel} : no og:audio meta found :: ${pageUrl}`);
      continue;
    }
    const absMediaUrl = mediaUrl.startsWith('http') ? mediaUrl : `https://www.myinstants.com${mediaUrl}`;

    const res = await fetch(absMediaUrl, { headers: { 'user-agent': UA } });
    if (!res.ok) {
      fail++;
      console.error(`FAIL ${rel} : audio HTTP ${res.status} :: ${absMediaUrl}`);
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) {
      fail++;
      console.error(`FAIL ${rel} : empty body :: ${absMediaUrl}`);
      continue;
    }
    fs.writeFileSync(outPath, buf);
    ok++;
    console.log(`OK   ${rel} : ${buf.length} bytes :: ${absMediaUrl}`);
    await sleep(400);
  } catch (err) {
    fail++;
    console.error(`FAIL ${rel} : ${err.message} :: ${pageUrl}`);
  }
}

console.log(`\nDownloaded ${ok}, skipped ${skip}, failed ${fail} -> ${OUT}`);
process.exit(fail ? 1 : 0);
