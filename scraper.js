// scraper.js 〈情報源拡張・重複判定強化版〉
import { load } from 'cheerio';
import axios from 'axios';

//
// ---------- 1) カテゴリ & キーワード定義 ----------
//   keys: Google ニュースで検索する言葉（スペース区切りは AND 検索）
//   tags: Instagram のハッシュタグ
//
export const categories = {
  event: {
    name: 'イベント',
    keys: [
      'クラフトビール フェス',
      'ビアフェス',
      'ビールフェス',
      'クラフトビール イベント',
      'タップテイクオーバー',
      'tap takeover'
    ],
    tags: ['ビアフェス', 'taptakeover']
  },
  release: {
    name: '新作リリース',
    keys: [
      'クラフトビール 新商品',
      'クラフトビール 発売',
      '限定ビール 発売',
      'ブルワリー コラボ ビール',
      'IPA 発売'
    ],
    tags: ['限定ビール', 'newbeerrelease']
  },
  shop: {
    name: '新店舗',
    keys: [
      'クラフトビール 新店舗',
      'クラフトビール オープン',
      'ビアバー オープン',
      'ブルワリー オープン',
      'ブルーパブ オープン',
      'タップルーム オープン'
    ],
    tags: ['クラフトビールバー', '新店オープン']
  },
  news: {
    name: '業界ニュース',
    keys: [
      'クラフトビール',
      'ブルワリー',
      '醸造所 ビール',
      '地ビール'
    ],
    tags: ['クラフトビールニュース']
  }
};

// 1 カテゴリあたりの最大件数（LINE の配信通数を増やしすぎないため）
const MAX_PER_CATEGORY = 8;

//
// ---------- 2) ドメイン設定 ----------
//   NG_DOMAINS   : 丸ごと除外するサイト
//   REPOST_DOMAINS: 転載サイト（元記事があればそちらを優先、なければ残す）
//
const NG_DOMAINS = [
  'prtimes.jp',
  'news.yahoo.co.jp',
  'food.biglobe.ne.jp'
];

const REPOST_DOMAINS = [
  'yahoo.co.jp',
  'biglobe.ne.jp',
  'livedoor.com',
  'goo.ne.jp',
  'excite.co.jp',
  'infoseek.co.jp',
  'newspicks.com',
  'smartnews.com',
  'msn.com',
  'auone.jp',
  'docomo.ne.jp'
];

// タイトルにこのどれかが入っていない記事は、ビールと関係ないものとして弾く
const BEER_WORDS = /ビール|ビア|ブルワリー|ブルーイング|醸造|ブルーパブ|タップ|IPA|エール|ラガー|スタウト|ピルスナー|beer|brew/i;

const hostOf = (u) => {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; }
};
const matchDomain = (host, list) => list.some(d => host === d || host.endsWith('.' + d));

