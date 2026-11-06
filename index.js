import express from 'express';
import { getCraftwaveData } from './scraper.js';

const app  = express();
const PORT = process.env.PORT || 3000;

// Render が自動で入れるコミット ID を返す（どのバージョンが動いているか確認用）
app.get('/health', (_, res) =>
  res.send('ok 🚀 ' + (process.env.RENDER_GIT_COMMIT || 'local').slice(0, 7))
);

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