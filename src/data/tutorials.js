// ============================================================================
// src/data/tutorials.js
//
// The three guided tours. EVERY statement here is checked against the shipped
// behaviour before it was written:
//
//  * Arena  — migration-v63: correct = 1 point, correct+Double = 2, incorrect
//    and skip = 0; tie-break is points DESC, then correct count DESC, then
//    DRAW (the v58 latency tie-break was deliberately deleted as unfair on
//    mobile). Rumble.jsx: 40 NMCN questions, ONE shared 90-second wall clock,
//    2 SC held in escrow at match start, tutor practice free (0 SC).
//  * Voting — service feedback and individual campaigns are separate surfaces
//    with separate storage. One rating per category per account; campaign votes
//    follow that campaign's own rule (one per authenticated user by default).
//  * Marketplace — only "Sold by PolyNurse" items can be bought, server-enforced
//    in initiate-payment / verify-payment / payments-webhook. Third-party
//    listings are informational, have no buy button, and are refused server-side.
//
// If any of these change, this file must change with them. It must never
// describe a feature the app does not have.
// ============================================================================

export const TUTORIALS = [
  {
    key: 'arena',
    title: 'The 1v1 Arena',
    blurb: 'Answer 40 questions against a clock or a real scholar.',
    icon: 'swords',
    route: '/rumble',
    // Where the contextual first-use tip points.
    steps: [
      {
        icon: 'swords',
        title: 'Open the Arena',
        body: 'Tap Arena in the sidebar, or "Arena" on your dashboard. The War Hall shows your last five duels and your current Smart Coin balance.',
      },
      {
        icon: 'users',
        title: 'Pick an opponent',
        body: 'From the Arena you choose one of two: "Enter Arena" to face a real scholar (2 SC stake), or "Practise vs a Bot" to rehearse the exact same board for free.',
      },
      {
        icon: 'zap',
        title: 'Bot practice is free',
        body: 'A tutor bot plays the real game — same 40-question board, same clock, same scoring and the same Double — but no coins change hands. Use it to learn the format before staking anything.',
      },
      {
        icon: 'clock',
        title: 'How a match runs',
        body: 'The board is 40 NMCN questions and BOTH players share one 90-second clock. When the countdown reaches zero the clock starts for real. You can attempt as many of the 40 as you can in that time — running out of questions does not end the match, the clock does.',
      },
      {
        icon: 'target',
        title: 'Answering and scoring',
        body: 'A correct answer scores 1 point. Press Double first and a correct answer scores 2 — but you only get ONE Double per match. An incorrect answer scores 0 (never negative), and skipping scores 0 too. Everything is graded on the server; your device never sends a score.',
      },
      {
        icon: 'trophy',
        title: 'How the winner is decided',
        body: 'Whoever has the most POINTS wins — it is not a speed race. Speed only decides how many of the 40 questions you get to attempt. If points are level we compare correct answers, and if that is level too the match is a DRAW and both stakes come straight back.',
      },
      {
        icon: 'coins',
        title: 'What Smart Coins do',
        body: 'A real duel holds 2 SC from each side in escrow the moment the match starts. Cancel before you start, walk away, or hit the grace timer and the coins come straight back. Forfeit or lose, and the pot goes to the other player. Tutor practice never touches coins.',
      },
      {
        icon: 'refresh',
        title: 'If your connection drops',
        body: 'You get a short grace window to reconnect. Reopen the Arena and pick up where you left off — your question index, score and Double are restored from the server, not from this device. If nobody comes back, the stakes are automatically returned.',
      },
      {
        icon: 'home',
        title: 'Back to the War Hall',
        body: 'After the result you will see both scorecards, a review of every question with the correct answer, explanation and hint, plus a Rematch button. Tap "War Hall" to leave and pick a new opponent.',
      },
    ],
  },
  {
    key: 'voting',
    title: 'Voting & Campaigns',
    blurb: 'Rate PolyNurse services, and vote in individual campaigns.',
    icon: 'check',
    route: '/voting',
    steps: [
      {
        icon: 'check',
        title: 'Open Voting',
        body: 'Voting is its own page in the sidebar. It has two separate tabs and they are never mixed together: service feedback for PolyNurse, and campaigns for individuals.',
      },
      {
        icon: 'star',
        title: 'Two different things',
        body: '"Service feedback" rates PolyNurse itself — the quiz experience, Marketplace, 1v1, Community, and overall quality. "Campaigns" are individual candidates with a start and end date. A service rating never counts as a candidate vote, and a candidate vote never counts as a service rating.',
      },
      {
        icon: 'file',
        title: 'Read the rules first',
        body: 'Every campaign states its eligibility, its voting rules and its closing time before you vote, and shows whether it is upcoming, active or ended. Results are hidden until the campaign says they are visible.',
      },
      {
        icon: 'star',
        title: 'Rate a service',
        body: 'Choose a category, pick a rating, optionally tick structured options and leave a written comment if you want to. Each of the five services is reviewed once per account — the server records your first answer and refuses a second one, so the averages cannot be quietly edited.',
      },
      {
        icon: 'trophy',
        title: 'Vote in a campaign',
        body: 'Open a candidate, read their statement, and tap Vote. You get a pending state immediately, then the server confirms it. Until the server confirms, the vote is not counted — we never show a vote as done before the database has agreed.',
      },
      {
        icon: 'zap',
        title: 'Live results',
        body: 'Totals and standings update on their own for everyone looking at the same campaign — no refreshing. You will see a small connection indicator if live updates drop out, and the page falls back to a periodic refresh rather than freezing. If several candidates are level we show them level.',
      },
      {
        icon: 'clock',
        title: 'When results appear',
        body: 'A campaign that hides its results shows no totals until it ends, even to you. An ended campaign keeps showing its final standings. Upcoming campaigns cannot be voted on at all.',
      },
      {
        icon: 'shield',
        title: 'One vote, honestly',
        body: 'Voting is limited by each campaign\'s own rules — by default one vote per account per campaign. Votes are recorded atomically and totals are computed on the server, so nobody can inflate a count by spamming the button. Votes must be your genuine choice; duplicate accounts to vote twice is not something we support or tolerate.',
      },
      {
        icon: 'file',
        title: 'Try the sample campaign',
        body: 'The Campaigns tab ships with one campaign labelled "SAMPLE - How voting works". It is there so you can see the whole thing working before anything real happens, and its description says so plainly. Every vote on it is a real vote cast by a real account — we have not invented a turnout.',
      },
      {
        icon: 'star',
        title: 'One review per service, once',
        body: 'Each of the five service categories is rated separately and never merged into one number. All five are one-time: your first answer is recorded and locked, and the server refuses any different second answer for the same service. If your view changes, that is what the free-text comment and the reviews inbox are for — not editing the number.',
      },
      {
        icon: 'flag',
        title: 'If a result looks wrong',
        body: 'Tell us through Reviews and we will check the vote records against your account. Corrections are recorded rather than quietly rewritten, so a total never changes without a trace. We do not publish a Report button on a campaign because we do not yet have one — we would rather say that than send you looking for something that is not there.',
      },
    ],
  },
  {
    key: 'marketplace',
    title: 'The Marketplace',
    blurb: 'Browse study resources and buy what PolyNurse sells.',
    icon: 'store',
    route: '/marketplace',
    steps: [
      {
        icon: 'store',
        title: 'Open the Marketplace',
        body: 'Marketplace is in the sidebar. It is a real storefront: categories across the top, search, and sorting by newest or price.',
      },
      {
        icon: 'book',
        title: 'Browse categories',
        body: 'Categories include books, study materials, question packs, revision guides, clinical resources and exam preparation. Tap one to narrow the list, or search by name.',
      },
      {
        icon: 'file',
        title: 'Open a listing',
        body: 'Tapping a product opens its details: description, who is selling it, whether it is free, premium-only or a one-time purchase, and the real price in Naira.',
      },
      {
        icon: 'shield',
        title: 'Who is selling this?',
        body: 'This is the most important thing to check. Items marked "Sold by PolyNurse" are ours and you can buy them here. Anything labelled "Informational" is a third-party listing: we show it for information, we do not sell it, and we cannot take payment for it — the server refuses those purchases even if someone crafts the request by hand.',
      },
      {
        icon: 'coins',
        title: 'Price and what you are agreeing to',
        body: 'For a one-time PolyNurse item the sheet shows the exact total payable in Naira before you pay, and states it is a one-time purchase with no auto-renewal. We do not show struck-through prices or discounts that are not real.',
      },
      {
        icon: 'credit',
        title: 'Paying',
        body: 'Buying sends you to Paystack for a secure payment. Free items and premium-entitlement items are handled in place without a payment. We only ever tell you a purchase succeeded once the payment provider has confirmed it to our server.',
      },
      {
        icon: 'check',
        title: 'After you pay',
        body: 'Your new purchase appears under "My purchases" straight away, where you can open it. Access follows the product\'s own access type — a download link, or an entitlement that opens inside your account.',
      },
      {
        icon: 'history',
        title: 'Your history and support',
        body: '"My purchases" lists everything you own right now, which is also where you re-open something you have already bought. If a purchase looks wrong, contact us and we will check the payment record against your account.',
      },
    ],
  },
];

