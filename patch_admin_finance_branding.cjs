const fs = require('fs');
const content = fs.readFileSync('src/pages/AdminFinance.jsx', 'utf8');

let updated = content.replace('Bursary Control', 'Apex Command Center');
updated = updated.replace('Institutional Treasury & Student Ledger Management.', 'Institutional Intelligence & Question Management.');

// Also check for any other "Bursary" or "Ledger" specific headers that might need softening
updated = updated.replace('Revenue Today', 'Active Learners');
updated = updated.replace('NGN 30,000', '1,240'); // Mocking active learners instead of revenue for general admin feel

fs.writeFileSync('src/pages/AdminFinance.jsx', updated);
