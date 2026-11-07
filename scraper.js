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

// ---------- 1.5) 集める期間と件数（週1配信向け 2026-11-07） ----------
//   直近 DEFAULT_DAYS 日に公開された記事だけを集める
//   /api/craftwave?days=1 のように期間を変えて確認もできる
const DEFAULT_DAYS = 7;
let windowDays = DEFAULT_DAYS;
const windowStart = () => Date.now() - windowDays * 24 * 60 * 60 * 1000;

// 1 カテゴリあたりの最大件数（週1の「今週の厳選」なので少なめ）
const MAX_PER_CATEGORY = 5;

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
// ---------- 2.3) 古い記事・ビールじゃない記事を外す（2026-11-07 追加） ----------
//
// 画像ギャラリーのページ（＜画像16 / 17＞〜）は、Google が最近拾い直しただけで
// 中身は何年も前の記事のことが多い（例：ウォーカープラスの2015年の記事）→ 丸ごと外す
export const isGalleryPage = (rawTitle) =>
  /^[＜<]?\s*画像\s*\d+\s*\/\s*\d+/.test(rawTitle) || /^画像\s*[|｜]/.test(rawTitle);

// タイトルに去年以前の年（「2024年」「2025」など）が入っていたら古い記事として外す
export const hasPastYear = (title, now = new Date()) => {
  const thisYear = now.getFullYear();
  return (title.match(/(?<!\d)20\d{2}(?!\d)/g) || []).some(y => Number(y) < thisYear);
};

// チューハイ・ハイボールなど、ビールではないお酒（RTD）の新商品は外す
//   「キリンビール、氷結〜発売」のように社名の「ビール」だけで通ってしまうのを防ぐ
//   ※大手メーカーのビールの記事は残す（ゆうたの判断）
const RTD_WORDS = /氷結|チューハイ|酎ハイ|ハイボール|カクテル|レモンサワー|ほろよい|ストロングゼロ|-196/;
export const isBeerTitle = (title) => {
  if (RTD_WORDS.test(title) && !CRAFT_WORDS.test(title)) return false;
  return BEER_WORDS.test(title);
};

//
// ---------- 2.5) PR TIMES 用のきびしいフィルター ----------
//   PR TIMES は記事の 9 割がビールと関係ないので、クラフトの言葉がある記事だけ通す
//
const PR_DOMAIN = 'prtimes.jp';
const PR_MAX_PER_WEEK = 3;   // PR TIMES は1回の配信で最大3件
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
  `https://news.google.com/rss/search?q=${encodeURIComponent(q + ` when:${windowDays}d`)}&hl=ja&gl=JP&ceid=JP:ja`;

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
    const rawTitle = $(el).find('title').first().text().trim();
    const title  = cleanTitle(rawTitle);
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
    if (!opts.beerOnly && !isBeerTitle(title)) return;
    if (!opts.beerOnly && isSideTopic(title)) return;

    // フィルタ2.5：古い記事（画像ギャラリー・去年以前の年が入ったタイトル）
    if (isGalleryPage(rawTitle) || hasPastYear(title)) return;

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
  const since = windowStart();
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
  const since = windowStart();
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

//   Shopify のブログは /blogs/<ブログ名>.atom、WordPress は /feed/ でフィードが出る
//   動くかどうかは /api/feeds-check で確認できる（配信には影響しない）
//   cat を指定するとタイトルに関係なくそのカテゴリにする（ビール名だけの醸造記録など）
//   2026-11-06 確認：BLACK TIDE（最終更新2020年）と open air（同2022年）はサイトのお知らせが
//   止まっていて X / Instagram 中心なので未登録
export const FEEDS = [
  { url: 'https://kaiganbrewery.com/blogs/news.atom',          name: 'KAIGAN BREWERY' },
  { url: 'https://www.westcoastbrewing.jp/news/feed/',          name: 'West Coast Brewing' },
  { url: 'https://www.craftbk.net/blogs/brew-ledger.atom',      name: 'CRAFT BANK', cat: 'release' }
];

const FEED_TIMEOUT_MS = 10000;

async function getFeedXml(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; craftwave-scraper)' },
    signal: AbortSignal.timeout(FEED_TIMEOUT_MS)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  if (!/<(rss|feed|rdf:RDF)[\s>]/i.test(xml)) throw new Error('フィードではない（HTMLなど）');
  return xml;
}

