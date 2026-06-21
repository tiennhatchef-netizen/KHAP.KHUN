const express = require('express');
const path = require('path');
const app = express();
const port = process.env.PORT || 3000;

// Serve static files from /public
app.use(express.static(path.join(__dirname, 'public')));

// Health check
app.get('/api/health', (req, res) => res.send('OK'));

// BEGIN ENV CHECK - temporary endpoint to verify environment variables (non-sensitive)
app.get('/api/env-check', (req, res) => {
  res.json({
    NODE_ENV: process.env.NODE_ENV || null,
    TEST_ENV: process.env.TEST_ENV || null
  });
});
// END ENV CHECK

// Fallback to index.html for SPA routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
