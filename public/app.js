/* app.js - メインエントリーポイント
 * ------------------------------------------------------------
 * このファイルはアプリの「司令塔」です。
 * 実際の処理（ユーティリティ関数、YouTube API、localStorage管理、
 * 画面ごとの Actions メソッド群）はすべて js/ フォルダ内の各ファイルに
 * 分割されています。app.js はそれらを正しい順番で読み込むよう指示し、
 * 全部揃ったところでアプリを起動します。
 *
 * 読み込み順序（依存関係があるため厳守）:
 *   1. utils.js          … 他の全ファイルが使う共通関数
 *   2. storage.js         … localStorage ラッパー（Storage）
 *   3. yt-api.js           … YouTube Data API ラッパー（YT）
 *   4. actions-core.js     … Actions オブジェクト本体（init/ルーティング等）
 *   5. actions-home.js     … ホーム・おすすめ・マイプレイリスト
 *   6. actions-search.js   … 検索・一覧表示
 *   7. actions-player.js   … 再生操作（速度・後で見る・コメント・PiP）
 *   8. actions-stream.js   … HLS/DASH再生エンジン本体
 *   9. actions-channel.js  … チャンネルページ
 *  10. actions-library.js  … 登録チャンネル・履歴・ゲーム
 *
 * HTML側で <script src="app.js"> を1つ読み込むだけで、
 * 上記すべてが自動的にロード＆初期化されます。
 * （HTML側に個別の <script> タグを書く必要はありません）
 * ------------------------------------------------------------
 */

// ページ全体のデフォルトのリファラポリシーを no-referrer に設定
// (個別に referrerpolicy 属性を指定した要素はこの設定を上書きできる)
(function setDefaultReferrerPolicy() {
  if (document.querySelector('meta[name="referrer"]')) return; // 二重挿入防止
  const meta = document.createElement("meta");
  meta.name = "referrer";
  meta.content = "no-referrer";
  document.head.prepend(meta);
})();

const AppLoader = {
  // 依存関係の順番どおりに読み込むファイル一覧
  modules: [
    "js/utils.js",
    "js/storage.js",
    "js/yt-api.js",
    "js/actions-core.js",
    "js/actions-home.js",
    "js/actions-search.js",
    "js/actions-player.js",
    "js/actions-stream.js",
    "js/actions-channel.js",
    "js/actions-library.js",
  ],

  // app.js 自身の場所を基準に、js/ フォルダの絶対パスを決定する
  getBasePath() {
    const current =
      document.currentScript && document.currentScript.src
        ? document.currentScript.src
        : "";
    return current ? current.replace(/app\.js(\?.*)?$/, "") : "";
  },

  loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = false; // 挿入順で実行させる（依存関係を守るため）
      script.onload = () => resolve(src);
      script.onerror = () => reject(new Error(`読み込み失敗: ${src}`));
      document.head.appendChild(script);
    });
  },

  async loadAll() {
    const base = this.getBasePath();
    for (const mod of this.modules) {
      await this.loadScript(base + mod);
    }
  },
};

window.onload = async () => {
  try {
    // 1. 分割ファイル群を順番に読み込む（依存順を保証）
    await AppLoader.loadAll();

    // 2. すべて揃ったのでアプリを起動する
    Actions.init();
    await YT.refreshEduKey();
    Actions.routeCurrentUrl();
  } catch (error) {
    console.error("アプリの初期化に失敗しました:", error);
  }
};
