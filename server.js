const express = require("express");
const path = require("path");
const fetch = require("node-fetch");
const crypto = require("crypto");
const { Redis } = require("@upstash/redis");
const kv = new Redis({ url: "https://big-monkfish-128403.upstash.io", token: "gQAAAAAAAfWTAAIgcDFiMmMyYjE5ZTA5ODc0Y2ZiYTM2NGFiYTU4MWVlMGViYQ" });
const { getStreamUrl } = require("./streaming.js");

const app = express();

// 🔑 サーバー側で保持する秘密の合言葉（フロントからは絶対に見えません）
const SECRET_KEY = "json-study";
const AUTH_COOKIE_NAME = "app_auth_token";
const AUTH_TOKEN_VALUE = "valid_authenticated_user_token_98777";

// 開発者ログイン設定
// URLの数字はログイン画面を表示するための識別子であり、認証情報ではありません。
const DEVELOPER_MODE_ID = "67247431";
const DEVELOPER_COOKIE_NAME = "developer_session";
const DEVELOPER_SESSION_MAX_AGE = 12 * 60 * 60 * 1000; // 12時間
// ★ 開発者パスワード：ここを変更（16文字以上を推奨）
const DEVELOPER_PASSWORD = "mmhmr38bbamanaita";
// ★ セッション署名用の秘密文字列：ここも別のランダムな値に変更（32文字以上）
const DEVELOPER_SESSION_SECRET = "47357694593793232836817336800406";

function signDeveloperSession(issuedAt) {
  return crypto
    .createHmac("sha256", DEVELOPER_SESSION_SECRET)
    .update(String(issuedAt))
    .digest("hex");
}

function isValidDeveloperSession(token) {
  if (!token || !DEVELOPER_SESSION_SECRET) return false;
  const [issuedAtText, suppliedSignature] = token.split(".");
  const issuedAt = Number(issuedAtText);
  if (!Number.isSafeInteger(issuedAt) || !suppliedSignature) return false;

  const age = Date.now() - issuedAt;
  if (age < 0 || age > DEVELOPER_SESSION_MAX_AGE) return false;

  const expected = Buffer.from(signDeveloperSession(issuedAt), "hex");
  let supplied;
  try {
    supplied = Buffer.from(suppliedSignature, "hex");
  } catch {
    return false;
  }
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

function developerCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: DEVELOPER_SESSION_MAX_AGE,
  };
}

// 簡易Cookieパーサー関数（これの定義が抜けていたためエラーになっています）
function parseCookies(req) {
  const list = {};
  const rc = req.headers.cookie;
  if (rc) {
    rc.split(";").forEach((cookie) => {
      const parts = cookie.split("=");
      list[parts.shift().trim()] = decodeURI(parts.join("="));
    });
  }
  return list;
}
// ミドルウェアの設定
app.use(express.json({ limit: "4mb" }));
app.use(express.urlencoded({ extended: true, limit: "4mb" }));

// Expressの場合
app.use((req, res, next) => {
  // ブラウザに対してリファラを一切保持・送信させないヘッダー
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

// 🔒 CORS設定
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS"
  );
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

// 🌟 生存確認用Ping (無条件許可)
app.get("/api/ping", (req, res) => {
  res.setHeader("Content-Type", "text/plain");
  return res.status(200).send("alive");
});

// 一般ユーザーの申請入口・申請後の状態確認・ワンタイムコード認証
const REQUEST_ENTRY_COOKIE = "access_request_entry";
const REQUEST_TRACK_COOKIE = "access_request_track";
const REQUEST_ENTRY_TTL = 15 * 60;
const REQUEST_TRACK_TTL = 60 * 60 * 24 * 14;
const ONE_TIME_CODE_TTL = 60 * 60 * 48; // 48時間
// 永久承認Cookie。Redis側の承認レコードには有効期限を設定しない。
const USER_APPROVAL_COOKIE_MAX_AGE = 10 * 365 * 24 * 60 * 60 * 1000; // 10年

function requestEntryOptions() {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: REQUEST_ENTRY_TTL * 1000 };
}
function requestTrackOptions() {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: REQUEST_TRACK_TTL * 1000 };
}
function userAuthCookieOptions() {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: USER_APPROVAL_COOKIE_MAX_AGE };
}
function hashAccessToken(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}
function hashOneTimeCode(requestId, code) {
  return crypto.createHash("sha256")
    .update(`${requestId}:${code}:${DEVELOPER_SESSION_SECRET}`)
    .digest("hex");
}

