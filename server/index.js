const express = require('express');
const webpush = require('web-push');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../dist')));

// ── VAPID config ──
webpush.setVapidDetails(
  'mailto:' + (process.env.VAPID_EMAIL || 'you@example.com'),
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// ═══════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════

const DATA_DIR = process.env.DATA_DIR || '/data';

function ensureDataDir() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const attempt = crypto.scryptSync(password, salt, 64).toString('hex');
  return attempt === hash;
}

const USERS_FILE = path.join(DATA_DIR, 'users.json');
function loadUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch { return []; }
}
function saveUsers(users) {
  ensureDataDir();
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// ── Default farm sets ──
const HYER_FARMS = [
  { id: 1, name: "Wheeler",     lat: 47.145960, lon: -119.084559 },
  { id: 2, name: "Meyer",       lat: 47.228213, lon: -119.087152 },
  { id: 3, name: "Hirz",        lat: 47.263619, lon: -119.205851 },
  { id: 4, name: "County Line", lat: 47.115975, lon: -118.981951 },
  { id: 5, name: "Kulm",        lat: 46.995123, lon: -118.849620 },
  { id: 6, name: "Lincoln",     lat: 47.309481, lon: -118.915966 },
  { id: 7, name: "Wilbur",      lat: 47.634717, lon: -118.657076 },
];
const DEFAULT_FARMS = [
  { id: Date.now(), name: "Moses Lake", lat: 47.21337627564896, lon: -119.4912443529655 },
];

function getDefaultFarmsForUser(username) {
  const lower = username.toLowerCase();
  if (lower === 'admin' || lower === 'hyerfarms') {
    return HYER_FARMS.map(f => ({ ...f }));
  }
  return [{ id: 100, name: "Moses Lake", lat: 47.21337627564896, lon: -119.4912443529655 }];
}

// Seed default accounts on first run
(function seedUsers() {
  ensureDataDir();
  let users = loadUsers();
  if (users.length > 0) {
    console.log('[Auth] Users already exist:', users.map(u => u.username).join(', '));
    return;
  }
  const defaults = [
    { username: 'admin',     password: 'andrewhyer', role: 'admin' },
    { username: 'hyerfarms', password: 'eatorganic', role: 'user'  },
    { username: 'test1',     password: 'password',   role: 'user'  },
    { username: 'test2',     password: 'password',   role: 'user'  },
  ];
  users = defaults.map(u => ({
    id: crypto.randomUUID(),
    username: u.username,
    passwordHash: hashPassword(u.password),
    role: u.role,
    createdAt: new Date().toISOString(),
  }));
  saveUsers(users);
  console.log('[Auth] Seeded users:', users.map(u => u.username).join(', '));
})();

// In-memory session store: token -> { userId, username, role, createdAt }
const sessions = new Map();

function createSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { userId: user.id, username: user.username, role: user.role, createdAt: Date.now() });
  return token;
}

setInterval(() => {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  for (const [token, sess] of sessions) {
    if (sess.createdAt < cutoff) sessions.delete(token);
  }
}, 60 * 60 * 1000);

function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token || !sessions.has(token)) return res.status(401).json({ error: 'Unauthorized' });
  req.session = sessions.get(token);
  next();
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.session.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    next();
  });
}

// Login
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const users = loadUsers();
  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase().trim());
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  const token = createSession(user);
  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

// Logout
app.post('/api/auth/logout', requireAuth, (req, res) => {
  sessions.delete(req.headers['authorization'].slice(7));
  res.json({ ok: true });
});

// Verify session
app.get('/api/auth/me', requireAuth, (req, res) => {
  const users = loadUsers();
  const user = users.find(u => u.id === req.session.userId);
  if (!user) return res.status(401).json({ error: 'User not found' });
  res.json({ user: { id: user.id, username: user.username, role: user.role } });
});

// Admin: list users
app.get('/api/auth/users', requireAdmin, (req, res) => {
  res.json(loadUsers().map(u => ({ id: u.id, username: u.username, role: u.role, createdAt: u.createdAt })));
});

