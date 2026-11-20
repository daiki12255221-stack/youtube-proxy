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
    const features = data.features || {};
    output.textContent = data.ok
      ? `開発者認証済み・申請管理API接続済み / 申請:${features.authenticationRequests} / 承認:${features.approvalQueue} / ワンタイムコード:${features.oneTimeCodes} / 永久承認:${features.permanentApprovals || "unknown"}`
      : "状態を確認できません";
  } catch (error) {
    output.textContent = `状態確認に失敗しました: ${error.message}`;
  }
}

function showDecisionResult(data, decision, displayName) {
  const area = document.getElementById("decision-result");
  if (!area) return;
  area.hidden = false;
  area.replaceChildren();
  const heading = document.createElement("strong");
  heading.textContent = decision === "approved" ? "承認しました" : "申請を却下しました";
  area.append(heading);
  const message = document.createElement("p");
  if (decision === "approved" && data.oneTimeCode) {
    message.textContent = `${displayName} さんに、この8桁のワンタイムパスワードを伝えてください。有効期限は発行から48時間です。コードはこの操作時に一度だけ表示されます。`;
    const code = document.createElement("p");
    code.style.cssText = "font-size:28px;font-weight:700;letter-spacing:5px;color:#a8f0c9";
    code.textContent = data.oneTimeCode;
    const copy = document.createElement("button");
    copy.type = "button";
    copy.textContent = "コードをコピー";
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(data.oneTimeCode);
        copy.textContent = "コピーしました";
      } catch (_) {
        copy.textContent = "コピーできませんでした";
      }
    });
    area.append(message, code, copy);
  } else {
    message.textContent = "申請を却下しました。";
    area.append(message);
  }
}

async function loadRequests() {
  const box = document.getElementById("request-list");
  try {
    const data = await api("/api/developer/requests");
    box.replaceChildren();
    if (!data.requests.length) {
      box.textContent = "現在、承認待ちの申請はありません。";
      return;
    }
    for (const item of data.requests) {
      const card = document.createElement("div");
      card.style.cssText = "border:1px solid #40516e;border-radius:10px;padding:12px;margin-top:10px";
      const info = document.createElement("p");
      info.textContent = `${item.displayName} ・ ${new Date(item.createdAt).toLocaleString("ja-JP")}`;
      const actions = document.createElement("div");
      actions.style.cssText = "display:flex;gap:8px;flex-wrap:wrap";
      for (const [label, decision] of [["OK・承認", "approved"], ["NO・却下", "rejected"]]) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.addEventListener("click", async () => {
          button.disabled = true;
          try {
            const result = await api(`/api/developer/requests/${encodeURIComponent(item.id)}/decision`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ decision })
            });
            showDecisionResult(result, decision, item.displayName);
            await loadRequests();
          } catch (error) {
            alert(error.message);
            button.disabled = false;
          }
        });
        actions.append(button);
      }
      card.append(info, actions);
      box.append(card);
    }
  } catch (error) {
    box.textContent = `申請一覧の取得に失敗しました: ${error.message}`;
  }
}

document.getElementById("refresh")?.addEventListener("click", () => {
  refreshConsoleStatus();
  loadRequests();
  loadApprovals();
});

async function loadApprovals() {
  const box = document.getElementById("approval-list");
  if (!box) return;
  try {
    const data = await api("/api/developer/approvals");
    box.replaceChildren();
    if (!data.approvals.length) {
      box.textContent = "現在、永久承認されているブラウザはありません。";
      return;
    }
    for (const item of data.approvals) {
      const card = document.createElement("div");
      card.style.cssText = "border:1px solid #40516e;border-radius:10px;padding:12px;margin-top:10px";
      const info = document.createElement("p");
      info.textContent = `${item.displayName || "名前なし"} ・ 承認: ${new Date(item.approvedAt).toLocaleString("ja-JP")}`;
      const revoke = document.createElement("button");
      revoke.type = "button";
      revoke.textContent = "永久承認を取り消す";
      revoke.addEventListener("click", async () => {
        if (!confirm(`${item.displayName || "このブラウザ"} の永久承認を取り消しますか？`)) return;
        revoke.disabled = true;
        try {
          await api(`/api/developer/approvals/${encodeURIComponent(item.id)}/revoke`, { method: "POST" });
          await loadApprovals();
        } catch (error) {
          alert(error.message);
          revoke.disabled = false;
        }
      });
      card.append(info, revoke);
      box.append(card);
    }
  } catch (error) {
    box.textContent = `永久承認一覧の取得に失敗しました: ${error.message}`;
  }
}

refreshConsoleStatus();
loadRequests();
loadApprovals();
