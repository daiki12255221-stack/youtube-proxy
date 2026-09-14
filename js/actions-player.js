/* actions-player.js - プレイヤー操作系
 * 再生リスト内移動、ダウンロード、再生速度、後で見る、コメント表示、PiP(ミニプレイヤー)を担当。
 * Actions オブジェクトに Object.assign で機能を追加する。
 * 依存: actions-core.js（先に Actions を定義していること） / utils.js / yt-api.js / storage.js
 */

Object.assign(Actions, {
  playFromList(index) {
    this.currentIndex = index;
    this.play(this.currentList[index]);
  },
  playFromRelated(index) {
    if (this.activePlaylistName) this.playFromList(index);
    else if (this.relatedList && this.relatedList[index])
      this.play(this.relatedList[index]);
  },
  playRelative(offset) {
    if (
      !this.activePlaylistName &&
      this.relatedList &&
      this.relatedList.length > 0
    ) {
      // relatedList から再生中（プレイリストなし）: relatedList 内で前後移動
      const relIdx = this.relatedList.indexOf(
        this.currentList[this.currentIndex]
      );
      const base = relIdx >= 0 ? relIdx : 0;
      const newIdx = base + offset;
      if (newIdx >= 0 && newIdx < this.relatedList.length) {
        this.play(this.relatedList[newIdx]);
      }
      return;
    }
    // currentList（プレイリスト等）内で前後移動
    const newIndex = this.currentIndex + offset;
    if (newIndex >= 0 && newIndex < this.currentList.length) {
      this.playFromList(newIndex);
    } else if (newIndex >= this.currentList.length && this.activePlaylistName) {
      this.playFromList(0); // プレイリストの先頭に戻る
    }
  },

  async fetchMissingIcons(ids) {
    // こちらもchannels.listの1リクエストあたり最大50件制限に対応してバッチ分割する
    const idList = ids.split(",").filter(Boolean);
    const batches = [];
    for (let i = 0; i < idList.length; i += 50)
      batches.push(idList.slice(i, i + 50));

    await Promise.all(
      batches.map(async (batch) => {
        const data = await YT.fetchAPI("channels", {
          id: batch.join(","),
          part: "snippet",
        });
        if (data.items) {
          data.items.forEach((ch) => {
            this.channelIcons[ch.id] = ch.snippet.thumbnails.default.url;
          });
        }
      })
    );

    document.querySelectorAll(".card-avatar[data-chid]").forEach((img) => {
      const cid = img.dataset.chid;
      if (this.channelIcons[cid]) img.src = this.channelIcons[cid];
    });
  },

  // app.js 用の修正版ダウンロード関数（エラーを回避して確実にポップアップを出す仕様）
  async downloadVideo(vId, title) {
    // ファイル名を整形
    const safeFileName = (title || vId).replace(/[\\/:*?"<>|]/g, "_") + ".mp4";

    // 1. サーバーのプロキシURLを直接作成（サーバー側でURLを再解決してもらう）
    const downloadUrl = `/api/download_proxy?id=${encodeURIComponent(
      vId
    )}&filename=${encodeURIComponent(safeFileName)}`;

    try {
      // 既存モーダルがあれば閉じる（二重表示防止）
      const existing = document.getElementById("download-popup-modal");
      if (existing) existing.remove();
      // 2. 画面中央にポップアップ（UI）を即座に作成
      const modal = document.createElement("div");
      modal.id = "download-popup-modal";
      modal.style.position = "fixed";
      modal.style.top = "0";
      modal.style.left = "0";
      modal.style.width = "100vw";
      modal.style.height = "100vh";
      modal.style.backgroundColor = "rgba(0, 0, 0, 0.75)";
      modal.style.display = "flex";
      modal.style.justifyContent = "center";
      modal.style.alignItems = "center";
      modal.style.zIndex = "99999";

      // ポップアップの内側の箱
      const box = document.createElement("div");
      box.style.backgroundColor = "#222";
      box.style.color = "#fff";
      box.style.padding = "30px";
      box.style.borderRadius = "12px";
      box.style.textAlign = "center";
      box.style.boxShadow = "0 4px 20px rgba(0,0,0,0.5)";
      box.style.maxWidth = "90%";
      box.style.width = "400px";

      // 説明文
      const infoText = document.createElement("p");
      infoText.style.fontSize = "14px";
      infoText.style.lineHeight = "1.6";
      infoText.style.marginBottom = "20px";
      box.appendChild(infoText);

      // 【本命】長押し用ダウンロードリンクボタン
      const downloadLink = document.createElement("a");
      downloadLink.href = downloadUrl; // 🚀 直接プロキシのURLを指定
      downloadLink.target = "_blank";
      downloadLink.innerText = "ここでダウンロード";
      downloadLink.style.display = "block";
      downloadLink.style.backgroundColor = "#ff0000";
      downloadLink.style.color = "#fff";
      downloadLink.style.padding = "12px 20px";
      downloadLink.style.borderRadius = "6px";
      downloadLink.style.textDecoration = "none";
      downloadLink.style.fontWeight = "bold";
      downloadLink.style.fontSize = "16px";
      downloadLink.style.marginBottom = "20px";
      box.appendChild(downloadLink);

      // 閉じるボタン
      const closeBtn = document.createElement("button");
      closeBtn.innerText = "閉じる";
      closeBtn.style.backgroundColor = "#444";
      closeBtn.style.color = "#fff";
      closeBtn.style.border = "none";
      closeBtn.style.padding = "8px 16px";
      closeBtn.style.borderRadius = "4px";
      closeBtn.style.cursor = "pointer";
      closeBtn.onclick = () => {
        document.body.removeChild(modal);
      };
      box.appendChild(closeBtn);

      modal.appendChild(box);
      document.body.appendChild(modal);

      if (typeof Actions !== "undefined" && Actions.showStatusNotification) {
        Actions.showStatusNotification(
          "リンクを生成しました！ページ中央を確認してください。✅"
        );
      }
    } catch (error) {
      console.error("モーダル生成エラー:", error);
      alert("ポップアップの表示に失敗しました。");
    }
  },

  changeSpeed(rate) {
    const player = document.getElementById("yt-player");
    const audioPlayer = document.getElementById("yt-audio-player");
    if (!player) return;

    if (player.tagName === "IFRAME") {
      player.contentWindow.postMessage(
        JSON.stringify({
          event: "command",
          func: "setPlaybackRate",
          args: [rate],
        }),
        "*"
      );
    } else {
      player.playbackRate = rate;
      if (audioPlayer) audioPlayer.playbackRate = rate;
    }
  },

  handleWatchLater(id, title, channelTitle, thumb, channelId) {
    const proxiedThumb = `/api/thumb?id=${id}`;
    Storage.toggleWatchLater({
      id,
      title,
      channelTitle,
      thumb: proxiedThumb,
      channelId,
    });
    const currentVideo = this.currentList[this.currentIndex];
    if (
      this.currentIndex !== -1 &&
      currentVideo &&
      !["subs", "watchlater"].includes(this.currentView)
    )
      this.play(currentVideo, true);
    else if (this.currentView === "watchlater") this.showWatchLater(true);
  },

  async showComments(vId, order = "relevance") {
    let panel = document.getElementById("comment-panel");
    if (panel && panel.dataset.vId === vId && panel.dataset.order === order) {
      panel.remove();
      document.querySelector(
        ".watch-layout, .shorts-container"
      ).style.marginRight = "0";
      return;
    }
    const layout = document.querySelector(".watch-layout, .shorts-container");
    if (layout) layout.style.marginRight = "400px";
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "comment-panel";
      panel.style =
        "position:fixed; top:60px; right:0; width:400px; height:calc(100vh - 60px); background:#0f0f0f; border-left:1px solid #333; z-index:100; padding:20px; overflow-y:auto; color:white;";
      document.body.appendChild(panel);
    }
    panel.dataset.vId = vId;
    panel.dataset.order = order;
    panel.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                <h3 style="margin:0;">コメント</h3>
                <div style="display:flex; gap:10px;">
                    <button class="btn" style="font-size:11px; padding:4px 8px; ${
                      order === "relevance"
                        ? "background:#3ea6ff;"
                        : "background:#333;"
                    }" onclick="Actions.showComments('${vId}', 'relevance')">いいね順</button>
                    <button class="btn" style="font-size:11px; padding:4px 8px; ${
                      order === "time"
                        ? "background:#3ea6ff;"
                        : "background:#333;"
                    }" onclick="Actions.showComments('${vId}', 'time')">新着順</button>
                </div>
            </div>
            <div id="comment-list">読み込み中...</div>`;

    try {
      const resp = await fetch(
        `/api/komento?vId=${vId}&key=${YT.getCurrentKey()}&order=${order}`
      );
      const data = await resp.json();
      const list = document.getElementById("comment-list");
      if (!data.items || data.items.length === 0) {
        list.innerHTML = "コメントが無効か、存在しません。";
        return;
      }
      list.innerHTML = data.items
        .map((item) => {
          const c = item.snippet.topLevelComment.snippet;
          const commentId = item.snippet.topLevelComment.id;
          const totalReplyCount = item.snippet.totalReplyCount || 0;
          // 返信ボタン: 返信が1件以上ある場合のみ表示
          const replyBtnHtml =
            totalReplyCount > 0
              ? `<button
                id="reply-btn-${commentId}"
                onclick="Actions.showReplies('${commentId}', '${commentId}')"
                style="background:none; border:none; color:#3ea6ff; font-size:12px; cursor:pointer; padding:4px 0; margin-top:4px; display:block;">
                🔽 返信を表示 (${totalReplyCount}件)
              </button>
              <div id="replies-${commentId}" style="display:none;"></div>`
              : "";
          return `
            <div style="display:flex; gap:10px; margin-bottom:20px; font-size:13px;">
              <img src="${
                c.authorProfileImageUrl
              }" style="width:35px; height:35px; border-radius:50%; flex-shrink:0;">
              <div style="flex:1; min-width:0;">
                <div style="font-weight:bold;">
                  ${c.authorDisplayName}
                  <span style="color:#aaa; font-weight:normal;">${timeAgo(
                    c.publishedAt
                  )}</span>
                </div>
                <div style="margin-top:5px; white-space:pre-wrap; word-break:break-word;">${
                  c.textDisplay
                }</div>
                <div style="color:#aaa; margin-top:5px;">👍 ${c.likeCount}</div>
                ${replyBtnHtml}
              </div>
            </div>`;
        })
        .join("");
      // タイムスタンプリンクをフックしてプレイヤーにシークさせる
      interceptTimestampLinks(list);
    } catch (e) {
      document.getElementById("comment-list").innerHTML = "コメント取得失敗";
    }
  },

  async showReplies(parentId, commentId) {
    const repliesContainer = document.getElementById(`replies-${commentId}`);
    const replyBtn = document.getElementById(`reply-btn-${commentId}`);
    if (!repliesContainer || !replyBtn) return;

    // 既に展開済みの場合はトグルして閉じる
    if (repliesContainer.dataset.loaded === "true") {
      const isVisible = repliesContainer.style.display !== "none";
      repliesContainer.style.display = isVisible ? "none" : "block";
      replyBtn.textContent = isVisible
        ? replyBtn.dataset.closedLabel
        : replyBtn.dataset.openLabel;
      return;
    }

    // 読み込み中表示
    replyBtn.textContent = "⏳ 読み込み中...";
    replyBtn.disabled = true;

    try {
      const resp = await fetch(
        `/api/komento?parentId=${parentId}&key=${YT.getCurrentKey()}`
      );
      const data = await resp.json();

      if (!data.items || data.items.length === 0) {
        repliesContainer.innerHTML = `<div style="padding:8px 0; color:#aaa; font-size:12px;">返信はありません。</div>`;
      } else {
        repliesContainer.innerHTML = data.items
          .map((item) => {
            const r = item.snippet;
            return `
              <div style="display:flex; gap:8px; margin-bottom:14px; font-size:13px;">
                <img src="${
                  r.authorProfileImageUrl
                }" style="width:28px; height:28px; border-radius:50%; flex-shrink:0;">
                <div style="flex:1; min-width:0;">
                  <div style="font-weight:bold;">
                    ${r.authorDisplayName}
                    <span style="color:#aaa; font-weight:normal;">${timeAgo(
                      r.publishedAt
                    )}</span>
                  </div>
                  <div style="margin-top:4px; white-space:pre-wrap; word-break:break-word;">${
                    r.textDisplay
                  }</div>
                  <div style="color:#aaa; margin-top:4px;">👍 ${
                    r.likeCount
                  }</div>
                </div>
              </div>`;
          })
          .join("");
      }

      const closedLabel =
        replyBtn.textContent.replace("⏳ 読み込み中...", "") || `🔽 返信を表示`;
      const openLabel = `🔼 返信を閉じる`;
      replyBtn.dataset.closedLabel = closedLabel;
      replyBtn.dataset.openLabel = openLabel;

      // 返信コメントのタイムスタンプリンクもフック
      interceptTimestampLinks(repliesContainer);
      repliesContainer.style.cssText =
        "display:block; margin-left:0; padding-left:12px; border-left:2px solid #333; margin-top:8px;";
      repliesContainer.dataset.loaded = "true";
      replyBtn.textContent = openLabel;
      replyBtn.disabled = false;
    } catch (e) {
      repliesContainer.innerHTML = `<div style="color:#aaa; font-size:12px;">返信の取得に失敗しました。</div>`;
      repliesContainer.style.display = "block";
      replyBtn.textContent = "返信の取得に失敗";
      replyBtn.disabled = false;
    }
  },

  // ─── PiP（ページ内フローティングミニプレイヤー） ───
  togglePip() {
    if (this._pipActive) {
      this.closePip();
    } else {
      this.openPip();
    }
  },

  openPip() {
    const wrapper = document.querySelector(".video-wrapper");
    const pipContainer = document.getElementById("pip-container");
    const pipInner = document.getElementById("pip-inner");
    const pipTitle = document.getElementById("pip-title");
    const pipBtn = document.getElementById("pip-btn");
    if (!wrapper || !pipContainer || !pipInner) return;

    const player = document.getElementById("yt-player");
    if (!player) return;

    // ① goHome()前に動画・時刻・タイトルを保存
    const savedVideo =
      this.currentList[this.currentIndex] ||
      (this.relatedList &&
        this.relatedList.find((v) => YT.getVideoId(v) === this._pipCurrentVid));
    const savedVid = this._pipCurrentVid;
    const h2 = document.querySelector(".player-area h2");
    const titleText = h2 ? h2.textContent : "";

    // 現在の再生時刻を保存（シークレット中でもメモリ上に保持）
    const isIframe = player.tagName === "IFRAME";
    if (!isIframe) {
      // video要素: currentTime を直接取得
      this._pipSavedTime = player.currentTime || 0;
    } else {
      // iframe(edu): resumeTimerが5秒ごとに保存しているので Storage から取得
      // シークレット中は Storage に書かれないので postMessage で時刻を問い合わせ
      // → 直前の resumeTimer サイクルで取れた値を使う（最大5秒の誤差）
      this._pipSavedTime = this._lastKnownIframeTime || 0;
    }

    // iframeSrcを保持（DOM移動後に再ロードされないよう）
    const iframeSrc = isIframe ? player.src : null;

    const audioEl = document.getElementById("yt-audio");

    // プレイヤー要素を退避
    const fragment = document.createDocumentFragment();
    fragment.appendChild(player);
    if (audioEl) fragment.appendChild(audioEl);

    // ② ホーム画面に戻す
    this.goHome();

    // ③ PiPコンテナにプレイヤーを挿入
    pipInner.innerHTML = "";
    pipInner.appendChild(player);
    if (audioEl) pipInner.appendChild(audioEl);

    // iframeのsrcがリセットされた場合は復元
    if (isIframe && iframeSrc && player.src !== iframeSrc) {
      player.src = iframeSrc;
    }

    if (pipTitle) {
      pipTitle.textContent = titleText;
      pipTitle._tapCount = 0;
      pipTitle._tapTimer = null;

      const returnToPlayer = () => {
        // PiP終了時に現在時刻を再取得して保存
        const pipPlayer = document.getElementById("yt-player");
        if (pipPlayer) {
          if (pipPlayer.tagName === "VIDEO") {
            this._pipSavedTime = pipPlayer.currentTime || this._pipSavedTime;
          } else {
            // iframe: 最後に取れた時刻を使う
            this._pipSavedTime =
              this._lastKnownIframeTime || this._pipSavedTime;
          }
          // シークレット中でも一時保存（メモリ上）
          if (savedVideo && !Storage.isIncognito()) {
            Storage.saveResumeProgress(
              savedVideo,
              this._pipSavedTime,
              this._pipSavedTime + 1
            );
          }
        }
        this.closePip();

        const doPlay = (vid) => {
          const id = YT.getVideoId(vid);
          // URLを正しく更新
          window.history.pushState(null, "", "?v=" + id);
          // currentList/currentIndex をこの動画に正しくセット
          // → モード切り替えの onchange が参照したとき正しい動画が再生される
          this.currentList = [vid];
          this.currentIndex = 0;
          this.play(vid, true);
          // 再生開始後に保存済み時刻にシーク
          setTimeout(() => {
            const t = this._pipSavedTime;
            if (t > 0) {
              const p = document.getElementById("yt-player");
              if (p && p.tagName === "VIDEO") {
                p.currentTime = t;
                const a = document.getElementById("yt-audio");
                if (a) a.currentTime = t;
              } else if (p && p.tagName === "IFRAME") {
                YT.seek(t);
              }
            }
          }, 1200);
        };

        if (savedVideo) {
          doPlay(savedVideo);
        } else if (savedVid) {
          YT.fetchAPI("videos", { id: savedVid, part: "snippet" }).then(
            (data) => {
              if (data.items && data.items[0]) doPlay(data.items[0]);
            }
          );
        }
      };

      pipTitle.ondblclick = returnToPlayer;
      pipTitle.ontouchend = () => {
        pipTitle._tapCount = (pipTitle._tapCount || 0) + 1;
        clearTimeout(pipTitle._tapTimer);
        if (pipTitle._tapCount >= 2) {
          pipTitle._tapCount = 0;
          returnToPlayer();
        } else {
          pipTitle._tapTimer = setTimeout(() => {
            pipTitle._tapCount = 0;
          }, 400);
        }
      };
    }

    pipContainer.style.display = "block";
    if (pipBtn) pipBtn.style.display = "none";
    this._pipActive = true;

    this._initPipDrag(pipContainer);
  },

  closePip() {
    if (!this._pipActive) return;
    const pipContainer = document.getElementById("pip-container");
    const pipInner = document.getElementById("pip-inner");
    const pipBtn = document.getElementById("pip-btn");

    // PiP内のタイトルのイベントをクリア
    const pipTitle = document.getElementById("pip-title");
    if (pipTitle) {
      pipTitle.ondblclick = null;
      pipTitle.ontouchend = null;
    }

    if (pipContainer) pipContainer.style.display = "none";
    if (pipInner) pipInner.innerHTML = "";
    if (pipBtn) pipBtn.classList.remove("pip-active");
    this._pipActive = false;
  },

  _initPipDrag(el) {
    // 既存のドラッグリスナーを解除してから再登録
    if (el._dragCleanup) el._dragCleanup();
    let ox = 0,
      oy = 0,
      sx = 0,
      sy = 0;
    const onMove = (e) => {
      const cx = e.touches ? e.touches[0].clientX : e.clientX;
      const cy = e.touches ? e.touches[0].clientY : e.clientY;
      el.style.right = "auto";
      el.style.left =
        Math.max(0, Math.min(window.innerWidth - el.offsetWidth, cx - ox)) +
        "px";
      el.style.top =
        Math.max(0, Math.min(window.innerHeight - el.offsetHeight, cy - oy)) +
        "px";
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onUp);
    };
    const onDown = (e) => {
      // ✕ボタンはドラッグ対象外
      if (e.target.tagName === "BUTTON") return;
      const cx = e.touches ? e.touches[0].clientX : e.clientX;
      const cy = e.touches ? e.touches[0].clientY : e.clientY;
      const rect = el.getBoundingClientRect();
      ox = cx - rect.left;
      oy = cy - rect.top;
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      document.addEventListener("touchmove", onMove, { passive: true });
      document.addEventListener("touchend", onUp);
    };
    el.addEventListener("mousedown", onDown);
    el.addEventListener("touchstart", onDown, { passive: true });
    el._dragCleanup = () => {
      el.removeEventListener("mousedown", onDown);
      el.removeEventListener("touchstart", onDown);
    };
  },
});
