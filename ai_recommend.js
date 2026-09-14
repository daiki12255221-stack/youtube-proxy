const { Redis } = require("@upstash/redis");

const kv = new Redis({
  url: "https://big-monkfish-128403.upstash.io",
  token: "gQAAAAAAAfWTAAIgcDFiMmMyYjE5ZTA5ODc0Y2ZiYTM2NGFiYTU4MWVlMGViYQ",
});

/**
 * ai_recommend.js - AIおすすめ「読み込み専用」窓口
 * ------------------------------------------------------------
 * 重い計算は一切ここではやらない。Vercel側(compute.js/watcher.js)が
 * 裏で計算してRedisに保存した結果(recommend:{username}:display)を
 * 読んで返すのが基本の役目。
 *
 * ただし watch_recent / watch_mid / substitute / fav_channel は
 * Invidious由来のタイトル/投稿者情報を使っているため、たまに英語タイトルの
 * 動画が紛れ込むことがある。ここではその4分類の動画だけ、YouTube API で
 * 最新の情報を取り直し、さらに全体をタイトルに漢字・ひらがな・カタカナが
 * 含まれるかでフィルタして、日本語コンテンツだけを返すようにする。
 * ------------------------------------------------------------
 */

// Invidious由来で情報の裏取りが必要な分類
const REFETCH_ROUTES = new Set([
  "watch_recent",
  "watch_mid",
  "substitute",
  "fav_channel",
]);

const FALLBACK_KEYS = [
  "AIzaSyBfCvyZ_J9mJiMFNYB6WfcuLyvf9zDdcUU",
  "AIzaSyCgVn-JWHKT_z6EC73Z6Vlex0F_d-BP_fY",
  "AIzaSyBbqPhAbqoWDOurTt7hejQmwc6dAoZ5Iy0",
  "AIzaSyAWk9mmie23-khi8-nipv1jHJND__UtEWA",
  "AIzaSyBL38iyqeiaKHoKqhloSnhG590DfJ35vCE",
  "AIzaSyDU4jrOT0o2Jd4zDwZyU5OOBsKt1P3RJNs",
  "AIzaSyB2L_plk45E1wihBUB4VJ516pIfqcBc2Yw",
  "AIzaSyDcYrvxFDKcXNqI65Aihrqk0uK2Ebj7KVo",
  "AIzaSyAmfASO-61oyXFOfzJCR9e3oGbnKenBZb",
  "AIzaSyCU7xnDWAFbXt1ze0_DBaWDKt7NDT1XP7",
];
let fallbackKeyIndex = 0;
function getNextFallbackKey() {
  const key = FALLBACK_KEYS[fallbackKeyIndex % FALLBACK_KEYS.length];
  fallbackKeyIndex = (fallbackKeyIndex + 1) % FALLBACK_KEYS.length;
  return key;
}

// タイトルに漢字・ひらがな・カタカナのいずれかが含まれているか
function isJapanese(text) {
  return /[\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF]/.test(text || "");
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function fetchYouTubeVideos(ids, apiKey, retried = false) {
  const key = apiKey || getNextFallbackKey();
  const url = `https://www.googleapis.com/youtube/v3/videos?id=${ids.join(
    ","
  )}&part=snippet&key=${key}`;
  try {
    const res = await fetch(url);
    if (res.status === 403 && !retried) {
      return fetchYouTubeVideos(ids, getNextFallbackKey(), true);
    }
    if (!res.ok) return [];
    const data = await res.json();
    return data.items || [];
  } catch (e) {
    return [];
  }
}

module.exports = async function handler(req, res) {
  const username =
    req.method === "GET" ? req.query.username : req.body?.username;

  if (!username) {
    return res.status(400).json({ error: "ログインが必要です" });
  }

  try {
    const status = (await kv.get(`recommend:${username}:status`)) || "idle";

    const raw = await kv.get(`recommend:${username}:display`);
    const items = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : [];

    if (items.length === 0) {
      return res.status(200).json({ items: [], status });
    }

    // ① Invidious由来の分類だけ、YouTube APIで情報を取り直す
    const idsToRefetch = [
      ...new Set(
        items.filter((v) => REFETCH_ROUTES.has(v._route)).map((v) => v.id)
      ),
    ];
    const snippetMap = {};
    if (idsToRefetch.length > 0) {
      const batches = chunk(idsToRefetch, 50);
      const results = await Promise.all(
        batches.map((batch) => fetchYouTubeVideos(batch))
      );
      results.flat().forEach((v) => {
        snippetMap[v.id] = v.snippet;
      });
    }

    // ② 取り直した情報に差し替える（取り直せなかった=削除済み等は除外対象にする）
    const enriched = items
      .map((v) => {
        if (REFETCH_ROUTES.has(v._route)) {
          const fresh = snippetMap[v.id];
          if (!fresh) return null; // 取得失敗 → 除外
          return { ...v, snippet: fresh };
        }
        return v;
      })
      .filter(Boolean);

    // ③ 全体を、タイトルに日本語(漢字/ひらがな/カタカナ)が含まれるかでフィルタ
    const filtered = enriched.filter((v) => isJapanese(v.snippet?.title));

    return res.status(200).json({ items: filtered, status });
  } catch (error) {
    console.error("[ai_recommend] エラー:", error);
    return res.status(500).json({ error: "サーバーエラー" });
  }
};
