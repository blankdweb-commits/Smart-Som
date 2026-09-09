// scripts/_gen-vapid-keys.mjs
// One-off helper: prints a fresh VAPID keypair to paste into .env /
// Vercel env. The PUBLIC key is safe to ship to browsers (VITE_ var); the
// PRIVATE key must NEVER leave the server (.env / Vercel env only).
import webpush from 'web-push';

const keys = webpush.generateVAPIDKeys();
console.log('VITE_VAPID_PUBLIC_KEY=' + keys.publicKey);
console.log('VAPID_PRIVATE_KEY=' + keys.privateKey);
console.log('');
console.log('# Also add (server-only):');
console.log('# VAPID_SUBJECT=mailto:you@example.com   (or `https://www.polynurse.com.ng` — an https contact or URI)');
console.log('# CRON_SECRET=<random long string>       (used by Vercel Cron to call /api/cron-push-reminders)');