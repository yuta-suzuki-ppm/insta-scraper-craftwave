// ranking.js 〈週刊CRAFTWAVEの「厳選」ロジック 2026-11-07〉
//
//   1) isFinishedEvent : タイトルの日付から「もう終わったイベント」を見つける
//   2) scoreItem       : クラフトビールの内容がどれだけ濃いかを点数にする
//
//   どちらもタイトルと配信元だけで判断する（記事本文は読まない）
//   点数の内訳は /api/craftwave?debug=1 で確認できる

const JST = 9 * 3600e3;
const DAY = 24 * 3600e3;

// 全角数字・記号を半角に（山陽新聞などは「１７、１８日」と全角で書く）
const toHalf = (s) => String(s)
  .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
  .replace(/／/g, '/').replace(/[～〜]/g, '~');

// 日本時間の「その日の0時」
const jstDayStart = (t) => Math.floor((t + JST) / DAY) * DAY - JST;
const jstDate = (y, m, d) => Date.UTC(y, m - 1, d) - JST;

//
// ---------- 1) 終わったイベントを外す ----------
//   タイトルに出てくる日付のうち一番遅い日を「最終日」とみなし、
//   それが配信日より前なら終わったイベントとする
//   日付が読み取れないものは残す（消しすぎないように）
//
export function eventEndDate(title, pub = Date.now()) {
  const t = toHalf(title)
    .replace(/\d+日間/g, '')                 // 「2日間だけ」などの期間は日付じゃない
    .replace(/(?<!\d)20\d{2}年?/g, '');       // 年はここでは使わない
  const p = new Date(pub + JST);
  const pubY = p.getUTCFullYear(), pubM = p.getUTCMonth() + 1, pubD = p.getUTCDate();

  // 月が書いていない日付は、公開月のものとする（公開日よりかなり前の日なら翌月）
  const resolve = (m, d) => {
    if (!(d >= 1 && d <= 31)) return null;
    let y = pubY;
    if (m == null) {
      m = pubM;
      if (d < pubD - 7) m += 1;
    } else if (m < pubM - 6) {
      y += 1;                                  // 12月の記事に「1月10日」→ 翌年
    }
    if (m > 12) { m -= 12; y += 1; }
    if (!(m >= 1 && m <= 12)) return null;
    return jstDate(y, m, d);
  };

  const dates = [];
  let lastMonth = null;
  // 「11月7日」「11/7」「7日」を前から順に拾う（「11月7日・8日」の8日は11月として扱う）
  const re = /(\d{1,2})月(\d{1,2})日|(?<![\d/.])(\d{1,2})\/(\d{1,2})(?![\d/])|(?<![\d月/])(\d{1,2})日(?!本)/g;
  for (const m of t.matchAll(re)) {
    if (m[1]) { lastMonth = +m[1]; dates.push(resolve(+m[1], +m[2])); }
    else if (m[3]) { lastMonth = +m[3]; dates.push(resolve(+m[3], +m[4])); }
    else dates.push(resolve(lastMonth, +m[5]));
  }

  // 「【2026年11月】」のように月だけ → その月の末日まで
  if (!dates.length) {
    const mm = t.match(/(?<!\d)(\d{1,2})月(?![\d日])/);
    if (mm) {
      const first = resolve(+mm[1], 1);
      if (first) {
        const d = new Date(first + JST);
        dates.push(jstDate(d.getUTCFullYear(), d.getUTCMonth() + 2, 0));
      }
    }
  }

  const ok = dates.filter(Boolean);
  return ok.length ? Math.max(...ok) : null;
}

// イベント欄の記事と、ほかの欄でも「開催・ブース」など催しっぽい記事が対象
//   ※「11月1日オープン」「11月6日発売」は日付が過ぎても価値があるので対象外
const EVENTISH = /開催|イベント|フェス|ブース|試飲会|テイクオーバー|takeover|ビアガーデン/i;
export function isFinishedEvent(item, now = Date.now()) {
  if (item.cat !== 'event' && !EVENTISH.test(item.title)) return false;
  const end = eventEndDate(item.title, item.pub || now);
  return end != null && end < jstDayStart(now);
}

