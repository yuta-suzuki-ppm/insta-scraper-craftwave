// scraper.js 〈重複タイトルもはじく最新版〉
import { load } from 'cheerio';
import axios from 'axios';

//
// ---------- 1) カテゴリ & キーワード定義 ----------
//
export const categories = {
  event: {
    name: 'イベント',
    keys: ['クラフトビール フェス', 'ビアフェス', 'ビール イベント', 'tap takeover'],
    tags: ['ビアフェス', 'taptakeover']
  },
  release: {
    name: '新作リリース',
    keys: ['新商品 クラフトビール', '限定ビール 発売', 'craft beer release'],
    tags: ['限定ビール', 'newbeerrelease']
  },
  shop: {
    name: '新店舗',
    keys: ['クラフトビール 新店舗', 'ビールバー オープン', 'taproom open'],
    tags: ['クラフトビールバー', '新店オープン']
  },
  news: {
    name: '業界ニュース',
    keys: ['クラフトビール 業界', '醸造所 設立', 'brewery news'],
    tags: ['クラフトビールニュース']
  }
};

//
// ---------- 追加：ノイズを弾く NG ドメイン ----------
//
const NG_DOMAINS = [
  'prtimes.jp',
  'news.yahoo.co.jp',
  'food.biglobe.ne.jp'
];

//
// ---------- 2) Google News RSS で Web 収集 ----------
//
const rssURL = q =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q + ' when:1d site:.jp')}&hl=ja&gl=JP&ceid=JP:ja`;

async function fetchNewsByCategory(catId) {
  const { keys } = categories[catId];
  const yesterday = Date.now() - 24 * 60 * 60 * 1000;
  let out = [];

  for (const k of keys) {
    try {
      const xml = await (await fetch(rssURL(k))).text();
      const $ = load(xml, { xmlMode: true });
      $('item').each((_, el) => {
        const title = $(el).find('title').text();
        const link  = $(el).find('link').text();
        const pub   = new Date($(el).find('pubDate').text()).getTime();

        // フィルタ１：NG ドメイン除外
        if (NG_DOMAINS.some(d => link.includes(d))) return;

        // フィルタ２：タイトル再チェック（AND）
        const low = title.toLowerCase();
        const ok  = k.toLowerCase().split(' ').every(w => low.includes(w));
        if (!ok) return;

        if (pub > yesterday) out.push({ cat: catId, title, url: link });
      });
    } catch (e) {
      console.error('[RSS fail]', k, e.message);
    }
  }
  return out;
}

//
// ---------- 3) Instagram (ハッシュタグ) 収集 ----------
//
const IG_TOKEN  = process.env.IG_TOKEN  || '';
const IG_BUS_ID = process.env.IG_BUS_ID || '';

async function fetchInstaByCategory(catId) {
  if (!IG_TOKEN || !IG_BUS_ID) return [];
  const { tags } = categories[catId];
  const yesterday = Date.now() - 24 * 60 * 60 * 1000;
  let out = [];

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
        if (Date.parse(p.timestamp) > yesterday) {
          out.push({
            cat: catId,
            title: (p.caption || '').split('\n')[0].slice(0, 60) + '…',
            url: p.permalink
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
// ---------- 4) エントリーポイント（まとめて返す） ----------
//
export async function getCraftwaveData() {
  let results = [];

  for (const catId of Object.keys(categories)) {
    results.push(...await fetchNewsByCategory(catId));
    results.push(...await fetchInstaByCategory(catId));
  }

  // ① URL 重複カット
  let uniq = Array.from(new Map(results.map(o => [o.url, o])).values());

  // ② タイトルがほぼ同じ記事を 1 本だけ残す
  const norm = str =>
    str
      .toLowerCase()
      .replace(/[【\[\(（「『].*?[】\]\)）」』]/g, '') // カッコ内を削除
      .replace(/\s+/g, '');                             // スペース削除

  const seen = new Set();
  const final = [];
  for (const item of uniq) {
    const key = norm(item.title).slice(0, 30);          // 先頭30文字で比較
    if (seen.has(key)) continue;                        // もう見たらスキップ
    seen.add(key);
    final.push(item);
  }

  return final.slice(0, 100); // 最大100件返す
}
