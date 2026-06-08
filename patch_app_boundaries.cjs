const fs = require('fs');
const path = 'src/App.jsx';
let content = fs.readFileSync(path, 'utf8');

const search = `<Route path="/dashboard" element={<Dashboard />} />
        <Route path="/activate" element={<Activate />} />
        <Route path="/flashcards" element={<Flashcards />} />
        <Route path="/quiz" element={<Quiz />} />`;

const replace = `<Route path="/dashboard" element={<ErrorBoundary><Dashboard /></ErrorBoundary>} />
        <Route path="/activate" element={<ErrorBoundary><Activate /></ErrorBoundary>} />
        <Route path="/flashcards" element={<ErrorBoundary><Flashcards /></ErrorBoundary>} />
        <Route path="/quiz" element={<ErrorBoundary><Quiz /></ErrorBoundary>} />`;

if (content.includes(search)) {
    content = content.replace(search, replace);
    fs.writeFileSync(path, content);
    console.log('Added ErrorBoundaries to core routes in App.jsx');
} else {
    console.log('App.jsx search string not found');
}
