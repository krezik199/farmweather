const express = require('express');
const webpush = require('web-push');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../dist')));

// ── VAPID config (set these as environment variables on Render) ──
webpush.setVapidDetails(
  'mailto:' + (process.env.VAPID_EMAIL || 'you@example.com'),
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// ── Subscription storage (flat file — fine for a small crew) ──
const SUBS_FILE = path.join(__dirname, 'subscriptions.json');
function loadSubs() {
  try { return JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8')); } catch { return []; }
}
function saveSubs(subs) {
  fs.writeFileSync(SUBS_FILE, JSON.stringify(subs, null, 2));
}

// ── Farm locations (pulled from env or defaults) ──
const FARMS = JSON.parse(process.env.FARMS || JSON.stringify([
  { id: 1, name: "Wheeler",     lat: 47.145960, lon: -119.084559 },
  { id: 2, name: "Meyer",       lat: 47.228213, lon: -119.087152 },
  { id: 3, name: "Hirz",        lat: 47.263619, lon: -119.205851 },
  { id: 4, name: "County Line", lat: 47.115975, lon: -118.981951 },
  { id: 5, name: "Kulm",        lat: 46.995123, lon: -118.849620 },
  { id: 6, name: "Lincoln",     lat: 47.309481, lon: -118.915966 },
  { id: 7, name: "Wilbur",      lat: 47.634717, lon: -118.657076 },
]));

// ── Alert thresholds ──
const FROST_THRESHOLDS = [
  { temp: 28, label: "HARD FREEZE WARNING", emoji: "🥶" },
  { temp: 32, label: "FREEZE WARNING",       emoji: "❄️" },
  { temp: 36, label: "FROST POSSIBLE",       emoji: "🌡️" },
];
const RAIN_LOOKAHEAD_HOURS = 6;
const RAIN_PROB_THRESHOLD  = 50;  // % chance to trigger
const RAIN_AMT_THRESHOLD   = 0.05; // inches

// ── Fetch weather from Open-Meteo ──
async function fetchWeather(farm) {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${farm.lat}&longitude=${farm.lon}` +
    `&daily=temperature_2m_min,precipitation_sum,precipitation_probability_max` +
    `&hourly=precipitation,precipitation_probability,temperature_2m` +
    `&temperature_unit=fahrenheit&precipitation_unit=inch` +
    `&timezone=America%2FLos_Angeles&forecast_days=2`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Weather fetch failed for ${farm.name}`);
  return res.json();
}

// ── Send push to all subscribers ──
async function sendPush(title, body, tag) {
  const subs = loadSubs();
  const payload = JSON.stringify({ title, body, tag });
  const dead = [];
  for (const sub of subs) {
    try {
      await webpush.sendNotification(sub, payload);
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) dead.push(sub.endpoint);
      else console.error('Push error:', err.message);
    }
  }
  if (dead.length) saveSubs(subs.filter(s => !dead.includes(s.endpoint)));
}

// ── Alert state (prevent duplicate alerts same day) ──
const alertedToday = new Set();
function alertKey(farmId, type) {
  return `${new Date().toDateString()}:${farmId}:${type}`;
}

// ── Core check logic ──
async function checkAllFarms() {
  console.log(`[${new Date().toISOString()}] Checking weather for all farms...`);
  for (const farm of FARMS) {
    try {
      const data = await fetchWeather(farm);
      const tonightLow = data.daily.temperature_2m_min[0];

      // Frost checks
      for (const threshold of FROST_THRESHOLDS) {
        const key = alertKey(farm.id, `frost-${threshold.temp}`);
        if (tonightLow <= threshold.temp && !alertedToday.has(key)) {
          alertedToday.add(key);
          await sendPush(
            `${threshold.emoji} ${threshold.label} — ${farm.name}`,
            `Tonight's low: ${Math.round(tonightLow)}°F at ${farm.name}. Check tender crops.`,
            `frost-${farm.id}`
          );
          console.log(`  Frost alert sent for ${farm.name}: ${Math.round(tonightLow)}°F`);
        }
      }

      // Rain in next N hours check
      const now = new Date();
      const rainKey = alertKey(farm.id, 'rain');
      if (!alertedToday.has(rainKey)) {
        const upcoming = data.hourly.time
          .map((t, i) => ({ time: new Date(t), prob: data.hourly.precipitation_probability[i], amt: data.hourly.precipitation[i] }))
          .filter(h => h.time >= now && h.time <= new Date(now.getTime() + RAIN_LOOKAHEAD_HOURS * 3600000));

        const rainHour = upcoming.find(h => h.prob >= RAIN_PROB_THRESHOLD || h.amt >= RAIN_AMT_THRESHOLD);
        if (rainHour) {
          alertedToday.add(rainKey);
          const hrs = Math.round((rainHour.time - now) / 3600000);
          await sendPush(
            `🌧️ Rain Expected — ${farm.name}`,
            `${rainHour.prob}% chance of rain in ~${hrs} hour${hrs !== 1 ? 's' : ''} at ${farm.name}.`,
            `rain-${farm.id}`
          );
          console.log(`  Rain alert sent for ${farm.name}`);
        }
      }
    } catch (err) {
      console.error(`  Error checking ${farm.name}:`, err.message);
    }
  }
}

// ── API routes ──
app.get('/api/vapid-public-key', (req, res) => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY });
});

app.post('/api/subscribe', (req, res) => {
  const sub = req.body;
  if (!sub?.endpoint) return res.status(400).json({ error: 'Invalid subscription' });
  const subs = loadSubs();
  if (!subs.find(s => s.endpoint === sub.endpoint)) {
    subs.push(sub);
    saveSubs(subs);
    console.log(`New subscriber: ${sub.endpoint.slice(0, 50)}...`);
  }
  res.json({ ok: true, count: subs.length });
});

app.delete('/api/subscribe', (req, res) => {
  const { endpoint } = req.body;
  const subs = loadSubs().filter(s => s.endpoint !== endpoint);
  saveSubs(subs);
  res.json({ ok: true });
});

app.post('/api/test-push', async (req, res) => {
  try {
    await sendPush('🧪 Test Alert', 'FarmWeather push notifications are working!', 'test');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve React app for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../dist/index.html'));
});

// ── Cron schedule: check every 30 minutes ──
cron.schedule('*/30 * * * *', checkAllFarms);

// Also run once on startup
checkAllFarms();

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`FarmWeather server running on port ${PORT}`));
