const Database = require("better-sqlite3");
const db = new Database("casino.sqlite");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  balance INTEGER NOT NULL DEFAULT 0,
  last_daily INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_config (
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);
`);

function getUser(userId) {
  const row = db.prepare("SELECT user_id, balance, last_daily FROM users WHERE user_id = ?").get(userId);
  if (row) return row;
  db.prepare("INSERT INTO users (user_id, balance, last_daily) VALUES (?, 0, 0)").run(userId);
  return { user_id: userId, balance: 0, last_daily: 0 };
}

function addBalance(userId, delta) {
  const u = getUser(userId);
  const newBal = u.balance + delta;
  db.prepare("UPDATE users SET balance = ? WHERE user_id = ?").run(newBal, userId);
  return newBal;
}

function setBalance(userId, balance) {
  getUser(userId);
  db.prepare("UPDATE users SET balance = ? WHERE user_id = ?").run(balance, userId);
}

function setLastDaily(userId, tsMs) {
  getUser(userId);
  db.prepare("UPDATE users SET last_daily = ? WHERE user_id = ?").run(tsMs, userId);
}

// --- CONFIG ---
function setConfig(key, valueObj) {
  const value = JSON.stringify(valueObj);
  db.prepare(`
    INSERT INTO config (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
  `).run(key, value);
}

function getConfig(key, defaultObj) {
  const row = db.prepare("SELECT value FROM config WHERE key = ?").get(key);
  if (!row) {
    setConfig(key, defaultObj);
    return defaultObj;
  }
  try {
    return JSON.parse(row.value);
  } catch {
    setConfig(key, defaultObj);
    return defaultObj;
  }
}

function getUserConfig(userId, key) {
  const row = db.prepare("SELECT value FROM user_config WHERE user_id = ? AND key = ?").get(userId, key);
  if (!row) return null;
  try {
    return JSON.parse(row.value);
  } catch {
    return null;
  }
}

function setUserConfig(userId, key, valueObj) {
  const value = JSON.stringify(valueObj);
  db.prepare(`
    INSERT INTO user_config (user_id, key, value) VALUES (?, ?, ?)
    ON CONFLICT(user_id, key) DO UPDATE SET value=excluded.value
  `).run(userId, key, value);
}

function clearUserConfig(userId, key) {
  db.prepare("DELETE FROM user_config WHERE user_id = ? AND key = ?").run(userId, key);
}

function getEffectiveConfig(userId, key, defaultObj) {
  const globalCfg = getConfig(key, defaultObj);
  const userCfg = getUserConfig(userId, key);
  const merged = { ...defaultObj, ...globalCfg };
  if (userCfg && typeof userCfg === "object") {
    Object.entries(userCfg).forEach(([field, value]) => {
      if (value !== undefined) merged[field] = value;
    });
  }
  return merged;
}

module.exports = {
  db,
  getUser,
  addBalance,
  setBalance,
  setLastDaily,
  getConfig,
  setConfig,
  getUserConfig,
  setUserConfig,
  clearUserConfig,
  getEffectiveConfig,
};
