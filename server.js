const express = require("express");
const cors = require("cors");
const sqlite3 = require("sqlite3").verbose();
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const TelegramBot = require("node-telegram-bot-api");

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || "spacenovax-admin";
const BOT_TOKEN = process.env.BOT_TOKEN || "";

const LINKS = {
  website: process.env.WEBSITE_URL || "https://spacenovax-server-v2.onrender.com",
  telegram_group: process.env.TELEGRAM_URL || "",
  youtube: process.env.YOUTUBE_URL || "",
  discord: process.env.DISCORD_URL || "",
  x: process.env.X_URL || ""
};

const appUrl = process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || "https://spacenovax-server-v2.onrender.com";

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const db = new sqlite3.Database("./spacenovax.db");

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      telegram_id TEXT UNIQUE,
      username TEXT,
      invite_code TEXT UNIQUE,
      referrer_code TEXT,
      points INTEGER DEFAULT 100,
      wallet TEXT,
      last_mining_at TEXT,
      is_blocked INTEGER DEFAULT 0,
      created_at TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS missions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      mission_key TEXT,
      reward INTEGER,
      status TEXT DEFAULT 'completed',
      completed_at TEXT,
      UNIQUE(user_id, mission_key)
    )
  `);
});

function nowIso() { return new Date().toISOString(); }

function makeInviteCode(username) {
  const prefix = username ? username.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toUpperCase() : "SPNX";
  const random = Math.floor(1000 + Math.random() * 9000);
  return `${prefix || "SPNX"}${random}`;
}

function missionReward(key) {
  const rewards = {
    website: Number(process.env.REWARD_WEBSITE || 100),
    youtube: Number(process.env.REWARD_YOUTUBE || 300),
    x: Number(process.env.REWARD_X || 300),
    telegram_group: Number(process.env.REWARD_TELEGRAM || 200),
    discord: Number(process.env.REWARD_DISCORD || 300)
  };
  return rewards[key] || 0;
}

function missionName(key) {
  return {
    website: "Website Visit",
    youtube: "YouTube Subscribe",
    x: "X Follow",
    telegram_group: "Telegram Join",
    discord: "Discord Join"
  }[key] || key;
}

function requireAdmin(req, res, next) {
  const key = req.headers["x-admin-key"] || req.query.key;
  if (key !== ADMIN_KEY) return res.status(401).json({ error: "unauthorized" });
  next();
}

function registerUser(telegram_id, username, referrer_code, cb) {
  if (!telegram_id) return cb(new Error("telegram_id is required"));
  db.get("SELECT * FROM users WHERE telegram_id = ?", [telegram_id], (err, user) => {
    if (err) return cb(err);
    if (user) return cb(null, user, false);
    const id = uuidv4();
    const invite_code = makeInviteCode(username);
    db.run(
      `INSERT INTO users (id, telegram_id, username, invite_code, referrer_code, points, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, String(telegram_id), username || "", invite_code, referrer_code || "", 100, nowIso()],
      function (err) {
        if (err) return cb(err);
        if (referrer_code) db.run("UPDATE users SET points = points + 500 WHERE invite_code = ?", [referrer_code]);
        db.get("SELECT * FROM users WHERE id = ?", [id], (err, newUser) => cb(err, newUser, true));
      }
    );
  });
}

function mineUser(telegram_id, cb) {
  db.get("SELECT * FROM users WHERE telegram_id = ?", [String(telegram_id)], (err, user) => {
    if (err) return cb(err);
    if (!user) return cb(new Error("user not found"));
    if (user.is_blocked) return cb(new Error("user blocked"));
    if (user.last_mining_at) {
      const last = new Date(user.last_mining_at);
      const next = new Date(last.getTime() + 24 * 60 * 60 * 1000);
      if (new Date() < next) {
        const remaining = Math.ceil((next.getTime() - Date.now()) / 1000);
        const e = new Error("mining cooldown");
        e.remaining_seconds = remaining;
        return cb(e);
      }
    }
    db.run("UPDATE users SET points = points + 100, last_mining_at = ? WHERE telegram_id = ?", [nowIso(), String(telegram_id)], err => {
      if (err) return cb(err);
      db.get("SELECT * FROM users WHERE telegram_id = ?", [String(telegram_id)], (err, updated) => cb(err, updated));
    });
  });
}

function completeMission(telegram_id, mission_key, cb) {
  const reward = missionReward(mission_key);
  if (!reward) return cb(new Error("invalid mission_key"));
  db.get("SELECT * FROM users WHERE telegram_id = ?", [String(telegram_id)], (err, user) => {
    if (err) return cb(err);
    if (!user) return cb(new Error("user not found"));
    if (user.is_blocked) return cb(new Error("user blocked"));
    db.run(
      "INSERT INTO missions (user_id, mission_key, reward, status, completed_at) VALUES (?, ?, ?, ?, ?)",
      [user.id, mission_key, reward, "completed", nowIso()],
      function (err) {
        if (err) return cb(new Error("mission already completed"));
        db.run("UPDATE users SET points = points + ? WHERE id = ?", [reward, user.id], err => {
          if (err) return cb(err);
          db.get("SELECT * FROM users WHERE id = ?", [user.id], (err, updated) => cb(err, updated, reward));
        });
      }
    );
  });
}

