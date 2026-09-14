/* yt-api.js - YouTube Data API ラッパー
 * APIキーのローテーション、動画情報取得、埋め込みURL生成などを担当。
 * 依存: utils.js（timeAgo等は使わないが読み込み順は utils -> storage の後を想定）
 *       Storage（getEmbedUrl内で使用） / Actions（showStatusNotification）/ SearchHandler（存在すれば優先使用）
 */

const YT = {
  keys: [
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
  ],
  currentEduKey: "",

  getVideoId(item) {
    if (!item) return "";
    return (
      item.id?.videoId ||
      item.contentDetails?.videoId ||
      item.contentDetails?.upload?.videoId ||
      item.snippet?.resourceId?.videoId ||
      (typeof item.id === "string" ? item.id : "")
    );
  },

  getProxiedThumb(video) {
    const vId = this.getVideoId(video);
    if (vId) return `/api/thumb?id=${vId}`;
    return (
      video.snippet?.thumbnails?.high?.url ||
      video.snippet?.thumbnails?.default?.url ||
      ""
    );
  },

  async refreshEduKey() {
    try {
      const response = await fetch("/api/get_key");
      if (!response.ok) throw new Error("APIアクセス失敗");
      const data = await response.json();
      if (data && data.key) {
        this.currentEduKey = data.key;
        Actions.showStatusNotification("最新キーを自動更新しました✅");
      }
    } catch (error) {
      console.error("自動収集エラー:", error);
    }
  },

  seek(seconds) {
    const iframe = document.querySelector(
      ".video-wrapper iframe, .shorts-container iframe"
    );
    if (iframe) {
      iframe.contentWindow.postMessage(
        JSON.stringify({
          event: "command",
          func: "seekTo",
          args: [seconds, true],
        }),
        "*"
      );
    }
  },

  getCurrentKey() {
    const index = parseInt(localStorage.getItem("yt_key_index")) || 0;
    return this.keys[index] || "";
  },

  rotateKey() {
    let index = (parseInt(localStorage.getItem("yt_key_index")) || 0) + 1;
    if (index >= this.keys.length) index = 0;
    localStorage.setItem("yt_key_index", index);
  },

  async fetchAPI(endpoint, params, _attempt = 0) {
    if (typeof SearchHandler !== "undefined") {
      return await SearchHandler.fetch(endpoint, params);
    }
    const queryParams = new URLSearchParams({
      ...params,
      key: this.getCurrentKey(),
    });
    const url = `https://www.googleapis.com/youtube/v3/${endpoint}?${queryParams.toString()}`;
    try {
      const response = await fetch(url);
      if (response.status === 403) {
        // 全キーを試し終えたら諦める（無限再帰防止）
        if (_attempt >= this.keys.length - 1) {
          console.warn("全APIキーの quota が枯渇しています");
          return { items: [], nextPageToken: "" };
        }
        this.rotateKey();
        return this.fetchAPI(endpoint, params, _attempt + 1);
      }
      if (!response.ok) throw new Error("API error: " + response.status);
      return await response.json();
    } catch (error) {
      return { items: [], nextPageToken: "" };
    }
  },

  getEmbedUrl(id, isShort = false) {
    const config = { enc: this.currentEduKey, hideTitle: true };
    const params = new URLSearchParams({
      autoplay: 1,
      origin: location.origin,
      embed_config: JSON.stringify(config),
      rel: 0,
      modestbranding: 1,
      enablejsapi: 1,
      v: id,
    });

    const resumeTime = Storage.getResumeTime(id);
    if (resumeTime > 0) params.append("start", resumeTime);

    if (isShort) {
      params.append("loop", "1");
      params.append("playlist", id);
    }
    return `https://www.youtubeeducation.com/embed/${id}?${params.toString()}`;
  },
};