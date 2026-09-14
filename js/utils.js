/* utils.js - 共通ユーティリティ関数
 * 日付表示・再生回数表示・タイムスタンプ解析など、どこからでも呼び出す純粋関数群。
 * 依存: なし（最初に読み込む）
 */

/* app.js - URL Routing System Integrated & AI Recommendations Updated (kanrenn.js利用版) */

// --- ユーティリティ ---
function timeAgo(dateString) {
  const now = new Date();
  const past = new Date(dateString);
  const diff = Math.floor((now - past) / 1000);
  if (diff < 60) return `${diff}秒前`;
  if (diff < 3600) return `${Math.floor(diff / 60)}分前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}時間前`;
  const days = Math.floor(diff / 86400);
  if (days < 30) return `${days}日前`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}ヶ月前`;
  return `${Math.floor(months / 12)}年前`;
}

function formatViews(views) {
  if (!views) return "0回";
  const num = parseInt(views);
  if (num >= 100000000) return `${(num / 100000000).toFixed(1)}億回`;
  if (num >= 10000) return `${(num / 10000).toFixed(1)}万回`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}千回`;
  return `${num}回`;
}

function parseTimestamp(text) {
  // "1:23:45" or "1:23" -> total seconds
  const parts = text.trim().split(":").map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

function interceptTimestampLinks(container) {
  // YouTube の textDisplay に含まれる <a href="...?t=..."> や /watch?t=... リンクを
  // preventDefault してプレイヤーをシークさせる
  container.querySelectorAll("a").forEach((a) => {
    if (a.dataset.tsHooked) return; // 重複フック防止
    const href = a.href || "";
    const text = a.textContent.trim();
    // タイムスタンプリンクの判定: hrefに ?t= が含まれる、またはテキストが M:SS / H:MM:SS 形式
    const isTimestamp =
      /[?&]t=\d+/.test(href) || /^\d+:\d{2}(:\d{2})?$/.test(text);
    if (!isTimestamp) return;
    a.dataset.tsHooked = "1"; // フック済みマーク
    a.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // 秒数の取得: hrefの?t= を優先、なければテキストをパース
      let seconds = null;
      const tMatch = href.match(/[?&]t=(\d+)/);
      if (tMatch) {
        seconds = parseInt(tMatch[1]);
      } else {
        seconds = parseTimestamp(text);
      }
      if (seconds === null) return;
      // iframe（Education等）の場合は YT.seek() で postMessage シーク
      const iframe = document.querySelector(
        ".video-wrapper iframe, .shorts-container iframe"
      );
      if (iframe) {
        YT.seek(seconds);
      } else {
        const video = document.querySelector("video");
        if (video) {
          video.currentTime = seconds;
          video.play();
        }
      }
    });
  });
}

function parseDuration(iso) {
  if (!iso) return "0:00";
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return "0:00";
  const h = parseInt(m[1] || 0);
  const min = parseInt(m[2] || 0);
  const sec = parseInt(m[3] || 0);
  if (h > 0)
    return `${h}:${String(min).padStart(2, "0")}:${String(sec).padStart(
      2,
      "0"
    )}`;
  return `${min}:${String(sec).padStart(2, "0")}`;
}