//
// ---------- 2) クラフトビールの「濃さ」スコア ----------
//
const RULES = [
  // クラフトの核になる言葉（1つの記事で最大2回まで数える）
  { re: /クラフトビール|クラフト・ビール|craft\s*beer/gi,                       pts: 3, max: 1, why: 'クラフトビール' },
  { re: /ブルワリー|ブリュワリー|ブルーイング|醸造所|ブルーパブ|タップルーム|brewery|brewing/gi, pts: 3, max: 1, why: 'ブルワリー' },
  // 有名なクラフトブルワリー・提携ブルワリーの名前（「ブルワリー」と書いてない記事用）
  { re: /サンクトガーレン|ヤッホー|よなよな|水曜日のネコ|COEDO|コエド|志賀高原|箕面|伊勢角屋|ベアレン|常陸野|京都醸造|うちゅうブルーイング|Far Yeast|ファーイースト|富士桜高原|いわて蔵|奈良醸造|KAIGAN|海岸醸造|BLACK TIDE|ブラックタイド|West Coast Brewing|WCB|CRAFT BANK|open air|羽田麦酒|T\.Y\.HARBOR|ワイマーケット|Y\.MARKET|反射炉|Baird|ベアード|アウグスビール|銀河高原|DD4D/gi, pts: 2, max: 1, why: 'クラフトブルワリー名' },
  { re: /ビアフェス|ビールフェス|ビール祭|ビアバー|タップテイクオーバー|tap\s*takeover/gi, pts: 2, max: 1, why: 'ビール専門の場' },
  // ビアスタイル・原料（濃い記事ほどたくさん出てくる）
  { re: /IPA|ペールエール|ヘイジー|スタウト|ポーター|ピルスナー|セゾン|ヴァイツェン|サワーエール|ベルジャン|バーレイワイン|ラガー|エール|ホップ|麦芽|モルト/gi, pts: 2, max: 2, why: 'スタイル・原料' },
  { re: /限定醸造|コラボ醸造|初醸造|醸造開始|新作|樽|タップ/g,                  pts: 1, max: 2, why: '醸造・新作' },
  // ビールが出てくるだけ
  { re: /ビール|ビア|beer/gi,                                                   pts: 1, max: 1, why: 'ビール' },
  // ビールが主役じゃなさそうな言葉
  { re: /グルメ|料理|食べ|ウインナー|スイーツ|おむすび|ランチ|ホテル|温泉|マルシェ|まとめ|J1|試合/g, pts: -2, max: 2, why: 'ビールが脇役' },
  // 大手の定番・量産ブランド（残すけど順位は下げる）
  { re: /本麒麟|一番搾り|スーパードライ|黒ラベル|ヱビス|YEBISU|プレモル|プレミアム・モルツ|発泡酒|新ジャンル|ノンアル/g, pts: -1, max: 1, why: '大手の定番' }
];

export function scoreItem(x) {
  // 配信元名（「 - ウォーカープラス」）は点数に入れない
  const title = toHalf(x.title).replace(/\s+[-－–|｜]\s+[^-－–|｜]+$/, '');
  let score = 0;
  const why = [];
  for (const r of RULES) {
    const hits = (title.match(r.re) || []).length;
    if (!hits) continue;
    const p = r.pts * Math.min(hits, r.max);
    score += p;
    why.push(`${r.why}${p > 0 ? '+' : ''}${p}`);
  }
  // 配信元
  if (x.prio >= 3) { score += 3; why.push('ブルワリー公式+3'); }
  if (x.pr)        { score -= 1; why.push('PR-1'); }
  if (x.repost)    { score -= 1; why.push('転載-1'); }
  // 話題性：同じ話題を複数のメディアが書いていたら少し上げる
  if (x.dups)      { const p = Math.min(x.dups, 2); score += p; why.push(`複数メディア+${p}`); }
  return { score, why: why.join(' ') };
}

// 同じ配信元はカテゴリごとに最大この件数まで（1サイトだらけにならないように）
export const MAX_PER_SOURCE = 2;
