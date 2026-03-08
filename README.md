# NursingHub: Flashcard Learning System for Nursing & Midwifery

NursingHub is a comprehensive, mobile-responsive React application designed to help nursing and midwifery students excel in their clinical and theoretical studies. It features a robust curriculum-based flashcard system, an exam scheduler, professional prep tools (NCLEX/NMCN), and a clinical pronunciation helper.

## 🚀 Key Features

- **Academic Curriculum**: 300+ preloaded cards covering Year 1-3 for General Nursing and Midwifery tracks.
- **Smart Study (SRS)**: Implements the SM-2 Spaced Repetition Algorithm for optimized long-term retention.
- **Exam Timetable**: Track clinical assessments with countdowns, color-coded alerts, and PDF export.
- **Pronunciation Helper**: Searchable index of 400+ difficult medical terms with syllable breakdowns and Text-to-Speech (TTS).
- **Professional Prep**: Dedicated modules for NCLEX-RN and NMCN Council exams.
- **Community Portal**: Shared study feed with image support (backed by Supabase).
- **Modern UI**: Soft medical-themed design with dark/light mode and mobile-first navigation.

## 🛠️ Tech Stack

- **Frontend**: React (Hooks, Context API), React Router 7
- **Styling**: Tailwind CSS 4, Framer Motion
- **Icons**: Lucide React
- **Persistence**: LocalStorage + Supabase (for community features)
- **Utilities**: SM-2 Algorithm, Web Speech API, jsPDF (Export)

## 📦 Getting Started

### Prerequisites
- Node.js (v18+)
- NPM or Bun

### Installation
1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd nursinghub
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file in the root and add your Supabase credentials (optional for community features):
   ```env
   VITE_SUPABASE_URL=your_project_url
   VITE_SUPABASE_ANON_KEY=your_anon_key
   ```
4. Start the development server:
   ```bash
   npm run dev
   ```

## ☁️ Deployment

This project is optimized for deployment on **Vercel**.

1. Connect your repository to Vercel.
2. Add the environment variables from your `.env` file in the Vercel dashboard.
3. The `vercel.json` ensures SPA routing works correctly.

For detailed Supabase setup (database schemas and storage policies), refer to [SUPABASE_VERCEL_GUIDE.md](./SUPABASE_VERCEL_GUIDE.md).

## 📂 Project Structure

```text
src/
├── components/     # Reusable UI components
├── context/        # Global state management
├── data/           # Academic curriculum (JSON)
├── pages/          # Main route views
├── utils/          # SM-2 algorithm, AI helpers, PDF export
└── App.jsx         # App entry and routing
```

## 🩺 Academic Coverage
The system includes flashcards for courses such as:
- Anatomy & Physiology
- Pharmacology & Therapeutics
- Medical-Surgical Nursing
- Normal Labor and Birth (Midwifery)
- Clinical Procedures (Oxygen therapy, Catheterization, etc.)

---
*Built for the next generation of healthcare professionals.*
