// recommend.js — /api/god_recommend
// handleEdge互換：async function(req) → new Response(...) 形式

const fetch = require("node-fetch");

// ─── Invidiousインスタンス一覧 ─────────────────────────────────────────────
const INVIDIOUS_INSTANCES = [
  "https://ppgzlx-3000.csb.app/",
];

// ─── APIキー ────────────────────────────────────────────────────────────────
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

// ─── メモリキャッシュ（5分間） ───────────────────────────────────────────────
const scoreCache = new Map(); // videoId → { score, time }
const CACHE_TTL = 5 * 60 * 1000;

// ─── ユーティリティ ─────────────────────────────────────────────────────────
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeThumbUrl(id) {
  return `/api/thumb?id=${id}`;
}

function getVideoId(item) {
  if (!item) return "";
  return (
    item.videoId ||
    item.id?.videoId ||
    (typeof item.id === "string" ? item.id : "") ||
    item.contentDetails?.videoId ||
    ""
  );
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── Invidious フェッチ（シャッフルしてレース） ─────────────────────────────
async function fetchInvidious(path) {
  const instances = shuffle(INVIDIOUS_INSTANCES);
  for (const base of instances) {
    try {
      const url = `${base.replace(/\/$/, "")}${path}`;
      const res = await fetch(url, { timeout: 5000 });
      if (!res.ok) continue;
      const data = await res.json();
      if (data && !data.error) return data;
    } catch (_) {}
  }
  return null;
}

// ─── YouTube API フェッチ ────────────────────────────────────────────────────
async function fetchYouTube(endpoint, params, apiKey, retried = false) {
  const key = apiKey || getNextFallbackKey();
  const qs = new URLSearchParams({ ...params, key });
  const url = `https://www.googleapis.com/youtube/v3/${endpoint}?${qs}`;
  try {
    const res = await fetch(url, { timeout: 10000 });
    if (res.status === 403 && !retried)
      return fetchYouTube(endpoint, params, getNextFallbackKey(), true);
    if (!res.ok) return null;
    return await res.json();
  } catch (_) {
    return null;
  }
}

// ─── 関連動画取得（kanrenn.js と同じ実装） ───────────────────────────────────
async function fetchRelated(vId, limit = 2) {
  const data = await fetchInvidious(`/api/v1/videos/${vId}?region=JP`);
  if (!data?.relatedVideos) return [];
  return data.relatedVideos.slice(0, limit);
}

// ─── スコアリング（10個バッチ・キャッシュ付き） ──────────────────────────────
async function scoreVideos(ids, apiKey) {
  const result = {};
  const toFetch = [];

  for (const id of ids) {
    const cached = scoreCache.get(id);
    if (cached && Date.now() - cached.time < CACHE_TTL) {
      result[id] = cached.score;
    } else {
      toFetch.push(id);
    }
  }

  // 10個ずつバッチ処理
  const batches = [];
  for (let i = 0; i < toFetch.length; i += 10) {
    batches.push(toFetch.slice(i, i + 10));
  }

  await Promise.allSettled(
    batches.map(async (batch) => {
      try {
        const data = await fetchYouTube(
          "videos",
          { id: batch.join(","), part: "statistics" },
          apiKey
        );
        if (!data?.items) return;
        for (const item of data.items) {
          const likes = parseInt(item.statistics?.likeCount || "0");
          const dislikes = parseInt(item.statistics?.dislikeCount || "0");
          const views = parseInt(item.statistics?.viewCount || "0");
          // 高評価率 = likes / (likes + dislikes)、dislikes不明時はviews補正
          const score =
            likes + dislikes > 0
              ? (likes / (likes + dislikes)) * 100
              : views > 0
              ? Math.min((likes / views) * 1000, 100)
              : 0;
          result[item.id] = score;
          scoreCache.set(item.id, { score, time: Date.now() });
        }
      } catch (_) {}
    })
  );

  return result;
}

// ─── メインハンドラー ────────────────────────────────────────────────────────
async function handler(req) {
  try {
    if (req.method === "OPTIONS") return new Response(null, { status: 200 });
    if (req.method !== "POST") return jsonResponse({ error: "POST only" }, 405);

    let body = {};
    try {
      const raw = typeof req.body === "string" ? req.body : await req.text();
      body = JSON.parse(raw || "{}");
    } catch (_) {}

    const {
      apiKey = null,
      searchHistory = [],
      watchHistory = [],
      trendingVideos = [],
    } = body;

    const watchArr = Array.isArray(watchHistory) ? watchHistory : [];
    const searchKeywords = (
      Array.isArray(searchHistory) ? searchHistory : []
    ).slice(0, 10);
    const trendingArr = Array.isArray(trendingVideos) ? trendingVideos : [];

    // ─── 除外セット：直近10件は絶対表示禁止 ───────────────────────────────
    const seenIds = new Set();
    for (const item of watchArr.slice(0, 10)) {
      const id = item?.id || (typeof item === "string" ? item : "");
      if (id) seenIds.add(id);
    }

    const addIfNew = (id) => {
      if (!id || seenIds.has(id)) return false;
      seenIds.add(id);
      return true;
    };

    const makeSnippet = (rv) => ({
      title: rv.title || "",
      channelTitle: rv.author || rv.channelTitle || "",
      channelId: rv.authorId || rv.channelId || "",
      thumbnails: {
        high: { url: makeThumbUrl(rv.videoId || rv.id || "") },
        default: { url: makeThumbUrl(rv.videoId || rv.id || "") },
      },
      publishedAt: rv.publishedText || rv.published || "",
    });

    const candidates = []; // { id, snippet, _route }

    // ─── ① 検索履歴ルート：1ワード3件 × 10ワード = 最大30件 ──────────────
    await Promise.allSettled(
      searchKeywords.map(async (word) => {
        if (!word) return;
        try {
          const data = await fetchYouTube(
            "search",
            {
              q: word,
              part: "snippet",
              type: "video",
              maxResults: 3,
              regionCode: "JP",
            },
            apiKey
          );
          if (!data?.items) return;
          for (const item of data.items) {
            const id = getVideoId(item);
            if (!addIfNew(id)) continue;
            candidates.push({ id, snippet: item.snippet, _route: "search" });
          }
        } catch (_) {}
      })
    );

    // ─── ② 直近視聴履歴（1〜20件目）の関連動画 2つずつ = 最大40件 ─────────
    const recentWatch = watchArr.slice(0, 20);
    await Promise.allSettled(
      recentWatch.map(async (item) => {
        const id = item?.id || (typeof item === "string" ? item : "");
        if (!id) return;
        try {
          const related = await fetchRelated(id, 2);
          for (const rv of related) {
            const rvId = rv.videoId || rv.id || "";
            if (!addIfNew(rvId)) continue;
            candidates.push({
              id: rvId,
              snippet: makeSnippet(rv),
              _route: "watch_recent",
            });
          }
        } catch (_) {}
      })
    );

    // ─── ③ 中期視聴履歴（21〜100件目）ランダム10件の関連動画 1つずつ = 最大10件 ──
    const midWatch = watchArr.slice(20, 100);
    const midPick = shuffle(midWatch).slice(0, 10);
    await Promise.allSettled(
      midPick.map(async (item) => {
        const id = item?.id || (typeof item === "string" ? item : "");
        if (!id) return;
        try {
          const related = await fetchRelated(id, 1);
          for (const rv of related) {
            const rvId = rv.videoId || rv.id || "";
            if (!addIfNew(rvId)) continue;
            candidates.push({
              id: rvId,
              snippet: makeSnippet(rv),
              _route: "watch_mid",
            });
          }
        } catch (_) {}
      })
    );

    // ─── ④ 長期視聴履歴（101〜500件目）タグ集計→タグ検索 = 最大10件 ────────
    const longWatch = watchArr.slice(100, 500);
    const longPick = shuffle(longWatch).slice(0, 10);
    const tagCount = {};
    await Promise.allSettled(
      longPick.map(async (item) => {
        const id = item?.id || (typeof item === "string" ? item : "");
        if (!id) return;
        try {
          const data = await fetchInvidious(
            `/api/v1/videos/${id}?fields=keywords`
          );
          if (!data?.keywords) return;
          for (const tag of data.keywords) {
            tagCount[tag] = (tagCount[tag] || 0) + 1;
          }
        } catch (_) {}
      })
    );

    const topTag = Object.entries(tagCount).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (topTag) {
      try {
        const data = await fetchYouTube(
          "search",
          {
            q: topTag,
            part: "snippet",
            type: "video",
            maxResults: 10,
            regionCode: "JP",
          },
          apiKey
        );
        if (data?.items) {
          for (const item of data.items) {
            const id = getVideoId(item);
            if (!addIfNew(id)) continue;
            candidates.push({ id, snippet: item.snippet, _route: "long_tag" });
          }
        }
      } catch (_) {}
    }

    // ─── ⑤ お気に入りチャンネル（直近20件で最多登場チャンネル）= 最大10件 ──
    const chCount = {};
    for (const item of recentWatch) {
      const chId = item?.channelId || item?.snippet?.channelId || "";
      if (chId) chCount[chId] = (chCount[chId] || 0) + 1;
    }
    const topChId = Object.entries(chCount).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (topChId) {
      try {
        const data = await fetchInvidious(
          `/api/v1/channels/${topChId}/videos?region=JP`
        );
        const chVideos = data?.videos || data?.items || [];
        const picked = shuffle(chVideos).slice(0, 10);
        for (const v of picked) {
          const id = v.videoId || v.id || "";
          if (!addIfNew(id)) continue;
          candidates.push({
            id,
            snippet: {
              title: v.title || "",
              channelTitle: v.author || v.channelTitle || "",
              channelId: topChId,
              thumbnails: {
                high: { url: makeThumbUrl(id) },
                default: { url: makeThumbUrl(id) },
              },
              publishedAt: v.publishedText || v.published || "",
            },
            _route: "fav_channel",
          });
        }
      } catch (_) {}
    }

    // ─── ⑥ 急上昇ランダム10件（スコアリング除外） ──────────────────────────
    const trendingPool = shuffle(trendingArr)
      .slice(0, 10)
      .map((item) => {
        const id = getVideoId(item);
        return { id, snippet: item.snippet, _route: "trending", _score: null };
      })
      .filter((v) => v.id);

    // ─── 重複排除 ＆ 身代わりシステム ──────────────────────────────────────
    // candidates の中で seenIds に引っかかるものは関連動画で差し替え
    // （addIfNew で追加済みなので candidates 内の重複は既にない）
    // 身代わり: candidates が少なかった場合、各候補の関連動画1件で補充
    if (candidates.length < 90) {
      const shortage = 90 - candidates.length;
      const triggers = shuffle(candidates).slice(0, shortage);
      await Promise.allSettled(
        triggers.map(async (v) => {
          if (candidates.length >= 90) return;
          try {
            const related = await fetchRelated(v.id, 1);
            for (const rv of related) {
              const rvId = rv.videoId || rv.id || "";
              if (!addIfNew(rvId)) continue;
              candidates.push({
                id: rvId,
                snippet: makeSnippet(rv),
                _route: "substitute",
              });
              break;
            }
          } catch (_) {}
        })
      );
    }

    // ─── スコアリング（最大90件・10個バッチ・キャッシュ付き） ───────────────
    const scoringTargets = candidates.slice(0, 90);
    const scoreMap = await scoreVideos(
      scoringTargets.map((v) => v.id),
      apiKey
    );

    const scoredVideos = scoringTargets
      .map((v) => ({ ...v, _score: scoreMap[v.id] ?? 0 }))
      .sort((a, b) => b._score - a._score);

    // ─── 急上昇を中盤以降の等間隔に挿入（11番目から7間隔） ─────────────────
    const result = [...scoredVideos];
    let insertPos = 10;
    for (let i = trendingPool.length - 1; i >= 0; i--) {
      const pos = Math.min(
        10 + (trendingPool.length - 1 - i) * 7,
        result.length
      );
      result.splice(pos, 0, trendingPool[i]);
    }

    // ─── 整形して返却 ────────────────────────────────────────────────────────
    const finalList = result.slice(0, 100).map((v) => ({
      id: v.id,
      snippet: v.snippet || {},
      _score: v._score ?? null,
      _route: v._route,
    }));

    console.log(
      `[recommend] 完了: ${finalList.length}件 (candidates=${candidates.length})`
    );
    return jsonResponse({ items: finalList });
  } catch (error) {
    console.error("[recommend.js] 致命的エラー:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

module.exports = handler;
