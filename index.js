import express from 'express';
import { getCraftwaveData } from './scraper.js';

const app  = express();
const PORT = process.env.PORT || 3000;

app.get('/health', (_, res) => res.send('ok 🚀'));

app.get('/api/craftwave', async (_, res) => {
  try {
    const data = await getCraftwaveData();
    res.json(data);
  } catch (e) {
    console.error('[api error]', e);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log('server on', PORT));