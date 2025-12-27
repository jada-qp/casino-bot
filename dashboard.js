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
const DASHBOARD_HOST = process.env.DASHBOARD_HOST || "127.0.0.1";

const ADMIN_USER_IDS = new Set(
  (process.env.ADMIN_USER_IDS || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean)
);

// Token store for auto-login from Discord bot
// Map<token, { userId, username, expiresAt }>
const autoLoginTokens = new Map();

// Generate a random token
function generateToken() {
  return require("crypto").randomBytes(32).toString("hex");
}

// Create an auto-login token for a user (expires in 5 minutes)
function createAutoLoginToken(userId, username) {
  const token = generateToken();
  const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes
  autoLoginTokens.set(token, { userId, username, expiresAt });
  return token;
}

// Validate and consume an auto-login token
function consumeAutoLoginToken(token) {
  const data = autoLoginTokens.get(token);
  if (!data) return null;

  autoLoginTokens.delete(token); // Single-use

  if (Date.now() > data.expiresAt) return null; // Expired

  return { id: data.userId, username: data.username };
}

function mustBeAuthed(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  if (!ADMIN_USER_IDS.has(req.session.user.id)) return res.status(403).send("Forbidden (not admin).");
  next();
}

function htmlPage(title, body, script = "") {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title} — Casino Admin</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --bg-primary: #ffffff;
    --bg-secondary: #f5f5f7;
    --bg-tertiary: #fbfbfd;
    --text-primary: #1d1d1f;
    --text-secondary: #86868b;
    --text-tertiary: #6e6e73;
    --accent: #0071e3;
    --accent-hover: #0077ed;
    --success: #34c759;
    --danger: #ff3b30;
    --warning: #ff9500;
    --border: rgba(0, 0, 0, 0.08);
    --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.04);
    --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.08);
    --shadow-lg: 0 12px 40px rgba(0, 0, 0, 0.12);
    --radius-sm: 8px;
    --radius-md: 12px;
    --radius-lg: 20px;
    --radius-xl: 28px;
    --nav-bg: rgba(255, 255, 255, 0.72);
  }

  /* Dark Mode */
  .dark-mode {
    --bg-primary: #1c1c1e;
    --bg-secondary: #000000;
    --bg-tertiary: #2c2c2e;
    --text-primary: #f5f5f7;
    --text-secondary: #98989d;
    --text-tertiary: #8e8e93;
    --border: rgba(255, 255, 255, 0.1);
    --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.3);
    --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.4);
    --shadow-lg: 0 12px 40px rgba(0, 0, 0, 0.5);
    --nav-bg: rgba(28, 28, 30, 0.72);
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Helvetica Neue', sans-serif;
    background: var(--bg-secondary);
    color: var(--text-primary);
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    transition: background-color 0.3s ease, color 0.3s ease;
  }

  /* Navigation Header */
  .nav-header {
    position: sticky;
    top: 0;
    z-index: 100;
    background: var(--nav-bg);
    backdrop-filter: saturate(180%) blur(20px);
    -webkit-backdrop-filter: saturate(180%) blur(20px);
    border-bottom: 1px solid var(--border);
    padding: 0 24px;
    transition: background-color 0.3s ease;
  }

  .nav-inner {
    max-width: 1200px;
    margin: 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 52px;
  }

  .nav-brand {
    font-size: 21px;
    font-weight: 600;
    color: var(--text-primary);
    letter-spacing: -0.02em;
  }

  .nav-links {
    display: flex;
    gap: 8px;
  }

  .nav-links a {
    padding: 8px 16px;
    border-radius: 980px;
    font-size: 14px;
    font-weight: 500;
    color: var(--text-secondary);
    text-decoration: none;
    transition: all 0.2s ease;
  }

  .nav-links a:hover {
    background: var(--bg-secondary);
    color: var(--text-primary);
  }

  .nav-user {
    display: flex;
    align-items: center;
    gap: 16px;
    font-size: 14px;
    color: var(--text-secondary);
  }

  .nav-user strong { color: var(--text-primary); }

  .nav-user a {
    color: var(--accent);
    text-decoration: none;
    font-weight: 500;
  }

  /* Main Content */
  .wrap {
    max-width: 1200px;
    margin: 0 auto;
    padding: 40px 24px 80px;
  }

  /* Hero Section */
  .hero {
    text-align: center;
    padding: 60px 0 40px;
  }

  .hero h1 {
    font-size: 48px;
    font-weight: 700;
    letter-spacing: -0.025em;
    color: var(--text-primary);
    margin-bottom: 12px;
  }

  .hero p {
    font-size: 21px;
    color: var(--text-secondary);
    max-width: 600px;
    margin: 0 auto;
  }

  /* Cards */
  .card {
    background: var(--bg-primary);
    border-radius: var(--radius-lg);
    padding: 32px;
    margin-bottom: 24px;
    box-shadow: var(--shadow-md);
    border: 1px solid var(--border);
  }

  .card-header {
    margin-bottom: 24px;
  }

  .card-header h2 {
    font-size: 28px;
    font-weight: 600;
    letter-spacing: -0.02em;
    color: var(--text-primary);
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .card-header p {
    font-size: 15px;
    color: var(--text-secondary);
    margin-top: 8px;
  }

  h3 {
    font-size: 17px;
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 12px;
  }

  /* Badge */
  .badge {
    display: inline-flex;
    align-items: center;
    padding: 4px 12px;
    border-radius: 980px;
    font-size: 12px;
    font-weight: 600;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }

  /* Grid Layout */
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 20px;
  }

  .grid-item {
    background: var(--bg-tertiary);
    border-radius: var(--radius-md);
    padding: 24px;
    border: 1px solid var(--border);
    transition: all 0.3s ease;
  }

  .grid-item:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-md);
  }

  /* Form Elements */
  label {
    display: block;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-secondary);
    margin-bottom: 8px;
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }

  input[type="text"],
  input[type="number"] {
    width: 100%;
    padding: 12px 16px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--bg-primary);
    font-size: 17px;
    font-family: inherit;
    color: var(--text-primary);
    transition: all 0.2s ease;
  }

  input[type="text"]:focus,
  input[type="number"]:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 4px rgba(0, 113, 227, 0.1);
  }

  input[type="range"] {
    width: 100%;
    height: 6px;
    border-radius: 3px;
    background: var(--bg-secondary);
    appearance: none;
    cursor: pointer;
  }

  input[type="range"]::-webkit-slider-thumb {
    appearance: none;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--accent);
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0, 113, 227, 0.3);
    transition: transform 0.15s ease;
  }

  input[type="range"]::-webkit-slider-thumb:hover {
    transform: scale(1.1);
  }

  /* Buttons */
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 12px 24px;
    border-radius: 980px;
    font-size: 15px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    border: none;
    transition: all 0.2s ease;
    text-decoration: none;
    gap: 8px;
  }

  .btn-primary {
    background: var(--accent);
    color: white;
  }

  .btn-primary:hover {
    background: var(--accent-hover);
    transform: scale(1.02);
  }

  .btn-secondary {
    background: var(--bg-secondary);
    color: var(--text-primary);
    border: 1px solid var(--border);
  }

  .btn-secondary:hover {
    background: var(--bg-tertiary);
  }

  .btn-danger {
    background: var(--danger);
    color: white;
  }

  .btn-danger:hover {
    filter: brightness(1.1);
    transform: scale(1.02);
  }

  .btn-sm {
    padding: 8px 16px;
    font-size: 13px;
  }

  /* Tables */
  .table-container {
    overflow-x: auto;
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    background: var(--bg-primary);
  }

  table {
    width: 100%;
    border-collapse: collapse;
    min-width: 600px;
  }

  th, td {
    padding: 16px 20px;
    text-align: left;
    border-bottom: 1px solid var(--border);
  }

  th {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    background: var(--bg-tertiary);
  }

  td {
    font-size: 15px;
    color: var(--text-primary);
  }

  tbody tr:hover {
    background: var(--bg-tertiary);
  }

  tbody tr:last-child td {
    border-bottom: none;
  }

  /* Pill/Tag */
  .pill {
    display: inline-flex;
    padding: 6px 12px;
    border-radius: 980px;
    font-size: 13px;
    font-weight: 500;
    background: var(--bg-secondary);
    color: var(--text-secondary);
    font-family: 'SF Mono', Monaco, monospace;
  }

  /* Value Display */
  .value-display {
    font-size: 32px;
    font-weight: 700;
    color: var(--accent);
    letter-spacing: -0.02em;
  }

  /* Divider */
  .divider {
    height: 1px;
    background: var(--border);
    margin: 32px 0;
  }

  /* Note/Help Text */
  .note {
    font-size: 13px;
    color: var(--text-tertiary);
    margin-top: 8px;
  }

  /* Login Card Special */
  .login-card {
    max-width: 400px;
    margin: 120px auto;
    text-align: center;
  }

  .login-card h1 {
    font-size: 32px;
    font-weight: 700;
    margin-bottom: 12px;
  }

  .login-card p {
    color: var(--text-secondary);
    margin-bottom: 32px;
  }

  .login-card .btn {
    width: 100%;
  }

  /* Responsive */
  @media (max-width: 768px) {
    .hero h1 { font-size: 32px; }
    .hero p { font-size: 17px; }
    .card { padding: 24px; }
    .grid { grid-template-columns: 1fr; }
    .nav-links { display: none; }
  }

  /* Animation */
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .card { animation: fadeIn 0.4s ease; }

  /* Dark Mode Toggle */
  .theme-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border-radius: 980px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    color: var(--text-secondary);
    transition: all 0.2s ease;
  }

  .theme-toggle:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .theme-toggle .icon {
    font-size: 16px;
  }
