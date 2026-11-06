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
      'IPA ビール 発売'
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
  'news.yahoo.co.jp',
  'food.biglobe.ne.jp',
  // 動画配信サイト（番組紹介が多く、放送日も古いことがある）
  'tver.jp',
  'youtube.com',
  'youtu.be',
  'abema.tv'
];

//
// ---------- 2.2) 「ビールがおまけ」の記事を外す ----------
//   グルメ・旅行・ダイエットなどで、ビールがちょっと出てくるだけの記事
//   ただし、ビールが主役だと分かる言葉があれば残す
//
const SIDE_TOPIC = /ランチ|ディナー|誕生日|ダイエット|減量|体重|\d+\s*kg|食べ方|パスタ|ピザ|スイーツ|ケーキ|宿泊|ホテル|旅館|温泉街|旅行記|カンパーイ|♪/;
const BEER_MAIN  = /ブルワリー|ブリュワリー|醸造|ブルーパブ|ビアフェス|ビールフェス|ビール祭|麦酒祭|ビアバー|タップルーム|新作|新商品|発売|限定|オープン|開業|受賞|金賞/;
export const isSideTopic = (title) => SIDE_TOPIC.test(title) && !BEER_MAIN.test(title);

//
// ---------- 2.5) PR TIMES 用のきびしいフィルター ----------
//   PR TIMES は記事の 9 割がビールと関係ないので、クラフトの言葉がある記事だけ通す
//
const PR_DOMAIN = 'prtimes.jp';
const PR_MAX_PER_DAY = 5;
const PR_KEYS = ['クラフトビール', 'ブルワリー', '醸造所 ビール', 'ビアフェス', 'ビール 発売'];

const CRAFT_WORDS = /クラフトビール|クラフト・ビール|ブルワリー|ブリュワリー|ブルーイング|ブルーパブ|タップルーム|ヘイジー|セゾン|ペールエール|スタウト|(?<!サ)ポーター|ヴァイツェン|ピルスナー|[ァ-ヶー]+エール|craft\s*beer|brewery|brewing/i;
const PR_EXCLUDE = /クラフトサケ|サケ醸造|日本酒|清酒|どぶろく|ウイスキー|ワイン|焼酎|に関するプレスリリース一覧|のプレスリリース\s*-\s*PR TIMES$|プレスリリース・ニュースリリース/;

export const isCraftPress = (title) =>
  !PR_EXCLUDE.test(title) &&
  (CRAFT_WORDS.test(title) || (/醸造所/.test(title) && /ビール|エール|ラガー|ビア/.test(title)));

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
// ※「IPA」単体は情報処理推進機構などと紛らわしいので入れない
const BEER_WORDS = /ビール|ビア|ブルワリー|ブルーイング|醸造|ブルーパブ|タップルーム|エール|ラガー|スタウト|ピルスナー|beer|brew/i;

// 「＜画像2 / 4＞」のような飾りをタイトルから外す
const cleanTitle = (t) => t
  .replace(/^[＜<]?\s*画像\s*\d+\s*\/\s*\d+\s*[＞>]\s*/, '')   // ＜画像2 / 4＞
  .replace(/^画像\s*[|｜]\s*/, '')                              // 画像 |
  .trim();

const hostOf = (u) => {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; }
};
const matchDomain = (host, list) => list.some(d => host === d || host.endsWith('.' + d));

