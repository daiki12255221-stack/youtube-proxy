/* actions-library.js - 登録チャンネル・履歴・その他ライブラリ系
 * 購読チャンネルのタイムライン、後で見る一覧、シークレットモード、視聴履歴、ゲームメニューを担当。
 * Actions オブジェクトに Object.assign で機能を追加する。
 * 依存: actions-core.js（先に Actions を定義していること） / utils.js / yt-api.js / storage.js
 */

Object.assign(Actions, {
  async showSubs(skipPush = false) {
    if (!skipPush) window.history.pushState(null, "", "?mode=subs");
    this.currentView = "subs";
    const subs = Storage.get("yt_subs");

    const scrollStyles = `display: flex; overflow-x: auto; gap: 20px; padding: 20px; background: #0f0f0f; border-bottom: 1px solid #333; scrollbar-width: none; -ms-overflow-style: none;`;
    const channelItemsHtml = subs
      .map(
        (ch) => `
            <div style="flex: 0 0 auto; text-align: center; width: 85px; cursor: pointer;" onclick="Actions.showChannel('${ch.id}')">
                <div style="position:relative; width:65px; height:65px; margin: 0 auto;">
                    <img src="${ch.thumb}" style="width: 100%; height: 100%; border-radius: 50%; border: 2px solid #444; object-fit: cover;">
                </div>
                <div style="font-size: 11px; color: #fff; margin-top: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 0 2px;">${ch.name}</div>
            </div>`
      )
      .join("");

    const subHtml = `
            <div style="${scrollStyles}" class="no-scrollbar">${channelItemsHtml}</div>
            <div style="padding: 20px;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <h2 style="margin:0;">最新タイムライン</h2>
                    <span style="font-size:12px; color:#aaa;">(3日以内の一括取得)</span>
                </div>
                <div id="subs-timeline-grid" class="grid" style="margin-top:20px;">タイムライン読み込み中...</div>
            </div>`;
    this.Maps(subHtml);

    try {
      // 新着動画はGASが収集してRedisに保存済み。ブラウザからYouTube APIは呼び出さない。
      const channelIds = subs.map((ch) => ch.id).filter(Boolean);
      if (channelIds.length === 0) {
        this.currentList = [];
        const emptyGrid = document.getElementById("subs-timeline-grid");
        if (emptyGrid) {
          emptyGrid.innerHTML =
            `<p style="color:#aaa; text-align:center; grid-column: 1/-1; padding:40px;">チャンネルを登録すると新着動画が表示されます。</p>`;
        }
        return;
      }

      const response = await fetch(
        `/api/subs-feed?ids=${encodeURIComponent(channelIds.join(","))}`,
        { method: "GET", cache: "no-store" }
      );
      if (!response.ok) throw new Error(`Subs feed API error: ${response.status}`);

      const feedData = await response.json();
      const timelineVideos = (feedData.videos || []).map((video) => ({
        id: video.videoId || video.id,
        snippet: {
          title: video.title || "",
          thumbnails: {
            high: { url: video.thumbnail || "" },
          },
          channelTitle: video.channelTitle || video.channelName || "",
          channelId: video.channelId || "",
          publishedAt: video.publishedAt || "",
        },
      }));

      this.currentList = timelineVideos;
      // 統計情報取得のためのYouTube API呼び出しもここでは行わない。
      const grid = document.getElementById("subs-timeline-grid");
      if (grid)
        grid.innerHTML =
          timelineVideos.length === 0
            ? `<p style="color:#aaa; text-align:center; grid-column: 1/-1; padding:40px;">最近の新着動画はありません。</p>`
            : this.renderCards(timelineVideos);
    } catch (e) {
      if (document.getElementById("subs-timeline-grid"))
        document.getElementById("subs-timeline-grid").innerHTML =
          "取得に失敗しました。";
    }
  },

  showWatchLater(skipPush = false) {
    if (!skipPush) window.history.pushState(null, "", "?mode=watchlater");
    this.currentView = "watchlater";
    const list = Storage.get("yt_watchlater");
    this.currentList = list.map((x) => ({
      id: x.id,
      snippet: {
        title: x.title,
        thumbnails: { high: { url: x.thumb } },
        channelTitle: x.channelTitle,
        channelId: x.channelId,
        publishedAt: x.savedAt || new Date().toISOString(),
      },
    }));
    this.activePlaylistName = "後で見る";
    this.renderGrid("<h2>📌 後で見る</h2>");
  },

  toggleIncognito() {
    const current = Storage.isIncognito();
    Storage.setIncognito(!current);
    const item = document.getElementById("nav-incognito");
    if (item) {
      const isInc = !current;
      item.style.color = isInc ? "#00ff00" : "#aaa";
      item.innerHTML = `👤<span>${
        isInc ? "シークレット: ON" : "シークレット: OFF"
      }</span>`;
    }
    Actions.showStatusNotification(
      current
        ? "シークレットモードを終了しました"
        : "シークレットモードを開始しました。履歴は保存されません。"
    );
  },

  showHistory(skipPush = false) {
    if (!skipPush) window.history.pushState(null, "", "?mode=history");
    this.currentView = "history";
    const history = Storage.get("yt_history");
    this.currentList = history.map((x) => ({
      id: x.id,
      views: x.views,
      snippet: {
        title: x.title,
        thumbnails: { high: { url: x.thumb } },
        channelTitle: x.channelTitle,
        publishedAt: x.publishedAt || new Date().toISOString(),
      },
    }));
    this.activePlaylistName = null;

    let html = `
            <div style="padding:20px;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <h2>履歴</h2>
                    <button class="btn" onclick="Storage.clearAllHistory()" style="background:#ff4e45; color:white; font-size:12px;">すべて削除</button>
                </div>
                <div class="grid" style="margin-top:20px;">`;
    if (history.length === 0) {
      html += `<p style="padding:40px; color:#aaa; grid-column:1/-1; text-align:center;">視聴履歴はありません。</p>`;
    } else {
      this.currentList.forEach((v, i) => {
        html += `
                <div class="v-card">
                    <div class="thumb-container" onclick="Actions.playFromList(${i})">
                        <img src="${
                          v.snippet.thumbnails.high.url
                        }" class="main-thumb">
                        <span class="video-duration">${
                          this.videoDurations[v.id] || ""
                        }</span>
                    </div>
                    <div class="v-text">
                        <div class="card-avatar-container">
                            <img src="${
                              this.channelIcons[
                                v.snippet && v.snippet.channelId
                              ] || "/api/thumb?id=" + v.id
                            }" class="card-avatar">
                        </div>
                        <div class="card-info-content">
                            <h3>${v.snippet.title}</h3>
                            <p>${v.snippet.channelTitle}</p>
                            <p>${formatViews(v.views)} • ${timeAgo(
          v.snippet.publishedAt
        )}</p>
                            <button class="btn" onclick="Storage.deleteHistoryItem('${
                              v.id
                            }'); Actions.showHistory(true);" style="margin-top:5px; font-size:10px; padding:2px 5px; background:#444;">削除</button>
                        </div>
                    </div>
                </div>`;
      });
    }
    html += `</div></div>`;
    this.Maps(html);
  },

  showGame(skipPush = false) {
    if (!skipPush) window.history.pushState(null, "", "?mode=game");
    window.scrollTo(0, 0);
    if (typeof M3U8Player !== "undefined") M3U8Player.stopPlayer();
    GameModule.renderGameMenu();
  },
});
