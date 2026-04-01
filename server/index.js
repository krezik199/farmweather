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

// ── NWS grid point cache (permanent — grid points don't change) ──
const nwsGridCache = new Map();
const NWS_HEADERS = { 'User-Agent': 'FarmWeather/1.0 (farmweather@hyerfarms.com)' };

async function getNWSGridPoint(lat, lon) {
  const key = `${lat},${lon}`;
  if (nwsGridCache.has(key)) return nwsGridCache.get(key);
  const res = await fetch(`https://api.weather.gov/points/${lat},${lon}`, { headers: NWS_HEADERS });
  if (!res.ok) throw new Error(`NWS points lookup failed (${res.status}) for ${lat},${lon}`);
  const data = await res.json();
  const { cwa: office, gridX, gridY, forecastHourly, forecastGridData } = data.properties;
  const grid = { office, gridX, gridY, forecastHourly, forecastGridData };
  nwsGridCache.set(key, grid);
  return grid;
}

// Converts m/s to mph
function msToMph(ms) { return ms == null ? null : Math.round(ms * 2.23694); }
// Converts km/h to mph (NWS windSpeed and windGust grid values are in km/h)
function kphToMph(kph) { return kph == null ? null : Math.round(kph * 0.621371); }
// Converts celsius to fahrenheit
function cToF(c) { return c == null ? null : (c * 9/5) + 32; }
// Converts mm to inches
function mmToIn(mm) { return mm == null ? null : mm / 25.4; }

// Parse NWS ISO duration values like "2019-07-04T18:00:00+00:00/PT3H"
function parseNWSTimeSeries(values, targetTimes, transform = v => v) {
  const map = new Map();
  for (const { validTime, value } of values) {
    const [timeStr, durationStr] = validTime.split('/');
    const start = new Date(timeStr);
    const hours = (() => {
      const h = durationStr.match(/PT?(\d+)H/);
      const d = durationStr.match(/P(\d+)D/);
      if (h) return parseInt(h[1]);
      if (d) return parseInt(d[1]) * 24;
      return 1;
    })();
    for (let i = 0; i < hours; i++) {
      const t = new Date(start.getTime() + i * 3600000);
      const key = t.toISOString().slice(0, 13);
      map.set(key, transform(value));
    }
  }
  return targetTimes.map(t => {
    const key = new Date(t).toISOString().slice(0, 13);
    return map.get(key) ?? null;
  });
}