app.get("/access-request", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const cookies = parseCookies(req);
    const trackingId = cookies[REQUEST_TRACK_COOKIE];

    if (trackingId) {
      const raw = await kv.get(`access:request:${trackingId}`);
      if (raw) {
        const item = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (item.status === "pending") {
          return res.type("html").send(accessRequestPage("pending"));
        }
        if (item.status === "rejected") {
          return res.type("html").send(accessRequestPage("rejected"));
        }
        if (item.status === "approved") {
          return res.type("html").send(accessRequestPage("approved"));
        }
        if (item.status === "completed") {
          return res.type("html").send(accessRequestPage("completed"));
        }
      }
      res.clearCookie(REQUEST_TRACK_COOKIE, { path: "/" });
    }

    const entry = cookies[REQUEST_ENTRY_COOKIE];
    if (!entry || !(await kv.get(`access:entry:${entry}`))) {
      return res.status(403).send("申請用URLから入り直してください。");
    }
    return res.type("html").send(accessRequestPage("new"));
  } catch (error) {
    console.error("access page error", error.message);
    return res.status(503).send("申請ページを読み込めませんでした。時間をおいて再試行してください。");
  }
});

function accessRequestPage(initialState) {
  return `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>サイト利用認証</title>
<style>
body{font-family:system-ui;background:#101827;color:#eef;padding:24px}.box{max-width:440px;margin:8vh auto;background:#1b2940;padding:24px;border-radius:14px}
input,button{box-sizing:border-box;width:100%;padding:12px;margin-top:12px;border-radius:8px;border:1px solid #53627a}
input{background:#101827;color:white}button{background:#dce8ff;color:#10203a;font-weight:bold;cursor:pointer}
button:disabled{opacity:.55}#msg{white-space:pre-wrap;line-height:1.7}.hidden{display:none}
</style>
<main class="box"><h1>サイト利用認証</h1><div id="request" class="${initialState === "new" ? "" : "hidden"}">
<p>表示名を入力して認証を申請してください。</p><form id="request-form"><label>表示名<input name="displayName" maxlength="32" required></label><button>認証を申請する</button></form></div>
<div id="code-area" class="${initialState === "approved" ? "" : "hidden"}"><p>申請が承認されました。管理者から受け取ったワンタイムパスワードを入力してください。</p><form id="code-form"><label>ワンタイムパスワード<input name="code" inputmode="numeric" autocomplete="one-time-code" minlength="8" maxlength="8" required></label><button>認証する</button></form></div>
<p id="msg" role="status">${initialState === "pending" ? "申請を受け付けました。管理者の承認をお待ちください。このページを開いたままお待ちください。" : initialState === "rejected" ? "申請は承認されませんでした。必要な場合は管理者にお問い合わせください。" : initialState === "completed" ? "この申請はすでに認証済みです。サイトを開き直してください。" : ""}</p>
</main>
<script>
const msg=document.getElementById('msg');
const requestBox=document.getElementById('request');
const codeArea=document.getElementById('code-area');
function showState(state){
  if(state==='pending'){requestBox.classList.add('hidden');codeArea.classList.add('hidden');msg.textContent='申請を受け付けました。管理者の承認をお待ちください。このページを開いたままお待ちください。';}
  if(state==='approved'){requestBox.classList.add('hidden');codeArea.classList.remove('hidden');msg.textContent='申請が承認されました。ワンタイムパスワードを入力してください。';}
  if(state==='rejected'){requestBox.classList.add('hidden');codeArea.classList.add('hidden');msg.textContent='申請は承認されませんでした。必要な場合は管理者にお問い合わせください。';}
  if(state==='completed'){requestBox.classList.add('hidden');codeArea.classList.add('hidden');msg.textContent='この申請はすでに認証済みです。サイトを開き直してください。';}
}
document.getElementById('request-form')?.addEventListener('submit',async e=>{
  e.preventDefault();const b=e.target.querySelector('button');b.disabled=true;
  try{const r=await fetch('/api/access/request',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({displayName:e.target.displayName.value})});const d=await r.json();if(!r.ok)throw Error(d.error||'申請できませんでした');showState('pending');}
  catch(x){msg.textContent=x.message;b.disabled=false;}
});
document.getElementById('code-form')?.addEventListener('submit',async e=>{
  e.preventDefault();const b=e.target.querySelector('button');b.disabled=true;msg.textContent='認証中…';
  try{const r=await fetch('/api/access/verify-code',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({code:e.target.code.value.trim()})});const d=await r.json();if(!r.ok)throw Error(d.error||'認証できませんでした');msg.textContent='認証しました。サイトへ移動します…';location.replace('/');}
  catch(x){msg.textContent=x.message;b.disabled=false;}
});
async function pollStatus(){
  try{const r=await fetch('/api/access/status',{credentials:'same-origin',cache:'no-store'});const d=await r.json();if(r.ok&&d.status)showState(d.status);}
  catch(_){}
}
setInterval(pollStatus,5000);
</script></html>`;
}

