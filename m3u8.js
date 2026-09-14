const fetch = require("node-fetch");

const INVIDIOUS_INSTANCES = [ "https://ppgzlx-3000.csb.app/",];

module.exports = async function (req, res) {
  // CORSヘッダーを最優先で適用
  res.setHeader("Access-Control-Allow-Origin", "*");

  const videoId = req.query.id;
  if (!videoId) {
    res.setHeader("Content-Type", "application/json");
    return res.status(400).json({ error: "Video ID (id) is required" });
  }

  // ─── 段階②: フロント（hls.jsやSafari）が実際にストリーム指示書を読み込むフェーズ ───
  if (req.query.type === "master") {
    res.setHeader(
      "Content-Type",
      "application/vnd.apple.mpegurl; charset=utf-8"
    );

    const host = req.get("host");
    const protocol =
      req.headers["x-forwarded-proto"] || req.protocol || "https";

    const vUrl = req.query.vUrl || "";
    const aUrl = req.query.aUrl || "";

    // 🌟【最重要ロジック】映像と音声の独立したDASH生URLを、HLS（m3u8）のマスタープレイリスト規格に完璧に翻訳
    // フロントのhls.jsやSafariはこの指示書を読み込むことで、裏で映像と音声を自動合流させて再生します
    let m3u8 = `#EXTM3U\n`;
    m3u8 += `#EXT-X-VERSION:4\n`;

    // 1. まず音声用のサブプレイリスト（メディア制御タグ）を定義
    m3u8 += `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio-group",NAME="Japanese",DEFAULT=YES,AUTOSELECT=YES,URI="${protocol}://${host}/api/m3u8?type=substream&url=${vUrl}"\n`;

    // 2. 次に映像ストリームと上記音声グループをバインド（紐付け）
    m3u8 += `#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,AUDIO="audio-group",CODECS="avc1.64002a,mp4a.40.2"\n`;
    m3u8 += `${protocol}://${host}/api/m3u8?type=substream&url=${vUrl}\n`;

    return res.status(200).send(m3u8);
  }

  // ─── 段階③: 映像・音声それぞれの生データをHLSセグメントとして流し込むサブフェーズ ───
  if (req.query.type === "substream") {
    res.setHeader(
      "Content-Type",
      "application/vnd.apple.mpegurl; charset=utf-8"
    );
    const rawUrl = decodeURIComponent(req.query.url || "");

    // 単一ストリームをVODとして安全に再生させるためのHLS下位レイヤー指示書
    let m3u8 = `#EXTM3U\n`;
    m3u8 += `#EXT-X-VERSION:3\n`;
    m3u8 += `#EXT-X-TARGETDURATION:36000\n`; // 長尺動画でも途切れないようにバッファを巨大化
    m3u8 += `#EXT-X-MEDIA-SEQUENCE:0\n`;
    m3u8 += `#EXT-X-PLAYLIST-TYPE:VOD\n`;
    m3u8 += `#EXTINF:36000.0,\n`; // 1本の巨大なセグメントとして生URLをそのまま認識させる
    m3u8 += `${rawUrl}\n`;
    m3u8 += `#EXT-X-ENDLIST\n`;

    return res.status(200).send(m3u8);
  }

  // ─── 段階①: 最初のURL解決フェーズ（フロントからのアクセスをトリガーに最速インスタンスからURLを抜く） ───
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  const dashRaceTask = async (instanceUrl) => {
    const baseUrl = instanceUrl.endsWith("/")
      ? instanceUrl.slice(0, -1)
      : instanceUrl;

    const response = await fetch(
      `${baseUrl}/api/v1/videos/${videoId}?hl=ja&region=JP`,
      {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      }
    );
    if (!response.ok) throw new Error("Fetch failed");

    const data = await response.json();
    if (!data || !data.adaptiveFormats) throw new Error("No adaptive formats");

    // あなたのアプリのDASH再生部で絶大な信頼性のあるURL選別ロジックをそのまま使用
    const targetVideo =
      data.adaptiveFormats.find(
        (f) =>
          f.resolution === "1080p" ||
          f.size === "1920x1080" ||
          f.qualityLabel === "1080p"
      ) ||
      data.adaptiveFormats.find((f) => f.qualityLabel === "720p") ||
      data.adaptiveFormats.find((f) => f.type && f.type.includes("video")) ||
      data.adaptiveFormats[0];

    const targetAudio =
      data.adaptiveFormats.find(
        (f) =>
          f.type &&
          f.type.includes("audio") &&
          (f.language === "ja" ||
            f.lang === "ja" ||
            (f.label &&
              (f.label.includes("日本語") ||
                f.label.toLowerCase().includes("japanese"))))
      ) || data.adaptiveFormats.find((f) => f.type && f.type.includes("audio"));

    if (targetVideo?.url && targetAudio?.url) {
      const host = req.get("host");
      const protocol =
        req.headers["x-forwarded-proto"] || req.protocol || "https";

      const encV = encodeURIComponent(targetVideo.url);
      const encA = encodeURIComponent(targetAudio.url);

      // フロントエンドに「このURLをvideoタグに突っ込めば、映像と音声がマージされたHLSになるよ」という特製マスターURLを生成
      const masterHlsUrl = `${protocol}://${host}/api/m3u8?id=${videoId}&type=master&vUrl=${encV}&aUrl=${encA}`;

      return { hlsUrl: masterHlsUrl, instance: baseUrl };
    }
    throw new Error("Streams not found");
  };

  try {
    // 27台のインスタンスから、DASHストリームのURLを一番早く返してくれた優秀なサーバーを1台掴まえる
    const tasks = INVIDIOUS_INSTANCES.map((url) =>
      dashRaceTask(url).catch(() => null)
    );
    const results = await Promise.all(tasks);
    const successResult = results.find((r) => r !== null);

    if (successResult) {
      console.log(
        "🚀 [自作HLSプロキシ成功] インスタンスドメイン:",
        successResult.instance
      );
      return res.status(200).json({
        hlsUrl: successResult.hlsUrl,
        source: successResult.instance,
      });
    }

    throw new Error("All instances failed");
  } catch (raceError) {
    console.error(
      "[m3u8.js 自作マスター生成エラー]:",
      raceError.message || raceError
    );
    return res.status(500).json({
      error: "Failed to construct multiplexed HLS stream",
      details: raceError.message || String(raceError),
    });
  }
};