async function fetchWeather(farm) {
  const { office, gridX, gridY, forecastHourly, forecastGridData } =
    await getNWSGridPoint(farm.lat, farm.lon);

  const [hourlyRes, gridRes] = await Promise.all([
    fetch(forecastHourly, { headers: NWS_HEADERS }),
    fetch(forecastGridData, { headers: NWS_HEADERS }),
  ]);
  if (!hourlyRes.ok) throw new Error(`NWS hourly forecast failed (${hourlyRes.status})`);
  if (!gridRes.ok)   throw new Error(`NWS grid data failed (${gridRes.status})`);

  const [hourlyData, gridData] = await Promise.all([hourlyRes.json(), gridRes.json()]);
  const props = gridData.properties;

  const hourlyPeriods = hourlyData.properties.periods.slice(0, 168);
  const hourlyTimes = hourlyPeriods.map(p => p.startTime);

  const hourly = {
    time:                     hourlyTimes,
    temperature_2m:           hourlyPeriods.map(p => p.temperature),
    wind_speed_10m:           hourlyPeriods.map(p => {
      const match = String(p.windSpeed).match(/(\d+)/);
      return match ? parseInt(match[1]) : 0;
    }),
    wind_direction_10m:       hourlyPeriods.map(p => {
      const dirs = {N:0,NNE:22,NE:45,ENE:67,E:90,ESE:112,SE:135,SSE:157,S:180,SSW:202,SW:225,WSW:247,W:270,WNW:292,NW:315,NNW:337};
      return dirs[p.windDirection] ?? 0;
    }),
    precipitation_probability: hourlyPeriods.map(p => p.probabilityOfPrecipitation?.value ?? 0),
    precipitation:             parseNWSTimeSeries(
      props.quantitativePrecipitation?.values || [],
      hourlyTimes,
      v => mmToIn(v)
    ),
    weather_code:              hourlyPeriods.map(p => {
      const f = (p.shortForecast || '').toLowerCase();
      if (f.includes('thunder'))                    return 95;
      if (f.includes('snow') || f.includes('blizzard')) return 71;
      if (f.includes('sleet') || f.includes('freezing')) return 67;
      if (f.includes('rain') && f.includes('heavy')) return 65;
      if (f.includes('showers') || f.includes('rain')) return 61;
      if (f.includes('drizzle'))                    return 51;
      if (f.includes('fog'))                        return 45;
      if (f.includes('overcast') || f.includes('cloudy') && f.includes('mostly')) return 3;
      if (f.includes('partly') || f.includes('partly cloudy'))  return 2;
      if (f.includes('sunny') || f.includes('clear'))           return 0;
      return 1;
    }),
  };

  const tz = 'America/Los_Angeles';
  const todayPacific = new Date().toLocaleDateString('en-US', { timeZone: tz, year:'numeric', month:'2-digit', day:'2-digit' });
  const [tm, td, ty] = todayPacific.split('/');
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(`${ty}-${tm}-${td}T12:00:00-08:00`);
    d.setDate(d.getDate() + i);
    return d.toISOString().split('T')[0];
  });

  function dailyFromGrid(gridValues, transform = v => v) {
    return days.map(day => {
      const vals = [];
      for (const { validTime, value } of (gridValues || [])) {
        if (value == null) continue;
        const t = new Date(validTime.split('/')[0]);
        const dateStr = t.toLocaleDateString('en-US', { timeZone: tz, year:'numeric', month:'2-digit', day:'2-digit' });
        const [m, dd, y] = dateStr.split('/');
        if (`${y}-${m}-${dd}` === day) vals.push(transform(value));
      }
      return vals;
    });
  }

  const tempMaxVals  = dailyFromGrid(props.maxTemperature?.values,  cToF);
  const tempMinVals  = dailyFromGrid(props.minTemperature?.values,  cToF);
  const windMaxVals  = dailyFromGrid(props.windSpeed?.values,        kphToMph);
  const gustMaxVals  = dailyFromGrid(props.windGust?.values,         kphToMph);
  const precipVals   = dailyFromGrid(props.quantitativePrecipitation?.values, v => mmToIn(v));
  const precipProbVals = dailyFromGrid(props.probabilityOfPrecipitation?.values);

  function getSunriseSunset(dayStr) {
    const d = new Date(dayStr + 'T12:00:00-08:00');
    const lat = farm.lat * Math.PI / 180;
    const doy = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
    const decl = -23.45 * Math.cos((360/365) * (doy + 10) * Math.PI/180) * Math.PI/180;
    const ha = Math.acos(-Math.tan(lat) * Math.tan(decl)) * 180/Math.PI;
    const sunrise = 12 - ha/15;
    const sunset  = 12 + ha/15;
    const toTime = (h) => {
      const base = new Date(dayStr + 'T00:00:00-08:00');
      base.setMinutes(Math.round(h * 60));
      return base.toISOString();
    };
    return { sunrise: toTime(sunrise), sunset: toTime(sunset) };
  }

  function dailyWeatherCode(day) {
    const dayHours = hourly.time
      .map((t, i) => ({ t, code: hourly.weather_code[i] }))
      .filter(({ t }) => t.startsWith(day));
    if (!dayHours.length) return 1;
    return dayHours.reduce((max, { code }) => (code || 0) > max ? code : max, 0);
  }

  const daily = {
    time: days,
    temperature_2m_max:            days.map((_, i) => tempMaxVals[i].length  ? Math.max(...tempMaxVals[i])  : null),
    temperature_2m_min:            days.map((_, i) => tempMinVals[i].length  ? Math.min(...tempMinVals[i])  : null),
    precipitation_sum:             days.map((_, i) => precipVals[i].length   ? precipVals[i].reduce((a,b) => a + b, 0) : 0),
    precipitation_probability_max: days.map((_, i) => precipProbVals[i].length ? Math.max(...precipProbVals[i]) : 0),
    wind_speed_10m_max:            days.map((_, i) => windMaxVals[i].length  ? Math.max(...windMaxVals[i])  : 0),
    wind_gusts_10m_max:            days.map((_, i) => gustMaxVals[i].length  ? Math.max(...gustMaxVals[i])  : 0),
    wind_direction_10m_dominant:   days.map(() => 0),
    weather_code:                  days.map(d => dailyWeatherCode(d)),
    sunrise:                       days.map(d => getSunriseSunset(d).sunrise),
    sunset:                        days.map(d => getSunriseSunset(d).sunset),
  };

  const cur = hourlyPeriods[0];
  const windMatch = String(cur?.windSpeed || '0').match(/(\d+)/);
  const current = {
    temperature_2m:       cur?.temperature ?? null,
    apparent_temperature: cur?.temperature ?? null,
    relative_humidity_2m: parseNWSTimeSeries(props.relativeHumidity?.values || [], [hourlyTimes[0]], v => v)[0] ?? null,
    precipitation:        0,
    weather_code:         hourly.weather_code[0],
    wind_speed_10m:       windMatch ? parseInt(windMatch[1]) : 0,
    wind_direction_10m:   hourly.wind_direction_10m[0],
    wind_gusts_10m:       parseNWSTimeSeries(props.windGust?.values || [], [hourlyTimes[0]], kphToMph)[0] ?? 0,
  };

  return { current, hourly, daily };
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
// WEATHER (auth required, proxied from NWS)
// ═══════════════════════════════════════════════