</style>
</head>
<body>
${body}
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

  // Auto-login via token from Discord bot
  app.get("/auth/token", (req, res) => {
    const token = req.query.token;
    if (!token) return res.redirect("/login");

    const user = consumeAutoLoginToken(token);
    if (!user) {
      return res.send(htmlPage("Login Failed", `
        <div class="wrap">
          <div class="card login-card">
            <h1>Link Expired</h1>
            <p>This login link has expired or was already used.</p>
            <a href="/login" class="btn btn-primary">Sign in with Discord</a>
          </div>
        </div>
      `));
    }

    // Check if user is an admin
    if (!ADMIN_USER_IDS.has(user.id)) {
      return res.status(403).send("Forbidden (not admin).");
    }

    req.session.user = user;
    res.redirect("/dashboard");
  });

  app.get("/login", (req, res) => {
    // If already logged in, redirect to dashboard
    if (req.session.user && ADMIN_USER_IDS.has(req.session.user.id)) {
      return res.redirect("/dashboard");
    }

    const auth = new URL("https://discord.com/api/oauth2/authorize");
    auth.searchParams.set("client_id", CLIENT_ID);
    auth.searchParams.set("redirect_uri", REDIRECT_URI);
    auth.searchParams.set("response_type", "code");
    auth.searchParams.set("scope", "identify");

    res.send(htmlPage("Login", `
      <div class="wrap">
        <div class="card login-card">
          <h1>Casino Admin</h1>
          <p>Sign in to manage balances, odds, and player overrides.</p>
          <a href="${auth.toString()}" class="btn btn-primary">Continue with Discord</a>
        </div>
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
        <td><strong>${u.balance}</strong></td>
        <td>
          <form method="POST" action="/balances/${u.user_id}" style="display:flex;gap:8px;align-items:center;">
            <input type="number" name="balance" value="${u.balance}" min="0" step="1" style="max-width:120px;"/>
            <button class="btn btn-primary btn-sm" type="submit">Save</button>
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
              <button class="btn btn-danger btn-sm" type="submit">Clear</button>
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

      // Dark Mode Toggle
      const themeToggle = document.getElementById('themeToggle');
      const themeIcon = document.getElementById('themeIcon');
      const themeText = document.getElementById('themeText');
      
      function setTheme(dark) {
        if (dark) {
          document.body.classList.add('dark-mode');
          themeIcon.textContent = '☀️';
          themeText.textContent = 'Light';
          localStorage.setItem('theme', 'dark');
        } else {
          document.body.classList.remove('dark-mode');
          themeIcon.textContent = '🌙';
          themeText.textContent = 'Dark';
          localStorage.setItem('theme', 'light');
        }
      }
      
      // Initialize theme from localStorage
      const savedTheme = localStorage.getItem('theme');
      if (savedTheme === 'dark') {
        setTheme(true);
      } else {
        setTheme(false);
      }
      
      themeToggle.addEventListener('click', () => {
        const isDark = document.body.classList.contains('dark-mode');
        setTheme(!isDark);
      });
    `;

    res.send(htmlPage("Dashboard", `
      <nav class="nav-header">
        <div class="nav-inner">
          <div class="nav-brand">Casino Admin</div>
          <div class="nav-links">
            <a href="#odds">Odds</a>
            <a href="#balances">Balances</a>
            <a href="#overrides">Overrides</a>
          </div>
          <div class="nav-user">
            <button class="theme-toggle" id="themeToggle">
              <span class="icon" id="themeIcon">🌙</span>
              <span id="themeText">Dark</span>
            </button>
            <span>Welcome, <strong>${req.session.user.username}</strong></span>
            <a href="/logout">Sign Out</a>
          </div>
        </div>
      </nav>

      <div class="wrap">
        <section class="hero">
          <h1>Control Center</h1>
          <p>Manage game odds, player balances, and individual overrides.</p>
        </section>

        <div class="card" id="odds">
          <div class="card-header">
            <h2>Game Odds <span class="badge">Global</span></h2>
            <p>Configure win probabilities for each game. Changes apply to all players without individual overrides.</p>
          </div>

          <div class="grid">
            <div class="grid-item">
              <h3>🪙 Coinflip</h3>
              <form method="POST" action="/config/coinflip">
                <label>Heads Probability</label>
                <div class="value-display" id="coinflipHeadsLabel">${headsPct}%</div>
                <input id="coinflipHeadsPct" type="range" name="headsPct" min="0" max="100" value="${headsPct}"/>
                <button class="btn btn-primary btn-sm" type="submit" style="margin-top:16px;">Update</button>
              </form>
            </div>

            <div class="grid-item">
              <h3>🎰 Slots</h3>
              <form method="POST" action="/config/slots">
                <label>Win Chance</label>
                <div class="value-display" id="slotsWinLabel">${slotsPct}%</div>
                <input id="slotsWinPct" type="range" name="winPct" min="0" max="100" value="${slotsPct}"/>
                <button class="btn btn-primary btn-sm" type="submit" style="margin-top:16px;">Update</button>
              </form>
            </div>

            <div class="grid-item">
              <h3>🎡 Roulette</h3>
              <form method="POST" action="/config/roulette">
                <label>Player Win Bias</label>
                <div class="value-display" id="rouletteWinLabel">${roulPct}%</div>
                <input id="rouletteWinPct" type="range" name="winPct" min="0" max="100" value="${roulPct}"/>
                <button class="btn btn-primary btn-sm" type="submit" style="margin-top:16px;">Update</button>
              </form>
            </div>

            <div class="grid-item">
              <h3>🃏 Blackjack</h3>
              <form method="POST" action="/config/blackjack">
                <label>Player Win Bias</label>
                <div class="value-display" id="blackjackWinLabel">${bjPct}%</div>
                <input id="blackjackWinPct" type="range" name="winPct" min="0" max="100" value="${bjPct}"/>
                <button class="btn btn-primary btn-sm" type="submit" style="margin-top:16px;">Update</button>
              </form>
            </div>

            <div class="grid-item">
              <h3>🎲 Dice</h3>
              <form method="POST" action="/config/dice">
                <label>Player Win Bias</label>
                <div class="value-display" id="diceWinLabel">${dicePct}%</div>
                <input id="diceWinPct" type="range" name="winPct" min="0" max="100" value="${dicePct}"/>
                <button class="btn btn-primary btn-sm" type="submit" style="margin-top:16px;">Update</button>
              </form>
            </div>

            <div class="grid-item">
              <h3>📈 High-Low</h3>
              <form method="POST" action="/config/highlow">
                <label>Player Win Bias</label>
                <div class="value-display" id="highlowWinLabel">${highlowPct}%</div>
                <input id="highlowWinPct" type="range" name="winPct" min="0" max="100" value="${highlowPct}"/>
                <button class="btn btn-primary btn-sm" type="submit" style="margin-top:16px;">Update</button>
              </form>
            </div>
          </div>

          <div class="divider"></div>
          <form method="POST" action="/config/reset-all" style="display: inline-block;">
            <button class="btn btn-danger btn-sm" type="submit">Reset All to Defaults</button>
          </form>
          <span class="note" style="margin-left: 16px;">Restore all odds to their original values.</span>
        </div>

        <div class="card" id="balances">
          <div class="card-header">
            <h2>Player Balances</h2>
            <p>View and modify player coin balances. Showing top 200 players.</p>
          </div>

          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th>User ID</th>
                  <th>Balance</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>${rows || '<tr><td colspan="3" style="text-align:center;color:var(--text-secondary);">No players yet</td></tr>'}</tbody>
            </table>
          </div>

          <div class="divider"></div>
          <h3>Set Any Balance</h3>
          <form method="POST" action="/balances/set-any" style="max-width: 400px;">
            <label>User ID</label>
            <input type="text" name="user_id" placeholder="Enter Discord user ID" />
            <label style="margin-top:16px;">Balance</label>
            <input type="number" name="balance" min="0" step="1" placeholder="0" />
            <button class="btn btn-primary" type="submit" style="margin-top:20px;">Set Balance</button>
          </form>
          <p class="note" style="margin-top:16px;">Access restricted to admin users only.</p>
        </div>

        <div class="card" id="overrides">
          <div class="card-header">
            <h2>Per-User Overrides</h2>
            <p>Set custom win rates for specific players. Values override global settings.</p>
          </div>

          <form method="POST" action="/user-odds" style="max-width: 100%;">
            <label>User ID</label>
            <input type="text" name="user_id" placeholder="Enter Discord user ID" required style="max-width: 400px;" />

            <div class="grid" style="margin-top: 24px;">
              <div class="grid-item">
                <label>Coinflip (%)</label>
                <input type="number" name="coinflipHeadsPct" min="0" max="100" value="${headsPct}" required />
              </div>
              <div class="grid-item">
                <label>Slots (%)</label>
                <input type="number" name="slotsWinPct" min="0" max="100" value="${slotsPct}" required />
              </div>
              <div class="grid-item">
                <label>Roulette (%)</label>
                <input type="number" name="rouletteWinPct" min="0" max="100" value="${roulPct}" required />
              </div>
              <div class="grid-item">
                <label>Blackjack (%)</label>
                <input type="number" name="blackjackWinPct" min="0" max="100" value="${bjPct}" required />
              </div>
              <div class="grid-item">
                <label>Dice (%)</label>
                <input type="number" name="diceWinPct" min="0" max="100" value="${dicePct}" required />
              </div>
              <div class="grid-item">
                <label>High-Low (%)</label>
                <input type="number" name="highlowWinPct" min="0" max="100" value="${highlowPct}" required />
              </div>
            </div>

            <button class="btn btn-primary" type="submit" style="margin-top:24px;">Save Override</button>
          </form>

          <div class="divider"></div>
          <h3>Active Overrides</h3>
          <div class="table-container">
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
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>${overrideRows || '<tr><td colspan="8" style="text-align:center;color:var(--text-secondary);">No overrides set</td></tr>'}</tbody>
            </table>
          </div>
        </div>
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

  app.post("/config/reset-all", mustBeAuthed, (req, res) => {
    // Reset all global odds to their default values
    setConfig("coinflip", { headsProb: 0.5 });
    setConfig("slots", { winChance: 0.28 });
    setConfig("roulette", { playerWinChance: 0.47 });
    setConfig("blackjack", { playerWinChance: 0.45 });
    setConfig("dice", { playerWinChance: 0.18 });
    setConfig("highlow", { playerWinChance: 0.5 });
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
  app.listen(PORT, DASHBOARD_HOST, () => {
    console.log(`🛠️ Dashboard: http://${DASHBOARD_HOST}:${PORT}/login`);
  });
}

module.exports = { startDashboard, createAutoLoginToken };
