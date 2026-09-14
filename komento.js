const axios = require('axios');

module.exports = async (req, res) => {
    // クエリパラメータから動画ID、APIキー、並び順(order)、親コメントIDを取得
    const { vId, key, order, parentId } = req.query;

    // parentId がある場合は返信取得モード（vId不要）、ない場合は vId が必須
    if (!key) {
        return res.status(400).json({ error: 'Missing key' });
    }
    if (!parentId && !vId) {
        return res.status(400).json({ error: 'Missing vId or parentId' });
    }

    try {
        let url;

        if (parentId) {
            // --- 返信取得モード ---
            // YouTube Data API v3 の comments エンドポイントで返信を取得
            url = `https://www.googleapis.com/youtube/v3/comments?part=snippet&parentId=${parentId}&maxResults=100&key=${key}`;
        } else {
            // --- トップレベルコメント取得モード ---
            // 並び順の指定がない場合は 'relevance' (いいね順) をデフォルトにする
            // YouTube APIで使用可能な値: 'relevance' (人気順), 'time' (新着順)
            const sortOrder = order || 'relevance';
            url = `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${vId}&order=${sortOrder}&maxResults=50&key=${key}`;
        }

        const response = await axios.get(url);

        // 成功した場合はデータをそのまま返す
        res.status(200).json(response.data);
    } catch (error) {
        console.error('YouTube API Error (Comments):', error.response ? error.response.data : error.message);

        // エラー時はフロントエンドが壊れないよう、空のアイテムリストを返す
        res.status(200).json({ items: [] });
    }
};