app.get("/api/access/status", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const requestId = parseCookies(req)[REQUEST_TRACK_COOKIE];
    if (!requestId) return res.status(401).json({ error: "申請情報がありません。" });
    const raw = await kv.get(`access:request:${requestId}`);
    if (!raw) return res.status(404).json({ error: "申請が見つかりません。" });
    const item = typeof raw === "string" ? JSON.parse(raw) : raw;
    return res.json({ ok: true, status: item.status });
  } catch (error) {
    console.error("access status error", error.message);
    return res.status(503).json({ error: "状態を確認できませんでした。" });
  }
});

app.post("/api/access/request", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const entry = parseCookies(req)[REQUEST_ENTRY_COOKIE];
    if (!entry || !(await kv.get(`access:entry:${entry}`))) return res.status(403).json({ error: "申請用URLから入り直してください。" });
    const displayName = typeof req.body?.displayName === "string" ? req.body.displayName.trim().slice(0, 32) : "";
    if (!displayName) return res.status(400).json({ error: "表示名を入力してください。" });
    const requestId = crypto.randomUUID();
    const record = { id: requestId, displayName, status: "pending", createdAt: new Date().toISOString() };
    await kv.set(`access:request:${requestId}`, JSON.stringify(record), { ex: REQUEST_TRACK_TTL });
    await kv.lpush("access:requests", requestId);
    await kv.del(`access:entry:${entry}`);
    res.clearCookie(REQUEST_ENTRY_COOKIE, { path: "/" });
    res.cookie(REQUEST_TRACK_COOKIE, requestId, requestTrackOptions());
    return res.status(201).json({ ok: true, requestId });
  } catch (error) {
    console.error("access request error", error.message);
    return res.status(503).json({ error: "申請を保存できませんでした。時間をおいて再試行してください。" });
  }
});

app.post("/api/access/verify-code", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const requestId = parseCookies(req)[REQUEST_TRACK_COOKIE];
    const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
    if (!requestId) return res.status(401).json({ error: "申請情報がありません。申請URLからやり直してください。" });
    if (!/^\d{8}$/.test(code)) return res.status(400).json({ error: "8桁のコードを入力してください。" });

    const key = `access:request:${requestId}`;
    const raw = await kv.get(key);
    if (!raw) return res.status(404).json({ error: "申請が見つかりません。" });
    const item = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (item.status !== "approved") return res.status(409).json({ error: "この申請はまだ承認されていないか、すでに使用済みです。" });
    if (!item.oneTimeCodeHash || !item.oneTimeCodeExpiresAt || Date.now() > Date.parse(item.oneTimeCodeExpiresAt)) {
      return res.status(410).json({ error: "ワンタイムパスワードの有効期限が切れています。管理者に再申請を依頼してください。" });
    }
    const suppliedHash = hashOneTimeCode(requestId, code);
    const expected = Buffer.from(item.oneTimeCodeHash, "hex");
    const supplied = Buffer.from(suppliedHash, "hex");
    if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) {
      const attemptsKey = `access:code-attempts:${requestId}`;
      const attempts = await kv.incr(attemptsKey);
      if (attempts === 1) await kv.expire(attemptsKey, ONE_TIME_CODE_TTL);
      if (attempts >= 5) {
        return res.status(429).json({ error: "コードの入力回数が上限に達しました。管理者に再申請を依頼してください。" });
      }
      return res.status(401).json({ error: "ワンタイムパスワードが違います。" });
    }

    // RedisのNX書き込みを使い、同じコードを同時に送信しても1回だけ成功させる。
    const consumed = await kv.set(`access:code-used:${requestId}`, "1", { nx: true, ex: ONE_TIME_CODE_TTL });
    if (consumed !== "OK") return res.status(409).json({ error: "このワンタイムパスワードはすでに使用されています。" });

    const sessionToken = crypto.randomBytes(32).toString("hex");
    const approvalId = hashAccessToken(sessionToken);
    const approvedAt = new Date().toISOString();
    const approvalRecord = {
      id: approvalId,
      requestId,
      displayName: item.displayName,
      approvedAt,
      status: "active"
    };
    // 永久承認レコード。期限を付けず、管理者が取り消すまで有効。
    await kv.set(`access:approval:${approvalId}`, JSON.stringify(approvalRecord));
    await kv.lpush("access:approvals", approvalId);
    item.status = "completed";
    item.completedAt = approvedAt;
    item.approvalId = approvalId;
    delete item.oneTimeCodeHash;
    delete item.oneTimeCodeExpiresAt;
    await kv.set(key, JSON.stringify(item), { ex: REQUEST_TRACK_TTL });
    res.cookie(AUTH_COOKIE_NAME, sessionToken, userAuthCookieOptions());
    res.clearCookie(REQUEST_TRACK_COOKIE, { path: "/" });
    return res.json({ ok: true });
  } catch (error) {
    console.error("one-time code verification error", error.message);
    return res.status(503).json({ error: "認証処理に失敗しました。時間をおいて再試行してください。" });
  }
});

