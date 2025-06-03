import express from 'express';
const app  = express();
const PORT = process.env.PORT || 3000;

// 軽量ヘルスチェック
app.get('/health', (_, res) => res.send('ok 🚀'));

// ダミー API（後でスクレイパー実装に差し替え）
app.get('/api/craftwave', (_, res) =>
  res.json([{ title: 'Hello Craftwave', url: 'https://example.com' }])
);

app.listen(PORT, () => console.log('server on', PORT));