//
// ---------- 3) Google News RSS で Web 収集 ----------
//
const rssURL = q =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q + ' when:1d')}&hl=ja&gl=JP&ceid=JP:ja`;

// タイトルからカテゴリを推定する（専門サイトや RSS フィード用）
export function classify(title) {
  if (/フェス|祭|イベント|テイクオーバー|takeover|ビアガーデン|試飲会|開催/i.test(title)) return 'event';
  if (/オープン|開店|新店|開業|移転|出店|進出/.test(title)) return 'shop';
  if (/発売|新商品|新作|限定|リリース|販売開始|登場|コラボ|誕生|より提供|提供開始/.test(title)) return 'release';
  return 'news';
}

// RSS の XML から記事を取り出す（テストしやすいように分離）
//   catId に 'auto' を渡すとタイトルからカテゴリを推定
//   opts.beerOnly = true のときはビール専門サイトなので言葉チェックを省く
export function parseNewsRss(xml, catId, since, opts = {}) {
  const $ = load(xml, { xmlMode: true });
  const out = [];
  $('item').each((_, el) => {
    const title  = cleanTitle($(el).find('title').first().text());
    const link   = $(el).find('link').first().text().trim();
    const pub    = new Date($(el).find('pubDate').first().text()).getTime();
    const srcEl  = $(el).find('source').first();
    const source = srcEl.text().trim() || opts.sourceName || '';
    const host   = hostOf(srcEl.attr('url') || '');

    if (!title || !link) return;

    // フィルタ１：NG ドメイン除外（Google ニュース経由でも元サイトで判定）
    if (host && matchDomain(host, NG_DOMAINS)) return;

    // フィルタ２：ビール関連の言葉がタイトルにあるか
    const isPr = host ? matchDomain(host, [PR_DOMAIN]) : false;
    if (isPr && !isCraftPress(title)) return;
    if (!opts.beerOnly && !BEER_WORDS.test(title)) return;
    if (!opts.beerOnly && isSideTopic(title)) return;

    // フィルタ３：直近のものだけ
    if (!(pub > since)) return;

    out.push({
      // カテゴリは検索ワードではなくタイトルの中身で決める
      // （「〇〇発売」がイベント欄に入る、などのズレを防ぐ）
      cat: classify(title),
      title,
      url: link,
      source,
      repost: host ? matchDomain(host, REPOST_DOMAINS) : false,
      pr: isPr,
      pub
    });
  });
  return out;
}

// PR TIMES をキーワード付きで検索（カテゴリはタイトルから自動推定）
async function fetchPrTimes() {
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const out = [];
  for (const k of PR_KEYS) {
    try {
      const xml = await (await fetch(rssURL(`site:${PR_DOMAIN} ${k}`))).text();
      out.push(...parseNewsRss(xml, 'auto', since));
    } catch (e) {
      console.error('[PR fail]', k, e.message);
    }
  }
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
// ---------- 3.5) ビール専門サイト・ブルワリー公式サイト ----------
//
//   SITE_SOURCES: Google ニュースに載っているサイトを「サイト指定」で全部拾う
//   FEEDS       : サイトが自前で出している RSS / Atom フィードを直接読む
//                 （Google ニュースに載らない小さいブルワリー向け）
//   どちらもビール専門なので、タイトルのビール判定は省いてカテゴリは自動推定
//
export const SITE_SOURCES = [
  { site: 'alwayslovebeer.com', name: 'オールウェイズ・ラブ・ビール' },
  { site: 'yohobrewing.com',    name: 'ヤッホーブルーイング' },
  { site: 'coedobrewery.com',   name: 'コエドブルワリー' }
];

export const FEEDS = [
  // 例：{ url: 'https://example-brewery.jp/feed', name: '〇〇ブルワリー' },
];

async function fetchSiteSources() {
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const out = [];
  for (const s of SITE_SOURCES) {
    try {
      const xml = await (await fetch(rssURL(`site:${s.site}`))).text();
      out.push(...parseNewsRss(xml, 'auto', since, { beerOnly: true, sourceName: s.name }));
    } catch (e) {
      console.error('[SITE fail]', s.site, e.message);
    }
  }
  return out;
}

// RSS（<item>）と Atom（<entry>）の両方を読む
export function parseFeed(xml, name, since) {
  const $ = load(xml, { xmlMode: true });
  const out = [];
  $('item, entry').each((_, el) => {
    const title = cleanTitle($(el).find('title').first().text());
    const linkEl = $(el).find('link').first();
    const link = (linkEl.attr('href') || linkEl.text() || '').trim();
    const dateText = $(el).find('pubDate, published, updated, dc\\:date').first().text();
    const pub = new Date(dateText).getTime();
    if (!title || !link || !(pub > since)) return;
    out.push({ cat: classify(title), title, url: link, source: name, repost: false, pub });
  });
  return out;
}

async function fetchFeeds() {
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const out = [];
  for (const f of FEEDS) {
    try {
      const xml = await (await fetch(f.url, { headers: { 'User-Agent': 'craftwave-scraper' } })).text();
      out.push(...parseFeed(xml, f.name, since));
    } catch (e) {
      console.error('[FEED fail]', f.url, e.message);
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
    (Number(!!x.it.pr) - Number(!!y.it.pr)) ||       // 同じ話題なら報道記事を PR より優先
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

  // 専門サイト・ブルワリーを先に入れる（同じ記事なら専門サイト側が残りやすい）
  results.push(...await fetchSiteSources());
  results.push(...await fetchFeeds());

  for (const catId of Object.keys(categories)) {
    results.push(...await fetchNewsByCategory(catId));
    results.push(...await fetchInstaByCategory(catId));
  }

  results.push(...await fetchPrTimes());

  // PR TIMES は新しい順に 1 日最大 PR_MAX_PER_DAY 件まで
  const deduped = dedupe(results);
  const prKeep = new Set(
    deduped.filter(x => x.pr).sort((a, b) => b.pub - a.pub).slice(0, PR_MAX_PER_DAY)
  );
  const unique = deduped.filter(x => !x.pr || prKeep.has(x));

  // カテゴリごとに新しい順で上限件数まで（LINE の配信通数を増やしすぎないため）
  const final = [];
  for (const catId of Object.keys(categories)) {
    final.push(
      ...unique
        .filter(x => x.cat === catId)
        .sort((a, b) => b.pub - a.pub)
        .slice(0, MAX_PER_CATEGORY)
    );
  }

  return final.map(({ cat, title, url, source, pr }) => ({ cat, title, url, source, pr: !!pr }));
}
