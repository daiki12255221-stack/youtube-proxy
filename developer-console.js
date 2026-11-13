async function refreshConsoleStatus() {
  const output = document.getElementById("connection");
  try {
    const response = await fetch("/api/developer/console-status", {
      credentials: "same-origin",
      cache: "no-store"
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!data.ok) throw new Error("応答を確認できませんでした");
    output.textContent = "開発者認証済み・コンソールAPI接続済み（管理機能のデータ連携は未実装）";
  } catch (error) {
    output.textContent = `状態確認に失敗しました: ${error.message}`;
  }
}
document.getElementById("refresh")?.addEventListener("click", refreshConsoleStatus);
refreshConsoleStatus();
