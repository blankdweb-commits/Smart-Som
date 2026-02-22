import { medicalTerms as expandedTerms } from './medicalTerms';

export const initialFlashcards = [
  {
    id: '1',
    subject: 'Anatomy',
    topic: 'Skeletal System',
    question: 'How many bones are in the adult human body?',
    answer: '206 bones',
    hint: 'Think of the skeleton after infancy.',
    difficulty: 'Easy',
    important: false,
    srs: { interval: 0, reps: 0, efactor: 2.5, nextReview: new Date().toISOString() }
  },
  {
    id: '2',
    subject: 'Pharmacology',
    topic: 'Dosage Calculation',
    question: 'What is the formula for calculating IV drip rate (gtt/min)?',
    answer: '(Volume in mL × Drop Factor) / Time in minutes',
    hint: 'It involves volume, drop factor, and time.',
    difficulty: 'Moderate',
    important: true,
    srs: { interval: 0, reps: 0, efactor: 2.5, nextReview: new Date().toISOString() }
  },
  {
    id: '3',
    subject: 'Medical-Surgical Nursing',
    topic: 'Diabetes',
    question: 'What are the three "Ps" of Diabetes Mellitus?',
    answer: 'Polyuria, Polydipsia, and Polyphagia',
    hint: 'Frequent urination, thirst, and hunger.',
    difficulty: 'Easy',
    important: true,
    srs: { interval: 0, reps: 0, efactor: 2.5, nextReview: new Date().toISOString() }
  },
  {
    id: '4',
    subject: 'Midwifery',
    topic: 'Labor Stages',
    question: 'What defines the second stage of labor?',
    answer: 'From full cervical dilation (10cm) until the delivery of the baby.',
    hint: 'This is the "pushing" stage.',
    difficulty: 'Moderate',
    important: false,
    srs: { interval: 0, reps: 0, efactor: 2.5, nextReview: new Date().toISOString() }
  }
];

export const medicalTerms = expandedTerms;