// 開発者ログイン画面。URLのmode値は画面表示にしか使いません。
app.get("/", (req, res, next) => {
  if (req.query.mode !== DEVELOPER_MODE_ID) return next();
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.status(200).send(`<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>Developer Login</title>
<style>body{font-family:sans-serif;background:#111;color:#eee;display:grid;place-items:center;min-height:100vh;margin:0}.panel{width:min(360px,calc(100% - 40px));background:#222;padding:24px;border-radius:14px;box-sizing:border-box}input,button{box-sizing:border-box;width:100%;padding:12px;margin-top:12px;border-radius:8px;border:1px solid #555}input{background:#111;color:#fff}button{background:#eee;color:#111;font-weight:bold;cursor:pointer}#message{color:#ff8a80;min-height:1.5em;font-size:14px}</style></head>
<body><main class="panel"><h2>開発者ログイン</h2><form id="login"><label for="password">開発者パスワード</label><input id="password" type="password" autocomplete="current-password" required><button type="submit">ログイン</button></form><p id="message" role="status"></p></main>
<script>document.getElementById('login').addEventListener('submit',async function(e){e.preventDefault();const button=this.querySelector('button');const message=document.getElementById('message');button.disabled=true;message.textContent='認証中…';try{const response=await fetch('/api/developer/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:document.getElementById('password').value})});const data=await response.json();if(!response.ok)throw new Error(data.error||'ログインできませんでした');location.replace('/');}catch(error){message.textContent=error.message;button.disabled=false;}});</script></body></html>`);
});


// 🔐 開発者コンソール：開発者セッションだけに限定
function requireDeveloperSession(req, res, next) {
  const cookies = parseCookies(req);
  if (!isValidDeveloperSession(cookies[DEVELOPER_COOKIE_NAME])) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(403).send("403 Forbidden");
  }
  next();
}

// ?mode=Console は開発者セッションがある場合だけHTMLを返す。
// 一般ユーザーCookieや旧Storage.isAdmin()は認証に使わない。
app.get("/", (req, res, next) => {
  if (req.query.mode !== "Console") return next();
  const cookies = parseCookies(req);
  if (!isValidDeveloperSession(cookies[DEVELOPER_COOKIE_NAME])) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(403).send("403 Forbidden");
  }
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  return res.sendFile(path.join(__dirname, "private-console", "developer-console.html"));
});

