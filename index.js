import express from 'express';
import { getCraftwaveData, checkFeeds } from './scraper.js';

const app  = express();
const PORT = process.env.PORT || 3000;

// Render が自動で入れるコミット ID を返す（どのバージョンが動いているか確認用）
app.get('/health', (_, res) =>
  res.send('ok 🚀 ' + (process.env.RENDER_GIT_COMMIT || 'local').slice(0, 7))
);

app.get('/api/craftwave', async (req, res) => {
  try {
    // ?days=1 などで集める期間を変えられる（指定なしは7日）
    const data = await getCraftwaveData({ days: req.query.days });
    res.json(data);
  } catch (e) {
    console.error('[api error]', e);
    res.status(500).json({ error: e.message });
  }
});

// ブルワリー公式フィードの動作確認用（LINE配信とは無関係）
app.get('/api/feeds-check', async (_, res) => {
  try {
    res.json(await checkFeeds());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log('server on', PORT));