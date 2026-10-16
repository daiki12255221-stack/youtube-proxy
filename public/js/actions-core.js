/* actions-core.js - Actions オブジェクトの本体定義
 * 状態プロパティ、初期化(init)、URLルーティング、画面遷移の土台(Maps)、
 * サイドバー最新情報、管理者ログインなど「アプリの中核」を担当。
 * 他の actions-*.js は Object.assign(Actions, {...}) でこのオブジェクトに機能を追加する。
 * そのため actions-core.js は必ず他の actions-*.js より先に読み込むこと。
 * 依存: utils.js / yt-api.js / storage.js
 */

const Actions = {
  currentList: [],
  relatedList: [],
  currentIndex: -1,
  channelIcons: {},
  currentView: "home",
  nextToken: "",
  currentParams: {},
  selectedSubs: [],
  activePlaylistName: null,
  videoStats: {},
  videoDurations: {},
  resumeTimer: null,
  _pipActive: false,
  _pipCurrentVid: null,
  _pipSavedTime: 0,
  _hlsInstance: null, // hls.js インスタンス管理    // PiP開始時の再生時刻（シークレット中でも保持）
  playbackMode: localStorage.getItem("yt_playback_mode") || "edu",

  // チャンネルページ専用の状態管理
  chState: { type: "videos", sort: "date" },

  init() {
    const input = document.getElementById("search-input");
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.hideSuggestDropdown();
        this.search();
        input.blur();
      }
    });
    document.getElementById("search-btn").onclick = () => {
      this.hideSuggestDropdown();
      this.search();
    };

    // --- 検索サジェスト（入力後0.3秒でバックエンドの/api/suggestを叩く） ---
    let suggestTimer = null;
    input.addEventListener("input", () => {
      clearTimeout(suggestTimer);
      const q = input.value.trim();
      if (!q) {
        this.hideSuggestDropdown();
        return;
      }
      suggestTimer = setTimeout(() => {
        this.fetchSuggestions(q);
      }, 300);
    });

    // 入力欄以外をクリックしたらサジェストを閉じる
    document.addEventListener("click", (e) => {
      const bar = document.querySelector(".search-bar");
      if (bar && !bar.contains(e.target)) this.hideSuggestDropdown();
    });

    const sidebar = document.querySelector(".sidebar");
    if (sidebar) {
      if (!document.getElementById("nav-resume")) {
        const homeNav = document.querySelector(
          '.sidebar .nav-item[onclick="Actions.goHome()"]'
        );
        if (homeNav)
          homeNav.insertAdjacentHTML(
            "afterend",
            '<div id="nav-resume" class="nav-item" onclick="Actions.showResumeList()" style="color:#ff8c00;">🕒<span>続きから見る</span></div>'
          );
      }
      if (!document.getElementById("nav-watch-later")) {
        const historyNav = document.querySelector(
          '.sidebar .nav-item[onclick="Actions.showHistory()"]'
        );
        if (historyNav)
          historyNav.insertAdjacentHTML(
            "beforebegin",
            '<div id="nav-watch-later" class="nav-item" onclick="Actions.showWatchLater()">📌<span>後で見る</span></div>'
          );
      }
      if (!document.getElementById("nav-playlist")) {
        const wlNav = document.getElementById("nav-watch-later");
        if (wlNav)
          wlNav.insertAdjacentHTML(
            "afterend",
            '<div id="nav-playlist" class="nav-item" onclick="Actions.showMyPlaylists()" style="color:#3ea6ff;">📂<span>プレイリスト</span></div>'
          );
      }
      if (!document.getElementById("nav-ai-recommend")) {
        const homeNav = document.querySelector(
          '.sidebar .nav-item[onclick="Actions.goHome()"]'
        );
        if (homeNav)
          homeNav.insertAdjacentHTML(
            "afterend",
            '<div id="nav-ai-recommend" class="nav-item" onclick="Actions.showAIRecommendations()">🤖<span>AIおすすめ</span></div>'
          );
      }
      if (!document.getElementById("nav-incognito")) {
        const isInc = Storage.isIncognito();
        const historyNav = document.querySelector(
          '.sidebar .nav-item[onclick="Actions.showHistory()"]'
        );
        if (historyNav) {
          historyNav.insertAdjacentHTML(
            "afterend",
            `
                        <div id="nav-incognito" class="nav-item" onclick="Actions.toggleIncognito()" style="color:${
                          isInc ? "#00ff00" : "#aaa"
                        };">
                            👤<span>${
                              isInc ? "シークレット: ON" : "シークレット: OFF"
                            }</span>
                        </div>
                    `
          );
        }
      }
      if (!document.getElementById("nav-admin-login")) {
        sidebar.insertAdjacentHTML(
          "beforeend",
          `<hr><div id="nav-admin-login" class="nav-item" onclick="Actions.adminLogin()" style="opacity:0.5; font-size:12px;">🔑<span>${
            Storage.isAdmin() ? "管理者ログイン済み" : "管理者ログイン"
          }</span></div>`
        );
      }
    }
  },

  Maps(html, skipScroll = false) {
    const container = document.getElementById("view-container");
    container.innerHTML = html;
    if (!skipScroll) {
      window.scrollTo(0, 0);
    }
    // プレイヤー以外の画面ではPiPボタンを隠す（showPlayerが再表示する）
    if (!container.querySelector(".video-wrapper")) {
      const pipBtn = document.getElementById("pip-btn");
      if (pipBtn) pipBtn.style.display = "none";
    }
  },

  async routeCurrentUrl() {
    const params = new URLSearchParams(window.location.search);
    const vId = params.get("v");
    const searchQ = params.get("search");
    const mode = params.get("mode");
    const list = params.get("list");
    const channel = params.get("channel");
    const ytPlaylist = params.get("playlist");

    if (vId) {
      try {
        const data = await YT.fetchAPI("videos", { id: vId, part: "snippet" });
        if (data && data.items && data.items.length > 0) {
          Actions.currentList = data.items;
          Actions.currentIndex = 0;
          await Actions.fillStats(data.items);
          Actions.play(data.items[0], true);
        } else {
          Actions.goHome(true);
        }
      } catch (e) {
        Actions.goHome(true);
      }
    } else if (searchQ) {
      document.getElementById("search-input").value = searchQ;
      Actions.search(true);
    } else if (list) {
      Actions.viewPlaylistDetail(list, true);
    } else if (ytPlaylist) {
      const plTitle = params.get("title") || "再生リスト";
      Actions.showPlaylistView(ytPlaylist, plTitle, true);
    } else if (channel) {
      Actions.showChannel(channel, true);
    } else if (mode) {
      switch (mode) {
        case "shorts":
          Actions.showShorts(true);
          break;
        case "live":
          Actions.showLiveHub(true);
          break;
        case "subs":
          Actions.showSubs(true);
          break;
        case "history":
          Actions.showHistory(true);
          break;
        case "resume":
          Actions.showResumeList(true);
          break;
        case "playlists":
          Actions.showMyPlaylists(true);
          break;
        case "ai_recommend":
          Actions.showAIRecommendations(true);
          break;
        case "watchlater":
          Actions.showWatchLater(true);
          break;
        case "game":
          Actions.showGame(true);
          break;
        default:
          Actions.goHome(true);
      }
    } else {
      Actions.goHome(true);
    }
  },

  loadSidebarLatest() {},

  async playFromSidebar(vId) {
    const data = await YT.fetchAPI("videos", { id: vId, part: "snippet" });
    if (data.items && data.items[0]) this.play(data.items[0]);
  },

  adminLogin() {
    if (Storage.isAdmin()) return alert("既に管理者としてログインしています。");
    const pass = prompt("管理者パスワードを入力してください:");
    if (pass === "2973") {
      Storage.setAdmin(true);
      alert("管理者として認証されました✅");
      location.reload();
    } else {
      alert("パスワードが違います。");
    }
  },

  showStatusNotification(text) {
    const div = document.createElement("div");
    div.style =
      "position:fixed; top:20px; left:50%; transform:translateX(-50%); background:rgba(0,0,0,0.8); color:white; padding:10px 20px; border-radius:20px; z-index:9999; font-size:14px; pointer-events:none; transition: opacity 0.5s;";
    div.innerText = text;
    document.body.appendChild(div);
    setTimeout(() => {
      div.style.opacity = "0";
      setTimeout(() => div.remove(), 500);
    }, 3000);
  },

};
