async function api(url, options = {}) {
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store", ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}
async function refreshConsoleStatus() {
  const output = document.getElementById("connection");
  try {
    const data = await api("/api/developer/console-status");
    output.textContent = data.ok ? "開発者認証済み・申請管理API接続済み" : "状態を確認できません";
  } catch (error) { output.textContent = `状態確認に失敗しました: ${error.message}`; }
}
async function loadRequests() {
  const box = document.getElementById("request-list");
  try {
    const data = await api("/api/developer/requests");
    if (!data.requests.length) { box.textContent = "現在、承認待ちの申請はありません。"; return; }
    box.replaceChildren();
    for (const item of data.requests) {
      const card = document.createElement("div");
      card.style.cssText = "border:1px solid #40516e;border-radius:10px;padding:12px;margin-top:10px";
      const info = document.createElement("p");
      info.textContent = `${item.displayName} ・ ${new Date(item.createdAt).toLocaleString("ja-JP")}`;
      const actions = document.createElement("div"); actions.style.cssText = "display:flex;gap:8px";
      for (const [label, decision] of [["OK・承認", "approved"], ["NO・却下", "rejected"]]) {
        const button = document.createElement("button"); button.type = "button"; button.textContent = label;
        button.addEventListener("click", async () => {
          button.disabled = true;
          try { await api(`/api/developer/requests/${encodeURIComponent(item.id)}/decision`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }) }); await loadRequests(); }
          catch (error) { alert(error.message); button.disabled = false; }
        }); actions.append(button);
      }
      card.append(info, actions); box.append(card);
    }
  } catch (error) { box.textContent = `申請一覧の取得に失敗しました: ${error.message}`; }
}
document.getElementById("refresh")?.addEventListener("click", () => { refreshConsoleStatus(); loadRequests(); });
refreshConsoleStatus(); loadRequests();
