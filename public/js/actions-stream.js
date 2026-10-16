/* actions-stream.js - 動画ストリーミング再生エンジン
 * HLS/DASH再生の初期化・字幕音声同期・再生本体(play)など、最も重量級の再生ロジックを担当。
 * Actions オブジェクトに Object.assign で機能を追加する。
 * 依存: actions-core.js（先に Actions を定義していること） / utils.js / yt-api.js / storage.js
 */

Object.assign(Actions, {
  // ─── HLS再生プレイヤー初期化 ───
  async initHlsPlayer(vId, video) {
    console.log("[HLS] initHlsPlayer 開始 vId:", vId);

    // ① 前回インスタンスのクリーンアップ
    if (this._hlsInstance) {
      console.log("[HLS] 既存インスタンスを destroy()");
      this._hlsInstance.destroy();
      this._hlsInstance = null;
    }

    // ② hls.js の動的ロード
    if (!window.Hls) {
      console.log("[HLS] hls.js が未ロード → 動的読み込み開始");
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://cdn.jsdelivr.net/npm/hls.js@latest";
        script.onload = () => {
          console.log("[HLS] hls.js 動的読み込み完了");
          resolve();
        };
        script.onerror = (e) => {
          console.error("[HLS] hls.js 動的読み込み失敗:", e);
          reject(new Error("hls.js load failed"));
        };
        document.head.appendChild(script);
      }).catch((e) => {
        this.showStatusNotification("HLS: ライブラリ読み込み失敗");
        return;
      });
    } else {
      console.log("[HLS] hls.js は既にロード済み");
    }

    // ③ /api/hls からストリームURLを取得
    console.log("[HLS] API通信開始 → /api/hls?id=" + vId);
    let hlsUrl;
    try {
      const res = await fetch("/api/hls?id=" + vId);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      hlsUrl = data.url || data.hlsUrl || data.stream_url;
      if (!hlsUrl)
        throw new Error("URLが見つかりません: " + JSON.stringify(data));
      console.log("[HLS] API通信成功 → hlsUrl:", hlsUrl);
    } catch (e) {
      console.error("[HLS] API通信失敗:", e);
      this.showStatusNotification(
        "HLS: ストリームURL取得失敗 → EDUモードに切り替えます"
      );
      this.playbackMode = "edu";
      this.play(this.currentList[this.currentIndex], true);
      return;
    }

    // video要素が消えていないか確認（非同期中に画面遷移した場合）
    const playerEl = document.getElementById("yt-player");
    if (!playerEl || playerEl.tagName !== "VIDEO") {
      console.warn("[HLS] video要素が見つかりません。再生中断。");
      return;
    }

    // ④ 再生分岐: Safari など HLS ネイティブサポートか否かを判定
    if (playerEl.canPlayType("application/vnd.apple.mpegurl")) {
      // ── Safari / iOS: 直接 src にセット ──
      console.log("[HLS] Safari ネイティブHLS再生開始");
      playerEl.src = hlsUrl;
      playerEl
        .play()
        .catch((e) => console.warn("[HLS] Safari autoplay失敗:", e));

      // resumeTime のシーク
      const resumeTime = Storage.getResumeTime(vId);
      if (resumeTime > 0) {
        playerEl.addEventListener(
          "loadedmetadata",
          () => {
            playerEl.currentTime = resumeTime;
            console.log("[HLS] Safari resumeTime シーク:", resumeTime);
          },
          { once: true }
        );
      }
    } else if (window.Hls && Hls.isSupported()) {
      // ── Chrome / Firefox 等: hls.js で再生 ──
      console.log("[HLS] hls.js による再生開始");
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        debug: false,
      });
      this._hlsInstance = hls;

      hls.loadSource(hlsUrl);
      hls.attachMedia(playerEl);
      console.log("[HLS] loadSource + attachMedia 完了");

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        console.log("[HLS] MANIFEST_PARSED → 再生開始");
        // resumeTime のシーク
        const resumeTime = Storage.getResumeTime(vId);
        if (resumeTime > 0) {
          playerEl.currentTime = resumeTime;
          console.log("[HLS] resumeTime シーク:", resumeTime);
        }
        playerEl.play().catch((e) => console.warn("[HLS] autoplay失敗:", e));
      });

      // エラーハンドリング
      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.error(
                "[HLS] 致命的ネットワークエラー → 再接続試行:",
                data
              );
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.error(
                "[HLS] 致命的メディアエラー → recoverMediaError:",
                data
              );
              hls.recoverMediaError();
              break;
            default:
              console.error("[HLS] 致命的エラー（回復不能）→ destroy:", data);
              hls.destroy();
              this._hlsInstance = null;
              this.showStatusNotification(
                "HLS再生エラー → EDUモードに切り替えます"
              );
              this.playbackMode = "edu";
              this.play(this.currentList[this.currentIndex], true);
              break;
          }
        } else {
          console.warn("[HLS] 非致命的エラー (無視):", data.type, data.details);
        }
      });
    } else {
      console.error(
        "[HLS] このブラウザはHLS非対応（Hls.isSupported() = false）"
      );
      this.showStatusNotification(
        "HLS非対応ブラウザ → EDUモードに切り替えます"
      );
      this.playbackMode = "edu";
      this.play(this.currentList[this.currentIndex], true);
    }
  },

  _dashCleanup() {
    // DASH再生中の孤立タイマー・インターバルを確実に破棄する
    if (this._syncSleepTimer) {
      clearTimeout(this._syncSleepTimer);
      this._syncSleepTimer = null;
    }
    if (this._syncMergeInterval) {
      clearInterval(this._syncMergeInterval);
      this._syncMergeInterval = null;
    }
    // HLS インスタンスも破棄
    if (this._hlsInstance) {
      console.log("[HLS] _dashCleanup: hls.destroy()");
      this._hlsInstance.destroy();
      this._hlsInstance = null;
    }
  },

  async play(video, skipPush = false) {
    this._dashCleanup();
    // 新しい動画開始時はPiPを自動解除
    this.closePip();
    const vId = YT.getVideoId(video);
    if (!skipPush) window.history.pushState(null, "", "?v=" + vId);
    const snip = video.snippet;
    const isSubbed = Storage.get("yt_subs").some(
      (x) => x.id === snip.channelId
    );
    const isWatchLater = Storage.isWatchLater(vId);
    const isShorts =
      this.currentView === "shorts" ||
      this.currentView === "channel_shorts" ||
      snip.title.includes("#Shorts");
    const safeTitle = snip.title.replace(/'/g, "\\'").replace(/"/g, "&quot;");
    const safeChTitle = snip.channelTitle
      .replace(/'/g, "\\'")
      .replace(/"/g, "&quot;");
    const thumbUrl = `/api/thumb?id=${vId}`;

    const cp = document.getElementById("comment-panel");
    if (cp) cp.remove();

    const renderPlayerContent = () => {
      if (this.playbackMode === "dash") {
        // 🌟【重要】裏で同時に鳴らす隠しオーディオタグを追加配置
        return `
            <video id="yt-player" controls autoplay playsinline style="width:100%; height:100%; background:#000;"></video>
            <audio id="yt-audio-player" autoplay style="display:none;"></audio>
          `;
      } else if (this.playbackMode === "hls") {
        // 🚀 HLS再生用のビデオタグ（DASHと違ってオーディオタグは不要）
        return `<video id="yt-player" controls autoplay playsinline style="width:100%; height:100%; background:#000;"></video>`;
      } else if (this.playbackMode === "streaming") {
        return `<video id="yt-player" src="${window.location.origin}/api/streaming?id=${vId}" controls autoplay playsinline style="width:100%; height:100%; background:#000;"
 onerror="setTimeout(() => { this.src=this.src; }, 3000); console.log('Retrying streaming source...')"></video>`;
      } else {
        return `<iframe id="yt-player" src="${YT.getEmbedUrl(
          vId,
          isShorts
        )}" style="width:100%; height:100%; border:none;"
 referrerpolicy="origin" allowfullscreen allow="autoplay"></iframe>`;
      }
    };

    let playHtml = "";
    if (isShorts) {
      playHtml = `
                <div class="shorts-container">
                    <div class="nav-arrow arrow-prev" onclick="Actions.playRelative(-1)">←</div>
                     <div class="nav-arrow arrow-next" onclick="Actions.playRelative(1)">→</div>
                    <div style="width:360px; height:640px; background:#000; border-radius:15px; overflow:hidden; position:relative;">
                        ${renderPlayerContent()}
                    </div>
                    <div style="width:360px; margin-top:15px;">
                        <h3>${snip.title}</h3>
                        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom: 10px;">
                            <span onclick="Actions.showChannel('${
                              snip.channelId
                            }')" style="cursor:pointer; color:#aaa;">${
        snip.channelTitle
      }</span>
                        </div>
                        <div style="display:flex; flex-wrap:wrap; gap: 8px;">
                            <button class="btn ${
                              isSubbed ? "subbed" : ""
                            }" onclick="Actions.handleSub('${
        snip.channelId
      }', '${safeChTitle}', true)">${isSubbed ? "登録済み" : "登録"}</button>
                            <button class="btn ${
                              isWatchLater ? "subbed" : ""
                            }" onclick="Actions.handleWatchLater('${vId}', '${safeTitle}', '${safeChTitle}', '${thumbUrl}', '${
        snip.channelId
      }')">${isWatchLater ? "保存済み" : "📌 後で"}</button>
                            <button class="btn" style="background:#333;" onclick="Actions.showComments('${vId}')">💬</button>
                            <button class="btn-download" onclick="Actions.downloadVideo('${vId}', '${safeTitle}')">📥</button>
                        </div>
                    </div>
                </div>`;
    } else {
      playHtml = `
                <div class="watch-layout">
                    <div class="player-area">
                        <div class="video-wrapper" style="position:relative;">${renderPlayerContent()}</div>
                        <div style="margin-top:15px; display:flex; gap:10px; align-items:center; background:#1e1e1e; padding:10px 20px; border-radius:10px; flex-wrap:wrap;">
                            
                            <div id="dash-status-box" class="dash-status-container" style="margin-right: 15px;"></div>

                            <span style="font-size:14px; color:#aaa; font-weight:bold; margin-right:10px;">再生速度:</span>
                            <button class="btn" onclick="Actions.changeSpeed(0.5)">0.5x</button>
                            <button class="btn" style="background:#444;" onclick="Actions.changeSpeed(1.0)">1.0x</button>
                            <button class="btn" onclick="Actions.changeSpeed(1.5)">1.5x</button>
                            <button class="btn" onclick="Actions.changeSpeed(2.0)">2.0x</button>
                            <div style="margin-left:auto; display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                                <label id="dash-sync-limit-label" style="font-size:12px; color:#aaa; display:${
                                  this.playbackMode === "dash"
                                    ? "inline"
                                    : "none"
                                };">ズレ許容:</label>
                                <input id="dash-sync-limit-input" type="text"
                                  value="${
                                    localStorage.getItem(
                                      "yt_dash_sync_limit"
                                    ) || "0.45"
                                  }"
                                  style="width:52px; background:#222; color:#fff; border:1px solid #555; border-radius:6px; padding:4px 6px; font-size:13px; text-align:center; display:${
                                    this.playbackMode === "dash"
                                      ? "inline"
                                      : "none"
                                  };" />
                                <span style="font-size:12px; color:#aaa;">再生モード:</span>
                                <select id="mode-select" class="btn" style="background:#333; color:#fff; border:none;" onchange="
                                  Actions.playbackMode = this.value;
                                  localStorage.setItem('yt_playback_mode', this.value);
                                  var isDash = (this.value === 'dash');
                                  var lbl = document.getElementById('dash-sync-limit-label');
                                  var inp = document.getElementById('dash-sync-limit-input');
                                  if (lbl) lbl.style.display = isDash ? 'inline' : 'none';
                                  if (inp) inp.style.display = isDash ? 'inline' : 'none';
                                  Actions.play(Actions.currentList[Actions.currentIndex] || Actions.relatedList[Actions.currentIndex], true);
                                ">
                                    <option value="edu" ${
                                      this.playbackMode === "edu"
                                        ? "selected"
                                        : ""
                                    }>Education</option>
                                    <option value="streaming" ${
                                      this.playbackMode === "streaming"
                                        ? "selected"
                                        : ""
                                    }>ストリーミング</option>
                                    <option value="dash" ${
                                      this.playbackMode === "dash"
                                        ? "selected"
                                        : ""
                                    }>dash再生</option>

                                </select>
                            </div>
                        </div>
                        <div style="padding-top:15px;">
                            <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px;">
                                <h2 style="margin:0;">${snip.title}</h2>
                                <div style="display:flex; gap:10px;">
                                    <select id="plist-select" class="btn" style="background:#333; color:#fff; border:none;"><option value="">📂 リスト選択</option>${Object.keys(
                                      Storage.getMyPlaylists()
                                    )
                                      .map(
                                        (name) =>
                                          `<option value="${name}">${name}</option>`
                                      )
                                      .join("")}</select>
                                    <button class="btn" onclick="const n=document.getElementById('plist-select').value;
 if(n) Storage.addToPlaylist(n, {id:'${vId}', title:'${safeTitle}', thumb:'${thumbUrl}', channelTitle:'${safeChTitle}'}); else alert('選択してね');" style="background:#3ea6ff; color:#fff;">追加</button>
                                </div>
                            </div>
                            <p style="color:#aaa; font-size:14px; margin-top:5px;">${formatViews(
                              this.videoStats[vId]
                            )} • ${timeAgo(snip.publishedAt)}</p>
                            <div style="display:flex; align-items:center; justify-content:space-between; margin-top:15px; flex-wrap:wrap; gap:10px;">
                                <div style="display:flex; align-items:center; cursor:pointer;" onclick="Actions.showChannel('${
                                  snip.channelId
                                }')">
                                    <img src="${
                                      this.channelIcons[snip.channelId] || ""
                                    }" style="width:40px; height:40px; border-radius:50%;">
                                    <span style="margin-left:10px; font-weight:bold;">${
                                      snip.channelTitle
                                    }</span>
                                </div>
                                <div style="display:flex; align-items:center; gap:8px;">
                                    <button class="btn ${
                                      isSubbed ? "subbed" : ""
                                    }" onclick="Actions.handleSub('${
        snip.channelId
      }', '${safeChTitle}', true)">${
        isSubbed ? "登録済み" : "チャンネル登録"
      }</button>
                                    <button class="btn ${
                                      isWatchLater ? "subbed" : ""
                                    }" onclick="Actions.handleWatchLater('${vId}', '${safeTitle}', '${safeChTitle}', '${thumbUrl}', '${
        snip.channelId
      }')">${isWatchLater ? "保存済み" : "📌 後で"}</button>
                                    <button class="btn" style="background:#333;" onclick="Actions.showComments('${vId}')">💬 コメント</button>
                                    <button class="btn-download" onclick="Actions.downloadVideo('${vId}', '${safeTitle}')">📥</button>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="related-area"><h3 id="side-title" style="margin-top:0;">関連動画</h3><div id="side-content-box"></div></div>
                </div>`;
    }

    this.Maps(playHtml);

    // PiPボタンを表示（動画再生画面に入ったとき）
    const pipBtn = document.getElementById("pip-btn");
    if (pipBtn) pipBtn.style.display = "inline-block";
    this._pipCurrentVid = vId;

    const _syncLimitInput = document.getElementById("dash-sync-limit-input");
    if (_syncLimitInput) {
      let _lastValidSyncLimit =
        localStorage.getItem("yt_dash_sync_limit") || "0.45";
      _syncLimitInput.value = _lastValidSyncLimit;
      _syncLimitInput.addEventListener("change", function () {
        const raw = this.value.trim();
        const isValidFormat = /^(0\.\d{1,2}|1\.0{1,2})$/.test(raw);
        const numVal = parseFloat(raw);
        if (!isValidFormat || numVal < 0.3 || numVal > 1.0) {
          alert(
            "入力値が無効です。\n0.3〜1.0 の範囲で、小数点以下2桁まで入力してください。\n例: 0.45, 0.60, 1.00"
          );
          this.value = _lastValidSyncLimit;
          return;
        }
        _lastValidSyncLimit = raw;
        localStorage.setItem("yt_dash_sync_limit", raw);
        Actions.showStatusNotification(
          `ズレ許容値を ${raw}秒 に更新しました ✅`
        );
      });
    }

    const sideBox = document.getElementById("side-content-box");
    if (sideBox) {
      if (this.activePlaylistName) {
        document.getElementById(
          "side-title"
        ).innerText = `再生中: ${this.activePlaylistName}`;
        this.relatedList = this.currentList;
      } else {
        try {
          const relResp = await fetch(`/api/kanrenn?vId=${vId}`);
          const relIds = await relResp.json();
          if (Array.isArray(relIds) && relIds.length > 0) {
            const relData = await YT.fetchAPI("videos", {
              id: relIds.join(","),
              part: "snippet",
            });
            this.relatedList = relData.items || [];
          } else {
            this.relatedList = [];
          }
        } catch (e) {
          console.error("Related fetch error:", e);
          this.relatedList = [];
        }
        await this.fillStats(this.relatedList);
      }
      sideBox.innerHTML = this.relatedList
        .map(
          (i, idx) => `
                <div class="v-card" style="${
                  idx === this.currentIndex && this.activePlaylistName
                    ? "background:#333; border-left:4px solid #3ea6ff;"
                    : ""
                }">
                    <div class="thumb-container" onclick="Actions.playFromRelated(${idx})">
                        <img src="${YT.getProxiedThumb(i)}" class="main-thumb">
                        <span class="video-duration">${
                          this.videoDurations[YT.getVideoId(i)] || ""
                        }</span>
                    </div>
                    <div class="v-text">
                        <div class="card-avatar-container">
                            <img src="${
                              i.snippet.channelIcon ||
                              "/api/thumb?id=" + YT.getVideoId(i)
                            }" class="card-avatar">
                        </div>
                        <div class="card-info-content">
                            <h3>${i.snippet.title}</h3>
                            <p>${i.snippet.channelTitle}</p>
                            <p>${formatViews(
                              this.videoStats[YT.getVideoId(i)]
                            )} • ${timeAgo(i.snippet.publishedAt)}</p>
                        </div>
                    </div>
                </div>`
        )
        .join("");
    }

    Storage.addHistory({
      id: vId,
      title: snip.title,
      thumb: thumbUrl,
      channelTitle: snip.channelTitle,
      views: this.videoStats[vId] || null,
      publishedAt: snip.publishedAt || null,
    });

    if (this.playbackMode === "dash") {
      this.initDashPlayer(vId, video);
    } else if (this.playbackMode === "hls") {
      // 🚀 HLS再生モードが選ばれたら初期化関数をキック
      this.initHlsPlayer(vId, video);
    }

    if (this.resumeTimer) clearInterval(this.resumeTimer);
    // 既存の message リスナーを削除してから再登録（重複蓄積を防ぐ）
    if (this._iframeResumeListener) {
      window.removeEventListener("message", this._iframeResumeListener);
      this._iframeResumeListener = null;
    }
    this._iframeResumeListener = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (
          data.event === "infoDelivery" &&
          data.info &&
          data.info.currentTime
        ) {
          // シークレット中でも時刻をメモリ上に保持（PiP復帰用）
          this._lastKnownIframeTime = data.info.currentTime;
          if (!Storage.isIncognito()) {
            Storage.saveResumeProgress(
              video,
              data.info.currentTime,
              data.info.duration
            );
          }
        }
      } catch (err) {}
    };
    window.addEventListener("message", this._iframeResumeListener);
    this.resumeTimer = setInterval(() => {
      const player = document.getElementById("yt-player");
      if (player) {
        if (player.tagName === "IFRAME") {
          player.contentWindow.postMessage(
            JSON.stringify({ event: "listening" }),
            "*"
          );
        } else if (player.tagName === "VIDEO") {
          // シークレット中でもメモリ上に時刻を保持（PiP復帰用）
          this._lastKnownIframeTime = player.currentTime;
          if (!Storage.isIncognito()) {
            Storage.saveResumeProgress(
              video,
              player.currentTime,
              player.duration
            );
          }
        }
      }
    }, 5000);
  },

  async initDashPlayer(vId, video) {
    const playerEl = document.getElementById("yt-player");
    const audioEl = document.getElementById("yt-audio-player");
    if (!playerEl || !audioEl) return;

    // 🌟 ランプUIを制御するためのローカル補助関数
    const _updateIndicator = (stateClass, text) => {
      const box = document.getElementById("dash-status-box");
      if (!box) return;
      box.innerHTML = `
        <div class="dash-lamp ${stateClass}"></div>
        <span>DASH SYNC: ${text}</span>
      `;
    };

    let errorReason = "原因不明のエラー";
    try {
      // 初期状態は用意中
      _updateIndicator("state-sleeping", "ストリーム準備中...");
      Actions.showStatusNotification("dash用意中");

      const response = await fetch(`/api/dash_stream?id=${vId}`).catch(() => {
        throw new Error("SERVER_DOWN");
      });
      if (!response.ok) {
        throw new Error(`SERVER_ERROR_${response.status}`);
      }

      const data = await response.json();
      if (
        !data ||
        !data.adaptiveFormats ||
        !Array.isArray(data.adaptiveFormats)
      ) {
        throw new Error("EMPTY_DATA");
      }

      // --- 映像URLの選別 ---
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

      // --- 音声URLの日本語・主音声 4段階ハンターロジック ---
      const targetAudio =
        data.adaptiveFormats.find(
          (f) => f.type?.includes("audio") && f.url?.includes("lang=ja")
        ) ||
        data.adaptiveFormats.find(
          (f) => f.type?.includes("audio") && f.url?.includes("original")
        ) ||
        data.adaptiveFormats.find(
          (f) => f.type?.includes("audio") && !f.url?.includes("lang=")
        ) ||
        data.adaptiveFormats.find((f) => f.type && f.type.includes("audio"));

      if (
        !targetVideo ||
        !targetVideo.url ||
        !targetAudio ||
        !targetAudio.url
      ) {
        throw new Error("NO_STREAM_URL");
      }

      playerEl.src = targetVideo.url;
      audioEl.src = targetAudio.url;
      console.log("Invidious 1080p音声合流成功:", data.source);

      // 無事に読み込めたら「常時監視（緑）」を灯す
      _updateIndicator("state-monitoring", "同期正常");

      playerEl.onerror = () => {
        console.error("Player Element Error:", playerEl.error);
        Actions.showStatusNotification(
          "DASH再生エラー: 動画データの読み込みに失敗しました（通常画質に切り替えます）"
        );
        this.playbackMode = "edu";
        this.play(video, true);
      };

      const resumeTime = Storage.getResumeTime(vId);
      if (resumeTime > 0) {
        playerEl.currentTime = resumeTime;
        audioEl.currentTime = resumeTime;
      }

      let isSeeking = false;
      let lastVideoTime = 0;
      let lastCheckTime = Date.now();

      let _syncSleeping = false;
      this._syncSleepTimer = null;
      this._syncMergeInterval = null;

      const _startSleepAndMerge = () => {
        _syncSleeping = true;
        if (this._syncSleepTimer) clearTimeout(this._syncSleepTimer);
        if (this._syncMergeInterval) clearInterval(this._syncMergeInterval);

        console.log("[Sync] 居眠り開始（2秒）");
        // 🌟 ランプを「黄色点滅（居眠り中）」に変える
        _updateIndicator("state-sleeping", "ズレ測定のための2秒の居眠り中...");

        this._syncSleepTimer = setTimeout(() => {
          const snapVideoTime = playerEl.currentTime;
          const snapDiff = audioEl.currentTime - snapVideoTime;
          const syncLimit = parseFloat(
            localStorage.getItem("yt_dash_sync_limit") || "0.45"
          );

          console.log(
            `[Sync] 居眠り終了。測定ズレ: ${snapDiff.toFixed(
              3
            )}秒 / しきい値: ${syncLimit}秒 → 10分割合流開始`
          );

          if (Math.abs(snapDiff) <= syncLimit) {
            console.log("[Sync] ズレなし。即座に常時監視へ復帰。");
            _syncSleeping = false;
            // 🌟 ズレがなければ即座に「緑（正常）」へ
            _updateIndicator("state-monitoring", "同期正常");
            return;
          }

          const stepSize = snapDiff / 10;
          let stepCount = 0;

          // 🌟 ここから合流開始。ランプを「青色高速点滅」に変える
          _updateIndicator("state-merging", `10分割合流中... (0/10)`);

          this._syncMergeInterval = setInterval(() => {
            stepCount++;
            const currentDiff = audioEl.currentTime - playerEl.currentTime;

            if (Math.abs(currentDiff) > syncLimit && stepCount <= 10) {
              audioEl.currentTime = audioEl.currentTime - stepSize;
              console.log(
                `[Sync] 合流 step ${stepCount}/10: 補正後差分 ≒ ${(
                  audioEl.currentTime - playerEl.currentTime
                ).toFixed(3)}秒`
              );
              // 🌟 現在何ステップ目かをリアルタイム表示
              _updateIndicator(
                "state-merging",
                `10分割合流中... (${stepCount}/10)`
              );
            }

            if (stepCount >= 10 || Math.abs(currentDiff) <= syncLimit) {
              clearInterval(this._syncMergeInterval);
              this._syncMergeInterval = null;
              _syncSleeping = false;
              console.log("[Sync] 10分割合流完了。常時監視モードへ復帰。");
              // 🌟 合流完了！「緑（正常）」へ復帰
              _updateIndicator("state-monitoring", "同期正常");
            }
          }, 100);
        }, 2000);
      };

      playerEl.onplay = () => {
        if (!isSeeking) {
          audioEl.play().catch(() => {});
        }
      };

      playerEl.onpause = () => {
        audioEl.pause();
      };

      playerEl.onseeking = () => {
        isSeeking = true;
        audioEl.pause();
      };

      playerEl.onseeked = () => {
        audioEl.currentTime = playerEl.currentTime;
        lastVideoTime = playerEl.currentTime;
        lastCheckTime = Date.now();
        isSeeking = false;
        if (!playerEl.paused) {
          audioEl.play().catch(() => {});
        }
        _startSleepAndMerge();
      };

      playerEl.onwaiting = () => {
        if (!isSeeking) {
          audioEl.pause();
        }
      };

      playerEl.onplaying = () => {
        if (isSeeking) return;
        if (Math.abs(audioEl.currentTime - playerEl.currentTime) > 0.1) {
          audioEl.currentTime = playerEl.currentTime;
        }
        lastVideoTime = playerEl.currentTime;
        lastCheckTime = Date.now();
        if (!playerEl.paused) {
          audioEl.play().catch(() => {});
        }
        _startSleepAndMerge();
      };

      audioEl.onended = () => {
        console.log(
          "[Guard] 本編（音声）が正常に終了しました。映像を強制終了します。"
        );
        if (this._syncSleepTimer) clearTimeout(this._syncSleepTimer);
        if (this._syncMergeInterval) clearInterval(this._syncMergeInterval);
        _syncSleeping = false;
        playerEl.pause();
        playerEl.currentTime = audioEl.duration || playerEl.currentTime;
        // ended イベントを正しく発火させる（onended プロパティの直呼びは不正）
        playerEl.dispatchEvent(new Event("ended"));
      };

      playerEl.ontimeupdate = () => {
        if (isSeeking || playerEl.paused) return;
        if (_syncSleeping) return;
        const syncLimit = parseFloat(
          localStorage.getItem("yt_dash_sync_limit") || "0.45"
        );
        const now = Date.now();
        const currentVideoTime = playerEl.currentTime;
        const diff = audioEl.currentTime - currentVideoTime;
        if (now - lastCheckTime > 300) {
          if (currentVideoTime === lastVideoTime && !audioEl.paused) {
            console.log(
              "[Sync] 映像のフリーズを検知。音声を一時停止して映像を待ちます。"
            );
            // 🌟 フリーズ検知時も警告を出すとさらにサイバー感が出ます
            _updateIndicator(
              "state-sleeping",
              "映像フリーズ検知！音声一時停止中..."
            );
            audioEl.pause();
            return;
          }
        }

        lastVideoTime = currentVideoTime;
        lastCheckTime = now;

        if (audioEl.paused && !playerEl.paused && !isSeeking) {
          audioEl.play().catch(() => {});
          _updateIndicator("state-monitoring", "常時監視中（同期正常）");
        }

        if (Math.abs(diff) > 1.5) {
          console.log("[Sync] 致命的なズレを検知。強力リバイブします。");
          _updateIndicator(
            "state-merging",
            "致命的ズレ検知！音声強力リバイブ中..."
          );
          audioEl.pause();
          audioEl.load();
          audioEl.currentTime = currentVideoTime + 0.05;
          if (!playerEl.paused) {
            audioEl.play().catch(() => {});
          }
          return;
        }

        if (Math.abs(diff) > syncLimit) {
          console.log(
            `[Sync] タイム補正 (差分: ${diff.toFixed(
              2
            )}秒 / 許容: ${syncLimit}秒)`
          );
          _updateIndicator(
            "state-merging",
            `微ズレ補正中... (${diff.toFixed(2)}s)`
          );
          audioEl.currentTime = currentVideoTime;
          setTimeout(() => {
            if (!_syncSleeping)
              _updateIndicator("state-monitoring", "常時監視中（同期正常）");
          }, 200);
        }
      };

      playerEl.onratechange = () => {
        audioEl.playbackRate = playerEl.playbackRate;
      };
    } catch (error) {
      console.error(error);
      if (error.message === "SERVER_DOWN") {
        errorReason = "サーバーが応答していないかオフラインです";
      } else if (error.message.startsWith("SERVER_ERROR_")) {
        const status = error.message.replace("SERVER_ERROR_", "");
        errorReason = `サーバーがエラーを返しました (エラーコード: ${status})`;
      } else if (
        error.message === "EMPTY_DATA" ||
        error.message === "NO_STREAM_URL"
      ) {
        errorReason = "高画質データ（URL）がサーバー側に見つかりません";
      } else {
        errorReason = `再生準備中に問題が発生しました (${error.message})`;
      }

      _updateIndicator("state-sleeping", "DASHエラー発生により停止");
      Actions.showStatusNotification(
        `DASH再生エラー: ${errorReason}（通常画質に切り替えます）`
      );
      this.playbackMode = "edu";
      this.play(video, true);
    }
  },
});
