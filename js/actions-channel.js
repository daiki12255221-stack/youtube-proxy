/* actions-channel.js - チャンネルページ系
 * チャンネル情報表示、動画/再生リスト切替、並び替え、登録状態管理を担当。
 * Actions オブジェクトに Object.assign で機能を追加する。
 * 依存: actions-core.js（先に Actions を定義していること） / utils.js / yt-api.js / storage.js
 */

Object.assign(Actions, {
  // --- チャンネルページ用 UIとロジック（UI大型化・分離版） ---
  async showChannel(chId, skipPush = false) {
    if (typeof this.removeShortsSwipe === "function") this.removeShortsSwipe();
    if (!skipPush) window.history.pushState(null, "", "?channel=" + chId);
    this.currentView = "channel";

    // チャンネルを開いた時の初期状態
    this.chState = { type: "videos", sort: "date" };

    const chData = await YT.fetchAPI("channels", {
      id: chId,
      part: "snippet,brandingSettings",
    });
    const ch = chData.items[0];
    const isSubbed = Storage.get("yt_subs").some((x) => x.id === chId);

    const channelHtml = `
            <div class="channel-header">
                <div style="width:100%; height:150px; background:url(${
                  ch.brandingSettings?.image?.bannerExternalUrl || ""
                }) center/cover #333; border-radius:15px;"></div>
                <div style="display:flex; align-items:center; padding:20px;">
                    <img src="${
                      ch.snippet.thumbnails.medium.url
                    }" style="width:80px; height:80px; border-radius:50%;">
                    <div style="margin-left:20px;"><h1>${
                      ch.snippet.title
                    }</h1><p style="color:#aaa;">${
      ch.snippet.customUrl
    }</p></div>
                    <button class="btn ${
                      isSubbed ? "subbed" : ""
                    }" style="margin-left:auto;" onclick="Actions.handleSub('${chId}', '${ch.snippet.title.replace(
      /'/g,
      "\\\\'"
    )}', true)">${isSubbed ? "登録済み" : "登録"}</button>
                </div>
                
                <div style="padding: 10px 20px;">
                    <div style="display:flex; gap:30px; flex-wrap:wrap; margin-bottom:20px; border-bottom:1px solid #333; padding-bottom:20px;">
                        <div id="ch-type-videos" class="ch-type-btn" onclick="Actions.changeChType('${chId}', 'videos')" style="padding:15px 40px; font-size:18px; font-weight:bold; border-radius:30px; cursor:pointer; transition:all 0.3s ease;">🎬 動画</div>
                        <div id="ch-type-shorts" class="ch-type-btn" onclick="Actions.changeChType('${chId}', 'shorts')" style="padding:15px 40px; font-size:18px; font-weight:bold; border-radius:30px; cursor:pointer; transition:all 0.3s ease;">⚡ ショート</div>
                        <div id="ch-type-playlists" class="ch-type-btn" onclick="Actions.changeChType('${chId}', 'playlists')" style="padding:15px 40px; font-size:18px; font-weight:bold; border-radius:30px; cursor:pointer; transition:all 0.3s ease;">📂 再生リスト</div>
                    </div>
                    
                    <div id="ch-sort-container" style="display:flex; gap:20px; margin-bottom:10px;">
                        <div id="ch-sort-date" class="ch-sort-btn" onclick="Actions.changeChSort('${chId}', 'date')" style="padding:10px 25px; font-size:15px; font-weight:bold; border-radius:20px; cursor:pointer; transition:all 0.3s ease;">🕒 最新順</div>
                        <div id="ch-sort-viewCount" class="ch-sort-btn" onclick="Actions.changeChSort('${chId}', 'viewCount')" style="padding:10px 25px; font-size:15px; font-weight:bold; border-radius:20px; cursor:pointer; transition:all 0.3s ease;">🔥 人気順</div>
                    </div>
                </div>
            </div>
            <div id="channel-content-grid" class="grid" style="padding: 0 20px;"></div>
            <div id="more-btn-area" style="padding: 0 20px;"></div>`;
    this.Maps(channelHtml);

    // UIの初期発光設定とデータ取得
    this.updateChUI();
    this.fetchChData(chId);
  },

  changeChType(chId, type) {
    this.chState.type = type;
    this.updateChUI();
    this.fetchChData(chId);
  },

  changeChSort(chId, sort) {
    this.chState.sort = sort;
    this.updateChUI();
    this.fetchChData(chId);
  },

  updateChUI() {
    // メインカテゴリのUIリセット＆発光
    document.querySelectorAll(".ch-type-btn").forEach((b) => {
      b.style.background = "#222";
      b.style.boxShadow = "none";
      b.style.border = "2px solid transparent";
      b.style.color = "#fff";
    });
    const activeType = document.getElementById("ch-type-" + this.chState.type);
    if (activeType) {
      activeType.style.background = "#1a1a1a";
      activeType.style.boxShadow = "0 0 20px rgba(62, 166, 255, 0.6)";
      activeType.style.border = "2px solid #3ea6ff";
      activeType.style.color = "#3ea6ff";
    }

    // 並び替えメニューのUIリセット＆発光（再生リストの場合は非表示）
    const sortContainer = document.getElementById("ch-sort-container");
    if (this.chState.type === "playlists") {
      sortContainer.style.display = "none";
    } else {
      sortContainer.style.display = "flex";
      document.querySelectorAll(".ch-sort-btn").forEach((b) => {
        b.style.background = "#222";
        b.style.boxShadow = "none";
        b.style.border = "1px solid transparent";
        b.style.color = "#fff";
      });
      const activeSort = document.getElementById(
        "ch-sort-" + this.chState.sort
      );
      if (activeSort) {
        activeSort.style.background = "#1a1a1a";
        activeSort.style.boxShadow = "0 0 15px rgba(0, 255, 136, 0.5)";
        activeSort.style.border = "1px solid #00ff88";
        activeSort.style.color = "#00ff88";
      }
    }
  },

  async fetchChData(chId) {
    const grid = document.getElementById("channel-content-grid");
    grid.innerHTML =
      "<div style='padding:40px; text-align:center;'>読込中...</div>";

    if (this.chState.type === "videos") {
      if (typeof this.removeShortsSwipe === "function")
        this.removeShortsSwipe();
      this.currentView = "channel";
      this.currentParams = {
        channelId: chId,
        part: "snippet",
        type: "video",
        order: this.chState.sort,
        maxResults: 24,
      };
      const data = await YT.fetchAPI("search", this.currentParams);
      let items = data.items || [];
      this.nextToken = data.nextPageToken || "";

      // クライアント側で #shorts を含むタイトルを除外
      items = items.filter((item) => {
        const title = item.snippet?.title?.toLowerCase() || "";
        return !title.includes("#shorts") && !title.includes("shorts");
      });

      this.currentList = items;
      await this.fillStats(this.currentList);
      grid.innerHTML = this.renderCards(this.currentList);
    } else if (this.chState.type === "shorts") {
      this.currentView = "channel_shorts";
      this.currentParams = {
        channelId: chId,
        part: "snippet",
        type: "video",
        videoDuration: "short",
        order: this.chState.sort,
        maxResults: 24,
      };
      const data = await YT.fetchAPI("search", this.currentParams);
      this.currentList = data.items || [];
      this.nextToken = data.nextPageToken || "";

      await this.fillStats(this.currentList);
      grid.innerHTML = this.renderCards(this.currentList);

      // チャンネルのショートでもスワイプを有効化
      if (typeof this.initShortsSwipe === "function") {
        this.initShortsSwipe();
      }
    } else if (this.chState.type === "playlists") {
      if (typeof this.removeShortsSwipe === "function")
        this.removeShortsSwipe();
      this.currentView = "channel_playlists";
      this.currentParams = { channelId: chId, part: "snippet", maxResults: 24 };
      const data = await YT.fetchAPI("playlists", this.currentParams);
      this.currentList = data.items || [];
      this.nextToken = data.nextPageToken || "";
      grid.innerHTML = this.renderCards(this.currentList);
    }
    document.getElementById("more-btn-area").innerHTML = this.nextToken
      ? `<button class="btn" onclick="Actions.loadMore()" style="width:100%; margin:20px 0; background:#333; color:#fff; padding:15px; font-size:16px;">もっと読み込む</button>`
      : "";
  },

  async showPlaylistView(plId, title, skipPush = false) {
    if (typeof this.removeShortsSwipe === "function") this.removeShortsSwipe();
    if (!skipPush)
      window.history.pushState(
        null,
        "",
        `?playlist=${plId}&title=${encodeURIComponent(title)}`
      );
    this.currentView = "playlist";
    this.activePlaylistName = title;
    this.currentParams = {
      playlistId: plId,
      part: "snippet,contentDetails",
      maxResults: 24,
    };
    const data = await YT.fetchAPI("playlistItems", this.currentParams);
    this.currentList = data.items || [];
    this.nextToken = data.nextPageToken || "";
    await this.fillStats(this.currentList);
    this.renderGrid(`<h2>再生リスト: ${title}</h2>`);
  },

  handleSub(id, name, refresh = false) {
    Storage.toggleSub({ id, name, thumb: this.channelIcons[id] || "" });
    if (refresh) {
      if (this.currentView === "channel") this.showChannel(id, true);
      else if (this.currentIndex !== -1 && this.currentView !== "subs")
        this.play(this.currentList[this.currentIndex], true);
    }
  },
});
