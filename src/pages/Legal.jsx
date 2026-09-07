import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';

const EFFECTIVE_DATE = '5 September 2026';
const APP_NAME = 'Apex Scholars (Polynurse Exam Center)';
const Shell = ({ title, children }) => (
  <div className="min-h-screen bg-slate-950 p-4 sm:p-8">
    <div className="max-w-3xl mx-auto">
      <Link
        to="/dashboard"
        className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors mb-6"
      >
        ← Back to App
      </Link>

      <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 sm:p-10 border border-slate-100 dark:border-slate-700 shadow-xl space-y-8">
        <header>
          <div className="flex items-center gap-2 mb-3 text-medical-600">
            <ShieldCheck size={20} />
            <span className="text-[10px] font-black uppercase tracking-[0.3em]">Legal</span>
          </div>
          <h1 className="text-3xl font-black text-slate-900 dark:text-white">{title}</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1 font-medium">
            Effective {EFFECTIVE_DATE}
          </p>
        </header>

        <div className="legal-content">
          {children}
        </div>

        <div className="border-t border-slate-100 dark:border-slate-700 pt-6">
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors"
          >
            ← Back to App
          </Link>
        </div>
      </div>
    </div>
  </div>
);

// Route wrapper — maps the `section` route param to the corresponding policy.
const LegalPage = ({ section = 'terms' }) => {
  if (section === 'privacy') return <LegalPrivacy />;
  if (section === 'cookies') return <LegalCookies />;
  return <LegalTerms />;
};

export default LegalPage;

// ─────────────────────────────────────────────────────────────────────
// TERMS OF SERVICE
// ─────────────────────────────────────────────────────────────────────
export const LegalTerms = () => (
  <Shell title="Terms of Service">
    <h2>1. Acceptance of Terms</h2>
    <p>
      By creating an account or using {APP_NAME} ("the Platform"), you agree to be bound by these Terms
      of Service. If you do not agree, please do not use the Platform.
    </p>

    <h2>2. Who We Are</h2>
    <p>
      {APP_NAME} is an educational quiz and study platform built for nursing and midwifery students.
      It provides practice questions, study tools, progress tracking, and competitive features to
      support exam preparation.
    </p>

    <h2>3. Accounts</h2>
    <p>You are responsible for:</p>
    <ul>
      <li>Keeping your login credentials confidential.</li>
      <li>All activity that occurs under your account.</li>
      <li>Providing accurate registration information (name, email, nursing year).</li>
    </ul>
    <p>
      You must be at least 16 years old to create an account. One account per person; multiple
      accounts may be suspended.
    </p>

    <h2>4. Platform Content &amp; Intellectual Property</h2>
    <p>
      All question banks, flashcards, study materials, software, and branding are the intellectual
      property of Apex Scholars. You may not:
    </p>
    <ul>
      <li>Copy, redistribute, or republish questions, explanations, or flashcard content.</li>
      <li>Scrape, automate extraction of, or reverse-engineer the question database.</li>
      <li>Share your account credentials to give others access to premium content.</li>
    </ul>
    <p>
      You are granted a limited, non-transferable, revocable licence to use the Platform for
      personal, non-commercial study purposes.
    </p>

    <h2>5. Smart Coins &amp; Payments</h2>
    <p>
      Smart Coins (SC) are an in-platform virtual currency earned by studying. They have no cash
      value and cannot be transferred between users or redeemed for money.
    </p>
    <p>
      Premium subscriptions unlock additional features (longer quizzes, higher difficulty tiers,
      full-length NCLEX/NMCN modes). Payments are processed through third-party payment
      providers; Apex Scholars does not store card details.
    </p>

    <h2>6. Competitive Features (XP Hall / Community)</h2>
    <p>
      When you participate in duels, community posts, or study groups, your chosen <strong>identity
      name</strong> (not your real name) is visible to other users. You are solely responsible for the
      content you post. Harassment, cheating, or abusive behaviour will result in account
      suspension.
    </p>

    <h2>7. Availability &amp; Limitations</h2>
    <p>
      The Platform is provided "as is" and "as available." We do not guarantee uninterrupted
      availability. Scheduled maintenance and occasional downtime may occur. Question content is
      periodically updated and may change without notice.
    </p>

    <h2>8. Limitation of Liability</h2>
    <p>
      To the maximum extent permitted by law, Apex Scholars shall not be liable for any indirect,
      incidental, or consequential damages arising from your use of the Platform. Our total
      liability shall not exceed the amount you paid for premium access in the 12 months preceding
      the claim.
    </p>

    <h2>9. Termination</h2>
    <p>
      We may suspend or terminate your account at any time for violation of these Terms. You may
      delete your account at any time from the Settings page or by contacting us.
    </p>

    <h2>10. Governing Law</h2>
    <p>
      These Terms are governed by the laws of the Federal Republic of Nigeria. Disputes shall be
      subject to the exclusive jurisdiction of Nigerian courts.
    </p>

    <h2>11. Changes to These Terms</h2>
    <p>
      We may update these Terms from time to time. Continued use of the Platform after changes
      constitutes acceptance of the revised Terms. The "Effective" date at the top will be updated
      accordingly.
    </p>

    <h2>Contact</h2>
    <p>
      Questions about these Terms? Reach us through the Community page or via the contact details
      provided on the Platform.
    </p>
  </Shell>
);

