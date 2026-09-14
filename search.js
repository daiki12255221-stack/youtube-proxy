/**
 * search.js - APIキー管理 & データ取得エンジン
 */

const SearchHandler = {
  // app.jsと同期させるため、最新のキーリストを保持
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
    "AIzaSyBAuXbk8AocoPImN0gL14f87J62IJsoea4",
    "AIzaSyB13z_kssSC_JKmO9oAKb0OHR2dQHd2ptw",
    "AIzaSyDTN6IrgVl3KU7zsAFwF00dzUvwRUXCW9w",
    "AIzaSyA9TvW4DMYbDyZg1NrhzXOsJTc2L9L_jcI",
    "AIzaSyA9mcZEtfjfcroZuMjIxzvdklBmMnqIZfU",
    "AIzaSyBN1HHKaTf1LPc0RaHQlBKOxd0hrRjoRBw",
    "AIzaSyAhpuyU1zwEfOhX_6GGYxOMMSKjmEzCtGU",
    "AIzaSyBIEOiVBH2Ie_HeRk32XDjaAdroDZPJrYs",
    "AIzaSyCxrx3veof89ZNA3-usEWBjgcHze5-WiEI",
    "AIzaSyAA7IsnGA1X2GTv-cvZVeyiTIvFwRR7wT0",
  ],

  // APIキャッシュ（同じ検索を短時間に繰り返さないため）
  cache: new Map(),
  CACHE_TIME: 5 * 60 * 1000, // 5分間

  /**
   * 現在有効なキーのインデックスを取得
   */
  getKeyIndex() {
    return parseInt(localStorage.getItem("yt_active_key_index")) || 0;
  },

  /**
   * 次のキーに切り替え
   */
  rotateKey() {
    let index = this.getKeyIndex() + 1;
    if (index >= this.keys.length) index = 0;
    localStorage.setItem("yt_active_key_index", index);
    console.warn(`[SearchHandler] キーを切り替えました。現在のIndex: ${index}`);
    return index;
  },

  /**
   * メインのデータ取得関数 (競合回避のため名前を requestAPI に変更)
   * @param {string} endpoint - 'search', 'videos', 'channels' など
   * @param {Object} params - APIパラメータ
   * @param {number} retryCount - リトライ回数（内部用）
   */
  async requestAPI(endpoint, params, retryCount = 0) {
    // 全てのキーを試した場合は終了
    if (retryCount >= this.keys.length) {
      console.error("[SearchHandler] 全てのAPIキーが制限または無効です。");
      return { items: [], nextPageToken: "" };
    }

    // キャッシュチェック (GETリクエストかつ1ページ目の場合のみ)
    const cacheKey = `${endpoint}-${JSON.stringify(params)}`;
    if (!params.pageToken && this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.time < this.CACHE_TIME) {
        console.log("[SearchHandler] キャッシュからデータを返します");
        return cached.data;
      }
    }

    const currentKey = this.keys[this.getKeyIndex()];
    const queryParams = new URLSearchParams({ ...params, key: currentKey });
    const url = `https://www.googleapis.com/youtube/v3/${endpoint}?${queryParams.toString()}`;

    try {
      // 💡 window.fetch を明示的に指定して、ブラウザ標準のfetchを確実に呼び出す
      const response = await window.fetch(url);

      // 403(制限) または 400(無効なキー) の場合
      if (response.status === 403 || response.status === 400) {
        const errorData = await response.json();
        console.error(
          `[SearchHandler] エラー発生 (${response.status}):`,
          errorData.error.message
        );

        this.rotateKey(); // キーを回す
        return await this.requestAPI(endpoint, params, retryCount + 1); // 次のキーでリトライ
      }

      if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

      const data = await response.json();

      // 成功した結果をキャッシュに保存（1ページ目のみ）
      if (!params.pageToken) {
        this.cache.set(cacheKey, { time: Date.now(), data: data });
      }

      return data;
    } catch (error) {
      console.error("[SearchHandler] 通信エラー:", error);
      // ネットワークエラー等の場合も、とりあえずキーを変えて1回だけリトライ
      if (retryCount < 1) {
        this.rotateKey();
        return await this.requestAPI(endpoint, params, retryCount + 1);
      }
      return { items: [], nextPageToken: "" };
    }
  },
};

// 互換性維持: app.js が「SearchHandler.fetch」の名前で呼び出していても動くようにするお守り
SearchHandler.fetch = SearchHandler.requestAPI;
