const { Redis } = require("@upstash/redis");

// Vercel / Node サーバーの環境変数に設定する。
// UPSTASH_REDIS_REST_URL
// UPSTASH_REDIS_REST_TOKEN
const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

let redis = null;

function getRedis() {
  if (!redisUrl || !redisToken) {
    throw new Error("Upstash Redis の環境変数が設定されていません");
  }
  if (!redis) {
    redis = new Redis({ url: redisUrl, token: redisToken });
  }
  return redis;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const rawIds = String(req.query.ids || "");
    const channelIds = [...new Set(
      rawIds.split(",")
        .map((id) => id.trim())
        .filter((id) => /^UC[a-zA-Z0-9_-]{22}$/.test(id))
    )].slice(0, 100);

    if (channelIds.length === 0) {
      return res.status(200).json({ success: true, videos: [] });
    }

    const kv = getRedis();
    const values = await Promise.all(
      channelIds.map((id) => kv.get(`yt:feed:channel:${id}`))
    );

    const cutoff = Date.now() - 3 * 24 * 60 * 60 * 1000;
    const byVideoId = new Map();

    values.forEach((value) => {
      let items = value;
      if (typeof items === "string") {
        try {
          items = JSON.parse(items);
        } catch {
          items = [];
        }
      }
      if (!Array.isArray(items)) return;

      items.forEach((video) => {
        if (!video || !(video.videoId || video.id)) return;
        const published = Date.parse(video.publishedAt || "");
        if (!Number.isFinite(published) || published < cutoff) return;

        const id = video.videoId || video.id;
        const previous = byVideoId.get(id);
        if (!previous || published > Date.parse(previous.publishedAt || "")) {
          byVideoId.set(id, {
            videoId: id,
            title: video.title || "",
            channelId: video.channelId || "",
            channelTitle: video.channelTitle || video.channelName || "",
            thumbnail: video.thumbnail || "",
            publishedAt: video.publishedAt,
          });
        }
      });
    });

    const videos = [...byVideoId.values()].sort(
      (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)
    );

    return res.status(200).json({ success: true, videos });
  } catch (error) {
    console.error("[subs-feed] error:", error);
    return res.status(500).json({
      success: false,
      error: "新着動画の読み込みに失敗しました",
    });
  }
};
