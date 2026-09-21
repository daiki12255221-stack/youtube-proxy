// streaming.js
const fetch = require("node-fetch"); // node-fetchを明示的に使用

// 全サーバーリスト（27台）
const APIS = ["https://inv.nadeko.net/",
  "https://invidious.f5.si/",
  "https://invidious.lunivers.trade/",
  "https://invidious.ducks.party/",
  "https://iv.melmac.space/",
  "https://invidious.nerdvpn.de/",
  "https://invidious.privacyredirect.com",
  "https://invidious.technicalvoid.dev",
  "https://invidious.darkness.services",
  "https://invidious.nikkosphere.com",
  "https://invidious.schenkel.eti.br",
  "https://invidious.tiekoetter.com",
  "https://invidious.perennialte.ch",
  "https://invidious.reallyaweso.me",
  "https://invidious.private.coffee",
  "https://invidious.privacydev.net",
  "https://yewtu.be",
  "https://iv.nboeck.de",
  "https://inv.tux.pizza",
  "https://iv.ggtyler.dev",
  "https://yt.omada.cafe",
  "https://super8.absturztau.be",
  "https://invidious.adminforge.de",
  "https://youtube.alt.tyil.nl",
  "https://rust.oskamp.nl",
  "https://invidious.nietzospannend.nl",
  "https://youtube.mosesmang.com",];

const TARGET_QUALITIES = ["1080p", "720p", "480p", "360p"];

/**
 * 🏎️ 各インスタンスに対する非同期タスク
 */
async function raceTask(base, id, signal) {
  const baseUrl = base.endsWith("/") ? base.slice(0, -1) : base;

  // node-fetchに合わせた安全なリクエスト設定
  const response = await fetch(
    `${baseUrl}/api/v1/videos/${id}?hl=ja&region=JP`,
    {
      signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      },
    }
  );
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${baseUrl}`);

  const data = await response.json();
  let streamUrl = null;

  // 1. まずは 1080p や 720p の「映像＋音声」セットを探す
  for (const q of TARGET_QUALITIES) {
    const found = data.formatStreams?.find(
      (s) => s.qualityLabel === q || s.quality === q
    );
    if (found && found.url) {
      streamUrl = found.url;
      break;
    }
  }

  // 2. なければ adaptiveFormats から探す
  if (!streamUrl) {
    for (const q of ["1080p", "720p"]) {
      const found = data.adaptiveFormats?.find(
        (s) =>
          (s.qualityLabel === q || s.quality === q) &&
          s.type &&
          s.type.includes("video/mp4")
      );
      if (found && found.url) {
        streamUrl = found.url;
        break;
      }
    }
  }

  // 3. 最終手段
  if (!streamUrl && data.formatStreams?.length > 0) {
    streamUrl = data.formatStreams[0].url;
  }

  if (streamUrl) {
    return streamUrl;
  }
  throw new Error(`No URL in data from ${baseUrl}`);
}

/**
 * 🏁 複数インスタンスから最速でURLをもぎ取る共通レースロジック
 */
async function executeRace(id) {
  // ランダムにシャッフルして上位8台でレース
  const shuffledApis = [...APIS].sort(() => Math.random() - 0.5).slice(0, 8);

  const controller = new AbortController();
  // タイムアウトを4.5秒に少し緩和
  const timeoutId = setTimeout(() => controller.abort(), 4500);

  try {
    const fastestUrl = await Promise.any(
      shuffledApis.map((base) => raceTask(base, id, controller.signal))
    );
    clearTimeout(timeoutId);
    controller.abort(); // 他の遅れてる通信をキャンセル
    return fastestUrl;
  } catch (error) {
    clearTimeout(timeoutId);
    controller.abort();
    // ターミナルで原因を追えるようにログを出力
    console.error(
      `[streaming.js] レース全滅またはタイムアウト id=${id}:`,
      error.message || error
    );
    return null;
  }
}

/**
 * 🌐 メインAPIハンドラー（通常再生用）
 */
module.exports = async function handler(req, res) {
  const id = req.query.id;
  if (!id) {
    return res.status(400).send("Video ID is required");
  }

  try {
    const streamUrl = await executeRace(id);
    if (streamUrl) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.redirect(302, streamUrl);
    }
    return res
      .status(500)
      .send("全てのサーバーでストリームの取得に失敗しました。");
  } catch (err) {
    console.error("[streaming.js クリティカルエラー]:", err);
    return res.status(500).send("Internal Server Error");
  }
};

/**
 * 📥 download_proxy 用
 */
module.exports.getStreamUrl = async function getStreamUrl(id) {
  return await executeRace(id);
};
