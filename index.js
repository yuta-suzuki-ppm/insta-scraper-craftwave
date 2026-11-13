import express from 'express';
import { getCraftwaveData, checkFeeds } from './scraper.js';

const app  = express();
const PORT = process.env.PORT || 3000;

// Render が自動で入れるコミット ID を返す（どのバージョンが動いているか確認用）
app.get('/health', (_, res) =>
  res.send('ok 🚀 ' + (process.env.RENDER_GIT_COMMIT || 'local').slice(0, 7))
);

app.use(express.json({ limit: '200kb' }));

// GET : ?days=1 などで集める期間を変えられる（指定なしは7日）、?debug=1 で点数の内訳つき
// POST: 本文に { sent: [{ title, url }] } を入れると、配信済みと同じ話題を外す（GAS の配信用）
const craftwave = async (req, res) => {
  try {
    const q = { ...req.query, ...(req.body || {}) };
    const data = await getCraftwaveData({
      days: q.days,
      debug: q.debug === '1' || q.debug === true,
      sent: Array.isArray(q.sent) ? q.sent : []
    });
    res.json(data);
  } catch (e) {
    console.error('[api error]', e);
    res.status(500).json({ error: e.message });
  }
};
app.get('/api/craftwave', craftwave);
app.post('/api/craftwave', craftwave);

// ブルワリー公式フィードの動作確認用（LINE配信とは無関係）
app.get('/api/feeds-check', async (_, res) => {
  try {
    res.json(await checkFeeds());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log('server on', PORT));