export const TUTORIAL_KEYS = TUTORIALS.map((t) => t.key);

export const tutorialByKey = (key) => TUTORIALS.find((t) => t.key === key) || null;

// ---------------------------------------------------------------------------
// Progress + first-use-tip dismissal. Plain localStorage, matching the app's
// existing convention (apex:pushOptInDismissed, apex:quizTapHintSeen,
// apex:anon_muted_aliases) rather than a new profile table. The push
// notification_preferences table is for push channels and is deliberately not
// reused for this.
// ---------------------------------------------------------------------------
const DONE_KEY = 'apex:tutorials:v1';
const tipKey = (key) => `apex:tip:${key}`;

const readJson = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
};

const writeJson = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / storage disabled — the tour still works for this session */
  }
};

export const readTutorialProgress = () => {
  const stored = readJson(DONE_KEY, {});
  const out = {};
  for (const k of TUTORIAL_KEYS) out[k] = !!stored[k];
  return out;
};

export const markTutorialDone = (key) => {
  const stored = readJson(DONE_KEY, {});
  stored[key] = true;
  writeJson(DONE_KEY, stored);
};

export const resetTutorialProgress = () => {
  try {
    localStorage.removeItem(DONE_KEY);
  } catch {
    /* ignore */
  }
};

export const readTipDismissed = (key) => {
  try {
    return localStorage.getItem(tipKey(key)) === '1';
  } catch {
    return false;
  }
};

export const dismissTip = (key) => {
  try {
    localStorage.setItem(tipKey(key), '1');
  } catch {
    /* ignore */
  }
};