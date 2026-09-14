/* actions-home.js - ホーム・おすすめ・マイプレイリスト系
 * ホーム画面、AIおすすめ、急上昇、ショート、ライブ配信、マイプレイリスト管理などを担当。
 * Actions オブジェクトに Object.assign で機能を追加する。
 * 依存: actions-core.js（先に Actions を定義していること） / utils.js / yt-api.js / storage.js
 */

Object.assign(Actions, {
  showResumeList(skipPush = false) {
    this.removeShortsSwipe(); // 他画面遷移時にスワイプ解除
    if (!skipPush) window.history.pushState(null, "", "?mode=resume");
    this.currentView = "resume";
    const list = Storage.get("yt_resume_list");

    if (list.length === 0) {
      this.Maps(
        `<div style="padding:40px; text-align:center;"><h2>🕒 続きから見る動画はありません</h2><p style="color:#aaa;">視聴途中の動画がここに3つまで表示されます。</p></div>`
      );
      return;
    }

    this.currentList = list.map((x) => ({
      id: x.id,
      snippet: {
        title: x.title,
        thumbnails: { high: { url: x.thumb } },
        channelTitle: x.channelTitle,
        publishedAt: new Date(x.timestamp).toISOString(),
      },
    }));

    let html = `<div style="padding:20px;"><h2>🕒 続きから見る</h2><div class="grid">`;
    list.forEach((v, i) => {
      const progress = (v.time / v.duration) * 100;
      html += `
            <div class="v-card">
                <div class="thumb-container" onclick="Actions.playFromList(${i})">
                    <img src="${v.thumb}" class="main-thumb">
                    <div style="position:absolute; bottom:0; left:0; height:4px; width:${progress}%; background:#ff0000;"></div>
                    <span class="video-duration">${parseDuration(
                      "PT" +
                        Math.floor(v.duration / 60) +
                        "M" +
                        (v.duration % 60) +
                        "S"
                    )}</span>
                </div>
                <div class="v-text">
                    <div class="card-avatar-container">
                        <img src="/api/thumb?id=${v.id}" class="card-avatar">
                    </div>
                    <div class="card-info-content">
                        <h3>${v.title}</h3>
                        <p>${v.channelTitle}</p>
                        <p style="font-size:11px; color:#ff8c00;">再生再開位置: ${Math.floor(
                          v.time / 60
                        )}分${v.time % 60}秒</p>
                    </div>
                </div>
            </div>`;
    });
    html += `</div></div>`;
    this.Maps(html);
  },

  async fillStats(items) {
    const ids = items.map((i) => YT.getVideoId(i)).filter((id) => id);
    if (!ids.length) return;

    const batches = [];
    for (let i = 0; i < ids.length; i += 50) batches.push(ids.slice(i, i + 50));

    await Promise.all(
      batches.map(async (batch) => {
        const data = await YT.fetchAPI("videos", {
          id: batch.join(","),
          part: "statistics,contentDetails",
        });
        if (data.items) {
          data.items.forEach((v) => {
            this.videoStats[v.id] = v.statistics?.viewCount;
            this.videoDurations[v.id] = parseDuration(
              v.contentDetails?.duration
            );
          });
        }
      })
    );
  },

  showMyPlaylists(skipPush = false) {
    this.removeShortsSwipe();
    if (!skipPush) window.history.pushState(null, "", "?mode=playlists");
    this.currentView = "my_playlists";
    const dict = Storage.getMyPlaylists();
    let html = `<div style="padding:20px;"><div style="display:flex; justify-content:space-between; align-items:center;"><h2>📂 マイプレイリスト</h2><button class="btn" onclick="Actions.createNewPlaylistPrompt()" style="background:#3ea6ff; color:#fff;">＋ 新規作成</button></div><div class="grid" style="margin-top:20px;">`;
    Object.keys(dict).forEach((name) => {
      const count = dict[name].length;
      const thumb = count > 0 ? dict[name][0].thumb : "";
      html += `<div class="v-card"><div class="thumb-container" style="background:#333; display:flex; align-items:center; justify-content:center;" onclick="Actions.viewPlaylistDetail('${name.replace(
        /'/g,
        "\\\\'"
      )}')">${
        thumb
          ? `<img src="${thumb}" class="main-thumb">`
          : '<span style="font-size:40px;">📂</span>'
      }<div style="position:absolute; bottom:5px; right:5px; background:rgba(0,0,0,0.8); padding:2px 8px; border-radius:4px; font-size:12px;">${count}本</div></div><div class="v-text"><div class="card-avatar-container"></div><div class="card-info-content"><h3>${name}</h3><p></p><p></p><button class="btn" onclick="event.stopPropagation(); Actions.deletePlaylistConfirm('${name.replace(
        /'/g,
        "\\\\'"
      )}')" style="margin-top:5px; font-size:11px; padding:2px 8px;">削除</button></div></div></div>`;
    });
    html += `</div></div>`;
    this.Maps(html);
  },

  createNewPlaylistPrompt() {
    const name = prompt("プレイリスト名を入力してください:");
    if (name) {
      Storage.createPlaylist(name);
      this.showMyPlaylists();
    }
  },

  deletePlaylistConfirm(name) {
    if (confirm(`プレイリスト「${name}」を削除しますか？`)) {
      Storage.deletePlaylist(name);
      this.showMyPlaylists();
    }
  },

  viewPlaylistDetail(name, skipPush = false) {
    this.removeShortsSwipe();
    if (!skipPush)
      window.history.pushState(null, "", "?list=" + encodeURIComponent(name));
    this.currentView = "playlist_detail";
    this.activePlaylistName = name;
    const dict = Storage.getMyPlaylists();
    const list = dict[name] || [];
    this.currentList = list.map((v) => ({
      id: v.id,
      snippet: {
        title: v.title,
        thumbnails: { high: { url: v.thumb } },
        channelTitle: v.channelTitle,
      },
    }));
    let html = `
            <div style="padding:20px;">
                <h2>📂 ${name}</h2>
                <button class="btn" onclick="Actions.playFromList(0)" style="margin-bottom:20px; background:#fff; color:#000;">▶ すべて再生</button>
                <div class="grid">
                    ${list
                      .map(
                        (v, i) => `
                        <div class="v-card">
                            <div class="thumb-container" onclick="Actions.playFromList(${i})">
                                <img src="${v.thumb}" class="main-thumb">
                                <span class="video-duration">${
                                  Actions.videoDurations[v.id] || ""
                                }</span>
                            </div>
                            <div class="v-text">
                                <div class="card-avatar-container">
                                    <img src="${v.thumb}" class="card-avatar">
                                </div>
                                <div class="card-info-content">
                                    <h3>${v.title}</h3>
                                    <p>${v.channelTitle}</p>
                                    <p></p>
                                    <button class="btn" onclick="Actions.removeFromPlaylistAndRefresh('${name.replace(
                                      /'/g,
                                      "\\\\'"
                                    )}', '${
                          v.id
                        }')" style="font-size:11px; padding:2px 8px;">削除</button>
                                </div>
                            </div>
                        </div>`
                      )
                      .join("")}
                </div>
            </div>`;
    this.Maps(html);
  },

  removeFromPlaylistAndRefresh(name, id) {
    Storage.removeFromPlaylist(name, id);
    this.viewPlaylistDetail(name, true);
  },

  async showAIRecommendations(skipPush = false) {
    this.removeShortsSwipe();
    if (!skipPush) window.history.pushState(null, "", "?mode=ai_recommend");
    this.currentView = "ai_recommend";

    const loggedInUser = Storage.getLoggedInUser();
    if (!loggedInUser) {
      this.Maps(
        `<div style="padding:20px;"><h2>🔒 ログインが必要です</h2><p style="color:#aaa; font-size:13px;">AIおすすめ機能はアカウントにログインすると使えるようになります。サイドバーの「アカウント設定」からログイン、または新規登録してください。</p></div>`
      );
      return;
    }

    this.Maps(
      `<div style="padding:20px;"><h2>✨ おすすめを読み込み中...</h2></div>`
    );

    try {
      const res = await fetch(
        `/api/ai_recommend?username=${encodeURIComponent(loggedInUser)}`
      );
      if (!res.ok) throw new Error("ai_recommend APIエラー: " + res.status);
      const data = await res.json();

      if (!data?.items?.length) {
        const waitingMessages = {
          computing:
            "🧠 今まさに計算中です。数分待ってからもう一度開いてみてください。",
          queued:
            "⏳ 計算の順番待ちです。少し時間をおいてからもう一度開いてみてください。",
          idle: "🕒 まだおすすめが用意されていません。しばらく視聴を続けると、自動的に計算が始まります。",
        };
        this.Maps(
          `<div style="padding:20px;"><h2>🤖 準備中です</h2><p style="color:#aaa; font-size:13px;">${
            waitingMessages[data?.status] || waitingMessages.idle
          }</p></div>`
        );
        return;
      }

      this.currentList = data.items;
      this.nextToken = "";
      await this.fillStats(this.currentList);
      this.renderGrid(
        `<h2>✨ おすすめ</h2><p style="color:#aaa; margin:-10px 0 20px 0; font-size:12px;">検索・視聴履歴 × スコアリングで厳選したおすすめです。</p>`
      );
    } catch (e) {
      console.error("ai_recommend失敗:", e);
      this.Maps(
        `<div style="padding:20px;"><h2>❌ おすすめの取得に失敗しました。</h2></div>`
      );
    }
  },

  async goHome(skipPush = false) {
    this.removeShortsSwipe();
    if (!skipPush) window.history.pushState(null, "", window.location.pathname);
    this.currentView = "home";
    this.activePlaylistName = null;
    this.currentParams = {
      chart: "mostPopular",
      regionCode: "JP",
      part: "snippet",
      maxResults: 24,
    };
    const data = await YT.fetchAPI("videos", this.currentParams);
    this.currentList = data.items || [];
    this.nextToken = data.nextPageToken || "";
    await this.fillStats(this.currentList);
    this.renderGrid("<h2>急上昇</h2>");
  },

  async _fetchGodRecommend(trendingVideos) {
    try {
      const res = await fetch("/api/god_recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: YT.getCurrentKey(),
          searchHistory: Storage.get("yt_search_history") || [],
          watchHistory: Storage.get("yt_history") || [],
          trendingVideos: trendingVideos || [],
        }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (!data?.items?.length) return;
      if (this.currentView !== "home") return;
      this.currentList = data.items;
      this.renderGrid("<h2>✨ おすすめ</h2>");
    } catch (e) {
      console.warn("god_recommend失敗、急上昇を継続表示:", e);
    }
  },

  // --- スワイプ管理（厳重判定 ＋ 自動追加読み込み） ---
  _swipeHandlers: null,
  _isSwipeLoading: false,

  initShortsSwipe() {
    this.removeShortsSwipe();

    let touchStartY = 0;
    let touchEndY = 0;
    const container = document.getElementById("main") || document.body;

    const handleTouchStart = (e) => {
      touchStartY = e.changedTouches[0].screenY;
    };

    const handleTouchEnd = async (e) => {
      // 1. 【厳重判定】ショートモード（shorts / channel_shorts）かつ
      //    現在実際に動画モーダルで再生中でない場合は即座に弾く
      const isShortsView =
        this.currentView === "shorts" || this.currentView === "channel_shorts";
      const isPlaying = !!this.currentModalId; // 動画再生中か判定

      if (!isShortsView || !isPlaying || this._isSwipeLoading) return;

      touchEndY = e.changedTouches[0].screenY;
      const diffY = touchStartY - touchEndY;

      // 2. スワイプ移動距離判定 (50px以上)
      if (Math.abs(diffY) > 50) {
        if (diffY > 0) {
          // 上スワイプ（次の動画へ）
          if (this.currentIndex + 1 < this.currentList.length) {
            this.playFromList(this.currentIndex + 1);
          } else if (this.nextToken) {
            // リストの末尾に達していて nextToken があれば自動で追加読み込み
            this._isSwipeLoading = true;
            try {
              const oldLength = this.currentList.length;
              await this.loadMore();
              // 追加読み込み後に次の動画があれば再生
              if (this.currentList.length > oldLength) {
                this.playFromList(oldLength);
              }
            } catch (err) {
              console.error("ショート自動読み込み失敗:", err);
            } finally {
              this._isSwipeLoading = false;
            }
          }
        } else {
          // 下スワイプ（前の動画へ）
          if (this.currentIndex > 0) {
            this.playFromList(this.currentIndex - 1);
          }
        }
      }
    };

    container.addEventListener("touchstart", handleTouchStart, {
      passive: true,
    });
    container.addEventListener("touchend", handleTouchEnd, { passive: true });

    this._swipeHandlers = { container, handleTouchStart, handleTouchEnd };
  },

  removeShortsSwipe() {
    if (this._swipeHandlers) {
      const { container, handleTouchStart, handleTouchEnd } =
        this._swipeHandlers;
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchend", handleTouchEnd);
      this._swipeHandlers = null;
    }
  },

  async showShorts(skipPush = false) {
    if (!skipPush) window.history.pushState(null, "", "?mode=shorts");
    this.currentView = "shorts";
    this.activePlaylistName = null;
    this.currentParams = {
      q: "#Shorts",
      part: "snippet",
      type: "video",
      videoDuration: "short",
      maxResults: 24,
    };
    const data = await YT.fetchAPI("search", this.currentParams);
    this.currentList = data.items || [];
    this.nextToken = data.nextPageToken || "";
    await this.fillStats(this.currentList);
    this.renderGrid("<h2>ショート</h2>");

    this.initShortsSwipe();
  },

  async showLiveHub(skipPush = false) {
    this.removeShortsSwipe();
    if (!skipPush) window.history.pushState(null, "", "?mode=live");
    this.currentView = "live";
    this.activePlaylistName = null;
    this.currentParams = {
      q: "live",
      part: "snippet",
      type: "video",
      eventType: "live",
      regionCode: "JP",
      maxResults: 24,
    };
    const data = await YT.fetchAPI("search", this.currentParams);
    this.currentList = data.items || [];
    this.nextToken = data.nextPageToken || "";
    await this.fillStats(this.currentList);
    this.renderGrid("<h2>🔴 ライブ配信</h2>");
  },
});