// ─────────────────────────────────────────────────────────────────────
// PRIVACY POLICY
// ─────────────────────────────────────────────────────────────────────
export const LegalPrivacy = () => (
  <Shell title="Privacy Policy">
    <h2>1. What This Policy Covers</h2>
    <p>
      This Privacy Policy explains how {APP_NAME} ("the Platform") collects, uses, stores, and
      protects your personal information. By using the Platform you agree to this policy.
    </p>

    <h2>2. Data We Collect</h2>
    <h3>Information you provide</h3>
    <ul>
      <li><strong>Account details:</strong> full name, email address, phone number (optional), nursing
        year, department.</li>
      <li><strong>Identity name:</strong> the public display name you choose for yourself (defaults
        to "Scholar").</li>
      <li><strong>Profile inputs:</strong> matriculation number, subscription payments.</li>
    </ul>

    <h3>Data generated by your use</h3>
    <ul>
      <li><strong>Learning data:</strong> quiz scores, accuracy, question history, difficulty
        progress, study streaks, identity tier, Smart Coin balance.</li>
      <li><strong>Activity data:</strong> last active date, course quota usage, daily challenge
        completion, achievement unlocks.</li>
      <li><strong>Community data:</strong> posts, comments, and reactions you submit (visible to
        other users under your identity name).</li>
      <li><strong>Device data:</strong> a stable device identifier stored locally in your browser
        (see Cookie Policy) used to enforce session security.</li>
    </ul>

    <h2>3. How We Use Your Data</h2>
    <p>We use your data to:</p>
    <ul>
      <li>Provide, personalise, and improve the Platform.</li>
      <li>Track your learning progress, streaks, and competitive rankings.</li>
      <li>Operate premium subscriptions and enforce free-tier quotas.</li>
      <li>Display your identity name (not your real name) to other users in community and
        competitive features.</li>
      <li>Detect and prevent abuse, cheating, and unauthorised access.</li>
      <li>Send essential service notifications (password resets, quota resets).</li>
    </ul>

    <h2>4. Data Sharing</h2>
    <p>Your data is shared only in the following circumstances:</p>
    <ul>
      <li><strong>Other users:</strong> your <em>identity name</em> (and learning stats relevant to
        duels/rankings) are visible. Your real name, email, and phone number are <strong>never</strong>
        shown to other users.</li>
      <li><strong>Admins:</strong> authorised administrators can view full profile details (name,
        email) for account management and support purposes.</li>
      <li><strong>Infrastructure providers:</strong> data is hosted on Supabase (database) and
        Vercel (serverless API). These providers process data on our behalf under strict security
        standards.</li>
      <li><strong>Legal requirements:</strong> we may disclose data if required by law or valid
        legal process.</li>
    </ul>
    <p>We never sell your personal data to advertisers or third parties.</p>

    <h2>5. Data Retention</h2>
    <p>
      Your account and associated data are retained while your account remains active. If you
      delete your account, your personal data and learning history are permanently removed from
      our database within 30 days. Anonymised, non-identifiable analytics may be retained
      indefinitely.
    </p>

    <h2>6. Data Security</h2>
    <p>
      We use industry-standard security measures including encrypted data in transit (TLS),
      encrypted data at rest, role-based access controls, and row-level security policies on our
      database. However, no online system is completely secure; we encourage you to use a strong,
      unique password.
    </p>

    <h2>7. Your Rights</h2>
    <p>You have the right to:</p>
    <ul>
      <li><strong>Access</strong> a copy of the personal data we hold about you.</li>
      <li><strong>Correct</strong> inaccurate data via the Settings page.</li>
      <li><strong>Delete</strong> your account and all associated data (Settings → Sign Out, then
        contact us to request deletion).</li>
      <li><strong>Export</strong> your learning data (contact us to request).</li>
      <li><strong>Withdraw consent</strong> by deleting your account at any time.</li>
    </ul>

    <h2>8. Children's Privacy</h2>
    <p>
      The Platform is intended for users aged 16 and above. We do not knowingly collect data from
      children under 16.
    </p>

    <h2>9. Changes to This Policy</h2>
    <p>
      We may update this Privacy Policy from time to time. The "Effective" date at the top will
      reflect the latest revision. Significant changes will be communicated through the Platform.
    </p>

    <h2>Contact</h2>
    <p>
      For privacy-related questions or to exercise your rights, contact us via the Community
      page or the details provided on the Platform.
    </p>
  </Shell>
);

