/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        blue: {
          50: '#f6eef6',
          100: '#e9d4e9',
          200: '#d4a8d4',
          300: '#bf7dbf',
          400: '#a84ea8',
          500: '#8f1a8f',
          600: '#800080', // Polynurse Purple (brand)
          700: '#6b006b',
          800: '#580058',
          900: '#420042',
        },
        polynurse: {
          50: '#f6eef6',
          100: '#e9d4e9',
          200: '#d4a8d4',
          300: '#bf7dbf',
          400: '#a84ea8',
          500: '#8f1a8f',
          600: '#800080', // Polynurse Purple (brand)
          700: '#6b006b',
          800: '#580058',
          900: '#420042',
        },
        // Legacy brand alias (the Apex Scholars purple). GroupPage/StudyGroups
        // and the rest of the app still reference apex-* classes; without this
        // palette Tailwind generated NO css for them, so `bg-apex-600 text-white`
        // buttons rendered as transparent backgrounds with invisible white labels.
        apex: {
          50: '#f6eef6',
          100: '#e9d4e9',
          200: '#d4a8d4',
          300: '#bf7dbf',
          400: '#a84ea8',
          500: '#8f1a8f',
          600: '#800080', // Polynurse Purple (brand)
          700: '#6b006b',
          800: '#580058',
          900: '#420042',
        },
        gold: {
          50: '#fffbeb',
          100: '#fef3c7',
          200: '#fde68a',
          300: '#fcd34d',
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
          700: '#b45309',
          800: '#92400e',
          900: '#78350f',
        },
        medical: {
          50: '#faf5ff',
          100: '#f3e8ff',
          200: '#e9d5ff',
          300: '#d8b4fe',
          400: '#c084fc',
          500: '#a855f7',
          600: '#9333ea',
          700: '#7e22ce',
          800: '#6b21a8',
          900: '#581c87',
        },
        teal: {
          50: '#f0fdfa',
          100: '#ccfbf1',
          200: '#99f6e4',
          300: '#5eead4',
          400: '#2dd4bf',
          500: '#14b8a6',
          600: '#0d9488',
          700: '#0f766e',
          800: '#115e59',
          900: '#134e4a',
        },
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      boxShadow: {
        'soft': '0 4px 20px -2px rgba(0, 0, 0, 0.05)',
        '3d-glass': '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
        'polynurse-glow': '0 0 20px rgba(128, 0, 128, 0.3)',
      }
    },
  },
  plugins: [],
}