//
// ---------- 3) Google News RSS で Web 収集 ----------
//
const rssURL = q =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q + ' when:1d')}&hl=ja&gl=JP&ceid=JP:ja`;

// RSS の XML から記事を取り出す（テストしやすいように分離）
export function parseNewsRss(xml, catId, since) {
  const $ = load(xml, { xmlMode: true });
  const out = [];
  $('item').each((_, el) => {
    const title  = $(el).find('title').first().text().trim();
    const link   = $(el).find('link').first().text().trim();
    const pub    = new Date($(el).find('pubDate').first().text()).getTime();
    const srcEl  = $(el).find('source').first();
    const source = srcEl.text().trim();
    const host   = hostOf(srcEl.attr('url') || '');

    if (!title || !link) return;

    // フィルタ１：NG ドメイン除外（Google ニュース経由でも元サイトで判定）
    if (host && matchDomain(host, NG_DOMAINS)) return;

    // フィルタ２：ビール関連の言葉がタイトルにあるか
    if (!BEER_WORDS.test(title)) return;

    // フィルタ３：直近のものだけ
    if (!(pub > since)) return;

    out.push({
      cat: catId,
      title,
      url: link,
      source,
      repost: host ? matchDomain(host, REPOST_DOMAINS) : false,
      pub
    });
  });
  return out;
}

async function fetchNewsByCategory(catId) {
  const { keys } = categories[catId];
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const out = [];

  for (const k of keys) {
    try {
      const xml = await (await fetch(rssURL(k))).text();
      out.push(...parseNewsRss(xml, catId, since));
    } catch (e) {
      console.error('[RSS fail]', k, e.message);
    }
  }
  return out;
}

//
// ---------- 4) Instagram (ハッシュタグ) 収集 ----------
//
const IG_TOKEN  = process.env.IG_TOKEN  || '';
const IG_BUS_ID = process.env.IG_BUS_ID || '';

async function fetchInstaByCategory(catId) {
  if (!IG_TOKEN || !IG_BUS_ID) return [];
  const { tags } = categories[catId];
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const out = [];

  for (const tag of tags) {
    try {
      // 1) ハッシュタグ ID
      const { data: tagSearch } = await axios.get(
        'https://graph.facebook.com/v19.0/ig_hashtag_search',
        { params: { user_id: IG_BUS_ID, q: tag, access_token: IG_TOKEN } }
      );
      const tagId = tagSearch.data?.[0]?.id;
      if (!tagId) continue;

      // 2) 最新メディア
      const { data: media } = await axios.get(
        `https://graph.facebook.com/v19.0/${tagId}/recent_media`,
        {
          params: {
            user_id: IG_BUS_ID,
            fields: 'caption,permalink,timestamp',
            access_token: IG_TOKEN
          }
        }
      );

      (media.data || []).forEach(p => {
        const pub = Date.parse(p.timestamp);
        if (pub > since) {
          out.push({
            cat: catId,
            title: (p.caption || '').split('\n')[0].slice(0, 60) + '…',
            url: p.permalink,
            source: 'Instagram',
            repost: false,
            pub
          });
        }
      });
    } catch (e) {
      console.error('[IG fail]', tag, e.response?.data?.error?.message || e.message);
    }
  }
  return out;
}

//
// ---------- 5) 重複をまとめる ----------
//   ・同じ URL は 1 件
//   ・タイトルが 8 割以上同じ記事は 1 件（元記事を優先、転載は後回し）
//   ・同じ記事が複数カテゴリに入ったら、先に定義したカテゴリを優先
//
const normTitle = (t) => String(t)
  .replace(/\s+[-－–|｜]\s+[^-－–|｜]+$/, '')        // 末尾の「 - 媒体名」
  .replace(/[（(][^（）()]*[）)]\s*$/, '')            // 末尾の「（媒体名）」
  .replace(/[\s　「」『』【】〈〉《》、。，．・…！？!?:：;；,.\-－–~〜'"“”‘’]/g, '')
  .toLowerCase();

const bigrams = (s) => {
  const g = new Set();
  for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2));
  return g;
};

const isSimilar = (a, b) => {
  const n = Math.min(a.size, b.size);
  if (n < 6) return false;
  let hit = 0;
  a.forEach(x => { if (b.has(x)) hit++; });
  return hit / n >= 0.8;
};

export function dedupe(items) {
  const catOrder = Object.keys(categories);
  const indexed = items.map((it, i) => ({ it, i, g: bigrams(normTitle(it.title)) }));
  const order = indexed.slice().sort((x, y) =>
    (Number(!!x.it.repost) - Number(!!y.it.repost)) ||
    (catOrder.indexOf(x.it.cat) - catOrder.indexOf(y.it.cat)) ||
    (x.i - y.i)
  );

  const seenUrl = new Set();
  const kept = [];
  for (const e of order) {
    if (seenUrl.has(e.it.url)) continue;
    if (kept.some(k => isSimilar(e.g, k.g))) continue;
    seenUrl.add(e.it.url);
    kept.push(e);
  }
  return kept.sort((x, y) => x.i - y.i).map(e => e.it);
}

//
// ---------- 6) エントリーポイント（まとめて返す） ----------
//
export async function getCraftwaveData() {
  const results = [];

  for (const catId of Object.keys(categories)) {
    results.push(...await fetchNewsByCategory(catId));
    results.push(...await fetchInstaByCategory(catId));
  }

  // カテゴリごとに新しい順で上限件数まで（LINE の配信通数を増やしすぎないため）
  const unique = dedupe(results);
  const final = [];
  for (const catId of Object.keys(categories)) {
    final.push(
      ...unique
        .filter(x => x.cat === catId)
        .sort((a, b) => b.pub - a.pub)
        .slice(0, MAX_PER_CATEGORY)
    );
  }

  return final.map(({ cat, title, url, source }) => ({ cat, title, url, source }));
}
