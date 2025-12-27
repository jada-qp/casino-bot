require("dotenv").config();
const express = require("express");
const session = require("express-session");
const fetch = require("node-fetch");

const { db, setBalance, getConfig, setConfig, setUserConfig, clearUserConfig } = require("./db");

const PORT = parseInt(process.env.DASHBOARD_PORT || "3000", 10);
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.DASHBOARD_REDIRECT_URI;
const SESSION_SECRET = process.env.SESSION_SECRET || "dev_secret_change_me";

const ADMIN_USER_IDS = new Set(
  (process.env.ADMIN_USER_IDS || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean)
);

function mustBeAuthed(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  if (!ADMIN_USER_IDS.has(req.session.user.id)) return res.status(403).send("Forbidden (not admin).");
  next();
}

function htmlPage(title, body, script = "") {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title}</title>
<style>
  body { font-family: ui-sans-serif, system-ui, -apple-system; background:#0b1020; color:#e5e7eb; margin:0; }
  .wrap { max-width: 1100px; margin: 0 auto; padding: 24px; }
  .card { background: rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.08);
          border-radius: 14px; padding: 16px; margin: 16px 0; }
  h1,h2,h3 { margin: 0 0 10px 0; }
  a { color:#a78bfa; text-decoration:none; }
  table { width:100%; border-collapse: collapse; }
  th, td { border-bottom: 1px solid rgba(255,255,255,0.08); padding: 10px; text-align:left; vertical-align: top; }
  input[type="number"], input[type="text"] { width: 100%; padding: 10px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.12); background: rgba(0,0,0,0.25); color: #e5e7eb; }
  input[type="range"] { width: 100%; }
  label { display:block; margin: 10px 0 6px; }
  .row { display:grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .btn { background:#8b5cf6; border:none; color:white; padding:10px 12px; border-radius: 10px; cursor:pointer; }
  .btn:hover { filter: brightness(1.05); }
  .muted { color:#9ca3af; }
  .pill { display:inline-block; padding: 3px 10px; border-radius: 999px; background: rgba(255,255,255,0.08); }
</style>
</head>
<body>
<div class="wrap">${body}</div>
<script>
${script}
</script>
</body>
</html>`;
}

async function exchangeCodeForToken(code) {
  const params = new URLSearchParams();
  params.append("client_id", CLIENT_ID);
  params.append("client_secret", CLIENT_SECRET);
  params.append("grant_type", "authorization_code");
  params.append("code", code);
  params.append("redirect_uri", REDIRECT_URI);

  const r = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  if (!r.ok) throw new Error("Token exchange failed");
  return r.json();
}

async function fetchDiscordUser(access_token) {
  const r = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!r.ok) throw new Error("User fetch failed");
  return r.json();
}

function pctFromConfig(v, fallbackPct) {
  const p = typeof v === "number" ? v : (fallbackPct / 100);
  const clamped = Math.max(0, Math.min(1, p));
  return Math.round(clamped * 100);
}

function pctFromField(cfg, field, fallbackPct) {
  const raw = cfg && typeof cfg === "object" ? cfg[field] : undefined;
  return pctFromConfig(raw, fallbackPct);
}

function startDashboard() {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
  }));

  app.get("/", (req, res) => res.redirect("/dashboard"));

  app.get("/login", (req, res) => {
    const auth = new URL("https://discord.com/api/oauth2/authorize");
    auth.searchParams.set("client_id", CLIENT_ID);
    auth.searchParams.set("redirect_uri", REDIRECT_URI);
    auth.searchParams.set("response_type", "code");
    auth.searchParams.set("scope", "identify");

    res.send(htmlPage("Login", `
      <div class="card">
        <h1>Casino Dev Dashboard</h1>
        <p class="muted">Login with Discord to manage balances and odds.</p>
        <p><a href="${auth.toString()}">→ Login with Discord</a></p>
      </div>
    `));
  });

  app.get("/auth/discord/callback", async (req, res) => {
    try {
      const code = req.query.code;
      if (!code) return res.status(400).send("Missing code");

      const tok = await exchangeCodeForToken(code);
      const user = await fetchDiscordUser(tok.access_token);

      req.session.user = { id: user.id, username: user.username };
      res.redirect("/dashboard");
    } catch (e) {
      console.error(e);
      res.status(500).send("Auth failed.");
    }
  });

  app.get("/logout", (req, res) => {
    req.session.destroy(() => res.redirect("/login"));
  });

  app.get("/dashboard", mustBeAuthed, (req, res) => {
    const users = db.prepare("SELECT user_id, balance, last_daily FROM users ORDER BY balance DESC LIMIT 200").all();
    const userOverridesRaw = db.prepare("SELECT user_id, key, value FROM user_config ORDER BY user_id").all();

    const coin = getConfig("coinflip", { headsProb: 0.5 });
    const slots = getConfig("slots", { winChance: 0.28 });
    const roul = getConfig("roulette", { playerWinChance: 0.47 });
    const bj = getConfig("blackjack", { playerWinChance: 0.45 });
    const dice = getConfig("dice", { playerWinChance: 0.18 });
    const highlow = getConfig("highlow", { playerWinChance: 0.5 });

    const headsPct = pctFromConfig(coin.headsProb, 50);
    const slotsPct = pctFromConfig(slots.winChance, 28);
    const roulPct = pctFromConfig(roul.playerWinChance, 47);
    const bjPct = pctFromConfig(bj.playerWinChance, 45);
    const dicePct = pctFromConfig(dice.playerWinChance, 18);
    const highlowPct = pctFromConfig(highlow.playerWinChance, 50);

    const rows = users.map(u => `
      <tr>
        <td><span class="pill">${u.user_id}</span></td>
        <td><b>${u.balance}</b></td>
        <td>
          <form method="POST" action="/balances/${u.user_id}">
            <input type="number" name="balance" value="${u.balance}" min="0" step="1"/>
            <button class="btn" type="submit" style="margin-top:8px;">Save</button>
          </form>
        </td>
      </tr>
    `).join("");

    const overridesByUser = userOverridesRaw.reduce((acc, row) => {
      if (!acc[row.user_id]) acc[row.user_id] = {};
      try {
        acc[row.user_id][row.key] = JSON.parse(row.value);
      } catch {
        acc[row.user_id][row.key] = {};
      }
      return acc;
    }, {});

    const overrideRows = Object.entries(overridesByUser).map(([userId, cfgs]) => {
      const coinPct = pctFromField(cfgs.coinflip, "headsProb", headsPct);
      const slotsPctUser = pctFromField(cfgs.slots, "winChance", slotsPct);
      const roulPctUser = pctFromField(cfgs.roulette, "playerWinChance", roulPct);
      const bjPctUser = pctFromField(cfgs.blackjack, "playerWinChance", bjPct);
      const dicePctUser = pctFromField(cfgs.dice, "playerWinChance", dicePct);
      const highlowPctUser = pctFromField(cfgs.highlow, "playerWinChance", highlowPct);

      return `
        <tr>
          <td><span class="pill">${userId}</span></td>
          <td>${coinPct}%</td>
          <td>${slotsPctUser}%</td>
          <td>${roulPctUser}%</td>
          <td>${bjPctUser}%</td>
          <td>${dicePctUser}%</td>
          <td>${highlowPctUser}%</td>
          <td>
            <form method="POST" action="/user-odds/clear">
              <input type="hidden" name="user_id" value="${userId}" />
              <button class="btn" type="submit">Clear</button>
            </form>
          </td>
        </tr>
      `;
    }).join("");

    const script = `
      function bindSlider(sliderId, labelId) {
        const s = document.getElementById(sliderId);
        const l = document.getElementById(labelId);
        if (!s || !l) return;
        const update = () => { l.textContent = s.value + "%"; };
        s.addEventListener("input", update);
        update();
      }
      bindSlider("coinflipHeadsPct", "coinflipHeadsLabel");
      bindSlider("slotsWinPct", "slotsWinLabel");
      bindSlider("rouletteWinPct", "rouletteWinLabel");
      bindSlider("blackjackWinPct", "blackjackWinLabel");
      bindSlider("diceWinPct", "diceWinLabel");
      bindSlider("highlowWinPct", "highlowWinLabel");
    `;

    res.send(htmlPage("Dashboard", `
      <div class="card">
        <h1>Casino Dev Dashboard</h1>
        <p class="muted">Logged in as <b>${req.session.user.username}</b> • <a href="/logout">Logout</a></p>
      </div>

      <div class="card">
        <h2>Odds & Chances</h2>
        <p class="muted">These affect randomness internally. They are <b>not shown</b> in Discord.</p>

        <div class="row">
          <div>
            <h3>Coinflip</h3>
            <form method="POST" action="/config/coinflip">
              <label>Heads chance: <b id="coinflipHeadsLabel">${headsPct}%</b></label>
              <input id="coinflipHeadsPct" type="range" name="headsPct" min="0" max="100" value="${headsPct}"/>
              <button class="btn" type="submit" style="margin-top:10px;">Update</button>
            </form>
          </div>

          <div>
            <h3>Slots</h3>
            <form method="POST" action="/config/slots">
              <label>Win chance: <b id="slotsWinLabel">${slotsPct}%</b></label>
              <input id="slotsWinPct" type="range" name="winPct" min="0" max="100" value="${slotsPct}"/>
              <button class="btn" type="submit" style="margin-top:10px;">Update</button>
            </form>
          </div>
        </div>

        <div class="row" style="margin-top:16px;">
          <div>
            <h3>Roulette</h3>
            <form method="POST" action="/config/roulette">
              <label>Player win bias: <b id="rouletteWinLabel">${roulPct}%</b></label>
              <input id="rouletteWinPct" type="range" name="winPct" min="0" max="100" value="${roulPct}"/>
              <button class="btn" type="submit" style="margin-top:10px;">Update</button>
            </form>
          </div>

          <div>
            <h3>Blackjack</h3>
            <form method="POST" action="/config/blackjack">
              <label>Player win bias: <b id="blackjackWinLabel">${bjPct}%</b></label>
              <input id="blackjackWinPct" type="range" name="winPct" min="0" max="100" value="${bjPct}"/>
              <button class="btn" type="submit" style="margin-top:10px;">Update</button>
            </form>
          </div>
        </div>

        <div class="row" style="margin-top:16px;">
          <div>
            <h3>Dice</h3>
            <form method="POST" action="/config/dice">
              <label>Player win bias: <b id="diceWinLabel">${dicePct}%</b></label>
              <input id="diceWinPct" type="range" name="winPct" min="0" max="100" value="${dicePct}"/>
              <button class="btn" type="submit" style="margin-top:10px;">Update</button>
            </form>
          </div>

          <div>
            <h3>High-Low</h3>
            <form method="POST" action="/config/highlow">
              <label>Player win bias: <b id="highlowWinLabel">${highlowPct}%</b></label>
              <input id="highlowWinPct" type="range" name="winPct" min="0" max="100" value="${highlowPct}"/>
              <button class="btn" type="submit" style="margin-top:10px;">Update</button>
            </form>
          </div>
        </div>
      </div>

      <div class="card">
        <h2>Balances (Top 200)</h2>
        <table>
          <thead><tr><th>User ID</th><th>Balance</th><th>Edit</th></tr></thead>
          <tbody>${rows || ""}</tbody>
        </table>

        <div class="row" style="margin-top:16px;">
          <form method="POST" action="/balances/set-any">
            <label>User ID</label>
            <input type="text" name="user_id" placeholder="123..." />
            <label style="margin-top:10px;">Balance</label>
            <input type="number" name="balance" min="0" step="1" />
            <button class="btn" type="submit" style="margin-top:10px;">Set Balance</button>
          </form>
          <div class="muted">
            <p><b>Security:</b> access is restricted to <code>ADMIN_USER_IDS</code>.</p>
            <p>If you expose this publicly: add HTTPS, stronger auth, and rate limits.</p>
          </div>
        </div>
      </div>

      <div class="card">
        <h2>Per-User Odds Overrides</h2>
        <p class="muted">Set custom chances for a specific user. Values are percentages.</p>

        <form method="POST" action="/user-odds">
          <label>User ID</label>
          <input type="text" name="user_id" placeholder="123..." required />

          <div class="row" style="margin-top:12px;">
            <div>
              <label>Coinflip (Heads %)</label>
              <input type="number" name="coinflipHeadsPct" min="0" max="100" value="${headsPct}" required />
            </div>
            <div>
              <label>Slots (Win %)</label>
              <input type="number" name="slotsWinPct" min="0" max="100" value="${slotsPct}" required />
            </div>
          </div>

          <div class="row" style="margin-top:12px;">
            <div>
              <label>Roulette (Win %)</label>
              <input type="number" name="rouletteWinPct" min="0" max="100" value="${roulPct}" required />
            </div>
            <div>
              <label>Blackjack (Win %)</label>
              <input type="number" name="blackjackWinPct" min="0" max="100" value="${bjPct}" required />
            </div>
          </div>

          <div class="row" style="margin-top:12px;">
            <div>
              <label>Dice (Win %)</label>
              <input type="number" name="diceWinPct" min="0" max="100" value="${dicePct}" required />
            </div>
            <div>
              <label>High-Low (Win %)</label>
              <input type="number" name="highlowWinPct" min="0" max="100" value="${highlowPct}" required />
            </div>
          </div>

          <button class="btn" type="submit" style="margin-top:12px;">Save Overrides</button>
        </form>

        <h3 style="margin-top:20px;">Existing Overrides</h3>
        <table>
          <thead>
            <tr>
              <th>User ID</th>
              <th>Coinflip</th>
              <th>Slots</th>
              <th>Roulette</th>
              <th>Blackjack</th>
              <th>Dice</th>
              <th>High-Low</th>
              <th>Clear</th>
            </tr>
          </thead>
          <tbody>${overrideRows || ""}</tbody>
        </table>
      </div>
    `, script));
  });

  app.post("/balances/:userId", mustBeAuthed, (req, res) => {
    const userId = req.params.userId;
    const balance = Math.max(0, parseInt(req.body.balance || "0", 10));
    setBalance(userId, balance);
    res.redirect("/dashboard");
  });

  app.post("/balances/set-any", mustBeAuthed, (req, res) => {
    const userId = (req.body.user_id || "").trim();
    const balance = Math.max(0, parseInt(req.body.balance || "0", 10));
    if (!userId) return res.status(400).send("Missing user_id");
    setBalance(userId, balance);
    res.redirect("/dashboard");
  });

  app.post("/config/coinflip", mustBeAuthed, (req, res) => {
    const headsPct = Math.max(0, Math.min(100, parseInt(req.body.headsPct || "50", 10)));
    setConfig("coinflip", { headsProb: headsPct / 100 });
    res.redirect("/dashboard");
  });

  app.post("/config/slots", mustBeAuthed, (req, res) => {
    const winPct = Math.max(0, Math.min(100, parseInt(req.body.winPct || "28", 10)));
    setConfig("slots", { winChance: winPct / 100 });
    res.redirect("/dashboard");
  });

  app.post("/config/roulette", mustBeAuthed, (req, res) => {
    const winPct = Math.max(0, Math.min(100, parseInt(req.body.winPct || "47", 10)));
    setConfig("roulette", { playerWinChance: winPct / 100 });
    res.redirect("/dashboard");
  });

  app.post("/config/blackjack", mustBeAuthed, (req, res) => {
    const winPct = Math.max(0, Math.min(100, parseInt(req.body.winPct || "45", 10)));
    setConfig("blackjack", { playerWinChance: winPct / 100 });
    res.redirect("/dashboard");
  });

  app.post("/config/dice", mustBeAuthed, (req, res) => {
    const winPct = Math.max(0, Math.min(100, parseInt(req.body.winPct || "18", 10)));
    setConfig("dice", { playerWinChance: winPct / 100 });
    res.redirect("/dashboard");
  });

  app.post("/config/highlow", mustBeAuthed, (req, res) => {
    const winPct = Math.max(0, Math.min(100, parseInt(req.body.winPct || "50", 10)));
    setConfig("highlow", { playerWinChance: winPct / 100 });
    res.redirect("/dashboard");
  });

  app.post("/user-odds", mustBeAuthed, (req, res) => {
    const userId = (req.body.user_id || "").trim();
    if (!userId) return res.status(400).send("Missing user_id");

    const globalCoin = getConfig("coinflip", { headsProb: 0.5 });
    const globalSlots = getConfig("slots", { winChance: 0.28 });
    const globalRoul = getConfig("roulette", { playerWinChance: 0.47 });
    const globalBj = getConfig("blackjack", { playerWinChance: 0.45 });
    const globalDice = getConfig("dice", { playerWinChance: 0.18 });
    const globalHighlow = getConfig("highlow", { playerWinChance: 0.5 });

    const headsPct = pctFromConfig(globalCoin.headsProb, 50);
    const slotsPct = pctFromConfig(globalSlots.winChance, 28);
    const roulPct = pctFromConfig(globalRoul.playerWinChance, 47);
    const bjPct = pctFromConfig(globalBj.playerWinChance, 45);
    const dicePct = pctFromConfig(globalDice.playerWinChance, 18);
    const highlowPct = pctFromConfig(globalHighlow.playerWinChance, 50);

    const clampPct = (value, fallback) => {
      const n = parseInt(value || `${fallback}`, 10);
      return Math.max(0, Math.min(100, n));
    };

    const coinflipHeadsPct = clampPct(req.body.coinflipHeadsPct, headsPct);
    const slotsWinPct = clampPct(req.body.slotsWinPct, slotsPct);
    const rouletteWinPct = clampPct(req.body.rouletteWinPct, roulPct);
    const blackjackWinPct = clampPct(req.body.blackjackWinPct, bjPct);
    const diceWinPct = clampPct(req.body.diceWinPct, dicePct);
    const highlowWinPct = clampPct(req.body.highlowWinPct, highlowPct);

    setUserConfig(userId, "coinflip", { headsProb: coinflipHeadsPct / 100 });
    setUserConfig(userId, "slots", { winChance: slotsWinPct / 100 });
    setUserConfig(userId, "roulette", { playerWinChance: rouletteWinPct / 100 });
    setUserConfig(userId, "blackjack", { playerWinChance: blackjackWinPct / 100 });
    setUserConfig(userId, "dice", { playerWinChance: diceWinPct / 100 });
    setUserConfig(userId, "highlow", { playerWinChance: highlowWinPct / 100 });

    res.redirect("/dashboard");
  });

  app.post("/user-odds/clear", mustBeAuthed, (req, res) => {
    const userId = (req.body.user_id || "").trim();
    if (!userId) return res.status(400).send("Missing user_id");

    ["coinflip", "slots", "roulette", "blackjack", "dice", "highlow"].forEach((key) => {
      clearUserConfig(userId, key);
    });

    res.redirect("/dashboard");
  });

  // Local-only by default; change to "0.0.0.0" if hosting on a server intentionally
  app.listen(PORT, "127.0.0.1", () => {
    console.log(`🛠️ Dashboard: http://localhost:${PORT}/login`);
  });
}

module.exports = { startDashboard };