// Admin: create user
app.post('/api/auth/users', requireAdmin, (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const users = loadUsers();
  if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
    return res.status(409).json({ error: 'Username already exists' });
  }
  const newUser = { id: crypto.randomUUID(), username: username.trim(), passwordHash: hashPassword(password), role: role === 'admin' ? 'admin' : 'user', createdAt: new Date().toISOString() };
  users.push(newUser);
  saveUsers(users);
  res.json({ id: newUser.id, username: newUser.username, role: newUser.role });
});

// Admin: delete user
app.delete('/api/auth/users/:id', requireAdmin, (req, res) => {
  const users = loadUsers();
  const target = users.find(u => u.id === req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.id === req.session.userId) return res.status(400).json({ error: 'Cannot delete your own account' });
  saveUsers(users.filter(u => u.id !== req.params.id));
  res.json({ ok: true });
});

// Admin: reset password
app.put('/api/auth/users/:id/password', requireAdmin, (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password required' });
  const users = loadUsers();
  const idx = users.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'User not found' });
  users[idx].passwordHash = hashPassword(password);
  saveUsers(users);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════
// PER-USER FARMS
// ═══════════════════════════════════════════════

const USER_FARMS_FILE = path.join(DATA_DIR, 'user_farms.json');

function loadUserFarms() {
  try { return JSON.parse(fs.readFileSync(USER_FARMS_FILE, 'utf8')); } catch { return {}; }
}
function saveUserFarms(data) {
  ensureDataDir();
  fs.writeFileSync(USER_FARMS_FILE, JSON.stringify(data, null, 2));
}

// Get farms for a user — seeds defaults if first time
function getUserFarms(userId, username) {
  const all = loadUserFarms();
  if (!all[userId]) {
    all[userId] = getDefaultFarmsForUser(username);
    saveUserFarms(all);
  }
  return all[userId];
}

// GET /api/farms — returns this user's farms
app.get('/api/farms', requireAuth, (req, res) => {
  res.json(getUserFarms(req.session.userId, req.session.username));
});

// POST /api/farms — add a farm
app.post('/api/farms', requireAuth, (req, res) => {
  const { name, lat, lon } = req.body;
  if (!name || lat == null || lon == null) return res.status(400).json({ error: 'name, lat, lon required' });
  const all = loadUserFarms();
  const farms = getUserFarms(req.session.userId, req.session.username);
  const newFarm = { id: Date.now(), name: name.trim(), lat: parseFloat(lat), lon: parseFloat(lon) };
  farms.push(newFarm);
  all[req.session.userId] = farms;
  saveUserFarms(all);
  res.json(newFarm);
});

// PUT /api/farms/:id — edit a farm
app.put('/api/farms/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  const all = loadUserFarms();
  const farms = getUserFarms(req.session.userId, req.session.username);
  const idx = farms.findIndex(f => f.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Farm not found' });
  farms[idx] = { ...farms[idx], ...req.body, id };
  all[req.session.userId] = farms;
  saveUserFarms(all);
  res.json(farms[idx]);
});

// DELETE /api/farms/:id — remove a farm
app.delete('/api/farms/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  const all = loadUserFarms();
  const farms = getUserFarms(req.session.userId, req.session.username);
  all[req.session.userId] = farms.filter(f => f.id !== id);
  saveUserFarms(all);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════
// SUBSCRIPTIONS
// ═══════════════════════════════════════════════

const SUBS_FILE = path.join(__dirname, 'subscriptions.json');
function loadSubs() {
  try { return JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8')); } catch { return []; }
}
function saveSubs(subs) {
  fs.writeFileSync(SUBS_FILE, JSON.stringify(subs, null, 2));
}

// ═══════════════════════════════════════════════
// ALERTS & WEATHER  (uses all HYER_FARMS for push checks)
// ═══════════════════════════════════════════════

const FROST_THRESHOLDS = [
  { temp: 28, label: "HARD FREEZE WARNING", emoji: "🥶" },
  { temp: 32, label: "FREEZE WARNING",       emoji: "❄️" },
  { temp: 36, label: "FROST POSSIBLE",       emoji: "🌡️" },
];
const RAIN_PROB_THRESHOLD = 50;
const RAIN_AMT_THRESHOLD  = 0.1;
const WIND_THRESHOLD      = 20;
const HEAT_THRESHOLD      = 95;
const LOOKAHEAD_DAYS      = 3;

async function fetchWeather(farm) {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${farm.lat}&longitude=${farm.lon}` +
    `&daily=temperature_2m_min,temperature_2m_max,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max` +
    `&hourly=precipitation,precipitation_probability,temperature_2m,wind_speed_10m` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch` +
    `&timezone=America%2FLos_Angeles&forecast_days=${LOOKAHEAD_DAYS + 1}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Weather fetch failed for ${farm.name}`);
  return res.json();
}

async function sendPush(title, body, tag) {
  const subs = loadSubs();
  const payload = JSON.stringify({ title, body, tag });
  const dead = [];
  for (const sub of subs) {
    try { await webpush.sendNotification(sub, payload); }
    catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) dead.push(sub.endpoint);
      else console.error('Push error:', err.message);
    }
  }
  if (dead.length) saveSubs(subs.filter(s => !dead.includes(s.endpoint)));
  return subs.length - dead.length;
}

