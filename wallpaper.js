const { Redis } = require("@upstash/redis");

const kv = new Redis({
  url: "https://big-monkfish-128403.upstash.io",
  token: "gQAAAAAAAfWTAAIgcDFiMmMyYjE5ZTA5ODc0Y2ZiYTM2NGFiYTU4MWVlMGViYQ",
});

// Node.js（Express）用のハンドラーに変更
module.exports = async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });
  const { username, action, wallpaperData } = req.body;

  if (!username) return res.status(400).json({ error: "ログインが必要です" });

  // 🎨 壁紙の保存（既存のデータは自動的に上書き消去されます）
  if (action === "save") {
    try {
      await kv.set(`user:${username}:wallpaper`, wallpaperData);
      return res
        .status(200)
        .json({ success: true, message: "🎨 壁紙をサーバーに保存しました！" });
    } catch (error) {
      return res.status(500).json({ error: "壁紙の保存に失敗しました" });
    }
  }

  // 🔄 壁紙の読み込み
  if (action === "load") {
    try {
      const data = await kv.get(`user:${username}:wallpaper`);
      if (!data)
        return res.status(404).json({ error: "壁紙が設定されていません" });
      return res.status(200).json({ success: true, wallpaper: data });
    } catch (error) {
      return res.status(500).json({ error: "壁紙の読み込みに失敗しました" });
    }
  }
};