async function fetchSiteSources() {
  const since = windowStart();
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
export function parseFeed(xml, name, since, fixedCat) {
  const $ = load(xml, { xmlMode: true });
  const out = [];
  $('item, entry').each((_, el) => {
    const title = cleanTitle($(el).find('title').first().text());
    const linkEl = $(el).find('link').first();
    const link = (linkEl.attr('href') || linkEl.text() || '').trim();
    const dateText = $(el).find('pubDate, published, updated, dc\\:date').first().text();
    const pub = new Date(dateText).getTime();
    if (!title || !link || !(pub > since)) return;
    out.push({ cat: fixedCat || classify(title), title, url: link, source: name, repost: false, pub });
  });
  return out;
}

// 1つのサイトが遅くても全体が止まらないよう、並列＋タイムアウト付きで読む
async function fetchFeeds() {
  const since = windowStart();
  const results = await Promise.allSettled(
    FEEDS.map(async f => parseFeed(await getFeedXml(f.url), f.name, since, f.cat))
  );
  const out = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') out.push(...r.value);
    else console.error('[FEED fail]', FEEDS[i].url, r.reason?.message);
  });
  return out;
}

// 確認用：各フィードが読めるか、最新記事は何かを返す（24時間の絞り込みなし）
export async function checkFeeds() {
  return Promise.all(FEEDS.map(async f => {
    try {
      const items = parseFeed(await getFeedXml(f.url), f.name, 0, f.cat)
        .sort((a, b) => b.pub - a.pub);
      return {
        name: f.name, url: f.url, ok: true, count: items.length,
        latest: items.slice(0, 3).map(x => ({
          title: x.title, cat: x.cat, date: new Date(x.pub).toISOString().slice(0, 10), url: x.url
        }))
      };
    } catch (e) {
      return { name: f.name, url: f.url, ok: false, error: e.message };
    }
  }));
}

//
// ---------- 4) Instagram (ハッシュタグ) 収集 ----------
//
const IG_TOKEN  = process.env.IG_TOKEN  || '';
const IG_BUS_ID = process.env.IG_BUS_ID || '';

async function fetchInstaByCategory(catId) {
  if (!IG_TOKEN || !IG_BUS_ID) return [];
  const { tags } = categories[catId];
  const since = windowStart();
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
// 厳選の優先度：ブルワリー公式 ＞ ビール専門サイト ＞ ニュース ＞ 転載・PR
const priorityOf = (x) => x.prio ?? (x.pr || x.repost ? 0 : 1);

export async function getCraftwaveData({ days } = {}) {
  const d = Number(days);
  windowDays = d >= 1 && d <= 30 ? Math.floor(d) : DEFAULT_DAYS;
  const results = [];

  // 専門サイト・ブルワリーを先に入れる（同じ記事なら専門サイト側が残りやすい）
  results.push(...(await fetchSiteSources()).map(x => ({ ...x, prio: 2 })));
  results.push(...(await fetchFeeds()).map(x => ({ ...x, prio: 3 })));

  for (const catId of Object.keys(categories)) {
    results.push(...await fetchNewsByCategory(catId));
    results.push(...await fetchInstaByCategory(catId));
  }

  results.push(...await fetchPrTimes());

  // PR TIMES は新しい順に PR_MAX_PER_WEEK 件まで
  const deduped = dedupe(results);
  const prKeep = new Set(
    deduped.filter(x => x.pr).sort((a, b) => b.pub - a.pub).slice(0, PR_MAX_PER_WEEK)
  );
  const unique = deduped.filter(x => !x.pr || prKeep.has(x));

  // カテゴリごとに「優先度 → 新しい順」で上限件数まで
  const final = [];
  for (const catId of Object.keys(categories)) {
    final.push(
      ...unique
        .filter(x => x.cat === catId)
        .sort((a, b) => (priorityOf(b) - priorityOf(a)) || (b.pub - a.pub))
        .slice(0, MAX_PER_CATEGORY)
    );
  }

  // date：記事の公開日（日本時間の「11/5」形式）。週刊なのでLINEで表示できるように
  const md = (t) => new Date(t + 9 * 3600e3).toISOString().slice(5, 10).replace(/^0?(\d+)-0?(\d+)$/, '$1/$2');
  return final.map(({ cat, title, url, source, pr, pub }) => ({ cat, title, url, source, pr: !!pr, date: md(pub) }));
}
