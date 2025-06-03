import express from 'express';
const app  = express();
const PORT = process.env.PORT || 3000;   // ← ここポイント

app.get('/health', (_, res) => res.send('ok 🚀'));
app.get('/api/craftwave', (_, res) => res.json([{ title: 'dummy', url: 'https://example.com' }]));

app.listen(PORT, () => console.log('server on', PORT));