// ─────────────────────────────────────────────────────────────────────
// COOKIE & LOCAL STORAGE POLICY
// ─────────────────────────────────────────────────────────────────────
export const LegalCookies = () => (
  <Shell title="Cookie &amp; Local Storage Policy">
    <h2>1. How We Store Data Locally</h2>
    <p>
      {APP_NAME} does <strong>not</strong> use traditional HTTP cookies. Instead, it stores data
      directly in your browser using <strong>localStorage</strong> and the Supabase client library.
      This page explains what is stored, why, and how you can manage it.
    </p>

    <h2>2. Local Storage Items We Use</h2>

    <div className="overflow-x-auto -mx-6 px-6">
      <table className="min-w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-slate-200 dark:border-slate-700 text-left text-slate-500 dark:text-slate-400">
            <th className="py-2 pr-4 font-semibold">Key</th>
            <th className="py-2 pr-4 font-semibold">Purpose</th>
            <th className="py-2 font-semibold">Required</th>
          </tr>
        </thead>
        <tbody className="text-slate-700 dark:text-slate-300">
          <tr className="border-b border-slate-100 dark:border-slate-800">
            <td className="py-2 pr-4 font-mono text-xs">apex_device_session_id</td>
            <td className="py-2 pr-4">Stable device identifier used to enforce session security and prevent unauthorised multi-device access.</td>
            <td className="py-2">Yes</td>
          </tr>
          <tr className="border-b border-slate-100 dark:border-slate-800">
            <td className="py-2 pr-4 font-mono text-xs">sb-*_auth_token</td>
            <td className="py-2 pr-4">Supabase authentication session (managed automatically by the Supabase client). Keeps you signed in.</td>
            <td className="py-2">Yes</td>
          </tr>
          <tr className="border-b border-slate-100 dark:border-slate-800">
            <td className="py-2 pr-4 font-mono text-xs">darkMode</td>
            <td className="py-2 pr-4">Remembers your light/dark theme preference.</td>
            <td className="py-2">Functional</td>
          </tr>
          <tr className="border-b border-slate-100 dark:border-slate-800">
            <td className="py-2 pr-4 font-mono text-xs">soundEnabled</td>
            <td className="py-2 pr-4">Remembers your quiz sound preference (on/off).</td>
            <td className="py-2">Functional</td>
          </tr>
          <tr className="border-b border-slate-100 dark:border-slate-800">
            <td className="py-2 pr-4 font-mono text-xs">apex:notifDismissed</td>
            <td className="py-2 pr-4">Tracks which in-app notifications you have dismissed.</td>
            <td className="py-2">Functional</td>
          </tr>
          <tr className="border-b border-slate-100 dark:border-slate-800">
            <td className="py-2 pr-4 font-mono text-xs">apex:quizTapHintSeen</td>
            <td className="py-2 pr-4">Dismisses the first-time quiz onboarding hint.</td>
            <td className="py-2">Functional</td>
          </tr>
          <tr className="border-b border-slate-100 dark:border-slate-800">
            <td className="py-2 pr-4 font-mono text-xs">apex_unlocked_tiers</td>
            <td className="py-2 pr-4">Records which identity tiers you have already seen, to avoid repeated celebration prompts.</td>
            <td className="py-2">Functional</td>
          </tr>
          <tr className="border-b border-slate-100 dark:border-slate-800">
            <td className="py-2 pr-4 font-mono text-xs">apex_daily_challenge_done_*</td>
            <td className="py-2 pr-4">Marks whether you have completed today's daily challenge (expires daily).</td>
            <td className="py-2">Functional</td>
          </tr>
          <tr>
            <td className="py-2 pr-4 font-mono text-xs">apex_cookie_consent</td>
            <td className="py-2 pr-4">Records your cookie/local-storage consent choice and the date it was made.</td>
            <td className="py-2">Yes</td>
          </tr>
        </tbody>
      </table>
    </div>

    <h2>3. Required vs Functional</h2>
    <p>
      <strong>Required items</strong> are essential for the Platform to function (authentication,
      session security, consent tracking). They cannot be disabled.
    </p>
    <p>
      <strong>Functional items</strong> store preferences and onboarding state. Disabling them
      will not break core functionality but you may see repeated prompts or lose visual
      preferences.
    </p>

    <h2>4. Managing Your Data</h2>
    <p>
      You can clear all local storage at any time through your browser's developer tools
      (Application → Storage → Local Storage → delete items for this site). Note that clearing
      the Supabase auth token will sign you out; clearing <code>apex_device_session_id</code>
      will generate a new device identifier on your next visit.
    </p>

    <h2>5. Third-Party Cookies</h2>
    <p>
      The Platform itself does not set third-party cookies. If a Google Ads integration is
      enabled in the future, it may use cookies governed by
      <a href="https://policies.google.com/technologies/ads" target="_blank" rel="noopener noreferrer">
      Google's Advertising Policy</a>. You will be notified and given the option to opt out at
      that time.
    </p>

    <h2>6. Changes to This Policy</h2>
    <p>
      We may update this policy when new storage items are added. The "Effective" date at the top
      will be updated. You will be asked to re-confirm consent after any material change.
    </p>

    <h2>Contact</h2>
    <p>
      Questions about local storage or cookies? Contact us via the Community page or the details
      provided on the Platform.
    </p>
  </Shell>
);