function saveWallet(telegram_id, wallet, cb) {
  const solanaRegex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  if (!solanaRegex.test(wallet)) return cb(new Error("invalid Solana wallet address"));
  db.run("UPDATE users SET wallet = ? WHERE telegram_id = ?", [wallet, String(telegram_id)], err => {
    if (err) return cb(err);
    db.get("SELECT * FROM users WHERE telegram_id = ?", [String(telegram_id)], (err, user) => cb(err, user));
  });
}

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
app.get("/api/config", (req, res) => res.json({ project: "SpaceNovaX", point: "SNP", token: "SPNX", links: LINKS, rewards: {
  website: missionReward("website"), youtube: missionReward("youtube"), x: missionReward("x"), telegram_group: missionReward("telegram_group"), discord: missionReward("discord")
}}));
app.get("/api/health", (req, res) => res.json({ project: "SpaceNovaX", status: "running", bot: BOT_TOKEN ? "enabled" : "disabled", version: "3.0.0" }));
app.post("/api/register", (req, res) => registerUser(req.body.telegram_id, req.body.username, req.body.referrer_code, (err, user) => err ? res.status(500).json({error: err.message}) : res.json({user})));
app.get("/api/user/:telegram_id", (req, res) => db.get("SELECT * FROM users WHERE telegram_id = ?", [req.params.telegram_id], (err, user) => err ? res.status(500).json({error: err.message}) : user ? res.json({user}) : res.status(404).json({error:"user not found"})));
app.post("/api/mine", (req, res) => mineUser(req.body.telegram_id, (err, user) => err ? res.status(err.remaining_seconds ? 429 : 400).json({error: err.message, remaining_seconds: err.remaining_seconds}) : res.json({success:true,reward:100,point:"SNP",user})));
app.post("/api/mission/complete", (req, res) => completeMission(req.body.telegram_id, req.body.mission_key, (err, user, reward) => err ? res.status(400).json({error: err.message}) : res.json({success:true,mission_key:req.body.mission_key,reward,point:"SNP",user})));
app.post("/api/wallet", (req, res) => saveWallet(req.body.telegram_id, req.body.wallet, (err, user) => err ? res.status(400).json({error: err.message}) : res.json({success:true,user})));
app.get("/api/rank", (req, res) => db.all("SELECT username, points, invite_code FROM users WHERE is_blocked = 0 ORDER BY points DESC LIMIT 100", [], (err, rows) => err ? res.status(500).json({error: err.message}) : res.json({ranking: rows})));
app.get("/api/admin/stats", requireAdmin, (req, res) => db.get("SELECT COUNT(*) AS users, COALESCE(SUM(points),0) AS total_points FROM users", [], (err, a) => {
  if (err) return res.status(500).json({ error: err.message });
  db.get("SELECT COUNT(*) AS wallets FROM users WHERE wallet IS NOT NULL AND wallet != ''", [], (err, b) => {
    if (err) return res.status(500).json({ error: err.message });
    db.get("SELECT COUNT(*) AS missions FROM missions", [], (err, c) => res.json({ users: a.users, total_points: a.total_points, wallets: b.wallets, missions: c.missions }));
  });
}));
app.get("/api/admin/users", requireAdmin, (req, res) => db.all("SELECT * FROM users ORDER BY points DESC LIMIT 500", [], (err, rows) => err ? res.status(500).json({error: err.message}) : res.json({users: rows})));
app.post("/api/admin/block", requireAdmin, (req, res) => db.run("UPDATE users SET is_blocked = ? WHERE telegram_id = ?", [req.body.blocked ? 1 : 0, req.body.telegram_id], err => err ? res.status(500).json({error: err.message}) : res.json({success:true})));
app.get("/api/admin/export", requireAdmin, (req, res) => db.all("SELECT * FROM users ORDER BY points DESC", [], (err, rows) => {
  if (err) return res.status(500).json({ error: err.message });
  const header = "telegram_id,username,points,wallet,invite_code,referrer_code,is_blocked,created_at\n";
  const body = rows.map(r => `${r.telegram_id},${r.username},${r.points},${r.wallet || ""},${r.invite_code},${r.referrer_code || ""},${r.is_blocked},${r.created_at}`).join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=spacenovax_users.csv");
  res.send(header + body);
}));

const walletWait = new Map();
let bot = null;

function botMenu() {
  const rows = [
    [{ text: "⛏ Mine SNP", callback_data: "mine" }, { text: "📊 My Balance", callback_data: "me" }],
    [{ text: "🎁 Missions", callback_data: "missions" }, { text: "🏆 Ranking", callback_data: "rank" }],
    [{ text: "💰 Register Solana Wallet", callback_data: "wallet" }]
  ];
  return { inline_keyboard: rows };
}