const weatherCache = new Map();
const WEATHER_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

app.get('/api/weather/:farmId', requireAuth, async (req, res) => {
  const farmId = parseInt(req.params.farmId);
  const userFarms = getUserFarms(req.session.userId, req.session.username);
  let farm = userFarms.find(f => f.id === farmId);
  if (!farm) {
    const oldIdx = farmId - 1;
    if (oldIdx >= 0 && oldIdx < userFarms.length) farm = userFarms[oldIdx];
  }
  if (!farm) return res.status(404).json({ error: 'Farm not found' });

  const cached = weatherCache.get(farmId);
  if (cached && Date.now() - cached.cachedAt < WEATHER_CACHE_TTL) {
    return res.json(cached.data);
  }

  try {
    const data = await fetchWeather(farm);
    weatherCache.set(farmId, { data, cachedAt: Date.now() });
    res.json(data);
  } catch (err) {
    console.error(`[Weather] Error for farm ${farm.name}:`, err.message);
    res.status(500).json({ error: err.message });
  }
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
// GDD CACHE — disk-persisted, 12-hour TTL
// Survives Render cold starts; on 429 serves stale data silently
// ═══════════════════════════════════════════════

const GDD_CACHE_FILE = path.join(DATA_DIR, 'gdd_cache.json');
const GDD_CACHE_TTL  = 12 * 60 * 60 * 1000; // 12 hours

function loadGDDCacheFile() {
  try { return JSON.parse(fs.readFileSync(GDD_CACHE_FILE, 'utf8')); } catch { return {}; }
}
function saveGDDCacheFile(cache) {
  ensureDataDir();
  try { fs.writeFileSync(GDD_CACHE_FILE, JSON.stringify(cache)); } catch (e) { console.error('[GDD Cache] Save error:', e.message); }
}

function getGDDCache(fieldId) {
  const cache = loadGDDCacheFile();
  const entry = cache[String(fieldId)];
  if (!entry) return null;
  // Return data regardless of age — caller decides whether it's fresh
  return entry;
}
function setGDDCache(fieldId, data) {
  const cache = loadGDDCacheFile();
  cache[String(fieldId)] = { data, cachedAt: Date.now() };
  saveGDDCacheFile(cache);
}
function clearGDDCache(fieldId) {
  const cache = loadGDDCacheFile();
  delete cache[String(fieldId)];
  saveGDDCacheFile(cache);
}

app.get('/api/fields/:id/gdd', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  const field = loadFields().find(f => f.id === id && f.userId === req.session.userId);
  if (!field) return res.status(404).json({ error: 'Field not found' });

  const userFarms = getUserFarms(req.session.userId, req.session.username);
  let farm = userFarms.find(f => f.id === parseInt(field.farmId));
  if (!farm) {
    const oldIdx = parseInt(field.farmId) - 1;
    if (oldIdx >= 0 && oldIdx < userFarms.length) farm = userFarms[oldIdx];
  }
  if (!farm) return res.status(400).json({ error: `Farm not found — farmId: ${field.farmId}. Please re-save this field.` });

  // Check cache — return immediately if fresh (< 12 hours old)
  const cached = getGDDCache(id);
  if (cached && Date.now() - cached.cachedAt < GDD_CACHE_TTL) {
    return res.json(cached.data);
  }

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

    // Use NWS for 7-day forecast GDD projection
    const { forecastGridData } = await getNWSGridPoint(farm.lat, farm.lon);
    const nwsFcastRes = await fetch(forecastGridData, { headers: NWS_HEADERS });
    if (!nwsFcastRes.ok) throw new Error(`NWS forecast failed (${nwsFcastRes.status})`);
    const nwsFcastData = await nwsFcastRes.json();
    const nwsProps = nwsFcastData.properties;
    const tz = 'America/Los_Angeles';
    const todayStr = new Date().toLocaleDateString('en-US', { timeZone: tz, year:'numeric', month:'2-digit', day:'2-digit' });
    const [ftm, ftd, fty] = todayStr.split('/');
    const fcastDays14 = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(`${fty}-${ftm}-${ftd}T12:00:00-08:00`);
      d.setDate(d.getDate() + i);
      return d.toISOString().split('T')[0];
    });
    function nwsDailyMinMax(gridValues, transform, day) {
      const vals = [];
      for (const { validTime, value } of (gridValues || [])) {
        if (value == null) continue;
        const t = new Date(validTime.split('/')[0]);
        const ds = t.toLocaleDateString('en-US', { timeZone: tz, year:'numeric', month:'2-digit', day:'2-digit' });
        const [m, dd, y] = ds.split('/');
        if (`${y}-${m}-${dd}` === day) vals.push(transform(value));
      }
      return vals;
    }
    let forecastCumulative = totalGDD;
    const forecastDays = fcastDays14.map(date => {
      const maxVals = nwsDailyMinMax(nwsProps.maxTemperature?.values, cToF, date);
      const minVals = nwsDailyMinMax(nwsProps.minTemperature?.values, cToF, date);
      const tmaxRaw = maxVals.length ? Math.max(...maxVals) : 70;
      const tminRaw = minVals.length ? Math.min(...minVals) : 45;
      const tmax = Math.min(tmaxRaw, 86);
      const tmin = Math.max(tminRaw, BASE);
      const gdd = Math.max(0, ((tmax + tmin) / 2) - BASE);
      forecastCumulative += gdd;
      return { date, tmax: tmaxRaw, tmin: tminRaw, gdd: Math.round(gdd * 10) / 10, projected: Math.round(forecastCumulative * 10) / 10 };
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

  } catch (err) {
    // On any error (including 429 rate limit), serve stale cache if available
    if (cached) {
      console.warn(`[GDD] Fetch failed for field ${id} (${err.message}), serving stale cache from ${new Date(cached.cachedAt).toLocaleString()}`);
      return res.json(cached.data);
    }
    res.status(500).json({ error: err.message });
  }
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
  const userFieldIds = new Set(loadFields().filter(f => f.userId === req.session.userId).map(f => f.id));
  res.json(loadObs().filter(o => userFieldIds.has(o.fieldId)));
});

app.post('/api/observations', requireAuth, (req, res) => {
  const { fieldId, stage, date, notes, gddAtObservation } = req.body;
  if (!fieldId || !stage || !date) return res.status(400).json({ error: 'Missing required fields' });
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
