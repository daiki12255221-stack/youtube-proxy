const { Redis } = require("@upstash/redis");
const crypto = require("crypto");

const kv = new Redis({
  url: "https://big-monkfish-128403.upstash.io",
  token: "gQAAAAAAAfWTAAIgcDFiMmMyYjE5ZTA5ODc0Y2ZiYTM2NGFiYTU4MWVlMGViYQ",
});

// Node.js（Express）用のハンドラーに変更
module.exports = async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });
  const { action, username, password } = req.body;

  if (!username || !password)
    return res
      .status(400)
      .json({ error: "ユーザー名とパスワードを入力してください" });

  const hashPassword = (pwd) => {
    return crypto
      .createHmac("sha256", "super-secret-key")
      .update(pwd)
      .digest("hex");
  };

  if (action === "signup") {
    try {
      const exists = await kv.exists(`user:${username}`);
      if (exists)
        return res
          .status(400)
          .json({ error: "このユーザー名は既に使われています" });

      const hashedPassword = hashPassword(password);
      await kv.set(
        `user:${username}`,
        JSON.stringify({ password: hashedPassword })
      );
      await kv.sadd("all_users", username);
      return res
        .status(200)
        .json({ success: true, message: "アカウントを作成しました！" });
    } catch (error) {
      return res.status(500).json({ error: "サーバーエラー" });
    }
  }

  if (action === "login") {
    try {
      const userData = await kv.get(`user:${username}`);
      if (!userData)
        return res
          .status(400)
          .json({ error: "ユーザー名またはパスワードが違います" });

      // Redisから取得したデータが文字列の場合はパースする
      let parsedData = userData;
      if (typeof userData === "string") {
        parsedData = JSON.parse(userData);
      }

      const hashedPassword = hashPassword(password);
      if (parsedData.password !== hashedPassword)
        return res
          .status(400)
          .json({ error: "ユーザー名またはパスワードが違います" });

      await kv.sadd("all_users", username);
      return res.status(200).json({ success: true, username: username });
    } catch (error) {
      return res.status(500).json({ error: "サーバーエラー" });
    }
  }
};
