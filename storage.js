/* storage.js - localStorage ラッパー
 * 視聴履歴・後で見る・登録チャンネル・マイプレイリスト・シークレットモード等、
 * ブラウザ側の永続データをすべてここに集約する。
 * 依存: YT（getVideoId）/ Actions（loadSidebarLatest, showHistory 呼び出し）
 */

const Storage = {
  get(key) {
    const data = localStorage.getItem(key);
    try {
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  },
  set(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  },
  isAdmin() {
    return localStorage.getItem("is_admin") === "true";
  },
  setAdmin(status) {
    localStorage.setItem("is_admin", status);
  },

  // 🔐 現在ログイン中のユーザー名を返す（未ログインなら null）
  // backup.js(DataManager)が保存している googlo_logged_in_user を読むだけの薄いラッパー。
  // ここを共通の参照先にしておくことで、他の場所からログイン状態を見るときも
  // キー名を意識せずに済むようにする。
  getLoggedInUser() {
    return localStorage.getItem("googlo_logged_in_user") || null;
  },

  isIncognito() {
    return localStorage.getItem("yt_incognito") === "true";
  },
  setIncognito(status) {
    localStorage.setItem("yt_incognito", status);
  },

  saveResumeProgress(video, currentTime, duration) {
    if (this.isIncognito()) return;
    let list = this.get("yt_resume_list");
    if (!Array.isArray(list)) list = [];

    const vId = YT.getVideoId(video);
    if (!vId) return;

    if (duration > 0 && currentTime / duration >= 0.95) {
      list = list.filter((item) => item.id !== vId);
      this.set("yt_resume_list", list);
      return;
    }

    const newItem = {
      id: vId,
      title: video.snippet.title,
      thumb: `/api/thumb?id=${vId}`,
      channelTitle: video.snippet.channelTitle,
      time: Math.floor(currentTime),
      duration: Math.floor(duration),
      timestamp: Date.now(),
    };

    list = [newItem, ...list.filter((item) => item.id !== vId)].slice(0, 3);
    this.set("yt_resume_list", list);
  },

  getResumeTime(vId) {
    const list = this.get("yt_resume_list");
    const item = list.find((i) => i.id === vId);
    return item ? item.time : 0;
  },

  addHistory(v) {
    if (this.isIncognito()) return;
    let h = this.get("yt_history");
    h = [v, ...h.filter((x) => x.id !== v.id)].slice(0, 500);
    this.set("yt_history", h);
  },

  deleteHistoryItem(vId) {
    let h = this.get("yt_history");
    h = h.filter((x) => x.id !== vId);
    this.set("yt_history", h);
  },

  clearAllHistory() {
    if (confirm("すべての視聴履歴を削除しますか？")) {
      this.set("yt_history", []);
      Actions.showHistory();
    }
  },

  toggleSub(ch) {
    let s = this.get("yt_subs");
    const i = s.findIndex((x) => x.id === ch.id);
    if (i > -1) s.splice(i, 1);
    else s.push({ id: ch.id, name: ch.name, thumb: ch.thumb || "" });
    this.set("yt_subs", s);
    Actions.loadSidebarLatest();
  },
  toggleWatchLater(v) {
    let list = this.get("yt_watchlater");
    const i = list.findIndex((x) => x.id === v.id);
    if (i > -1) list.splice(i, 1);
    else list.unshift({ ...v, savedAt: new Date().toISOString() });
    this.set("yt_watchlater", list);
  },
  isWatchLater(id) {
    return this.get("yt_watchlater").some((x) => x.id === id);
  },
  getMyPlaylists() {
    const d = localStorage.getItem("yt_my_playlists");
    try {
      return d ? JSON.parse(d) : {};
    } catch (e) {
      return {};
    }
  },
  setMyPlaylists(data) {
    localStorage.setItem("yt_my_playlists", JSON.stringify(data));
  },
  createPlaylist(name) {
    let dict = this.getMyPlaylists();
    if (dict[name]) return alert("既に同じ名前のリストがあります");
    dict[name] = [];
    this.setMyPlaylists(dict);
  },
  deletePlaylist(name) {
    let dict = this.getMyPlaylists();
    delete dict[name];
    this.setMyPlaylists(dict);
  },
  addToPlaylist(name, video) {
    let dict = this.getMyPlaylists();
    if (!dict[name]) return;
    if (dict[name].some((v) => v.id === video.id))
      return alert("既に入っています");
    dict[name].push(video);
    this.setMyPlaylists(dict);
    alert(`「${name}」に追加しました！`);
  },
  removeFromPlaylist(name, videoId) {
    let dict = this.getMyPlaylists();
    if (!dict[name]) return;
    dict[name] = dict[name].filter((v) => v.id !== videoId);
    this.setMyPlaylists(dict);
  },
};