async function sendPushToOne(subscription, title, body, tag) {
  const payload = JSON.stringify({ title, body, tag });
  try {
    await webpush.sendNotification(subscription, payload);
    return true;
  } catch (err) {
    if (err.statusCode === 410 || err.statusCode === 404) saveSubs(loadSubs().filter(s => s.endpoint !== subscription.endpoint));
    else console.error('Push error:', err.message);
    return false;
  }
}

const alertedThisWindow = new Set();
function alertWindowKey(farmId, type, date) {
  const now = new Date();
  const w = Math.floor(now.getHours() / 6);
  return `${now.toDateString()}:${w}:${farmId}:${type}:${date}`;
}

function dayLabel(dateStr) {
  const nowPacific = new Date().toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', year:'numeric', month:'2-digit', day:'2-digit' });
  const [m, d, y] = nowPacific.split('/');
  const todayPacific = `${y}-${m}-${d}`;
  const tomorrowDate = new Date(`${todayPacific}T12:00:00-08:00`);
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrowPacific = tomorrowDate.toISOString().split('T')[0];
  if (dateStr === todayPacific) return 'today';
  if (dateStr === tomorrowPacific) return 'tomorrow';
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

// Push alerts check against all Hyer farms (the main farm set)
async function checkAllFarms(manual = false, targetSub = null, farmsToCheck = HYER_FARMS) {
  console.log(`[${new Date().toISOString()}] Checking weather (manual=${manual})...`);
  const dayMap = {};
  for (const farm of farmsToCheck) {
    try {
      const data = await fetchWeather(farm);
      for (let i = 0; i < LOOKAHEAD_DAYS; i++) {
        const date = data.daily.time[i];
        const low = data.daily.temperature_2m_min[i];
        const high = data.daily.temperature_2m_max[i];
        const rainProb = data.daily.precipitation_probability_max[i];
        const rainAmt = data.daily.precipitation_sum[i];
        const maxWind = data.daily.wind_speed_10m_max[i];
        const maxGusts = data.daily.wind_gusts_10m_max[i];
        if (!dayMap[date]) dayMap[date] = { frost:[], rain:[], wind:[], heat:[] };
        const worstFrost = FROST_THRESHOLDS.find(t => low <= t.temp);
        if (worstFrost) dayMap[date].frost.push({ farm: farm.name, low, threshold: worstFrost });
        if (rainProb >= RAIN_PROB_THRESHOLD || rainAmt >= RAIN_AMT_THRESHOLD) dayMap[date].rain.push({ farm: farm.name, prob: rainProb, amt: rainAmt });
        if (maxWind >= WIND_THRESHOLD) dayMap[date].wind.push({ farm: farm.name, speed: Math.round(maxWind), gusts: Math.round(maxGusts) });
        if (high >= HEAT_THRESHOLD) dayMap[date].heat.push({ farm: farm.name, high });
      }
    } catch (err) { console.error(`  Error fetching ${farm.name}:`, err.message); }
  }

  const allAlerts = [];
  for (const date of Object.keys(dayMap).sort()) {
    const day = dayMap[date];
    const label = dayLabel(date);
    if (!day.frost.length && !day.rain.length && !day.wind.length && !day.heat.length) continue;
    const key = alertWindowKey('all', 'summary', date);
    if (!manual && alertedThisWindow.has(key)) continue;
    alertedThisWindow.add(key);

    const worstOverall = day.frost.length ? FROST_THRESHOLDS.find(t => day.frost.some(f => f.threshold.temp === t.temp)) : null;
    const titleParts = [];
    if (worstOverall)    titleParts.push(`${worstOverall.emoji} ${worstOverall.label}`);
    if (day.rain.length) titleParts.push('🌧️ Rain');
    if (day.wind.length) titleParts.push('💨 Wind');
    if (day.heat.length) titleParts.push('🌡️ Heat');
    const title = `${label.charAt(0).toUpperCase() + label.slice(1)}: ${titleParts.join(' · ')}`;

    const lines = [];
    if (day.frost.length) {
      const byLevel = {};
      for (const f of day.frost) { if (!byLevel[f.threshold.label]) byLevel[f.threshold.label] = []; byLevel[f.threshold.label].push(`${f.farm} (${Math.round(f.low)}°F)`); }
      for (const [lbl, farms] of Object.entries(byLevel)) lines.push(`${lbl}: ${farms.join(', ')}`);
    }
    if (day.rain.length) lines.push(`Rain: ${day.rain.map(r => `${r.farm} (${r.prob}%)`).join(', ')}`);
    if (day.wind.length) {
      const worst = day.wind.reduce((a, b) => b.speed > a.speed ? b : a);
      lines.push(`Wind ${worst.speed} mph, gusts ${worst.gusts} mph: ${day.wind.map(w => w.farm).join(', ')}`);
    }
    if (day.heat.length) lines.push(`Heat: ${day.heat.map(h => `${h.farm} (${Math.round(h.high)}°F)`).join(', ')}`);

    const body = lines.join(' | ');
    if (targetSub) await sendPushToOne(targetSub, title, body, `summary-${date}`);
    else await sendPush(title, body, `summary-${date}`);
    console.log(`  [summary] ${date}: ${title}`);
    allAlerts.push({ date, label, title, body, frost: day.frost, rain: day.rain, wind: day.wind, heat: day.heat });
  }
  return allAlerts;
}

// ═══════════════════════════════════════════════
// PUSH ROUTES (auth required)
// ═══════════════════════════════════════════════

app.get('/api/vapid-public-key', (req, res) => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY });
});

