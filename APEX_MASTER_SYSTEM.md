# Apex Scholars Master Prompt System
## Operational Blueprint & Architectural Intellectual Property

This document serves as the master specification for the **Apex Scholars** platform ("Rise to Excellence"). It codifies the marketing logic, technical architecture, and operational rules required to maintain, scale, or rebuild the system.

---

### 1. Branding & Marketing Engine
**Tagline:** Rise to Excellence
**Mission:** Transitioning students from "Doubt to Distinction" through clinical mastery.

#### A. Pricing & Urgency Logic
- **Current Subscription:** ₦1,999.90 / week (Institutional rate).
- **Strike-through Price:** ₦3,000.00.
- **Urgency Mechanism:** Randomly generated slots remaining (e.g., "Only 12 slots remaining at this price").
- **Access Window:** 7-day rolling access per activation.

#### B. Visual Identity (Conversion-First Design)
- **2D Sales Hero:** High-impact typography focusing on outcomes ("Pass Your Nursing Exams").
- **Visual Hierarchy:** Benefit-driven cards (Structured Curriculum, Practice Exams) with clear CTA buttons.
- **Performance:** 2D landing ensures instant TTI (Time to Interactive) across all devices, while retaining 3D elements for internal dashboard interactions where appropriate.

---

### 2. Product Key Architecture (Licensing)
The platform uses a "Key-First" access model.

- **Key Format:** 17-character alphanumeric (e.g., `APEX-XXXX-XXXX-XXXX`).
- **Generation:** Server-side only via Vercel Functions using cryptographic randomness.
- **Storage:** Keys are hashed before storage in Supabase `product_keys` table.
- **Verification Logic:**
  1. User enters key in `/activate`.
  2. Frontend calls `/api/license/activate`.
  3. Backend checks hash, status (`unused`), and expiry.
  4. Upon success, user profile `is_activated` is set to `true`.

---

### 3. Backend & Integration Logic

#### A. Supabase Schema
- **Profiles:** Extended user data including `matric_number`, `level`, `is_activated`, and `role` (student/admin).
- **Flashcard Progress:** Relational mapping of user IDs to card IDs using the SM-2 SRS algorithm data.
- **Transactions:** Audit log of all Paystack references, amounts, and metadata.

#### B. Paystack Payment Flow
1. **Initialize:** Client sends intent → Server calls Paystack API with secret key → Returns access code.
2. **Payment:** Handled via Paystack Inline or Redirect.
3. **Webhook Verification:**
   - Verify `x-paystack-signature`.
   - On `charge.success`, generate product key and update user ledger.
   - Record transaction in Supabase.

---

### 4. Papers AI Module (Local Intelligence)
Apex Scholars prioritizes local, cost-effective AI over external API calls.

- **Extraction Engine:**
  - **PDF:** `pdfjs-dist` for text layer extraction.
  - **Images:** `tesseract.js` for OCR.
  - **DOCX:** `mammoth` for document structure parsing.
- **Card Generation:** A rule-based regex parser identifies patterns (e.g., "Q:", "A:", or numbered lists) to convert raw text into flashcards without hitting LLM tokens.

---

### 5. Admin Dashboard System
Accessible only to users with `role IN ('admin', 'super_admin')`.

- **Institutional Ledger:** Real-time visualization of school fees, payment percentages, and transaction success rates.
- **User Management:** Ability to manually override activation statuses and view student study streaks.
- **Audit Trails:** Every financial action creates an immutable log in the `audit_logs` table.

---

### 6. Mobile-First UX Rules
1. **Viewport Stability:** Use `-webkit-fill-available` for height to prevent address bar jumps.
2. **Touch Safety:** Swipe-based flashcards must disable `touch-action: none` on the container to prevent accidental page scrolling.
3. **Code Splitting:** Heavy libraries (Three.js, Tesseract) MUST be lazy-loaded to ensure initial TTI (Time to Interactive) < 3.5s on 4G networks.
4. **Input Optimization:** Use `AutocompleteInput` for curriculum fields to reduce mobile typing friction.

---

### 7. Deployment & Error Prevention
- **Environment Parity:** `.env.example` must match Vercel production variables exactly.
- **Defensive Rendering:** `AppContext` must provide a "Demo Mode" fallback if Supabase keys are missing, allowing the app to run (with limited features) for review.
- **Build Optimization:** `vite.config.js` uses manual chunking to keep the main bundle under 500KB.
- **Repository Sanitization:** Before final build, remove all `temp/`, `.env` backups, and local log files.

---
*Apex Scholars: Master Document v1.0 • Confirmed for Production Build*