// 開発者パスワードの照合と、署名付き・期限付きHttpOnlyセッションの発行
const developerLoginAttempts = new Map();
app.post("/api/developer/login", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!DEVELOPER_PASSWORD || DEVELOPER_PASSWORD.length < 16 || !DEVELOPER_SESSION_SECRET || DEVELOPER_SESSION_SECRET.length < 32) {
    return res.status(503).json({ error: "開発者ログインの設定を確認してください。パスワードは16文字以上、署名用秘密文字列は32文字以上にしてください。" });
  }

  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const attempt = developerLoginAttempts.get(ip) || { count: 0, resetAt: now + 15 * 60 * 1000 };
  if (now > attempt.resetAt) {
    attempt.count = 0;
    attempt.resetAt = now + 15 * 60 * 1000;
  }
  if (attempt.count >= 5) {
    return res.status(429).json({ error: "試行回数が多すぎます。しばらく待ってから再試行してください。" });
  }

  const suppliedPassword = typeof req.body?.password === "string" ? req.body.password : "";
  const expectedDigest = crypto.createHash("sha256").update(DEVELOPER_PASSWORD, "utf8").digest();
  const suppliedDigest = crypto.createHash("sha256").update(suppliedPassword, "utf8").digest();
  const passwordMatches = crypto.timingSafeEqual(expectedDigest, suppliedDigest);

  if (!passwordMatches) {
    attempt.count += 1;
    developerLoginAttempts.set(ip, attempt);
    return res.status(401).json({ error: "パスワードが違います。" });
  }

  developerLoginAttempts.delete(ip);
  const issuedAt = Date.now();
  const token = `${issuedAt}.${signDeveloperSession(issuedAt)}`;
  res.cookie(DEVELOPER_COOKIE_NAME, token, developerCookieOptions());
  return res.status(200).json({ ok: true });
});