app.post('/api/subscribe', requireAuth, (req, res) => {
  const sub = req.body;
  if (!sub?.endpoint) return res.status(400).json({ error: 'Invalid subscription' });
  const subs = loadSubs();
  if (!subs.find(s => s.endpoint === sub.endpoint)) { subs.push(sub); saveSubs(subs); }
  res.json({ ok: true, count: subs.length });
});

app.delete('/api/subscribe', requireAuth, (req, res) => {
  saveSubs(loadSubs().filter(s => s.endpoint !== req.body.endpoint));
  res.json({ ok: true });
});

app.post('/api/test-push', requireAuth, async (req, res) => {
  try {
    const { subscription } = req.body;
    if (subscription) await sendPushToOne(subscription, '🧪 Test Alert', 'FarmWeather push notifications are working!', 'test');
    else await sendPush('🧪 Test Alert', 'FarmWeather push notifications are working!', 'test');
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Manual alert check — uses the requesting user's farms
app.post('/api/check-alerts', requireAuth, async (req, res) => {
  try {
    const { subscription } = req.body;
    const userFarms = getUserFarms(req.session.userId, req.session.username);
    const alerts = await checkAllFarms(true, subscription || null, userFarms);
    res.json({ ok: true, count: alerts.length, alerts });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/debug-alerts', requireAuth, async (req, res) => {
  try {
    const userFarms = getUserFarms(req.session.userId, req.session.username);
    const results = [];
    for (const farm of userFarms) {
      const data = await fetchWeather(farm);
      const days = [];
      for (let i = 0; i < LOOKAHEAD_DAYS; i++) {
        days.push({ date: data.daily.time[i], low: data.daily.temperature_2m_min[i], high: data.daily.temperature_2m_max[i], rainProb: data.daily.precipitation_probability_max[i], rainAmt: data.daily.precipitation_sum[i], wind: data.daily.wind_speed_10m_max[i], gusts: data.daily.wind_gusts_10m_max[i] });
      }
      results.push({ farm: farm.name, days });
    }
    res.json(results);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════
// FIELDS (auth required, scoped to user)
// ═══════════════════════════════════════════════

const FIELDS_FILE = path.join(DATA_DIR, 'fields.json');
function loadFields() {
  try { return JSON.parse(fs.readFileSync(FIELDS_FILE, 'utf8')); } catch { return []; }
}
function saveFields(fields) {
  ensureDataDir();
  fs.writeFileSync(FIELDS_FILE, JSON.stringify(fields, null, 2));
}

async function fetchGDDData(lat, lon, plantingDate) {
  const end = new Date().toISOString().split('T')[0];
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&timezone=America%2FLos_Angeles&start_date=${plantingDate}&end_date=${end}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GDD archive fetch failed (${res.status})`);
  const data = await res.json();
  if (!data.daily) throw new Error(`Archive API error: ${data.reason || JSON.stringify(data)}`);
  return data;
}

(function migrateFields() {
  try {
    const fields = loadFields();
    let changed = false;
    fields.forEach(f => { if (typeof f.farmId !== 'number') { f.farmId = parseInt(f.farmId); changed = true; } });
    if (changed) { saveFields(fields); console.log('[Migration] Coerced farmId to number'); }
  } catch(e) { console.error('[Migration] Error:', e.message); }
})();

// Fields are scoped to the requesting user
app.get('/api/fields', requireAuth, (req, res) => {
  const fields = loadFields().filter(f => f.userId === req.session.userId);
  res.json(fields);
});

app.post('/api/fields', requireAuth, (req, res) => {
  const { name, farmId, crop, plantingDate } = req.body;
  if (!name || !farmId || !crop || !plantingDate) return res.status(400).json({ error: 'Missing required fields' });

  const fields = loadFields();
  const field = { id: Date.now(), userId: req.session.userId, name, farmId: parseInt(farmId), crop, variety: req.body.variety || '', plantingDate, createdAt: new Date().toISOString() };
  fields.push(field);
  saveFields(fields);
  res.json(field);
});

app.put('/api/fields/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  const fields = loadFields();
  const idx = fields.findIndex(f => f.id === id && f.userId === req.session.userId);
  if (idx === -1) return res.status(404).json({ error: 'Field not found' });
  fields[idx] = { ...fields[idx], ...req.body, id, userId: req.session.userId };
  saveFields(fields);
  clearGDDCache(id);
  res.json(fields[idx]);
});

app.delete('/api/fields/:id', requireAuth, (req, res) => {
  const delId = parseInt(req.params.id);
  saveFields(loadFields().filter(f => !(f.id === delId && f.userId === req.session.userId)));
  clearGDDCache(delId);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════
// GDD CACHE (in-memory, 3-hour TTL)
// ═══════════════════════════════════════════════

const gddCache = new Map(); // key: `${fieldId}` -> { data, cachedAt }
const GDD_CACHE_TTL = 12 * 60 * 60 * 1000; // 12 hours

function getGDDCache(fieldId) {
  const entry = gddCache.get(String(fieldId));
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > GDD_CACHE_TTL) { gddCache.delete(String(fieldId)); return null; }
  return entry.data;
}
function setGDDCache(fieldId, data) {
  gddCache.set(String(fieldId), { data, cachedAt: Date.now() });
}
function clearGDDCache(fieldId) {
  gddCache.delete(String(fieldId));
}

app.get('/api/fields/:id/gdd', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  const field = loadFields().find(f => f.id === id && f.userId === req.session.userId);
  if (!field) return res.status(404).json({ error: 'Field not found' });

  // Look up farm from this user's farm list
  // Try by id first, then fall back to matching by position (for fields saved with old static ids 1-7)
  const userFarms = getUserFarms(req.session.userId, req.session.username);
  let farm = userFarms.find(f => f.id === parseInt(field.farmId));
  if (!farm) {
    // Old static IDs were 1-7 in order; try matching by index position as fallback
    const oldIdx = parseInt(field.farmId) - 1;
    if (oldIdx >= 0 && oldIdx < userFarms.length) farm = userFarms[oldIdx];
  }
  if (!farm) return res.status(400).json({ error: `Farm not found — farmId: ${field.farmId}. Please re-save this field.` });

  // Return cached result if fresh
  const cached = getGDDCache(id);
  if (cached) return res.json(cached);

  try {
    const BASE = 45;
    const today = new Date().toISOString().split('T')[0];
    let daily = [], totalGDD = 0;

    if (field.plantingDate <= today) {
      const data = await fetchGDDData(farm.lat, farm.lon, field.plantingDate);
      let cumulative = 0;
      daily = data.daily.time.map((date, i) => {
        const tmax = Math.min(data.daily.temperature_2m_max[i], 86);
        const tmin = Math.max(data.daily.temperature_2m_min[i], BASE);
        const gdd = Math.max(0, ((tmax + tmin) / 2) - BASE);
        cumulative += gdd;
        return { date, tmax: data.daily.temperature_2m_max[i], tmin: data.daily.temperature_2m_min[i], gdd: Math.round(gdd * 10) / 10, cumulative: Math.round(cumulative * 10) / 10 };
      });
      totalGDD = Math.round(cumulative * 10) / 10;
    }

    const fcastRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${farm.lat}&longitude=${farm.lon}&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&timezone=America%2FLos_Angeles&forecast_days=14`);
    const fcastData = await fcastRes.json();
    if (!fcastData.daily) throw new Error(`Forecast API error: ${fcastData.reason || JSON.stringify(fcastData)}`);
    let forecastCumulative = totalGDD;
    const forecastDays = fcastData.daily.time.map((date, i) => {
      const tmax = Math.min(fcastData.daily.temperature_2m_max[i], 86);
      const tmin = Math.max(fcastData.daily.temperature_2m_min[i], BASE);
      const gdd = Math.max(0, ((tmax + tmin) / 2) - BASE);
      forecastCumulative += gdd;
      return { date, tmax: fcastData.daily.temperature_2m_max[i], tmin: fcastData.daily.temperature_2m_min[i], gdd: Math.round(gdd * 10) / 10, projected: Math.round(forecastCumulative * 10) / 10 };
    });

    const CROP_STAGES = {
      onion:  [{ name:"Emergence",gdd:100},{name:"3-Leaf Stage",gdd:400},{name:"Bulb Initiation",gdd:800},{name:"Bulb Fill",gdd:1400},{name:"Maturity",gdd:2000}],
      potato: [{ name:"Emergence",gdd:100},{name:"Tuber Initiation",gdd:350},{name:"Tuber Bulking",gdd:700},{name:"Maturity",gdd:1200}],
    };
    const stageProjections = (CROP_STAGES[field.crop] || []).map(stage => {
      if (totalGDD >= stage.gdd) {
        const reachedDay = daily.find(d => d.cumulative >= stage.gdd);
        return { name: stage.name, gdd: stage.gdd, reached: true, date: reachedDay ? reachedDay.date : null };
      }
      const forecastDay = forecastDays.find(d => d.projected >= stage.gdd);
      if (forecastDay) return { name: stage.name, gdd: stage.gdd, reached: false, date: forecastDay.date, daysAway: forecastDays.indexOf(forecastDay) + 1 };
      const last7 = forecastDays.slice(-7);
      const avgGDDperDay = last7.reduce((sum, d) => sum + d.gdd, 0) / last7.length;
      const gddNeeded = stage.gdd - forecastCumulative;
      if (avgGDDperDay > 0) {
        const extraDays = Math.ceil(gddNeeded / avgGDDperDay);
        const lastDate = new Date(forecastDays[forecastDays.length - 1].date + 'T12:00:00');
        lastDate.setDate(lastDate.getDate() + extraDays);
        return { name: stage.name, gdd: stage.gdd, reached: false, date: lastDate.toISOString().split('T')[0], daysAway: forecastDays.length + extraDays, estimated: true };
      }
      return { name: stage.name, gdd: stage.gdd, reached: false, date: null, daysAway: null };
    });

    const result = { field, farm: farm.name, daily, totalGDD, daysTracked: daily.length, forecastDays, stageProjections };
    setGDDCache(id, result);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════
// OBSERVATIONS (scoped to user via their fields)
// ═══════════════════════════════════════════════

const OBS_FILE = path.join(DATA_DIR, 'observations.json');
function loadObs() {
  try { return JSON.parse(fs.readFileSync(OBS_FILE, 'utf8')); } catch { return []; }
}
function saveObs(obs) {
  ensureDataDir();
  fs.writeFileSync(OBS_FILE, JSON.stringify(obs, null, 2));
}

app.get('/api/observations', requireAuth, (req, res) => {
  // Only return observations for this user's fields
  const userFieldIds = new Set(loadFields().filter(f => f.userId === req.session.userId).map(f => f.id));
  res.json(loadObs().filter(o => userFieldIds.has(o.fieldId)));
});

app.post('/api/observations', requireAuth, (req, res) => {
  const { fieldId, stage, date, notes, gddAtObservation } = req.body;
  if (!fieldId || !stage || !date) return res.status(400).json({ error: 'Missing required fields' });
  // Verify field belongs to user
  const field = loadFields().find(f => f.id === parseInt(fieldId) && f.userId === req.session.userId);
  if (!field) return res.status(403).json({ error: 'Field not found or not yours' });
  const obs = loadObs();
  const filtered = obs.filter(o => !(o.fieldId === parseInt(fieldId) && o.stage === stage));
  const newObs = { id: Date.now(), fieldId: parseInt(fieldId), stage, date, notes: notes || '', gddAtObservation: gddAtObservation ?? null, createdAt: new Date().toISOString() };
  filtered.push(newObs);
  saveObs(filtered);
  res.json(newObs);
});

app.delete('/api/observations/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  const userFieldIds = new Set(loadFields().filter(f => f.userId === req.session.userId).map(f => f.id));
  const obs = loadObs();
  const target = obs.find(o => o.id === id);
  if (target && !userFieldIds.has(target.fieldId)) return res.status(403).json({ error: 'Not yours' });
  saveObs(obs.filter(o => o.id !== id));
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════
// BACKUP / RESTORE (scoped to user)
// ═══════════════════════════════════════════════

app.get('/api/backup', requireAuth, (req, res) => {
  const userFieldIds = new Set(loadFields().filter(f => f.userId === req.session.userId).map(f => f.id));
  res.json({
    farms: getUserFarms(req.session.userId, req.session.username),
    fields: loadFields().filter(f => f.userId === req.session.userId),
    observations: loadObs().filter(o => userFieldIds.has(o.fieldId)),
  });
});

app.post('/api/restore/fields', requireAuth, (req, res) => {
  try {
    const incoming = req.body;
    if (!Array.isArray(incoming)) return res.status(400).json({ error: 'Expected an array' });
    const fields = loadFields().filter(f => f.userId !== req.session.userId);
    const stamped = incoming.map(f => ({ ...f, userId: req.session.userId }));
    saveFields([...fields, ...stamped]);
    res.json({ ok: true, count: stamped.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/restore/observations', requireAuth, (req, res) => {
  try {
    const obs = req.body;
    if (!Array.isArray(obs)) return res.status(400).json({ error: 'Expected an array' });
    saveObs(obs);
    res.json({ ok: true, count: obs.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── React fallback ──
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../dist/index.html'));
});

// ── Cron — checks Hyer farms for push alerts ──
cron.schedule('0 6 * * *',  () => checkAllFarms(), { timezone: 'America/Los_Angeles' });
cron.schedule('0 12 * * *', () => checkAllFarms(), { timezone: 'America/Los_Angeles' });
cron.schedule('0 18 * * *', () => checkAllFarms(), { timezone: 'America/Los_Angeles' });

console.log('[Startup] FarmWeather server ready. Alerts scheduled at 6am, 12pm, 6pm Pacific.');

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`FarmWeather server running on port ${PORT}`));
