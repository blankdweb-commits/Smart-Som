import * as pdfjs from 'pdfjs-dist';
import mammoth from 'mammoth';
import Tesseract from 'tesseract.js';

// Set up PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;

export const extractTextFromFile = async (file) => {
  const fileType = file.type;

  if (fileType === 'application/pdf') {
    return await extractTextFromPDF(file);
  } else if (fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return await extractTextFromDOCX(file);
  } else if (fileType === 'text/plain') {
    return await file.text();
  } else if (fileType.startsWith('image/')) {
    return await extractTextFromImage(file);
  } else {
    throw new Error('Unsupported file type');
  }
};

const extractTextFromPDF = async (file) => {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  let fullText = '';

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map(item => item.str).join(' ');
    fullText += pageText + '\n';
  }

  return fullText;
};

const extractTextFromDOCX = async (file) => {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
};

const extractTextFromImage = async (file) => {
  const result = await Tesseract.recognize(file, 'eng');
  return result.data.text;
};

export const parseQuestionsAndAnswers = (text) => {
  // Simple rule-based parser
  // Patterns to look for:
  // 1. Question followed by "Answer: ..."
  // 2. Numbered questions like "1. What is..." followed by "Ans: ..."
  // 3. Question followed by multiple choice and then an answer indicator

  const cards = [];

  // Normalize text: remove multiple spaces, etc.
  const lines = text.split(/\n+/).map(line => line.trim()).filter(line => line.length > 0);

  let currentQuestion = '';
  let currentAnswer = '';

  const qRegex = /^(\d+[\.\)]\s*|Q:\s*|Question:\s*)/i;
  const aRegex = /^(Ans:|Answer:|A:)\s*/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (qRegex.test(line)) {
      // If we already have a question and found a new one, save the previous one if it has an answer
      if (currentQuestion && currentAnswer) {
        cards.push({
          question: currentQuestion,
          answer: currentAnswer,
          difficulty: 'Moderate'
        });
        currentAnswer = '';
      }
      currentQuestion = line.replace(qRegex, '').trim();
    } else if (aRegex.test(line)) {
      currentAnswer = line.replace(aRegex, '').trim();
    } else if (currentQuestion && !currentAnswer) {
      // Append to question if it's not a new question or answer
      currentQuestion += ' ' + line;
    } else if (currentQuestion && currentAnswer) {
      // Append to answer
      currentAnswer += ' ' + line;
    }
  }

  // Push the last one
  if (currentQuestion && currentAnswer) {
    cards.push({
      question: currentQuestion,
      answer: currentAnswer,
      difficulty: 'Moderate'
    });
  }

  // If no cards found with explicit Ans: labels, try a more aggressive split
  if (cards.length === 0) {
     // Try splitting by common question starters
     const splitPattern = /\n(?=\d+[\.\)])/;
     const sections = text.split(splitPattern);

     sections.forEach(section => {
       const lines = section.split('\n').filter(l => l.trim());
       if (lines.length >= 2) {
         cards.push({
           question: lines[0].replace(/^\d+[\.\)]\s*/, '').trim(),
           answer: lines.slice(1).join(' ').trim(),
           difficulty: 'Moderate'
         });
       }
     });
  }

  return cards;
};