function missionKeyboard() {
  const rows = [];
  for (const key of ["website", "telegram_group", "youtube", "discord", "x"]) {
    const url = LINKS[key];
    if (url) rows.push([{ text: `${missionName(key)} +${missionReward(key)} SNP`, url }, { text: "✅ Claim", callback_data: `mission:${key}` }]);
  }
  rows.push([{ text: "⬅️ Back", callback_data: "menu" }]);
  return { inline_keyboard: rows };
}

function startBot() {
  if (!BOT_TOKEN) {
    console.log("Telegram bot disabled: BOT_TOKEN not set");
    return;
  }
  bot = new TelegramBot(BOT_TOKEN, { polling: true });
  console.log("Telegram bot connected and polling started");

  bot.onText(/\/start(?:\s+(.+))?/, (msg, match) => {
    const ref = match && match[1] ? match[1].trim() : "";
    const from = msg.from;
    registerUser(String(from.id), from.username || from.first_name || "", ref, (err, user, created) => {
      if (err) return bot.sendMessage(msg.chat.id, `Error: ${err.message}`);
      const text = `🚀 Welcome to SpaceNovaX\n\nPoint: SNP\nBalance: ${user.points} SNP\nInvite Code: ${user.invite_code}\nInvite Link: https://t.me/${bot.options.username || "YOUR_BOT"}?start=${user.invite_code}\n\n${created ? "가입 보상 +100 SNP 지급 완료" : "다시 오신 것을 환영합니다."}`;
      bot.sendMessage(msg.chat.id, text, { reply_markup: botMenu() });
    });
  });

  bot.onText(/\/wallet/, msg => {
    walletWait.set(String(msg.from.id), true);
    bot.sendMessage(msg.chat.id, "Solana 지갑 주소를 보내주세요.");
  });

  bot.on("callback_query", query => {
    const chatId = query.message.chat.id;
    const uid = String(query.from.id);
    const data = query.data;
    bot.answerCallbackQuery(query.id).catch(()=>{});

    registerUser(uid, query.from.username || query.from.first_name || "", "", (err, user) => {
      if (err) return bot.sendMessage(chatId, `Error: ${err.message}`);
      if (data === "menu") return bot.sendMessage(chatId, "SpaceNovaX Menu", { reply_markup: botMenu() });
      if (data === "me") return bot.sendMessage(chatId, `📊 My SpaceNovaX\nBalance: ${user.points} SNP\nWallet: ${user.wallet || "Not registered"}\nInvite Code: ${user.invite_code}`, { reply_markup: botMenu() });
      if (data === "wallet") { walletWait.set(uid, true); return bot.sendMessage(chatId, "Solana 지갑 주소를 보내주세요."); }
      if (data === "missions") return bot.sendMessage(chatId, "🎁 Mission Rewards\n미션 링크를 누른 뒤 Claim을 누르세요.", { reply_markup: missionKeyboard() });
      if (data === "mine") return mineUser(uid, (err, updated) => {
        if (err && err.remaining_seconds) {
          const h = Math.floor(err.remaining_seconds / 3600); const m = Math.floor((err.remaining_seconds % 3600) / 60);
          return bot.sendMessage(chatId, `⏳ 다음 채굴까지 ${h}시간 ${m}분 남았습니다.`);
        }
        if (err) return bot.sendMessage(chatId, `Error: ${err.message}`);
        bot.sendMessage(chatId, `⛏ 채굴 완료! +100 SNP\n현재 보유: ${updated.points} SNP`, { reply_markup: botMenu() });
      });
      if (data === "rank") return db.all("SELECT username, points FROM users WHERE is_blocked = 0 ORDER BY points DESC LIMIT 10", [], (err, rows) => {
        if (err) return bot.sendMessage(chatId, `Error: ${err.message}`);
        const text = "🏆 Ranking\n" + rows.map((r,i)=>`${i+1}. ${r.username || "user"} - ${r.points} SNP`).join("\n");
        bot.sendMessage(chatId, text || "No ranking yet", { reply_markup: botMenu() });
      });
      if (data.startsWith("mission:")) {
        const key = data.split(":")[1];
        return completeMission(uid, key, (err, updated, reward) => {
          if (err) return bot.sendMessage(chatId, `⚠️ ${err.message}`);
          bot.sendMessage(chatId, `✅ ${missionName(key)} 완료! +${reward} SNP\n현재 보유: ${updated.points} SNP`, { reply_markup: botMenu() });
        });
      }
    });
  });

  bot.on("message", msg => {
    if (!msg.text || msg.text.startsWith("/")) return;
    const uid = String(msg.from.id);
    if (!walletWait.get(uid)) return;
    walletWait.delete(uid);
    saveWallet(uid, msg.text.trim(), (err, user) => {
      if (err) return bot.sendMessage(msg.chat.id, `⚠️ ${err.message}`);
      bot.sendMessage(msg.chat.id, `✅ Solana 지갑 등록 완료\n${user.wallet}`, { reply_markup: botMenu() });
    });
  });
}

app.listen(PORT, () => {
  console.log(`SpaceNovaX Server + Bot + Dashboard v3 running on port ${PORT}`);
  console.log(`Admin dashboard: http://localhost:${PORT}`);
  console.log(`Default admin key: ${ADMIN_KEY}`);
  startBot();
});
