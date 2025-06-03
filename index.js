import express from 'express';
import fetch from 'node-fetch';

const app  = express();
const PORT = process.env.PORT || 3000;

/* ─────────────  ヘルスチェック  ───────────── */
app.get('/health', (_, res) => res.send('ok 🚀'));

/* ─────────────  メインAPI  ───────────── */
/* いったんダミーの配列返す。あとで本物のスクレイプ結果に差し替えればOK */
app.get('/api/craftwave', (_, res) => {
  const sample = [
    { title: 'クラフトビール新作リリース', url: 'https://example.com/post/123' },
    { title: '今週末開催：ビアフェス渋谷',    url: 'https://example.com/post/456' }
  ];
  res.json(sample);
});

/* ─────────────  サーバー起動  ───────────── */
app.listen(PORT, () => console.log(`server on ${PORT}`));
