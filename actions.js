/* actions-search.js - 検索・一覧表示系
 * 検索サジェスト、検索実行、カード/グリッド描画、もっと読み込むを担当。
 * Actions オブジェクトに Object.assign で機能を追加する。
 * 依存: actions-core.js（先に Actions を定義していること） / utils.js / yt-api.js / storage.js
 */

Object.assign(Actions, {
  async fetchSuggestions(q) {
    try {
      const res = await fetch(`/api/suggest?q=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error("suggest API error: " + res.status);
      const data = await res.json();
      this.renderSuggestDropdown(data.suggestions || []);
    } catch (e) {
      console.error("サジェスト取得エラー:", e);
      this.hideSuggestDropdown();
    }
  },

  renderSuggestDropdown(suggestions) {
    const dropdown = document.getElementById("search-history-dropdown");
    if (!dropdown) return;

    if (!suggestions.length) {
      this.hideSuggestDropdown();
      return;
    }

    const escapeHtml = (str) =>
      str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

    dropdown.innerHTML = suggestions
      .map((s) => {
        const safe = escapeHtml(String(s));
        return `
          <div class="history-dropdown-item suggest-item" data-q="${safe}">
            <span>🔍 ${safe}</span>
          </div>`;
      })
      .join("");

    dropdown.querySelectorAll(".suggest-item").forEach((el) => {
      el.addEventListener("click", () => {
        const q = el.dataset.q;
        document.getElementById("search-input").value = q;
        this.hideSuggestDropdown();
        this.search();
      });
    });

    dropdown.style.display = "block";
  },

  hideSuggestDropdown() {
    const dropdown = document.getElementById("search-history-dropdown");
    if (dropdown) {
      dropdown.style.display = "none";
      dropdown.innerHTML = "";
    }
  },

  async search(skipPush = false) {
    const q = document.getElementById("search-input").value;
    if (!q) return;
    if (!skipPush)
      window.history.pushState(null, "", "?search=" + encodeURIComponent(q));

    // 検索履歴をローカルストレージに保存（最大10件・重複排除・最新を先頭に）
    if (!Storage.isIncognito()) {
      let searchHistory = Storage.get("yt_search_history");
      if (!Array.isArray(searchHistory)) searchHistory = [];
      searchHistory = [q, ...searchHistory.filter((item) => item !== q)].slice(
        0,
        10
      );
      Storage.set("yt_search_history", searchHistory);
    }

    let finalQ = q;
    const vParams = { part: "snippet", maxResults: 15, type: "video" };
    let includePlaylists = true;
    if (this.currentView === "shorts") {
      finalQ = `${q} #shorts`;
      vParams.videoDuration = "short";
      includePlaylists = false;
    } else if (this.currentView === "live") {
      vParams.eventType = "live";
      includePlaylists = false;
    }
    vParams.q = finalQ;
    this.currentParams = vParams;
    const promises = [YT.fetchAPI("search", vParams)];
    if (includePlaylists) {
      promises.push(
        YT.fetchAPI("search", {
          q,
          part: "snippet",
          maxResults: 5,
          type: "playlist",
        })
      );
    }
    const results = await Promise.all(promises);
    const vData = results[0];
    const plData = results[1] || { items: [] };
    const limitedPlaylists = plData.items.slice(0, 5);
    this.currentList = [...limitedPlaylists, ...vData.items];
    this.nextToken = vData.nextPageToken || "";
    this.activePlaylistName = null;
    await this.fillStats(this.currentList);
    this.renderGrid(`<h2>"${q}" の検索結果</h2>`);
  },

  renderCards(items) {
    return items
      .map((item, index) => {
        const snip = item.snippet;
        const thumb = YT.getProxiedThumb(item);
        const isPlaylist = !!(
          item.id?.playlistId || item.kind === "youtube#playlist"
        );
        const isLive = snip.liveBroadcastContent === "live";
        const vId = YT.getVideoId(item);
        const plId =
          item.id?.playlistId || (typeof item.id === "string" ? item.id : "");
        const stats = vId ? this.videoStats[vId] : null;
        const metaInfo = isPlaylist
          ? `<span style="color:#3ea6ff; font-weight:bold;">📋 再生リスト</span>`
          : `<span>${formatViews(stats)} • ${timeAgo(snip.publishedAt)}</span>`;
        const glowStyle = isLive
          ? "box-shadow: 0 0 15px #ff0000; border: 2px solid #ff0000;"
          : "";
        return `
            <div class="v-card" style="${glowStyle}">
                <div class="thumb-container" onclick="${
                  isPlaylist
                    ? `Actions.showPlaylistView('${plId}', '${snip.title.replace(
                        /'/g,
                        ""
                      )}')`
                    : `Actions.playFromList(${index})`
                }">
                    <img src="${thumb}" class="main-thumb">
                    ${
                      isPlaylist
                        ? '<div style="position:absolute; top:0; right:0; bottom:0; width:40%; background:rgba(0,0,0,0.6); display:flex; align-items:center; justify-content:center; font-size:24px;">☰</div>'
                        : ""
                    }
                    ${
                      isLive
                        ? '<div class="live-badge" style="background:#ff0000;">● LIVE</div>'
                        : ""
                    }
                    ${
                      !isPlaylist
                        ? `<span class="video-duration">${
                            vId && this.videoDurations[vId]
                              ? this.videoDurations[vId]
                              : ""
                          }</span>`
                        : ""
                    }
                </div>
                <div class="v-text">
                    <div class="card-avatar-container">
                        <img src="${
                          this.channelIcons[snip.channelId] || ""
                        }" class="card-avatar" data-chid="${snip.channelId}">
                    </div>
                    <div class="card-info-content">
                        <h3 style="${isLive ? "color:#ff4e45;" : ""}">${
          snip.title
        }</h3>
                        <p>${snip.channelTitle}</p>
                        <p>${metaInfo}</p>
                    </div>
                </div>
            </div>`;
      })
      .join("");
  },

  renderGrid(headerHtml = "", skipScroll = false) {
    const container = document.getElementById("view-container");
    const moreBtn = this.nextToken
      ? `<button class="btn" onclick="Actions.loadMore()" style="width:100%; margin:20px 0; background:#333; color:#fff;">もっと読み込む</button>`
      : "";
    if (headerHtml) container.dataset.header = headerHtml;
    const currentHeader = container.dataset.header || "";
    const finalHtml = `<div style="padding: 10px 20px;">${currentHeader}</div><div class="grid">${this.renderCards(
      this.currentList
    )}</div>${moreBtn}`;

    this.Maps(finalHtml, skipScroll);

    const ids = this.currentList
      .map((i) => i.snippet?.channelId)
      .filter((id) => id && !this.channelIcons[id])
      .join(",");
    if (ids) this.fetchMissingIcons(ids);
  },

  async loadMore() {
    if (!this.nextToken) return;
    let endpoint = "search";
    if (this.currentView === "home" && !this.currentParams.q)
      endpoint = "videos";
    else if (this.currentView === "playlist") endpoint = "playlistItems";
    else if (this.currentView === "channel_playlists") endpoint = "playlists";

    const data = await YT.fetchAPI(endpoint, {
      ...this.currentParams,
      pageToken: this.nextToken,
    });
    let newItems = data.items || [];

    // チャンネルでの横長動画の追加読み込み時もショートを除外
    if (this.currentView === "channel") {
      newItems = newItems.filter((item) => {
        const title = item.snippet?.title?.toLowerCase() || "";
        return !title.includes("#shorts") && !title.includes("shorts");
      });
    }

    await this.fillStats(newItems);
    this.currentList = [...this.currentList, ...newItems];
    this.nextToken = data.nextPageToken || "";

    this.renderGrid("", true);
  },

});