// 🚪 ログアウト処理 (一般・開発者Cookieを削除)
app.get("/api/logout", (req, res) => {
  res.clearCookie(AUTH_COOKIE_NAME, { path: "/" });
  res.clearCookie(DEVELOPER_COOKIE_NAME, { path: "/", httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict" });
  return res.redirect("/");
});

// 🛡️ 【最重要】バックエンド認証ミドルウェア
app.use(async (req, res, next) => {
  // 1. URLパラメータに合言葉（?mode=python-study）が含まれている場合
  if (req.query.mode === SECRET_KEY) {
    const entry = crypto.randomBytes(24).toString("hex");
    try { await kv.set(`access:entry:${entry}`, "1", { ex: REQUEST_ENTRY_TTL }); }
    catch (error) { console.error("entry creation error", error.message); return res.status(503).send("申請ページを準備できませんでした。時間をおいて再試行してください。"); }
    res.cookie(REQUEST_ENTRY_COOKIE, entry, requestEntryOptions());
    return res.redirect("/access-request");
  }
  // 申請ページと申請APIは、申請用ワンタイム入口Cookieで個別に認証する。
  if (req.path === "/access-request" || req.path === "/api/access/request") return next();

  // 2. 一般ユーザーCookieまたは有効な開発者セッションを確認
  const cookies = parseCookies(req);
  if (cookies[AUTH_COOKIE_NAME] === AUTH_TOKEN_VALUE) {
    return next();
  }
  if (cookies[AUTH_COOKIE_NAME]) {
    try {
      const tokenHash = hashAccessToken(cookies[AUTH_COOKIE_NAME]);
      const approval = await kv.get(`access:approval:${tokenHash}`);
      if (approval) return next();
      // 旧バージョンで発行済みの30日セッションは期限まで互換維持。
      const legacySession = await kv.get(`access:session:${tokenHash}`);
      if (legacySession) return next();
    } catch (error) {
      console.error("user approval lookup error", error.message);
      return res.status(503).send("認証状態を確認できませんでした。");
    }
  }
  if (isValidDeveloperSession(cookies[DEVELOPER_COOKIE_NAME])) {
    return next();
  }

  // 3. 未認証の場合は 403 Forbidden を返してアクセスを完全にブロック
  res.status(403).send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>403 Forbidden</title>
      <style>
        body { font-family: sans-serif; text-align: center; margin-top: 15%; background: #fff; color: #000; }
        h1 { font-size: 42px; margin-bottom: 10px; }
        p { font-size: 18px; color: #666; }
      </style>
    </head>
    <body>
      <h1>403 Forbidden</h1>
      <p>You don't have permission to access this resource.</p>
    </body>
    </html>
  `);
});

// コンソール用JSは開発者セッション専用。一般ユーザーCookieでは取得不可。
app.get("/developer-console.js", requireDeveloperSession, (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.sendFile(path.join(__dirname, "private-console", "developer-console.js"));
});

// 開発者コンソール：申請一覧
app.get("/api/developer/requests", requireDeveloperSession, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const ids = await kv.lrange("access:requests", 0, 99);
    const records = [];
    for (const id of ids) {
      const raw = await kv.get(`access:request:${id}`);
      if (!raw) continue;
      const item = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (item.status === "pending") records.push(item);
    }
    return res.json({ ok: true, requests: records });
  } catch (error) {
    console.error("request list error", error.message);
    return res.status(503).json({ ok: false, error: "申請一覧を取得できませんでした。" });
  }
});
app.post("/api/developer/requests/:id/decision", requireDeveloperSession, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const decision = req.body?.decision;
  if (!["approved", "rejected"].includes(decision)) return res.status(400).json({ error: "不正な操作です。" });
  try {
    const key = `access:request:${req.params.id}`;
    const raw = await kv.get(key);
    if (!raw) return res.status(404).json({ error: "申請が見つかりません。" });
    const item = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (item.status !== "pending") return res.status(409).json({ error: "この申請はすでに処理されています。" });
    item.status = decision;
    item.decidedAt = new Date().toISOString();
    let oneTimeCode;
    if (decision === "approved") {
      oneTimeCode = String(crypto.randomInt(10000000, 100000000));
      item.oneTimeCodeHash = hashOneTimeCode(item.id, oneTimeCode);
      item.oneTimeCodeExpiresAt = new Date(Date.now() + ONE_TIME_CODE_TTL * 1000).toISOString();
    }
    await kv.set(key, JSON.stringify(item), { ex: REQUEST_TRACK_TTL });
    return res.json({ ok: true, status: decision, ...(oneTimeCode ? { oneTimeCode, expiresInSeconds: ONE_TIME_CODE_TTL } : {}) });
  } catch (error) {
    console.error("request decision error", error.message);
    return res.status(503).json({ error: "処理を保存できませんでした。" });
  }
});

// 永久承認一覧（開発者のみ）
app.get("/api/developer/approvals", requireDeveloperSession, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const ids = await kv.lrange("access:approvals", 0, 499);
    const approvals = [];
    const seen = new Set();
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      const raw = await kv.get(`access:approval:${id}`);
      if (!raw) continue;
      const item = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (item.status === "active") approvals.push(item);
    }
    return res.json({ ok: true, approvals });
  } catch (error) {
    console.error("approval list error", error.message);
    return res.status(503).json({ ok: false, error: "永久承認一覧を取得できませんでした。" });
  }
});

// 永久承認の取り消し。Cookieが残っていても次のアクセスから拒否される。
app.post("/api/developer/approvals/:id/revoke", requireDeveloperSession, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const id = String(req.params.id || "");
  if (!/^[a-f0-9]{64}$/.test(id)) return res.status(400).json({ error: "不正な承認IDです。" });
  try {
    const key = `access:approval:${id}`;
    const raw = await kv.get(key);
    if (!raw) return res.status(404).json({ error: "承認が見つからないか、すでに取り消されています。" });
    const item = typeof raw === "string" ? JSON.parse(raw) : raw;
    await kv.del(key);
    return res.json({ ok: true, revoked: true, displayName: item.displayName || "" });
  } catch (error) {
    console.error("approval revoke error", error.message);
    return res.status(503).json({ error: "承認を取り消せませんでした。" });
  }
});

// コンソール用APIも開発者セッション専用。
app.get("/api/developer/console-status", requireDeveloperSession, (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  return res.json({
    ok: true,
    features: {
      authenticationRequests: "connected",
      approvalQueue: "connected",
      oneTimeCodes: "connected",
      sessionManagement: "not_connected",
      permanentApprovals: "connected"
    }
  });
});

// 🛠️ 認証済みの場合のみトップページと静的ファイルを配信
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.use(express.static(__dirname));

// Edge Runtime互換ラッパー
async function handleEdge(handler, req, res) {
  try {
    if (typeof handler !== "function") {
      return res.status(500).json({ error: "Handler is not a function" });
    }

    const protocol = req.protocol;
    const host = req.get("host");
    const fullUrl = `${protocol}://${host}${req.originalUrl}`;

    const webReq = {
      url: fullUrl,
      method: req.method,
      headers: new Headers(req.headers),
      body:
        req.method !== "GET" && req.method !== "HEAD"
          ? JSON.stringify(req.body)
          : null,
      searchParams: new URL(fullUrl).searchParams,
    };

    const webRes = await handler(webReq);

    if (webRes && (webRes.status === 302 || webRes.status === 301)) {
      const redirectUrl = webRes.headers.get("Location");
      if (redirectUrl) {
        return res.redirect(webRes.status, redirectUrl);
      }
    }

    res.status(webRes.status || 200);
    webRes.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    const bodyText = await webRes.text();
    res.send(bodyText);
  } catch (error) {
    console.error("Edge関数実行エラー:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}

// 🌐 Invidious インスタンスリスト
const INVIDIOUS_INSTANCES = [
  "https://inv.nadeko.net/",
  "https://invidious.f5.si/",
  "https://invidious.lunivers.trade/",
  "https://invidious.ducks.party/",
  "https://iv.melmac.space/",
  "https://invidious.nerdvpn.de/",
  "https://invidious.privacyredirect.com",
  "https://invidious.technicalvoid.dev",
  "https://invidious.darkness.services",
  "https://invidious.nikkosphere.com",
  "https://invidious.schenkel.eti.br",
  "https://invidious.tiekoetter.com",
  "https://invidious.perennialte.ch",
  "https://invidious.reallyaweso.me",
  "https://invidious.private.coffee",
  "https://invidious.privacydev.net",
  "https://yewtu.be",
  "https://iv.nboeck.de",
  "https://inv.tux.pizza",
  "https://iv.ggtyler.dev",
  "https://yt.omada.cafe",
  "https://super8.absturztau.be",
  "https://invidious.adminforge.de",
  "https://youtube.alt.tyil.nl",
  "https://rust.oskamp.nl",
  "https://invidious.nietzospannend.nl",
  "https://youtube.mosesmang.com",
];

// 🏁 DASHストリーム取得API
app.get("/api/dash_stream", async (req, res) => {
  const videoId = req.query.id;
  if (!videoId)
    return res.status(400).json({ error: "Video ID (id) is required" });

  const raceTask = async (instanceUrl) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);
    const baseUrl = instanceUrl.endsWith("/")
      ? instanceUrl.slice(0, -1)
      : instanceUrl;
    try {
      const response = await fetch(
        `${baseUrl}/api/v1/videos/${videoId}?hl=ja&region=JP`,
        {
          signal: controller.signal,
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
          },
        }
      );
      clearTimeout(timeoutId);
      if (!response.ok)
        throw new Error(`HTTP error status: ${response.status}`);
      const data = await response.json();
      if (
        data.adaptiveFormats &&
        Array.isArray(data.adaptiveFormats) &&
        data.adaptiveFormats.length > 0
      ) {
        return {
          dashUrl: data.dashUrl || null,
          adaptiveFormats: data.adaptiveFormats,
          instance: baseUrl,
        };
      }
      throw new Error("No adaptive formats found");
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  };

  try {
    const fastestWinner = await Promise.any(
      INVIDIOUS_INSTANCES.map((instanceUrl) => raceTask(instanceUrl))
    );
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(200).json({
      dashUrl: fastestWinner.dashUrl,
      adaptiveFormats: fastestWinner.adaptiveFormats,
      source: fastestWinner.instance,
    });
  } catch (raceError) {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res
      .status(500)
      .json({ error: "All instances failed", details: raceError.message });
  }
});

// 📥 動画ダウンロード用プロキシ
app.get("/api/download_proxy", async (req, res) => {
  let videoUrl = req.query.url;
  const videoId = req.query.id;
  const filename = req.query.filename || "video.mp4";

  if (!videoUrl && videoId) {
    try {
      videoUrl = await getStreamUrl(videoId);
    } catch (e) {
      return res
        .status(500)
        .json({ error: "Failed to resolve stream URL", details: e.message });
    }
  }

  if (!videoUrl)
    return res.status(400).json({ error: "url or id is required" });

  try {
    const parsedUrl = new URL(videoUrl);
    const allowedHosts = ["googlevideo.com", "youtube.com", "ytimg.com"];
    if (!allowedHosts.some((h) => parsedUrl.hostname.endsWith(h))) {
      return res.status(403).json({ error: "Forbidden: URL host not allowed" });
    }

    const upstream = await fetch(videoUrl, {
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        Range: req.headers.range || "bytes=0-",
      },
    });

    if (!upstream.ok && upstream.status !== 206) {
      return res.status(upstream.status).json({ error: "Upstream error" });
    }

    const safeFilename = filename.replace(/[\\/:*?"<>|]/g, "_");
    const encodedFilename = encodeURIComponent(safeFilename);

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`
    );
    res.setHeader("Content-Type", "application/octet-stream");

    if (upstream.headers.has("content-length"))
      res.setHeader("Content-Length", upstream.headers.get("content-length"));
    if (upstream.headers.has("content-range")) {
      res.setHeader("Content-Range", upstream.headers.get("content-range"));
      res.status(206);
    }

    upstream.body.pipe(res);
    upstream.body.on("error", (err) => {
      console.error("[download_proxy] stream pipe error:", err);
      if (!res.headersSent) res.status(500).end();
    });
  } catch (error) {
    console.error("[download_proxy] critical error:", error);
    if (!res.headersSent)
      res.status(500).json({ error: "Download proxy failed" });
  }
});

// 各種APIハンドラー設定
const kanrennHandler =
  require("./kanrenn.js").default || require("./kanrenn.js");
app.all("/api/kanrenn", (req, res) => {
  if (kanrennHandler.length === 2) return kanrennHandler(req, res);
  return handleEdge(kanrennHandler, req, res);
});

const aiRecommendHandler =
  require("./ai_recommend.js").default || require("./ai_recommend.js");
app.all("/api/ai_recommend", (req, res) => {
  if (aiRecommendHandler.length === 2) return aiRecommendHandler(req, res);
  return handleEdge(aiRecommendHandler, req, res);
});

const streamingHandler =
  require("./streaming.js").default || require("./streaming.js");
app.all("/api/streaming", (req, res) => {
  if (streamingHandler.length === 2) return streamingHandler(req, res);
  return handleEdge(streamingHandler, req, res);
});

const komentoHandler = require("./komento.js");
app.all("/api/komento", (req, res) => komentoHandler(req, res));

const thumbHandler = require("./thumb.js");
app.all("/api/thumb", (req, res) => thumbHandler(req, res));

const m3u8Handler = require("./m3u8.js");
app.all("/api/m3u8", (req, res) => m3u8Handler(req, res));

const authHandler = require("./auth.js").default || require("./auth.js");
app.all("/api/auth", (req, res) => authHandler(req, res));

const syncHandler = require("./sync.js").default || require("./sync.js");
app.all("/api/sync", (req, res) => syncHandler(req, res));

// 📺 GAS / Redis に保存された登録チャンネル新着動画
const subsFeedHandler = require("./subs-feed.js").default || require("./subs-feed.js");
app.all("/api/subs-feed", (req, res) => subsFeedHandler(req, res));

const wallpaperHandler =
  require("./wallpaper.js").default || require("./wallpaper.js");
app.all("/api/wallpaper", (req, res) => wallpaperHandler(req, res));

const recommendHandler =
  require("./recommend.js").default || require("./recommend.js");
app.all("/api/god_recommend", (req, res) => {
  if (recommendHandler.length === 2) return recommendHandler(req, res);
  return handleEdge(recommendHandler, req, res);
});

// 🔍 検索サジェスト
app.get("/api/suggest", async (req, res) => {
  const q = (req.query.q || "").toString();
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");

  if (!q.trim()) {
    return res.status(200).json({ query: q, suggestions: [] });
  }

  const suggestUrl = `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=${encodeURIComponent(
    q
  )}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    const response = await fetch(suggestUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      },
    });
    clearTimeout(timeoutId);

    if (!response.ok) throw new Error(`HTTP error status: ${response.status}`);

    const data = await response.json();
    const suggestions =
      Array.isArray(data) && Array.isArray(data[1]) ? data[1] : [];

    return res.status(200).json({ query: q, suggestions });
  } catch (error) {
    console.error("[/api/suggest] エラー:", error.message);
    return res.status(200).json({ query: q, suggestions: [] });
  }
});

app.get("/api/get_key", async (req, res) => {
  try {
    const response = await fetch(
      "https://apis.kahoot.it/media-api/youtube/key",
      { timeout: 10000 }
    );
    const data = await response.json();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

// 🚀 サーバー起動処理
function startServer(targetPort) {
  const server = app.listen(targetPort, "0.0.0.0", () => {
    console.log(`🚀 Server successfully running on port ${targetPort} 🎉`);
  });
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.log(
        `ポート ${targetPort} が使用中のため、${
          targetPort + 1
        } で再試行します...`
      );
      startServer(targetPort + 1);
    } else {
      console.error("サーバーエラー:", err);
    }
  });
}

const initialPort = process.env.PORT ? parseInt(process.env.PORT) : 8080;
startServer(initialPort);

process.on("uncaughtException", (err) => {
  console.error("⚠️ 予期せぬ例外エラーが発生しましたが維持します:", err);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("⚠️ 未処理の非同期エラーが発生しましたが維持します:", reason);
});
